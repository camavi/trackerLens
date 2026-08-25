const workspaceViewData = window.TrackerLensWorkspaceData;

const workspaceViewState = {
  loading: true,
  error: "",
  workspace: { ...workspaceViewData.workspace },
  boxes: [],
  connections: [],
  runtimes: new Map(),
  trackerTimers: new Map(),
  trackerStats: new Map(),
  boxPerformanceStats: new Map(),
  trackerLog: [],
  trackerLogSeq: 0,
  trackerLogPaused: false,
  trackerLogPending: 0,
  expandedTrackers: new Set(),
  pausedTrackers: new Set(),
  busUnsubscribers: [],
};

const icon = (name, size = "md") => _.Icon({ name, size });
const btn = (props, ...children) => _.Btn({ type: "button", ...props }, ...children);
const debugParams = new URLSearchParams(window.location.search);
const runtimeDebugTrace = [];
const trackerLaunchLog = [];
const runtimeDebugEnabled = () => debugParams.get("debugRuntime") === "1" || localStorage.getItem("tl_debug_runtime") === "1";
const runtimeDebug = (label, payload = {}) => {
  const entry = {
    at: new Date().toISOString(),
    label,
    payload,
  };
  runtimeDebugTrace.push(entry);
  if (runtimeDebugTrace.length > 300) runtimeDebugTrace.shift();
  if (runtimeDebugEnabled()) console.debug(`[TL Runtime Debug] ${label}`, payload);
};
const trackerLaunch = (label, payload = {}, level = "info") => {
  const entry = {
    at: new Date().toISOString(),
    label,
    payload,
  };
  trackerLaunchLog.push(entry);
  if (trackerLaunchLog.length > 300) trackerLaunchLog.shift();
  const method = level === "warn" ? "warn" : level === "error" ? "error" : "info";
  if (runtimeDebugEnabled() || method !== "info") {
    console[method](`[TL Tracker Launch] ${label}`, payload);
  }
  runtimeDebug(label, payload);
};

window.TLRuntimeDebug = {
  enable() {
    localStorage.setItem("tl_debug_runtime", "1");
    console.info("[TL Runtime Debug] enabled. Reload the workspace page.");
  },
  disable() {
    localStorage.removeItem("tl_debug_runtime");
    console.info("[TL Runtime Debug] disabled. Reload the workspace page.");
  },
  dump() {
    return [...runtimeDebugTrace];
  },
  launchLog() {
    return [...trackerLaunchLog];
  },
  async clearLogs() {
    if (!window.TrackerLensEventLogStore?.clearAll) {
      throw new Error("TrackerLensEventLogStore.clearAll non disponibile. Ricarica workspace.html.");
    }
    const result = await window.TrackerLensEventLogStore.clearAll();
    runtimeDebugTrace.length = 0;
    trackerLaunchLog.length = 0;
    console.info("[TL Runtime Debug] logs cleared", result);
    return result;
  },
  state() {
    return {
      enabled: runtimeDebugEnabled(),
      workspace: workspaceViewState.workspace,
      boxes: workspaceViewState.boxes.map((box) => ({
        id: box.id,
        name: box.name,
        type: box.type,
        detectedTracker: isBoxTracker(box),
        source: box.source || box.trackerType || box.runtime?.source || box.runtime?.trackerType || box.runtime?.runtime?.source || "",
      })),
      connections: workspaceViewState.connections,
      runtimes: Array.from(workspaceViewState.runtimes.keys()),
      trackerTimers: Array.from(workspaceViewState.trackerTimers.keys()),
      trackerStats: Array.from(workspaceViewState.trackerStats.entries()),
      boxPerformanceStats: Array.from(workspaceViewState.boxPerformanceStats.entries()),
    };
  },
};

runtimeDebug("debug-bootstrap", {
  enabled: runtimeDebugEnabled(),
  href: window.location.href,
});
trackerLaunch("workspace-script-loaded", {
  href: window.location.href,
  debugRuntime: runtimeDebugEnabled(),
});

const runtimeEventStore = () => window.TrackerLensEventLogStore;
const runtimePerformanceMonitor = () => window.TrackerLensBoxPerformanceMonitor;
const runtimeChannelRegistry = () => window.TrackerLensChannelRegistry;
const runtimeEventBus = () => {
  if (!window.TrackerLensEventBus?.get) return null;
  return window.TrackerLensEventBus.get(workspaceViewState.workspace.id || "global", {
    eventStore: runtimeEventStore(),
    channelRegistry: runtimeChannelRegistry(),
  });
};

const normalizeRuntimeConnection = (connection = {}) => {
  const fromBoxId = connection.fromBoxId || connection.sourceNodeId || "";
  const toBoxId = connection.toBoxId || connection.targetNodeId || "";
  return {
    ...connection,
    fromBoxId,
    toBoxId,
    channel: connection.channel || "default",
    mapping: connection.mapping && typeof connection.mapping === "object" ? { ...connection.mapping } : {},
  };
};

const runtimeConnectionKey = (connection = {}) => {
  if (connection.id) return `id:${connection.id}`;
  return [
    "edge",
    connection.fromBoxId || connection.sourceNodeId || "",
    connection.toBoxId || connection.targetNodeId || "",
    connection.channel || "default",
  ].join(":");
};

const loadWorkspaceConnections = async ({ workspaceId = "", contentConnections = [] } = {}) => {
  const baseConnections = contentConnections.map(normalizeRuntimeConnection);
  const store = window.TrackerLensConnectionsStore;
  if (!store?.list) return baseConnections;

  try {
    const allConnections = await store.list();
    const storeConnections = allConnections
      .map(normalizeRuntimeConnection)
      .filter((connection) => !workspaceId || !connection.workspaceId || connection.workspaceId === workspaceId)
      .filter((connection) => connection.fromBoxId && connection.toBoxId);
    const merged = new Map();
    [...baseConnections, ...storeConnections].forEach((connection) => {
      merged.set(runtimeConnectionKey(connection), connection);
    });
    runtimeDebug("workspace-connections-loaded", {
      workspaceId,
      contentConnections: baseConnections.length,
      storeConnections: storeConnections.length,
      mergedConnections: merged.size,
    });
    return Array.from(merged.values());
  } catch (error) {
    trackerLaunch("workspace-connections-store-error", {
      workspaceId,
      error: error?.message || String(error),
    }, "warn");
    return baseConnections;
  }
};

const persistRuntimeEvent = (payload) => {
  const store = runtimeEventStore();
  if (!store?.recordEvent) return;
  store.recordEvent(payload).catch((error) => {
    console.warn("Evento runtime non persistito:", error);
  });
};

const persistRuntimeFlowLog = (payload) => {
  const store = runtimeEventStore();
  if (!store?.recordFlowLog) return;
  store.recordFlowLog(payload).catch((error) => {
    console.warn("Flow log runtime non persistito:", error);
  });
};

const openChromePage = (url) => {
  if (window.TrackerLensSidebar?.navigate) {
    window.TrackerLensSidebar.navigate(url);
    return;
  }
  window.location.assign(url);
};

const openEditor = () => {
  const workspaceId = workspaceViewState.workspace.id;
  openChromePage(`editorWorkspace.html${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ""}`);
};

const boxById = (boxId) =>
  workspaceViewState.boxes.find((box) => box.id === boxId) || null;

const isBoxTracker = (box = {}) => {
  const type = String(box.type || box.runtime?.type || "").toLowerCase();
  if (type === "boxtracker" || type === "box-tracker") return true;
  const source = box.source || box.trackerType || box.runtime?.source || box.runtime?.trackerType || box.runtime?.runtime?.source || box.runtime?.runtime?.trackerType;
  return Boolean(source && !getRuntimeCode(box).html && !getRuntimeCode(box).css);
};

const trackerBoxes = () =>
  workspaceViewState.boxes.filter(isBoxTracker);

const renderBrand = () => window.TrackerLensSidebar.renderBrand({ className: "tl-view-brand" });

const renderTopbar = () =>
  _.header(
    { class: "tl-view-topbar" },
    renderBrand(),
    _.Search({
      class: "tl-view-search-input",
      label: "Cerca workspace...",
      value: "",
      "aria-label": "Cerca workspace",
    }),
    _.Toolbar(
      { class: "tl-view-actions", align: "center", gap: 16 },
      btn({ class: "tl-view-monitor", onclick: openTrackerMonitorDialog }, icon("monitoring", "sm"), "Monitor"),
      btn({ class: "tl-view-edit", onclick: openEditor }, icon("edit", "sm"), "Edit"),
      btn({ class: "tl-view-menu", "aria-label": "Menu workspace" }, icon("more_vert"))
    )
  );

const renderSidebar = () =>
  window.TrackerLensSidebar.render({ activeId: "dashboard" });

const renderWorkspaceGrid = () =>
  _.section(
    {
      class: "tl-view-canvas",
      style: {
        "--tl-view-columns": workspaceViewState.workspace.columns,
        "--tl-view-rows": workspaceViewState.workspace.rows || 40,
      },
      "aria-label": "Workspace vuoto",
    },
    _.div({ class: "tl-view-grid", "aria-hidden": "true" }),
    workspaceViewState.loading ? _.div({ class: "tl-view-state" }, "Caricamento workspace...") : null,
    workspaceViewState.error ? _.div({ class: "tl-view-state is-error" }, workspaceViewState.error) : null,
    !workspaceViewState.loading && !workspaceViewState.error ? renderWorkspaceBoxes() : null
  );

const renderWorkspaceBoxes = () =>
  _.div(
    {
      class: "tl-view-box-layer",
      style: {
        gridTemplateColumns: `repeat(${workspaceViewState.workspace.columns || 48}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${workspaceViewState.workspace.rows || 40}, minmax(0, 1fr))`,
      },
    },
    ...workspaceViewState.boxes.filter((box) => !box.hidden).map(renderWorkspaceBox)
  );

const getRuntimeCode = (box) => {
  const code = box.runtime?.code || box.code || {};
  return {
    css: code.css || code.CSS || "",
    html: code.html || code.HTML || "",
    js: code.js || code.JS || "",
    manifest: code.manifest || code.Manifest || "",
  };
};

const runtimePreviewData = () => ({
  price: "63,245.67",
  change24h: "+1,234.56 (2.00%)",
  btcPrice: "63,245.67",
});

const interpolateTemplate = (html, values) =>
  String(html || "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const value = key.split(".").reduce((acc, part) => acc?.[part], values);
    return value == null ? "" : String(value);
  });

const safeRuntimeId = (value) =>
  String(value || "box_lens").replace(/[^\w-]/g, "_");

const safeCssQueryId = (value) =>
  window.CSS?.escape ? CSS.escape(String(value)) : safeRuntimeId(value);

const scopeCssSelectors = (selectors, scopeSelector) =>
  selectors
    .split(",")
    .map((selector) => selector.trim())
    .filter(Boolean)
    .map((selector) => {
      if (selector.includes(scopeSelector)) return selector;
      if (/^(from|to|\d+(?:\.\d+)?%)$/i.test(selector)) return selector;
      if (/^(html|body|:root)\b/i.test(selector)) return scopeSelector;
      return `${scopeSelector} ${selector}`;
    })
    .join(", ");

const scopeBoxLensCss = (css, scopeSelector) =>
  String(css || "").replace(/(^|[{}])\s*([^@{}][^{}]*)\{/g, (match, boundary, selectors) => {
    const scopedSelectors = scopeCssSelectors(selectors, scopeSelector);
    return `${boundary}${scopedSelectors}{`;
  });

const normalizeBoxLensRuntimeResult = (result) => {
  const normalized = result && typeof result === "object" ? result : {};
  return {
    ...normalized,
    status: normalized.status || "ready",
    listener: typeof normalized.listener === "function"
      ? { default: normalized.listener }
      : normalized.listener && typeof normalized.listener === "object" ? normalized.listener : {},
  };
};

const valueByPath = (data, path) =>
  String(path || "").split(".").reduce((value, part) => value?.[part], data);

const createSafeDomListener = (boxLen) => {
  const setText = (selector, value) => {
    if (value == null) return;
    boxLen.querySelectorAll(selector).forEach((element) => {
      element.textContent = String(value);
    });
  };

  const update = (data = {}) => {
    boxLen.querySelectorAll("[data-tl-bind], [data-bind]").forEach((element) => {
      const path = element.getAttribute("data-tl-bind") || element.getAttribute("data-bind");
      const value = valueByPath(data, path);
      if (value != null) element.textContent = String(value);
    });

    setText(".value", data.c ?? data.price ?? data.btcPrice);
    setText(".change", data.P ?? data.change24h);
    setText(".title", data.title);
    setText(".source", data.source);
  };

  return update;
};

const executeBoxLensJs = (boxLen, js, context = {}) => {
  const listener = createSafeDomListener(boxLen);
  listener(context.data);

  return {
    status: "ready",
    listener: {
      default: listener,
      "*": listener,
      "btc-price": listener,
    },
  };
};

const scopedRuntimeCss = (box) => {
  const code = getRuntimeCode(box);
  const scopeSelector = `[data-box-lens-instance="${safeRuntimeId(box.id)}"]`;
  return `${scopeSelector}{box-sizing:border-box;padding:12px;} ${scopeSelector} *{box-sizing:border-box;}${scopeBoxLensCss(code.css, scopeSelector)}`;
};

const hasRuntimeView = (box) => {
  const code = getRuntimeCode(box);
  return !isBoxTracker(box) && Boolean(code.html || code.css || code.js);
};

const renderRuntimeBox = (box) =>
  _.article(
    {
      class: "tl-view-box has-runtime",
      "data-runtime-box-id": box.id,
      "data-box-lens-instance": safeRuntimeId(box.id),
      style: {
        gridColumn: `${box.x || 1} / span ${box.width || 6}`,
        gridRow: `${box.y || 1} / span ${box.height || 4}`,
        zIndex: box.zIndex || 1,
      },
    },
    _.style(scopedRuntimeCss(box)),
    _.div({ class: "tl-view-box-runtime", "data-runtime-mount": box.id })
  );

const renderWorkspaceBox = (box) =>
  hasRuntimeView(box) ? renderRuntimeBox(box) :
    _.article(
      {
        class: `tl-view-box${isBoxTracker(box) ? " is-tracker" : ""}`,
        style: {
          gridColumn: `${box.x || 1} / span ${box.width || 6}`,
          gridRow: `${box.y || 1} / span ${box.height || 4}`,
          "--asset-color": box.color || (isBoxTracker(box) ? "#35c979" : "#9b5cf5"),
          zIndex: box.zIndex || 1,
        },
      },
      _.span({ class: "tl-view-box-icon" }, icon(box.icon || (isBoxTracker(box) ? "cloud_queue" : "dashboard"), "sm")),
      _.div(
        { class: "tl-view-box-copy" },
        _.h2(box.name || "Box"),
        _.p(box.type || "boxLens")
      )
    );

const hydrateWorkspaceBoxes = async (boxes) => {
  const assets = await window.TrackerLensLocalLibrary.listWidgetAssets();
  const byId = new Map();

  assets.forEach((asset) => {
    byId.set(asset.id, asset);
    byId.set(asset.sourceId, asset);
  });

  return boxes.map((box) => {
    const runtime = byId.get(box.assetId) || byId.get(box.sourceId) || byId.get(box.id);
    return runtime
      ? {
        ...box,
        type: runtime.type || box.type,
        name: runtime.name || box.name,
        category: runtime.category || box.category,
        description: runtime.description || box.description,
        icon: runtime.icon || box.icon,
        color: runtime.color || box.color,
        code: runtime.code,
        outputChannel: runtime.outputChannel || box.outputChannel,
        sampleOutput: runtime.sampleOutput || box.sampleOutput,
        runtime,
      }
      : { ...box };
  });
};

const readWorkspaceRecord = async (workspaceId) => {
  const persistence = window.trackers?.desktop?.persistence;
  if (!persistence?.readDevelopmentRecords) throw new Error("Workspace richiede SQLite nell'app desktop.");
  return (await persistence.readDevelopmentRecords({ storeName: "tl_pages" })).find((record) => record.id === workspaceId) || null;
};

const cleanupRuntimeBoxes = () => {
  cleanupEventBusSubscriptions();
  workspaceViewState.runtimes.forEach((runtime) => {
    try {
      if (typeof runtime?.destroy === "function") runtime.destroy();
    } catch (error) {
      console.error("Errore cleanup boxLens:", error);
    }
  });
  workspaceViewState.runtimes.clear();
};

const cleanupEventBusSubscriptions = () => {
  workspaceViewState.busUnsubscribers.forEach((unsubscribe) => {
    try {
      unsubscribe();
    } catch (error) {
      console.error("Errore cleanup Event Bus:", error);
    }
  });
  workspaceViewState.busUnsubscribers = [];
};

const cleanupTrackerRuntimes = () => {
  workspaceViewState.trackerTimers.forEach((runtime) => {
    if (typeof runtime === "function") {
      runtime();
      return;
    }
    clearInterval(runtime);
  });
  workspaceViewState.trackerTimers.clear();
};

const cleanupWorkspaceRuntime = () => {
  cleanupTrackerRuntimes();
  cleanupRuntimeBoxes();
};

const mapConnectionPayload = (payload, mapping = {}) => {
  const routeOnlyKeys = new Set(["sourcePort", "targetPort", "channel"]);
  const entries = Object.entries(mapping || {})
    .filter(([sourceKey, targetKey]) => targetKey && !routeOnlyKeys.has(sourceKey));
  if (!entries.length || !payload || typeof payload !== "object") return payload;

  return entries.reduce((mapped, [sourceKey, targetKey]) => {
    mapped[targetKey] = sourceKey.split(".").reduce((value, part) => value?.[part], payload);
    return mapped;
  }, {});
};

const runtimeListener = (runtime, channel) => {
  const listener = runtime?.listener || {};
  return listener[channel] || listener.default || listener["*"] || null;
};

const trackerConnections = (trackerId) =>
  workspaceViewState.connections.filter((connection) => connection.fromBoxId === trackerId);

const connectedLensNames = (trackerId) =>
  trackerConnections(trackerId)
    .map((connection) => boxById(connection.toBoxId)?.name || connection.toBoxId)
    .filter(Boolean);

const formatMonitorTime = (value) =>
  value ? new Date(value).toLocaleTimeString() : "--";

const formatMonitorTimestamp = (value) => {
  if (!value) return "--";
  const date = new Date(value);
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${date.toLocaleTimeString()}.${ms}`;
};

const shortValue = (value, fallback = "--") => {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
};

const payloadFieldLabel = (key) => {
  if (!key) return "--";
  return String(key);
};

const compactJson = (payload) => {
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
};

const clonePayloadSnapshot = (payload) => {
  if (payload === null || payload === undefined) return payload;
  try {
    if (typeof structuredClone === "function") return structuredClone(payload);
  } catch {
    // fallback sotto
  }
  try {
    return JSON.parse(JSON.stringify(payload));
  } catch {
    return payload;
  }
};

const previewPayload = (payload) => {
  return compactJson(payload);
};

const previewPayloadText = (text = "") =>
  text;

const normalizePayloadText = (value, fallbackPayload) => {
  const text = String(value || "").trim();
  if (!text) return compactJson(fallbackPayload);
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
};

const sourceLabel = (box) =>
  box.source || box.runtime?.source || box.runtime?.runtime?.source || box.trackerType || box.runtime?.trackerType || "manual";

const endpointLabel = (box) =>
  box.endpoint || box.runtime?.endpoint || box.runtime?.runtime?.endpoint || "";

const monitorStatusLabel = (status) => ({
  starting: "Avvio",
  live: "Live",
  error: "Errore",
  idle: "Idle",
  stopped: "Fermo",
  paused: "Pausa",
})[status] || "Idle";

const trackerStat = (box) => {
  const current = workspaceViewState.trackerStats.get(box.id) || {};
  return {
    id: box.id,
    status: workspaceViewState.pausedTrackers.has(box.id) ? "paused" : current.status || (box.active === false || box.autoStart === false ? "stopped" : "idle"),
    eventCount: Number(current.eventCount) || 0,
    errorCount: Number(current.errorCount) || 0,
    lastAt: current.lastAt || "",
    lastLatencyMs: current.lastLatencyMs || 0,
    channel: current.channel || trackerChannel(box),
    lastPayload: current.lastPayload || trackerPayload(box),
    lastPayloadBytes: Number(current.lastPayloadBytes) || 0,
    eventsPerSec: Number(current.eventsPerSec) || 0,
    avgLatencyMs: Number(current.avgLatencyMs) || Number(current.lastLatencyMs) || 0,
    errorRate: Number(current.errorRate) || 0,
    networkBytesPerMin: Number(current.networkBytesPerMin) || 0,
    estimatedMemoryBytes: Number(current.estimatedMemoryBytes) || 0,
    lastError: current.lastError || "",
    startedAt: current.startedAt || "",
  };
};

const formatMonitorBytes = (bytes = 0) => {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${Math.max(0, Math.round(value))} B`;
};

const trackerPerformancePatch = (stat, payload = {}, payloadText = "") => {
  const lastPayloadBytes = new Blob([payloadText || JSON.stringify(payload || {})]).size;
  const eventCount = Number(stat.eventCount) || 0;
  const errorCount = Number(stat.errorCount) || 0;
  const startedAt = Date.parse(stat.startedAt || "") || Date.now();
  const elapsedSec = Math.max(1, (Date.now() - startedAt) / 1000);
  const lastLatency = Number(stat.lastLatencyMs) || 0;
  const previousAvg = Number(stat.avgLatencyMs) || lastLatency;
  return {
    lastPayloadBytes,
    eventsPerSec: eventCount / elapsedSec,
    avgLatencyMs: eventCount > 1 ? Math.round(((previousAvg * (eventCount - 1)) + lastLatency) / eventCount) : lastLatency,
    errorRate: eventCount ? (errorCount / eventCount) * 100 : 0,
    networkBytesPerMin: Math.round((Number(stat.networkBytesPerMin) || 0) * 0.72 + lastPayloadBytes * 0.28),
    estimatedMemoryBytes: Math.max(1024, eventCount * 360 + errorCount * 540 + lastPayloadBytes * 2),
  };
};

const persistTrackerPerformance = (boxId, stat, payload = {}, payloadText = "") => {
  const monitor = runtimePerformanceMonitor();
  if (!monitor?.recordSample) return;
  monitor.recordSample({
    workspaceId: workspaceViewState.workspace.id || "global",
    boxId,
    stat,
    payload,
    payloadText,
  }).catch((error) => console.warn("Performance box non persistita:", error));
};

const recordBoxPerformanceSample = ({ boxId = "", status = "live", payload = {}, payloadText = "", latencyMs = 0, error = "" } = {}) => {
  const box = boxById(boxId);
  if (!box) return;
  const previous = workspaceViewState.boxPerformanceStats.get(boxId) || {
    eventCount: 0,
    errorCount: 0,
    startedAt: new Date().toISOString(),
    status: "idle",
  };
  const next = {
    ...previous,
    status: error ? "error" : status,
    eventCount: previous.eventCount + (error ? 0 : 1),
    errorCount: previous.errorCount + (error ? 1 : 0),
    lastAt: new Date().toISOString(),
    lastLatencyMs: Number(latencyMs) || previous.lastLatencyMs || 0,
    lastError: error || "",
  };
  const performancePatch = trackerPerformancePatch(next, error ? { error } : payload, payloadText);
  const stat = { ...next, ...performancePatch };
  workspaceViewState.boxPerformanceStats.set(boxId, stat);
  const monitor = runtimePerformanceMonitor();
  if (!monitor?.recordSample) return;
  monitor.recordSample({
    workspaceId: workspaceViewState.workspace.id || "global",
    boxId,
    stat,
    payload: error ? { error } : payload,
    payloadText,
    status: stat.status,
  }).catch((monitorError) => console.warn("Performance boxLens non persistita:", monitorError));
};

const updateTrackerStat = (boxId, patch = {}) => {
  const box = boxById(boxId);
  if (!box) return;
  const previous = trackerStat(box);
  workspaceViewState.trackerStats.set(boxId, { ...previous, ...patch });
  refreshTrackerRow(boxId);
  refreshTrackerActionsDialog(boxId);
};

const pushTrackerLog = (entry) => {
  const payload = clonePayloadSnapshot(entry.payload);
  const payloadText = entry.type === "event" ? normalizePayloadText(entry.payloadText, payload) : "";
  const logEntry = {
    id: `log_${Date.now()}_${++workspaceViewState.trackerLogSeq}`,
    seq: workspaceViewState.trackerLogSeq,
    at: new Date().toISOString(),
    ...entry,
    payload,
    payloadText,
  };
  workspaceViewState.trackerLog.unshift(logEntry);
  workspaceViewState.trackerLog = workspaceViewState.trackerLog;
  if (workspaceViewState.trackerLogPaused) {
    workspaceViewState.trackerLogPending += 1;
  }
  return logEntry;
};

const recordTrackerEvent = (boxId, channel, payload, payloadText = "") => {
  const box = boxById(boxId);
  if (!box || !isBoxTracker(box)) return;
  const previous = trackerStat(box);
  const payloadSnapshot = clonePayloadSnapshot(payload);
  const latency = payload?._trackerRuntime?.latencyMs || payload?._trackerTest?.latencyMs || 0;
  const next = {
    status: "live",
    eventCount: previous.eventCount + 1,
    lastAt: new Date().toISOString(),
    lastLatencyMs: Number(latency) || previous.lastLatencyMs || 0,
    channel,
    lastPayload: payloadSnapshot,
    lastError: "",
  };
  const performancePatch = trackerPerformancePatch({ ...previous, ...next }, payloadSnapshot, payloadText);
  const nextStat = { ...previous, ...next, ...performancePatch };
  workspaceViewState.trackerStats.set(boxId, nextStat);
  persistTrackerPerformance(boxId, nextStat, payloadSnapshot, payloadText);
  refreshTrackerRow(boxId);
  refreshTrackerActionsDialog(boxId);
  appendTrackerLogEntry(pushTrackerLog({ type: "event", trackerId: boxId, trackerName: box.name || boxId, channel, payload: payloadSnapshot, payloadText }));
};

const recordTrackerError = (boxId, error) => {
  const box = boxById(boxId);
  if (!box || !isBoxTracker(box)) return;
  const previous = trackerStat(box);
  const message = error?.message || String(error || "Errore tracker");
  const errorStat = {
    ...previous,
    status: "error",
    errorCount: previous.errorCount + 1,
    lastAt: new Date().toISOString(),
    lastError: message,
  };
  const nextStat = { ...errorStat, ...trackerPerformancePatch(errorStat, { error: message }) };
  workspaceViewState.trackerStats.set(boxId, nextStat);
  persistTrackerPerformance(boxId, nextStat, { error: message });
  refreshTrackerRow(boxId);
  refreshTrackerActionsDialog(boxId);
  appendTrackerLogEntry(pushTrackerLog({ type: "error", trackerId: boxId, trackerName: box.name || boxId, channel: previous.channel, error: message }));
  persistRuntimeEvent({
    workspaceId: workspaceViewState.workspace.id || "global",
    channel: previous.channel || "default",
    eventType: "error",
    sourceNodeId: boxId,
    payload: { error: message },
    status: "error",
  });
  persistRuntimeFlowLog({
    workspaceId: workspaceViewState.workspace.id || "global",
    nodeId: boxId,
    level: "error",
    message,
  });
};

const renderMonitorMetric = (label, value, tone = "") =>
  _.Card(
    { class: `tl-monitor-metric${tone ? ` is-${tone}` : ""}` },
    _.span({ class: "tl-monitor-metric-label" }, label),
    _.strong(value)
  );

const renderMonitorSummaryPill = (label, value, tone = "") =>
  _.div(
    { class: `tl-monitor-summary-pill${tone ? ` is-${tone}` : ""}` },
    _.span(label),
    _.strong(value)
  );

const renderTrackerPulse = (stat) =>
  _.div(
    { class: `tl-monitor-signal is-${stat.status}` },
    ...Array.from({ length: 14 }, (unused, index) =>
      _.span({
        style: {
          "--delay": `${index * 42}ms`,
        },
      })
    )
  );

const renderPayloadFields = (payload) => {
  const entries = payload && typeof payload === "object" && !Array.isArray(payload)
    ? Object.entries(payload).filter(([key]) => !key.startsWith("_"))
    : [];
  if (!entries.length) return _.div({ class: "tl-monitor-empty-line" }, "Nessun campo payload leggibile");

  return _.Grid(
    { class: "tl-monitor-fields", cols: "repeat(auto-fit, minmax(132px, 1fr))", gap: 8 },
    ...entries.map(([key, value]) =>
      _.div(
        { class: "tl-monitor-field" },
        _.span(payloadFieldLabel(key)),
        _.strong(typeof value === "object" ? compactJson(value) : shortValue(value))
      )
    )
  );
};

const trackerLogEntries = (trackerId = "") =>
  workspaceViewState.trackerLog.filter((entry) => !trackerId || entry.trackerId === trackerId);

const cleanupTrackerRuntime = (boxId) => {
  const runtime = workspaceViewState.trackerTimers.get(boxId);
  if (!runtime) return;
  if (typeof runtime === "function") runtime();
  else clearInterval(runtime);
  workspaceViewState.trackerTimers.delete(boxId);
};

const toggleTrackerExpanded = (boxId) => {
  if (workspaceViewState.expandedTrackers.has(boxId)) workspaceViewState.expandedTrackers.delete(boxId);
  else workspaceViewState.expandedTrackers.add(boxId);
  refreshTrackerMonitor(true);
};

const toggleTrackerPaused = (boxId) => {
  const box = boxById(boxId);
  if (!box) return;

  if (workspaceViewState.pausedTrackers.has(boxId)) {
    workspaceViewState.pausedTrackers.delete(boxId);
    startTrackerRuntime(box);
  } else {
    workspaceViewState.pausedTrackers.add(boxId);
    cleanupTrackerRuntime(boxId);
    updateTrackerStat(boxId, { status: "paused" });
  }

  refreshTrackerMonitor(true);
};

const trackerPauseActionLabel = (boxId) =>
  workspaceViewState.pausedTrackers.has(boxId) ? "Riattiva boxTracker" : "Pausa boxTracker";

const openTrackerLogDialog = (trackerId = "") => {
  const tracker = trackerId ? boxById(trackerId) : null;
  const dialog = _.Dialog({
    class: "tl-tracker-log-dialog",
    panelClass: "tl-tracker-log-panel",
    size: "lg",
    title: tracker ? `Log ${tracker.name || tracker.id}` : "Log boxTracker",
    subtitle: tracker ? `Eventi ricevuti dal canale ${trackerChannel(tracker)}` : "Eventi raccolti dai tracker del workspace.",
    icon: "article",
    closeButton: true,
    scrollable: true,
    bodyMaxHeight: "70vh",
    content: () => _.div({ class: "tl-monitor-log-dialog-body" }, renderTrackerMonitorLogRows(trackerId)),
    actions: ({ close }) => _.Toolbar({ align: "end", gap: 8 }, btn({ onclick: close }, "Chiudi")),
  });
  dialog.open();
};

const renderTrackerActionsContentNodes = (box) => {
  const currentStat = trackerStat(box);
  return [
    _.Grid(
      { cols: 2, gap: 8 },
      renderMonitorMetric("Stato", monitorStatusLabel(currentStat.status)),
      renderMonitorMetric("Eventi", currentStat.eventCount),
      renderMonitorMetric("Errori", currentStat.errorCount, currentStat.errorCount ? "danger" : ""),
      renderMonitorMetric("Latenza", currentStat.lastLatencyMs ? `${currentStat.lastLatencyMs} ms` : "--"),
      renderMonitorMetric("Events/sec", currentStat.eventsPerSec.toFixed(2)),
      renderMonitorMetric("Memoria", formatMonitorBytes(currentStat.estimatedMemoryBytes))
    ),
    _.Card(
      { class: "tl-monitor-json-card" },
      _.h3("Ultimo payload"),
      _.pre(previewPayload(currentStat.lastPayload || {}))
    ),
  ];
};

const refreshTrackerActionsDialog = (boxId) => {
  const box = boxById(boxId);
  if (!box) return;
  const host = document.querySelector(`[data-tracker-actions-content="${safeCssQueryId(boxId)}"]`);
  if (!host) return;
  host.replaceChildren(...renderTrackerActionsContentNodes(box));
};

const openTrackerActionsDialog = (box) => {
  const stat = trackerStat(box);
  const dialog = _.Dialog({
    class: "tl-tracker-actions-dialog",
    panelClass: "tl-tracker-actions-panel",
    size: "md",
    title: box.name || "BoxTracker",
    subtitle: `${sourceLabel(box)} · canale ${stat.channel}`,
    icon: "more_vert",
    closeButton: true,
    content: () => _.div(
      { class: "tl-tracker-actions-content", "data-tracker-actions-content": box.id },
      ...renderTrackerActionsContentNodes(box)
    ),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: () => openTrackerLogDialog(box.id) }, icon("article", "sm"), "Log"),
      btn(
        {
          onclick: () => {
            toggleTrackerPaused(box.id);
            close();
            setTimeout(() => openTrackerActionsDialog(boxById(box.id) || box), 0);
          },
        },
        icon(workspaceViewState.pausedTrackers.has(box.id) ? "play_arrow" : "pause", "sm"),
        trackerPauseActionLabel(box.id)
      ),
      btn({ onclick: close }, "Chiudi")
    ),
  });
  dialog.open();
};

const renderTrackerMonitorDetailNodes = (box, stat, connections, names) => [
  _.Grid(
    { class: "tl-monitor-info-grid", cols: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 },
    _.div(_.span("ID istanza"), _.strong(box.id)),
    _.div(_.span("Asset sorgente"), _.strong(shortValue(box.sourceId || box.assetId))),
    _.div(_.span("Endpoint"), _.strong(endpointLabel(box) || "sample/manual")),
    _.div(_.span("Collegamenti"), _.strong(String(connections.length))),
    _.div(_.span("Events/sec"), _.strong(stat.eventsPerSec.toFixed(2))),
    _.div(_.span("Error rate"), _.strong(`${stat.errorRate.toFixed(1)}%`)),
    _.div(_.span("Network/min"), _.strong(formatMonitorBytes(stat.networkBytesPerMin))),
    _.div(_.span("Memoria stimata"), _.strong(formatMonitorBytes(stat.estimatedMemoryBytes)))
  ),
  _.div(
    { class: "tl-monitor-lens-list" },
    names.length
      ? names.map((name) => _.span(name))
      : _.span({ class: "is-empty" }, "Nessun boxLens collegato")
  ),
  _.Card(
    { class: "tl-monitor-network is-inline" },
    _.h3("Mappa collegamenti"),
    _.p(`${connections.length} connessioni per questo tracker`),
    _.div(
      { class: "tl-monitor-network-lines" },
      ...connections.map((connection) =>
        _.div(
          _.span(boxById(connection.fromBoxId)?.name || connection.fromBoxId),
          _.span({ class: "tl-monitor-link-line", "aria-hidden": "true" }),
          _.strong(boxById(connection.toBoxId)?.name || connection.toBoxId)
        )
      )
    )
  ),
  renderPayloadFields(stat.lastPayload)
];

const renderTrackerMonitorDetails = (box, stat, connections, names) =>
  _.div(
    { class: "tl-monitor-row-details", "data-tracker-row-details": box.id },
    ...renderTrackerMonitorDetailNodes(box, stat, connections, names)
  );

const renderTrackerMonitorCard = (box) => {
  const stat = trackerStat(box);
  const connections = trackerConnections(box.id);
  const names = connectedLensNames(box.id);
  const status = monitorStatusLabel(stat.status);
  const source = sourceLabel(box);
  const expanded = workspaceViewState.expandedTrackers.has(box.id);
  const paused = workspaceViewState.pausedTrackers.has(box.id);

  return _.Card(
    { class: `tl-monitor-row is-${stat.status}${expanded ? " is-expanded" : ""}`, "data-tracker-row": box.id },
    _.Row(
      { class: "tl-monitor-row-main", align: "center", justify: "space-between", gap: 12 },
      _.Row(
        { class: "tl-monitor-row-identity", align: "center", gap: 10 },
        _.span({ class: "tl-monitor-tracker-icon", style: { "--tracker-color": box.color || "#35c979" } }, icon(box.icon || "cloud_queue", "sm")),
        _.div(
          _.h3(box.name || "BoxTracker"),
          _.p({ "data-tracker-row-channel": box.id }, `${source} · canale ${stat.channel}`)
        )
      ),
      renderTrackerPulse(stat),
      _.Grid(
        { class: "tl-monitor-row-metrics", cols: 6, gap: 6 },
        _.div(_.span("Eventi"), _.strong({ "data-tracker-row-events": box.id }, String(stat.eventCount))),
        _.div(_.span("Errori"), _.strong({ "data-tracker-row-errors": box.id }, String(stat.errorCount))),
        _.div(_.span("Latenza"), _.strong({ "data-tracker-row-latency": box.id }, stat.lastLatencyMs ? `${stat.lastLatencyMs} ms` : "--")),
        _.div(_.span("Ev/s"), _.strong({ "data-tracker-row-eps": box.id }, stat.eventsPerSec.toFixed(2))),
        _.div(_.span("Net/min"), _.strong({ "data-tracker-row-net": box.id }, formatMonitorBytes(stat.networkBytesPerMin))),
        _.div(_.span("Mem"), _.strong({ "data-tracker-row-mem": box.id }, formatMonitorBytes(stat.estimatedMemoryBytes)))
      ),
      _.Toolbar(
        { class: "tl-monitor-row-actions", align: "center", gap: 6 },
        _.span({ class: `tl-monitor-status is-${stat.status}`, "data-tracker-row-status": box.id }, status),
        btn({ class: "tl-monitor-row-btn", "aria-label": paused ? "Riprendi tracker" : "Metti in pausa tracker", onclick: () => toggleTrackerPaused(box.id) }, icon(paused ? "play_arrow" : "pause", "sm")),
        btn({ class: "tl-monitor-row-btn", "aria-label": "Apri log tracker", onclick: () => openTrackerLogDialog(box.id) }, icon("article", "sm")),
        btn({ class: "tl-monitor-row-btn", "aria-label": "Espandi tracker", onclick: () => toggleTrackerExpanded(box.id) }, icon(expanded ? "keyboard_arrow_up" : "keyboard_arrow_down", "sm")),
        btn({ class: "tl-monitor-row-btn", "aria-label": "Altre azioni tracker", onclick: () => openTrackerActionsDialog(box) }, icon("more_vert", "sm"))
      )
    ),
    expanded ? renderTrackerMonitorDetails(box, stat, connections, names) : null,
    stat.lastError ? _.div({ class: "tl-monitor-error" }, stat.lastError) : null
  );
};

const setTrackerRowText = (selector, value) => {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
};

const setTrackerRowClass = (element, baseClass, status) => {
  if (!element) return;
  element.className = `${baseClass} is-${status}`;
};

const refreshTrackerRow = (boxId) => {
  const box = boxById(boxId);
  if (!box) return;
  const row = document.querySelector(`[data-tracker-row="${safeCssQueryId(boxId)}"]`);
  if (!row) return;

  const stat = trackerStat(box);
  row.className = `tl-monitor-row cms-card is-${stat.status}${workspaceViewState.expandedTrackers.has(boxId) ? " is-expanded" : ""}`;
  setTrackerRowClass(row.querySelector(`[data-tracker-row-status="${safeCssQueryId(boxId)}"]`), "tl-monitor-status", stat.status);
  setTrackerRowClass(row.querySelector(".tl-monitor-signal"), "tl-monitor-signal", stat.status);
  setTrackerRowText(`[data-tracker-row-status="${safeCssQueryId(boxId)}"]`, monitorStatusLabel(stat.status));
  setTrackerRowText(`[data-tracker-row-channel="${safeCssQueryId(boxId)}"]`, `${sourceLabel(box)} · canale ${stat.channel}`);
  setTrackerRowText(`[data-tracker-row-events="${safeCssQueryId(boxId)}"]`, String(stat.eventCount));
  setTrackerRowText(`[data-tracker-row-errors="${safeCssQueryId(boxId)}"]`, String(stat.errorCount));
  setTrackerRowText(`[data-tracker-row-latency="${safeCssQueryId(boxId)}"]`, stat.lastLatencyMs ? `${stat.lastLatencyMs} ms` : "--");
  setTrackerRowText(`[data-tracker-row-eps="${safeCssQueryId(boxId)}"]`, stat.eventsPerSec.toFixed(2));
  setTrackerRowText(`[data-tracker-row-net="${safeCssQueryId(boxId)}"]`, formatMonitorBytes(stat.networkBytesPerMin));
  setTrackerRowText(`[data-tracker-row-mem="${safeCssQueryId(boxId)}"]`, formatMonitorBytes(stat.estimatedMemoryBytes));
  setTrackerRowText(`[data-tracker-row-last="${safeCssQueryId(boxId)}"]`, formatMonitorTime(stat.lastAt));

  const details = row.querySelector(`[data-tracker-row-details="${safeCssQueryId(boxId)}"]`);
  if (details) {
    details.replaceChildren(...renderTrackerMonitorDetailNodes(box, stat, trackerConnections(boxId), connectedLensNames(boxId)));
  }
};

const toggleTrackerLogPaused = () => {
  workspaceViewState.trackerLogPaused = !workspaceViewState.trackerLogPaused;
  if (!workspaceViewState.trackerLogPaused) workspaceViewState.trackerLogPending = 0;
  refreshTrackerMonitor(true);
};

const renderTrackerMonitorLogRows = (trackerId = "") => {
  const entries = trackerLogEntries(trackerId);
  if (!entries.length) {
    return _.div(
      { class: "tl-monitor-log-empty-body" },
      _.div({ class: "tl-dialog-icon" }, icon("pending", "md")),
      _.h3("Nessuna attivita ancora"),
      _.p("Il monitor si aggiorna appena un boxTracker emette dati, incontra errori o viene riconnesso.")
    );
  }

  return _.div(
    { class: "tl-monitor-log-list", "data-tracker-log-list": "true" },
    ...entries.map(renderTrackerLogRow)
  );
};

const renderTrackerLogRow = (entry) =>
  _.Card(
    { class: `tl-monitor-log-row is-${entry.type}`, "data-tracker-log-entry": entry.id },
    _.Row(
      { align: "center", justify: "space-between", gap: 12 },
      _.strong(`#${entry.seq} · ${entry.trackerName || entry.trackerId}`),
      _.span(formatMonitorTimestamp(entry.at))
    ),
    _.p(entry.type === "error" ? entry.error : `Evento su canale ${entry.channel || "default"}`),
    entry.type === "event" ? _.pre(previewPayloadText(entry.payloadText || compactJson(entry.payload))) : null
  );

const updateTrackerLogHeader = () => {
  const counter = document.querySelector("[data-tracker-log-count]");
  if (!counter) return;
  counter.textContent = workspaceViewState.trackerLogPaused
    ? `${workspaceViewState.trackerLogPending} eventi ricevuti mentre la vista e in pausa`
    : `${workspaceViewState.trackerLog.length} eventi visibili`;
};

const appendTrackerLogEntry = (entry) => {
  if (workspaceViewState.trackerLogPaused) {
    updateTrackerLogHeader();
    return;
  }

  const list = document.querySelector("[data-tracker-log-list]");
  if (!list) {
    updateTrackerLogHeader();
    return;
  }

  const previousHeight = list.scrollHeight;
  const wasScrolled = list.scrollTop > 4;
  list.prepend(renderTrackerLogRow(entry));

  while (list.children.length > workspaceViewState.trackerLog.length) {
    list.lastElementChild?.remove();
  }

  if (wasScrolled) {
    list.scrollTop += list.scrollHeight - previousHeight;
  }

  updateTrackerLogHeader();
};

const renderTrackerMonitorLog = () =>
  _.Card(
    { class: `tl-monitor-log-box${workspaceViewState.trackerLogPaused ? " is-paused" : ""}` },
    _.Row(
      { class: "tl-monitor-log-head", align: "center", justify: "space-between", gap: 12 },
      _.div(
        _.h3("Log eventi"),
        _.p(
          { "data-tracker-log-count": "true" },
          workspaceViewState.trackerLogPaused
            ? `${workspaceViewState.trackerLogPending} eventi ricevuti mentre la vista e in pausa`
            : `${workspaceViewState.trackerLog.length} eventi visibili`
        )
      ),
      _.Toolbar(
        { align: "center", gap: 8 },
        btn(
          { class: `tl-monitor-log-toggle${workspaceViewState.trackerLogPaused ? " is-paused" : ""}`, onclick: toggleTrackerLogPaused },
          icon(workspaceViewState.trackerLogPaused ? "play_arrow" : "pause", "sm"),
          workspaceViewState.trackerLogPaused ? "Play" : "Pausa"
        ),
        btn({ class: "tl-monitor-log-refresh", onclick: () => refreshTrackerMonitor(true) }, icon("refresh", "sm"))
      )
    ),
    workspaceViewState.trackerLogPaused
      ? _.div({ class: "tl-monitor-log-freeze" }, icon("pause", "sm"), "Vista in pausa: i nuovi eventi vengono raccolti senza spostare il log.")
      : null,
    renderTrackerMonitorLogRows()
  );

const renderTrackerMonitorContent = () => {
  const trackers = trackerBoxes();
  const stats = trackers.map(trackerStat);
  const liveCount = stats.filter((stat) => stat.status === "live" || stat.status === "starting").length;
  const errorCount = stats.reduce((count, stat) => count + stat.errorCount, 0);
  const eventCount = stats.reduce((count, stat) => count + stat.eventCount, 0);
  const eventsPerSec = stats.reduce((sum, stat) => sum + stat.eventsPerSec, 0);
  const memoryBytes = stats.reduce((sum, stat) => sum + stat.estimatedMemoryBytes, 0);

  if (!trackers.length) {
    return _.div(
      { class: "tl-monitor-dialog-content" },
      _.Card(
        { class: "tl-monitor-empty" },
        _.div({ class: "tl-dialog-icon" }, icon("cloud_off", "md")),
        _.h3("Nessun boxTracker nel workspace"),
        _.p("Collega un boxTracker a un boxLens dall'editor workspace per vedere traffico, payload e stato runtime in questo monitor.")
      )
    );
  }

  return _.div(
    { class: "tl-monitor-dialog-content" },
    _.Toolbar(
      { class: "tl-monitor-summary", cols: 4, gap: 10 },
      renderMonitorSummaryPill("Tracker", trackers.length, "green"),
      renderMonitorSummaryPill("Runtime attivi", liveCount, liveCount ? "green" : ""),
      renderMonitorSummaryPill("Eventi totali", eventCount),
      renderMonitorSummaryPill("Errori", errorCount, errorCount ? "danger" : ""),
      renderMonitorSummaryPill("Events/sec", eventsPerSec.toFixed(2)),
      renderMonitorSummaryPill("Memoria", formatMonitorBytes(memoryBytes)),
      btn({ class: "tl-monitor-open-log", onclick: () => openTrackerLogDialog() }, icon("article", "sm"), "Log completo")
    ),
    _.Grid(
      { class: "tl-monitor-overview is-full", cols: "minmax(0, 1fr)", gap: 14 },
      _.div(
        { class: "tl-monitor-card-list" },
        ...trackers.map(renderTrackerMonitorCard)
      )
    )
  );
};

const refreshTrackerMonitor = (force = false) => {
  if (workspaceViewState.trackerLogPaused && !force) return;
  const host = document.querySelector("[data-tracker-monitor-content]");
  if (!host) return;
  workspaceViewState.trackerLogPending = 0;
  host.replaceChildren(renderTrackerMonitorContent());
};

const openTrackerMonitorDialog = () => {
  const dialog = _.Dialog({
    class: "tl-tracker-monitor-dialog",
    panelClass: "tl-tracker-monitor-panel",
    size: "xl",
    title: "Monitor boxTracker",
    subtitle: "Attivita runtime, payload, errori e collegamenti dei tracker nel workspace aperto.",
    icon: "monitoring",
    closeButton: true,
    scrollable: true,
    bodyMaxHeight: "72vh",
    content: () => _.div({ "data-tracker-monitor-content": "true" }, renderTrackerMonitorContent()),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: () => refreshTrackerMonitor(true) }, icon("refresh", "sm"), "Aggiorna"),
      btn({ onclick: close }, "Chiudi")
    ),
  });
  dialog.open();
};

const deliverTrackerEventLegacy = (fromBoxId, channel = "default", payload = {}) => {
  workspaceViewState.connections
    .filter((connection) =>
      connection.fromBoxId === fromBoxId &&
      (!connection.channel || connection.channel === channel || connection.channel === "default")
    )
    .forEach((connection) => {
      const runtime = workspaceViewState.runtimes.get(connection.toBoxId);
      const handler = runtimeListener(runtime, channel);
      if (typeof handler !== "function") return;

      try {
        handler(mapConnectionPayload(payload, connection.mapping), {
          channel,
          connection,
          fromBox: workspaceViewState.boxes.find((box) => box.id === fromBoxId) || null,
          toBox: workspaceViewState.boxes.find((box) => box.id === connection.toBoxId) || null,
          workspace: workspaceViewState.workspace,
        });
      } catch (error) {
        console.error("Errore listener boxLens:", error);
        persistRuntimeEvent({
          workspaceId: workspaceViewState.workspace.id || "global",
          channel,
          eventType: "delivery_error",
          sourceNodeId: fromBoxId,
          targetNodeId: connection.toBoxId,
          payload: { error: error.message || String(error) },
          status: "error",
        });
      }
    });
};

const registerEventBusSubscriptions = () => {
  cleanupEventBusSubscriptions();
  const bus = runtimeEventBus();
  if (!bus?.on) {
    runtimeDebug("event-bus-missing", { workspaceId: workspaceViewState.workspace.id || "global" });
    return;
  }

  runtimeDebug("event-bus-subscribe-start", {
    workspaceId: workspaceViewState.workspace.id || "global",
    connections: workspaceViewState.connections.length,
  });

  workspaceViewState.connections.forEach((connection) => {
    const subscriptionChannel = connection.channel && connection.channel !== "default" ? connection.channel : "*";
    runtimeDebug("event-bus-subscribe", {
      connectionId: connection.id || "",
      fromBoxId: connection.fromBoxId || "",
      toBoxId: connection.toBoxId || "",
      channel: subscriptionChannel,
    });
    const unsubscribe = bus.on(subscriptionChannel, (payload, event) => {
      runtimeDebug("event-bus-received", {
        eventId: event.id || "",
        sourceNodeId: event.sourceNodeId || "",
        expectedSourceNodeId: connection.fromBoxId || "",
        channel: event.channel,
        connectionId: connection.id || "",
      });
      if (event.sourceNodeId !== connection.fromBoxId) return;
      const runtime = workspaceViewState.runtimes.get(connection.toBoxId);
      const handler = runtimeListener(runtime, event.channel);
      if (typeof handler !== "function") {
        runtimeDebug("delivery-handler-missing", {
          toBoxId: connection.toBoxId || "",
          channel: event.channel,
          hasRuntime: Boolean(runtime),
        });
        return;
      }

      const mappedPayload = mapConnectionPayload(payload, connection.mapping);
      const deliveryStarted = performance.now();
      try {
        handler(mappedPayload, {
          channel: event.channel,
          event: {
            id: event.id || "",
            workspaceId: event.workspaceId || workspaceViewState.workspace.id || "global",
            channel: event.channel,
            eventType: event.eventType || "emitted",
            sourceNodeId: event.sourceNodeId || "",
            targetNodeId: event.targetNodeId || "",
            connectionId: event.connectionId || "",
            status: event.status || "ok",
            latencyMs: event.latencyMs || 0,
            createdAt: event.createdAt || new Date().toISOString(),
          },
          connection: {
            id: connection.id || "",
            fromBoxId: connection.fromBoxId || "",
            toBoxId: connection.toBoxId || "",
            channel: connection.channel || event.channel || "default",
            mapping: connection.mapping || {},
          },
          fromBox: { id: connection.fromBoxId || "", name: boxById(connection.fromBoxId)?.name || "" },
          toBox: { id: connection.toBoxId || "", name: boxById(connection.toBoxId)?.name || "" },
          workspace: { id: workspaceViewState.workspace.id || "global", name: workspaceViewState.workspace.name || "" },
        });
      } catch (error) {
        recordBoxPerformanceSample({
          boxId: connection.toBoxId,
          status: "error",
          payload: mappedPayload,
          latencyMs: Math.max(1, Math.round(performance.now() - deliveryStarted)),
          error: error?.message || String(error),
        });
        persistRuntimeEvent({
          workspaceId: workspaceViewState.workspace.id || "global",
          channel: event.channel,
          eventType: "delivery_error",
          sourceNodeId: connection.fromBoxId,
          targetNodeId: connection.toBoxId,
          connectionId: connection.id || "",
          payload: { error: error?.message || String(error) },
          status: "error",
          latencyMs: Math.max(1, Math.round(performance.now() - deliveryStarted)),
        });
        throw error;
      }
      const deliveryLatencyMs = Math.max(1, Math.round(performance.now() - deliveryStarted));
      recordBoxPerformanceSample({
        boxId: connection.toBoxId,
        status: "live",
        payload: mappedPayload,
        latencyMs: deliveryLatencyMs,
      });
      runtimeDebug("delivery-dispatched", {
        connectionId: connection.id || "",
        fromBoxId: connection.fromBoxId || "",
        toBoxId: connection.toBoxId || "",
        channel: event.channel,
        deliveryLatencyMs,
      });

      persistRuntimeEvent({
        workspaceId: workspaceViewState.workspace.id || "global",
        channel: event.channel,
        eventType: "received",
        sourceNodeId: connection.fromBoxId,
        targetNodeId: connection.toBoxId,
        connectionId: connection.id || "",
        payload: mappedPayload,
        status: "ok",
        latencyMs: deliveryLatencyMs,
      });
    }, {
      id: `connection_${connection.id || connection.fromBoxId}_${connection.toBoxId}`,
      sourceNodeId: connection.fromBoxId,
      targetNodeId: connection.toBoxId,
      connectionId: connection.id || "",
      metadata: {
        workspaceId: workspaceViewState.workspace.id || "global",
        mapping: connection.mapping || {},
      },
    });
    workspaceViewState.busUnsubscribers.push(unsubscribe);
  });
};

const emitTrackerEvent = (fromBoxId, channel = "default", payload = {}, payloadText = "") => {
  runtimeDebug("tracker-emit", {
    fromBoxId,
    channel,
    hasBus: Boolean(runtimeEventBus()?.emit),
    payloadKeys: payload && typeof payload === "object" ? Object.keys(payload) : [],
  });
  recordTrackerEvent(fromBoxId, channel, payload, payloadText);

  const bus = runtimeEventBus();
  if (!bus?.emit) {
    persistRuntimeEvent({
      workspaceId: workspaceViewState.workspace.id || "global",
      channel,
      eventType: "emitted",
      sourceNodeId: fromBoxId,
      payload,
      payloadText,
      status: "ok",
      latencyMs: payload?._trackerRuntime?.latencyMs || payload?._trackerTest?.latencyMs || 0,
    });
    deliverTrackerEventLegacy(fromBoxId, channel, payload);
    return;
  }

  bus.emit(channel, payload, {
    workspaceId: workspaceViewState.workspace.id || "global",
    eventType: "emitted",
    sourceNodeId: fromBoxId,
    payloadText,
    latencyMs: payload?._trackerRuntime?.latencyMs || payload?._trackerTest?.latencyMs || 0,
  }).catch((error) => {
    console.error("Errore Event Bus:", error);
    recordTrackerError(fromBoxId, error);
  });
};

const recordSandboxIssue = ({ box, error, level = "error", message = "" } = {}) => {
  const text = message || error?.message || String(error || "Sandbox issue");
  persistRuntimeEvent({
    workspaceId: workspaceViewState.workspace.id || "global",
    channel: box?.channels?.[0] || "sandbox",
    eventType: "sandbox_error",
    sourceNodeId: box?.id || "",
    payload: { error: text },
    status: "error",
  });
  persistRuntimeFlowLog({
    workspaceId: workspaceViewState.workspace.id || "global",
    flowId: `flow_${workspaceViewState.workspace.id || "global"}`,
    nodeId: box?.id || "",
    level,
    message: text,
    context: {
      action: "sandbox-runtime",
      boxId: box?.id || "",
      boxType: box?.type || "",
    },
  });
};

const persistSandboxStatus = async (box, status = "unknown", details = {}) => {
  if (!box?.id || !window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode) return;
  try {
    await window.TrackerLensRuntimeGraphStore.upsertRuntimeNode({
      node: {
        id: box.id,
        workspaceId: workspaceViewState.workspace.id || "workspace_global",
        type: box.type || "boxLens",
        label: box.name || box.label || box.id,
        sourceRef: box.sourceId || box.assetId || box.id,
        assetId: box.assetId || box.sourceId || "",
        channels: Array.isArray(box.channels) ? box.channels : [],
        metadata: {
          ...(box.metadata || {}),
          sandbox: {
            status,
            updatedAt: new Date().toISOString(),
            ...details,
          },
        },
      },
    });
  } catch (error) {
    console.warn("Sandbox status non persistito:", error);
  }
};

const mountRuntimeBoxLegacy = (box, mount, code, html) => {
  mount.innerHTML = html;
  const runtime = executeBoxLensJs(mount, code.js, {
    mode: "workspace",
    box,
    workspace: workspaceViewState.workspace,
    data: runtimePreviewData(),
    emit: (channel, payload) => emitTrackerEvent(box.id, channel, payload),
  });
  workspaceViewState.runtimes.set(box.id, runtime);
  persistSandboxStatus(box, "legacy");
};

const mountRuntimeBox = (box) => {
  const host = document.querySelector(`[data-runtime-box-id="${safeCssQueryId(box.id)}"]`);
  const mount = host?.querySelector("[data-runtime-mount]");
  if (!host || !mount) return;

  const code = getRuntimeCode(box);
  const versioning = window.TrackerLensBoxVersioning?.validateBox?.(box);
  if (versioning?.ok === false) {
    host.dataset.versionStatus = "blocked";
    mount.innerHTML = `<div class="tl-runtime-error">Version blocked: ${versioning.errors.join(", ")}</div>`;
    return;
  }
  const sandbox = window.TrackerLensSandboxPolicy?.validateBox?.({ box, code });
  host.dataset.sandboxStatus = sandbox?.ok === false ? "blocked" : "allowed";
  if (sandbox?.ok === false) {
    mount.innerHTML = `<div class="tl-runtime-error">Sandbox blocked: ${sandbox.violations.join(", ")}</div>`;
    recordSandboxIssue({ box, message: `Sandbox blocked: ${sandbox.violations.join(", ")}` });
    persistSandboxStatus(box, "blocked", { violations: sandbox.violations });
    return;
  }
  const html = interpolateTemplate(code.html, runtimePreviewData());

  if (window.TrackerLensSandboxRunner?.mount) {
    let settled = false;
    const fallback = (error = null) => {
      if (settled) return;
      settled = true;
      host.dataset.sandboxStatus = "legacy";
      if (error) recordSandboxIssue({ box, error, message: `Sandbox fallback legacy: ${error.message}` });
      mountRuntimeBoxLegacy(box, mount, code, html);
    };
    const runtime = window.TrackerLensSandboxRunner.mount({
      host: mount,
      box,
      code: {
        html,
        css: scopeBoxLensCss(code.css, "#tl-sandbox-root"),
        js: code.js,
      },
      data: runtimePreviewData(),
      mode: "workspace",
      policy: sandbox.policy,
      onEmit: (channel, payload) => emitTrackerEvent(box.id, channel, payload),
      onReady: () => {
        settled = true;
        host.dataset.sandboxStatus = "sandboxed";
        persistSandboxStatus(box, "sandboxed");
      },
      onError: fallback,
    });
    workspaceViewState.runtimes.set(box.id, runtime);
    return;
  }

  mountRuntimeBoxLegacy(box, mount, code, html);
};

const mountRuntimeBoxes = () => {
  cleanupRuntimeBoxes();
  workspaceViewState.boxes.filter(hasRuntimeView).forEach(mountRuntimeBox);
  registerEventBusSubscriptions();
};

const trackerChannel = (box) =>
  box.outputChannel || box.runtime?.outputChannel || box.runtime?.output || box.channels?.[0] || "default";

const trackerPayload = (box) =>
  box.sampleOutput || box.runtime?.sampleOutput || {
    boxId: box.id,
    sourceId: box.sourceId || box.assetId,
    emittedAt: new Date().toISOString(),
  };

const parseHeadersText = (value = "") => {
  const text = String(value || "").trim();
  if (!text) return {};

  if (text.startsWith("{")) {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Headers JSON non valido.");
    return parsed;
  }

  return text.split(/\r?\n/).reduce((headers, line) => {
    const separator = line.indexOf(":");
    if (separator <= 0) return headers;
    const key = line.slice(0, separator).trim();
    const headerValue = line.slice(separator + 1).trim();
    if (key) headers[key] = headerValue;
    return headers;
  }, {});
};

const parseBodyText = (value = "") => {
  const text = String(value || "").trim();
  if (!text) return undefined;
  if (text.startsWith("{") || text.startsWith("[")) return JSON.parse(text);
  return text;
};

const buildUrlWithQuery = (endpoint, query = "") => {
  const text = String(query || "").trim();
  if (!text) return endpoint;
  if (text.startsWith("?") || text.includes("=")) {
    const separator = endpoint.includes("?") ? "&" : "?";
    return `${endpoint}${separator}${text.replace(/^\?/, "")}`;
  }
  return endpoint;
};

const parseFeedPayload = (xmlText) => {
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, "application/xml");
  const parseError = xml.querySelector("parsererror");
  if (parseError) throw new Error("Feed RSS/Atom non valido.");

  const nodes = [...xml.querySelectorAll("item, entry")];
  const items = nodes.map((node) => ({
    title: node.querySelector("title")?.textContent?.trim() || "",
    link: node.querySelector("link")?.getAttribute("href") || node.querySelector("link")?.textContent?.trim() || "",
    publishedAt: node.querySelector("pubDate, published, updated")?.textContent?.trim() || "",
    summary: node.querySelector("description, summary, content")?.textContent?.trim() || "",
  }));

  return {
    title: xml.querySelector("channel > title, feed > title")?.textContent?.trim() || "",
    items,
  };
};

const parseResponsePayload = async (response, source) => {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
  }

  if (source === "rss" || contentType.includes("xml") || contentType.includes("rss") || contentType.includes("atom")) {
    return parseFeedPayload(text);
  }

  if (contentType.includes("json")) return JSON.parse(text);

  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
};

const parseWebSocketMessage = (data) => {
  if (typeof data !== "string") return { data: String(data) };
  try {
    return JSON.parse(data);
  } catch {
    return { text: data };
  }
};

const getPathValue = (payload, path) =>
  String(path || "").split(".").reduce((value, key) => {
    if (value && Object.prototype.hasOwnProperty.call(value, key)) return value[key];
    return undefined;
  }, payload);

const setPathValue = (payload, path, value) => {
  const keys = String(path || "").split(".").filter(Boolean);
  if (!keys.length) return;
  const lastKey = keys.pop();
  const target = keys.reduce((node, key) => {
    if (!node[key] || typeof node[key] !== "object") node[key] = {};
    return node[key];
  }, payload);
  target[lastKey] = value;
};

const applyTransformRules = (payload, transformText = "", tracker = {}, started = performance.now()) => {
  const mapped = payload && typeof payload === "object" && !Array.isArray(payload) ? { ...payload } : { value: payload };

  String(transformText || "").split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([^#][^>-]*?)\s*(?:->|=>)\s*([A-Za-z0-9_.-]+)\s*$/);
    if (!match) return;
    const value = getPathValue(payload, match[1].trim());
    if (value !== undefined) setPathValue(mapped, match[2].trim(), value);
  });

  return {
    ...mapped,
    _trackerRuntime: {
      receivedAt: new Date().toISOString(),
      latencyMs: Math.max(1, Math.round(performance.now() - started)),
      source: tracker.source,
      endpoint: tracker.endpoint,
    },
  };
};

const trackerRuntimeConfig = (box) => {
  const asset = box.runtime && typeof box.runtime === "object" ? box.runtime : {};
  const runtime = asset.runtime && typeof asset.runtime === "object" ? asset.runtime : {};
  return {
    ...runtime,
    ...asset,
    ...box,
    source: box.source || asset.source || runtime.source || box.trackerType || asset.trackerType || runtime.trackerType || "manual",
    trackerType: box.trackerType || asset.trackerType || runtime.trackerType || runtime.source || "manual",
    runtimeMode: box.runtimeMode || asset.runtimeMode || runtime.mode || "manual",
    endpoint: box.endpoint || asset.endpoint || runtime.endpoint || "",
    method: box.method || asset.method || runtime.method || "GET",
    timeout: Number(box.timeout || asset.timeout || runtime.timeout) || 10,
    reconnect: box.reconnect ?? asset.reconnect ?? runtime.reconnect ?? true,
    reconnectInterval: Number(box.reconnectInterval || asset.reconnectInterval || runtime.reconnectInterval) || 5,
    intervalMs: Number(box.intervalMs || asset.intervalMs || runtime.intervalMs) || 0,
    outputChannel: trackerChannel(box),
    sampleOutput: box.sampleOutput || asset.sampleOutput || trackerPayload(box),
  };
};

const runRestTracker = async (tracker, started) => {
  const controller = new AbortController();
  const timeoutMs = Math.max(1, Number(tracker.timeout) || 10) * 1000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const method = (tracker.method || "GET").toUpperCase();
  const headers = parseHeadersText(tracker.headersText);
  const bodyValue = method === "GET" || method === "HEAD" ? undefined : parseBodyText(tracker.query || "");
  if (bodyValue && typeof bodyValue === "object" && !headers["Content-Type"] && !headers["content-type"]) {
    headers["Content-Type"] = "application/json";
  }

  try {
    const response = await fetch(buildUrlWithQuery(tracker.endpoint, method === "GET" ? tracker.query || "" : ""), {
      method,
      headers,
      signal: controller.signal,
      body: bodyValue && typeof bodyValue === "object" ? JSON.stringify(bodyValue) : bodyValue,
    });
    return applyTransformRules(await parseResponsePayload(response, tracker.source), tracker.transformText, tracker, started);
  } finally {
    clearTimeout(timer);
  }
};

const runManualTracker = (tracker, started) => {
  const queryPayload = parseBodyText(tracker.query || "");
  const payload = queryPayload === undefined ? tracker.sampleOutput : queryPayload;
  return applyTransformRules(payload, tracker.transformText, tracker, started);
};

const executeTrackerRuntime = async (tracker) => {
  const started = performance.now();
  const source = tracker.source || tracker.trackerType;
  if (source === "rest" || source === "rss") return runRestTracker(tracker, started);
  if (source === "manual" || !tracker.endpoint) return runManualTracker(tracker, started);
  return runRestTracker(tracker, started);
};

const startWebSocketTrackerRuntime = (box, tracker, emit) => {
  runtimeDebug("websocket-start", {
    boxId: box.id,
    endpoint: tracker.endpoint,
    channel: tracker.outputChannel || trackerChannel(box),
    reconnect: tracker.reconnect,
  });
  if (!tracker.endpoint) {
    runtimeDebug("websocket-missing-endpoint", { boxId: box.id });
    queueMicrotask(() => emit(runManualTracker(tracker)));
    return null;
  }

  let disposed = false;
  let socket = null;
  let reconnectTimer = null;

  const connect = () => {
    if (disposed) return;
    try {
      socket = new WebSocket(tracker.endpoint);
    } catch (error) {
      trackerLaunch("websocket-constructor-error", { boxId: box.id, endpoint: tracker.endpoint, message: error?.message || String(error) }, "error");
      runtimeDebug("websocket-constructor-error", { boxId: box.id, message: error?.message || String(error) });
      recordTrackerError(box.id, error);
      return;
    }
    socket.onopen = () => {
      const query = String(tracker.query || "").trim();
      if (query) socket.send(query);
      trackerLaunch("websocket-open", { boxId: box.id, endpoint: tracker.endpoint, sentQuery: Boolean(query) });
      runtimeDebug("websocket-open", { boxId: box.id, endpoint: tracker.endpoint, sentQuery: Boolean(query) });
      updateTrackerStat(box.id, { status: "live", channel: tracker.outputChannel || trackerChannel(box), lastError: "" });
    };
    socket.onmessage = (event) => {
      const payload = applyTransformRules(parseWebSocketMessage(event.data), tracker.transformText, tracker);
      trackerLaunch("websocket-message", {
        boxId: box.id,
        channel: tracker.outputChannel || trackerChannel(box),
        rawLength: String(event.data || "").length,
      });
      runtimeDebug("websocket-message", {
        boxId: box.id,
        channel: tracker.outputChannel || trackerChannel(box),
        rawLength: String(event.data || "").length,
        payloadKeys: payload && typeof payload === "object" ? Object.keys(payload) : [],
      });
      emit(payload, event.data);
    };
    socket.onerror = () => {
      trackerLaunch("websocket-error", { boxId: box.id, endpoint: tracker.endpoint }, "error");
      runtimeDebug("websocket-error", { boxId: box.id, endpoint: tracker.endpoint });
      recordTrackerError(box.id, new Error("Errore connessione WebSocket."));
      socket?.close();
    };
    socket.onclose = () => {
      trackerLaunch("websocket-close", { boxId: box.id, reconnect: tracker.reconnect, disposed }, tracker.reconnect && !disposed ? "warn" : "info");
      runtimeDebug("websocket-close", { boxId: box.id, reconnect: tracker.reconnect, disposed });
      if (!disposed && tracker.reconnect) {
        reconnectTimer = setTimeout(connect, Math.max(1, Number(tracker.reconnectInterval) || 5) * 1000);
      }
    };
  };

  connect();

  return () => {
    disposed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    socket?.close();
  };
};

const startTrackerRuntime = (box) => {
  trackerLaunch("tracker-start-request", {
    boxId: box.id,
    name: box.name || "",
    type: box.type || "",
    detectedTracker: isBoxTracker(box),
  });
  runtimeDebug("tracker-start-request", {
    boxId: box.id,
    type: box.type,
    detectedTracker: isBoxTracker(box),
    source: box.source || box.trackerType || box.runtime?.source || box.runtime?.trackerType || box.runtime?.runtime?.source || "",
  });
  if (workspaceViewState.pausedTrackers.has(box.id)) {
    trackerLaunch("tracker-paused", { boxId: box.id }, "warn");
    runtimeDebug("tracker-paused", { boxId: box.id });
    updateTrackerStat(box.id, { status: "paused" });
    return;
  }

  const tracker = trackerRuntimeConfig(box);
  trackerLaunch("tracker-config", {
    boxId: box.id,
    source: tracker.source,
    trackerType: tracker.trackerType,
    endpoint: tracker.endpoint,
    outputChannel: tracker.outputChannel,
    active: tracker.active,
    autoStart: tracker.autoStart,
  });
  runtimeDebug("tracker-config", {
    boxId: box.id,
    source: tracker.source,
    trackerType: tracker.trackerType,
    endpoint: tracker.endpoint,
    outputChannel: tracker.outputChannel,
    active: tracker.active,
    autoStart: tracker.autoStart,
    intervalMs: tracker.intervalMs,
  });
  if (tracker.active === false || tracker.autoStart === false) {
    trackerLaunch("tracker-stopped-by-config", { boxId: box.id, active: tracker.active, autoStart: tracker.autoStart }, "warn");
    runtimeDebug("tracker-stopped-by-config", { boxId: box.id, active: tracker.active, autoStart: tracker.autoStart });
    updateTrackerStat(box.id, { status: "stopped", channel: tracker.outputChannel || trackerChannel(box) });
    return;
  }

  const channel = tracker.outputChannel || trackerChannel(box);
  const emit = (payload = trackerPayload(box), payloadText = "") => emitTrackerEvent(box.id, channel, payload, payloadText);
  updateTrackerStat(box.id, { status: "starting", channel, startedAt: new Date().toISOString() });

  if ((tracker.source || tracker.trackerType) === "websocket") {
    trackerLaunch("tracker-launch-websocket", { boxId: box.id, endpoint: tracker.endpoint, channel });
    const dispose = startWebSocketTrackerRuntime(box, tracker, emit);
    if (dispose) workspaceViewState.trackerTimers.set(box.id, dispose);
    return;
  }

  const run = async () => {
    try {
      trackerLaunch("tracker-run-once", { boxId: box.id, source: tracker.source || tracker.trackerType, channel });
      emit(await executeTrackerRuntime(tracker));
    } catch (error) {
      trackerLaunch("tracker-run-error", { boxId: box.id, message: error?.message || String(error) }, "error");
      console.error(`Errore runtime boxTracker ${box.id}:`, error);
      recordTrackerError(box.id, error);
      emit(tracker.sampleOutput || trackerPayload(box));
    }
  };

  run();

  if (tracker.intervalMs > 0) {
    workspaceViewState.trackerTimers.set(box.id, setInterval(run, tracker.intervalMs));
  }
};

const startTrackerRuntimes = () => {
  cleanupTrackerRuntimes();
  const trackers = workspaceViewState.boxes.filter(isBoxTracker);
  trackerLaunch("tracker-start-all", {
    workspaceId: workspaceViewState.workspace.id || "global",
    boxes: workspaceViewState.boxes.length,
    trackers: trackers.map((box) => ({ id: box.id, type: box.type, name: box.name })),
  });
  runtimeDebug("tracker-start-all", {
    workspaceId: workspaceViewState.workspace.id || "global",
    boxes: workspaceViewState.boxes.length,
    trackers: trackers.map((box) => ({ id: box.id, type: box.type, name: box.name })),
  });
  trackers.forEach(startTrackerRuntime);
};

const startBackgroundGraphRuntime = () => {
  const workspaceId = workspaceViewState.workspace.id || "workspace_global";
  if (!workspaceId || !window.TrackerLensRuntimeWorker?.start) return;
  window.TrackerLensRuntimeWorker.start({ workspaceId, refreshMs: 5000 });
  runtimeDebug("runtime-worker-start", { workspaceId, source: "workspace-view" });
};

const mountWorkspaceView = () => {
  const root = document.getElementById("tl-workspace-view-root");
  cleanupWorkspaceRuntime();
  root.replaceChildren(
    _.div(
      { class: "tl-view-shell" },
      renderTopbar(),
      _.div({ class: "tl-view-body" }, renderSidebar(), renderWorkspaceGrid())
    )
  );

  const searchInput = root.querySelector(".tl-view-search input");
  if (searchInput) {
    searchInput.placeholder = "Cerca workspace...";
    searchInput.setAttribute("aria-label", "Cerca workspace");
  }

  mountRuntimeBoxes();
  startTrackerRuntimes();
  startBackgroundGraphRuntime();
};

const loadWorkspaceView = async () => {
  const workspaceId = new URLSearchParams(window.location.search).get("workspaceId");

  if (!workspaceId) {
    workspaceViewState.loading = false;
    mountWorkspaceView();
    return;
  }

  mountWorkspaceView();

  try {
    const items = await window.TrackerLensLocalLibrary.listLibraryItems();
    const workspace = items.find((item) => item.type === "workspace" && item.id === workspaceId);
    const record = await readWorkspaceRecord(workspaceId);
    const content = record?.content;
    if (!content) throw new Error("Workspace non trovato.");

    workspaceViewState.workspace = {
      ...workspaceViewState.workspace,
      ...content,
      id: record.id || content.id || workspace?.id || workspaceId,
    };
    workspaceViewState.boxes = await hydrateWorkspaceBoxes(Array.isArray(content.boxes) ? content.boxes : []);
    workspaceViewState.connections = await loadWorkspaceConnections({
      workspaceId: workspaceViewState.workspace.id || workspaceId,
      contentConnections: Array.isArray(content.connections) ? content.connections : [],
    });
    workspaceViewState.loading = false;
    workspaceViewState.error = "";
  } catch (error) {
    console.error(error);
    workspaceViewState.loading = false;
    workspaceViewState.error = error?.message || "Workspace non leggibile.";
  }

  mountWorkspaceView();
};

CMSwift.ready(loadWorkspaceView);
