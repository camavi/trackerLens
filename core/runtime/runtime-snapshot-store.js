window.TrackerLensRuntimeSnapshotStore = (() => {
  const DB_NAME = "TrackersLens";
  const config = () => (typeof tlConfig !== "undefined" ? tlConfig : window.tlConfig) || {};
  const tableName = (key, fallback) => config()?.TABLES?.[key] || fallback;

  const STORES = {
    channels: tableName("TL_CHANNELS", "tl_channels"),
    flows: tableName("TL_FLOWS", "tl_flows"),
    events: tableName("TL_EVENTS", "tl_events"),
    flowLogs: tableName("TL_FLOW_LOGS", "tl_flow_logs"),
    runtimeNodes: tableName("TL_RUNTIME_NODES", "tl_runtime_nodes"),
    runtimeDependencies: tableName("TL_RUNTIME_DEPENDENCIES", "tl_runtime_dependencies"),
    connections: tableName("TL_CONNECTIONS", "tl_connections"),
    offlineQueue: tableName("TL_OFFLINE_QUEUE", "tl_offline_queue"),
    offlineCache: tableName("TL_OFFLINE_CACHE", "tl_offline_cache"),
    packages: tableName("TL_PACKAGES", "tl_packages"),
    packageLock: tableName("TL_PACKAGE_LOCK", "tl_package_lock"),
    performance: tableName("TL_BOX_PERFORMANCE", "tl_box_performance"),
    timeTravel: tableName("TL_TIME_TRAVEL_SNAPSHOTS", "tl_time_travel_snapshots"),
  };

  const ensureRuntimeStores = async () => {
    if (window.TrackerLensRuntimeGraphStore?.ensureStores) {
      await window.TrackerLensRuntimeGraphStore.ensureStores().then((db) => db?.close?.());
      return;
    }
    if (window.TrackerLensDependencyManager?.ensureRuntimeStores) {
      await window.TrackerLensDependencyManager.ensureRuntimeStores().then((db) => db?.close?.());
    }
  };

  const openDb = () =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open(config().DB_NAME || DB_NAME);
      request.onsuccess = (event) => resolve(event.target.result);
      request.onerror = (event) => reject(event.target.error || new Error("Errore apertura IndexedDB runtime snapshot"));
      request.onblocked = () => reject(new Error("IndexedDB bloccato da un'altra scheda"));
    });

  const readAllFromDb = (db, storeName) =>
    new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains(storeName)) {
        resolve([]);
        return;
      }
      const read = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
      read.onsuccess = (event) => resolve(Array.from(event.target.result || []));
      read.onerror = (event) => reject(event.target.error || new Error(`Errore lettura ${storeName}`));
    });

  const readWorkspaceScopedFromDb = (db, storeName, workspaceId = "") =>
    new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains(storeName)) {
        resolve([]);
        return;
      }
      const store = db.transaction(storeName, "readonly").objectStore(storeName);
      if (!workspaceId || workspaceId === "all" || !store.indexNames.contains("workspaceId")) {
        const read = store.getAll();
        read.onsuccess = (event) => {
          const records = Array.from(event.target.result || []);
          resolve(workspaceId && workspaceId !== "all"
            ? records.filter((record) => (record.workspaceId || "global") === workspaceId)
            : records);
        };
        read.onerror = (event) => reject(event.target.error || new Error(`Errore lettura ${storeName}`));
        return;
      }
      const read = store.index("workspaceId").getAll(workspaceId);
      read.onsuccess = (event) => {
        const indexedRecords = Array.from(event.target.result || []);
        if (indexedRecords.length) {
          resolve(indexedRecords);
          return;
        }
        const fallbackRead = store.getAll();
        fallbackRead.onsuccess = (fallbackEvent) => {
          resolve(Array.from(fallbackEvent.target.result || [])
            .filter((record) => (record.workspaceId || "global") === workspaceId));
        };
        fallbackRead.onerror = (fallbackEvent) => reject(fallbackEvent.target.error || new Error(`Errore fallback lettura ${storeName}`));
      };
      read.onerror = (event) => reject(event.target.error || new Error(`Errore lettura ${storeName} per workspace`));
    });

  const readWorkspaceScoped = async (db, storeName, workspaceId = "") => {
    const graphStore = window.TrackerLensRuntimeGraphStore;
    const desktopStores = new Set([
      STORES.channels, STORES.flows, STORES.events, STORES.flowLogs, STORES.runtimeNodes, STORES.runtimeDependencies, STORES.connections,
    ]);
    if (desktopStores.has(storeName) && await graphStore?.usesDesktopSqlite?.()) {
      const records = await window.trackers?.desktop?.persistence?.readDevelopmentRecords?.({ storeName, workspaceId: workspaceId === "all" ? "" : workspaceId });
      return Array.isArray(records) ? records : [];
    }
    return readWorkspaceScopedFromDb(db, storeName, workspaceId);
  };

  const load = async ({ includeConnections = true, workspaceId = "" } = {}) => {
    await ensureRuntimeStores();
    const db = await openDb();
    try {
      const [channels, flows, events, flowLogs, runtimeNodes, runtimeDependencies, connections] = await Promise.all([
        readWorkspaceScoped(db, STORES.channels, workspaceId),
        readWorkspaceScoped(db, STORES.flows, workspaceId),
        readWorkspaceScoped(db, STORES.events, workspaceId),
        readWorkspaceScoped(db, STORES.flowLogs, workspaceId),
        readWorkspaceScoped(db, STORES.runtimeNodes, workspaceId),
        readWorkspaceScoped(db, STORES.runtimeDependencies, workspaceId),
        includeConnections ? readWorkspaceScoped(db, STORES.connections, workspaceId) : Promise.resolve([]),
      ]);

      return {
        workspaceId: workspaceId || "all",
        channels,
        flows,
        events,
        flowLogs,
        runtimeNodes,
        runtimeDependencies,
        connections,
        offlineQueue: await readAllFromDb(db, STORES.offlineQueue),
        offlineCache: await readAllFromDb(db, STORES.offlineCache),
        packages: await readAllFromDb(db, STORES.packages),
        packageLock: await readAllFromDb(db, STORES.packageLock),
        performance: await readAllFromDb(db, STORES.performance),
        timeTravel: await readAllFromDb(db, STORES.timeTravel),
        loadedAt: new Date().toISOString(),
      };
    } finally {
      db.close();
    }
  };

  return {
    STORES,
    load,
  };
})();
