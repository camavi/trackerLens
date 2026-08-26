const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const PERSISTENCE_CONTRACT_VERSION = "tl-desktop-persistence/v1";
const SQLITE_SCHEMA_VERSION = 1;
const DEFAULT_MODE = "desktop-sqlite";
const FIRST_COHORT_STORES = Object.freeze([
  "tl_pages",
  "tl_widgets",
  "tl_connections",
  "tl_settings",
  "tl_flows",
  "tl_runtime_nodes",
  "tl_runtime_dependencies",
  "tl_channels"
]);
const SQLITE_REPOSITORY_STORES = Object.freeze([
  ...FIRST_COHORT_STORES,
  "tl_events",
  "tl_flow_logs",
  "tl_box_performance",
  "tl_time_travel_snapshots",
  "tl_offline_queue",
  "tl_offline_cache",
  "tl_packages",
  "tl_package_lock",
  "tl_marketplace_trust",
  "tl_agents",
  "tl_ai_providers",
  "tl_ai_agents",
  "tl_ai_runtime",
  "tl_ai_jobs",
  "tl_ai_logs",
  "tl_ai_memory",
  "tl_ai_prompts",
  "tl_ai_prompt_flows",
  "tl_ai_metrics",
  "tl_flow_prompt_chats",
  "tl_knowledge_documents",
  "tl_knowledge_chunks",
  "tl_knowledge_embeddings",
  "tl_knowledge_entities",
  "tl_knowledge_relations",
  "tl_knowledge_dictionary",
  "tl_knowledge_events",
  "tl_structured_knowledge",
  "tl_knowledge_queries",
  "tl_knowledge_sources",
  "tl_knowledge_metrics"
]);

const now = () => new Date().toISOString();
const clone = (value) => JSON.parse(JSON.stringify(value));
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isAllowedRepositoryStore = (name = "") => SQLITE_REPOSITORY_STORES.includes(name) || name === "tl_history" || /^tl_storage_[A-Za-z0-9_-]+$/.test(name);

const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item) ?? "null").join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort()
      .map((key) => [key, canonicalJson(value[key])])
      .filter(([, serialized]) => serialized !== undefined)
      .map(([key, serialized]) => `${JSON.stringify(key)}:${serialized}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const parseStoredJson = (source = "") => {
  try {
    return JSON.parse(source);
  } catch (error) {
    const repaired = String(source).replace(/:\s*undefined(?=\s*[,}])/g, ":null");
    if (repaired === source) throw error;
    return JSON.parse(repaired);
  }
};

const normalizeRecords = (records = []) => {
  if (!Array.isArray(records)) throw new Error("Persistence records must be an array.");
  const ids = new Set();
  return records.map((record) => {
    if (!isPlainObject(record) || !String(record.id || "").trim()) {
      throw new Error("Persistence records require a non-empty id.");
    }
    const id = String(record.id);
    if (ids.has(id)) throw new Error(`Duplicate persistence record id: ${id}`);
    ids.add(id);
    const recordJson = canonicalJson(record);
    return {
      id,
      workspaceId: String(record.workspaceId || ""),
      recordJson,
      payloadHash: hash(recordJson),
      record: clone(record)
    };
  });
};

const normalizeBundle = (bundle = {}, { allowDynamicStores = false } = {}) => {
  if (!isPlainObject(bundle) || !isPlainObject(bundle.stores)) {
    throw new Error("Persistence import bundle requires a stores object.");
  }
  const stores = Object.entries(bundle.stores).map(([storeName, records]) => {
    const name = String(storeName || "").trim();
    if (!FIRST_COHORT_STORES.includes(name) && !allowDynamicStores) {
      throw new Error(`Unsupported persistence store: ${name}`);
    }
    return { name, records: normalizeRecords(records) };
  });
  return stores.sort((left, right) => left.name.localeCompare(right.name));
};

const createImportPlan = (bundle = {}) => {
  const stores = normalizeBundle(bundle);
  const missingStores = [...new Set((Array.isArray(bundle.missingStores) ? bundle.missingStores : [])
    .map((storeName) => String(storeName || "").trim())
    .filter(Boolean))].sort();
  missingStores.forEach((storeName) => {
    if (!FIRST_COHORT_STORES.includes(storeName)) throw new Error(`Unsupported persistence store: ${storeName}`);
  });
  const storePlans = stores.map(({ name, records }) => ({
    name,
    recordCount: records.length,
    recordIds: records.map(({ id }) => id).sort(),
    contentHash: hash(records.map(({ id, payloadHash }) => `${id}:${payloadHash}`).sort().join("\n")),
    workspaceCounts: Object.entries(records.reduce((counts, record) => {
      const workspaceId = record.workspaceId || "__unscoped__";
      counts[workspaceId] = (counts[workspaceId] || 0) + 1;
      return counts;
    }, {})).sort(([left], [right]) => left.localeCompare(right)).map(([workspaceId, recordCount]) => ({ workspaceId, recordCount }))
  }));
  const recordCount = storePlans.reduce((total, store) => total + store.recordCount, 0);
  return Object.freeze({
    contractVersion: PERSISTENCE_CONTRACT_VERSION,
    source: String(bundle.source || "renderer-export"),
    mode: DEFAULT_MODE,
    missingStores,
    eligibleForImport: missingStores.length === 0,
    recordCount,
    stores: storePlans,
    manifestHash: hash(canonicalJson(storePlans)),
    plannedAt: now()
  });
};

const createBackupManifest = (catalog = {}) => {
  if (!isPlainObject(catalog) || !Array.isArray(catalog.stores)) throw new Error("Persistence backup catalog requires stores.");
  const names = new Set();
  const stores = catalog.stores.map((store) => {
    const name = String(store?.name || "").trim();
    if (!/^[A-Za-z0-9_-]+$/.test(name) || names.has(name)) throw new Error(`Invalid persistence catalog store: ${name}`);
    names.add(name);
    const recordCount = Number(store?.recordCount);
    if (!Number.isInteger(recordCount) || recordCount < 0) throw new Error(`Invalid persistence catalog count: ${name}`);
    const contentHash = String(store?.contentHash || "");
    if (!/^[a-f0-9]{64}$/i.test(contentHash)) throw new Error(`Invalid persistence catalog hash: ${name}`);
    const kind = ["first-cohort", "storage-dynamic", "known-later", "unclassified"].includes(store?.kind) ? store.kind : "unclassified";
    return { name, recordCount, contentHash, kind };
  }).sort((left, right) => left.name.localeCompare(right.name));
  const dynamicStores = stores.filter((store) => store.kind === "storage-dynamic").map((store) => store.name);
  const unclassifiedStores = stores.filter((store) => store.kind === "unclassified").map((store) => store.name);
  return Object.freeze({
    contractVersion: PERSISTENCE_CONTRACT_VERSION,
    source: String(catalog.source || "renderer-indexeddb-catalog"),
    generatedAt: String(catalog.generatedAt || now()),
    recordCount: stores.reduce((total, store) => total + store.recordCount, 0),
    stores,
    dynamicStores,
    unclassifiedStores,
    backupCreated: false,
    recoveryAvailable: false,
    manifestHash: hash(canonicalJson(stores))
  });
};

class DesktopPersistence {
  constructor({ databasePath = "", profileId = "default" } = {}) {
    this.databasePath = databasePath ? path.resolve(databasePath) : "";
    this.profileId = String(profileId || "default");
    this.mode = DEFAULT_MODE;
    this.lastDevelopmentShadowMatch = false;
  }

  getStatus() {
    const exists = Boolean(this.databasePath && fs.existsSync(this.databasePath));
    if (exists) this.mode = this.readActiveMode();
    return {
      contractVersion: PERSISTENCE_CONTRACT_VERSION,
      owner: "tl-core",
      mode: this.mode,
      sqlite: {
        configured: Boolean(this.databasePath),
        exists,
        schemaVersion: SQLITE_SCHEMA_VERSION,
        integrity: exists ? this.checkIntegrity() : "not-created"
      },
      migration: { enabled: false, userDataImport: false }
    };
  }

  planImport(bundle = {}) {
    return createImportPlan(bundle);
  }

  planBackupManifest(catalog = {}) {
    return createBackupManifest(catalog);
  }

  initialize() {
    if (!this.databasePath) throw new Error("Desktop SQLite path is not configured.");
    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true });
    const database = new DatabaseSync(this.databasePath);
    try {
      database.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS tl_meta (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS tl_records (
          store_name TEXT NOT NULL,
          id TEXT NOT NULL,
          workspace_id TEXT NOT NULL DEFAULT '',
          record_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (store_name, id)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS tl_records_store_workspace_idx ON tl_records (store_name, workspace_id);
        CREATE INDEX IF NOT EXISTS tl_records_updated_at_idx ON tl_records (updated_at);
        CREATE TABLE IF NOT EXISTS tl_migration_runs (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          status TEXT NOT NULL,
          manifest_json TEXT NOT NULL,
          started_at TEXT NOT NULL,
          completed_at TEXT,
          error_json TEXT
        ) STRICT;
        CREATE TABLE IF NOT EXISTS tl_migration_items (
          run_id TEXT NOT NULL,
          store_name TEXT NOT NULL,
          record_id TEXT NOT NULL,
          payload_hash TEXT NOT NULL,
          status TEXT NOT NULL,
          error_json TEXT,
          PRIMARY KEY (run_id, store_name, record_id),
          FOREIGN KEY (run_id) REFERENCES tl_migration_runs(id)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS tl_backups (
          id TEXT PRIMARY KEY,
          path TEXT NOT NULL,
          manifest_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
      `);
      const activeMode = database.prepare("SELECT value_json FROM tl_meta WHERE key = ?").get("activePersistenceMode");
      const storedMode = activeMode?.value_json ? JSON.parse(activeMode.value_json) : "";
      if (storedMode === DEFAULT_MODE) this.mode = storedMode;
      const setMeta = database.prepare("INSERT OR REPLACE INTO tl_meta (key, value_json, updated_at) VALUES (?, ?, ?)");
      const updatedAt = now();
      setMeta.run("schemaVersion", JSON.stringify(SQLITE_SCHEMA_VERSION), updatedAt);
      setMeta.run("storageContractVersion", JSON.stringify(PERSISTENCE_CONTRACT_VERSION), updatedAt);
      setMeta.run("profileId", JSON.stringify(this.profileId), updatedAt);
      setMeta.run("activePersistenceMode", JSON.stringify(this.mode), updatedAt);
    } finally {
      database.close();
    }
  }

  checkIntegrity() {
    if (!this.databasePath || !fs.existsSync(this.databasePath)) return "not-created";
    const database = new DatabaseSync(this.databasePath, { readOnly: true });
    try {
      const result = database.prepare("PRAGMA integrity_check").get();
      return result?.integrity_check === "ok" ? "ok" : "failed";
    } finally {
      database.close();
    }
  }

  readActiveMode() {
    if (!this.databasePath || !fs.existsSync(this.databasePath)) return DEFAULT_MODE;
    const database = new DatabaseSync(this.databasePath, { readOnly: true });
    try {
      const row = database.prepare("SELECT value_json FROM tl_meta WHERE key = ?").get("activePersistenceMode");
      const mode = row?.value_json ? JSON.parse(row.value_json) : DEFAULT_MODE;
      return mode === DEFAULT_MODE ? mode : DEFAULT_MODE;
    } catch (_) {
      return DEFAULT_MODE;
    } finally {
      database.close();
    }
  }

  setDevelopmentRuntimeActive({ active = false } = {}) {
    if (active && (!this.databasePath || !fs.existsSync(this.databasePath))) {
      throw new Error("SQLite development candidate does not exist.");
    }
    if (active && this.checkIntegrity() !== "ok") throw new Error("SQLite development candidate integrity check failed.");
    if (active && !this.lastDevelopmentShadowMatch) {
      throw new Error("SQLite development runtime requires a matching shadow verification in this session.");
    }
    this.initialize();
    this.mode = DEFAULT_MODE;
    const database = new DatabaseSync(this.databasePath);
    try {
      database.prepare("INSERT OR REPLACE INTO tl_meta (key, value_json, updated_at) VALUES (?, ?, ?)")
        .run("activePersistenceMode", JSON.stringify(this.mode), now());
      return { ...this.getStatus(), restartRequired: true };
    } finally {
      database.close();
    }
  }

  importFixture(bundle = {}) {
    const plan = createImportPlan(bundle);
    this.initialize();
    const runId = `fixture_${hash(`${plan.manifestHash}:${this.profileId}`).slice(0, 20)}`;
    const database = new DatabaseSync(this.databasePath);
    try {
      database.exec("BEGIN IMMEDIATE");
      const createdAt = now();
      database.prepare("INSERT OR IGNORE INTO tl_migration_runs (id, source, status, manifest_json, started_at) VALUES (?, ?, ?, ?, ?)")
        .run(runId, "fixture", "running", canonicalJson(plan), createdAt);
      const writeRecord = database.prepare("INSERT OR REPLACE INTO tl_records (store_name, id, workspace_id, record_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
      const writeItem = database.prepare("INSERT OR REPLACE INTO tl_migration_items (run_id, store_name, record_id, payload_hash, status) VALUES (?, ?, ?, ?, ?)");
      normalizeBundle(bundle).forEach(({ name, records }) => records.forEach((record) => {
        writeRecord.run(name, record.id, record.workspaceId, record.recordJson, createdAt, createdAt);
        writeItem.run(runId, name, record.id, record.payloadHash, "imported");
      }));
      database.prepare("UPDATE tl_migration_runs SET status = ?, completed_at = ? WHERE id = ?").run("verified-fixture", now(), runId);
      database.exec("COMMIT");
      return { runId, status: "verified-fixture", plan };
    } catch (error) {
      try { database.exec("ROLLBACK"); } catch (_) { /* Nessuna transazione aperta. */ }
      throw error;
    } finally {
      database.close();
    }
  }

  importDevelopmentBundle(bundle = {}) {
    const plan = createImportPlan(bundle);
    if (!plan.eligibleForImport) throw new Error("Development import requires a complete first-cohort bundle.");
    this.initialize();
    const runId = `development_${hash(`${plan.manifestHash}:${this.profileId}`).slice(0, 20)}`;
    const database = new DatabaseSync(this.databasePath);
    try {
      database.exec("BEGIN IMMEDIATE");
      const createdAt = now();
      database.prepare("INSERT OR REPLACE INTO tl_migration_runs (id, source, status, manifest_json, started_at, completed_at, error_json) VALUES (?, ?, ?, ?, ?, NULL, NULL)")
        .run(runId, "development-import", "running", canonicalJson(plan), createdAt);
      const clearStore = database.prepare("DELETE FROM tl_records WHERE store_name = ?");
      const writeRecord = database.prepare("INSERT INTO tl_records (store_name, id, workspace_id, record_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
      const writeItem = database.prepare("INSERT OR REPLACE INTO tl_migration_items (run_id, store_name, record_id, payload_hash, status) VALUES (?, ?, ?, ?, ?)");
      normalizeBundle(bundle).forEach(({ name, records }) => {
        clearStore.run(name);
        records.forEach((record) => {
          writeRecord.run(name, record.id, record.workspaceId, record.recordJson, createdAt, createdAt);
          writeItem.run(runId, name, record.id, record.payloadHash, "imported");
        });
      });
      const restoredBundle = {
        source: "sqlite-development-verification",
        stores: Object.fromEntries(plan.stores.map((store) => [store.name,
          database.prepare("SELECT record_json FROM tl_records WHERE store_name = ? ORDER BY id").all(store.name).map((row) => JSON.parse(row.record_json))
        ]))
      };
      const verification = createImportPlan(restoredBundle);
      if (verification.manifestHash !== plan.manifestHash || verification.recordCount !== plan.recordCount) {
        throw new Error("SQLite development import verification failed.");
      }
      database.prepare("UPDATE tl_migration_runs SET status = ?, completed_at = ? WHERE id = ?").run("verified-development", now(), runId);
      database.exec("COMMIT");
      return { runId, status: "verified-development", plan, verification: { recordCount: verification.recordCount, manifestHash: verification.manifestHash } };
    } catch (error) {
      try { database.exec("ROLLBACK"); } catch (_) { /* Nessuna transazione aperta. */ }
      throw error;
    } finally {
      database.close();
    }
  }

  verifyDevelopmentBundle(bundle = {}) {
    const sourcePlan = createImportPlan(bundle);
    if (!sourcePlan.eligibleForImport) throw new Error("Development shadow verification requires a complete first-cohort bundle.");
    if (!this.databasePath || !fs.existsSync(this.databasePath)) throw new Error("SQLite development candidate does not exist.");
    const database = new DatabaseSync(this.databasePath, { readOnly: true });
    try {
      const sqlitePlan = createImportPlan({
        source: "sqlite-shadow-read",
        stores: Object.fromEntries(sourcePlan.stores.map((store) => [store.name,
          database.prepare("SELECT record_json FROM tl_records WHERE store_name = ? ORDER BY id").all(store.name).map((row) => JSON.parse(row.record_json))
        ]))
      });
      const matches = sourcePlan.manifestHash === sqlitePlan.manifestHash && sourcePlan.recordCount === sqlitePlan.recordCount;
      this.lastDevelopmentShadowMatch = matches;
      return {
        mode: DEFAULT_MODE,
        status: matches ? "shadow-match" : "shadow-mismatch",
        matches,
        indexeddb: { recordCount: sourcePlan.recordCount, manifestHash: sourcePlan.manifestHash },
        sqlite: { recordCount: sqlitePlan.recordCount, manifestHash: sqlitePlan.manifestHash },
        stores: sourcePlan.stores.map((store) => {
          const candidate = sqlitePlan.stores.find((item) => item.name === store.name);
          return { name: store.name, matches: store.contentHash === candidate?.contentHash && store.recordCount === candidate?.recordCount, indexeddbCount: store.recordCount, sqliteCount: candidate?.recordCount || 0 };
        })
      };
    } finally {
      database.close();
    }
  }

  readDevelopmentRecords({ storeName = "", workspaceId = "" } = {}) {
    const name = String(storeName || "");
    if (!isAllowedRepositoryStore(name)) throw new Error(`Unsupported persistence store: ${name}`);
    if (!this.databasePath || !fs.existsSync(this.databasePath)) throw new Error("SQLite development candidate does not exist.");
    const database = new DatabaseSync(this.databasePath, { readOnly: true });
    try {
      const rows = workspaceId
        ? database.prepare("SELECT record_json FROM tl_records WHERE store_name = ? AND workspace_id = ? ORDER BY id").all(name, String(workspaceId))
        : database.prepare("SELECT record_json FROM tl_records WHERE store_name = ? ORDER BY id").all(name);
      return rows.map((row) => parseStoredJson(row.record_json));
    } finally {
      database.close();
    }
  }

  listDevelopmentStores() {
    if (!this.databasePath || !fs.existsSync(this.databasePath)) return [];
    const database = new DatabaseSync(this.databasePath, { readOnly: true });
    try {
      return database.prepare("SELECT store_name, COUNT(*) AS record_count FROM tl_records GROUP BY store_name ORDER BY store_name").all()
        .filter((row) => isAllowedRepositoryStore(row.store_name))
        .map((row) => ({ name: row.store_name, recordCount: Number(row.record_count) || 0 }));
    } finally {
      database.close();
    }
  }

  writeDevelopmentRecords({ storeName = "", records = [] } = {}) {
    const name = String(storeName || "");
    if (!isAllowedRepositoryStore(name)) throw new Error(`Unsupported persistence store: ${name}`);
    if (!Array.isArray(records)) throw new Error("Development records must be an array.");
    if (!this.databasePath || !fs.existsSync(this.databasePath)) throw new Error("SQLite development candidate does not exist.");
    const normalizedRecords = normalizeRecords(records);
    this.lastDevelopmentShadowMatch = false;
    const database = new DatabaseSync(this.databasePath);
    try {
      database.exec("BEGIN IMMEDIATE");
      const updatedAt = now();
      const writeRecord = database.prepare(
        "INSERT OR REPLACE INTO tl_records (store_name, id, workspace_id, record_json, created_at, updated_at) VALUES (?, ?, ?, ?, COALESCE((SELECT created_at FROM tl_records WHERE store_name = ? AND id = ?), ?), ?)"
      );
      normalizedRecords.forEach((record) => {
        writeRecord.run(name, record.id, record.workspaceId, record.recordJson, name, record.id, updatedAt, updatedAt);
      });
      database.exec("COMMIT");
      return { mode: DEFAULT_MODE, status: "development-write-complete", storeName: name, recordCount: normalizedRecords.length };
    } catch (error) {
      try { database.exec("ROLLBACK"); } catch (_) { /* Nessuna transazione aperta. */ }
      throw error;
    } finally {
      database.close();
    }
  }

  deleteDevelopmentRecords({ storeName = "", ids = [] } = {}) {
    const name = String(storeName || "");
    if (!isAllowedRepositoryStore(name)) throw new Error(`Unsupported persistence store: ${name}`);
    if (!Array.isArray(ids)) throw new Error("Development record ids must be an array.");
    if (!this.databasePath || !fs.existsSync(this.databasePath)) throw new Error("SQLite development candidate does not exist.");
    const recordIds = [...new Set(ids.map((id) => String(id || "")).filter(Boolean))];
    this.lastDevelopmentShadowMatch = false;
    const database = new DatabaseSync(this.databasePath);
    try {
      database.exec("BEGIN IMMEDIATE");
      const removeRecord = database.prepare("DELETE FROM tl_records WHERE store_name = ? AND id = ?");
      recordIds.forEach((id) => removeRecord.run(name, id));
      database.exec("COMMIT");
      return { mode: DEFAULT_MODE, status: "development-delete-complete", storeName: name, recordCount: recordIds.length };
    } catch (error) {
      try { database.exec("ROLLBACK"); } catch (_) { /* Nessuna transazione aperta. */ }
      throw error;
    } finally {
      database.close();
    }
  }

  readFixtureRecords(storeName = "") {
    if (!FIRST_COHORT_STORES.includes(String(storeName))) throw new Error(`Unsupported persistence store: ${String(storeName)}`);
    if (!this.databasePath || !fs.existsSync(this.databasePath)) return [];
    const database = new DatabaseSync(this.databasePath, { readOnly: true });
    try {
      return database.prepare("SELECT record_json FROM tl_records WHERE store_name = ? ORDER BY id").all(String(storeName))
        .map((row) => parseStoredJson(row.record_json));
    } finally {
      database.close();
    }
  }
}

module.exports = {
  DEFAULT_MODE,
  DesktopPersistence,
  FIRST_COHORT_STORES,
  SQLITE_REPOSITORY_STORES,
  PERSISTENCE_CONTRACT_VERSION,
  createBackupManifest,
  createImportPlan
};
