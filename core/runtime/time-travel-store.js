window.TrackerLensTimeTravelStore = (() => {
  const DB_NAME = "TrackersLens";
  const STORE = "tl_time_travel_snapshots";
  let desktopSqliteMode = null;
  const desktopPersistence = () => window.trackers?.desktop?.persistence || null;
  const usesDesktopSqlite = async () => {
    if (desktopSqliteMode !== null) return desktopSqliteMode;
    const persistence = desktopPersistence();
    if (!persistence?.getStatus) return (desktopSqliteMode = false);
    try { desktopSqliteMode = (await persistence.getStatus())?.mode === "desktop-sqlite"; } catch (_) { desktopSqliteMode = false; }
    return desktopSqliteMode;
  };
  const SCHEMA_VERSION = "1.0.0";

  const now = () => new Date().toISOString();
  const clone = (value) => JSON.parse(JSON.stringify(value ?? null));

  const createStores = (db) => {
    if (db.objectStoreNames.contains(STORE)) return;
    const store = db.createObjectStore(STORE, { keyPath: "id" });
    store.createIndex("workspaceId", "workspaceId", { unique: false });
    store.createIndex("reason", "reason", { unique: false });
    store.createIndex("createdAt", "createdAt", { unique: false });
  };

  const openDb = (version = undefined) =>
    new Promise((resolve, reject) => {
      const request = version ? indexedDB.open(DB_NAME, version) : indexedDB.open(DB_NAME);
      request.onupgradeneeded = (event) => createStores(event.target.result);
      request.onsuccess = (event) => resolve(event.target.result);
      request.onerror = (event) => reject(event.target.error || new Error("Errore apertura time travel store"));
    });

  const ensureDb = async () => {
    if (await usesDesktopSqlite()) return { close() {} };
    const db = await openDb();
    if (db.objectStoreNames.contains(STORE)) return db;
    const version = db.version + 1;
    db.close();
    return openDb(version);
  };

  const write = async (record) => {
    if (await usesDesktopSqlite()) {
      await desktopPersistence().writeDevelopmentRecords({ storeName: STORE, records: [record] });
      return record;
    }
    const db = await ensureDb();
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction(STORE, "readwrite").objectStore(STORE).put(record);
        request.onsuccess = () => resolve(record);
        request.onerror = (event) => reject(event.target.error || new Error("Errore scrittura time travel snapshot"));
      });
    } finally {
      db.close();
    }
  };

  const readAllStore = async (storeName) => {
    if (await usesDesktopSqlite()) return desktopPersistence().readDevelopmentRecords({ storeName });
    const db = await ensureDb();
    try {
      if (!db.objectStoreNames.contains(storeName)) return [];
      return await new Promise((resolve, reject) => {
        const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
        request.onsuccess = (event) => resolve(Array.from(event.target.result || []));
        request.onerror = (event) => reject(event.target.error || new Error(`Errore lettura ${storeName}`));
      });
    } finally {
      db.close();
    }
  };

  const replaceStore = async (storeName, records = []) => {
    if (await usesDesktopSqlite()) {
      const existing = await desktopPersistence().readDevelopmentRecords({ storeName });
      await desktopPersistence().deleteDevelopmentRecords({ storeName, ids: existing.map((record) => record.id) });
      await desktopPersistence().writeDevelopmentRecords({ storeName, records: records.filter((record) => record?.id) });
      return { storeName, restored: records.length, skipped: false };
    }
    const db = await ensureDb();
    try {
      if (!db.objectStoreNames.contains(storeName)) return { storeName, restored: 0, skipped: true };
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, "readwrite");
        const store = transaction.objectStore(storeName);
        store.clear();
        records.filter((record) => record?.id).forEach((record) => store.put(record));
        transaction.oncomplete = () => resolve({ storeName, restored: records.length, skipped: false });
        transaction.onerror = (event) => reject(event.target.error || new Error(`Errore restore ${storeName}`));
      });
    } finally {
      db.close();
    }
  };

  const list = async ({ workspaceId = "" } = {}) => {
    if (await usesDesktopSqlite()) {
      return (await desktopPersistence().readDevelopmentRecords({ storeName: STORE, workspaceId }))
        .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
    }
    const db = await ensureDb();
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
        request.onsuccess = (event) => {
          const records = Array.from(event.target.result || [])
            .filter((record) => !workspaceId || record.workspaceId === workspaceId)
            .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
          resolve(records);
        };
        request.onerror = (event) => reject(event.target.error || new Error("Errore lettura time travel snapshots"));
      });
    } finally {
      db.close();
    }
  };

  const capture = async ({ workspaceId = "global", reason = "manual", label = "", state = null } = {}) => {
    const runtime = state || (window.TrackerLensRuntimeSnapshotStore?.load
      ? await window.TrackerLensRuntimeSnapshotStore.load().catch(() => null)
      : null);
    return write({
      id: `tt_${workspaceId}_${Date.now()}`.replace(/[^A-Za-z0-9_-]/g, "_"),
      schemaVersion: SCHEMA_VERSION,
      workspaceId,
      reason,
      label: label || reason,
      state: clone(runtime || {}),
      createdAt: now(),
    });
  };

  const latest = async ({ workspaceId = "" } = {}) => (await list({ workspaceId }))[0] || null;

  const snapshotById = async (id = "") => (await list()).find((item) => item.id === id) || null;

  const runtimeStores = () => window.TrackerLensRuntimeSnapshotStore?.STORES || {};

  const restore = async ({ snapshotId = "", snapshot = null, stores = [] } = {}) => {
    const record = snapshot || await snapshotById(snapshotId);
    if (!record) throw new Error("Snapshot non trovato");
    const state = record.state || {};
    const storeMap = runtimeStores();
    const targets = stores.length ? stores : [
      "channels",
      "flows",
      "runtimeNodes",
      "runtimeDependencies",
      "connections",
      "offlineQueue",
      "offlineCache",
      "packages",
      "packageLock",
      "performance",
    ];
    const restored = [];
    for (const key of targets) {
      const storeName = storeMap[key];
      if (!storeName || !Array.isArray(state[key])) continue;
      restored.push(await replaceStore(storeName, clone(state[key])));
    }
    return {
      snapshotId: record.id,
      restored,
      restoredAt: now(),
    };
  };

  const countById = (records = []) => new Map(records.filter((item) => item?.id).map((item) => [item.id, item]));

  const diffSnapshots = async ({ fromId = "", toId = "" } = {}) => {
    const [from, to] = await Promise.all([snapshotById(fromId), snapshotById(toId)]);
    if (!from || !to) throw new Error("Snapshot diff richiede fromId e toId validi");
    const keys = ["channels", "flows", "events", "flowLogs", "runtimeNodes", "runtimeDependencies", "connections", "packages", "packageLock", "performance"];
    const changes = keys.map((key) => {
      const left = countById(from.state?.[key] || []);
      const right = countById(to.state?.[key] || []);
      const added = [...right.keys()].filter((id) => !left.has(id));
      const removed = [...left.keys()].filter((id) => !right.has(id));
      const changed = [...right.keys()].filter((id) => left.has(id) && JSON.stringify(left.get(id)) !== JSON.stringify(right.get(id)));
      return { key, added, removed, changed, total: added.length + removed.length + changed.length };
    });
    return { fromId, toId, changes, total: changes.reduce((sum, item) => sum + item.total, 0) };
  };

  const replay = async ({ snapshotId = "", limit = 50 } = {}) => {
    const record = await snapshotById(snapshotId);
    if (!record) throw new Error("Snapshot non trovato");
    const events = [...(record.state?.events || [])]
      .sort((a, b) => Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0))
      .slice(0, limit);
    return {
      snapshotId: record.id,
      events,
      count: events.length,
      replayedAt: now(),
    };
  };

  return {
    SCHEMA_VERSION,
    STORE,
    capture,
    diffSnapshots,
    ensureDb,
    latest,
    list,
    readAllStore,
    replay,
    restore,
    snapshotById,
  };
})();
