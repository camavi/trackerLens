const root = document.getElementById("tl-devtools-root");
const icon = (name, size = "md") => _.Icon({ name, size });
const btn = (props, ...children) => _.Btn({ type: "button", ...props }, ...children);
const params = new URLSearchParams(window.location.search);

const tabs = [
  { id: "overview", label: "Overview", icon: "dashboard" },
  { id: "graph", label: "Graph", icon: "account_tree" },
  { id: "events", label: "Events", icon: "bolt" },
  { id: "channels", label: "Channels", icon: "hub" },
  { id: "offline", label: "Offline", icon: "cloud_off" },
  { id: "packages", label: "Packages", icon: "deployed_code" },
  { id: "time", label: "Time Travel", icon: "history" },
  { id: "performance", label: "Performance", icon: "speed" },
  { id: "ai", label: "AI", icon: "psychology" },
];

const state = {
  loading: true,
  error: "",
  tab: tabs.some((tab) => tab.id === params.get("tab")) ? params.get("tab") : "overview",
  data: null,
  selected: {
    type: params.get("type") || (params.get("nodeId") ? "node" : params.get("eventId") ? "event" : params.get("channel") ? "channel" : ""),
    id: params.get("id") || params.get("nodeId") || params.get("eventId") || params.get("channel") || "",
  },
  filters: {
    eventType: params.get("eventType") || "all",
    channel: params.get("channelFilter") || params.get("channel") || "all",
    channelStatus: params.get("channelStatus") || "all",
  },
  timeDiff: null,
  timeReplay: null,
};

const formatDate = (value) => {
  if (!value) return "N/D";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("it-IT");
};

const number = (value) => Number(value || 0).toLocaleString("it-IT");
const runtime = () => state.data?.graph?.runtime || {};
const graph = () => state.data?.graph?.graph || {};
const validation = () => state.data?.graph?.validation || { issues: [], errors: [], warnings: [] };
const jsonPreview = (value) => {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch (_) {
    return String(value ?? "");
  }
};

const scrollInspectorIntoView = () => {
  window.requestAnimationFrame(() => {
    document.querySelector(".tl-devtools-inspector")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  });
};

const selectDetail = (type, id) => {
  state.selected = { type, id: String(id || "") };
  const query = new URLSearchParams(window.location.search);
  query.set("tab", state.tab);
  query.set("type", type);
  query.set("id", String(id || ""));
  history.replaceState(null, "", `${window.location.pathname}?${query.toString()}`);
  mount();
  scrollInspectorIntoView();
};

const setTab = (tab) => {
  state.tab = tab;
  const query = new URLSearchParams(window.location.search);
  query.set("tab", tab);
  history.replaceState(null, "", `${window.location.pathname}?${query.toString()}`);
  mount();
};

const updateFilter = (key, value) => {
  state.filters[key] = value || "all";
  const query = new URLSearchParams(window.location.search);
  query.set("tab", state.tab);
  Object.entries(state.filters).forEach(([filterKey, filterValue]) => {
    if (filterValue && filterValue !== "all") query.set(filterKey, filterValue);
    else query.delete(filterKey);
  });
  history.replaceState(null, "", `${window.location.pathname}?${query.toString()}`);
  mount();
};

const closeInspector = () => {
  state.selected = { type: "", id: "" };
  const query = new URLSearchParams(window.location.search);
  query.delete("type");
  query.delete("id");
  query.delete("nodeId");
  query.delete("eventId");
  query.delete("channel");
  history.replaceState(null, "", `${window.location.pathname}?${query.toString()}`);
  mount();
};

const metric = (label, value, iconName, tone = "cyan") =>
  _.article(
    { class: `tl-devtools-metric is-${tone}` },
    _.span({ class: "tl-devtools-metric-icon" }, icon(iconName, "sm")),
    _.div(
      _.span({ class: "tl-devtools-metric-value" }, number(value)),
      _.span({ class: "tl-devtools-metric-label" }, label)
    )
  );

const empty = (message) =>
  _.div({ class: "tl-devtools-empty" }, icon("info", "sm"), _.span(message));

const table = (headers, rows) => {
  if (!rows.length) return empty("Nessun dato disponibile");
  return _.div(
    { class: "tl-devtools-table-wrap" },
    _.table(
      { class: "tl-devtools-table" },
      _.thead(_.tr(...headers.map((header) => _.th(header)))),
      _.tbody(...rows)
    )
  );
};

const actionCell = (label, onclick) =>
  _.td(btn({ class: "tl-devtools-row-action", onclick }, icon("open_in_new", "sm"), label));

const badge = (label, tone = "") =>
  _.span({ class: `tl-devtools-badge${tone ? ` is-${tone}` : ""}` }, label);

const select = (value, options, onChange) =>
  _.select(
    { class: "tl-devtools-select", value, onchange: (event) => onChange(event.target.value) },
    ...options.map((option) => _.option({ value: option.value }, option.label))
  );

const option = (value, label = value) => ({ value, label });

const parseMaybeJson = (value) => {
  if (!value || typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_) {
    return null;
  }
};

const isStoredMemory = (item = {}) =>
  Boolean(item.id && item.raw && !Array.isArray(item.raw.items) && !/^memory_(scope|widgets|workspaces|connections)/.test(item.id));

const pinMemoryRecord = async (item, pinned) => {
  if (!isStoredMemory(item) || !window.TrackerLensAiRuntimeStore?.pinMemory) return;
  await window.TrackerLensAiRuntimeStore.pinMemory(item.id, pinned);
  await loadDevTools();
};

const forgetMemoryRecord = async (item) => {
  if (!isStoredMemory(item) || !window.TrackerLensAiRuntimeStore?.forgetMemory) return;
  const label = item.name || item.id || "Memory";
  if (!window.confirm(`Dimenticare questa memoria?\n\n${label}`)) return;
  await window.TrackerLensAiRuntimeStore.forgetMemory(item.id);
  if (state.selected.type === "aiMemory" && state.selected.id === item.id) {
    state.selected = { type: "", id: "" };
  }
  await loadDevTools();
};

const memoryActionCell = (item) => {
  if (!isStoredMemory(item)) return actionCell("Inspect", () => openAiMemoryDialog(item));
  return _.td(
    _.div(
      { class: "tl-devtools-row-actions" },
      btn({ class: "tl-devtools-row-action", onclick: () => openAiMemoryDialog(item) }, icon("open_in_new", "sm"), "Inspect"),
      btn(
        { class: "tl-devtools-row-action", onclick: () => pinMemoryRecord(item, !item.pinned) },
        icon(item.pinned ? "keep_off" : "push_pin", "sm"),
        item.pinned ? "Unpin" : "Pin"
      ),
      btn({ class: "tl-devtools-row-action is-danger", onclick: () => forgetMemoryRecord(item) }, icon("delete", "sm"), "Forget")
    )
  );
};

const renderOverview = () => {
  const data = state.data || {};
  const graph = data.graph || {};
  const runtime = graph.runtime || {};
  const offline = data.offline || {};
  return _.section(
    { class: "tl-devtools-panel" },
    _.div(
      { class: "tl-devtools-overview-grid" },
      _.div(
        { class: "tl-devtools-section" },
        _.h2("Runtime Graph"),
        _.p("Stato compatto del grafo runtime centrale."),
        table(["Metric", "Value"], [
          _.tr(_.td("Nodes"), _.td(number(data.stats?.graphNodes))),
          _.tr(_.td("Dependencies"), _.td(number(data.stats?.graphDependencies))),
          _.tr(_.td("Channels"), _.td(number(runtime.channels?.length))),
          _.tr(_.td("Events"), _.td(number(runtime.events?.length))),
          _.tr(_.td("Graph errors"), _.td(number(graph.validation?.errors?.length))),
        ])
      ),
      _.div(
        { class: "tl-devtools-section" },
        _.h2("Runtime Core"),
        _.p("Moduli collegati alla base offline-first."),
        table(["Source", "State"], [
          _.tr(_.td("Offline queue"), _.td(offline?.online === false ? "offline" : "ready")),
          _.tr(_.td("Package registry"), _.td(`${number(data.packages?.length)} packages`)),
          _.tr(_.td("Time travel"), _.td(`${number(data.snapshots?.length)} snapshots`)),
          _.tr(_.td("Performance monitor"), _.td(`${number(data.performance?.length)} records`)),
        ])
      )
    )
  );
};

const renderGraph = () => {
  const nodes = graph().nodes || [];
  const dependencies = graph().dependencies || [];
  const graphValidation = validation();
  return _.section(
    { class: "tl-devtools-panel" },
    _.div(
      { class: "tl-devtools-section" },
      _.h2("Graph Validation"),
      _.p("Controlli centrali su endpoints, duplicati, direzione e coerenza runtime."),
      _.div(
        { class: "tl-devtools-validation-summary" },
        badge(graphValidation.ok ? "valid graph" : "issues found", graphValidation.ok ? "green" : "red"),
        badge(`${number(graphValidation.errors?.length)} errors`, graphValidation.errors?.length ? "red" : ""),
        badge(`${number(graphValidation.warnings?.length)} warnings`, graphValidation.warnings?.length ? "gold" : "")
      ),
      table(["Level", "Type", "Message", "Source", "Target", "Channel"], (graphValidation.issues || []).map((issue) =>
        _.tr(
          _.td(badge(issue.level || "info", issue.level === "error" ? "red" : "gold")),
          _.td(issue.type || "graph"),
          _.td(issue.message || "N/D"),
          _.td(issue.sourceNodeId || "N/D"),
          _.td(issue.targetNodeId || "N/D"),
          _.td(issue.channel || "N/D")
        )
      ))
    ),
    _.div(
      { class: "tl-devtools-section" },
      _.h2("Nodes"),
      table(["Node", "Type", "Workspace", "Status", "Impact", ""], nodes.map((node) => {
        const impact = window.TrackerLensGraphEngine?.impactAnalysis
          ? window.TrackerLensGraphEngine.impactAnalysis({ graph: graph(), runtime: runtime(), nodeId: node.id })
          : null;
        return _.tr(
          _.td(node.label || node.name || node.id || "N/D"),
          _.td(node.type || "N/D"),
          _.td(node.workspaceId || "N/D"),
          _.td(node.status || "N/D"),
          _.td(`${number(impact?.upstream?.length)} in · ${number(impact?.downstream?.length)} out`),
          actionCell("Inspect", () => selectDetail("node", node.id))
        );
      }))
    ),
    _.div(
      { class: "tl-devtools-section" },
      _.h2("Dependencies"),
      table(["Source", "Target", "Channel", "Status", "Connection", ""], dependencies.map((dependency) =>
        _.tr(
          _.td(dependency.sourceNodeId || "N/D"),
          _.td(dependency.targetNodeId || "N/D"),
          _.td(dependency.channel || "runtime"),
          _.td(dependency.status || "N/D"),
          _.td(dependency.connectionId || "N/D"),
          actionCell("Inspect", () => selectDetail("dependency", dependency.id || dependency.connectionId))
        )
      ))
    )
  );
};

const renderEvents = () => {
  const allEvents = [...(runtime().events || [])];
  const eventTypes = ["all", ...new Set(allEvents.map((event) => event.eventType || event.type || "event").filter(Boolean))];
  const channels = ["all", ...new Set(allEvents.map((event) => event.channel).filter(Boolean))];
  const events = allEvents
    .filter((event) => state.filters.eventType === "all" || (event.eventType || event.type || "event") === state.filters.eventType)
    .filter((event) => state.filters.channel === "all" || event.channel === state.filters.channel)
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  const flowLogs = [...(runtime().flowLogs || [])].sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  return _.section(
    { class: "tl-devtools-panel" },
    _.div(
      { class: "tl-devtools-section" },
      _.div(
        { class: "tl-devtools-section-head" },
        _.h2("Runtime Events"),
        _.div(
          { class: "tl-devtools-filters" },
          select(state.filters.eventType, eventTypes.map((item) => option(item, item === "all" ? "All types" : item)), (value) => updateFilter("eventType", value)),
          select(state.filters.channel, channels.map((item) => option(item, item === "all" ? "All channels" : item)), (value) => updateFilter("channel", value))
        )
      ),
      table(["Time", "Type", "Channel", "Source", "Target", "Status", ""], events.map((event) =>
        _.tr(
          _.td(formatDate(event.createdAt)),
          _.td(event.eventType || event.type || "event"),
          _.td(event.channel || "N/D"),
          _.td(event.sourceNodeId || "N/D"),
          _.td(event.targetNodeId || "N/D"),
          _.td(event.status || "ok"),
          actionCell("Inspect", () => selectDetail("event", event.id))
        )
      ))
    ),
    _.div(
      { class: "tl-devtools-section" },
      _.h2("Flow Logs"),
      table(["Time", "Level", "Action", "Node", "Channel", ""], flowLogs.map((log) =>
        _.tr(
          _.td(formatDate(log.createdAt)),
          _.td(log.level || "info"),
          _.td(log.action || log.message || "log"),
          _.td(log.nodeId || log.sourceNodeId || "N/D"),
          _.td(log.channel || "N/D"),
          actionCell("Inspect", () => selectDetail("flowLog", log.id))
        )
      ))
    )
  );
};

const renderChannels = () => {
  const allChannels = [...(runtime().channels || [])];
  const statuses = ["all", ...new Set(allChannels.map((channel) => channel.status || "active").filter(Boolean))];
  const channels = allChannels
    .filter((channel) => state.filters.channelStatus === "all" || (channel.status || "active") === state.filters.channelStatus)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  return _.section(
    { class: "tl-devtools-panel" },
    _.div(
      { class: "tl-devtools-section" },
      _.div(
        { class: "tl-devtools-section-head" },
        _.h2("Runtime Channels"),
        _.div({ class: "tl-devtools-filters" }, select(state.filters.channelStatus, statuses.map((item) => option(item, item === "all" ? "All statuses" : item)), (value) => updateFilter("channelStatus", value)))
      ),
      table(["Name", "Workspace", "Producers", "Subscribers", "Updated", ""], channels.map((channel) =>
        _.tr(
          _.td(channel.name || channel.id || "N/D"),
          _.td(channel.workspaceId || "global"),
          _.td(number(channel.producers?.length)),
          _.td(number(channel.subscribers?.length)),
          _.td(formatDate(channel.updatedAt || channel.lastEventAt)),
          actionCell("Inspect", () => selectDetail("channel", channel.name || channel.id))
        )
      ))
    )
  );
};

const renderOffline = () => {
  const offline = state.data?.offline || {};
  const queue = state.data?.offlineQueue || [];
  const cache = state.data?.offlineCache || [];
  return _.section(
    { class: "tl-devtools-panel" },
    _.div(
      { class: "tl-devtools-section" },
      _.h2("Offline-first"),
      table(["Metric", "Value"], [
        _.tr(_.td("Online"), _.td(offline.online === false ? "no" : "yes")),
        _.tr(_.td("Pending"), _.td(number(offline.pendingCount))),
        _.tr(_.td("Queue"), _.td(number(offline.queueCount))),
        _.tr(_.td("Cache"), _.td(number(offline.cacheCount))),
        _.tr(_.td("Updated"), _.td(formatDate(offline.updatedAt))),
      ])
    ),
    _.div(
      { class: "tl-devtools-section" },
      _.div(
        { class: "tl-devtools-section-head" },
        _.h2("Sync Queue"),
        btn({ class: "tl-devtools-row-action", onclick: processOfflineQueue }, icon("sync", "sm"), "Process")
      ),
      table(["Operation", "Target", "Status", "Attempts", "Updated", ""], queue.map((item) =>
        _.tr(
          _.td(item.operation || "sync"),
          _.td(item.target || "N/D"),
          _.td(badge(item.status || "pending", item.status === "done" ? "green" : item.status === "conflict" ? "gold" : "")),
          _.td(number(item.attempts)),
          _.td(formatDate(item.updatedAt || item.createdAt)),
          _.td(item.status === "conflict"
            ? btn({ class: "tl-devtools-row-action", onclick: () => resolveOfflineConflict(item.id) }, icon("rule", "sm"), "Resolve")
            : btn({ class: "tl-devtools-row-action", onclick: () => selectDetail("offline", item.id) }, icon("open_in_new", "sm"), "Inspect"))
        )
      ))
    ),
    _.div(
      { class: "tl-devtools-section" },
      _.h2("Offline Cache"),
      table(["Scope", "Key", "TTL", "Updated"], cache.map((item) =>
        _.tr(_.td(item.scope || "runtime"), _.td(item.key || item.id), _.td(item.expiresAt ? formatDate(item.expiresAt) : "none"), _.td(formatDate(item.updatedAt)))
      ))
    )
  );
};

const renderPackages = () => {
  const packages = state.data?.packages || [];
  const locks = state.data?.packageLocks || [];
  return _.section(
    { class: "tl-devtools-panel" },
    _.div(
      { class: "tl-devtools-section" },
      _.div(
        { class: "tl-devtools-section-head" },
        _.h2("Internal Packages"),
        btn({ class: "tl-devtools-row-action", onclick: installSelectedPackage }, icon("download", "sm"), "Install latest")
      ),
      table(["Name", "Version", "Type", "Status", ""], packages.map((item) =>
        _.tr(
          _.td(item.name || item.id || "N/D"),
          _.td(item.version || "N/D"),
          _.td(item.type || item.category || "package"),
          _.td(item.status || "registered"),
          actionCell("Inspect", () => selectDetail("package", item.id))
        )
      ))
    ),
    _.div(
      { class: "tl-devtools-section" },
      _.h2("Package Locks"),
      table(["Workspace", "Package", "Version", "Locked"], locks.map((item) =>
        _.tr(_.td(item.workspaceId || "global"), _.td(item.name || item.packageId), _.td(item.version || "N/D"), _.td(formatDate(item.lockedAt)))
      ))
    )
  );
};

const renderTime = () => {
  const snapshots = state.data?.snapshots || [];
  return _.section(
    { class: "tl-devtools-panel" },
    _.div(
      { class: "tl-devtools-section" },
      _.div(
        { class: "tl-devtools-section-head" },
        _.h2("Time Travel"),
        btn({ class: "tl-devtools-row-action", onclick: captureSnapshot }, icon("add_a_photo", "sm"), "Capture")
      ),
      table(["Snapshot", "Workspace", "Reason", "Created", ""], snapshots.map((item) =>
        _.tr(
          _.td(item.id || "N/D"),
          _.td(item.workspaceId || "global"),
          _.td(item.reason || item.label || "snapshot"),
          _.td(formatDate(item.createdAt || item.updatedAt)),
          _.td(
            _.div(
              { class: "tl-devtools-row-actions" },
              btn({ class: "tl-devtools-row-action", onclick: () => selectDetail("snapshot", item.id) }, icon("open_in_new", "sm"), "Inspect"),
              btn({ class: "tl-devtools-row-action", onclick: () => restoreSnapshot(item.id) }, icon("restore", "sm"), "Restore"),
              btn({ class: "tl-devtools-row-action", onclick: () => replaySnapshot(item.id) }, icon("play_arrow", "sm"), "Replay")
            )
          )
        )
      ))
    ),
    state.timeReplay
      ? _.div({ class: "tl-devtools-section" }, _.h2("Replay Preview"), table(["Time", "Type", "Channel", "Status"], state.timeReplay.events.map((event) =>
        _.tr(_.td(formatDate(event.createdAt)), _.td(event.eventType || "event"), _.td(event.channel || "N/D"), _.td(event.status || "ok"))
      )))
      : null,
    state.timeDiff
      ? _.div({ class: "tl-devtools-section" }, _.h2("Snapshot Diff"), table(["Store", "Added", "Removed", "Changed"], state.timeDiff.changes.map((item) =>
        _.tr(_.td(item.key), _.td(number(item.added.length)), _.td(number(item.removed.length)), _.td(number(item.changed.length)))
      )))
      : snapshots.length > 1
        ? _.div({ class: "tl-devtools-section" }, _.h2("Snapshot Diff"), btn({ class: "tl-devtools-row-action", onclick: () => diffLatestSnapshots(snapshots[1].id, snapshots[0].id) }, icon("difference", "sm"), "Diff latest"))
        : null
  );
};

const renderPerformance = () =>
  _.section(
    { class: "tl-devtools-panel" },
    _.div(
      { class: "tl-devtools-section" },
      _.h2("Box Performance"),
      table(["Box", "Events/s", "Avg latency", "Errors", "Memory"], (state.data?.performance || []).map((item) =>
        _.tr(
          _.td(item.boxId || item.nodeId || "N/D"),
          _.td(number(item.eventsPerSecond)),
          _.td(`${number(item.avgLatencyMs)} ms`),
          _.td(number(item.errorCount || item.errorRate)),
          _.td(item.memoryMb ? `${number(item.memoryMb)} MB` : "N/D")
        )
      ))
    )
  );

const renderAi = () => {
  const ai = state.data?.ai || {};
  const providers = ai.providers || [];
  const agents = ai.agents || [];
  const jobs = ai.jobs || [];
  const memory = ai.memory || [];
  return _.section(
    { class: "tl-devtools-panel" },
    _.div(
      { class: "tl-devtools-section" },
      _.h2("AI Runtime"),
      table(["Metric", "Value"], [
        _.tr(_.td("Providers"), _.td(number(providers.length))),
        _.tr(_.td("Agents"), _.td(number(agents.length))),
        _.tr(_.td("Jobs"), _.td(number(jobs.length))),
        _.tr(_.td("Memory blocks"), _.td(number(memory.length))),
      ])
    ),
    _.div(
      { class: "tl-devtools-section" },
      _.h2("Providers"),
      table(["Name", "Model", "Status", "Local", ""], providers.map((item) =>
        _.tr(
          _.td(item.name || item.id || "N/D"),
          _.td(item.model || "N/D"),
          _.td(item.status || "idle"),
          _.td(item.local ? "yes" : "no"),
          actionCell("Inspect", () => selectDetail("aiProvider", item.id || item.name))
        )
      ))
    ),
    _.div(
      { class: "tl-devtools-section" },
      _.h2("Memory"),
      table(["Name", "Kind", "Scope", "Workspace", "Status", "Updated", ""], memory.map((item) =>
        _.tr(
          _.td(item.name || item.id || "Memory"),
          _.td(item.kind || item.tags?.[0] || "summary"),
          _.td(item.scope || "workspace"),
          _.td(item.workspaceId || "global"),
          _.td(item.pinned ? badge("pinned", "gold") : item.status || "active"),
          _.td(formatDate(item.updatedAt)),
          memoryActionCell(item)
        )
      ))
    )
  );
};

const processOfflineQueue = async () => {
  await window.TrackerLensOfflineFirst?.processQueue?.();
  await loadDevTools();
};

const resolveOfflineConflict = async (id) => {
  await window.TrackerLensOfflineFirst?.resolveConflict?.({ id, resolution: "retry", note: "Resolved from DevTools" });
  await loadDevTools();
};

const installSelectedPackage = async () => {
  const pkg = state.data?.packages?.[0];
  if (!pkg) return;
  await window.TrackerLensPackageSystem?.installPackage?.({ workspaceId: "global", name: pkg.name, range: pkg.version });
  await loadDevTools();
};

const captureSnapshot = async () => {
  await window.TrackerLensTimeTravelStore?.capture?.({ workspaceId: "global", reason: "devtools", label: "DevTools capture" });
  await loadDevTools();
};

const restoreSnapshot = async (snapshotId) => {
  await window.TrackerLensTimeTravelStore?.restore?.({ snapshotId });
  await loadDevTools();
};

const replaySnapshot = async (snapshotId) => {
  state.timeReplay = await window.TrackerLensTimeTravelStore?.replay?.({ snapshotId, limit: 25 });
  mount();
};

const diffLatestSnapshots = async (fromId, toId) => {
  state.timeDiff = await window.TrackerLensTimeTravelStore?.diffSnapshots?.({ fromId, toId });
  mount();
};

const activePanel = () => ({
  overview: renderOverview,
  graph: renderGraph,
  events: renderEvents,
  channels: renderChannels,
  offline: renderOffline,
  packages: renderPackages,
  time: renderTime,
  performance: renderPerformance,
  ai: renderAi,
}[state.tab] || renderOverview)();

const selectedRecord = () => {
  const { type, id } = state.selected;
  if (!type || !id) return null;
  if (type === "node") return (graph().nodes || []).find((node) => node.id === id || node.sourceRef === id || node.assetId === id);
  if (type === "event") return (runtime().events || []).find((event) => event.id === id);
  if (type === "flowLog") return (runtime().flowLogs || []).find((log) => log.id === id);
  if (type === "channel") return (runtime().channels || []).find((channel) => channel.name === id || channel.id === id);
  if (type === "dependency") return (graph().dependencies || []).find((dependency) => dependency.id === id || dependency.connectionId === id);
  if (type === "offline") return (state.data?.offlineQueue || []).find((item) => item.id === id);
  if (type === "package") return (state.data?.packages || []).find((item) => item.id === id);
  if (type === "snapshot") return (state.data?.snapshots || []).find((item) => item.id === id);
  if (type === "aiProvider") return (state.data?.ai?.providers || []).find((item) => item.id === id || item.name === id);
  if (type === "aiMemory") return (state.data?.ai?.memory || []).find((item) => item.id === id);
  return null;
};

const renderAiMemoryDetail = (record) => {
  const meta = parseMaybeJson(record.meta) || parseMaybeJson(record.raw?.meta) || {};
  const provenance = {
    kind: meta.kind || record.kind || "note",
    source: meta.source || meta.sourceNodeId || record.agentId || "shared",
    nodeId: meta.nodeId || "",
    nodeLabel: meta.nodeLabel || meta.nextLabel || record.name || "",
    endpoint: meta.endpoint || "",
    prompt: meta.prompt || "",
    appliedAt: meta.appliedAt || record.pinnedAt || record.updatedAt || "",
  };
  return [
    _.div(
      { class: "tl-devtools-inspector-stats" },
      _.span(record.pinned ? "pinned" : record.status || "active"),
      _.span(record.scope || "workspace"),
      _.span(record.workspaceId || "global"),
      _.span(record.kind || "note")
    ),
    _.div(
      { class: "tl-devtools-impact" },
      _.h3("Memory"),
      _.div(
        { class: "tl-devtools-impact-grid" },
        _.span("Text"), _.strong(record.text || record.summary || record.meta || "N/D"),
        _.span("Summary"), _.strong(record.summary || record.meta || "N/D"),
        _.span("Tags"), _.strong(Array.isArray(record.tags) && record.tags.length ? record.tags.join(", ") : "N/D"),
        _.span("Weight"), _.strong(number(record.weight || 0))
      )
    ),
    _.div(
      { class: "tl-devtools-impact" },
      _.h3("Provenance"),
      _.div(
        { class: "tl-devtools-impact-grid" },
        _.span("Kind"), _.strong(provenance.kind),
        _.span("Source"), _.strong(provenance.source || "N/D"),
        _.span("Node"), _.strong([provenance.nodeLabel, provenance.nodeId].filter(Boolean).join(" / ") || "N/D"),
        _.span("Endpoint"), _.strong(provenance.endpoint || "N/D"),
        _.span("Prompt"), _.strong(provenance.prompt || "N/D"),
        _.span("Applied"), _.strong(formatDate(provenance.appliedAt))
      )
    ),
  ];
};

const openAiMemoryDialog = (record) => {
  if (!record) return;
  const dialog = _.Dialog({
    class: "tl-devtools-memory-dialog",
    panelClass: "tl-devtools-memory-dialog-panel",
    size: "xl",
    title: record.name || record.id || "AI Memory",
    subtitle: `${record.scope || "workspace"} · ${record.kind || "note"} · ${record.workspaceId || "global"}`,
    icon: "psychology",
    closeButton: true,
    content: () => _.div(
      { class: "tl-devtools-memory-dialog-body" },
      ...renderAiMemoryDetail(record),
      _.pre({ class: "tl-devtools-json" }, jsonPreview(record))
    ),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      isStoredMemory(record)
        ? btn(
          {
            class: "tl-devtools-row-action",
            onclick: async () => {
              close();
              await pinMemoryRecord(record, !record.pinned);
            },
          },
          icon(record.pinned ? "keep_off" : "push_pin", "sm"),
          record.pinned ? "Unpin memory" : "Pin memory"
        )
        : null,
      isStoredMemory(record)
        ? btn(
          {
            class: "tl-devtools-row-action is-danger",
            onclick: async () => {
              const label = record.name || record.id || "Memory";
              if (!window.confirm(`Dimenticare questa memoria?\n\n${label}`)) return;
              close();
              await window.TrackerLensAiRuntimeStore.forgetMemory(record.id);
              if (state.selected.type === "aiMemory" && state.selected.id === record.id) {
                state.selected = { type: "", id: "" };
              }
              await loadDevTools();
            },
          },
          icon("delete", "sm"),
          "Forget memory"
        )
        : null,
      btn({ onclick: close }, "Close")
    ),
  });
  dialog.open();
};

const renderInspector = () => {
  const record = selectedRecord();
  if (!record || state.selected.type === "aiMemory") return null;
  const title = record.label || record.name || record.id || state.selected.id;
  const dependencies = state.selected.type === "node"
    ? (graph().dependencies || []).filter((dependency) => dependency.sourceNodeId === record.id || dependency.targetNodeId === record.id)
    : [];
  const events = state.selected.type === "node"
    ? (runtime().events || []).filter((event) => event.sourceNodeId === record.id || event.targetNodeId === record.id)
    : [];
  const impact = window.TrackerLensGraphEngine?.impactAnalysis
    ? window.TrackerLensGraphEngine.impactAnalysis({
      graph: graph(),
      runtime: runtime(),
      nodeId: state.selected.type === "node" ? record.id : "",
      connectionId: state.selected.type === "dependency" ? (record.connectionId || record.id) : "",
    })
    : null;
  return _.aside(
    { class: "tl-devtools-inspector" },
    _.div(
      { class: "tl-devtools-inspector-head" },
      _.div(_.span({ class: "tl-devtools-inspector-type" }, state.selected.type), _.h2(title)),
      btn({ class: "tl-devtools-icon-btn", "aria-label": "Close inspector", onclick: closeInspector }, icon("close", "sm"))
    ),
    dependencies.length || events.length
      ? _.div(
        { class: "tl-devtools-inspector-stats" },
        _.span(`${number(dependencies.length)} dependencies`),
        _.span(`${number(events.length)} events`)
      )
      : null,
    impact
      ? _.div(
        { class: "tl-devtools-impact" },
        _.h3("Impact Analysis"),
        _.div(
          { class: "tl-devtools-impact-grid" },
          _.span("Upstream"), _.strong(number(impact.upstream?.length)),
          _.span("Downstream"), _.strong(number(impact.downstream?.length)),
          _.span("Direct links"), _.strong(number(impact.directDependencies?.length)),
          _.span("Events"), _.strong(number(impact.directEvents?.length)),
          _.span("Channels"), _.strong((impact.channels || []).join(", ") || "N/D"),
          _.span("Risk"), _.strong(impact.risk || "N/D")
        )
      )
      : null,
    _.pre({ class: "tl-devtools-json" }, jsonPreview(record))
  );
};

const renderContent = () => {
  if (state.loading) {
    return _.div({ class: "tl-devtools-state" }, icon("sync", "sm"), _.span("Caricamento DevTools..."));
  }
  if (state.error) {
    return _.div({ class: "tl-devtools-state is-error" }, icon("error", "sm"), _.span(state.error));
  }
  return [
    _.section(
      { class: "tl-devtools-hero" },
      _.div(
        _.p({ class: "tl-devtools-eyebrow" }, "Runtime Core"),
        _.h1("DevTools"),
        _.p("Inspector centrale per graph, offline, packages, performance e time travel.")
      ),
      _.div(
        { class: "tl-devtools-hero-actions" },
        btn({ class: "tl-devtools-refresh", onclick: loadDevTools }, icon("sync", "sm"), "Refresh")
      )
    ),
    _.section(
      { class: "tl-devtools-metrics", "aria-label": "Runtime metrics" },
      metric("Nodes", state.data?.stats?.graphNodes, "hub", "cyan"),
      metric("Dependencies", state.data?.stats?.graphDependencies, "lan", "gold"),
      metric("Graph Issues", state.data?.graph?.validation?.issues?.length, "report", state.data?.graph?.validation?.ok ? "green" : "red"),
      metric("Offline Queue", state.data?.stats?.queuedOffline, "cloud_off", "gold"),
      metric("Packages", state.data?.stats?.packages, "deployed_code", "green"),
      metric("Snapshots", state.data?.stats?.snapshots, "history", "blue")
    ),
    _.div(
      { class: "tl-devtools-tabs", role: "tablist" },
      ...tabs.map((tab) =>
        btn(
          {
            class: `tl-devtools-tab${state.tab === tab.id ? " is-active" : ""}`,
            onclick: () => {
              setTab(tab.id);
            },
          },
          icon(tab.icon, "sm"),
          tab.label
        )
      )
    ),
    activePanel(),
    renderInspector(),
    _.footer({ class: "tl-devtools-footer" }, `Loaded: ${formatDate(state.data?.loadedAt)}`),
  ];
};

const mount = () => {
  if (!root) return;
  root.replaceChildren(
    _.div(
      { class: "tl-devtools-shell" },
      _.header(
        { class: "tl-devtools-topbar" },
        window.TrackerLensSidebar.renderBrand({ className: "tl-devtools-brand" }),
        _.div(
          _.p({ class: "tl-devtools-kicker" }, "Trackers Lens"),
          _.h1("Runtime DevTools")
        ),
        _.div({ class: "tl-devtools-status" }, _.span({ class: "tl-devtools-dot" }), "Core")
      ),
      window.TrackerLensSidebar?.render({ activeId: "devtools" }),
      _.div(
        { class: "tl-devtools-main" },
        _.div({ class: "tl-devtools-grid-bg" }, ...[].concat(renderContent()))
      )
    )
  );
};

async function loadDevTools() {
  state.loading = true;
  state.error = "";
  mount();
  try {
    if (!window.TrackerLensDevToolsRuntime?.load) throw new Error("TrackerLensDevToolsRuntime non disponibile");
    state.data = await window.TrackerLensDevToolsRuntime.load();
  } catch (error) {
    console.error("Errore DevTools runtime:", error);
    state.error = error?.message || "Errore caricamento DevTools";
  } finally {
    state.loading = false;
    mount();
  }
}

loadDevTools();
