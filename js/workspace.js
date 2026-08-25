const workspaceData = window.TrackerLensWorkspaceData;

const workspaceState = {
  type: "boxLens",
  device: "desktop",
  search: "",
  zoom: 100,
  panX: 0,
  panY: 0,
  suppressCanvasClick: false,
  activeTool: "select",
  selectedAssetId: null,
  selectedBoxId: null,
  selectedBoxIds: [],
  actionMenuOpen: false,
  propertiesOpen: false,
  navigatorCollapsed: localStorage.getItem("tl_workspace_navigator_collapsed") === "true",
  toolMenu: null,
  collapsedAssetSections: {
    templates: false,
    saved: false,
  },
  pendingConfirm: null,
  previewMode: false,
  notice: "",
  assetsLoading: true,
  assetsError: "",
  flowMapsLoading: true,
  flowMapsError: "",
  savedLabel: workspaceData.workspace.savedLabel,
  workspace: { ...workspaceData.workspace },
  localAssets: [],
  localFlowMaps: [],
  boxes: [],
  connections: [],
  interaction: null,
  selectionRect: null,
  connectDraft: null,
  tempLine: null,
  history: [],
  future: [],
};

const assetDragState = {
  assetId: null,
  startX: 0,
  startY: 0,
  dragged: false,
  suppressClick: false,
};

const openChromePage = (url) => {
  if (window.TrackerLensSidebar?.navigate) {
    window.TrackerLensSidebar.navigate(url);
    return;
  }
  window.location.assign(url);
};

const icon = (name, size = "md") => _.Icon({ name, size });
const btn = (props, ...children) => _.Btn({ type: "button", ...props }, ...children);
const WORKSPACE_ASSET_MIME = "application/x-trackerlens-workspace-asset";

const refreshAssetsAfterBoxEdit = async ({ type, id, box } = {}) => {
  await loadLocalAssets();
  const assetId = id || box?.id;
  if (assetId) workspaceState.selectedAssetId = assetId;
  workspaceState.type = type || workspaceState.type;
  setNotice(type === "boxTracker" ? "boxTracker salvato in libreria" : "boxLens salvato in libreria");
  mountWorkspace();
};

const openUniversalBoxEditor = (options = {}) => {
  if (!window.TrackerLensBoxEditorDialog?.open) {
    setNotice("Editor universale non disponibile in questa pagina.");
    mountWorkspace();
    return;
  }

  window.TrackerLensBoxEditorDialog.open({
    workspaceId: workspaceState.workspace.id || "workspace_global",
    onSave: refreshAssetsAfterBoxEdit,
    ...options,
  });
};

const lensTemplateAssets = [
  { id: "lens-template-chart", name: "Chart Lens", boxType: "chart", category: "Lens Template", description: "Grafico e serie dati per il workspace.", icon: "insert_chart", color: "#38bdf8", width: 12, height: 8 },
  { id: "lens-template-stats", name: "Stats Lens", boxType: "card", category: "Lens Template", description: "KPI, contatori e statistiche compatte.", icon: "monitoring", color: "#60a5fa", width: 10, height: 6 },
  { id: "lens-template-feed", name: "Feed Lens", boxType: "card", category: "Lens Template", description: "Lista eventi, news o aggiornamenti live.", icon: "dynamic_feed", color: "#2dd4bf", width: 10, height: 8 },
  { id: "lens-template-table", name: "Table Lens", boxType: "table", category: "Lens Template", description: "Tabella dati ordinata per righe e colonne.", icon: "table_chart", color: "#38bdf8", width: 12, height: 8 },
  { id: "lens-template-video", name: "Video Lens", boxType: "media", category: "Lens Template", description: "Media, iframe o player video nel workspace.", icon: "smart_display", color: "#60a5fa", width: 12, height: 8 },
  { id: "lens-template-terminal", name: "Terminal Lens", boxType: "custom", category: "Lens Template", description: "Output tecnico, log e testo monospace.", icon: "terminal", color: "#38bdf8", width: 12, height: 7 },
  { id: "lens-template-ai-insight", name: "AI Insight Lens", boxType: "custom", category: "Lens Template", description: "Risultati AI, insight e spiegazioni.", icon: "insights", color: "#2dd4bf", width: 12, height: 7 },
  { id: "lens-template-notification", name: "Notification Lens", boxType: "card", category: "Lens Template", description: "Alert, stato e notifiche operative.", icon: "notifications_active", color: "#60a5fa", width: 10, height: 6 },
].map((asset) => ({
  ...asset,
  sourceId: asset.id,
  type: "boxLens",
  isTemplate: true,
  searchText: [asset.name, asset.category, asset.description, asset.boxType, "boxLens"].join(" ").toLowerCase(),
}));

const db = new DatabaseIndexedDB({
  dbName: tlConfig.DB_NAME,
  startTables: [
    { name: tlConfig.TABLES.TL_WIDGETS, columns: [{ name: "content" }] },
    { name: tlConfig.TABLES.TL_PAGES, columns: [{ name: "content" }] },
  ],
});

const gridPresets = {
  columns: [24, 32, 48, 64],
  rows: [20, 30, 40, 60],
  rowHeight: [40, 48, 60, 72, 90],
};

const toolBehavior = {
  select: { canSelect: true, canMove: false, canResize: false, canConnect: false, cursor: "default" },
  move: { canSelect: true, canMove: true, canResize: false, canConnect: false, cursor: "move" },
  resize: { canSelect: true, canMove: false, canResize: true, canConnect: false, cursor: "nwse-resize" },
  connect: { canSelect: true, canMove: false, canResize: false, canConnect: true, cursor: "crosshair" },
  align: { canSelect: true, canMove: false, canResize: false, canConnect: false, cursor: "default" },
  distribute: { canSelect: true, canMove: false, canResize: false, canConnect: false, cursor: "default" },
  order: { canSelect: true, canMove: false, canResize: false, canConnect: false, cursor: "default" },
  delete: { canSelect: false, canMove: false, canResize: false, canConnect: false, cursor: "not-allowed" },
};

const cloneWorkspaceModel = () => ({
  workspace: { ...workspaceState.workspace },
  boxes: workspaceState.boxes.map((box) => ({ ...box })),
  connections: workspaceState.connections.map((connection) => ({ ...connection, mapping: { ...connection.mapping } })),
});

const restoreWorkspaceModel = (snapshot) => {
  workspaceState.workspace = { ...snapshot.workspace };
  workspaceState.boxes = snapshot.boxes.map((box) => ({ ...box }));
  workspaceState.connections = (snapshot.connections || []).map((connection) => ({ ...connection, mapping: { ...connection.mapping } }));
  workspaceState.selectedBoxIds = workspaceState.selectedBoxIds.filter((id) => workspaceState.boxes.some((box) => box.id === id));
  workspaceState.selectedBoxId = workspaceState.selectedBoxIds[0] || null;
};

const setNotice = (message) => {
  workspaceState.notice = message;
};

const markDirty = (message = "Modifiche non salvate") => {
  workspaceState.savedLabel = message;
};

const commitWorkspaceChange = (message, updater) => {
  workspaceState.history.push(cloneWorkspaceModel());
  if (workspaceState.history.length > 40) workspaceState.history.shift();
  workspaceState.future = [];
  updater();
  markDirty();
  setNotice(message);
  mountWorkspace();
};

const cycleValue = (current, values) => {
  const index = values.indexOf(current);
  return values[(index + 1) % values.length];
};

const selectedBox = () => workspaceState.boxes.find((box) => box.id === workspaceState.selectedBoxId) || null;
const selectedBoxes = () => workspaceState.selectedBoxIds.map((id) => workspaceState.boxes.find((box) => box.id === id)).filter(Boolean);
const isBoxSelected = (boxId) => workspaceState.selectedBoxIds.includes(boxId);
const boxById = (boxId) => workspaceState.boxes.find((box) => box.id === boxId) || null;
const visibleWorkspaceBoxes = () => workspaceState.boxes.filter((box) => !box.hidden);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const nextZIndex = () => Math.max(1, ...workspaceState.boxes.map((box) => box.zIndex || 1)) + 1;
const assetById = (id) => id ? [...lensTemplateAssets, ...workspaceState.localAssets].find((asset) => asset.id === id || asset.sourceId === id) || null : null;

const displayBoxFromAsset = (asset, box = {}) => {
  const boxFields = { ...box };
  delete boxFields.code;
  delete boxFields.searchText;

  return {
    ...boxFields,
    assetId: box.assetId || asset.id,
    sourceId: box.sourceId || asset.sourceId || asset.id,
    type: box.type || asset.type,
    name: asset.name || box.name || "Box",
    category: asset.category || box.category || "",
    description: asset.description || box.description || "",
    icon: asset.icon || box.icon || (asset.type === "boxTracker" ? "cloud_queue" : "dashboard"),
    color: asset.color || box.color || (asset.type === "boxTracker" ? "#35c979" : "#9b5cf5"),
    boxType: box.boxType || asset.boxType || "",
  };
};

const hydrateWorkspaceBox = (box) => {
  const asset = assetById(box.assetId || box.sourceId);
  return asset ? displayBoxFromAsset(asset, box) : { ...box };
};

const hydrateWorkspaceBoxes = () => {
  workspaceState.boxes = workspaceState.boxes.map(hydrateWorkspaceBox);
};

const serializeWorkspaceBox = (box) => ({
  id: box.id,
  assetId: box.assetId || box.sourceId,
  sourceId: box.sourceId || box.assetId,
  type: box.type || "boxLens",
  name: box.name || "Box",
  category: box.category || "",
  description: box.description || "",
  icon: box.icon || (box.type === "boxTracker" ? "cloud_queue" : "dashboard"),
  color: box.color || (box.type === "boxTracker" ? "#35c979" : "#9b5cf5"),
  boxType: box.boxType || "",
  runtime: box.runtime && typeof box.runtime === "object" ? { ...box.runtime } : null,
  x: box.x || 1,
  y: box.y || 1,
  width: box.width || 6,
  height: box.height || 4,
  zIndex: box.zIndex || 1,
  hidden: Boolean(box.hidden),
  channels: Array.isArray(box.channels) ? [...box.channels] : [],
});

const waitForWorkspaceStore = async () => {
  const table = tlConfig.TABLES.TL_PAGES;
  await db.ready;

  if (!db.db?.objectStoreNames?.contains(table)) {
    throw new Error(`Store SQLite non disponibile: ${table}`);
  }
};

const workspacePayload = () => ({
  id: workspaceState.workspace.id,
  content: {
    ...workspaceState.workspace,
    updatedAt: new Date().toISOString(),
    boxes: workspaceState.boxes.map(serializeWorkspaceBox),
    connections: workspaceState.connections,
  },
});

const persistWorkspaceSilently = async () => {
  ensureWorkspaceIdentity();

  try {
    await waitForWorkspaceStore();
    await db.updateData(tlConfig.TABLES.TL_PAGES, workspacePayload());
    if (window.TrackerLensConnectionsStore?.syncWorkspaceConnections) {
      await window.TrackerLensConnectionsStore.syncWorkspaceConnections({
        workspace: workspaceState.workspace,
        boxes: workspaceState.boxes,
        connections: workspaceState.connections,
      });
    }
    if (window.TrackerLensChannelRegistry?.syncWorkspaceChannels) {
      await window.TrackerLensChannelRegistry.syncWorkspaceChannels({
        workspace: workspaceState.workspace,
        boxes: workspaceState.boxes,
        connections: workspaceState.connections,
      });
    }
    if (window.TrackerLensRuntimeGraphStore?.syncWorkspaceGraph) {
      await window.TrackerLensRuntimeGraphStore.syncWorkspaceGraph({
        workspace: workspaceState.workspace,
        boxes: workspaceState.boxes,
        connections: workspaceState.connections,
      });
    }
    workspaceState.savedLabel = "Salvato localmente";
  } catch (error) {
    console.error("Errore autosalvataggio workspace:", error);
    workspaceState.savedLabel = "Errore salvataggio";
    setNotice("Errore durante il salvataggio locale del workspace.");
  }
};

const connectionKey = (connection = {}) => {
  if (connection.id) return `id:${connection.id}`;
  return [
    "edge",
    connection.fromBoxId || "",
    connection.toBoxId || "",
    connection.channel || "default",
  ].join(":");
};

const normalizeWorkspaceConnection = (connection = {}) => ({
  ...connection,
  fromBoxId: connection.fromBoxId || connection.sourceNodeId || "",
  toBoxId: connection.toBoxId || connection.targetNodeId || "",
  channel: connection.channel || "default",
  mapping: connection.mapping && typeof connection.mapping === "object" ? { ...connection.mapping } : {},
});

const loadWorkspaceConnectionsFromStore = async (workspaceId = "", contentConnections = []) => {
  const baseConnections = contentConnections.map(normalizeWorkspaceConnection);
  if (!window.TrackerLensConnectionsStore?.list) return baseConnections;

  try {
    const boxIds = new Set(workspaceState.boxes.map((box) => box.id).filter(Boolean));
    const storeConnections = (await window.TrackerLensConnectionsStore.list())
      .map(normalizeWorkspaceConnection)
      .filter((connection) => !workspaceId || !connection.workspaceId || connection.workspaceId === workspaceId)
      .filter((connection) => boxIds.has(connection.fromBoxId) && boxIds.has(connection.toBoxId));
    const merged = new Map();
    [...baseConnections, ...storeConnections].forEach((connection) => merged.set(connectionKey(connection), connection));

    await Promise.all(storeConnections.map((connection) =>
      window.TrackerLensConnectionsStore.upsertWorkspaceContentConnection?.({
        ...connection,
        workspaceId: connection.workspaceId || workspaceId,
      })
    ));

    return Array.from(merged.values());
  } catch (error) {
    console.warn("Connessioni Flow Map non importate nel workspace:", error);
    return baseConnections;
  }
};

const loadWorkspaceFromQuery = async () => {
  const workspaceId = new URLSearchParams(window.location.search).get("workspaceId");
  if (!workspaceId) return;

  try {
    await waitForWorkspaceStore();
    const record = await db.getData(tlConfig.TABLES.TL_PAGES, workspaceId);
    const content = record?.content;
    if (!content) return;

    workspaceState.workspace = {
      ...workspaceState.workspace,
      ...content,
      id: record.id || content.id || workspaceId,
    };
    workspaceState.boxes = Array.isArray(content.boxes) ? content.boxes.map((box) => ({ ...box })) : [];
    workspaceState.connections = await loadWorkspaceConnectionsFromStore(
      workspaceState.workspace.id || workspaceId,
      Array.isArray(content.connections) ? content.connections : []
    );
    workspaceState.savedLabel = content.updatedAt ? "Caricato da SQLite" : workspaceState.savedLabel;
  } catch (error) {
    console.error("Errore caricamento workspace:", error);
    setNotice("Workspace salvato non trovato o non leggibile.");
  }
};

const ensureWorkspaceIdentity = () => {
  if (workspaceState.workspace.id && workspaceState.workspace.id !== "new-workspace") return;

  const workspaceId = new URLSearchParams(window.location.search).get("workspaceId");
  workspaceState.workspace.id = workspaceId || `workspace_${Date.now()}`;
};

const saveWorkspace = async () => {
  const saveState = document.getElementById("tl-save-state");
  if (saveState) saveState.textContent = "Salvataggio...";

  ensureWorkspaceIdentity();

  try {
    await waitForWorkspaceStore();
    await db.updateData(tlConfig.TABLES.TL_PAGES, workspacePayload());
    if (window.TrackerLensConnectionsStore?.syncWorkspaceConnections) {
      await window.TrackerLensConnectionsStore.syncWorkspaceConnections({
        workspace: workspaceState.workspace,
        boxes: workspaceState.boxes,
        connections: workspaceState.connections,
      });
    }

    workspaceState.savedLabel = "Salvato localmente";
    setNotice("Workspace salvato in SQLite");
  } catch (error) {
    console.error("Errore salvataggio workspace:", error);
    workspaceState.savedLabel = "Errore salvataggio";
    setNotice("Errore durante il salvataggio locale del workspace.");
  }

  mountWorkspace();
};

const exportCurrentWorkspace = async () => {
  try {
    await persistWorkspaceSilently();
    await window.TrackerLensPortableRuntime.exportWorkspaceFile(workspaceState.workspace.id, { includeAssets: true });
    setNotice("Workspace esportato in formato .tlworkspace.");
  } catch (error) {
    console.error("Errore export workspace:", error);
    setNotice(error?.message || "Export workspace non riuscito.");
  }
  mountWorkspace();
};

const renderHeader = () =>
  _.header(
    { class: "tl-workspace-header" },
    window.TrackerLensSidebar.renderBrand({ className: "tl-app-brand" }),
    _.div(
      { class: "tl-workspace-title" },
      _.h1(workspaceState.workspace.name, btn({ class: "tl-title-edit", "aria-label": "Modifica workspace", onclick: openWorkspaceProperties }, icon("edit", "sm"))),
      _.div({ id: "tl-save-state", class: "tl-save-state" }, workspaceState.savedLabel)
    ),
    _.Toolbar(
      { class: "tl-header-actions", align: "center", gap: 14 },
      _.Row({ class: "tl-icon-group", align: "center", gap: 8 }, btn({ class: "tl-top-icon", "aria-label": "Annulla", disabled: workspaceState.history.length === 0, onclick: undoWorkspace }, icon("undo")), btn({ class: "tl-top-icon", "aria-label": "Ripeti", disabled: workspaceState.future.length === 0, onclick: redoWorkspace }, icon("redo"))),
      _.span({ class: "tl-separator" }),
      _.Row({ class: "tl-zoom-group", align: "center", gap: 8 }, btn({ class: "tl-top-icon", "aria-label": "Zoom out", onclick: () => setZoom(workspaceState.zoom - 10) }, icon("remove")), _.span(`${workspaceState.zoom}%`), btn({ class: "tl-top-icon", "aria-label": "Zoom in", onclick: () => setZoom(workspaceState.zoom + 10) }, icon("add"))),
      _.span({ class: "tl-separator" }),
      btn({ class: `tl-top-icon${workspaceState.previewMode ? " is-active" : ""}`, "aria-label": "Anteprima desktop", onclick: togglePreview }, icon("desktop_windows")),
      btn({ class: `tl-top-icon${workspaceState.workspace.showGrid ? " is-active" : ""}`, "aria-label": "Vista griglia", onclick: () => updateWorkspaceConfig("showGrid", !workspaceState.workspace.showGrid, "Vista griglia aggiornata") }, icon("dashboard")),
      btn({ class: "st-btn-primary", onclick: saveWorkspace }, icon("cloud_upload", "sm"), "Salva"),
      btn({ class: "tl-top-icon", "aria-label": "Export workspace", onclick: exportCurrentWorkspace }, icon("download")),
      btn({ class: "st-btn-primary", onclick: publishWorkspace }, icon("language", "sm"), "Pubblica"),
      btn({ class: `tl-top-icon${workspaceState.actionMenuOpen ? " is-active" : ""}`, "aria-label": "Altre azioni", onclick: toggleActionMenu }, icon("more_vert")),
      btn({ class: "tl-top-icon", "aria-label": "Chiudi", onclick: () => openChromePage("popup.html") }, icon("close"))
    )
  );

const renderRail = () => {
  return window.TrackerLensSidebar.render({
    activeId: "dashboard",
    onHelp: () => setNotice("Suggerimento: seleziona un box e usa la toolbar in basso."),
  });
};

const setAssetType = (type) => {
  workspaceState.type = type;
  setNotice(type === "boxLens" ? "Lista boxLens attiva" : "Lista boxTracker attiva");
  mountWorkspace();
};

const openAssetEditor = (event, asset) => {
  event?.stopPropagation?.();
  event?.preventDefault?.();
  if (asset.type === "boxTracker") {
    const trackerId = asset.isTemplate ? "" : asset.sourceId || asset.id;
    openUniversalBoxEditor(
      {
        type: "boxTracker",
        id: trackerId,
        template: asset.isTemplate ? asset : null,
      }
    );
    return;
  }

  openUniversalBoxEditor(
    {
      type: "boxLens",
      id: asset.isTemplate ? "" : asset.sourceId || asset.id,
      template: asset.isTemplate ? asset : null,
      runtimeLabel: asset.isTemplate ? asset.name || "Box Lens" : "",
    }
  );
};

const setDevice = (device) => {
  workspaceState.device = device;
  setNotice(`Anteprima ${device} attiva`);
  mountWorkspace();
};

const setZoom = (zoom) => {
  workspaceState.zoom = Math.max(50, Math.min(150, zoom));
  if (workspaceState.zoom <= 100) {
    workspaceState.panX = 0;
    workspaceState.panY = 0;
  }
  setNotice(`Zoom impostato al ${workspaceState.zoom}%`);
  mountWorkspace();
};

const togglePreview = () => {
  workspaceState.previewMode = !workspaceState.previewMode;
  setNotice(workspaceState.previewMode ? "Anteprima attiva: toolbar box nascosta" : "Modalita editor attiva");
  mountWorkspace();
};

const toggleActionMenu = () => {
  workspaceState.actionMenuOpen = !workspaceState.actionMenuOpen;
  if (workspaceState.actionMenuOpen) workspaceState.propertiesOpen = true;
  workspaceState.toolMenu = null;
  mountWorkspace();
};

const openWorkspaceProperties = () => {
  workspaceState.propertiesOpen = true;
  workspaceState.actionMenuOpen = false;
  mountWorkspace();
  requestAnimationFrame(() => {
    const target = document.getElementById("tl-workspace-name");
    (target?.matches?.("input") ? target : target?.querySelector?.("input"))?.focus();
  });
};

const closeWorkspaceProperties = () => {
  workspaceState.propertiesOpen = false;
  workspaceState.actionMenuOpen = false;
  workspaceState.pendingConfirm = null;
  mountWorkspace();
};

const toggleWorkspaceNavigator = () => {
  workspaceState.navigatorCollapsed = !workspaceState.navigatorCollapsed;
  localStorage.setItem("tl_workspace_navigator_collapsed", String(workspaceState.navigatorCollapsed));
  mountWorkspace();
};

const setActiveTool = (toolId) => {
  workspaceState.activeTool = toolId;
  workspaceState.toolMenu = null;
  workspaceState.connectDraft = null;
  workspaceState.tempLine = null;

  if (toolId === "align") return openAlignMenu();
  if (toolId === "distribute") return openDistributeMenu();
  if (toolId === "order") return openOrderMenu();
  if (toolId === "delete") return deleteSelectedBoxes();

  setNotice(`Strumento ${toolId} attivo`);
  mountWorkspace();
};

const renderAssetCard = (asset) =>
  _.div(
    {
      class: `tl-asset-card cms-card${workspaceState.selectedAssetId === asset.id ? " is-selected" : ""}`,
      draggable: true,
      "data-asset-id": asset.id,
      onclick: () => {
        if (assetDragState.suppressClick) {
          assetDragState.suppressClick = false;
          return;
        }
        addAssetToCanvas(asset.id);
      },
      onmousedown: (event) => startAssetPointerDrag(event, asset.id),
      ondragstart: (event) => {
        workspaceState.selectedAssetId = asset.id;
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "copy";
          event.dataTransfer.setData(WORKSPACE_ASSET_MIME, asset.id);
          event.dataTransfer.setData("text/plain", asset.id);
        }
      },
    },
    _.div(
      { class: "cms-card-body" },
      _.span({ class: "tl-asset-icon", style: { "--asset-color": asset.color } }, icon(asset.icon, "sm")),
      _.div(_.div({ class: "tl-asset-name" }, asset.name), _.div({ class: "tl-asset-type" }, asset.category || asset.note || asset.type)),
      asset.isTemplate
        ? _.span({ class: "tl-asset-template-lock", title: "Template" }, icon("add_box", "xs"))
        : btn({
          class: "tl-asset-edit",
          title: "Modifica box",
          "aria-label": `Modifica ${asset.name}`,
          onmousedown: (event) => event.stopPropagation(),
          onclick: (event) => openAssetEditor(event, asset),
        }, icon("edit", "xs"))
    )
  );

const workspaceAssets = () => [
  ...lensTemplateAssets,
  ...workspaceState.localAssets,
];

const assetMatchesCurrentFilters = (asset) => {
  const matchesType = asset.type === workspaceState.type || asset.type === "asset";
  const query = workspaceState.search.trim().toLowerCase();
  return matchesType && (!query || asset.searchText?.includes(query) || asset.name.toLowerCase().includes(query));
};

const visibleAssets = () =>
  workspaceAssets().filter(assetMatchesCurrentFilters);

const visibleTemplateAssets = () =>
  lensTemplateAssets.filter(assetMatchesCurrentFilters);

const visibleSavedAssets = () =>
  workspaceState.localAssets.filter(assetMatchesCurrentFilters);

const toggleAssetSection = (section) => {
  workspaceState.collapsedAssetSections = {
    ...workspaceState.collapsedAssetSections,
    [section]: !workspaceState.collapsedAssetSections[section],
  };
  mountWorkspace();
};

const trackerAssets = () => workspaceState.localAssets.filter((asset) => asset.type === "boxTracker");

const trackerChannel = (tracker) =>
  tracker.outputChannel || tracker.runtime?.output || tracker.channels?.[0] || "default";

const flowMapChannel = (flowMap) =>
  flowMap.outputPorts?.[0]?.name || flowMap.inputPorts?.[0]?.name || (flowMap.hasOutput ? "flow.out" : flowMap.hasInput ? "flow.in" : "flow");

const matchesTrackerAsset = (box, asset) =>
  box?.type === "boxTracker" && [asset.id, asset.sourceId].filter(Boolean).some((id) => [box.assetId, box.sourceId, box.id].includes(id));

const matchesFlowMapAsset = (box, flowMap) =>
  box?.type === "flowMap" && [flowMap.id].filter(Boolean).some((id) => [box.assetId, box.sourceId, box.id].includes(id));

const trackerInstanceForAsset = (asset) =>
  workspaceState.boxes.find((box) => matchesTrackerAsset(box, asset)) || null;

const flowMapInstanceForAsset = (flowMap) =>
  workspaceState.boxes.find((box) => matchesFlowMapAsset(box, flowMap)) || null;

const trackerConnectionForLens = (asset, lensBox) => {
  const tracker = trackerInstanceForAsset(asset);
  if (!tracker) return null;
  return workspaceState.connections.find((connection) => connection.fromBoxId === tracker.id && connection.toBoxId === lensBox.id) || null;
};

const flowMapConnectionForLens = (flowMap, lensBox) => {
  const flowMapBox = flowMapInstanceForAsset(flowMap);
  if (!flowMapBox) return null;
  return workspaceState.connections.find((connection) => connection.fromBoxId === flowMapBox.id && connection.toBoxId === lensBox.id) || null;
};

const createHiddenTrackerBox = (asset) =>
  displayBoxFromAsset(asset, {
    id: `tracker_${asset.id}_${Date.now()}`,
    assetId: asset.id,
    sourceId: asset.sourceId || asset.id,
    type: "boxTracker",
    hidden: true,
    x: 1,
    y: 1,
    width: 1,
    height: 1,
    zIndex: 1,
    channels: [trackerChannel(asset)],
  });

const createHiddenFlowMapBox = (flowMap) =>
  displayBoxFromAsset({
    id: flowMap.id,
    sourceId: flowMap.id,
    type: "flowMap",
    name: flowMap.name || "Flow Map",
    category: flowMap.category || "Flow Map",
    description: flowMap.description || "",
    icon: "account_tree",
    color: "#38bdf8",
  }, {
    id: `flowmap_${flowMap.id}_${Date.now()}`,
    assetId: flowMap.id,
    sourceId: flowMap.id,
    type: "flowMap",
    hidden: true,
    x: 1,
    y: 1,
    width: 1,
    height: 1,
    zIndex: 1,
    channels: [...new Set([...(flowMap.outputPorts || []), ...(flowMap.inputPorts || [])].map((port) => port.name).filter(Boolean))],
    runtime: {
      type: "flowMap",
      flowMapId: flowMap.id,
      hasInput: flowMap.hasInput,
      hasOutput: flowMap.hasOutput,
      inputPorts: flowMap.inputPorts || [],
      outputPorts: flowMap.outputPorts || [],
    },
  });

const linkTrackerAssetToLens = (asset, lensBox, closeDialog) => {
  commitWorkspaceChange(`${asset.name} collegato a ${lensBox.name}`, () => {
    let tracker = trackerInstanceForAsset(asset);
    if (!tracker) {
      tracker = createHiddenTrackerBox(asset);
      workspaceState.boxes.push(tracker);
    }

    const hasConnection = workspaceState.connections.some((connection) => connection.fromBoxId === tracker.id && connection.toBoxId === lensBox.id);
    if (!hasConnection) {
      workspaceState.connections.push({
        id: `connection_${Date.now()}`,
        fromBoxId: tracker.id,
        toBoxId: lensBox.id,
        channel: trackerChannel(tracker),
        mapping: {},
      });
    }
    selectBoxes([lensBox.id]);
  });
  persistWorkspaceSilently();
  closeDialog?.();
};

const linkFlowMapToLens = (flowMap, lensBox, closeDialog) => {
  if (!flowMap?.id || (!flowMap.hasInput && !flowMap.hasOutput)) return;
  commitWorkspaceChange(`${flowMap.name} collegato a ${lensBox.name}`, () => {
    let flowMapBox = flowMapInstanceForAsset(flowMap);
    if (!flowMapBox) {
      flowMapBox = createHiddenFlowMapBox(flowMap);
      workspaceState.boxes.push(flowMapBox);
    }

    const hasConnection = workspaceState.connections.some((connection) => connection.fromBoxId === flowMapBox.id && connection.toBoxId === lensBox.id);
    if (!hasConnection) {
      workspaceState.connections.push({
        id: `connection_${Date.now()}`,
        fromBoxId: flowMapBox.id,
        toBoxId: lensBox.id,
        channel: flowMapChannel(flowMap),
        mapping: {
          sourceType: "flowMap",
          flowMapId: flowMap.id,
          hasInput: flowMap.hasInput,
          hasOutput: flowMap.hasOutput,
          inputPorts: flowMap.inputPorts || [],
          outputPorts: flowMap.outputPorts || [],
        },
      });
    }
    selectBoxes([lensBox.id]);
  });
  persistWorkspaceSilently();
  closeDialog?.();
};

const unlinkTrackerAssetFromLens = (asset, lensBox, closeDialog) => {
  commitWorkspaceChange(`${asset.name} scollegato da ${lensBox.name}`, () => {
    const tracker = trackerInstanceForAsset(asset);
    if (!tracker) return;

    workspaceState.connections = workspaceState.connections.filter((connection) => !(connection.fromBoxId === tracker.id && connection.toBoxId === lensBox.id));
    const stillUsed = workspaceState.connections.some((connection) => connection.fromBoxId === tracker.id || connection.toBoxId === tracker.id);
    if (tracker.hidden && !stillUsed) {
      workspaceState.boxes = workspaceState.boxes.filter((box) => box.id !== tracker.id);
    }
    selectBoxes([lensBox.id]);
  });
  persistWorkspaceSilently();
  closeDialog?.();
};

const unlinkFlowMapFromLens = (flowMap, lensBox, closeDialog) => {
  commitWorkspaceChange(`${flowMap.name} scollegato da ${lensBox.name}`, () => {
    const flowMapBox = flowMapInstanceForAsset(flowMap);
    if (!flowMapBox) return;

    workspaceState.connections = workspaceState.connections.filter((connection) => !(connection.fromBoxId === flowMapBox.id && connection.toBoxId === lensBox.id));
    const stillUsed = workspaceState.connections.some((connection) => connection.fromBoxId === flowMapBox.id || connection.toBoxId === flowMapBox.id);
    if (flowMapBox.hidden && !stillUsed) {
      workspaceState.boxes = workspaceState.boxes.filter((box) => box.id !== flowMapBox.id);
    }
    selectBoxes([lensBox.id]);
  });
  persistWorkspaceSilently();
  closeDialog?.();
};

const trackerSearchText = (tracker) =>
  [
    tracker.name,
    tracker.category,
    tracker.description,
    tracker.outputChannel,
    tracker.runtime?.output,
    trackerChannel(tracker),
  ].filter(Boolean).map((value) => String(value).toLowerCase()).join(" ");

const flowMapSearchText = (flowMap) =>
  [
    flowMap.name,
    flowMap.category,
    flowMap.description,
    flowMap.hasInput ? "flow in" : "",
    flowMap.hasOutput ? "flow out" : "",
  ].filter(Boolean).map((value) => String(value).toLowerCase()).join(" ");

const filterTrackerDialogList = (value = "") => {
  const query = String(value).trim().toLowerCase();
  const cards = [...document.querySelectorAll(".tl-tracker-link-card")];
  let visibleCount = 0;

  cards.forEach((card) => {
    const matches = !query || card.dataset.searchText?.includes(query);
    card.classList.toggle("is-hidden", !matches);
    if (matches) visibleCount += 1;
  });

  document.querySelector(".tl-tracker-link-empty.is-filtered")?.classList.toggle("is-hidden", visibleCount > 0);
};

const trackerDialogInputValue = (eventOrValue) => {
  if (eventOrValue && typeof eventOrValue === "object" && "target" in eventOrValue) return eventOrValue.target?.value || "";
  return eventOrValue || "";
};

const workspaceFlowMapDbName = () => (typeof tlConfig !== "undefined" ? tlConfig.DB_NAME : null) || "TrackersLens";
const workspaceFlowMapStoreName = (key, fallback) => (typeof tlConfig !== "undefined" ? tlConfig.TABLES?.[key] : null) || fallback;

const openWorkspaceFlowMapDb = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(workspaceFlowMapDbName());
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error || new Error("Errore apertura IndexedDB Flow Map"));
  });

const readWorkspaceFlowMapStore = async (storeName) => {
  const openedDb = await openWorkspaceFlowMapDb();
  try {
    if (!openedDb.objectStoreNames.contains(storeName)) return [];
    return await new Promise((resolve, reject) => {
      const request = openedDb.transaction(storeName, "readonly").objectStore(storeName).getAll();
      request.onsuccess = (event) => resolve(Array.from(event.target.result || []));
      request.onerror = (event) => reject(event.target.error || new Error(`Errore lettura ${storeName}`));
    });
  } finally {
    openedDb.close();
  }
};

const workspaceFlowMapContentOf = (record) => record?.content && typeof record.content === "object" ? record.content : record || {};
const isWorkspaceFlowMapPage = (record = {}) => {
  const content = workspaceFlowMapContentOf(record);
  return content.type === "flowmap" || content.kind === "flowmap" || content.format === "tlflow" || record?.format === "tlflow";
};

const isWorkspaceFlowPortNode = (node = {}, subtype = "") => {
  const value = String(node.metadata?.subtype || node.subtype || "").toLowerCase();
  const label = String(node.metadata?.paletteLabel || node.label || "").toLowerCase();
  return value === subtype || label === (subtype === "flow-in" ? "flow in" : "flow out");
};

const normalizeWorkspaceFlowPort = (port = {}, fallbackName = "flow.port") => {
  if (typeof port === "string") return { name: port || fallbackName, type: "object" };
  return {
    name: String(port.name || port.key || port.channel || port.id || fallbackName),
    type: String(port.type || port.valueType || "object"),
    schema: port.schema || port.payloadSchema || null,
    required: Boolean(port.required),
  };
};

const workspaceFlowPortsForNode = (node = {}, subtype = "") => {
  const direction = subtype === "flow-out" ? "inputs" : "outputs";
  const fallback = subtype === "flow-out" ? "flow.out" : "flow.in";
  const stored = Array.isArray(node.metadata?.flowPorts) ? node.metadata.flowPorts : [];
  const source = stored.length ? stored : Array.isArray(node[direction]) ? node[direction] : [];
  const ports = source
    .map((port) => normalizeWorkspaceFlowPort(port, fallback))
    .filter((port) => port.name && port.name !== "all" && port.name !== "agent_control");
  return ports.length ? ports : [{ name: fallback, type: "object" }];
};

const uniqueWorkspaceFlowPorts = (nodes = [], subtype = "") => {
  const unique = new Map();
  nodes
    .filter((node) => isWorkspaceFlowPortNode(node, subtype))
    .flatMap((node) => workspaceFlowPortsForNode(node, subtype))
    .forEach((port) => {
      if (!unique.has(port.name)) unique.set(port.name, port);
    });
  return [...unique.values()];
};

const listComposableWorkspaceFlowMaps = async () => {
  const pageStore = workspaceFlowMapStoreName("TL_PAGES", "tl_pages");
  const nodeStore = workspaceFlowMapStoreName("TL_RUNTIME_NODES", "tl_runtime_nodes");
  const [pages, nodes] = await Promise.all([
    readWorkspaceFlowMapStore(pageStore),
    readWorkspaceFlowMapStore(nodeStore),
  ]);
  return pages
    .filter(isWorkspaceFlowMapPage)
    .map((record) => {
      const content = workspaceFlowMapContentOf(record);
      const id = String(content.id || record.id || "").trim();
      const scopedNodes = nodes.filter((node) => node.workspaceId === id);
      const inputPorts = uniqueWorkspaceFlowPorts(scopedNodes, "flow-in");
      const outputPorts = uniqueWorkspaceFlowPorts(scopedNodes, "flow-out");
      const hasInput = inputPorts.length > 0;
      const hasOutput = outputPorts.length > 0;
      return {
        id,
        name: content.name || content.title || id,
        category: content.category || "global",
        description: content.description || `${scopedNodes.length} nodi runtime`,
        version: content.version || "0.1.0",
        hasInput,
        hasOutput,
        inputPorts,
        outputPorts,
      };
    })
    .filter((item) => item.id && (item.hasInput || item.hasOutput));
};

const renderTrackerLinkDialogContent = (lensBox, closeDialog) => {
  const trackers = trackerAssets();
  const flowMaps = workspaceState.localFlowMaps || [];
  if (!trackers.length && !flowMaps.length) {
    return _.Card(
      { class: "tl-tracker-link-empty" },
      _.div({ class: "tl-dialog-icon" }, icon("cloud_off", "md")),
      _.h3("Nessuna sorgente disponibile"),
      _.p("Crea un boxTracker o un Flow Map con almeno una porta Flow In/Flow Out, poi torna qui per collegarlo al boxLens."),
      _.Row(
        { gap: 8 },
        btn({ onclick: () => { closeDialog?.(); openUniversalBoxEditor({ type: "boxTracker" }); } }, icon("add", "sm"), "Crea boxTracker"),
        btn({ onclick: () => { closeDialog?.(); openChromePage("libraryFlowmap.html"); } }, icon("account_tree", "sm"), "Flow Map")
      )
    );
  }

  return _.div(
    { class: "tl-tracker-link-content" },
    _.Input({
      class: "tl-tracker-link-search",
      placeholder: "Cerca boxTracker...",
      icon: "search",
      onInput: (event) => filterTrackerDialogList(trackerDialogInputValue(event)),
    }),
    flowMaps.length
      ? _.div(
        { class: "tl-tracker-link-group" },
        _.h3("Flow Map"),
        _.Grid(
          { class: "tl-tracker-link-list", cols: 1, gap: 10 },
          ...flowMaps.map((flowMap) => {
            const connection = flowMapConnectionForLens(flowMap, lensBox);
            const linked = Boolean(connection);
            return _.Card(
              { class: `tl-tracker-link-card${linked ? " is-linked" : ""}`, "data-search-text": flowMapSearchText(flowMap) },
              _.Row(
                { class: "tl-tracker-link-row", align: "center", justify: "space-between", gap: 12 },
                _.Row(
                  { align: "center", gap: 10 },
                  _.span({ class: "tl-tracker-link-icon", style: { "--asset-color": "#38bdf8" } }, icon("account_tree", "sm")),
                  _.div(
                    _.div({ class: "tl-tracker-link-name" }, flowMap.name),
                    _.div({ class: "tl-tracker-link-meta" }, `${flowMap.category || "global"} · ${flowMap.hasInput ? "IN" : ""}${flowMap.hasInput && flowMap.hasOutput ? " / " : ""}${flowMap.hasOutput ? "OUT" : ""}`)
                  )
                ),
                btn(
                  {
                    class: linked ? "tl-tracker-link-action is-linked" : "tl-tracker-link-action",
                    onclick: () => linked ? unlinkFlowMapFromLens(flowMap, lensBox, closeDialog) : linkFlowMapToLens(flowMap, lensBox, closeDialog),
                  },
                  icon(linked ? "link_off" : "link", "sm"),
                  linked ? "Scollega" : "Collega"
                )
              )
            );
          })
        )
      )
      : null,
    trackers.length
      ? _.div(
        { class: "tl-tracker-link-group" },
        _.h3("Box Tracker"),
    _.Grid(
      { class: "tl-tracker-link-list", cols: 1, gap: 10 },
      ...trackers.map((tracker) => {
        const connection = trackerConnectionForLens(tracker, lensBox);
        const linked = Boolean(connection);
        return _.Card(
          { class: `tl-tracker-link-card${linked ? " is-linked" : ""}`, "data-search-text": trackerSearchText(tracker) },
          _.Row(
            { class: "tl-tracker-link-row", align: "center", justify: "space-between", gap: 12 },
            _.Row(
              { align: "center", gap: 10 },
              _.span({ class: "tl-tracker-link-icon", style: { "--asset-color": tracker.color } }, icon(tracker.icon || "cloud_queue", "sm")),
              _.div(
                _.div({ class: "tl-tracker-link-name" }, tracker.name),
                _.div({ class: "tl-tracker-link-meta" }, `${tracker.category || "Dati"} · canale ${trackerChannel(tracker)}`)
              )
            ),
            btn(
              {
                class: linked ? "tl-tracker-link-action is-linked" : "tl-tracker-link-action",
                onclick: () => linked ? unlinkTrackerAssetFromLens(tracker, lensBox, closeDialog) : linkTrackerAssetToLens(tracker, lensBox, closeDialog),
              },
              icon(linked ? "link_off" : "link", "sm"),
              linked ? "Scollega" : "Collega"
            )
          )
        );
      })
    )
      )
      : null,
    _.Card(
      { class: "tl-tracker-link-empty is-filtered is-hidden" },
      _.div({ class: "tl-dialog-icon" }, icon("search_off", "md")),
      _.h3("Nessun tracker trovato"),
      _.p("Modifica la ricerca per vedere altri boxTracker disponibili.")
    )
  );
};

const focusTrackerDialogSearch = () => {
  requestAnimationFrame(() => {
    const input = document.querySelector(".tl-tracker-link-search input");
    if (!input) return;
    input.focus();
  });
};

const openTrackerLinkDialog = (event, lensBox) => {
  event?.stopPropagation?.();
  event?.preventDefault?.();

  const dialog = _.Dialog({
    class: "tl-tracker-link-dialog",
    panelClass: "tl-tracker-link-panel",
    size: "lg",
    title: `Collega tracker a ${lensBox.name}`,
    subtitle: "Scegli un boxTracker dalla libreria locale. Il collegamento viene salvato come connessione del workspace.",
    icon: "hub",
    closeButton: true,
    scrollable: true,
    bodyMaxHeight: "62vh",
    onOpen: focusTrackerDialogSearch,
    content: ({ close }) => renderTrackerLinkDialogContent(lensBox, close),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: close }, "Chiudi")
    ),
  });
  dialog.open();
};

const renderAssetList = () => {
  if (workspaceState.assetsLoading) {
    return _.div({ class: "tl-box-list-state" }, "Caricamento libreria locale...");
  }

  if (workspaceState.assetsError) {
    return _.div({ class: "tl-box-list-state is-error" }, workspaceState.assetsError);
  }

  const templates = visibleTemplateAssets();
  const saved = visibleSavedAssets();
  if (!templates.length && !saved.length) {
    return _.div({ class: "tl-box-list-state" }, workspaceState.search ? "Nessun box locale trovato." : "Nessun box salvato in libreria.");
  }

  return _.div(
    { class: "tl-box-sections" },
    renderAssetSection({
      id: "saved",
      title: "I miei box",
      count: saved.length,
      assets: saved,
      empty: workspaceState.search ? "Nessun box salvato trovato." : "Nessun box salvato in libreria.",
    }),
    renderAssetSection({
      id: "templates",
      title: "Templates",
      count: templates.length,
      assets: templates,
      empty: workspaceState.type === "boxLens" ? "Nessun template trovato." : "I template sono disponibili per i boxLens.",
    })
  );
};

const renderAssetSection = ({ id, title, count, assets, empty }) => {
  const collapsed = Boolean(workspaceState.collapsedAssetSections[id]);
  return _.section(
    { class: `tl-box-section${collapsed ? " is-collapsed" : ""}` },
    btn(
      {
        class: "tl-box-section-toggle",
        "aria-expanded": String(!collapsed),
        onclick: () => toggleAssetSection(id),
      },
      _.span({ class: "tl-box-section-dot" }),
      _.span({ class: "tl-box-section-title" }, title),
      _.span({ class: "tl-box-section-count" }, String(count)),
      icon(collapsed ? "keyboard_arrow_right" : "keyboard_arrow_down", "sm")
    ),
    collapsed
      ? null
      : assets.length
        ? _.Grid({ class: "tl-box-list", cols: 1, gap: 8 }, ...assets.map(renderAssetCard))
        : _.div({ class: "tl-box-list-state" }, empty)
  );
};

const renderAddPanel = () =>
  _.aside(
    { class: "tl-add-panel" },
    _.h2({ class: "tl-panel-title" }, "Aggiungi Box"),
    _.Grid(
      { class: "tl-type-tabs", cols: 2, gap: 8, margin: "0 0 10px" },
      btn({ class: `tl-type-tab${workspaceState.type === "boxLens" ? " is-active" : ""}`, onclick: () => setAssetType("boxLens") }, "boxLens"),
      btn({ class: `tl-type-tab is-tracker${workspaceState.type === "boxTracker" ? " is-active" : ""}`, onclick: () => setAssetType("boxTracker") }, "boxTracker")
    ),
    _.Grid(
      { class: "tl-create-actions", cols: 2, gap: 8, margin: "0 0 14px" },
      btn({ class: "tl-create-box-btn is-lens", onclick: () => openUniversalBoxEditor({ type: "boxLens" }) }, icon("add", "sm"), "Crea boxLens"),
      btn({ class: "tl-create-box-btn is-tracker", onclick: () => openUniversalBoxEditor({ type: "boxTracker" }) }, icon("add", "sm"), "Crea boxTracker")
    ),
    _.div(
      { class: "tl-search" },
      _.Input({
        class: "tl-search-input",
        placeholder: "Cerca box...",
        value: workspaceState.search,
        icon: "search",
        onInput: (event) => {
          workspaceState.search = event.target.value;
          mountWorkspace();
        },
      })
    ),
    renderAssetList()
  );

const renderDeviceSwitch = () =>
  _.Row(
    { class: "tl-device-switch", align: "center", gap: 8 },
    [
      ["desktop", "Desktop", "desktop_windows"],
      ["tablet", "Tablet", "tablet_mac"],
      ["mobile", "Mobile", "phone_iphone"],
    ].map(([id, label, iconName]) => btn({ class: `tl-device-btn${workspaceState.device === id ? " is-active" : ""}`, onclick: () => setDevice(id) }, icon(iconName, "sm"), label))
  );

const renderCanvasToolbar = () =>
  _.Toolbar(
    { class: "tl-canvas-toolbar", align: "center", justify: "space-between", gap: 12 },
    renderDeviceSwitch(),
    _.Row(
      { class: "tl-grid-controls", align: "center", gap: 8 },
      btn({ class: "tl-grid-select", onclick: () => cycleGridSetting("columns") }, `Griglia: ${workspaceState.workspace.columns} colonne`, icon("keyboard_arrow_down", "sm")),
      btn({ class: "tl-grid-select", onclick: () => cycleGridSetting("rows") }, `Righe: ${workspaceState.workspace.rows}`, icon("keyboard_arrow_down", "sm")),
      btn({ class: "tl-grid-select", "aria-label": "Impostazioni griglia", onclick: () => updateWorkspaceConfig("snapToGrid", !workspaceState.workspace.snapToGrid, "Aggancio alla griglia aggiornato") }, icon("settings"))
    )
  );

const renderCanvas = () =>
  _.section(
    { class: "tl-canvas-area" },
    renderCanvasToolbar(),
    _.div(
      {
        class: `tl-canvas tl-tool-${workspaceState.activeTool} tl-canvas-${workspaceState.device}${workspaceState.workspace.showGrid ? "" : " no-grid"}${workspaceState.previewMode ? " is-preview" : ""}${workspaceState.zoom > 100 ? " is-zoomed" : ""}${workspaceState.interaction?.type === "pan" ? " is-panning" : ""}`,
        style: {
          "--tl-zoom": workspaceState.zoom / 100,
          "--tl-pan-x": `${workspaceState.panX}px`,
          "--tl-pan-y": `${workspaceState.panY}px`,
          "--tl-columns": workspaceState.workspace.columns,
          "--tl-rows": workspaceState.workspace.rows,
          "--tl-cell-width": `${100 / workspaceState.workspace.columns}%`,
          "--tl-cell-height": `${100 / workspaceState.workspace.rows}%`,
          "--tl-major-width": `${500 / workspaceState.workspace.columns}%`,
          "--tl-major-height": `${500 / workspaceState.workspace.rows}%`,
          backgroundColor: workspaceState.workspace.background,
          cursor: workspaceState.interaction?.type === "pan" ? "grabbing" : workspaceState.zoom > 100 && workspaceState.activeTool === "select" ? "grab" : toolBehavior[workspaceState.activeTool]?.cursor || "default",
        },
        ondragover: handleCanvasDragOver,
        ondrop: handleCanvasDrop,
        onmousedown: startCanvasPointer,
        onmousemove: handleCanvasHover,
        onclick: (event) => {
          if (workspaceState.suppressCanvasClick) {
            workspaceState.suppressCanvasClick = false;
            return;
          }
          if (event.currentTarget === event.target) selectBox(null);
        },
      },
      _.div({ class: "tl-axis-top" }, ...["1", "5", "10", "15", "20", "25", "30", "35", "40", "45", "48"].map((label) => _.span(label))),
      _.div({ class: "tl-axis-left" }, ...["1", "5", "10", "15", "20", "25", "30", "35", "40"].map((label) => _.span(label))),
      renderConnectionLayer(),
      _.div(
        {
          class: "tl-canvas-content",
          style: {
            gridTemplateColumns: `repeat(${workspaceState.workspace.columns}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${workspaceState.workspace.rows}, minmax(0, 1fr))`,
          },
        },
        ...visibleWorkspaceBoxes().map(renderPlacedBox)
      ),
      workspaceState.selectionRect ? renderSelectionRect() : null,
      visibleWorkspaceBoxes().length ? null : renderDropZone()
    )
  );

const renderDropZone = () =>
  _.button(
    {
      class: "tl-drop-zone",
      type: "button",
      onclick: () => addAssetToCanvas(visibleAssets()[0]?.id),
      ondragover: handleCanvasDragOver,
      ondrop: handleCanvasDrop,
    },
    _.div(
      _.div({ class: "tl-drop-icon" }, icon("dashboard", "xxl")),
      _.p({ class: "tl-drop-title" }, "Trascina un box qui"),
      _.p({ class: "tl-drop-subtitle" }, "oppure clicca su"),
      _.div({ class: "tl-add-link" }, "Aggiungi Box")
    )
  );

const renderPlacedBox = (box) =>
  _.div(
    {
      class: `tl-placed-box${isBoxSelected(box.id) ? " is-selected" : ""}${workspaceState.connectDraft?.fromBoxId === box.id ? " is-connect-source" : ""}`,
      role: "button",
      tabindex: 0,
      style: {
        gridColumn: `${box.x} / span ${box.width}`,
        gridRow: `${box.y} / span ${box.height}`,
        "--asset-color": box.color,
        zIndex: box.zIndex || 1,
      },
      "data-box-id": box.id,
      onmousedown: (event) => startBoxPointer(event, box.id),
      ondblclick: (event) => {
        event.stopPropagation();
        openBoxEditor(box);
      },
      onclick: (event) => {
        event.stopPropagation();
        handleBoxClick(event, box.id);
      },
    },
    _.span({ class: "tl-asset-icon" }, icon(box.icon, "sm")),
    _.span({ class: "tl-placed-title" }, box.name),
    _.span({ class: "tl-placed-meta" }, `${box.width} x ${box.height} celle`),
    box.type === "boxLens" && !workspaceState.previewMode
      ? btn(
        {
          class: "tl-link-tracker-btn",
          "aria-label": `Collega boxTracker a ${box.name}`,
          onmousedown: (event) => event.stopPropagation(),
          onclick: (event) => openTrackerLinkDialog(event, box),
        },
        icon("hub", "sm")
      )
      : null,
    box.type === "boxLens" && !workspaceState.previewMode
      ? btn(
        {
          class: "tl-delete-box-btn",
          "aria-label": `Elimina ${box.name}`,
          onmousedown: (event) => event.stopPropagation(),
          onclick: (event) => deletePlacedBox(event, box),
        },
        icon("delete", "sm")
      )
      : null,
    isBoxSelected(box.id) && workspaceState.activeTool === "resize" ? renderResizeHandles(box.id) : null
  );

const renderResizeHandles = (boxId) =>
  _.span(
    { class: "tl-resize-handles", "aria-hidden": "true" },
    ...["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((handle) =>
      _.span({ class: `tl-resize-handle is-${handle}`, onmousedown: (event) => startResizePointer(event, boxId, handle) })
    )
  );

const renderSelectionRect = () => {
  const rect = workspaceState.selectionRect;
  return _.span({ class: "tl-selection-rect", style: { left: `${rect.left + 34}px`, top: `${rect.top + 34}px`, width: `${rect.width}px`, height: `${rect.height}px` } });
};

const renderConnectionLayer = () => {
  const lines = workspaceState.connections.map(connectionLine).filter(Boolean);
  if (workspaceState.tempLine) lines.push(workspaceState.tempLine);
  return _.svg(
    { class: "tl-connection-layer", viewBox: "0 0 100 100", preserveAspectRatio: "none", "aria-hidden": "true" },
    ...lines.map((line) => _.line({ class: line.temp ? "tl-connection-line is-temp" : "tl-connection-line", x1: line.x1, y1: line.y1, x2: line.x2, y2: line.y2 }))
  );
};

const navigatorBoxStyle = (box) => ({
  left: `${((box.x - 1) / workspaceState.workspace.columns) * 100}%`,
  top: `${((box.y - 1) / workspaceState.workspace.rows) * 100}%`,
  width: `${(box.width / workspaceState.workspace.columns) * 100}%`,
  height: `${(box.height / workspaceState.workspace.rows) * 100}%`,
  "--asset-color": box.color,
});

const boxAtNavigatorPoint = (event) => {
  const rect = event.currentTarget.getBoundingClientRect();
  const gridX = ((event.clientX - rect.left) / rect.width) * workspaceState.workspace.columns + 1;
  const gridY = ((event.clientY - rect.top) / rect.height) * workspaceState.workspace.rows + 1;
  return visibleWorkspaceBoxes()
    .slice()
    .sort((a, b) => (b.zIndex || 1) - (a.zIndex || 1))
    .find((box) => gridX >= box.x && gridX <= box.x + box.width && gridY >= box.y && gridY <= box.y + box.height) || null;
};

const handleNavigatorClick = (event) => {
  const box = boxAtNavigatorPoint(event);
  if (!box) {
    selectBox(null);
    return;
  }
  workspaceState.activeTool = "select";
  selectBox(box.id);
};

const renderNavigator = () => {
  const boxes = visibleWorkspaceBoxes();
  const lines = workspaceState.connections.map(connectionLine).filter(Boolean);
  return _.div(
    { class: "tl-navigator", role: "button", tabindex: 0, onclick: handleNavigatorClick },
    _.svg(
      { class: "tl-navigator-lines", viewBox: "0 0 100 100", preserveAspectRatio: "none", "aria-hidden": "true" },
      ...lines.map((line) => _.line({ x1: line.x1, y1: line.y1, x2: line.x2, y2: line.y2 }))
    ),
    ...boxes.map((box) =>
      _.span({
        class: `tl-navigator-box${isBoxSelected(box.id) ? " is-selected" : ""}${box.type === "boxTracker" ? " is-tracker" : ""}`,
        title: box.name,
        style: navigatorBoxStyle(box),
      })
    ),
    boxes.length ? null : _.span({ class: "tl-navigator-empty" }, "Nessun box")
  );
};

const renderProperties = () => {
  if (!workspaceState.propertiesOpen && !workspaceState.actionMenuOpen && !workspaceState.pendingConfirm) return null;
  const workspace = workspaceState.workspace;
  const box = selectedBox();
  return _.aside(
    { class: "tl-properties", "aria-label": "Proprieta workspace" },
    workspaceState.actionMenuOpen ? renderActionMenu() : null,
    workspaceState.pendingConfirm ? renderConfirmPanel() : null,
    workspaceState.notice ? _.div({ class: "tl-notice" }, workspaceState.notice) : null,
    _.Card(
      { class: "tl-property-card" },
      _.Row(
        { class: "tl-card-head", justify: "space-between", align: "center" },
        _.span("Proprieta Workspace"),
        btn({ class: "tl-property-close", "aria-label": "Chiudi proprieta", onclick: closeWorkspaceProperties }, icon("close", "sm"))
      ),
      _.label({ class: "tl-field" }, _.span("Nome"), _.Input({ id: "tl-workspace-name", class: "tl-property-input", value: workspace.name, onInput: (event) => updateWorkspaceDraft("name", event.target.value) })),
      _.label({ class: "tl-field" }, _.span("Descrizione"), _.textarea({ class: "tl-property-textarea", placeholder: "Descrizione (opzionale)", oninput: (event) => updateWorkspaceDraft("description", event.target.value) }, workspace.description)),
      _.label({ class: "tl-field" }, _.span("Sfondo"), btn({ class: "tl-color-row", onclick: cycleBackground }, _.span({ class: "tl-color-swatch", style: { background: workspace.background } }), _.span(workspace.background), icon("check_box_outline_blank", "sm"))),
      _.Row({ class: "tl-card-head", justify: "space-between" }, _.span("Impostazioni Griglia")),
      renderSetting("Colonne", workspace.columns),
      renderSetting("Righe iniziali", workspace.rows),
      renderSetting("Altezza riga (px)", workspace.rowHeight),
      renderToggle("Mostra griglia", workspace.showGrid, () => updateWorkspaceConfig("showGrid", !workspace.showGrid, "Vista griglia aggiornata")),
      renderToggle("Aggancia alla griglia", workspace.snapToGrid, () => updateWorkspaceConfig("snapToGrid", !workspace.snapToGrid, "Aggancio alla griglia aggiornato"))
    ),
    box ? renderSelectedBoxProperties(box) : null
  );
};

const renderFixedNavigator = () =>
  _.aside(
    { class: `tl-fixed-navigator${workspaceState.navigatorCollapsed ? " is-collapsed" : ""}`, "aria-label": "Navigator workspace" },
    _.Row(
      { class: "tl-card-head", justify: "space-between", align: "center" },
      _.span("Navigator"),
      btn({
        class: "tl-navigator-toggle",
        "aria-label": workspaceState.navigatorCollapsed ? "Espandi navigator" : "Minimizza navigator",
        title: workspaceState.navigatorCollapsed ? "Espandi navigator" : "Minimizza navigator",
        onclick: toggleWorkspaceNavigator,
      }, icon(workspaceState.navigatorCollapsed ? "unfold_more" : "remove", "sm"))
    ),
    workspaceState.navigatorCollapsed ? null : renderNavigator()
  );

const renderSetting = (label, value) =>
  _.Row({ class: "tl-setting-row", align: "center", justify: "space-between", gap: 12 }, _.span(label), btn({ class: "tl-setting-btn", onclick: () => cycleSettingByLabel(label) }, String(value), icon("keyboard_arrow_down", "sm")));

const renderToggle = (label, value, onclick) => _.Row({ class: "tl-setting-row", align: "center", justify: "space-between", gap: 12 }, _.span(label), _.Toggle({ checked: value, color: "primary", onChange: onclick, onclick }));

const renderSelectedBoxProperties = (box) =>
  _.Card(
    { class: "tl-property-card" },
    _.Row({ class: "tl-card-head", justify: "space-between" }, _.span(workspaceState.selectedBoxIds.length > 1 ? "Box selezionati" : "Box selezionato"), btn({ class: "tl-top-icon", "aria-label": "Deseleziona box", onclick: () => selectBox(null) }, icon("close", "sm"))),
    _.div({ class: "tl-selected-box-name" }, workspaceState.selectedBoxIds.length > 1 ? `${workspaceState.selectedBoxIds.length} box` : box.name),
    _.Row({ class: "tl-setting-row", align: "center", justify: "space-between", gap: 12 }, _.span("Tipo"), _.span(workspaceState.selectedBoxIds.length > 1 ? "Selezione multipla" : box.type)),
    _.Row({ class: "tl-setting-row", align: "center", justify: "space-between", gap: 12 }, _.span("Posizione"), _.span(`${box.x}, ${box.y}`)),
    _.Row({ class: "tl-setting-row", align: "center", justify: "space-between", gap: 12 }, _.span("Dimensioni"), _.span(`${box.width} x ${box.height}`)),
    _.Grid({ class: "tl-mini-actions", cols: 1, gap: 8 }, btn({ onclick: duplicateSelectedBoxes }, icon("content_copy", "sm"), "Duplica"), btn({ class: "is-danger", onclick: deleteSelectedBoxes }, icon("delete", "sm"), "Elimina"))
  );

const renderActionMenu = () =>
  _.Card(
    { class: "tl-action-menu" },
    btn({ onclick: saveWorkspace }, icon("cloud_upload", "sm"), "Salva workspace"),
    btn({ onclick: publishWorkspace }, icon("language", "sm"), "Pubblica"),
    btn({ onclick: resetWorkspaceView }, icon("center_focus_strong", "sm"), "Ripristina vista"),
    btn({ onclick: clearWorkspace }, icon("delete", "sm"), "Svuota griglia")
  );

const renderConfirmPanel = () =>
  (() => {
    const dependencies = workspaceState.pendingConfirm?.dependencies || { connections: [], runtimeDependencies: [], channels: [], total: 0 };
    const blocked = workspaceState.pendingConfirm?.requiresForce;
    return _.Card(
      { class: `tl-confirm-panel${blocked ? " is-blocked" : ""}` },
      _.div({ class: "tl-confirm-title" }, blocked ? "Questo box e collegato al runtime" : "Vuoi eliminare i box selezionati?"),
      _.p(
        blocked
          ? `Sono presenti ${dependencies.connections.length} connessioni, ${dependencies.runtimeDependencies?.length || 0} dependency persistite e ${dependencies.channels.length} channel collegati. La cancellazione normale e bloccata.`
          : "Le istanze verranno rimosse dal canvas insieme alle connessioni collegate. Gli asset in libreria resteranno disponibili."
      ),
      blocked ? _.div(
        { class: "tl-confirm-deps" },
        ...[
          ...dependencies.connections.map((connection) => `${connection.fromBoxId} -> ${connection.toBoxId} · ${connection.channel || "default"}`),
          ...(dependencies.runtimeDependencies || []).map((dependency) => `${dependency.sourceNodeId} -> ${dependency.targetNodeId} · ${dependency.channel || "runtime"}`),
        ].slice(0, 4).map((label) => _.span(label))
      ) : null,
      _.Grid(
        { class: "tl-confirm-actions", cols: blocked ? 3 : 2, gap: 8 },
        ...[
          btn({ onclick: cancelPendingConfirm }, "Annulla"),
          blocked ? btn({ onclick: openWorkspaceDeleteDependencies }, icon("account_tree", "sm"), "View") : null,
          btn({ class: "is-danger", onclick: () => confirmPendingDelete(blocked) }, icon(blocked ? "delete_forever" : "delete", "sm"), blocked ? "Force" : "Elimina"),
        ].filter(Boolean)
      )
    );
  })();

const renderToolMenu = () => {
  if (!workspaceState.toolMenu) return null;
  const selectedCount = workspaceState.selectedBoxIds.length;
  const menus = {
    align: [
      ["left", "Allinea a sinistra"],
      ["center", "Allinea al centro"],
      ["right", "Allinea a destra"],
      ["top", "Allinea in alto"],
      ["middle", "Allinea centro verticale"],
      ["bottom", "Allinea in basso"],
    ],
    distribute: [
      ["horizontal", "Distribuisci orizzontalmente"],
      ["vertical", "Distribuisci verticalmente"],
      ["horizontal", "Spaziatura uguale orizzontale"],
      ["vertical", "Spaziatura uguale verticale"],
    ],
    order: [
      ["forward", "Porta avanti"],
      ["backward", "Porta dietro"],
      ["front", "Porta in primo piano"],
      ["back", "Manda sul fondo"],
    ],
  };
  const action = { align: alignSelectedBoxes, distribute: distributeSelectedBoxes, order: changeBoxOrder }[workspaceState.toolMenu];
  const requirements = {
    align: { min: 1, message: "Seleziona almeno 1 box per usare Allinea." },
    distribute: { min: 3, message: "Seleziona almeno 3 box per usare Distribuisci." },
    order: { min: 1, message: "Seleziona almeno 1 box per cambiare Ordine." },
  };
  const requirement = requirements[workspaceState.toolMenu];
  const disabled = selectedCount < requirement.min;

  return _.Card(
    {
      class: "tl-tool-menu",
      onmousedown: (event) => event.stopPropagation(),
      onclick: (event) => event.stopPropagation(),
    },
    _.div({ class: "tl-tool-menu-status" }, disabled ? requirement.message : `${selectedCount} box selezionati`),
    _.Grid(
      { class: "tl-tool-menu-actions", cols: 1, gap: 6 },
      ...menus[workspaceState.toolMenu].map(([id, label]) =>
        btn(
          {
            class: disabled ? "disabled" : "",
            disabled,
            onclick: (event) => {
              event.stopPropagation();
              if (!disabled) action(id);
            },
          },
          label
        )
      )
    )
  );
};

const renderToolbox = () =>
  _.Card(
    { class: "tl-toolbox" },
    _.Row(
      { class: "tl-toolbox-row", align: "center", justify: "center", gap: 8 },
      ...workspaceData.tools.map((tool, index) => [
        index === 4 || index === 7 ? _.span({ class: "tl-separator" }) : null,
        btn({ id: `tool-${tool.id}`, class: `tl-tool-btn tool-button${workspaceState.activeTool === tool.id ? " is-active active" : ""}${tool.danger ? " is-danger" : ""}`, onclick: () => setActiveTool(tool.id) }, icon(tool.icon), _.span(tool.label)),
      ]).flat().filter(Boolean)
    )
  );

const renderShortcuts = () =>
  _.Card(
    { class: "tl-shortcuts" },
    _.Row(
      { class: "tl-shortcuts-row", align: "center", gap: 28 },
      _.span(icon("lightbulb_outline", "sm"), " Suggerimenti"),
      _.span("Seleziona ", _.kbd({ class: "tl-kbd" }, "V")),
      _.span("Sposta ", _.kbd({ class: "tl-kbd" }, "M")),
      _.span("Ridimensiona ", _.kbd({ class: "tl-kbd" }, "R")),
      _.span("Collega ", _.kbd({ class: "tl-kbd" }, "C")),
      _.span("Duplica ", _.kbd({ class: "tl-kbd" }, "Ctrl D")),
      _.span("Anteprima ", _.kbd({ class: "tl-kbd" }, "P")),
      _.span({ class: "tl-help" }, icon("help_outline", "sm"), " Serve aiuto? ", btn({ class: "tl-top-icon", onclick: () => setNotice("Guida rapida: clicca un box dalla lista per inserirlo, poi usa la toolbar.") }, "Apri guida", icon("chevron_right", "sm")))
    )
  );

const renderBottom = () => _.div({ class: "tl-bottom-bar" }, renderToolMenu(), renderToolbox(), renderShortcuts());

const publishWorkspace = async () => {
  workspaceState.workspace.published = true;
  workspaceState.workspace.publishedAt = new Date().toISOString();
  await saveWorkspace();
  workspaceState.savedLabel = "Pubblicazione locale pronta";
  setNotice("Pubblicazione locale preparata. Il catalogo remoto arrivera nella fase sito.");
  mountWorkspace();
};

const updateWorkspaceDraft = (key, value) => {
  workspaceState.workspace[key] = value;
  markDirty();
  setNotice("Proprieta workspace aggiornata");
  const saveState = document.getElementById("tl-save-state");
  if (saveState) saveState.textContent = workspaceState.savedLabel;
};

const updateWorkspaceConfig = (key, value, message) => {
  commitWorkspaceChange(message, () => {
    workspaceState.workspace[key] = value;
  });
};

const cycleGridSetting = (key) => {
  updateWorkspaceConfig(key, cycleValue(workspaceState.workspace[key], gridPresets[key]), `${key} aggiornato`);
};

const cycleSettingByLabel = (label) => {
  const keyByLabel = {
    Colonne: "columns",
    "Righe iniziali": "rows",
    "Altezza riga (px)": "rowHeight",
  };
  const key = keyByLabel[label];
  if (key) cycleGridSetting(key);
};

const cycleBackground = () => {
  const colors = ["#0f1115", "#071018", "#111827", "#10131a"];
  updateWorkspaceConfig("background", cycleValue(workspaceState.workspace.background, colors), "Sfondo workspace aggiornato");
};

const focusWorkspaceName = () => {
  openWorkspaceProperties();
};

const assetBoxSize = (asset = {}) => ({
  width: asset.type === "boxTracker" ? 5 : asset.width || 10,
  height: asset.type === "boxTracker" ? 3 : asset.height || 6,
});

const dropGridPosition = (event, asset) => {
  const metrics = canvasMetrics();
  if (!metrics) return null;
  const size = assetBoxSize(asset);
  const point = clientToCanvas(event);
  return {
    x: clamp(Math.floor(point.x / metrics.cellWidth) + 1, 1, workspaceState.workspace.columns - size.width + 1),
    y: clamp(Math.floor(point.y / metrics.cellHeight) + 1, 1, workspaceState.workspace.rows - size.height + 1),
  };
};

const addAssetToCanvas = (assetId, position = null) => {
  const asset = assetById(assetId);
  if (!asset) {
    setNotice("Seleziona un box dalla libreria prima di aggiungerlo.");
    mountWorkspace();
    return;
  }

  commitWorkspaceChange(`${asset.name} aggiunto alla griglia`, () => {
    const index = workspaceState.boxes.length;
    const size = assetBoxSize(asset);
    const box = displayBoxFromAsset(asset, {
      id: `${asset.id}-${Date.now()}`,
      assetId: asset.id,
      sourceId: asset.sourceId || asset.id,
      type: asset.type,
      x: position?.x || 3 + (index % 4) * 7,
      y: position?.y || 3 + Math.floor(index / 4) * 5,
      width: size.width,
      height: size.height,
      zIndex: workspaceState.boxes.length + 1,
      channels: asset.type === "boxTracker" ? ["default", "btc-price"] : [],
    });
    workspaceState.boxes.push(box);
    workspaceState.selectedAssetId = asset.id;
    workspaceState.selectedBoxId = box.id;
    workspaceState.selectedBoxIds = [box.id];
  });
};

const startAssetPointerDrag = (event, assetId) => {
  if (event.button !== 0) return;
  assetDragState.assetId = assetId;
  assetDragState.startX = event.clientX;
  assetDragState.startY = event.clientY;
  assetDragState.dragged = false;
  workspaceState.selectedAssetId = assetId;
};

const updateAssetPointerDrag = (event) => {
  if (!assetDragState.assetId) return;
  const dx = event.clientX - assetDragState.startX;
  const dy = event.clientY - assetDragState.startY;
  if (assetDragState.dragged || Math.hypot(dx, dy) > 6) {
    assetDragState.dragged = true;
    document.body.classList.add("is-dragging-workspace-asset");
  }
};

const finishAssetPointerDrop = (event) => {
  if (!assetDragState.assetId) return;
  const assetId = assetDragState.assetId;
  const wasDragged = assetDragState.dragged;

  assetDragState.assetId = null;
  assetDragState.dragged = false;
  document.body.classList.remove("is-dragging-workspace-asset");

  if (!wasDragged) return;
  assetDragState.suppressClick = true;

  const dropTarget = document.elementFromPoint(event.clientX, event.clientY)?.closest?.(".tl-canvas, .tl-drop-zone");
  if (!dropTarget) return;

  const asset = assetById(assetId);
  addAssetToCanvas(assetId, asset ? dropGridPosition(event, asset) : null);
};

const handleCanvasDragOver = (event) => {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
};

const handleCanvasDrop = (event) => {
  event.preventDefault();
  event.stopPropagation();
  const assetId = event.dataTransfer?.getData(WORKSPACE_ASSET_MIME) || event.dataTransfer?.getData("text/plain") || workspaceState.selectedAssetId;
  const asset = assetById(assetId);
  assetDragState.assetId = null;
  assetDragState.dragged = false;
  assetDragState.suppressClick = true;
  document.body.classList.remove("is-dragging-workspace-asset");
  addAssetToCanvas(assetId, asset ? dropGridPosition(event, asset) : null);
};

const selectBox = (boxId) => {
  workspaceState.selectedBoxIds = boxId ? [boxId] : [];
  workspaceState.selectedBoxId = boxId || null;
  setNotice(boxId ? "Box selezionato" : "Selezione rimossa");
  mountWorkspace();
};

const selectBoxes = (boxIds) => {
  workspaceState.selectedBoxIds = boxIds;
  workspaceState.selectedBoxId = boxIds[0] || null;
};

const handleBoxClick = (event, boxId) => {
  if (workspaceState.interaction?.dragged) return;
  const box = boxById(boxId);
  if (!box) return;
  if (workspaceState.activeTool === "connect") return handleConnectClick(box);
  if (event.shiftKey) {
    const selected = new Set(workspaceState.selectedBoxIds);
    selected.has(boxId) ? selected.delete(boxId) : selected.add(boxId);
    selectBoxes([...selected]);
  } else if (!isBoxSelected(boxId)) {
    selectBoxes([boxId]);
  }
  setNotice(workspaceState.selectedBoxIds.length > 1 ? `${workspaceState.selectedBoxIds.length} box selezionati` : "Box selezionato");
  mountWorkspace();
};

const duplicateSelectedBoxes = () => {
  const boxes = selectedBoxes();
  if (!boxes.length) return;
  commitWorkspaceChange("Box duplicati", () => {
    const clones = boxes.map((box, index) => hydrateWorkspaceBox({ ...serializeWorkspaceBox(box), id: `${box.assetId || box.id}-${Date.now()}-${index}`, x: clamp(box.x + 1, 1, workspaceState.workspace.columns - box.width + 1), y: box.y + 1, zIndex: nextZIndex() + index }));
    workspaceState.boxes.push(...clones);
    selectBoxes(clones.map((box) => box.id));
  });
};

const duplicateSelectedBox = duplicateSelectedBoxes;

const selectedDeleteDependencies = async (ids = []) => {
  const selected = new Set(ids);
  const boxes = workspaceState.boxes.filter((box) => selected.has(box.id));
  const connections = workspaceState.connections.filter((connection) => selected.has(connection.fromBoxId) || selected.has(connection.toBoxId));
  let runtimeDependencies = [];
  let managerReports = [];

  if (window.TrackerLensDependencyManager?.inspectNode) {
    managerReports = (await Promise.all(boxes.map((box) =>
      window.TrackerLensDependencyManager.inspectNode({ id: box.id, type: box.type || "boxLens" }).catch((error) => {
        console.warn("Dependency manager non disponibile per box:", box.id, error);
        return null;
      })
    ))).filter(Boolean);
  }

  try {
    const store = window.TrackerLensRuntimeGraphStore;
    if (store?.readAll && store?.STORES?.runtimeDependencies) {
      runtimeDependencies = (await store.readAll(store.STORES.runtimeDependencies)).filter((dependency) =>
        selected.has(dependency.sourceNodeId) || selected.has(dependency.targetNodeId)
      );
    }
  } catch (error) {
    console.warn("Dipendenze runtime persistite non leggibili:", error);
  }

  const channels = [...new Set([
    ...connections.map((connection) => connection.channel || "default"),
    ...runtimeDependencies.map((dependency) => dependency.channel || "default"),
    ...managerReports.flatMap((report) => report.channelNames || []),
  ])];
  const managerConnections = managerReports.flatMap((report) => report.connections || []);
  const managerRuntimeDependencies = managerReports.flatMap((report) => report.dependencies || []);
  const byId = (items = []) => [...new Map(items.filter(Boolean).map((item) => [item.id || JSON.stringify(item), item])).values()];
  return {
    boxes,
    connections: byId([...connections, ...managerConnections]),
    runtimeDependencies: byId([...runtimeDependencies, ...managerRuntimeDependencies]),
    channels,
    reports: managerReports,
    total: connections.length + runtimeDependencies.length + managerConnections.length + managerRuntimeDependencies.length,
    hasDependencies: connections.length > 0 || runtimeDependencies.length > 0 || managerReports.some((report) => report.hasDependencies),
  };
};

const openWorkspaceDeleteDependencies = () => {
  const dependency = workspaceState.pendingConfirm?.dependencies;
  const firstConnection = dependency?.connections?.[0];
  const firstBox = dependency?.boxes?.[0];
  const params = new URLSearchParams();
  params.set("runtime", "dependencies");
  if (firstBox?.id) params.set("nodeId", firstBox.id);
  if (firstBox?.type) params.set("nodeType", firstBox.type);
  if (dependency?.channels?.[0]) params.set("channel", dependency.channels[0]);
  if (firstConnection?.id) params.set("connectionId", firstConnection.id);
  openChromePage(`flowMap.html?${params.toString()}`);
};

const deleteSelectedBoxes = async () => {
  const ids = workspaceState.selectedBoxIds;
  if (!ids.length) {
    setNotice("Nessun box selezionato da eliminare");
    mountWorkspace();
    return;
  }

  const dependencies = await selectedDeleteDependencies(ids);
  workspaceState.pendingConfirm = {
    type: "delete",
    ids: [...ids],
    dependencies,
    requiresForce: dependencies.hasDependencies,
  };
  setNotice(dependencies.hasDependencies ? "Dipendenze runtime rilevate" : "Conferma eliminazione richiesta");
  mountWorkspace();
};

const deletePlacedBox = (event, box) => {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  selectBoxes([box.id]);
  deleteSelectedBoxes();
};

const confirmPendingDelete = (force = false) => {
  const ids = workspaceState.pendingConfirm?.type === "delete" ? workspaceState.pendingConfirm.ids : [];
  if (!ids.length) return cancelPendingConfirm();
  if (workspaceState.pendingConfirm?.requiresForce && !force) {
    setNotice("Eliminazione bloccata: usa View Dependencies o Force Delete.");
    mountWorkspace();
    return;
  }
  commitWorkspaceChange("Box selezionati eliminati", () => {
    const selected = new Set(ids);
    workspaceState.boxes = workspaceState.boxes.filter((item) => !selected.has(item.id));
    workspaceState.connections = workspaceState.connections.filter((connection) => !selected.has(connection.fromBoxId) && !selected.has(connection.toBoxId));
    workspaceState.pendingConfirm = null;
    selectBoxes([]);
  });
  if (window.TrackerLensEventLogStore?.cleanupNodeReferences) {
    window.TrackerLensEventLogStore.cleanupNodeReferences({
      nodeIds: ids,
      workspaceId: workspaceState.workspace.id || "",
    }).catch((error) => console.warn("Cleanup eventi nodi runtime non completato:", error));
  }
  persistWorkspaceSilently();
};

const cancelPendingConfirm = () => {
  workspaceState.pendingConfirm = null;
  setNotice("Eliminazione annullata");
  mountWorkspace();
};

const deleteSelectedBox = deleteSelectedBoxes;

const canvasMetrics = () => {
  const content = document.querySelector(".tl-canvas-content");
  if (!content) return null;
  const rect = content.getBoundingClientRect();
  const zoom = workspaceState.zoom / 100;
  return {
    rect,
    zoom,
    cellWidth: rect.width / workspaceState.workspace.columns / zoom,
    cellHeight: rect.height / workspaceState.workspace.rows / zoom,
  };
};

const clientToCanvas = (event) => {
  const metrics = canvasMetrics();
  if (!metrics) return { x: 0, y: 0 };
  return {
    x: (event.clientX - metrics.rect.left) / metrics.zoom,
    y: (event.clientY - metrics.rect.top) / metrics.zoom,
  };
};

const deltaToGrid = (event, interaction) => {
  const metrics = canvasMetrics();
  if (!metrics) return { dx: 0, dy: 0 };
  return {
    dx: Math.round((event.clientX - interaction.startClientX) / metrics.zoom / metrics.cellWidth),
    dy: Math.round((event.clientY - interaction.startClientY) / metrics.zoom / metrics.cellHeight),
  };
};

const startCanvasPointer = (event) => {
  if (event.button !== 0 || event.target.closest?.(".tl-placed-box")) return;
  if (workspaceState.activeTool !== "select") return;

  if (workspaceState.zoom > 100) {
    event.preventDefault();
    workspaceState.interaction = {
      type: "pan",
      startClientX: event.clientX,
      startClientY: event.clientY,
      initialPanX: workspaceState.panX,
      initialPanY: workspaceState.panY,
      dragged: false,
    };
    setNotice("Trascina per spostare la vista del canvas.");
    mountWorkspace();
    return;
  }

  const point = clientToCanvas(event);
  workspaceState.interaction = { type: "select-rect", startClientX: event.clientX, startClientY: event.clientY, startX: point.x, startY: point.y };
  workspaceState.selectionRect = { left: point.x, top: point.y, width: 0, height: 0 };
  selectBoxes([]);
  mountWorkspace();
};

const startBoxPointer = (event, boxId) => {
  if (event.button !== 0 || workspaceState.activeTool !== "move") return;
  event.preventDefault();
  event.stopPropagation();
  if (!isBoxSelected(boxId)) selectBoxes(event.shiftKey ? [...workspaceState.selectedBoxIds, boxId] : [boxId]);
  workspaceState.interaction = {
    type: "move",
    boxId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    snapshot: cloneWorkspaceModel(),
    initialBoxes: selectedBoxes().map((box) => ({ id: box.id, x: box.x, y: box.y, width: box.width, height: box.height })),
    dragged: false,
  };
};

const startResizePointer = (event, boxId, handle) => {
  if (event.button !== 0 || workspaceState.activeTool !== "resize") return;
  event.preventDefault();
  event.stopPropagation();
  if (!isBoxSelected(boxId)) selectBoxes([boxId]);
  workspaceState.interaction = {
    type: "resize",
    boxId,
    handle,
    startClientX: event.clientX,
    startClientY: event.clientY,
    snapshot: cloneWorkspaceModel(),
    initialBoxes: selectedBoxes().map((box) => ({ id: box.id, x: box.x, y: box.y, width: box.width, height: box.height })),
    dragged: false,
  };
};

const handleCanvasHover = (event) => {
  if (workspaceState.activeTool !== "connect" || !workspaceState.connectDraft) return;
  const canvas = event.currentTarget.getBoundingClientRect();
  const from = boxCenterPercent(boxById(workspaceState.connectDraft.fromBoxId));
  if (!from) return;
  workspaceState.tempLine = { temp: true, x1: from.x, y1: from.y, x2: ((event.clientX - canvas.left) / canvas.width) * 100, y2: ((event.clientY - canvas.top) / canvas.height) * 100 };
  mountWorkspace();
};

const updatePointerInteraction = (event) => {
  const interaction = workspaceState.interaction;
  if (!interaction) return;

  if (interaction.type === "select-rect") {
    const point = clientToCanvas(event);
    const left = Math.min(interaction.startX, point.x);
    const top = Math.min(interaction.startY, point.y);
    const width = Math.abs(point.x - interaction.startX);
    const height = Math.abs(point.y - interaction.startY);
    workspaceState.selectionRect = { left, top, width, height };
    selectBoxes(boxesInsideRect(workspaceState.selectionRect));
    mountWorkspace();
    return;
  }

  if (interaction.type === "pan") {
    const dx = event.clientX - interaction.startClientX;
    const dy = event.clientY - interaction.startClientY;
    interaction.dragged = interaction.dragged || Math.abs(dx) > 1 || Math.abs(dy) > 1;
    workspaceState.panX = interaction.initialPanX + dx;
    workspaceState.panY = interaction.initialPanY + dy;
    mountWorkspace();
    return;
  }

  if (interaction.type === "move") {
    const { dx, dy } = deltaToGrid(event, interaction);
    interaction.dragged = interaction.dragged || dx !== 0 || dy !== 0;
    interaction.initialBoxes.forEach((initial) => {
      const box = boxById(initial.id);
      if (!box) return;
      box.x = clamp(initial.x + dx, 1, workspaceState.workspace.columns - initial.width + 1);
      box.y = clamp(initial.y + dy, 1, workspaceState.workspace.rows - initial.height + 1);
    });
    setNotice("Spostamento box in corso");
    mountWorkspace();
    return;
  }

  if (interaction.type === "resize") {
    const { dx, dy } = deltaToGrid(event, interaction);
    interaction.dragged = interaction.dragged || dx !== 0 || dy !== 0;
    interaction.initialBoxes.forEach((initial) => {
      const box = boxById(initial.id);
      if (box) applyResizeDelta(box, initial, interaction.handle, dx, dy);
    });
    setNotice("Ridimensionamento box in corso");
    mountWorkspace();
  }
};

const finishPointerInteraction = () => {
  const interaction = workspaceState.interaction;
  if (!interaction) return;

  if (interaction.type === "select-rect") {
    workspaceState.selectionRect = null;
    workspaceState.interaction = null;
    setNotice(workspaceState.selectedBoxIds.length ? `${workspaceState.selectedBoxIds.length} box selezionati` : "Selezione rimossa");
    mountWorkspace();
    return;
  }

  if (interaction.type === "pan") {
    workspaceState.interaction = null;
    workspaceState.suppressCanvasClick = interaction.dragged;
    setNotice(interaction.dragged ? "Vista canvas spostata" : "Vista canvas invariata");
    mountWorkspace();
    return;
  }

  if ((interaction.type === "move" || interaction.type === "resize") && interaction.dragged) {
    workspaceState.history.push(interaction.snapshot);
    workspaceState.future = [];
    markDirty(interaction.type === "move" ? "Posizione non salvata" : "Dimensione non salvata");
    setNotice(interaction.type === "move" ? "Posizione box aggiornata" : "Dimensione box aggiornata");
    workspaceState.interaction = null;
    persistWorkspaceSilently();
    mountWorkspace();
    return;
  }

  workspaceState.interaction = null;
};

const applyResizeDelta = (box, initial, handle, dx, dy) => {
  const minWidth = box.minWidth || 2;
  const minHeight = box.minHeight || 2;
  const maxWidth = box.maxWidth || 18;
  const maxHeight = box.maxHeight || 12;
  let x = initial.x;
  let y = initial.y;
  let width = initial.width;
  let height = initial.height;

  if (handle.includes("e")) width = initial.width + dx;
  if (handle.includes("s")) height = initial.height + dy;
  if (handle.includes("w")) {
    width = initial.width - dx;
    x = initial.x + dx;
  }
  if (handle.includes("n")) {
    height = initial.height - dy;
    y = initial.y + dy;
  }

  width = clamp(width, minWidth, Math.min(maxWidth, workspaceState.workspace.columns));
  height = clamp(height, minHeight, Math.min(maxHeight, workspaceState.workspace.rows));
  x = clamp(x, 1, workspaceState.workspace.columns - width + 1);
  y = clamp(y, 1, workspaceState.workspace.rows - height + 1);
  Object.assign(box, { x, y, width, height });
};

const boxesInsideRect = (rect) => {
  const metrics = canvasMetrics();
  if (!metrics) return [];
  return workspaceState.boxes
    .filter((box) => {
      const left = (box.x - 1) * metrics.cellWidth;
      const top = (box.y - 1) * metrics.cellHeight;
      const width = box.width * metrics.cellWidth;
      const height = box.height * metrics.cellHeight;
      return left < rect.left + rect.width && left + width > rect.left && top < rect.top + rect.height && top + height > rect.top;
    })
    .map((box) => box.id);
};

const openBoxEditor = (box) => {
  const sourceId = box.sourceId || box.assetId;
  openUniversalBoxEditor(
    {
      type: box.type === "boxTracker" ? "boxTracker" : "boxLens",
      id: sourceId || "",
      template: sourceId ? null : box,
    }
  );
};

const handleConnectClick = (box) => {
  if (!workspaceState.connectDraft) {
    if (box.type !== "boxTracker") {
      setNotice("Il primo box deve essere un boxTracker.");
      mountWorkspace();
      return;
    }
    workspaceState.connectDraft = { fromBoxId: box.id };
    setNotice("Source tracker selezionato. Ora clicca un boxLens.");
    mountWorkspace();
    return;
  }

  const source = boxById(workspaceState.connectDraft.fromBoxId);
  if (!source || box.type !== "boxLens" || source.id === box.id) {
    workspaceState.connectDraft = null;
    workspaceState.tempLine = null;
    setNotice("Collegamento non valido: usa boxTracker -> boxLens.");
    mountWorkspace();
    return;
  }

  const channel = source.channels?.length > 1 ? source.channels[0] : "default";
  commitWorkspaceChange("Connessione creata", () => {
    workspaceState.connections.push({ id: `connection_${Date.now()}`, fromBoxId: source.id, toBoxId: box.id, channel, mapping: {} });
    workspaceState.connectDraft = null;
    workspaceState.tempLine = null;
  });
  persistWorkspaceSilently();
};

const boxCenterPercent = (box) => {
  if (!box) return null;
  return {
    x: ((box.x - 1 + box.width / 2) / workspaceState.workspace.columns) * 100,
    y: ((box.y - 1 + box.height / 2) / workspaceState.workspace.rows) * 100,
  };
};

const connectionLine = (connection) => {
  const source = boxCenterPercent(boxById(connection.fromBoxId));
  const target = boxCenterPercent(boxById(connection.toBoxId));
  if (!source || !target) return null;
  return { x1: source.x, y1: source.y, x2: target.x, y2: target.y };
};

const openAlignMenu = () => {
  workspaceState.toolMenu = "align";
  setNotice(workspaceState.selectedBoxIds.length ? "Scegli dove allineare nel canvas." : "Seleziona almeno 1 box per allineare.");
  mountWorkspace();
};

const openDistributeMenu = () => {
  workspaceState.toolMenu = "distribute";
  setNotice(workspaceState.selectedBoxIds.length >= 3 ? "Scegli una distribuzione." : "Seleziona almeno 3 box per distribuire.");
  mountWorkspace();
};

const openOrderMenu = () => {
  workspaceState.toolMenu = "order";
  setNotice(workspaceState.selectedBoxIds.length ? "Scegli ordine z-index." : "Seleziona almeno un box per cambiare ordine.");
  mountWorkspace();
};

const alignSelectedBoxes = (alignment) => {
  const boxes = selectedBoxes();
  if (!boxes.length) {
    setNotice("Allinea richiede almeno 1 box selezionato.");
    mountWorkspace();
    return;
  }

  commitWorkspaceChange("Box allineati", () => {
    boxes.forEach((box) => {
      if (alignment === "left") box.x = 1;
      if (alignment === "center") box.x = clamp(Math.round((workspaceState.workspace.columns - box.width) / 2) + 1, 1, workspaceState.workspace.columns - box.width + 1);
      if (alignment === "right") box.x = workspaceState.workspace.columns - box.width + 1;
      if (alignment === "top") box.y = 1;
      if (alignment === "middle") box.y = clamp(Math.round((workspaceState.workspace.rows - box.height) / 2) + 1, 1, workspaceState.workspace.rows - box.height + 1);
      if (alignment === "bottom") box.y = workspaceState.workspace.rows - box.height + 1;
    });
    workspaceState.toolMenu = null;
  });
  persistWorkspaceSilently();
};

const distributeSelectedBoxes = (direction) => {
  const boxes = selectedBoxes().slice().sort((a, b) => (direction === "horizontal" ? a.x - b.x : a.y - b.y));
  if (boxes.length < 3) {
    setNotice("Distribuisci richiede almeno 3 box selezionati.");
    mountWorkspace();
    return;
  }
  const first = boxes[0];
  const last = boxes[boxes.length - 1];
  commitWorkspaceChange("Box distribuiti", () => {
    const span = direction === "horizontal" ? last.x - first.x : last.y - first.y;
    const step = Math.max(1, Math.round(span / (boxes.length - 1)));
    boxes.slice(1, -1).forEach((box, index) => {
      if (direction === "horizontal") box.x = clamp(first.x + step * (index + 1), 1, workspaceState.workspace.columns - box.width + 1);
      if (direction === "vertical") box.y = clamp(first.y + step * (index + 1), 1, workspaceState.workspace.rows - box.height + 1);
    });
    workspaceState.toolMenu = null;
  });
  persistWorkspaceSilently();
};

const changeBoxOrder = (mode) => {
  const boxes = selectedBoxes();
  if (!boxes.length) {
    setNotice("Seleziona almeno un box per cambiare ordine.");
    mountWorkspace();
    return;
  }
  commitWorkspaceChange("Ordine box aggiornato", () => {
    boxes.forEach((box) => {
      const current = box.zIndex || 1;
      if (mode === "forward") box.zIndex = current + 1;
      if (mode === "backward") box.zIndex = Math.max(1, current - 1);
      if (mode === "front") box.zIndex = nextZIndex();
      if (mode === "back") box.zIndex = 1;
    });
    workspaceState.toolMenu = null;
  });
  persistWorkspaceSilently();
};

const clearWorkspace = () => {
  commitWorkspaceChange("Griglia svuotata", () => {
    workspaceState.boxes = [];
    workspaceState.connections = [];
    selectBoxes([]);
    workspaceState.actionMenuOpen = false;
  });
};

const resetWorkspaceView = () => {
  workspaceState.zoom = 100;
  workspaceState.panX = 0;
  workspaceState.panY = 0;
  workspaceState.device = "desktop";
  workspaceState.actionMenuOpen = false;
  setNotice("Vista workspace ripristinata");
  mountWorkspace();
};

const undoWorkspace = () => {
  const snapshot = workspaceState.history.pop();
  if (!snapshot) return;
  workspaceState.future.push(cloneWorkspaceModel());
  restoreWorkspaceModel(snapshot);
  markDirty("Modifica annullata");
  setNotice("Ultima modifica annullata");
  mountWorkspace();
};

const redoWorkspace = () => {
  const snapshot = workspaceState.future.pop();
  if (!snapshot) return;
  workspaceState.history.push(cloneWorkspaceModel());
  restoreWorkspaceModel(snapshot);
  markDirty("Modifica ripristinata");
  setNotice("Modifica ripristinata");
  mountWorkspace();
};

const handleWorkspaceKeys = (event) => {
  if (
    event.target?.matches?.("input, textarea, select, [contenteditable='true']") ||
    event.target?.closest?.(".cms-dialog, .cm-editor, .cm-content")
  ) return;
  const key = event.key.toLowerCase();
  if ((event.metaKey || event.ctrlKey) && key === "s") {
    event.preventDefault();
    saveWorkspace();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && key === "a") {
    event.preventDefault();
    selectBoxes(visibleWorkspaceBoxes().map((box) => box.id));
    setNotice(`${visibleWorkspaceBoxes().length} box selezionati`);
    mountWorkspace();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && key === "d") {
    event.preventDefault();
    duplicateSelectedBoxes();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && key === "z") {
    event.preventDefault();
    undoWorkspace();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && key === "y") {
    event.preventDefault();
    redoWorkspace();
    return;
  }
  if (key === "escape") {
    selectBoxes([]);
    workspaceState.activeTool = "select";
    workspaceState.toolMenu = null;
    workspaceState.connectDraft = null;
    workspaceState.tempLine = null;
    setNotice("Selezione cancellata");
    mountWorkspace();
    return;
  }
  if (key === "v") setActiveTool("select");
  if (key === "m") setActiveTool("move");
  if (key === "r") setActiveTool("resize");
  if (key === "c") setActiveTool("connect");
  if (key === "p") togglePreview();
};

const mountWorkspace = () => {
  const root = document.getElementById("tl-workspace-root");
  root.replaceChildren(
    _.div(
      { class: "tl-workspace-shell" },
      renderHeader(),
      _.div({ class: "tl-workspace-body" }, renderRail(), renderAddPanel(), renderCanvas()),
      renderProperties(),
      renderFixedNavigator(),
      renderBottom()
    )
  );

  const searchInput = root.querySelector(".tl-search input");
  if (searchInput) searchInput.placeholder = "Cerca box...";
};

const loadLocalAssets = async () => {
  workspaceState.assetsLoading = true;
  workspaceState.assetsError = "";
  workspaceState.flowMapsLoading = true;
  workspaceState.flowMapsError = "";
  mountWorkspace();

  try {
    const [assets, flowMaps] = await Promise.all([
      window.TrackerLensLocalLibrary.listWidgetAssets(),
      listComposableWorkspaceFlowMaps(),
    ]);
    workspaceState.localAssets = assets;
    workspaceState.localFlowMaps = flowMaps;
    hydrateWorkspaceBoxes();
    workspaceState.assetsLoading = false;
    workspaceState.flowMapsLoading = false;
  } catch (error) {
    console.error(error);
    workspaceState.localAssets = [];
    workspaceState.localFlowMaps = [];
    workspaceState.assetsLoading = false;
    workspaceState.flowMapsLoading = false;
    workspaceState.assetsError = "Libreria locale non disponibile.";
    workspaceState.flowMapsError = "Flow Map locali non disponibili.";
  }

  mountWorkspace();
};

const initializeWorkspace = async () => {
  await loadWorkspaceFromQuery();
  await loadLocalAssets();
  const createType = new URLSearchParams(window.location.search).get("create");
  if (createType === "boxLens" || createType === "boxTracker") {
    openUniversalBoxEditor({ type: createType });
  }
};

CMSwift.ready(initializeWorkspace);
document.addEventListener("keydown", handleWorkspaceKeys);
document.addEventListener("mousemove", updatePointerInteraction);
document.addEventListener("mousemove", updateAssetPointerDrag);
document.addEventListener("mouseup", finishPointerInteraction);
document.addEventListener("mouseup", finishAssetPointerDrop);
