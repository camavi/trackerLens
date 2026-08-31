const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { TL_CORE_CONTRACT_VERSION, createTlCore } = require("../core/desktop/tl-core.cjs");
const { DesktopPersistence } = require("../core/desktop/desktop-persistence.cjs");
const executionContract = require("../core/runtime/node-execution-contract.js");
const { RuntimeManager } = require("../core/runtime/runtime-manager.js");
const { PythonPackResolver } = require("../core/runtime/python-pack-resolver.cjs");
const { PythonRuntimeCatalog } = require("../core/desktop/python-runtime-catalog.cjs");
const { ManagedPythonPackInstaller } = require("../core/desktop/managed-python-pack-installer.cjs");
const ragPackManifest = require("../runtimes/python/packs/rag/pack.json");
const annotationsPackManifest = require("../runtimes/python/packs/annotations/pack.json");
const graphRelationsPackManifest = require("../runtimes/python/packs/graph-relations/pack.json");

test("managed RAG pack pins its local CrossEncoder reranker", () => {
  const reranker = ragPackManifest.models.find((model) => model.id === "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1");
  assert.equal(ragPackManifest.version, "0.2.0");
  assert.deepEqual(reranker, {
    id: "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1",
    displayName: "Multilingual mMARCO MiniLM Reranker",
    revision: "1427fd652930e4ba29e8149678df786c240d8825",
    languages: 15,
    license: "Apache-2.0",
    estimatedDownloadBytes: 492745974,
    downloadFiles: ["config.json", "model.safetensors", "sentencepiece.bpe.model", "special_tokens_map.json", "tokenizer.json", "tokenizer_config.json"],
    localOnlyAfterInstall: true
  });
  assert.ok(ragPackManifest.capabilities.includes("text.rerank"));
});

test("managed annotations pack pins five official spaCy CPU wheel artifacts", () => {
  assert.equal(annotationsPackManifest.id, "trackerslens.nlp.annotations");
  assert.deepEqual(annotationsPackManifest.requirements, [{ name: "spacy", version: "==3.8.14" }]);
  assert.equal(annotationsPackManifest.models.length, 5);
  assert.deepEqual(annotationsPackManifest.models.map((model) => model.id).sort(), ["de_core_news_sm", "en_core_web_sm", "es_core_news_sm", "fr_core_news_sm", "it_core_news_sm"]);
  for (const model of annotationsPackManifest.models) {
    assert.equal(model.revision, "3.8.0");
    assert.equal(model.artifact.type, "python-wheel");
    assert.match(model.artifact.url, /^https:\/\/github\.com\/explosion\/spacy-models\/releases\/download\//);
    assert.match(model.artifact.sha256, /^[a-f0-9]{64}$/);
    assert.equal(model.artifact.sizeBytes, model.estimatedDownloadBytes);
    assert.equal(model.artifact.package, model.id);
  }
});

test("managed graph relations pack pins local GLiNER2 extraction and multilingual NLI verification", () => {
  assert.equal(graphRelationsPackManifest.id, "trackerslens.graph.relations.gliner2");
  assert.equal(graphRelationsPackManifest.version, "0.2.0");
  assert.deepEqual(graphRelationsPackManifest.requirements, [
    { name: "gliner2", version: "==2.0.0" },
    { name: "protobuf", version: "==7.36.0" }
  ]);
  assert.deepEqual(graphRelationsPackManifest.capabilities, ["knowledge.graph.relation_extract", "knowledge.graph.relation_verify"]);
  assert.deepEqual(graphRelationsPackManifest.models[0].downloadFiles, [
    "config.json",
    "encoder_config/config.json",
    "model.safetensors",
    "tokenizer.json",
    "tokenizer_config.json"
  ]);
  assert.equal(graphRelationsPackManifest.models[0].revision, "aaecfe45db1d828c963717054ccb868e8ad1f1d5");
  assert.equal(graphRelationsPackManifest.models[0].license, "Apache-2.0");
  assert.equal(graphRelationsPackManifest.models[1].id, "MoritzLaurer/mDeBERTa-v3-base-mnli-xnli");
  assert.equal(graphRelationsPackManifest.models[1].revision, "8adb042d524ecd5c26d3e3ba0e3fbcf7e2d0864c");
  assert.equal(graphRelationsPackManifest.models[1].license, "MIT");
  assert.equal(graphRelationsPackManifest.models[1].estimatedDownloadBytes, 578291075);
  assert.deepEqual(graphRelationsPackManifest.models[1].downloadFiles, ["config.json", "model.safetensors", "special_tokens_map.json", "spm.model", "tokenizer.json", "tokenizer_config.json"]);
  const lock = fs.readFileSync(path.join(__dirname, "../runtimes/python/packs/graph-relations/requirements.lock"), "utf8");
  assert.match(lock, /^gliner2\[local\]==2\.0\.0$/m);
  assert.match(lock, /^torch==2\.13\.0$/m);
  assert.match(lock, /^transformers==4\.57\.6$/m);
  assert.match(lock, /^protobuf==7\.36\.0$/m);
});

test("graph relations install plan resolves both local models only in the isolated graph environment", async () => {
  const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "trackers-lens-gliner2-plan-"));
  const models = graphRelationsPackManifest.models.map((model) => ({ ...model, directory: path.join(fixtureDirectory, model.id.replaceAll("/", "--")) }));
  const installer = new ManagedPythonPackInstaller({
    packs: [{ ...graphRelationsPackManifest, lockfilePath: path.join(__dirname, "../", graphRelationsPackManifest.lockfile) }],
    environments: [{
      id: "graph",
      interpreter: "Python 3.11",
      pythonPath: path.join(fixtureDirectory, "bin/python"),
      directory: path.join(fixtureDirectory, "env"),
      models
    }]
  });
  const plan = await installer.getInstallPlan({ packId: graphRelationsPackManifest.id });
  assert.equal(plan.environment.id, "graph");
  assert.equal(plan.models.length, 2);
  assert.deepEqual(plan.models.map((model) => model.id), graphRelationsPackManifest.models.map((model) => model.id));
  assert.ok(plan.models.every((model) => model.installed === false));
  fs.rmSync(fixtureDirectory, { recursive: true, force: true });
});

test("graph builder requirement resolves the managed GLiNER2 pack and prompts before installation", () => {
  const resolver = new PythonPackResolver({
    packs: [{
      ...graphRelationsPackManifest,
      packages: graphRelationsPackManifest.requirements.map((requirement) => ({ ...requirement, version: requirement.version.replace(/^==/, "") })),
      status: "unavailable"
    }]
  });
  const resolution = resolver.resolve({
    dependencies: {
      python: {
        packId: "trackerslens.graph.relations.gliner2",
        environment: "graph",
        requirements: [{ name: "gliner2", version: "==2.0.0" }, { name: "protobuf", version: "==7.36.0" }],
        lockfile: "runtimes/python/packs/graph-relations/requirements.lock",
        installPolicy: "managed-optional",
        requiredByDefault: true
      }
    }
  });
  assert.equal(resolution.status, "unavailable");
  assert.equal(resolution.installPlan.supported, true);
  assert.equal(resolution.installPlan.packId, "trackerslens.graph.relations.gliner2");
  assert.equal(resolution.installPlan.environment, "graph");
});

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

test("desktop persistence omits undefined fields and recovers legacy undefined JSON", (context) => {
  const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "trackers-lens-persistence-"));
  context.after(() => fs.rmSync(fixtureDirectory, { recursive: true, force: true }));
  const databasePath = path.join(fixtureDirectory, "undefined-fields.sqlite");
  const persistence = new DesktopPersistence({ databasePath });
  persistence.initialize();
  persistence.writeDevelopmentRecords({
    storeName: "tl_runtime_nodes",
    records: [{ id: "node_clean", workspaceId: "workspace_1", connectionType: undefined, metadata: { source: "test", optional: undefined } }]
  });
  assert.deepEqual(persistence.readDevelopmentRecords({ storeName: "tl_runtime_nodes" }), [{ id: "node_clean", workspaceId: "workspace_1", metadata: { source: "test" } }]);

  const database = new DatabaseSync(databasePath);
  try {
    database.prepare("INSERT INTO tl_records (store_name, id, workspace_id, record_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("tl_runtime_nodes", "node_legacy", "workspace_1", '{"id":"node_legacy","connectionType":undefined}', "2026-08-25T00:00:00.000Z", "2026-08-25T00:00:00.000Z");
  } finally {
    database.close();
  }
  assert.deepEqual(persistence.readDevelopmentRecords({ storeName: "tl_runtime_nodes" }), [
    { id: "node_clean", workspaceId: "workspace_1", metadata: { source: "test" } },
    { id: "node_legacy", connectionType: null }
  ]);
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

test("TL Core keeps the development NLP pack behind a separate narrow bridge", async () => {
  const calls = [];
  const pythonNlp = {
    status: () => ({ status: "ready", workerId: "managed-python-nlp-dev" }),
    start: async () => ({ status: "ready" }),
    execute: async (payload) => { calls.push(payload); return { status: "success", outputs: { vector: [0.1] } }; },
    cancel: (executionId) => calls.push({ cancelled: executionId }),
    restart: async () => ({ status: "ready", restartCount: 1 })
  };
  await assert.rejects(createTlCore().request("runtime.pythonNlp.status"), (error) => error.code === "PYTHON_NLP_DISABLED");

  const core = createTlCore({ featureFlags: { pythonNlpDev: true }, adapters: { pythonNlp } });
  assert.equal((await core.request("runtime.pythonNlp.status")).workerId, "managed-python-nlp-dev");
  assert.deepEqual(await core.request("runtime.pythonNlp.run", { executionId: "nlp_1", operation: "text_embedding" }), { status: "success", outputs: { vector: [0.1] } });
  await core.request("runtime.pythonNlp.cancel", { executionId: "nlp_1" });
  assert.deepEqual(calls, [{ executionId: "nlp_1", operation: "text_embedding" }, { cancelled: "nlp_1" }]);
});

test("Python package resolution is declarative and exposes no installer", async () => {
  const resolver = new PythonPackResolver({
    packs: [{
      id: "builtin-nlp",
      environment: "nlp",
      lockfile: "python/nlp.lock",
      trustLevel: "built-in",
      status: "ready",
      packages: [{ name: "sentence-transformers", version: "5.5.0" }]
    }]
  });
  const core = createTlCore({ adapters: { pythonPacks: resolver } });
  const execution = {
    dependencies: {
      python: {
        environment: "nlp",
        requirements: [{ name: "sentence-transformers", version: ">=5,<6" }],
        lockfile: "python/nlp.lock",
        installPolicy: "bundled"
      }
    }
  };
  const ready = await core.request("runtime.pythonPacks.resolve", { execution });
  assert.equal(ready.code, "PYTHON_PACK_READY");
  assert.equal(ready.pack.id, "builtin-nlp");
  assert.equal(Object.hasOwn(ready, "install"), false);

  const missing = await core.request("runtime.pythonPacks.resolve", {
    execution: { dependencies: { python: { environment: "nlp", requirements: [{ name: "spacy", version: ">=3" }], installPolicy: "managed-optional" } } }
  });
  assert.equal(missing.code, "PYTHON_PACK_MISSING");
  assert.equal(missing.installPlan.requiresUserConsent, true);
  await assert.rejects(createTlCore().request("runtime.pythonPacks.resolve", { execution }), (error) => error.code === "PYTHON_PACKS_UNAVAILABLE");
});

test("Python package resolution honors a required managed pack ID", () => {
  const resolver = new PythonPackResolver({
    packs: [
      { id: "builtin-nlp", version: "1.0.0", environment: "nlp", lockfile: "python/nlp.lock", trustLevel: "built-in", status: "ready", packages: [{ name: "sentence-transformers", version: "5.5.0" }, { name: "bm25s", version: "0.3.11" }] },
      { id: "builtin-rag", version: "2.0.0", environment: "nlp", lockfile: "python/nlp.lock", trustLevel: "built-in", status: "unavailable", packages: [{ name: "sentence-transformers", version: "5.5.0" }, { name: "bm25s", version: "0.3.11" }] }
    ]
  });
  const result = resolver.resolve({ dependencies: { python: {
    packId: "builtin-rag",
    environment: "nlp",
    requirements: [{ name: "sentence-transformers", version: "==5.5.0" }, { name: "bm25s", version: "==0.3.11" }],
    lockfile: "python/nlp.lock",
    installPolicy: "managed-optional"
  } } });

  assert.equal(result.code, "PYTHON_PACK_MISSING");
  assert.equal(result.installPlan.packId, "builtin-rag");
});

test("Python runtime catalog exposes managed metadata without local paths and requires removal confirmation", async (context) => {
  const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "trackers-lens-python-model-"));
  const modelDirectory = path.join(fixtureDirectory, "model");
  fs.mkdirSync(modelDirectory);
  fs.writeFileSync(path.join(modelDirectory, "weights.bin"), "1234567890");
  context.after(() => fs.rmSync(fixtureDirectory, { recursive: true, force: true }));
  let stopped = 0;
  let removalNotified = 0;
  const catalog = new PythonRuntimeCatalog({
    packs: [{ id: "builtin-nlp", version: "1.0.0", environment: "nlp", requirements: [{ name: "sentence-transformers", version: "==5.5.0" }], models: [{ id: "model/test" }] }],
    environments: [{
      id: "nlp",
      interpreter: "Python 3.11",
      interpreterPath: process.execPath,
      requested: () => true,
      enabled: () => true,
      runtimeStatus: () => ({ status: "ready" }),
      stopRuntime: async () => { stopped += 1; },
      onModelRemoved: async () => { removalNotified += 1; },
      models: [{ id: "model/test", displayName: "Test model", directory: modelDirectory, revision: "rev", dimensions: 12, languages: 1, license: "Apache-2.0" }]
    }]
  });
  const core = createTlCore({ adapters: { pythonRuntimeCatalog: catalog } });
  const result = await core.request("runtime.pythonRuntime.getCatalog");
  assert.equal(result.models[0].sizeBytes, 10);
  assert.equal(result.models[0].state, "installed");
  assert.equal(JSON.stringify(result).includes(modelDirectory), false);
  await assert.rejects(core.request("runtime.pythonRuntime.removeModel", { modelId: "model/test" }), (error) => error.code === "PYTHON_MODEL_CONFIRMATION_REQUIRED");
  assert.deepEqual(await core.request("runtime.pythonRuntime.removeModel", { modelId: "model/test", confirmed: true }), { removed: true, modelId: "model/test", environmentId: "nlp" });
  assert.equal(stopped, 1);
  assert.equal(removalNotified, 1);
  assert.equal(fs.existsSync(modelDirectory), false);
});

test("Python pack installation exposes an allow-listed plan and never starts without confirmation", async () => {
  const installer = new ManagedPythonPackInstaller({
    packs: [{ id: "builtin-nlp", version: "1.0.0", trustLevel: "built-in", installPolicy: "managed-optional", environment: "nlp", lockfile: "python/nlp.lock", lockfilePath: "/managed/python/nlp.lock", requirements: [{ name: "sentence-transformers", version: "==5.5.0" }] }],
    environments: [{ id: "nlp", interpreter: "Python 3.11", pythonPath: "/managed/python/bin/python", directory: "/managed/python", bootstrapPython: "python3.11", models: [] }]
  });
  const core = createTlCore({ adapters: { pythonPackInstaller: installer } });
  const plan = await core.request("runtime.pythonRuntime.getInstallPlan", { packId: "builtin-nlp" });
  assert.equal(plan.pack.id, "builtin-nlp");
  assert.deepEqual(plan.requirements, [{ name: "sentence-transformers", version: "5.5.0" }]);
  assert.equal(plan.requiresUserConsent, true);
  assert.equal(Object.hasOwn(plan, "lockfilePath"), false);
  await assert.rejects(core.request("runtime.pythonRuntime.installPack", { packId: "builtin-nlp" }), (error) => error.code === "PYTHON_PACK_CONFIRMATION_REQUIRED");
});

test("managed Python pack installation reports Core-owned progress through verification", async (context) => {
  const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "trackers-lens-python-install-"));
  const pythonPath = path.join(fixtureDirectory, "python");
  const modelDirectory = path.join(fixtureDirectory, "model");
  fs.writeFileSync(pythonPath, "fixture");
  context.after(() => fs.rmSync(fixtureDirectory, { recursive: true, force: true }));
  const progress = [];
  let started = 0;
  const installer = new ManagedPythonPackInstaller({
    packs: [{ id: "builtin-nlp", version: "1.0.0", trustLevel: "built-in", environment: "nlp", lockfile: "python/nlp.lock", lockfilePath: "/managed/python/nlp.lock", requirements: [{ name: "sentence-transformers", version: "==5.5.0" }], models: [{ id: "model/test", revision: "rev", displayName: "Test model" }] }],
    environments: [{ id: "nlp", interpreter: "Python 3.11", pythonPath, directory: fixtureDirectory, bootstrapPython: "python3.11", models: [{ id: "model/test", directory: modelDirectory }], onInstalled: async () => { started += 1; } }],
    runProcess: async (_command, args) => {
      if (args[1] === "pip") return { stdout: "", stderr: "" };
      if (args[0] === "-c" && String(args[1]).includes("importlib.metadata")) return { stdout: '{"sentence-transformers":"5.5.0"}', stderr: "" };
      if (args[0] === "-c") { fs.mkdirSync(args[4], { recursive: true }); fs.writeFileSync(path.join(args[4], "weights.bin"), "fixture"); return { stdout: "", stderr: "" }; }
      throw new Error(`Unexpected process: ${args.join(" ")}`);
    }
  });
  installer.subscribe((event) => progress.push(event));
  const result = await installer.install({ packId: "builtin-nlp", confirmed: true });
  assert.equal(result.status, "installed");
  assert.deepEqual(result.verifiedRequirements, [{ name: "sentence-transformers", version: "5.5.0" }]);
  assert.equal(fs.existsSync(modelDirectory), true);
  assert.equal(started, 1);
  assert.ok(progress.map((event) => event.phase).includes("downloading-model"));
  assert.deepEqual(progress.map((event) => event.phase).filter((phase) => phase !== "downloading-model"), ["preparing", "installing-requirements", "verifying-requirements", "starting-runtime", "complete"]);
});

test("managed Python pack installation resumes only a revision-verified partial model download", async (context) => {
  const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "trackers-lens-python-resume-"));
  const pythonPath = path.join(fixtureDirectory, "python");
  const modelDirectory = path.join(fixtureDirectory, "model");
  const temporaryDirectory = `${modelDirectory}.installing`;
  fs.writeFileSync(pythonPath, "fixture");
  fs.mkdirSync(path.join(temporaryDirectory, ".cache", "huggingface", "trees"), { recursive: true });
  fs.writeFileSync(path.join(temporaryDirectory, ".cache", "huggingface", "trees", "pinned-revision.json"), '{"files":{"partial.bin":{"size":13}}}');
  fs.writeFileSync(path.join(temporaryDirectory, "partial.bin"), "partial-model");
  context.after(() => fs.rmSync(fixtureDirectory, { recursive: true, force: true }));
  const progress = [];
  const installer = new ManagedPythonPackInstaller({
    packs: [{ id: "builtin-rag", version: "1.0.0", trustLevel: "built-in", environment: "nlp", lockfile: "python/rag.lock", lockfilePath: "/managed/python/rag.lock", requirements: [{ name: "sentence-transformers", version: "==5.5.0" }], models: [{ id: "model/test", revision: "pinned-revision", displayName: "Test model", downloadFiles: ["partial.bin"] }] }],
    environments: [{ id: "nlp", interpreter: "Python 3.11", pythonPath, directory: fixtureDirectory, bootstrapPython: "python3.11", models: [{ id: "model/test", directory: modelDirectory }] }],
    runProcess: async (_command, args) => {
      if (args[1] === "pip") return { stdout: "", stderr: "" };
      if (args[0] === "-c" && String(args[1]).includes("importlib.metadata")) return { stdout: '{"sentence-transformers":"5.5.0"}', stderr: "" };
      if (args[0] === "-c") { fs.writeFileSync(path.join(args[4], "weights.bin"), "complete"); return { stdout: "", stderr: "" }; }
      throw new Error(`Unexpected process: ${args.join(" ")}`);
    }
  });
  const plan = await installer.getInstallPlan({ packId: "builtin-rag" });
  assert.equal(plan.models[0].resumeAvailable, true);
  assert.ok(plan.models[0].partialBytes > 0);
  installer.subscribe((event) => progress.push(event));
  await installer.install({ packId: "builtin-rag", confirmed: true });
  assert.equal(fs.existsSync(modelDirectory), true);
  assert.equal(fs.existsSync(temporaryDirectory), false);
  assert.match(progress.find((event) => event.phase === "downloading-model").message, /^Resuming /);
});

test("managed Python pack installation accepts only a Core-downloaded pinned wheel artifact", async (context) => {
  const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "trackers-lens-python-wheel-"));
  const pythonPath = path.join(fixtureDirectory, "python");
  const modelDirectory = path.join(fixtureDirectory, "model");
  fs.writeFileSync(pythonPath, "fixture");
  context.after(() => fs.rmSync(fixtureDirectory, { recursive: true, force: true }));
  const downloads = [];
  const installer = new ManagedPythonPackInstaller({
    packs: [{ id: "builtin-annotations", version: "1.0.0", trustLevel: "built-in", environment: "nlp", lockfile: "python/annotations.lock", lockfilePath: "/managed/python/annotations.lock", requirements: [{ name: "spacy", version: "==3.8.14" }], models: [{ id: "it_core_news_sm", revision: "3.8.0", displayName: "Italian pipeline", estimatedDownloadBytes: 12, artifact: { type: "python-wheel", source: "Official spaCy release", url: "https://github.com/explosion/spacy-models/releases/download/it_core_news_sm-3.8.0/it_core_news_sm-3.8.0-py3-none-any.whl", sha256: "a".repeat(64), sizeBytes: 12 } }] }],
    environments: [{ id: "nlp", interpreter: "Python 3.11", pythonPath, directory: fixtureDirectory, bootstrapPython: "python3.11", models: [{ id: "it_core_news_sm", directory: modelDirectory, artifact: { type: "python-wheel", url: "https://github.com/explosion/spacy-models/releases/download/it_core_news_sm-3.8.0/it_core_news_sm-3.8.0-py3-none-any.whl", sha256: "a".repeat(64), sizeBytes: 12 } }] }],
    downloadWheelArtifact: async ({ model, temporaryDirectory, onProgress }) => {
      downloads.push(model.id);
      fs.mkdirSync(temporaryDirectory, { recursive: true });
      const wheel = path.join(temporaryDirectory, "artifact.whl");
      fs.writeFileSync(wheel, "fixture-wheel");
      onProgress({ downloadedBytes: 12, totalBytes: 12 });
      return { wheelPath: wheel, extractCode: "fixture-wheel-extract" };
    },
    runProcess: async (_command, args) => {
      if (args[1] === "pip") return { stdout: "", stderr: "" };
      if (args[0] === "-c" && String(args[1]).includes("importlib.metadata")) return { stdout: '{"spacy":"3.8.14"}', stderr: "" };
      if (args[0] === "-c" && args[1] === "fixture-wheel-extract") { fs.mkdirSync(args[3], { recursive: true }); fs.writeFileSync(path.join(args[3], "config.cfg"), "pipeline"); return { stdout: "", stderr: "" }; }
      throw new Error(`Unexpected process: ${args.join(" ")}`);
    }
  });
  const plan = await installer.getInstallPlan({ packId: "builtin-annotations" });
  assert.equal(plan.models[0].artifactType, "python-wheel");
  assert.equal(plan.models[0].source, "Official spaCy release");
  const result = await installer.install({ packId: "builtin-annotations", confirmed: true });
  assert.deepEqual(downloads, ["it_core_news_sm"]);
  assert.deepEqual(result.downloadedModels, ["it_core_news_sm"]);
  assert.equal(fs.existsSync(path.join(modelDirectory, "content", "config.cfg")), true);
  assert.equal(fs.existsSync(path.join(modelDirectory, "artifact.whl")), false);
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

test("execution manifests normalize managed Python module requirements without installing them", () => {
  const execution = executionContract.normalizeExecution({
    runtime: "javascript",
    capabilities: ["text.embedding"],
    dependencies: {
      python: {
        environment: "nlp",
        requirements: ["sentence-transformers", { package: "torch", constraint: ">=2,<3" }],
        lock: "python/nlp.lock",
        policy: "managed-optional",
        requiredByDefault: true
      }
    }
  });

  assert.deepEqual(execution.dependencies.python, {
    environment: "nlp",
    requirements: [
      { name: "sentence-transformers", version: "" },
      { name: "torch", version: ">=2,<3" }
    ],
    lockfile: "python/nlp.lock",
    installPolicy: "managed-optional",
    requiredByDefault: true
  });
  assert.deepEqual(executionContract.PYTHON_INSTALL_POLICIES.sort(), ["bundled", "managed-optional", "managed-required"]);
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

test("Runtime Manager blocks manifest-only Custom Node packages before a task can run", async () => {
  const manager = new RuntimeManager();
  let executed = false;

  await assert.rejects(
    manager.runLegacyTask({
      node: { id: "custom_package", metadata: { runtimeBlocked: true, customPackage: { runtimeExecution: "blocked" } } },
      task: async () => { executed = true; }
    }),
    (error) => error.code === "CUSTOM_NODE_RUNTIME_BLOCKED"
  );
  assert.equal(executed, false);
  assert.equal(manager.getExecutor("javascript").completedJobs, 0);
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
