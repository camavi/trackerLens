window.TrackerLensEventLogStore = (() => {
  const config = () => (typeof tlConfig !== "undefined" ? tlConfig : window.tlConfig) || {};
  const tableName = (key, fallback) => config()?.TABLES?.[key] || fallback;

  const STORES = {
    events: tableName("TL_EVENTS", "tl_events"),
    flowLogs: tableName("TL_FLOW_LOGS", "tl_flow_logs"),
  };

  const DEFAULT_RETENTION = {
    eventLimit: 0,
    flowLogLimit: 0,
  };
  const SETTINGS_STORE = tableName("TL_SETTINGS", "tl_settings");
  const SETTINGS_RECORD_ID = "global";
  let desktopSqliteMode = null;

  const desktopPersistence = () => window.trackers?.desktop?.persistence || null;
  const usesDesktopSqlite = async () => {
    if (desktopSqliteMode !== null) return desktopSqliteMode;
    const persistence = desktopPersistence();
    if (!persistence?.getStatus) throw new Error("Event Log richiede SQLite nell'app desktop.");
    try {
      desktopSqliteMode = (await persistence.getStatus())?.mode === "desktop-sqlite";
    } catch (error) {
      throw error;
    }
    if (!desktopSqliteMode) throw new Error("Event Log richiede SQLite nell'app desktop.");
    return desktopSqliteMode;
  };

  const ensureStores = async () => {
    await usesDesktopSqlite();
    return desktopPersistence();
  };

  const write = async (storeName, record) => {
    await (await ensureStores()).writeDevelopmentRecords({ storeName, records: [record] });
    return record;
  };

  const deleteRecords = async (storeName, ids = []) => {
    const uniqueIds = [...new Set(ids.filter(Boolean).map(String))];
    if (!uniqueIds.length) return [];
    await (await ensureStores()).deleteDevelopmentRecords({ storeName, ids: uniqueIds });
    return uniqueIds;
  };

  const clearStore = async (storeName) => {
    const persistence = await ensureStores();
    const records = await persistence.readDevelopmentRecords({ storeName });
    await deleteRecords(storeName, records.map((record) => record.id));
    return storeName;
  };

  const clearAll = async () => {
    await Promise.all([clearStore(STORES.events), clearStore(STORES.flowLogs)]);
    return {
      stores: [STORES.events, STORES.flowLogs],
      clearedAt: new Date().toISOString(),
    };
  };

  const readRetentionPolicy = async () => {
    const settings = await (await ensureStores()).readDevelopmentRecords({ storeName: SETTINGS_STORE });
    const record = settings.find((item) => item.id === SETTINGS_RECORD_ID) || {};
    const storage = record.settings?.storage || record.content?.settings?.storage || {};
    const eventLimit = Number(storage.runtimeEventLimit ?? DEFAULT_RETENTION.eventLimit);
    const flowLogLimit = Number(storage.runtimeFlowLogLimit ?? DEFAULT_RETENTION.flowLogLimit);
    return {
      eventLimit: Number.isFinite(eventLimit) && eventLimit > 0 ? Math.floor(eventLimit) : 0,
      flowLogLimit: Number.isFinite(flowLogLimit) && flowLogLimit > 0 ? Math.floor(flowLogLimit) : 0,
    };
  };

  const pruneByScope = async ({ storeName, workspaceId = "global", channel = "", limit = 0 }) => {
    const explicitLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 0;
    if (!explicitLimit) return false;
    const records = await (await ensureStores()).readDevelopmentRecords({ storeName, workspaceId });
    const ids = records
      .filter((record) => !channel || record.channel === channel)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(explicitLimit)
      .map((record) => record.id);
    await deleteRecords(storeName, ids);
    return true;
  };

  const cleanupEvents = ({ workspaceId = "global", channel = "", limit = 0 } = {}) =>
    pruneByScope({ storeName: STORES.events, workspaceId, channel, limit });

  const cleanupFlowLogs = ({ workspaceId = "global", limit = 0 } = {}) =>
    pruneByScope({ storeName: STORES.flowLogs, workspaceId, limit });

  const applyRetentionPolicy = async (policy = null) => {
    const retention = policy || await readRetentionPolicy();
    const [events, flowLogs] = await Promise.all([listEvents(), listFlowLogs()]);
    const eventScopes = [...new Set(events.map((event) => `${event.workspaceId || "global"}::${event.channel || ""}`))];
    const flowScopes = [...new Set(flowLogs.map((log) => log.workspaceId || "global"))];
    await Promise.all([
      ...eventScopes.map((scope) => {
        const [workspaceId, channel] = scope.split("::");
        return cleanupEvents({ workspaceId, channel, limit: retention.eventLimit });
      }),
      ...flowScopes.map((workspaceId) => cleanupFlowLogs({ workspaceId, limit: retention.flowLogLimit })),
    ]);
    return {
      ...retention,
      eventScopes: eventScopes.length,
      flowScopes: flowScopes.length,
      appliedAt: new Date().toISOString(),
    };
  };

  const cleanupNodeReferences = async ({ nodeIds = [], workspaceId = "" } = {}) => {
    const ids = new Set(nodeIds.filter(Boolean).map(String));
    if (!ids.size) return { eventIds: [], flowLogIds: [] };
    const [events, flowLogs] = await Promise.all([listEvents(), listFlowLogs()]);
    const eventIds = events
      .filter((event) => !workspaceId || event.workspaceId === workspaceId)
      .filter((event) => ids.has(String(event.sourceNodeId)) || ids.has(String(event.targetNodeId)))
      .map((event) => event.id);
    const flowLogIds = flowLogs
      .filter((log) => !workspaceId || log.workspaceId === workspaceId)
      .filter((log) => ids.has(String(log.nodeId)))
      .map((log) => log.id);

    await Promise.all([
      deleteRecords(STORES.events, eventIds),
      deleteRecords(STORES.flowLogs, flowLogIds),
    ]);
    return { eventIds, flowLogIds };
  };

  const cleanupConnectionReferences = async ({ connectionId = "", workspaceId = "" } = {}) => {
    if (!connectionId) return { eventIds: [], flowLogIds: [] };
    const [events, flowLogs] = await Promise.all([listEvents(), listFlowLogs()]);
    const eventIds = events
      .filter((event) => !workspaceId || event.workspaceId === workspaceId)
      .filter((event) => event.connectionId === connectionId || event.context?.connectionId === connectionId)
      .map((event) => event.id);
    const flowLogIds = flowLogs
      .filter((log) => !workspaceId || log.workspaceId === workspaceId)
      .filter((log) => log.connectionId === connectionId || log.context?.connectionId === connectionId)
      .map((log) => log.id);

    await Promise.all([
      deleteRecords(STORES.events, eventIds),
      deleteRecords(STORES.flowLogs, flowLogIds),
    ]);
    return { eventIds, flowLogIds };
  };

  const payloadSize = (payload, payloadText = "") => {
    const text = payloadText || JSON.stringify(payload || {});
    return new Blob([text]).size;
  };

  const recordEvent = async ({
    id = "",
    workspaceId = "global",
    flowId = "",
    channel = "default",
    eventType = "emitted",
    sourceNodeId = "",
    targetNodeId = "",
    connectionId = "",
    payload = {},
    payloadText = "",
    status = "ok",
    latencyMs = 0,
  } = {}) => {
    const createdAt = new Date().toISOString();
    const event = {
      id: id || `event_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      workspaceId,
      flowId,
      channel,
      eventType,
      sourceNodeId,
      targetNodeId,
      connectionId,
      payload,
      status,
      latencyMs: Number(latencyMs) || 0,
      sizeBytes: payloadSize(payload, payloadText),
      createdAt,
    };

    await write(STORES.events, event);
    readRetentionPolicy()
      .then((policy) => cleanupEvents({ workspaceId, channel, limit: policy.eventLimit }))
      .catch((error) => {
        console.warn("Cleanup eventi runtime non completato:", error);
      });
    return event;
  };

  const recordFlowLog = async ({
    workspaceId = "global",
    flowId = "",
    nodeId = "",
    connectionId = "",
    level = "info",
    message = "",
    context = {},
  } = {}) => {
    const createdAt = new Date().toISOString();
    const log = {
      id: `flowlog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      workspaceId,
      flowId,
      nodeId,
      connectionId,
      level,
      message,
      context,
      createdAt,
    };

    await write(STORES.flowLogs, log);
    readRetentionPolicy()
      .then((policy) => cleanupFlowLogs({ workspaceId, limit: policy.flowLogLimit }))
      .catch((error) => {
        console.warn("Cleanup flow logs non completato:", error);
      });
    return log;
  };

  const listEvents = async () => (await ensureStores()).readDevelopmentRecords({ storeName: STORES.events });

  const listFlowLogs = async () => (await ensureStores()).readDevelopmentRecords({ storeName: STORES.flowLogs });

  return {
    STORES,
    applyRetentionPolicy,
    clearAll,
    clearStore,
    cleanupConnectionReferences,
    cleanupEvents,
    cleanupFlowLogs,
    cleanupNodeReferences,
    deleteRecords,
    ensureStores,
    listFlowLogs,
    listEvents,
    recordEvent,
    recordFlowLog,
    readRetentionPolicy,
  };
})();
