const icon = (name, size = "md") => _.Icon({ name, size });
const btn = (props, ...children) => _.Btn({ type: "button", ...props }, ...children);
const dot = (tone = "online") => _.span({ class: `tl-ai-dot is-${tone}`, "aria-hidden": "true" });

const formatNumber = (value) => new Intl.NumberFormat("it-IT").format(Math.max(0, Math.round(value || 0)));
const timeLabel = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "Mai";
  return date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};
const durationLabel = (ms = 0) => {
  const value = Number(ms) || 0;
  if (!value) return "-";
  if (value < 1000) return `${value}ms`;
  return `${Math.round(value / 1000)}s`;
};
const providerLatency = (value = 0) => value ? `${Math.round(value)}ms` : "n/d";
const statusTone = (status = "") => window.TrackerLensAiRuntimeStore?.statusTone?.(status) || "warn";
const sourceLabel = (status = "") => {
  const value = String(status || "").toLowerCase();
  if (["active", "running", "online", "success", "completed", "complete", "done"].includes(value)) return "Attivo";
  if (["queued", "idle", "warning", "warn"].includes(value)) return value === "queued" ? "In Coda" : "Idle";
  if (["error", "failed", "timeout", "offline"].includes(value)) return "Errore";
  return status || "Idle";
};

let aiRuntimeMeta = {
  loading: true,
  error: "",
  queryMs: 0,
  lastUpdate: "",
  indexedDb: "Loading",
};

let metrics = [
  { label: "Modelli Attivi", value: "4", delta: "+2 attivi", source: "demo", tone: "gold", icon: "psychology" },
  { label: "AI Jobs Attivi", value: "12", delta: "+3 da ieri", source: "demo", tone: "green", icon: "radar" },
  { label: "Richieste AI / min", value: "128", delta: "+18.4%", source: "demo", tone: "blue", icon: "rocket_launch" },
  { label: "Token Utilizzati (oggi)", value: "1.2M", delta: "+21.7%", source: "demo", tone: "gold", icon: "database" },
  { label: "Success Rate", value: "97.6%", delta: "+2.1%", source: "demo", tone: "green", icon: "verified_user" },
  { label: "Error Rate", value: "2.4%", delta: "-1.3%", source: "demo", tone: "red", icon: "report" },
  { label: "Costo Stimato (oggi)", value: "$0.82", delta: "+11.3%", source: "demo", tone: "gold", icon: "toll" },
];

let agents = [
  { id: "demo_market", name: "Market Analyzer", description: "Analizza mercati crypto in tempo reale", state: "Attivo", status: "online", icon: "monitoring" },
  { id: "demo_news", name: "News Summarizer", description: "Riassume news da fonti RSS", state: "Attivo", status: "online", icon: "article" },
  { id: "demo_sentiment", name: "Sentiment Analyzer", description: "Analizza sentiment social e news", state: "Attivo", status: "online", icon: "sentiment_satisfied" },
  { id: "demo_automation", name: "Automation Agent", description: "Crea automazioni e trigger intelligenti", state: "Warning", status: "warn", icon: "bolt" },
  { id: "demo_workspace", name: "Workspace Assistant", description: "Aiuta a costruire workspace e box", state: "Attivo", status: "online", icon: "dashboard_customize" },
  { id: "demo_endpoint", name: "Endpoint Debugger", description: "Monitora e risolve problemi endpoint", state: "Offline", status: "error", icon: "bug_report" },
];

let providers = [
  ["OpenAI", "gpt-4.1-mini", "Online", "324ms", "online", "all_inclusive"],
  ["Anthropic", "claude-3-5-sonnet", "Online", "412ms", "online", "neurology"],
  ["Google Gemini", "gemini-1.5-pro", "Online", "298ms", "online", "auto_awesome"],
  ["Ollama (Local)", "llama3.1:70b", "Online", "45ms", "online", "memory"],
  ["LM Studio (Local)", "mistral-nemo:latest", "Online", "62ms", "online", "dns"],
];

let jobs = [
  ["job_8f71a2", "Market Analyzer", "Analizza BTC trend", "In Esecuzione", "12:32:15", "14s", "1.2K", "online"],
  ["job_8f71a3", "News Summarizer", "Riassumi 5 news", "In Esecuzione", "12:32:10", "18s", "856", "online"],
  ["job_8f71a4", "Sentiment Analyzer", "Analizza sentiment", "In Coda", "12:32:20", "-", "-", "warn"],
  ["job_8f71a5", "Automation Agent", "Valuta trigger", "In Esecuzione", "12:32:05", "27s", "1.5K", "online"],
  ["job_8f71a6", "Workspace Assistant", "Suggerisci layout", "Completato", "12:31:55", "22s", "743", "complete"],
  ["job_8f71a7", "Endpoint Debugger", "Diagnostica CoinGecko", "Errore", "12:31:40", "10s", "412", "error"],
];

let logs = [
  ["12:32:18", "Market Analyzer", "Analisi completata con successo", "ai"],
  ["12:32:17", "Sentiment Analyzer", "Sentiment score: 72% bullish", "success"],
  ["12:32:16", "News Summarizer", "5 news riassunte in 18s", "success"],
  ["12:32:15", "Automation Agent", "Trigger valutato: BTC_DROP", "warn"],
  ["12:32:14", "Workspace Assistant", "Layout suggerito generato", "ai"],
  ["12:32:12", "Endpoint Debugger", "API CoinGecko timeout (10s)", "error"],
  ["12:32:09", "Prompt Cache", "Context window ottimizzata", "success"],
  ["12:32:06", "Runtime Core", "Routing provider completato", "ai"],
];

let memory = [
  ["Mercato BTC", "Ultimo update: 2 min fa", "24 items", "psychology"],
  ["News Crypto", "Ultimo update: 5 min fa", "18 items", "article"],
  ["Sentiment Data", "Ultimo update: 2 min fa", "32 items", "sentiment_satisfied"],
  ["Workspace Context", "Ultimo update: 1 ora fa", "12 items", "deployed_code"],
];

let workspaceActivity = [
  ["Crypto Dashboard", 92, "142"],
  ["News Monitor", 70, "98"],
  ["DeFi Analyzer", 54, "76"],
  ["Social Sentiment", 42, "54"],
  ["Market Overview", 31, "38"],
];

const promptTone = (index = 0, tone = "") => {
  const normalized = String(tone || "").toLowerCase();
  if (["green", "blue", "gold"].includes(normalized)) return normalized;
  if (["purple", "violet"].includes(normalized)) return "gold";
  return ["gold", "blue", "green", "gold"][index % 4];
};

const buildPrompts = (flows = []) => {
  const records = Array.isArray(flows) ? flows : [];
  if (!records.length) {
    return [{
      id: "",
      name: "Nessun prompt salvato",
      description: "Crea il primo prompt locale in tl_ai_prompt_flows",
      prompt: "",
      category: "Generale",
      icon: "psychology",
      tone: "gold",
      updatedAt: "",
      placeholder: true,
    }];
  }
  return records
    .slice()
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
    .map((item, index) => ({
      id: item.id,
      name: item.name || "Prompt",
      description: item.description || item.prompt || "Prompt salvato",
      prompt: item.prompt || item.blocks?.[0]?.prompt || "",
      category: item.category || "Generale",
      icon: item.icon || "psychology",
      tone: promptTone(index, item.tone),
      updatedAt: item.updatedAt || "",
      placeholder: false,
    }));
};

let prompts = buildPrompts();
const getStoredAiUiPref = (key, fallback = "") => {
  try {
    return localStorage.getItem(`tl_ai_${key}`) || fallback;
  } catch {
    return fallback;
  }
};
const setStoredAiUiPref = (key, value) => {
  try {
    localStorage.setItem(`tl_ai_${key}`, value);
  } catch {
    // Ignore storage restrictions; view state still works for the current session.
  }
};
let promptListSearchQuery = "";
let promptCategoryFilter = "all";
let promptSearchQuery = "";
let promptViewMode = getStoredAiUiPref("prompt_view_mode", "grid") === "list" ? "list" : "grid";
let agentListSearchQuery = "";
let agentStatusFilter = "all";
let agentSearchQuery = "";
let agentViewMode = getStoredAiUiPref("agent_view_mode", "grid") === "list" ? "list" : "grid";
let globalSearchQuery = "";
let providerListSearchQuery = "";
let jobListSearchQuery = "";
let logListSearchQuery = "";
let memoryListSearchQuery = "";

const buildRuntimeViewModel = (data, queryMs = 0) => {
  const activeProviders = data.providers.filter((item) => statusTone(item.status) === "online").length;
  const runningJobs = data.jobs.filter((item) => ["online", "warn"].includes(statusTone(item.status))).length;
  const completedJobs = data.jobs.filter((item) => statusTone(item.status) === "complete").length;
  const errorJobs = data.jobs.filter((item) => statusTone(item.status) === "error").length;
  const tokenTotal = data.jobs.reduce((sum, item) => sum + (Number(item.tokens) || 0), 0);
  const activeAgents = data.agents.filter((item) => ["online", "complete"].includes(statusTone(item.status))).length;
  const aiConnections = data.connections.filter((item) => /ai|openai|anthropic|gemini|ollama|llm|prompt|agent|model|gpt|claude/i.test(`${item.name || ""} ${item.type || ""} ${item.endpoint || ""}`));
  const requestEstimate = runningJobs * 12 + aiConnections.length * 8 + activeAgents * 3;
  const totalJobs = Math.max(1, data.jobs.length);
  const successRate = data.jobs.length ? (completedJobs / totalJobs) * 100 : activeAgents ? 100 : 0;
  const errorRate = data.jobs.length ? (errorJobs / totalJobs) * 100 : 0;
  const latestUpdate = [
    ...data.jobs.map((item) => item.updatedAt || item.startedAt),
    ...data.logs.map((item) => item.updatedAt || item.time),
    ...data.agents.map((item) => item.updatedAt),
    ...data.providers.map((item) => item.updatedAt),
  ].filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || new Date().toISOString();
  const workspaceMax = Math.max(1, ...data.pages.map((page) => page.boxes.length + page.connections.length));

  return {
    meta: {
      loading: false,
      error: "",
      queryMs,
      lastUpdate: timeLabel(latestUpdate),
      indexedDb: data.stores?.length ? "Connected" : "Empty",
    },
    metrics: [
      { label: "Modelli Attivi", value: formatNumber(activeProviders), delta: `${data.providers.length} configurati`, source: "IndexedDB", tone: "gold", icon: "psychology" },
      { label: "AI Jobs Attivi", value: formatNumber(runningJobs), delta: `${data.jobs.length} totali`, source: "IndexedDB", tone: "green", icon: "radar" },
      { label: "Richieste AI / min", value: formatNumber(requestEstimate), delta: "stima locale", source: "Runtime", tone: "blue", icon: "rocket_launch" },
      { label: "Token Utilizzati (oggi)", value: formatNumber(tokenTotal), delta: data.jobs.length ? "da tl_ai_jobs" : "nessun job", source: data.jobs.length ? "IndexedDB" : "idle", tone: "gold", icon: "database" },
      { label: "Success Rate", value: `${successRate.toFixed(1)}%`, delta: `${completedJobs} completati`, source: data.jobs.length ? "AI Jobs" : "Stimato", tone: "green", icon: "verified_user" },
      { label: "Error Rate", value: `${errorRate.toFixed(1)}%`, delta: `${errorJobs} errori`, source: data.jobs.length ? "AI Jobs" : "idle", tone: "red", icon: "report" },
      { label: "Costo Stimato (oggi)", value: "$0.00", delta: "pricing non collegato", source: "Planned", tone: "gold", icon: "toll" },
    ],
    agents: data.agents.length
      ? data.agents
        .slice()
        .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
        .map((item) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          state: sourceLabel(item.status),
          status: statusTone(item.status),
          icon: item.icon || "psychology",
          color: item.color || "gold",
          category: item.category || "Runtime Intelligence",
          scope: item.scope || "template",
          workspaceId: item.workspaceId || "",
          runtime: item.runtime || {},
          provider: item.provider || {},
          channels: item.channels || {},
          metrics: item.metrics || {},
          raw: item.raw,
          placeholder: false,
        }))
      : [{
        id: "",
        name: "Nessun agente reale",
        description: "Crea record in tl_ai_agents o widget AI",
        state: "Idle",
        status: "warn",
        icon: "psychology",
        placeholder: true,
      }],
    providers: data.providers.length
      ? data.providers.map((item) => ({
        id: item.id,
        name: item.name,
        provider: item.provider,
        model: item.model,
        endpoint: item.endpoint,
        healthPath: item.healthPath,
        state: sourceLabel(item.status),
        latency: providerLatency(item.latencyMs),
        status: statusTone(item.status),
        icon: item.icon || "psychology",
        local: Boolean(item.local),
        raw: item.raw,
        placeholder: false,
      }))
      : [{ id: "", name: "Nessun provider configurato", provider: "custom", model: "tl_ai_providers", endpoint: "", healthPath: "", state: "Idle", latency: "n/d", status: "warn", icon: "dns", local: false, placeholder: true }],
    jobs: data.jobs.length
      ? data.jobs.map((item) => ({ id: item.id, agent: item.agent, task: item.task, state: sourceLabel(item.status), start: timeLabel(item.startedAt), duration: durationLabel(item.durationMs), tokens: item.tokens ? formatNumber(item.tokens) : "-", status: statusTone(item.status), raw: item.raw, result: item.result, provider: item.provider, model: item.model, prompt: item.prompt, memoryContext: item.memoryContext }))
      : [{ id: "-", agent: "Runtime AI", task: "Nessun job reale in tl_ai_jobs", state: "Idle", start: "Mai", duration: "-", tokens: "-", status: "warn", raw: null }],
    logs: data.logs.length
      ? data.logs.map((item) => ({ id: item.id, time: timeLabel(item.time), source: item.source, message: item.message, status: statusTone(item.status), raw: item.raw }))
      : [{ id: "-", time: "-", source: "AI Runtime", message: "Nessun log reale in tl_ai_logs", status: "warn", raw: null }],
    memory: data.memory.length
      ? data.memory.map((item) => ({ id: item.id, name: item.name, meta: item.meta || "Context locale", count: `${formatNumber(item.count)} items`, icon: item.icon || "database", scope: item.scope || "workspace", text: item.text || "", raw: item.raw }))
      : [{ id: "", name: "Memoria AI vuota", meta: "tl_ai_memory", count: "0 items", icon: "database", scope: "workspace", text: "", raw: null }],
    prompts: buildPrompts(data.promptFlows),
    workspaceActivity: data.pages.length
      ? data.pages
        .slice()
        .sort((a, b) => (b.boxes.length + b.connections.length) - (a.boxes.length + a.connections.length))
        .map((page) => [page.name, Math.max(10, Math.round(((page.boxes.length + page.connections.length) / workspaceMax) * 100)), formatNumber(page.boxes.length + page.connections.length)])
      : [["Nessun workspace", 0, "0"]],
  };
};

const applyRuntimeViewModel = (viewModel) => {
  aiRuntimeMeta = viewModel.meta;
  metrics = viewModel.metrics;
  agents = viewModel.agents;
  providers = viewModel.providers;
  jobs = viewModel.jobs;
  logs = viewModel.logs;
  memory = viewModel.memory;
  prompts = viewModel.prompts;
  workspaceActivity = viewModel.workspaceActivity;
};

const renderBrand = () => window.TrackerLensSidebar.renderBrand({ className: "tl-ai-brand" });

const renderTopbar = () =>
  _.header(
    { class: "tl-ai-topbar" },
    renderBrand(),
    _.div(
      { class: "tl-ai-search" },
      _.Search({
        class: "tl-ai-search-input",
        label: "Cerca agenti, modelli, prompt, workflow...",
        value: globalSearchQuery,
        "aria-label": "Cerca AI Runtime Center",
        onInput: (event) => {
          globalSearchQuery = event.target.value;
          agentSearchQuery = globalSearchQuery;
          promptSearchQuery = globalSearchQuery;
          providerListSearchQuery = globalSearchQuery;
          jobListSearchQuery = globalSearchQuery;
          logListSearchQuery = globalSearchQuery;
          memoryListSearchQuery = globalSearchQuery;
          mountAiRuntime({ focusSelector: ".tl-ai-search-input input" });
        },
      })
    ),
    _.Toolbar(
      { class: "tl-ai-actions", align: "center", gap: 16 },
      btn({ class: "st-btn-primary", onclick: () => openProviderEditorDialog() }, icon("add", "sm"), "Provider"),
      btn({ class: "tl-ai-menu", "aria-label": "Impostazioni AI", onclick: () => window.location.assign("settings.html#ai") }, icon("settings", "sm"))
    )
  );

const renderSidebar = () => window.TrackerLensSidebar.render({ activeId: "ai" });

const renderSpark = (tone, seed = 0) =>
  _.span(
    { class: `tl-ai-spark is-${tone}`, "aria-hidden": "true" },
    ...Array.from({ length: 20 }, (item, index) =>
      _.span({ style: { height: `${18 + ((seed + index * 11) % 38)}%` } })
    )
  );

const renderMetric = (metric, index) =>
  _.Card(
    { class: `tl-ai-metric is-${metric.tone}` },
    _.div(
      { class: "tl-ai-metric-head" },
      _.span({ class: "tl-ai-metric-icon" }, icon(metric.icon, "sm")),
      _.span({ class: "tl-ai-label" }, metric.label)
    ),
    _.strong(metric.value),
    _.div(
      { class: "tl-ai-metric-foot" },
      _.span({ class: `tl-ai-delta is-${metric.tone}` }, metric.delta),
      _.span({ class: "tl-ai-source" }, metric.source || "runtime")
    ),
    renderSpark(metric.tone, index * 9)
  );

const renderHeader = () =>
  _.section(
    { class: "tl-ai-header" },
    _.div(
      { class: "tl-ai-title-row" },
      _.div(
        _.span({ class: "tl-ai-orb" }, icon("psychology_alt", "md")),
        _.div(_.h2("AI Runtime Center"), _.p("Centro di orchestrazione AI di Trackers Lens"))
      ),
      _.Toolbar(
        { class: "tl-ai-head-actions", gap: 14 },
        _.span({ class: "tl-ai-live-pill" }, dot(aiRuntimeMeta.error ? "error" : "online"), aiRuntimeMeta.error ? "AI System Error" : "AI System Online"),
        btn({ class: "st-btn-primary", onclick: () => window.location.assign("settings.html#ai") }, icon("settings", "sm"), "Impostazioni AI"),
        btn({ class: "tl-ai-icon-btn", "aria-label": "Aggiorna runtime AI", onclick: refreshAiRuntime }, icon("refresh", "sm"))
      )
    ),
    _.Grid({ class: "tl-ai-metrics-grid", cols: "repeat(auto-fit, minmax(138px, 1fr))", gap: 10 }, ...metrics.map(renderMetric))
  );

const agentCount = () => agents.filter((agent) => !agent.placeholder).length;
const agentStatusOptions = () => {
  const statuses = agents.filter((agent) => !agent.placeholder).map((item) => item.status);
  return Array.from(new Set(statuses)).sort((a, b) => a.localeCompare(b, "it"));
};
const agentMatches = (agent, query = "") => {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  return [agent.name, agent.description, agent.state, agent.status].filter(Boolean).join(" ").toLowerCase().includes(q);
};
const filteredAgents = () =>
  agents
    .filter((agent) => agent.placeholder || agentStatusFilter === "all" || agent.status === agentStatusFilter)
    .filter((agent) => agent.placeholder || agentMatches(agent, agentSearchQuery));

const renderAgentSelect = (value, options, onChange) =>
  _.Select({
    class: "tl-ai-agent-filter",
    value,
    onChange: (value) => onChange(selectValueOf(value)),
    options,
    slots: { arrow: () => icon("keyboard_arrow_down", "sm") },
  });

const renderAgentSearch = () =>
  _.Search({
    class: "tl-ai-agent-search-input",
    label: "Cerca agenti...",
    value: agentSearchQuery,
    "aria-label": "Cerca agenti AI",
    onInput: (event) => {
      agentSearchQuery = event.target.value;
      mountAiRuntime({ focusSelector: ".tl-ai-agent-search-input input" });
    },
  });

const renderAgentEmptyState = () =>
  _.div(
    { class: "tl-ai-agent-empty-state" },
    _.span({ class: "tl-ai-agent-empty-icon" }, icon("psychology", "md")),
    _.strong("Nessun agente reale"),
    _.p("Crea record in tl_ai_agents o widget AI"),
    btn({ class: "tl-ai-agent-empty-cta", onclick: () => openAgentEditorDialog() }, "Aggiungi Agente")
  );

const openAgentEditorDialog = (agent = null) => window.TrackerLensAiAgentEditor.open({
  agent,
  providers: providers.map(providerOf).filter((item) => !item.placeholder),
  onSave: async ({ payload, close }) => {
    if (payload.scope === "runtime") {
      await window.TrackerLensAiRuntimeStore?.upsertRuntimeAgent?.(payload);
    } else {
      await window.TrackerLensAiRuntimeStore?.upsertAgent?.(payload);
    }
    await window.TrackerLensAiRuntimeStore?.upsertMetric?.({
      id: `metric_${payload.id || payload.name.replace(/\W+/g, "_").toLowerCase()}`,
      workspaceId: payload.workspaceId || "global",
      agentId: payload.id || payload.name,
      ...payload.metrics,
      status: payload.status,
    });
    close?.();
    await refreshAiRuntime();
  },
});

const deleteAgent = async (agent, close = null) => {
  if (!agent?.id) return;
  if ((agent.scope || agent.raw?.scope || agent.raw?.kind) === "runtime") {
    await window.TrackerLensAiRuntimeStore?.deleteRuntimeAgent?.(agent.id);
  } else {
    await window.TrackerLensAiRuntimeStore?.deleteAgent?.(agent.id);
  }
  close?.();
  await refreshAiRuntime();
};

const openAgentDeleteDialog = (agent) => {
  if (!agent?.id) return;
  const dialog = _.Dialog({
    class: "tl-ai-agent-delete-dialog",
    panelClass: "tl-ai-prompt-delete-panel",
    size: "sm",
    title: "Elimina agente",
    subtitle: agent.name,
    icon: "delete",
    closeButton: true,
    content: () => _.div(
      { class: "tl-ai-prompt-delete-body" },
      _.p("Questa azione rimuove l'agente salvato da tl_ai_agents.")
    ),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: close }, "Annulla"),
      btn({ class: "tl-ai-danger-btn", onclick: () => deleteAgent(agent, close) }, icon("delete", "sm"), "Elimina")
    ),
  });
  dialog.open();
};

const renderAgentActions = (agent) =>
  _.Toolbar(
    { class: "tl-ai-agent-row-actions", gap: 6 },
    btn({ "aria-label": "Apri Flow Map", title: "Flow Map", disabled: agent.placeholder, onclick: () => window.location.assign(`flowMap.html${agent.workspaceId ? `?workspaceId=${encodeURIComponent(agent.workspaceId)}` : ""}`) }, icon("account_tree", "sm")),
    btn({ "aria-label": "Modifica agente", title: "Modifica", disabled: agent.placeholder, onclick: () => openAgentEditorDialog(agent) }, icon("edit", "sm")),
    btn({ "aria-label": "Elimina agente", title: "Elimina", disabled: agent.placeholder, onclick: () => openAgentDeleteDialog(agent) }, icon("delete", "sm"))
  );

const renderAgentCard = (agent, compact = false) =>
  agent.placeholder ? renderAgentEmptyState() :
  _.div(
    { class: `tl-ai-agent is-${agent.status} is-ai-runtime is-${agent.color || "gold"}` },
    _.span({ class: "tl-ai-agent-icon" }, icon(agent.icon, "sm")),
    _.div(
      _.strong(agent.name),
      _.p(agent.description),
      _.div(
        { class: "tl-ai-agent-mini-runtime" },
        _.span(agent.scope === "runtime" ? "Runtime Instance" : "Library Template"),
        _.span(agent.runtime?.agentType || "agent"),
        agent.channels?.outputChannel ? _.span(agent.channels.outputChannel) : null
      )
    ),
    _.span({ class: `tl-ai-status is-${agent.status}` }, dot(agent.status), agent.state),
    renderAgentActions(agent)
  );

const renderAgentListItem = (agent) =>
  agent.placeholder ? renderAgentEmptyState() :
  _.div(
    { class: `tl-ai-agent-row is-${agent.status} is-ai-runtime is-${agent.color || "gold"}` },
    _.span({ class: "tl-ai-agent-row-icon" }, icon(agent.icon, "sm")),
    _.div({ class: "tl-ai-agent-row-copy" }, _.strong(agent.name), _.p(agent.description), _.small(`${agent.scope === "runtime" ? "Runtime Instance" : "Library Template"} · ${agent.runtime?.agentType || "agent"} · ${agent.channels?.outputChannel || "no output channel"}`)),
    _.span({ class: `tl-ai-status is-${agent.status}` }, dot(agent.status), agent.state),
    renderAgentActions(agent)
  );

const renderAgentDialogList = (query = "") => {
  const filtered = agents.filter((agent) => !agent.placeholder && agentMatches(agent, query));
  return _.div(
    { class: "tl-ai-prompt-dialog-list tl-ai-agent-dialog-list" },
    ...(filtered.length
      ? filtered.map((agent) => renderAgentCard(agent, true))
      : [_.div({ class: "tl-ai-prompt-empty" }, icon("search_off", "sm"), _.strong("Nessun agente trovato"), _.p("Modifica la ricerca o aggiungi un nuovo agente."))])
  );
};

const refreshAgentDialogList = (query = "") => {
  agentListSearchQuery = query;
  const host = document.querySelector("[data-ai-agent-dialog-list]");
  if (!host) return;
  host.replaceChildren(renderAgentDialogList(query));
};

const openAgentListDialog = () => {
  const dialog = _.Dialog({
    class: "tl-ai-agent-list-dialog",
    panelClass: "tl-ai-prompt-list-panel",
    size: "lg",
    title: "AI Agents",
    subtitle: `${agentCount()} agenti salvati`,
    icon: "psychology",
    closeButton: true,
    scrollable: true,
    bodyMaxHeight: "68vh",
    content: () => _.div(
      { class: "tl-ai-prompt-list-body" },
      _.div(
        { class: "tl-ai-prompt-search" },
        icon("search", "sm"),
        _.input({
          type: "search",
          value: agentListSearchQuery,
          placeholder: "Cerca agenti...",
          oninput: (event) => refreshAgentDialogList(event.currentTarget.value),
        })
      ),
      _.div({ "data-ai-agent-dialog-list": "true" }, renderAgentDialogList(agentListSearchQuery))
    ),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: () => openAgentEditorDialog() }, icon("add", "sm"), "Aggiungi"),
      btn({ onclick: close }, "Chiudi")
    ),
  });
  dialog.open();
};

const renderAgents = () =>
  {
    const visibleAgents = filteredAgents();
    const statuses = agentStatusOptions();
    return _.aside(
      { class: "tl-ai-agents" },
      _.div(
        { class: "tl-ai-agent-header" },
        _.div({ class: "tl-ai-agent-title" }, _.h3("AI Agents"), _.p(`${agentCount()} agenti salvati · tl_ai_agents`)),
        _.Toolbar(
          { class: "tl-ai-agent-head-actions", gap: 8 },
          btn({ class: "tl-ai-ghost-btn", onclick: () => openAgentEditorDialog() }, icon("add", "sm"), "Aggiungi"),
          btn({ class: "tl-ai-link-btn", onclick: openAgentListDialog }, "Visualizza tutti", icon("arrow_forward", "sm"))
        )
      ),
      _.div(
        { class: "tl-ai-agent-toolbar" },
        renderAgentSelect(
          agentStatusFilter,
          [
            { value: "all", label: "Tutti gli stati" },
            ...statuses.map((status) => ({ value: status, label: sourceLabel(status) })),
          ],
          (value) => {
            agentStatusFilter = value || "all";
            mountAiRuntime();
          }
        ),
        renderAgentSearch(),
        _.div(
          { class: "tl-ai-agent-view-switch", role: "group", "aria-label": "Cambia visualizzazione agenti" },
          btn({ class: agentViewMode === "list" ? "is-active" : "", "aria-label": "Lista", onclick: () => setAgentViewMode("list") }, icon("view_list", "sm")),
          btn({ class: agentViewMode === "grid" ? "is-active" : "", "aria-label": "Box", onclick: () => setAgentViewMode("grid") }, icon("grid_view", "sm"))
        )
      ),
    _.div(
      { class: `tl-ai-agent-list is-${agentViewMode}` },
      ...visibleAgents.map((agent) => agentViewMode === "list" ? renderAgentListItem(agent) : renderAgentCard(agent))
    )
  );
  };

const providerOf = (provider = {}) => Array.isArray(provider)
  ? {
    id: "",
    name: provider[0],
    model: provider[1],
    state: provider[2],
    latency: provider[3],
    status: provider[4],
    icon: provider[5],
    provider: provider[0],
    endpoint: "",
    healthPath: "",
    placeholder: provider[0]?.startsWith?.("Nessun"),
  }
  : provider;

const providerMatches = (provider, query = "") => {
  const item = providerOf(provider);
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  return [item.name, item.provider, item.model, item.endpoint, item.state].filter(Boolean).join(" ").toLowerCase().includes(q);
};

const providerFormValue = (form, name) => String(new FormData(form).get(name) || "").trim();

const saveProviderFromForm = async (form, close, current = null) => {
  const name = providerFormValue(form, "name");
  if (!name) return;
  await window.TrackerLensAiRuntimeStore?.upsertProvider?.({
    ...(current?.id ? { id: current.id, createdAt: current.raw?.createdAt } : {}),
    name,
    provider: providerFormValue(form, "provider") || "custom",
    model: providerFormValue(form, "model") || "local-model",
    endpoint: providerFormValue(form, "endpoint"),
    healthPath: providerFormValue(form, "healthPath"),
    status: providerFormValue(form, "status") || "idle",
    icon: providerFormValue(form, "icon") || "psychology",
    local: providerFormValue(form, "local") === "true",
    priority: Number(providerFormValue(form, "priority") || 100),
  });
  close?.();
  await refreshAiRuntime();
};

const openProviderEditorDialog = (provider = null) => {
  const current = provider ? providerOf(provider) : null;
  const isEdit = Boolean(current?.id);
  const dialog = _.Dialog({
    class: "tl-ai-provider-dialog",
    panelClass: "tl-ai-prompt-panel",
    size: "md",
    title: isEdit ? "Modifica provider" : "Nuovo provider",
    subtitle: "Provider salvati localmente in tl_ai_providers.",
    icon: isEdit ? "edit" : "dns",
    closeButton: true,
    content: ({ close }) => _.form(
      {
        class: "tl-ai-prompt-form",
        onsubmit: (event) => {
          event.preventDefault();
          saveProviderFromForm(event.currentTarget, close, current);
        },
      },
      _.Input({ label: "Nome", name: "name", required: true, value: current?.name || "", placeholder: "Ollama" }),
      _.div(
        { class: "tl-ai-prompt-form-row" },
        _.Input({ label: "Provider", name: "provider", value: current?.provider || "custom", placeholder: "ollama" }),
        _.Input({ label: "Modello", name: "model", value: current?.model || "", placeholder: "llama3.1" })
      ),
      _.Input({ label: "Endpoint", name: "endpoint", value: current?.endpoint || "", placeholder: "http://127.0.0.1:11434" }),
      _.div(
        { class: "tl-ai-prompt-form-row" },
        _.Input({ label: "Health path", name: "healthPath", value: current?.healthPath || "", placeholder: "/api/tags" }),
        _.Input({ label: "Icona", name: "icon", value: current?.icon || "psychology", placeholder: "memory" })
      ),
      _.div(
        { class: "tl-ai-prompt-form-row" },
        _.div(
          { class: "tl-ai-prompt-tone-field" },
          _.input({ type: "hidden", name: "status", value: current?.raw?.status || "idle" }),
          _.Select({
            label: "Stato",
            value: current?.raw?.status || "idle",
            options: [
              { value: "idle", label: "Idle" },
              { value: "online", label: "Online" },
              { value: "offline", label: "Offline" },
            ],
            slots: { arrow: () => icon("keyboard_arrow_down", "sm") },
            onChange: (value) => {
              const input = document.querySelector(".tl-ai-provider-dialog input[name='status']");
              if (input) input.value = selectValueOf(value);
            },
          })
        ),
        _.div(
          { class: "tl-ai-prompt-tone-field" },
          _.input({ type: "hidden", name: "local", value: current?.local ? "true" : "false" }),
          _.Select({
            label: "Tipo",
            value: current?.local ? "true" : "false",
            options: [{ value: "true", label: "Locale" }, { value: "false", label: "Cloud/Custom" }],
            slots: { arrow: () => icon("keyboard_arrow_down", "sm") },
            onChange: (value) => {
              const input = document.querySelector(".tl-ai-provider-dialog input[name='local']");
              if (input) input.value = selectValueOf(value);
            },
          })
        ),
        _.Input({ label: "Priorita", name: "priority", type: "number", value: current?.raw?.priority || (current?.local ? 10 : 100) })
      ),
      _.Toolbar(
        { align: "end", gap: 8 },
        btn({ onclick: close }, "Annulla"),
        btn({ class: "st-btn-primary", type: "submit" }, icon("save", "sm"), "Salva")
      )
    ),
  });
  dialog.open();
};

const probeProvider = async (provider) => {
  const current = providerOf(provider);
  if (!current?.id || current.placeholder) return;
  aiRuntimeMeta = { ...aiRuntimeMeta, indexedDb: `Probe ${current.name}` };
  mountAiRuntime();
  await window.TrackerLensAiRuntimeStore?.probeProvider?.(current.raw || current);
  await refreshAiRuntime();
};

const deleteProvider = async (provider, close = null) => {
  const current = providerOf(provider);
  if (!current?.id || current.placeholder) return;
  await window.TrackerLensAiRuntimeStore?.deleteProvider?.(current.id);
  close?.();
  await refreshAiRuntime();
};

const openProviderDeleteDialog = (provider) => {
  const current = providerOf(provider);
  if (!current?.id || current.placeholder) return;
  const dialog = _.Dialog({
    class: "tl-ai-provider-delete-dialog",
    panelClass: "tl-ai-prompt-delete-panel",
    size: "sm",
    title: "Elimina provider",
    subtitle: current.name,
    icon: "delete",
    closeButton: true,
    content: () => _.div({ class: "tl-ai-prompt-delete-body" }, _.p("Questa azione rimuove il provider da tl_ai_providers.")),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: close }, "Annulla"),
      btn({ class: "tl-ai-danger-btn", onclick: () => deleteProvider(current, close) }, icon("delete", "sm"), "Elimina")
    ),
  });
  dialog.open();
};

const renderProviderRow = (provider, compact = false) => {
  const item = providerOf(provider);
  const isDefaultLocal = ["local_ollama", "local_lm_studio"].includes(item.id);
  return _.div(
    { class: `tl-ai-provider is-${item.status}${item.placeholder ? " is-empty" : ""}` },
    _.span(icon(item.icon || "psychology", "sm"), item.name),
    _.em(item.model || "modello non configurato"),
    _.strong({ class: `is-${item.status}` }, item.state || sourceLabel(item.status)),
    _.small(item.latency || "n/d"),
    item.placeholder ? null : _.Toolbar(
      { class: "tl-ai-provider-row-actions", gap: 6 },
      btn({ "aria-label": "Probe provider", title: "Probe", onclick: () => probeProvider(item) }, icon("radar", "sm")),
      btn({ "aria-label": "Modifica provider", title: "Modifica", onclick: () => openProviderEditorDialog(item) }, icon("edit", "sm")),
      btn({ "aria-label": "Elimina provider", title: isDefaultLocal ? "Provider locale default" : "Elimina", disabled: isDefaultLocal, onclick: () => openProviderDeleteDialog(item) }, icon("delete", "sm"))
    ),
    compact && item.endpoint ? _.pre({ class: "tl-ai-prompt-preview" }, item.endpoint) : null
  );
};

const renderProviderDialogList = (query = "") => {
  const filtered = providers.map(providerOf).filter((provider) => !provider.placeholder && providerMatches(provider, query));
  return _.div(
    { class: "tl-ai-prompt-dialog-list tl-ai-provider-dialog-list" },
    ...(filtered.length
      ? filtered.map((provider) => renderProviderRow(provider, true))
      : [_.div({ class: "tl-ai-prompt-empty" }, icon("search_off", "sm"), _.strong("Nessun provider trovato"), _.p("Aggiungi un provider o modifica la ricerca."))])
  );
};

const refreshProviderDialogList = (query = "") => {
  providerListSearchQuery = query;
  const host = document.querySelector("[data-ai-provider-dialog-list]");
  if (!host) return;
  host.replaceChildren(renderProviderDialogList(query));
};

const openProviderListDialog = () => {
  const dialog = _.Dialog({
    class: "tl-ai-provider-list-dialog",
    panelClass: "tl-ai-prompt-list-panel",
    size: "lg",
    title: "AI Models & Providers",
    subtitle: "Provider locali e custom in tl_ai_providers.",
    icon: "dns",
    closeButton: true,
    scrollable: true,
    bodyMaxHeight: "68vh",
    content: () => _.div(
      { class: "tl-ai-prompt-list-body" },
      _.div(
        { class: "tl-ai-prompt-search" },
        icon("search", "sm"),
        _.input({
          type: "search",
          value: providerListSearchQuery,
          placeholder: "Cerca provider...",
          oninput: (event) => refreshProviderDialogList(event.currentTarget.value),
        })
      ),
      _.div({ "data-ai-provider-dialog-list": "true" }, renderProviderDialogList(providerListSearchQuery))
    ),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: probeLocalAiProviders }, icon("radar", "sm"), "Probe Local"),
      btn({ onclick: () => openProviderEditorDialog() }, icon("add", "sm"), "Aggiungi"),
      btn({ onclick: close }, "Chiudi")
    ),
  });
  dialog.open();
};

const renderProviders = () =>
  {
    const visibleProviders = providers.map(providerOf).filter((provider) => provider.placeholder || providerMatches(provider, providerListSearchQuery));
    return _.aside(
      { class: "tl-ai-providers" },
      _.Row({ justify: "space-between", align: "center" }, _.h3("AI Models & Providers"), btn({ class: "tl-ai-ghost-btn", onclick: probeLocalAiProviders }, icon("radar", "sm"), "Probe Local")),
      _.div(
        { class: "tl-ai-provider-list" },
        ...visibleProviders.map((provider) => renderProviderRow(provider))
      ),
      _.Toolbar({ class: "tl-ai-provider-actions", gap: 8 }, btn({ class: "tl-ai-link-btn", onclick: () => openProviderEditorDialog() }, "Aggiungi provider"), btn({ class: "tl-ai-link-btn", onclick: openProviderListDialog }, "Gestisci modelli", icon("arrow_forward", "sm")))
    );
  };

const selectValueOf = (value) => value?.target?.value ?? value;

const renderPromptSelect = (value, options, onChange) =>
  _.Select({
    class: "tl-ai-prompt-category",
    value,
    onChange: (value) => onChange(selectValueOf(value)),
    options,
    slots: { arrow: () => icon("keyboard_arrow_down", "sm") },
  });

const renderPromptSearch = () =>
  _.Search({
    class: "tl-ai-prompt-search-input",
    label: "Cerca prompt...",
    value: promptSearchQuery,
    "aria-label": "Cerca prompt",
    onInput: (event) => {
      promptSearchQuery = event.target.value;
      mountAiRuntime({ focusSelector: ".tl-ai-prompt-search-input input" });
    },
  });

const promptFormValue = (form, name) => String(new FormData(form).get(name) || "").trim();

const savePromptFromForm = async (form, close, current = null) => {
  const name = promptFormValue(form, "name");
  const prompt = promptFormValue(form, "prompt");
  if (!name || !prompt) return;
  await window.TrackerLensAiRuntimeStore?.upsertPromptFlow?.({
    ...(current?.id ? { id: current.id, createdAt: current.raw?.createdAt } : {}),
    name,
    title: name,
    description: promptFormValue(form, "description") || prompt,
    prompt,
    category: promptFormValue(form, "category") || "Generale",
    status: "active",
    icon: promptFormValue(form, "icon") || "psychology",
    tone: promptFormValue(form, "tone") || "gold",
  });
  close?.();
  await refreshAiRuntime();
};

const openPromptEditorDialog = (prompt = null) => {
  const isEdit = Boolean(prompt?.id);
  const toneValue = prompt?.tone || "gold";
  const dialog = _.Dialog({
    class: "tl-ai-prompt-dialog",
    panelClass: "tl-ai-prompt-panel",
    size: "md",
    title: isEdit ? "Modifica prompt" : "Nuovo prompt",
    subtitle: "Prompt salvati localmente in tl_ai_prompt_flows.",
    icon: isEdit ? "edit" : "add",
    closeButton: true,
    content: ({ close }) => _.form(
      {
        class: "tl-ai-prompt-form",
        onsubmit: (event) => {
          event.preventDefault();
          savePromptFromForm(event.currentTarget, close, prompt);
        },
      },
      _.Input({ label: "Nome", name: "name", required: true, value: prompt?.name || "", placeholder: "Nome prompt" }),
      _.Input({ label: "Descrizione", name: "description", value: prompt?.description || "", placeholder: "Breve contesto" }),
      _.Input({ label: "Categoria", name: "category", value: prompt?.category || "Generale", placeholder: "Generale" }),
      _.label({ class: "tl-ai-prompt-textarea-field" }, _.span("Prompt"), _.textarea({ name: "prompt", required: true, rows: 7, placeholder: "Scrivi il prompt...", value: prompt?.prompt || "" })),
      _.div(
        { class: "tl-ai-prompt-form-row" },
        _.Input({ label: "Icona", name: "icon", value: prompt?.icon || "psychology", placeholder: "psychology" }),
        _.div(
          { class: "tl-ai-prompt-tone-field" },
          _.input({ type: "hidden", name: "tone", value: toneValue }),
          _.Select({
            label: "Colore",
            value: toneValue,
            options: ["gold", "blue", "green", "purple"].map((tone) => ({ value: tone, label: tone })),
            slots: { arrow: () => icon("keyboard_arrow_down", "sm") },
            onChange: (value) => {
              const input = document.querySelector(".tl-ai-prompt-form input[name='tone']");
              if (input) input.value = selectValueOf(value);
            },
          })
        )
      ),
      _.Toolbar(
        { align: "end", gap: 8 },
        btn({ onclick: close }, "Annulla"),
        btn({ class: "st-btn-primary", type: "submit" }, icon("save", "sm"), "Salva")
      )
    ),
  });
  dialog.open();
};

const deletePrompt = async (prompt, close = null) => {
  if (!prompt?.id) return;
  await window.TrackerLensAiRuntimeStore?.deletePromptFlow?.(prompt.id);
  close?.();
  await refreshAiRuntime();
};

const openPromptDeleteDialog = (prompt) => {
  if (!prompt?.id) return;
  const dialog = _.Dialog({
    class: "tl-ai-prompt-delete-dialog",
    panelClass: "tl-ai-prompt-delete-panel",
    size: "sm",
    title: "Elimina prompt",
    subtitle: prompt.name,
    icon: "delete",
    closeButton: true,
    content: () => _.div(
      { class: "tl-ai-prompt-delete-body" },
      _.p("Questa azione rimuove il prompt salvato da tl_ai_prompt_flows."),
      prompt.prompt ? _.pre(prompt.prompt) : null
    ),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: close }, "Annulla"),
      btn({ class: "tl-ai-danger-btn", onclick: () => deletePrompt(prompt, close) }, icon("delete", "sm"), "Elimina")
    ),
  });
  dialog.open();
};

const renderPromptEmptyState = () =>
  _.div(
    { class: "tl-ai-prompt-empty-state" },
    _.span({ class: "tl-ai-prompt-empty-icon" }, icon("psychology", "md")),
    _.strong("Nessun prompt salvato"),
    _.p("Crea il primo prompt locale in tl_ai_prompt_flows"),
    btn({ class: "tl-ai-prompt-empty-cta", onclick: () => openPromptEditorDialog() }, "Aggiungi Prompt")
  );

const renderPromptCard = (prompt, index, compact = false) =>
  prompt.placeholder && !compact ? renderPromptEmptyState() :
  _.div(
    { class: `tl-ai-prompt-block is-${prompt.tone}${prompt.placeholder ? " is-empty" : ""}` },
    _.span({ class: "tl-ai-prompt-index" }, String(index + 1).padStart(2, "0")),
    _.span({ class: "tl-ai-prompt-icon" }, icon(prompt.icon, "sm")),
    _.div(
      { class: "tl-ai-prompt-copy" },
      _.strong(prompt.name),
      _.p(prompt.description || prompt.prompt || "Prompt salvato"),
      _.small(prompt.category || "Generale")
    ),
    _.Toolbar(
      { class: "tl-ai-prompt-actions", gap: 6 },
      btn({ "aria-label": "Modifica prompt", title: "Modifica", disabled: prompt.placeholder, onclick: () => openPromptEditorDialog(prompt) }, icon("edit", "sm")),
      btn({ "aria-label": "Elimina prompt", title: "Elimina", disabled: prompt.placeholder, onclick: () => openPromptDeleteDialog(prompt) }, icon("delete", "sm"))
    ),
    compact && prompt.prompt ? _.pre({ class: "tl-ai-prompt-preview" }, prompt.prompt) : null
  );

const renderPromptListItem = (prompt, index) =>
  prompt.placeholder ? renderPromptEmptyState() :
  _.div(
    { class: `tl-ai-prompt-row is-${prompt.tone}${prompt.placeholder ? " is-empty" : ""}` },
    _.span({ class: "tl-ai-prompt-row-icon" }, icon(prompt.icon, "sm")),
    _.div({ class: "tl-ai-prompt-row-copy" }, _.strong(prompt.name), _.p(prompt.description || prompt.prompt || "Prompt salvato")),
    _.span({ class: "tl-ai-prompt-row-category" }, prompt.category || "Generale"),
    _.Toolbar(
      { class: "tl-ai-prompt-row-actions", gap: 6 },
      btn({ "aria-label": "Modifica prompt", title: "Modifica", disabled: prompt.placeholder, onclick: () => openPromptEditorDialog(prompt) }, icon("edit", "sm")),
      btn({ "aria-label": "Elimina prompt", title: "Elimina", disabled: prompt.placeholder, onclick: () => openPromptDeleteDialog(prompt) }, icon("delete", "sm"))
    )
  );

const promptMatches = (prompt, query = "") => {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  return [prompt.name, prompt.description, prompt.prompt, prompt.category].filter(Boolean).join(" ").toLowerCase().includes(q);
};

const promptCategories = () => {
  const categories = prompts
    .filter((prompt) => !prompt.placeholder)
    .map((prompt) => prompt.category || "Generale")
    .filter(Boolean);
  return Array.from(new Set(categories)).sort((a, b) => a.localeCompare(b, "it"));
};

const filteredPrompts = () =>
  prompts
    .filter((prompt) => prompt.placeholder || promptCategoryFilter === "all" || prompt.category === promptCategoryFilter)
    .filter((prompt) => prompt.placeholder || promptMatches(prompt, promptSearchQuery));

const setAgentViewMode = (value) => {
  agentViewMode = value === "list" ? "list" : "grid";
  setStoredAiUiPref("agent_view_mode", agentViewMode);
  mountAiRuntime();
};

const setPromptCategoryFilter = (value) => {
  promptCategoryFilter = value || "all";
  mountAiRuntime();
};

const setPromptViewMode = (value) => {
  promptViewMode = value === "list" ? "list" : "grid";
  setStoredAiUiPref("prompt_view_mode", promptViewMode);
  mountAiRuntime();
};

const renderPromptDialogList = (query = "") => {
  const filtered = prompts.filter((prompt) => !prompt.placeholder && promptMatches(prompt, query));
  return _.div(
    { class: "tl-ai-prompt-dialog-list" },
    ...(filtered.length
      ? filtered.map((prompt, index) => renderPromptCard(prompt, index, true))
      : [_.div({ class: "tl-ai-prompt-empty" }, icon("search_off", "sm"), _.strong("Nessun prompt trovato"), _.p("Modifica la ricerca o aggiungi un nuovo prompt."))])
  );
};

const refreshPromptDialogList = (query = "") => {
  promptListSearchQuery = query;
  const host = document.querySelector("[data-ai-prompt-dialog-list]");
  if (!host) return;
  host.replaceChildren(renderPromptDialogList(query));
};

const openPromptListDialog = () => {
  const dialog = _.Dialog({
    class: "tl-ai-prompt-list-dialog",
    panelClass: "tl-ai-prompt-list-panel",
    size: "lg",
    title: "Prompt",
    subtitle: `${prompts.filter((prompt) => !prompt.placeholder).length} prompt salvati`,
    icon: "psychology",
    closeButton: true,
    scrollable: true,
    bodyMaxHeight: "68vh",
    content: () => _.div(
      { class: "tl-ai-prompt-list-body" },
      _.div(
        { class: "tl-ai-prompt-search" },
        icon("search", "sm"),
        _.input({
          type: "search",
          value: promptListSearchQuery,
          placeholder: "Cerca prompt...",
          oninput: (event) => refreshPromptDialogList(event.currentTarget.value),
        })
      ),
      _.div({ "data-ai-prompt-dialog-list": "true" }, renderPromptDialogList(promptListSearchQuery))
    ),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: () => openPromptEditorDialog() }, icon("add", "sm"), "Aggiungi"),
      btn({ onclick: close }, "Chiudi")
    ),
  });
  dialog.open();
};

const renderPrompts = () => {
  const visiblePrompts = filteredPrompts();
  const categories = promptCategories();
  return _.section(
    { class: "tl-ai-prompts" },
    _.div(
      { class: "tl-ai-prompt-header" },
      _.div(
        { class: "tl-ai-prompt-title" },
        _.h3("Prompt"),
        _.p(`${prompts.filter((prompt) => !prompt.placeholder).length} prompt salvati · tl_ai_prompt_flows`)
      ),
      _.Toolbar(
        { class: "tl-ai-prompt-head-actions", gap: 8 },
        btn({ class: "tl-ai-ghost-btn", onclick: () => openPromptEditorDialog() }, icon("add", "sm"), "Aggiungi"),
        btn({ class: "tl-ai-link-btn", onclick: openPromptListDialog }, "Visualizza tutti", icon("arrow_forward", "sm"))
      )
    ),
    _.div(
      { class: "tl-ai-prompt-toolbar" },
      renderPromptSelect(
        promptCategoryFilter,
        [
          { value: "all", label: "Tutte le categorie" },
          ...categories.map((category) => ({ value: category, label: category })),
        ],
        setPromptCategoryFilter
      ),
      renderPromptSearch(),
      _.div(
        { class: "tl-ai-prompt-view-switch", role: "group", "aria-label": "Cambia visualizzazione prompt" },
        btn({ class: promptViewMode === "list" ? "is-active" : "", "aria-label": "Lista", onclick: () => setPromptViewMode("list") }, icon("view_list", "sm")),
        btn({ class: promptViewMode === "grid" ? "is-active" : "", "aria-label": "Box", onclick: () => setPromptViewMode("grid") }, icon("grid_view", "sm"))
      )
    ),
    _.div(
      { class: `tl-ai-prompt-list is-${promptViewMode}` },
      ...visiblePrompts.map((prompt, index) => promptViewMode === "list" ? renderPromptListItem(prompt, index) : renderPromptCard(prompt, index))
    )
  );
};

const jobOf = (job = {}) => Array.isArray(job)
  ? { id: job[0], agent: job[1], task: job[2], state: job[3], start: job[4], duration: job[5], tokens: job[6], status: job[7], raw: null }
  : job;
const logOf = (log = {}) => Array.isArray(log)
  ? { time: log[0], source: log[1], message: log[2], status: log[3], raw: null }
  : log;
const memoryOf = (item = {}) => Array.isArray(item)
  ? { name: item[0], meta: item[1], count: item[2], icon: item[3], scope: item[4], raw: null }
  : item;

const itemMatches = (item, query = "", keys = []) => {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  return keys.map((key) => item?.[key]).filter(Boolean).join(" ").toLowerCase().includes(q);
};

const openJsonDialog = ({ title, subtitle, iconName = "data_object", record = null }) => {
  const dialog = _.Dialog({
    class: "tl-ai-json-dialog",
    panelClass: "tl-ai-prompt-list-panel",
    size: "lg",
    title,
    subtitle,
    icon: iconName,
    closeButton: true,
    scrollable: true,
    bodyMaxHeight: "68vh",
    content: () => _.pre({ class: "tl-ai-json-preview" }, JSON.stringify(record || {}, null, 2)),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({
        onclick: async () => {
          try {
            await navigator.clipboard?.writeText?.(JSON.stringify(record || {}, null, 2));
          } catch (error) {
            console.warn("Copia JSON non disponibile:", error);
          }
        },
      }, icon("content_copy", "sm"), "Copia JSON"),
      btn({ onclick: close }, "Chiudi")
    ),
  });
  dialog.open();
};

const renderJobRows = (query = "") => jobs
  .map(jobOf)
  .filter((job) => itemMatches(job, query, ["id", "agent", "task", "state", "provider", "model"]));

const openJobsDialog = () => {
  const renderList = (query = "") => _.div(
    { class: "tl-ai-dialog-table-wrap" },
    _.table(
      { class: "tl-ai-table" },
      _.thead(_.tr(_.th("Job ID"), _.th("Agente"), _.th("Task"), _.th("Stato"), _.th("Provider"), _.th("Tokens"), _.th("Azioni"))),
      _.tbody(
        ...renderJobRows(query).map((job) =>
          _.tr(
            { class: `is-${job.status}` },
            _.td(job.id),
            _.td(_.strong(job.agent)),
            _.td(job.task),
            _.td(_.span({ class: `tl-ai-status is-${job.status}` }, dot(job.status), job.state)),
            _.td(job.provider || "-"),
            _.td(job.tokens || "-"),
            _.td(btn({ "aria-label": "Dettagli job", onclick: () => openJsonDialog({ title: job.id, subtitle: job.task, iconName: "radar", record: job.raw || job }) }, icon("data_object", "sm")))
          )
        )
      )
    )
  );
  const refresh = (query = "") => {
    jobListSearchQuery = query;
    const host = document.querySelector("[data-ai-job-dialog-list]");
    if (host) host.replaceChildren(renderList(query));
  };
  const dialog = _.Dialog({
    class: "tl-ai-job-list-dialog",
    panelClass: "tl-ai-prompt-list-panel",
    size: "xl",
    title: "AI Jobs",
    subtitle: "Coda e storico recente da tl_ai_jobs.",
    icon: "radar",
    closeButton: true,
    scrollable: true,
    bodyMaxHeight: "68vh",
    content: () => _.div(
      { class: "tl-ai-prompt-list-body" },
      _.div({ class: "tl-ai-prompt-search" }, icon("search", "sm"), _.input({ type: "search", value: jobListSearchQuery, placeholder: "Cerca job...", oninput: (event) => refresh(event.currentTarget.value) })),
      _.div({ "data-ai-job-dialog-list": "true" }, renderList(jobListSearchQuery))
    ),
    actions: ({ close }) => _.Toolbar({ align: "end", gap: 8 }, btn({ onclick: refreshAiRuntime }, icon("refresh", "sm"), "Aggiorna"), btn({ onclick: close }, "Chiudi")),
  });
  dialog.open();
};

const renderJobsTable = () =>
  _.section(
    { class: "tl-ai-jobs" },
    _.Row({ justify: "space-between", align: "center" }, _.h3("AI Jobs in Esecuzione"), _.span({ class: "tl-ai-muted-pill" }, "Realtime queue")),
    _.div(
      { class: "tl-ai-table-wrap" },
      _.table(
        { class: "tl-ai-table" },
        _.thead(_.tr(_.th("Job ID"), _.th("Agente"), _.th("Task"), _.th("Stato"), _.th("Iniziato"), _.th("Durata"), _.th("Tokens"), _.th("Azioni"))),
        _.tbody(
          ...renderJobRows(jobListSearchQuery).map((job) =>
            _.tr(
              { class: `is-${job.status}` },
              _.td(job.id),
              _.td(_.strong(job.agent)),
              _.td(job.task),
              _.td(_.span({ class: `tl-ai-status is-${job.status}` }, dot(job.status), job.state)),
              _.td(job.start),
              _.td(job.duration),
              _.td(job.tokens),
              _.td(_.div({ class: "tl-ai-row-actions" }, btn({ "aria-label": "Dettagli job", onclick: () => openJsonDialog({ title: job.id, subtitle: job.task, iconName: "radar", record: job.raw || job }) }, icon("data_object", "sm"))))
            )
          )
        )
      )
    ),
    btn({ class: "tl-ai-link-btn", onclick: openJobsDialog }, "Visualizza tutti i job", icon("arrow_forward", "sm"))
  );

const renderLogRows = (query = "") => logs
  .map(logOf)
  .filter((log) => itemMatches(log, query, ["time", "source", "message", "status"]));

const openLogsDialog = () => {
  const renderList = (query = "") => _.div(
    { class: "tl-ai-log-list tl-ai-dialog-log-list" },
    ...renderLogRows(query).map((log) =>
      _.div({ class: `tl-ai-log is-${log.status}` }, _.time(log.time), _.span({ class: "tl-ai-log-icon" }, icon(log.status === "error" ? "report" : log.status === "warn" ? "warning" : "psychology", "sm")), _.div(_.strong(log.source), _.p(log.message)), btn({ "aria-label": "Dettagli log", onclick: () => openJsonDialog({ title: log.source, subtitle: log.time, iconName: "receipt_long", record: log.raw || log }) }, icon("data_object", "sm")))
    )
  );
  const refresh = (query = "") => {
    logListSearchQuery = query;
    const host = document.querySelector("[data-ai-log-dialog-list]");
    if (host) host.replaceChildren(renderList(query));
  };
  const dialog = _.Dialog({
    class: "tl-ai-log-list-dialog",
    panelClass: "tl-ai-prompt-list-panel",
    size: "lg",
    title: "AI Logs",
    subtitle: "Eventi recenti da tl_ai_logs.",
    icon: "receipt_long",
    closeButton: true,
    scrollable: true,
    bodyMaxHeight: "68vh",
    content: () => _.div(
      { class: "tl-ai-prompt-list-body" },
      _.div({ class: "tl-ai-prompt-search" }, icon("search", "sm"), _.input({ type: "search", value: logListSearchQuery, placeholder: "Cerca log...", oninput: (event) => refresh(event.currentTarget.value) })),
      _.div({ "data-ai-log-dialog-list": "true" }, renderList(logListSearchQuery))
    ),
    actions: ({ close }) => _.Toolbar({ align: "end", gap: 8 }, btn({ onclick: refreshAiRuntime }, icon("refresh", "sm"), "Aggiorna"), btn({ onclick: close }, "Chiudi")),
  });
  dialog.open();
};

const renderLogs = () =>
  _.aside(
    { class: "tl-ai-logs" },
    _.Row({ justify: "space-between", align: "center" }, _.h3("AI Logs (Live)"), _.span({ class: "tl-ai-live-chip" }, dot("online"), "Live")),
    _.div(
      { class: "tl-ai-log-list" },
      ...renderLogRows(logListSearchQuery).map((log) =>
        _.div({ class: `tl-ai-log is-${log.status}` }, _.time(log.time), _.span({ class: "tl-ai-log-icon" }, icon(log.status === "error" ? "report" : log.status === "warn" ? "warning" : "psychology", "sm")), _.div(_.strong(log.source), _.p(log.message)))
      )
    ),
    btn({ class: "tl-ai-link-btn", onclick: openLogsDialog }, "Visualizza tutti i log", icon("arrow_forward", "sm"))
  );

const renderMemoryRows = (query = "") => memory
  .map(memoryOf)
  .filter((item) => itemMatches(item, query, ["name", "meta", "scope", "text"]));

const openMemoryDialog = () => {
  const renderList = (query = "") => _.div(
    { class: "tl-ai-memory-scroll" },
    ...renderMemoryRows(query).map((item) =>
      _.div({ class: "tl-ai-memory-row" }, _.span(icon(item.icon, "sm")), _.div(_.strong(item.name), _.p(item.meta)), _.em(item.count), _.small(item.scope || "workspace"), btn({ "aria-label": "Dettagli memoria", onclick: () => openJsonDialog({ title: item.name, subtitle: item.scope, iconName: "database", record: item.raw || item }) }, icon("data_object", "sm")))
    )
  );
  const refresh = (query = "") => {
    memoryListSearchQuery = query;
    const host = document.querySelector("[data-ai-memory-dialog-list]");
    if (host) host.replaceChildren(renderList(query));
  };
  const dialog = _.Dialog({
    class: "tl-ai-memory-list-dialog",
    panelClass: "tl-ai-prompt-list-panel",
    size: "lg",
    title: "AI Memory",
    subtitle: "Memoria locale short/workspace/global.",
    icon: "database",
    closeButton: true,
    scrollable: true,
    bodyMaxHeight: "68vh",
    content: () => _.div(
      { class: "tl-ai-prompt-list-body" },
      _.div({ class: "tl-ai-prompt-search" }, icon("search", "sm"), _.input({ type: "search", value: memoryListSearchQuery, placeholder: "Cerca memoria...", oninput: (event) => refresh(event.currentTarget.value) })),
      _.div({ "data-ai-memory-dialog-list": "true" }, renderList(memoryListSearchQuery))
    ),
    actions: ({ close }) => _.Toolbar({ align: "end", gap: 8 }, btn({ onclick: refreshAiRuntime }, icon("refresh", "sm"), "Aggiorna"), btn({ onclick: close }, "Chiudi")),
  });
  dialog.open();
};

const renderMemory = () =>
  _.aside(
    { class: "tl-ai-memory" },
    _.Row({ justify: "space-between", align: "center" }, _.h3("AI Memory (Context)"), btn({ class: "tl-ai-link-btn", onclick: openMemoryDialog }, "Vedi tutto")),
    ...renderMemoryRows(memoryListSearchQuery).map((item) =>
      _.div({ class: "tl-ai-memory-row" }, _.span(icon(item.icon, "sm")), _.div(_.strong(item.name), _.p(item.meta)), _.em(item.count), _.small(item.scope || "workspace"))
    )
  );

const renderDonut = (className, value, label) => _.div({ class: `tl-ai-donut ${className}` }, _.strong(value), _.span(label));

const renderAnalytics = () =>
  _.section(
    { class: "tl-ai-analytics" },
    _.Card(
      { class: "tl-ai-analytics-card" },
      _.h3("Distribuzione per Tipo"),
      _.div({ class: "tl-ai-donut-row" }, renderDonut("is-multi", metrics[1]?.value || "0", "Jobs"), _.div(...metrics.map((item) => _.p(`${item.label} ${item.value}`))))
    ),
    _.Card(
      { class: "tl-ai-analytics-card is-performance" },
      _.h3("AI Performance (24h)"),
      _.Grid(
        { cols: "repeat(4, minmax(0, 1fr))", gap: 8 },
        _.div(_.span("Jobs Attivi"), _.strong(metrics[1]?.value || "0"), _.em(metrics[1]?.delta || "")),
        _.div(_.span("Query"), _.strong(`${aiRuntimeMeta.queryMs || 0}ms`), _.em("IndexedDB")),
        _.div(_.span("Token Totali"), _.strong(metrics[3]?.value || "0"), _.em(metrics[3]?.delta || "")),
        _.div(_.span("Costo Stimato"), _.strong(metrics[6]?.value || "$0.00"), _.em(metrics[6]?.delta || ""))
      ),
      renderSpark("gold", 20)
    ),
    _.Card(
      { class: "tl-ai-analytics-card" },
      _.h3("Storage AI"),
      _.div({ class: "tl-ai-donut-row" }, renderDonut("is-storage", memory.length, "Blocchi"), _.div(...memory.map(memoryOf).map((item) => _.p(`${item.name} ${item.count}`))))
    ),
    _.Card(
      { class: "tl-ai-analytics-card" },
      _.h3("Workspace AI Activity"),
      ...workspaceActivity.map(([name, width, count]) => _.div({ class: "tl-ai-workspace-bar" }, _.span(name), _.span({ class: "tl-ai-bar", style: { "--w": `${width}%` } }), _.strong(count))),
      btn({ class: "tl-ai-link-btn" }, "Richieste AI (24h)")
    )
  );

const renderFooter = () =>
  _.footer(
    { class: "tl-ai-footer" },
    _.span(dot(aiRuntimeMeta.error ? "error" : "online"), aiRuntimeMeta.error || "AI System Online"),
    _.span(`Query Time: ${aiRuntimeMeta.queryMs || 0}ms`),
    _.span("Uptime: runtime locale"),
    _.span(`Agents: ${agents.length}`),
    _.span(`Jobs: ${jobs.length}`),
    _.span(`Memory: ${memory.length}`),
    _.span(`IndexedDB: ${aiRuntimeMeta.indexedDb}`),
    _.span(`Last Update: ${aiRuntimeMeta.lastUpdate || "Mai"}`),
    renderSpark("green", 28)
  );

const renderShell = () =>
  _.div(
    { class: "tl-ai-shell" },
    renderTopbar(),
    _.div(
      { class: "tl-ai-body" },
      renderSidebar(),
      _.main(
        { class: "tl-ai-main" },
        _.div({ class: "tl-ai-grid-bg", "aria-hidden": "true" }),
        renderHeader(),
        renderAgents(),
        renderProviders(),
        renderMemory(),
        renderPrompts(),
        renderLogs(),
        renderJobsTable(),
        renderAnalytics(),
        renderFooter()
      )
    )
  );

const refreshAiRuntime = async () => {
  const started = performance.now();
  try {
    const data = await window.TrackerLensAiRuntimeStore.list();
    applyRuntimeViewModel(buildRuntimeViewModel(data, Math.max(1, Math.round(performance.now() - started))));
  } catch (error) {
    aiRuntimeMeta = {
      loading: false,
      error: error?.message || "Errore caricamento runtime AI",
      queryMs: Math.max(1, Math.round(performance.now() - started)),
      lastUpdate: timeLabel(new Date()),
      indexedDb: "Error",
    };
  }
  mountAiRuntime();
};

const probeLocalAiProviders = async () => {
  aiRuntimeMeta = {
    ...aiRuntimeMeta,
    loading: true,
    error: "",
    indexedDb: "Probing local AI",
  };
  mountAiRuntime();
  try {
    await window.TrackerLensAiRuntimeStore?.probeLocalProviders?.();
  } catch (error) {
    aiRuntimeMeta = {
      ...aiRuntimeMeta,
      error: error?.message || "Errore probe provider locali",
      indexedDb: "Probe error",
    };
  }
  await refreshAiRuntime();
};

const mountAiRuntime = ({ focusSelector = "", selectionStart = null } = {}) => {
  const root = document.getElementById("tl-ai-root");
  if (!root) return;
  const active = document.activeElement;
  const nextSelectionStart = selectionStart ?? (active && typeof active.selectionStart === "number" ? active.selectionStart : null);
  root.replaceChildren(renderShell());
  if (focusSelector) {
    requestAnimationFrame(() => {
      const input = document.querySelector(focusSelector);
      if (!input || typeof input.focus !== "function") return;
      input.focus();
      if (nextSelectionStart !== null && typeof input.setSelectionRange === "function") {
        input.setSelectionRange(nextSelectionStart, nextSelectionStart);
      }
    });
  }
};

mountAiRuntime();
refreshAiRuntime();
