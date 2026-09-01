const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { CustomNodePackageManager, inspectArchive } = require("../core/desktop/custom-node-package-manager.cjs");
const sandbox = require("../core/desktop/custom-node-sandbox-contract.cjs");
const { CustomNodeSandboxBroker } = require("../core/desktop/custom-node-sandbox-broker.cjs");
const { CustomNodeElectronRunner } = require("../core/desktop/custom-node-electron-runner.cjs");
const { CustomNodeToolDispatcher } = require("../core/desktop/custom-node-tool-dispatcher.cjs");

const crc32 = (buffer) => {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
};

const zipStored = (files = {}) => {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, raw] of Object.entries(files)) {
    const nameBytes = Buffer.from(name);
    const content = Buffer.from(raw);
    const crc = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const centralRecord = Buffer.alloc(46);
    centralRecord.writeUInt32LE(0x02014b50, 0);
    centralRecord.writeUInt16LE(20, 4);
    centralRecord.writeUInt16LE(20, 6);
    centralRecord.writeUInt32LE(crc, 16);
    centralRecord.writeUInt32LE(content.length, 20);
    centralRecord.writeUInt32LE(content.length, 24);
    centralRecord.writeUInt16LE(nameBytes.length, 28);
    centralRecord.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, content);
    central.push(centralRecord, nameBytes);
    offset += local.length + nameBytes.length + content.length;
  }
  const centralBuffer = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, eocd]);
};

const manifest = {
  id: "custom.example-node",
  name: "Example Node",
  version: "1.0.0",
  publisher: "example-dev",
  category: "processors",
  subtype: "example",
  inputs: ["input"],
  outputs: ["output"],
  permissions: { runtimeGraph: "read" },
  runtime: { entry: "runtime.js", mode: "sandboxed" },
  ui: { schema: "ui.json" }
};

test("Custom Node ZIP inspection validates the root manifest without executing runtime code", () => {
  const archive = zipStored({
    "node.json": JSON.stringify(manifest),
    "runtime.js": "throw new Error('must not execute');",
    "ui.json": "{}",
    "assets/": "",
    "assets/icon.svg": "<svg/>"
  });
  const inspected = inspectArchive(archive);
  assert.equal(inspected.manifest.id, "custom.example-node");
  assert.equal(inspected.runtimeExecution, "blocked");
  assert.equal(inspected.files.length, 5);
  assert.match(inspected.archiveSha256, /^[a-f0-9]{64}$/);
  assert.equal(inspected.staticAnalysis.status, "reviewed");
  assert.equal(inspected.staticAnalysis.findings.length, 0);
});

test("Custom Node ZIP static audit reports direct sensitive APIs and undeclared permissions without executing code", () => {
  const archive = zipStored({
    "node.json": JSON.stringify(manifest),
    "runtime.js": "const value = eval('1'); fetch('https://example.invalid'); require('fs');",
    "ui.json": "{}"
  });
  const inspected = inspectArchive(archive);
  const network = inspected.staticAnalysis.findings.find((finding) => finding.code === "NETWORK");
  assert.equal(inspected.staticAnalysis.entry, "runtime.js");
  assert.equal(inspected.staticAnalysis.findings.some((finding) => finding.code === "DYNAMIC_CODE"), true);
  assert.equal(inspected.staticAnalysis.findings.some((finding) => finding.code === "FILESYSTEM"), true);
  assert.equal(network.permissionDeclared, false);
});

test("Custom Node ZIP rejects path traversal before import", () => {
  const archive = zipStored({ "node.json": JSON.stringify(manifest), "../runtime.js": "unsafe" });
  assert.throws(() => inspectArchive(archive), { code: "CUSTOM_NODE_ZIP_PATH_UNSAFE" });
});

test("Custom Node sandbox contract grants only declared capabilities and rejects undeclared tool messages", () => {
  const packageRecord = {
    packageId: manifest.id,
    version: manifest.version,
    archive: { sha256: "a".repeat(64) },
    permissions: { aiProvider: true, runtimeGraph: "read" },
    runtimeExecution: "sandboxed",
    manifest
  };
  const request = sandbox.createSandboxRequest({
    executionId: "run_1",
    nodeId: "node_1",
    packageRecord,
    grantedPermissions: { aiProvider: true, network: true, runtimeGraph: "write" }
  });
  assert.equal(request.permissions.aiProvider, true);
  assert.equal(request.permissions.network, false);
  assert.equal(request.permissions.runtimeGraph, "read");
  assert.equal(sandbox.validateSandboxRequest(request, packageRecord).ok, true);
  assert.equal(sandbox.validateSandboxMessage({ kind: "tool.call", tool: "ai.complete", callId: "call_0" }, { permissions: request.permissions }).ok, true);
  assert.equal(sandbox.validateSandboxMessage({ kind: "tool.call", tool: "memory.write" }, { permissions: request.permissions }).ok, false);
  assert.equal(sandbox.validateSandboxMessage({ kind: "emit", port: "not-declared" }, { outputs: manifest.outputs }).ok, false);
});

test("Custom Node sandbox contract never treats manifest-only packages as executable", () => {
  const packageRecord = {
    packageId: manifest.id,
    version: manifest.version,
    archive: { sha256: "b".repeat(64) },
    permissions: manifest.permissions,
    runtimeExecution: "blocked",
    manifest
  };
  const request = sandbox.createSandboxRequest({ executionId: "run_2", nodeId: "node_2", packageRecord });
  assert.equal(sandbox.validateSandboxRequest(request, packageRecord).ok, false);
  assert.match(sandbox.validateSandboxRequest(request, packageRecord).errors.join(" "), /not enabled/);
});

test("Custom Node sandbox broker rejects ungranted tools and keeps an inspectable event trace", async () => {
  const events = [];
  const broker = new CustomNodeSandboxBroker({ onEvent: (event) => events.push(event) });
  const packageRecord = {
    packageId: manifest.id, version: manifest.version, archive: { sha256: "c".repeat(64) },
    permissions: { aiProvider: true }, runtimeExecution: "sandboxed", manifest
  };
  const request = broker.open({ nodeId: "node_3", packageRecord, grantedPermissions: {} });
  assert.equal(broker.receive({ executionId: request.executionId, message: { kind: "ready" } }).status, "running");
  assert.throws(() => broker.receive({ executionId: request.executionId, message: { kind: "tool.call", tool: "ai.complete" } }), { code: "CUSTOM_NODE_SANDBOX_MESSAGE_REJECTED" });
  broker.receive({ executionId: request.executionId, message: { kind: "emit", port: "output", data: { safe: true } } });
  const completed = broker.wait(request.executionId);
  broker.receive({ executionId: request.executionId, message: { kind: "result", status: "success" } });
  assert.equal((await completed).status, "success");
  assert.equal(broker.get(request.executionId).status, "completed");
  assert.deepEqual(events.map((event) => event.kind), ["ready", "emit", "result"]);
});

test("Custom Node sandbox dispatches only a broker-authorized tool call", async () => {
  const calls = [];
  const broker = new CustomNodeSandboxBroker({ onToolCall: async (call) => { calls.push(call); return { ok: true }; } });
  const packageRecord = { packageId: manifest.id, version: manifest.version, archive: { sha256: "f".repeat(64) }, permissions: { aiProvider: true }, runtimeExecution: "sandboxed", manifest };
  const request = broker.open({ nodeId: "node_tools", packageRecord, grantedPermissions: { aiProvider: true } });
  const result = await broker.callTool({ executionId: request.executionId, message: { tool: "ai.complete", callId: "call_1", arguments: { prompt: "hello" } } });
  assert.deepEqual(result.result, { ok: true });
  assert.equal(calls[0].tool, "ai.complete");
  assert.equal(broker.get(request.executionId).events[0].kind, "tool.call");
  await assert.rejects(broker.callTool({ executionId: request.executionId, message: { tool: "memory.write", callId: "call_2" } }), { code: "CUSTOM_NODE_SANDBOX_MESSAGE_REJECTED" });
});

test("Custom Node runtime graph dispatcher is workspace-scoped and preflight-only for mutations", async () => {
  const calls = [];
  const dispatcher = new CustomNodeToolDispatcher({ persistence: { async readDevelopmentRecords({ storeName, workspaceId }) { calls.push({ storeName, workspaceId }); return storeName === "tl_runtime_dependencies" ? [{ id: `${storeName}_1`, workspaceId, sourceNodeId: "node_1", targetNodeId: "node_2" }] : [{ id: `${storeName}_1`, workspaceId }]; } } });
  const read = await dispatcher.dispatch({ tool: "runtimeGraph.read", request: { context: { workspaceId: "workspace_1" } } });
  assert.equal(read.graph.nodes.length, 1);
  assert.deepEqual(calls.map((call) => call.workspaceId), ["workspace_1", "workspace_1", "workspace_1"]);
  const preflight = await dispatcher.dispatch({ tool: "runtimeGraph.preflight", arguments: { action: "deleteNode", arguments: { nodeId: "node_1" } }, request: { context: { workspaceId: "workspace_1" } } });
  assert.equal(preflight.executable, false);
  assert.equal(preflight.proposedAction.tool, "deleteNode");
  assert.equal(preflight.proposedAction.affectedDependencies.length, 1);
  await assert.rejects(dispatcher.dispatch({ tool: "runtimeGraph.read", request: { context: {} } }), { code: "CUSTOM_NODE_TOOL_SCOPE_REQUIRED" });
  await assert.rejects(dispatcher.dispatch({ tool: "runtimeGraph.preflight", arguments: { action: "deleteEverything" }, request: { context: { workspaceId: "workspace_1" } } }), { code: "CUSTOM_NODE_PREFLIGHT_ACTION_INVALID" });
});

test("Custom Node sandbox rejects terminal messages without an explicit status", () => {
  assert.equal(sandbox.validateSandboxMessage({ kind: "result" }).ok, false);
  assert.equal(sandbox.validateSandboxMessage({ kind: "result", status: "cancelled" }).ok, false);
  assert.equal(sandbox.validateSandboxMessage({ kind: "result", status: "success" }).ok, true);
});

test("Custom Node Electron runner binds sandbox messages to the owning webContents", async () => {
  class FakeWebContents {
    constructor(id) { this.id = id; this.handlers = new Map(); }
    setWindowOpenHandler() {}
    on(name, listener) { this.handlers.set(name, listener); }
    send() {}
  }
  class FakeWindow {
    constructor() { this.webContents = new FakeWebContents(41); this.handlers = new Map(); }
    on(name, listener) { this.handlers.set(name, listener); }
    async loadFile() {}
    isDestroyed() { return false; }
  }
  const broker = new CustomNodeSandboxBroker();
  const runner = new CustomNodeElectronRunner({ BrowserWindow: FakeWindow, broker, runnerPage: __filename, runnerPreload: __filename });
  const packageRecord = {
    packageId: manifest.id, version: manifest.version, archive: { sha256: "d".repeat(64) },
    permissions: {}, runtimeExecution: "sandboxed", manifest
  };
  const request = broker.open({ nodeId: "node_4", packageRecord });
  const launched = await runner.launch({ request, source: "export const run = async () => {};" });
  assert.equal(launched.senderId, 41);
  assert.equal(runner.receive({ senderId: 41, message: { kind: "ready" } }).status, "running");
  assert.throws(() => runner.receive({ senderId: 42, message: { kind: "ready" } }), { code: "CUSTOM_NODE_SANDBOX_SENDER_INVALID" });
});

test("Custom Node manifest-only install copies the archive and catalogs opaque metadata", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "trackers-lens-custom-node-"));
  const archivePath = path.join(root, "example.tl-node.zip");
  fs.writeFileSync(archivePath, zipStored({ "node.json": JSON.stringify(manifest), "runtime.js": "throw new Error('must not execute');", "ui.json": "{}" }));
  const records = [];
  const persistence = {
    async writeDevelopmentRecords({ storeName, records: nextRecords }) {
      assert.equal(storeName, "tl_packages");
      records.push(...nextRecords.map((record) => JSON.parse(JSON.stringify(record))));
    },
    async readDevelopmentRecords({ storeName }) {
      assert.equal(storeName, "tl_packages");
      return records;
    }
  };
  const manager = new CustomNodePackageManager({ packagesDirectory: path.join(root, "app-data-packages"), persistence });
  const installed = await manager.installFile(archivePath);
  assert.equal(installed.installState, "manifest-only");
  assert.equal(installed.runtimeExecution, "blocked");
  assert.equal(installed.trustLevel, "local-dev");
  assert.equal(installed.staticAnalysis.status, "reviewed");
  assert.deepEqual(installed.grantedPermissions, { network: false, filesystem: false, aiProvider: false, memory: false, runtimeGraph: "none" });
  assert.equal(records.length, 1);
  assert.equal(Object.values(installed).some((value) => typeof value === "string" && value.includes(root)), false);
  const archivedFiles = fs.readdirSync(path.join(root, "app-data-packages", "custom.example-node", "1.0.0"));
  assert.equal(archivedFiles.length, 1);
  const installedHash = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "app-data-packages", "custom.example-node", "1.0.0", archivedFiles[0]))).digest("hex");
  assert.equal(installedHash, installed.archive.sha256);
  assert.deepEqual(await manager.listInstalled(), [installed]);
});

test("Custom Node permission grants require confirmation and cannot exceed the manifest", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "trackers-lens-custom-node-grants-"));
  const archivePath = path.join(root, "example.tl-node.zip");
  fs.writeFileSync(archivePath, zipStored({ "node.json": JSON.stringify(manifest), "runtime.js": "export const run = async () => {};", "ui.json": "{}" }));
  const records = [];
  const persistence = {
    async writeDevelopmentRecords({ records: nextRecords }) {
      for (const record of nextRecords) {
        const index = records.findIndex((item) => item.id === record.id);
        if (index >= 0) records[index] = JSON.parse(JSON.stringify(record));
        else records.push(JSON.parse(JSON.stringify(record)));
      }
    },
    async readDevelopmentRecords() { return records; }
  };
  const manager = new CustomNodePackageManager({ packagesDirectory: path.join(root, "app-data-packages"), persistence });
  const installed = await manager.installFile(archivePath);
  await assert.rejects(manager.grantPermissions({ packageId: installed.packageId, version: installed.version, archiveSha256: installed.archive.sha256 }), { code: "CUSTOM_NODE_PERMISSION_CONFIRMATION_REQUIRED" });
  const granted = await manager.grantPermissions({
    packageId: installed.packageId,
    version: installed.version,
    archiveSha256: installed.archive.sha256,
    permissions: { network: true, runtimeGraph: "write" },
    confirmed: true
  });
  assert.equal(granted.permissionConsent.status, "granted");
  assert.equal(granted.grantedPermissions.network, false);
  assert.equal(granted.grantedPermissions.runtimeGraph, "read");
});

test("Custom Node sandbox source loader requires an enabled, hash-verified catalog record", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "trackers-lens-custom-node-runtime-"));
  const archivePath = path.join(root, "example.tl-node.zip");
  fs.writeFileSync(archivePath, zipStored({ "node.json": JSON.stringify(manifest), "runtime.js": "export const run = async () => {};", "ui.json": "{}" }));
  const records = [];
  const persistence = {
    async writeDevelopmentRecords({ records: nextRecords }) { records.splice(0, records.length, ...nextRecords.map((record) => JSON.parse(JSON.stringify(record)))); },
    async readDevelopmentRecords() { return records; }
  };
  const manager = new CustomNodePackageManager({ packagesDirectory: path.join(root, "app-data-packages"), persistence });
  const installed = await manager.installFile(archivePath);
  const reference = { packageId: installed.packageId, version: installed.version, archiveSha256: installed.archive.sha256 };
  await assert.rejects(manager.loadSandboxRuntime(reference), { code: "CUSTOM_NODE_RUNTIME_BLOCKED" });
  records[0].runtimeExecution = "sandboxed";
  const loaded = await manager.loadSandboxRuntime(reference);
  assert.match(loaded.source, /export const run/);
  assert.equal(loaded.packageRecord.runtimeExecution, "sandboxed");
  assert.equal(Object.values(loaded).some((value) => typeof value === "string" && value.includes(root)), false);
});

test("Custom Node sandbox activation requires prior permission consent and exact package identity", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "trackers-lens-custom-node-activate-"));
  const archivePath = path.join(root, "example.tl-node.zip");
  fs.writeFileSync(archivePath, zipStored({ "node.json": JSON.stringify(manifest), "runtime.js": "export const run = async () => {};", "ui.json": "{}" }));
  const records = [];
  const persistence = { async writeDevelopmentRecords({ records: next }) { for (const record of next) { const index = records.findIndex((item) => item.id === record.id); if (index >= 0) records[index] = JSON.parse(JSON.stringify(record)); else records.push(JSON.parse(JSON.stringify(record))); } }, async readDevelopmentRecords() { return records; } };
  const manager = new CustomNodePackageManager({ packagesDirectory: path.join(root, "app-data-packages"), persistence });
  const installed = await manager.installFile(archivePath);
  const reference = { packageId: installed.packageId, version: installed.version, archiveSha256: installed.archive.sha256 };
  await assert.rejects(manager.activateSandboxRuntime({ ...reference, confirmed: true }), { code: "CUSTOM_NODE_PERMISSION_CONSENT_REQUIRED" });
  await manager.grantPermissions({ ...reference, permissions: manifest.permissions, confirmed: true });
  const activated = await manager.activateSandboxRuntime({ ...reference, confirmed: true });
  assert.equal(activated.runtimeExecution, "sandboxed");
  assert.equal(activated.installState, "sandbox-ready");
});
