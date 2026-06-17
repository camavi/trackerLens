const popupData = window.TrackerLensPopupData;

const openChromePage = (url) => {
  if (window.chrome?.tabs?.create) {
    chrome.tabs.create({ url });
    return;
  }

  window.open(url, "_blank", "noopener");
};

const icon = (name, size = "md") => _.Icon({ name, size });

const cmsButton = (props, ...children) => _.Btn({ type: "button", ...props }, ...children);

const renderHeader = () =>
  _.header(
    { class: "tl-popup-header" },
    _.div(
      { class: "tl-brand" },
      _.span({ class: "tl-brand-mark", "aria-hidden": "true" }),
      _.div(
        _.h1({ class: "tl-brand-title" }, "TRACKERS ", _.span("LENS")),
        _.p({ class: "tl-brand-subtitle" }, "Your personal tracking workspace")
      )
    ),
    _.nav(
      { class: "tl-quick-access", "aria-label": "Accesso rapido" },
      cmsButton({ class: "tl-icon-btn", "aria-label": "Ricerca", title: "Ricerca" }, icon("search")),
      cmsButton({ class: "tl-icon-btn", "aria-label": "Libreria", title: "Libreria" }, icon("menu_book")),
      cmsButton({ class: "tl-icon-btn", "aria-label": "Impostazioni", title: "Impostazioni" }, icon("settings")),
      cmsButton(
        {
          class: "tl-user-btn",
          "aria-label": "Profilo utente",
          title: "Profilo utente",
          onclick: () => openChromePage("profile.html"),
        },
        "TL"
      )
    )
  );

const renderSparkline = () =>
  _.div(
    { class: "tl-sparkline", "aria-hidden": "true" },
    ...[16, 20, 18, 24, 22, 27, 21, 30, 35, 29, 25, 33, 28, 38, 45].map((height) =>
      _.span({ style: { height: `${height}px` } })
    )
  );

const renderChart = () =>
  _.div(
    { class: "tl-chart-line", "aria-hidden": "true" },
    ...[-2, 8, -10, -4, 12, -8, 6, -6, 10, -3, 9, -11, 4, -5].map((offset) =>
      _.span({ style: { "--y": `${offset}px` } })
    )
  );

const renderMiniCards = () => {
  const cards = [
    _.Card(
      { class: "tl-mini-card" },
      _.div({ class: "tl-mini-title" }, "BTC / USDT"),
      _.div({ class: "tl-mini-note" }, "Binance"),
      _.div({ class: "tl-price" }, "63,245.67"),
      _.div({ class: "tl-positive" }, "+1,234.56 (2.00%)"),
      renderSparkline()
    ),
    _.Card(
      { class: "tl-mini-card" },
      _.div({ class: "tl-mini-title" }, "RSI (14)"),
      _.div({ class: "tl-rsi-value" }, "62.14"),
      renderChart()
    ),
    _.Card(
      { class: "tl-mini-card" },
      _.div({ class: "tl-mini-title" }, "News RSS"),
      _.ul(
        { class: "tl-news-list" },
        _.li(_.span("Bitcoin ETF inflows"), _.span({ class: "tl-mini-time" }, "2m ago")),
        _.li(_.span("BTC breaks 63K"), _.span({ class: "tl-mini-time" }, "15m ago")),
        _.li(_.span("Ethereum update"), _.span({ class: "tl-mini-time" }, "32m ago"))
      ),
      _.div({ class: "tl-positive" }, "View all")
    ),
    _.Card(
      { class: "tl-mini-card" },
      _.div({ class: "tl-mini-title" }, "YouTube - BTC"),
      _.div({ class: "tl-video-thumb" }, _.span({ class: "tl-play" }, icon("play_arrow", "sm"))),
      _.div({ class: "tl-mini-title" }, "Bitcoin Next Move?"),
      _.div({ class: "tl-mini-note" }, "Analisi e Previsioni")
    ),
    _.Card(
      { class: "tl-mini-card" },
      _.div({ class: "tl-mini-title" }, "WebSocket Tracker", _.span({ class: "tl-signal" }, icon("wifi", "sm"))),
      _.p({ class: "tl-mini-note" }, "Status: ", _.span({ class: "tl-positive" }, "Connected")),
      _.p({ class: "tl-mini-note" }, "Channel: !btcusdt@ticker"),
      _.p({ class: "tl-mini-note" }, "Last update: 10:15:30")
    ),
    _.Card(
      { class: "tl-mini-card" },
      _.div({ class: "tl-mini-title" }, "AI Analysis"),
      _.p({ class: "tl-analysis-text" }, "Il trend e rialzista nel breve termine. RSI in zona neutrale. Resistenza a 64K."),
      _.div({ class: "tl-mini-time" }, "10:15")
    ),
  ];

  return _.div({ class: "tl-preview-grid" }, ...cards);
};

const renderCurrentWorkspace = () =>
  _.section(
    _.h2({ class: "tl-section-title" }, "Workspace corrente"),
    _.Card(
      { class: "tl-workspace-preview" },
      renderMiniCards(),
      _.div(
        { class: "tl-preview-footer" },
        _.div({ class: "tl-workspace-name" }, popupData.currentWorkspace.name, " ", icon("star", "xs")),
        _.div({ class: "tl-modified" }, popupData.currentWorkspace.modifiedLabel)
      )
    ),
    _.div({ class: "tl-carousel-dots", "aria-hidden": "true" }, _.span(), _.span(), _.span(), _.span())
  );

const renderWorkspaceRow = (workspace) =>
  _.Card(
    { class: "tl-workspace-row" },
    _.span(
      { class: "tl-grid-icon", style: { "--accent": workspace.color }, "aria-hidden": "true" },
      _.span(),
      _.span(),
      _.span(),
      _.span()
    ),
    _.div(
      _.div({ class: "tl-workspace-row-title" }, workspace.title, workspace.favorite ? " ★" : ""),
      _.div({ class: "tl-workspace-row-meta" }, workspace.meta)
    ),
    cmsButton({ class: "tl-open-link", onclick: () => openChromePage("editorWorkspace.html") }, "Apri"),
    cmsButton({ class: "tl-icon-btn", "aria-label": `Azioni ${workspace.title}` }, icon("more_vert", "sm"))
  );

const renderWorkspaceList = () =>
  _.section(
    _.h2({ class: "tl-section-title" }, "I miei workspace"),
    _.div({ class: "tl-workspace-list" }, ...popupData.workspaces.map(renderWorkspaceRow))
  );

const renderActionButton = (action) =>
  cmsButton(
    {
      class: "tl-action-btn",
      style: { "--action-color": action.color },
      onclick: () => handleQuickAction(action.id),
    },
    _.span({ class: "tl-action-icon" }, icon(action.icon, "sm")),
    _.span(_.span({ class: "tl-action-title" }, action.title), _.span({ class: "tl-action-subtitle" }, action.subtitle)),
    icon("chevron_right", "sm")
  );

const renderSystemCard = () =>
  _.Card(
    { class: "tl-system-card" },
    _.h2({ class: "tl-section-title" }, "Stato sistema"),
    _.div({ class: "tl-system-row" }, _.span("Runtime"), _.strong({ class: "is-online" }, popupData.system.runtime)),
    _.div({ class: "tl-system-row" }, _.span("Storage"), _.strong(popupData.system.storage)),
    _.div({ class: "tl-system-row" }, _.span("Connessioni attive"), _.strong(popupData.system.connections)),
    cmsButton(
      { class: "tl-new-window", onclick: () => openChromePage("editorWorkspace.html") },
      "Apri in nuova finestra",
      icon("open_in_new", "sm")
    )
  );

const renderSide = () =>
  _.aside(
    { class: "tl-side" },
    _.section(_.h2({ class: "tl-section-title" }, "Azioni rapide"), _.div({ class: "tl-action-stack" }, ...popupData.quickActions.map(renderActionButton))),
    renderSystemCard()
  );

const renderFooter = () =>
  _.footer(
    { class: "tl-popup-footer" },
    _.span(_.span({ class: "tl-status-dot", "aria-hidden": "true" }), " Trackers Lens v", tlConfig.VERSION),
    _.span("Tutto salvato localmente"),
    _.span("Dati al sicuro sul tuo dispositivo ", icon("lock", "xs"))
  );

const handleQuickAction = (actionId) => {
  const routes = {
    "new-workspace": "editorWorkspace.html",
    "new-box-lens": "editorBoxLens.html",
    "new-box-tracker": "editorBoxTracker.html",
    "asset-library": "widgets.html",
    "import-export": "options.html",
    sync: "options.html",
    help: "info.html",
  };

  openChromePage(routes[actionId] || "editorWorkspace.html");
};

const mountPopup = () => {
  const root = document.getElementById("tl-popup-root");
  root.replaceChildren(
    _.div(
      { class: "tl-popup-shell" },
      renderHeader(),
      _.div({ class: "tl-popup-main" }, _.div(renderCurrentWorkspace(), renderWorkspaceList()), renderSide()),
      renderFooter()
    )
  );
};

CMSwift.ready(mountPopup);
