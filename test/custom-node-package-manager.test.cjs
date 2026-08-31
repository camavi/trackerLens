const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { CustomNodePackageManager, inspectArchive } = require("../core/desktop/custom-node-package-manager.cjs");

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
    "assets/icon.svg": "<svg/>"
  });
  const inspected = inspectArchive(archive);
  assert.equal(inspected.manifest.id, "custom.example-node");
  assert.equal(inspected.runtimeExecution, "blocked");
  assert.equal(inspected.files.length, 4);
  assert.match(inspected.archiveSha256, /^[a-f0-9]{64}$/);
});

test("Custom Node ZIP rejects path traversal before import", () => {
  const archive = zipStored({ "node.json": JSON.stringify(manifest), "../runtime.js": "unsafe" });
  assert.throws(() => inspectArchive(archive), { code: "CUSTOM_NODE_ZIP_PATH_UNSAFE" });
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
  assert.equal(records.length, 1);
  assert.equal(Object.values(installed).some((value) => typeof value === "string" && value.includes(root)), false);
  const archivedFiles = fs.readdirSync(path.join(root, "app-data-packages", "custom.example-node", "1.0.0"));
  assert.equal(archivedFiles.length, 1);
  const installedHash = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "app-data-packages", "custom.example-node", "1.0.0", archivedFiles[0]))).digest("hex");
  assert.equal(installedHash, installed.archive.sha256);
  assert.deepEqual(await manager.listInstalled(), [installed]);
});
