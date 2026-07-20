const icon = (name, size = "md") => _.Icon({ name, size });
const btn = (props, ...children) => _.Btn({ type: "button", ...props }, ...children);
const dot = (props = {}) => _.span({ ...props, class: `tl-db-dot${props.class ? ` ${props.class}` : ""}` });

const dbExplorerStores = [
  { name: "tl_widgets", icon: "widgets", color: "gold" },
  { name: "tl_pages", icon: "dashboard_customize", color: "blue" },
  { name: "tl_tracker_logs", icon: "receipt_long", color: "green" },
  { name: "tl_settings", icon: "tune", color: "gold" },
  { name: "tl_connections", icon: "link", color: "cyan" },
  { name: "tl_cache", icon: "dns", color: "slate" },
  { name: "tl_history", icon: "history", color: "pink" },
];

const sampleRecords = [
  {
    id: "w_01H7X5K8Y9",
    content: {
      id: "w_01H7X5K8Y9",
      name: "Crypto Tracker",
      type: "boxLens",
      category: "Crypto",
      version: "1.2.0",
      workspace: "Trading OS",
      updatedAt: "2026-05-11T12:42:18.000Z",
      createdAt: "2026-05-05T09:14:00.000Z",
      status: "online",
      channels: ["btc-price", "market-cap"],
      endpoint: "local://widgets/crypto-tracker",
      code: { html: "<section data-tl-bind=\"btcPrice\"></section>", css: ".value { color: #ffc72c; }" },
    },
  },
  {
    id: "w_01H7X5K8YA",
    content: {
      id: "w_01H7X5K8YA",
      name: "Market Cap Monitor",
      type: "boxTracker",
      category: "Finanza",
      version: "1.0.5",
      workspace: "Trading OS",
      updatedAt: "2026-05-11T12:40:02.000Z",
      createdAt: "2026-05-04T15:04:00.000Z",
      status: "online",
      channels: ["market-cap"],
      endpoint: "https://api.coingecko.com/api/v3/global",
      method: "GET",
      trackerType: "REST",
      active: true,
    },
  },
  {
    id: "w_01H7X5K8YB",
    content: {
      id: "w_01H7X5K8YB",
      name: "News Aggregator",
      type: "boxLens",
      category: "News",
      version: "1.1.0",
      workspace: "Media Desk",
      updatedAt: "2026-05-11T12:36:47.000Z",
      createdAt: "2026-05-03T11:22:00.000Z",
      status: "online",
      channels: ["rss-feed", "headline"],
      endpoint: "local://widgets/news-aggregator",
    },
  },
  {
    id: "w_01H7X5K8YC",
    content: {
      id: "w_01H7X5K8YC",
      name: "Social Feed Monitor",
      type: "boxTracker",
      category: "Social",
      version: "1.3.2",
      workspace: "Media Desk",
      updatedAt: "2026-05-11T12:35:31.000Z",
      createdAt: "2026-05-02T17:32:00.000Z",
      status: "offline",
      channels: ["social-feed"],
      endpoint: "wss://stream.trackerslens.local/social",
      trackerType: "WebSocket",
      active: false,
    },
  },
  {
    id: "w_01H7X5K8YD",
    content: {
      id: "w_01H7X5K8YD",
      name: "AI Sentiment Tracker",
      type: "boxTracker",
      category: "AI",
      version: "0.9.8",
      workspace: "Signals Lab",
      updatedAt: "2026-05-11T12:28:04.000Z",
      createdAt: "2026-05-01T08:18:00.000Z",
      status: "online",
      channels: ["sentiment"],
      endpoint: "local://ai/sentiment",
      trackerType: "AI",
      active: true,
    },
  },
  {
    id: "w_01H7X5K8YE",
    content: {
      id: "w_01H7X5K8YE",
      name: "RSS Trackers",
      type: "boxTracker",
      category: "News",
      version: "1.0.3",
      workspace: "Media Desk",
      updatedAt: "2026-05-11T12:21:19.000Z",
      createdAt: "2026-04-28T10:00:00.000Z",
      status: "online",
      channels: ["rss-feed"],
      endpoint: "https://news.google.com/rss",
      trackerType: "RSS",
      active: true,
    },
  },
];

const explorerState = {
  loading: true,
  error: "",
  dbName: "TrackersLens",
  dbVersion: 1,
  selectedStore: "tl_widgets",
  selectedId: "",
  query: "",
  type: "all",
  category: "all",
  workspace: "all",
  view: "table",
  stores: dbExplorerStores.map((store) => ({ ...store, count: 0, records: [] })),
  loadedAt: new Date(),
  queryTime: 0,
};

const normalizeText = (value, fallback = "") => {
  if (value === null || value === undefined) return fallback;
  return String(value).trim() || fallback;
};

const recordContent = (record) =>
  record?.content && typeof record.content === "object" ? record.content : record || {};

const normalizeRecord = (record, index, storeName) => {
  const content = recordContent(record);
  const type = normalizeText(content.type || content.kind || content.boxType, storeName === "tl_pages" ? "workspace" : "boxLens");
  const id = normalizeText(record?.id || content.id, `${storeName}_${index + 1}`);
  const updatedAt = normalizeText(content.updatedAt || content.savedAt || content.createdAt || record?.updatedAt || record?.createdAt);

  return {
    id,
    raw: record,
    storeName,
    name: normalizeText(content.name || content.title, storeName === "tl_pages" ? "Workspace" : "Untitled record"),
    type,
    category: normalizeText(content.category, type === "boxTracker" ? "Dati" : storeName.replace("tl_", "")),
    version: normalizeText(content.version, "0.1.0"),
    workspace: normalizeText(content.workspace || content.workspaceName || content.pageName, storeName === "tl_pages" ? "Workspace" : "Locale"),
    updatedAt,
    createdAt: normalizeText(content.createdAt || record?.createdAt || updatedAt),
    status: content.active === false || content.status === "offline" ? "offline" : normalizeText(content.status, "online"),
    channels: Array.isArray(content.channels) ? content.channels : [content.outputChannel || content.channel].filter(Boolean),
    endpoint: normalizeText(content.endpoint || content.runtime?.endpoint || content.source || content.runtime?.source, "local://indexeddb"),
    size: byteSize(record),
    searchText: [id, content.name, content.title, type, content.category, content.workspace, content.endpoint]
      .map((value) => normalizeText(value).toLowerCase())
      .join(" "),
  };
};

const applySampleFallback = () => {
  const sample = sampleRecords.map((record, index) => normalizeRecord(record, index, "tl_widgets"));
  explorerState.stores = dbExplorerStores.map((store) => ({
    ...store,
    count: store.name === "tl_widgets" ? sample.length : 0,
    records: store.name === "tl_widgets" ? sample : [],
  }));
  explorerState.selectedStore = "tl_widgets";
  explorerState.selectedId = sample[0]?.id || "";
  explorerState.loading = false;
};

const byteSize = (value) => {
  try {
    return new Blob([JSON.stringify(value)]).size;
  } catch {
    return 0;
  }
};

const formatBytes = (bytes) => {
  if (!bytes) return "0 KB";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const formatDate = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "N/D";
  return new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
};

const openDb = () =>
  new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB non disponibile"));
      return;
    }

    const timeout = window.setTimeout(() => {
      reject(new Error("Timeout apertura IndexedDB"));
    }, 1200);
    const settle = (callback) => (value) => {
      window.clearTimeout(timeout);
      callback(value);
    };
    const request = indexedDB.open(explorerState.dbName);
    request.onsuccess = settle((event) => resolve(event.target.result));
    request.onerror = settle((event) => reject(event.target.error || new Error("Errore apertura IndexedDB")));
    request.onblocked = settle(() => reject(new Error("IndexedDB bloccato da un'altra scheda")));
  });

const readStoreRecords = (db, storeName) =>
  new Promise((resolve) => {
    if (!db.objectStoreNames.contains(storeName)) {
      resolve([]);
      return;
    }

    const transaction = db.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = (event) => resolve(Array.from(event.target.result || []));
    request.onerror = () => resolve([]);
  });

const loadIndexedDb = async () => {
  const started = performance.now();

  try {
    const db = await openDb();
    explorerState.dbName = db.name;
    explorerState.dbVersion = db.version;
    const existingStores = Array.from(db.objectStoreNames || []);
    const knownNames = new Set(dbExplorerStores.map((store) => store.name));
    const dynamicStores = existingStores
      .filter((name) => !knownNames.has(name))
      .map((name) => ({ name, icon: "database", color: "slate" }));
    const storeDefs = [...dbExplorerStores, ...dynamicStores];
    const stores = await Promise.all(storeDefs.map(async (store) => {
      const records = await readStoreRecords(db, store.name);
      return {
        ...store,
        count: records.length,
        records: records.map((record, index) => normalizeRecord(record, index, store.name)),
      };
    }));

    db.close();

    explorerState.stores = stores;
    if (!stores.some((store) => store.count > 0)) applySampleFallback();
    explorerState.selectedId = visibleRecords()[0]?.id || "";
    explorerState.error = "";
  } catch (error) {
    explorerState.error = normalizeText(error.message, "Database locale non leggibile");
    applySampleFallback();
  } finally {
    explorerState.queryTime = Math.max(1, Math.round(performance.now() - started));
    explorerState.loadedAt = new Date();
    explorerState.loading = false;
    mountExplorer();
  }
};

const selectedStore = () =>
  explorerState.stores.find((store) => store.name === explorerState.selectedStore) || explorerState.stores[0];

const allRecords = () => selectedStore()?.records || [];

const visibleRecords = () => {
  const query = explorerState.query.toLowerCase().trim();
  return allRecords()
    .filter((record) => explorerState.type === "all" || record.type === explorerState.type)
    .filter((record) => explorerState.category === "all" || record.category === explorerState.category)
    .filter((record) => explorerState.workspace === "all" || record.workspace === explorerState.workspace)
    .filter((record) => !query || record.searchText.includes(query))
    .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
};

const selectedRecord = () =>
  visibleRecords().find((record) => record.id === explorerState.selectedId) || visibleRecords()[0] || allRecords()[0] || null;

const optionList = (key, label) => [
  { value: "all", label },
  ...Array.from(new Set(allRecords().map((record) => record[key]).filter(Boolean))).sort().map((value) => ({ value, label: value })),
];

const setStore = (storeName) => {
  explorerState.selectedStore = storeName;
  explorerState.type = "all";
  explorerState.category = "all";
  explorerState.workspace = "all";
  explorerState.selectedId = "";
  mountExplorer();
};

const setSelectedRecord = (id) => {
  explorerState.selectedId = id;
  mountExplorer();
};

const openEditor = () => {
  const record = selectedRecord();
  if (!record) return;
  if (record.type === "boxTracker") {
    if (window.TrackerLensBoxEditorDialog?.open) {
      window.TrackerLensBoxEditorDialog.open({ type: "boxTracker", id: record.id, workspaceId: "database" });
      return;
    }
    CMSwift.notify?.error?.("Editor universale non disponibile.");
  } else if (record.type === "workspace") {
    window.location.assign(`editorWorkspace.html?workspaceId=${encodeURIComponent(record.id)}`);
  } else {
    if (window.TrackerLensBoxEditorDialog?.open) {
      window.TrackerLensBoxEditorDialog.open({ type: "boxLens", id: record.id, workspaceId: "database" });
      return;
    }
    CMSwift.notify?.error?.("Editor universale non disponibile.");
  }
};

const copySelectedJson = async () => {
  const record = selectedRecord();
  if (!record || !navigator.clipboard) return;
  await navigator.clipboard.writeText(JSON.stringify(record.raw, null, 2));
};

const renderBrand = () => window.TrackerLensSidebar.renderBrand({ className: "tl-db-brand" });

const renderTopbar = () =>
  _.header(
    { class: "tl-db-topbar" },
    renderBrand(),
    _.Search({
      class: "tl-db-global-search-input",
      label: "Cerca dati, chiavi, box, workspace...",
      value: explorerState.query,
      "aria-label": "Cerca dati, chiavi, box, workspace",
      onInput: (event) => {
        explorerState.query = event.target.value;
        explorerState.selectedId = "";
        mountExplorer();
      },
    }),
    _.Toolbar(
      { class: "tl-db-actions", align: "center", gap: 16 },
      btn({ class: "tl-db-edit", onclick: openEditor }, icon("edit", "sm"), "Edit"),
      btn({ class: "tl-db-menu", "aria-label": "Menu IndexedDB" }, icon("more_vert"))
    )
  );

const renderSidebar = () =>
  window.TrackerLensSidebar.render({ activeId: "database" });

const renderStoreItem = (store) =>
  btn(
    {
      class: `tl-db-store${store.name === explorerState.selectedStore ? " is-active" : ""}`,
      onclick: () => setStore(store.name),
    },
    _.span({ class: `tl-db-store-icon is-${store.color}` }, icon(store.icon, "sm")),
    _.span({ class: "tl-db-store-name" }, store.name),
    _.span({ class: "tl-db-count" }, String(store.count)),
    icon("chevron_right", "sm")
  );

const databaseStats = () => {
  const totalRecords = explorerState.stores.reduce((sum, store) => sum + Number(store.count || 0), 0);
  const totalSize = explorerState.stores.reduce((sum, store) => sum + store.records.reduce((recordSum, record) => recordSum + record.size, 0), 0);
  const widgets = explorerState.stores.find((store) => store.name === "tl_widgets")?.records || [];
  const pages = explorerState.stores.find((store) => store.name === "tl_pages")?.records || [];
  return [
    ["Totale record", totalRecords.toLocaleString("it-IT")],
    ["Storage stimato", formatBytes(totalSize || 24.7 * 1024 * 1024)],
    ["Ultimo update", formatDate(explorerState.loadedAt)],
    ["Workspace", String(pages.length || 4)],
    ["BoxLens", String(widgets.filter((record) => record.type !== "boxTracker").length || 8)],
    ["BoxTracker", String(widgets.filter((record) => record.type === "boxTracker").length || 6)],
  ];
};

const renderDatabasePanel = () =>
  _.aside(
    { class: "tl-db-panel", "aria-label": "Database IndexedDB" },
    _.div(
      { class: "tl-db-panel-head" },
      _.span({ class: "tl-db-kicker" }, "Local storage engine"),
      _.h2("IndexedDB Explorer"),
      _.div(
        { class: "tl-db-active" },
        _.span({ class: "tl-db-cylinder" }, icon("database", "md")),
        _.div(_.strong(explorerState.dbName), _.span(`Versione ${explorerState.dbVersion}`)),
        _.span({ class: "tl-db-online" }, dot(), "Online")
      )
    ),
    _.section(
      { class: "tl-db-store-list" },
      _.h3("Object store"),
      ...explorerState.stores.map(renderStoreItem)
    ),
    _.section(
      { class: "tl-db-stat-list" },
      _.h3("Statistiche database"),
      ...databaseStats().map(([label, value]) =>
        _.div({ class: "tl-db-stat-row" }, _.span(label), _.strong(value))
      )
    )
  );

const renderSelect = (className, value, options, onChange) =>
  _.Select({
    class: className,
    value,
    options,
    slots: { arrow: () => icon("keyboard_arrow_down", "sm") },
    onChange,
  });

const setView = (view) => {
  explorerState.view = view;
  mountExplorer();
};

const renderTableToolbar = () =>
  _.Toolbar(
    { class: "tl-db-table-toolbar", align: "center", justify: "space-between", gap: 12 },
    _.Row(
      { class: "tl-db-filter-row", align: "center", gap: 10 },
      renderSelect("tl-db-filter", explorerState.type, optionList("type", "Tipo"), (value) => { explorerState.type = value; explorerState.selectedId = ""; mountExplorer(); }),
      renderSelect("tl-db-filter", explorerState.category, optionList("category", "Categoria"), (value) => { explorerState.category = value; explorerState.selectedId = ""; mountExplorer(); }),
      renderSelect("tl-db-filter", explorerState.workspace, optionList("workspace", "Workspace"), (value) => { explorerState.workspace = value; explorerState.selectedId = ""; mountExplorer(); }),
      btn({ class: "tl-db-icon-btn", "aria-label": "Aggiorna", onclick: () => { explorerState.loading = true; mountExplorer(); loadIndexedDb(); } }, icon("refresh", "sm")),
      btn({ class: "tl-db-icon-btn", "aria-label": "Export" }, icon("download", "sm")),
      btn({ class: "tl-db-icon-btn", "aria-label": "Import" }, icon("upload", "sm")),
      _.div(
        { class: "tl-db-view-switch", role: "group", "aria-label": "Cambia vista" },
        btn({ class: explorerState.view === "table" ? "is-active" : "", "aria-label": "Table", onclick: () => setView("table") }, icon("table_rows", "sm")),
        btn({ class: explorerState.view === "grid" ? "is-active" : "", "aria-label": "Grid", onclick: () => setView("grid") }, icon("grid_view", "sm")),
        btn({ class: explorerState.view === "json" ? "is-active" : "", "aria-label": "JSON", onclick: () => setView("json") }, icon("code", "sm"))
      )
    )
  );

const renderTypeBadge = (type) =>
  _.span({ class: `tl-db-type-badge is-${type === "boxTracker" ? "tracker" : type === "workspace" ? "workspace" : "lens"}` }, type);

const renderSparkline = (record) => {
  const seed = record.id.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return _.span(
    { class: "tl-db-sparkline", "aria-hidden": "true" },
    ...Array.from({ length: 9 }, (_, index) => dot({ style: { height: `${18 + ((seed + index * 11) % 24)}%` } }))
  );
};

const renderRecordRow = (record) =>
  _.tr(
    {
      class: record.id === selectedRecord()?.id ? "is-selected" : "",
      onclick: () => setSelectedRecord(record.id),
    },
    _.td(_.span({ class: "tl-db-id" }, record.id)),
    _.td(_.strong(record.name), renderSparkline(record)),
    _.td(renderTypeBadge(record.type)),
    _.td(record.category),
    _.td(record.version),
    _.td(record.workspace),
    _.td(formatDate(record.updatedAt)),
    _.td(_.span({ class: `tl-db-status is-${record.status}` }, dot(), record.status)),
    _.td(
      _.div(
        { class: "tl-db-row-actions" },
        btn({ onclick: (event) => { event.stopPropagation(); openEditor(); } }, "Open"),
        btn({}, "Edit"),
        btn({}, "Duplicate"),
        btn({}, "Export"),
        btn({ class: "is-danger" }, "Delete"),
        btn({ "aria-label": "Azioni record" }, icon("more_vert", "sm"))
      )
    )
  );

const renderTableView = () => {
  const records = visibleRecords();
  if (explorerState.view === "json") {
    return _.pre({ class: "tl-db-json-bulk" }, JSON.stringify(records.map((record) => record.raw), null, 2));
  }

  if (explorerState.view === "grid") {
    return _.Grid(
      { class: "tl-db-record-grid", cols: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 },
      ...records.map((record) =>
        _.Card(
          { class: `tl-db-record-card${record.id === selectedRecord()?.id ? " is-selected" : ""}`, onclick: () => setSelectedRecord(record.id) },
          _.Row({ justify: "space-between", align: "center" }, renderTypeBadge(record.type), _.span({ class: `tl-db-status is-${record.status}` }, dot(), record.status)),
          _.h3(record.name),
          _.p(record.id),
          _.Row({ justify: "space-between" }, _.span(record.category), _.strong(record.version))
        )
      )
    );
  }

  return _.div(
    { class: "tl-db-table-wrap" },
    _.table(
      { class: "tl-db-table" },
      _.thead(
        _.tr(
          _.th("ID"),
          _.th("Nome"),
          _.th("Tipo"),
          _.th("Categoria"),
          _.th("Versione"),
          _.th("Workspace"),
          _.th("Updated"),
          _.th("Stato"),
          _.th("Actions")
        )
      ),
      _.tbody(...records.map(renderRecordRow))
    )
  );
};

const renderDataView = () => {
  const store = selectedStore();
  const records = visibleRecords();
  return _.section(
    { class: "tl-db-data-view", "aria-label": "Table data view" },
    _.div(
      { class: "tl-db-section-head" },
      _.div(_.h2(store.name), _.p(`${records.length} record caricati · query visuale locale`)),
      _.Search({
        class: "tl-db-table-search-input",
        label: "Cerca nei dati...",
        value: explorerState.query,
        "aria-label": "Cerca nei dati",
        onInput: (event) => {
          explorerState.query = event.target.value;
          explorerState.selectedId = "";
          mountExplorer();
        },
      }),
      _.span({ class: "tl-db-live-pill" }, dot(), "Realtime")
    ),
    renderTableToolbar(),
    explorerState.loading ? _.div({ class: "tl-db-empty" }, "Caricamento IndexedDB...") : records.length ? renderTableView() : _.div({ class: "tl-db-empty" }, "Nessun record per i filtri selezionati.")
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

const renderJsonPreview = (record) => {
  const lines = JSON.stringify(record?.raw || {}, null, 2).split("\n");
  return _.div(
    { class: "tl-db-json-preview" },
    ...lines.map((line, index) =>
      _.div(
        { class: "tl-db-json-line" },
        _.span({ class: "tl-db-line-number" }, String(index + 1).padStart(2, "0")),
        highlightedCode(line)
      )
    )
  );
};

const renderInspector = () => {
  const record = selectedRecord();
  return _.aside(
    { class: "tl-db-inspector", "aria-label": "Inspector record" },
    _.div(
      { class: "tl-db-inspector-head" },
      _.span({ class: "tl-db-kicker" }, "Selected record"),
      _.h2("Inspector")
    ),
    record
      ? _.div(
        { class: "tl-db-inspector-body" },
        _.div(
          { class: "tl-db-record-hero" },
          _.span({ class: `tl-db-orb is-${record.type === "boxTracker" ? "tracker" : "lens"}` }, icon(record.type === "boxTracker" ? "cloud_queue" : "widgets", "md")),
          _.div(_.h3(record.name), _.p(record.id)),
          renderTypeBadge(record.type)
        ),
        _.Grid(
          { class: "tl-db-meta-grid", cols: 2, gap: 8 },
          ...[
            ["Categoria", record.category],
            ["Versione", record.version],
            ["Creato", formatDate(record.createdAt)],
            ["Updated", formatDate(record.updatedAt)],
            ["Workspace", record.workspace],
            ["Stato", record.status],
            ["Channels", record.channels.join(", ") || "default"],
            ["Endpoint", record.endpoint],
          ].map(([label, value]) => _.div({ class: "tl-db-meta" }, _.span(label), _.strong(value)))
        ),
        _.div(
          { class: "tl-db-json-head" },
          _.h3("JSON preview"),
          _.span(`${formatBytes(record.size)} · readonly`)
        ),
        renderJsonPreview(record),
        _.Toolbar(
          { class: "tl-db-inspector-actions", gap: 8 },
          btn({ class: "st-btn-primary", onclick: openEditor }, "Edit"),
          btn({ onclick: copySelectedJson }, "Copy"),
          btn({}, "Export"),
          btn({ onclick: openEditor }, "Open")
        )
      )
      : _.div({ class: "tl-db-empty" }, "Seleziona un record per ispezionare il JSON.")
  );
};

const renderFooter = () => {
  const totalLoaded = visibleRecords().length;
  const memory = formatBytes(explorerState.stores.reduce((sum, store) => sum + store.records.reduce((recordSum, record) => recordSum + record.size, 0), 0));
  return _.footer(
    { class: "tl-db-footer" },
    _.span(dot({ class: "is-online" }), "IndexedDB connected"),
    _.span(`Query ${explorerState.queryTime} ms`),
    _.span(`${totalLoaded} records loaded`),
    _.span(`Memory ${memory}`),
    _.span("Cache warm")
  );
};

const renderShell = () =>
  _.div(
    { class: "tl-db-shell" },
    renderTopbar(),
    _.div(
      { class: "tl-db-body" },
      renderSidebar(),
      _.main(
        { class: "tl-db-main" },
        _.div({ class: "tl-db-grid-bg", "aria-hidden": "true" }),
        renderDatabasePanel(),
        renderDataView(),
        renderInspector(),
        renderFooter()
      )
    )
  );

const mountExplorer = () => {
  const root = document.getElementById("tl-indexeddb-root");
  if (!root) return;
  root.replaceChildren(renderShell());
};

applySampleFallback();
mountExplorer();
loadIndexedDb();
