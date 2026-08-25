window.TrackerLensTimeTravelStore = (() => {
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

  const write = async (record) => {
    const persistence = desktopPersistence();
    if (!await usesDesktopSqlite() || !persistence?.writeDevelopmentRecords) {
      throw new Error("Time Travel richiede SQLite nell'app desktop.");
    }
    await persistence.writeDevelopmentRecords({ storeName: STORE, records: [record] });
    return record;
  };

  const readAllStore = async (storeName) => {
    const persistence = desktopPersistence();
    if (!await usesDesktopSqlite() || !persistence?.readDevelopmentRecords) throw new Error("Time Travel richiede SQLite nell'app desktop.");
    return persistence.readDevelopmentRecords({ storeName });
  };

  const replaceStore = async (storeName, records = []) => {
    const persistence = desktopPersistence();
    if (!await usesDesktopSqlite() || !persistence?.readDevelopmentRecords || !persistence?.deleteDevelopmentRecords || !persistence?.writeDevelopmentRecords) throw new Error("Time Travel richiede SQLite nell'app desktop.");
    const existing = await persistence.readDevelopmentRecords({ storeName });
    await persistence.deleteDevelopmentRecords({ storeName, ids: existing.map((record) => record.id) });
    await persistence.writeDevelopmentRecords({ storeName, records: records.filter((record) => record?.id) });
    return { storeName, restored: records.length, skipped: false };
  };

  const list = async ({ workspaceId = "" } = {}) => {
    const persistence = desktopPersistence();
    if (!await usesDesktopSqlite() || !persistence?.readDevelopmentRecords) throw new Error("Time Travel richiede SQLite nell'app desktop.");
    return (await persistence.readDevelopmentRecords({ storeName: STORE, workspaceId }))
      .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
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
