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

const DB_NAME = (typeof tlConfig !== "undefined" ? tlConfig.DB_NAME : null) || "TrackersLens";
const PAGE_STORE = (typeof tlConfig !== "undefined" ? tlConfig.TABLES?.TL_PAGES : null) || "tl_pages";
const FLOW_STORE = (typeof tlConfig !== "undefined" ? tlConfig.TABLES?.TL_FLOWS : null) || "tl_flows";
const NODE_STORE = (typeof tlConfig !== "undefined" ? tlConfig.TABLES?.TL_RUNTIME_NODES : null) || "tl_runtime_nodes";
const DEPENDENCY_STORE = (typeof tlConfig !== "undefined" ? tlConfig.TABLES?.TL_RUNTIME_DEPENDENCIES : null) || "tl_runtime_dependencies";
const CHANNEL_STORE = (typeof tlConfig !== "undefined" ? tlConfig.TABLES?.TL_CHANNELS : null) || "tl_channels";
const EVENT_STORE = (typeof tlConfig !== "undefined" ? tlConfig.TABLES?.TL_EVENTS : null) || "tl_events";
const FLOW_LOG_STORE = (typeof tlConfig !== "undefined" ? tlConfig.TABLES?.TL_FLOW_LOGS : null) || "tl_flow_logs";
const CONNECTION_STORE = (typeof tlConfig !== "undefined" ? tlConfig.TABLES?.TL_CONNECTIONS : null) || "tl_connections";

const normalizeText = (value, fallback = "") => value === null || value === undefined ? fallback : String(value).trim() || fallback;
const openChromePage = (url) => window.location.assign(url);
const openFlowMap = (workspaceId) => openChromePage(`flowMap.html?workspaceId=${encodeURIComponent(workspaceId)}`);

const openDb = () =>
  new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB non disponibile"));
      return;
    }
    const request = indexedDB.open(DB_NAME);
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error || new Error("Errore apertura IndexedDB"));
  });

const readAll = async (storeName) => {
  const db = await openDb();
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

const deleteRecord = async (storeName, id) => {
  if (!storeName || !id) return null;
  const db = await openDb();
  try {
    if (!db.objectStoreNames.contains(storeName)) return null;
    return await new Promise((resolve, reject) => {
      const request = db.transaction(storeName, "readwrite").objectStore(storeName).delete(id);
      request.onsuccess = () => resolve(id);
      request.onerror = (event) => reject(event.target.error || new Error(`Errore eliminazione ${storeName}`));
    });
  } finally {
    db.close();
  }
};

const deleteScopedRecords = async (storeName, workspaceId = "") => {
  if (!storeName || !workspaceId) return [];
  const db = await openDb();
  try {
    if (!db.objectStoreNames.contains(storeName)) return [];
    const records = await new Promise((resolve, reject) => {
      const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
      request.onsuccess = (event) => resolve(Array.from(event.target.result || []));
      request.onerror = (event) => reject(event.target.error || new Error(`Errore lettura ${storeName}`));
    });
    const ids = records
      .filter((record) => record?.workspaceId === workspaceId || record?.id === workspaceId)
      .map((record) => record.id)
      .filter(Boolean);
    if (!ids.length) return [];
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      ids.forEach((id) => store.delete(id));
      transaction.oncomplete = () => resolve(ids);
      transaction.onerror = (event) => reject(event.target.error || new Error(`Errore eliminazione ${storeName}`));
    });
    return ids;
  } finally {
    db.close();
  }
};

const contentOf = (record) => record?.content && typeof record.content === "object" ? record.content : record || {};

const loadFlowMapsFromDb = async () => {
  const [pages, flows, nodes, dependencies] = await Promise.all([
    readAll(PAGE_STORE),
    readAll(FLOW_STORE),
    readAll(NODE_STORE),
    readAll(DEPENDENCY_STORE),
  ]);
  const pageById = new Map(pages.map((record) => [normalizeText(record.id || contentOf(record).id), contentOf(record)]));
  const workspaceIds = new Set([
    ...pages.map((record) => normalizeText(record.id || contentOf(record).id)).filter(Boolean),
    ...flows.map((flow) => normalizeText(flow.workspaceId || flow.id)).filter(Boolean),
    ...nodes.map((node) => normalizeText(node.workspaceId)).filter(Boolean),
  ]);

  return Array.from(workspaceIds).map((workspaceId) => {
    const page = pageById.get(workspaceId) || {};
    const flow = flows.find((item) => item.workspaceId === workspaceId || item.id === workspaceId) || {};
    const scopedNodes = nodes.filter((node) => node.workspaceId === workspaceId);
    const scopedDependencies = dependencies.filter((dependency) => dependency.workspaceId === workspaceId);
    const name = normalizeText(flow.name || page.name || page.title, workspaceId);
    const category = normalizeText(flow.category || page.category, "global");
    const updatedAt = normalizeText(page.updatedAt || page.savedAt || flow.updatedAt || page.createdAt || flow.createdAt);
    const description = normalizeText(page.description, `${scopedNodes.length} nodi runtime · ${scopedDependencies.length} collegamenti`);
    return {
      id: workspaceId,
      name,
      category,
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
      const result = await window.TrackerLensPortableRuntime.importFile(file, { onConflict: "overwrite", includeRuntimeGraph: true });
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

const renderTopbar = () =>
  _.header(
    { class: "tl-library-topbar" },
    window.TrackerLensSidebar.renderBrand({ className: "tl-library-brand" }),
    _.Search({
      class: "tl-library-search-input",
      label: "Cerca Flow Map...",
      value: flowLibraryState.query,
      "aria-label": "Cerca Flow Map",
    }),
    _.Toolbar(
      { class: "tl-library-actions", align: "center", gap: 16 },
      btn({ class: "tl-library-menu", onclick: importFlowMapFile }, icon("upload_file", "sm"), "Import"),
      btn({ class: "tl-library-create", onclick: () => openFlowMap("workspace_global") }, icon("add", "sm"), "Nuovo Flow Map")
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
      class: "tl-box-card",
    },
    _.Grid(
      { class: "tl-card-head", cols: "52px minmax(0, 1fr)", gap: 14, align: "center" },
      _.span({ class: "tl-card-icon is-workspace" }, icon("account_tree", "md")),
      _.div(
        { class: "tl-card-title" },
        _.h3(item.name),
        _.div({ class: "tl-card-type" }, item.category || "global"),
        _.span({ class: "tl-trust-badge is-verified" }, icon("hub", "xs"), item.status)
      )
    ),
    _.p({ class: "tl-card-description" }, item.description),
    _.Row(
      { class: "tl-card-foot", align: "center", justify: "space-between", gap: 12 },
      _.div(
        _.div({ class: "tl-card-category is-workspace" }, `${item.nodes} nodi · ${item.dependencies} link`),
        _.div({ class: "tl-card-meta" }, item.updatedAt ? `Aggiornato ${new Date(item.updatedAt).toLocaleString()}` : "Nessuna data salvata")
      ),
      _.Row(
        { class: "tl-card-actions", align: "center", justify: "end", gap: 30 },
        btn({ class: "tl-workspace-flow", onclick: () => openFlowMap(item.id) }, icon("open_in_new", "sm"), "Apri"),
        btn({ class: "tl-card-more", "aria-label": `Export ${item.name}`, title: "Export", onclick: (event) => exportFlowMap(item, event) }, icon("download", "sm")),
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
        ? renderStateCard({ iconName: "hourglass_top", title: "Caricamento Flow Map", text: "Lettura dei flow runtime salvati in IndexedDB." })
        : flowLibraryState.error
          ? renderStateCard({ iconName: "warning", title: "Libreria Flow Map non disponibile", text: flowLibraryState.error, action: btn({ class: "tl-empty-action", onclick: loadFlowLibrary }, icon("refresh", "sm"), "Riprova") })
          : items.length
            ? _.Grid({ class: "tl-library-grid", cols: "repeat(auto-fill, minmax(240px, 1fr))", gap: "28px 18px" }, ...items.map(renderFlowCard))
            : renderStateCard({ iconName: "account_tree", title: "Nessun Flow Map salvato", text: "Crea o importa un Flow Map per iniziare a separarlo dal workspace.", action: btn({ class: "tl-empty-action", onclick: () => openFlowMap("workspace_global") }, icon("add", "sm"), "Nuovo Flow Map") })
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
  const root = document.getElementById("tl-flow-library-root");
  root.replaceChildren(
    _.div(
      { class: "tl-library-shell" },
      renderTopbar(),
      _.div({ class: "tl-library-body" }, window.TrackerLensSidebar.render({ activeId: "flow" }), renderPanel(), renderMain())
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

CMSwift.ready(loadFlowLibrary);
