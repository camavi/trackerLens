// Flow Map state, stores, graph loading and global helpers.
// Extracted from js/flowMapView.js; loaded in order by flowMap.html.
const icon = (name, size = "md") => _.Icon({ name, size });
const btn = (props, ...children) => _.Btn({ type: "button", ...props }, ...children);
const dot = (className = "") => _.span({ class: `tl-flow-dot${className ? ` ${className}` : ""}` });
const params = new URLSearchParams(window.location.search);
const defaultViewport = () => ({ zoom: 1, panX: 0, panY: 0 });
const FLOW_CANVAS_POSITION_MIN = -1000000;
const FLOW_CANVAS_POSITION_MAX = 1000000;
const FLOW_NODE_DEFAULT_WIDTH = 218;
const FLOW_NODE_MIN_WIDTH = 160;
const FLOW_NODE_MAX_WIDTH = 720;
const flowMapRepairMode = () => String(params.get("repair") || "").trim().toLowerCase();
const isFlowMapRecoveryMode = () => {
  const repair = flowMapRepairMode();
  return Boolean(params.get("safe") || ["knowledge-graph", "kg", "runtime", "hard", "workspace-hard", "clear-workspace"].includes(repair));
};
const viewportWorkspaceId = (workspaceId = "") => {
  const candidate = String(workspaceId || params.get("workspaceId") || state.filters.workspaceId || "workspace_global").trim();
  return candidate && candidate !== "all" ? candidate : "workspace_global";
};
const viewportStorageKey = (workspaceId = "") => `tl_flow_viewport:${viewportWorkspaceId(workspaceId)}`;
const previewClearStorageKey = (workspaceId = "") => `tl_flow_preview_cleared:${viewportWorkspaceId(workspaceId)}`;

const loadStoredViewport = (workspaceId = "") => {
  try {
    const value = JSON.parse(localStorage.getItem(viewportStorageKey(workspaceId)) || "null");
    if (!value || typeof value !== "object") return null;
    return {
      zoom: Number.isFinite(value.zoom) ? value.zoom : 1,
      panX: Number.isFinite(value.panX) ? value.panX : 0,
      panY: Number.isFinite(value.panY) ? value.panY : 0,
    };
  } catch (_) {
    return null;
  }
};

const saveViewport = (workspaceId = "") => {
  try {
    localStorage.setItem(viewportStorageKey(workspaceId), JSON.stringify(state.viewport));
  } catch (_) {
    // localStorage may be unavailable in restricted extension contexts.
  }
};

const loadStoredPreviewClears = (workspaceId = "") => {
  try {
    const value = JSON.parse(localStorage.getItem(previewClearStorageKey(workspaceId)) || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, clearedAt]) => Number.isFinite(Date.parse(clearedAt))));
  } catch (_) {
    return {};
  }
};

const saveStoredPreviewClears = (workspaceId = "", clears = {}) => {
  try {
    localStorage.setItem(previewClearStorageKey(workspaceId), JSON.stringify(clears || {}));
  } catch (_) {
    // localStorage may be unavailable in restricted extension contexts.
  }
};

const markPreviewNodesClean = (nodes = [], { remount = false } = {}) => {
  const targets = [...new Map((Array.isArray(nodes) ? nodes : [nodes]).filter((node) => node?.id).map((node) => [node.id, node])).values()];
  if (!targets.length) return;
  const clearedAt = new Date().toISOString();
  const byWorkspace = targets.reduce((acc, node) => {
    const workspaceId = node.workspaceId || state.filters.workspaceId || "workspace_global";
    if (!acc.has(workspaceId)) acc.set(workspaceId, []);
    acc.get(workspaceId).push(node);
    return acc;
  }, new Map());
  byWorkspace.forEach((workspaceNodes, workspaceId) => {
    const stored = loadStoredPreviewClears(workspaceId);
    workspaceNodes.forEach((node) => {
      stored[node.id] = clearedAt;
      state.previewClearedAt[node.id] = clearedAt;
      delete state.previewPayloads[node.id];
    });
    saveStoredPreviewClears(workspaceId, stored);
  });
  if (remount && typeof mount === "function") mount({ preserveScroll: true });
};

const markPreviewNodeClean = (node = {}, { remount = false } = {}) => {
  markPreviewNodesClean([node], { remount });
};

const state = {
  loading: true,
  error: "",
  connections: [],
  runtime: {
    channels: [],
    flows: [],
    events: [],
    flowLogs: [],
    nodes: [],
    dependencies: [],
  },
  performance: [],
  libraryItems: [],
  focus: {
    mode: params.get("runtime") || "",
    nodeId: params.get("nodeId") || "",
    edgeId: params.get("edgeId") || "",
    nodeType: params.get("nodeType") || "",
    channel: params.get("channel") || "",
    connectionId: params.get("connectionId") || "",
  },
  filters: {
    workspaceId: params.get("workspaceId") || "",
    channel: params.get("channel") || "all",
    activity: params.get("activity") || "all",
    type: params.get("type") || "all",
    origin: params.get("origin") || "all",
    state: params.get("state") || "all",
    eventType: params.get("eventType") || "all",
    logLevel: params.get("logLevel") || "all",
    runId: params.get("runId") || "all",
  },
  viewport: { zoom: 1, panX: 0, panY: 0 },
  nodePositions: {},
  frontNodeId: params.get("nodeId") || "",
  paletteSearch: "",
  paletteDragItem: null,
  palettePointer: null,
  suppressPaletteClick: false,
  interaction: null,
  edgeRender: { graph: { nodes: [], dependencies: [] }, activity: { edgeActivity: new Map() } },
  edgePhase: 0,
  edgeAnimation: 0,
  inspectorPanelDrag: null,
  inspectorPortDrag: null,
  debugMode: localStorage.getItem("tl_flow_debug_mode") === "true",
  minimapCollapsed: localStorage.getItem("tl_flow_minimap_collapsed") === "true",
  lastDeletedConnection: null,
  lastDeletedNode: null,
  lastChannelAction: null,
  linkingSourceId: "",
  linkHoverTargetId: "",
  linkingPort: "",
  linkHoverPort: "",
  hoverNodeId: "",
  hoverPortKey: "",
  linkValidation: null,
  optimisticDependencies: [],
  pendingRuntimeRefresh: false,
  runtimeLoadInFlight: false,
  liveBusUnsubscribe: null,
  liveRenderFrame: 0,
  liveActivityClearTimer: 0,
  liveBus: {
    available: false,
    connected: false,
    workspaceId: "",
    count: 0,
    lastAt: "",
    lastChannel: "",
  },
  previewPayloads: {},
  previewClearedAt: {},
  storageInspectorRecords: {},
  aiInspectorJobs: {},
  knowledgeInspectorGraph: {},
  knowledgeInspectorDocuments: {},
  knowledgeInspectorDictionaries: {},
  knowledgeInspectorEvents: {},
  knowledgeInspectorStructured: {},
  agentToolDebug: {},
  knowledgeUploadProgress: {},
  aiProcessing: {},
  runtimeWorker: {
    available: false,
    connected: false,
    mode: "none",
    status: "idle",
    error: "",
    workspaceId: "",
    nodes: 0,
    dependencies: 0,
    lastRefreshAt: "",
  },
  lastInteractionAt: 0,
  updatedAt: new Date(),
  activeStatusPanel: "",
  inspectorOpen: false,
  contextMenu: null,
  errorToast: {
    message: "",
    timerId: 0,
  },
  testRun: {
    running: false,
    runId: "",
    nodeIds: [],
    edgeIds: [],
    activeNodeIds: [],
    activeEdgeIds: [],
    startedAt: "",
    completedAt: "",
    summary: "",
    timeoutId: 0,
    abortController: null,
    liveSockets: [],
    keepOpen: false,
    cancelRequested: false,
    verification: null,
  },
  mounted: false,
};

const stringifyRuntimeValue = (value = {}) => {
  try {
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch (_) {
    return String(value || "");
  }
};

const summarizeRuntimePayloadForUi = (payload) => {
  return payload;
};

const sanitizeRuntimeEventForUi = (event = {}) => {
  const payload = summarizeRuntimePayloadForUi(event.payload);
  return {
    ...event,
    payload,
    originalPayload: event.originalPayload,
    payloadPreview: event.payloadPreview || stringifyRuntimeValue(event.payload),
  };
};

const sanitizeFlowLogForUi = (log = {}) => ({
  ...log,
  context: summarizeRuntimePayloadForUi(log.context || {}),
});

const recentRuntimeRecords = (records = [], limit = 0) =>
  [...(records || [])]
    .sort((a, b) => Date.parse(b.createdAt || b.updatedAt || "") - Date.parse(a.createdAt || a.updatedAt || ""))
    .slice(0, Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : Number.POSITIVE_INFINITY);

state.viewport = params.get("workspaceId") ? loadStoredViewport(params.get("workspaceId")) || state.viewport : state.viewport;

const flowReactive = CMSwift.reactive;
const [getRuntimeState, setRuntimeSignal] = flowReactive.signal(state.runtime);
const [getFiltersState, setFiltersSignal] = flowReactive.signal(state.filters);
const [getFocusState, setFocusSignal] = flowReactive.signal(state.focus);
const TEST_RUN_TIMEOUT_MS = 12000;
const LIVE_TEST_TIMEOUT_MS = 10000;
const AI_DIRECT_TEST_TIMEOUT_MS = 120000;
const AI_PROCESSING_VISUAL_TIMEOUT_MS = 300000;
const MIN_TEST_ANIMATION_MS = 3000;
const EDGE_ACTIVITY_WINDOW_MS = 12000;
const [getUpdatedAtState, setUpdatedAtSignal] = flowReactive.signal(state.updatedAt);
const [getLoadingState, setLoadingSignal] = flowReactive.signal(state.loading);
const [getErrorState, setErrorSignal] = flowReactive.signal(state.error);
const FLOW_ERROR_TIMEOUT_MS = 7000;

const clearFlowMapError = ({ remount = true } = {}) => {
  if (state.errorToast.timerId) {
    window.clearTimeout(state.errorToast.timerId);
  }
  state.errorToast = { message: "", timerId: 0 };
  if (!state.error) return;
  state.error = "";
  setErrorSignal("");
  if (remount && state.mounted && typeof mount === "function") mount({ preserveScroll: true });
};

const scheduleFlowMapErrorDismiss = () => {
  const message = String(state.error || "");
  if (!message) {
    if (state.errorToast.timerId) window.clearTimeout(state.errorToast.timerId);
    state.errorToast = { message: "", timerId: 0 };
    return;
  }
  if (state.errorToast.message === message && state.errorToast.timerId) return;
  if (state.errorToast.timerId) window.clearTimeout(state.errorToast.timerId);
  const timerId = window.setTimeout(() => {
    if (state.error === message) clearFlowMapError({ remount: true });
  }, FLOW_ERROR_TIMEOUT_MS);
  state.errorToast = { message, timerId };
};

const setFlowMapError = (message = "", { timeout = true, remount = false } = {}) => {
  state.error = String(message || "");
  if (!timeout && state.errorToast.timerId) {
    window.clearTimeout(state.errorToast.timerId);
    state.errorToast = { message: "", timerId: 0 };
  }
  if (timeout) scheduleFlowMapErrorDismiss();
  setErrorSignal(state.error);
  if (remount && state.mounted && typeof mount === "function") mount({ preserveScroll: true });
};

const syncReactiveState = () => {
  scheduleFlowMapErrorDismiss();
  flowReactive.batch(() => {
    setRuntimeSignal(state.runtime);
    setFiltersSignal(state.filters);
    setFocusSignal(state.focus);
    setUpdatedAtSignal(state.updatedAt);
    setLoadingSignal(state.loading);
    setErrorSignal(state.error);
  });
};

const setRuntimeState = (runtime) => {
  state.runtime = runtime;
  setRuntimeSignal(runtime);
};

const isFlowMapEditableElement = (target = null) =>
  Boolean(target?.closest?.("input, textarea, select, [contenteditable='true']"));

const isFlowMapNodeEditorActive = () =>
  isFlowMapEditableElement(document.activeElement) &&
  Boolean(document.activeElement?.closest?.(".tl-flow-node, .tl-flow-inspector, .tl-flow-config-panel"));

const syncProcessorRuntime = (workspaceId = state.filters.workspaceId) => {
  if (!window.TrackerLensProcessorRuntime?.get) return;
  const id = workspaceId || "workspace_global";
  try {
    window.TrackerLensProcessorRuntime.get(id).start({
      workspaceId: id,
      runtime: state.runtime,
    });
  } catch (error) {
    console.warn("Processor runtime non avviato", error);
  }
};

const syncActionRuntime = (workspaceId = state.filters.workspaceId) => {
  if (!window.TrackerLensActionRuntime?.get) return;
  const id = workspaceId || "workspace_global";
  try {
    window.TrackerLensActionRuntime.get(id).start({
      workspaceId: id,
      runtime: state.runtime,
    });
  } catch (error) {
    console.warn("Action runtime non avviato", error);
  }
};

const syncStorageRuntime = (workspaceId = state.filters.workspaceId) => {
  if (!window.TrackerLensStorageRuntime?.get) return;
  const id = workspaceId || "workspace_global";
  try {
    window.TrackerLensStorageRuntime.get(id).start({
      workspaceId: id,
      runtime: state.runtime,
    });
  } catch (error) {
    console.warn("Storage runtime non avviato", error);
  }
};

const syncKnowledgeRuntime = (workspaceId = state.filters.workspaceId) => {
  if (!window.TrackerLensKnowledgeRuntime?.get) return;
  const id = workspaceId || "workspace_global";
  try {
    window.TrackerLensKnowledgeRuntime.get(id).start({
      workspaceId: id,
      runtime: state.runtime,
    });
  } catch (error) {
    console.warn("Knowledge runtime non avviato", error);
  }
};

const syncAiAgentRuntime = (workspaceId = state.filters.workspaceId) => {
  if (!window.TrackerLensAiAgentRuntime?.get) return;
  const id = workspaceId || "workspace_global";
  try {
    window.TrackerLensAiAgentRuntime.get(id).start({
      workspaceId: id,
      runtime: state.runtime,
    });
  } catch (error) {
    console.warn("AI Agent runtime non avviato", error);
  }
};

const syncOrchestratorAgentRuntime = (workspaceId = state.filters.workspaceId) => {
  if (!window.TrackerLensOrchestratorAgentRuntime?.get) return;
  const id = workspaceId || "workspace_global";
  try {
    window.TrackerLensOrchestratorAgentRuntime.get(id).start({
      workspaceId: id,
      runtime: state.runtime,
    });
  } catch (error) {
    console.warn("Orchestrator Agent runtime non avviato", error);
  }
};

const stopPageRuntimes = (workspaceId = state.filters.workspaceId) => {
  const id = workspaceId || "workspace_global";
  try { window.TrackerLensProcessorRuntime?.get?.(id)?.stop?.(); } catch (_) {}
  try { window.TrackerLensActionRuntime?.get?.(id)?.stop?.(); } catch (_) {}
  try { window.TrackerLensStorageRuntime?.get?.(id)?.stop?.(); } catch (_) {}
  try { window.TrackerLensKnowledgeRuntime?.get?.(id)?.stop?.(); } catch (_) {}
  try { window.TrackerLensAiAgentRuntime?.get?.(id)?.stop?.(); } catch (_) {}
  try { window.TrackerLensOrchestratorAgentRuntime?.get?.(id)?.stop?.(); } catch (_) {}
};

const stopBackgroundRuntime = (workspaceId = state.filters.workspaceId) => {
  const id = workspaceId || "workspace_global";
  try {
    window.TrackerLensRuntimeWorker?.stop?.(id);
  } catch (_) {}
  state.runtimeWorker = {
    ...state.runtimeWorker,
    connected: false,
    status: "stopped",
    workspaceId: id,
  };
};

const syncBackgroundRuntime = (workspaceId = state.filters.workspaceId, options = {}) => {
  if (!window.TrackerLensRuntimeWorker?.start) return false;
  const id = workspaceId || "workspace_global";
  const forceRefresh = Boolean(options.forceRefresh);
  if (isFlowMapRecoveryMode()) {
    state.runtimeWorker = {
      ...state.runtimeWorker,
      available: true,
      connected: false,
      mode: "recovery",
      status: "paused",
      workspaceId: id,
      error: "",
    };
    return true;
  }
  stopPageRuntimes(id);
  const status = window.TrackerLensRuntimeWorker.status?.() || {};
  const active = (status.workspaces || []).find((workspace) => workspace.workspaceId === id);
  if (forceRefresh && window.TrackerLensRuntimeWorker.restart) {
    const restarted = window.TrackerLensRuntimeWorker.restart({ workspaceId: id, refreshMs: 5000 });
    state.runtimeWorker = {
      ...state.runtimeWorker,
      available: Boolean(status.available || restarted),
      connected: Boolean(status.connected || restarted),
      mode: status.mode || state.runtimeWorker.mode || "worker",
      status: restarted ? "restarting" : status.status || "idle",
      workspaceId: id,
      error: status.error || "",
    };
    return Boolean(restarted);
  }
  if (forceRefresh && window.TrackerLensRuntimeWorker.refresh) {
    window.TrackerLensRuntimeWorker.refresh(id);
  }
  if (state.runtimeWorker.connected && state.runtimeWorker.workspaceId === id && active?.status === "running") {
    state.runtimeWorker = {
      ...state.runtimeWorker,
      available: true,
      connected: true,
      mode: status.mode || state.runtimeWorker.mode || "worker",
      status: active.status,
      workspaceId: id,
      nodes: active.nodes || state.runtimeWorker.nodes || 0,
      dependencies: active.dependencies || state.runtimeWorker.dependencies || 0,
      lastRefreshAt: active.lastRefreshAt || state.runtimeWorker.lastRefreshAt || "",
      error: active.error || "",
    };
    return true;
  }
  const started = window.TrackerLensRuntimeWorker.start({ workspaceId: id, refreshMs: 5000 });
  state.runtimeWorker = {
    ...state.runtimeWorker,
    available: Boolean(status.available || started),
    connected: Boolean(status.connected || started),
    mode: status.mode || state.runtimeWorker.mode || "worker",
    status: started ? "starting" : status.status || "idle",
    workspaceId: id,
    error: status.error || "",
  };
  return Boolean(started);
};

const syncPageRuntimes = (workspaceId = state.filters.workspaceId) => {
  if (isFlowMapRecoveryMode()) return;
  stopBackgroundRuntime(workspaceId);
  syncProcessorRuntime(workspaceId);
  syncActionRuntime(workspaceId);
  syncStorageRuntime(workspaceId);
  syncKnowledgeRuntime(workspaceId);
  syncAiAgentRuntime(workspaceId);
  syncOrchestratorAgentRuntime(workspaceId);
};

const hasRendererOnlyPythonPocNode = (nodes = state.runtime.nodes || []) =>
  Boolean(window.trackers?.runtime?.pythonPoc?.run) &&
  nodes.some((node) => String(node.metadata?.subtype || node.metadata?.manifest?.subtype || "").toLowerCase() === "python-test");

const setFiltersState = (filters) => {
  state.filters = filters;
  setFiltersSignal(filters);
};

const setFocusState = (focus) => {
  state.focus = focus;
  setFocusSignal(focus);
};

const filterModel = (key) => [
  () => getFiltersState()[key],
  (value) => setFilter(key, value),
];

const runtimeStoreName = (key, fallback) => tlConfig?.TABLES?.[key] || fallback;

const readRuntimeStore = async (storeName) => {
  const eventStore = window.TrackerLensEventLogStore;
  if (storeName === runtimeStoreName("TL_EVENTS", "tl_events") && eventStore?.listEvents) return eventStore.listEvents();
  if (storeName === runtimeStoreName("TL_FLOW_LOGS", "tl_flow_logs") && eventStore?.listFlowLogs) return eventStore.listFlowLogs();
  if (window.TrackerLensRuntimeGraphStore?.readAll) return window.TrackerLensRuntimeGraphStore.readAll(storeName);
  if (window.TrackerLensRuntimeGraphStore?.ensureStores) {
    await window.TrackerLensRuntimeGraphStore.ensureStores().then((db) => db?.close?.());
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(tlConfig.DB_NAME);
    request.onsuccess = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.close();
        resolve([]);
        return;
      }
      const read = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
      read.onsuccess = (readEvent) => {
        db.close();
        resolve(Array.from(readEvent.target.result || []));
      };
      read.onerror = (readEvent) => {
        db.close();
        reject(readEvent.target.error || new Error(`Errore lettura ${storeName}`));
      };
    };
    request.onerror = (event) => reject(event.target.error || new Error(`Errore apertura ${tlConfig.DB_NAME}`));
  });
};

const readScopedRuntimeStore = async (storeName, workspaceId = "") => {
  const records = await readRuntimeStore(storeName);
  if (!workspaceId || workspaceId === "all") return records;
  return records.filter((record) => (record.workspaceId || "global") === workspaceId);
};

const readRuntimeRecord = async (storeName, id) => {
  if (!id) return null;
  if (window.TrackerLensRuntimeGraphStore?.ensureStores) {
    await window.TrackerLensRuntimeGraphStore.ensureStores().then((db) => db?.close?.());
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(tlConfig.DB_NAME);
    request.onsuccess = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.close();
        resolve(null);
        return;
      }
      const read = db.transaction(storeName, "readonly").objectStore(storeName).get(id);
      read.onsuccess = (readEvent) => {
        db.close();
        resolve(readEvent.target.result || null);
      };
      read.onerror = (readEvent) => {
        db.close();
        reject(readEvent.target.error || new Error(`Errore lettura ${storeName}`));
      };
    };
    request.onerror = (event) => reject(event.target.error || new Error(`Errore apertura ${tlConfig.DB_NAME}`));
  });
};

const writeRuntimeRecord = async (storeName, record) => {
    if (!record?.id) return null;
  const eventStore = window.TrackerLensEventLogStore;
  if (storeName === runtimeStoreName("TL_EVENTS", "tl_events") && eventStore?.recordEvent) {
    return eventStore.recordEvent(record);
  }
  if (storeName === runtimeStoreName("TL_FLOW_LOGS", "tl_flow_logs") && eventStore?.recordFlowLog) {
    return eventStore.recordFlowLog(record);
  }
  if (window.TrackerLensRuntimeGraphStore?.ensureStores) {
    await window.TrackerLensRuntimeGraphStore.ensureStores().then((db) => db?.close?.());
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(tlConfig.DB_NAME);
    request.onsuccess = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.close();
        reject(new Error(`Store ${storeName} non disponibile`));
        return;
      }
      const write = db.transaction(storeName, "readwrite").objectStore(storeName).put(record);
      write.onsuccess = () => {
        db.close();
        resolve(record);
      };
      write.onerror = (writeEvent) => {
        db.close();
        reject(writeEvent.target.error || new Error(`Errore salvataggio ${storeName}`));
      };
    };
    request.onerror = (event) => reject(event.target.error || new Error(`Errore apertura ${tlConfig.DB_NAME}`));
  });
};

const deleteWorkspaceScopedRecords = async (storeName, workspaceId = "") => {
  if (!workspaceId) return [];
  const records = await readRuntimeStore(storeName).catch(() => []);
  const ids = records
    .filter((record) => record.workspaceId === workspaceId || record.id === workspaceId)
    .map((record) => record.id)
    .filter(Boolean);
  if (!ids.length) return [];
  if ([runtimeStoreName("TL_EVENTS", "tl_events"), runtimeStoreName("TL_FLOW_LOGS", "tl_flow_logs")].includes(storeName) && window.TrackerLensEventLogStore?.deleteRecords) {
    return window.TrackerLensEventLogStore.deleteRecords(storeName, ids);
  }
  if (window.TrackerLensRuntimeGraphStore?.deleteRecords) return window.TrackerLensRuntimeGraphStore.deleteRecords(storeName, ids);
  if (window.TrackerLensRuntimeGraphStore?.ensureStores) {
    await window.TrackerLensRuntimeGraphStore.ensureStores().then((db) => db?.close?.());
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(tlConfig.DB_NAME);
    request.onsuccess = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.close();
        resolve([]);
        return;
      }
      const transaction = db.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      ids.forEach((id) => store.delete(id));
      transaction.oncomplete = () => {
        db.close();
        resolve(ids);
      };
      transaction.onerror = (deleteEvent) => {
        db.close();
        reject(deleteEvent.target.error || new Error(`Errore cleanup ${storeName}`));
      };
    };
    request.onerror = (event) => reject(event.target.error || new Error(`Errore apertura ${tlConfig.DB_NAME}`));
  });
};

const deleteRuntimeRecordsWhere = async (storeName, predicate = () => false) => {
  const records = await readRuntimeStore(storeName).catch(() => []);
  const ids = records.filter(predicate).map((record) => record.id).filter(Boolean);
  if (!ids.length) return [];
  if ([runtimeStoreName("TL_EVENTS", "tl_events"), runtimeStoreName("TL_FLOW_LOGS", "tl_flow_logs")].includes(storeName) && window.TrackerLensEventLogStore?.deleteRecords) {
    return window.TrackerLensEventLogStore.deleteRecords(storeName, ids);
  }
  if (window.TrackerLensRuntimeGraphStore?.deleteRecords) return window.TrackerLensRuntimeGraphStore.deleteRecords(storeName, ids);
  if (window.TrackerLensRuntimeGraphStore?.ensureStores) {
    await window.TrackerLensRuntimeGraphStore.ensureStores().then((db) => db?.close?.());
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(tlConfig.DB_NAME);
    request.onsuccess = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.close();
        resolve([]);
        return;
      }
      const transaction = db.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      ids.forEach((id) => store.delete(id));
      transaction.oncomplete = () => {
        db.close();
        resolve(ids);
      };
      transaction.onerror = (deleteEvent) => {
        db.close();
        reject(deleteEvent.target.error || new Error(`Errore cleanup ${storeName}`));
      };
    };
    request.onerror = (event) => reject(event.target.error || new Error(`Errore apertura ${tlConfig.DB_NAME}`));
  });
};

const isKnowledgeGraphSampleRecord = (record = {}) => {
  const text = [
    record.id,
    record.sourceNodeId,
    record.targetNodeId,
    record.connectionId,
    record.channel,
    record.eventType,
    record.message,
    record.metadata?.source,
    record.context?.action,
    record.meta?.origin,
    record.payload?.runId,
  ].map((value) => String(value || "").toLowerCase()).join(" ");
  return text.includes("knowledge_graph_sample") ||
    text.includes("knowledge-graph-sample") ||
    text.includes("flow-map-knowledge-graph-sample") ||
    text.includes("knowledge graph sample");
};

const isOversizedRuntimeRecord = (record = {}) => {
  const payloadText = stringifyRuntimeValue(record.payload || record.context || record.value || {});
  return payloadText.length > 160000;
};

const cleanupKnowledgeGraphWorkspaceData = async (workspaceId = "") => {
  const id = normalizeRuntimeWorkspaceId(workspaceId || await resolveInitialWorkspaceId());
  const scoped = (record = {}) => (record.workspaceId || "workspace_global") === id;
  const nodeStore = runtimeStoreName("TL_RUNTIME_NODES", "tl_runtime_nodes");
  const dependencyStore = runtimeStoreName("TL_RUNTIME_DEPENDENCIES", "tl_runtime_dependencies");
  const eventStore = runtimeStoreName("TL_EVENTS", "tl_events");
  const logStore = runtimeStoreName("TL_FLOW_LOGS", "tl_flow_logs");
  const connectionStore = runtimeStoreName("TL_CONNECTIONS", "tl_connections");
  const channelStore = runtimeStoreName("TL_CHANNELS", "tl_channels");
  const sampleNodeIds = new Set((await readRuntimeStore(nodeStore).catch(() => []))
    .filter(scoped)
    .filter(isKnowledgeGraphSampleRecord)
    .map((record) => record.id)
    .filter(Boolean));
  const touchesSampleNode = (record = {}) =>
    sampleNodeIds.has(record.id) ||
    sampleNodeIds.has(record.sourceNodeId || record.fromBoxId) ||
    sampleNodeIds.has(record.targetNodeId || record.toBoxId);
  const result = {
    workspaceId: id,
    nodes: await deleteRuntimeRecordsWhere(nodeStore, (record) => scoped(record) && (isKnowledgeGraphSampleRecord(record) || touchesSampleNode(record))),
    dependencies: await deleteRuntimeRecordsWhere(dependencyStore, (record) => scoped(record) && (isKnowledgeGraphSampleRecord(record) || touchesSampleNode(record))),
    connections: await deleteRuntimeRecordsWhere(connectionStore, (record) => scoped(record) && (isKnowledgeGraphSampleRecord(record) || touchesSampleNode(record))),
    channels: await deleteRuntimeRecordsWhere(channelStore, (record) => scoped(record) && isKnowledgeGraphSampleRecord(record)),
    events: await deleteRuntimeRecordsWhere(eventStore, (record) => scoped(record)),
    flowLogs: await deleteRuntimeRecordsWhere(logStore, (record) => scoped(record)),
  };
  const knowledge = window.TrackerLensKnowledgeRuntime;
  const stores = knowledge?.STORES || {};
  if (knowledge?.listStore && knowledge?.deleteRecords) {
    const collectionId = "knowledge_graph_sample_current";
    const cleanupKnowledgeStore = async (storeName, predicate) => {
      if (!storeName) return [];
      const records = await knowledge.listStore(storeName).catch(() => []);
      const ids = records.filter((record) => scoped(record) && predicate(record)).map((record) => record.id).filter(Boolean);
      if (ids.length) await knowledge.deleteRecords(storeName, ids);
      return ids;
    };
    result.knowledgeDocuments = await cleanupKnowledgeStore(stores.documents, (record) =>
      record.metadata?.collectionId === collectionId || isKnowledgeGraphSampleRecord(record) || isOversizedRuntimeRecord(record));
    result.knowledgeChunks = await cleanupKnowledgeStore(stores.chunks, (record) =>
      record.metadata?.collectionId === collectionId || isKnowledgeGraphSampleRecord(record));
    result.knowledgeEntities = await cleanupKnowledgeStore(stores.entities, (record) =>
      record.metadata?.collectionId === collectionId || isKnowledgeGraphSampleRecord(record));
    result.knowledgeRelations = await cleanupKnowledgeStore(stores.relations, (record) =>
      record.metadata?.collectionId === collectionId || isKnowledgeGraphSampleRecord(record));
    result.knowledgeDictionary = await cleanupKnowledgeStore(stores.dictionary, (record) =>
      record.collectionId === collectionId || record.metadata?.collectionId === collectionId || isKnowledgeGraphSampleRecord(record));
    result.knowledgeEvents = await cleanupKnowledgeStore(stores.events, (record) =>
      record.collectionId === collectionId || record.metadata?.collectionId === collectionId || isKnowledgeGraphSampleRecord(record));
    result.knowledgeQueries = await cleanupKnowledgeStore(stores.queries, (record) =>
      record.collectionId === collectionId || record.scope?.collectionId === collectionId || isKnowledgeGraphSampleRecord(record));
    result.knowledgeMetrics = await cleanupKnowledgeStore(stores.metrics, (record) =>
      record.value?.collectionId === collectionId || isKnowledgeGraphSampleRecord(record));
  }
  console.info("[FlowMap repair] Knowledge Graph workspace cleanup", result);
  return result;
};

const cleanupWorkspaceRuntimeData = async (workspaceId = "") => {
  const id = normalizeRuntimeWorkspaceId(workspaceId || await resolveInitialWorkspaceId());
  const scoped = (record = {}) => record.workspaceId === id || record.id === id;
  const result = {
    workspaceId: id,
    flows: await deleteRuntimeRecordsWhere(runtimeStoreName("TL_FLOWS", "tl_flows"), scoped),
    nodes: await deleteRuntimeRecordsWhere(runtimeStoreName("TL_RUNTIME_NODES", "tl_runtime_nodes"), scoped),
    dependencies: await deleteRuntimeRecordsWhere(runtimeStoreName("TL_RUNTIME_DEPENDENCIES", "tl_runtime_dependencies"), scoped),
    connections: await deleteRuntimeRecordsWhere(runtimeStoreName("TL_CONNECTIONS", "tl_connections"), scoped),
    channels: await deleteRuntimeRecordsWhere(runtimeStoreName("TL_CHANNELS", "tl_channels"), scoped),
    events: await deleteRuntimeRecordsWhere(runtimeStoreName("TL_EVENTS", "tl_events"), scoped),
    flowLogs: await deleteRuntimeRecordsWhere(runtimeStoreName("TL_FLOW_LOGS", "tl_flow_logs"), scoped),
  };
  state.runtime = {
    channels: [],
    flows: [],
    events: [],
    flowLogs: [],
    nodes: [],
    dependencies: [],
  };
  state.connections = [];
  state.previewPayloads = {};
  state.previewClearedAt = {};
  state.knowledgeInspectorGraph = {};
  state.knowledgeInspectorDocuments = {};
  state.knowledgeInspectorDictionaries = {};
  state.knowledgeInspectorEvents = {};
  state.knowledgeInspectorStructured = {};
  state.edgeRender = { graph: { nodes: [], dependencies: [] }, activity: { edgeActivity: new Map() } };
  setRuntimeSignal(state.runtime);
  console.info("[FlowMap repair] Workspace runtime cleanup", result);
  return result;
};

const runFlowMapStartupRepair = async () => {
  const repair = flowMapRepairMode();
  if (!repair || repair === "0" || repair === "false") return null;
  const workspaceId = normalizeRuntimeWorkspaceId(params.get("workspaceId") || state.filters.workspaceId || await resolveInitialWorkspaceId());
  if (repair === "knowledge-graph" || repair === "kg" || repair === "runtime" || repair === "hard" || repair === "workspace-hard" || repair === "clear-workspace") {
    state.loading = true;
    setLoadingSignal(true);
    try {
      const hardRepair = repair === "hard" || repair === "workspace-hard" || repair === "clear-workspace";
      const result = hardRepair
        ? await cleanupWorkspaceRuntimeData(workspaceId)
        : await cleanupKnowledgeGraphWorkspaceData(workspaceId);
      state.error = "";
      setErrorSignal("");
      try {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.delete("repair");
        nextUrl.searchParams.delete("safe");
        window.history.replaceState({}, "", nextUrl.toString());
      } catch (_) {
        // URL cleanup is best-effort in extension contexts.
      }
      return { ...result, skipInitialLoad: hardRepair };
    } catch (error) {
      state.error = `Repair Flow Map fallito: ${error.message || error}`;
      setErrorSignal(state.error);
      console.error("[FlowMap repair] cleanup failed", error);
      return null;
    } finally {
      state.loading = false;
      setLoadingSignal(false);
    }
  }
  return null;
};

window.TrackerLensFlowMapRepair = {
  cleanupKnowledgeGraphWorkspaceData,
  cleanupWorkspaceRuntimeData,
};

const resolveInitialWorkspaceId = async () => {
  if (state.filters.workspaceId && state.filters.workspaceId !== "all") return state.filters.workspaceId;
  const flows = await readRuntimeStore(runtimeStoreName("TL_FLOWS", "tl_flows")).catch(() => []);
  const flow = flows.find((item) => item.workspaceId) || null;
  if (flow?.workspaceId) return flow.workspaceId;
  const pages = await readRuntimeStore(runtimeStoreName("TL_PAGES", "tl_pages")).catch(() => []);
  const page = pages.find((item) => item.id || item.content?.id) || null;
  return page?.id || page?.content?.id || "workspace_global";
};

const enrichNodesWithLibrarySample = (nodes = [], libraryItems = []) => {
  const sampleById = new Map();
  libraryItems.forEach((item) => {
    if (!item.sampleOutput || typeof item.sampleOutput !== "object") return;
    [item.id, item.sourceId, item.assetId].filter(Boolean).forEach((id) => sampleById.set(String(id), item.sampleOutput));
  });
  return nodes.map((node) => {
    if (node.metadata?.sampleOutput && Object.keys(node.metadata.sampleOutput).length) return node;
    const sampleOutput = sampleById.get(String(node.assetId || node.sourceRef || node.id));
    if (!sampleOutput) return node;
    return {
      ...node,
      metadata: {
        ...(node.metadata || {}),
        sampleOutput,
      },
    };
  });
};

const nodeLookupKeys = (node = {}) =>
  [node.id, node.sourceRef, node.assetId, node.label]
    .filter(Boolean)
    .flatMap((value) => [String(value), normalize(value)]);

const buildNodeLookup = (nodes = []) => {
  const lookup = new Map();
  nodes.forEach((node) => {
    nodeLookupKeys(node).forEach((key) => {
      if (key && !lookup.has(key)) lookup.set(key, node);
    });
  });
  return lookup;
};

const resolveNodeRef = (lookup, ...values) => {
  for (const value of values.filter(Boolean)) {
    const direct = lookup.get(String(value));
    if (direct) return direct;
    const normalized = lookup.get(normalize(value));
    if (normalized) return normalized;
  }
  return null;
};

const dependencyKey = (dependency) =>
  [dependency.sourceNodeId, dependency.targetNodeId, dependency.channel || "runtime"].join("::");

const mergeConnectionDependencies = (nodes = [], dependencies = [], connections = []) => {
  const lookup = buildNodeLookup(nodes);
  const merged = [...dependencies];
  const seen = new Set(merged.map(dependencyKey));

  connections.forEach((connection) => {
    const source = resolveNodeRef(lookup, connection.fromBoxId, connection.sourceNodeId, connection.from, connection.sourceName);
    const target = resolveNodeRef(lookup, connection.toBoxId, connection.targetNodeId, connection.to, connection.targetName);
    if (!source || !target || source.id === target.id) return;
    const dependency = {
      id: `conn_dep_${connection.id || source.id}_${target.id}`.replace(/[^A-Za-z0-9_-]/g, "_"),
      workspaceId: connection.workspaceId || source.workspaceId || target.workspaceId || "",
      sourceNodeId: source.id,
      targetNodeId: target.id,
      sourceType: source.type || "",
      targetType: target.type || "",
      channel: connection.channel || nodeChannels(source)[0] || nodeChannels(target)[0] || "runtime",
      connectionId: connection.id || "",
      status: connection.status || "active",
      metadata: {
        virtual: false,
        source: "tl_connections",
        ...(connection.mapping || {}),
        sourcePort: connection.mapping?.sourcePort || "all",
        targetPort: connection.mapping?.targetPort || "all",
      },
      updatedAt: connection.updatedAt || "",
    };
    const key = dependencyKey(dependency);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(dependency);
  });

  return merged;
};

const mergeOptimisticDependencies = (nodes = [], dependencies = []) => {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const merged = [...dependencies];
  const seen = new Set(merged.map(dependencyKey));
  const stillPending = [];

  (state.optimisticDependencies || []).forEach((dependency) => {
    if (!nodeIds.has(dependency.sourceNodeId) || !nodeIds.has(dependency.targetNodeId)) return;
    const key = dependencyKey(dependency);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(dependency);
    }
    stillPending.push(dependency);
  });

  state.optimisticDependencies = stillPending;
  return merged;
};

const runtimeChannelForDependency = (nodesById = new Map(), dependency = {}) => {
  const source = nodesById.get(dependency.sourceNodeId);
  const target = nodesById.get(dependency.targetNodeId);
  if (!source || !target) return dependency.channel || "runtime";
  const sourcePort = dependency.metadata?.sourcePort || dependency.sourcePort || "";
  const targetPort = dependency.metadata?.targetPort || dependency.targetPort || "";
  const channel = dependency.channel || "";
  if (normalizePortChannel(sourcePort)) return normalizePortChannel(sourcePort);
  const naturalChannel = channelForConnection(source, target);
  if (channel && channel !== targetPort) return channel;
  return naturalChannel || normalizePortChannel(targetPort) || channel || "runtime";
};

const normalizeRuntimeDependencyChannels = async (nodes = [], dependencies = [], connections = []) => {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const connectionsById = new Map((connections || []).map((connection) => [connection.id, connection]));
  const changed = [];
  const normalized = dependencies.map((dependency) => {
    const channel = runtimeChannelForDependency(nodesById, dependency);
    if (!channel || channel === dependency.channel) return dependency;
    const next = { ...dependency, channel, updatedAt: new Date().toISOString() };
    changed.push(next);
    return next;
  });
  if (changed.length) {
    await Promise.all(changed.map(async (dependency) => {
      await window.TrackerLensRuntimeGraphStore?.upsertDependency?.({ dependency }).catch(() => null);
      const connection = connectionsById.get(dependency.connectionId || "");
      if (connection && connection.channel !== dependency.channel) {
        await window.TrackerLensConnectionsStore?.upsert?.({
          ...connection,
          channel: dependency.channel,
          frequency: dependency.channel,
          updatedAt: new Date().toISOString(),
        }).catch(() => null);
      }
    })).catch((error) => console.warn("Dependency channel repair non persistito", error));
  }
  return normalized;
};

const connectionFromRuntimeDependency = ({ dependency = {}, source = {}, target = {} } = {}) => {
  const now = new Date().toISOString();
  const workspaceId = dependency.workspaceId || source.workspaceId || target.workspaceId || "workspace_global";
  const connectionId = dependency.connectionId || `dep_conn_${dependency.id || Date.now()}`;
  const channel = dependency.channel || dependency.metadata?.sourcePort || nodeChannels(source)[0] || "runtime";

  return {
    id: connectionId,
    name: `${source.label || source.id} -> ${target.label || target.id}`,
    type: `${source.type || "node"} -> ${target.type || "node"}`,
    from: source.label || source.id,
    fromKind: source.type || "node",
    to: target.label || target.id,
    targetMeta: target.sourceRef || target.assetId || target.id,
    status: dependency.status || "active",
    lastTest: "Mai",
    result: "Riparato da runtime dependency",
    method: "EVENT",
    frequency: channel,
    timeout: "10 secondi",
    retries: 0,
    endpoint: `flowmap://${workspaceId}/${connectionId}`,
    workspaceId,
    workspaceName: workspaceId,
    fromBoxId: source.id,
    toBoxId: target.id,
    sourceNodeId: source.id,
    targetNodeId: target.id,
    sourceName: source.label || source.id,
    targetName: target.label || target.id,
    channel,
    mapping: {
      ...(dependency.metadata || {}),
      sourcePort: dependency.metadata?.sourcePort || channel || "output",
      targetPort: dependency.metadata?.targetPort || target.inputs?.[0] || "input",
    },
    createdAt: dependency.createdAt || now,
    updatedAt: now,
  };
};

const repairMissingDependencyConnections = async (nodes = [], dependencies = [], connections = []) => {
  if (!window.TrackerLensConnectionsStore?.upsert) return connections;
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const connectionIds = new Set((connections || []).map((connection) => connection.id).filter(Boolean));
  const repaired = [];

  for (const dependency of dependencies || []) {
    if (!dependency.connectionId || connectionIds.has(dependency.connectionId)) continue;
    const source = nodesById.get(dependency.sourceNodeId);
    const target = nodesById.get(dependency.targetNodeId);
    if (!source?.id || !target?.id) continue;
    const connection = connectionFromRuntimeDependency({ dependency, source, target });
    const saved = await window.TrackerLensConnectionsStore.upsert(connection).catch(() => null);
    if (saved?.id) {
      repaired.push(saved);
      connectionIds.add(saved.id);
    }
  }

  return repaired.length ? [...connections, ...repaired] : connections;
};

const normalizeLoadedNodeManifest = (node = {}) => {
  const metadata = node.metadata || {};
  const subtype = metadata.subtype || nodeSubtype(node);
  const isWorldDatabase = node.type === "knowledge" && subtype === "world-database";
  const stripWorldGraphContextPort = (ports = []) => (ports || []).filter((port) => {
    const name = typeof port === "string" ? port : port?.name || port?.key || "";
    return !isWorldDatabase || name !== "knowledge.graph.context";
  });
  const normalizedConfig = isWorldDatabase
    ? {
      ...(metadata.config || {}),
      outputChannel: metadata.config?.outputChannel === "knowledge.graph.context" ? "world.database.updated" : metadata.config?.outputChannel,
    }
    : metadata.config;
  const manifest = window.TrackerLensRuntimeManifest?.normalizeManifest?.({
    ...(metadata.manifest || {}),
    type: metadata.manifest?.type || (node.type === "boxLens" ? "lens" : node.type),
    subtype: metadata.manifest?.subtype || subtype,
    category: metadata.manifest?.category || metadata.category || nodeCategory(node),
    inputs: stripWorldGraphContextPort(metadata.manifest?.inputs || node.inputs || []),
    outputs: stripWorldGraphContextPort(metadata.manifest?.outputs || node.outputs || []),
    permissions: metadata.manifest?.permissions || metadata.permissions || node.permissions || [],
    settingsSchema: metadata.manifest?.settingsSchema || metadata.settingsSchema || {},
    runtime: metadata.manifest?.runtime || metadata.runtimeMetadata || node.runtime || {},
  });
  if (!manifest) return node;
  const inputs = stripWorldGraphContextPort(node.inputs || manifest.inputs || []);
  const outputs = stripWorldGraphContextPort(node.outputs || manifest.outputs || []);
  const channels = stripWorldGraphContextPort(node.channels || [...inputs, ...outputs]);
  return {
    ...node,
    inputs,
    outputs,
    channels,
    metadata: {
      ...metadata,
      manifest,
      permissions: manifest.permissions,
      settingsSchema: manifest.settingsSchema,
      runtimeMetadata: manifest.runtime,
      config: normalizedConfig,
    },
  };
};

const needsWorldDatabasePortMigration = (node = {}) => {
  const metadata = node.metadata || {};
  const subtype = metadata.subtype || nodeSubtype(node);
  if (node.type !== "knowledge" || subtype !== "world-database") return false;
  const hasGraphContext = (ports = []) => (ports || []).some((port) => {
    const name = typeof port === "string" ? port : port?.name || port?.key || "";
    return name === "knowledge.graph.context";
  });
  return (
    hasGraphContext(node.inputs) ||
    hasGraphContext(node.outputs) ||
    hasGraphContext(node.channels) ||
    hasGraphContext(metadata.manifest?.inputs) ||
    hasGraphContext(metadata.manifest?.outputs) ||
    metadata.config?.outputChannel === "knowledge.graph.context"
  );
};

const persistWorldDatabasePortMigrations = async (originalNodes = [], normalizedNodes = []) => {
  if (!window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode) return;
  const normalizedById = new Map((normalizedNodes || []).map((node) => [node.id, node]));
  const migrations = (originalNodes || [])
    .filter(needsWorldDatabasePortMigration)
    .map((node) => normalizedById.get(node.id))
    .filter(Boolean);
  for (const node of migrations) {
    await window.TrackerLensRuntimeGraphStore.upsertRuntimeNode({ node }).catch(() => null);
  }
};

const sortById = (items = []) =>
  [...items].sort((a, b) => String(a.id || a.name || "").localeCompare(String(b.id || b.name || "")));

const runtimeGraphSignature = () => JSON.stringify({
  nodes: sortById(state.runtime.nodes).map((node) => ({
    id: node.id,
    sourceRef: node.sourceRef,
    assetId: node.assetId,
    type: node.type,
    label: node.label,
    workspaceId: node.workspaceId,
    status: node.status,
    inputs: node.inputs || [],
    outputs: node.outputs || [],
    channels: node.channels || [],
    flowPosition: node.flowPosition || null,
    configured: Boolean(node.metadata?.configured),
    draft: Boolean(node.metadata?.draft),
    library: Boolean(node.metadata?.library),
  })),
  dependencies: sortById(state.runtime.dependencies).map((dependency) => ({
    id: dependency.id,
    sourceNodeId: dependency.sourceNodeId,
    targetNodeId: dependency.targetNodeId,
    channel: dependency.channel,
    status: dependency.status,
    connectionId: dependency.connectionId || "",
    sourcePort: dependency.metadata?.sourcePort || dependency.sourcePort || "",
    targetPort: dependency.metadata?.targetPort || dependency.targetPort || "",
    virtual: Boolean(dependency.metadata?.virtual),
  })),
  flows: sortById(state.runtime.flows).map((flow) => ({
    id: flow.id,
    workspaceId: flow.workspaceId,
    name: flow.name,
    updatedAt: flow.updatedAt || flow.savedAt || "",
  })),
});

const loadRuntime = async (options = {}) => {
  const silent = Boolean(options.silent);
  const force = Boolean(options.force);
  const previousGraphSignature = runtimeGraphSignature();
  if (state.runtimeLoadInFlight && !force) {
    state.pendingRuntimeRefresh = true;
    return;
  }
  state.runtimeLoadInFlight = true;
  if (state.interaction && !force) {
    state.pendingRuntimeRefresh = true;
    state.runtimeLoadInFlight = false;
    return;
  }
  state.loading = !silent;
  state.error = "";
  setLoadingSignal(state.loading);
  setErrorSignal(state.error);
  if (!silent) mount();

  try {
    const workspaceId = normalizeRuntimeWorkspaceId(await resolveInitialWorkspaceId());
    const workspaceChanged = workspaceId !== state.filters.workspaceId;
    if (workspaceChanged) state.viewport = loadStoredViewport(workspaceId) || defaultViewport();
    if (workspaceChanged || state.filters.origin === "library") {
      setFiltersState({ ...state.filters, workspaceId, origin: state.filters.origin === "library" ? "runtime" : state.filters.origin });
      syncFilterQuery();
    }

    const runtimeFilters = { workspaceId };
    const engineResult = window.TrackerLensGraphEngine?.buildGraph
      ? await window.TrackerLensGraphEngine.buildGraph({ filters: runtimeFilters, includeConnections: true })
      : null;
    const snapshot = engineResult?.runtime || (window.TrackerLensRuntimeSnapshotStore?.load
      ? await window.TrackerLensRuntimeSnapshotStore.load({ includeConnections: true, workspaceId })
      : null);
    const [channels, flows, events, flowLogs, runtimeNodes, dependencies, connections, libraryItems, performanceRecords] = snapshot
      ? await Promise.all([
        Promise.resolve(snapshot.channels),
        Promise.resolve(snapshot.flows),
        Promise.resolve(snapshot.events),
        Promise.resolve(snapshot.flowLogs || []),
        Promise.resolve(snapshot.runtimeNodes),
        Promise.resolve(snapshot.runtimeDependencies),
        Promise.resolve(snapshot.connections),
        Promise.resolve([]),
        window.TrackerLensBoxPerformanceMonitor?.list ? window.TrackerLensBoxPerformanceMonitor.list({ workspaceId }) : Promise.resolve([]),
      ])
      : await Promise.all([
        readScopedRuntimeStore(runtimeStoreName("TL_CHANNELS", "tl_channels"), workspaceId),
        readScopedRuntimeStore(runtimeStoreName("TL_FLOWS", "tl_flows"), workspaceId),
        readScopedRuntimeStore(runtimeStoreName("TL_EVENTS", "tl_events"), workspaceId),
        readScopedRuntimeStore(runtimeStoreName("TL_FLOW_LOGS", "tl_flow_logs"), workspaceId),
        readScopedRuntimeStore(runtimeStoreName("TL_RUNTIME_NODES", "tl_runtime_nodes"), workspaceId),
        readScopedRuntimeStore(runtimeStoreName("TL_RUNTIME_DEPENDENCIES", "tl_runtime_dependencies"), workspaceId),
        window.TrackerLensConnectionsStore?.list ? window.TrackerLensConnectionsStore.list().then((items) => items.filter((item) => item.workspaceId === workspaceId)) : Promise.resolve([]),
        Promise.resolve([]),
        window.TrackerLensBoxPerformanceMonitor?.list ? window.TrackerLensBoxPerformanceMonitor.list({ workspaceId }) : Promise.resolve([]),
      ]);

    if (state.interaction && !force) {
      state.pendingRuntimeRefresh = true;
      return;
    }

    const enrichedNodes = await resolveAiAgentAliasNodes(enrichNodesWithLibrarySample(runtimeNodes, libraryItems));
    const loadedNodes = enrichedNodes.map(normalizeLoadedNodeManifest);
    await persistWorldDatabasePortMigrations(enrichedNodes, loadedNodes);
    const nodes = await syncEmbeddedFlowMapAliases(loadedNodes);
    const mergedDependencies = await normalizeRuntimeDependencyChannels(
      nodes,
      mergeOptimisticDependencies(nodes, mergeConnectionDependencies(nodes, dependencies, connections)),
      connections
    );
    const repairedConnections = await repairMissingDependencyConnections(nodes, mergedDependencies, connections);
    setRuntimeState({
      channels,
      flows,
      events: recentRuntimeRecords(events).map(sanitizeRuntimeEventForUi),
      flowLogs: recentRuntimeRecords(flowLogs).map(sanitizeFlowLogForUi),
      nodes,
      dependencies: mergedDependencies,
    });
    state.previewClearedAt = loadStoredPreviewClears(workspaceId);
    rebuildPreviewPayloadsFromEvents();
    if (state.testRun?.running || hasRendererOnlyPythonPocNode(nodes)) {
      syncPageRuntimes(workspaceId);
    } else if (!syncBackgroundRuntime(workspaceId, { forceRefresh: force })) {
      syncPageRuntimes(workspaceId);
    }
    state.graphEngine = engineResult;
    state.libraryItems = libraryItems;
    state.connections = repairedConnections;
    state.performance = performanceRecords || [];
    if (state.inspectorOpen && !state.focus.nodeId && nodes[0]?.id) {
      setFocusState({ ...state.focus, nodeId: nodes[0].id });
    }
    state.updatedAt = new Date();
    setUpdatedAtSignal(state.updatedAt);
  } catch (error) {
    console.error("Errore Flow Map:", error);
    state.error = error?.message || "Errore caricamento Flow Map";
    setErrorSignal(state.error);
  } finally {
    state.runtimeLoadInFlight = false;
    state.loading = false;
    setLoadingSignal(state.loading);
    if (!state.interaction) {
      const nextGraphSignature = runtimeGraphSignature();
      const editorActive = isFlowMapNodeEditorActive();
      const canPatchRuntime = silent && state.mounted && !state.error && (previousGraphSignature === nextGraphSignature || editorActive);
      if (canPatchRuntime) refreshRuntimeDom({ preserveScroll: true });
      else mount({ preserveScroll: silent });
      if (editorActive && previousGraphSignature !== nextGraphSignature) state.pendingRuntimeRefresh = true;
    }
  }
};

const runtimeEventBus = () => {
  if (!window.TrackerLensEventBus?.get) return null;
  const workspaceId = normalizeRuntimeWorkspaceId(state.filters.workspaceId || state.runtime.flows[0]?.workspaceId || "workspace_global");
  return window.TrackerLensEventBus.get(workspaceId);
};

const workspaceEventBus = (workspaceId = state.filters.workspaceId || "workspace_global") => {
  if (!window.TrackerLensEventBus?.get) return null;
  return window.TrackerLensEventBus.get(workspaceId || "workspace_global", {
    eventStore: window.TrackerLensEventLogStore,
    channelRegistry: window.TrackerLensChannelRegistry,
  });
};

const eventMatchesFilters = (event = {}) => {
  if (state.filters.workspaceId !== "all" && event.workspaceId !== state.filters.workspaceId) return false;
  if (state.filters.channel !== "all" && event.channel !== state.filters.channel) return false;
  return true;
};

const eventTypeGroup = (event = {}) => {
  const type = String(event.eventType || "event");
  if (event.status === "error" || type.includes("error")) return "errors";
  if (type === "tracker_test" || type.includes("test") || event.meta?.test) return "test";
  if (type === "received") return "received";
  if (type === "emitted") return "emitted";
  return "other";
};

const eventMatchesTypeFilter = (event = {}, filter = state.filters.eventType || "all") =>
  filter === "all" || eventTypeGroup(event) === filter;

const runtimeRecordRunId = (record = {}) =>
  record.meta?.runId || record.context?.runId || record.payload?.runId || "";

const recordMatchesRunFilter = (record = {}, runId = state.filters.runId || "all") =>
  runId === "all" || runtimeRecordRunId(record) === runId;

const filteredRuntimeEvents = () =>
  state.runtime.events
    .filter((event) => eventMatchesTypeFilter(event))
    .filter((event) => recordMatchesRunFilter(event));

const mergeRuntimeEvent = (event = {}) => {
  if (!event.id) return false;
  if (state.runtime.events.some((item) => item.id === event.id)) {
    return false;
  }
  const safeEvent = sanitizeRuntimeEventForUi(event);
  state.runtime.events = [safeEvent, ...state.runtime.events];
  updateAiProcessingFromEvent(safeEvent);
  updatePreviewPayloads(safeEvent);
  state.runtime.channels = state.runtime.channels.map((channel) =>
    channel.workspaceId === safeEvent.workspaceId && channel.name === safeEvent.channel
      ? { ...channel, lastValue: safeEvent.payload, lastEmittedAt: safeEvent.createdAt, updatedAt: safeEvent.createdAt }
      : channel
  );
  setRuntimeSignal(state.runtime);
  if (typeof refreshOpenAiAgentRuntimeDialog === "function") {
    refreshOpenAiAgentRuntimeDialog(safeEvent);
  }
  scheduleRuntimeDomRefresh({ preserveScroll: true });
  return true;
};

const scheduleRuntimeDomRefresh = ({ preserveScroll = true } = {}) => {
  if (isFlowMapRecoveryMode()) return;
  requestAnimationFrame(() => {
    if (!state.mounted || state.interaction) return;
    const baseGraph = graphModel();
    const activity = recentActivity(baseGraph);
    const graph = filterByActivity(baseGraph, activity);
    state.edgeRender = { graph, activity };
    refreshRuntimeDom({ preserveScroll });
  });
};

const isPreviewNode = (node = {}) =>
  node.type === "devPreview" || nodeSubtype(node) === "preview" || nodeCategory(node) === "dev";

const dependencyChannelForEvent = (dependency = {}) =>
  dependency.channel || normalizePortChannel(dependency.metadata?.sourcePort || dependency.sourcePort) || "";

const previewDependenciesForEvent = (event = {}) => {
  const nodesById = new Map((state.runtime.nodes || []).map((node) => [node.id, node]));
  return (state.runtime.dependencies || [])
    .filter((dependency) => dependencyChannelForEvent(dependency) === event.channel)
    .filter((dependency) => isPreviewNode(nodesById.get(dependency.targetNodeId)));
};

const previewNodesForEvent = (event = {}) => {
  const nodesById = new Map((state.runtime.nodes || []).map((node) => [node.id, node]));
  const previewIncomingDependencies = (state.runtime.dependencies || [])
    .filter((dependency) => isPreviewNode(nodesById.get(dependency.targetNodeId)));
  const directTargets = previewDependenciesForEvent(event)
    .map((dependency) => nodesById.get(dependency.targetNodeId))
    .filter(isPreviewNode);
  const inputTargets = (state.runtime.nodes || [])
    .filter(isPreviewNode)
    .filter((node) => !previewIncomingDependencies.some((dependency) => dependency.targetNodeId === node.id))
    .filter((node) => (node.inputs || []).includes(event.channel) || (node.channels || []).includes(event.channel));
  return [...new Map([...directTargets, ...inputTargets].filter(Boolean).map((node) => [node.id, node])).values()];
};

const previewPayloadForNodeEvent = (node = {}, event = {}) => {
  const dependency = previewDependenciesForEvent(event)
    .find((item) => item.targetNodeId === node.id && (!event.sourceNodeId || !item.sourceNodeId || item.sourceNodeId === event.sourceNodeId)) ||
    previewDependenciesForEvent(event).find((item) => item.targetNodeId === node.id) ||
    null;
  const mapping = dependency?.metadata || null;
  if (!mapping || !window.TrackerLensRuntimeContract?.applyConnectionMapping) {
    return {
      payload: event.payload,
      mappingResult: null,
      dependency,
    };
  }
  const mappingResult = window.TrackerLensRuntimeContract.applyConnectionMapping(event.payload, mapping);
  return {
    payload: mappingResult.payload,
    mappingResult,
    dependency,
  };
};

const updateAiProcessingFromEvent = (event = {}) => {
  const graph = state.runtime || { nodes: [], dependencies: [] };
  const nodesById = new Map((graph.nodes || []).map((node) => [node.id, node]));
  const runId = event.meta?.runId || event.payload?.runId || "";
  const inputEventId = event.id || "";
  const eventType = String(event.eventType || "").toLowerCase();

  if (eventType.includes("ai_agent_response") || eventType.includes("ai_agent_error")) {
    const nodeId = event.sourceNodeId || event.meta?.aiAgentRuntime || "";
    if (nodeId && state.aiProcessing[nodeId]) {
      state.aiProcessing = { ...state.aiProcessing };
      delete state.aiProcessing[nodeId];
    }
    return;
  }

  const targets = (graph.dependencies || [])
    .filter((dependency) => dependency.channel === event.channel)
    .map((dependency) => nodesById.get(dependency.targetNodeId))
    .filter((node) => runtimeKindForNode(node) === "ai");
  if (!targets.length) return;
  const now = new Date().toISOString();
  state.aiProcessing = {
    ...state.aiProcessing,
    ...Object.fromEntries(targets.map((node) => [node.id, {
      nodeId: node.id,
      runId,
      inputEventId,
      inputChannel: event.channel || "",
      startedAt: now,
      expiresAt: new Date(Date.now() + AI_PROCESSING_VISUAL_TIMEOUT_MS).toISOString(),
    }])),
  };
};

const activeAiProcessingNodeIds = () => {
  const now = Date.now();
  const entries = Object.entries(state.aiProcessing || {})
    .filter(([, item]) => Date.parse(item.expiresAt || "") > now);
  if (entries.length !== Object.keys(state.aiProcessing || {}).length) {
    state.aiProcessing = Object.fromEntries(entries);
  }
  return entries.map(([nodeId]) => nodeId);
};

const activeProcessingEdgeIds = (graph = state.runtime) =>
  activeOutgoingDependencyIds(graph, activeAiProcessingNodeIds());

const isPreviewPayloadEvent = (event = {}) => {
  const type = String(event.eventType || "").toLowerCase();
  if (!type) return true;
  if (type.includes("pulse")) return false;
  if (event.payload?.route && event.payload?.channel && (event.payload?.live || event.payload?.__test)) return false;
  return true;
};

const updatePreviewPayloads = (event = {}) => {
  if (!isPreviewPayloadEvent(event)) return;
  const sourcePayload = event.originalPayload !== undefined && event.originalPayload !== null ? event.originalPayload : event.payload;
  previewNodesForEvent(event).forEach((node) => {
    const clearedAt = Date.parse(state.previewClearedAt[node.id] || "");
    const nodeCreatedAt = Date.parse(node.createdAt || "");
    const eventAt = Date.parse(event.createdAt || "");
    const visibleAfter = Math.max(clearedAt || 0, nodeCreatedAt || 0);
    if (visibleAfter && eventAt && eventAt <= visibleAfter) return;
    const mapped = previewPayloadForNodeEvent(node, { ...event, payload: sourcePayload });
    state.previewPayloads[node.id] = {
      eventId: event.id,
      channel: event.channel || "default",
      eventType: event.eventType || "event",
      sourceNodeId: event.sourceNodeId || "",
      payload: mapped.payload,
      originalPayload: mapped.mappingResult?.changed || event.originalPayload !== undefined ? sourcePayload : null,
      mapping: mapped.mappingResult?.mapping || null,
      mappingWarnings: mapped.mappingResult?.warnings || [],
      mappingDependencyId: mapped.dependency?.id || "",
      createdAt: event.createdAt || new Date().toISOString(),
      sizeBytes: event.sizeBytes || 0,
    };
  });
};

const rebuildPreviewPayloadsFromEvents = () => {
  state.previewPayloads = {};
  (state.runtime.events || [])
    .slice()
    .sort((a, b) => Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0))
    .forEach(updatePreviewPayloads);
};

const mergeFlowLog = (log = {}) => {
  if (!log.id) return false;
  if ((state.runtime.flowLogs || []).some((item) => item.id === log.id)) return false;
  state.runtime.flowLogs = [sanitizeFlowLogForUi(log), ...(state.runtime.flowLogs || [])];
  setRuntimeSignal(state.runtime);
  return true;
};

const scheduleLiveRender = () => {
  if (isFlowMapRecoveryMode()) return;
  if (state.liveRenderFrame) return;
  state.liveRenderFrame = requestAnimationFrame(() => {
    state.liveRenderFrame = 0;
    if (state.interaction) {
      state.pendingRuntimeRefresh = true;
      return;
    }
    refreshLiveGraphState();
    window.clearTimeout(state.liveActivityClearTimer);
    state.liveActivityClearTimer = window.setTimeout(() => {
      state.liveActivityClearTimer = 0;
      refreshLiveGraphState();
    }, EDGE_ACTIVITY_WINDOW_MS + 120);
  });
};

const refreshLiveBusDom = () => {
  const pill = document.querySelector("[data-live-bus-pill]");
  if (pill) {
    pill.className = `tl-flow-live is-bus${state.liveBus.connected ? " is-connected" : ""}${state.liveBus.lastAt ? " is-receiving" : ""}${!state.liveBus.available ? " is-offline" : ""}`;
    pill.title = liveBusTitle();
  }
  const dotNode = pill?.querySelector(".tl-flow-dot");
  if (dotNode) {
    dotNode.className = `tl-flow-dot ${state.liveBus.connected ? "is-connected" : !state.liveBus.available ? "is-offline" : "is-standby"}`;
  }
  const label = document.querySelector("[data-live-bus-label]");
  if (label) label.textContent = liveBusLabel();
  const updated = document.querySelector("[data-flow-status-updated]");
  if (updated) updated.textContent = state.liveBus.lastAt ? `Live ${formatShortDate(state.liveBus.lastAt)}` : `Updated ${formatShortDate(state.updatedAt)}`;
  const statusButton = document.querySelector("[data-status-item='bus']");
  if (statusButton) {
    statusButton.classList.toggle("is-green", state.liveBus.connected);
    statusButton.classList.toggle("is-gold", !state.liveBus.connected);
    const statusLabel = statusButton.querySelector("[data-status-label]");
    if (statusLabel) statusLabel.textContent = state.liveBus.connected ? `${state.liveBus.count} live bus` : "bus offline";
  }
};

const updateLiveClasses = (graph, activity) => {
  document.querySelectorAll(".tl-flow-node-port.is-event-active").forEach((port) => {
    port.classList.remove("is-event-active");
  });
  const processingNodeIds = new Set(activeAiProcessingNodeIds());
  const processingEdgeIds = new Set(activeProcessingEdgeIds(graph));

  (graph.nodes || []).forEach((node) => {
    const element = document.querySelector(`[data-flow-node-id="${escapeSelectorValue(node.id)}"]`);
    const live = activity.nodeActivity?.get(node.id);
    const activeTestNode = state.testRun.running && (state.testRun.activeNodeIds || []).includes(node.id);
    const processingNode = processingNodeIds.has(node.id);
    if (!element) return;
    element.classList.toggle("is-live", Boolean(live) || activeTestNode || processingNode);
    element.classList.toggle("is-event-active", Boolean(live) || activeTestNode || processingNode);
    element.classList.toggle("is-ai-processing", processingNode);
    element.classList.toggle("is-orchestrating", live?.status === "orchestrating");
    element.classList.toggle("is-task-complete", live?.status === "complete");
    element.classList.toggle("is-busy", live?.status === "busy");
    element.classList.toggle("is-waiting", live?.phase === "waiting" || live?.phase === "thinking");
    element.classList.toggle("is-queued", live?.status === "queued");
    element.classList.toggle("is-overloaded", live?.status === "overloaded");
    element.classList.toggle("is-error", live?.status === "error" || live?.status === "overloaded");
  });

  (graph.dependencies || []).forEach((dependency) => {
    const element = document.querySelector(`.tl-flow-edge-label[data-edge-id="${escapeSelectorValue(dependency.id)}"]`);
    const live = activity.edgeActivity?.get(dependency.id);
    const activeTestEdge = state.testRun.running && (state.testRun.activeEdgeIds || []).includes(dependency.id);
    const processingEdge = processingEdgeIds.has(dependency.id);
    if (!element) return;
    element.classList.toggle("is-live", Boolean(live) || activeTestEdge || processingEdge);
    element.classList.toggle("is-error", live?.status === "error");
    if (live || activeTestEdge || processingEdge) {
      [
        [dependency.sourceNodeId, "out", dependencyPort(dependency, "out")],
        [dependency.targetNodeId, "in", dependencyPort(dependency, "in")],
      ].forEach(([nodeId, side, port]) => {
        const selector = `.tl-flow-node[data-flow-node-id="${escapeSelectorValue(nodeId)}"] .tl-flow-node-port[data-port-side="${side}"][data-port-label="${escapeSelectorValue(port || "all")}"]`;
        document.querySelectorAll(selector).forEach((portElement) => {
          portElement.classList.add("is-event-active");
        });
      });
    }
  });
};

const refreshLiveGraphState = () => {
  const baseGraph = graphModel();
  const activity = recentActivity(baseGraph);
  const graph = filterByActivity(baseGraph, activity);
  state.edgeRender = { graph, activity };
  refreshLiveBusDom();
  updateLiveClasses(graph, activity);
  renderFlowEdges();
};

const connectLiveEventBus = () => {
  state.liveBus.available = Boolean(window.TrackerLensEventBus?.get);
  if (isFlowMapRecoveryMode()) {
    state.liveBus.connected = false;
    state.liveBus.lastChannel = "recovery";
    return;
  }
  const workspaceId = normalizeRuntimeWorkspaceId(state.filters.workspaceId || state.runtime.flows[0]?.workspaceId || "workspace_global");
  if (state.liveBusUnsubscribe && state.liveBus.workspaceId && state.liveBus.workspaceId !== workspaceId) {
    state.liveBusUnsubscribe();
    state.liveBusUnsubscribe = null;
    state.liveBus.connected = false;
    state.liveBus.workspaceId = "";
  }
  if (state.liveBusUnsubscribe) return;
  const bus = runtimeEventBus();
  if (!bus?.on) {
    state.liveBus.connected = false;
    return;
  }
  state.liveBus.workspaceId = workspaceId;
  state.liveBusUnsubscribe = bus.on("*", (payload, event) => {
    state.liveBus.connected = true;
    state.liveBus.count += 1;
    state.liveBus.lastAt = event.createdAt || new Date().toISOString();
    state.liveBus.lastChannel = event.channel || "default";
    if (!eventMatchesFilters(event)) return;
    if (!mergeRuntimeEvent(event)) return;
    state.updatedAt = new Date();
    scheduleLiveRender();
  }, {
    id: "flow-map-live-inspector",
    targetNodeId: "flow-map",
    metadata: { source: "flow-map" },
  });
  state.liveBus.connected = true;
  requestAnimationFrame(refreshLiveBusDom);
};

const normalize = (value) => String(value || "").toLowerCase();
const graphModelApi = () => window.TrackerLensRuntimeGraphModel;
const nodeChannels = (node = {}) => node ? graphModelApi().nodeChannels(node) : [];
const graphTone = (nodeOrType = "") => {
  const node = typeof nodeOrType === "object" ? nodeOrType : null;
  return graphModelApi().toneForType(node?.type || nodeOrType, node);
};
const graphIcon = (nodeOrType = "") => {
  const node = typeof nodeOrType === "object" ? nodeOrType : null;
  return graphModelApi().iconForType(node?.type || nodeOrType, node);
};

const nodeRuntimeStatus = (node = {}, live = null) => {
  const raw = node.runtime?.status || node.metadata?.runtimeStatus || node.status || (live ? "active" : "idle");
  const status = isDraftNode(node) ? "idle" : String(raw || "idle").toLowerCase();
  if (live?.status === "error") return "error";
  if (["busy", "queued", "overloaded"].includes(live?.status)) return live.status;
  if (status === "active" && live) return "running";
  return ["idle", "active", "running", "busy", "queued", "overloaded", "warning", "paused", "error", "disconnected", "disabled"].includes(status) ? status : "idle";
};

const nodeCategory = (node = {}) => {
  const safeNode = node && typeof node === "object" ? node : {};
  return safeNode.metadata?.category || safeNode.metadata?.manifest?.category || safeNode.metadata?.runtimeType || safeNode.type || "runtime";
};

const nodeSubtype = (node = {}) => {
  const safeNode = node && typeof node === "object" ? node : {};
  return safeNode.metadata?.subtype || safeNode.metadata?.manifest?.subtype || safeNode.metadata?.mode || safeNode.type || "node";
};

const nodeRuntimeDescription = (node = {}, live = null) => {
  const category = nodeCategory(node);
  if (node.metadata?.description) return node.metadata.description;
  if (category === "sources" && nodeSubtype(node) === "task") return "Agent task source emitting objective, context and success conditions.";
  if (category === "sources") return "Input adapter ingesting raw external data.";
  if (nodeSubtype(node) === "world-graph-view") return "Visual worldbuilding graph view for World Database payloads.";
  if (category === "dev" || node.type === "devPreview") return "Development probe showing raw and JSON payloads passing through the graph.";
  if (category === "trackers" || node.type === "boxTracker") return "Data orchestrator emitting structured runtime channels.";
  if (category === "processors" || node.type === "processor") return "Stateless transformation node for runtime events.";
  if (category === "knowledge" || node.type === "knowledge") return "Local Knowledge runtime node for documents, chunks, embeddings and RAG context.";
  if (node.type === "aiAgent" && nodeSubtype(node) === "orchestrator") return "Central runtime brain that decides and dispatches connected nodes.";
  if (category === "ai-agents" || node.type === "aiAgent") return "AI decision node for analysis, routing and interpretation.";
  if (category === "lens" || node.type === "boxLens" || node.type === "lens") return "Visual runtime consumer rendering live channel state.";
  if (category === "actions" || node.type === "action") return "Active runtime reaction triggered by events.";
  if (category === "storage" || node.type === "storage") return "Persistence layer for runtime data and history.";
  if (isCustomRuntimeNode(node)) return "Custom runtime node.";
  return live ? "Runtime node receiving live events." : "Runtime graph node.";
};

const runtimeNodeBase = (node = {}, live = null, perf = null) => {
  const eventsPerMin = perf?.eventsPerSec ? Math.round(perf.eventsPerSec * 60) : live?.count || node.runtime?.eventsPerMin || 0;
  const latency = perf?.avgLatency || perf?.latency || node.runtime?.latency || 0;
  const persistedListeners = selectedChannelRecords(node).reduce((total, channel) => total + (channel.subscribers?.length || 0), 0);
  const connectedConsumers = (state.runtime.dependencies || []).filter((dependency) =>
    dependency.sourceNodeId === node.id &&
    String(dependency.metadata?.linkType || dependency.mapping?.linkType || "") !== "tool-access"
  ).length;
  return {
    id: node.id || "",
    workspaceId: node.workspaceId || "",
    flowId: node.flowId || "",
    category: nodeCategory(node),
    subtype: nodeSubtype(node),
    title: node.label || node.title || node.id || "Runtime Node",
    description: nodeRuntimeDescription(node, live),
    inputs: node.inputs || [],
    outputs: node.outputs || [],
    channels: nodeChannels(node),
    runtime: {
      status: nodeRuntimeStatus(node, live),
      active: Boolean(live || node.runtime?.active),
      errors: Number(node.runtime?.errors || 0),
      eventsPerMin,
      latency,
      lastEventAt: live?.lastAt || node.runtime?.lastEventAt || "",
    },
    metrics: {
      ...(node.metrics || {}),
      eventsPerMin,
      latency,
      listeners: Math.max(persistedListeners, connectedConsumers),
    },
    permissions: node.metadata?.permissions || node.metadata?.manifest?.permissions || node.permissions || [],
    position: node.flowPosition || node.position || { x: 0, y: 0 },
    style: node.style || {},
    createdAt: node.createdAt || "",
    updatedAt: node.updatedAt || "",
  };
};

const toneRgb = (tone = "cyan") => ({
  green: [34, 197, 94],
  blue: [56, 189, 248],
  violet: [168, 85, 247],
  purple: [147, 51, 234],
  gold: [250, 204, 21],
  orange: [249, 115, 22],
  red: [248, 113, 113],
  lime: [132, 204, 22],
  pink: [236, 72, 153],
  cyan: [34, 211, 238],
  teal: [20, 184, 166],
}[tone] || [34, 211, 238]);

const FLOW_NODE_CATEGORY_OPTIONS = [
  { value: "custom", label: "Custom" },
  { value: "sources", label: "Sources" },
  { value: "trackers", label: "Trackers" },
  { value: "flow-maps", label: "Flow Maps" },
  { value: "processors", label: "Processors" },
  { value: "knowledge", label: "Knowledge" },
  { value: "ai-agents", label: "AI Agents" },
  { value: "actions", label: "Actions" },
  { value: "storage", label: "Storage" },
  { value: "dev", label: "Dev" },
];

const FLOW_NODE_ICON_FALLBACK_OPTIONS = [
  { value: "extension", label: "Extension" },
  { value: "add_box", label: "Add Box" },
  { value: "api", label: "API" },
  { value: "settings_input_antenna", label: "WebSocket" },
  { value: "rss_feed", label: "RSS Feed" },
  { value: "webhook", label: "Webhook" },
  { value: "data_object", label: "JSON" },
  { value: "notes", label: "Notes" },
  { value: "storage", label: "Storage" },
  { value: "inventory_2", label: "Inventory" },
  { value: "sync_alt", label: "Realtime" },
  { value: "update", label: "Polling" },
  { value: "filter_alt", label: "Filter" },
  { value: "tune", label: "Tune" },
  { value: "alt_route", label: "Route" },
  { value: "psychology", label: "AI" },
  { value: "memory", label: "Memory" },
  { value: "dashboard", label: "Dashboard" },
  { value: "visibility", label: "Preview" },
  { value: "database", label: "Database" },
  { value: "notifications", label: "Notification" },
  { value: "bolt", label: "Trigger" },
];

const FLOW_NODE_ICON_OPTIONS = (() => {
  const values = new Map();
  const addOption = (option = {}) => {
    const value = String(option.value || "").trim();
    if (!value || values.has(value)) return;
    values.set(value, {
      value,
      label: option.label || value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
      icon: value,
      category: option.category || "",
      keywords: option.keywords || "",
    });
  };
  FLOW_NODE_ICON_FALLBACK_OPTIONS.forEach(addOption);
  (window.TrackerLensMaterialIconOptions || []).forEach(addOption);
  return Array.from(values.values());
})();

const FLOW_COMPONENT_ICON_OPTIONS = [
  { value: "", icon: "auto_awesome" },
  ...FLOW_NODE_ICON_OPTIONS,
];

const FLOW_NODE_TONE_OPTIONS = [
  { value: "gold", label: "Gold" },
  { value: "green", label: "Green" },
  { value: "blue", label: "Blue" },
  { value: "cyan", label: "Cyan" },
  { value: "violet", label: "Violet" },
  { value: "purple", label: "Purple" },
  { value: "pink", label: "Pink" },
  { value: "orange", label: "Orange" },
  { value: "red", label: "Red" },
  { value: "lime", label: "Lime" },
  { value: "teal", label: "Teal" },
];

const rgba = ([r, g, b], alpha = 1) => `rgba(${r}, ${g}, ${b}, ${alpha})`;

const workspaceOptions = () => {
  const values = new Map();
  state.runtime.flows.forEach((flow) => flow.workspaceId && values.set(flow.workspaceId, flow.name || flow.workspaceId));
  state.runtime.nodes.forEach((node) => {
    if (!node.workspaceId || values.has(node.workspaceId)) return;
    values.set(node.workspaceId, node.workspaceId);
  });
  if (state.filters.workspaceId && !values.has(state.filters.workspaceId)) values.set(state.filters.workspaceId, state.filters.workspaceId);
  return Array.from(values.entries()).map(([value, label]) => ({ value, label }));
};

const channelOptions = () => {
  const values = new Set();
  state.runtime.channels.forEach((channel) => channel.name && values.add(channel.name));
  state.runtime.dependencies.forEach((dependency) => dependency.channel && values.add(dependency.channel));
  state.runtime.nodes.forEach((node) => nodeChannels(node).forEach((channel) => values.add(channel)));
  return [{ value: "all", label: "Tutti i channel" }, ...Array.from(values).sort().map((channel) => ({ value: channel, label: channel }))];
};

const typeOptions = () => {
  const values = new Set(state.runtime.nodes.map((node) => node.type).filter(Boolean));
  return [{ value: "all", label: "Tutti i tipi" }, ...Array.from(values).sort().map((type) => ({ value: type, label: type }))];
};

const eventTypeOptions = () => [
  { value: "all", label: "All events" },
  { value: "emitted", label: "Emit" },
  { value: "received", label: "Recv" },
  { value: "test", label: "Test" },
  { value: "errors", label: "Errors" },
  { value: "other", label: "Other" },
];

const performanceByBox = () => new Map((state.performance || []).map((record) => [record.boxId, record]));
const nodePerformance = (node = {}) => {
  const records = performanceByBox();
  return records.get(node.id) || records.get(node.sourceRef) || records.get(node.assetId) || null;
};
const performanceTone = (perf = {}) => {
  if (!perf) return "";
  if (perf.health === "error" || perf.status === "error") return "red";
  if (perf.health === "warning" || Number(perf.errorRate) >= 5 || Number(perf.avgLatencyMs) >= 500) return "gold";
  if (perf.health === "healthy" || Number(perf.eventCount) > 0) return "green";
  return "blue";
};
const performanceLabel = (perf = {}) => {
  if (!perf) return "";
  const eps = Number(perf.eventsPerSec) || 0;
  const latency = Number(perf.avgLatencyMs) || Number(perf.lastLatencyMs) || 0;
  if (eps > 0) return `${eps.toFixed(2)} ev/s`;
  if (latency > 0) return `${Math.round(latency)} ms`;
  return perf.health || perf.status || "";
};

const graphModel = () => graphModelApi().build({ runtime: state.runtime, filters: state.filters });

const flowWorldNumber = (value, fallback = 0) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  const numeric = Number.isFinite(Number(text)) ? Number(text) : parseFloat(text);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const flowNodeWidth = (nodeOrPosition = {}) => {
  const raw = nodeOrPosition?.flowPosition?.width ?? nodeOrPosition?.metadata?.width ?? nodeOrPosition?.style?.width ?? nodeOrPosition?.width;
  const width = flowWorldNumber(raw, FLOW_NODE_DEFAULT_WIDTH);
  return Math.max(FLOW_NODE_MIN_WIDTH, Math.min(FLOW_NODE_MAX_WIDTH, width));
};

const cssFlowCoordinate = (value, fallback = 0) =>
  `${flowWorldNumber(value, fallback)}px`;

const normalizeFlowPosition = (position = {}) => ({
  x: cssFlowCoordinate(position.x),
  y: cssFlowCoordinate(position.y),
  width: flowNodeWidth(position),
});

const nodePosition = (node, index) => {
  return normalizeFlowPosition(graphModelApi().nodePosition({ node, index, overrides: state.nodePositions }));
};

const recentActivity = (graph) => {
  const events = filteredRuntimeEvents();
  const activity = graphModelApi().recentActivity({
    graph,
    events,
    windowMs: EDGE_ACTIVITY_WINDOW_MS,
  });
  return activity;
};

const filterByActivity = (graph, activity) => graphModelApi().filterByActivity({ graph, activity, filter: state.filters.activity });

const pointerPercent = (event, canvas) => {
  const rect = canvas.getBoundingClientRect();
  const zoom = state.viewport.zoom || 1;
  return {
    x: (event.clientX - rect.left - state.viewport.panX) / zoom,
    y: (event.clientY - rect.top - state.viewport.panY) / zoom,
  };
};

const flowCoordinate = (value, min = FLOW_CANVAS_POSITION_MIN, max = FLOW_CANVAS_POSITION_MAX) =>
  `${Math.max(min, Math.min(max, flowWorldNumber(value)))}px`;

const normalizeRuntimeWorkspaceId = (workspaceId = "") => {
  const value = String(workspaceId || "").trim();
  if (!value || value === "all" || value === "library_local") return "workspace_global";
  return value;
};

const ensureRuntimeWorkspaceScope = async () => {
  const workspaceId = normalizeRuntimeWorkspaceId(state.filters.workspaceId || await resolveInitialWorkspaceId());
  if (state.filters.workspaceId !== workspaceId) {
    setFiltersState({ ...state.filters, workspaceId, origin: state.filters.origin === "library" ? "runtime" : state.filters.origin });
    syncFilterQuery();
    state.viewport = loadStoredViewport(workspaceId) || state.viewport || defaultViewport();
  }
  return workspaceId;
};

const workspaceForDraft = () =>
  normalizeRuntimeWorkspaceId(state.filters.workspaceId || selectedNode()?.workspaceId || state.runtime.flows[0]?.workspaceId);

const currentWorkspaceId = () =>
  normalizeRuntimeWorkspaceId(state.filters.workspaceId || state.runtime.flows[0]?.workspaceId || "workspace_global");

const currentWorkspaceName = () => {
  const workspaceId = currentWorkspaceId();
  const flow = state.runtime.flows.find((item) => item.workspaceId === workspaceId || item.id === workspaceId);
  const option = workspaceOptions().find((item) => item.value === workspaceId);
  return flow?.name || option?.label || workspaceId;
};

const channelForDraft = () =>
  (state.filters.channel !== "all"
    ? state.filters.channel
    : state.focus.channel || (selectedNode() ? nodeChannels(selectedNode())[0] : "")) || "default";

const escapeSelectorValue = (value) => window.CSS?.escape ? window.CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&");

const bringNodeToFront = (nodeId = "") => {
  const nextId = String(nodeId || "");
  if (!nextId || state.frontNodeId === nextId) return;
  state.frontNodeId = nextId;
  document.querySelectorAll(".tl-flow-node.is-front").forEach((element) => element.classList.remove("is-front"));
  document.querySelector(`.tl-flow-node[data-flow-node-id="${escapeSelectorValue(nextId)}"]`)?.classList.add("is-front");
};
