const icon = (name, size = "md") => _.Icon({ name, size });
const btn = (props, ...children) => _.Btn({ type: "button", ...props }, ...children);
const dot = (tone = "online") => _.span({ class: `tl-profile-dot-status is-${tone}`, "aria-hidden": "true" });
const apiClient = window.TrackerLensApi?.client || null;

const authState = {
  mode: "login",
  status: "checking",
  user: null,
  name: "",
  email: "",
  password: "",
  passwordConfirmation: "",
  remember: true,
  error: "",
  busy: false,
};

const dashboardState = {
  loading: false,
  error: "",
  summary: null,
  activity: null,
  systemStatus: null,
  updatedAt: "",
};

let authDialog = null;

const fallbackProfileStats = [
  { label: "Workspace", value: "24", icon: "workspaces", tone: "pink" },
  { label: "Box Creati", value: "152", icon: "deployed_code", tone: "green" },
  { label: "Tracker Attivi", value: "37", icon: "radar", tone: "blue" },
  { label: "AI Jobs", value: "1.284", icon: "psychology", tone: "gold" },
  { label: "Dati Elaborati", value: "12.6 GB", icon: "data_thresholding", tone: "gold" },
];

const fallbackTimeline = [
  ["12:32", "Hai creato un nuovo workspace “Crypto Monitor”", "Workspace", "workspaces", "gold"],
  ["11:45", "AI Job completato: Market Analysis", "AI", "psychology", "gold"],
  ["10:21", "Aggiunto nuovo tracker “BTC Price”", "Tracker", "radar", "green"],
  ["09:15", "Connessione Binance API aggiornata", "Connessione", "link", "blue"],
  ["08:42", "Backup automatico completato", "Sistema", "verified", "slate"],
];

const fallbackUser = {
  name: "Trackers Lens User",
  email: "sessione non collegata",
  plan: "local",
};

const securityRows = [
  ["Password", "Ultima modifica: 12/04/2024", "Cambia", "key", "neutral"],
  ["Autenticazione a due fattori", "", "Attivata", "shield", "green"],
  ["Email di recupero", "", "Verificata", "mail", "green"],
];

const devices = [
  ["Windows 11 • Chrome", "Rome, Italy • 192.168.1.45", "Attivo", "Sessione Attuale", "desktop_windows", "online"],
  ["macOS • Safari", "Rome, Italy • 192.168.1.23", "Altro", "2 ore fa", "work", "online"],
  ["iPhone 14 • Safari", "Rome, Italy • 192.168.1.99", "Inattivo", "1 giorno fa", "phone_iphone", "offline"],
];

const quickActions = [
  ["Nuovo Workspace", "deployed_code", "gold"],
  ["Aggiungi Tracker", "track_changes", "green"],
  ["Nuovo AI Job", "psychology", "gold"],
  ["Importa Dati", "download", "blue"],
  ["Esporta Dati", "upload", "cyan"],
  ["Pulisci Cache", "delete_sweep", "gold"],
];

const fallbackSystemRows = [
  ["Versione Trackers Lens", "v1.0.0"],
  ["Ambiente", "Node.js"],
  ["Piattaforma", "darwin"],
  ["Architettura", "arm64"],
  ["Node.js", "v24.14.1"],
];

const renderBrand = () => window.TrackerLensSidebar.renderBrand({ className: "tl-profile-brand" });

const numberFormatter = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });
const formatMetricValue = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value || "0");
  if (number >= 1000000) return `${numberFormatter.format(number / 1000000)}M`;
  if (number >= 1000) return numberFormatter.format(number);
  return String(number);
};
const timeLabel = (value = "") => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
};
const dashboardIcon = (label = "", type = "") => {
  const text = `${label} ${type}`.toLowerCase();
  if (/api|request|key/.test(text)) return "key";
  if (/asset|cloud|storage/.test(text)) return "cloud";
  if (/follower|user/.test(text)) return "group";
  if (/box|workspace/.test(text)) return "workspaces";
  if (/database/.test(text)) return "database";
  if (/websocket|gateway/.test(text)) return "hub";
  if (/marketplace/.test(text)) return "storefront";
  return "monitoring";
};
const dashboardTone = (index = 0, status = "") => {
  if (/operational|ok|online/i.test(status)) return "green";
  if (/degraded|warning|pending/i.test(status)) return "gold";
  if (/down|error|failed/i.test(status)) return "red";
  return ["pink", "green", "blue", "gold", "cyan"][index % 5] || "gold";
};
const profileStats = () => {
  const kpis = dashboardState.summary?.kpis;
  if (!Array.isArray(kpis) || !kpis.length) return fallbackProfileStats;
  return kpis.slice(0, 5).map((item, index) => ({
    label: item.label || "KPI",
    value: formatMetricValue(item.value),
    delta: Number(item.delta) || 0,
    trend: item.trend || "",
    icon: dashboardIcon(item.label),
    tone: dashboardTone(index),
  }));
};
const timeline = () => {
  const items = dashboardState.activity?.items;
  if (!Array.isArray(items) || !items.length) return fallbackTimeline;
  return items.map((item, index) => [
    timeLabel(item.created_at),
    [item.title, item.detail].filter(Boolean).join(": "),
    item.type ? item.type.replace(/_/g, " ") : "API",
    dashboardIcon(item.title, item.type),
    dashboardTone(index),
  ]);
};
const systemRows = () => {
  const services = dashboardState.systemStatus?.services;
  if (!Array.isArray(services) || !services.length) return fallbackSystemRows;
  return services.map((service) => [service.name || "Servizio", service.status || "unknown"]);
};
const getAuthUser = () => authState.user || fallbackUser;
const isAuthenticated = () => authState.status === "authenticated" && authState.user;
const authStatusLabel = () => {
  if (authState.status === "checking") return "Verifica sessione";
  if (authState.status === "authenticated") return "Online";
  if (authState.status === "offline") return "API non raggiungibile";
  return "Non autenticato";
};
const authStatusTone = () => {
  if (authState.status === "authenticated") return "online";
  if (authState.status === "checking") return "gold";
  return "offline";
};
const planLabel = (plan = "") => {
  const normalized = String(plan || "").trim().toLowerCase();
  if (normalized === "pro") return "Pro";
  if (normalized === "premium") return "Premium";
  if (normalized === "local") return "Locale";
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "Locale";
};
const accountRows = () => {
  const user = getAuthUser();
  return [
    ["Nome", user.name || fallbackUser.name],
    ["Email", user.email || fallbackUser.email],
    ["Piano", planLabel(user.plan)],
    ["Sessione", authStatusLabel()],
    ["API", apiClient?.baseUrl || "Client non caricato"],
  ];
};
const updateAuthState = (patch = {}) => Object.assign(authState, patch);
const updateDashboardState = (patch = {}) => Object.assign(dashboardState, patch);
const refreshProfileUi = () => {
  mountProfile();
  authDialog?.update?.();
};
const resetDashboardState = () => updateDashboardState({
  loading: false,
  error: "",
  summary: null,
  activity: null,
  systemStatus: null,
  updatedAt: "",
});
const renderFieldError = (field = "") => {
  const errors = authState.errorPayload?.errors?.[field];
  if (!errors?.length) return null;
  return _.small({ class: "tl-profile-auth-field-error" }, errors[0]);
};
const readFormValue = (event, name = "") => new FormData(event.currentTarget).get(name);
const setAuthMode = (mode = "login") => {
  updateAuthState({
    mode,
    error: "",
    errorPayload: null,
    password: "",
    passwordConfirmation: "",
  });
  refreshProfileUi();
};
const openAuthDialog = (mode = authState.mode || "login") => {
  if (isAuthenticated()) return;
  updateAuthState({ mode, error: "", errorPayload: null });
  if (authDialog?.isOpen?.()) {
    authDialog.update?.();
    return;
  }
  authDialog = _.Dialog({
    class: "tl-profile-auth-dialog",
    panelClass: "tl-profile-auth-dialog-panel",
    size: "sm",
    title: () => authState.mode === "register" ? "Crea account" : "Accedi",
    subtitle: () => apiClient?.baseUrl || "Client API non caricato",
    icon: "person",
    closeButton: true,
    content: () => _.div({ class: "tl-profile-auth-dialog-body" }, renderAuthForm()),
    actions: ({ close }) => _.Toolbar(
      { align: "between", gap: 8 },
      _.span({ class: "tl-profile-auth-dialog-status" }, authStatusLabel()),
      btn({ onclick: close }, "Chiudi")
    ),
    onClose: () => {
      authDialog = null;
    },
  });
  authDialog.open();
};
const handleAuthSubmit = async (event) => {
  event.preventDefault();
  if (!apiClient || authState.busy) return;
  const isRegister = authState.mode === "register";
  updateAuthState({
    busy: true,
    error: "",
    errorPayload: null,
    name: String(readFormValue(event, "name") || "").trim(),
    email: String(readFormValue(event, "email") || "").trim(),
    password: String(readFormValue(event, "password") || ""),
    passwordConfirmation: String(readFormValue(event, "password_confirmation") || ""),
    remember: readFormValue(event, "remember") === "on",
  });
  refreshProfileUi();

  try {
    let user = null;
    if (isRegister) {
      const result = await apiClient.register({
        name: authState.name,
        email: authState.email,
        password: authState.password,
        password_confirmation: authState.passwordConfirmation,
      });
      user = result?.user || await apiClient.user();
    } else {
      await apiClient.login({
        email: authState.email,
        password: authState.password,
        remember: authState.remember,
      });
      user = await apiClient.user();
    }
    updateAuthState({
      mode: "login",
      status: "authenticated",
      user,
      password: "",
      passwordConfirmation: "",
      busy: false,
    });
    await loadDashboardData();
    authDialog?.close?.();
  } catch (error) {
    updateAuthState({
      status: error.status === 0 ? "offline" : "guest",
      error: error.message || (isRegister ? "Registrazione non riuscita" : "Login non riuscito"),
      errorPayload: error.payload || null,
      busy: false,
    });
  }
  refreshProfileUi();
};
const handleLogout = async () => {
  if (!apiClient || authState.busy) return;
  updateAuthState({ busy: true, error: "", errorPayload: null });
  refreshProfileUi();

  try {
    await apiClient.logout();
  } catch (error) {
    if (error.status !== 401 && error.status !== 419) {
      updateAuthState({
        error: error.message || "Logout non riuscito",
        errorPayload: error.payload || null,
        busy: false,
      });
      refreshProfileUi();
      return;
    }
  }

  updateAuthState({ status: "guest", user: null, password: "", passwordConfirmation: "", busy: false });
  resetDashboardState();
  refreshProfileUi();
};
const loadDashboardData = async () => {
  if (!apiClient || !isAuthenticated()) {
    resetDashboardState();
    return;
  }

  updateDashboardState({ loading: true, error: "" });
  refreshProfileUi();

  try {
    const [summary, activity, systemStatus] = await Promise.all([
      apiClient.dashboard.summary(),
      apiClient.dashboard.activity(),
      apiClient.dashboard.systemStatus(),
    ]);
    updateDashboardState({
      loading: false,
      error: "",
      summary,
      activity,
      systemStatus,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    updateDashboardState({
      loading: false,
      error: error.message || "Dashboard API non raggiungibile",
    });
  }
};
const loadCurrentUser = async () => {
  if (!apiClient) {
    updateAuthState({ status: "offline", error: "Client API non caricato" });
    refreshProfileUi();
    return;
  }

  try {
    const user = await apiClient.user();
    updateAuthState({ status: "authenticated", user, error: "", errorPayload: null });
    await loadDashboardData();
  } catch (error) {
    updateAuthState({
      status: error.status === 401 || error.status === 419 ? "guest" : "offline",
      user: null,
      error: error.status === 401 || error.status === 419 ? "" : error.message || "API non raggiungibile",
      errorPayload: error.payload || null,
    });
    resetDashboardState();
  }
  refreshProfileUi();
};

const renderTopbar = () =>
  _.header(
    { class: "tl-profile-topbar" },
    renderBrand(),
    _.div(
      { class: "tl-profile-search" },
      _.Search({
        class: "tl-profile-search-input",
        label: "Cerca workspace, box, tracker, impostazioni...",
        value: "",
        "aria-label": "Cerca in Trackers Lens",
      })
    ),
    _.Toolbar(
      { class: "tl-profile-top-actions", align: "center", gap: 16 },
      btn(
        {
          class: "tl-profile-edit",
          onclick: isAuthenticated() ? handleLogout : () => openAuthDialog("login"),
          disabled: authState.busy || authState.status === "checking",
          title: isAuthenticated() ? "Logout" : authStatusLabel(),
        },
        icon(isAuthenticated() ? "logout" : "person", "sm"),
        isAuthenticated() ? "Logout" : "Login / Registrati"
      ),
      btn({ class: "tl-profile-menu", "aria-label": "Menu profilo" }, icon("more_vert"))
    )
  );

const renderSidebar = () => window.TrackerLensSidebar.render({ activeId: "profile" });

const renderStat = (item) =>
  _.div(
    { class: `tl-profile-stat is-${item.tone}` },
    _.span({ class: "tl-profile-stat-icon" }, icon(item.icon, "md")),
    _.div(_.strong(item.value), _.span({ class: 'label' }, item.label))
  );

const renderHero = () => {
  const user = getAuthUser();
  const authenticated = isAuthenticated();
  return (
    _.section(
      { class: "tl-profile-hero" },
      _.div({ class: "tl-profile-wave", "aria-hidden": "true" }),
      _.div(
        { class: "tl-profile-avatar-wrap" },
        _.div({ class: "tl-profile-avatar", "aria-label": `Avatar ${user.name || "utente"}` }),
        _.span({ class: "tl-profile-avatar-glow", "aria-hidden": "true" }),
        _.span({ class: "tl-profile-online-badge" }, dot(authStatusTone()), authStatusLabel()),
        btn({ class: "tl-profile-camera", "aria-label": "Modifica avatar" }, icon("photo_camera", "sm"))
      ),
      _.div(
        { class: "tl-profile-identity" },
        _.Row(
          { class: "tl-profile-name-row", align: "center", gap: 12 },
          _.h2(user.name || fallbackUser.name),
          _.span({ class: "tl-profile-builder-badge" }, `${planLabel(user.plan)} AI Builder`, icon("crown", "sm"))
        ),
        _.p(authenticated ? "Sessione API attiva con cookie Sanctum." : "Accedi per collegare Trackers Lens al backend Laravel."),
        _.Row(
          { class: "tl-profile-meta", gap: 18 },
          _.span(icon("calendar_month", "sm"), authenticated ? "Sessione verificata" : "Sessione locale"),
          _.span(icon("location_on", "sm"), "Rome, Italy"),
          _.span(icon("mail", "sm"), user.email || fallbackUser.email)
        ),
        _.div({ class: "tl-profile-stats" }, ...profileStats().map(renderStat))
      ),
      _.aside(
        { class: "tl-profile-plan" },
        _.div(_.span({ class: "tl-profile-plan-icon" }, icon("crown", "lg")), _.div(_.span("Piano Attuale"), _.strong(planLabel(user.plan)), _.em(authenticated ? "Backend Laravel" : "Modalita locale"))),
        btn({ class: "tl-profile-plan-btn", disabled: !authenticated }, "Gestisci Abbonamento")
      ),
      _.Toolbar(
        { class: "tl-profile-hero-actions", gap: 12 },
        btn({ class: "tl-profile-ghost" }, icon("edit", "sm"), "Modifica Profilo"),
        btn({ class: "tl-profile-ghost" }, icon("ios_share", "sm"), "Esporta Profilo"),
        btn({ class: "tl-profile-ghost" }, icon("share", "sm"), "Condividi Profilo")
      )
    )
  );
};

const renderTabs = () =>
  _.Toolbar(
    { class: "tl-profile-tabs", gap: 0, "aria-label": "Sezioni profilo utente" },
    ...["Overview", "Activity", "Security", "API Keys", "AI Usage", "Devices", "Billing"].map((label, index) =>
      btn({ class: `tl-profile-tab${index === 0 ? " is-active" : ""}`, "aria-current": index === 0 ? "page" : undefined }, label)
    )
  );

const renderAccount = () =>
  _.Card(
    { class: "tl-profile-card tl-profile-account" },
    _.h3("Informazioni Account"),
    _.div({ class: "tl-profile-info-list" }, ...accountRows().map(([label, value]) => _.p(_.span(label), _.strong(value))))
  );

const renderAuthForm = () =>
  _.form(
    { class: "tl-profile-auth-form", onsubmit: handleAuthSubmit },
    _.div(
      { class: "tl-profile-auth-mode", role: "tablist", "aria-label": "Accesso account" },
      btn(
        {
          class: authState.mode === "login" ? "is-active" : "",
          "aria-selected": authState.mode === "login",
          onclick: () => setAuthMode("login"),
        },
        "Login"
      ),
      btn(
        {
          class: authState.mode === "register" ? "is-active" : "",
          "aria-selected": authState.mode === "register",
          onclick: () => setAuthMode("register"),
        },
        "Registrati"
      )
    ),
    authState.mode === "register"
      ? _.label(
        "Nome",
        _.input({
          class: "tl-profile-auth-input",
          name: "name",
          type: "text",
          value: authState.name,
          autocomplete: "name",
          required: true,
          disabled: authState.busy || authState.status === "checking",
        }),
        renderFieldError("name")
      )
      : null,
    _.label(
      "Email",
      _.input({
        class: "tl-profile-auth-input",
        name: "email",
        type: "email",
        value: authState.email,
        autocomplete: "email",
        required: true,
        disabled: authState.busy || authState.status === "checking",
      }),
      renderFieldError("email")
    ),
    _.label(
      "Password",
      _.input({
        class: "tl-profile-auth-input",
        name: "password",
        type: "password",
        value: authState.password,
        autocomplete: "current-password",
        required: true,
        disabled: authState.busy || authState.status === "checking",
      }),
      renderFieldError("password")
    ),
    authState.mode === "register"
      ? _.label(
        "Conferma password",
        _.input({
          class: "tl-profile-auth-input",
          name: "password_confirmation",
          type: "password",
          value: authState.passwordConfirmation,
          autocomplete: "new-password",
          required: true,
          disabled: authState.busy || authState.status === "checking",
        }),
        renderFieldError("password_confirmation")
      )
      : null,
    _.label(
      { class: "tl-profile-auth-remember" },
      _.input({ name: "remember", type: "checkbox", checked: authState.remember, disabled: authState.busy || authState.status === "checking" }),
      _.span("Ricordami")
    ),
    authState.error ? _.p({ class: "tl-profile-auth-error" }, authState.error) : null,
    btn(
      {
        class: "tl-profile-fill",
        type: "submit",
        disabled: !apiClient || authState.busy || authState.status === "checking",
      },
      authState.busy ? (authState.mode === "register" ? "Creo account..." : "Accesso...") : authState.status === "checking" ? "Verifica..." : authState.mode === "register" ? "Registrati" : "Login"
    )
  );

const renderTimeline = () =>
  _.Card(
    { class: "tl-profile-card tl-profile-timeline" },
    _.h3("Attività Recenti", dashboardState.loading ? _.span(" API...") : null),
    dashboardState.error ? _.p({ class: "tl-profile-auth-error" }, dashboardState.error) : null,
    _.div(
      { class: "tl-profile-events" },
      ...timeline().map(([time, text, badge, iconName, tone]) =>
        _.div(
          { class: `tl-profile-event is-${tone}` },
          _.time(time),
          _.span({ class: "tl-profile-event-icon" }, icon(iconName, "sm")),
          _.p(text),
          _.span({ class: `tl-profile-event-badge is-${tone}` }, badge)
        )
      )
    ),
    btn({ class: "tl-profile-link-btn" }, "Visualizza tutta l’attività", icon("arrow_forward", "sm"))
  );

const renderAiUsage = () =>
  _.Card(
    { class: "tl-profile-card tl-profile-ai-usage" },
    _.h3("AI Usage ", _.span("(Ultimi 30 giorni)")),
    _.div(
      { class: "tl-profile-ai-grid" },
      _.div({ class: "tl-profile-donut" }, _.strong("1.284"), _.span("Total AI Jobs"), _.em("+ 342 (36%)")),
      _.div(
        { class: "tl-profile-ai-metrics" },
        _.p(_.span(dot("gold"), "Token Utilizzati"), _.strong("2.4M")),
        _.p(_.span(dot("blue"), "Richieste AI"), _.strong("1.284")),
        _.p(_.span(dot("green"), "Tempo Medio"), _.strong("18.4s")),
        _.p(_.span(dot("gold"), "Costo Stimato"), _.strong("$1.82"))
      )
    )
  );

const renderLineChart = () =>
  _.div(
    { class: "tl-profile-line-chart", "aria-hidden": "true" },
    ...Array.from({ length: 38 }, (item, index) => _.span({ style: { "--h": `${22 + ((index * 17 + (index > 30 ? 24 : 0)) % 58)}%` } })),
    _.div({ class: "tl-profile-chart-fill" })
  );

const renderWorkspaceStats = () =>
  _.Card(
    { class: "tl-profile-card tl-profile-workspace" },
    _.Row({ justify: "space-between", align: "center" }, _.h3("Statistiche Workspace"), _.Select({ class: "tl-profile-filter", value: "30", options: [{ label: "Ultimi 30 giorni", value: "30" }] })),
    _.div(
      { class: "tl-profile-workspace-kpis" },
      ...profileStats().slice(0, 4).map((item, index) => _.div(_.strong(item.value), _.span(item.label), _.em(item.delta ? `${item.delta > 0 ? "+" : ""}${item.delta}%` : index === 0 ? "+ 3" : index === 1 ? "+ 18" : index === 2 ? "+ 5" : "+ 342")))
    ),
    renderLineChart(),
    _.Row({ class: "tl-profile-chart-labels", justify: "space-between" }, _.span("6 Mag"), _.span("12 Mag"), _.span("18 Mag"), _.span("24 Mag"), _.span("30 Mag"), _.span("Oggi"))
  );

const renderQuickActions = () =>
  _.Card(
    { class: "tl-profile-card tl-profile-quick" },
    _.h3("Azioni Rapide"),
    _.Grid(
      { class: "tl-profile-action-grid", cols: 3, gap: 10 },
      ...quickActions.map(([label, iconName, tone]) => btn({ class: `tl-profile-action is-${tone}` }, _.span(icon(iconName, "md")), label))
    )
  );

const renderSecurity = () =>
  _.Card(
    { class: "tl-profile-card tl-profile-security" },
    _.h3("Sicurezza Account"),
    _.div(
      { class: "tl-profile-security-list" },
      ...securityRows.map(([label, meta, state, iconName, tone]) =>
        _.div({ class: "tl-profile-security-row" }, _.span({ class: "tl-profile-security-icon" }, icon(iconName, "sm")), _.div(_.strong(label), meta ? _.small(meta) : null), _.em({ class: `is-${tone}` }, state))
      )
    ),
    btn({ class: "tl-profile-fill" }, "Gestisci Sicurezza")
  );

const renderDevices = () =>
  _.Card(
    { class: "tl-profile-card tl-profile-devices" },
    _.Row({ justify: "space-between", align: "center" }, _.h3("Dispositivi Attivi"), btn({ class: "tl-profile-link-btn" }, "Visualizza tutti i dispositivi", icon("arrow_forward", "sm"))),
    _.div(
      { class: "tl-profile-device-grid" },
      ...devices.map(([name, meta, state, session, iconName, status]) =>
        _.div(
          { class: `tl-profile-device is-${status}` },
          _.span({ class: "tl-profile-device-icon" }, icon(iconName, "sm")),
          _.div(_.strong(name), _.p(meta), _.em(session)),
          _.span({ class: `tl-profile-device-status is-${status}` }, dot(status), state)
        )
      )
    )
  );

const renderSystem = () =>
  _.Card(
    { class: "tl-profile-card tl-profile-system" },
    _.h3("Informazioni Sistema"),
    _.div({ class: "tl-profile-info-list" }, ...systemRows().map(([label, value]) => _.p(_.span(label), _.strong(value)))),
    btn({ class: "tl-profile-fill" }, "Diagnostica Sistema")
  );

const renderFooter = () =>
  _.footer(
    { class: "tl-profile-footer" },
    _.span(dot("online"), "Sistema Online"),
    _.span("Uptime: 2h 47m 32s"),
    _.span("Memory: 68%"),
    _.span("Cache: Hit 98%"),
    _.span("IndexedDB: Connected"),
    _.span("Last Update: 12:32:20"),
    _.span({ class: "tl-profile-footer-spark" }, ...Array.from({ length: 13 }, (item, index) => _.i({ style: { "--h": `${18 + ((index * 19) % 42)}%` } })))
  );

const renderShell = () =>
  _.div(
    { class: "tl-profile-shell" },
    renderTopbar(),
    _.div(
      { class: "tl-profile-body" },
      renderSidebar(),
      _.main(
        { class: "tl-profile-main" },
        _.div({ class: "tl-profile-grid-bg", "aria-hidden": "true" }),
        renderHero(),
        renderTabs(),
        renderAccount(),
        renderTimeline(),
        renderAiUsage(),
        renderSecurity(),
        renderWorkspaceStats(),
        renderQuickActions(),
        renderDevices(),
        renderSystem(),
        renderFooter()
      )
    )
  );

const mountProfile = () => {
  const root = document.getElementById("tl-profile-root");
  if (!root) return;
  root.replaceChildren(renderShell());
};

mountProfile();
loadCurrentUser();
