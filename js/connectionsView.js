const icon = (name, size = "md") => _.Icon({ name, size });
const btn = (props, ...children) => _.Btn({ type: "button", ...props }, ...children);
const dot = (props = {}) => _.span({ ...props, class: `tl-link-dot${props.class ? ` ${props.class}` : ""}` });
const runtimeParams = new URLSearchParams(window.location.search);

if (runtimeParams.get("view") === "graph") {
  runtimeParams.delete("view");
  window.location.replace(`flowMap.html${runtimeParams.toString() ? `?${runtimeParams.toString()}` : ""}`);
}

const connectionTypes = [
  { name: "API Endpoint", color: "gold", icon: "api", count: 128 },
  { name: "Data Source", color: "green", icon: "hub", count: 96 },
  { name: "Widget -> Widget", color: "blue", icon: "conversion_path", count: 72 },
  { name: "Widget -> API", color: "gold", icon: "sync_alt", count: 184 },
  { name: "Tracker -> Source", color: "pink", icon: "account_tree", count: 64 },
  { name: "Event Listener", color: "cyan", icon: "sensors", count: 48 },
  { name: "WebSocket", color: "lime", icon: "settings_input_antenna", count: 24 },
  { name: "RSS Feed", color: "orange", icon: "rss_feed", count: 18 },
  { name: "AI Connector", color: "gold", icon: "psychology", count: 31 },
  { name: "IndexedDB", color: "slate", icon: "database", count: 22 },
  { name: "MCP Connection", color: "indigo", icon: "lan", count: 11 },
];

const typeToneRgb = {
  green: "53, 201, 121",
  blue: "56, 145, 248",
  gold: "255, 199, 44",
  pink: "236, 72, 153",
  cyan: "34, 211, 238",
  lime: "132, 204, 22",
  orange: "249, 115, 22",
  indigo: "255, 199, 44",
  slate: "148, 163, 184",
};

const sampleConnections = [
  {
    id: "conn_01H7X9K8A1B2",
    name: "BTC Price API",
    type: "API Endpoint",
    from: "Market Cap Monitor",
    fromKind: "boxTracker",
    to: "CoinGecko API",
    targetMeta: "api.coingecko.com",
    status: "active",
    lastTest: "2 min fa",
    result: "200 OK",
    method: "GET",
    frequency: "Ogni 30 secondi",
    timeout: "10 secondi",
    retries: 3,
    createdAt: "2026-05-08T10:21:00.000Z",
    updatedAt: "2026-05-11T12:42:18.000Z",
    endpoint: "https://api.coingecko.com/api/v3/simple/price",
  },
  {
    id: "conn_01H7X9K8A1B3",
    name: "Binance WebSocket",
    type: "WebSocket",
    from: "ETH Tracker Live",
    fromKind: "boxTracker",
    to: "Binance Stream",
    targetMeta: "wss://stream.binance.com",
    status: "active",
    lastTest: "1 min fa",
    result: "101 Switching",
    method: "WS",
    frequency: "Realtime",
    timeout: "8 secondi",
    retries: 5,
    createdAt: "2026-05-07T15:10:00.000Z",
    updatedAt: "2026-05-11T12:39:12.000Z",
    endpoint: "wss://stream.binance.com:9443/ws/ethusdt@ticker",
  },
  {
    id: "conn_01H7X9K8A1B4",
    name: "News RSS Feed",
    type: "RSS Feed",
    from: "News Aggregator",
    fromKind: "boxLens",
    to: "RSS Feed",
    targetMeta: "cryptonews.com/feed",
    status: "active",
    lastTest: "5 min fa",
    result: "200 OK",
    method: "GET",
    frequency: "Ogni 5 minuti",
    timeout: "12 secondi",
    retries: 2,
    createdAt: "2026-05-05T08:45:00.000Z",
    updatedAt: "2026-05-11T12:34:48.000Z",
    endpoint: "https://cryptonews.com/feed",
  },
  {
    id: "conn_01H7X9K8A1B5",
    name: "AI Analyzer",
    type: "AI Connector",
    from: "Twitter Feed",
    fromKind: "boxTracker",
    to: "Sentiment AI",
    targetMeta: "local://ai/sentiment",
    status: "active",
    lastTest: "3 min fa",
    result: "Sync OK",
    method: "EVENT",
    frequency: "On payload",
    timeout: "15 secondi",
    retries: 1,
    createdAt: "2026-05-04T13:12:00.000Z",
    updatedAt: "2026-05-11T12:31:11.000Z",
    endpoint: "local://ai/sentiment/analyze",
  },
  {
    id: "conn_01H7X9K8A1B6",
    name: "Twitter Feed",
    type: "Tracker -> Source",
    from: "Social Feed Monitor",
    fromKind: "boxTracker",
    to: "Twitter API v2",
    targetMeta: "api.twitter.com",
    status: "error",
    lastTest: "1 min fa",
    result: "401 Unauthorized",
    method: "GET",
    frequency: "Ogni 60 secondi",
    timeout: "10 secondi",
    retries: 4,
    createdAt: "2026-05-03T09:03:00.000Z",
    updatedAt: "2026-05-11T12:28:09.000Z",
    endpoint: "https://api.twitter.com/2/tweets/search/recent",
  },
  {
    id: "conn_01H7X9K8A1B7",
    name: "ETH Tracker WS",
    type: "WebSocket",
    from: "ETH Tracker Live",
    fromKind: "boxTracker",
    to: "Workspace Event Bus",
    targetMeta: "event-bus://trading-os",
    status: "timeout",
    lastTest: "15 min fa",
    result: "Timeout",
    method: "WS",
    frequency: "Realtime",
    timeout: "6 secondi",
    retries: 6,
    createdAt: "2026-05-01T16:20:00.000Z",
    updatedAt: "2026-05-11T12:16:34.000Z",
    endpoint: "event-bus://trading-os/eth-price",
  },
  {
    id: "conn_01H7X9K8A1B8",
    name: "Market Cap API",
    type: "Widget -> API",
    from: "Portfolio Overview",
    fromKind: "boxLens",
    to: "CoinMarketCap API",
    targetMeta: "pro-api.coinmarketcap.com",
    status: "inactive",
    lastTest: "24 min fa",
    result: "Paused",
    method: "GET",
    frequency: "Manuale",
    timeout: "10 secondi",
    retries: 2,
    createdAt: "2026-04-29T12:08:00.000Z",
    updatedAt: "2026-05-11T11:58:02.000Z",
    endpoint: "https://pro-api.coinmarketcap.com/v1/global-metrics/quotes/latest",
  },
  {
    id: "conn_01H7X9K8A1B9",
    name: "DB Write Connection",
    type: "IndexedDB",
    from: "AI Analyzer",
    fromKind: "boxLens",
    to: "IndexedDB",
    targetMeta: "tl_widgets store",
    status: "active",
    lastTest: "2 min fa",
    result: "Write OK",
    method: "PUT",
    frequency: "On update",
    timeout: "5 secondi",
    retries: 1,
    createdAt: "2026-04-26T17:55:00.000Z",
    updatedAt: "2026-05-11T12:41:50.000Z",
    endpoint: "indexeddb://TrackersLens/tl_widgets",
  },
];

const connectionState = {
  loading: true,
  error: "",
  connections: [],
  query: "",
  type: runtimeParams.get("type") || "all",
  status: "all",
  sort: "recent",
  view: runtimeParams.get("view") === "grid" ? "grid" : "table",
  selectedType: runtimeParams.get("type") || "all",
  selectedId: "",
  loadedAt: new Date(),
  runtimeLoading: true,
  runtimeError: "",
  runtime: {
    channels: [],
    flows: [],
    events: [],
    runtimeNodes: [],
    runtimeDependencies: [],
  },
  runtimeFocus: {
    mode: runtimeParams.get("runtime") || "",
    nodeId: runtimeParams.get("nodeId") || "",
    nodeType: runtimeParams.get("nodeType") || "",
    channel: runtimeParams.get("channel") || "",
    connectionId: runtimeParams.get("connectionId") || "",
  },
  inspectorTab: "details",
  mounted: false,
};

const connectionsReactive = CMSwift.reactive;
const filtersSnapshot = () => ({
  query: connectionState.query,
  type: connectionState.type,
  status: connectionState.status,
  sort: connectionState.sort,
  view: connectionState.view,
  selectedType: connectionState.selectedType,
});
const [, setConnectionsSignal] = connectionsReactive.signal(connectionState.connections);
const [, setRuntimeSignal] = connectionsReactive.signal(connectionState.runtime);
const [getFiltersState, setFiltersSignal] = connectionsReactive.signal(filtersSnapshot());
const [, setSelectedIdSignal] = connectionsReactive.signal(connectionState.selectedId);
const [, setLoadedAtSignal] = connectionsReactive.signal(connectionState.loadedAt);
const [, setLoadingSignal] = connectionsReactive.signal(connectionState.loading);
const [, setRuntimeLoadingSignal] = connectionsReactive.signal(connectionState.runtimeLoading);
const [, setErrorSignal] = connectionsReactive.signal(connectionState.error);
const [, setRuntimeErrorSignal] = connectionsReactive.signal(connectionState.runtimeError);
const [, setRuntimeFocusSignal] = connectionsReactive.signal(connectionState.runtimeFocus);

const syncReactiveState = () => {
  connectionsReactive.batch(() => {
    setConnectionsSignal(connectionState.connections);
    setRuntimeSignal(connectionState.runtime);
    setFiltersSignal(filtersSnapshot());
    setSelectedIdSignal(connectionState.selectedId);
    setLoadedAtSignal(connectionState.loadedAt);
    setLoadingSignal(connectionState.loading);
    setRuntimeLoadingSignal(connectionState.runtimeLoading);
    setErrorSignal(connectionState.error);
    setRuntimeErrorSignal(connectionState.runtimeError);
    setRuntimeFocusSignal(connectionState.runtimeFocus);
  });
};

const setConnectionsState = (connections) => {
  connectionState.connections = connections;
  setConnectionsSignal(connections);
};

const setRuntimeState = (runtime) => {
  connectionState.runtime = runtime;
  setRuntimeSignal(runtime);
};

const setLoadedAtState = (loadedAt) => {
  connectionState.loadedAt = loadedAt;
  setLoadedAtSignal(loadedAt);
};

const setSelectedIdState = (selectedId) => {
  connectionState.selectedId = selectedId;
  setSelectedIdSignal(selectedId);
};

const setFilterState = (patch) => {
  Object.assign(connectionState, patch);
  setFiltersSignal(filtersSnapshot());
  if (Object.prototype.hasOwnProperty.call(patch, "selectedId")) {
    setSelectedIdSignal(connectionState.selectedId);
  }
};

const setRuntimeFocusState = (runtimeFocus) => {
  connectionState.runtimeFocus = runtimeFocus;
  setRuntimeFocusSignal(runtimeFocus);
};

const setInspectorTab = (tab) => {
  connectionState.inspectorTab = tab;
  mountConnections();
};

const filterModel = (key, options = {}) => [
  () => getFiltersState()[key],
  (value) => {
    setFilterState({
      [key]: value,
      ...(options.keepSelection ? {} : { selectedId: "" }),
    });
    mountConnections();
  },
];

const normalize = (value) => String(value || "").toLowerCase();
const typeColor = (type) => {
  const normalized = normalize(type);
  if (normalized === "processor" || normalized.includes("processor")) return "gold";
  const known = connectionTypes.find((item) => normalize(item.name) === normalized);
  if (known) return known.color;
  if (normalized.includes("source")) return "gold";
  return "gold";
};

const analyticsTypeName = (type) => {
  const normalized = normalize(type);
  if (normalized.includes("processor")) return "Processor";
  return type || "Sconosciuto";
};

const visibleConnections = () => {
  const query = normalize(connectionState.query).trim();
  return connectionState.connections
    .filter((item) => connectionState.selectedType === "all" || item.type === connectionState.selectedType)
    .filter((item) => connectionState.type === "all" || item.type === connectionState.type)
    .filter((item) => connectionState.status === "all" || item.status === connectionState.status)
    .filter((item) => !query || [item.id, item.name, item.type, item.from, item.to, item.targetMeta, item.endpoint].some((value) => normalize(value).includes(query)))
    .sort((a, b) => connectionState.sort === "name" ? a.name.localeCompare(b.name) : Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
};

const selectedConnection = () =>
  visibleConnections().find((item) => item.id === connectionState.selectedId) ||
  connectionState.connections.find((item) => item.id === connectionState.selectedId) ||
  (hasRuntimeFocus() ? null : visibleConnections()[0]) ||
  (hasRuntimeFocus() ? null : connectionState.connections[0]) ||
  null;

const fallbackConnection = () =>
  visibleConnections()[0] ||
  connectionState.connections[0] ||
  null;

const focusedRuntimeNode = () => {
  const focus = connectionState.runtimeFocus;
  if (!focus.nodeId) return null;
  return connectionState.runtime.runtimeNodes.find((node) =>
    [node.id, node.sourceRef, node.assetId].filter(Boolean).map(String).includes(focus.nodeId)
  ) || null;
};

const connectionMatchesRuntimeFocus = (connection) => {
  const focus = connectionState.runtimeFocus;
  if (!connection || (!focus.nodeId && !focus.channel && !focus.connectionId)) return false;
  if (focus.connectionId && connection.id === focus.connectionId) return true;
  if (focus.nodeId && [connection.fromBoxId, connection.toBoxId, connection.fromNodeId, connection.toNodeId].filter(Boolean).map(String).includes(focus.nodeId)) return true;
  if (focus.channel && [connection.channel, connection.frequency].filter(Boolean).map(String).includes(focus.channel)) return true;
  return false;
};

const runtimeStoreName = (key, fallback) => tlConfig?.TABLES?.[key] || fallback;

const readRuntimeStore = async (storeName) => {
  const graphStore = window.TrackerLensRuntimeGraphStore;
  if (graphStore?.readAll) return graphStore.readAll(storeName);
  const persistence = window.trackers?.desktop?.persistence;
  if (!persistence?.readDevelopmentRecords) throw new Error("Connections richiede SQLite nell'app desktop.");
  return persistence.readDevelopmentRecords({ storeName });
};

const loadRuntimeInspectorData = async () => {
  connectionState.runtimeLoading = true;
  setRuntimeLoadingSignal(true);
  connectionState.runtimeError = "";
  setRuntimeErrorSignal("");

  try {
    const snapshot = window.TrackerLensRuntimeSnapshotStore?.load
      ? await window.TrackerLensRuntimeSnapshotStore.load({ includeConnections: false })
      : null;
    const [channels, flows, events, runtimeNodes, runtimeDependencies] = snapshot
      ? [snapshot.channels, snapshot.flows, snapshot.events, snapshot.runtimeNodes, snapshot.runtimeDependencies]
      : await Promise.all([
        window.TrackerLensChannelRegistry?.list ? window.TrackerLensChannelRegistry.list() : readRuntimeStore(runtimeStoreName("TL_CHANNELS", "tl_channels")),
        readRuntimeStore(runtimeStoreName("TL_FLOWS", "tl_flows")),
        window.TrackerLensEventLogStore?.listEvents ? window.TrackerLensEventLogStore.listEvents() : readRuntimeStore(runtimeStoreName("TL_EVENTS", "tl_events")),
        readRuntimeStore(runtimeStoreName("TL_RUNTIME_NODES", "tl_runtime_nodes")),
        readRuntimeStore(runtimeStoreName("TL_RUNTIME_DEPENDENCIES", "tl_runtime_dependencies")),
      ]);

    setRuntimeState({
      channels,
      flows,
      events,
      runtimeNodes,
      runtimeDependencies,
    });
  } catch (error) {
    console.error("Errore caricamento Runtime Inspector:", error);
    connectionState.runtimeError = error?.message || "Errore Runtime Inspector";
    setRuntimeErrorSignal(connectionState.runtimeError);
  } finally {
    connectionState.runtimeLoading = false;
    setRuntimeLoadingSignal(false);
  }
};

const connectionRuntimeContext = (connection) => {
  const focus = connectionState.runtimeFocus;
  if (!connection && !focus.nodeId && !focus.channel && !focus.connectionId) {
    return { channels: [], flows: [], events: [], nodes: [], dependencies: [] };
  }

  const ids = new Set([
    connection?.id,
    connection?.fromBoxId,
    connection?.toBoxId,
    connection?.fromNodeId,
    connection?.toNodeId,
    focus.nodeId,
  ].filter(Boolean).map(String));
  const channelNames = new Set([connection?.channel, connection?.frequency, focus.channel].filter(Boolean).map(String));
  const workspaceId = connection?.workspaceId || "";

  const dependencies = connectionState.runtime.runtimeDependencies.filter((dependency) =>
    dependency.connectionId === connection?.id ||
    dependency.connectionId === focus.connectionId ||
    ids.has(String(dependency.sourceNodeId)) ||
    ids.has(String(dependency.targetNodeId)) ||
    channelNames.has(String(dependency.channel))
  );
  dependencies.forEach((dependency) => {
    [dependency.sourceNodeId, dependency.targetNodeId].filter(Boolean).forEach((id) => ids.add(String(id)));
    if (dependency.channel) channelNames.add(String(dependency.channel));
  });

  const nodes = connectionState.runtime.runtimeNodes.filter((node) =>
    ids.has(String(node.id)) ||
    ids.has(String(node.sourceRef)) ||
    (workspaceId && node.workspaceId === workspaceId)
  );
  nodes.forEach((node) => {
    (node.channels || []).forEach((channel) => channelNames.add(String(channel)));
    (node.inputs || []).forEach((channel) => channelNames.add(String(channel)));
    (node.outputs || []).forEach((channel) => channelNames.add(String(channel)));
  });

  const channels = connectionState.runtime.channels.filter((channel) =>
    channelNames.has(String(channel.name)) ||
    ids.has(String(channel.producerNodeId)) ||
    ids.has(String(channel.producerBoxId)) ||
    (Array.isArray(channel.subscribers) && channel.subscribers.some((subscriber) => ids.has(String(subscriber))))
  );
  channels.forEach((channel) => {
    if (channel.name) channelNames.add(String(channel.name));
  });

  const flows = connectionState.runtime.flows.filter((flow) =>
    (workspaceId && flow.workspaceId === workspaceId) ||
    (Array.isArray(flow.connections) && [connection?.id, focus.connectionId].filter(Boolean).some((id) => flow.connections.includes(id))) ||
    (Array.isArray(flow.nodes) && flow.nodes.some((node) => ids.has(String(node.id)) || ids.has(String(node.boxId))))
  );

  const events = connectionState.runtime.events
    .filter((event) =>
      channelNames.has(String(event.channel)) ||
      ids.has(String(event.sourceNodeId)) ||
      ids.has(String(event.targetNodeId)) ||
      (workspaceId && event.workspaceId === workspaceId)
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 8);

  return { channels, flows, events, nodes, dependencies };
};

const stats = () => {
  const total = connectionState.connections.length;
  return {
    total,
    active: connectionState.connections.filter((item) => item.status === "active").length,
    inactive: connectionState.connections.filter((item) => item.status === "inactive").length,
    error: connectionState.connections.filter((item) => item.status === "error").length,
    timeout: connectionState.connections.filter((item) => item.status === "timeout").length,
  };
};

const typeCount = (name) =>
  connectionState.connections.filter((item) => item.type === name).length;

const typeDistribution = () => {
  const counts = connectionState.connections.reduce((map, item) => {
    const name = analyticsTypeName(item.type);
    map.set(name, (map.get(name) || 0) + 1);
    return map;
  }, new Map());
  const rows = Array.from(counts.entries())
    .map(([name, count]) => ({ name, count, color: typeColor(name) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  if (rows.length <= 5) return rows;
  const visible = rows.slice(0, 4);
  const otherCount = rows.slice(4).reduce((sum, item) => sum + item.count, 0);
  return [...visible, { name: "Altri", count: otherCount, color: "slate" }];
};

const loadConnections = async () => {
  connectionState.loading = true;
  connectionState.runtimeLoading = true;
  connectionState.error = "";
  syncReactiveState();
  mountConnections();

  try {
    const [records] = await Promise.all([
      window.TrackerLensConnectionsStore.list(),
      loadRuntimeInspectorData(),
    ]);
    setConnectionsState(records);
    const focusedConnection = records.find((record) => connectionMatchesRuntimeFocus(record));
    setSelectedIdState(focusedConnection?.id || (hasRuntimeFocus() ? "" : records[0]?.id || ""));
    setLoadedAtState(new Date());
  } catch (error) {
    console.error("Errore caricamento collegamenti:", error);
    connectionState.error = error?.message || "Errore caricamento collegamenti";
    setErrorSignal(connectionState.error);
    setConnectionsState([]);
  } finally {
    connectionState.loading = false;
    setLoadingSignal(false);
    mountConnections();
  }
};

const persistConnection = async (connection) => {
  const saved = await window.TrackerLensConnectionsStore.upsert(connection);
  setConnectionsState(connectionState.connections.map((item) => item.id === saved.id ? saved : item));
  setSelectedIdState(saved.id);
  setLoadedAtState(new Date());
  mountConnections();
};

const testConnection = async (connection) => {
  if (!connection) return;

  const started = performance.now();
  let status = "active";
  let result = "OK";

  try {
    if (/^https?:\/\//i.test(connection.endpoint) && connection.method !== "EVENT") {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 5000);
      const response = await fetch(connection.endpoint, { method: "GET", signal: controller.signal, mode: "no-cors" });
      window.clearTimeout(timer);
      result = response?.status ? `${response.status} ${response.statusText || "OK"}` : "Richiesta inviata";
    } else if (/^wss?:\/\//i.test(connection.endpoint)) {
      result = "WebSocket configurato";
    } else if (/^indexeddb:\/\//i.test(connection.endpoint)) {
      await window.TrackerLensConnectionsStore.list();
      result = "IndexedDB OK";
    } else {
      result = "Collegamento locale OK";
    }
  } catch (error) {
    status = error?.name === "AbortError" ? "timeout" : "error";
    result = error?.name === "AbortError" ? "Timeout" : "Errore test";
  }

  await persistConnection({
    ...connection,
    status,
    result,
    lastTest: `${Math.max(1, Math.round(performance.now() - started))} ms`,
    updatedAt: new Date().toISOString(),
  });
};

const duplicateConnection = async (connection) => {
  if (!connection) return;
  const saved = await window.TrackerLensConnectionsStore.duplicate(connection);
  setConnectionsState([saved, ...connectionState.connections]);
  setSelectedIdState(saved.id);
  setLoadedAtState(new Date());
  mountConnections();
};

const deleteConnection = async (connection) => {
  if (!connection) return;
  await window.TrackerLensConnectionsStore.remove(connection.id);
  if (window.TrackerLensRuntimeGraphStore?.cleanupConnectionReferences) {
    await window.TrackerLensRuntimeGraphStore.cleanupConnectionReferences({ connectionId: connection.id });
  }
  if (window.TrackerLensEventLogStore?.cleanupConnectionReferences) {
    await window.TrackerLensEventLogStore.cleanupConnectionReferences({ connectionId: connection.id, workspaceId: connection.workspaceId || "" });
  }
  setConnectionsState(connectionState.connections.filter((item) => item.id !== connection.id));
  setSelectedIdState(connectionState.connections[0]?.id || "");
  await loadRuntimeInspectorData();
  setLoadedAtState(new Date());
  mountConnections();
};

const createConnection = async () => {
  const now = new Date().toISOString();
  const saved = await window.TrackerLensConnectionsStore.upsert({
    id: `conn_${Date.now()}`,
    name: "Nuovo collegamento locale",
    type: "Event Listener",
    from: "Workspace",
    fromKind: "workspace",
    to: "Event Bus",
    targetMeta: "event-bus://local",
    status: "inactive",
    lastTest: "Mai",
    result: "Creato localmente",
    method: "EVENT",
    frequency: "Manuale",
    timeout: "10 secondi",
    retries: 0,
    createdAt: now,
    updatedAt: now,
    endpoint: "event-bus://local/manual",
  });
  setConnectionsState([saved, ...connectionState.connections]);
  setSelectedIdState(saved.id);
  mountConnections();
};

const refreshRuntimeInspector = async () => {
  await loadRuntimeInspectorData();
  setLoadedAtState(new Date());
  refreshRuntimeDom({ preserveScroll: true });
};

const clearRuntimeFocus = () => {
  setRuntimeFocusState({ mode: "", nodeId: "", nodeType: "", channel: "", connectionId: "" });
  const url = new URL(window.location.href);
  ["runtime", "nodeId", "nodeType", "channel", "connectionId"].forEach((key) => url.searchParams.delete(key));
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  mountConnections();
};

const setType = (type) => {
  setFilterState({ selectedType: type, selectedId: "" });
  mountConnections();
};

const setView = (view) => {
  setFilterState({ view });
  mountConnections();
};

const openFlowMap = () => {
  const params = new URLSearchParams();
  if (connectionState.runtimeFocus.mode) params.set("runtime", connectionState.runtimeFocus.mode);
  if (connectionState.runtimeFocus.nodeId) params.set("nodeId", connectionState.runtimeFocus.nodeId);
  if (connectionState.runtimeFocus.nodeType) params.set("nodeType", connectionState.runtimeFocus.nodeType);
  if (connectionState.runtimeFocus.channel) params.set("channel", connectionState.runtimeFocus.channel);
  if (connectionState.runtimeFocus.connectionId) params.set("connectionId", connectionState.runtimeFocus.connectionId);
  window.location.assign(`flowMap.html${params.toString() ? `?${params.toString()}` : ""}`);
};

const setSelected = (id) => {
  setSelectedIdState(id);
  connectionState.inspectorTab = "details";
  mountConnections();
};

const renderBrand = () => window.TrackerLensSidebar.renderBrand({ className: "tl-link-brand" });

const renderTopbar = () =>
  _.header(
    { class: "tl-link-topbar" },
    renderBrand(),
    _.Search({
      class: "tl-link-global-search-input",
      label: "Cerca workspace...",
      value: "",
      "aria-label": "Cerca workspace",
    }),
    _.Toolbar(
      { class: "tl-link-actions", align: "center", gap: 16 },
      btn({ class: "tl-link-edit", onclick: createConnection }, icon("add", "sm"), "Nuovo"),
      btn({ class: "tl-link-menu", "aria-label": "Aggiorna runtime", onclick: refreshRuntimeInspector }, icon("sync", "sm")),
      btn({ class: "tl-link-menu", "aria-label": "Menu collegamenti" }, icon("more_vert"))
    )
  );

const renderSidebar = () =>
  window.TrackerLensSidebar.render({ activeId: "links" });

const renderTypeItem = (type) =>
  btn(
    {
      class: `tl-link-type${connectionState.selectedType === type.name ? " is-active" : ""}`,
      onclick: () => setType(type.name),
    },
    _.span({ class: `tl-link-type-icon is-${type.color}` }, icon(type.icon, "sm")),
    _.span({ class: "tl-link-type-name" }, type.name),
    _.span({ class: "tl-link-count" }, String(typeCount(type.name)))
  );

const renderFilterButton = (label, iconName) =>
  btn({ class: "tl-link-filter-btn" }, icon(iconName, "sm"), _.span(label), icon("chevron_right", "sm"));

const renderFilterPanel = () => {
  const data = stats();
  return _.aside(
    { class: "tl-link-panel", "aria-label": "Filtri collegamenti" },
    _.section(
      { class: "tl-link-type-list" },
      _.h2("Tipi di Collegamento"),
      btn(
        {
          class: `tl-link-type${connectionState.selectedType === "all" ? " is-active" : ""}`,
          onclick: () => setType("all"),
        },
        _.span({ class: "tl-link-type-icon is-gold" }, icon("all_inclusive", "sm")),
        _.span({ class: "tl-link-type-name" }, "Tutti i tipi"),
        _.span({ class: "tl-link-count" }, String(data.total))
      ),
      ...connectionTypes.map(renderTypeItem)
    ),
    _.section(
      { class: "tl-link-filter-list" },
      _.h3("Filtri Attivi"),
      renderFilterButton("Tutti gli ambienti", "public"),
      renderFilterButton("Tutti i workspace", "dashboard_customize"),
      renderFilterButton("Tutti gli stati", "radio_button_checked"),
      renderFilterButton("Nessun filtro temporale", "event")
    ),
    _.section(
      { class: "tl-link-summary", "data-link-summary": "runtime" },
      _.h3("Riepilogo"),
      _.div(_.span("Totale collegamenti"), _.strong(data.total)),
      _.div(_.span("Attivi"), _.strong({ class: "is-ok" }, data.active)),
      _.div(_.span("Inattivi"), _.strong({ class: "is-warn" }, data.inactive)),
      _.div(_.span("Errori"), _.strong({ class: "is-error" }, data.error)),
      _.div(_.span("Ultimo aggiornamento"), _.strong(formatShortDate(connectionState.loadedAt)))
    )
  );
};

const renderSelect = (className, value, options, onChange) => {
  const model = Array.isArray(value) ? value : null;
  return _.Select({
    class: className,
    ...(model ? { model } : { value, onChange }),
    options,
    slots: { arrow: () => icon("keyboard_arrow_down", "sm") },
  });
};

const renderTableSearch = () =>
  _.Search({
    class: "tl-link-table-search-input",
    label: "Cerca collegamenti...",
    value: getFiltersState().query,
    "aria-label": "Cerca collegamenti",
    onInput: (event) => {
      setFilterState({ query: event.target.value, selectedId: "" });
      mountConnections();
    },
  });

const renderToolbar = () =>
  _.Toolbar(
    { class: "tl-link-table-toolbar", align: "center", justify: "space-between", gap: 12 },
    _.Row(
      { class: "tl-link-filter-row", align: "center", gap: 10 },
      renderSelect("tl-link-filter", filterModel("status"), [
        { value: "all", label: "Tutti gli stati" },
        { value: "active", label: "Attivo" },
        { value: "inactive", label: "Inattivo" },
        { value: "error", label: "Errore" },
        { value: "timeout", label: "Timeout" },
      ]),
      renderSelect("tl-link-filter", filterModel("type"), [
        { value: "all", label: "Tipo" },
        ...connectionTypes.map((type) => ({ value: type.name, label: type.name })),
      ]),
      renderSelect("tl-link-filter", filterModel("sort", { keepSelection: true }), [
        { value: "recent", label: "Ordina: Piu recenti" },
        { value: "name", label: "Ordina: Nome" },
      ]),
      _.div(
        { class: "tl-link-view-switch", role: "group", "aria-label": "Cambia vista" },
        btn({ class: connectionState.view === "table" ? "is-active" : "", "aria-label": "Table", onclick: () => setView("table") }, icon("table_rows", "sm")),
        btn({ class: connectionState.view === "grid" ? "is-active" : "", "aria-label": "Grid", onclick: () => setView("grid") }, icon("grid_view", "sm")),
        btn({ "aria-label": "Apri Flow Map", title: "Apri Flow Map", onclick: openFlowMap }, icon("account_tree", "sm"))
      )
    )
  );

const renderTypeBadge = (type) =>
  _.span({ class: `tl-link-badge is-${typeColor(type)}` }, type);

const renderStatus = (status) => {
  const labels = { active: "Attivo", inactive: "Inattivo", error: "Errore", timeout: "Timeout" };
  return _.span({ class: `tl-link-status is-${status}` }, dot(), labels[status] || status);
};

const renderConnectionRow = (item) =>
  _.tr(
    {
      class: selectedConnection()?.id === item.id ? "is-selected" : "",
      onclick: () => setSelected(item.id),
    },
    _.td(_.span({ class: "tl-link-id" }, item.id)),
    _.td(_.strong(item.name), renderMiniSpark(item)),
    _.td(renderTypeBadge(item.type)),
    _.td(_.strong(item.from), _.span(item.fromKind)),
    _.td(_.strong(item.to), _.span(item.targetMeta)),
    _.td(renderStatus(item.status)),
    _.td(_.strong(item.lastTest), _.span({ class: `tl-link-result is-${item.status}` }, item.result)),
    _.td(
      _.div(
        { class: "tl-link-row-actions" },
        btn({ "aria-label": "Testa collegamento", onclick: (event) => { event.stopPropagation(); testConnection(item); } }, icon("play_arrow", "sm")),
        btn({ "aria-label": "Modifica collegamento", onclick: (event) => event.stopPropagation() }, icon("edit", "sm")),
        btn({ "aria-label": "Duplica collegamento", onclick: (event) => { event.stopPropagation(); duplicateConnection(item); } }, icon("content_copy", "sm")),
        btn({ "aria-label": "Elimina collegamento", onclick: (event) => { event.stopPropagation(); deleteConnection(item); } }, icon("delete", "sm"))
      )
    )
  );

const renderMiniSpark = (item) => {
  const seed = item.id.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return _.span(
    { class: "tl-link-spark", "aria-hidden": "true" },
    ...Array.from({ length: 10 }, (_, index) => dot({ style: { height: `${16 + ((seed + index * 9) % 32)}%` } }))
  );
};

const renderTableView = () => {
  const items = visibleConnections();
  if (connectionState.loading) {
    return _.div({ class: "tl-link-empty" }, "Caricamento collegamenti da IndexedDB...");
  }

  if (connectionState.error) {
    return _.div({ class: "tl-link-empty is-error" }, connectionState.error);
  }

  if (!items.length) {
    return _.div({ class: "tl-link-empty" }, "Nessun collegamento salvato. Usa Nuovo o crea collegamenti nel workspace.");
  }

  if (connectionState.view === "grid") {
    return _.Grid(
      { class: "tl-link-card-grid", cols: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 },
      ...items.map((item) =>
        _.Card(
          { class: `tl-link-card${selectedConnection()?.id === item.id ? " is-selected" : ""}`, onclick: () => setSelected(item.id) },
          _.Row({ justify: "space-between", align: "center" }, renderTypeBadge(item.type), renderStatus(item.status)),
          _.h3(item.name),
          _.p(item.endpoint),
          _.Row({ justify: "space-between", align: "center" }, _.span(item.from), icon("arrow_forward", "sm"), _.strong(item.to))
        )
      )
    );
  }

  return _.div(
    { class: "tl-link-table-wrap" },
    _.table(
      { class: "tl-link-table" },
      _.thead(_.tr(_.th("ID"), _.th("Nome"), _.th("Tipo"), _.th("Da"), _.th("A"), _.th("Stato"), _.th("Ultimo Test"), _.th("Azioni"))),
      _.tbody(...items.map(renderConnectionRow))
    )
  );
};

const renderMainTable = () => {
  const count = visibleConnections().length;
  return _.section(
    { class: "tl-link-data-view", "aria-label": "Lista collegamenti" },
    _.div(
      { class: "tl-link-section-head" },
      _.div(_.h2("Tutti i Collegamenti"), _.p(`${count} collegamenti reali · store tl_connections`)),
      renderTableSearch(),
      _.span({ class: "tl-link-live-pill" }, dot(), "Sistema Online")
    ),
    renderToolbar(),
    renderTableView()
  );
};

const jsonTokenize = (line) =>
  line
    .replace(/(&)/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/("(?:\\.|[^"\\])*")(\s*:)?/g, (_, text, colon) => `<span class="${colon ? "is-key" : "is-string"}">${text}</span>${colon || ""}`)
    .replace(/\b(true|false|null)\b/g, '<span class="is-bool">$1</span>')
    .replace(/(:\s*)(-?\d+(?:\.\d+)?)/g, '$1<span class="is-number">$2</span>');

const highlightedCode = (line) => {
  const code = document.createElement("code");
  code.innerHTML = jsonTokenize(line);
  return code;
};

const renderJson = (item) => {
  const config = {
    url: item.endpoint,
    method: item.method,
    params: { ids: "bitcoin", vs_currency: "usd", include_24hr_change: true },
    headers: { Accept: "application/json", "x-tl-source": "tracker-lens" },
    retry: { attempts: item.retries, timeout: item.timeout },
  };
  return _.div(
    { class: "tl-link-json" },
    ...JSON.stringify(config, null, 2).split("\n").map((line, index) =>
      _.div({ class: "tl-link-json-line" }, _.span({ class: "tl-link-line-number" }, String(index + 1).padStart(2, "0")), highlightedCode(line))
    )
  );
};

const renderRuntimeMetric = (label, value, tone = "") =>
  _.div({ class: `tl-runtime-metric${tone ? ` is-${tone}` : ""}` }, _.span(label), _.strong(String(value)));

const hasRuntimeFocus = () =>
  Boolean(connectionState.runtimeFocus.nodeId || connectionState.runtimeFocus.channel || connectionState.runtimeFocus.connectionId);

const renderRuntimeFocus = () => {
  if (!hasRuntimeFocus()) return null;
  const focus = connectionState.runtimeFocus;
  return _.div(
    { class: "tl-runtime-focus" },
    _.div(
      _.strong("Dependency focus"),
      _.span(
        [
          focus.nodeId ? `node ${focus.nodeId}` : "",
          focus.channel ? `channel ${focus.channel}` : "",
          focus.connectionId ? `connection ${focus.connectionId}` : "",
        ].filter(Boolean).join(" · ")
      )
    ),
    btn({ class: "tl-runtime-clear", onclick: clearRuntimeFocus }, icon("close", "sm"))
  );
};

const renderRuntimeNodeSummary = () => {
  const node = focusedRuntimeNode();
  const focus = connectionState.runtimeFocus;
  const runtime = connectionRuntimeContext(null);
  const label = node?.label || focus.nodeId || "Runtime node";
  const type = node?.type || focus.nodeType || "node";
  const status = node?.status || (runtime.dependencies.length || runtime.channels.length ? "linked" : "not indexed");

  return _.div(
    { class: "tl-runtime-node-summary", "data-link-runtime-node-summary": "true" },
    _.div(
      { class: "tl-link-hero is-runtime-node" },
      _.span({ class: "tl-link-orb is-cyan" }, icon(type === "boxTracker" ? "storage" : "account_tree", "md")),
      _.div(_.h3(label), _.p(focus.nodeId || node?.id || "runtime-focus")),
      _.span({ class: `tl-link-status is-${status === "not indexed" ? "inactive" : "active"}` }, dot(), status)
    ),
    _.Grid(
      { class: "tl-link-meta-grid", cols: 2, gap: 8 },
      ...[
        ["Tipo", type],
        ["Workspace", node?.workspaceId || "N/D"],
        ["Source ref", node?.sourceRef || "N/D"],
        ["Channels", runtime.channels.map((channel) => channel.name).join(", ") || focus.channel || "N/D"],
        ["Inputs", node?.inputs?.join(", ") || "N/D"],
        ["Outputs", node?.outputs?.join(", ") || "N/D"],
      ].map(([labelText, value]) => _.div({ class: "tl-link-meta" }, _.span(labelText), _.strong(value)))
    )
  );
};

const renderRuntimeList = (title, items, emptyLabel, formatter) =>
  _.div(
    { class: "tl-runtime-list" },
    _.h3(title),
    items.length
      ? _.div(...items.map((item) => _.div({ class: "tl-runtime-list-row" }, ...formatter(item))))
      : _.p({ class: "tl-link-muted" }, emptyLabel)
  );

const renderRuntimeInspector = (connection) => {
  const runtime = connectionRuntimeContext(connection);

  if (connectionState.runtimeLoading) {
    return _.section({ class: "tl-runtime-inspector", "data-link-runtime-inspector": "true" }, _.h3("Runtime Inspector"), _.p({ class: "tl-link-muted" }, "Caricamento runtime graph..."));
  }

  if (connectionState.runtimeError) {
    return _.section({ class: "tl-runtime-inspector", "data-link-runtime-inspector": "true" }, _.h3("Runtime Inspector"), _.p({ class: "tl-link-error-text" }, connectionState.runtimeError));
  }

  return _.section(
    { class: "tl-runtime-inspector", "data-link-runtime-inspector": "true" },
    _.Row({ justify: "space-between", align: "center" }, _.h3("Runtime Inspector"), btn({ class: "tl-runtime-refresh", onclick: refreshRuntimeInspector }, icon("sync", "sm"))),
    renderRuntimeFocus(),
    _.Grid(
      { class: "tl-runtime-metrics", cols: 3, gap: 8 },
      renderRuntimeMetric("Channels", runtime.channels.length, "green"),
      renderRuntimeMetric("Nodes", runtime.nodes.length, "blue"),
      renderRuntimeMetric("Events", runtime.events.length, "gold")
    ),
    renderRuntimeList(
      "Channels",
      runtime.channels.slice(0, 5),
      "Nessun channel collegato.",
      (channel) => [
        _.strong(channel.name || channel.id),
        _.span(`${channel.status || "unknown"} · ${channel.subscribers?.length || 0} subscribers`),
      ]
    ),
    renderRuntimeList(
      "Runtime Nodes",
      runtime.nodes.slice(0, 5),
      "Nessun runtime node collegato.",
      (node) => [
        _.strong(node.label || node.id),
        _.span(`${node.type || "node"} · ${node.status || "unknown"}`),
      ]
    ),
    renderRuntimeList(
      "Dependencies",
      runtime.dependencies.slice(0, 5),
      "Nessuna dependency collegata.",
      (dependency) => [
        _.strong(`${dependency.sourceNodeId || "source"} -> ${dependency.targetNodeId || "target"}`),
        _.span(dependency.channel || dependency.connectionId || "runtime mapping"),
      ]
    ),
    renderRuntimeList(
      "Recent Events",
      runtime.events,
      "Nessun evento runtime registrato.",
      (event) => [
        _.strong(`${event.eventType || "event"} · ${event.channel || "default"}`),
        _.span(`${event.status || "ok"} · ${formatShortDate(event.createdAt)} · ${event.sizeBytes || 0} B`),
      ]
    )
  );
};

const inspectorTabs = [
  { id: "details", label: "Details", icon: "info" },
  { id: "config", label: "Setting", icon: "data_object" },
  { id: "runtime", label: "Runtime", icon: "hub" },
];

const renderInspectorTabs = () =>
  _.div(
    { class: "tl-link-inspector-tabs", role: "tablist", "aria-label": "Sezioni inspector collegamento" },
    ...inspectorTabs.map((tab) =>
      btn(
        {
          class: `tl-link-inspector-tab${connectionState.inspectorTab === tab.id ? " is-active" : ""}`,
          role: "tab",
          "aria-selected": String(connectionState.inspectorTab === tab.id),
          onclick: () => setInspectorTab(tab.id),
        },
        icon(tab.icon, "sm"),
        _.span(tab.label)
      )
    )
  );

const renderConnectionDetailsPanel = (item) =>
  _.div(
    { class: "tl-link-inspector-panel is-details", role: "tabpanel" },
    _.div(
      { class: "tl-link-hero" },
      _.span({ class: `tl-link-orb is-${typeColor(item.type)}` }, icon("link", "md")),
      _.div(_.h3(item.name), _.p(item.id)),
      renderStatus(item.status)
    ),
    _.Grid(
      { class: "tl-link-meta-grid", cols: 2, gap: 8 },
      ...[
        ["Tipo", item.type],
        ["Creato il", formatDate(item.createdAt)],
        ["Ultimo update", formatDate(item.updatedAt)],
        ["Ultimo test", item.lastTest],
        ["Source", item.from],
        ["Target", item.to],
        ["Metodo", item.method],
        ["Frequenza", item.frequency],
        ["Timeout", item.timeout],
        ["Tentativi", String(item.retries)],
        ["Stato", item.status],
        ["Endpoint", item.targetMeta],
      ].map(([label, value]) => _.div({ class: "tl-link-meta" }, _.span(label), _.strong(value)))
    )
  );

const renderConnectionConfigPanel = (item) =>
  _.div(
    { class: "tl-link-inspector-panel is-config", role: "tabpanel" },
    _.div({ class: "tl-link-json-head" }, _.h3("Configurazione"), _.span("JSON preview")),
    renderJson(item)
  );

const renderConnectionRuntimePanel = (item) =>
  _.div(
    { class: "tl-link-inspector-panel is-runtime", role: "tabpanel" },
    renderRuntimeInspector(item)
  );

const renderInspectorPanel = (item) => {
  if (connectionState.inspectorTab === "config") return renderConnectionConfigPanel(item);
  if (connectionState.inspectorTab === "runtime") return renderConnectionRuntimePanel(item);
  return renderConnectionDetailsPanel(item);
};

const renderInspectorActions = (item) =>
  _.Toolbar(
    { class: "tl-link-inspector-actions", gap: 8 },
    btn({ class: "tl-link-primary", onclick: () => testConnection(item) }, icon("play_arrow", "sm"), "Testa"),
    _.Tooltip(
      btn({ class: "tl-link-icon-action", "aria-label": "Modifica collegamento", title: "Modifica", onclick: () => { } }, icon("edit", "sm")),
      "Modifica"
    ),
    _.Tooltip(
      btn({ class: "tl-link-icon-action", "aria-label": "Duplica collegamento", title: "Duplica", onclick: () => duplicateConnection(item) }, icon("content_copy", "sm")),
      "Duplica"
    ),
    _.Tooltip(
      btn({ class: "tl-link-icon-action is-danger", "aria-label": "Elimina collegamento", title: "Elimina", onclick: () => deleteConnection(item) }, icon("delete", "sm")),
      "Elimina"
    )
  );

const renderInspector = () => {
  const item = selectedConnection();
  const isRuntimeNodeFocus = !item && hasRuntimeFocus();
  return _.aside(
    { class: "tl-link-inspector", "aria-label": "Dettagli collegamento" },
    item ? _.div(
      { class: "tl-link-inspector-body" },
      renderInspectorTabs(),
      renderInspectorPanel(item),
      renderInspectorActions(item)
    ) : isRuntimeNodeFocus ? _.div(
      { class: "tl-link-inspector-body is-runtime-node" },
      renderRuntimeNodeSummary(),
      renderRuntimeInspector(null)
    ) : _.div({ class: "tl-link-empty" }, "Nessun collegamento selezionato.")
  );
};

const formatDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/D";
  return new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
};

const formatShortDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/D";
  return new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" }).format(date);
};

const svgNode = (name, attrs = {}, ...children) => {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value !== undefined && value !== null) node.setAttribute(key, String(value));
  });
  children.flat().filter(Boolean).forEach((child) => node.append(child));
  return node;
};

const activitySeries = (base, trend, jitter, length = 8) =>
  Array.from({ length }, (_, index) => Math.max(0, Math.round(base + trend * index + ((index % 3) - 1) * jitter)));

const activityChartModel = () => {
  const data = stats();
  const eventPressure = Math.min(18, Math.ceil((connectionState.runtime.events.length || 0) / 40));
  const requestsBase = Math.max(1, data.total + eventPressure);
  const successBase = Math.max(0, data.active);
  const errorBase = Math.max(0, data.error + data.timeout);
  return [
    { key: "requests", label: "Richieste/min", color: "#ffc72c", values: activitySeries(requestsBase, Math.max(1, data.active), 1) },
    { key: "success", label: "Successi", color: "#35c979", values: activitySeries(successBase, Math.max(0, data.active - errorBase) / 2, 1) },
    { key: "errors", label: "Errori", color: "#f87171", values: activitySeries(errorBase, errorBase ? 0.35 : 0, errorBase ? 1 : 0) },
  ];
};

const chartPoints = (values, maxValue, width = 280, height = 106, pad = 12) =>
  values.map((value, index) => {
    const x = pad + (index * (width - pad * 2)) / Math.max(1, values.length - 1);
    const y = height - pad - (value / Math.max(1, maxValue)) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

const renderRealtimeChart = () => {
  const series = activityChartModel();
  const maxValue = Math.max(1, ...series.flatMap((item) => item.values));
  const requestPoints = chartPoints(series[0].values, maxValue);
  const requestArea = `12,94 ${requestPoints} 268,94`;

  return _.div(
    { class: "tl-link-line-chart", "data-link-activity-chart": "true", "aria-label": "Grafico attivita realtime" },
    svgNode(
      "svg",
      { class: "tl-link-activity-svg", viewBox: "0 0 280 116", role: "img", "aria-label": "Andamento richieste, successi ed errori" },
      [28, 52, 76].map((y) => svgNode("line", { class: "tl-link-chart-grid", x1: 12, y1: y, x2: 268, y2: y })),
      [series[0], series[1], series[2]].map((item) =>
        svgNode(
          "g",
          { class: `tl-link-chart-series is-${item.key}` },
          item.key === "requests" ? svgNode("polygon", { class: "tl-link-chart-area", points: requestArea }) : null,
          svgNode("polyline", { points: chartPoints(item.values, maxValue), fill: "none", stroke: item.color, "stroke-width": item.key === "requests" ? 3 : 2.4, "stroke-linecap": "round", "stroke-linejoin": "round" }),
          svgNode("circle", { cx: chartPoints(item.values, maxValue).split(" ").at(-1).split(",")[0], cy: chartPoints(item.values, maxValue).split(" ").at(-1).split(",")[1], r: item.key === "requests" ? 3.5 : 3, fill: item.color })
        )
      )
    ),
    _.div(
      { class: "tl-link-chart-legend" },
      ...series.map((item) =>
        _.span(
          { class: `tl-link-chart-key is-${item.key}` },
          _.span({ class: "tl-link-chart-key-dot", style: { "--tone-color": item.color } }),
          _.span(item.label),
          _.strong(String(item.values.at(-1)))
        )
      )
    )
  );
};

const analyticsModel = () => {
  const data = stats();
  const runtime = connectionState.runtime;
  const successRate = data.total ? Math.round((data.active / data.total) * 1000) / 10 : 0;
  const topTypes = typeDistribution();
  const topEndpoints = connectionState.connections
    .map((item) => item.targetMeta || item.endpoint)
    .filter(Boolean)
    .reduce((map, endpoint) => map.set(endpoint, (map.get(endpoint) || 0) + 1), new Map());
  const endpoints = Array.from(topEndpoints.entries()).sort((a, b) => b[1] - a[1]);

  return { data, runtime, successRate, topTypes, endpoints };
};

const renderTypeRows = (topTypes) =>
  topTypes.length
    ? topTypes.map((type) =>
      _.p(
        _.span({ class: "tl-link-type-dot", style: { "--tone": typeToneRgb[type.color] || typeToneRgb.gold } }),
        _.span(type.name),
        _.strong(String(type.count))
      )
    )
    : [_.p("Nessun tipo salvato")];

const endpointIcon = (name) => {
  const value = String(name || "").toLowerCase();
  if (value.startsWith("wss://") || value.startsWith("ws://")) return "sensors";
  if (value.startsWith("event-bus://")) return "hub";
  if (value.startsWith("indexeddb://")) return "database";
  if (value.startsWith("local://")) return "memory";
  if (value.startsWith("http://") || value.startsWith("https://")) return "api";
  return "link";
};

const endpointLabel = (name) => String(name || "Nessun endpoint").replace(/^https?:\/\//i, "").replace(/^wss?:\/\//i, "");

const renderEndpointRows = (endpoints) => {
  if (!endpoints.length) {
    return [
      _.div(
        { class: "tl-link-endpoint is-empty" },
        _.span({ class: "tl-link-endpoint-rank" }, "-"),
        _.div({ class: "tl-link-endpoint-main" }, _.span({ class: "tl-link-endpoint-name" }, "Nessun endpoint"), _.span({ class: "tl-link-endpoint-meta" }, "In attesa di collegamenti")),
        _.strong("0")
      ),
    ];
  }

  const visibleEndpoints = endpoints.slice(0, 3);
  const hiddenEndpoints = endpoints.slice(3);
  const hiddenTotal = hiddenEndpoints.reduce((sum, [, count]) => sum + count, 0);
  const maxCount = Math.max(...visibleEndpoints.map(([, count]) => count), 1);
  const rows = visibleEndpoints.map(([name, count], index) =>
    _.div(
      { class: `tl-link-endpoint is-rank-${index + 1}`, style: { "--w": `${Math.max(12, Math.round((count / maxCount) * 100))}%` } },
      _.span({ class: "tl-link-endpoint-rank" }, String(index + 1)),
      _.span({ class: "tl-link-endpoint-icon" }, _.Icon(endpointIcon(name), { size: "sm" })),
      _.div(
        { class: "tl-link-endpoint-main" },
        _.span({ class: "tl-link-endpoint-name", title: String(name) }, endpointLabel(name)),
        _.span({ class: "tl-link-endpoint-meta" }, count === 1 ? "1 collegamento" : `${count} collegamenti`)
      ),
      _.strong(String(count)),
      _.span({ class: "tl-link-bar", "aria-hidden": "true" })
    )
  );

  if (hiddenEndpoints.length) {
    rows.push(
      _.div(
        { class: "tl-link-endpoint-more" },
        _.span(`+${hiddenEndpoints.length} endpoint`),
        _.strong(`${hiddenTotal} collegamenti`)
      )
    );
  }

  return rows;
};

const graphDistribution = (runtime) => [
  { name: "Nodes", key: "runtimeNodes", count: runtime.runtimeNodes.length, color: "pink" },
  { name: "Channels", key: "channels", count: runtime.channels.length, color: "blue" },
  { name: "Flows", key: "flows", count: runtime.flows.length, color: "green" },
].filter((item) => item.count > 0);

const renderGraphRows = (segments, eventsCount) => [
  ...segments.map((item) =>
    _.p(
      _.span({ class: "tl-link-type-dot", style: { "--tone": typeToneRgb[item.color] || typeToneRgb.gold } }),
      _.span(item.name),
      _.strong({ "data-link-analytics-value": item.key }, String(item.count))
    )
  ),
  _.p(
    _.span({ class: "tl-link-type-dot", style: { "--tone": typeToneRgb.gold } }),
    _.span("Events"),
    _.strong({ "data-link-analytics-value": "events" }, String(eventsCount))
  ),
];

const donutValueStyle = (value) => ({ "--value": `${Math.max(0, Math.min(100, Number(value) || 0))}%` });

const conicSegments = (items, total) => {
  if (!total || !items.length) return "rgba(148, 163, 184, 0.25) 0 100%";
  let cursor = 0;
  return items.map((item, index) => {
    const next = index === items.length - 1 ? 100 : cursor + (item.count / total) * 100;
    const color = `rgb(${typeToneRgb[item.color] || typeToneRgb.gold})`;
    const segment = `${color} ${cursor.toFixed(2)}% ${next.toFixed(2)}%`;
    cursor = next;
    return segment;
  }).join(", ");
};

const typeDonutSegments = (types, total) => conicSegments(types, total);
const typeDonutStyle = (topTypes, total) => ({ "--segments": typeDonutSegments(topTypes, total) });
const graphDonutStyle = (segments) => ({ "--segments": conicSegments(segments, segments.reduce((sum, item) => sum + item.count, 0)) });

const renderAnalytics = () =>
  (() => {
    const { data, runtime, successRate, topTypes, endpoints } = analyticsModel();
    const graphSegments = graphDistribution(runtime);

    return (
      _.section(
        { class: "tl-link-analytics", "data-link-analytics": "runtime", "aria-label": "Analytics collegamenti" },
        _.Card({ class: "tl-link-analytics-card is-wide", "data-link-analytics-card": "activity" }, _.Row({ justify: "space-between" }, _.h3("Attivita in Tempo Reale"), _.span({ "data-link-analytics-value": "total" }, `${data.total} conn.`)), renderRealtimeChart()),
        _.Card({ class: "tl-link-analytics-card", "data-link-analytics-card": "runtime" }, _.h3("Runtime Graph"), _.div({ class: "tl-link-success-wrap" }, _.div({ class: "tl-link-donut is-graph", "data-link-analytics-donut": "graph", style: graphDonutStyle(graphSegments) }, _.strong({ "data-link-analytics-value": "runtimeNodes" }, String(runtime.runtimeNodes.length)), _.span("Nodes")), _.div({ class: "tl-link-type-breakdown", "data-link-analytics-list": "graph" }, ...renderGraphRows(graphSegments, runtime.events.length)))),
        _.Card({ class: "tl-link-analytics-card", "data-link-analytics-card": "success" }, _.h3("Tasso di Successo"), _.div({ class: "tl-link-success-wrap" }, _.div({ class: "tl-link-donut is-success", "data-link-analytics-donut": "success", style: donutValueStyle(successRate) }, _.strong({ "data-link-analytics-value": "successRate" }, `${successRate}%`), _.span("Successo")), _.div(_.p("Successi ", _.span({ "data-link-analytics-value": "active" }, String(data.active))), _.p("Errori ", _.span({ "data-link-analytics-value": "error" }, String(data.error))), _.p("Timeout ", _.span({ "data-link-analytics-value": "timeout" }, String(data.timeout)))))),
        _.Card({ class: "tl-link-analytics-card", "data-link-analytics-card": "types" }, _.h3("Distribuzione per Tipo"), _.div({ class: "tl-link-success-wrap" }, _.div({ class: "tl-link-donut is-types", "data-link-analytics-donut": "types", style: typeDonutStyle(topTypes, data.total) }, _.strong({ "data-link-analytics-value": "typeTotal" }, String(data.total)), _.span("Totale")), _.div({ class: "tl-link-type-breakdown", "data-link-analytics-list": "types" }, ...renderTypeRows(topTypes)))),
        _.Card(
          { class: "tl-link-analytics-card", "data-link-analytics-card": "endpoints" },
          _.h3("Top Endpoint"),
          _.div({ "data-link-analytics-list": "endpoints" }, ...renderEndpointRows(endpoints))
        )
      )
    );
  })();

const renderShell = () =>
  _.div(
    { class: "tl-link-shell" },
    renderTopbar(),
    _.div(
      { class: "tl-link-body" },
      renderSidebar(),
      _.main(
        { class: "tl-link-main" },
        _.div({ class: "tl-link-grid-bg", "aria-hidden": "true" }),
        renderFilterPanel(),
        renderMainTable(),
        renderInspector(),
        renderAnalytics()
      )
    )
  );

const replaceRenderedNode = (selector, nextNode, { preserveScroll = false } = {}) => {
  const current = document.querySelector(selector);
  if (!current || !nextNode) return false;
  const scrollTop = preserveScroll ? current.scrollTop : 0;
  current.replaceWith(nextNode);
  if (preserveScroll) {
    const replacement = document.querySelector(selector);
    if (replacement) replacement.scrollTop = scrollTop;
  }
  return true;
};

const setAnalyticsText = (key, value) => {
  const target = document.querySelector(`[data-link-analytics-value="${key}"]`);
  if (target) target.textContent = String(value);
};

const replaceAnalyticsList = (key, rows) => {
  const target = document.querySelector(`[data-link-analytics-list="${key}"]`);
  if (target) target.replaceChildren(...rows);
};

const replaceActivityChart = () => {
  const target = document.querySelector("[data-link-activity-chart]");
  if (target) target.replaceWith(renderRealtimeChart());
};

const setAnalyticsDonutValue = (key, value) => {
  const target = document.querySelector(`[data-link-analytics-donut="${key}"]`);
  if (target) target.style.setProperty("--value", `${Math.max(0, Math.min(100, Number(value) || 0))}%`);
};

const setAnalyticsDonutSegments = (key, segments) => {
  const target = document.querySelector(`[data-link-analytics-donut="${key}"]`);
  if (target) target.style.setProperty("--segments", segments);
};

const refreshAnalyticsDom = () => {
  const analytics = document.querySelector("[data-link-analytics]");
  if (!analytics) return false;

  const { data, runtime, successRate, topTypes, endpoints } = analyticsModel();
  const graphSegments = graphDistribution(runtime);
  setAnalyticsText("total", `${data.total} conn.`);
  replaceActivityChart();
  setAnalyticsText("runtimeNodes", runtime.runtimeNodes.length);
  setAnalyticsDonutSegments("graph", conicSegments(graphSegments, graphSegments.reduce((sum, item) => sum + item.count, 0)));
  replaceAnalyticsList("graph", renderGraphRows(graphSegments, runtime.events.length));
  setAnalyticsText("successRate", `${successRate}%`);
  setAnalyticsDonutValue("success", successRate);
  setAnalyticsText("active", data.active);
  setAnalyticsText("error", data.error);
  setAnalyticsText("timeout", data.timeout);
  setAnalyticsText("typeTotal", data.total);
  setAnalyticsDonutSegments("types", typeDonutSegments(topTypes, data.total));
  replaceAnalyticsList("types", renderTypeRows(topTypes));
  replaceAnalyticsList("endpoints", renderEndpointRows(endpoints));
  return true;
};

const refreshRuntimeDom = ({ preserveScroll = true } = {}) => {
  if (!connectionState.mounted) {
    mountConnections();
    return;
  }

  syncReactiveState();

  const selected = selectedConnection();
  const nextFilterPanel = renderFilterPanel();
  replaceRenderedNode("[data-link-summary]", nextFilterPanel.querySelector("[data-link-summary]"), { preserveScroll });
  replaceRenderedNode("[data-link-runtime-inspector]", renderRuntimeInspector(selected), { preserveScroll });
  replaceRenderedNode("[data-link-runtime-node-summary]", renderRuntimeNodeSummary(), { preserveScroll });
  if (!refreshAnalyticsDom()) {
    replaceRenderedNode("[data-link-analytics]", renderAnalytics(), { preserveScroll });
  }
};

const mountConnections = () => {
  const root = document.getElementById("tl-connections-root");
  if (!root) return;
  syncReactiveState();
  root.replaceChildren(renderShell());
  connectionState.mounted = true;
};

const startRuntimeInspectorRefresh = () => {
  window.setInterval(() => {
    if (connectionState.runtimeLoading) return;
    loadRuntimeInspectorData().then(() => {
      setLoadedAtState(new Date());
      refreshRuntimeDom({ preserveScroll: true });
    });
  }, 10000);
};

mountConnections();
loadConnections();
startRuntimeInspectorRefresh();
