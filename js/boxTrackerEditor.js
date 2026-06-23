const trackerData = window.TrackerLensBoxTrackerData;

const params = new URLSearchParams(window.location.search);
const requestedTrackerId = params.get("trackerId") || params.get("boxTrackerId") || params.get("id");
const isEditRequest = Boolean(requestedTrackerId);
const requestedSource = params.get("source") || params.get("trackerType") || "";
const requestedRuntimeMode = params.get("runtimeMode") || params.get("mode") || "";
const requestedWorkspaceId = params.get("workspaceId") || "";
const requestedChannel = params.get("channel") || "";
const requestedDraftNodeId = params.get("draftNodeId") || "";
const requestedRuntimeLabel = params.get("runtimeLabel") || "";
const TRACKER_STORES = [
  { name: tlConfig.TABLES.TL_WIDGETS, columns: [{ name: "content" }] },
  { name: tlConfig.TABLES.TL_PAGES, columns: [{ name: "content" }] },
];

const makeTrackerId = () => requestedTrackerId || `tracker_${Date.now()}`;
const boxVersioning = () => window.TrackerLensBoxVersioning;
const normalizeBoxVersion = (box) => boxVersioning()?.normalizeBox ? boxVersioning().normalizeBox(box) : {
  ...box,
  version: box.version || "0.1.0",
  runtimeVersion: box.runtimeVersion || ">=0.1.0",
};

const defaultTracker = {
  ...trackerData.tracker,
  id: makeTrackerId(),
  name: requestedRuntimeLabel || trackerData.tracker.name,
  type: "boxTracker",
  version: trackerData.tracker.version || "0.1.0",
  runtimeVersion: trackerData.tracker.runtimeVersion || ">=0.1.0",
  trackerType: requestedSource || trackerData.tracker.trackerType || "websocket",
  runtimeMode: requestedRuntimeMode || trackerData.tracker.runtimeMode || "real-time",
  source: requestedSource || trackerData.tracker.source || "websocket",
  outputChannel: requestedChannel || trackerData.tracker.outputChannel,
  method: trackerData.tracker.method || "GET",
  endpoint: trackerData.tracker.endpoint || "wss://stream.binance.com:9443/ws/btcusdt@ticker",
  timeout: Number(trackerData.tracker.timeout) || 10,
  reconnect: trackerData.tracker.reconnect !== false,
  reconnectInterval: Number(trackerData.tracker.reconnectInterval) || 5,
  intervalMs: Number(trackerData.tracker.intervalMs) || 0,
  active: trackerData.tracker.active !== false,
  autoStart: trackerData.tracker.autoStart !== false,
  visibility: trackerData.tracker.visibility || "private",
  tags: Array.isArray(trackerData.tracker.tags) ? trackerData.tracker.tags : ["btc", "binance", "websocket"],
  note: trackerData.tracker.note || "",
};

const trackerState = {
  loading: true,
  saving: false,
  editingExisting: false,
  notice: "Caricamento boxTracker...",
  savedLabel: trackerData.workspace.savedLabel,
  zoom: 100,
  activeTab: "Manifest",
  previewView: "json",
  testStatus: "In attesa",
  testLatency: "—",
  lastRun: "—",
  testRunning: false,
  deleting: false,
  tagDraft: "",
  tracker: { ...defaultTracker },
  sampleOutput: { ...trackerData.sampleJson },
  history: [],
  future: [],
};

let shortcutsBound = false;

const openChromePage = (url) => {
  if (window.TrackerLensSidebar?.navigate) {
    window.TrackerLensSidebar.navigate(url);
    return;
  }
  window.location.assign(url);
};

const flowMapUrl = () => {
  const query = new URLSearchParams();
  query.set("runtime", "dependencies");
  query.set("nodeId", trackerState.editingExisting ? trackerState.tracker.id : requestedDraftNodeId || trackerState.tracker.id);
  query.set("nodeType", "boxTracker");
  if (requestedWorkspaceId) query.set("workspaceId", requestedWorkspaceId);
  if (trackerState.tracker.outputChannel) query.set("channel", trackerState.tracker.outputChannel);
  return `flowMap.html?${query.toString()}`;
};

const icon = (name, size = "md") => _.Icon({ name, size });
const btn = (props, ...children) => _.Btn({ type: "button", ...props }, ...children);
const notify = (type, message) => {
  if (CMSwift.notify?.[type]) CMSwift.notify[type](message);
};

const createStoreIndexes = (store, columns = []) => {
  columns.forEach((column) => {
    if (!store.indexNames.contains(column.name)) {
      store.createIndex(column.name, column?.keyPath ?? column.name, column?.options ?? { unique: false });
    }
  });
};

const createMissingStores = (dbInstance) => {
  TRACKER_STORES.forEach((table) => {
    if (!dbInstance.objectStoreNames.contains(table.name)) {
      createStoreIndexes(dbInstance.createObjectStore(table.name, { keyPath: "id" }), table.columns);
    }
  });
};

const bindDbVersionChange = (dbInstance) => {
  dbInstance.onversionchange = () => {
    dbInstance.close();
    console.warn("IndexedDB boxTracker chiuso per consentire aggiornamento da un'altra scheda.");
  };
  return dbInstance;
};

const openTrackerDb = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(tlConfig.DB_NAME);
    let blockedTimer = null;
    const clearBlockedTimer = () => {
      if (blockedTimer) clearTimeout(blockedTimer);
    };

    request.onupgradeneeded = (event) => createMissingStores(event.target.result);
    request.onsuccess = (event) => {
      clearBlockedTimer();
      const openedDb = bindDbVersionChange(event.target.result);
      const hasAllStores = TRACKER_STORES.every((table) => openedDb.objectStoreNames.contains(table.name));

      if (hasAllStores) {
        resolve(openedDb);
        return;
      }

      const nextVersion = openedDb.version + 1;
      openedDb.close();
      const upgradeRequest = indexedDB.open(tlConfig.DB_NAME, nextVersion);
      let upgradeBlockedTimer = null;
      const clearUpgradeBlockedTimer = () => {
        if (upgradeBlockedTimer) clearTimeout(upgradeBlockedTimer);
      };
      upgradeRequest.onupgradeneeded = (upgradeEvent) => createMissingStores(upgradeEvent.target.result);
      upgradeRequest.onsuccess = (upgradeEvent) => {
        clearUpgradeBlockedTimer();
        resolve(bindDbVersionChange(upgradeEvent.target.result));
      };
      upgradeRequest.onerror = (upgradeEvent) => {
        clearUpgradeBlockedTimer();
        reject(upgradeEvent.target.error || new Error("Errore aggiornamento IndexedDB"));
      };
      upgradeRequest.onblocked = () => {
        console.warn("Upgrade IndexedDB boxTracker in attesa: un'altra scheda tiene aperta una vecchia connessione.");
        upgradeBlockedTimer = setTimeout(() => reject(new Error("IndexedDB bloccato da un'altra scheda.")), 8000);
      };
    };
    request.onerror = (event) => {
      clearBlockedTimer();
      reject(event.target.error || new Error("Errore apertura IndexedDB"));
    };
    request.onblocked = () => {
      console.warn("Apertura IndexedDB boxTracker in attesa: un'altra scheda tiene aperta una vecchia connessione.");
      blockedTimer = setTimeout(() => reject(new Error("IndexedDB bloccato da un'altra scheda.")), 8000);
    };
  });

const waitForDb = async () => {
  const openedDb = await openTrackerDb();
  openedDb.close();
};

const getTrackerRecord = async (id) => {
  const openedDb = await openTrackerDb();

  try {
    return await new Promise((resolve, reject) => {
      const transaction = openedDb.transaction(tlConfig.TABLES.TL_WIDGETS, "readonly");
      const store = transaction.objectStore(tlConfig.TABLES.TL_WIDGETS);
      const request = store.get(id);
      request.onsuccess = (event) => resolve(event.target.result);
      request.onerror = (event) => reject(event.target.error || new Error("Errore lettura boxTracker"));
    });
  } finally {
    openedDb.close();
  }
};

const putTrackerRecord = async (payload) => {
  const openedDb = await openTrackerDb();

  try {
    return await new Promise((resolve, reject) => {
      const transaction = openedDb.transaction(tlConfig.TABLES.TL_WIDGETS, "readwrite");
      const store = transaction.objectStore(tlConfig.TABLES.TL_WIDGETS);
      const request = store.put(payload);
      request.onsuccess = () => resolve(payload);
      request.onerror = (event) => reject(event.target.error || new Error("Errore salvataggio boxTracker"));
    });
  } finally {
    openedDb.close();
  }
};

const dependencyManager = () => window.TrackerLensDependencyManager;
const channelRegistry = () => window.TrackerLensChannelRegistry;
const runtimeEventStore = () => window.TrackerLensEventLogStore;
const runtimeEventBus = () => {
  if (!window.TrackerLensEventBus?.get) return null;
  return window.TrackerLensEventBus.get(runtimeWorkspaceId(), {
    eventStore: runtimeEventStore(),
    channelRegistry: channelRegistry(),
  });
};

const trackerTypeOptions = trackerData.trackerTypes.map((item) => ({
  value: item.id,
  label: item.title,
}));

const categoryOptions = [
  { value: "Criptovalute", label: "Criptovalute" },
  { value: "News", label: "News" },
  { value: "Media", label: "Media" },
  { value: "Dati", label: "Dati" },
  { value: "Custom", label: "Custom" },
];

const methodOptions = ["GET", "POST", "PUT", "PATCH", "DELETE"].map((value) => ({ value, label: value }));
const runtimeModeOptions = [
  { value: "real-time", label: "Real-time" },
  { value: "interval", label: "Intervallo" },
  { value: "manual", label: "Manuale" },
];
const logLevelOptions = ["Debug", "Info", "Warning", "Error"].map((value) => ({ value, label: value }));
const colorOptions = ["#22c55e", "#38bdf8", "#a855f7", "#f59e0b", "#ef4444"];
const iconOptions = ["₿", "◎", "RSS", "YT", "AI", "{}"];
const selectArrowSlot = { arrow: () => icon("keyboard_arrow_down", "sm") };

const cloneSnapshot = () => ({
  tracker: JSON.parse(JSON.stringify(trackerState.tracker)),
  sampleOutput: JSON.parse(JSON.stringify(trackerState.sampleOutput)),
});

const pushHistory = () => {
  trackerState.history.push(cloneSnapshot());
  if (trackerState.history.length > 40) trackerState.history.shift();
  trackerState.future = [];
};

const restoreSnapshot = (snapshot) => {
  trackerState.tracker = JSON.parse(JSON.stringify(snapshot.tracker));
  trackerState.sampleOutput = JSON.parse(JSON.stringify(snapshot.sampleOutput));
  mountTrackerEditor();
};

const undo = () => {
  if (!trackerState.history.length) return;
  trackerState.future.push(cloneSnapshot());
  restoreSnapshot(trackerState.history.pop());
};

const redo = () => {
  if (!trackerState.future.length) return;
  trackerState.history.push(cloneSnapshot());
  restoreSnapshot(trackerState.future.pop());
};

const mutateTracker = (patch, shouldRemount = false) => {
  pushHistory();
  trackerState.tracker = normalizeBoxVersion({ ...trackerState.tracker, ...patch });
  trackerState.savedLabel = "Modifiche non salvate";
  if (shouldRemount) mountTrackerEditor();
};

const mutateTrackerVersioning = (patch, shouldRemount = false) => {
  const current = normalizeBoxVersion(trackerState.tracker);
  mutateTracker({
    versioning: {
      ...current.versioning,
      ...patch,
      compatibility: {
        ...(current.versioning?.compatibility || {}),
        ...(patch.compatibility || {}),
      },
      migration: {
        ...(current.versioning?.migration || {}),
        ...(patch.migration || {}),
      },
      changelog: Array.isArray(patch.changelog) ? patch.changelog : current.versioning?.changelog || [],
    },
  }, shouldRemount);
};

const mutateSampleOutput = (patch, shouldRemount = false) => {
  pushHistory();
  trackerState.sampleOutput = { ...trackerState.sampleOutput, ...patch };
  trackerState.savedLabel = "Modifiche non salvate";
  if (shouldRemount) mountTrackerEditor();
};

const setSampleOutput = (payload, shouldRemount = false) => {
  pushHistory();
  trackerState.sampleOutput = payload && typeof payload === "object" ? payload : { value: payload };
  trackerState.savedLabel = "Modifiche non salvate";
  if (shouldRemount) mountTrackerEditor();
};

const normalizeStoredTracker = (record) => {
  const content = record?.content || {};
  const runtime = content.runtime || {};

  return {
    tracker: normalizeBoxVersion({
      ...defaultTracker,
      ...content,
      id: record?.id || content.id || requestedTrackerId || defaultTracker.id,
      type: "boxTracker",
      trackerType: content.trackerType || runtime.source || defaultTracker.trackerType,
      runtimeMode: content.runtimeMode || runtime.mode || defaultTracker.runtimeMode,
      source: content.source || runtime.source || defaultTracker.source,
      outputChannel: content.outputChannel || runtime.output || defaultTracker.outputChannel,
      reconnect: content.reconnect !== false,
      active: content.active !== false,
      autoStart: content.autoStart !== false,
      visibility: content.visibility || defaultTracker.visibility,
      tags: Array.isArray(content.tags) ? content.tags : defaultTracker.tags,
    }),
    sampleOutput: content.sampleOutput && typeof content.sampleOutput === "object" ? content.sampleOutput : { ...trackerData.sampleJson },
  };
};

const loadTrackerForEdit = async () => {
  await waitForDb();
  if (!requestedTrackerId) {
    trackerState.loading = false;
    trackerState.notice = "";
    document.title = "Trackers Lens - Nuovo boxTracker";
    mountTrackerEditor();
    return;
  }

  try {
    const record = await getTrackerRecord(requestedTrackerId);
    if (!record) {
      trackerState.loading = false;
      trackerState.notice = "BoxTracker non trovato. E stato aperto un nuovo boxTracker.";
      notify("warning", trackerState.notice);
      mountTrackerEditor();
      return;
    }

    const normalized = normalizeStoredTracker(record);
    trackerState.tracker = normalized.tracker;
    trackerState.sampleOutput = normalized.sampleOutput;
    trackerState.editingExisting = true;
    trackerState.loading = false;
    trackerState.notice = "";
    trackerState.savedLabel = "Caricato da IndexedDB";
    document.title = `Trackers Lens - Modifica ${trackerState.tracker.name}`;
    mountTrackerEditor();
  } catch (error) {
    console.error(error);
    trackerState.loading = false;
    trackerState.notice = "BoxTracker non leggibile.";
    notify("error", trackerState.notice);
    mountTrackerEditor();
  }
};

const trackerPayload = () => ({
  id: trackerState.tracker.id,
  content: {
    ...normalizeBoxVersion(trackerState.tracker),
    type: "boxTracker",
    runtime: {
      mode: trackerState.tracker.runtimeMode,
      source: trackerState.tracker.source || trackerState.tracker.trackerType,
      output: trackerState.tracker.outputChannel,
      endpoint: trackerState.tracker.endpoint,
      method: trackerState.tracker.method,
      timeout: Number(trackerState.tracker.timeout) || 10,
      reconnect: Boolean(trackerState.tracker.reconnect),
      reconnectInterval: Number(trackerState.tracker.reconnectInterval) || 5,
      intervalMs: Number(trackerState.tracker.intervalMs) || 0,
    },
    sampleOutput: trackerState.sampleOutput,
    updatedAt: new Date().toISOString(),
  },
});

const runtimeWorkspaceId = () => requestedWorkspaceId || "global";

const syncDraftRuntimeNode = async (payload) => {
  if (!requestedDraftNodeId || !window.TrackerLensRuntimeGraphStore?.promoteDraftNode) return null;
  const channel = payload.content.outputChannel || payload.content.runtime?.output || "default";
  return window.TrackerLensRuntimeGraphStore.promoteDraftNode({
    draftNodeId: requestedDraftNodeId,
    workspaceId: runtimeWorkspaceId(),
    node: {
      id: payload.id,
      workspaceId: runtimeWorkspaceId(),
      type: "boxTracker",
      label: payload.content.name || payload.id,
      sourceRef: payload.id,
      assetId: payload.id,
      inputs: [],
      outputs: [channel].filter(Boolean),
      channels: [channel].filter(Boolean),
      status: payload.content.active !== false ? "active" : "inactive",
      metadata: {
        paletteLabel: requestedRuntimeLabel || "",
        trackerType: payload.content.trackerType,
        runtimeMode: payload.content.runtimeMode,
        source: payload.content.source,
        sampleOutput: payload.content.sampleOutput || {},
      },
    },
  });
};

const saveTracker = async () => {
  if (trackerState.loading || trackerState.saving) return;

  trackerState.saving = true;
  trackerState.notice = "Salvataggio boxTracker...";
  mountTrackerEditor();

  try {
    const payload = trackerPayload();
    await putTrackerRecord(payload);
    if (channelRegistry()?.upsertChannelForTracker) {
      await channelRegistry().upsertChannelForTracker({
        tracker: { ...payload.content, id: payload.id },
        workspaceId: runtimeWorkspaceId(),
      });
    }
    await syncDraftRuntimeNode(payload);
    trackerState.editingExisting = true;
    trackerState.savedLabel = "Salvato localmente";
    trackerState.notice = requestedDraftNodeId
      ? "BoxTracker salvato, channel registrato e draft runtime promosso"
      : "BoxTracker salvato e channel registrato";
    notify("success", trackerState.notice);
  } catch (error) {
    console.error(error);
    trackerState.savedLabel = "Errore salvataggio";
    trackerState.notice = "Impossibile salvare il boxTracker.";
    notify("error", trackerState.notice);
  } finally {
    trackerState.saving = false;
    mountTrackerEditor();
  }
};

const dependencyCountLabel = (report) => {
  if (!report?.hasDependencies) return "Nessuna dipendenza runtime rilevata";
  return [
    `${report.workspaces.length} workspace`,
    `${report.channels.length || report.channelNames.length} channel`,
    `${report.connections.length} connessioni`,
    `${report.flows.length} flow`,
    `${report.agents.length} agenti AI`,
  ].join(" · ");
};

const renderDependencyList = (title, items, formatter) =>
  _.Card(
    { class: "tl-runtime-dependency-card" },
    _.h3(title),
    items.length
      ? _.ul(...items.slice(0, 8).map((item) => _.li(formatter(item))))
      : _.p({ class: "tl-muted" }, "Nessun riferimento")
  );

const renderDependencyReport = (report) =>
  _.div(
    { class: "tl-runtime-dependency-report" },
    _.p(
      "Il boxTracker ",
      _.strong(report.label),
      " e utilizzato da altri componenti del workspace. La cancellazione normale e bloccata per proteggere il runtime."
    ),
    _.Grid(
      { cols: 2, gap: 10 },
      renderDependencyList("Channels collegati", report.channelNames || [], (channel) => channel),
      renderDependencyList("Workspace utilizzati", report.workspaces || [], (workspace) => `${workspace.name} (${workspace.boxes.length} box, ${workspace.connections.length} connessioni)`),
      renderDependencyList("Connections attive", report.connections || [], (connection) => `${connection.name || connection.id || "Connection"} · ${connection.channel || connection.frequency || "default"}`),
      renderDependencyList("AI Agent collegati", report.agents || [], (agent) => agent.name || agent.id || "AI Agent"),
      renderDependencyList("Flow nodes", report.flows || [], (flow) => flow.name || flow.id || "Flow"),
      renderDependencyList("Runtime mappings", report.dependencies || [], (dependency) => dependency.name || dependency.id || "Dependency")
    )
  );

const openDependencyDetailsDialog = (report) => {
  const dialog = _.Dialog({
    class: "tl-runtime-dependency-dialog",
    panelClass: "tl-runtime-dependency-panel",
    size: "lg",
    title: "Dipendenze runtime",
    subtitle: dependencyCountLabel(report),
    icon: "account_tree",
    closeButton: true,
    scrollable: true,
    bodyMaxHeight: "68vh",
    content: () => renderDependencyReport(report),
    actions: ({ close }) => _.Toolbar({ align: "end", gap: 8 }, btn({ onclick: close }, "Chiudi")),
  });
  dialog.open();
};

const openDependenciesInInspector = (report, closeDialog = null) => {
  const params = new URLSearchParams();
  params.set("runtime", "dependencies");
  params.set("nodeId", report.id || trackerState.tracker.id);
  params.set("nodeType", report.type || "boxTracker");
  if (report.channelNames?.[0]) params.set("channel", report.channelNames[0]);
  if (report.connections?.[0]?.id) params.set("connectionId", report.connections[0].id);
  closeDialog?.();
  openChromePage(`flowMap.html?${params.toString()}`);
};

const performTrackerDelete = async ({ report = null, force = false, closeDialog = null } = {}) => {
  if (trackerState.deleting) return;

  const manager = dependencyManager();
  if (!manager) {
    notify("error", "Dependency manager non caricato.");
    return;
  }

  trackerState.deleting = true;
  trackerState.notice = force ? "Force delete runtime in corso..." : "Eliminazione boxTracker...";
  mountTrackerEditor();

  try {
    const deleteReport = await manager.forceDeleteNode({
      id: trackerState.tracker.id,
      type: "boxTracker",
      report,
    });
    closeDialog?.();
    notify("success", force ? "BoxTracker eliminato con pulizia runtime" : "BoxTracker eliminato");
    trackerState.notice = "BoxTracker eliminato";
    trackerState.editingExisting = false;
    setTimeout(() => openChromePage("library.html"), 250);
    return deleteReport;
  } catch (error) {
    console.error(error);
    notify("error", error.message || "Impossibile eliminare il boxTracker.");
    trackerState.notice = "Errore eliminazione boxTracker";
  } finally {
    trackerState.deleting = false;
    mountTrackerEditor();
  }
};

const openSafeDeleteDialog = (report) => {
  const dialog = _.Dialog({
    class: "tl-runtime-delete-dialog",
    panelClass: "tl-runtime-delete-panel",
    size: "md",
    title: "Eliminare questo boxTracker?",
    subtitle: "Nessuna dipendenza runtime rilevata.",
    icon: "delete",
    closeButton: true,
    content: () => _.p("Il boxTracker verra rimosso dalla libreria locale."),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: close }, "Cancel"),
      btn({ class: "is-danger", onclick: () => performTrackerDelete({ report, closeDialog: close }) }, icon("delete", "sm"), "Delete")
    ),
  });
  dialog.open();
};

const openDependencyWarningDialog = (report) => {
  const dialog = _.Dialog({
    class: "tl-runtime-delete-dialog",
    panelClass: "tl-runtime-delete-panel",
    size: "lg",
    title: "Questo box e utilizzato nel runtime",
    subtitle: dependencyCountLabel(report),
    icon: "warning",
    closeButton: true,
    scrollable: true,
    bodyMaxHeight: "68vh",
    content: () => renderDependencyReport(report),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: close }, "Cancel"),
      btn({ onclick: () => openDependenciesInInspector(report, close) }, icon("account_tree", "sm"), "View Dependencies"),
      btn({ class: "is-danger", onclick: () => performTrackerDelete({ report, force: true, closeDialog: close }) }, icon("delete_forever", "sm"), "Force Delete")
    ),
  });
  dialog.open();
};

const requestTrackerDelete = async () => {
  if (!trackerState.editingExisting || trackerState.loading || trackerState.deleting) return;

  const manager = dependencyManager();
  if (!manager) {
    notify("error", "Dependency manager non caricato.");
    return;
  }

  trackerState.deleting = true;
  trackerState.notice = "Verifica dipendenze runtime...";
  mountTrackerEditor();

  try {
    const report = await manager.inspectNode({ id: trackerState.tracker.id, type: "boxTracker" });
    if (report.hasDependencies) {
      openDependencyWarningDialog(report);
    } else {
      openSafeDeleteDialog(report);
    }
  } catch (error) {
    console.error(error);
    notify("error", error.message || "Controllo dipendenze non riuscito.");
    trackerState.notice = "Errore verifica dipendenze";
  } finally {
    trackerState.deleting = false;
    mountTrackerEditor();
  }
};

const copyTrackerId = async () => {
  try {
    await navigator.clipboard?.writeText(trackerState.tracker.id);
    notify("success", "ID copiato");
  } catch {
    notify("info", trackerState.tracker.id);
  }
};

const cycleValue = (current, values) => {
  const index = values.indexOf(current);
  return values[(index + 1) % values.length];
};

const cycleColor = () => {
  mutateTracker({ color: cycleValue(trackerState.tracker.color, colorOptions) }, true);
};

const cycleIcon = () => {
  mutateTracker({ icon: cycleValue(trackerState.tracker.icon, iconOptions) }, true);
};

const addTag = () => {
  const tag = trackerState.tagDraft.trim();
  if (!tag || trackerState.tracker.tags.includes(tag)) return;
  mutateTracker({ tags: [...trackerState.tracker.tags, tag] }, true);
  trackerState.tagDraft = "";
};

const removeTag = (tag) => {
  mutateTracker({ tags: trackerState.tracker.tags.filter((item) => item !== tag) }, true);
};

const setActiveTab = (tab) => {
  trackerState.activeTab = tab;
  mountTrackerEditor();
};

const setPreviewView = (view) => {
  trackerState.previewView = view;
  mountTrackerEditor();
};

const setZoom = (zoom) => {
  trackerState.zoom = Math.min(150, Math.max(50, zoom));
  mountTrackerEditor();
};

const readInputValue = (input) => {
  if (input && typeof input === "object" && "target" in input) return input.target?.value ?? "";
  return input ?? "";
};

const executeTrackerTest = async (tracker, started) => {
  if (!window.TrackerLensTrackerTestRunner?.executeTrackerTest) throw new Error("Tracker test runner non disponibile.");
  return window.TrackerLensTrackerTestRunner.executeTrackerTest(tracker, {
    sampleOutput: trackerState.sampleOutput,
    started,
  });
};

const testStateClass = () => {
  if (trackerState.testStatus === "Errore") return "tl-state-error";
  if (trackerState.testStatus === "In esecuzione") return "tl-state-running";
  return "tl-state-ok";
};

const emitTrackerTestEvent = async ({ payload = {}, latency = 0, status = "ok", error = "" } = {}) => {
  const bus = runtimeEventBus();
  if (!bus?.emit) return null;
  const channel = trackerState.tracker.outputChannel || "default";
  const sourceNodeId = requestedDraftNodeId && !trackerState.editingExisting ? requestedDraftNodeId : trackerState.tracker.id;
  const eventPayload = status === "error"
    ? { error, _trackerTest: { receivedAt: new Date().toISOString(), latencyMs: Number(latency) || 0, source: trackerState.tracker.source, endpoint: trackerState.tracker.endpoint } }
    : payload;

  return bus.emit(channel, eventPayload, {
    workspaceId: runtimeWorkspaceId(),
    eventType: status === "error" ? "tracker_test_error" : "tracker_test",
    sourceNodeId,
    status,
    latencyMs: Number(latency) || payload?._trackerTest?.latencyMs || 0,
    meta: {
      source: "box-tracker-editor",
      trackerId: trackerState.tracker.id,
      trackerName: trackerState.tracker.name,
      draftNodeId: requestedDraftNodeId,
    },
  });
};

const runManualTest = async () => {
  if (trackerState.testRunning) return;

  const started = performance.now();
  trackerState.testRunning = true;
  trackerState.testStatus = "In esecuzione";
  trackerState.testLatency = "—";
  trackerState.notice = "Esecuzione test tracker...";
  mountTrackerEditor();

  try {
    const payload = await executeTrackerTest({ ...trackerState.tracker }, started);
    const latency = Math.max(1, Math.round(performance.now() - started));
    setSampleOutput(payload);
    trackerState.testStatus = "Connesso";
    trackerState.testLatency = `${latency} ms`;
    trackerState.lastRun = new Date().toLocaleTimeString();
    trackerState.notice = "Test manuale eseguito";
    await emitTrackerTestEvent({ payload, latency, status: "ok" });
    notify("success", trackerState.notice);
  } catch (error) {
    console.error(error);
    const latency = Math.max(1, Math.round(performance.now() - started));
    trackerState.testStatus = "Errore";
    trackerState.testLatency = "—";
    trackerState.lastRun = new Date().toLocaleTimeString();
    trackerState.notice = error.message || "Test manuale non riuscito.";
    await emitTrackerTestEvent({ latency, status: "error", error: trackerState.notice });
    notify("error", trackerState.notice);
  } finally {
    trackerState.testRunning = false;
    mountTrackerEditor();
  }
};

const renderHeader = () => {
  const deleteAction = trackerState.editingExisting
    ? [btn({ class: "tl-icon-btn is-danger", "aria-label": "Elimina boxTracker", onclick: requestTrackerDelete, disabled: trackerState.loading || trackerState.deleting }, icon("delete"))]
    : [];
  const flowAction = requestedDraftNodeId
    ? [btn({ class: "tl-cancel-btn", onclick: () => openChromePage(flowMapUrl()) }, icon("account_tree", "sm"), "Flow Map")]
    : [];

  return _.header(
    { class: "tl-tracker-header" },
    window.TrackerLensSidebar.renderBrand({ className: "tl-tracker-brand" }),
    _.div({ class: "tl-workspace-heading" }, _.h1(trackerData.workspace.name, _.span({ class: "tl-online-dot" })), _.p("• ", trackerState.notice || trackerState.savedLabel)),
    _.Toolbar(
      { class: "tl-tracker-actions", align: "center", gap: 12 },
      btn({ class: "tl-icon-btn", "aria-label": "Annulla", onclick: undo, disabled: !trackerState.history.length }, icon("undo")),
      btn({ class: "tl-icon-btn", "aria-label": "Ripristina", onclick: redo, disabled: !trackerState.future.length }, icon("redo")),
      _.span({ class: "tl-separator" }),
      btn({ class: "tl-icon-btn", "aria-label": "Zoom out", onclick: () => setZoom(trackerState.zoom - 10) }, icon("remove")),
      _.span(`${trackerState.zoom}%`),
      btn({ class: "tl-icon-btn", "aria-label": "Zoom in", onclick: () => setZoom(trackerState.zoom + 10) }, icon("add")),
      btn({ class: "tl-icon-btn", "aria-label": "Desktop", onclick: () => setPreviewView("json") }, icon("desktop_windows")),
      btn({ class: "tl-icon-btn", "aria-label": "Vista griglia", onclick: () => openChromePage("editorWorkspace.html") }, icon("dashboard")),
      ...flowAction,
      ...deleteAction,
      btn({ class: "tl-cancel-btn", onclick: () => openChromePage("editorWorkspace.html") }, icon("close", "sm"), "Annulla"),
      btn({ class: "tl-save-tracker", onclick: saveTracker, disabled: trackerState.loading || trackerState.saving }, icon("radio_button_checked", "sm"), trackerState.saving ? "Salvataggio..." : "Salva Tracker"),
      btn({ class: "tl-icon-btn", "aria-label": "Chiudi", onclick: () => openChromePage("editorWorkspace.html") }, icon("close"))
    )
  );
};

const renderKindCard = (type) =>
  _.Card(
    {
      class: `tl-kind-card${type === "boxTracker" ? " is-active" : ""}`,
      onclick: () => type === "boxLens" && openChromePage("editorBoxLens.html"),
    },
    _.span({ class: `tl-kind-icon${type === "boxLens" ? " is-lens" : ""}` }, icon(type === "boxLens" ? "dashboard" : "storage", "md")),
    _.div(
      _.div({ class: "tl-kind-title" }, type),
      _.div({ class: "tl-kind-subtitle" }, type === "boxLens" ? "Visualizzazione e interfaccia HTML, CSS e dati" : "Connessioni e raccolta dati API, WebSocket, RSS, MCP")
    )
  );

const renderTypeCard = (item) =>
  _.Card(
    {
      class: `tl-type-card${item.id === trackerState.tracker.trackerType ? " is-active" : ""}`,
      onclick: () => mutateTracker({ trackerType: item.id, source: item.id }, true),
    },
    _.span({ class: "tl-type-icon" }, icon(item.icon, "sm")),
    _.div(_.div({ class: "tl-type-title" }, item.title), _.div({ class: "tl-type-subtitle" }, item.subtitle))
  );

const renderAppSidebar = () => window.TrackerLensSidebar.render({ activeId: "dashboard" });

const renderSidebar = () =>
  _.aside(
    { class: "tl-create-side" },
    _.h2({ class: "tl-side-title" }, "Crea Nuovo Box"),
    _.p({ class: "tl-side-subtitle" }, "Scegli il tipo di box da creare"),
    _.Grid({ cols: 1, gap: 10, margin: "0 0 30px" }, renderKindCard("boxLens"), renderKindCard("boxTracker")),
    _.h2({ class: "tl-side-title" }, "Tipo di boxTracker"),
    _.Grid({ cols: 1, gap: 7 }, ...trackerData.trackerTypes.map(renderTypeCard))
  );

const renderMain = () =>
  _.section(
    { class: "tl-tracker-main" },
    _.div({ class: "tl-editor-top" }, _.h2(trackerState.editingExisting || isEditRequest ? "Modifica boxTracker" : "Nuovo boxTracker"), icon("edit", "sm"), _.span({ class: "tl-id-badge" }, "ID: ", trackerState.tracker.id)),
    _.Grid({ class: "tl-content-grid", cols: "minmax(0, 1fr) 356px", gap: 14 }, renderConfigStack(), renderPreview())
  );

const renderTabs = () =>
  _.div(
    { class: "tl-tabs" },
    ...trackerData.tabs.map((tab) =>
      btn({ class: `tl-tab${tab === trackerState.activeTab ? " is-active" : ""}`, onclick: () => setActiveTab(tab) }, tab)
    )
  );

const renderConfigStack = () =>
  _.div(
    { class: "tl-config-stack" },
    renderTabs(),
    renderTabContent()
  );

const renderTabContent = () => {
  if (trackerState.activeTab === "Endpoint") return renderEndpointPanel();
  if (trackerState.activeTab === "Parametri") return renderParamsPanel();
  if (trackerState.activeTab === "Headers") return renderHeadersPanel();
  if (trackerState.activeTab === "Trasformazione") return renderTransformPanel();
  if (trackerState.activeTab === "Output") return renderOutputPanel();
  if (trackerState.activeTab === "Test") return renderTestConfigPanel();
  if (trackerState.activeTab === "Avanzate") return renderAdvancedPanel();
  return _.div(renderGeneralPanel(), renderExecutionPanel(), renderInitialStatePanel());
};

const renderGeneralPanel = () =>
  _.Card(
    { class: "tl-panel" },
    _.h3({ class: "tl-panel-title" }, "Informazioni generali"),
    _.Grid(
      { cols: "minmax(0, 1fr) 150px", gap: 14 },
      _.label({ class: "tl-field" }, _.span("Nome"), _.Input({ value: trackerState.tracker.name, onInput: (event) => mutateTracker({ name: String(readInputValue(event)) }) })),
      _.Select({ label: "Categoria", value: trackerState.tracker.category, options: categoryOptions, slots: selectArrowSlot, onChange: (value) => mutateTracker({ category: value }, true) })
    ),
    _.Grid(
      { cols: "minmax(0, 1fr) 150px", gap: 14, margin: "14px 0 0" },
      _.label({ class: "tl-field" }, _.span("Descrizione (opzionale)"), _.textarea({ value: trackerState.tracker.description, onInput: (event) => mutateTracker({ description: String(readInputValue(event)) }) })),
      _.div({ class: "tl-field" }, _.span("Icona"), btn({ class: "tl-select-row", onclick: cycleIcon }, _.span({ class: "tl-tracker-icon", style: { "--tracker-color": trackerState.tracker.color } }, trackerState.tracker.icon), _.span("Cambia"), icon("keyboard_arrow_down", "sm")))
    ),
    _.Grid(
      { cols: "160px minmax(0, 1fr)", gap: 14, margin: "14px 0 0" },
      _.div({ class: "tl-field" }, _.span("Colore"), btn({ class: "tl-select-row", onclick: cycleColor }, _.span({ class: "tl-color-chip", style: { "--tracker-color": trackerState.tracker.color } }), _.span(trackerState.tracker.color), icon("keyboard_arrow_down", "sm"))),
      renderTagEditor()
    )
  );

const renderTagEditor = () =>
  _.div(
    { class: "tl-field" },
    _.span("Tag"),
    _.Row(
      {
        align: "center",
        wrap: true,
        gap: 6,
        minHeight: 34,
        padding: 6,
        style: {
          color: "var(--tl-text)",
          background: "rgba(4, 9, 14, 0.58)",
          border: "1px solid var(--tl-border-soft)",
          borderRadius: "var(--tl-radius-sm)"
        }
      },
      _.Col({ width: "100%" }, ...trackerState.tracker.tags.map((tag) => _.Chip({ class: "tl-chip", label: tag, removable: true, onRemove: () => removeTag(tag) }))),
      _.Input({ class: "tl-tag-input", value: trackerState.tagDraft, placeholder: "Nuovo tag", onInput: (event) => { trackerState.tagDraft = String(readInputValue(event)); } }),
      btn({ class: "tl-icon-btn", "aria-label": "Aggiungi tag", onclick: addTag }, icon("add", "sm"))
    )
  );

const renderExecutionPanel = () =>
  _.Card(
    { class: "tl-panel" },
    _.h3({ class: "tl-panel-title" }, "Configurazione esecuzione"),
    _.Grid(
      { cols: 3, gap: 8 },
      modeCard("real-time", "Real-time", "Connessione continua"),
      modeCard("interval", "Intervallo", "Esegui ogni tot secondi"),
      modeCard("manual", "Manuale", "Esegui solo su richiesta")
    ),
    _.Grid(
      { cols: 2, gap: 14, margin: "14px 0 0" },
      _.div({ class: "tl-setting-row" }, _.span("Riconnessione automatica"), _.Toggle({ checked: trackerState.tracker.reconnect, color: "success", onChange: (checked) => mutateTracker({ reconnect: Boolean(checked) }, true) })),
      _.label({ class: "tl-field" }, _.span("Timeout richiesta (s)"), _.Input({ value: trackerState.tracker.timeout, type: "number", onInput: (event) => mutateTracker({ timeout: Number(readInputValue(event)) || 0 }) })),
      _.label({ class: "tl-field" }, _.span("Intervallo riconnessione (s)"), _.Input({ value: trackerState.tracker.reconnectInterval, type: "number", onInput: (event) => mutateTracker({ reconnectInterval: Number(readInputValue(event)) || 0 }) })),
      _.label({ class: "tl-field" }, _.span("Intervallo mock runtime (ms)"), _.Input({ value: trackerState.tracker.intervalMs, type: "number", onInput: (event) => mutateTracker({ intervalMs: Number(readInputValue(event)) || 0 }) }))
    )
  );

const modeCard = (value, title, subtitle) =>
  btn(
    { class: `tl-mode-card${trackerState.tracker.runtimeMode === value ? " is-active" : ""}`, onclick: () => mutateTracker({ runtimeMode: value }, true) },
    _.div({ class: "tl-mode-title" }, trackerState.tracker.runtimeMode === value ? _.span({ class: "tl-live-dot" }) : icon("schedule", "sm"), title),
    _.div({ class: "tl-muted" }, subtitle)
  );

const renderInitialStatePanel = () =>
  _.Card(
    { class: "tl-panel" },
    _.h3({ class: "tl-panel-title" }, "Stato iniziale"),
    _.Grid(
      { cols: 3, gap: 16 },
      _.div(_.div({ class: "tl-muted" }, "Attivo"), _.Toggle({ checked: trackerState.tracker.active, color: "success", onChange: (checked) => mutateTracker({ active: Boolean(checked) }, true) })),
      _.div(_.div({ class: "tl-muted" }, "Avvia automaticamente"), _.Toggle({ checked: trackerState.tracker.autoStart, color: "success", onChange: (checked) => mutateTracker({ autoStart: Boolean(checked) }, true) })),
      _.div(_.div({ class: "tl-muted" }, "Ultima esecuzione"), _.div(trackerState.lastRun))
    )
  );

const renderEndpointPanel = () =>
  _.Card(
    { class: "tl-panel" },
    _.h3({ class: "tl-panel-title" }, "Endpoint"),
    _.Grid(
      { cols: "minmax(0, 1fr) minmax(0, 1fr)", gap: 14 },
      _.Select({ label: "Metodo", value: trackerState.tracker.method, options: methodOptions, slots: selectArrowSlot, onChange: (value) => mutateTracker({ method: value }, true) }),
      _.Select({ label: "Tipo sorgente", value: trackerState.tracker.source, options: trackerTypeOptions, slots: selectArrowSlot, onChange: (value) => mutateTracker({ source: value, trackerType: value }, true) })
    ),
    _.label({ class: "tl-field tl-span-all" }, _.span("URL / Sorgente"), _.Input({ value: trackerState.tracker.endpoint, onInput: (event) => mutateTracker({ endpoint: String(readInputValue(event)) }) }))
  );

const renderParamsPanel = () =>
  _.Card(
    { class: "tl-panel" },
    _.h3({ class: "tl-panel-title" }, "Parametri"),
    _.div({ class: "tl-muted" }, "Per REST GET vengono aggiunti alla query string. Per REST con body vengono inviati come JSON o testo. Per WebSocket vengono inviati all'apertura."),
    _.label({ class: "tl-field" }, _.span("Query / subscription"), _.textarea({ value: trackerState.tracker.query || "", onInput: (event) => mutateTracker({ query: String(readInputValue(event)) }) }))
  );

const renderHeadersPanel = () =>
  _.Card(
    { class: "tl-panel" },
    _.h3({ class: "tl-panel-title" }, "Headers"),
    _.div({ class: "tl-muted" }, "Usati nelle chiamate REST. Accetta JSON o righe key:value."),
    _.label({ class: "tl-field" }, _.span("Headers"), _.textarea({ value: trackerState.tracker.headersText || "", placeholder: "Authorization: Bearer ...", onInput: (event) => mutateTracker({ headersText: String(readInputValue(event)) }) }))
  );

const renderTransformPanel = () =>
  _.Card(
    { class: "tl-panel" },
    _.h3({ class: "tl-panel-title" }, "Trasformazione"),
    _.div({ class: "tl-muted" }, "Regole di mapping per normalizzare l'output prima di inviarlo ai boxLens."),
    _.label({ class: "tl-field" }, _.span("Mapping / note trasformazione"), _.textarea({ value: trackerState.tracker.transformText || "", placeholder: "c -> price\nP -> change24h", onInput: (event) => mutateTracker({ transformText: String(readInputValue(event)) }) }))
  );

const renderOutputPanel = () =>
  _.Card(
    { class: "tl-panel" },
    _.h3({ class: "tl-panel-title" }, "Output"),
    _.label({ class: "tl-field" }, _.span("Canale output"), _.Input({ value: trackerState.tracker.outputChannel, onInput: (event) => mutateTracker({ outputChannel: String(readInputValue(event)) }) })),
    _.label({ class: "tl-field" }, _.span("Sample JSON"), _.textarea({ value: JSON.stringify(trackerState.sampleOutput, null, 2), onInput: (event) => updateSampleJson(String(readInputValue(event))) }))
  );

const updateSampleJson = (value) => {
  try {
    trackerState.sampleOutput = JSON.parse(value);
    trackerState.notice = "";
  } catch {
    trackerState.notice = "JSON sample non valido";
  }
};

const renderTestConfigPanel = () =>
  _.Card(
    { class: "tl-panel" },
    _.h3({ class: "tl-panel-title" }, "Test"),
    _.div({ class: "tl-setting-row" }, _.span("Stato test"), _.span({ class: testStateClass() }, trackerState.testStatus)),
    _.div({ class: "tl-setting-row" }, _.span("Latenza"), _.span(trackerState.testLatency)),
    btn({ class: "tl-run-test", onclick: runManualTest, disabled: trackerState.testRunning }, icon("play_arrow", "sm"), trackerState.testRunning ? "Test in corso" : "Esegui test manuale")
  );

const renderAdvancedPanel = () =>
  _.Card(
    { class: "tl-panel" },
    _.h3({ class: "tl-panel-title" }, "Avanzate"),
    renderVersioningPanel(),
    _.Select({ label: "Livello log", value: trackerState.tracker.logLevel, options: logLevelOptions, slots: selectArrowSlot, onChange: (value) => mutateTracker({ logLevel: value }, true) }),
    _.label({ class: "tl-field" }, _.span("Note"), _.textarea({ value: trackerState.tracker.note, onInput: (event) => mutateTracker({ note: String(readInputValue(event)) }) }))
  );

const migrationOptions = [
  { value: "none", label: "None" },
  { value: "manual", label: "Manual" },
  { value: "automatic", label: "Automatic" },
];

const renderVersioningPanel = () => {
  const versioning = normalizeBoxVersion(trackerState.tracker).versioning || {};
  const migration = versioning.migration || {};
  return _.div(
    { class: "tl-version-panel" },
    _.Grid(
      { cols: "1fr 1fr 140px", gap: 12 },
      _.label({ class: "tl-field" }, _.span("Version"), _.Input({ value: versioning.version || trackerState.tracker.version || "0.1.0", onInput: (event) => mutateTrackerVersioning({ version: String(readInputValue(event)) }) })),
      _.label({ class: "tl-field" }, _.span("Runtime"), _.Input({ value: versioning.runtimeVersion || trackerState.tracker.runtimeVersion || ">=0.1.0", onInput: (event) => mutateTrackerVersioning({ runtimeVersion: String(readInputValue(event)) }) })),
      _.Select({ label: "Migration", value: migration.policy || "none", options: migrationOptions, slots: selectArrowSlot, onChange: (value) => mutateTrackerVersioning({ migration: { policy: value } }, true) })
    ),
    _.label(
      { class: "tl-field" },
      _.span("Changelog"),
      _.textarea({
        value: versioning.changelog?.[0]?.notes || "",
        placeholder: "Note della versione corrente",
        onInput: (event) => mutateTrackerVersioning({
          changelog: [{
            version: versioning.version || trackerState.tracker.version || "0.1.0",
            date: new Date().toISOString().slice(0, 10),
            notes: String(readInputValue(event)),
          }],
        }),
      })
    )
  );
};

const renderPreview = () =>
  _.section(
    { class: "tl-preview-panel" },
    _.div(
      { class: "tl-preview-head" },
      _.div({ class: "tl-preview-title" }, "Anteprima / Test", _.span({ class: "tl-live-dot" })),
      _.Row({ class: "tl-preview-icons", gap: 6 }, btn({ class: trackerState.previewView === "summary" ? "is-active" : "", onclick: () => setPreviewView("summary") }, icon("article", "sm")), btn({ class: trackerState.previewView === "json" ? "is-active" : "", onclick: () => setPreviewView("json") }, icon("code", "sm")), btn({ onclick: runManualTest, disabled: trackerState.testRunning }, icon("play_arrow", "sm")))
    ),
    _.div(
      { class: "tl-test-card" },
      _.div({ class: "tl-test-row" }, _.span("Stato"), _.span({ class: testStateClass() }, trackerState.testStatus)),
      _.div({ class: "tl-test-row" }, _.span("Ultimo messaggio ricevuto"), _.span(trackerState.lastRun)),
      trackerState.previewView === "summary" ? renderSummaryPreview() : renderJson()
    ),
    _.div({ class: "tl-preview-foot" }, btn({ class: "tl-run-test", onclick: runManualTest, disabled: trackerState.testRunning }, icon("play_arrow", "sm"), trackerState.testRunning ? "Test in corso" : "Esegui test manuale"), _.span("Risposta: ", _.span({ class: testStateClass() }, trackerState.testLatency)))
  );

const renderSummaryPreview = () =>
  _.div(
    { class: "tl-summary-preview" },
    _.div({ class: "tl-test-row" }, _.span("Canale"), _.strong(trackerState.tracker.outputChannel)),
    _.div({ class: "tl-test-row" }, _.span("Prezzo"), _.strong(trackerState.sampleOutput.c || trackerState.sampleOutput.price || "—")),
    _.div({ class: "tl-test-row" }, _.span("Cambio"), _.strong(trackerState.sampleOutput.P || trackerState.sampleOutput.change24h || "—"))
  );

const renderJson = () => {
  const lines = JSON.stringify(trackerState.sampleOutput, null, 2).split("\n");
  return _.pre(
    { class: "tl-json" },
    ...lines.map((line) => {
      const match = line.match(/^(\s*)"([^"]+)":\s*(.+),?$/);
      return match ? _.code(match[1], '"', _.span({ class: "key" }, match[2]), '": ', _.span({ class: "value" }, match[3])) : _.code(line);
    })
  );
};

const renderProperties = () =>
  _.aside(
    { class: "tl-tracker-properties" },
    _.h2({ class: "tl-property-title" }, "Proprietà BoxTracker"),
    _.div({ class: "tl-property-section" }, _.div({ class: "tl-field" }, _.span("ID univoco"), btn({ class: "tl-output-row", onclick: copyTrackerId }, _.span(trackerState.tracker.id), icon("content_copy", "sm")))),
    _.div({ class: "tl-property-section" }, _.h3("Canale di output ", icon("help_outline", "sm")), _.label({ class: "tl-field" }, _.div({ class: "tl-output-row" }, _.span(trackerState.tracker.outputChannel), icon("check", "sm")), _.p({ class: "tl-note" }, "Questo è il nome del canale usato per inviare i dati"))),
    _.div({ class: "tl-property-section" }, _.h3("Buffer dati"), renderNumberRow("Mantieni ultimi (max)", "bufferMax"), renderNumberRow("Pulisci ogni (minuti)", "flushMinutes")),
    _.div({ class: "tl-property-section" }, _.h3("Log"), _.div({ class: "tl-status-row" }, _.span("Registra attività"), _.Toggle({ checked: trackerState.tracker.logEnabled !== false, color: "success", onChange: (checked) => mutateTracker({ logEnabled: Boolean(checked) }, true) })), _.Select({ label: "Livello log", value: trackerState.tracker.logLevel, options: logLevelOptions, slots: selectArrowSlot, onChange: (value) => mutateTracker({ logLevel: value }, true) })),
    _.div({ class: "tl-property-section" }, _.h3("Stato"), _.div({ class: "tl-field" }, _.span("Visibilità"), _.div({ class: "tl-visibility" }, btn({ class: trackerState.tracker.visibility === "private" ? "is-active" : "", onclick: () => mutateTracker({ visibility: "private" }, true) }, icon("radio_button_checked", "sm"), "Privato"), btn({ class: trackerState.tracker.visibility === "public" ? "is-active" : "", onclick: () => mutateTracker({ visibility: "public" }, true) }, icon("public", "sm"), "Pubblico"))))
  );

const renderNumberRow = (label, key) =>
  _.div({ class: "tl-dimension-row" }, _.span(label), _.Input({ value: trackerState.tracker[key], type: "number", onInput: (event) => mutateTracker({ [key]: Number(readInputValue(event)) || 0 }) }));

const bindMenuTrigger = (trigger, menuProps, content) => {
  const menu = _.Menu(
    {
      trigger: "click",
      placement: "top",
      width: 340,
      closeOnOutside: true,
      closeOnEsc: true,
      panelClass: "tl-tracker-dropdown-menu",
      ...menuProps,
    },
    content
  );
  queueMicrotask(() => menu.bind(trigger));
  return trigger;
};

const renderSuggestionMenu = () =>
  bindMenuTrigger(
    btn({ class: "tl-tracker-menu-trigger" }, icon("lightbulb_outline", "sm"), "Suggerimento", icon("keyboard_arrow_up", "sm")),
    { title: "Suggerimento", icon: "lightbulb_outline" },
    _.div(
      { class: "tl-tracker-menu-content" },
      _.p("Il boxTracker lavora in background: raccoglie dati e li invia ai boxLens collegati tramite il canale di output."),
      _.div({ class: "tl-menu-row" }, icon("hub", "sm"), _.span("Non viene posizionato nella griglia del workspace.")),
      _.div({ class: "tl-menu-row" }, icon("monitoring", "sm"), _.span("Una pagina monitor dedicata mostrera stato, traffico, errori e payload."))
    )
  );

const renderNextStepsMenu = () =>
  bindMenuTrigger(
    btn({ class: "tl-tracker-menu-trigger" }, icon("playlist_add_check", "sm"), "Prossimi passi", icon("keyboard_arrow_up", "sm")),
    { title: "Prossimi passi", icon: "playlist_add_check" },
    _.ol(
      { class: "tl-tracker-menu-list" },
      _.li("Salva il boxTracker."),
      _.li("Collegalo a uno o piu boxLens dal workspace."),
      _.li("Usa il monitor tracker per controllare traffico e stato runtime.")
    )
  );

const renderFooter = () =>
  _.footer(
    { class: "tl-tracker-footer" },
    _.Card(
      { class: "tl-tracker-bottom-hints" },
      renderSuggestionMenu(),
      _.Row({ class: "tl-bottom-shortcuts", align: "center", wrap: true, gap: 10 }, shortcut("Ctrl S", "Salva"), shortcut("Ctrl Enter", "Test"), shortcut("Ctrl Z", "Annulla")),
      renderNextStepsMenu()
    )
  );

const shortcut = (keys, label) => _.span(_.kbd({ class: "tl-kbd" }, keys), " ", label);

const bindShortcuts = () => {
  if (shortcutsBound) return;
  shortcutsBound = true;
  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (key === "escape") openChromePage("editorWorkspace.html");
    if (!(event.metaKey || event.ctrlKey)) return;
    if (key === "s") {
      event.preventDefault();
      saveTracker();
    }
    if (key === "enter") {
      event.preventDefault();
      runManualTest();
    }
    if (key === "z") {
      event.preventDefault();
      undo();
    }
    if (key === "y") {
      event.preventDefault();
      redo();
    }
  });
};

const mountTrackerEditor = () => {
  const root = document.getElementById("tl-box-tracker-root");
  root.replaceChildren(
    _.div(
      { class: "tl-tracker-shell" },
      renderHeader(),
      _.div({ class: "tl-tracker-body" }, renderAppSidebar(), renderSidebar(), renderMain(), renderProperties()),
      renderFooter()
    )
  );
};

CMSwift.ready(async () => {
  bindShortcuts();
  mountTrackerEditor();
  await loadTrackerForEdit();
});
