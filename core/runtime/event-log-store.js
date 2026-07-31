window.TrackerLensEventLogStore = (() => {
  const DB_NAME = "TrackersLens";
  const config = () => (typeof tlConfig !== "undefined" ? tlConfig : window.tlConfig) || {};
  const tableName = (key, fallback) => config()?.TABLES?.[key] || fallback;

  const STORES = {
    events: tableName("TL_EVENTS", "tl_events"),
    flowLogs: tableName("TL_FLOW_LOGS", "tl_flow_logs"),
  };

  const STORE_DEFINITIONS = [
    { name: STORES.events, columns: [{ name: "workspaceId" }, { name: "channel" }, { name: "eventType" }, { name: "createdAt" }] },
    { name: STORES.flowLogs, columns: [{ name: "workspaceId" }, { name: "flowId" }, { name: "createdAt" }] },
  ];
  const DEFAULT_RETENTION = {
    eventLimit: 0,
    flowLogLimit: 0,
  };
  const SETTINGS_STORE = tableName("TL_SETTINGS", "tl_settings");
  const SETTINGS_RECORD_ID = "global";

  const createIndexes = (store, columns = []) => {
    columns.forEach((column) => {
      if (!store.indexNames.contains(column.name)) {
        store.createIndex(column.name, column?.keyPath ?? column.name, column?.options ?? { unique: false });
      }
    });
  };

  const createMissingStores = (db) => {
    STORE_DEFINITIONS.forEach((definition) => {
      if (db.objectStoreNames.contains(definition.name)) return;
      createIndexes(db.createObjectStore(definition.name, { keyPath: "id" }), definition.columns);
    });
  };

  const bindVersionChange = (db) => {
    db.onversionchange = () => {
      db.close();
      console.warn("IndexedDB event log chiuso per consentire aggiornamento da un'altra scheda.");
    };
    return db;
  };

  const openDb = (version = undefined) =>
    new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("IndexedDB non disponibile"));
        return;
      }

      const request = version ? indexedDB.open(DB_NAME, version) : indexedDB.open(DB_NAME);
      request.onupgradeneeded = (event) => createMissingStores(event.target.result);
      request.onsuccess = (event) => resolve(bindVersionChange(event.target.result));
      request.onerror = (event) => reject(event.target.error || new Error("Errore apertura IndexedDB event log"));
      request.onblocked = () => reject(new Error("IndexedDB bloccato da un'altra scheda."));
    });

  const ensureStores = async () => {
    if (window.TrackerLensDependencyManager?.ensureRuntimeStores) {
      await window.TrackerLensDependencyManager.ensureRuntimeStores().then((db) => db?.close?.());
    }

    const db = await openDb();
    const hasAllStores = STORE_DEFINITIONS.every((definition) => db.objectStoreNames.contains(definition.name));
    if (hasAllStores) return db;

    const nextVersion = db.version + 1;
    db.close();
    return openDb(nextVersion);
  };

  const write = async (storeName, record) => {
    const db = await ensureStores();
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction(storeName, "readwrite").objectStore(storeName).put(record);
        request.onsuccess = () => resolve(record);
        request.onerror = (event) => reject(event.target.error || new Error(`Errore salvataggio ${storeName}`));
      });
    } finally {
      db.close();
    }
  };

  const deleteRecords = async (storeName, ids = []) => {
    const uniqueIds = [...new Set(ids.filter(Boolean).map(String))];
    if (!uniqueIds.length) return [];
    const db = await ensureStores();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, "readwrite");
        const store = transaction.objectStore(storeName);
        uniqueIds.forEach((id) => store.delete(id));
        transaction.oncomplete = () => resolve(uniqueIds);
        transaction.onerror = (event) => reject(event.target.error || new Error(`Errore cleanup ${storeName}`));
      });
    } finally {
      db.close();
    }
  };

  const clearStore = async (storeName) => {
    const db = await ensureStores();
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction(storeName, "readwrite").objectStore(storeName).clear();
        request.onsuccess = () => resolve(storeName);
        request.onerror = (event) => reject(event.target.error || new Error(`Errore reset ${storeName}`));
      });
    } finally {
      db.close();
    }
  };

  const clearAll = async () => {
    await Promise.all([clearStore(STORES.events), clearStore(STORES.flowLogs)]);
    return {
      stores: [STORES.events, STORES.flowLogs],
      clearedAt: new Date().toISOString(),
    };
  };

  const readRetentionPolicy = async () => {
    const db = await ensureStores();
    try {
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) return { ...DEFAULT_RETENTION };
      const settings = await new Promise((resolve) => {
        const request = db.transaction(SETTINGS_STORE, "readonly").objectStore(SETTINGS_STORE).get(SETTINGS_RECORD_ID);
        request.onsuccess = (event) => resolve(event.target.result?.settings || {});
        request.onerror = () => resolve({});
      });
      const storage = settings?.storage || {};
      const eventLimit = Number(storage.runtimeEventLimit ?? DEFAULT_RETENTION.eventLimit);
      const flowLogLimit = Number(storage.runtimeFlowLogLimit ?? DEFAULT_RETENTION.flowLogLimit);
      return {
        eventLimit: Number.isFinite(eventLimit) && eventLimit > 0 ? Math.floor(eventLimit) : 0,
        flowLogLimit: Number.isFinite(flowLogLimit) && flowLogLimit > 0 ? Math.floor(flowLogLimit) : 0,
      };
    } finally {
      db.close();
    }
  };

  const pruneByScope = async ({ storeName, workspaceId = "global", channel = "", limit = 0 }) => {
    const explicitLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 0;
    if (!explicitLimit) return false;
    const db = await ensureStores();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, "readwrite");
        const store = transaction.objectStore(storeName);
        const request = store.getAll();
        request.onsuccess = (event) => {
          const records = Array.from(event.target.result || [])
            .filter((record) => record.workspaceId === workspaceId)
            .filter((record) => !channel || record.channel === channel)
            .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
          records.slice(explicitLimit).forEach((record) => store.delete(record.id));
        };
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = (event) => reject(event.target.error || new Error(`Errore cleanup ${storeName}`));
      });
    } finally {
      db.close();
    }
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

  const listEvents = async () => {
    const db = await ensureStores();
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction(STORES.events, "readonly").objectStore(STORES.events).getAll();
        request.onsuccess = (event) => resolve(Array.from(event.target.result || []));
        request.onerror = (event) => reject(event.target.error || new Error("Errore lettura eventi runtime"));
      });
    } finally {
      db.close();
    }
  };

  const listFlowLogs = async () => {
    const db = await ensureStores();
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction(STORES.flowLogs, "readonly").objectStore(STORES.flowLogs).getAll();
        request.onsuccess = (event) => resolve(Array.from(event.target.result || []));
        request.onerror = (event) => reject(event.target.error || new Error("Errore lettura flow logs runtime"));
      });
    } finally {
      db.close();
    }
  };

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
