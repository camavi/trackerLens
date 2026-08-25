window.TrackerLensChannelRegistry = (() => {
  const config = () => (typeof tlConfig !== "undefined" ? tlConfig : window.tlConfig) || {};
  const tableName = (key, fallback) => config()?.TABLES?.[key] || fallback;

  const STORES = {
    channels: tableName("TL_CHANNELS", "tl_channels"),
    widgets: tableName("TL_WIDGETS", "tl_widgets"),
    pages: tableName("TL_PAGES", "tl_pages"),
    connections: tableName("TL_CONNECTIONS", "tl_connections"),
    runtimeNodes: tableName("TL_RUNTIME_NODES", "tl_runtime_nodes"),
    runtimeDependencies: tableName("TL_RUNTIME_DEPENDENCIES", "tl_runtime_dependencies"),
  };
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
  const ensureStores = async () => {
    const persistence = desktopPersistence();
    if (!await usesDesktopSqlite() || !persistence?.readDevelopmentRecords || !persistence.writeDevelopmentRecords || !persistence.deleteDevelopmentRecords) {
      throw new Error("Channel Registry richiede SQLite nell'app desktop.");
    }
    return persistence;
  };

  const normalizeText = (value, fallback = "") => {
    if (value === null || value === undefined) return fallback;
    return String(value).trim() || fallback;
  };

  const contentOf = (record) =>
    record?.content && typeof record.content === "object" ? record.content : record || {};

  const safeChannelName = (value) =>
    normalizeText(value, "default")
      .toLowerCase()
      .replace(/\s+/g, ".")
      .replace(/[^a-z0-9_.-]/g, "")
      .replace(/\.+/g, ".")
      .replace(/^\./, "")
      .replace(/\.$/, "") || "default";

  const channelId = ({ workspaceId = "global", name }) =>
    `channel_${String(workspaceId || "global").replace(/[^A-Za-z0-9_-]/g, "_")}_${safeChannelName(name).replace(/[^A-Za-z0-9_-]/g, "_")}`;

  const readAll = async (storeName) => {
    const persistence = desktopPersistence();
    if (!await usesDesktopSqlite() || !persistence?.readDevelopmentRecords) throw new Error("Channel Registry richiede SQLite nell'app desktop.");
    return persistence.readDevelopmentRecords({ storeName });
  };

  const putRecords = async (storeName, records = []) => {
    if (!records.length) return [];
    const persistence = desktopPersistence();
    if (!await usesDesktopSqlite() || !persistence?.writeDevelopmentRecords) throw new Error("Channel Registry richiede SQLite nell'app desktop.");
    await persistence.writeDevelopmentRecords({ storeName, records });
    return records;
  };

  const deleteRecords = async (storeName, ids = []) => {
    const uniqueIds = [...new Set(ids.filter(Boolean).map(String))];
    if (!uniqueIds.length) return [];
    const persistence = desktopPersistence();
    if (!await usesDesktopSqlite() || !persistence?.deleteDevelopmentRecords) throw new Error("Channel Registry richiede SQLite nell'app desktop.");
    await persistence.deleteDevelopmentRecords({ storeName, ids: uniqueIds });
    return uniqueIds;
  };

  const trackerOutputChannel = (tracker) =>
    safeChannelName(tracker.outputChannel || tracker.runtime?.output || tracker.channel || tracker.channels?.[0] || "default");

  const nodeChannelSet = (node = {}) =>
    new Set([
      ...(Array.isArray(node.channels) ? node.channels : []),
      ...(Array.isArray(node.inputs) ? node.inputs : []),
      ...(Array.isArray(node.outputs) ? node.outputs : []),
    ].filter(Boolean).map(safeChannelName));

  const connectionChannel = (connection = {}) =>
    safeChannelName(connection.channel || connection.frequency || connection.mapping?.channel || "default");

  const replaceChannelValue = (value, from, to) =>
    safeChannelName(value) === from ? to : value;

  const replaceChannelList = (values = [], from, to = "") => {
    if (!Array.isArray(values)) return [];
    const next = values
      .map((value) => replaceChannelValue(value, from, to))
      .filter((value) => to || safeChannelName(value) !== from);
    return [...new Set(next.filter(Boolean).map(safeChannelName))];
  };

  const renameConnectionChannel = (connection = {}, from, to) => ({
    ...connection,
    channel: replaceChannelValue(connection.channel || "default", from, to),
    frequency: safeChannelName(connection.frequency || "") === from ? to : connection.frequency,
    mapping: connection.mapping && typeof connection.mapping === "object"
      ? {
        ...connection.mapping,
        channel: safeChannelName(connection.mapping.channel || "") === from ? to : connection.mapping.channel,
      }
      : connection.mapping,
    updatedAt: new Date().toISOString(),
  });

  const renameNodeChannel = (node = {}, from, to = "") => ({
    ...node,
    channels: replaceChannelList(node.channels, from, to),
    inputs: replaceChannelList(node.inputs, from, to),
    outputs: replaceChannelList(node.outputs, from, to),
    updatedAt: new Date().toISOString(),
  });

  const renamePageChannel = (pageRecord = {}, from, to = "") => {
    const content = contentOf(pageRecord);
    const boxes = Array.isArray(content.boxes)
      ? content.boxes.map((box) => renameNodeChannel(box, from, to))
      : content.boxes;
    const connections = Array.isArray(content.connections)
      ? content.connections
        .filter((connection) => to || connectionChannel(connection) !== from)
        .map((connection) => renameConnectionChannel(connection, from, to))
      : content.connections;
    const nextContent = {
      ...content,
      boxes,
      connections,
      updatedAt: new Date().toISOString(),
    };
    return pageRecord?.content
      ? { ...pageRecord, content: nextContent, updatedAt: nextContent.updatedAt }
      : nextContent;
  };

  const workspaceSnapshot = async ({ workspaceId = "global" } = {}) => {
    const [channels, nodes, dependencies, connections, pages] = await Promise.all([
      readAll(STORES.channels),
      readAll(STORES.runtimeNodes),
      readAll(STORES.runtimeDependencies),
      readAll(STORES.connections),
      readAll(STORES.pages),
    ]);
    const workspaceMatches = (record = {}) => workspaceId === "all" || (record.workspaceId || "global") === workspaceId;
    const pageMatches = (page = {}) => workspaceId === "all" || page.id === workspaceId || page.workspaceId === workspaceId;
    return {
      workspaceId,
      createdAt: new Date().toISOString(),
      channels: channels.filter(workspaceMatches),
      nodes: nodes.filter(workspaceMatches),
      dependencies: dependencies.filter(workspaceMatches),
      connections: connections.filter(workspaceMatches),
      pages: pages.filter(pageMatches),
    };
  };

  const restoreWorkspaceSnapshot = async (snapshot = {}) => {
    const workspaceId = snapshot.workspaceId || "global";
    const [channels, nodes, dependencies, connections, pages] = await Promise.all([
      readAll(STORES.channels),
      readAll(STORES.runtimeNodes),
      readAll(STORES.runtimeDependencies),
      readAll(STORES.connections),
      readAll(STORES.pages),
    ]);
    const workspaceMatches = (record = {}) => workspaceId === "all" || (record.workspaceId || "global") === workspaceId;
    const pageMatches = (page = {}) => workspaceId === "all" || page.id === workspaceId || page.workspaceId === workspaceId;

    await Promise.all([
      deleteRecords(STORES.channels, channels.filter(workspaceMatches).map((record) => record.id)),
      deleteRecords(STORES.runtimeNodes, nodes.filter(workspaceMatches).map((record) => record.id)),
      deleteRecords(STORES.runtimeDependencies, dependencies.filter(workspaceMatches).map((record) => record.id)),
      deleteRecords(STORES.connections, connections.filter(workspaceMatches).map((record) => record.id)),
      deleteRecords(STORES.pages, pages.filter(pageMatches).map((record) => record.id)),
    ]);
    await Promise.all([
      putRecords(STORES.channels, snapshot.channels || []),
      putRecords(STORES.runtimeNodes, snapshot.nodes || []),
      putRecords(STORES.runtimeDependencies, snapshot.dependencies || []),
      putRecords(STORES.connections, snapshot.connections || []),
      putRecords(STORES.pages, snapshot.pages || []),
    ]);
    return snapshot;
  };

  const inferChannelType = (tracker) => {
    const sample = tracker.sampleOutput;
    if (sample && typeof sample === "object") return "object";
    if (typeof sample === "number") return "number";
    if (typeof sample === "boolean") return "boolean";
    return "unknown";
  };

  const upsertChannelForTracker = async ({ tracker, workspaceId = "global", subscribers = [] }) => {
    if (!tracker?.id) throw new Error("Tracker mancante per registrazione channel");

    const now = new Date().toISOString();
    const name = trackerOutputChannel(tracker);
    const id = channelId({ workspaceId, name });
    const uniqueSubscribers = [...new Set(subscribers.filter(Boolean).map(String))];
    const record = {
      id,
      workspaceId,
      name,
      label: tracker.name || name,
      type: inferChannelType(tracker),
      producerNodeId: tracker.id,
      producerBoxId: tracker.id,
      producerOutput: tracker.outputChannel || tracker.runtime?.output || name,
      sourceType: "boxTracker",
      status: tracker.active === false ? "inactive" : "active",
      subscribers: uniqueSubscribers,
      lastValue: null,
      lastEmittedAt: null,
      createdAt: now,
      updatedAt: now,
      metadata: {
        trackerType: tracker.trackerType || tracker.source || tracker.runtime?.source || "",
        endpoint: tracker.endpoint || tracker.runtime?.endpoint || "",
      },
    };

    await putRecords(STORES.channels, [record]);
    return record;
  };

  const normalizeWidget = (record) => {
    const content = contentOf(record);
    return {
      ...content,
      id: record?.id || content.id,
      sourceId: content.sourceId || record?.id || content.id,
    };
  };

  const syncWorkspaceChannels = async ({ workspace = {}, boxes = [], connections = [] }) => {
    const widgetRecords = await readAll(STORES.widgets);
    const widgets = widgetRecords.map(normalizeWidget);
    const widgetsById = new Map();
    widgets.forEach((widget) => {
      [widget.id, widget.sourceId, widget.assetId].filter(Boolean).forEach((id) => widgetsById.set(String(id), widget));
    });

    const workspaceId = workspace.id || "global";
    const boxById = new Map(boxes.map((box) => [box.id, box]));
    const trackers = boxes.filter((box) => box.type === "boxTracker");

    const channelRecords = await Promise.all(trackers.map((box) => {
      const source = widgetsById.get(String(box.assetId || box.sourceId || box.id)) || {};
      const tracker = { ...source, ...box, id: box.id, outputChannel: box.channels?.[0] || source.outputChannel || source.runtime?.output };
      const subscribers = connections
        .filter((connection) => connection.fromBoxId === box.id)
        .map((connection) => connection.toBoxId)
        .filter((targetId) => boxById.has(targetId));
      return upsertChannelForTracker({ tracker, workspaceId, subscribers });
    }));

    const dependencyRecords = connections.map((connection) => {
      const from = boxById.get(connection.fromBoxId) || {};
      const to = boxById.get(connection.toBoxId) || {};
      const channel = safeChannelName(connection.channel || from.channels?.[0] || "default");
      return {
        id: `dep_${workspaceId}_${connection.id}`.replace(/[^A-Za-z0-9_-]/g, "_"),
        workspaceId,
        sourceNodeId: connection.fromBoxId,
        targetNodeId: connection.toBoxId,
        sourceType: from.type || "box",
        targetType: to.type || "box",
        channel,
        connectionId: connection.id,
        status: "active",
        createdAt: connection.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    });

    const [existingChannels, existingDependencies] = await Promise.all([
      readAll(STORES.channels),
      readAll(STORES.runtimeDependencies),
    ]);
    const channelIds = new Set(channelRecords.map((channel) => channel.id));
    const dependencyIds = new Set(dependencyRecords.map((dependency) => dependency.id));
    const staleChannelIds = existingChannels
      .filter((channel) => channel.workspaceId === workspaceId && !channelIds.has(channel.id))
      .map((channel) => channel.id);
    const staleDependencyIds = existingDependencies
      .filter((dependency) => dependency.workspaceId === workspaceId && !dependencyIds.has(dependency.id))
      .map((dependency) => dependency.id);

    await Promise.all([
      deleteRecords(STORES.channels, staleChannelIds),
      deleteRecords(STORES.runtimeDependencies, staleDependencyIds),
      putRecords(STORES.runtimeDependencies, dependencyRecords),
    ]);
    return channelRecords;
  };

  const upsertChannelsForRuntimeNode = async ({ node = {} } = {}) => {
    if (!node?.id) throw new Error("Runtime node mancante per registrazione channel");
    const workspaceId = node.workspaceId || "global";
    const now = new Date().toISOString();
    const inputs = [...new Set((node.inputs || []).filter(Boolean).map(safeChannelName))];
    const outputs = [...new Set((node.outputs || []).filter(Boolean).map(safeChannelName))];
    const activeNames = new Set([...inputs, ...outputs]);
    const existing = await readAll(STORES.channels);
    const existingByName = new Map(existing
      .filter((channel) => channel.workspaceId === workspaceId)
      .map((channel) => [safeChannelName(channel.name), channel]));
    const nextRecords = [];

    outputs.forEach((name) => {
      const previous = existingByName.get(name) || {};
      nextRecords.push({
        ...previous,
        id: previous.id || channelId({ workspaceId, name }),
        workspaceId,
        name,
        label: previous.label || name,
        type: previous.type || "unknown",
        producerNodeId: node.id,
        producerBoxId: node.assetId || node.sourceRef || node.id,
        producerOutput: name,
        sourceType: node.type || "runtime",
        status: node.status || "active",
        subscribers: Array.isArray(previous.subscribers) ? previous.subscribers : [],
        createdAt: previous.createdAt || now,
        updatedAt: now,
        metadata: {
          ...(previous.metadata || {}),
          runtimeNode: true,
          nodeType: node.type || "",
        },
      });
    });

    inputs.forEach((name) => {
      const previous = existingByName.get(name) || {};
      const subscribers = new Set(Array.isArray(previous.subscribers) ? previous.subscribers : []);
      subscribers.add(node.id);
      nextRecords.push({
        ...previous,
        id: previous.id || channelId({ workspaceId, name }),
        workspaceId,
        name,
        label: previous.label || name,
        type: previous.type || "unknown",
        producerNodeId: previous.producerNodeId || "",
        producerBoxId: previous.producerBoxId || "",
        producerOutput: previous.producerOutput || name,
        sourceType: previous.sourceType || "runtime",
        status: previous.status || "active",
        subscribers: [...subscribers],
        createdAt: previous.createdAt || now,
        updatedAt: now,
        metadata: {
          ...(previous.metadata || {}),
          runtimeSubscriber: true,
        },
      });
    });

    const cleanupRecords = existing
      .filter((channel) => channel.workspaceId === workspaceId)
      .filter((channel) => !activeNames.has(safeChannelName(channel.name)))
      .filter((channel) =>
        channel.producerNodeId === node.id ||
        (Array.isArray(channel.subscribers) && channel.subscribers.includes(node.id)))
      .map((channel) => ({
        ...channel,
        producerNodeId: channel.producerNodeId === node.id ? "" : channel.producerNodeId,
        producerBoxId: channel.producerNodeId === node.id ? "" : channel.producerBoxId,
        subscribers: Array.isArray(channel.subscribers)
          ? channel.subscribers.filter((subscriber) => subscriber !== node.id)
          : [],
        updatedAt: now,
      }));

    const merged = new Map();
    [...cleanupRecords, ...nextRecords].forEach((record) => merged.set(record.id, record));
    await putRecords(STORES.channels, [...merged.values()]);
    return [...merged.values()];
  };

  const cleanupNodeReferences = async ({ nodeId = "", workspaceId = "" } = {}) => {
    if (!nodeId) return [];
    const now = new Date().toISOString();
    const existing = await readAll(STORES.channels);
    const updates = existing
      .filter((channel) => !workspaceId || channel.workspaceId === workspaceId)
      .filter((channel) =>
        channel.producerNodeId === nodeId ||
        channel.producerBoxId === nodeId ||
        (Array.isArray(channel.subscribers) && channel.subscribers.includes(nodeId)))
      .map((channel) => ({
        ...channel,
        producerNodeId: channel.producerNodeId === nodeId ? "" : channel.producerNodeId,
        producerBoxId: channel.producerBoxId === nodeId ? "" : channel.producerBoxId,
        subscribers: Array.isArray(channel.subscribers)
          ? channel.subscribers.filter((subscriber) => subscriber !== nodeId)
          : [],
        updatedAt: now,
      }));
    await putRecords(STORES.channels, updates);
    return updates;
  };

  const restoreChannelRecords = async (records = []) => {
    const channelRecords = Array.isArray(records) ? records.filter((record) => record?.id) : [];
    await putRecords(STORES.channels, channelRecords);
    return channelRecords;
  };

  const recordEmission = async ({ workspaceId = "global", channel = "default", sourceNodeId = "", payload = {}, emittedAt = new Date().toISOString() } = {}) => {
    const name = safeChannelName(channel);
    const id = channelId({ workspaceId, name });
    const existing = (await readAll(STORES.channels)).find((record) => record.id === id);
    const record = {
      ...(existing || {
        id,
        workspaceId,
        name,
        label: name,
        type: payload && typeof payload === "object" ? "object" : typeof payload,
        producerNodeId: sourceNodeId,
        producerBoxId: sourceNodeId,
        producerOutput: name,
        sourceType: sourceNodeId ? "boxTracker" : "runtime",
        status: "active",
        subscribers: [],
        createdAt: emittedAt,
        metadata: {},
      }),
      workspaceId,
      name,
      producerNodeId: existing?.producerNodeId || sourceNodeId,
      producerBoxId: existing?.producerBoxId || sourceNodeId,
      lastValue: payload,
      lastEmittedAt: emittedAt,
      updatedAt: emittedAt,
    };
    await putRecords(STORES.channels, [record]);
    return record;
  };

  const inspectChannel = async ({ workspaceId = "global", channel = "default" } = {}) => {
    const name = safeChannelName(channel);
    const [channels, nodes, dependencies, connections, pages] = await Promise.all([
      readAll(STORES.channels),
      readAll(STORES.runtimeNodes),
      readAll(STORES.runtimeDependencies),
      readAll(STORES.connections),
      readAll(STORES.pages),
    ]);

    const workspaceMatches = (record = {}) => !workspaceId || workspaceId === "all" || (record.workspaceId || "global") === workspaceId;
    const record = channels.find((item) => workspaceMatches(item) && safeChannelName(item.name || item.id) === name) || null;
    const nodeMatches = (node = {}) => workspaceMatches(node) && (
      nodeChannelSet(node).has(name) ||
      node.id === record?.producerNodeId ||
      node.id === record?.producerBoxId ||
      (Array.isArray(record?.subscribers) && record.subscribers.includes(node.id))
    );
    const matchedNodes = nodes.filter(nodeMatches);
    const producers = matchedNodes.filter((node) =>
      node.id === record?.producerNodeId ||
      node.id === record?.producerBoxId ||
      (Array.isArray(node.outputs) && node.outputs.map(safeChannelName).includes(name)));
    const subscribers = matchedNodes.filter((node) =>
      (Array.isArray(record?.subscribers) && record.subscribers.includes(node.id)) ||
      (Array.isArray(node.inputs) && node.inputs.map(safeChannelName).includes(name)));
    const channelDependencies = dependencies.filter((dependency) =>
      workspaceMatches(dependency) && safeChannelName(dependency.channel || "default") === name);
    const channelConnections = connections.filter((connection) =>
      workspaceMatches(connection) && connectionChannel(connection) === name);
    const workspacePages = pages.filter((page) => !workspaceId || workspaceId === "all" || page.id === workspaceId || page.workspaceId === workspaceId);
    const pageReferences = workspacePages.filter((page) => {
      const content = contentOf(page);
      const boxes = Array.isArray(content.boxes) ? content.boxes : [];
      const links = Array.isArray(content.connections) ? content.connections : [];
      return boxes.some((box) => nodeChannelSet(box).has(name)) ||
        links.some((connection) => connectionChannel(connection) === name);
    });

    return {
      workspaceId,
      channel: name,
      record,
      producers,
      subscribers,
      nodes: matchedNodes,
      dependencies: channelDependencies,
      connections: channelConnections,
      pageReferences,
      lastValue: record?.lastValue ?? null,
      lastEmittedAt: record?.lastEmittedAt || "",
      hasDependencies: Boolean(
        producers.length ||
        subscribers.length ||
        channelDependencies.length ||
        channelConnections.length ||
        pageReferences.length
      ),
      counts: {
        producers: producers.length,
        subscribers: subscribers.length,
        nodes: matchedNodes.length,
        dependencies: channelDependencies.length,
        connections: channelConnections.length,
        pageReferences: pageReferences.length,
      },
    };
  };

  const canRenameChannel = async ({ workspaceId = "global", from = "", to = "" } = {}) => {
    const hasSource = Boolean(normalizeText(from, ""));
    const hasTarget = Boolean(normalizeText(to, ""));
    const source = safeChannelName(from);
    const target = safeChannelName(to);
    const channels = await readAll(STORES.channels);
    const report = await inspectChannel({ workspaceId, channel: source });
    const conflict = channels.find((channel) =>
      (workspaceId === "all" || (channel.workspaceId || "global") === workspaceId) &&
      safeChannelName(channel.name || channel.id) === target &&
      safeChannelName(channel.name || channel.id) !== source);
    const errors = [];
    if (!hasSource) errors.push("source channel mancante");
    if (!hasTarget) errors.push("target channel mancante");
    if (source === target) errors.push("target uguale al source");
    if (conflict) errors.push("channel target gia esistente nel workspace");
    if (report.hasDependencies) errors.push("channel usato da producer, subscriber, connection o workspace");
    return {
      ok: errors.length === 0,
      from: source,
      to: target,
      conflict: conflict || null,
      report,
      errors,
    };
  };

  const canDeleteChannel = async ({ workspaceId = "global", channel = "" } = {}) => {
    const report = await inspectChannel({ workspaceId, channel });
    const errors = [];
    if (!report.record) errors.push("channel non registrato");
    if (report.hasDependencies) errors.push("channel usato da producer, subscriber, connection o workspace");
    return {
      ok: errors.length === 0,
      channel: report.channel,
      report,
      errors,
    };
  };

  const renameChannel = async ({ workspaceId = "global", from = "", to = "", force = false } = {}) => {
    const validation = await canRenameChannel({ workspaceId, from, to });
    if (validation.conflict) {
      throw Object.assign(new Error("Channel target gia esistente nel workspace"), { validation });
    }
    if ((!validation.from || !validation.to || validation.from === validation.to) || (!force && validation.errors.length)) {
      throw Object.assign(new Error(validation.errors[0] || "Rename channel non valido"), { validation });
    }

    const now = new Date().toISOString();
    const snapshot = await workspaceSnapshot({ workspaceId });
    const source = validation.from;
    const target = validation.to;
    const [channels, nodes, dependencies, connections, pages] = await Promise.all([
      readAll(STORES.channels),
      readAll(STORES.runtimeNodes),
      readAll(STORES.runtimeDependencies),
      readAll(STORES.connections),
      readAll(STORES.pages),
    ]);
    const workspaceMatches = (record = {}) => workspaceId === "all" || (record.workspaceId || "global") === workspaceId;

    const channelUpdates = channels
      .filter((channel) => workspaceMatches(channel) && safeChannelName(channel.name || channel.id) === source)
      .map((channel) => ({
        ...channel,
        id: channelId({ workspaceId: channel.workspaceId || workspaceId || "global", name: target }),
        name: target,
        label: channel.label === channel.name || safeChannelName(channel.label || "") === source ? target : channel.label,
        producerOutput: safeChannelName(channel.producerOutput || "") === source ? target : channel.producerOutput,
        updatedAt: now,
      }));
    const channelDeleteIds = channels
      .filter((channel) => workspaceMatches(channel) && safeChannelName(channel.name || channel.id) === source)
      .map((channel) => channel.id)
      .filter((id) => !channelUpdates.some((channel) => channel.id === id));
    const nodeUpdates = nodes
      .filter((node) => workspaceMatches(node) && nodeChannelSet(node).has(source))
      .map((node) => renameNodeChannel(node, source, target));
    const dependencyUpdates = dependencies
      .filter((dependency) => workspaceMatches(dependency) && safeChannelName(dependency.channel || "default") === source)
      .map((dependency) => ({ ...dependency, channel: target, updatedAt: now }));
    const connectionUpdates = connections
      .filter((connection) => workspaceMatches(connection) && connectionChannel(connection) === source)
      .map((connection) => renameConnectionChannel(connection, source, target));
    const pageUpdates = pages
      .filter((page) => workspaceId === "all" || page.id === workspaceId || page.workspaceId === workspaceId)
      .filter((page) => {
        const content = contentOf(page);
        const boxes = Array.isArray(content.boxes) ? content.boxes : [];
        const links = Array.isArray(content.connections) ? content.connections : [];
        return boxes.some((box) => nodeChannelSet(box).has(source)) || links.some((connection) => connectionChannel(connection) === source);
      })
      .map((page) => renamePageChannel(page, source, target));

    await Promise.all([
      deleteRecords(STORES.channels, channelDeleteIds),
      putRecords(STORES.channels, channelUpdates),
      putRecords(STORES.runtimeNodes, nodeUpdates),
      putRecords(STORES.runtimeDependencies, dependencyUpdates),
      putRecords(STORES.connections, connectionUpdates),
      putRecords(STORES.pages, pageUpdates),
    ]);

    return {
      from: source,
      to: target,
      force: Boolean(force),
      snapshot,
      updated: {
        channels: channelUpdates.length,
        nodes: nodeUpdates.length,
        dependencies: dependencyUpdates.length,
        connections: connectionUpdates.length,
        pages: pageUpdates.length,
      },
    };
  };

  const deleteChannel = async ({ workspaceId = "global", channel = "", force = false } = {}) => {
    const validation = await canDeleteChannel({ workspaceId, channel });
    if (!force && validation.errors.length) {
      throw Object.assign(new Error(validation.errors[0] || "Delete channel non valido"), { validation });
    }

    const name = validation.channel;
    const snapshot = await workspaceSnapshot({ workspaceId });
    const [channels, nodes, dependencies, connections, pages] = await Promise.all([
      readAll(STORES.channels),
      readAll(STORES.runtimeNodes),
      readAll(STORES.runtimeDependencies),
      readAll(STORES.connections),
      readAll(STORES.pages),
    ]);
    const workspaceMatches = (record = {}) => workspaceId === "all" || (record.workspaceId || "global") === workspaceId;
    const channelDeleteIds = channels
      .filter((record) => workspaceMatches(record) && safeChannelName(record.name || record.id) === name)
      .map((record) => record.id);
    const dependencyDeleteIds = dependencies
      .filter((dependency) => workspaceMatches(dependency) && safeChannelName(dependency.channel || "default") === name)
      .map((dependency) => dependency.id);
    const connectionDeleteIds = connections
      .filter((connection) => workspaceMatches(connection) && connectionChannel(connection) === name)
      .map((connection) => connection.id);
    const nodeUpdates = nodes
      .filter((node) => workspaceMatches(node) && nodeChannelSet(node).has(name))
      .map((node) => renameNodeChannel(node, name, ""));
    const pageUpdates = pages
      .filter((page) => workspaceId === "all" || page.id === workspaceId || page.workspaceId === workspaceId)
      .filter((page) => {
        const content = contentOf(page);
        const boxes = Array.isArray(content.boxes) ? content.boxes : [];
        const links = Array.isArray(content.connections) ? content.connections : [];
        return boxes.some((box) => nodeChannelSet(box).has(name)) || links.some((connection) => connectionChannel(connection) === name);
      })
      .map((page) => renamePageChannel(page, name, ""));

    await Promise.all([
      deleteRecords(STORES.channels, channelDeleteIds),
      deleteRecords(STORES.runtimeDependencies, dependencyDeleteIds),
      deleteRecords(STORES.connections, connectionDeleteIds),
      putRecords(STORES.runtimeNodes, nodeUpdates),
      putRecords(STORES.pages, pageUpdates),
    ]);

    return {
      channel: name,
      force: Boolean(force),
      snapshot,
      deleted: {
        channels: channelDeleteIds.length,
        dependencies: dependencyDeleteIds.length,
        connections: connectionDeleteIds.length,
        nodesUpdated: nodeUpdates.length,
        pagesUpdated: pageUpdates.length,
      },
    };
  };

  const list = async () => readAll(STORES.channels);

  return {
    STORES,
    canDeleteChannel,
    canRenameChannel,
    deleteChannel,
    deleteRecords,
    cleanupNodeReferences,
    ensureStores,
    inspectChannel,
    list,
    renameChannel,
    restoreChannelSnapshot: restoreWorkspaceSnapshot,
    safeChannelName,
    recordEmission,
    restoreChannelRecords,
    syncWorkspaceChannels,
    trackerOutputChannel,
    upsertChannelsForRuntimeNode,
    upsertChannelForTracker,
  };
})();
