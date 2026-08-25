window.TrackerLensRuntimeSnapshotStore = (() => {
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

  const load = async ({ includeConnections = true, workspaceId = "" } = {}) => {
    const persistence = window.trackers?.desktop?.persistence;
    const graphStore = window.TrackerLensRuntimeGraphStore;
    if (!await graphStore?.usesDesktopSqlite?.() || !persistence?.readDevelopmentRecords) throw new Error("Runtime Snapshot richiede SQLite nell'app desktop.");
    const read = (storeName, scoped = false) => persistence.readDevelopmentRecords({ storeName, ...(scoped && workspaceId !== "all" ? { workspaceId } : {}) });
    const [channels, flows, events, flowLogs, runtimeNodes, runtimeDependencies, connections, offlineQueue, offlineCache, packages, packageLock, performance, timeTravel] = await Promise.all([
      read(STORES.channels, true), read(STORES.flows, true), read(STORES.events, true), read(STORES.flowLogs, true), read(STORES.runtimeNodes, true), read(STORES.runtimeDependencies, true), includeConnections ? read(STORES.connections, true) : [],
      read(STORES.offlineQueue), read(STORES.offlineCache), read(STORES.packages), read(STORES.packageLock), read(STORES.performance), read(STORES.timeTravel),
    ]);
    return { workspaceId: workspaceId || "all", channels, flows, events, flowLogs, runtimeNodes, runtimeDependencies, connections, offlineQueue, offlineCache, packages, packageLock, performance, timeTravel, loadedAt: new Date().toISOString() };
  };

  return {
    STORES,
    load,
  };
})();
