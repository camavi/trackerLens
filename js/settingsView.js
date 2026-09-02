(function () {
const icon = (name, size = "md") => _.Icon({ name, size });
const btn = (props, ...children) => _.Btn({ type: "button", ...props }, ...children);
const dot = (tone = "online") => _.span({ class: `tl-settings-dot is-${tone}`, "aria-hidden": "true" });

const selectArrowSlot = { arrow: () => icon("keyboard_arrow_down", "sm") };
const SETTINGS_STORE = (typeof tlConfig !== "undefined" ? tlConfig.TABLES?.TL_SETTINGS : null) || "tl_settings";
const SETTINGS_RECORD_ID = "global";

const clone = (value) => JSON.parse(JSON.stringify(value));
const normalizeText = (value, fallback = "") => {
  if (value === null || value === undefined) return fallback;
  return String(value).trim() || fallback;
};
const formatBytes = (bytes = 0) => {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
};
const formatDateTime = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "Mai";
  return date.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
const formatRelativeDuration = (ms) => {
  const value = Math.max(0, Number(ms) || 0);
  const minutes = Math.round(value / 60000);
  if (minutes < 1) return "adesso";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} giorni`;
  const months = Math.round(days / 30);
  return `${months} mesi`;
};
const backupIntervalMs = (frequency) => {
  if (frequency === "daily") return 24 * 60 * 60 * 1000;
  if (frequency === "weekly") return 7 * 24 * 60 * 60 * 1000;
  return 0;
};
const getBackupSchedule = () => {
  const backup = settingsState.settings.backup;
  const lastBackup = backup.lastBackupAt ? new Date(backup.lastBackupAt) : null;
  const hasLastBackup = lastBackup && !Number.isNaN(lastBackup.getTime());
  const interval = backup.automatic ? backupIntervalMs(backup.frequency) : 0;
  const elapsed = hasLastBackup ? Date.now() - lastBackup.getTime() : 0;
  const nextBackup = hasLastBackup && interval ? new Date(lastBackup.getTime() + interval) : null;
  const remaining = nextBackup ? nextBackup.getTime() - Date.now() : 0;
  return {
    lastLabel: hasLastBackup ? formatDateTime(lastBackup) : "Mai",
    agoLabel: hasLastBackup ? `${formatRelativeDuration(elapsed)} fa` : "Nessun backup locale",
    nextLabel: !backup.automatic
      ? "Backup manuale"
      : nextBackup
        ? formatDateTime(nextBackup)
        : "Dopo il primo backup",
    nextInLabel: !backup.automatic
      ? "Automazione disattivata"
      : nextBackup
        ? (remaining <= 0 ? "In coda ora" : `tra ${formatRelativeDuration(remaining)}`)
        : "Non pianificato",
    tone: hasLastBackup ? (remaining <= 0 && interval ? "warn" : "online") : "warn",
  };
};

const defaultSettings = {
  general: {
    workspaceName: "Trackers Lens Workspace",
    language: "it",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Rome",
    dateFormat: "dd/mm/yyyy",
    timeFormat: "24h",
    autoStart: true,
  },
  ai: {
    provider: "Ollama",
    model: "llama3.1",
    temperature: 0.72,
    maxTokens: 2048,
    localFirst: true,
  },
  connections: {
    timeout: 30,
    retries: 3,
    pingInterval: 25,
    proxy: "",
    autoReconnect: true,
    sslVerification: true,
  },
  storage: {
    keepLogs: "30",
    compression: true,
    autoCleanup: true,
    runtimeEventLimit: 500,
    runtimeFlowLogLimit: 300,
  },
  notifications: {
    desktop: true,
    email: false,
    errors: true,
    performance: false,
    dailySummary: false,
    emailAddress: "",
  },
  backup: {
    automatic: true,
    frequency: "daily",
    retention: "7",
    lastBackupAt: "",
    lastBackupSize: 0,
  },
  apiKeys: [
    { id: "openai", name: "OpenAI API Key", value: "", tone: "gold" },
    { id: "coingecko", name: "CoinGecko API Key", value: "", tone: "gold" },
    { id: "twitter", name: "Twitter API Key", value: "", tone: "blue" },
    { id: "binance", name: "Binance API Key", value: "", tone: "green" },
    { id: "newsapi", name: "NewsAPI Key", value: "", tone: "red" },
  ],
};

const mergeSettings = (record = {}) => {
  const source = record.settings && typeof record.settings === "object" ? record.settings : record;
  const merged = clone(defaultSettings);
  Object.keys(merged).forEach((key) => {
    if (source?.[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
      merged[key] = { ...merged[key], ...source[key] };
    }
  });
  if (Array.isArray(source?.apiKeys)) {
    const byId = new Map(source.apiKeys.map((item) => [item.id, item]));
    merged.apiKeys = merged.apiKeys.map((item) => ({ ...item, ...(byId.get(item.id) || {}) }));
  }
  return merged;
};

const settingSections = [
  { id: "general", title: "Generale", description: "Impostazioni generali del sistema", icon: "tune", target: "general", meta: "Workspace • Lingua" },
  { id: "ai", title: "AI & Modelli", description: "Provider, modelli e preferenze AI", icon: "psychology", target: "ai", meta: "Provider • Local AI" },
  { id: "connections", title: "Connessioni", description: "API, WebSocket e integrazioni", icon: "hub", target: "connections", meta: "Timeout • SSL" },
  { id: "data", title: "Dati & Archiviazione", description: "SQLite, cache e backup", icon: "database", target: "storage", meta: "Storage • Cache" },
  { id: "performance", title: "Performance", description: "Performance, limiti e ottimizzazioni", icon: "speed", target: "status", meta: "Runtime • Retention" },
  { id: "notifications", title: "Notifiche", description: "Avvisi, email e notifiche push", icon: "notifications", target: "notifications", meta: "Desktop • Email" },
  { id: "security", title: "Sicurezza", description: "Chiavi API, permessi e privacy", icon: "shield", target: "security", meta: "API Keys • Privacy" },
  { id: "interface", title: "Interfaccia", description: "Tema, layout e personalizzazioni", icon: "palette", target: "general", meta: "Layout • Tema" },
  { id: "backup", title: "Backup & Ripristino", description: "Esporta, importa e ripristina dati", icon: "restore", target: "backup", meta: "Backup • Restore" },
  { id: "system", title: "Sistema", description: "Info sistema e diagnostica", icon: "settings_suggest", target: "system", meta: "Info • Diagnostica" },
];

const panelOwners = {
  general: "general",
  ai: "ai",
  connections: "connections",
  storage: "data",
  status: "performance",
  notifications: "notifications",
  security: "security",
  backup: "backup",
  system: "system",
  "desktop-persistence": "data",
};

const settingsState = {
  search: "",
  apiKeySearch: "",
  activeSectionId: "general",
  navLockUntil: 0,
  loading: true,
  error: "",
  notice: "",
  settings: clone(defaultSettings),
  providers: [],
  aiModels: {
    provider: "",
    loading: false,
    error: "",
    items: [],
    selected: "",
    updatedAt: "",
  },
  connections: [],
  stores: [],
  storage: {
    usage: 0,
    quota: 0,
    usedLabel: "0 B",
    quotaLabel: "N/D",
    percent: 1,
  },
  desktopPersistence: {
    loading: false,
    status: null,
    error: "",
  },
  updatedAt: new Date(),
  queryMs: 0,
};

const settingsReactive = window.CMSwift?.reactive || window._?.reactive;
const [, setSettingsSignal] = settingsReactive?.signal
  ? settingsReactive.signal(settingsState.settings)
  : [() => settingsState.settings, (value) => { settingsState.settings = value; }];
const [, setRuntimeChromeSignal] = settingsReactive?.signal
  ? settingsReactive.signal({ error: settingsState.error, notice: settingsState.notice, updatedAt: settingsState.updatedAt, queryMs: settingsState.queryMs })
  : [() => ({ error: settingsState.error, notice: settingsState.notice, updatedAt: settingsState.updatedAt, queryMs: settingsState.queryMs }), () => {}];

const option = (value, label = value) => ({ value, label });
const readPath = (path) => path.split(".").reduce((value, key) => value?.[key], settingsState.settings);
const writePath = (path, value) => {
  const keys = path.split(".");
  let target = settingsState.settings;
  keys.slice(0, -1).forEach((key) => {
    target[key] = target[key] && typeof target[key] === "object" ? target[key] : {};
    target = target[key];
  });
  target[keys.at(-1)] = value;
};
const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((resolve) => {
      window.setTimeout(() => resolve({ __timeout: true, label }), ms);
    }),
  ]);
const desktopPersistence = () => window.trackers?.desktop?.persistence || null;
const ensureSettingsStore = async () => {
  const persistence = desktopPersistence();
  if (!persistence?.getStatus || !persistence.readDevelopmentRecords || !persistence.writeDevelopmentRecords || !persistence.deleteDevelopmentRecords) {
    throw new Error("Impostazioni richiedono il bridge SQLite dell'app desktop.");
  }
  const status = await persistence.getStatus();
  if (status?.mode !== "desktop-sqlite") throw new Error("Impostazioni richiedono SQLite nell'app desktop.");
  return persistence;
};
const readAllFromDb = (persistence, storeName) => persistence.readDevelopmentRecords({ storeName });
const getSettingsRecord = async () => {
  const persistence = await ensureSettingsStore();
  return (await readAllFromDb(persistence, SETTINGS_STORE)).find((record) => record.id === SETTINGS_RECORD_ID) || null;
};
const saveSettings = async (silent = false) => {
  const persistence = await ensureSettingsStore();
  const now = new Date().toISOString();
  const record = {
    id: SETTINGS_RECORD_ID,
    settings: clone(settingsState.settings),
    createdAt: settingsState.createdAt || now,
    updatedAt: now,
  };
  try {
    await persistence.writeDevelopmentRecords({ storeName: SETTINGS_STORE, records: [record] });
    settingsState.updatedAt = new Date(now);
    settingsState.notice = silent ? settingsState.notice : "Impostazioni salvate in SQLite";
    settingsState.error = "";
  } catch (error) {
    settingsState.error = error?.message || "Errore salvataggio impostazioni";
  }
  patchSettingsRuntimeChrome();
};
const mutateSetting = (path, value, { rerender = false, persist = false } = {}) => {
  writePath(path, value);
  setSettingsSignal(clone(settingsState.settings));
  if (persist) saveSettings(true);
  if (rerender) patchSettingsRuntimeChrome();
};
const maskKey = (value) => {
  const text = normalizeText(value);
  if (!text) return "Non configurata";
  if (text.length <= 8) return `${"*".repeat(Math.max(4, text.length))}`;
  return `${text.slice(0, 3)}${"*".repeat(Math.max(12, text.length - 7))}${text.slice(-4)}`;
};
const getSettingSection = (id) => settingSections.find((section) => section.id === id) || settingSections[0];
const getPanelById = (panelId) => document.querySelector(`[data-settings-panel-id="${panelId}"]`);
const buildPanelProps = (panelId, className, extra = {}) => {
  const ownerId = panelOwners[panelId] || panelId;
  const owner = getSettingSection(ownerId);
  return {
    class: className,
    id: `settings-panel-${panelId}`,
    "data-settings-panel-id": panelId,
    "data-settings-owner": ownerId,
    "data-settings-search": normalizeText([owner.title, owner.description, owner.meta, panelId].join(" ")).toLowerCase(),
    ...extra,
  };
};
const setActiveSettingsSection = (sectionId) => {
  if (!sectionId || settingsState.activeSectionId === sectionId) return;
  settingsState.activeSectionId = sectionId;
  document.querySelectorAll("[data-settings-category]").forEach((item) => {
    item.classList.toggle("is-active", item.dataset.settingsCategory === sectionId);
  });
};
const scrollToSettingsSection = (sectionId) => {
  const section = getSettingSection(sectionId);
  const panel = getPanelById(section.target);
  if (!panel) return;
  settingsState.navLockUntil = Date.now() + 900;
  setActiveSettingsSection(section.id);
  panel.classList.add("is-focus-pulse");
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
  window.setTimeout(() => panel.classList.remove("is-focus-pulse"), 900);
};
const applySettingsSearch = () => {
  const query = normalizeText(settingsState.search).toLowerCase();
  document.querySelectorAll("[data-settings-panel-id]").forEach((panel) => {
    const matches = !query || panel.dataset.settingsSearch?.includes(query);
    panel.classList.toggle("is-search-dimmed", !matches);
    panel.classList.toggle("is-search-match", Boolean(query && matches));
  });
  document.querySelectorAll("[data-settings-category]").forEach((item) => {
    const section = getSettingSection(item.dataset.settingsCategory);
    const matches = !query || normalizeText([section.title, section.description, section.meta].join(" ")).toLowerCase().includes(query);
    item.classList.toggle("is-search-dimmed", !matches);
    item.classList.toggle("is-search-match", Boolean(query && matches));
  });
};
let settingsSectionObserver = null;
const syncSettingsNavigation = () => {
  settingsSectionObserver?.disconnect();
  const main = document.querySelector(".tl-settings-main");
  const panels = Array.from(document.querySelectorAll("[data-settings-panel-id]"));
  if (!main || !panels.length || !window.IntersectionObserver) {
    applySettingsSearch();
    return;
  }
  settingsSectionObserver = new IntersectionObserver((entries) => {
    if (Date.now() < settingsState.navLockUntil) return;
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    const ownerId = visible?.target?.dataset?.settingsOwner;
    if (ownerId) setActiveSettingsSection(ownerId);
  }, {
    root: main,
    rootMargin: "-18% 0px -58% 0px",
    threshold: [0.18, 0.35, 0.55],
  });
  panels.forEach((panel) => settingsSectionObserver.observe(panel));
  setActiveSettingsSection(settingsState.activeSectionId);
  applySettingsSearch();
};

let settingsRoot = null;
let settingsEmbedded = false;
const renderBrand = () => window.TrackerLensSidebar.renderBrand({ className: "tl-settings-brand" });

const renderTopbar = () =>
  _.header(
    { class: "tl-settings-topbar" },
    settingsEmbedded ? null : renderBrand(),
    _.div(
      { class: "tl-settings-search" },
      _.Search({
        class: "tl-settings-search-input",
        label: "Cerca impostazioni...",
        value: settingsState.search,
        "aria-label": "Cerca impostazioni",
        onInput: (event) => {
          settingsState.search = event.target.value;
          applySettingsSearch();
        },
      })
    ),
    _.Toolbar(
      { class: "tl-settings-actions", align: "center", gap: 14 },
      btn({ class: "st-btn-primary", onclick: () => saveSettings(false) }, icon("edit", "sm"), "Edit"),
      btn({ class: "tl-settings-menu", "aria-label": "Menu impostazioni" }, icon("more_vert"))
    )
  );

const renderSidebar = () => window.TrackerLensSidebar.render({ activeId: "settings" });

const renderHeader = () =>
  _.section(
    { class: "tl-settings-header" },
    _.div(
      { class: "tl-settings-title-row" },
      _.div(
        _.span({ class: "tl-settings-orb" }, icon("settings", "md")),
        _.div(_.h2("Impostazioni"), _.p("Configura e personalizza il comportamento di Trackers Lens"))
      ),
      _.Toolbar(
        { class: "tl-settings-head-actions", gap: 14 },
        _.span({ class: "tl-settings-live-pill", "data-settings-live-pill": "true" }, dot(settingsState.error ? "error" : "online"), settingsState.error || settingsState.notice || "Sistema Online"),
        btn({ class: "st-btn-primary", onclick: () => saveSettings(false) }, icon("save", "sm"), "Salva Modifiche")
      )
    )
  );

const renderCategorySidebar = () =>
  _.aside(
    { class: "tl-settings-categories" },
    _.h2("Impostazioni"),
    _.p("Configura e personalizza il comportamento di Trackers Lens"),
    _.div(
      { class: "tl-settings-category-list" },
      ...settingSections.map(({ id, title, description, icon: iconName, meta }) =>
        btn(
          {
            class: `tl-settings-category${settingsState.activeSectionId === id ? " is-active" : ""}`,
            "data-settings-category": id,
            onclick: () => scrollToSettingsSection(id),
          },
          _.span({ class: "tl-settings-category-icon" }, icon(iconName, "sm")),
          _.span(_.strong(title), _.small(description), _.em(meta)),
          icon("chevron_right", "sm")
        )
      )
    )
  );

const renderField = (label, child) =>
  _.label({ class: "tl-settings-field" }, _.span(label), child);

const renderInput = (value, props = {}) =>
  _.Input({ class: "tl-settings-input", value, ...props });

const renderSettingInput = (path, props = {}) =>
  renderInput(readPath(path), {
    ...props,
    onInput: (event) => {
      const rawValue = event.target.value;
      mutateSetting(path, props.type === "number" ? Number(rawValue) || 0 : rawValue);
      props.onInput?.(event);
    },
  });

const renderSettingNumber = (path, props = {}) =>
  renderSettingInput(path, {
    type: "number",
    step: 1,
    ...props,
    onChange: () => saveSettings(true),
  });

const renderSelect = (label, value, options, onChange = null) =>
  _.Select({
    class: "tl-settings-select",
    label,
    value,
    options,
    slots: selectArrowSlot,
    onChange,
  });

const renderSettingSelect = (label, path, options) =>
  renderSelect(label, readPath(path), options, (value) => mutateSetting(path, value, { persist: true }));

const normalizeProviderName = (value = "") =>
  normalizeText(value).toLowerCase().replace(/[\s_-]+/g, "");

const selectedAiProvider = () => {
  const selected = normalizeProviderName(settingsState.settings.ai.provider);
  return settingsState.providers.find((provider) =>
    [provider.name, provider.provider, provider.id].some((value) => normalizeProviderName(value) === selected)
  ) || null;
};

const fallbackProviderConfig = (name = settingsState.settings.ai.provider) => {
  const key = normalizeProviderName(name);
  if (key.includes("lmstudio")) {
    return {
      id: "local_lm_studio",
      name: "LM Studio",
      provider: "lm-studio",
      endpoint: "http://127.0.0.1:1234/v1",
      modelPath: "/models",
    };
  }
  if (key.includes("ollama")) {
    return {
      id: "local_ollama",
      name: "Ollama",
      provider: "ollama",
      endpoint: "http://127.0.0.1:11434",
      modelPath: "/api/tags",
    };
  }
  return null;
};

const activeAiProviderConfig = () =>
  selectedAiProvider() || fallbackProviderConfig();

const joinEndpointPath = (base = "", path = "") => {
  const cleanBase = normalizeText(base).replace(/\/+$/, "");
  const cleanPath = normalizeText(path).replace(/^\/+/, "");
  if (!cleanBase) return "";
  return cleanPath ? `${cleanBase}/${cleanPath}` : cleanBase;
};

const aiProviderModelPaths = (provider = {}) => {
  const kind = normalizeProviderName(provider.provider || provider.name || provider.id);
  if (kind.includes("ollama")) return [provider.modelPath || "/api/tags", "/api/tags"];
  if (kind.includes("lmstudio") || kind.includes("lm-studio")) return [provider.modelPath || "/models", "/api/v1/models", "/v1/models"];
  return [provider.modelPath, provider.healthPath, "/models", "/api/v1/models"].filter(Boolean);
};

const aiProviderModelUrls = (provider = {}) => {
  const base = normalizeText(provider.endpoint).replace(/\/+$/, "");
  if (!base) return [];
  const kind = normalizeProviderName(provider.provider || provider.name || provider.id);
  const paths = aiProviderModelPaths(provider);
  const urls = paths.map((path) => joinEndpointPath(base, path));
  if (kind.includes("lmstudio") || kind.includes("lm-studio")) {
    const root = base.replace(/\/v1$/i, "");
    urls.push(joinEndpointPath(root, "/api/v1/models"));
    urls.push(joinEndpointPath(root, "/v1/models"));
    urls.push(joinEndpointPath(root, "/models"));
  }
  return [...new Set(urls.filter(Boolean))];
};

const parseAiModelList = (payload = {}) => {
  const source = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload.models)
        ? payload.models
        : Array.isArray(payload.tags)
          ? payload.tags
          : [];
  return [...new Set(source
    .map((item) => normalizeText(item?.id || item?.name || item?.model || item))
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
};

const fetchAiProviderModels = async (provider = activeAiProviderConfig()) => {
  if (!provider?.endpoint) return { models: [], error: "Provider endpoint non configurato" };
  const urls = aiProviderModelUrls(provider);
  let lastError = "";
  for (const url of urls) {
    if (!url) continue;
    let timeout = 0;
    try {
      const controller = new AbortController();
      timeout = window.setTimeout(() => controller.abort(), 3500);
      const response = await fetch(url, { method: "GET", signal: controller.signal });
      if (!response.ok) {
        lastError = `${response.status} ${response.statusText}`;
        continue;
      }
      const payload = await response.json();
      const models = parseAiModelList(payload);
      if (models.length) return { models, url };
      lastError = "Nessun modello nella risposta";
    } catch (error) {
      lastError = error?.name === "AbortError" ? "Timeout richiesta modelli" : error?.message || "Errore lettura modelli";
    } finally {
      if (timeout) window.clearTimeout(timeout);
    }
  }
  return { models: [], error: lastError || "Nessun endpoint modelli disponibile" };
};

const patchSettingsAiPanel = () => {
  const panel = document.querySelector("[data-settings-panel-id=\"ai\"]");
  if (panel) panel.replaceWith(renderAiProvider());
  syncSettingsNavigation();
};

const loadAiModelsForSelectedProvider = async ({ force = false } = {}) => {
  const provider = activeAiProviderConfig();
  const providerKey = provider?.id || provider?.name || settingsState.settings.ai.provider || "";
  if (!force && settingsState.aiModels.provider === providerKey && (settingsState.aiModels.items.length || settingsState.aiModels.loading)) return;
  settingsState.aiModels = {
    provider: providerKey,
    loading: true,
    error: "",
    items: [],
    selected: "",
    updatedAt: "",
  };
  patchSettingsAiPanel();
  const result = await fetchAiProviderModels(provider);
  settingsState.aiModels = {
    provider: providerKey,
    loading: false,
    error: result.error || "",
    items: result.models || [],
    selected: result.models?.[0] || "",
    updatedAt: new Date().toISOString(),
  };
  settingsState.notice = result.models?.length
    ? `${result.models.length} modelli caricati da ${provider?.name || settingsState.settings.ai.provider}`
    : settingsState.notice;
  patchSettingsAiPanel();
  patchSettingsRuntimeChrome();
};

const handleAiProviderChange = (value) => {
  mutateSetting("ai.provider", value, { persist: true });
  settingsState.aiModels = { provider: "", loading: false, error: "", items: [], selected: "", updatedAt: "" };
  patchSettingsAiPanel();
  loadAiModelsForSelectedProvider({ force: true });
};

const setSelectedAiModelAsDefault = async () => {
  const model = normalizeText(settingsState.aiModels.selected);
  if (!model) {
    settingsState.error = "Seleziona un modello prima di usare Set";
    patchSettingsRuntimeChrome();
    return;
  }
  mutateSetting("ai.model", model);
  await saveSettings(true);
  settingsState.notice = `Modello predefinito impostato: ${model}`;
  patchSettingsAiPanel();
  patchSettingsRuntimeChrome();
};

const renderToggleRow = (label, checked = true, onChange = null) =>
  _.div(
    { class: "tl-settings-toggle-row" },
    _.span(label),
    _.Toggle({ checked, color: checked ? "success" : "secondary", onChange })
  );

const renderSettingToggle = (label, path) =>
  renderToggleRow(label, Boolean(readPath(path)), (checked) => mutateSetting(path, Boolean(checked), { persist: true }));

const renderGeneral = () =>
  _.Card(
    buildPanelProps("general", "tl-settings-panel tl-settings-general"),
    _.h3("Impostazioni Generali"),
    renderField("Nome Workspace Predefinito", renderSettingInput("general.workspaceName")),
    _.Grid(
      { cols: 2, gap: 14 },
      renderSettingSelect("Lingua", "general.language", [option("it", "Italiano"), option("en", "English"), option("fr", "Francais"), option("de", "Deutsch"), option("es", "Espanol")]),
      renderSettingSelect("Fuso Orario", "general.timezone", [option("Europe/Rome", "(UTC+01:00) Europe/Rome"), option("UTC", "(UTC+00:00) UTC"), option("America/New_York", "(UTC-05:00) New York"), option(Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Rome")])
    ),
    _.Grid(
      { cols: 2, gap: 14 },
      renderSettingSelect("Formato Data", "general.dateFormat", [option("dd/mm/yyyy", "24/06/2024"), option("yyyy-mm-dd", "2024-06-24"), option("mm/dd/yyyy", "06/24/2024")]),
      renderSettingSelect("Formato Ora", "general.timeFormat", [option("24h", "24 ore"), option("12h", "12 ore")])
    ),
    renderSettingToggle("Avvio automatico Trackers Lens", "general.autoStart")
  );

const renderRange = (label, value, min, max, suffix = "") =>
  _.div(
    { class: "tl-settings-range-row" },
    _.div(_.span(label), _.strong(`${value}${suffix}`)),
    _.input({ class: "tl-settings-range", type: "range", min, max, value })
  );

const renderSettingRange = (label, path, min, max, step = 1, suffix = "") =>
  _.div(
    { class: "tl-settings-range-row" },
    _.div(_.span(label), _.strong({ "data-settings-range-value": path }, `${readPath(path)}${suffix}`)),
    _.input({
      class: "tl-settings-range",
      type: "range",
      min,
      max,
      step,
      value: readPath(path),
      onInput: (event) => {
        const nextValue = Number(event.target.value);
        mutateSetting(path, nextValue);
        const valueNode = event.currentTarget
          ?.closest(".tl-settings-range-row")
          ?.querySelector(`[data-settings-range-value="${path}"]`);
        if (valueNode) valueNode.textContent = `${nextValue}${suffix}`;
      },
      onChange: () => saveSettings(true),
    })
  );

const renderAiProvider = () =>
  _.Card(
    buildPanelProps("ai", "tl-settings-panel tl-settings-ai-card"),
    _.Row({ align: "center", justify: "space-between" }, _.h3("AI Provider Predefinito"), _.span({ class: "tl-settings-status is-online" }, dot(settingsState.providers.length ? "online" : "warn"), settingsState.providers.length ? "Connesso" : "Non configurato")),
    _.div(
      { class: "tl-settings-ai-provider-row" },
      renderSelect("Provider", readPath("ai.provider"), [
        option("OpenAI"),
        option("Anthropic"),
        option("Gemini"),
        option("Ollama"),
        option("LM Studio"),
        ...settingsState.providers.map((provider) => option(provider.name)),
      ], handleAiProviderChange),
      _.div(
        { class: "tl-settings-ai-model-picker" },
        renderSelect(
          settingsState.aiModels.loading ? "Loading models..." : "Available models",
          settingsState.aiModels.selected,
          settingsState.aiModels.items.length
            ? settingsState.aiModels.items.map((model) => option(model))
            : [option("", settingsState.aiModels.loading ? "Loading..." : "No models loaded")],
          (value) => {
            settingsState.aiModels.selected = value;
            patchSettingsAiPanel();
          }
        ),
        btn({
          class: "st-btn-primary tl-settings-model-set",
          disabled: !settingsState.aiModels.selected || settingsState.aiModels.loading,
          onclick: setSelectedAiModelAsDefault,
        }, icon("check", "sm"), "Set")
      )
    ),
    _.div(
      { class: `tl-settings-ai-model-meta${settingsState.aiModels.error ? " is-error" : ""}` },
      settingsState.aiModels.loading
        ? [icon("hourglass_empty", "sm"), _.span("Fetching model list from selected provider...")]
        : settingsState.aiModels.error
          ? [icon("warning", "sm"), _.span(settingsState.aiModels.error), btn({ class: "st-btn-primary tl-settings-model-refresh", onclick: () => loadAiModelsForSelectedProvider({ force: true }) }, icon("refresh", "sm"), "Retry")]
          : settingsState.aiModels.items.length
            ? [icon("dns", "sm"), _.span(`${settingsState.aiModels.items.length} models available`), btn({ class: "st-btn-primary tl-settings-model-refresh", onclick: () => loadAiModelsForSelectedProvider({ force: true }) }, icon("refresh", "sm"), "Refresh")]
            : [icon("info", "sm"), _.span("Select a local provider to load models automatically."), btn({ class: "st-btn-primary tl-settings-model-refresh", onclick: () => loadAiModelsForSelectedProvider({ force: true }) }, icon("refresh", "sm"), "Load")]
    ),
    renderField("Modello predefinito", renderSettingInput("ai.model")),
    renderToggleRow("Local AI first", Boolean(settingsState.settings.ai.localFirst), (checked) => mutateSetting("ai.localFirst", Boolean(checked), { persist: true })),
    renderSettingRange("Temperatura", "ai.temperature", 0, 2, 0.01),
    renderField("Token massimi", renderSettingNumber("ai.maxTokens", { min: 1 })),
    btn({ class: "st-btn-primary", onclick: testAiConnection }, icon("radar", "sm"), "Testa Connessione")
  );

const renderConnections = () =>
  _.Card(
    buildPanelProps("connections", "tl-settings-panel tl-settings-connections"),
    _.h3("Impostazioni Connessioni"),
    _.Grid(
      { cols: 2, gap: 12 },
      renderField("Timeout predefinito", renderSettingInput("connections.timeout", { type: "number" })),
      renderField("Retry tentativi", renderSettingInput("connections.retries", { type: "number" })),
      renderField("Intervallo ping", renderSettingInput("connections.pingInterval", { type: "number" })),
      renderField("Proxy", renderSettingInput("connections.proxy"))
    ),
    renderSettingToggle("Riconnessione automatica", "connections.autoReconnect"),
    renderSettingToggle("SSL verification", "connections.sslVerification"),
    _.p({ class: "tl-settings-meta" }, `${settingsState.connections.length} connessioni reali in tl_connections`)
  );

const renderStorage = () =>
  _.Card(
    buildPanelProps("storage", "tl-settings-panel tl-settings-storage"),
    _.h3("Archiviazione & Cache"),
    _.div(
      { class: "tl-settings-storage-grid" },
      _.div(
        { class: "tl-settings-donut", style: { "--value": `${settingsState.storage.percent}%` } },
        _.strong(`${settingsState.storage.percent}%`),
        _.span("Utilizzato")
      ),
      _.div(
        { class: "tl-settings-storage-lines" },
        ...[
          ["SQLite", formatBytes(settingsState.storage.usage), "gold"],
          ["Cache", settingsState.stores.includes("tl_cache") ? "Store presente" : "N/D", "blue"],
          ["Logs", settingsState.stores.includes("tl_ai_logs") ? "tl_ai_logs" : "N/D", "gold"],
          ["Altri Dati", `${settingsState.stores.length} store`, "green"],
        ].map(([label, value, tone]) => _.p(_.span({ class: `tl-settings-key is-${tone}` }), _.span(label), _.strong(value)))
      )
    ),
    _.div({ class: "tl-settings-storage-used" }, _.span("Spazio Utilizzato"), _.strong(`${settingsState.storage.usedLabel} / ${settingsState.storage.quotaLabel}`)),
    renderSettingSelect("Mantieni Logs", "storage.keepLogs", [option("7", "7 giorni"), option("30", "30 giorni"), option("90", "90 giorni")]),
    _.Grid(
      { cols: 2, gap: 12 },
      renderField("Eventi runtime max", renderSettingInput("storage.runtimeEventLimit", { type: "number", min: 0 })),
      renderField("Flow logs max", renderSettingInput("storage.runtimeFlowLogLimit", { type: "number", min: 0 }))
    ),
    renderSettingToggle("Compressione Dati", "storage.compression"),
    renderSettingToggle("Cleanup automatico", "storage.autoCleanup"),
    btn({ class: "st-btn-primary", onclick: applyRuntimeRetention }, icon("cleaning_services", "sm"), "Applica retention runtime")
  );

const desktopPersistenceLabel = () => {
  const state = settingsState.desktopPersistence || { loading: false, status: null, error: "" };
  if (state.loading) return ["Analisi SQLite in corso", "warn"];
  if (state.error) return ["Diagnostica non disponibile", "error"];
  if (!state.status?.available) return ["Disponibile solo nell'app desktop", "warn"];
  return [state.status.status?.mode || "desktop-sqlite", "online"];
};

const desktopBridgeSummary = () => {
  const diagnostic = settingsState.desktopPersistence?.status?.diagnostic;
  if (!diagnostic) return "Bridge non ancora analizzato";
  const desktopKeys = diagnostic.desktopKeys.length ? diagnostic.desktopKeys.join(", ") : "nessuna";
  const legacyKeys = diagnostic.legacyKeys.length ? diagnostic.legacyKeys.join(", ") : "nessuna";
  return `Renderer: ${diagnostic.renderer} · trackers.desktop: ${desktopKeys} · trackersDesktop: ${legacyKeys}`;
};

const renderDesktopPersistence = () => {
  const state = settingsState.desktopPersistence || { loading: false, status: null, error: "" };
  const [label, tone] = desktopPersistenceLabel();
  return _.Card(
    buildPanelProps("desktop-persistence", "tl-settings-panel tl-settings-desktop-persistence", { "data-settings-desktop-persistence-panel": "true" }),
    _.Row(
      { align: "center", justify: "space-between" },
      _.div(_.h3("SQLite desktop"), _.p("Persistenza desktop gestita da TL Core.")),
      _.span({ class: `tl-settings-status is-${tone}` }, dot(tone), label)
    ),
    state.error ? _.p({ class: "tl-settings-error" }, state.error) : null,
    !state.status?.available && state.status?.error ? _.p({ class: "tl-settings-error" }, `Errore bridge: ${state.status.error}`) : null,
    _.p("Modalità attiva: ", _.strong(state.status?.status?.mode || "desktop-sqlite")),
    _.p("SQLite: ", _.strong(state.status?.status?.sqlite?.exists ? "candidato presente" : "nessun database creato")),
    _.p({ class: "tl-settings-desktop-bridge-debug" }, "Debug bridge: ", _.code(desktopBridgeSummary())),
    _.p({ class: "tl-settings-desktop-bridge-debug" }, "SQLite viene inizializzato all'avvio dell'app desktop e resta l'unica persistenza desktop.")
  );
};

const patchDesktopPersistencePanel = () => {
  const panel = document.querySelector("[data-settings-desktop-persistence-panel]");
  if (panel) panel.replaceWith(renderDesktopPersistence());
  syncSettingsNavigation();
};

const loadDesktopPersistenceStatus = async () => {
  const persistence = window.trackers?.desktop?.persistence;
  const diagnostic = {
    renderer: /Electron\//i.test(navigator.userAgent) ? "electron" : "browser",
    desktopKeys: window.trackers?.desktop ? Object.keys(window.trackers.desktop).sort() : [],
    legacyKeys: window.trackersDesktop ? Object.keys(window.trackersDesktop).sort() : [],
  };
  if (!persistence?.getStatus) {
    settingsState.desktopPersistence = { ...settingsState.desktopPersistence, status: { available: false, reason: "desktop-bridge-unavailable", diagnostic } };
    return;
  }
  try {
    const status = await persistence.getStatus();
    settingsState.desktopPersistence = { ...settingsState.desktopPersistence, status: { available: true, status, diagnostic }, error: "" };
  } catch (error) {
    settingsState.desktopPersistence = { ...settingsState.desktopPersistence, status: { available: false, diagnostic, error: error?.message || "Errore IPC" }, error: error?.message || "Errore SQLite" };
  }
};

const renderNotifications = () =>
  _.Card(
    buildPanelProps("notifications", "tl-settings-panel tl-settings-notifications"),
    _.h3("Notifiche"),
    renderSettingToggle("Notifiche Desktop", "notifications.desktop"),
    renderSettingToggle("Notifiche Email", "notifications.email"),
    renderSettingToggle("Avvisi Errori", "notifications.errors"),
    renderSettingToggle("Avvisi Performance", "notifications.performance"),
    renderSettingToggle("Riepilogo Giornaliero", "notifications.dailySummary"),
    renderField("Email notifiche", renderSettingInput("notifications.emailAddress")),
    btn({ class: "st-btn-primary", onclick: testNotifications }, icon("mail", "sm"), "Testa Notifiche")
  );

const runtimeServices = () => {
  const hasConnections = settingsState.connections.length > 0;
  const hasProviders = settingsState.providers.length > 0;
  const hasBackup = Boolean(settingsState.settings.backup.lastBackupAt);
  return [
    ["Tracker Engine", settingsState.error ? "Warning" : "Attivo", settingsState.error ? "warn" : "online", "deployed_code"],
    ["WebSocket Server", hasConnections ? "Connesso" : "Idle", hasConnections ? "online" : "warn", "settings_ethernet"],
    ["Event Bus", "Attivo", "online", "hub"],
    ["SQLite", settingsState.stores.includes(SETTINGS_STORE) ? "Connesso" : "Warning", settingsState.stores.includes(SETTINGS_STORE) ? "online" : "warn", "database"],
    ["Cache System", settingsState.stores.includes("tl_cache") ? "Attivo" : "N/D", settingsState.stores.includes("tl_cache") ? "online" : "warn", "inventory_2"],
    ["AI Engine", hasProviders ? "Attivo" : "Non configurato", hasProviders ? "online" : "warn", "psychology"],
    ["Notification System", settingsState.settings.notifications.desktop || settingsState.settings.notifications.email ? "Attivo" : "Inattivo", settingsState.settings.notifications.desktop || settingsState.settings.notifications.email ? "online" : "warn", "notifications_active"],
    ["Backup Service", hasBackup || settingsState.settings.backup.automatic ? "Attivo" : "Warning", hasBackup || settingsState.settings.backup.automatic ? "online" : "warn", "backup"],
    ["Log System", settingsState.stores.includes("tl_ai_logs") ? "Attivo" : "Idle", settingsState.stores.includes("tl_ai_logs") ? "online" : "warn", "receipt_long"],
  ];
};

const renderSystemStatus = () =>
  _.aside(
    buildPanelProps("status", "tl-settings-panel tl-settings-status-panel"),
    _.h3("Stato Sistema"),
    _.div(
      { class: "tl-settings-service-list" },
      ...runtimeServices().map(([name, state, tone, iconName]) =>
        _.div(
          { class: `tl-settings-service is-${tone}` },
          _.span({ class: "tl-settings-service-icon" }, icon(iconName, "sm")),
          _.strong(name),
          _.em(dot(tone), state)
        )
      )
    )
  );

const renderQuickActions = () =>
  _.aside(
    { class: "tl-settings-panel tl-settings-quick" },
    _.h3("Azioni Rapide"),
    ...[
      ["Esporta Configurazione", "download", exportConfiguration],
      ["Importa Configurazione", "upload", importConfiguration],
      ["Reset Impostazioni", "restart_alt", resetSettings],
      ["Pulisci Cache", "delete_sweep", clearCacheStore],
      ["Ottimizza Database", "speed", refreshSettings],
      ["Verifica Integrita Sistema", "verified", runDiagnostics],
    ].map(([label, iconName, onclick]) => btn({ class: "tl-settings-action", onclick }, icon(iconName, "sm"), label, icon("chevron_right", "sm")))
  );

const renderBackup = () => {
  const schedule = getBackupSchedule();
  return _.Card(
    buildPanelProps("backup", "tl-settings-panel tl-settings-backup", { "data-settings-backup-panel": "true" }),
    _.Row(
      { class: "tl-settings-backup-heading", align: "center", justify: "space-between" },
      _.h3("Backup & Ripristino"),
      _.span({ class: `tl-settings-status is-${schedule.tone}` }, dot(schedule.tone), settingsState.settings.backup.automatic ? "Automatico" : "Manuale")
    ),
    _.div(
      { class: "tl-settings-backup-overview" },
      _.div(
        { class: "tl-settings-backup-hero" },
        _.span({ class: "tl-settings-backup-orb" }, icon("backup", "md")),
        _.div(
          { class: "tl-settings-backup-hero-copy" },
          _.small("Ultimo Backup"),
          _.strong(schedule.lastLabel)
        ),
        _.div(
          { class: "tl-settings-backup-hero-copy tl-settings-backup-hero-status" },
          _.small("Stato locale"),
          _.strong(schedule.agoLabel),
          _.span({ class: "tl-settings-backup-size" }, `Dimensione ${formatBytes(settingsState.settings.backup.lastBackupSize)}`)
        )
      ),
      _.div(
        { class: "tl-settings-backup-timeline" },
        _.div(
          { class: "tl-settings-backup-step is-done" },
          _.span({ class: "tl-settings-backup-step-dot" }, icon("check", "sm")),
          _.div(_.small("Eseguito"), _.strong(schedule.agoLabel))
        ),
        _.div({ class: "tl-settings-backup-line", "aria-hidden": "true" }),
        _.div(
          { class: `tl-settings-backup-step is-${schedule.tone}` },
          _.span({ class: "tl-settings-backup-step-dot" }, icon("schedule", "sm")),
          _.div(_.small("Prossimo backup"), _.strong(schedule.nextInLabel), _.em(schedule.nextLabel))
        )
      )
    ),
    _.div(
      { class: "tl-settings-backup-settings" },
      renderToggleRow("Backup automatico", Boolean(settingsState.settings.backup.automatic), (checked) => {
        mutateSetting("backup.automatic", Boolean(checked), { persist: true });
        patchSettingsBackupPanel();
      }),
      renderSelect("Frequenza backup", readPath("backup.frequency"), [option("daily", "Giornaliero"), option("weekly", "Settimanale"), option("manual", "Manuale")], (value) => {
        mutateSetting("backup.frequency", value, { persist: true });
        patchSettingsBackupPanel();
      }),
      renderSelect("Retention", readPath("backup.retention"), [option("7", "7 giorni"), option("30", "30 giorni"), option("90", "90 giorni")], (value) => {
        mutateSetting("backup.retention", value, { persist: true });
        patchSettingsBackupPanel();
      })
    ),
    _.Toolbar({ class: "tl-settings-backup-actions", gap: 10 }, btn({ class: "st-btn-primary", onclick: runBackupNow }, icon("backup", "sm"), "Esegui Backup Ora"), btn({ class: "tl-settings-ghost", onclick: importConfiguration }, icon("restore", "sm"), "Ripristina Backup"))
  );
};

const patchSettingsBackupPanel = () => {
  const panel = document.querySelector("[data-settings-backup-panel]");
  if (panel) panel.replaceWith(renderBackup());
  syncSettingsNavigation();
};

const patchSettingsSecurityPanel = () => {
  const panel = document.querySelector("[data-settings-security-panel]");
  if (panel) panel.replaceWith(renderSecurity());
  syncSettingsNavigation();
};

const renderSecurity = () => {
  const search = normalizeText(settingsState.apiKeySearch).toLowerCase();
  const keys = settingsState.settings.apiKeys.filter(({ id, name, value }) =>
    !search || [id, name, maskKey(value)].some((item) => normalizeText(item).toLowerCase().includes(search))
  );
  return _.Card(
    buildPanelProps("security", "tl-settings-panel tl-settings-security", { "data-settings-security-panel": "true" }),
    _.div(
      { class: "tl-settings-security-head" },
      _.div(_.h3("Sicurezza & API Keys"), _.p("Gestisci le chiavi API e le credenziali dei servizi")),
      _.div(
        { class: "tl-settings-security-search" },
        _.Search({
          class: "tl-settings-security-search-input",
          label: "Cerca chiave...",
          value: settingsState.apiKeySearch,
          "aria-label": "Cerca chiave API",
          onInput: (event) => {
            settingsState.apiKeySearch = event.target.value;
            patchSettingsSecurityPanel();
          },
        })
      ),
      btn({ class: "st-btn-primary tl-settings-security-add", onclick: addApiKey }, icon("add", "sm"), "Aggiungi Nuova Chiave")
    ),
    _.div(
      { class: "tl-settings-key-list" },
      ...(keys.length
        ? keys.map(({ id, name, value, tone }) =>
            _.div(
              { class: "tl-settings-api-row" },
              _.span({ class: `tl-settings-api-orb is-${tone}` }, icon("key", "sm")),
              _.strong(name),
              _.code(maskKey(value)),
              btn({ class: "tl-settings-row-btn", "aria-label": `Modifica ${name}`, onclick: () => editApiKey(id) }, icon("edit", "sm")),
              btn({ class: "tl-settings-row-btn", "aria-label": `Elimina ${name}`, onclick: () => clearApiKey(id) }, icon("delete", "sm"))
            )
          )
        : [
            _.div(
              { class: "tl-settings-security-empty" },
              icon("search_off", "md"),
              _.strong("Nessuna chiave trovata"),
              _.span("Modifica la ricerca o aggiungi una nuova chiave API.")
            ),
          ])
    )
  );
};

const renderSystemInfo = () => {
  const memory = performance?.memory;
  const usedMemory = memory?.usedJSHeapSize ? formatBytes(memory.usedJSHeapSize) : "N/D";
  const totalMemory = memory?.jsHeapSizeLimit ? formatBytes(memory.jsHeapSizeLimit) : "N/D";
  const platform = navigator.userAgentData?.platform || navigator.platform || "Browser";
  const architecture = navigator.userAgentData?.architecture || (/\b(?:x86_64|Win64|x64|amd64)\b/i.test(navigator.userAgent) ? "x64" : "Browser");
  return _.aside(
    buildPanelProps("system", "tl-settings-panel tl-settings-system"),
    _.h3("Informazioni Sistema"),
    ...[
      ["Versione Trackers Lens", (typeof tlConfig !== "undefined" ? tlConfig.VERSION : null) || "v1.0.0"],
      ["Ambiente", /Electron\//i.test(navigator.userAgent) ? "Electron Desktop" : location.protocol === "chrome-extension:" ? "Extension" : "Browser"],
      ["Piattaforma", platform],
      ["Architettura", architecture],
      ["User Agent", navigator.userAgent.split(" ").slice(-2).join(" ")],
      ["Memoria totale", totalMemory],
      ["Utilizzo Memoria", usedMemory],
    ].map(([label, value]) => _.p(_.span(label), _.strong(value))),
    btn({ class: "st-btn-primary", onclick: runDiagnostics }, icon("fact_check", "sm"), "Diagnostica Sistema")
  );
};

const renderFooter = () =>
  _.footer(
    { class: "tl-settings-footer", "data-settings-footer": "true" },
    _.span(dot(settingsState.error ? "error" : "online"), settingsState.error ? "System Warning" : "System Online"),
    _.span(dot(settingsState.stores.includes(SETTINGS_STORE) ? "online" : "warn"), settingsState.stores.includes(SETTINGS_STORE) ? "SQLite Connected" : "SQLite Warning"),
    _.span(`Memory Usage ${performance?.memory?.usedJSHeapSize ? formatBytes(performance.memory.usedJSHeapSize) : "N/D"}`),
    _.span(`Cache Status ${settingsState.stores.includes("tl_cache") ? "Available" : "N/D"}`),
    _.span(`Query ${settingsState.queryMs}ms`),
    _.span(`Last Update ${settingsState.updatedAt.toLocaleTimeString("it-IT")}`),
    _.span({ class: "tl-settings-footer-pulse", "aria-hidden": "true" })
  );

const patchSettingsRuntimeChrome = () => {
  settingsState.updatedAt = new Date();
  setRuntimeChromeSignal({
    error: settingsState.error,
    notice: settingsState.notice,
    updatedAt: settingsState.updatedAt,
    queryMs: settingsState.queryMs,
  });
  const livePill = document.querySelector("[data-settings-live-pill]");
  if (livePill) {
    livePill.replaceChildren(
      dot(settingsState.error ? "error" : "online"),
      settingsState.error || settingsState.notice || "Sistema Online"
    );
  }
  const footer = document.querySelector("[data-settings-footer]");
  if (footer) footer.replaceWith(renderFooter());
};

const renderShell = () =>
  _.div(
    { class: `tl-settings-shell${settingsEmbedded ? " is-embedded" : ""}` },
    renderTopbar(),
    _.div(
      { class: "tl-settings-body" },
      settingsEmbedded ? null : renderSidebar(),
      _.main(
        { class: "tl-settings-main" },
        _.div({ class: "tl-settings-grid-bg", "aria-hidden": "true" }),
        renderHeader(),
        renderCategorySidebar(),
        renderQuickActions(),
        _.section(
          { class: "tl-settings-content-grid", "aria-label": "Pannelli impostazioni" },
          renderGeneral(),
          renderSystemInfo(),
          renderSystemStatus(),
          renderConnections(),
          renderAiProvider(),
          renderStorage(),
          renderDesktopPersistence(),
          renderNotifications(),
          renderBackup(),
          renderSecurity()
        ),
        renderFooter()
      )
    )
  );

const loadSettingsStores = async () => {
  const started = performance.now();
  const record = await getSettingsRecord();
  settingsState.settings = mergeSettings(record || {});
  setSettingsSignal(clone(settingsState.settings));
  settingsState.createdAt = record?.createdAt || "";

  const persistence = await ensureSettingsStore();
  settingsState.stores = (await persistence.listDevelopmentStores()).map((store) => store.name);
  const fallbackConnections = await readAllFromDb(persistence, "tl_connections").catch(() => []);
  const providersResult = await withTimeout(
    window.TrackerLensAiRuntimeStore?.list?.().catch(() => null) || Promise.resolve(null),
    1600,
    "ai-runtime"
  );
  settingsState.providers = providersResult?.__timeout ? [] : providersResult?.providers || [];
  const connectionsResult = window.TrackerLensConnectionsStore?.list
    ? await withTimeout(window.TrackerLensConnectionsStore.list().catch(() => fallbackConnections), 1600, "connections")
    : fallbackConnections;
  settingsState.connections = connectionsResult?.__timeout ? fallbackConnections : connectionsResult;
  if (providersResult?.__timeout || connectionsResult?.__timeout) {
    settingsState.error = "Alcuni repository SQLite non hanno risposto in tempo";
  }
  settingsState.queryMs = Math.max(1, Math.round(performance.now() - started));
};

const updateStorageEstimate = async () => {
  if (!navigator.storage?.estimate) return;
  try {
    const estimate = await navigator.storage.estimate();
    const quota = estimate.quota || 0;
    const usage = estimate.usage || 0;
    if (!quota) return;
    const gb = 1024 * 1024 * 1024;
    settingsState.storage = {
      usage,
      quota,
      usedLabel: `${(usage / gb).toFixed(2)} GB`,
      quotaLabel: `${(quota / gb).toFixed(1)} GB`,
      percent: Math.min(99, Math.max(1, Math.round((usage / quota) * 100))),
    };
  } catch {
    return;
  }
};

const refreshSettings = async () => {
  try {
    settingsState.error = "";
    settingsState.notice = "Dati aggiornati";
    await loadSettingsStores();
    await loadPythonRuntimeCatalog();
    await updateStorageEstimate();
    await loadDesktopPersistenceStatus();
  } catch (error) {
    settingsState.error = error?.message || "Errore aggiornamento impostazioni";
  }
  mountSettings();
};

const exportConfiguration = () => {
  const payload = {
    exportedAt: new Date().toISOString(),
    version: (typeof tlConfig !== "undefined" ? tlConfig.VERSION : null) || "0.0.1",
    settings: clone(settingsState.settings),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `tracker-lens-settings-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  settingsState.notice = "Configurazione esportata";
  patchSettingsRuntimeChrome();
};

const importConfiguration = () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      settingsState.settings = mergeSettings(payload.settings || payload);
      setSettingsSignal(clone(settingsState.settings));
      await saveSettings(true);
      settingsState.notice = "Configurazione importata";
    } catch (error) {
      settingsState.error = error?.message || "Import configurazione non valido";
    }
    mountSettings();
  };
  input.click();
};

const resetSettings = async () => {
  settingsState.settings = clone(defaultSettings);
  setSettingsSignal(clone(settingsState.settings));
  settingsState.notice = "Impostazioni ripristinate";
  await saveSettings(true);
  mountSettings();
};

const clearStore = async (storeName) => {
  const persistence = await ensureSettingsStore();
  const records = await readAllFromDb(persistence, storeName);
  const ids = records.map((record) => record.id).filter(Boolean);
  if (!ids.length) return 0;
  await persistence.deleteDevelopmentRecords({ storeName, ids });
  return ids.length;
};

const clearCacheStore = async () => {
  try {
    const cleaned = await clearStore("tl_offline_cache");
    settingsState.notice = cleaned ? "Cache SQLite pulita" : "Cache SQLite già vuota";
  } catch (error) {
    settingsState.error = error?.message || "Errore pulizia cache";
  }
  await refreshSettings();
};

const applyRuntimeRetention = async () => {
  try {
    await saveSettings(true);
    const policy = await window.TrackerLensEventLogStore?.readRetentionPolicy?.();
    if (!policy) throw new Error("Event Log Store non disponibile");
    await window.TrackerLensEventLogStore.applyRetentionPolicy(policy);
    settingsState.notice = `Retention runtime applicata: ${policy.eventLimit} eventi, ${policy.flowLogLimit} flow logs`;
    settingsState.error = "";
  } catch (error) {
    settingsState.error = error?.message || "Errore retention runtime";
  }
  patchSettingsRuntimeChrome();
};

const runBackupNow = async () => {
  const serialized = JSON.stringify(settingsState.settings);
  settingsState.settings.backup.lastBackupAt = new Date().toISOString();
  settingsState.settings.backup.lastBackupSize = new Blob([serialized]).size;
  setSettingsSignal(clone(settingsState.settings));
  settingsState.notice = "Backup configurazione creato";
  await saveSettings(true);
  patchSettingsBackupPanel();
  patchSettingsRuntimeChrome();
};

const runDiagnostics = async () => {
  settingsState.notice = `Diagnostica OK: ${settingsState.stores.length} store, ${settingsState.connections.length} connessioni, ${settingsState.providers.length} provider AI`;
  settingsState.error = "";
  patchSettingsRuntimeChrome();
};

const testAiConnection = () => {
  const provider = settingsState.providers.find((item) => item.name === settingsState.settings.ai.provider);
  settingsState.notice = provider ? `Provider ${provider.name}: ${provider.status || "configurato"}` : "Provider salvato, nessun record runtime reale trovato";
  patchSettingsRuntimeChrome();
};

const testNotifications = () => {
  settingsState.notice = settingsState.settings.notifications.desktop || settingsState.settings.notifications.email
    ? "Preferenze notifiche attive"
    : "Notifiche disattivate";
  patchSettingsRuntimeChrome();
};

const editApiKey = async (id) => {
  const item = settingsState.settings.apiKeys.find((key) => key.id === id);
  if (!item) return;
  const nextValue = window.prompt(`Chiave per ${item.name}`, item.value || "");
  if (nextValue === null) return;
  item.value = nextValue.trim();
  setSettingsSignal(clone(settingsState.settings));
  settingsState.notice = `${item.name} aggiornata`;
  await saveSettings(true);
  patchSettingsSecurityPanel();
  patchSettingsRuntimeChrome();
};

const clearApiKey = async (id) => {
  const item = settingsState.settings.apiKeys.find((key) => key.id === id);
  if (!item) return;
  item.value = "";
  setSettingsSignal(clone(settingsState.settings));
  settingsState.notice = `${item.name} rimossa`;
  await saveSettings(true);
  patchSettingsSecurityPanel();
  patchSettingsRuntimeChrome();
};

const addApiKey = async () => {
  const name = window.prompt("Nome nuova chiave API");
  if (!name) return;
  const value = window.prompt(`Valore per ${name}`) || "";
  settingsState.settings.apiKeys.push({
    id: `key_${Date.now()}`,
    name: name.trim(),
    value: value.trim(),
    tone: "gold",
  });
  setSettingsSignal(clone(settingsState.settings));
  settingsState.notice = "Nuova chiave API aggiunta";
  await saveSettings(true);
  patchSettingsSecurityPanel();
  patchSettingsRuntimeChrome();
};

const mountSettings = () => {
  const root = settingsRoot || document.getElementById("tl-settings-root");
  if (!root) return;
  settingsState.updatedAt = new Date();
  root.replaceChildren(renderShell());
  syncSettingsNavigation();
};

const bootSettings = async () => {
  settingsState.loading = false;
  mountSettings();
  try {
    const loaded = await withTimeout(loadSettingsStores(), 2200, "settings-store");
    if (loaded?.__timeout) {
      settingsState.error = "Timeout caricamento store impostazioni";
    }
    await updateStorageEstimate();
    await loadPythonRuntimeCatalog();
    await loadDesktopPersistenceStatus();
    if (!settingsState.error) settingsState.error = "";
  } catch (error) {
    settingsState.error = error?.message || "Errore caricamento impostazioni";
  }
  mountSettings();
};

window.TrackerLensViews = window.TrackerLensViews || {};
window.TrackerLensViews.settings = {
  async mount({ outlet }) {
    settingsRoot = outlet;
    settingsEmbedded = true;
    window.TrackerLensAppShell?.setActive?.("settings");
    await bootSettings();
  },
  dispose() {
    settingsSectionObserver?.disconnect();
    settingsRoot?.replaceChildren();
    settingsRoot = null;
    settingsEmbedded = false;
  },
};

if (!window.TrackerLensAppRouter) {
  if (window.CMSwift?.ready) CMSwift.ready(bootSettings);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      if (!document.getElementById("tl-settings-root")?.children.length) bootSettings();
    }, { once: true });
  } else {
    window.setTimeout(() => {
      if (!document.getElementById("tl-settings-root")?.children.length) bootSettings();
    }, 0);
  }
}
})();
