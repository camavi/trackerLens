(function () {
const icon = (name, size = "md") => _.Icon({ name, size });
const btn = (props, ...children) => _.Btn({ type: "button", ...props }, ...children);

const flowLibraryState = {
  loading: true,
  error: "",
  items: [],
  query: "",
  category: "Tutti",
  categoryQuery: "",
  sort: "recent",
  searchFocus: false,
  searchSelectionStart: 0,
  categorySearchFocus: false,
  categorySearchSelectionStart: 0,
};

const sortOptions = [
  { value: "recent", label: "Piu recenti" },
  { value: "name", label: "Nome A-Z" },
  { value: "nodes", label: "Piu nodi" },
];

const selectArrowSlot = {
  arrow: () => icon("keyboard_arrow_down", "sm"),
};

const PAGE_STORE = (typeof tlConfig !== "undefined" ? tlConfig.TABLES?.TL_PAGES : null) || "tl_pages";
const FLOW_STORE = (typeof tlConfig !== "undefined" ? tlConfig.TABLES?.TL_FLOWS : null) || "tl_flows";
const NODE_STORE = (typeof tlConfig !== "undefined" ? tlConfig.TABLES?.TL_RUNTIME_NODES : null) || "tl_runtime_nodes";
const DEPENDENCY_STORE = (typeof tlConfig !== "undefined" ? tlConfig.TABLES?.TL_RUNTIME_DEPENDENCIES : null) || "tl_runtime_dependencies";
const CHANNEL_STORE = (typeof tlConfig !== "undefined" ? tlConfig.TABLES?.TL_CHANNELS : null) || "tl_channels";
const EVENT_STORE = (typeof tlConfig !== "undefined" ? tlConfig.TABLES?.TL_EVENTS : null) || "tl_events";
const FLOW_LOG_STORE = (typeof tlConfig !== "undefined" ? tlConfig.TABLES?.TL_FLOW_LOGS : null) || "tl_flow_logs";
const CONNECTION_STORE = (typeof tlConfig !== "undefined" ? tlConfig.TABLES?.TL_CONNECTIONS : null) || "tl_connections";

const normalizeText = (value, fallback = "") => value === null || value === undefined ? fallback : String(value).trim() || fallback;
const openChromePage = (url) => window.TrackerLensSidebar?.navigate?.(url) || window.location.assign(url);
const openFlowMap = (workspaceId) => openChromePage(`flowMap.html?workspaceId=${encodeURIComponent(workspaceId)}`);
const flowColorPalette = ["#38bdf8", "#35c979", "#ffc72c", "#f472b6", "#a78bfa", "#2dd4bf", "#fb7185", "#60a5fa"];
const safeFlowId = (value = "") =>
  normalizeText(value, "flowmap").toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "flowmap";

const validHexColor = (value = "") => /^#[0-9a-f]{6}$/i.test(String(value || "").trim());

const defaultFlowColor = (workspaceId = "") => {
  const key = String(workspaceId || "global");
  const hash = key.split("").reduce((total, char) => total + char.charCodeAt(0), 0);
  return flowColorPalette[hash % flowColorPalette.length];
};

const hexToRgb = (hex = "#38bdf8") => {
  const value = validHexColor(hex) ? hex.slice(1) : "38bdf8";
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ].join(", ");
};

const flowColorStyle = (color = "#38bdf8") => ({
  "--tl-flowmap-color": color,
  "--tl-flowmap-rgb": hexToRgb(color),
});

const recordUiColor = (record = {}) => {
  const ui = record.ui && typeof record.ui === "object" ? record.ui : {};
  return validHexColor(ui.color) ? ui.color : validHexColor(record.color) ? record.color : "";
};

const ensureFlowLibraryStores = async () => {
  const persistence = window.trackers?.desktop?.persistence;
  if (!persistence?.getStatus || !persistence.readDevelopmentRecords || !persistence.writeDevelopmentRecords || !persistence.deleteDevelopmentRecords) throw new Error("Library Flow Map richiede SQLite nell'app desktop.");
  if ((await persistence.getStatus())?.mode !== "desktop-sqlite") throw new Error("Library Flow Map richiede SQLite nell'app desktop.");
  return persistence;
};

const readAll = async (storeName) => {
  return (await ensureFlowLibraryStores()).readDevelopmentRecords({ storeName });
};

const readRecord = async (storeName, id) => {
  if (!storeName || !id) return null;
  return (await readAll(storeName)).find((record) => record.id === id) || null;
};

const writeRecord = async (storeName, record) => {
  if (!storeName || !record?.id) return null;
  await (await ensureFlowLibraryStores()).writeDevelopmentRecords({ storeName, records: [record] });
  return record;
};

const deleteRecord = async (storeName, id) => {
  if (!storeName || !id) return null;
  await (await ensureFlowLibraryStores()).deleteDevelopmentRecords({ storeName, ids: [id] });
  return id;
};

const deleteScopedRecords = async (storeName, workspaceId = "") => {
  if (!storeName || !workspaceId) return [];
  const persistence = await ensureFlowLibraryStores();
  {
    const records = await persistence.readDevelopmentRecords({ storeName });
    const ids = records
      .filter((record) => record?.workspaceId === workspaceId || record?.id === workspaceId)
      .map((record) => record.id)
      .filter(Boolean);
    if (!ids.length) return [];
    await persistence.deleteDevelopmentRecords({ storeName, ids });
    return ids;
  }
};

const contentOf = (record) => record?.content && typeof record.content === "object" ? record.content : record || {};

const isFlowMapRecord = (record = {}) => {
  const content = contentOf(record);
  return content.type === "flowmap" || content.kind === "flowmap" || content.format === "tlflow" || record?.format === "tlflow";
};

const isFlowMapFlow = (flow = {}) =>
  flow?.type === "flowmap" || flow?.kind === "flowmap" || flow?.format === "tlflow" || flow?.libraryKind === "flowmap";

const loadFlowMapsFromDb = async () => {
  const [pages, flows, nodes, dependencies] = await Promise.all([
    readAll(PAGE_STORE),
    readAll(FLOW_STORE),
    readAll(NODE_STORE),
    readAll(DEPENDENCY_STORE),
  ]);
  const flowMapPages = pages.filter(isFlowMapRecord);
  const flowMapFlows = flows.filter(isFlowMapFlow);
  const pageById = new Map(flowMapPages.map((record) => [normalizeText(record.id || contentOf(record).id), contentOf(record)]));
  const workspaceIds = new Set([
    ...flowMapPages.map((record) => normalizeText(record.id || contentOf(record).id)).filter(Boolean),
    ...flowMapFlows.map((flow) => normalizeText(flow.workspaceId || flow.id)).filter(Boolean),
  ]);

  return Array.from(workspaceIds).map((workspaceId) => {
    const page = pageById.get(workspaceId) || {};
    const flow = flowMapFlows.find((item) => item.workspaceId === workspaceId || item.id === workspaceId) || {};
    const scopedNodes = nodes.filter((node) => node.workspaceId === workspaceId);
    const scopedDependencies = dependencies.filter((dependency) => dependency.workspaceId === workspaceId);
    const name = normalizeText(flow.name || page.name || page.title, workspaceId);
    const category = normalizeText(flow.category || page.category, "global");
    const color = recordUiColor(flow) || recordUiColor(page) || defaultFlowColor(workspaceId);
    const updatedAt = normalizeText(page.updatedAt || page.savedAt || flow.updatedAt || page.createdAt || flow.createdAt);
    const description = normalizeText(page.description, `${scopedNodes.length} nodi runtime · ${scopedDependencies.length} collegamenti`);
    return {
      id: workspaceId,
      name,
      category,
      color,
      description,
      nodes: scopedNodes.length,
      dependencies: scopedDependencies.length,
      status: normalizeText(flow.status || page.status, "active"),
      updatedAt,
      searchText: [workspaceId, name, category, description, flow.status, page.status].map((value) => normalizeText(value).toLowerCase()).join(" "),
    };
  });
};

const sortFlowMaps = (a, b) => {
  if (flowLibraryState.sort === "name") return a.name.localeCompare(b.name);
  if (flowLibraryState.sort === "nodes") return b.nodes - a.nodes || a.name.localeCompare(b.name);
  const timeA = Date.parse(a.updatedAt) || 0;
  const timeB = Date.parse(b.updatedAt) || 0;
  return timeB - timeA || a.name.localeCompare(b.name);
};

const visibleFlowMaps = () => {
  const query = flowLibraryState.query.toLowerCase().trim();
  return flowLibraryState.items
    .filter((item) => !query || item.searchText.includes(query))
    .filter((item) => flowLibraryState.category === "Tutti" || (item.category || "global") === flowLibraryState.category)
    .sort(sortFlowMaps);
};

const categoryCounts = () => {
  const counts = new Map([["Tutti", flowLibraryState.items.length]]);
  flowLibraryState.items.forEach((item) => {
    const category = item.category || "global";
    counts.set(category, (counts.get(category) || 0) + 1);
  });
  const query = flowLibraryState.categoryQuery.toLowerCase().trim();
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .filter((category) => !query || category.name.toLowerCase().includes(query))
    .sort((a, b) => (a.name === "Tutti" ? -1 : b.name === "Tutti" ? 1 : a.name.localeCompare(b.name)));
};

const importFlowMapFile = () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".tlflow,.tlworkspace,application/json,.json";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const result = await window.TrackerLensPortableRuntime.importFile(file, { onConflict: "overwrite", includeRuntimeGraph: true, forceKind: "flowmap" });
      await loadFlowLibrary();
      if (result?.id) openFlowMap(result.id);
    } catch (error) {
      flowLibraryState.error = error?.message || "Import Flow Map non riuscito.";
      mountFlowLibrary();
    }
  };
  input.click();
};

const exportFlowMap = async (item, event = null) => {
  event?.stopPropagation?.();
  try {
    await window.TrackerLensPortableRuntime.exportFlowMapFile(item.id);
  } catch (error) {
    flowLibraryState.error = error?.message || "Export Flow Map non riuscito.";
    mountFlowLibrary();
  }
};

const deleteFlowMap = async (item, event = null) => {
  event?.stopPropagation?.();
  const confirmed = window.confirm(`Eliminare il Flow Map "${item.name}"?\n\nQuesta azione rimuove il flow locale, i nodi runtime, i collegamenti, i canali, gli eventi e i log collegati.`);
  if (!confirmed) return;

  try {
    await Promise.all([
      deleteRecord(PAGE_STORE, item.id),
      deleteScopedRecords(FLOW_STORE, item.id),
      deleteScopedRecords(NODE_STORE, item.id),
      deleteScopedRecords(DEPENDENCY_STORE, item.id),
      deleteScopedRecords(CHANNEL_STORE, item.id),
      deleteScopedRecords(EVENT_STORE, item.id),
      deleteScopedRecords(FLOW_LOG_STORE, item.id),
      deleteScopedRecords(CONNECTION_STORE, item.id),
    ]);
    await loadFlowLibrary();
  } catch (error) {
    flowLibraryState.error = error?.message || "Eliminazione Flow Map non riuscita.";
    mountFlowLibrary();
  }
};

const saveFlowMapColor = async (item, color, event = null) => {
  event?.stopPropagation?.();
  if (!validHexColor(color)) return;
  try {
    const now = new Date().toISOString();
    const pageRecord = await readRecord(PAGE_STORE, item.id);
    const pageContent = contentOf(pageRecord) || {};
    await writeRecord(PAGE_STORE, {
      ...(pageRecord || {}),
      id: item.id,
      content: {
        ...pageContent,
        id: pageContent.id || item.id,
        type: "flowmap",
        kind: "flowmap",
        format: "tlflow",
        libraryKind: "flowmap",
        ui: {
          ...(pageContent.ui && typeof pageContent.ui === "object" ? pageContent.ui : {}),
          color,
          colorUpdatedAt: now,
        },
      },
    });

    const flowRecord = (await readAll(FLOW_STORE)).find((flow) => flow.workspaceId === item.id || flow.id === item.id);
    if (flowRecord?.id) {
      await writeRecord(FLOW_STORE, {
        ...flowRecord,
        type: "flowmap",
        kind: "flowmap",
        format: "tlflow",
        libraryKind: "flowmap",
        ui: {
          ...(flowRecord.ui && typeof flowRecord.ui === "object" ? flowRecord.ui : {}),
          color,
          colorUpdatedAt: now,
        },
      });
    }

    flowLibraryState.items = flowLibraryState.items.map((flow) => flow.id === item.id ? { ...flow, color } : flow);
    mountFlowLibrary();
  } catch (error) {
    flowLibraryState.error = error?.message || "Colore Flow Map non salvato.";
    mountFlowLibrary();
  }
};

const createDefaultFlowBoundaryNodes = (workspaceId, now) => {
  const boundaryNode = ({
    id,
    label,
    subtype,
    iconName,
    tone,
    permission,
    port,
    side,
    x,
  }) => {
    const inputs = side === "in" ? [port] : [];
    const outputs = side === "out" ? [port] : [];
    return {
      id,
      workspaceId,
      type: "flowPort",
      label,
      sourceRef: "",
      assetId: "",
      inputs,
      outputs,
      channels: [port.name],
      status: "active",
      runtime: {
        status: "active",
        active: true,
      },
      position: { x: 1, y: 1 },
      flowPosition: { x, y: 260, width: 246 },
      metadata: {
        configured: true,
        draft: false,
        paletteLabel: label,
        paletteAction: subtype === "flow-in" ? "Flow Map Input" : "Flow Map Output",
        tone,
        icon: iconName,
        runtimeType: "flowPort",
        subtype,
        category: "flow-maps",
        flowPorts: [port],
        hasInput: side === "in",
        hasOutput: side === "out",
        permissions: [permission],
        manifest: {
          version: "1.0.0",
          type: "flowPort",
          subtype,
          category: "flow-maps",
          inputs,
          outputs,
          permissions: [permission],
        },
      },
      createdAt: now,
      updatedAt: now,
    };
  };

  return [
    boundaryNode({
      id: `flow_in_${safeFlowId(workspaceId)}`,
      label: "Flow In",
      subtype: "flow-in",
      iconName: "login",
      tone: "green",
      permission: "flow.input",
      port: { id: "flow.in", name: "flow.in", type: "object", schema: null, required: false },
      side: "out",
      x: 160,
    }),
    boundaryNode({
      id: `flow_out_${safeFlowId(workspaceId)}`,
      label: "Flow Out",
      subtype: "flow-out",
      iconName: "logout",
      tone: "cyan",
      permission: "flow.output",
      port: { id: "flow.out", name: "flow.out", type: "object", schema: null, required: false },
      side: "in",
      x: 820,
    }),
  ];
};

const createFlowMapFromDialog = async ({ close, titleInput, descriptionInput, categoryInput, colorInput, versionInput }) => {
  const title = normalizeText(titleInput.value, "Nuovo Flow Map");
  const category = normalizeText(categoryInput.value, "global");
  const version = normalizeText(versionInput.value, "0.1.0");
  const color = validHexColor(colorInput.value) ? colorInput.value : defaultFlowColor(title);
  const description = normalizeText(descriptionInput.value);
  const now = new Date().toISOString();
  const baseId = `flowmap_${safeFlowId(title)}`;
  let workspaceId = baseId;
  let suffix = 1;

  while (await readRecord(PAGE_STORE, workspaceId)) {
    suffix += 1;
    workspaceId = `${baseId}_${suffix}`;
  }

  const pageContent = {
    id: workspaceId,
    name: title,
    title,
    description,
    category,
    version,
    type: "flowmap",
    kind: "flowmap",
    format: "tlflow",
    libraryKind: "flowmap",
    status: "active",
    boxes: [],
    connections: [],
    columns: 48,
    ui: {
      color,
      colorUpdatedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };
  const flow = {
    id: `flow_${safeFlowId(workspaceId)}`,
    workspaceId,
    name: title,
    category,
    version,
    status: "active",
    type: "flowmap",
    kind: "flowmap",
    format: "tlflow",
    libraryKind: "flowmap",
    nodes: [],
    connections: [],
    ui: {
      color,
      colorUpdatedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };
  const boundaryNodes = createDefaultFlowBoundaryNodes(workspaceId, now);

  try {
    await Promise.all([
      writeRecord(PAGE_STORE, { id: workspaceId, content: pageContent }),
      writeRecord(FLOW_STORE, flow),
      ...boundaryNodes.map((node) => writeRecord(NODE_STORE, node)),
    ]);
    close?.();
    await loadFlowLibrary();
    openFlowMap(workspaceId);
  } catch (error) {
    flowLibraryState.error = error?.message || "Creazione Flow Map non riuscita.";
    mountFlowLibrary();
  }
};

const openCreateFlowMapDialog = () => {
  const titleInput = _.input({ class: "tl-flow-library-dialog-input", value: "", placeholder: "Titolo Flow Map" });
  const descriptionInput = _.textarea({ class: "tl-flow-library-dialog-input", rows: 3, placeholder: "Descrizione" });
  const categoryInput = _.input({ class: "tl-flow-library-dialog-input", value: "global", placeholder: "Categoria" });
  const colorInput = _.input({ class: "tl-flow-library-color-input", type: "color", value: defaultFlowColor(`flowmap_${Date.now()}`), "aria-label": "Colore Flow Map" });
  const versionInput = _.input({ class: "tl-flow-library-dialog-input", value: "0.1.0", placeholder: "Versione" });
  const dialog = _.Dialog({
    class: "tl-flow-library-dialog",
    panelClass: "tl-flow-library-dialog-panel",
    size: "md",
    title: "Nuovo Flow Map",
    subtitle: "Crea un Flow Map locale dedicato",
    icon: "account_tree",
    closeButton: true,
    content: () => _.div(
      { class: "tl-flow-library-dialog-form" },
      _.label(_.span("Titolo"), titleInput),
      _.label(_.span("Description"), descriptionInput),
      _.label(_.span("Categoria"), categoryInput),
      _.label({ class: "tl-flow-library-color-field" }, _.span("Colore"), colorInput),
      _.label(_.span("Versione"), versionInput)
    ),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: close }, "Annulla"),
      btn({ class: "st-btn-primary", onclick: () => createFlowMapFromDialog({ close, titleInput, descriptionInput, categoryInput, colorInput, versionInput }) }, icon("add", "sm"), "Crea")
    ),
  });
  dialog.open();
  requestAnimationFrame(() => titleInput.focus?.());
};

let flowLibraryRoot = null;
let flowLibraryEmbedded = false;
const renderTopbar = () =>
  _.header(
    { class: "tl-library-topbar" },
    flowLibraryEmbedded ? null : window.TrackerLensSidebar.renderBrand({ className: "tl-library-brand" }),
    _.Search({
      class: "tl-library-search-input",
      label: "Cerca Flow Map...",
      value: flowLibraryState.query,
      "aria-label": "Cerca Flow Map",
    }),
    _.Toolbar(
      { class: "tl-library-actions", align: "center", gap: 16 },
      btn({ class: "tl-library-menu", onclick: importFlowMapFile }, icon("upload_file", "sm"), "Import"),
      btn({ class: "st-btn-primary", onclick: openCreateFlowMapDialog }, icon("add", "sm"), "Nuovo Flow Map")
    )
  );

const renderPanel = () =>
  _.aside(
    { class: "tl-library-panel", "aria-label": "Filtri Flow Map" },
    _.Row(
      { class: "tl-library-panel-head", align: "center", justify: "space-between", gap: 14 },
      _.h2({ class: "tl-library-title" }, "Flow Map"),
      _.span({ class: "tl-favorites-count" }, String(flowLibraryState.items.length))
    ),
    _.section(
      { class: "tl-category-section" },
      _.h3({ class: "tl-section-label" }, "Categorie"),
      _.Search({
        class: "tl-flow-category-search-input",
        label: "Cerca categoria...",
        value: flowLibraryState.categoryQuery,
        "aria-label": "Cerca categoria Flow Map",
      }),
      _.Grid(
        { cols: 1, gap: 4 },
        ...categoryCounts().map((category) =>
          btn(
            {
              class: `tl-category-btn${flowLibraryState.category === category.name ? " is-active" : ""}`,
              onclick: () => setCategory(category.name),
            },
            _.Row(
              { class: "tl-category-row", align: "center", justify: "space-between", gap: 12 },
              _.span({ class: "tl-category-name" }, category.name),
              _.span({ class: "tl-category-count" }, String(category.count))
            )
          )
        )
      )
    )
  );

const setCategory = (category) => {
  flowLibraryState.category = category;
  mountFlowLibrary();
};

const setSort = (sort) => {
  flowLibraryState.sort = sort;
  mountFlowLibrary();
};

const renderSort = () =>
  _.Select({
    class: "tl-sort-select",
    value: flowLibraryState.sort,
    options: sortOptions,
    slots: selectArrowSlot,
    onChange: (value) => {
      flowLibraryState.sort = value;
      mountFlowLibrary();
    },
  });

const renderToolbar = (items) =>
  _.Toolbar(
    { class: "tl-library-toolbar", align: "center", justify: "space-between", gap: 18 },
    _.Row(
      { class: "tl-result-heading", align: "baseline", gap: 10 },
      _.h2("Flow Map salvati"),
      _.span({ class: "tl-result-count" }, `${items.length} flow`)
    ),
    _.Row(
      { class: "tl-toolbar-actions", align: "center", gap: 12 },
      renderSort(),
      btn({ class: "tl-view-toggle is-active", "aria-label": "Vista griglia" }, icon("grid_view", "sm"))
    )
  );

const renderFlowCard = (item) =>
  _.Card(
    {
      class: "tl-box-card tl-flow-map-card",
      style: flowColorStyle(item.color),
    },
    _.div(
      { class: "tl-flow-card-graph", "aria-hidden": "true" },
      _.span({ class: "is-node is-a" }),
      _.span({ class: "is-node is-b" }),
      _.span({ class: "is-node is-c" }),
      _.span({ class: "is-edge is-ab" }),
      _.span({ class: "is-edge is-bc" })
    ),
    _.div(
      { class: "tl-card-head tl-flow-card-head" },
      _.Row(
        { class: "tl-flow-card-title-row", align: "start", justify: "space-between", gap: 10 },
        _.h3(item.name),
        _.label(
          { class: "tl-flow-color-picker", title: "Colore Flow Map", "aria-label": `Colore ${item.name}` },
          _.span({ class: "tl-flow-color-swatch", "aria-hidden": "true" }),
          _.input({
            type: "color",
            value: item.color,
            "aria-label": `Scegli colore ${item.name}`,
            onchange: (event) => saveFlowMapColor(item, event.target.value, event),
          })
        )
      ),
      _.Grid(
        { class: "tl-flow-card-meta-row", cols: "52px minmax(0, 1fr)", gap: 14, align: "center" },
        _.span({ class: "tl-card-icon is-workspace tl-flow-card-icon" }, icon("account_tree", "md")),
        _.Row(
          { class: "tl-flow-card-badges", align: "center", gap: 8 },
          _.span({ class: "tl-flow-category-badge" }, item.category || "global"),
          _.span({ class: "tl-trust-badge is-verified" }, icon("hub", "xs"), item.status)
        )
      )
    ),
    _.p({ class: "tl-card-description" }, item.description),
    _.Row(
      { class: "tl-flow-metrics", align: "center", gap: 8 },
      _.span({ class: "tl-flow-metric-pill" }, _.span({ class: "tl-flow-metric-icon" }, icon("account_tree", "sm")), _.strong(String(item.nodes)), " nodi"),
      _.span({ class: "tl-flow-metric-pill" }, _.span({ class: "tl-flow-metric-icon" }, icon("link", "sm")), _.strong(String(item.dependencies)), " link")
    ),
    _.Row(
      { class: "tl-card-foot", align: "center", justify: "space-between", gap: 12 },
      _.div(
        _.div({ class: "tl-card-meta" }, item.updatedAt ? `Aggiornato ${new Date(item.updatedAt).toLocaleString()}` : "Nessuna data salvata")
      ),
      _.Row(
        { class: "tl-card-actions", align: "center", justify: "end", gap: 30 },
        btn({ class: "tl-workspace-flow", onclick: () => openFlowMap(item.id) }, icon("open_in_new", "sm"), "Apri"),
        btn({ class: "tl-card-more tl-flow-download", "aria-label": `Export ${item.name}`, title: "Export", onclick: (event) => exportFlowMap(item, event) }, icon("download", "sm")),
        btn({ class: "tl-card-more is-danger", "aria-label": `Elimina ${item.name}`, title: "Elimina", onclick: (event) => deleteFlowMap(item, event) }, icon("delete", "sm"))
      )
    )
  );

const renderStateCard = ({ iconName, title, text, action = null }) =>
  _.div(
    { class: "tl-library-state" },
    _.Card(
      { class: "tl-empty-card" },
      _.div({ class: "tl-empty-icon" }, icon(iconName, "md")),
      _.h2(title),
      _.p(text),
      action
    )
  );

const renderMain = () => {
  const items = visibleFlowMaps();
  return _.section(
    { class: "tl-library-main", "aria-label": "Lista Flow Map salvati" },
    _.div(
      { class: "tl-library-content" },
      renderToolbar(items),
      flowLibraryState.loading
        ? renderStateCard({ iconName: "hourglass_top", title: "Caricamento Flow Map", text: "Lettura dei flow runtime salvati in SQLite." })
        : flowLibraryState.error
          ? renderStateCard({ iconName: "warning", title: "Libreria Flow Map non disponibile", text: flowLibraryState.error, action: btn({ class: "st-btn-primary", onclick: loadFlowLibrary }, icon("refresh", "sm"), "Riprova") })
          : items.length
            ? _.Grid({ class: "tl-library-grid", cols: "repeat(auto-fill, minmax(240px, 1fr))", gap: "28px 18px" }, ...items.map(renderFlowCard))
            : renderStateCard({ iconName: "account_tree", title: "Nessun Flow Map salvato", text: "Crea o importa un Flow Map per iniziare a separarlo dal workspace.", action: btn({ class: "st-btn-primary", onclick: openCreateFlowMapDialog }, icon("add", "sm"), "Nuovo Flow Map") })
    )
  );
};

const bindSearchInput = (root) => {
  const searchInput = root.querySelector(".tl-library-search-input input");
  if (!searchInput) return;
  searchInput.value = flowLibraryState.query;
  if (flowLibraryState.searchFocus) {
    searchInput.focus();
    searchInput.setSelectionRange(flowLibraryState.searchSelectionStart, flowLibraryState.searchSelectionStart);
    flowLibraryState.searchFocus = false;
  }
  searchInput.addEventListener("input", (event) => {
    flowLibraryState.query = event.target.value;
    flowLibraryState.searchFocus = true;
    flowLibraryState.searchSelectionStart = event.target.selectionStart || flowLibraryState.query.length;
    mountFlowLibrary();
  });
};

const bindCategorySearchInput = (root) => {
  const searchInput = root.querySelector(".tl-flow-category-search-input input");
  if (!searchInput) return;
  searchInput.value = flowLibraryState.categoryQuery;
  if (flowLibraryState.categorySearchFocus) {
    searchInput.focus();
    searchInput.setSelectionRange(flowLibraryState.categorySearchSelectionStart, flowLibraryState.categorySearchSelectionStart);
    flowLibraryState.categorySearchFocus = false;
  }
  searchInput.addEventListener("input", (event) => {
    flowLibraryState.categoryQuery = event.target.value;
    flowLibraryState.categorySearchFocus = true;
    flowLibraryState.categorySearchSelectionStart = event.target.selectionStart || flowLibraryState.categoryQuery.length;
    mountFlowLibrary();
  });
};

const mountFlowLibrary = () => {
  const root = flowLibraryRoot || document.getElementById("tl-flow-library-root");
  if (!root) return;
  root.replaceChildren(
    _.div(
      { class: `tl-library-shell tl-flow-library-shell${flowLibraryEmbedded ? " is-embedded" : ""}` },
      renderTopbar(),
      _.div({ class: "tl-library-body" }, flowLibraryEmbedded ? null : window.TrackerLensSidebar.render({ activeId: "flow" }), renderPanel(), renderMain())
    )
  );
  bindSearchInput(root);
  bindCategorySearchInput(root);
};

const loadFlowLibrary = async () => {
  flowLibraryState.loading = true;
  flowLibraryState.error = "";
  mountFlowLibrary();
  try {
    flowLibraryState.items = await loadFlowMapsFromDb();
    flowLibraryState.loading = false;
  } catch (error) {
    console.error(error);
    flowLibraryState.items = [];
    flowLibraryState.loading = false;
    flowLibraryState.error = error?.message || "Errore durante la lettura dei Flow Map.";
  }
  mountFlowLibrary();
};

window.TrackerLensViews = window.TrackerLensViews || {};
window.TrackerLensViews.flowLibrary = {
  async mount({ outlet }) {
    flowLibraryRoot = outlet;
    flowLibraryEmbedded = true;
    window.TrackerLensAppShell?.setActive?.("flow");
    await loadFlowLibrary();
  },
  dispose() {
    flowLibraryRoot?.replaceChildren();
    flowLibraryRoot = null;
    flowLibraryEmbedded = false;
  },
};

if (!window.TrackerLensAppRouter) CMSwift.ready(loadFlowLibrary);
})();
