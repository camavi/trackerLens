const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { TL_CORE_CONTRACT_VERSION, createTlCore } = require("../core/desktop/tl-core.cjs");
const { DesktopPersistence } = require("../core/desktop/desktop-persistence.cjs");
const executionContract = require("../core/runtime/node-execution-contract.js");
const { RuntimeManager } = require("../core/runtime/runtime-manager.js");

test("TL Core exposes desktop status without persistence handles", async () => {
  const core = createTlCore({ appVersion: "1.2.3", platform: "darwin", mode: "development" });
  const status = await core.request("desktop.getStatus");

  assert.equal(status.contractVersion, TL_CORE_CONTRACT_VERSION);
  assert.equal(status.appVersion, "1.2.3");
  assert.equal(status.platform, "darwin");
  assert.equal(status.featureFlags.electronDesktop, true);
  assert.equal(Object.hasOwn(status, "appDataPath"), false);
});

test("TL Core reports the renderer-owned runtime with SQLite desktop persistence", async () => {
  const core = createTlCore();
  const runtime = await core.request("runtime.getStatus");

  assert.equal(runtime.owner, "renderer-js-worker");
  assert.equal(runtime.persistence, "desktop-sqlite");
  assert.equal(runtime.runtimeManager, "javascript-registered");
});

test("TL Core permits only validated external URL requests", async () => {
  const opened = [];
  const core = createTlCore({ adapters: { openExternal: async (url) => opened.push(url) } });

  await core.request("desktop.openExternal", { url: "https://trackerslens.com" });
  await assert.rejects(core.request("desktop.openExternal", { url: "file:///etc/passwd" }), /not allowed/);
  await assert.rejects(core.request("storage.read"), /Unsupported TL Core command/);
  assert.deepEqual(opened, ["https://trackerslens.com"]);
});

test("desktop persistence exposes only status and an allow-listed import plan", async (context) => {
  const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "trackers-lens-persistence-"));
  context.after(() => fs.rmSync(fixtureDirectory, { recursive: true, force: true }));
  const persistence = new DesktopPersistence({ databasePath: path.join(fixtureDirectory, "fixture.sqlite"), profileId: "test" });
  const core = createTlCore({ adapters: { persistence } });
  const initialStatus = await core.request("desktop.persistence.getStatus");

  assert.equal(initialStatus.owner, "tl-core");
  assert.equal(initialStatus.mode, "desktop-sqlite");
  assert.equal(initialStatus.sqlite.exists, false);
  assert.equal(Object.hasOwn(initialStatus.sqlite, "path"), false);

  const bundle = {
    source: "test-fixture",
    stores: {
      tl_pages: [{ id: "page_1", workspaceId: "workspace_1", content: { title: "Test" } }],
      tl_runtime_nodes: [{ id: "node_1", workspaceId: "workspace_1", type: "processor" }]
    }
  };
  const plan = await core.request("desktop.persistence.planImport", { bundle });
  assert.equal(plan.recordCount, 2);
  assert.equal(plan.eligibleForImport, true);
  assert.deepEqual(plan.stores.map((store) => store.name), ["tl_pages", "tl_runtime_nodes"]);
  const incomplete = await core.request("desktop.persistence.planImport", { bundle: { stores: { tl_pages: [] }, missingStores: ["tl_channels"] } });
  assert.equal(incomplete.eligibleForImport, false);
  assert.deepEqual(incomplete.missingStores, ["tl_channels"]);
  const backupManifest = await core.request("desktop.persistence.planBackupManifest", {
    catalog: { stores: [{ name: "tl_history", recordCount: 2, contentHash: "a".repeat(64), kind: "storage-dynamic" }] }
  });
  assert.deepEqual(backupManifest.dynamicStores, ["tl_history"]);
  assert.equal(backupManifest.backupCreated, false);
  await assert.rejects(core.request("desktop.persistence.planImport", { bundle: { stores: { arbitrary_sql: [] } } }), /Unsupported persistence store/);
  await assert.rejects(core.request("desktop.persistence.executeSql", { sql: "SELECT 1" }), /Unsupported TL Core command/);
});

test("desktop persistence imports only disposable fixtures atomically and idempotently", (context) => {
  const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "trackers-lens-persistence-"));
  context.after(() => fs.rmSync(fixtureDirectory, { recursive: true, force: true }));
  const persistence = new DesktopPersistence({ databasePath: path.join(fixtureDirectory, "fixture.sqlite"), profileId: "fixture-test" });
  const bundle = {
    source: "fixture",
    stores: {
      tl_pages: [{ id: "page_1", workspaceId: "workspace_1", content: { name: "Workspace" } }],
      tl_widgets: [{ id: "widget_1", workspaceId: "workspace_1", content: { value: 3 } }]
    }
  };

  const first = persistence.importFixture(bundle);
  const second = persistence.importFixture(bundle);
  assert.equal(first.runId, second.runId);
  assert.equal(persistence.checkIntegrity(), "ok");
  assert.deepEqual(persistence.readFixtureRecords("tl_pages"), bundle.stores.tl_pages);
  assert.deepEqual(persistence.readFixtureRecords("tl_widgets"), bundle.stores.tl_widgets);
  assert.equal(persistence.getStatus().migration.userDataImport, false);
});

test("desktop persistence verifies a development first-cohort import without activating SQLite", (context) => {
  const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "trackers-lens-persistence-"));
  context.after(() => fs.rmSync(fixtureDirectory, { recursive: true, force: true }));
  const persistence = new DesktopPersistence({ databasePath: path.join(fixtureDirectory, "development.sqlite") });
  const result = persistence.importDevelopmentBundle({ stores: { tl_pages: [{ id: "page_1", workspaceId: "workspace_1" }], tl_channels: [] } });
  assert.equal(result.status, "verified-development");
  assert.equal(result.verification.recordCount, 1);
  assert.equal(persistence.verifyDevelopmentBundle({ stores: { tl_pages: [{ id: "page_1", workspaceId: "workspace_1" }], tl_channels: [] } }).status, "shadow-match");
  assert.deepEqual(persistence.readDevelopmentRecords({ storeName: "tl_pages", workspaceId: "workspace_1" }), [{ id: "page_1", workspaceId: "workspace_1" }]);
  assert.equal(persistence.writeDevelopmentRecords({ storeName: "tl_pages", records: [{ id: "page_2", workspaceId: "workspace_1", title: "SQLite page" }] }).status, "development-write-complete");
  assert.deepEqual(persistence.readDevelopmentRecords({ storeName: "tl_pages", workspaceId: "workspace_1" }), [{ id: "page_1", workspaceId: "workspace_1" }, { id: "page_2", workspaceId: "workspace_1", title: "SQLite page" }]);
  assert.equal(persistence.deleteDevelopmentRecords({ storeName: "tl_pages", ids: ["page_2"] }).status, "development-delete-complete");
  assert.deepEqual(persistence.readDevelopmentRecords({ storeName: "tl_pages", workspaceId: "workspace_1" }), [{ id: "page_1", workspaceId: "workspace_1" }]);
  assert.equal(persistence.verifyDevelopmentBundle({ stores: { tl_pages: [{ id: "page_1", workspaceId: "workspace_1" }], tl_channels: [] } }).status, "shadow-match");
  assert.throws(() => persistence.readDevelopmentRecords({ storeName: "tl_unapproved_records" }), /Unsupported persistence store/);
  assert.equal(persistence.getStatus().mode, "desktop-sqlite");
  assert.equal(persistence.setDevelopmentRuntimeActive({ active: true }).mode, "desktop-sqlite");
  assert.equal(persistence.setDevelopmentRuntimeActive({ active: false }).mode, "desktop-sqlite");
  assert.equal(persistence.writeDevelopmentRecords({ storeName: "tl_events", records: [{ id: "event_1", workspaceId: "workspace_1", eventType: "emitted" }] }).status, "development-write-complete");
  assert.deepEqual(persistence.readDevelopmentRecords({ storeName: "tl_events", workspaceId: "workspace_1" }), [{ id: "event_1", workspaceId: "workspace_1", eventType: "emitted" }]);
  assert.equal(persistence.deleteDevelopmentRecords({ storeName: "tl_events", ids: ["event_1"] }).status, "development-delete-complete");
  assert.equal(persistence.writeDevelopmentRecords({ storeName: "tl_knowledge_documents", records: [{ id: "doc_1", workspaceId: "workspace_1", title: "SQLite knowledge" }] }).status, "development-write-complete");
  assert.deepEqual(persistence.readDevelopmentRecords({ storeName: "tl_knowledge_documents", workspaceId: "workspace_1" }), [{ id: "doc_1", workspaceId: "workspace_1", title: "SQLite knowledge" }]);
  assert.deepEqual(persistence.listDevelopmentStores().map((store) => store.name).sort(), ["tl_knowledge_documents", "tl_pages"]);
});

test("TL Core keeps the Python POC opt-in behind narrow commands", async () => {
  const calls = [];
  const pythonPoc = {
    status: () => ({ status: "ready" }),
    start: async () => ({ status: "ready" }),
    execute: async (payload) => { calls.push(payload); return { status: "success" }; },
    cancel: (executionId) => calls.push({ cancelled: executionId }),
    restart: async () => ({ status: "ready", restartCount: 1 })
  };
  const disabled = createTlCore();
  await assert.rejects(disabled.request("runtime.pythonPoc.status"), (error) => error.code === "PYTHON_POC_DISABLED");

  const enabled = createTlCore({ featureFlags: { pythonRuntime: true }, adapters: { pythonPoc } });
  assert.deepEqual(await enabled.request("runtime.pythonPoc.status"), { status: "ready" });
  assert.deepEqual(await enabled.request("runtime.pythonPoc.run", { executionId: "poc_1" }), { status: "success" });
  await enabled.request("runtime.pythonPoc.cancel", { executionId: "poc_1" });
  assert.deepEqual(await enabled.request("runtime.pythonPoc.restart"), { status: "ready", restartCount: 1 });
  assert.deepEqual(calls, [{ executionId: "poc_1" }, { cancelled: "poc_1" }]);
});

test("legacy nodes normalize to the JavaScript execution runtime", () => {
  const execution = executionContract.normalizeExecution({}, { legacy: true });
  const resolution = executionContract.resolveRuntime(execution, ["javascript"]);

  assert.equal(execution.runtime, "javascript");
  assert.equal(execution.legacy, true);
  assert.equal(resolution.available, true);
});

test("explicit Python execution is represented but blocked until its runtime exists", () => {
  const execution = executionContract.normalizeExecution({ runtime: "python", entry: "main.py", capabilities: ["semantic_reranking"] });
  const request = executionContract.createExecutionRequest({
    executionId: "exec_1",
    nodeId: "node_1",
    execution,
    context: { workspaceId: "workspace_1", flowId: "flow_1" }
  });
  const validation = executionContract.validateExecutionRequest(request, ["javascript"]);

  assert.equal(request.runtime, "python");
  assert.equal(validation.ok, false);
  assert.match(validation.errors[0], /Runtime unavailable: python/);
});

test("execution results preserve events, diagnostics and provenance", () => {
  const result = executionContract.normalizeExecutionResult({
    executionId: "exec_2",
    status: "success",
    outputs: { ranked: [] },
    metrics: { latencyMs: 42 },
    diagnostics: [{ code: "INFO" }],
    events: [{ kind: "progress", progress: 50 }],
    provenance: { runtime: "javascript" }
  });

  assert.equal(result.status, "success");
  assert.equal(result.events[0].kind, "progress");
  assert.equal(result.metrics.latencyMs, 42);
  assert.equal(result.provenance.runtime, "javascript");
});

test("Runtime Manager routes legacy nodes through the JavaScript executor", async () => {
  const manager = new RuntimeManager();
  const result = await manager.runLegacyTask({
    node: { id: "node_1", metadata: { manifest: {} } },
    task: async () => ({ value: 7 })
  });

  assert.deepEqual(result, { value: 7 });
  const javascript = manager.getExecutor("javascript");
  assert.equal(javascript.status, "ready");
  assert.equal(javascript.completedJobs, 1);
  assert.equal(javascript.activeJobs, 0);
});

test("Runtime Manager isolates unavailable Python nodes from the JavaScript executor", async () => {
  const manager = new RuntimeManager();

  await assert.rejects(
    manager.runLegacyTask({
      node: { id: "node_python", metadata: { manifest: { execution: { runtime: "python", entry: "main.py" } } } },
      task: async () => "must not run"
    }),
    (error) => error.code === "RUNTIME_UNAVAILABLE"
  );
  assert.equal(manager.getExecutor("javascript").completedJobs, 0);
});

test("Runtime Manager registers Python only when the restricted POC bridge exists", () => {
  globalThis.trackers = { runtime: { pythonPoc: { run: async () => ({}) } } };
  try {
    const manager = new RuntimeManager();
    assert.equal(manager.getExecutor("python").workerId, "managed-python-poc");
    assert.deepEqual(manager.getStatus().availableRuntimes, ["javascript", "python"]);
    assert.equal(manager.resolveCapability("text.transform").runtime, "python");
    assert.equal(manager.resolveCapability("vectors.search").code, "CAPABILITY_UNAVAILABLE");
  } finally {
    delete globalThis.trackers;
  }
});
