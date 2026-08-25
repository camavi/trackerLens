window.TrackerLensConnectionsStore = (() => {
  const DB_NAME = "TrackersLens";
  const CONNECTION_STORE = "tl_connections";
  const PAGE_STORE = "tl_pages";
  const WIDGET_STORE = "tl_widgets";
  let desktopSqliteMode = null;

  const desktopPersistence = () => window.trackers?.desktop?.persistence || null;
  const usesDesktopSqlite = async () => {
    if (desktopSqliteMode !== null) return desktopSqliteMode;
    const persistence = desktopPersistence();
    if (!persistence?.getStatus) {
      if (typeof navigator !== "undefined" && /Electron\//i.test(navigator.userAgent || "")) throw new Error("SQLite desktop bridge unavailable.");
      return (desktopSqliteMode = false);
    }
    try {
      desktopSqliteMode = (await persistence.getStatus())?.mode === "desktop-sqlite";
    } catch (error) {
      if (typeof navigator !== "undefined" && /Electron\//i.test(navigator.userAgent || "")) throw error;
      desktopSqliteMode = false;
    }
    return desktopSqliteMode;
  };

  const normalizeText = (value, fallback = "") => {
    if (value === null || value === undefined) return fallback;
    return String(value).trim() || fallback;
  };

  const openDb = (version = undefined) =>
    new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("IndexedDB non disponibile"));
        return;
      }

      const request = version ? indexedDB.open(DB_NAME, version) : indexedDB.open(DB_NAME);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(CONNECTION_STORE)) {
          const store = db.createObjectStore(CONNECTION_STORE, { keyPath: "id" });
          store.createIndex("workspaceId", "workspaceId", { unique: false });
          store.createIndex("type", "type", { unique: false });
          store.createIndex("status", "status", { unique: false });
          store.createIndex("updatedAt", "updatedAt", { unique: false });
        }
      };
      request.onsuccess = (event) => resolve(event.target.result);
      request.onerror = (event) => reject(event.target.error || new Error("Errore apertura IndexedDB"));
      request.onblocked = () => reject(new Error("IndexedDB bloccato da un'altra scheda"));
    });

  const ensureStore = async () => {
    if (await usesDesktopSqlite()) return { close() {} };
    const db = await openDb();
    if (db.objectStoreNames.contains(CONNECTION_STORE)) return db;

    const nextVersion = db.version + 1;
    db.close();
    return openDb(nextVersion);
  };

  const readAll = async (storeName) => {
    if (await usesDesktopSqlite()) return desktopPersistence().readDevelopmentRecords({ storeName });
    const db = await ensureStore();
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

  const readRecord = async (storeName, id) => {
    if (!id) return null;
    if (await usesDesktopSqlite()) return (await readAll(storeName)).find((record) => record.id === id) || null;
    const db = await ensureStore();
    try {
      if (!db.objectStoreNames.contains(storeName)) return null;

      return await new Promise((resolve, reject) => {
        const request = db.transaction(storeName, "readonly").objectStore(storeName).get(id);
        request.onsuccess = (event) => resolve(event.target.result || null);
        request.onerror = (event) => reject(event.target.error || new Error(`Errore lettura ${storeName}`));
      });
    } finally {
      db.close();
    }
  };

  const write = async (storeName, record) => {
    if (await usesDesktopSqlite()) {
      await desktopPersistence().writeDevelopmentRecords({ storeName, records: [record] });
      return record;
    }
    const db = await ensureStore();
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

  const remove = async (id) => {
    if (await usesDesktopSqlite()) {
      await desktopPersistence().deleteDevelopmentRecords({ storeName: CONNECTION_STORE, ids: [id] });
      return id;
    }
    const db = await ensureStore();
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction(CONNECTION_STORE, "readwrite").objectStore(CONNECTION_STORE).delete(id);
        request.onsuccess = () => resolve(id);
        request.onerror = (event) => reject(event.target.error || new Error("Errore eliminazione collegamento"));
      });
    } finally {
      db.close();
    }
  };

  const removeMany = async (ids = []) => {
    const uniqueIds = [...new Set(ids.filter(Boolean).map(String))];
    if (!uniqueIds.length) return [];
    if (await usesDesktopSqlite()) {
      await desktopPersistence().deleteDevelopmentRecords({ storeName: CONNECTION_STORE, ids: uniqueIds });
      return uniqueIds;
    }
    const db = await ensureStore();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(CONNECTION_STORE, "readwrite");
        const store = transaction.objectStore(CONNECTION_STORE);
        uniqueIds.forEach((id) => store.delete(id));
        transaction.oncomplete = () => resolve(uniqueIds);
        transaction.onerror = (event) => reject(event.target.error || new Error("Errore cleanup collegamenti workspace"));
      });
    } finally {
      db.close();
    }
  };

  const workspaceConnectionKey = (connection = {}) => {
    if (connection.id) return `id:${connection.id}`;
    return [
      "edge",
      connection.fromBoxId || connection.sourceNodeId || "",
      connection.toBoxId || connection.targetNodeId || "",
      connection.channel || "default",
    ].join(":");
  };

  const workspaceConnectionPayload = (connection = {}) => ({
    id: normalizeText(connection.id, `connection_${Date.now()}`),
    fromBoxId: normalizeText(connection.fromBoxId || connection.sourceNodeId),
    toBoxId: normalizeText(connection.toBoxId || connection.targetNodeId),
    channel: normalizeText(connection.channel || connection.frequency, "default"),
    mapping: connection.mapping && typeof connection.mapping === "object"
      ? Object.fromEntries(Object.entries(connection.mapping).filter(([key]) => !["sourcePort", "targetPort", "channel"].includes(key)))
      : {},
  });

  const trackerChannel = (asset = {}) =>
    normalizeText(asset.outputChannel || asset.runtime?.output || asset.channels?.[0], "default");

  const hiddenTrackerBoxFromAsset = (asset = {}, now = new Date().toISOString()) => ({
    id: `tracker_${normalizeText(asset.assetId || asset.sourceRef || asset.id, "asset")}_${Date.now()}`,
    assetId: normalizeText(asset.assetId || asset.sourceRef || asset.id),
    sourceId: normalizeText(asset.sourceRef || asset.assetId || asset.id),
    type: "boxTracker",
    hidden: true,
    x: 1,
    y: 1,
    width: 1,
    height: 1,
    zIndex: 1,
    channels: [trackerChannel(asset)],
    createdAt: now,
    updatedAt: now,
  });

  const boxMatchesLibraryAsset = (box = {}, asset = {}) => {
    const ids = [asset.assetId, asset.sourceRef, asset.id].filter(Boolean).map(String);
    return box.type === "boxTracker" && ids.some((id) => [box.assetId, box.sourceId, box.id].filter(Boolean).map(String).includes(id));
  };

  const upsertLibraryTrackerWorkspaceLink = async ({ source = {}, target = {}, connection = {} } = {}) => {
    const workspaceId = normalizeText(connection.workspaceId || target.workspaceId);
    if (!workspaceId || source.workspaceId !== "library_local" || source.type !== "boxTracker" || !target.id) return null;

    const record = await readRecord(PAGE_STORE, workspaceId);
    const content = contentOf(record);
    if (!content || !Array.isArray(content.boxes)) return null;

    const now = new Date().toISOString();
    const boxes = content.boxes.map((box) => ({ ...box }));
    let trackerBox = boxes.find((box) => boxMatchesLibraryAsset(box, source));
    if (!trackerBox) {
      trackerBox = hiddenTrackerBoxFromAsset(source, now);
      boxes.push(trackerBox);
    }

    const lensBox = boxes.find((box) => box.id === target.id);
    if (!lensBox) return null;

    const channel = normalizeText(connection.channel || trackerChannel(source), "default");
    const workspaceConnection = workspaceConnectionPayload({
      ...connection,
      id: connection.id || `connection_${Date.now()}`,
      fromBoxId: trackerBox.id,
      toBoxId: lensBox.id,
      channel,
      mapping: connection.mapping || {},
    });
    const connections = Array.isArray(content.connections) ? content.connections : [];
    const merged = new Map(connections.map((item) => [workspaceConnectionKey(item), { ...item, mapping: { ...(item.mapping || {}) } }]));
    merged.set(workspaceConnectionKey(workspaceConnection), workspaceConnection);
    const nextContent = {
      ...content,
      id: content.id || workspaceId,
      updatedAt: now,
      boxes,
      connections: Array.from(merged.values()),
    };

    await write(PAGE_STORE, {
      ...(record || {}),
      id: workspaceId,
      content: nextContent,
    });

    const normalizedConnection = normalizeConnection({
      ...connection,
      ...workspaceConnection,
      name: connection.name || `${source.label || source.name || trackerBox.id} -> ${target.label || target.name || lensBox.id}`,
      type: connection.type || "boxTracker -> boxLens",
      from: source.label || source.name || trackerBox.id,
      fromKind: "boxTracker",
      to: target.label || target.name || lensBox.id,
      targetMeta: target.sourceRef || target.assetId || lensBox.id,
      workspaceId,
      workspaceName: content.name || content.title || workspaceId,
      endpoint: connection.endpoint || `workspace://${workspaceId}/${workspaceConnection.id}`,
      result: connection.result || "Creato dalla Flow Map",
      status: connection.status || "active",
      method: connection.method || "EVENT",
      frequency: channel,
      updatedAt: now,
    });
    await write(CONNECTION_STORE, normalizedConnection);

    return {
      connection: normalizedConnection,
      workspace: nextContent,
      boxes,
      connections: nextContent.connections,
      trackerBox,
    };
  };

  const upsertWorkspaceContentConnection = async (connection = {}) => {
    const normalized = normalizeConnection(connection);
    const workspaceId = normalizeText(normalized.workspaceId);
    const payload = workspaceConnectionPayload(normalized);
    if (!workspaceId || !payload.fromBoxId || !payload.toBoxId) return null;

    const record = await readRecord(PAGE_STORE, workspaceId);
    const content = contentOf(record);
    if (!content || !Array.isArray(content.boxes)) return null;

    const validBoxIds = new Set(content.boxes.map((box) => box.id).filter(Boolean));
    if (!validBoxIds.has(payload.fromBoxId) || !validBoxIds.has(payload.toBoxId)) return null;

    const connections = Array.isArray(content.connections) ? content.connections : [];
    const merged = new Map(connections.map((item) => [workspaceConnectionKey(item), { ...item, mapping: { ...(item.mapping || {}) } }]));
    merged.set(workspaceConnectionKey(payload), payload);

    const nextRecord = {
      ...(record || {}),
      id: workspaceId,
      content: {
        ...content,
        id: content.id || workspaceId,
        updatedAt: new Date().toISOString(),
        connections: Array.from(merged.values()),
      },
    };
    await write(PAGE_STORE, nextRecord);
    return payload;
  };

  const removeWorkspaceContentConnection = async (connectionId, { workspaceId = "" } = {}) => {
    if (!connectionId) return null;
    const candidateWorkspaceIds = workspaceId ? [workspaceId] : (await readAll(PAGE_STORE)).map((record) => record.id || record.content?.id).filter(Boolean);
    const updated = [];

    for (const pageId of candidateWorkspaceIds) {
      const record = await readRecord(PAGE_STORE, pageId);
      const content = contentOf(record);
      const connections = Array.isArray(content.connections) ? content.connections : [];
      const nextConnections = connections.filter((connection) => connection.id !== connectionId);
      if (nextConnections.length === connections.length) continue;
      const usedBoxIds = new Set(nextConnections.flatMap((connection) => [connection.fromBoxId, connection.toBoxId]).filter(Boolean));
      const boxes = Array.isArray(content.boxes)
        ? content.boxes.filter((box) => !box.hidden || box.type !== "boxTracker" || usedBoxIds.has(box.id))
        : content.boxes;

      await write(PAGE_STORE, {
        ...(record || {}),
        id: pageId,
        content: {
          ...content,
          id: content.id || pageId,
          updatedAt: new Date().toISOString(),
          boxes,
          connections: nextConnections,
        },
      });
      updated.push(pageId);
    }

    return updated;
  };

  const contentOf = (record) =>
    record?.content && typeof record.content === "object" ? record.content : record || {};

  const normalizeWidget = (record, index) => {
    const content = contentOf(record);
    const type = normalizeText(content.type || content.kind || content.boxType, "boxLens");
    const id = normalizeText(record?.id || content.id, `widget_${index}`);
    return {
      id,
      sourceId: normalizeText(content.sourceId || id, id),
      name: normalizeText(content.name || content.title, type === "boxTracker" ? "Box Tracker" : "Box Lens"),
      type,
      endpoint: normalizeText(content.endpoint || content.runtime?.endpoint || content.source || content.runtime?.source),
      method: normalizeText(content.method || content.runtime?.method, type === "boxTracker" ? "GET" : "EVENT"),
      outputChannel: normalizeText(content.outputChannel || content.runtime?.output || content.channel, "default"),
      trackerType: normalizeText(content.trackerType || content.runtime?.source || content.source),
    };
  };

  const connectionTypeFrom = (connection, from, to) => {
    if (from?.type === "boxTracker" && to?.type === "boxLens") return "Tracker -> Source";
    if (from?.endpoint?.startsWith("wss://")) return "WebSocket";
    if (from?.endpoint?.includes("rss") || from?.trackerType === "rss") return "RSS Feed";
    if (from?.endpoint?.startsWith("http")) return "API Endpoint";
    if (connection.type) return connection.type;
    return "Widget -> Widget";
  };

  const normalizeConnection = (record, index = 0) => {
    const content = contentOf(record);
    const now = new Date().toISOString();
    const id = normalizeText(record?.id || content.id, `conn_${Date.now()}_${index}`);

    return {
      id,
      name: normalizeText(content.name || content.label, "Collegamento"),
      type: normalizeText(content.type, "Widget -> Widget"),
      from: normalizeText(content.from || content.sourceName || content.fromName || content.fromBoxId, "Source"),
      fromKind: normalizeText(content.fromKind || content.sourceType || "box"),
      to: normalizeText(content.to || content.targetName || content.toName || content.toBoxId, "Target"),
      targetMeta: normalizeText(content.targetMeta || content.endpoint || content.toBoxId || "local"),
      status: normalizeText(content.status, "active"),
      lastTest: normalizeText(content.lastTest, "Mai"),
      result: normalizeText(content.result, "Non testato"),
      method: normalizeText(content.method, "EVENT"),
      frequency: normalizeText(content.frequency || content.channel, "On event"),
      timeout: normalizeText(content.timeout, "10 secondi"),
      retries: Number(content.retries) || 0,
      createdAt: normalizeText(content.createdAt, now),
      updatedAt: normalizeText(content.updatedAt, now),
      endpoint: normalizeText(content.endpoint || content.targetMeta || "local://connection"),
      workspaceId: normalizeText(content.workspaceId),
      workspaceName: normalizeText(content.workspaceName),
      fromBoxId: normalizeText(content.fromBoxId),
      toBoxId: normalizeText(content.toBoxId),
      channel: normalizeText(content.channel, "default"),
      mapping: content.mapping && typeof content.mapping === "object" ? { ...content.mapping } : {},
      raw: record,
    };
  };

  const buildWorkspaceConnections = async () => {
    const [pages, widgetRecords] = await Promise.all([readAll(PAGE_STORE), readAll(WIDGET_STORE)]);
    const widgets = widgetRecords.map(normalizeWidget);
    const widgetsById = new Map();
    widgets.forEach((widget) => {
      widgetsById.set(widget.id, widget);
      widgetsById.set(widget.sourceId, widget);
    });

    return pages.flatMap((record, pageIndex) => {
      const page = contentOf(record);
      const boxes = Array.isArray(page.boxes) ? page.boxes : [];
      const boxesById = new Map(boxes.map((box) => [box.id, box]));
      const workspaceName = normalizeText(page.name || page.title, `Workspace ${pageIndex + 1}`);

      return (Array.isArray(page.connections) ? page.connections : []).map((connection, index) => {
        const fromBox = boxesById.get(connection.fromBoxId) || {};
        const toBox = boxesById.get(connection.toBoxId) || {};
        const fromAsset = widgetsById.get(fromBox.assetId) || widgetsById.get(fromBox.sourceId) || null;
        const toAsset = widgetsById.get(toBox.assetId) || widgetsById.get(toBox.sourceId) || null;
        const now = new Date().toISOString();
        const id = normalizeText(connection.id, `connection_${record.id || page.id}_${index}`);

        return normalizeConnection({
          id,
          name: `${fromAsset?.name || fromBox.name || connection.fromBoxId} -> ${toAsset?.name || toBox.name || connection.toBoxId}`,
          type: connectionTypeFrom(connection, fromAsset || fromBox, toAsset || toBox),
          from: fromAsset?.name || fromBox.name || connection.fromBoxId,
          fromKind: fromAsset?.type || fromBox.type || "box",
          to: toAsset?.name || toBox.name || connection.toBoxId,
          targetMeta: toAsset?.endpoint || toBox.sourceId || connection.toBoxId,
          status: "active",
          lastTest: "Mai",
          result: "Importato da workspace",
          method: fromAsset?.method || "EVENT",
          frequency: connection.channel || "On event",
          timeout: "10 secondi",
          retries: 0,
          createdAt: page.createdAt || page.updatedAt || now,
          updatedAt: page.updatedAt || now,
          endpoint: fromAsset?.endpoint || `workspace://${record.id || page.id}/${id}`,
          workspaceId: record.id || page.id,
          workspaceName,
          fromBoxId: connection.fromBoxId,
          toBoxId: connection.toBoxId,
          channel: connection.channel || "default",
          mapping: connection.mapping || {},
        }, index);
      });
    });
  };

  const list = async () => {
    const records = (await readAll(CONNECTION_STORE)).map(normalizeConnection);
    if (records.length) return records;

    const imported = await buildWorkspaceConnections();
    await Promise.all(imported.map((connection) => write(CONNECTION_STORE, connection)));
    return imported;
  };

  const upsert = async (connection) => write(CONNECTION_STORE, normalizeConnection(connection));

  const upsertAndSyncWorkspace = async (connection) => {
    const record = await upsert(connection);
    await upsertWorkspaceContentConnection(record);
    return record;
  };

  const duplicate = async (connection) => {
    const now = new Date().toISOString();
    return upsert({
      ...connection,
      id: `conn_${Date.now()}`,
      name: `${connection.name} Copy`,
      createdAt: now,
      updatedAt: now,
      lastTest: "Mai",
      result: "Duplicato localmente",
    });
  };

  const syncWorkspaceConnections = async ({ workspace, boxes = [], connections = [] }) => {
    const widgetsByBoxId = new Map(boxes.map((box) => [box.id, box]));
    const workspaceId = workspace?.id || "";
    const workspaceName = normalizeText(workspace?.name || workspace?.title, "Workspace");
    const now = new Date().toISOString();

    const existing = await readAll(CONNECTION_STORE);
    const nextIds = new Set(connections.map((connection, index) => connection.id || `connection_${workspaceId}_${index}`));
    const staleIds = existing
      .map(normalizeConnection)
      .filter((connection) => connection.workspaceId === workspaceId && !nextIds.has(connection.id))
      .map((connection) => connection.id);

    await removeMany(staleIds);

    return Promise.all(connections.map((connection, index) => {
      const fromBox = widgetsByBoxId.get(connection.fromBoxId) || {};
      const toBox = widgetsByBoxId.get(connection.toBoxId) || {};
      return upsert({
        id: connection.id || `connection_${workspaceId}_${index}`,
        name: `${fromBox.name || connection.fromBoxId} -> ${toBox.name || connection.toBoxId}`,
        type: connectionTypeFrom(connection, fromBox, toBox),
        from: fromBox.name || connection.fromBoxId,
        fromKind: fromBox.type || "box",
        to: toBox.name || connection.toBoxId,
        targetMeta: toBox.sourceId || toBox.assetId || connection.toBoxId,
        status: "active",
        lastTest: "Mai",
        result: "Sincronizzato da workspace",
        method: "EVENT",
        frequency: connection.channel || "On event",
        timeout: "10 secondi",
        retries: 0,
        createdAt: now,
        updatedAt: now,
        endpoint: `workspace://${workspaceId}/${connection.id}`,
        workspaceId,
        workspaceName,
        fromBoxId: connection.fromBoxId,
        toBoxId: connection.toBoxId,
        channel: connection.channel || "default",
        mapping: connection.mapping || {},
      });
    }));
  };

  return {
    CONNECTION_STORE,
    duplicate,
    list,
    normalizeConnection,
    remove,
    removeMany,
    removeWorkspaceContentConnection,
    upsertLibraryTrackerWorkspaceLink,
    upsertAndSyncWorkspace,
    upsertWorkspaceContentConnection,
    syncWorkspaceConnections,
    upsert,
  };
})();
