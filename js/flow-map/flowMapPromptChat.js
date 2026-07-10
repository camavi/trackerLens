// Flow Map prompt chat: local prompt-to-runtime graph materializer.
const FLOW_PROMPT_CHAT_STORE = () =>
  tlConfig?.TABLES?.TL_FLOW_PROMPT_CHATS || "tl_flow_prompt_chats";

const flowPromptNow = () => new Date().toISOString();

const FLOW_PROMPT_CHAT_OPEN_STATE_PREFIX = "trackersLens.flowPromptChat.openState";

const flowPromptCurrentWorkspaceForStorage = () =>
  (typeof currentWorkspaceId === "function" ? currentWorkspaceId() : "") || "runtime";

const flowPromptOpenStateKey = (workspaceId = flowPromptCurrentWorkspaceForStorage()) =>
  `${FLOW_PROMPT_CHAT_OPEN_STATE_PREFIX}.${encodeURIComponent(workspaceId || "runtime")}`;

const flowPromptSaveOpenState = (isOpen = false, workspaceId = flowPromptCurrentWorkspaceForStorage()) => {
  try {
    window.localStorage?.setItem?.(flowPromptOpenStateKey(workspaceId), isOpen ? "open" : "closed");
  } catch (_) {
    // localStorage can be blocked in private/plugin contexts.
  }
};

const flowPromptShouldRestoreOpen = (workspaceId = flowPromptCurrentWorkspaceForStorage()) => {
  try {
    return window.localStorage?.getItem?.(flowPromptOpenStateKey(workspaceId)) === "open";
  } catch (_) {
    return false;
  }
};

const flowPromptMessageId = (prefix = "msg") =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const flowPromptChatTitle = (prompt = "") => {
  const value = String(prompt || "").trim().replace(/\s+/g, " ");
  return value.length > 64 ? `${value.slice(0, 61)}...` : value || "Nuova chat";
};

const flowPromptOpenDb = (version = undefined) =>
  new Promise((resolve, reject) => {
    const request = version ? indexedDB.open(tlConfig.DB_NAME, version) : indexedDB.open(tlConfig.DB_NAME);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const storeName = FLOW_PROMPT_CHAT_STORE();
      if (!db.objectStoreNames.contains(storeName)) {
        const store = db.createObjectStore(storeName, { keyPath: "id" });
        store.createIndex("workspaceId", "workspaceId", { unique: false });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error || new Error("Errore apertura storico AI Flow Chat"));
    request.onblocked = () => reject(new Error("IndexedDB bloccato da un'altra scheda."));
  });

const flowPromptEnsureChatStore = async () => {
  if (!window.indexedDB) throw new Error("IndexedDB non disponibile");
  const db = await flowPromptOpenDb();
  if (db.objectStoreNames.contains(FLOW_PROMPT_CHAT_STORE())) return db;
  const nextVersion = db.version + 1;
  db.close();
  return flowPromptOpenDb(nextVersion);
};

const flowPromptListChats = async (workspaceId = currentWorkspaceId()) => {
  const db = await flowPromptEnsureChatStore();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(FLOW_PROMPT_CHAT_STORE(), "readonly").objectStore(FLOW_PROMPT_CHAT_STORE()).getAll();
      request.onsuccess = (event) => resolve(
        Array.from(event.target.result || [])
          .filter((chat) => chat.workspaceId === workspaceId)
          .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
      );
      request.onerror = (event) => reject(event.target.error || new Error("Errore lettura storico AI Flow Chat"));
    });
  } finally {
    db.close();
  }
};

const flowPromptSaveChat = async (chat = {}) => {
  if (!chat?.id) return null;
  const db = await flowPromptEnsureChatStore();
  const record = {
    workspaceId: currentWorkspaceId(),
    title: "Nuova chat",
    messages: [],
    createdAt: flowPromptNow(),
    ...chat,
    updatedAt: flowPromptNow(),
  };
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(FLOW_PROMPT_CHAT_STORE(), "readwrite").objectStore(FLOW_PROMPT_CHAT_STORE()).put(record);
      request.onsuccess = () => resolve(record);
      request.onerror = (event) => reject(event.target.error || new Error("Errore salvataggio AI Flow Chat"));
    });
  } finally {
    db.close();
  }
};

const flowPromptDeleteChat = async (chatId = "") => {
  if (!chatId) return false;
  const db = await flowPromptEnsureChatStore();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(FLOW_PROMPT_CHAT_STORE(), "readwrite").objectStore(FLOW_PROMPT_CHAT_STORE()).delete(chatId);
      request.onsuccess = () => resolve(true);
      request.onerror = (event) => reject(event.target.error || new Error("Errore eliminazione AI Flow Chat"));
    });
  } finally {
    db.close();
  }
};

const flowPromptNewChat = (workspaceId = currentWorkspaceId()) => ({
  id: `flow_chat_${safeRuntimeId(workspaceId)}_${Date.now()}`,
  workspaceId,
  title: "Nuova chat",
  messages: [],
  createdAt: flowPromptNow(),
  updatedAt: flowPromptNow(),
});

const flowPromptPlanSnapshot = (analysis = {}) => ({
  prompt: analysis.prompt || "",
  summary: analysis.summary || "",
  planner: analysis.planner || {},
  notice: analysis.planner?.mode === "fallback" && analysis.planner?.error
    ? `Avviso AI: ${analysis.planner.error}`
    : "",
  conversationContext: analysis.conversationContext || null,
  memoryGuard: analysis.memoryGuard || null,
  preflight: flowPromptPlanPreflight(analysis),
  similarPatterns: (analysis.approvedPatterns || []).slice(0, 3),
  nodes: (analysis.analyzedNodes || []).map((item) => ({
    label: item.spec?.label || "",
    type: item.spec?.type || "",
    subtype: item.spec?.subtype || "",
    icon: item.spec?.icon || "extension",
    action: item.action || "create",
    existingId: item.existing?.id || "",
    existingLabel: item.existing?.label || "",
  })),
  edges: (analysis.analyzedEdges || []).map((edge) => ({
    sourceKey: edge.sourceKey || edge.source?.label || "",
    targetKey: edge.targetKey || edge.target?.label || "",
    sourceLabel: edge.source?.label || edge.sourceKey || "",
    targetLabel: edge.target?.label || edge.targetKey || "",
    sourcePort: edge.sourcePort || "",
    targetPort: edge.targetPort || "",
    duplicate: Boolean(edge.duplicate),
  })),
});

const flowPromptConversationContext = (messages = [], prompt = "") => {
  const list = Array.isArray(messages) ? messages : [];
  const recent = list
    .slice(-8)
    .map((message) => ({
      role: message.role || "",
      kind: message.kind || "text",
      content: String(message.content || "").replace(/\s+/g, " ").slice(0, 260),
      feedback: message.feedback?.rating || "",
    }))
    .filter((item) => item.content);
  const lastPlanMessage = [...list].reverse().find((message) => message.kind === "plan" && message.plan);
  const lastReportMessage = [...list].reverse().find((message) => message.kind === "agent-report" && message.agentReport);
  const lastPlan = lastPlanMessage?.plan ? {
    messageId: lastPlanMessage.id || "",
    summary: lastPlanMessage.plan.summary || lastPlanMessage.content || "",
    nodes: (lastPlanMessage.plan.nodes || []).map((node) => node.label).filter(Boolean).slice(0, 12),
    edges: (lastPlanMessage.plan.edges || []).map((edge) =>
      `${edge.sourceLabel || edge.sourceKey || ""} -> ${edge.targetLabel || edge.targetKey || ""}`.trim()
    ).filter((edge) => edge && edge !== "->").slice(0, 12),
  } : null;
  const normalized = flowPromptNormalize(prompt);
  const referencesPrevious = flowPromptHasAny(normalized, [
    "quello", "quella", "prima", "precedente", "stesso", "stessa", "rifallo", "rifai", "come prima", "secondo",
    "that", "previous", "same", "again", "redo", "second",
    "eso", "anterior", "mismo", "refaz", "refais", "vorher",
  ]);
  const constraints = [
    flowPromptHasAny(normalized, ["senza split", "no split", "non usare split", "without split"]) ? "avoid Split" : "",
    flowPromptHasAny(normalized, ["usa condition", "aggiungi condition", "con condition", "use condition"]) ? "add/use Condition" : "",
    flowPromptHasAny(normalized, ["flow in", "flow out", "in/out", "boundary", "confine"]) ? "include Flow In/Out boundary if useful" : "",
    flowPromptHasAny(normalized, ["piu semplice", "più semplice", "semplifica", "simpler", "simplify"]) ? "simplify previous plan" : "",
    flowPromptHasAny(normalized, ["spiega", "spiegami", "explain"]) ? "answer as explanation unless creation is explicit" : "",
    flowPromptHasAny(normalized, ["ora crealo", "crealo", "create it", "apply it"]) ? "user may refer to creating previous plan" : "",
  ].filter(Boolean);
  const hasContext = Boolean(referencesPrevious || constraints.length || lastPlan || lastReportMessage);
  if (!hasContext) return null;
  return {
    version: "flow-chat-conversation/v1",
    active: true,
    referencesPrevious,
    constraints,
    recent,
    lastPlan,
    lastReport: lastReportMessage ? {
      messageId: lastReportMessage.id || "",
      intent: lastReportMessage.agentReport?.intent || "",
      summary: lastReportMessage.content || lastReportMessage.agentReport?.content || "",
    } : null,
  };
};

const flowPromptConversationContextLabel = (conversationContext = null) => {
  if (!conversationContext?.active) return "";
  const bits = [
    conversationContext.referencesPrevious ? "usa il contesto precedente" : "",
    conversationContext.lastPlan?.nodes?.length ? `${conversationContext.lastPlan.nodes.length} nodi dal piano precedente` : "",
    ...(conversationContext.constraints || []).slice(0, 2),
  ].filter(Boolean);
  return bits.join(" · ") || "contesto chat attivo";
};

const flowPromptLastPlanActionIntent = (prompt = "") => {
  const text = flowPromptNormalize(prompt);
  if (!text) return "";
  const strong = [
    "crealo", "crea questo", "crea il flow", "crea flow", "ora crealo", "ok crealo", "applica", "applica questo",
    "procedi", "vai", "esegui", "esegui questo", "crea da questo piano",
    "create it", "apply it", "go ahead", "proceed", "create this flow",
    "aplicalo", "crealo ahora", "appliquer", "erstelle es",
  ];
  if (flowPromptHasAny(text, strong)) return "apply";
  const prepare = [
    "usa questo", "usa questo piano", "prendi questo", "carica questo", "prepara questo", "lo voglio",
    "use this", "load this", "prepare this", "use this plan",
  ];
  if (flowPromptHasAny(text, prepare)) return "prepare";
  return "";
};

const flowPromptResultSummary = (result = {}) => ({
  createdNodes: result.savedNodes?.length || 0,
  reusedNodes: result.reusedNodes?.length || 0,
  createdEdges: result.createdEdges?.length || 0,
  reusedEdges: result.reusedEdges?.length || 0,
  warnings: result.warnings || [],
  snapshotId: result.snapshotId || "",
  preflight: result.preflight || null,
  completion: result.completion || null,
});

const flowPromptBuildCompletionSummary = (analysis = {}, result = {}, preflight = null) => {
  const createdNodeLabels = (result.savedNodes || [])
    .map((node) => node.label || node.name || node.metadata?.paletteLabel || node.id)
    .filter(Boolean)
    .slice(0, 8);
  const reusedNodeLabels = (result.reusedNodes || [])
    .map((node) => node.label || node.name || node.metadata?.paletteLabel || node.id)
    .filter(Boolean)
    .slice(0, 8);
  const linkLabels = (preflight?.edges || [])
    .filter((edge) => edge.status !== "blocked")
    .map((edge) => `${edge.sourceLabel || "source"} -> ${edge.targetLabel || "target"}`)
    .filter(Boolean)
    .slice(0, 8);
  const createdCount = result.savedNodes?.length || 0;
  const reusedCount = result.reusedNodes?.length || 0;
  const edgeCount = result.createdEdges?.length || 0;
  const reusedEdgeCount = result.reusedEdges?.length || 0;
  const goal = analysis.summary || "Flow applicato con controllo.";
  const details = [
    createdCount ? `Creati ${createdCount} nodi: ${createdNodeLabels.join(", ")}.` : "",
    reusedCount ? `Riusati ${reusedCount} nodi esistenti: ${reusedNodeLabels.join(", ")}.` : "",
    edgeCount ? `Creati ${edgeCount} collegamenti validati.` : "",
    reusedEdgeCount ? `Riusati ${reusedEdgeCount} collegamenti gia presenti.` : "",
  ].filter(Boolean);
  return {
    status: "Obiettivo raggiunto",
    goal,
    details: details.length ? details : ["Il piano e stato applicato senza modifiche aggiuntive."],
    links: linkLabels,
    warningCount: result.warnings?.length || 0,
    nextStep: result.warnings?.length
      ? "Controlla i warning oppure usa Undo se vuoi ripristinare lo stato precedente."
      : "Puoi testare il flow, aprire Inspector sui nodi creati o usare Undo per tornare allo stato precedente.",
  };
};

const flowPromptBuildWorkLeadSummary = (plan = {}) => {
  const nodes = plan.nodes || [];
  const edges = plan.edges || [];
  const preflight = plan.preflight || null;
  const hasRepair = Boolean(plan.planner?.selfRepair?.attempts);
  const warnings = preflight?.warnings?.length || 0;
  const blockers = preflight?.blockers?.length || 0;
  return {
    objective: plan.summary || "Piano Flow Chat pronto.",
    constraints: [
      plan.conversationContext?.active ? flowPromptConversationContextLabel(plan.conversationContext) : "",
      plan.memoryGuard ? "memoria negativa considerata" : "",
      hasRepair ? `self-repair ${plan.planner.selfRepair.attempts}` : "",
    ].filter(Boolean),
    plan: `${nodes.length} nodi, ${edges.length} collegamenti`,
    verification: blockers
      ? `${blockers} blocchi da correggere`
      : warnings
        ? `${warnings} warning, applicazione consentita con controllo`
        : "preflight valido",
    next: blockers ? "correggi o rigenera il piano" : "puoi applicare con Crea flow",
  };
};

const flowPromptNormalize = (value = "") =>
  String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const FLOW_PROMPT_AGENT_TOOLS = Object.freeze([
  {
    name: "inspectGraph",
    label: "Inspect Runtime Graph",
    category: "read",
    status: "ready",
    mutates: false,
    description: "Read current workspace nodes, edges, channels, events and flow logs.",
  },
  {
    name: "findNode",
    label: "Find Node",
    category: "read",
    status: "ready",
    mutates: false,
    description: "Resolve a user label/id into a concrete Flow Map runtime node.",
  },
  {
    name: "diagnoseGraph",
    label: "Diagnose Graph",
    category: "read",
    status: "ready",
    mutates: false,
    description: "Detect broken links, missing nodes and structural runtime issues.",
  },
  {
    name: "queryRuntime",
    label: "Query Runtime",
    category: "read",
    status: "ready",
    mutates: false,
    description: "Query channels, events, logs and runtime activity in the current workspace.",
  },
  {
    name: "createNode",
    label: "Create Node",
    category: "write",
    status: "ready",
    mutates: true,
    description: "Materialize a new runtime node from the Flow Map palette contract.",
  },
  {
    name: "connectNodes",
    label: "Connect Nodes",
    category: "write",
    status: "ready",
    mutates: true,
    description: "Create a validated runtime dependency between compatible nodes.",
  },
  {
    name: "disconnectNodes",
    label: "Disconnect Nodes",
    category: "write",
    status: "ready",
    mutates: true,
    description: "Remove selected runtime dependencies.",
  },
  {
    name: "deleteNode",
    label: "Delete Node",
    category: "write",
    status: "ready",
    mutates: true,
    description: "Delete one runtime node and clean its graph references.",
  },
  {
    name: "duplicateNode",
    label: "Duplicate Node",
    category: "write",
    status: "ready",
    mutates: true,
    description: "Duplicate one runtime node without duplicating its graph links.",
  },
  {
    name: "moveNode",
    label: "Move Node",
    category: "write",
    status: "ready",
    mutates: true,
    description: "Move one runtime node on the Flow Map canvas.",
  },
  {
    name: "renameNode",
    label: "Rename Node",
    category: "write",
    status: "ready",
    mutates: true,
    description: "Rename one existing runtime node.",
  },
  {
    name: "updateNodeConfig",
    label: "Update Node Config",
    category: "write",
    status: "ready",
    mutates: true,
    description: "Update validated node config, input/output or channel fields.",
  },
  {
    name: "fixGraph",
    label: "Fix Graph",
    category: "write",
    status: "ready",
    mutates: true,
    description: "Apply safe graph repairs such as broken-link cleanup.",
  },
  {
    name: "researchEndpoint",
    label: "Research Endpoint",
    category: "external",
    status: "ready",
    mutates: false,
    description: "Suggest candidate API endpoints for a user goal without mutating the graph.",
  },
  {
    name: "validateEndpoint",
    label: "Validate Endpoint",
    category: "external",
    status: "ready",
    mutates: false,
    description: "Verify URL shape, method, expected response and safety before saving.",
  },
]);

const FLOW_PROMPT_AGENT_TOOL_MAP = Object.freeze(
  FLOW_PROMPT_AGENT_TOOLS.reduce((map, tool) => ({ ...map, [tool.name]: tool }), {})
);

const flowPromptAgentTool = (name = "") =>
  FLOW_PROMPT_AGENT_TOOL_MAP[name] || null;

const flowPromptAgentToolForAction = (action = {}) => {
  if (!action || typeof action !== "object") return "";
  if (action.tool && flowPromptAgentTool(action.tool)) return action.tool;
  if (action.type === "fixRuntimeError") return "diagnoseGraph";
  if (action.type === "researchEndpoint") return "researchEndpoint";
  if (action.type === "connect") return "connectNodes";
  if (action.type === "deleteDependencies") return "disconnectNodes";
  if (action.type === "deleteNode") return "deleteNode";
  if (action.type === "duplicateNode") return "duplicateNode";
  if (action.type === "moveNode") return "moveNode";
  if (action.type === "renameNode") return "renameNode";
  if (action.type === "updateNodeConfig") return "updateNodeConfig";
  if (action.type === "fix") return "fixGraph";
  if (action.type === "batch") return "";
  return action.type || "";
};

const flowPromptAgentToolIsReady = (name = "") =>
  flowPromptAgentTool(name)?.status === "ready";

const flowPromptAnnotateActionTool = (action = {}, forcedTool = "") => {
  const safeAction = action && typeof action === "object" ? action : {};
  const toolName = forcedTool || flowPromptAgentToolForAction(safeAction);
  const tool = flowPromptAgentTool(toolName);
  return {
    ...safeAction,
    tool: toolName || safeAction.tool || "",
    toolStatus: tool?.status || safeAction.toolStatus || "",
    toolMutates: typeof tool?.mutates === "boolean" ? tool.mutates : Boolean(safeAction.toolMutates),
    toolCategory: tool?.category || safeAction.toolCategory || "",
  };
};

const flowPromptAnnotateActionPlan = (plan = null) => {
  if (!plan) return plan;
  if (plan.type === "batch") {
    const actions = (plan.actions || [])
      .map((action) => flowPromptAnnotateActionPlan(action))
      .filter(Boolean);
    return flowPromptAnnotateActionTool({
      ...plan,
      actions,
      status: flowPromptPlanStatus(actions),
      tools: flowPromptPlanTools({ ...plan, actions }),
    });
  }
  return flowPromptAnnotateActionTool(plan);
};

const flowPromptPlanTools = (plan = null) => {
  const tools = new Map();
  const visit = (action = {}) => {
    if (!action) return;
    if (action.type === "batch") {
      (action.actions || []).forEach(visit);
      return;
    }
    const toolName = flowPromptAgentToolForAction(action);
    const tool = flowPromptAgentTool(toolName);
    if (tool) tools.set(tool.name, {
      name: tool.name,
      status: tool.status,
      category: tool.category,
      mutates: tool.mutates,
    });
  };
  visit(plan);
  return Array.from(tools.values());
};

const flowPromptAgentToolManifest = () =>
  FLOW_PROMPT_AGENT_TOOLS.map(({ name, status, category, mutates, description }) => ({
    name,
    status,
    category,
    mutates,
    description,
  }));

const flowPromptTokenSet = (value = "") =>
  new Set(flowPromptNormalize(value).split(/\s+/).filter(Boolean));

const flowPromptPortName = (port, fallback = "input") =>
  String(typeof port === "string" ? port : port?.name || fallback);

const flowPromptPaletteItem = (label = "") =>
  flatPalette().find((item) => flowPromptNormalize(item.label) === flowPromptNormalize(label)) || null;

const flowPromptPaletteItemForAiNode = (node = {}) => {
  const labelMatch = flowPromptPaletteItem(node.label || node.name || node.paletteLabel);
  if (labelMatch) return labelMatch;
  const type = flowPromptNormalize(node.type || node.nodeType);
  const subtype = flowPromptNormalize(node.subtype);
  const category = flowPromptNormalize(node.category);
  return flatPalette().find((item) =>
    type && subtype &&
    flowPromptNormalize(item.nodeType) === type &&
    flowPromptNormalize(item.subtype) === subtype
  ) || flatPalette().find((item) =>
    subtype && flowPromptNormalize(item.subtype) === subtype
  ) || flatPalette().find((item) =>
    category && flowPromptNormalize(item.category) === category
  ) || null;
};

const flowPromptStrictPaletteItemForAiNode = (node = {}) => {
  const labelMatch = flowPromptPaletteItem(node.label || node.name || node.paletteLabel);
  if (labelMatch) return labelMatch;
  const type = flowPromptNormalize(node.type || node.nodeType);
  const subtype = flowPromptNormalize(node.subtype);
  if (!subtype) return null;
  return flatPalette().find((item) =>
    type &&
    flowPromptNormalize(item.nodeType) === type &&
    flowPromptNormalize(item.subtype) === subtype
  ) || flatPalette().find((item) =>
    flowPromptNormalize(item.subtype) === subtype
  ) || null;
};

const flowPromptSpecFromPalette = (label, overrides = {}) => {
  const item = flowPromptPaletteItem(label) || {};
  return {
    label: item.label || label,
    icon: item.icon || overrides.icon || "extension",
    tone: item.tone || overrides.tone || "gold",
    type: item.nodeType || overrides.type || "custom",
    subtype: item.subtype || overrides.subtype || flowPromptNormalize(label).replace(/\s+/g, "-") || "custom",
    category: item.category || overrides.category || "custom",
    inputs: item.inputs || item.manifest?.inputs || overrides.inputs || [],
    outputs: item.outputs || item.manifest?.outputs || overrides.outputs || [],
    permissions: item.permissions || item.manifest?.permissions || overrides.permissions || [],
    manifest: item.manifest || overrides.manifest || null,
    runtime: item.runtime || item.manifest?.runtime || overrides.runtime || {},
    settingsSchema: item.settingsSchema || item.manifest?.settingsSchema || overrides.settingsSchema || {},
    connectionType: item.connectionType || item.url || overrides.connectionType || label,
    config: overrides.config || {},
    description: overrides.description || "",
  };
};

const flowPromptHasAny = (text, words = []) => {
  const normalized = flowPromptNormalize(text);
  return words.some((word) => normalized.includes(flowPromptNormalize(word)));
};

const flowPromptExtractPreferenceMemory = (prompt = "") => {
  const raw = String(prompt || "").trim();
  const text = flowPromptNormalize(raw);
  const prefixes = [
    /^(?:ricordati|ricorda|memorizza|salva in memoria|tieni a mente|remember|memorize|save this|keep in mind)(?:\s+(?:che|di|that|to))?\s*[:,-]?\s+(.+)$/i,
    /^(?:preferisco|la mia preferenza e|la mia preferenza è|my preference is)\s+(.+)$/i,
  ];
  const explicit = prefixes
    .map((regex) => raw.match(regex)?.[1]?.trim())
    .find(Boolean);
  if (!explicit || explicit.length < 6) return null;
  if (flowPromptHasAny(text, ["non ricordare", "non memorizzare", "forget", "dimentica"])) return null;
  const normalizedValue = explicit.replace(/\s+/g, " ").slice(0, 500);
  return {
    kind: "user-preference",
    name: "Preferenza utente",
    text: normalizedValue,
    summary: normalizedValue.slice(0, 180),
    tags: ["preference", "explicit"],
  };
};

const flowPromptIsInventoryQuestion = (prompt = "") => {
  const text = flowPromptNormalize(prompt);
  const asksInfo = [
    "che node", "che nodi", "quali node", "quali nodi", "node ci sono", "nodi ci sono",
    "lista node", "lista nodi", "mostra node", "mostra nodi", "elenca node", "elenca nodi",
    "what nodes", "which nodes", "list nodes", "show nodes", "available nodes", "current nodes",
    "che collegamenti", "quali collegamenti", "lista collegamenti", "show links", "list links",
  ].some((phrase) => text.includes(flowPromptNormalize(phrase)));
  const asksCreation = [
    "crea", "creare", "genera", "generare", "aggiungi", "costruisci", "build", "create", "generate", "add",
  ].some((phrase) => text.includes(flowPromptNormalize(phrase)));
  return asksInfo && !asksCreation;
};

const flowPromptIsCreationRequest = (prompt = "") =>
  !flowPromptIsExplainOnlyRequest(prompt) && flowPromptHasAny(prompt, [
    "crea", "creare", "genera", "generare", "aggiungi", "costruisci", "build", "create", "generate", "add",
    "nuovo flow", "new flow", "pipeline", "workflow",
  ]);

const flowPromptIsExplainOnlyRequest = (prompt = "") => {
  const text = flowPromptNormalize(prompt);
  const asksExplain = flowPromptHasAny(text, [
    "spiega", "spiegami", "mi spieghi", "explain", "why", "perche", "perché", "come funziona", "what is", "cosa e", "cosa è",
  ]);
  const asksApply = flowPromptHasAny(text, [
    "crea", "creare", "crealo", "applica", "procedi", "genera", "aggiungi", "inserisci", "modifica", "sistema", "fix", "build", "create", "apply", "add",
  ]);
  return asksExplain && !asksApply;
};

const flowPromptQuestionLanguage = (prompt = "") => {
  const text = flowPromptNormalize(prompt);
  const scores = {
    it: ["mi ", " spieg", "spieg", "che ", "cosa", "quale", "quali", "nodo", "nodi", "agente", "agenti", "collegamento", "perche", "perché", "in punti"],
    es: ["que ", "qué ", "como", "cómo", "nodo", "agente", "explica", "dime", "en puntos"],
    fr: ["que ", "quoi", "comment", "noeud", "agent", "explique", "dis moi", "en points"],
    de: ["was ", "wie ", "knoten", "agent", "erklar", "erklär", "punkte"],
    en: ["what", "which", "how", "explain", "tell me", "node", "agent", "workflow", "in points"],
  };
  const ranked = Object.entries(scores)
    .map(([lang, tokens]) => [lang, tokens.reduce((sum, token) => sum + (text.includes(flowPromptNormalize(token)) ? 1 : 0), 0)])
    .sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[1] > 0 ? ranked[0][0] : "it";
};

const flowPromptLanguageName = (lang = "it") => ({
  it: "Italian",
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
})[lang] || "the same language as the user request";

const flowPromptLanguageRule = (prompt = "") =>
  `Golden language rule: answer in ${flowPromptLanguageName(flowPromptQuestionLanguage(prompt))}, the same language as the user request.`;

const flowPromptIsSimpleDefinitionQuestion = (prompt = "") => {
  const text = flowPromptNormalize(prompt);
  const asksDefinition = flowPromptHasAny(text, [
    "cosa e", "cosa è", "che cos e", "che cos'è", "cos e", "cos'è", "what is", "what's", "define",
  ]);
  const target = flowPromptHasAny(text, ["flow map", "flowmap", "flow-map"]);
  const asksMutation = flowPromptHasAny(text, ["crea", "creare", "applica", "modifica", "fix", "sistema", "create", "apply", "update"]);
  return asksDefinition && target && !asksMutation;
};

const flowPromptLocalDefinitionAnswer = (prompt = "") => {
  const lang = flowPromptQuestionLanguage(prompt);
  if (lang === "en") {
    return "Flow Map is the Trackers Lens runtime graph: a workspace where nodes, links, ports, channels, events and logs describe how data moves and how AI/runtime components work together. It is not just a visual canvas; it is the operational map that the runtime can inspect, validate, trace and eventually execute.";
  }
  return "Il Flow Map è il grafo runtime di Trackers Lens: uno spazio dove nodi, link, porte, canali, eventi e log descrivono come si muovono i dati e come collaborano componenti AI/runtime. Non è solo una canvas visuale: è la mappa operativa che il runtime può ispezionare, validare, tracciare e poi eseguire in modo controllato.";
};

const flowPromptUiText = (key = "", lang = "en") => {
  const dictionary = {
    brainDetails: { en: "Brain details", it: "Dettagli Brain" },
    providerHealth: { en: "Provider health", it: "Stato provider" },
    agentRuntime: { en: "Agent Runtime", it: "Agent Runtime" },
    runtimeTools: { en: "Runtime tools", it: "Strumenti runtime" },
    memoryRank: { en: "Memory rank", it: "Ranking memoria" },
    ragSources: { en: "RAG sources", it: "Fonti RAG" },
    diagnostics: { en: "Diagnostics", it: "Diagnostica" },
  };
  return dictionary[key]?.[lang] || dictionary[key]?.en || key;
};

const flowPromptIsArchitectureAdviceRequest = (prompt = "") => {
  const text = flowPromptNormalize(prompt);
  const asksAdvice = flowPromptHasAny(text, [
    "consiglia", "consigliami", "suggerisci", "suggerire", "mi dici", "dimmi", "quale nodo", "che nodo",
    "quale node", "che node", "node da inserire", "node da insertare", "nodo da inserire", "nodo da insertare",
    "serve per", "best practice", "architettura", "professionale", "capo lavoro", "come posso", "come possiamo",
    "come render", "pattern", "progetta", "disegna",
  ]);
  const asksDesignTarget = flowPromptHasAny(text, [
    "flow", "pipeline", "workflow", "agent", "agente", "agenti", "orchestrator", "orchestratore",
    "node", "nodo", "nodi", "edge", "edges", "link", "collegamento", "input", "output", " in ", " out ",
    "in/out", "out/in", "dividere", "separare", "split", "router", "routing", "porta", "porte",
  ]);
  const asksCurrentInventory = flowPromptIsInventoryQuestion(prompt) && !flowPromptHasAny(text, [
    "da inserire", "da insertare", "serve per", "consiglia", "suggerisci", "best practice", "pattern",
  ]);
  return asksAdvice && asksDesignTarget && !asksCurrentInventory;
};

const flowPromptLooksLikeFlowRequest = (prompt = "") =>
  flowPromptIsCreationRequest(prompt) || flowPromptHasAny(prompt, [
    "flow", "pipeline", "workflow", "agent", "agente", "orchestrator", "orchestratore", "node", "nodo", "nodi",
    "source", "tracker", "processor", "lens", "preview", "telegram", "rss", "websocket", "rest api", "database",
    "storage", "notification", "notifica",
  ]);

const flowPromptShouldPlanFromPrompt = (prompt = "", conversationContext = null) => {
  if (flowPromptIsExplainOnlyRequest(prompt)) return false;
  if (flowPromptLooksLikeFlowRequest(prompt)) return true;
  if (!conversationContext?.lastPlan) return false;
  const text = flowPromptNormalize(prompt);
  if (flowPromptHasAny(text, [
    "spiega", "spiegami", "explain", "perche", "perché", "why", "cosa", "what is",
  ]) && !flowPromptHasAny(text, [
    "rifallo", "rifai", "crea", "crealo", "aggiorna", "aggiungi", "senza", "usa", "use", "add", "without", "redo",
  ])) return false;
  return Boolean(conversationContext.referencesPrevious || conversationContext.constraints?.length);
};

const flowPromptIsReadOnlyRuntimeQuestion = (prompt = "") => {
  const text = flowPromptNormalize(prompt);
  if (flowPromptIsMutationRequest(prompt) || flowPromptIsCreationRequest(prompt)) return false;
  const asks = flowPromptHasAny(text, [
    "che", "cosa", "quale", "quali", "quanto", "quanti", "quante", "dimmi", "mostra", "mostrami",
    "lista", "elenca", "spiega", "spieghi", "spiegami", "sai", "stai usando", "sto usando", "what", "which", "show", "list",
    "tell me", "how many",
  ]);
  const runtimeSubject = flowPromptHasAny(text, [
    "provider", "modello", "model", "settings", "impostazioni", "config", "configurazione",
    "node", "nodo", "nodi", "canale", "canali", "channel", "channels", "link", "collegamenti",
    "edge", "edges", "runtime", "eventi", "events", "log", "logs", "errore", "errori",
    "error", "errors", "failed", "failure",
    "impatto", "impact", "dipendenze", "dependencies",
    "memoria", "memory", "workspace", "flow map", "preview", "telegram", "rest api", "websocket",
  ]);
  return asks && runtimeSubject;
};

const flowPromptIsMutationRequest = (prompt = "") =>
  flowPromptHasAny(prompt, [
    "modifica", "modificare", "cambia", "cambiare", "aggiorna", "aggiornare", "rinomina", "rimuovi",
    "elimina", "elimini", "elimine", "eliminare", "cancella", "cancellare", "sistema", "fix", "repair", "update", "rename", "remove", "delete",
    "duplica", "duplicare", "copia", "clona", "duplicate", "clone", "sposta", "spostare", "muovi", "move",
    "scollega", "disconnetti", "unlink", "disconnect", "metti", "inserisci", "configura", "cerca", "cerchi", "trova",
  ]);

const flowPromptIsAgentQuestion = (prompt = "") => {
  if (flowPromptIsCreationRequest(prompt)) return false;
  const text = flowPromptNormalize(prompt);
  return flowPromptIsArchitectureAdviceRequest(prompt) || flowPromptIsInventoryQuestion(prompt) || flowPromptIsReadOnlyRuntimeQuestion(prompt) || flowPromptHasAny(text, [
    "spiega", "spieghi", "spiegami", "explain", "analizza", "analisi", "diagnosi", "diagnostica", "controlla",
    "impatto", "impact", "cosa succede", "cosa succederebbe", "dipendenze", "dependencies",
    "errore", "errori", "warning", "problema", "problemi", "rotto", "broken", "invalid",
    "collegamenti", "links", "edges", "canali", "channels", "eventi", "events", "log", "logs",
    "runtime", "stato", "status", "db", "database", "indexeddb", "workspace", "flow map",
    "collega", "connetti", "connect", "link", "rinomina", "rename", "cambia", "imposta", "set", "aggiorna",
    "rimuovi", "elimina", "elimini", "elimine", "eliminare", "cancella", "cancellare", "remove", "delete",
    "duplica", "duplicare", "copia", "clona", "duplicate", "clone", "sposta", "spostare", "muovi", "move",
    "sistema", "fix", "ripara", "metti", "inserisci", "configura", "cerca", "cerchi", "trova", "endpoint",
    "perche", "perché", "why", "come funziona", "what is", "quali", "che cosa",
  ]);
};

const flowPromptAgentIntent = (prompt = "") => {
  const text = flowPromptNormalize(prompt);
  const asksRuntimeErrors = flowPromptHasAny(text, ["runtime"]) && flowPromptHasAny(text, [
    "errore", "errori", "error", "errors", "failed", "failure",
  ]);
  if (flowPromptIsArchitectureAdviceRequest(prompt)) return "advice";
  if (
    flowPromptHasAny(text, ["elimina", "elimini", "elimine", "eliminare", "cancella", "cancellare", "rimuovi", "remove", "delete"]) &&
    !flowPromptHasAny(text, ["collegamento", "collegamenti", "link", "edge", "dependency"]) &&
    flowPromptHasAny(text, ["node", "nodo", "telegram", "preview", "rest", "websocket", "agent", "source", "tracker"])
  ) return "deleteNode";
  if (flowPromptHasAny(text, ["duplica", "duplicare", "copia", "clona", "duplicate", "clone"]) && flowPromptHasAny(text, ["node", "nodo", "telegram", "preview", "rest", "websocket", "agent", "source", "tracker"])) return "duplicateNode";
  if (flowPromptHasAny(text, ["sposta", "spostare", "muovi", "move"]) && flowPromptHasAny(text, ["node", "nodo", "telegram", "preview", "rest", "websocket", "agent", "source", "tracker", "destra", "sinistra", "sopra", "sotto", "right", "left", "up", "down"])) return "moveNode";
  if (flowPromptHasAny(text, ["scollega", "disconnetti", "unlink", "disconnect", "rimuovi collegamento"]) && flowPromptHasAny(text, [" a ", " da ", " ad ", " to ", "->"])) return "disconnect";
  if (flowPromptHasAny(text, ["collega", "connetti", "connect", "link"]) && flowPromptHasAny(text, [" a ", " ad ", " to ", "->"])) return "connect";
  if (flowPromptHasAny(text, ["fix", "sistema", "ripara", "correggi", "prepara fix"]) && flowPromptHasAny(text, ["runtime", "errore", "error", "flowlog", "log"])) return "fixRuntimeError";
  if (flowPromptHasAny(text, ["sistema", "fix", "ripara", "proponi fix"]) && flowPromptHasAny(text, ["errore", "errori", "rotto", "rotti", "broken", "collegamenti"])) return "fix";
  if (flowPromptHasAny(text, ["rinomina", "rename", "cambia di nome", "cambiare di nome"])) return "rename";
  if (flowPromptHasAny(text, ["cambia", "imposta", "set", "aggiorna", "metti", "inserisci", "configura", "cerca", "cerchi", "trova"]) && flowPromptHasAny(text, ["provider", "modello", "model", "chatid", "chat id", "url", "endpoint", "method", "metodo", "canale", "channel", "output", "input", "rest api"])) return "config";
  if (flowPromptIsMutationRequest(text)) return "mutation";
  if (asksRuntimeErrors) return "runtime";
  if (flowPromptHasAny(text, ["errore", "errori", "error", "errors", "warning", "problema", "problemi", "diagnosi", "diagnostica", "controlla", "rotto", "broken", "invalid"])) return "diagnostics";
  if (flowPromptHasAny(text, ["canali", "channels", "channel"])) return "channels";
  if (flowPromptHasAny(text, ["eventi", "events", "log", "logs", "runtime", "runtime recente", "recenti", "recent"])) return "runtime";
  if (flowPromptHasAny(text, ["collegamenti", "links", "edges", "dipendenze", "dependencies", "impatto", "impact"])) return "edges";
  if (flowPromptHasAny(text, ["config", "configurazione", "settings", "impostazioni", "provider", "modello", "model", "endpoint", "url", "method", "metodo"])) return "config";
  if (flowPromptHasAny(text, ["memoria", "memory", "ricordi", "remember"])) return "memory";
  if (flowPromptIsInventoryQuestion(text) || flowPromptHasAny(text, ["node", "nodi", "nodes", "inventario", "inventory"])) return "nodes";
  if (flowPromptHasAny(text, ["spiega", "spieghi", "spiegami", "explain", "come funziona", "what is", "workspace", "flow map"])) return "explain";
  if (flowPromptHasAny(text, ["db", "database", "indexeddb"])) return "database";
  return "summary";
};

const flowPromptQueryMetric = (prompt = "") => {
  const text = flowPromptNormalize(prompt);
  if (flowPromptHasAny(text, ["quanti", "quante", "count", "numero", "totale", "how many"])) return "count";
  if (flowPromptHasAny(text, ["quali", "lista", "elenca", "mostra", "dimmi", "show", "list", "which"])) return "list";
  return "summary";
};

const flowPromptQueryFilter = (prompt = "") => {
  const text = flowPromptNormalize(prompt);
  const quoted = String(prompt || "").match(/["'“”](.+?)["'“”]/);
  if (quoted?.[1]) return quoted[1].trim();
  const channelMatch = text.match(/\b(?:canale|channel|ch)\s+([a-z0-9._:-]{3,80})/i);
  if (channelMatch?.[1]) return channelMatch[1].trim();
  const nodeMatch = text.match(/\b(?:nodo|node)\s+([a-z0-9._:-][a-z0-9._:\-\s]{2,64})/i);
  if (nodeMatch?.[1]) return nodeMatch[1].trim();
  if (flowPromptHasAny(text, ["errore", "errori", "error", "errors", "failed", "failure"])) return "error";
  const known = [
    "action", "actions", "telegram", "preview", "ai", "agent", "analyzer", "orchestrator", "source",
    "tracker", "processor", "storage", "lens", "error", "warning", "active", "idle", "draft", "websocket",
    "rss", "rest", "database", "history", "raw", "output", "input", "provider", "model", "modello", "endpoint",
  ];
  const knownMatch = known.find((token) => flowPromptHasAny(text, [token]));
  if (knownMatch) return knownMatch;
  const relationMatch = text.match(/\b(?:di|del|della|dello|su|sul|sulla|per|from|about)\s+([a-z0-9._:-][a-z0-9._:\-\s]{2,48})$/i);
  return String(relationMatch?.[1] || "")
    .replace(/\b(nodi|node|nodes|canali|channels|collegamenti|links|eventi|events|log|runtime|config|settings)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const flowPromptMatchFilter = (item = {}, filter = "") => {
  if (!filter) return true;
  const haystack = [
    item.id, item.name, item.label, item.type, item.subtype, item.category, item.status, item.channel,
    item.sourceLabel, item.targetLabel, item.sourcePort, item.targetPort, item.eventType, item.level,
    item.message, item.title, item.detail,
  ].filter(Boolean).join(" ");
  return flowPromptNormalize(haystack).includes(flowPromptNormalize(filter));
};

const flowPromptAgentQuery = (context = {}, prompt = "") => {
  const intent = flowPromptAgentIntent(prompt);
  const metric = flowPromptQueryMetric(prompt);
  const filter = flowPromptQueryFilter(prompt);
  const diagnostics = flowPromptDiagnoseContext(context);
  const datasets = {
    nodes: context.nodes || [],
    edges: context.edges || [],
    channels: context.channels || [],
    runtime: [...(context.flowLogs || []), ...(context.events || [])],
    diagnostics,
  };
  const entity = intent === "channels" ? "channels"
    : intent === "edges" ? "edges"
      : intent === "runtime" ? "runtime"
        : intent === "diagnostics" ? "diagnostics"
          : "nodes";
  const allItems = datasets[entity] || [];
  const items = allItems.filter((item) => flowPromptMatchFilter(item, filter));
  return {
    entity,
    metric,
    filter,
    items,
    total: items.length,
    allTotal: allItems.length,
  };
};

const flowPromptInventorySnapshot = () => {
  const nodes = (state.runtime.nodes || []).map((node) => ({
    id: node.id,
    label: node.label || node.id,
    type: node.type || "node",
    subtype: nodeSubtype(node),
    category: nodeCategory(node),
    status: node.runtime?.status || node.status || "idle",
    inputs: (node.inputs || []).map((port) => flowPromptPortName(port, "")).filter(Boolean),
    outputs: (node.outputs || []).map((port) => flowPromptPortName(port, "")).filter(Boolean),
    channels: (node.channels || []).map((port) => flowPromptPortName(port, "")).filter(Boolean),
    icon: graphIcon(node) || "extension",
    metadata: node.metadata || {},
    runtime: node.runtime || {},
  }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges = (state.runtime.dependencies || []).map((edge) => ({
    id: edge.id,
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
    sourceLabel: nodeById.get(edge.sourceNodeId)?.label || edge.sourceNodeId || "",
    targetLabel: nodeById.get(edge.targetNodeId)?.label || edge.targetNodeId || "",
    channel: edge.channel || "",
    sourcePort: edge.metadata?.sourcePort || edge.sourcePort || "",
    targetPort: edge.metadata?.targetPort || edge.targetPort || "",
    status: edge.status || "active",
  }));
  return {
    workspaceId: currentWorkspaceId(),
    workspaceName: currentWorkspaceName(),
    nodes,
    edges,
    summary: `${nodes.length} nodi e ${edges.length} collegamenti nel workspace corrente.`,
  };
};

const flowPromptRecentRecords = (items = [], limit = 12) =>
  Array.from(items || [])
    .slice()
    .sort((a, b) => String(b.createdAt || b.updatedAt || b.lastEmittedAt || "").localeCompare(String(a.createdAt || a.updatedAt || a.lastEmittedAt || "")))
    .slice(0, limit);

const flowPromptReadScopedRecords = async (storeKey, fallback) => {
  const workspaceId = currentWorkspaceId();
  if (typeof readScopedRuntimeStore !== "function") return [];
  return readScopedRuntimeStore(runtimeStoreName(storeKey, fallback), workspaceId).catch(() => []);
};

const flowPromptAgentContext = async () => {
  const inventory = flowPromptInventorySnapshot();
  const [dbChannels, dbEvents, dbFlowLogs] = await Promise.all([
    (state.runtime.channels || []).length ? Promise.resolve(state.runtime.channels) : flowPromptReadScopedRecords("TL_CHANNELS", "tl_channels"),
    (state.runtime.events || []).length ? Promise.resolve(state.runtime.events) : flowPromptReadScopedRecords("TL_EVENTS", "tl_events"),
    (state.runtime.flowLogs || []).length ? Promise.resolve(state.runtime.flowLogs) : flowPromptReadScopedRecords("TL_FLOW_LOGS", "tl_flow_logs"),
  ]);
  return {
    ...inventory,
    channels: Array.from(dbChannels || []),
    events: flowPromptRecentRecords(dbEvents, 20),
    flowLogs: flowPromptRecentRecords(dbFlowLogs, 20),
  };
};

const flowPromptReadSettingsSnapshot = async () => {
  const record = await readRuntimeRecord(runtimeStoreName("TL_SETTINGS", "tl_settings"), "global").catch(() => null);
  const settings = record?.settings || record || {};
  const ai = settings.ai || record?.ai || {};
  return {
    exists: !!record,
    ai: {
      provider: ai.provider || "",
      model: ai.model || "",
      temperature: ai.temperature ?? "",
      maxTokens: ai.maxTokens ?? "",
      localFirst: typeof ai.localFirst === "boolean" ? ai.localFirst : null,
    },
    rawKeys: Object.keys(settings || {}).slice(0, 20),
  };
};

const flowPromptReadAiRuntimeSnapshot = async () => {
  const data = await window.TrackerLensAiRuntimeStore?.list?.().catch(() => null);
  if (!data) return { providers: [], agents: [], runtimeAgents: [], jobs: [], logs: [], prompts: [] };
  return {
    providers: Array.from(data.providers || []),
    agents: Array.from(data.agents || []),
    runtimeAgents: Array.from(data.runtimeAgents || data.runtime || []),
    jobs: flowPromptRecentRecords(data.jobs || [], 10),
    logs: flowPromptRecentRecords(data.logs || [], 10),
    prompts: Array.from(data.prompts || data.promptFlows || []),
  };
};

const flowPromptNodeConnectivity = (context = {}, node = {}) => {
  const incoming = (context.edges || []).filter((edge) => edge.targetNodeId === node.id);
  const outgoing = (context.edges || []).filter((edge) => edge.sourceNodeId === node.id);
  const nodeChannels = new Set([...(node.inputs || []), ...(node.outputs || []), ...(node.channels || [])].filter(Boolean));
  const events = (context.events || []).filter((event) =>
    event.nodeId === node.id ||
    event.sourceNodeId === node.id ||
    event.targetNodeId === node.id ||
    nodeChannels.has(event.channel)
  );
  const logs = (context.flowLogs || []).filter((log) =>
    log.nodeId === node.id ||
    log.context?.nodeId === node.id ||
    nodeChannels.has(log.channel)
  );
  return {
    incoming,
    outgoing,
    channels: Array.from(nodeChannels),
    events: flowPromptRecentRecords(events, 5),
    logs: flowPromptRecentRecords(logs, 5),
  };
};

const flowPromptChannelName = (channel = {}) =>
  String(channel.name || channel.channel || channel.id || "").trim();

const flowPromptBuildChannelLineage = async (context = {}, filter = "") => {
  const channels = context.channels || [];
  const candidates = (filter
    ? channels.filter((channel) =>
      flowPromptMatchFilter(channel, filter) ||
      flowPromptNormalize(flowPromptChannelName(channel)).includes(flowPromptNormalize(filter))
    )
    : channels).slice(0, 10);
  const producerMap = new Map();
  const consumerMap = new Map();
  (context.nodes || []).forEach((node) => {
    (node.outputs || []).concat(node.channels || []).forEach((name) => {
      const key = String(name || "").trim();
      if (key) producerMap.set(key, [...(producerMap.get(key) || []), node]);
    });
    (node.inputs || []).forEach((name) => {
      const key = String(name || "").trim();
      if (key) consumerMap.set(key, [...(consumerMap.get(key) || []), node]);
    });
  });
  const inspected = [];
  for (const channel of candidates.slice(0, 4)) {
    const name = flowPromptChannelName(channel);
    if (!name || !window.TrackerLensChannelRegistry?.inspectChannel) continue;
    const report = await window.TrackerLensChannelRegistry.inspectChannel({
      workspaceId: currentWorkspaceId() || channel.workspaceId || "global",
      channel: name,
    }).catch(() => null);
    if (report) inspected.push(report);
  }
  return candidates.map((channel) => {
    const name = flowPromptChannelName(channel);
    const relatedEdges = (context.edges || []).filter((edge) =>
      edge.channel === name || edge.sourcePort === name || edge.targetPort === name
    );
    return {
      channel,
      name,
      producers: producerMap.get(name) || [],
      consumers: consumerMap.get(name) || [],
      edges: relatedEdges,
      recentEvents: flowPromptRecentRecords((context.events || []).filter((event) => event.channel === name), 4),
      inspect: inspected.find((report) => flowPromptNormalize(report.channel || report.name || "") === flowPromptNormalize(name)) || null,
    };
  });
};

const flowPromptRecordContextValue = (record = {}, keys = []) => {
  for (const key of keys) {
    const value = record?.[key] ?? record?.context?.[key] ?? record?.meta?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
};

const flowPromptRuntimeRecordNode = (context = {}, record = {}) => {
  const id = flowPromptRecordContextValue(record, ["nodeId", "sourceNodeId", "targetNodeId"]);
  const label = flowPromptRecordContextValue(record, ["nodeLabel", "label", "nodeName"]);
  return (context.nodes || []).find((node) =>
    [node.id, node.label, node.name].filter(Boolean).map((item) => flowPromptNormalize(item)).includes(flowPromptNormalize(id || label))
  ) || null;
};

const flowPromptRuntimeErrorDiagnosis = (context = {}, record = {}) => {
  const node = flowPromptRuntimeRecordNode(context, record);
  const url = flowPromptRecordContextValue(record, ["requestUrl", "endpoint", "url"]);
  const method = flowPromptRecordContextValue(record, ["method"]) || "";
  const status = flowPromptRecordContextValue(record, ["status"]);
  const statusText = flowPromptRecordContextValue(record, ["statusText"]);
  const kind = flowPromptRecordContextValue(record, ["errorKind", "type"]) || "";
  const error = flowPromptRecordContextValue(record, ["error", "message"]) || record.message || "";
  const diagnostic = flowPromptRecordContextValue(record, ["diagnostic"]) || "";
  const normalizedKind = flowPromptNormalize(kind);
  const normalizedError = flowPromptNormalize(error);
  let cause = "Errore runtime registrato nel flow log.";
  let suggestion = "Apri l'inspector del nodo e verifica configurazione, input e log correlati.";
  if (normalizedKind === "http" || Number(status) >= 400) {
    cause = `La chiamata HTTP ha ricevuto una risposta non valida${status ? ` (${status}${statusText ? ` ${statusText}` : ""})` : ""}.`;
    suggestion = "Controlla endpoint, metodo, parametri, headers e permessi del servizio remoto.";
  } else if (normalizedKind === "network-or-cors" || normalizedError.includes("failed to fetch")) {
    cause = "La richiesta non ha ricevuto nessuna risposta HTTP: lo status resta null.";
    suggestion = "Il dominio/API potrebbe non esistere, non rispondere, avere DNS/TLS non valido, CORS bloccato o mixed content. Verifica l'URL o usa un endpoint confermato/proxy.";
  } else if (normalizedKind === "abort") {
    cause = "La richiesta e stata annullata o ha superato il timeout prima della risposta.";
    suggestion = "Aumenta timeout, controlla rete o riprova il Live Test.";
  } else if (!url && /endpoint|url.*mancante|mancante/i.test(String(error || record.message || ""))) {
    cause = "Il nodo non ha un endpoint configurato.";
    suggestion = "Configura un URL esplicito nel nodo prima di rilanciare il test.";
  }
  const canPrepareEndpointConfig = !!node && (
    !url ||
    /^https?:\/\/\s*$/i.test(String(url || "")) ||
    /endpoint|url.*mancante|mancante/i.test(String(error || record.message || ""))
  );
  return {
    recordId: record.id || "",
    nodeId: node?.id || flowPromptRecordContextValue(record, ["nodeId"]) || "",
    nodeLabel: node?.label || flowPromptRecordContextValue(record, ["nodeLabel"]) || "",
    url,
    method,
    status,
    statusText,
    kind,
    error,
    cause,
    suggestion: diagnostic || suggestion,
    canRetry: !!node,
    canInspect: !!node,
    canPrepareEndpointConfig,
  };
};

const flowPromptRuntimeErrorProvenance = (context = {}, record = {}, insight = null) => {
  const diagnosis = insight || flowPromptRuntimeErrorDiagnosis(context, record);
  const node = flowPromptRuntimeRecordNode(context, record);
  const recordId = record.id || diagnosis.recordId || "";
  const action = record.action || record.eventType || record.type || record.context?.action || "";
  const level = record.level || record.status || record.severity || "error";
  const createdAt = record.createdAt || record.time || record.updatedAt || flowPromptNow();
  const fixHint = diagnosis.canPrepareEndpointConfig
    ? "configure-explicit-endpoint"
    : diagnosis.canRetry
      ? "inspect-node-and-retry"
      : "inspect-raw-log";
  const title = [
    diagnosis.nodeLabel || node?.label || "Runtime",
    diagnosis.kind || action || "error",
    diagnosis.status ? `status ${diagnosis.status}` : "",
  ].filter(Boolean).join(" · ");
  return {
    kind: "runtime-error-diagnosis",
    recordId,
    action,
    level,
    createdAt,
    nodeId: diagnosis.nodeId || node?.id || flowPromptRecordContextValue(record, ["nodeId"]) || "",
    nodeLabel: diagnosis.nodeLabel || node?.label || flowPromptRecordContextValue(record, ["nodeLabel"]) || "",
    url: diagnosis.url || "",
    method: diagnosis.method || "",
    status: diagnosis.status || "",
    statusText: diagnosis.statusText || "",
    errorKind: diagnosis.kind || "",
    error: diagnosis.error || record.message || "",
    cause: diagnosis.cause || "",
    suggestion: diagnosis.suggestion || "",
    fixHint,
    canRetry: Boolean(diagnosis.canRetry),
    canInspect: Boolean(diagnosis.canInspect),
    canPrepareEndpointConfig: Boolean(diagnosis.canPrepareEndpointConfig),
    title,
    rawPreview: {
      id: recordId,
      message: record.message || "",
      channel: record.channel || "",
      sourceNodeId: record.sourceNodeId || record.context?.sourceNodeId || "",
      targetNodeId: record.targetNodeId || record.context?.targetNodeId || "",
    },
  };
};

const flowPromptRuntimeErrorRecords = (context = {}, limit = 20) =>
  flowPromptRecentRecords([...(context.flowLogs || []), ...(context.events || [])], limit)
    .filter((record) =>
      ["error", "failed", "failure"].includes(flowPromptNormalize(record.level || record.status || record.severity || ""))
    );

const flowPromptFindRuntimeErrorForPrompt = (context = {}, prompt = "") => {
  const records = flowPromptRuntimeErrorRecords(context, 20);
  if (!records.length) return null;
  const text = flowPromptNormalize(prompt);
  const recordMatch = String(prompt || "").match(/\b(?:record|flowlog|log|id)\s+([a-z0-9_.:-]+)/i);
  const recordId = String(recordMatch?.[1] || "").trim();
  if (recordId) {
    const byId = records.find((record) =>
      flowPromptNormalize(record.id || "").includes(flowPromptNormalize(recordId))
    );
    if (byId) return byId;
  }
  const byNode = records.find((record) => {
    const insight = flowPromptRuntimeErrorDiagnosis(context, record);
    return [insight.nodeId, insight.nodeLabel]
      .filter(Boolean)
      .some((value) => text.includes(flowPromptNormalize(value)));
  });
  return byNode || records[0];
};

const flowPromptBuildRuntimeErrorFixPlan = (context = {}, prompt = "") => {
  const record = flowPromptFindRuntimeErrorForPrompt(context, prompt);
  if (!record) {
    return flowPromptBatchPlan([{
      type: "fixRuntimeError",
      tool: "diagnoseGraph",
      status: "blocked",
      summary: "Non ho trovato errori runtime recenti da preparare.",
      detail: "Esegui un Live Test o chiedi prima `mostrami runtime error recenti`.",
    }], "Nessun errore runtime recente da trasformare in fix.");
  }

  const insight = flowPromptRuntimeErrorDiagnosis(context, record);
  const node = flowPromptRuntimeRecordNode(context, record);
  const explicitUrl = flowPromptExtractExplicitUrl(prompt);
  if (explicitUrl && node?.id) {
    return flowPromptBuildConfigPlan(context, `imposta endpoint di ${node.label || node.id} a ${explicitUrl}`);
  }

  if (!node?.id) {
    return flowPromptBatchPlan([{
      type: "fixRuntimeError",
      tool: "diagnoseGraph",
      status: "blocked",
      recordId: record.id || "",
      summary: "Errore letto, ma il nodo sorgente non e chiaro.",
      detail: "Il log non contiene un nodeId risolvibile nel workspace corrente.",
    }], "Fix bloccato: non posso associare l'errore a un nodo Flow Map valido.");
  }

  const kind = flowPromptNormalize(insight.kind);
  const status = Number(insight.status || 0);
  const nodeLabel = node.label || node.id;
  if (insight.canPrepareEndpointConfig) {
    return flowPromptBatchPlan([{
      type: "updateNodeConfig",
      tool: "updateNodeConfig",
      status: "blocked",
      node,
      nodeId: node.id,
      field: "endpoint",
      target: "config",
      value: "",
      recordId: record.id || "",
      summary: `Serve un URL esplicito prima di aggiornare ${nodeLabel}.`,
      detail: `L'errore indica endpoint mancante/non valido. Scrivi ad esempio: imposta endpoint di ${nodeLabel} a https://...`,
    }], `Fix preparato per ${nodeLabel}, ma manca un URL esplicito da salvare.`);
  }

  if (kind === "http" || status >= 400) {
    return flowPromptBatchPlan([{
      type: "fixRuntimeError",
      tool: "diagnoseGraph",
      status: "blocked",
      node,
      nodeId: node.id,
      recordId: record.id || "",
      summary: `HTTP ${insight.status || "error"} su ${nodeLabel}: non cambio endpoint/metodo automaticamente.`,
      detail: "Il server ha risposto con errore: verifica endpoint, metodo, headers, auth e parametri. Se hai il valore corretto, chiedi di impostarlo esplicitamente.",
    }], `Fix bloccato: ${nodeLabel} ha ricevuto una risposta HTTP non valida.`);
  }

  if (kind === "network-or-cors" || flowPromptNormalize(insight.error).includes("failed to fetch")) {
    return flowPromptBatchPlan([{
      type: "fixRuntimeError",
      tool: "diagnoseGraph",
      status: "blocked",
      node,
      nodeId: node.id,
      recordId: record.id || "",
      summary: `Nessuna risposta HTTP da ${nodeLabel}: status null.`,
      detail: `URL testato: ${insight.url || "non disponibile"}. Il sito/API potrebbe non esistere, non rispondere, essere bloccato da DNS/TLS/CORS o mixed content. Non modifico automaticamente il nodo: serve un URL confermato.`,
    }], `Fix bloccato: ${nodeLabel} non ha ricevuto risposta HTTP dall'endpoint configurato.`);
  }

  return flowPromptBatchPlan([{
    type: "fixRuntimeError",
    tool: "diagnoseGraph",
    status: "blocked",
    node,
    nodeId: node.id,
    recordId: record.id || "",
    summary: `Errore runtime su ${nodeLabel}: nessun fix automatico sicuro.`,
    detail: insight.suggestion || "Apri Inspector e verifica il log raw prima di modificare il nodo.",
  }], `Ho preparato la diagnosi, ma non vedo una modifica sicura da applicare automaticamente.`);
};

const flowPromptBuildRuntimeQueryModel = async ({ context = {}, prompt = "", query = {}, memory = [] } = {}) => {
  const filter = query.filter || "";
  const matchedNode = flowPromptFindNodeByText(context, filter);
  const nodeCandidates = matchedNode ? [matchedNode] : flowPromptFindNodeCandidates(context, filter, 5);
  const selectedNodes = (filter ? nodeCandidates : (context.nodes || []).slice(0, 5)).map((node) => ({
    node,
    connectivity: flowPromptNodeConnectivity(context, node),
    config: node.metadata?.config || {},
    manifest: node.metadata?.manifest || null,
  }));
  const flowPromptProviderHealth = (providers = []) => {
    const normalized = (providers || []).map((provider) => {
      const endpoint = String(provider.endpoint || provider.baseUrl || "").replace(/\/+$/g, "");
      const status = provider.status || provider.health || (provider.local ? "local" : "configured") || "";
      const model = provider.model || provider.defaultModel || "";
      const providerType = provider.provider || provider.providerType || provider.name || "";
      const issue = !endpoint && provider.local
        ? "missing-endpoint"
        : !model
          ? "missing-model"
          : String(status).toLowerCase().includes("error")
            ? "provider-error"
            : "";
      return {
        id: provider.id || provider.name || providerType || "provider",
        name: provider.name || provider.provider || provider.id || "Provider",
        provider: providerType,
        model,
        endpoint,
        status,
        local: Boolean(provider.local),
        ready: !issue,
        issue,
      };
    });
    const ready = normalized.filter((item) => item.ready).length;
    return {
      ready,
      total: normalized.length,
      primary: normalized.find((item) => item.ready) || normalized[0] || null,
      providers: normalized.slice(0, 8),
      summary: normalized.length
        ? `${ready}/${normalized.length} provider ready`
        : "No AI provider configured",
    };
  };
  const flowPromptAgentRuntimeTools = async () => {
    if (!window.TrackerLensAgentRuntime?.inspectFlow) {
      return { available: false, version: "", summary: null, fixes: [], runs: [], trace: null, tools: [] };
    }
    const workspaceId = context.workspaceId || currentWorkspaceId() || "";
    const runtimeIntent = flowPromptAgentIntent(prompt);
    const wantsTrace = flowPromptHasAny(prompt, ["trace", "run trace", "simula", "simulate", "verifica", "verify"]);
    const wantsFixes = flowPromptHasAny(prompt, ["fix", "sistema", "ripara", "correggi", "diagnosi", "diagnostica", "problema", "error", "errore"]);
    const [inspect, fixes, runs, trace] = await Promise.all([
      window.TrackerLensAgentRuntime.inspectFlow({ workspaceId }).catch((error) => ({ error: error?.message || String(error) })),
      wantsFixes || runtimeIntent === "diagnostics"
        ? window.TrackerLensAgentRuntime.suggestFixes({ workspaceId }).catch((error) => ({ fixes: [], error: error?.message || String(error) }))
        : Promise.resolve(null),
      Promise.resolve()
        .then(() => window.TrackerLensAgentRuntime.listRuns?.() || [])
        .then((result) => Array.isArray(result) ? { runs: result } : result || { runs: [] })
        .catch(() => ({ runs: [] })),
      wantsTrace
        ? window.TrackerLensAgentRuntime.runFlow({ workspaceId, dryRun: true, mode: "dry-run", payload: { objective: `Flow Chat runtime trace: ${prompt}` } }).catch((error) => ({ error: error?.message || String(error), trace: [] }))
        : Promise.resolve(null),
    ]);
    return {
      available: true,
      version: window.TrackerLensAgentRuntime.VERSION || "agent-runtime-v1",
      summary: inspect.summary || null,
      issues: inspect.issues || [],
      fixes: fixes?.fixes || [],
      fixError: fixes?.error || "",
      runs: (runs.runs || []).slice(0, 5),
      trace,
      tools: Object.keys(window.TrackerLensAgentRuntime.tools || {}),
    };
  };
  const [channels, settings, aiRuntime, agentRuntime] = await Promise.all([
    flowPromptBuildChannelLineage(context, filter),
    flowPromptReadSettingsSnapshot(),
    flowPromptReadAiRuntimeSnapshot(),
    flowPromptAgentRuntimeTools(),
  ]);
  const providerHealth = flowPromptProviderHealth(aiRuntime.providers || []);
  const runtimeRecords = flowPromptRecentRecords([...(context.flowLogs || []), ...(context.events || [])], 12);
  const errors = runtimeRecords.filter((record) =>
    record.level === "error" || record.status === "error" || record.severity === "error"
  );
  const errorInsights = errors.map((record) => ({
    recordId: record.id || "",
    ...flowPromptRuntimeErrorDiagnosis(context, record),
  }));
  return {
    version: "flow-agent-query/v1",
    prompt,
    intent: flowPromptAgentIntent(prompt),
    metric: query.metric,
    filter,
    workspace: {
      id: context.workspaceId || currentWorkspaceId() || "",
      name: context.workspaceName || currentWorkspaceName() || "",
    },
    totals: {
      nodes: context.nodes?.length || 0,
      edges: context.edges?.length || 0,
      channels: context.channels?.length || 0,
      events: context.events?.length || 0,
      logs: context.flowLogs?.length || 0,
      memory: memory.length,
    },
    nodes: selectedNodes,
    channels,
    runtime: {
      recent: runtimeRecords,
      errors,
      errorInsights,
      last: runtimeRecords[0] || null,
    },
    settings,
    aiRuntime: {
      providerHealth,
      providers: aiRuntime.providers.map((provider) => ({
        id: provider.id,
        name: provider.name || provider.provider || provider.id,
        provider: provider.provider || "",
        model: provider.model || "",
        status: provider.status || provider.health || "",
      })).slice(0, 8),
      agents: aiRuntime.agents.slice(0, 8).map((agent) => ({
        id: agent.id,
        name: agent.name || agent.label || agent.id,
        status: agent.status || "",
        model: agent.model || agent.providerModel || "",
      })),
      jobs: aiRuntime.jobs.slice(0, 5),
      logs: aiRuntime.logs.slice(0, 5),
      prompts: aiRuntime.prompts.slice(0, 6).map((item) => ({ id: item.id, title: item.title || item.name || item.prompt || item.id })),
    },
    agentRuntime,
    memory: memory.slice(0, 8),
  };
};

const flowPromptBrainKnowledgeBase = () => [
  {
    id: "identity-runtime-os",
    title: "Trackers Lens identity",
    tags: ["identity", "architecture"],
    text: "Trackers Lens is a local-first AI Runtime Operating Environment. Treat Flow Map as a runtime graph of nodes, dependencies, channels, events and logs, not as a generic dashboard canvas.",
  },
  {
    id: "authority-runtime",
    title: "Runtime authority",
    tags: ["safety", "authority"],
    text: "The LLM can plan and explain, but runtime data, palette nodes, ports, dependencies and safe executor validation are the source of truth.",
  },
  {
    id: "agent-pattern",
    title: "Professional agent pattern",
    tags: ["agent", "orchestrator", "bridge"],
    text: "For professional multi-step agent flows, prefer Task Node -> Orchestrator Agent -> Agent Bridge. The Orchestrator Agent owns decisions; Agent Bridge separates agent_control input from action output.",
  },
  {
    id: "boundary-pattern",
    title: "Composable Flow Map boundary",
    tags: ["flow-in", "flow-out", "boundary", "ports"],
    text: "Use Flow In and Flow Out to expose typed boundaries when a Flow Map must be embedded or reused. Do not use Flow In/Out merely to split one edge inside the same graph.",
  },
  {
    id: "routing-pattern",
    title: "Routing and split pattern",
    tags: ["split", "condition", "routing"],
    text: "Use Split to fan out the same payload to two branches. Use Condition when routing depends on validation, state, or a true/false decision.",
  },
  {
    id: "debug-pattern",
    title: "Debug pattern",
    tags: ["preview", "debug"],
    text: "Use Preview after critical branches while designing. It makes runtime payloads visible before connecting actions, storage or AI agents.",
  },
  {
    id: "memory-rag-pattern",
    title: "Brain pattern",
    tags: ["memory", "rag", "llm"],
    text: "A Codex-like Trackers Lens assistant should use memory for confirmed user/workspace facts, RAG for product knowledge, an LLM for reasoning and natural language, and local validators before any Apply.",
  },
];

const FLOW_PROMPT_BRAIN_DOCS = [
  { id: "doc-ai-entry", title: "AI entrypoint", url: "AI.md", tags: ["entrypoint", "rules"] },
  { id: "doc-project-state", title: "Project state", url: "docs/ai/project-state.md", tags: ["identity", "runtime"] },
  { id: "doc-architecture", title: "Architecture rules", url: "docs/ai/architecture.md", tags: ["architecture", "rules"] },
  { id: "doc-flow-overview", title: "Flow Map overview", url: "docs/ai/flow-map/overview.md", tags: ["flow-map", "runtime"] },
  { id: "doc-flow-chat", title: "Flow Chat agent", url: "docs/ai/flow-map/prompt-chat.md", tags: ["flow-chat", "agent"] },
  { id: "doc-safe-executor", title: "Safe executor", url: "docs/ai/flow-map/safe-executor.md", tags: ["safe-executor", "mutation"] },
  { id: "doc-runtime-graph", title: "Runtime graph", url: "docs/ai/flow-map/runtime-graph.md", tags: ["runtime", "graph"] },
  { id: "doc-runtime-contract", title: "Runtime contract", url: "docs/ai/runtime/contract.md", tags: ["runtime", "contract", "ports"] },
  { id: "doc-agent-runtime", title: "Agent Runtime", url: "docs/ai/runtime/agent-runtime.md", tags: ["agent-runtime", "tools", "trace", "fixes"] },
  { id: "doc-ai-memory", title: "AI memory runtime", url: "docs/ai/runtime/ai-memory.md", tags: ["memory", "workspace"] },
];

let flowPromptBrainDocCache = null;

const flowPromptBrainTokens = (text = "") =>
  flowPromptNormalize(text)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);

const flowPromptBrainTrimDocText = (text = "") =>
  String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[#>*_\-[\]()`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2400);

const flowPromptLoadBrainDocs = async () => {
  if (flowPromptBrainDocCache) return flowPromptBrainDocCache;
  if (typeof fetch !== "function") {
    flowPromptBrainDocCache = [];
    return flowPromptBrainDocCache;
  }
  const docs = await Promise.all(FLOW_PROMPT_BRAIN_DOCS.map(async (doc) => {
    try {
      const response = await fetch(doc.url, { cache: "force-cache" });
      if (!response.ok) return null;
      const text = flowPromptBrainTrimDocText(await response.text());
      if (!text) return null;
      return {
        id: doc.id,
        title: doc.title,
        tags: doc.tags,
        text,
        url: doc.url,
        source: "docs",
      };
    } catch (_) {
      return null;
    }
  }));
  flowPromptBrainDocCache = docs.filter(Boolean);
  return flowPromptBrainDocCache;
};

const flowPromptScoreBrainItems = (items = [], { prompt = "", intent = "", limit = 5 } = {}) => {
  const tokens = new Set([...flowPromptBrainTokens(prompt), flowPromptNormalize(intent)].filter(Boolean));
  return items
    .map((item) => {
      const haystack = flowPromptNormalize([item.title, item.text, ...(item.tags || [])].join(" "));
      const score = Array.from(tokens).reduce((sum, token) => {
        if (!token) return sum;
        if ((item.tags || []).some((tag) => flowPromptNormalize(tag).includes(token))) return sum + 3;
        if (flowPromptNormalize(item.title).includes(token)) return sum + 2;
        return sum + (haystack.includes(token) ? 1 : 0);
      }, 0);
      return { ...item, score };
    })
    .filter((item) => item.score > 0 || ["identity-runtime-os", "authority-runtime"].includes(item.id))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
};

const flowPromptBrainRag = async ({ prompt = "", intent = "", limit = 6 } = {}) => {
  const docs = await flowPromptLoadBrainDocs();
  const localItems = flowPromptBrainKnowledgeBase().map((item) => ({ ...item, source: "built-in" }));
  const scored = flowPromptScoreBrainItems([...docs, ...localItems], { prompt, intent, limit });
  return scored.map((item) => ({
    ...item,
    text: String(item.text || "").slice(0, item.source === "docs" ? 1200 : 700),
  }));
};

const flowPromptBrainPaletteContext = () =>
  flowPromptPaletteContract().slice(0, 80);

const flowPromptShouldUseBrain = (intent = "", prompt = "") => {
  if (flowPromptIsSimpleDefinitionQuestion(prompt)) return false;
  if (["advice", "explain", "summary", "memory"].includes(intent)) return true;
  if (!["nodes", "edges", "channels", "config", "database"].includes(intent)) return false;
  return flowPromptHasAny(prompt, [
    "spiega", "spieghi", "spiegami", "come funziona", "perche", "perché", "why", "what is", "cosa e", "cosa è",
    "migliore", "meglio", "professionale", "architettura", "pattern", "best practice",
  ]);
};

const flowPromptBuildBrainContext = async ({ context = {}, prompt = "", routePrompt = "", intent = "", queryModel = {}, memory = [], approvedPatterns = [], rejectedPatterns = [], memoryGuard = null, conversationContext = null, architectureAdvice = null } = {}) => {
  const rag = await flowPromptBrainRag({ prompt, intent });
  return {
    version: "flow-chat-brain-context/v1",
    prompt,
    routePrompt: routePrompt && routePrompt !== prompt ? routePrompt : "",
    isRefinement: Boolean(routePrompt && routePrompt !== prompt),
    intent,
    workspace: {
      id: context.workspaceId || currentWorkspaceId() || "",
      name: context.workspaceName || currentWorkspaceName() || "",
    },
    runtimeFacts: {
      nodes: context.nodes?.length || 0,
      edges: context.edges?.length || 0,
      channels: context.channels?.length || 0,
      events: context.events?.length || 0,
      logs: context.flowLogs?.length || 0,
    },
    palette: flowPromptBrainPaletteContext(),
    currentNodes: (context.nodes || []).slice(0, 30).map((node) => ({
      id: node.id,
      label: node.label,
      type: node.type,
      subtype: node.subtype,
      category: node.category,
      inputs: node.inputs || [],
      outputs: node.outputs || [],
    })),
    selectedRuntime: {
      nodes: (queryModel.nodes || []).slice(0, 5).map((item) => ({
        label: item.node?.label || item.node?.id || "",
        inputs: item.node?.inputs || [],
        outputs: item.node?.outputs || [],
        inLinks: item.connectivity?.incoming?.length || 0,
        outLinks: item.connectivity?.outgoing?.length || 0,
      })),
      errors: (queryModel.runtime?.errorInsights || []).slice(0, 4),
      settings: queryModel.settings || {},
      providerHealth: queryModel.aiRuntime?.providerHealth || null,
      agentRuntime: queryModel.agentRuntime ? {
        available: queryModel.agentRuntime.available,
        version: queryModel.agentRuntime.version,
        summary: queryModel.agentRuntime.summary,
        issues: (queryModel.agentRuntime.issues || []).slice(0, 8),
        fixes: (queryModel.agentRuntime.fixes || []).slice(0, 8).map((fix) => ({
          type: fix.type,
          severity: fix.severity,
          problem: fix.problem,
          actionText: fix.actionText,
          safe: fix.safe,
          preview: fix.preview,
        })),
        trace: queryModel.agentRuntime.trace ? {
          status: queryModel.agentRuntime.trace.status,
          mode: queryModel.agentRuntime.trace.mode,
          steps: queryModel.agentRuntime.trace.trace?.length || 0,
          validationOk: queryModel.agentRuntime.trace.summary?.validationOk,
        } : null,
        tools: queryModel.agentRuntime.tools || [],
      } : null,
    },
    memory: (memory || []).slice(0, 6).map((item) => ({
      id: item.id,
      kind: item.kind,
      name: item.name,
      text: item.text || item.summary || item.content || "",
      tags: item.tags || [],
    })),
    approvedPatterns: (approvedPatterns || []).slice(0, 4).map((item) => ({
      id: item.id,
      name: item.name,
      prompt: item.prompt,
      nodes: item.nodes || [],
      edges: item.edges || [],
      text: String(item.text || "").slice(0, 420),
      score: item.score || 0,
    })),
    rejectedPatterns: (rejectedPatterns || []).slice(0, 4).map((item) => ({
      id: item.id,
      name: item.name,
      prompt: item.prompt,
      nodes: item.nodes || [],
      edges: item.edges || [],
      text: String(item.text || "").slice(0, 360),
      score: item.score || 0,
    })),
    memoryGuard: memoryGuard || null,
    conversationContext: conversationContext || null,
    rag,
    localAdvice: architectureAdvice ? {
      summary: architectureAdvice.summary,
      pattern: architectureAdvice.pattern,
      recommendations: (architectureAdvice.recommendations || []).map((item) => ({
        label: item.label,
        role: item.role,
        reason: item.reason,
        inputs: item.inputs || [],
        outputs: item.outputs || [],
      })),
    } : null,
  };
};

const flowPromptNormalizeBrainIntent = (value = "") => {
  const normalized = flowPromptNormalize(value);
  if (["advice", "architecture_advice", "architecture-advice"].includes(normalized)) return "advice";
  if (["query", "runtime_query", "runtime-query", "nodes", "edges", "channels", "runtime", "diagnostics", "config", "memory", "database", "explain", "summary"].includes(normalized)) return "query";
  if (["create", "createflow", "create_flow", "flow_creation"].includes(normalized)) return "createFlow";
  if (["mutate", "mutation", "apply", "command"].includes(normalized)) return "mutate";
  if (["debug", "fix", "diagnose"].includes(normalized)) return "debug";
  return "query";
};

const flowPromptTrimCompleteText = (value = "", limit = 3200) => {
  const text = String(value || "").trim();
  if (text.length <= limit) return text;
  const clipped = text.slice(0, limit);
  const candidates = [
    clipped.lastIndexOf("\n3."),
    clipped.lastIndexOf("\n- "),
    clipped.lastIndexOf(". "),
    clipped.lastIndexOf("! "),
    clipped.lastIndexOf("? "),
    clipped.lastIndexOf("\n"),
  ].filter((index) => index > Math.floor(limit * 0.62));
  const cut = candidates.length ? Math.max(...candidates) + 1 : clipped.lastIndexOf(" ");
  return `${clipped.slice(0, cut > 0 ? cut : limit).trim()}…`;
};

const flowPromptValidateBrainPayload = (payload = {}, brainContext = {}, fallbackIntent = "query") => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const paletteByLabel = new Map(flowPromptPaletteContract().map((item) => [flowPromptNormalize(item.label), item]));
  const recommendedNodes = (Array.isArray(payload.recommendedNodes) ? payload.recommendedNodes : [])
    .map((item) => {
      const rawLabel = typeof item === "string" ? item : item?.label || item?.node || item?.name || "";
      const paletteItem = paletteByLabel.get(flowPromptNormalize(rawLabel));
      if (!paletteItem) return null;
      return {
        label: paletteItem.label,
        role: String(item?.role || item?.purpose || "").slice(0, 160),
        reason: String(item?.reason || item?.why || "").slice(0, 320),
        inputs: paletteItem.inputs || [],
        outputs: paletteItem.outputs || [],
      };
    })
    .filter(Boolean);
  const plan = (Array.isArray(payload.plan) ? payload.plan : [])
    .map((step, index) => ({
      order: Number(step?.order || index + 1),
      title: String(step?.title || step?.step || `Step ${index + 1}`).slice(0, 120),
      detail: String(step?.detail || step?.summary || "").slice(0, 320),
      mutates: Boolean(step?.mutates),
    }))
    .slice(0, 8);
  return {
    version: "flow-chat-brain/v1",
    intent: flowPromptNormalizeBrainIntent(payload.intent || fallbackIntent),
    answer: flowPromptTrimCompleteText(payload.answer || payload.summary || "", 3200),
    recommendedNodes,
    plan,
    needsConfirmation: Boolean(payload.needsConfirmation),
    confidence: Math.max(0, Math.min(1, Number(payload.confidence || 0.6) || 0.6)),
    sources: (Array.isArray(payload.sources) ? payload.sources : [])
      .map((source) => String(source || "").trim())
      .filter((source) => brainContext.rag?.some((item) => item.id === source))
      .slice(0, 6),
  };
};

const flowPromptBuildBrainPrompt = (brainContext = {}) => [
  "You are the Trackers Lens Flow Chat Brain.",
  flowPromptLanguageRule(brainContext.prompt || ""),
  "Return only one valid JSON object.",
  "Schema:",
  "{\"intent\":\"advice|query|createFlow|mutate|debug\",\"answer\":\"natural answer\",\"recommendedNodes\":[{\"label\":\"palette label\",\"role\":\"short role\",\"reason\":\"why\"}],\"plan\":[{\"title\":\"step\",\"detail\":\"short detail\",\"mutates\":false}],\"needsConfirmation\":false,\"confidence\":0.0,\"sources\":[\"rag-id\"]}",
  "Rules:",
  "- Use only labels from context.palette in recommendedNodes.",
  "- Runtime facts, current nodes, ports, memory and RAG context are authoritative.",
  "- If context.selectedRuntime.agentRuntime is available, use its inspectFlow/suggestFixes/runFlow facts before giving diagnostics.",
  "- Provider health is operational data: mention missing model/endpoint/provider only when context.selectedRuntime.providerHealth reports it.",
  "- Do not claim a node/port/action exists unless it is in context.",
  "- Treat context.approvedPatterns as user-confirmed good examples and context.rejectedPatterns as user-confirmed examples to avoid.",
  "- Use context.conversationContext to resolve follow-up references such as previous, same, second node, simpler, without Split, or add Condition.",
  "- Do not produce an executable mutation plan; for changes, explain that validation and Apply must use Trackers Lens tools.",
  "- If the user asks for numbered points, complete every requested point with a full sentence; do not leave partial bullets.",
  "- Be practical and concise, like a senior Trackers Lens operator.",
  `context: ${JSON.stringify(brainContext)}`,
].join("\n");

const flowPromptCallBrainWithAi = async (brainContext = {}, fallbackIntent = "query") => {
  const aiSettings = await flowPromptReadAiSettings();
  const provider = await flowPromptPickProvider(aiSettings);
  if (!provider) {
    return {
      version: "flow-chat-brain/v1",
      intent: fallbackIntent,
      answer: "",
      recommendedNodes: [],
      plan: [],
      needsConfirmation: false,
      confidence: 0,
      sources: [],
      planner: {
        mode: "unavailable",
        error: flowPromptFriendlyAiError(null, { aiSettings }),
      },
    };
  }
  const model = aiSettings.model || provider.model;
  const prompt = flowPromptBuildBrainPrompt(brainContext);
  const kind = flowPromptProviderKey(provider.provider || provider.name || provider.id);
  try {
    const ai = kind.includes("ollama")
      ? await flowPromptCallOllama({ provider, model, prompt })
      : await flowPromptCallOpenAiCompatible({ provider, model, prompt, aiSettings });
    const payload = flowPromptFirstJsonObject(ai.text);
    const validated = flowPromptValidateBrainPayload(payload, brainContext, fallbackIntent);
    if (!validated?.answer && !validated?.recommendedNodes?.length && !validated?.plan?.length) return null;
    return {
      ...validated,
      planner: {
        provider: provider.name || provider.provider || aiSettings.provider || "",
        model: ai.model || model || "",
        mode: "llm-json",
      },
    };
  } catch (error) {
    return {
      version: "flow-chat-brain/v1",
      intent: fallbackIntent,
      answer: "",
      recommendedNodes: [],
      plan: [],
      needsConfirmation: false,
      confidence: 0,
      sources: [],
      planner: {
        mode: "unavailable",
        error: flowPromptFriendlyAiError(error, { provider, aiSettings, model }),
      },
    };
  }
};

const flowPromptReadWorkspaceMemory = async (prompt = "") => {
  if (!window.TrackerLensAiRuntimeStore?.buildMemoryContext) return [];
  return window.TrackerLensAiRuntimeStore.buildMemoryContext({
    workspaceId: currentWorkspaceId() || "runtime",
    agentId: "flow-map-agent",
    query: prompt,
    limit: 8,
  }).catch(() => []);
};

const flowPromptParseMemoryMeta = (memory = {}) => {
  const raw = memory.meta || memory.raw?.meta || "";
  if (!raw || typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
};

const flowPromptPatternTokens = (value = "") =>
  flowPromptNormalize(value)
    .split(/\s+/)
    .filter((token) => token.length > 2);

const flowPromptApprovedPatternFromMemory = (memory = {}, prompt = "") => {
  const meta = flowPromptParseMemoryMeta(memory);
  const nodes = Array.isArray(meta.nodes) ? meta.nodes.filter(Boolean).slice(0, 10) : [];
  const edges = Array.isArray(meta.edges) ? meta.edges.filter(Boolean).slice(0, 10) : [];
  const text = [memory.name, memory.text, memory.summary, memory.meta, ...(memory.tags || []), nodes.join(" "), edges.join(" ")].join(" ");
  const promptTokens = new Set(flowPromptPatternTokens(prompt));
  const textTokens = new Set(flowPromptPatternTokens(text));
  const overlap = Array.from(promptTokens).filter((token) => textTokens.has(token));
  const nodeMatches = nodes.filter((node) => promptTokens.has(flowPromptNormalize(node))).length;
  const score = overlap.length + (nodeMatches * 3) + Number(memory.weight || 0);
  return {
    id: memory.id || "",
    kind: memory.kind || "",
    name: memory.name || "Pattern Flow Chat",
    text: memory.text || memory.summary || "",
    prompt: meta.prompt || "",
    messageKind: meta.messageKind || "",
    nodes,
    edges,
    planner: meta.planner || {},
    score,
    updatedAt: memory.updatedAt || "",
    workspaceId: memory.workspaceId || meta.workspaceId || "",
    uses: Number(meta.uses || meta.useCount || memory.uses || memory.useCount || 0) || 0,
  };
};

const flowPromptPatternSimilarity = (left = {}, right = {}) => {
  const leftTokens = new Set(flowPromptPatternTokens([
    left.name,
    left.text,
    left.prompt,
    ...(left.nodes || []),
    ...(left.edges || []),
  ].filter(Boolean).join(" ")));
  const rightTokens = new Set(flowPromptPatternTokens([
    right.name,
    right.text,
    right.prompt,
    ...(right.nodes || []),
    ...(right.edges || []),
  ].filter(Boolean).join(" ")));
  const union = new Set([...leftTokens, ...rightTokens]);
  const tokenScore = union.size
    ? Array.from(leftTokens).filter((token) => rightTokens.has(token)).length / union.size
    : 0;
  const leftNodes = new Set((left.nodes || []).map(flowPromptNormalize).filter(Boolean));
  const rightNodes = new Set((right.nodes || []).map(flowPromptNormalize).filter(Boolean));
  const nodeUnion = new Set([...leftNodes, ...rightNodes]);
  const nodeScore = nodeUnion.size
    ? Array.from(leftNodes).filter((node) => rightNodes.has(node)).length / nodeUnion.size
    : 0;
  return Math.max(tokenScore, nodeScore);
};

const flowPromptPatternQuality = (pattern = {}) => {
  const nodeCount = pattern.nodes?.length || 0;
  const edgeCount = pattern.edges?.length || 0;
  const hasPrompt = Boolean(String(pattern.prompt || pattern.text || "").trim());
  const hasPlanner = Boolean(pattern.planner?.mode || pattern.planner?.model);
  const ageMs = pattern.updatedAt ? Date.now() - Date.parse(pattern.updatedAt) : Number.POSITIVE_INFINITY;
  const recency = Number.isFinite(ageMs) && ageMs < 1000 * 60 * 60 * 24 * 14 ? 2 : Number.isFinite(ageMs) && ageMs < 1000 * 60 * 60 * 24 * 60 ? 1 : 0;
  const frequency = Math.min(3, Number(pattern.uses || pattern.useCount || pattern.hits || pattern.meta?.uses || 0) || 0);
  const workspaceFit = pattern.workspaceId && pattern.workspaceId === currentWorkspaceId() ? 2 : 0;
  const stalePenalty = Number.isFinite(ageMs) && ageMs > 1000 * 60 * 60 * 24 * 120 ? 2 : 0;
  const structure = Math.min(4, nodeCount) + Math.min(4, edgeCount);
  const score = structure + (hasPrompt ? 2 : 0) + (hasPlanner ? 1 : 0) + recency + frequency + workspaceFit - stalePenalty;
  return {
    score,
    label: score >= 9 ? "alta" : score >= 5 ? "media" : "bassa",
    nodeCount,
    edgeCount,
    hasPrompt,
    recency,
    frequency,
    workspaceFit,
    stale: stalePenalty > 0,
  };
};

const flowPromptReadPatternMemories = async (prompt = "", limit = 4) => {
  if (!window.TrackerLensAiRuntimeStore?.listMemory) {
    return { approvedPatterns: [], rejectedPatterns: [], memoryGuard: null };
  }
  const workspaceId = currentWorkspaceId() || "runtime";
  const queried = await window.TrackerLensAiRuntimeStore.listMemory({
    scope: "workspace",
    workspaceId,
    agentId: "flow-map-agent",
    query: prompt,
    limit: 24,
  }).catch(() => []);
  const recent = await window.TrackerLensAiRuntimeStore.listMemory({
    scope: "workspace",
    workspaceId,
    agentId: "flow-map-agent",
    limit: 24,
  }).catch(() => []);
  const byId = new Map([...queried, ...recent]
    .filter((item) => ["flow-chat-approved-pattern", "flow-chat-rejected-pattern"].includes(item.kind))
    .map((item) => [item.id, item]));
  const patterns = Array.from(byId.values())
    .map((item) => flowPromptApprovedPatternFromMemory(item, prompt))
    .filter((item) => item.text || item.nodes.length || item.edges.length)
    .map((item) => ({ ...item, quality: flowPromptPatternQuality(item) }))
    .sort((a, b) => ((b.score + (b.quality?.score || 0)) - (a.score + (a.quality?.score || 0))) || String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  const rejectedPatterns = patterns
    .filter((item) => item.kind === "flow-chat-rejected-pattern")
    .slice(0, Math.max(limit, 6));
  const approvedCandidates = patterns.filter((item) => item.kind === "flow-chat-approved-pattern");
  const approvedPatterns = approvedCandidates
    .filter((item) => !rejectedPatterns.some((rejected) => flowPromptPatternSimilarity(item, rejected) >= 0.55))
    .slice(0, limit);
  const excludedByRejection = Math.max(0, approvedCandidates.length - approvedPatterns.length);
  return {
    approvedPatterns,
    rejectedPatterns: rejectedPatterns.slice(0, limit),
    memoryGuard: rejectedPatterns.length || excludedByRejection
      ? {
        rejectedPatterns: rejectedPatterns.length,
        excludedByRejection,
      }
      : null,
  };
};

const flowPromptReadApprovedPatterns = async (prompt = "", limit = 4) => {
  const patternMemory = await flowPromptReadPatternMemories(prompt, limit);
  return patternMemory.approvedPatterns || [];
};

const flowPromptMemorySearchText = (memory = {}) =>
  flowPromptNormalize([
    memory.id,
    memory.kind,
    memory.name,
    memory.text,
    memory.summary,
    Array.isArray(memory.tags) ? memory.tags.join(" ") : "",
  ].filter(Boolean).join(" "));

const flowPromptContextWithMemory = (context = {}, memory = []) => {
  if (!Array.isArray(memory) || !memory.length) return context;
  const nodeAliases = new Map();
  const nodeEndpoints = new Map();
  memory.forEach((item) => {
    const meta = flowPromptParseMemoryMeta(item);
    const rawKind = String(item.kind || meta.kind || "");
    const kind = flowPromptNormalize(rawKind);
    const nodeId = meta.nodeId || "";
    if (!nodeId) return;
    if (rawKind === "node-alias" || kind === "node alias" || flowPromptMemorySearchText(item).includes("node alias")) {
      const aliases = [
        ...(meta.sourceNodeId ? [] : [meta.previousLabel]),
        meta.nextLabel,
        ...(Array.isArray(meta.aliases) ? meta.aliases : []),
      ]
        .map(String)
        .filter(Boolean);
      if (aliases.length) nodeAliases.set(nodeId, [...new Set([...(nodeAliases.get(nodeId) || []), ...aliases])]);
    }
    if ((rawKind === "endpoint-choice" || kind === "endpoint choice") && meta.endpoint) nodeEndpoints.set(nodeId, meta);
  });
  if (!nodeAliases.size && !nodeEndpoints.size) return context;
  return {
    ...context,
    memory,
    nodes: (context.nodes || []).map((node) => ({
      ...node,
      aliases: [...new Set([...flowPromptNodeAliases(node), ...(nodeAliases.get(node.id) || [])])],
      memory: {
        ...(node.memory || {}),
        endpointChoice: nodeEndpoints.get(node.id) || node.memory?.endpointChoice || null,
      },
    })),
  };
};

const flowPromptRememberWorkspaceEvent = async ({ kind = "note", prompt = "", summary = "", result = null } = {}) => {
  if (!window.TrackerLensAiRuntimeStore?.remember) return null;
  const workspaceId = currentWorkspaceId() || "runtime";
  const text = [prompt, summary].filter(Boolean).join(" -> ").slice(0, 600);
  if (!text) return null;
  return window.TrackerLensAiRuntimeStore.remember({
    scope: "workspace",
    workspaceId,
    agentId: "flow-map-agent",
    kind,
    name: kind === "apply" ? "Flow Agent apply" : "Flow Agent context",
    text,
    summary: summary || prompt,
    tags: ["flow-map", "flow-agent", kind].filter(Boolean),
    weight: kind === "apply" ? 4 : 2,
    meta: result ? JSON.stringify(result).slice(0, 1200) : "",
  }).catch(() => null);
};

const flowPromptRememberConfirmedFact = async ({ kind = "fact", name = "", text = "", tags = [], weight = 3, meta = {} } = {}) => {
  if (!window.TrackerLensAiRuntimeStore?.remember || !text) return null;
  const workspaceId = currentWorkspaceId() || "runtime";
  const stableId = [
    "mem",
    "workspace",
    workspaceId,
    "flow-map-agent",
    kind,
    meta.nodeId || "",
    meta.previousLabel || meta.endpoint || meta.nextLabel || meta.stableName || name,
  ].map((value) => safeRuntimeId(value)).filter(Boolean).join("_");
  return window.TrackerLensAiRuntimeStore.remember({
    id: stableId,
    scope: "workspace",
    workspaceId,
    agentId: "flow-map-agent",
    kind,
    name: name || "Flow Agent memory",
    text: text.slice(0, 600),
    summary: text.slice(0, 180),
    tags: ["flow-map", "flow-agent", kind, ...tags].filter(Boolean),
    weight,
    meta: JSON.stringify({ kind, ...meta }).slice(0, 1200),
  }).catch(() => null);
};

const flowPromptRememberPreference = async (prompt = "") => {
  const preference = flowPromptExtractPreferenceMemory(prompt);
  if (!preference || !window.TrackerLensAiRuntimeStore?.remember) return null;
  const workspaceId = currentWorkspaceId() || "runtime";
  const stableId = [
    "mem",
    "workspace",
    workspaceId,
    "flow-map-agent",
    preference.kind,
    preference.text,
  ].map((value) => safeRuntimeId(value)).filter(Boolean).join("_").slice(0, 180);
  return window.TrackerLensAiRuntimeStore.remember({
    id: stableId,
    scope: "workspace",
    workspaceId,
    agentId: "flow-map-agent",
    kind: preference.kind,
    name: preference.name,
    text: preference.text,
    summary: preference.summary,
    tags: ["flow-map", "flow-agent", ...preference.tags],
    weight: 6,
    pinned: true,
    meta: JSON.stringify({
      kind: preference.kind,
      prompt,
      explicit: true,
      capturedAt: flowPromptNow(),
    }).slice(0, 1200),
  }).catch(() => null);
};

const flowPromptRememberRuntimeErrorDiagnosis = async ({ prompt = "", context = {}, record = {}, insight = null } = {}) => {
  if (!window.TrackerLensAiRuntimeStore?.remember || !record) return null;
  const provenance = flowPromptRuntimeErrorProvenance(context, record, insight);
  const workspaceId = currentWorkspaceId() || "runtime";
  const stableId = [
    "mem",
    "workspace",
    workspaceId,
    "flow-map-agent",
    provenance.kind,
    provenance.recordId || provenance.nodeId || provenance.nodeLabel || provenance.errorKind || provenance.error,
  ].map((value) => safeRuntimeId(value)).filter(Boolean).join("_").slice(0, 180);
  const text = [
    provenance.nodeLabel ? `Nodo ${provenance.nodeLabel}` : "Errore runtime",
    provenance.cause,
    provenance.suggestion ? `Suggerimento: ${provenance.suggestion}` : "",
  ].filter(Boolean).join(" · ");
  return window.TrackerLensAiRuntimeStore.remember({
    id: stableId,
    scope: "workspace",
    workspaceId,
    agentId: "flow-map-agent",
    kind: provenance.kind,
    name: provenance.title || "Runtime error diagnosis",
    text: text.slice(0, 700),
    summary: provenance.cause || provenance.error || "Runtime error diagnosis",
    tags: ["flow-map", "flow-agent", "runtime-error", provenance.errorKind, provenance.nodeId].filter(Boolean),
    weight: 5,
    meta: JSON.stringify({
      ...provenance,
      prompt,
      capturedAt: flowPromptNow(),
    }).slice(0, 1800),
  }).catch(() => null);
};

const flowPromptRememberAppliedActions = async ({ prompt = "", applied = [], actions = [] } = {}) => {
  if (!Array.isArray(applied) || !applied.length) return [];
  const actionByStep = new Map((actions || []).map((action) => [action.stepId || `${action.type}:${action.nodeId || action.source?.id || ""}`, action]));
  const records = [];
  for (const result of applied) {
    const action = actionByStep.get(result.stepId) || (actions || []).find((item) => item.type === result.type && (item.nodeId === result.nodeId || item.nodeId === result.focusNodeId));
    if (result.type === "renameNode" && action?.nodeId && action.previousLabel && action.nextLabel) {
      records.push(await flowPromptRememberConfirmedFact({
        kind: "node-alias",
        name: `Alias nodo ${action.nextLabel}`,
        text: `${action.previousLabel} ora si chiama ${action.nextLabel}. Usa ${action.nextLabel} per il nodo ${action.nodeId}.`,
        tags: ["alias", "rename", action.nodeId],
        weight: 5,
        meta: {
          nodeId: action.nodeId,
          previousLabel: action.previousLabel,
          nextLabel: action.nextLabel,
          aliases: [action.previousLabel, action.nextLabel],
          prompt,
          appliedAt: result.appliedAt || flowPromptNow(),
        },
      }));
    }
    if (result.type === "duplicateNode" && action?.newNodeId && action?.nextLabel) {
      records.push(await flowPromptRememberConfirmedFact({
        kind: "node-alias",
        name: `Alias nodo ${action.nextLabel}`,
        text: `${action.nextLabel} e un duplicato confermato di ${action.node?.label || action.nodeId}.`,
        tags: ["alias", "duplicate", action.newNodeId],
        weight: 4,
        meta: {
          nodeId: action.newNodeId,
          previousLabel: action.node?.label || action.nodeId || "",
          nextLabel: action.nextLabel,
          aliases: [action.nextLabel],
          sourceNodeId: action.nodeId,
          prompt,
          appliedAt: result.appliedAt || flowPromptNow(),
        },
      }));
    }
    if (result.type === "updateNodeConfig" && action?.field === "endpoint" && action?.nodeId && action?.value) {
      records.push(await flowPromptRememberConfirmedFact({
        kind: "endpoint-choice",
        name: `Endpoint ${action.node?.label || action.nodeId}`,
        text: `Endpoint confermato per ${action.node?.label || action.nodeId}: ${action.value}.`,
        tags: ["endpoint", action.nodeId, action.validation?.method || ""],
        weight: 5,
        meta: {
          nodeId: action.nodeId,
          nodeLabel: action.node?.label || "",
          endpoint: action.value,
          method: action.validation?.method || action.node?.metadata?.config?.method || "GET",
          validation: action.validation || null,
          prompt,
          appliedAt: result.appliedAt || flowPromptNow(),
        },
      }));
    }
  }
  return records.filter(Boolean);
};

const flowPromptApprovedMessageMemoryPayload = ({ message = {}, prompt = "" } = {}) => {
  const kind = message.kind || "text";
  const plan = message.plan || null;
  const report = message.agentReport || null;
  const nodes = (plan?.nodes || report?.brain?.recommendedNodes || report?.architectureAdvice?.recommendations || [])
    .map((item) => item.label || item.name || "")
    .filter(Boolean)
    .slice(0, 10);
  const edges = (plan?.edges || [])
    .map((edge) => `${edge.sourceLabel || edge.sourceKey || ""} -> ${edge.targetLabel || edge.targetKey || ""}`.trim())
    .filter((edge) => edge && edge !== "->")
    .slice(0, 10);
  const planner = plan?.planner || report?.brain?.planner || {};
  const tags = [
    "flow-chat-feedback",
    kind,
    planner.mode || "",
    ...nodes,
  ].filter(Boolean);
  const summary = [
    message.content || report?.content || "",
    nodes.length ? `Nodi: ${nodes.join(", ")}` : "",
    edges.length ? `Links: ${edges.join("; ")}` : "",
  ].filter(Boolean).join(" · ").slice(0, 700);
  if (!summary) return null;
  return {
    kind: "flow-chat-approved-pattern",
    name: kind === "plan" ? "Pattern Flow Chat approvato" : "Risposta Flow Chat approvata",
    text: [
      prompt ? `Prompt confermato: ${prompt}` : "",
      `Risposta approvata: ${summary}`,
    ].filter(Boolean).join(" · ").slice(0, 900),
    tags,
    weight: kind === "plan" ? 7 : 6,
    meta: {
      prompt,
      messageId: message.id || "",
      messageKind: kind,
      planner,
      nodes,
      edges,
      sources: report?.brain?.sources || [],
      approvedAt: flowPromptNow(),
    },
  };
};

const flowPromptRememberApprovedMessage = async ({ message = {}, prompt = "" } = {}) => {
  const payload = flowPromptApprovedMessageMemoryPayload({ message, prompt });
  if (!payload) return null;
  const stableName = [
    payload.kind,
    prompt || message.content || "",
    (payload.meta.nodes || []).join("-"),
    (payload.meta.edges || []).join("-"),
  ].join(" ").slice(0, 220);
  return flowPromptRememberConfirmedFact({
    ...payload,
    meta: {
      ...payload.meta,
      stableName,
    },
  });
};

const flowPromptRememberRejectedMessage = async ({ message = {}, prompt = "" } = {}) => {
  const payload = flowPromptApprovedMessageMemoryPayload({ message, prompt });
  if (!payload) return null;
  const stableName = [
    "flow-chat-rejected-pattern",
    prompt || message.content || "",
    (payload.meta.nodes || []).join("-"),
    (payload.meta.edges || []).join("-"),
  ].join(" ").slice(0, 220);
  return flowPromptRememberConfirmedFact({
    ...payload,
    kind: "flow-chat-rejected-pattern",
    name: payload.meta.messageKind === "plan" ? "Pattern Flow Chat rifiutato" : "Risposta Flow Chat rifiutata",
    text: payload.text.replace("Risposta approvata:", "Risposta rifiutata:"),
    tags: [...new Set([...(payload.tags || []), "rejected", "do-not-use"])],
    weight: -6,
    meta: {
      ...payload.meta,
      stableName,
      rejectedAt: flowPromptNow(),
    },
  });
};

const flowPromptRuntimeQueryInsights = (context = {}, query = {}) => {
  const filter = query.filter || "";
  const nodes = context.nodes || [];
  const edges = context.edges || [];
  const channels = context.channels || [];
  const normalizedFilter = flowPromptNormalize(filter);
  const channelMatches = channels.filter((channel) => flowPromptMatchFilter(channel, filter));
  const nodeMatches = nodes.filter((node) => flowPromptMatchFilter(node, filter));
  const edgeMatches = edges.filter((edge) => flowPromptMatchFilter(edge, filter));
  const relatedNodeIds = new Set(edgeMatches.flatMap((edge) => [edge.sourceNodeId, edge.targetNodeId]).filter(Boolean));
  const channelByName = new Map(channels.map((channel) => [String(channel.name || channel.id || channel.channel || ""), channel]));
  const producerCounts = nodes.reduce((map, node) => {
    (node.outputs || []).concat(node.channels || []).forEach((channel) => {
      const key = String(channel || "").trim();
      if (key) map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }, new Map());
  const consumerCounts = nodes.reduce((map, node) => {
    (node.inputs || []).forEach((channel) => {
      const key = String(channel || "").trim();
      if (key) map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }, new Map());
  return {
    filter,
    normalizedFilter,
    memoryScope: currentWorkspaceId() || "runtime",
    channels: {
      total: channels.length,
      matched: channelMatches.length,
      names: channelMatches.slice(0, 12).map((channel) => channel.name || channel.id || channel.channel).filter(Boolean),
      producerCounts: Array.from(producerCounts.entries()).slice(0, 12),
      consumerCounts: Array.from(consumerCounts.entries()).slice(0, 12),
    },
    nodes: {
      total: nodes.length,
      matched: nodeMatches.length,
      labels: nodeMatches.slice(0, 12).map((node) => node.label || node.id).filter(Boolean),
      relatedToMatchedEdges: Array.from(relatedNodeIds).map((id) => nodes.find((node) => node.id === id)?.label || id).slice(0, 12),
    },
    edges: {
      total: edges.length,
      matched: edgeMatches.length,
      labels: edgeMatches.slice(0, 12).map((edge) =>
        `${edge.sourceLabel || edge.sourceNodeId} -> ${edge.targetLabel || edge.targetNodeId}`
      ),
    },
    channelExists: normalizedFilter
      ? Array.from(channelByName.keys()).some((name) => flowPromptNormalize(name).includes(normalizedFilter))
      : false,
  };
};

const flowPromptBuildArchitectureAdvice = (context = {}, prompt = "") => {
  const text = flowPromptNormalize(prompt);
  const wantsAgentBoundary = flowPromptHasAny(text, ["agent", "agente", "agenti", "orchestrator", "orchestratore"]) &&
    flowPromptHasAny(text, ["in/out", "out/in", "input", "output", " in ", " out ", "edge", "edges", "link", "dividere", "separare", "split", "porta", "porte"]);
  const wantsEmbeddedBoundary = flowPromptHasAny(text, ["flow map", "embedded", "riutilizz", "boundary", "porta", "porte", "in/out", "input", "output"]);
  const wantsRouting = flowPromptHasAny(text, ["route", "router", "routing", "condizione", "condition", "if", "branch", "ramo", "dividere", "split"]);
  const recommendations = [];
  const add = (item) => {
    const key = flowPromptNormalize(item.label || "");
    if (key && !recommendations.some((entry) => flowPromptNormalize(entry.label || "") === key)) recommendations.push(item);
  };

  if (wantsAgentBoundary) {
    add({
      label: "Agent Bridge",
      role: "Ponte professionale fra agenti e runtime",
      reason: "Serve quando un agente deve ricevere eventi dal grafo e restituire azioni senza confondere il canale di controllo con il flusso dati.",
      inputs: ["agent_control", "listening"],
      outputs: ["action"],
      useWhen: "Un agente deve comandare nodi o ascoltare eventi runtime.",
      nextStep: "Inserisci Agent Bridge fra Orchestrator Agent e i nodi operativi; usa agent_control per controllo e action per comandi emessi.",
    });
    add({
      label: "Orchestrator Agent",
      role: "Cervello multi-step",
      reason: "Coordina task, decisioni, azioni, done ed error. E' il nodo giusto quando il flow deve comportarsi come un capo lavoro.",
      inputs: ["task"],
      outputs: ["decision", "action", "done", "error"],
      useWhen: "Il flow deve decidere sequenze, chiamare agenti o fermarsi su errore.",
      nextStep: "Collega Task Node -> Orchestrator Agent -> Agent Bridge o azioni specifiche.",
    });
  }

  if (wantsRouting || wantsAgentBoundary) {
    add({
      label: "Split",
      role: "Divide un flusso in due uscite",
      reason: "E' il nodo semplice per separare un edge logico in due rami OUT senza creare semantica AI.",
      inputs: ["input"],
      outputs: ["a", "b"],
      useWhen: "Vuoi duplicare o separare il payload verso due rami.",
      nextStep: "Usa Split se i due rami ricevono lo stesso payload; usa Condition se devono dipendere da una regola.",
    });
    add({
      label: "Condition",
      role: "Router true/false",
      reason: "Divide il percorso in base a una condizione, mantenendo chiaro cosa entra e cosa esce.",
      inputs: ["input"],
      outputs: ["true", "false"],
      useWhen: "Il ramo OUT dipende da stato, validazione o decisione.",
      nextStep: "Collega input -> Condition, poi true/false verso agenti, azioni o Preview.",
    });
  }

  if (wantsEmbeddedBoundary || wantsAgentBoundary) {
    add({
      label: "Flow In",
      role: "Porta IN di un Flow Map componibile",
      reason: "Espone ingressi dichiarati quando il flow deve essere riusato come modulo dentro altri Flow Map.",
      inputs: [],
      outputs: ["flow.in"],
      useWhen: "Stai costruendo un sotto-flow riutilizzabile con interfaccia pulita.",
      nextStep: "Configura le porte dal nodo Flow In e collega l'uscita al primo nodo interno.",
    });
    add({
      label: "Flow Out",
      role: "Porta OUT di un Flow Map componibile",
      reason: "Espone uscite dichiarate e rende leggibile il contratto del sotto-flow.",
      inputs: ["flow.out"],
      outputs: [],
      useWhen: "Vuoi pubblicare il risultato di un sotto-flow verso un Flow Map padre.",
      nextStep: "Collega l'ultimo nodo interno a Flow Out e nomina le porte con tipi coerenti.",
    });
  }

  if (!recommendations.length) {
    add({
      label: "Task Node",
      role: "Ingresso operativo",
      reason: "Trasforma un obiettivo utente in un evento runtime chiaro.",
      inputs: [],
      outputs: ["task"],
      useWhen: "La richiesta parte da un obiettivo, non da una sorgente esterna.",
      nextStep: "Collega Task Node a Orchestrator Agent o AI Analyzer.",
    });
    add({
      label: "Preview",
      role: "Verifica payload",
      reason: "Chiude il giro di debug e fa vedere cosa passa davvero nel runtime.",
      inputs: ["input"],
      outputs: [],
      useWhen: "Stai progettando o testando un nuovo flow.",
      nextStep: "Metti Preview dopo ogni ramo critico finche il contratto dati e' stabile.",
    });
  }

  const existingLabels = new Set((context.nodes || []).map((node) => flowPromptNormalize(node.label || node.id || "")));
  return {
    type: "architecture-advice",
    summary: wantsAgentBoundary
      ? "Per agenti con separazione IN/OUT usa un pattern Orchestrator Agent + Agent Bridge; aggiungi Split/Condition solo quando devi ramificare il payload, e Flow In/Flow Out solo per boundary di Flow Map componibili."
      : "Questa e' una richiesta di progettazione: propongo nodi di palette e pattern, non una ricerca nei nodi esistenti.",
    recommendations: recommendations.map((item) => ({
      ...item,
      alreadyInWorkspace: existingLabels.has(flowPromptNormalize(item.label)),
    })),
    pattern: wantsAgentBoundary
      ? "Task Node -> Orchestrator Agent -> Agent Bridge -> Split/Condition -> Actions/AI Agents/Preview"
      : "Source/Task -> Processor/Agent -> Preview/Action/Storage",
  };
};

const flowPromptDiagnoseContext = (context = {}) => {
  const nodes = context.nodes || [];
  const edges = context.edges || [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, 0]));
  const issues = [];

  edges.forEach((edge) => {
    if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) {
      issues.push({
        severity: "error",
        title: "Collegamento con nodo mancante",
        detail: `${edge.sourceNodeId || "N/D"} -> ${edge.targetNodeId || "N/D"} non punta a due nodi validi.`,
        fixAction: edge.id ? {
          type: "deleteDependencies",
          tool: "fixGraph",
          status: "ready",
          dependencyIds: [edge.id],
          summary: "Rimuovi questo collegamento rotto.",
        } : null,
      });
      return;
    }
    outgoing.set(edge.sourceNodeId, (outgoing.get(edge.sourceNodeId) || 0) + 1);
    incoming.set(edge.targetNodeId, (incoming.get(edge.targetNodeId) || 0) + 1);
    if (!edge.channel) {
      issues.push({
        severity: "warning",
        title: "Collegamento senza channel",
        detail: `${edge.sourceLabel || edge.sourceNodeId} -> ${edge.targetLabel || edge.targetNodeId} non dichiara un channel.`,
      });
    }
  });

  nodes.forEach((node) => {
    const category = flowPromptNormalize(node.category);
    const isSourceLike = ["sources", "trackers"].includes(category) || ["source", "boxtracker"].includes(flowPromptNormalize(node.type));
    const isSinkLike = ["lens", "actions", "storage"].includes(category) || ["lens", "action", "storage", "boxlens"].includes(flowPromptNormalize(node.type));
    if (!isSourceLike && !incoming.get(node.id)) {
      issues.push({
        severity: "warning",
        title: "Nodo senza input",
        detail: `${node.label} non riceve dati da altri nodi.`,
      });
    }
    if (!isSinkLike && !outgoing.get(node.id)) {
      issues.push({
        severity: "warning",
        title: "Nodo senza output collegato",
        detail: `${node.label} non invia dati a nessun nodo downstream.`,
      });
    }
    if (node.status === "error" || node.status === "failed") {
      issues.push({
        severity: "error",
        title: "Nodo in errore",
        detail: `${node.label} ha stato runtime ${node.status}.`,
      });
    }
  });

  (context.flowLogs || []).forEach((log) => {
    if ((log.level || log.status) === "error") {
      issues.push({
        severity: "error",
        title: "Flow log in errore",
        detail: `${log.nodeId || log.context?.nodeId || "runtime"}: ${log.message || log.error || "errore runtime"}`,
      });
    }
  });

  return issues.slice(0, 12);
};

const flowPromptNodeAliases = (node = {}) => {
  const metadataAliases = Array.isArray(node.metadata?.aliases) ? node.metadata.aliases : [];
  const runtimeAliases = Array.isArray(node.aliases) ? node.aliases : [];
  return [...new Set([...metadataAliases, ...runtimeAliases].map(String).filter(Boolean))];
};

const flowPromptNodeSearchText = (node = {}) =>
  flowPromptNormalize([node.id, node.label, node.type, node.subtype, node.category, ...flowPromptNodeAliases(node)].filter(Boolean).join(" "));

const flowPromptFindNodeByText = (context = {}, text = "") => {
  const normalized = flowPromptNormalize(text);
  if (!normalized) return null;
  const nodes = context.nodes || [];
  const exactVisible = nodes.filter((node) =>
    flowPromptNormalize(node.label || "") === normalized ||
    flowPromptNormalize(node.name || "") === normalized ||
    flowPromptNormalize(node.id || "") === normalized
  );
  if (exactVisible.length === 1) return exactVisible[0];
  const exactAlias = nodes.filter((node) =>
    flowPromptNodeAliases(node).some((alias) => flowPromptNormalize(alias) === normalized)
  );
  if (exactAlias.length === 1) return exactAlias[0];
  const exact = nodes.filter((node) => flowPromptNodeSearchText(node) === normalized);
  if (exact.length === 1) return exact[0];
  const visibleContains = nodes.filter((node) => {
    const label = flowPromptNormalize(node.label || node.name || "");
    return label && (label.includes(normalized) || normalized.includes(label));
  });
  if (visibleContains.length === 1) return visibleContains[0];
  const contains = nodes.filter((node) => flowPromptNodeSearchText(node).includes(normalized));
  if (contains.length === 1) return contains[0];
  const tokens = normalized.split(/\s+/).filter((token) => token.length > 2);
  const scored = nodes
    .map((node) => ({
      node,
      score: tokens.reduce((sum, token) => sum + (flowPromptNodeSearchText(node).includes(token) ? 1 : 0), 0),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.length && scored[0].score > (scored[1]?.score || 0) ? scored[0].node : null;
};

const flowPromptFindNodeCandidates = (context = {}, text = "", limit = 3) => {
  const normalized = flowPromptNormalize(text);
  if (!normalized) return [];
  const nodes = context.nodes || [];
  const tokens = normalized.split(/\s+/).filter((token) => token.length > 2);
  return nodes
    .map((node) => {
      const haystack = flowPromptNodeSearchText(node);
      let score = 0;
      if (haystack === normalized) score += 100;
      if (haystack.includes(normalized)) score += 50;
      if (normalized.includes(flowPromptNormalize(node.label || ""))) score += 35;
      tokens.forEach((token) => {
        if (haystack.includes(token)) score += 8;
      });
      return { node, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || String(a.node.label || "").localeCompare(String(b.node.label || "")))
    .slice(0, limit)
    .map((item) => item.node);
};

const flowPromptBlockedChoice = ({ type = "action", tool = "", summary = "", sourceHint = "", targetHint = "", value = "", context = {}, promptBuilder = null } = {}) =>
  flowPromptAnnotateActionTool({
    type,
    status: "blocked",
    summary,
    choices: [
      ...flowPromptFindNodeCandidates(context, sourceHint).map((node) => ({
        role: "source",
        label: node.label || node.id,
        detail: `${node.type || "node"} · ${node.subtype || node.category || "runtime"}`,
        prompt: typeof promptBuilder === "function" ? promptBuilder({ source: node, target: null, value }) : "",
      })),
      ...flowPromptFindNodeCandidates(context, targetHint).map((node) => ({
        role: "target",
        label: node.label || node.id,
        detail: `${node.type || "node"} · ${node.subtype || node.category || "runtime"}`,
        prompt: typeof promptBuilder === "function" ? promptBuilder({ source: null, target: node, value }) : "",
      })),
    ].filter((choice) => choice.prompt),
  }, tool);

const flowPromptPlanHasChoices = (action = {}) =>
  !!(action?.choices?.length || (action?.actions || []).some((item) => flowPromptPlanHasChoices(item)));

const flowPromptDebugPlan = (action = {}) => {
  if (!action) return null;
  if (action.type === "batch") {
    return {
      type: "batch",
      status: action.status || "",
      summary: action.summary || "",
      tools: flowPromptPlanTools(action),
      actions: (action.actions || []).map(flowPromptDebugPlan),
    };
  }
  const toolName = flowPromptAgentToolForAction(action);
  const tool = flowPromptAgentTool(toolName);
  return {
    type: action.type || "",
    status: action.status || "",
    tool: toolName,
    toolStatus: tool?.status || action.toolStatus || "",
    toolCategory: tool?.category || action.toolCategory || "",
    toolMutates: typeof tool?.mutates === "boolean" ? tool.mutates : action.toolMutates,
    guardReason: action.guardReason || "",
    impactOnly: Boolean(action.impactOnly),
    summary: action.summary || "",
    impact: action.impact || null,
    nodeId: action.nodeId || action.node?.id || "",
    source: action.source?.label || action.sourceHint || "",
    target: action.target?.label || action.targetHint || "",
    field: action.field || "",
    value: action.value || "",
    choices: (action.choices || []).map((choice) => ({
      role: choice.role || "",
      label: choice.label || "",
      prompt: choice.prompt || "",
    })),
  };
};

const flowPromptRuntimeNodeById = (nodeId = "") =>
  (state.runtime.nodes || []).find((node) => node.id === nodeId) || null;

const flowPromptRuntimeDependencyExists = (action = {}) =>
  (state.runtime.dependencies || []).some((dependency) =>
    dependency.sourceNodeId === action.source?.id &&
    dependency.targetNodeId === action.target?.id &&
    (
      !action.channel ||
      String(dependency.channel || "") === String(action.channel || "") ||
      String(dependency.channel || "") === String(action.sourcePort || "")
    )
  );

const flowPromptActionAlreadyApplied = (action = {}) => {
  if (!action) return false;
  if (action.status === "applied") return true;
  if (action.type === "batch") {
    const actions = action.actions || [];
    return actions.length > 0 && actions.every((item) => flowPromptActionAlreadyApplied(item));
  }
  if (action.type === "connect") return flowPromptRuntimeDependencyExists(action);
  if (action.type === "deleteNode") return !!action.nodeId && !flowPromptRuntimeNodeById(action.nodeId);
  if (action.type === "duplicateNode") {
    return !!action.nextLabel && (state.runtime.nodes || []).some((node) =>
      String(node.label || "") === String(action.nextLabel || "") &&
      node.metadata?.duplicatedFrom === action.nodeId
    );
  }
  if (action.type === "moveNode") {
    const node = flowPromptRuntimeNodeById(action.nodeId);
    const next = action.nextPosition || {};
    const current = node?.flowPosition || node?.position || {};
    return !!node && flowWorldNumber(current.x) === flowWorldNumber(next.x) && flowWorldNumber(current.y) === flowWorldNumber(next.y);
  }
  if (action.type === "renameNode") {
    const node = flowPromptRuntimeNodeById(action.nodeId);
    return !!node && String(node.label || "") === String(action.nextLabel || "");
  }
  if (action.type === "updateNodeConfig") {
    const node = flowPromptRuntimeNodeById(action.nodeId);
    if (!node) return false;
    const value = String(action.value || "");
    if (action.target === "output") return String(node.outputs?.[0] || "") === value;
    if (action.target === "input") return String(node.inputs?.[0] || "") === value;
    if (action.target === "channel") return (node.channels || []).some((channel) => String(channel || "") === value);
    const field = flowPromptNormalizeConfigFieldName(action.field);
    return String(node.metadata?.config?.[field] ?? "") === value;
  }
  if (action.type === "deleteDependencies") {
    const ids = action.dependencyIds || [];
    return ids.length > 0 && ids.every((id) => !(state.runtime.dependencies || []).some((dependency) => dependency.id === id));
  }
  return false;
};

const flowPromptEffectiveActionStatus = (action = {}) => {
  if (action?.status === "ready" && flowPromptActionAlreadyApplied(action)) return "applied";
  if (action?.type === "batch") return action.status || "blocked";
  const toolName = flowPromptAgentToolForAction(action);
  if (action?.status === "ready" && toolName && !flowPromptAgentToolIsReady(toolName)) return "blocked";
  return action?.status || "blocked";
};

const flowPromptActionSummary = (action = {}) => {
  if (!action) return "";
  if (action.type === "batch") return action.summary || `${action.actions?.length || 0} azioni pronte.`;
  if (action.type === "researchEndpoint") return action.summary || `Cerca endpoint per ${action.query || "la richiesta"}.`;
  if (action.type === "connect") return action.summary || "";
  if (action.type === "deleteNode") return action.summary || `Elimina ${action.label || action.node?.label || action.nodeId}.`;
  if (action.type === "duplicateNode") return action.summary || `Duplica ${action.node?.label || action.nodeId}.`;
  if (action.type === "moveNode") return action.summary || `Sposta ${action.node?.label || action.nodeId}.`;
  if (action.type === "renameNode") return `Rinomina ${action.node?.label || action.nodeId} in ${action.nextLabel}.`;
  if (action.type === "updateNodeConfig") return action.summary || `Aggiorna ${action.node?.label || action.nodeId}: ${action.field} = ${action.value}.`;
  if (action.type === "deleteDependencies") return `Rimuovi ${action.dependencyIds?.length || 0} collegamenti rotti.`;
  return action.summary || "Azione runtime.";
};

const flowPromptPlanStatus = (actions = []) => {
  const validActions = (actions || []).filter(Boolean);
  if (!validActions.length) return "blocked";
  if (validActions.some((action) => action.status === "blocked")) return "blocked";
  if (validActions.some((action) => action.status === "ready" && action.tool && !flowPromptAgentToolIsReady(action.tool))) return "blocked";
  if (validActions.every((action) => action.status === "duplicate")) return "duplicate";
  return "ready";
};

const flowPromptBatchPlan = (actions = [], summary = "") => {
  const annotatedActions = (actions || [])
    .map((action) => flowPromptAnnotateActionPlan(action))
    .filter(Boolean);
  return flowPromptAnnotateActionTool({
    type: "batch",
    status: flowPromptPlanStatus(annotatedActions),
    summary: summary || `${annotatedActions.length} azioni preparate.`,
    actions: annotatedActions,
    tools: flowPromptPlanTools({ type: "batch", actions: annotatedActions }),
  });
};

const flowPromptPlannerStepTitle = (action = {}) => {
  const tool = flowPromptAgentTool(flowPromptAgentToolForAction(action));
  if (tool?.label) return tool.label;
  if (action.type === "researchEndpoint") return "Research Endpoint";
  if (action.type === "connect") return "Connect Nodes";
  if (action.type === "deleteNode") return "Delete Node";
  if (action.type === "duplicateNode") return "Duplicate Node";
  if (action.type === "moveNode") return "Move Node";
  if (action.type === "deleteDependencies") return action.tool === "fixGraph" ? "Fix Graph" : "Disconnect Nodes";
  if (action.type === "renameNode") return "Rename Node";
  if (action.type === "updateNodeConfig") return "Update Node Config";
  return action.type || "Agent Step";
};

const flowPromptPlannerStepStatus = (action = {}) => {
  const status = flowPromptEffectiveActionStatus(action);
  if (status === "duplicate") return "done";
  if (status === "applied") return "done";
  if (status === "ready") return "ready";
  return "blocked";
};

const flowPromptAgentPlanSteps = (plan = null) => {
  const actions = flowPromptFlattenActionPlan(plan).filter(Boolean);
  return actions.map((action, index) => {
    const toolName = flowPromptAgentToolForAction(action);
    const tool = flowPromptAgentTool(toolName);
    const stepId = action.stepId || `step_${String(index + 1).padStart(2, "0")}_${toolName || action.type || "action"}`;
    const dependsOn = Array.isArray(action.dependsOn)
      ? action.dependsOn
      : action.dependsOn
        ? [action.dependsOn]
        : index > 0
          ? [`step_${String(index).padStart(2, "0")}_${flowPromptAgentToolForAction(actions[index - 1]) || actions[index - 1]?.type || "action"}`]
          : [];
    return {
      id: stepId,
      order: index + 1,
      title: flowPromptPlannerStepTitle(action),
      summary: flowPromptActionSummary(action),
      status: flowPromptPlannerStepStatus(action),
      tool: toolName,
      toolStatus: tool?.status || action.toolStatus || "",
      toolCategory: tool?.category || action.toolCategory || "",
      mutates: typeof tool?.mutates === "boolean" ? tool.mutates : Boolean(action.toolMutates),
      dependsOn,
      action,
    };
  });
};

const flowPromptAgentPlanStatus = (steps = []) => {
  if (!steps.length) return "blocked";
  if (steps.some((step) => step.status === "blocked")) return "blocked";
  if (steps.every((step) => step.status === "done")) return "done";
  return "ready";
};

const flowPromptBuildGenericAgentPlan = (plan = null, meta = {}) => {
  if (!plan) return null;
  const steps = flowPromptAgentPlanSteps(plan);
  return {
    version: "flow-agent-plan/v1",
    planner: "generic-multi-step",
    source: meta.source || "local",
    prompt: meta.prompt || "",
    summary: plan.summary || `${steps.length} step agentici.`,
    status: flowPromptAgentPlanStatus(steps),
    tools: flowPromptPlanTools(plan),
    steps,
  };
};

const flowPromptDebugAgentPlan = (agentPlan = null) =>
  !agentPlan ? null : {
    version: agentPlan.version,
    planner: agentPlan.planner,
    source: agentPlan.source,
    status: agentPlan.status,
    summary: agentPlan.summary,
    tools: agentPlan.tools,
    steps: (agentPlan.steps || []).map((step) => ({
      id: step.id,
      order: step.order,
      title: step.title,
      status: step.status,
      tool: step.tool,
      toolStatus: step.toolStatus,
      dependsOn: step.dependsOn,
      actionType: step.action?.type || "",
    })),
  };

const flowPromptSplitCompoundCommands = (prompt = "") => {
  const text = String(prompt || "").trim();
  if (!text) return [];
  const commandVerb = "(?:collega|connetti|connect|link|scollega|disconnetti|unlink|disconnect|elimina|elimini|elimine|eliminare|cancella|cancellare|rimuovi|remove|delete|duplica|duplicare|copia|clona|duplicate|clone|sposta|spostare|muovi|move|rinomina|rename|cambia|imposta|set|aggiorna|modifica|sistema|fix|ripara)";
  return text
    .replace(/[;\n]+/g, "\n")
    .replace(new RegExp(`\\b(?:prima|first)\\s+(?=${commandVerb}\\b)`, "gi"), "")
    .replace(new RegExp(`\\s+(?:e\\s+poi|poi|quindi|dopo)\\s+(?=${commandVerb}\\b)`, "gi"), "\n")
    .replace(new RegExp(`\\s+e\\s+(?=${commandVerb}\\b)`, "gi"), "\n")
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
};

const flowPromptFlattenActionPlan = (plan = null) => {
  if (!plan) return [];
  if (plan.type === "batch") return plan.actions || [];
  return [plan];
};

const flowPromptActionPlanWithStepMeta = (plan = null, meta = {}) => {
  if (!plan || (!meta.stepId && !meta.dependsOn)) return plan;
  const applyMeta = (action = {}, index = 0) => ({
    ...action,
    stepId: index === 0 && meta.stepId ? meta.stepId : action.stepId,
    dependsOn: index === 0 && meta.dependsOn ? meta.dependsOn : action.dependsOn,
  });
  if (plan.type === "batch") {
    return {
      ...plan,
      actions: (plan.actions || []).map(applyMeta),
    };
  }
  return applyMeta(plan);
};

const flowPromptCloneAgentContext = (context = {}) => ({
  ...context,
  nodes: (context.nodes || []).map((node) => ({
    ...node,
    inputs: [...(node.inputs || [])],
    outputs: [...(node.outputs || [])],
    channels: [...(node.channels || [])],
    flowPosition: { ...(node.flowPosition || {}) },
    position: { ...(node.position || {}) },
    metadata: {
      ...(node.metadata || {}),
      config: { ...(node.metadata?.config || {}) },
    },
  })),
  edges: (context.edges || []).map((edge) => ({ ...edge })),
  channels: (context.channels || []).map((channel) => ({ ...channel })),
});

const flowPromptCompoundNodeId = ({ workspaceId = currentWorkspaceId(), node = {}, label = "" } = {}) =>
  `agent_compound_${safeRuntimeId(workspaceId)}_${safeRuntimeId(node.type || "node")}_${safeRuntimeId(label || node.label || "copy")}_${Date.now()}_${Math.round(Math.random() * 10000)}`;

const flowPromptApplyActionToPlanningContext = (context = {}, action = {}) => {
  if (!context || !action || action.status !== "ready") return context;
  const nodes = context.nodes || [];
  const edges = context.edges || [];
  if (action.type === "renameNode") {
    const node = nodes.find((item) => item.id === action.nodeId);
    if (node) node.label = action.nextLabel || node.label;
    return context;
  }
  if (action.type === "duplicateNode") {
    const source = nodes.find((item) => item.id === action.nodeId) || action.node;
    if (source?.id) {
      const newNodeId = action.newNodeId || flowPromptCompoundNodeId({ node: source, label: action.nextLabel });
      action.newNodeId = newNodeId;
      const basePosition = source.flowPosition || source.position || { x: 0, y: 0 };
      nodes.push({
        ...source,
        id: newNodeId,
        label: action.nextLabel || `${source.label || source.id} Copy`,
        sourceRef: newNodeId,
        flowPosition: {
          x: flowCoordinate(flowWorldNumber(basePosition.x) + 180),
          y: flowCoordinate(flowWorldNumber(basePosition.y) + 120),
          width: flowNodeWidth(basePosition),
        },
        metadata: {
          ...(source.metadata || {}),
          duplicatedFrom: source.id,
          generatedBy: "flow-map-agent",
        },
      });
    }
    return context;
  }
  if (action.type === "deleteNode") {
    context.nodes = nodes.filter((node) => node.id !== action.nodeId);
    context.edges = edges.filter((edge) => edge.sourceNodeId !== action.nodeId && edge.targetNodeId !== action.nodeId);
    return context;
  }
  if (action.type === "deleteDependencies") {
    const ids = new Set(action.dependencyIds || []);
    context.edges = edges.filter((edge) => !ids.has(edge.id));
    return context;
  }
  if (action.type === "connect" && action.source?.id && action.target?.id) {
    const exists = edges.some((edge) =>
      edge.sourceNodeId === action.source.id &&
      edge.targetNodeId === action.target.id &&
      String(edge.channel || "") === String(action.channel || action.sourcePort || "")
    );
    if (!exists) {
      context.edges = [
        ...edges,
        {
          id: `planned_${safeRuntimeId(action.source.id)}_${safeRuntimeId(action.target.id)}_${Date.now()}`,
          workspaceId: currentWorkspaceId(),
          sourceNodeId: action.source.id,
          targetNodeId: action.target.id,
          sourceLabel: action.source.label || action.source.id,
          targetLabel: action.target.label || action.target.id,
          channel: action.channel || action.sourcePort || "runtime",
        },
      ];
    }
    return context;
  }
  if (action.type === "updateNodeConfig") {
    const node = nodes.find((item) => item.id === action.nodeId);
    if (!node) return context;
    node.metadata = { ...(node.metadata || {}), config: { ...(node.metadata?.config || {}) } };
    if (action.target === "output") {
      node.outputs = [action.value, ...(node.outputs || []).slice(1)].filter(Boolean);
      node.channels = [...new Set([...(node.channels || []), action.value].filter(Boolean))];
    } else if (action.target === "input") {
      node.inputs = [action.value, ...(node.inputs || []).slice(1)].filter(Boolean);
      node.channels = [...new Set([...(node.channels || []), action.value].filter(Boolean))];
    } else if (action.target === "channel") {
      node.channels = [...new Set([action.value, ...(node.channels || []).slice(1)].filter(Boolean))];
    } else {
      node.metadata.config[flowPromptNormalizeConfigFieldName(action.field)] = action.value;
    }
    return context;
  }
  if (action.type === "moveNode") {
    const node = nodes.find((item) => item.id === action.nodeId);
    if (node) node.flowPosition = { ...(action.nextPosition || node.flowPosition || {}) };
    return context;
  }
  return context;
};

const flowPromptNodeDependencyImpact = (context = {}, node = {}) => {
  if (!node?.id) return null;
  const incoming = (context.edges || []).filter((edge) => edge.targetNodeId === node.id);
  const outgoing = (context.edges || []).filter((edge) => edge.sourceNodeId === node.id);
  const channels = [...new Set([
    ...(node.inputs || []),
    ...(node.outputs || []),
    ...(node.channels || []),
    ...incoming.map((edge) => edge.channel),
    ...outgoing.map((edge) => edge.channel),
  ].filter(Boolean))];
  const recentRuntime = [...(context.flowLogs || []), ...(context.events || [])].filter((record) =>
    record.nodeId === node.id ||
    record.context?.nodeId === node.id ||
    channels.includes(record.channel)
  );
  return {
    nodeId: node.id,
    nodeLabel: node.label || node.id,
    incoming,
    outgoing,
    channels,
    recentRuntime: flowPromptRecentRecords(recentRuntime, 5),
  };
};

const flowPromptActionImpact = (context = {}, action = {}) => {
  if (!action || typeof action !== "object") return null;
  const node = action.node || flowPromptFindNodeByText(context, action.nodeId || action.label || "");
  const impact = node?.id ? flowPromptNodeDependencyImpact(context, node) : null;
  const links = [...(impact?.incoming || []), ...(impact?.outgoing || [])];
  const linkSummary = links.length
    ? `${links.length} link (${impact.incoming.length} IN, ${impact.outgoing.length} OUT)`
    : "nessun link diretto";
  if (action.type === "deleteNode" && impact) {
    return {
      severity: links.length ? "high" : "low",
      title: "Impatto eliminazione",
      summary: `Eliminare ${impact.nodeLabel} rimuove il nodo e ${linkSummary}.`,
      items: [
        ...impact.incoming.slice(0, 4).map((edge) => `IN: ${edge.sourceLabel || edge.sourceNodeId} -> ${impact.nodeLabel} (${edge.channel || "runtime"})`),
        ...impact.outgoing.slice(0, 4).map((edge) => `OUT: ${impact.nodeLabel} -> ${edge.targetLabel || edge.targetNodeId} (${edge.channel || "runtime"})`),
      ],
    };
  }
  if (action.type === "deleteDependencies") {
    const ids = new Set(action.dependencyIds || []);
    const selected = (context.edges || []).filter((edge) => ids.has(edge.id));
    return {
      severity: selected.length ? "medium" : "low",
      title: "Impatto scollegamento",
      summary: `Rimuove ${selected.length || action.dependencyIds?.length || 0} collegamento/i runtime.`,
      items: selected.slice(0, 6).map((edge) =>
        `${edge.sourceLabel || edge.sourceNodeId} -> ${edge.targetLabel || edge.targetNodeId} (${edge.channel || "runtime"})`
      ),
    };
  }
  if (action.type === "connect" && action.source && action.target) {
    return {
      severity: "low",
      title: "Impatto collegamento",
      summary: `Aggiunge un nuovo path ${action.source.label || action.source.id} -> ${action.target.label || action.target.id}.`,
      items: [`channel: ${action.channel || action.sourcePort || "runtime"}`, `porte: ${action.sourcePort || "output"} -> ${action.targetPort || "input"}`],
    };
  }
  if (action.type === "renameNode" && impact) {
    return {
      severity: "low",
      title: "Impatto rename",
      summary: `Rinomina solo la label visibile di ${impact.nodeLabel}; id, canali e link restano invariati.`,
      items: links.length ? [`Link preservati: ${linkSummary}`] : [],
    };
  }
  if (action.type === "updateNodeConfig" && impact) {
    const target = action.target || "config";
    const field = action.field || "config";
    const changesChannel = ["input", "output", "channel"].includes(target) || ["input", "output", "channel"].includes(field);
    return {
      severity: changesChannel && links.length ? "medium" : "low",
      title: "Impatto configurazione",
      summary: changesChannel
        ? `Modifica un canale/porta di ${impact.nodeLabel}; verifica i consumer collegati.`
        : `Modifica ${field} di ${impact.nodeLabel}; i link runtime non vengono cambiati.`,
      items: [
        `campo: ${target}.${field}`,
        links.length ? `Link esistenti: ${linkSummary}` : "Nessun link diretto",
        impact.recentRuntime.length ? `Runtime recente: ${impact.recentRuntime.length} record correlati` : "",
      ].filter(Boolean),
    };
  }
  if (action.type === "duplicateNode" && impact) {
    return {
      severity: "low",
      title: "Impatto duplicazione",
      summary: `Duplica ${impact.nodeLabel} senza copiare automaticamente ${linkSummary}.`,
      items: impact.channels.slice(0, 5).map((channel) => `canale esistente: ${channel}`),
    };
  }
  if (action.type === "moveNode" && impact) {
    return {
      severity: "low",
      title: "Impatto layout",
      summary: `Sposta ${impact.nodeLabel} sul canvas; runtime, link e canali restano invariati.`,
      items: links.length ? [`Link preservati: ${linkSummary}`] : [],
    };
  }
  return null;
};

const flowPromptWithDependencyImpact = (context = {}, plan = null) => {
  if (!plan) return plan;
  if (plan.type === "batch") {
    return flowPromptAnnotateActionPlan({
      ...plan,
      actions: (plan.actions || []).map((action) => flowPromptWithDependencyImpact(context, action)),
    });
  }
  const impact = flowPromptActionImpact(context, plan);
  return impact ? { ...plan, impact } : plan;
};

const flowPromptIsImpactOnlyRequest = (prompt = "") => {
  const text = flowPromptNormalize(prompt);
  const asksImpact = flowPromptHasAny(text, [
    "che impatto", "impatto", "impact", "cosa succede", "cosa succederebbe",
    "prima dimmi", "solo analizza", "analizza impatto", "preview impatto",
    "che dipendenze", "quali dipendenze", "dependency impact",
  ]);
  const mentionsCommand = flowPromptHasAny(text, [
    "collega", "connetti", "connect", "link", "scollega", "disconnetti", "unlink", "disconnect",
    "elimina", "elimini", "elimine", "eliminare", "cancella", "cancellare", "rimuovi", "remove", "delete",
    "rinomina", "rename", "cambia", "imposta", "set", "aggiorna", "modifica",
    "duplica", "duplicare", "copia", "clona", "duplicate", "clone", "sposta", "move",
  ]);
  return asksImpact && mentionsCommand;
};

const flowPromptPromptHasForce = (prompt = "") =>
  flowPromptHasAny(flowPromptNormalize(prompt), [
    "confermo", "conferma", "confirm", "forza", "force", "applica comunque",
    "procedi comunque", "esegui comunque", "sono sicuro", "sicuro", "yes apply",
  ]);

const flowPromptMapActionPlan = (plan = null, mapper = (action) => action) => {
  if (!plan) return plan;
  if (plan.type === "batch") {
    return flowPromptAnnotateActionPlan({
      ...plan,
      actions: (plan.actions || [])
        .map((action) => flowPromptMapActionPlan(action, mapper))
        .filter(Boolean),
    });
  }
  return flowPromptAnnotateActionPlan(mapper(plan));
};

const flowPromptActionRequiresDependencyConfirm = (action = {}) =>
  action?.status === "ready" &&
  action?.type === "deleteNode" &&
  action?.impact?.severity === "high";

const flowPromptConfirmPromptForAction = (action = {}) => {
  if (action.type === "deleteNode") {
    const label = action.node?.label || action.label || action.nodeId || "questo nodo";
    return `confermo elimina nodo ${label}`;
  }
  return `confermo ${action.summary || action.type || "applica modifica"}`;
};

const flowPromptFinalizeDependencyAwarePlan = (context = {}, plan = null, prompt = "") => {
  const withImpact = flowPromptWithDependencyImpact(context, plan);
  if (!withImpact) return withImpact;
  const impactOnly = flowPromptIsImpactOnlyRequest(prompt);
  const forced = flowPromptPromptHasForce(prompt);
  const mapped = flowPromptMapActionPlan(withImpact, (action = {}) => {
    if (!action || action.type === "researchEndpoint") return action;
    const toolName = flowPromptAgentToolForAction(action);
    const tool = flowPromptAgentTool(toolName);
    const mutates = typeof tool?.mutates === "boolean" ? tool.mutates : Boolean(action.toolMutates);
    if (impactOnly && action.status === "ready" && mutates) {
      return {
        ...action,
        status: "blocked",
        impactOnly: true,
        guardReason: "impact-only",
        summary: `Solo analisi impatto: ${flowPromptActionSummary(action)}`,
      };
    }
    if (!forced && flowPromptActionRequiresDependencyConfirm(action)) {
      const confirmPrompt = flowPromptConfirmPromptForAction(action);
      const choices = [
        ...(action.choices || []),
        {
          role: "confirm",
          label: "Conferma",
          detail: "Applica il delete pulendo i collegamenti indicati dall'impatto.",
          prompt: confirmPrompt,
        },
      ];
      return {
        ...action,
        status: "blocked",
        guardReason: "dependency-confirmation-required",
        choices,
        summary: `Richiede conferma esplicita: ${flowPromptActionSummary(action)}`,
      };
    }
    return action;
  });
  if (impactOnly && mapped?.summary) {
    return flowPromptAnnotateActionPlan({
      ...mapped,
      summary: `Analisi impatto: ${mapped.summary}`,
    });
  }
  return mapped;
};

const flowPromptBuildConnectPlan = (context = {}, prompt = "") => {
  const text = String(prompt || "").trim();
  const match = text.match(/(?:collega|connetti|connect|link)\s+(.+?)\s+(?:a|ad|to|->)\s+(.+)$/i);
  if (!match) return null;
  const source = flowPromptFindNodeByText(context, match[1]);
  const target = flowPromptFindNodeByText(context, match[2]);
  if (!source?.id || !target?.id) {
    return flowPromptBlockedChoice({
      type: "connect",
      summary: "Non ho trovato in modo univoco i due nodi da collegare.",
      sourceHint: match[1],
      targetHint: match[2],
      context,
      promptBuilder: ({ source: pickedSource, target: pickedTarget }) =>
        `collega ${pickedSource?.label || match[1]} a ${pickedTarget?.label || match[2]}`,
    });
  }
  const sourcePort = source.outputs?.[0] || source.channels?.[0] || "output";
  const targetPort = target.inputs?.[0] || "input";
  if (!source.outputs?.length && !source.channels?.length) {
    return flowPromptAnnotateActionTool({
      type: "connect",
      status: "blocked",
      summary: `${source.label} non espone output/channel validi per creare il collegamento.`,
    }, "connectNodes");
  }
  if (!target.inputs?.length) {
    return flowPromptAnnotateActionTool({
      type: "connect",
      status: "blocked",
      summary: `${target.label} non espone input validi per ricevere dati.`,
    }, "connectNodes");
  }
  const channel = sourcePort || source.channels?.[0] || "runtime";
  const duplicate = (context.edges || []).find((edge) =>
    edge.sourceNodeId === source.id &&
    edge.targetNodeId === target.id &&
    String(edge.channel || "") === String(channel || "")
  );
  return flowPromptAnnotateActionTool({
    type: "connect",
    status: duplicate ? "duplicate" : "ready",
    summary: duplicate
      ? `${source.label} è già collegato a ${target.label} sul channel ${channel}.`
      : `Posso collegare ${source.label} a ${target.label} usando ${sourcePort} -> ${targetPort}.`,
    source,
    target,
    sourcePort,
    targetPort,
    channel,
    duplicateId: duplicate?.id || "",
  }, "connectNodes");
};

const flowPromptBuildDisconnectPlan = (context = {}, prompt = "") => {
  const text = String(prompt || "").trim();
  const match = text.match(/(?:scollega|disconnetti|unlink|disconnect|rimuovi\s+collegamento)\s+(.+?)\s+(?:da|a|ad|to|->)\s+(.+)$/i);
  if (!match) return null;
  const source = flowPromptFindNodeByText(context, match[1]);
  const target = flowPromptFindNodeByText(context, match[2]);
  if (!source?.id || !target?.id) {
    return flowPromptBatchPlan([
      flowPromptBlockedChoice({
        type: "deleteDependencies",
        summary: "Non ho trovato in modo univoco i due nodi da scollegare.",
        sourceHint: match[1],
        targetHint: match[2],
        context,
        promptBuilder: ({ source: pickedSource, target: pickedTarget }) =>
          `scollega ${pickedSource?.label || match[1]} da ${pickedTarget?.label || match[2]}`,
      }),
    ], "Non posso scollegare: source o target non chiaro.");
  }
  const links = (context.edges || []).filter((edge) =>
    edge.sourceNodeId === source.id && edge.targetNodeId === target.id
  );
  if (!links.length) {
    return flowPromptBatchPlan([], `${source.label} e ${target.label} non risultano collegati.`);
  }
  return flowPromptBatchPlan([
    {
      type: "deleteDependencies",
      tool: "disconnectNodes",
      status: "ready",
      dependencyIds: links.map((edge) => edge.id).filter(Boolean),
      summary: `Scollego ${source.label} da ${target.label}.`,
    },
  ], `Posso rimuovere ${links.length} collegamento/i tra ${source.label} e ${target.label}.`);
};

const flowPromptExtractDeleteNodeHint = (prompt = "") => {
  const text = String(prompt || "").trim();
  const match = text.match(/(?:elimina|elimini|elimine|eliminare|cancella|cancellare|rimuovi|remove|delete)\s+(?:il\s+|la\s+|lo\s+|un\s+|una\s+)?(?:node|nodo)?\s*(.+)$/i);
  return String(match?.[1] || "")
    .replace(/\b(node|nodo)\b/gi, " ")
    .replace(/^(il|la|lo|un|una)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
};

const flowPromptBuildDeleteNodePlan = (context = {}, prompt = "") => {
  const nodeHint = flowPromptExtractDeleteNodeHint(prompt);
  const node = flowPromptFindNodeByText(context, nodeHint);
  if (!node?.id) {
    return flowPromptBatchPlan([
      flowPromptBlockedChoice({
        type: "deleteNode",
        tool: "deleteNode",
        summary: "Non ho trovato in modo univoco il nodo da eliminare.",
        sourceHint: nodeHint,
        context,
        promptBuilder: ({ source: pickedNode }) =>
          `elimina nodo ${pickedNode?.label || nodeHint}`,
      }),
    ], "Non posso eliminare: nodo non chiaro.");
  }
  const relatedEdges = (context.edges || []).filter((edge) =>
    edge.sourceNodeId === node.id || edge.targetNodeId === node.id
  );
  return flowPromptBatchPlan([
    {
      type: "deleteNode",
      tool: "deleteNode",
      status: "ready",
      node,
      nodeId: node.id,
      label: node.label || node.id,
      relatedDependencyIds: relatedEdges.map((edge) => edge.id).filter(Boolean),
      summary: `Elimino ${node.label || node.id} e pulisco ${relatedEdges.length} collegamento/i collegati.`,
    },
  ], `Posso eliminare ${node.label || node.id}. Verranno puliti ${relatedEdges.length} collegamento/i collegati.`);
};

const flowPromptExtractDuplicateNodeHint = (prompt = "") => {
  const text = String(prompt || "").trim();
  const match = text.match(/(?:duplica|duplicare|copia|clona|duplicate|clone)\s+(?:il\s+|la\s+|lo\s+|un\s+|una\s+)?(?:node|nodo)?\s*(.+?)(?:\s+(?:come|as|in)\s+(.+))?$/i);
  const nodeHint = String(match?.[1] || "")
    .replace(/\b(node|nodo)\b/gi, " ")
    .replace(/^(il|la|lo|un|una)\s+/i, "")
    .trim();
  const nextLabel = String(match?.[2] || "").trim();
  return { nodeHint, nextLabel };
};

const flowPromptBuildDuplicateNodePlan = (context = {}, prompt = "") => {
  const { nodeHint, nextLabel } = flowPromptExtractDuplicateNodeHint(prompt);
  const node = flowPromptFindNodeByText(context, nodeHint);
  if (!node?.id) {
    return flowPromptBatchPlan([
      flowPromptBlockedChoice({
        type: "duplicateNode",
        tool: "duplicateNode",
        summary: "Non ho trovato in modo univoco il nodo da duplicare.",
        sourceHint: nodeHint,
        context,
        promptBuilder: ({ source: pickedNode }) =>
          `duplica nodo ${pickedNode?.label || nodeHint}`,
      }),
    ], "Non posso duplicare: nodo non chiaro.");
  }
  const duplicateLabel = nextLabel || `${node.label || node.id} Copy`;
  const newNodeId = flowPromptCompoundNodeId({ node, label: duplicateLabel });
  return flowPromptBatchPlan([
    {
      type: "duplicateNode",
      tool: "duplicateNode",
      status: "ready",
      node,
      nodeId: node.id,
      newNodeId,
      nextLabel: duplicateLabel,
      summary: `Duplico ${node.label || node.id} come ${duplicateLabel}. I collegamenti non vengono duplicati automaticamente.`,
    },
  ], `Posso duplicare ${node.label || node.id} senza copiare i collegamenti.`);
};

const flowPromptMoveDeltaFromPrompt = (prompt = "") => {
  const text = flowPromptNormalize(prompt);
  const step = 220;
  if (flowPromptHasAny(text, ["sinistra", "left"])) return { x: -step, y: 0, label: "sinistra" };
  if (flowPromptHasAny(text, ["destra", "right"])) return { x: step, y: 0, label: "destra" };
  if (flowPromptHasAny(text, ["sopra", "su", "up"])) return { x: 0, y: -step, label: "sopra" };
  if (flowPromptHasAny(text, ["sotto", "giu", "giù", "down"])) return { x: 0, y: step, label: "sotto" };
  return { x: 140, y: 90, label: "leggermente" };
};

const flowPromptExtractMoveNodeHint = (prompt = "") => {
  const text = String(prompt || "").trim();
  const match = text.match(/(?:sposta|spostare|muovi|move)\s+(?:il\s+|la\s+|lo\s+|un\s+|una\s+)?(?:node|nodo)?\s*(.+?)(?:\s+(?:a|alla|verso|to|in)\s+(?:destra|sinistra|sopra|sotto|right|left|up|down|su|giu|giù))?$/i);
  return String(match?.[1] || "")
    .replace(/\b(node|nodo)\b/gi, " ")
    .replace(/^(il|la|lo|un|una)\s+/i, "")
    .trim();
};

const flowPromptBuildMoveNodePlan = (context = {}, prompt = "") => {
  const nodeHint = flowPromptExtractMoveNodeHint(prompt);
  const node = flowPromptFindNodeByText(context, nodeHint);
  const delta = flowPromptMoveDeltaFromPrompt(prompt);
  if (!node?.id) {
    return flowPromptBatchPlan([
      flowPromptBlockedChoice({
        type: "moveNode",
        tool: "moveNode",
        summary: "Non ho trovato in modo univoco il nodo da spostare.",
        sourceHint: nodeHint,
        context,
        promptBuilder: ({ source: pickedNode }) =>
          `sposta nodo ${pickedNode?.label || nodeHint} a ${delta.label}`,
      }),
    ], "Non posso spostare: nodo non chiaro.");
  }
  const current = node.flowPosition || node.position || { x: 0, y: 0 };
  const nextPosition = {
    x: flowCoordinate(flowWorldNumber(current.x) + delta.x),
    y: flowCoordinate(flowWorldNumber(current.y) + delta.y),
    width: flowNodeWidth(current),
  };
  return flowPromptBatchPlan([
    {
      type: "moveNode",
      tool: "moveNode",
      status: "ready",
      node,
      nodeId: node.id,
      previousPosition: current,
      nextPosition,
      summary: `Sposto ${node.label || node.id} ${delta.label}.`,
    },
  ], `Posso spostare ${node.label || node.id} ${delta.label}.`);
};

const flowPromptBuildFixPlan = (context = {}) => {
  const nodeIds = new Set((context.nodes || []).map((node) => node.id));
  const broken = (context.edges || []).filter((edge) => !nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId));
  if (!broken.length) {
    return flowPromptBatchPlan([], "Non ho trovato collegamenti rotti da sistemare.");
  }
  return flowPromptBatchPlan([
    {
      type: "deleteDependencies",
      tool: "fixGraph",
      status: "ready",
      dependencyIds: broken.map((edge) => edge.id).filter(Boolean),
      summary: `Rimuovo ${broken.length} collegamenti con nodo mancante.`,
    },
  ], `Posso rimuovere ${broken.length} collegamenti rotti dal runtime graph.`);
};

const flowPromptBuildRenamePlan = (context = {}, prompt = "") => {
  const text = String(prompt || "").trim();
  const match = text.match(/(?:rinomina|rename)\s+(?:il\s+)?(?:nodo\s+)?(.+?)\s+(?:in|a|to)\s+(.+)$/i)
    || text.match(/(?:cambia|cambiare)\s+(?:il\s+)?(?:nome|di nome)\s+(?:di\s+)?(?:il\s+)?(?:nodo\s+)?(.+?)\s+(?:in|a|to)\s+(.+)$/i);
  if (!match) return flowPromptBatchPlan([], "Non ho capito quale nodo rinominare.");
  const node = flowPromptFindNodeByText(context, match[1]);
  const nextLabel = String(match[2] || "").trim();
  if (!node?.id || !nextLabel) {
    return flowPromptBatchPlan([
      flowPromptBlockedChoice({
        type: "renameNode",
        summary: "Nodo o nuovo nome non trovato.",
        sourceHint: match[1],
        value: nextLabel,
        context,
        promptBuilder: ({ source: pickedNode, value: pickedValue }) =>
          `rinomina ${pickedNode?.label || match[1]} in ${pickedValue || nextLabel}`,
      }),
    ], "Non posso rinominare: nodo o nuovo nome non chiaro.");
  }
  return flowPromptBatchPlan([
    {
      type: "renameNode",
      tool: "renameNode",
      status: "ready",
      node,
      nodeId: node.id,
      previousLabel: node.label,
      nextLabel,
      summary: `Rinomino ${node.label} in ${nextLabel}.`,
    },
  ], `Posso rinominare ${node.label} in ${nextLabel}.`);
};

const flowPromptParseConfigField = (prompt = "") => {
  const text = flowPromptNormalize(prompt);
  if (flowPromptHasAny(text, ["provider"])) return { field: "provider", target: "config" };
  if (flowPromptHasAny(text, ["modello", "model"])) return { field: "model", target: "config" };
  if (flowPromptHasAny(text, ["chatid", "chat id"])) return { field: "chatId", target: "config" };
  if (flowPromptHasAny(text, ["url", "endpoint"])) return { field: "endpoint", target: "config" };
  if (flowPromptHasAny(text, ["method", "metodo"])) return { field: "method", target: "config" };
  if (flowPromptHasAny(text, ["canale output", "output channel", "output"])) return { field: "output", target: "output" };
  if (flowPromptHasAny(text, ["canale input", "input channel", "input"])) return { field: "input", target: "input" };
  if (flowPromptHasAny(text, ["canale", "channel"])) return { field: "channel", target: "channel" };
  return { field: "config", target: "config" };
};

const flowPromptNormalizeConfigFieldName = (field = "") => {
  const key = flowPromptNormalize(field).replace(/\s+/g, "");
  if (["url", "uri", "endpoint", "sourceurl", "sourceendpoint"].includes(key)) return "endpoint";
  if (["metodo", "method", "httpmethod"].includes(key)) return "method";
  if (["modello", "model"].includes(key)) return "model";
  if (["chatid", "chat"].includes(key)) return "chatId";
  return String(field || "config").trim() || "config";
};

const flowPromptExtractExplicitUrl = (prompt = "") => {
  const match = String(prompt || "").match(/\b(?:https?|wss?):\/\/[^\s"'<>]+/i);
  return String(match?.[0] || "").replace(/[),.;]+$/g, "");
};

const flowPromptUrlLooksLikeResearchSource = (url = "") => {
  try {
    const parsed = new URL(String(url || ""));
    const haystack = `${parsed.pathname} ${parsed.search}`.toLowerCase();
    return /(openapi|swagger|api-docs|\/docs?(?:\/|$)|documentation|\.ya?ml(?:\?|$)|\.json(?:\?|$))/i.test(haystack);
  } catch (_) {
    return false;
  }
};

const flowPromptUsesExplicitUrlAsResearchSource = (prompt = "") => {
  const explicitUrl = flowPromptExtractExplicitUrl(prompt);
  if (!explicitUrl || !flowPromptLooksLikeEndpointLookup(prompt)) return false;
  const text = flowPromptNormalize(prompt);
  return flowPromptUrlLooksLikeResearchSource(explicitUrl) || flowPromptHasAny(text, [
    " da ", " dal ", " dalla ", " from ", "source", "sorgente", "documentazione", "docs", "spec", "openapi", "swagger",
  ]);
};

const flowPromptIsExplicitRuntimeUrl = (value = "") =>
  /^(https?|wss?):\/\/[^\s"'<>]+$/i.test(String(value || "").trim());

const flowPromptLooksLikePlaceholderValue = (value = "") => {
  const text = String(value || "").trim();
  if (!text) return true;
  if (/^\[[^\]]+\]$/.test(text)) return true;
  return flowPromptHasAny(flowPromptNormalize(text), ["placeholder", "example endpoint", "api endpoint"]);
};

const FLOW_PROMPT_ENDPOINT_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

const flowPromptValidateEndpointCandidate = ({ value = "", method = "GET" } = {}) => {
  const endpoint = String(value || "").trim();
  const httpMethod = String(method || "GET").trim().toUpperCase();
  if (!endpoint) return { ok: false, reason: "Endpoint vuoto.", endpoint, method: httpMethod };
  if (flowPromptLooksLikePlaceholderValue(endpoint)) {
    return { ok: false, reason: "Endpoint placeholder: serve un URL reale.", endpoint, method: httpMethod };
  }
  if (flowPromptUrlLooksLikeResearchSource(endpoint)) {
    return {
      ok: false,
      reason: "Questo URL sembra uno spec/documentazione OpenAPI, non un endpoint runtime.",
      endpoint,
      method: httpMethod,
    };
  }
  if (!flowPromptIsExplicitRuntimeUrl(endpoint)) {
    return { ok: false, reason: "L'endpoint deve iniziare con http://, https://, ws:// o wss://.", endpoint, method: httpMethod };
  }
  if (!FLOW_PROMPT_ENDPOINT_METHODS.has(httpMethod)) {
    return { ok: false, reason: `Metodo HTTP non supportato: ${httpMethod}.`, endpoint, method: httpMethod };
  }
  try {
    const parsed = new URL(endpoint);
    if (!parsed.hostname) return { ok: false, reason: "URL senza host.", endpoint, method: httpMethod };
    return {
      ok: true,
      reason: "URL valido per configurazione runtime.",
      endpoint: parsed.toString(),
      method: httpMethod,
      protocol: parsed.protocol.replace(":", ""),
      host: parsed.host,
    };
  } catch (_) {
    return { ok: false, reason: "URL non parsabile.", endpoint, method: httpMethod };
  }
};

const flowPromptLooksLikeEndpointLookup = (prompt = "") => {
  const text = flowPromptNormalize(prompt);
  return flowPromptHasAny(text, ["cerca", "cerchi", "cercami", "trova", "trovami", "lookup"])
    && flowPromptHasAny(text, ["endpoint", "url", "api", "rest api"]);
};

const flowPromptEndpointResearchQuery = (prompt = "") => {
  const text = String(prompt || "").trim();
  if (flowPromptUsesExplicitUrlAsResearchSource(text)) return text;
  const match = text.match(/(?:per|to)\s+(.+?)(?:\s+(?:e poi|poi|and then|then|metti|inserisci|configura|nel|nella|in)\b|$)/i);
  return String(match?.[1] || text)
    .replace(/\b(endpoint|url|api|rest api)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const flowPromptEndpointPathScore = (path = "", query = "") => {
  const haystack = flowPromptNormalize(path);
  const tokens = flowPromptNormalize(query).split(/\s+/).filter((token) => token.length > 2);
  let score = 0;
  if (/\/v\d+(\b|\/|:)/i.test(path)) score += 4;
  if (/(quote|ticker|price|forecast|weather|current|search|lookup|feed|latest|market|symbol|asset|crypto|stock|currency|pet|user|store)/i.test(path)) score += 4;
  if (/(test|mock|example|sandbox|admin|oauth|auth|login|logout|schema|docs?)/i.test(path)) score -= 4;
  tokens.forEach((token) => {
    if (haystack.includes(token)) score += 2;
  });
  return score;
};

const flowPromptOpenapiServers = (spec = {}, sourceUrl = "") => {
  const servers = (Array.isArray(spec.servers) ? spec.servers : [])
    .map((server) => typeof server === "string" ? server : server?.url)
    .filter(Boolean)
    .map((url) => {
      try {
        return new URL(url, sourceUrl).toString().replace(/\/+$/g, "");
      } catch (_) {
        return "";
      }
    })
    .filter((url) => /^https?:\/\//i.test(url));
  if (servers.length) return [...new Set(servers)];
  try {
    const parsed = new URL(sourceUrl);
    return [`${parsed.protocol}//${parsed.host}`];
  } catch (_) {
    return [];
  }
};

const flowPromptExtractOpenapiCandidates = ({ spec = {}, sourceUrl = "", query = "" } = {}) => {
  if (!spec || typeof spec !== "object" || (!spec.openapi && !spec.swagger) || !spec.paths || typeof spec.paths !== "object") return [];
  const server = flowPromptOpenapiServers(spec, sourceUrl)[0] || "";
  if (!server) return [];
  const candidates = [];
  Object.entries(spec.paths || {}).forEach(([path, operations]) => {
    if (!operations || typeof operations !== "object") return;
    Object.entries(operations).forEach(([method, operation]) => {
      const httpMethod = String(method || "").toUpperCase();
      if (!FLOW_PROMPT_ENDPOINT_METHODS.has(httpMethod) || !operation || typeof operation !== "object") return;
      let score = flowPromptEndpointPathScore(path, query);
      if (httpMethod === "GET") score += 2;
      if (operation.deprecated) score -= 6;
      if (score < 2) return;
      const endpoint = `${server}/${String(path).replace(/^\/+/g, "")}`;
      candidates.push(flowPromptNormalizeEndpointCandidate({
        title: operation.summary || operation.description || `${spec.info?.title || "OpenAPI"} ${path}`,
        endpoint,
        method: httpMethod,
        sourceUrl,
        reason: "Extracted in browser from explicit OpenAPI/Swagger source.",
        confidence: "openapi-path",
        sourceConfidence: "openapi-spec",
        discoveryMethod: "openapi",
        researchSource: "browser-openapi",
        apiSpec: {
          title: String(spec.info?.title || ""),
          version: String(spec.info?.version || ""),
          path,
          operationId: String(operation.operationId || ""),
          score,
        },
      }, query));
    });
  });
  return candidates
    .filter((candidate) => candidate.endpoint && candidate.validation.ok)
    .sort((a, b) => (b.apiSpec?.score || 0) - (a.apiSpec?.score || 0))
    .slice(0, 3);
};

const flowPromptCallExplicitOpenapiResearch = async ({ query = "", prompt = "" } = {}) => {
  const sourceUrl = flowPromptExtractExplicitUrl(prompt);
  if (!sourceUrl || !flowPromptUsesExplicitUrlAsResearchSource(prompt) || !/\.json(?:\?|$)|openapi|swagger/i.test(sourceUrl)) return [];
  try {
    const response = await flowPromptEndpointFetchWithTimeout(sourceUrl, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      headers: { Accept: "application/json,*/*;q=0.8" },
    }, 12000);
    if (!response.ok) return [];
    const spec = await response.json().catch(() => null);
    return flowPromptExtractOpenapiCandidates({ spec, sourceUrl, query });
  } catch (_) {
    return [];
  }
};

const flowPromptNormalizeEndpointCandidate = (candidate = {}, fallbackQuery = "") => {
  const endpoint = String(candidate.endpoint || candidate.url || candidate.href || "").trim();
  const method = String(candidate.method || "GET").trim().toUpperCase();
  const validation = flowPromptValidateEndpointCandidate({ value: endpoint, method });
  const confidence = String(candidate.confidence || candidate.score || "candidate").trim();
  return {
    id: safeRuntimeId(`${method}_${endpoint || fallbackQuery}`),
    title: String(candidate.title || candidate.name || fallbackQuery || "Endpoint candidate").trim(),
    endpoint,
    method,
    sourceUrl: String(candidate.sourceUrl || candidate.docsUrl || candidate.documentation || "").trim(),
    reason: String(candidate.reason || candidate.notes || candidate.description || "").trim(),
    confidence,
    sourceConfidence: candidate.sourceConfidence || (candidate.sourceUrl || candidate.docsUrl || candidate.documentation
      ? "source-provided"
      : confidence === "user-provided"
        ? "user-provided"
        : "ai-suggested"),
    discoveryMethod: String(candidate.discoveryMethod || candidate.discovery || "").trim(),
    apiSpec: candidate.apiSpec && typeof candidate.apiSpec === "object" ? candidate.apiSpec : null,
    verification: candidate.verification || null,
    validation,
    usable: validation.ok,
  };
};

const flowPromptEndpointFetchWithTimeout = async (url = "", options = {}, timeoutMs = 4500) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timeoutId);
  }
};

const FLOW_PROMPT_ENDPOINT_RESEARCH_HELPER = "api/endpoint-research.php";

const flowPromptLocalEndpointResearchAvailable = () =>
  /^https?:$/i.test(window.location.protocol || "");

const flowPromptCallLocalEndpointResearch = async ({ query = "", prompt = "", targetNode = null } = {}) => {
  if (!flowPromptLocalEndpointResearchAvailable()) return [];
  try {
    const response = await flowPromptEndpointFetchWithTimeout(FLOW_PROMPT_ENDPOINT_RESEARCH_HELPER, {
      method: "POST",
      mode: "same-origin",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        prompt,
        targetNode: targetNode ? {
          id: targetNode.id,
          label: targetNode.label,
          type: targetNode.type,
          subtype: targetNode.subtype,
        } : null,
      }),
    }, 28000);
    if (!response.ok) return [];
    const data = await response.json().catch(() => null);
    const rawCandidates = Array.isArray(data?.candidates) ? data.candidates : [];
    return rawCandidates
      .map((candidate) => flowPromptNormalizeEndpointCandidate({
        ...candidate,
        sourceConfidence: candidate.sourceConfidence || data?.source || "local-helper",
        confidence: candidate.confidence || "source-discovered",
        researchSource: candidate.researchSource || "local-helper",
      }, query))
      .filter((candidate) => candidate.endpoint)
      .map((candidate) => ({
        ...candidate,
        verification: candidate.verification || null,
        usable: candidate.validation.ok && candidate.verification?.status !== "blocked",
      }))
      .slice(0, 3);
  } catch (_) {
    return [];
  }
};

const flowPromptVerifyEndpointCandidate = async (candidate = {}) => {
  if (!candidate?.validation?.ok || !candidate.endpoint) {
    return {
      status: "blocked",
      ok: false,
      reason: candidate?.validation?.reason || "URL non valido.",
      checkedAt: flowPromptNow(),
    };
  }
  if (!/^https?:\/\//i.test(candidate.endpoint)) {
    return { status: "blocked", ok: false, reason: "Solo URL http/https.", checkedAt: flowPromptNow() };
  }
  const method = String(candidate.method || "GET").toUpperCase();
  const safeMethod = ["GET", "HEAD", "OPTIONS"].includes(method) ? method : "HEAD";
  try {
    let response = await flowPromptEndpointFetchWithTimeout(candidate.endpoint, {
      method: "HEAD",
      mode: "cors",
      credentials: "omit",
    });
    if (response.status === 405 || response.status === 501) {
      response = await flowPromptEndpointFetchWithTimeout(candidate.endpoint, {
        method: safeMethod === "HEAD" ? "GET" : safeMethod,
        mode: "cors",
        credentials: "omit",
      });
    }
    const contentType = response.headers?.get?.("content-type") || "";
    return {
      status: response.ok ? "verified" : "http-warning",
      ok: response.ok,
      httpStatus: response.status,
      contentType,
      method: response.url && safeMethod === "HEAD" ? "HEAD" : safeMethod,
      reason: response.ok
        ? `HTTP ${response.status}${contentType ? ` · ${contentType}` : ""}`
        : `HTTP ${response.status}`,
      checkedAt: flowPromptNow(),
    };
  } catch (error) {
    const message = String(error?.name === "AbortError" ? "timeout" : error?.message || "fetch non riuscito");
    return {
      status: "unverified",
      ok: false,
      reason: `Non verificabile dal browser (${message}).`,
      checkedAt: flowPromptNow(),
    };
  }
};

const flowPromptResearchEndpointCandidates = async ({ query = "", prompt = "", targetNode = null } = {}) => {
  const explicitUrl = flowPromptExtractExplicitUrl(prompt);
  if (explicitUrl && !flowPromptUsesExplicitUrlAsResearchSource(prompt)) {
    const candidate = flowPromptNormalizeEndpointCandidate({
      title: query || "URL indicato dall'utente",
      endpoint: explicitUrl,
      method: targetNode?.metadata?.config?.method || "GET",
      reason: "URL fornito esplicitamente nel prompt.",
      confidence: "user-provided",
    }, query);
    candidate.verification = await flowPromptVerifyEndpointCandidate(candidate);
    candidate.usable = candidate.validation.ok && candidate.verification.status !== "blocked";
    return [candidate];
  }
  const localCandidates = await flowPromptCallLocalEndpointResearch({ query, prompt, targetNode });
  if (localCandidates.length) return localCandidates;
  const explicitOpenapiCandidates = await flowPromptCallExplicitOpenapiResearch({ query, prompt });
  if (explicitOpenapiCandidates.length) return explicitOpenapiCandidates;
  const aiSettings = await flowPromptReadAiSettings();
  const provider = await flowPromptPickProvider(aiSettings);
  if (!provider) return [];
  const researchPrompt = [
    "You are helping configure a generic Trackers Lens REST API node.",
    "Return JSON only. Do not include markdown.",
    "Find up to 3 public API endpoint candidates for the user's goal.",
    "Do not invent local placeholders. If unsure, return {\"candidates\":[]}.",
    "Each candidate must include: title, endpoint, method, sourceUrl, reason, confidence.",
    "The endpoint must be directly usable as a URL template or concrete URL and must start with http:// or https://.",
    "Never return an OpenAPI/Swagger spec URL, docs page, JSON schema URL, YAML URL, or documentation asset as endpoint. Put those only in sourceUrl.",
    "If the API needs a key or path parameters, keep placeholders only when they are part of documented URL templates and explain it in reason.",
    `goal: ${query || prompt}`,
    `targetNode: ${targetNode?.label || targetNode?.id || "REST API"}`,
  ].join("\n");
  try {
    const kind = flowPromptProviderKey(provider.provider || provider.name || provider.id);
    const model = aiSettings.model || provider.model;
    const ai = kind.includes("ollama")
      ? await flowPromptCallOllama({ provider, model, prompt: researchPrompt })
      : await flowPromptCallOpenAiCompatible({ provider, model, prompt: researchPrompt, aiSettings });
    const parsed = flowPromptFirstJsonObject(ai.text);
    const rawCandidates = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.candidates)
        ? parsed.candidates
        : parsed?.endpoint || parsed?.url
          ? [parsed]
          : [];
    const candidates = rawCandidates
      .map((candidate) => flowPromptNormalizeEndpointCandidate({
        ...candidate,
        sourceConfidence: candidate.sourceConfidence || "ai-fallback",
        discoveryMethod: candidate.discoveryMethod || "ai-fallback",
        researchSource: "ai-fallback",
      }, query))
      .filter((candidate) => candidate.endpoint && candidate.validation.ok)
      .slice(0, 3);
    for (const candidate of candidates) {
      candidate.verification = await flowPromptVerifyEndpointCandidate(candidate);
      candidate.usable = candidate.validation.ok && candidate.verification.status !== "blocked";
    }
    return candidates;
  } catch (_) {
    return [];
  }
};

const flowPromptEnrichEndpointResearchPlan = async (plan = null, prompt = "") => {
  if (!plan) return plan;
  const actions = flowPromptFlattenActionPlan(plan);
  const researchActions = actions.filter((action) => action?.type === "researchEndpoint");
  if (!researchActions.length) return plan;
  for (const action of researchActions) {
    const candidates = await flowPromptResearchEndpointCandidates({
      query: action.query || flowPromptEndpointResearchQuery(prompt),
      prompt,
      targetNode: action.node,
    });
    action.status = "ready";
    action.candidates = candidates;
    const verified = candidates.filter((candidate) => candidate.verification?.status === "verified").length;
    action.summary = candidates.length
      ? `Ho trovato ${candidates.length} candidato/i endpoint per "${action.query || "la richiesta"}"${verified ? `, ${verified} verificato/i` : ""}. Scegline uno per preparare l'Apply.`
      : `Non ho trovato candidati endpoint utilizzabili per "${action.query || "la richiesta"}".`;
    action.detail = candidates.length
      ? "Il tool non scrive nel grafo: il candidato scelto passa prima da validazione URL e conferma utente."
      : "Puoi inserire un URL esplicito nel prompt per procedere con la validazione.";
  }
  if (plan.type === "batch") {
    plan.status = flowPromptPlanStatus(plan.actions || []);
    plan.tools = flowPromptPlanTools(plan);
    const usable = researchActions.flatMap((action) => action.candidates || []).filter((candidate) => candidate.usable);
    plan.summary = usable.length
      ? `Ho trovato ${usable.length} endpoint candidati. Scegli un URL da validare prima di inserirlo nel nodo.`
      : plan.summary;
  }
  return flowPromptAnnotateActionPlan(plan);
};

const flowPromptExtractConfigChange = (prompt = "") => {
  const text = String(prompt || "").trim();
  const explicitUrl = flowPromptExtractExplicitUrl(prompt);
  const endpointLookup = flowPromptLooksLikeEndpointLookup(prompt) && (!explicitUrl || flowPromptUsesExplicitUrlAsResearchSource(prompt));
  if (explicitUrl || endpointLookup) {
    const targetMatch = text.match(/\b(?:in|nel|nella|sul|su|al|alla)\s+(.+?)(?:\s+(?:al|alla|nel|nella|sul|su)\s+(?:url|endpoint))?\s*$/i);
    const nodeHint = String(targetMatch?.[1] || "REST API")
      .replace(/\b(al|alla|nel|nella|sul|su)\s+(url|endpoint)\b/gi, "")
      .trim();
    return {
      field: { field: "endpoint", target: "config" },
      value: explicitUrl,
      nodeHint: nodeHint || "REST API",
      requiresEndpointLookup: endpointLookup,
    };
  }
  const valueMatch = text.match(/\s(?:in|a|to|su|come|con|=)\s+(['"]?)([^\n]+?)\1\s*$/i);
  const value = String(valueMatch?.[2] || "").trim();
  const beforeValue = valueMatch ? text.slice(0, valueMatch.index).trim() : text;
  const nodeMatch = beforeValue.match(/\s(?:di|del|della|dello|dell'|for|nel|nella|sul|su)\s+(.+)$/i);
  const field = flowPromptParseConfigField(prompt);
  const fallbackHint = beforeValue
    .replace(/^(cambia|imposta|set|aggiorna|modifica)\s+/i, "")
    .replace(/\b(il|la|lo|un|una|nodo|node|provider|url|endpoint|method|metodo|modello|model|chatid|chat id|canale|channel|output|input)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const nodeHint = String(nodeMatch?.[1] || fallbackHint)
    .replace(/^(il|la|lo|un|una|nodo|node)\s+/i, "")
    .trim();
  return { field, value, nodeHint, requiresEndpointLookup: false };
};

const flowPromptBuildConfigPlan = (context = {}, prompt = "") => {
  const { field, value, nodeHint, requiresEndpointLookup } = flowPromptExtractConfigChange(prompt);
  const node = flowPromptFindNodeByText(context, nodeHint);
  if (requiresEndpointLookup) {
    const researchQuery = flowPromptEndpointResearchQuery(prompt);
    if (!node?.id) {
      return flowPromptBatchPlan([
        flowPromptBlockedChoice({
          type: "updateNodeConfig",
          summary: "Nodo REST API non chiaro.",
          sourceHint: nodeHint,
          value,
          context,
          promptBuilder: ({ source: pickedNode }) =>
            `imposta endpoint di ${pickedNode?.label || nodeHint}`,
        }),
      ], "Piano agente bloccato: scegli prima il nodo REST API, poi il tool di ricerca endpoint potra completare il valore.");
    }
    return flowPromptBatchPlan([
      {
        type: "researchEndpoint",
        tool: "researchEndpoint",
        status: "ready",
        query: researchQuery,
        targetField: field.field,
        targetNodeId: node.id,
        node,
        summary: `Cerca un endpoint affidabile per "${researchQuery || "la richiesta"}".`,
        detail: "Il tool suggerisce candidati ma non scrive nel grafo.",
      },
      {
        type: "updateNodeConfig",
        tool: "updateNodeConfig",
        status: "blocked",
        node,
        nodeId: node.id,
        field: field.field,
        target: field.target,
        value: "",
        dependsOn: "researchEndpoint",
        summary: `Dopo la ricerca, inserisci l'endpoint trovato nel campo URL di ${node.label}.`,
      },
    ], `Piano agente: 1) cercare endpoint per "${researchQuery || "la richiesta"}"; 2) scegliere un URL candidato; 3) validarlo e inserirlo in ${node.label}.`);
  }
  if (!node?.id || !value) {
    return flowPromptBatchPlan([
      flowPromptBlockedChoice({
        type: "updateNodeConfig",
        summary: "Nodo o valore non chiaro.",
        sourceHint: nodeHint,
        value,
        context,
        promptBuilder: ({ source: pickedNode, value: pickedValue }) =>
          `imposta ${field.field} di ${pickedNode?.label || nodeHint} a ${pickedValue || value}`,
      }),
    ], "Non posso aggiornare config: nodo o valore non chiaro.");
  }
  const endpointValidation = field.field === "endpoint"
    ? flowPromptValidateEndpointCandidate({
      value,
      method: node?.metadata?.config?.method || "GET",
    })
    : null;
  if (field.field === "endpoint" && !endpointValidation.ok) {
    return flowPromptBatchPlan([
      {
        type: "updateNodeConfig",
        tool: "updateNodeConfig",
        status: "blocked",
        node,
        nodeId: node.id,
        field: field.field,
        target: field.target,
        value,
        validation: endpointValidation,
        summary: `Non salvo endpoint in ${node.label}: ${endpointValidation.reason}`,
      },
    ], endpointValidation.reason);
  }
  return flowPromptBatchPlan([
    {
      type: "updateNodeConfig",
      tool: "updateNodeConfig",
      status: "ready",
      node,
      nodeId: node.id,
      field: field.field,
      target: field.target,
      value,
      validation: endpointValidation,
      summary: `Imposto ${field.field} di ${node.label} a ${value}.`,
    },
  ], `Posso aggiornare ${node.label}: ${field.field} = ${value}.`);
};

const flowPromptBuildEndpointResearchPlan = (context = {}, prompt = "") => {
  const researchQuery = flowPromptEndpointResearchQuery(prompt);
  const node = flowPromptFindNodeByText(context, "REST API")
    || (context.nodes || []).find((item) => flowPromptNormalize(item.subtype || item.type || "").includes("rest"));
  return flowPromptBatchPlan([
    {
      type: "researchEndpoint",
      tool: "researchEndpoint",
      status: "ready",
      query: researchQuery,
      targetField: "endpoint",
      targetNodeId: node?.id || "",
      node: node || null,
      summary: `Cerca endpoint affidabili per "${researchQuery || "la richiesta"}".`,
      detail: "Il tool legge documentazione/spec e propone candidati senza scrivere nel grafo.",
    },
  ], `Piano agente: cercare endpoint per "${researchQuery || "la richiesta"}" senza modificare config.`);
};

const flowPromptBuildSingleActionPlan = (context = {}, prompt = "") => {
  if (flowPromptUsesExplicitUrlAsResearchSource(prompt)) return flowPromptBuildEndpointResearchPlan(context, prompt);
  const intent = flowPromptAgentIntent(prompt);
  if (intent === "deleteNode") return flowPromptBuildDeleteNodePlan(context, prompt);
  if (intent === "duplicateNode") return flowPromptBuildDuplicateNodePlan(context, prompt);
  if (intent === "moveNode") return flowPromptBuildMoveNodePlan(context, prompt);
  if (intent === "disconnect") return flowPromptBuildDisconnectPlan(context, prompt);
  if (intent === "connect") return flowPromptBuildConnectPlan(context, prompt);
  if (intent === "fixRuntimeError") return flowPromptBuildRuntimeErrorFixPlan(context, prompt);
  if (intent === "fix") return flowPromptBuildFixPlan(context, prompt);
  if (intent === "rename") return flowPromptBuildRenamePlan(context, prompt);
  if (intent === "config") return flowPromptBuildConfigPlan(context, prompt);
  return null;
};

const flowPromptBuildActionPlan = (context = {}, prompt = "") => {
  const parts = flowPromptSplitCompoundCommands(prompt);
  if (parts.length > 1) {
    const planningContext = flowPromptCloneAgentContext(context);
    const actions = [];
    parts.forEach((part, index) => {
      const plan = flowPromptBuildSingleActionPlan(planningContext, part);
      const stepActions = flowPromptFlattenActionPlan(plan)
        .map((action, actionIndex) => ({
          ...action,
          stepId: action.stepId || `step_${String(index + 1).padStart(2, "0")}${actionIndex ? `_${actionIndex + 1}` : ""}`,
          dependsOn: action.dependsOn || (index > 0 ? [`step_${String(index).padStart(2, "0")}`] : []),
          compoundIndex: index + 1,
          compoundPrompt: part,
        }));
      stepActions.forEach((action) => {
        actions.push(action);
        flowPromptApplyActionToPlanningContext(planningContext, action);
      });
    });
    if (!actions.length) return null;
    const ready = actions.filter((action) => action.status === "ready").length;
    const blocked = actions.filter((action) => action.status === "blocked").length;
    const duplicate = actions.filter((action) => action.status === "duplicate").length;
    return flowPromptBatchPlan(
      actions,
      `Piano compound: ${actions.length} azioni in ${parts.length} step: ${ready} pronte, ${duplicate} gia presenti, ${blocked} bloccate.`
    );
  }
  return flowPromptBuildSingleActionPlan(context, prompt);
};

const flowPromptBuildActionPlanFromNormalized = (context = {}, command = {}) => {
  const normalizedSteps = Array.isArray(command.steps) ? command.steps : null;
  const normalizedActions = Array.isArray(command.actions) ? command.actions : normalizedSteps;
  if (Array.isArray(normalizedActions)) {
    const planningContext = flowPromptCloneAgentContext(context);
    const plans = [];
    normalizedActions.forEach((item, index) => {
        const rawAction = item?.action && typeof item.action === "object" ? item.action : item;
        const plan = flowPromptBuildActionPlanFromNormalized(planningContext, {
          ...(rawAction || {}),
          dependsOn: item?.dependsOn || rawAction?.dependsOn || "",
        });
        const withMeta = flowPromptActionPlanWithStepMeta(plan, {
          stepId: item?.id || rawAction?.id || `step_${String(index + 1).padStart(2, "0")}`,
          dependsOn: item?.dependsOn || rawAction?.dependsOn || "",
        });
        flowPromptFlattenActionPlan(withMeta).forEach((action) => {
          action.compoundIndex = index + 1;
          flowPromptApplyActionToPlanningContext(planningContext, action);
        });
        if (withMeta) plans.push(withMeta);
      });
    const actions = plans.flatMap(flowPromptFlattenActionPlan);
    return actions.length ? flowPromptBatchPlan(actions, `AI normalize ha preparato ${actions.length} azioni.`) : null;
  }
  const action = flowPromptNormalize(command.action || command.intent || "");
  if (action === "rename" || action === "renamenode") {
    const node = flowPromptFindNodeByText(context, command.node || command.nodeLabel || command.source || "");
    const nextLabel = String(command.nextLabel || command.label || command.value || "").trim();
    if (!node?.id || !nextLabel) {
      const nodeHint = command.node || command.nodeLabel || command.source || "";
      return flowPromptBatchPlan([
        flowPromptBlockedChoice({
          type: "renameNode",
          summary: "AI normalize: nodo o nome non chiaro.",
          sourceHint: nodeHint,
          value: nextLabel,
          context,
          promptBuilder: ({ source: pickedNode, value }) =>
            `rinomina ${pickedNode?.label || nodeHint} in ${value || nextLabel}`,
        }),
      ], "Non posso rinominare: nodo o nuovo nome non chiaro.");
    }
    return flowPromptBatchPlan([{
      type: "renameNode",
      tool: "renameNode",
      status: "ready",
      node,
      nodeId: node.id,
      previousLabel: node.label,
      nextLabel,
      summary: `Rinomino ${node.label} in ${nextLabel}.`,
    }], `Posso rinominare ${node.label} in ${nextLabel}.`);
  }

  if (action === "connect" || action === "link") {
    const sourceHint = command.source || command.sourceNode || "";
    const targetHint = command.target || command.targetNode || "";
    const source = flowPromptFindNodeByText(context, sourceHint);
    const target = flowPromptFindNodeByText(context, targetHint);
    if (!source?.id || !target?.id) {
      return flowPromptBatchPlan([
        flowPromptBlockedChoice({
          type: "connect",
          summary: "AI normalize: source o target non chiaro.",
          sourceHint,
          targetHint,
          context,
          promptBuilder: ({ source: pickedSource, target: pickedTarget }) =>
            `collega ${pickedSource?.label || sourceHint} a ${pickedTarget?.label || targetHint}`,
        }),
      ], "Non posso collegare: source o target non chiaro.");
    }
    return flowPromptBuildConnectPlan(context, `collega ${source.label} a ${target.label}`);
  }

  if (action === "deletenode" || action === "delete" || action === "remove" || action === "removenode") {
    const nodeHint = command.node || command.nodeLabel || command.target || command.source || "";
    const node = flowPromptFindNodeByText(context, nodeHint);
    if (!node?.id) {
      return flowPromptBatchPlan([
        flowPromptBlockedChoice({
          type: "deleteNode",
          tool: "deleteNode",
          summary: "AI normalize: nodo da eliminare non chiaro.",
          sourceHint: nodeHint,
          context,
          promptBuilder: ({ source: pickedNode }) =>
            `elimina nodo ${pickedNode?.label || nodeHint}`,
        }),
      ], "Non posso eliminare: nodo non chiaro.");
    }
    return flowPromptBuildDeleteNodePlan(context, `elimina nodo ${node.label}`);
  }

  if (action === "duplicatenode" || action === "duplicate" || action === "clone" || action === "copy") {
    const nodeHint = command.node || command.nodeLabel || command.target || command.source || "";
    const node = flowPromptFindNodeByText(context, nodeHint);
    const nextLabel = String(command.nextLabel || command.label || command.value || "").trim();
    if (!node?.id) {
      return flowPromptBatchPlan([
        flowPromptBlockedChoice({
          type: "duplicateNode",
          tool: "duplicateNode",
          summary: "AI normalize: nodo da duplicare non chiaro.",
          sourceHint: nodeHint,
          context,
          promptBuilder: ({ source: pickedNode }) =>
            `duplica nodo ${pickedNode?.label || nodeHint}`,
        }),
      ], "Non posso duplicare: nodo non chiaro.");
    }
    return flowPromptBuildDuplicateNodePlan(context, `duplica nodo ${node.label}${nextLabel ? ` come ${nextLabel}` : ""}`);
  }

  if (action === "movenode" || action === "move") {
    const nodeHint = command.node || command.nodeLabel || command.target || command.source || "";
    const node = flowPromptFindNodeByText(context, nodeHint);
    const direction = String(command.direction || command.value || "").trim();
    if (!node?.id) {
      return flowPromptBatchPlan([
        flowPromptBlockedChoice({
          type: "moveNode",
          tool: "moveNode",
          summary: "AI normalize: nodo da spostare non chiaro.",
          sourceHint: nodeHint,
          context,
          promptBuilder: ({ source: pickedNode }) =>
            `sposta nodo ${pickedNode?.label || nodeHint}${direction ? ` a ${direction}` : ""}`,
        }),
      ], "Non posso spostare: nodo non chiaro.");
    }
    return flowPromptBuildMoveNodePlan(context, `sposta nodo ${node.label}${direction ? ` a ${direction}` : ""}`);
  }

  if (action === "disconnect" || action === "unlink" || action === "removeconnection") {
    const sourceHint = command.source || command.sourceNode || "";
    const targetHint = command.target || command.targetNode || "";
    const source = flowPromptFindNodeByText(context, sourceHint);
    const target = flowPromptFindNodeByText(context, targetHint);
    if (!source?.id || !target?.id) {
      return flowPromptBatchPlan([
        flowPromptBlockedChoice({
          type: "deleteDependencies",
          summary: "AI normalize: source o target non chiaro.",
          sourceHint,
          targetHint,
          context,
          promptBuilder: ({ source: pickedSource, target: pickedTarget }) =>
            `scollega ${pickedSource?.label || sourceHint} da ${pickedTarget?.label || targetHint}`,
        }),
      ], "Non posso scollegare: source o target non chiaro.");
    }
    return flowPromptBuildDisconnectPlan(context, `scollega ${source.label} da ${target.label}`);
  }

  if (action === "setconfig" || action === "config" || action === "updateconfig" || action === "setchannel") {
    const nodeHint = command.node || command.nodeLabel || command.source || "";
    const node = flowPromptFindNodeByText(context, nodeHint);
    const field = flowPromptNormalizeConfigFieldName(command.field || command.key || "config");
    const value = String(command.value || command.nextValue || "").trim();
    const target = ["output", "input", "channel"].includes(flowPromptNormalize(command.target || field))
      ? flowPromptNormalize(command.target || field)
      : "config";
    if (!node?.id || !value) {
      return flowPromptBatchPlan([
        flowPromptBlockedChoice({
          type: "updateNodeConfig",
          summary: "AI normalize: nodo o valore non chiaro.",
          sourceHint: nodeHint,
          value,
          context,
          promptBuilder: ({ source: pickedNode, value: pickedValue }) =>
            `imposta ${field} di ${pickedNode?.label || nodeHint} a ${pickedValue || value}`,
        }),
      ], "Non posso aggiornare config: nodo o valore non chiaro.");
    }
    const endpointValidation = target === "config" && field === "endpoint"
      ? flowPromptValidateEndpointCandidate({
        value,
        method: node?.metadata?.config?.method || command.method || "GET",
      })
      : null;
    if (target === "config" && field === "endpoint" && !endpointValidation.ok) {
      return flowPromptBatchPlan([{
        type: "updateNodeConfig",
        tool: "updateNodeConfig",
        status: "blocked",
        node,
        nodeId: node.id,
        field,
        target,
        value,
        validation: endpointValidation,
        summary: `AI normalize ha proposto un endpoint non valido per ${node.label}: ${endpointValidation.reason}`,
      }], endpointValidation.reason);
    }
    return flowPromptBatchPlan([{
      type: "updateNodeConfig",
      tool: "updateNodeConfig",
      status: "ready",
      node,
      nodeId: node.id,
      field,
      target,
      value,
      validation: endpointValidation,
      summary: `Imposto ${field} di ${node.label} a ${value}.`,
    }], `Posso aggiornare ${node.label}: ${field} = ${value}.`);
  }

  if (action === "fix" || action === "repair") return flowPromptBuildFixPlan(context);
  return null;
};

const flowPromptNormalizeCommandWithAi = async (context = {}, prompt = "", memory = []) => {
  const aiSettings = await flowPromptReadAiSettings();
  const provider = await flowPromptPickProvider(aiSettings);
  if (!provider) return null;
  const nodeContext = (context.nodes || []).map((node) => ({
    id: node.id,
    label: node.label,
    aliases: flowPromptNodeAliases(node),
    type: node.type,
    subtype: node.subtype,
    category: node.category,
    inputs: node.inputs,
    outputs: node.outputs,
    channels: node.channels,
  }));
  const normalizerPrompt = [
    "Normalize the user's Flow Map command into JSON only.",
    "Allowed actions: rename, connect, disconnect, deleteNode, duplicateNode, moveNode, setConfig, setChannel, fix.",
    "Available tools:",
    JSON.stringify(flowPromptAgentToolManifest()),
    "Schema examples:",
    "{\"action\":\"rename\",\"node\":\"Telegram 2\",\"nextLabel\":\"Telegram Vuoto\"}",
    "{\"action\":\"deleteNode\",\"node\":\"Telegram Message\"}",
    "{\"action\":\"duplicateNode\",\"node\":\"REST API\",\"nextLabel\":\"REST API Copy\"}",
    "{\"action\":\"moveNode\",\"node\":\"Preview\",\"direction\":\"right\"}",
    "{\"action\":\"connect\",\"source\":\"Telegram Message\",\"target\":\"Preview\"}",
    "{\"action\":\"disconnect\",\"source\":\"Telegram Message\",\"target\":\"Preview\"}",
    "{\"action\":\"setConfig\",\"node\":\"AI Analyzer\",\"field\":\"model\",\"value\":\"llama3.1\"}",
    "{\"action\":\"setConfig\",\"node\":\"REST API\",\"field\":\"method\",\"value\":\"POST\"}",
    "{\"action\":\"setChannel\",\"node\":\"Telegram Message\",\"target\":\"output\",\"field\":\"output\",\"value\":\"action.telegram\"}",
    "{\"actions\":[{\"action\":\"rename\",\"node\":\"Telegram 2\",\"nextLabel\":\"Telegram OK\"},{\"action\":\"connect\",\"source\":\"Telegram OK\",\"target\":\"Preview\"}]}",
    "{\"steps\":[{\"id\":\"step_1\",\"action\":{\"action\":\"rename\",\"node\":\"Telegram 2\",\"nextLabel\":\"Telegram OK\"}},{\"id\":\"step_2\",\"dependsOn\":[\"step_1\"],\"action\":{\"action\":\"connect\",\"source\":\"Telegram OK\",\"target\":\"Preview\"}}]}",
    "{\"action\":\"fix\"}",
    "Rules:",
    "- Use only labels or ids that best match existingNodes.",
    "- Treat memory aliases as confirmed previous/current labels for existing nodes.",
    "- Do not invent nodes.",
    "- Return only one JSON object. For multi-step commands, return {\"actions\":[...]} or {\"steps\":[...]} in execution order.",
    `existingNodes: ${JSON.stringify(nodeContext)}`,
    `confirmedMemory: ${JSON.stringify((memory || []).slice(0, 6))}`,
    `userCommand: ${prompt}`,
  ].join("\n");
  const model = aiSettings.model || provider.model;
  const kind = flowPromptProviderKey(provider.provider || provider.name || provider.id);
  try {
    const ai = kind.includes("ollama")
      ? await flowPromptCallOllama({ provider, model, prompt: normalizerPrompt })
      : await flowPromptCallOpenAiCompatible({ provider, model, prompt: normalizerPrompt, aiSettings });
    return flowPromptFirstJsonObject(ai.text) || null;
  } catch (_) {
    return null;
  }
};

const flowPromptBuildActionPlanWithAiNormalize = async (context = {}, prompt = "", debug = {}, memory = []) => {
  const localPlan = flowPromptFinalizeDependencyAwarePlan(context, flowPromptBuildActionPlan(context, prompt), prompt);
  debug.localPlan = flowPromptDebugPlan(localPlan);
  if (localPlan && localPlan.status !== "blocked") {
    debug.selectedPlan = "local";
    return localPlan;
  }
  if (flowPromptAgentIntent(prompt) === "fixRuntimeError") {
    debug.selectedPlan = localPlan ? "local" : "none";
    debug.reason = "Runtime error fixes must keep the local diagnosis plan even when blocked.";
    return localPlan;
  }
  if (flowPromptLooksLikeEndpointLookup(prompt) && (!flowPromptExtractExplicitUrl(prompt) || flowPromptUsesExplicitUrlAsResearchSource(prompt))) {
    debug.selectedPlan = localPlan ? "local" : "none";
    debug.reason = "Endpoint lookup must not be converted into an Apply plan before a candidate is selected.";
    return localPlan;
  }
  if (!flowPromptIsMutationRequest(prompt) && flowPromptAgentIntent(prompt) !== "connect") {
    debug.selectedPlan = localPlan ? "local" : "none";
    return localPlan;
  }
  const normalized = await flowPromptNormalizeCommandWithAi(context, prompt, memory);
  debug.normalizedCommand = normalized || null;
  const aiPlan = normalized
    ? flowPromptFinalizeDependencyAwarePlan(context, flowPromptBuildActionPlanFromNormalized(context, normalized), prompt)
    : null;
  debug.aiPlan = flowPromptDebugPlan(aiPlan);
  if (aiPlan?.status === "blocked" && localPlan && flowPromptPlanHasChoices(localPlan) && !flowPromptPlanHasChoices(aiPlan)) {
    debug.selectedPlan = "local";
    debug.reason = "AI normalizer returned a generic blocked plan without useful choices.";
    return localPlan;
  }
  debug.selectedPlan = aiPlan ? "ai-normalized" : localPlan ? "local" : "none";
  return aiPlan || localPlan;
};

const flowPromptRunMemoryRecallTests = async () => {
  const baseContext = {
    workspaceId: currentWorkspaceId() || "workspace_test",
    nodes: [
      { id: "node_rest", label: "Weather API", type: "rest", subtype: "rest", category: "sources", outputs: ["raw"], aliases: [] },
      { id: "node_rest_copy", label: "REST API Copy", type: "rest", subtype: "rest", category: "sources", outputs: ["raw"], aliases: [] },
      { id: "node_preview", label: "Preview", type: "preview", subtype: "preview", category: "dev", inputs: ["raw"], aliases: [] },
    ],
    edges: [],
    channels: [],
    events: [],
    flowLogs: [],
  };
  const memory = [
    {
      id: "test_alias_rename",
      kind: "node-alias",
      name: "Alias nodo Weather API",
      text: "REST API ora si chiama Weather API.",
      meta: JSON.stringify({
        kind: "node-alias",
        nodeId: "node_rest",
        previousLabel: "REST API",
        nextLabel: "Weather API",
        aliases: ["REST API", "Weather API"],
      }),
    },
    {
      id: "test_alias_duplicate",
      kind: "node-alias",
      name: "Alias nodo REST 2",
      text: "REST 2 e un duplicato confermato di REST API.",
      meta: JSON.stringify({
        kind: "node-alias",
        nodeId: "node_rest_copy",
        previousLabel: "REST API",
        nextLabel: "REST 2",
        aliases: ["REST 2"],
        sourceNodeId: "node_rest",
      }),
    },
  ];
  const context = flowPromptContextWithMemory(baseContext, memory);
  const renamePlan = flowPromptBuildConnectPlan(context, "collega REST API a Preview");
  const duplicatePlan = flowPromptBuildConnectPlan(context, "collega REST 2 a Preview");
  const preference = flowPromptExtractPreferenceMemory("ricordati che preferisco endpoint HTTPS validati");
  const tests = [
    {
      name: "rename alias recall",
      ok: renamePlan?.status === "ready" && renamePlan.source?.id === "node_rest" && renamePlan.target?.id === "node_preview",
      plan: renamePlan,
    },
    {
      name: "duplicate alias recall",
      ok: duplicatePlan?.status === "ready" && duplicatePlan.source?.id === "node_rest_copy" && duplicatePlan.target?.id === "node_preview",
      plan: duplicatePlan,
    },
    {
      name: "explicit preference parser",
      ok: preference?.kind === "user-preference" && /endpoint HTTPS/i.test(preference.text),
      preference,
    },
  ];
  return {
    ok: tests.every((test) => test.ok),
    tests,
    memoryCount: memory.length,
  };
};

const flowPromptRunRuntimeErrorMemoryTests = async () => {
  const context = {
    workspaceId: currentWorkspaceId() || "workspace_test",
    nodes: [
      { id: "node_rest", label: "REST API", type: "rest", subtype: "rest", category: "sources", outputs: ["raw"] },
    ],
    events: [],
    flowLogs: [],
  };
  const record = {
    id: "flow_log_error_1",
    level: "error",
    action: "live-rest-test",
    message: "Failed to fetch",
    createdAt: "2026-06-12T08:00:00.000Z",
    context: {
      nodeId: "node_rest",
      endpoint: "https://api.example.invalid/ticker",
      method: "GET",
      errorKind: "network-or-cors",
      status: "",
    },
  };
  const insight = flowPromptRuntimeErrorDiagnosis(context, record);
  const provenance = flowPromptRuntimeErrorProvenance(context, record, insight);
  const tests = [
    {
      name: "diagnosis resolves node",
      ok: insight.nodeId === "node_rest" && insight.nodeLabel === "REST API",
      insight,
    },
    {
      name: "provenance has cause and fix hint",
      ok: provenance.kind === "runtime-error-diagnosis"
        && provenance.recordId === "flow_log_error_1"
        && provenance.fixHint === "inspect-node-and-retry"
        && Boolean(provenance.cause)
        && Boolean(provenance.suggestion),
      provenance,
    },
  ];
  return {
    ok: tests.every((test) => test.ok),
    tests,
  };
};

const flowPromptRunFlowChatHardeningTests = async () => {
  const plan = {
    summary: "Flow professionale agentico",
    planner: { mode: "ai", selfRepair: { attempts: 2 } },
    nodes: [
      { label: "Task Node" },
      { label: "Orchestrator Agent" },
      { label: "Preview", action: "reuse" },
    ],
    edges: [
      { sourceLabel: "Task Node", targetLabel: "Orchestrator Agent" },
      { sourceLabel: "Orchestrator Agent", targetLabel: "Preview" },
    ],
    preflight: { ok: true, warnings: [], blockers: [], summary: "Pronto" },
    conversationContext: { active: true, referencesPrevious: true, lastPlan: { nodes: ["Task Node"] }, constraints: ["avoid Split"] },
  };
  const pattern = {
    name: "Agent pattern",
    text: "Task -> Orchestrator -> Preview",
    prompt: "crea flow agentico",
    nodes: ["Task Node", "Orchestrator Agent", "Preview"],
    edges: ["Task Node -> Orchestrator Agent", "Orchestrator Agent -> Preview"],
    planner: { mode: "ai" },
    updatedAt: flowPromptNow(),
    uses: 3,
  };
  const brainPrompt = flowPromptBuildBrainPrompt({
    prompt: "diagnostica il flow",
    palette: [],
    selectedRuntime: {
      agentRuntime: { available: true, tools: ["inspectFlow", "suggestFixes"], fixes: [] },
      providerHealth: { summary: "1/1 provider ready" },
    },
    rag: [],
  });
  const completion = flowPromptBuildCompletionSummary(
    { summary: plan.summary },
    {
      savedNodes: [{ label: "Task Node" }, { label: "Orchestrator Agent" }],
      reusedNodes: [{ label: "Preview" }],
      createdEdges: [{}, {}],
      reusedEdges: [],
      warnings: [],
    },
    { edges: plan.edges }
  );
  const workLead = flowPromptBuildWorkLeadSummary(plan);
  const tests = [
    {
      name: "short apply intent",
      ok: flowPromptLastPlanActionIntent("crealo") === "apply" && flowPromptLastPlanActionIntent("usa questo piano") === "prepare",
    },
    {
      name: "pattern quality",
      ok: flowPromptPatternQuality(pattern).label === "alta" && flowPromptPatternQuality(pattern).frequency === 3,
      quality: flowPromptPatternQuality(pattern),
    },
    {
      name: "explain-only does not plan",
      ok: flowPromptIsExplainOnlyRequest("mi spieghi Agent Bridge in 3 punti")
        && !flowPromptShouldPlanFromPrompt("mi spieghi Agent Bridge in 3 punti", { lastPlan: plan, referencesPrevious: true }),
    },
    {
      name: "simple Flow Map definition stays local",
      ok: flowPromptIsSimpleDefinitionQuestion("cosa è il Flow Map?")
        && !flowPromptShouldUseBrain("explain", "cosa è il Flow Map?")
        && flowPromptLocalDefinitionAnswer("cosa è il Flow Map?").includes("grafo runtime"),
    },
    {
      name: "agent runtime RAG doc registered",
      ok: FLOW_PROMPT_BRAIN_DOCS.some((doc) => doc.id === "doc-agent-runtime"),
    },
    {
      name: "brain prompt includes runtime tools",
      ok: brainPrompt.includes("inspectFlow/suggestFixes/runFlow") && brainPrompt.includes("Provider health"),
    },
    {
      name: "work lead summary",
      ok: workLead.verification === "preflight valido" && /Crea flow/i.test(workLead.next),
      workLead,
    },
    {
      name: "completion summary",
      ok: completion.status === "Obiettivo raggiunto" && completion.details.length >= 3 && completion.links.length === 2,
      completion,
    },
  ];
  return {
    ok: tests.every((test) => test.ok),
    tests,
  };
};

const flowPromptBuildAgentReport = async (prompt = "", options = {}) => {
  const effectivePrompt = String(options.promptForBrain || prompt || "").trim();
  const conversationContext = options.conversationContext || null;
  const memory = await flowPromptReadWorkspaceMemory(effectivePrompt || prompt);
  const patternMemory = await flowPromptReadPatternMemories(effectivePrompt || prompt);
  const context = flowPromptContextWithMemory(await flowPromptAgentContext(), memory);
  const diagnostics = flowPromptDiagnoseContext(context);
  const intent = flowPromptAgentIntent(prompt);
  const compactNatural = flowPromptIsSimpleDefinitionQuestion(prompt);
  const query = flowPromptAgentQuery(context, prompt);
  const queryInsights = flowPromptRuntimeQueryInsights(context, query);
  const queryModel = await flowPromptBuildRuntimeQueryModel({ context, prompt: effectivePrompt || prompt, query, memory });
  const architectureAdvice = intent === "advice" ? flowPromptBuildArchitectureAdvice(context, prompt) : null;
  const brainContext = flowPromptShouldUseBrain(intent, prompt)
    ? await flowPromptBuildBrainContext({
      context,
      prompt: effectivePrompt || prompt,
      routePrompt: prompt,
      intent,
      queryModel,
      memory,
      approvedPatterns: patternMemory.approvedPatterns || [],
      rejectedPatterns: patternMemory.rejectedPatterns || [],
      memoryGuard: patternMemory.memoryGuard,
      conversationContext,
      architectureAdvice,
    })
    : null;
  const brain = brainContext
    ? await flowPromptCallBrainWithAi(brainContext, intent === "advice" ? "advice" : "query")
    : null;
  const wantsRuntimeErrors = intent === "runtime" && flowPromptNormalize(query.filter) === "error";
  if (wantsRuntimeErrors && queryModel.runtime?.errors?.length) {
    const firstError = queryModel.runtime.errors[0];
    const firstInsight = queryModel.runtime.errorInsights?.[0] || flowPromptRuntimeErrorDiagnosis(context, firstError);
    const savedDiagnosis = await flowPromptRememberRuntimeErrorDiagnosis({
      prompt,
      context,
      record: firstError,
      insight: firstInsight,
    });
    if (!savedDiagnosis) {
      await flowPromptRememberWorkspaceEvent({
        kind: "runtime-error",
        prompt,
        summary: [
          firstInsight.nodeLabel ? `Nodo ${firstInsight.nodeLabel}` : "Errore runtime",
          firstInsight.kind ? `kind ${firstInsight.kind}` : "",
          firstInsight.status ? `status ${firstInsight.status}` : "",
          firstInsight.url ? `url ${firstInsight.url}` : "",
        ].filter(Boolean).join(" · "),
        result: { record: firstError, diagnosis: firstInsight },
      });
    }
  }
  const debug = {
    prompt,
    intent,
    metric: query.metric,
    filter: query.filter,
    queryInsights,
    queryModel,
    memory,
    brainContext,
    brain,
  };
  let pendingAction = compactNatural || intent === "advice" ? null : await flowPromptBuildActionPlanWithAiNormalize(context, prompt, debug, memory);
  pendingAction = await flowPromptEnrichEndpointResearchPlan(pendingAction, prompt);
  if (pendingAction && typeof pendingAction === "object") pendingAction.prompt = prompt;
  const agentPlan = flowPromptBuildGenericAgentPlan(pendingAction, {
    prompt,
    source: debug.selectedPlan || "local",
  });
  debug.genericPlan = flowPromptDebugAgentPlan(agentPlan);
  const lower = flowPromptNormalize(prompt);
  const wantsDb = flowPromptHasAny(lower, ["db", "database", "indexeddb"]);
  const wantsAgentRuntime = flowPromptHasAny(lower, ["agent runtime", "runtime agent", "diagnosi", "diagnostica", "trace", "fix", "sistema", "verifica"]);
  const wantsProviderHealth = flowPromptHasAny(lower, ["provider", "modello", "model", "llm", "ollama", "lm studio", "openai"]);
  const mutation = intent !== "advice" && flowPromptIsMutationRequest(prompt);
  const parts = [];

  if (mutation && !pendingAction) {
    parts.push("Ho capito la richiesta di modifica, ma nel livello 1 lavoro ancora in modalita read-only: posso analizzare e preparare il contesto, non applicare cambiamenti automatici.");
  }

  if (compactNatural && !pendingAction) {
    parts.push(flowPromptLocalDefinitionAnswer(prompt));
  } else if (brain?.answer && !pendingAction) {
    parts.push(brain.answer);
  } else if (wantsAgentRuntime && queryModel.agentRuntime?.available && !pendingAction) {
    const runtime = queryModel.agentRuntime;
    const fixCount = runtime.fixes?.length || 0;
    const issueCount = runtime.issues?.length || 0;
    parts.push(`Agent Runtime attivo (${runtime.version}). Flow corrente: ${runtime.summary?.nodes || 0} nodi, ${runtime.summary?.dependencies || 0} collegamenti, ${issueCount} issue.`);
    if (fixCount) {
      const primaryFix = runtime.fixes[0];
      parts.push(`Fix suggeriti: ${fixCount}. Primo fix: ${primaryFix.problem || primaryFix.type}; azione: ${primaryFix.actionText || primaryFix.preview || "review manuale"}.`);
    } else {
      parts.push("Nessun fix automatico necessario secondo Agent Runtime.");
    }
    if (runtime.trace) {
      parts.push(`Trace ${runtime.trace.mode || "dry-run"}: ${runtime.trace.status || "completed"}, ${runtime.trace.trace?.length || 0} step.`);
    }
  } else if (wantsProviderHealth && !pendingAction) {
    const health = queryModel.aiRuntime?.providerHealth;
    parts.push(health?.summary || "Nessun provider AI configurato.");
    if (health?.primary) {
      parts.push(`Provider primario: ${health.primary.name} · ${health.primary.provider || "provider"} · ${health.primary.model || "model missing"}${health.primary.issue ? ` · issue ${health.primary.issue}` : ""}.`);
    }
  } else if (brain?.planner?.mode === "unavailable" && brain.planner.error) {
    parts.push(`Avviso AI: ${brain.planner.error}`);
    if (architectureAdvice) {
      parts.push(architectureAdvice.summary);
      const primary = architectureAdvice.recommendations?.[0];
      if (primary) parts.push(`Fallback locale: nodo principale consigliato ${primary.label}. ${primary.reason}`);
    }
  } else if (architectureAdvice) {
    parts.push(architectureAdvice.summary);
    const primary = architectureAdvice.recommendations?.[0];
    if (primary) {
      parts.push(`Nodo principale consigliato: ${primary.label}. ${primary.reason}`);
      parts.push(`Pattern: ${architectureAdvice.pattern}.`);
    }
  } else if (pendingAction) {
    parts.push(pendingAction.summary);
  } else if (intent === "channels") {
    parts.push(query.filter
      ? `Ho trovato ${query.total} canali che corrispondono a "${query.filter}" su ${query.allTotal} canali runtime.`
      : `Nel workspace corrente ci sono ${context.channels.length} canali runtime.`);
    if (queryModel.channels.length) {
      parts.push(`Lineage principale: ${queryModel.channels.slice(0, 4).map((item) =>
        `${item.name || "channel"} (${item.producers.length} producer, ${item.consumers.length} consumer)`
      ).join("; ")}.`);
    } else if (query.items.length) {
      parts.push(`Risultati: ${query.items.slice(0, 10).map((channel) => channel.name || channel.id).filter(Boolean).join(", ")}.`);
    }
  } else if (intent === "diagnostics") {
    if (query.items.length) {
      const errors = query.items.filter((item) => item.severity === "error").length;
      const warnings = query.items.filter((item) => item.severity !== "error").length;
      parts.push(`Ho trovato ${errors} errori e ${warnings} warning nel Flow Map corrente.`);
    } else {
      parts.push("Non vedo problemi strutturali evidenti nel Flow Map corrente.");
    }
  } else if (intent === "runtime") {
    const wantsErrors = flowPromptNormalize(query.filter) === "error";
    parts.push(wantsErrors
      ? (queryModel.runtime.errors.length
        ? `Ho trovato ${queryModel.runtime.errors.length} errori runtime recenti.`
        : "Non ho trovato errori runtime recenti nei record caricati.")
      : query.filter
        ? `Ho trovato ${query.total} record runtime che corrispondono a "${query.filter}".`
        : `Ho trovato ${context.events.length} eventi recenti e ${context.flowLogs.length} flow log recenti.`);
    const lastRecord = queryModel.runtime.last || query.items[0] || context.flowLogs[0] || context.events[0];
    if (!wantsErrors && lastRecord) parts.push(`Ultimo record: ${lastRecord.message || lastRecord.eventType || lastRecord.channel || lastRecord.id || "runtime"}.`);
    if (!wantsErrors && queryModel.runtime.errors.length) parts.push(`Errori runtime recenti: ${queryModel.runtime.errors.length}.`);
  } else if (intent === "edges") {
    parts.push(query.filter
      ? `Ho trovato ${query.total} collegamenti che corrispondono a "${query.filter}" su ${query.allTotal}.`
      : `Nel workspace corrente ci sono ${context.edges.length} collegamenti fra ${context.nodes.length} nodi.`);
  } else if (intent === "nodes") {
    parts.push(query.filter
      ? `Ho trovato ${query.total} nodi che corrispondono a "${query.filter}" su ${query.allTotal}.`
      : `Nel workspace corrente ci sono ${context.nodes.length} nodi.`);
    if (queryModel.nodes.length === 1) {
      const item = queryModel.nodes[0];
      parts.push(`${item.node.label} ha ${item.connectivity.incoming.length} input link, ${item.connectivity.outgoing.length} output link e ${item.connectivity.channels.length} canali dichiarati.`);
    }
  } else if (intent === "config") {
    const ai = queryModel.settings.ai || {};
    parts.push(`Settings AI: provider ${ai.provider || "non impostato"}, modello ${ai.model || "non impostato"}.`);
    if (queryModel.nodes.length === 1) {
      const item = queryModel.nodes[0];
      const configKeys = Object.keys(item.config || {});
      parts.push(`${item.node.label} espone ${configKeys.length} campi config${configKeys.length ? `: ${configKeys.slice(0, 8).join(", ")}` : ""}.`);
    } else if (queryModel.aiRuntime.providers.length) {
      parts.push(`Provider registrati: ${queryModel.aiRuntime.providers.map((provider) => provider.name).join(", ")}.`);
    }
  } else if (intent === "memory") {
    parts.push(memory.length
      ? `Ho trovato ${memory.length} record di memoria workspace rilevanti.`
      : "Non ho trovato memoria workspace rilevante per questa richiesta.");
  } else if (intent === "explain") {
    parts.push(`Questo Flow Map contiene ${context.nodes.length} nodi collegati da ${context.edges.length} link, con ${context.channels.length} canali runtime disponibili.`);
  } else if (intent === "database") {
    parts.push(`Ho letto il contesto runtime scoped: ${context.nodes.length} nodi, ${context.edges.length} collegamenti, ${context.channels.length} canali, ${context.events.length} eventi recenti e ${context.flowLogs.length} flow log recenti.`);
  } else {
    parts.push(`Ho letto il Flow Map corrente: ${context.nodes.length} nodi, ${context.edges.length} collegamenti, ${context.channels.length} canali.`);
  }

  if (wantsDb) {
    parts.push("Ho interrogato gli store runtime scoped disponibili come fallback read-only quando lo stato in memoria non contiene dati sufficienti.");
  }

  if (memory.length && !pendingAction && !compactNatural) {
    parts.push(`Memoria workspace rilevante: ${memory.slice(0, 2).map((item) => item.text).filter(Boolean).join(" | ")}.`);
  }

  return {
    kind: mutation ? "readonly-mutation-request" : "agent-report",
    intent,
    compactNatural: compactNatural && !pendingAction,
    content: parts.join(" "),
    context,
    memory,
    diagnostics,
    query,
    queryInsights,
    queryModel,
    architectureAdvice,
    brainContext,
    brain,
    pendingAction,
    agentPlan,
    debug,
  };
};

const flowPromptStripJsonFence = (text = "") => {
  const clean = String(text || "").trim();
  const fenced = clean.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : clean;
};

const flowPromptFirstJsonObject = (text = "") => {
  const clean = flowPromptStripJsonFence(text);
  if (!clean) return null;
  try {
    return JSON.parse(clean);
  } catch (_) {
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(clean.slice(start, end + 1));
    } catch (_) {
      return null;
    }
  }
};

const flowPromptReadAiSettings = async () => {
  const fallback = { provider: "Ollama", model: "llama3.1", temperature: 0.2, maxTokens: 1400, localFirst: true };
  try {
    const record = await readRuntimeRecord(runtimeStoreName("TL_SETTINGS", "tl_settings"), "global");
    return {
      ...fallback,
      ...(record?.settings?.ai || record?.ai || {}),
    };
  } catch (_) {
    return fallback;
  }
};

const flowPromptProviderKey = (value = "") =>
  flowPromptNormalize(value).replace(/\s+/g, "");

const flowPromptPickProvider = async (aiSettings = {}) => {
  const data = await window.TrackerLensAiRuntimeStore?.list?.().catch(() => null);
  const providers = (data?.providers?.length ? data.providers : window.TrackerLensAiRuntimeStore?.localProviderDefaults?.() || []);
  const wanted = flowPromptProviderKey(aiSettings.provider);
  return providers.find((provider) =>
    [provider.id, provider.name, provider.provider].some((value) => flowPromptProviderKey(value) === wanted)
  ) || providers.find((provider) =>
    wanted && [provider.id, provider.name, provider.provider].some((value) => flowPromptProviderKey(value).includes(wanted) || wanted.includes(flowPromptProviderKey(value)))
  ) || null;
};

const flowPromptWithLmStudioBase = (endpoint = "") => {
  const clean = String(endpoint || "http://127.0.0.1:1234").replace(/\/+$/g, "");
  return clean.endsWith("/v1") ? clean : `${clean}/v1`;
};

const flowPromptAiProviderName = (provider = {}, aiSettings = {}) =>
  provider.name || provider.provider || provider.id || aiSettings.provider || "AI provider";

const flowPromptFriendlyAiError = (error = null, { provider = {}, aiSettings = {}, endpoint = "", model = "" } = {}) => {
  const raw = String(error?.message || error || "").trim();
  const providerName = flowPromptAiProviderName(provider, aiSettings);
  const providerKey = flowPromptProviderKey(provider.provider || provider.name || provider.id || aiSettings.provider);
  const target = endpoint || provider.endpoint || (providerKey.includes("ollama") ? "http://127.0.0.1:11434" : "http://127.0.0.1:1234");
  const resolvedModel = model || aiSettings.model || provider.model || "";
  if (!provider?.id && !provider?.name && !provider?.provider && !aiSettings.provider) {
    return "Provider AI non configurato. Apri Settings -> AI & Modelli e seleziona Ollama o LM Studio.";
  }
  if (/failed to fetch|load failed|networkerror|connection refused|err_connection_refused|fetch failed/i.test(raw)) {
    const startHint = providerKey.includes("ollama")
      ? "Avvia Ollama con `ollama serve`, poi verifica `http://127.0.0.1:11434/api/tags`."
      : "Avvia il server locale del provider e verifica endpoint/modello in Settings -> AI & Modelli.";
    return `${providerName} non raggiungibile su ${target}. ${startHint}`;
  }
  if (/404|not found/i.test(raw) && providerKey.includes("ollama")) {
    return `${providerName} risponde, ma il modello ${resolvedModel || "configurato"} non sembra disponibile. Esegui ` +
      "`ollama pull " + (resolvedModel || "llama3.1") + "` oppure scegli un modello installato in Settings.";
  }
  if (/timeout|abort/i.test(raw)) {
    return `${providerName} non ha risposto in tempo su ${target}. Controlla che il modello sia caricato e riduci max tokens se serve.`;
  }
  if (/HTTP 400|context|token/i.test(raw)) {
    return `${providerName} ha rifiutato la richiesta${resolvedModel ? ` per ${resolvedModel}` : ""}. Il prompt potrebbe essere troppo grande o il modello non compatibile. Dettaglio: ${raw}`;
  }
  if (/HTTP 401|HTTP 403|unauthorized|forbidden/i.test(raw)) {
    return `${providerName} richiede credenziali o permessi validi. Controlla API key e impostazioni provider.`;
  }
  return `${providerName} non ha completato la richiesta AI${target ? ` su ${target}` : ""}.${raw ? ` Dettaglio: ${raw}` : ""}`;
};

const flowPromptResolveLmStudioModel = async ({ provider = {}, model = "" } = {}) => {
  const requested = String(model || provider.model || "").trim();
  if (requested && requested !== "local-model") return requested;
  const endpoint = flowPromptWithLmStudioBase(provider.endpoint);
  try {
    const response = await fetch(`${endpoint}/models`);
    if (!response.ok) return requested || "local-model";
    const data = await response.json();
    const models = Array.isArray(data?.data) ? data.data : [];
    const chatModel = models.find((item) => !/embed/i.test(String(item.id || ""))) || models[0];
    return chatModel?.id || requested || "local-model";
  } catch (_) {
    return requested || "local-model";
  }
};

const flowPromptCallOllama = async ({ provider = {}, model = "", prompt = "" } = {}) => {
  const endpoint = String(provider.endpoint || "http://127.0.0.1:11434").replace(/\/+$/g, "");
  const response = await fetch(`${endpoint}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: model || provider.model || "llama3.1", prompt, stream: false }),
  });
  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
  const data = await response.json();
  return { text: data.response || "", model: model || provider.model || "llama3.1", raw: data };
};

const flowPromptCallOpenAiCompatible = async ({ provider = {}, model = "", prompt = "", aiSettings = {} } = {}) => {
  const endpoint = flowPromptWithLmStudioBase(provider.endpoint);
  const resolvedModel = await flowPromptResolveLmStudioModel({ provider, model });
  const response = await fetch(`${endpoint}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: resolvedModel,
      messages: [
        { role: "system", content: "You design Trackers Lens Flow Map runtime graphs. Return only valid JSON." },
        { role: "user", content: prompt },
      ],
      temperature: Math.min(1, Number(aiSettings.temperature ?? 0.2)),
      max_tokens: Math.max(900, Number(aiSettings.maxTokens || 2200)),
    }),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`AI HTTP ${response.status}${errorText ? `: ${errorText.slice(0, 180)}` : ""}`);
  }
  const data = await response.json();
  return { text: data.choices?.[0]?.message?.content || "", model: resolvedModel, raw: data };
};

const flowPromptPaletteContract = () =>
  flatPalette().map((item) => ({
    label: item.label,
    type: item.nodeType,
    subtype: item.subtype,
    category: item.category,
    inputs: (item.inputs || []).map((port) => flowPromptPortName(port, "")),
    outputs: (item.outputs || []).map((port) => flowPromptPortName(port, "")),
  }));

const flowPromptBuildAiPlannerPrompt = ({ prompt = "", workspaceId = currentWorkspaceId(), brainContext = null } = {}) => {
  const currentNodes = (state.runtime.nodes || []).map((node) => ({
    id: node.id,
    label: node.label,
    type: node.type,
    subtype: nodeSubtype(node),
    category: nodeCategory(node),
    inputs: (node.inputs || []).map((port) => flowPromptPortName(port, "")),
    outputs: (node.outputs || []).map((port) => flowPromptPortName(port, "")),
  }));
  return [
    "Create a Trackers Lens Flow Map plan from the user request.",
    flowPromptLanguageRule(prompt),
    "The JSON summary and any natural-language descriptions must use that language.",
    "Return only JSON with this schema:",
    "{\"summary\":\"short text\",\"nodes\":[{\"label\":\"palette label\",\"config\":{},\"description\":\"optional\"}],\"edges\":[{\"sourceKey\":\"node label\",\"targetKey\":\"node label\",\"sourcePort\":\"optional output port\",\"targetPort\":\"optional input port\"}]}",
    "Rules:",
    "- Use labels from allowedPalette when possible.",
    "- Include Orchestrator Agent for autonomous/multi-step AI flows.",
    "- Prefer Task Node for user objectives without an external source.",
    "- Include Preview unless the user asks for a concrete Lens or Action.",
    "- Do not invent unsupported node types.",
    "- Use RAG and confirmed memory as planning guidance, but never as proof that unsupported nodes exist.",
    "- Prefer approvedPatterns when they match the user request, adapting only where the current prompt requires it.",
    "- Approved patterns are examples of user-confirmed good answers/plans; still validate every node and port against allowedPalette.",
    "- Avoid rejectedPatterns: they are user-confirmed bad answers/plans and must not be copied or used as examples.",
    "- If brainContext.conversationContext references a previous plan, adapt that previous plan instead of starting from scratch.",
    "- Honor conversation constraints such as avoid Split, add Condition, simplify, or include Flow In/Out when they are present.",
    "- For professional agent flows, prefer Task Node -> Orchestrator Agent -> Agent Bridge -> Preview or concrete actions.",
    "- Use Split for payload fan-out and Condition for decision routing.",
    "- Use Flow In and Flow Out only when the request needs reusable/embedded Flow Map boundaries.",
    "- When connecting Orchestrator Agent to Agent Bridge, prefer sourcePort action and targetPort agent_control.",
    "- When connecting Agent Bridge to Split or Preview, prefer sourcePort action and targetPort input.",
    "- When connecting Task Node to Orchestrator Agent, use task -> task.",
    "- Existing nodes are listed for context; still output desired labels, the app will deduplicate.",
    `workspaceId: ${workspaceId}`,
    `allowedPalette: ${JSON.stringify(flowPromptPaletteContract())}`,
    `existingNodes: ${JSON.stringify(currentNodes)}`,
    brainContext ? `brainContext: ${JSON.stringify({
      runtimeFacts: brainContext.runtimeFacts,
      memory: brainContext.memory,
      approvedPatterns: brainContext.approvedPatterns,
      rejectedPatterns: brainContext.rejectedPatterns,
      memoryGuard: brainContext.memoryGuard,
      conversationContext: brainContext.conversationContext,
      rag: brainContext.rag,
    })}` : "",
    `userRequest: ${prompt}`,
  ].join("\n");
};

const flowPromptNormalizeAiPlan = (payload = {}, originalPrompt = "") => {
  const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
  const aliases = new Map();
  const specs = nodes
    .map((node) => {
      const paletteItem = flowPromptStrictPaletteItemForAiNode(node);
      if (!paletteItem?.label) return null;
      const label = String(paletteItem.label).trim();
      [node.label, node.name, node.paletteLabel, node.id, label].filter(Boolean).forEach((value) => {
        aliases.set(String(value), label);
      });
      const spec = flowPromptSpecFromPalette(label, {
        type: node.type,
        subtype: node.subtype,
        category: node.category,
        config: node.config || {},
        description: node.description || "",
      });
      return spec;
    })
    .filter(Boolean);
  if (!specs.length) return null;
  const labelSet = new Set(specs.map((spec) => spec.label));
  const edges = (Array.isArray(payload.edges) ? payload.edges : [])
    .map((edge) => {
      const sourceRaw = edge.sourceKey || edge.source || edge.from || "";
      const targetRaw = edge.targetKey || edge.target || edge.to || "";
      return {
        sourceKey: aliases.get(String(sourceRaw)) || sourceRaw,
        targetKey: aliases.get(String(targetRaw)) || targetRaw,
        sourcePort: edge.sourcePort || edge.fromPort || edge.output || "",
        targetPort: edge.targetPort || edge.toPort || edge.input || "",
      };
    })
    .filter((edge) => labelSet.has(edge.sourceKey) && labelSet.has(edge.targetKey));
  const fallbackEdges = specs.slice(0, -1).map((source, index) => ({
    sourceKey: source.label,
    targetKey: specs[index + 1].label,
  }));
  return {
    prompt: originalPrompt,
    summary: String(payload.summary || `AI plan: ${specs.length} nodi e ${(edges.length || fallbackEdges.length)} collegamenti.`),
    nodes: specs,
    edges: edges.length ? edges : fallbackEdges,
    planner: payload.planner || {},
  };
};

const flowPromptCallPlannerProvider = async ({ kind = "", provider = {}, model = "", prompt = "", aiSettings = {} } = {}) =>
  kind.includes("ollama")
    ? flowPromptCallOllama({ provider, model, prompt })
    : flowPromptCallOpenAiCompatible({ provider, model, prompt, aiSettings });

const flowPromptAiRepairPrompt = ({ originalPrompt = "", plannerPrompt = "", rawText = "", payload = null, plan = null, preflight = null, attempt = 1 } = {}) => [
  "Repair the Trackers Lens Flow Map plan.",
  flowPromptLanguageRule(originalPrompt),
  "Return only one valid JSON object with this exact schema:",
  "{\"summary\":\"short text\",\"nodes\":[{\"label\":\"palette label\",\"config\":{},\"description\":\"optional\"}],\"edges\":[{\"sourceKey\":\"node label\",\"targetKey\":\"node label\",\"sourcePort\":\"optional output port\",\"targetPort\":\"optional input port\"}]}",
  "Rules:",
  "- Do not add prose, markdown, comments, or code fences.",
  "- Use only labels from allowedPalette in the original planner prompt.",
  "- Fix only the JSON/validation problems listed below.",
  "- If a port is invalid, choose a valid port from the source/target node contract in the original planner prompt.",
  "- If a node cannot receive input, connect to the next valid runtime node instead.",
  "- Keep the user's requested architecture and conversation constraints.",
  `repairAttempt: ${attempt}`,
  `userRequest: ${originalPrompt}`,
  `validationErrors: ${JSON.stringify({
    jsonMissing: !payload,
    blockers: preflight?.blockers || [],
    warnings: preflight?.warnings || [],
    checks: preflight?.checks || [],
  })}`,
  plan ? `currentPlan: ${JSON.stringify({
    summary: plan.summary,
    nodes: (plan.nodes || []).map((node) => ({ label: node.label, type: node.type, subtype: node.subtype })),
    edges: plan.edges || [],
  })}` : "",
  rawText ? `rawProviderText: ${String(rawText).slice(0, 2400)}` : "",
  `originalPlannerPrompt: ${plannerPrompt.slice(0, 8000)}`,
].filter(Boolean).join("\n");

const flowPromptValidateAiPlanCandidate = (payload = null, prompt = "") => {
  const plan = flowPromptNormalizeAiPlan(payload || {}, prompt);
  if (!plan) {
    return {
      ok: false,
      plan: null,
      analysis: null,
      preflight: null,
      errors: ["Il provider AI non ha restituito un piano JSON valido"],
    };
  }
  const analysis = flowPromptAnalyzePlan(plan);
  const preflight = flowPromptPlanPreflight(analysis);
  return {
    ok: preflight.ok,
    plan,
    analysis,
    preflight,
    errors: preflight.blockers || [],
  };
};

const flowPromptBuildAiPlan = async (prompt = "", options = {}) => {
  const conversationContext = options.conversationContext || null;
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const aiSettings = await flowPromptReadAiSettings();
  const provider = await flowPromptPickProvider(aiSettings);
  if (!provider) throw new Error(flowPromptFriendlyAiError(null, { aiSettings }));
  const kind = flowPromptProviderKey(provider.provider || provider.name || provider.id);
  const memory = await flowPromptReadWorkspaceMemory(prompt);
  const patternMemory = await flowPromptReadPatternMemories(prompt);
  const approvedPatterns = patternMemory.approvedPatterns || [];
  const rejectedPatterns = patternMemory.rejectedPatterns || [];
  const context = flowPromptContextWithMemory(await flowPromptAgentContext(), memory);
  const query = flowPromptAgentQuery(context, prompt);
  const queryModel = await flowPromptBuildRuntimeQueryModel({ context, prompt, query, memory });
  const architectureAdvice = flowPromptIsArchitectureAdviceRequest(prompt)
    ? flowPromptBuildArchitectureAdvice(context, prompt)
    : null;
  const brainContext = await flowPromptBuildBrainContext({
    context,
    prompt,
    intent: "createFlow",
    queryModel,
    memory,
    approvedPatterns,
    rejectedPatterns,
    memoryGuard: patternMemory.memoryGuard,
    conversationContext,
    architectureAdvice,
  });
  const plannerPrompt = flowPromptBuildAiPlannerPrompt({ prompt, brainContext });
  const model = aiSettings.model || provider.model;
  let ai = null;
  let payload = null;
  let plan = null;
  let validation = null;
  let activePrompt = plannerPrompt;
  const repairLog = [];
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    onProgress?.({
      attempt,
      maxAttempts,
      phase: attempt === 1 ? "planner" : "repair",
      label: attempt === 1 ? "Planner AI" : `Self repair ${attempt - 1}`,
      detail: attempt === 1
        ? "Sto chiedendo al provider un piano JSON validabile."
        : "Sto rimandando al provider gli errori reali del preflight.",
    });
    try {
      ai = await flowPromptCallPlannerProvider({ kind, provider, model, prompt: activePrompt, aiSettings });
    } catch (error) {
      throw new Error(flowPromptFriendlyAiError(error, { provider, aiSettings, model }));
    }
    payload = flowPromptFirstJsonObject(ai.text);
    validation = flowPromptValidateAiPlanCandidate(payload, prompt);
    repairLog.push({
      attempt,
      json: Boolean(payload),
      ok: validation.ok,
      errors: validation.errors || [],
    });
    onProgress?.({
      attempt,
      maxAttempts,
      phase: validation.ok ? "validated" : "preflight",
      label: validation.ok ? "Piano validato" : "Preflight repair",
      detail: validation.ok
        ? "JSON, nodi e porte sono validi."
        : (validation.errors?.[0] || "Il piano richiede correzioni."),
    });
    if (validation.ok) {
      plan = validation.plan;
      break;
    }
    if (attempt >= maxAttempts) break;
    activePrompt = flowPromptAiRepairPrompt({
      originalPrompt: prompt,
      plannerPrompt,
      rawText: ai.text || "",
      payload,
      plan: validation.plan,
      preflight: validation.preflight,
      attempt: attempt + 1,
    });
  }
  if (!plan) {
    const lastErrors = validation?.errors?.length ? `: ${validation.errors.join("; ")}` : "";
    throw new Error(`Il provider AI non ha restituito un piano JSON valido dopo self-repair${lastErrors}`);
  }
  return {
    ...plan,
    summary: `${plan.summary} · AI ${provider.name || provider.provider || aiSettings.provider} / ${ai.model || model}`,
    planner: {
      provider: provider.name || provider.provider || aiSettings.provider,
      model: ai.model || model,
      mode: "ai-brain",
      selfRepair: {
        attempts: repairLog.length,
        repaired: repairLog.length > 1 && Boolean(plan),
        log: repairLog,
      },
      rag: (brainContext.rag || []).map((item) => item.id),
      memory: (brainContext.memory || []).length,
      approvedPatterns: approvedPatterns.length,
      rejectedPatterns: rejectedPatterns.length,
      conversationContext: Boolean(conversationContext?.active),
    },
    approvedPatterns,
    rejectedPatterns,
    memoryGuard: patternMemory.memoryGuard,
    conversationContext,
  };
};

const flowPromptBuildConversationalReply = async (prompt = "", options = {}) => {
  const conversationContext = options.conversationContext || null;
  const aiSettings = await flowPromptReadAiSettings();
  const provider = await flowPromptPickProvider(aiSettings);
  if (!provider) {
    return "Posso rispondere alle domande sul Flow Map, ma non trovo un provider AI configurato per una risposta generale.";
  }
  const context = await flowPromptAgentContext().catch(() => null);
  const model = aiSettings.model || provider.model;
  const system = [
    "You are the Trackers Lens Flow Map assistant.",
    flowPromptLanguageRule(prompt),
    "Answer conversationally in that language.",
    "If the question is outside Flow Map, answer briefly and explain that your main scope is this runtime graph.",
    "Do not invent runtime data; use the provided context when relevant.",
  ].join(" ");
  const contextText = context
    ? `Current Flow Map context: ${context.nodes.length} nodes, ${context.edges.length} links, ${context.channels.length} channels, ${context.events.length} recent events, ${context.flowLogs.length} recent logs.`
    : "Current Flow Map context is not available.";
  const conversationText = conversationContext?.active
    ? `Conversation context: ${JSON.stringify(conversationContext)}`
    : "";
  const kind = flowPromptProviderKey(provider.provider || provider.name || provider.id);

  try {
    if (kind.includes("ollama")) {
      const ai = await flowPromptCallOllama({
        provider,
        model,
        prompt: `${system}\n${contextText}\n${conversationText}\nUser question: ${prompt}`,
      });
      return String(ai.text || "").trim() || "Non ho ricevuto una risposta dal provider AI.";
    }

    const endpoint = flowPromptWithLmStudioBase(provider.endpoint);
    const resolvedModel = await flowPromptResolveLmStudioModel({ provider, model });
    const response = await fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: resolvedModel,
        messages: [
          { role: "system", content: system },
          { role: "user", content: `${contextText}\n${conversationText}\n\n${prompt}` },
        ],
        temperature: Math.min(1, Number(aiSettings.temperature ?? 0.35)),
        max_tokens: Math.max(160, Math.min(900, Number(aiSettings.maxTokens || 600))),
      }),
    });
    if (!response.ok) throw new Error(`AI HTTP ${response.status}`);
    const data = await response.json();
    return String(data.choices?.[0]?.message?.content || "").trim() || "Non ho ricevuto una risposta dal provider AI.";
  } catch (error) {
    return `Posso aiutarti sul Flow Map, ma il provider AI non ha risposto. ${flowPromptFriendlyAiError(error, { provider, aiSettings, model })}`;
  }
};

const flowPromptBuildPlanWithAiFallback = async (prompt = "", options = {}) => {
  const conversationContext = options.conversationContext || null;
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  try {
    return await flowPromptBuildAiPlan(prompt, { conversationContext, onProgress });
  } catch (error) {
    onProgress?.({
      phase: "fallback",
      label: "Fallback locale",
      detail: error?.message || "Provider AI non validabile, preparo un piano locale.",
    });
    const localPlan = flowPromptBuildContextualLocalPlan(prompt, conversationContext);
    const patternMemory = await flowPromptReadPatternMemories(prompt);
    const approvedPatterns = patternMemory.approvedPatterns || [];
    const rejectedPatterns = patternMemory.rejectedPatterns || [];
    return {
      ...localPlan,
      summary: `${localPlan.summary} · fallback locale`,
      approvedPatterns,
      rejectedPatterns,
      memoryGuard: patternMemory.memoryGuard,
      conversationContext,
      planner: {
        mode: "fallback",
        error: error?.message || "AI planner non disponibile",
        approvedPatterns: approvedPatterns.length,
        rejectedPatterns: rejectedPatterns.length,
        conversationContext: Boolean(conversationContext?.active),
      },
    };
  }
};

const flowPromptPlannerLabel = (planner = {}) => {
  if (!planner || !planner.mode) return "Local planner";
  const repair = planner.selfRepair?.repaired ? ` · self-repair ${Math.max(1, Number(planner.selfRepair?.attempts || 1) - 1)}` : "";
  if (planner.mode === "ai-brain") return `AI Brain planner · ${planner.provider || "provider"}${planner.model ? ` / ${planner.model}` : ""}${repair}`;
  if (planner.mode === "ai") return `AI planner · ${planner.provider || "provider"}${planner.model ? ` / ${planner.model}` : ""}`;
  return "Local fallback";
};

const flowPromptBuildPlan = (prompt = "") => {
  const text = String(prompt || "").trim();
  const lower = flowPromptNormalize(text);
  const specs = [];
  const add = (label, overrides = {}) => {
    const spec = flowPromptSpecFromPalette(label, overrides);
    const key = `${spec.type}:${spec.subtype}:${flowPromptNormalize(spec.label)}`;
    if (!specs.some((item) => `${item.type}:${item.subtype}:${flowPromptNormalize(item.label)}` === key)) specs.push(spec);
  };

  if (flowPromptHasAny(lower, ["rss", "feed", "news", "notizie"])) add("RSS Feed", { config: { url: "" } });
  else if (flowPromptHasAny(lower, ["websocket", "stream", "realtime", "real time", "live"])) add("WebSocket", { config: { url: "" } });
  else if (flowPromptHasAny(lower, ["api", "rest", "http", "endpoint"])) add("REST API", { config: { method: "GET", endpoint: "" } });
  else if (flowPromptHasAny(lower, ["manual", "json", "task", "missione", "obiettivo", "prompt"])) add("Task Node", { config: { objective: text } });
  else add("Task Node", { config: { objective: text } });

  add("Orchestrator Agent", {
    config: {
      goal: text || "Orchestrate the runtime graph",
      executionMode: "on_event",
      maxSteps: 6,
      requireConfirmation: false,
    },
  });

  if (flowPromptHasAny(lower, ["planner", "piano", "route", "routing"])) add("AI Planner");
  else if (flowPromptHasAny(lower, ["sentiment", "umore"])) add("AI Sentiment");
  else if (flowPromptHasAny(lower, ["summary", "summarize", "riassunto", "notizie", "research"])) add("AI Summarizer");
  else if (flowPromptHasAny(lower, ["classifica", "classifier", "categoria"])) add("AI Classifier");
  else if (flowPromptHasAny(lower, ["predict", "previsione", "forecast"])) add("AI Predictor");
  else add("AI Analyzer");

  if (flowPromptHasAny(lower, ["filter", "filtro"])) add("Filter");
  if (flowPromptHasAny(lower, ["transform", "map", "format", "parser", "parse"])) add("Transform");
  if (flowPromptHasAny(lower, ["condition", "if", "alert se", "quando"])) add("Condition");

  if (flowPromptHasAny(lower, ["db", "database", "salva", "storico", "history"])) add(lower.includes("history") || lower.includes("storico") ? "History Store" : "Save DB Record");
  if (flowPromptHasAny(lower, ["telegram"])) add("Telegram Message");
  else if (flowPromptHasAny(lower, ["slack"])) add("Slack Message");
  else if (flowPromptHasAny(lower, ["discord"])) add("Discord Message");
  else if (flowPromptHasAny(lower, ["email", "mail"])) add("Email");
  else if (flowPromptHasAny(lower, ["notifica", "notification", "alert"])) add("Browser Notification");

  add("Preview");

  const edges = specs.slice(0, -1).map((source, index) => ({
    sourceKey: source.label,
    targetKey: specs[index + 1].label,
  }));

  return {
    prompt: text,
    summary: `Plan locale: ${specs.length} nodi e ${edges.length} collegamenti.`,
    nodes: specs,
    edges,
  };
};

const flowPromptBuildContextualLocalPlan = (prompt = "", conversationContext = null) => {
  const text = String(prompt || "").trim();
  const constraints = new Set(conversationContext?.constraints || []);
  const shouldUsePrevious = Boolean(conversationContext?.lastPlan?.nodes?.length && (conversationContext.referencesPrevious || constraints.size));
  const baseSpecs = shouldUsePrevious
    ? conversationContext.lastPlan.nodes
      .map((label) => flowPromptSpecFromPalette(label))
      .filter((spec) => spec?.label)
    : flowPromptBuildPlan(prompt).nodes;
  const byLabel = new Map();
  const add = (label, overrides = {}) => {
    const spec = flowPromptSpecFromPalette(label, overrides);
    if (!spec?.label) return;
    byLabel.set(spec.label, spec);
  };
  baseSpecs.forEach((spec) => add(spec.label, spec));

  if (constraints.has("avoid Split") || constraints.has("simplify previous plan")) byLabel.delete("Split");
  if (constraints.has("simplify previous plan")) {
    byLabel.delete("Condition");
    byLabel.delete("AI Analyzer");
    byLabel.delete("AI Planner");
    byLabel.delete("AI Summarizer");
    byLabel.delete("AI Classifier");
    byLabel.delete("AI Predictor");
  }
  if (constraints.has("add/use Condition")) add("Condition");
  if (constraints.has("include Flow In/Out boundary if useful")) {
    byLabel.delete("Task Node");
    add("Flow In");
    add("Flow Out");
  }
  if ((byLabel.has("Orchestrator Agent") || flowPromptHasAny(text, ["agent", "agente", "agenti"])) && !byLabel.has("Agent Bridge")) {
    add("Agent Bridge");
  }
  if (!byLabel.has("Preview")) add("Preview");

  const orderedLabels = [
    "Flow In",
    "Task Node",
    "REST API",
    "RSS Feed",
    "WebSocket",
    "Orchestrator Agent",
    "Agent Bridge",
    "Condition",
    "Split",
    "AI Planner",
    "AI Analyzer",
    "AI Summarizer",
    "AI Classifier",
    "AI Predictor",
    "Transform",
    "Filter",
    "Save DB Record",
    "History Store",
    "Telegram Message",
    "Slack Message",
    "Discord Message",
    "Email",
    "Browser Notification",
    "Flow Out",
    "Preview",
  ];
  const ordered = [
    ...orderedLabels.map((label) => byLabel.get(label)).filter(Boolean),
    ...Array.from(byLabel.values()).filter((spec) => !orderedLabels.includes(spec.label)),
  ];
  const hasFlowOut = byLabel.has("Flow Out");
  const hasPreview = byLabel.has("Preview");
  const chain = hasFlowOut && hasPreview
    ? ordered.filter((spec) => spec.label !== "Preview")
    : ordered;
  const edges = chain.slice(0, -1).map((source, index) => ({
    sourceKey: source.label,
    targetKey: chain[index + 1].label,
  }));
  if (hasFlowOut && hasPreview) {
    const flowOutIndex = chain.findIndex((spec) => spec.label === "Flow Out");
    const previewSource = flowOutIndex > 0 ? chain[flowOutIndex - 1] : chain[chain.length - 1];
    if (previewSource?.label) edges.push({ sourceKey: previewSource.label, targetKey: "Preview" });
  }
  return {
    prompt: text,
    summary: `Plan locale contestuale: ${ordered.length} nodi e ${edges.length} collegamenti.`,
    nodes: ordered,
    edges,
  };
};

const flowPromptFindExistingNode = (spec = {}) => {
  const specName = flowPromptNormalize(spec.label);
  const specTokens = flowPromptTokenSet(spec.label);
  const candidates = (state.runtime.nodes || []).filter((node) => {
    const sameType = String(node.type || "") === String(spec.type || "");
    const sameSubtype = flowPromptNormalize(nodeSubtype(node)) === flowPromptNormalize(spec.subtype);
    const sameCategory = flowPromptNormalize(nodeCategory(node)) === flowPromptNormalize(spec.category);
    return sameType || sameSubtype || sameCategory;
  });

  let best = null;
  let bestScore = 0;
  candidates.forEach((node) => {
    const nodeName = flowPromptNormalize(node.label || node.metadata?.paletteLabel || node.id);
    const nodeTokens = flowPromptTokenSet(nodeName);
    let score = 0;
    if (nodeName === specName) score += 6;
    if (flowPromptNormalize(nodeSubtype(node)) === flowPromptNormalize(spec.subtype)) score += 3;
    if (String(node.type || "") === String(spec.type || "")) score += 2;
    specTokens.forEach((token) => {
      if (nodeTokens.has(token)) score += 1;
    });
    if (score > bestScore) {
      best = node;
      bestScore = score;
    }
  });
  return bestScore >= 4 ? best : null;
};

const flowPromptPositionForIndex = (index = 0) => ({
  x: flowCoordinate(120 + (index % 4) * 320),
  y: flowCoordinate(140 + Math.floor(index / 4) * 240),
  width: FLOW_NODE_DEFAULT_WIDTH,
});

const flowPromptNodeFromSpec = ({ spec, workspaceId, index }) => {
  const now = new Date().toISOString();
  const inputs = Array.isArray(spec.inputs) ? spec.inputs : [];
  const outputs = Array.isArray(spec.outputs) ? spec.outputs : [];
  const channelNames = [...new Set([...inputs, ...outputs].map((port) => flowPromptPortName(port, "")).filter(Boolean))];
  const id = `prompt_${safeRuntimeId(workspaceId)}_${safeRuntimeId(spec.type)}_${safeRuntimeId(spec.subtype)}_${Date.now()}_${index}`;
  return {
    id,
    workspaceId,
    type: spec.type || "custom",
    label: spec.label || "Generated Node",
    sourceRef: id,
    assetId: "",
    inputs,
    outputs,
    channels: channelNames,
    status: "idle",
    runtime: { status: "idle", active: true },
    flowPosition: flowPromptPositionForIndex(index),
    position: { x: 1, y: 1 },
    metadata: {
      paletteLabel: spec.label,
      paletteAction: spec.connectionType || "prompt-chat",
      tone: spec.tone || "gold",
      icon: spec.icon || "extension",
      runtimeType: spec.type || "custom",
      subtype: spec.subtype || "custom",
      category: spec.category || "custom",
      manifest: spec.manifest || null,
      permissions: spec.permissions || [],
      settingsSchema: spec.settingsSchema || {},
      runtimeMetadata: spec.runtime || {},
      config: spec.config || {},
      configured: true,
      generatedBy: "flow-prompt-chat",
      description: spec.description || `Generated from prompt: ${spec.label}`,
    },
    createdAt: now,
    updatedAt: now,
  };
};

const flowPromptConnectionFromDependency = ({ dependency = {}, source = {}, target = {}, workspaceId = "" } = {}) => {
  const now = new Date().toISOString();
  const connectionId = dependency.connectionId || `prompt_chat_${Date.now()}`;
  const channel = dependency.channel || dependency.metadata?.sourcePort || source.outputs?.[0] || source.channels?.[0] || "runtime";
  const mapping = {
    sourcePort: dependency.metadata?.sourcePort || channel || "output",
    targetPort: dependency.metadata?.targetPort || target.inputs?.[0] || "input",
    linkType: dependency.metadata?.linkType || "data",
    generatedBy: dependency.metadata?.generatedBy || "flow-prompt-chat",
  };

  return {
    id: connectionId,
    name: `${source.label || source.id} -> ${target.label || target.id}`,
    type: `${source.type || "node"} -> ${target.type || "node"}`,
    from: source.label || source.id,
    fromKind: source.type || "node",
    to: target.label || target.id,
    targetMeta: target.sourceRef || target.assetId || target.id,
    status: "active",
    lastTest: "Mai",
    result: "Creato dalla Flow Map Agent",
    method: "EVENT",
    frequency: channel,
    timeout: "10 secondi",
    retries: 0,
    endpoint: `flowmap://${workspaceId || dependency.workspaceId || "workspace_global"}/${connectionId}`,
    workspaceId: workspaceId || dependency.workspaceId || source.workspaceId || target.workspaceId || "workspace_global",
    workspaceName: workspaceId || dependency.workspaceId || source.workspaceId || target.workspaceId || "workspace_global",
    fromBoxId: source.id,
    toBoxId: target.id,
    sourceNodeId: source.id,
    targetNodeId: target.id,
    sourceName: source.label || source.id,
    targetName: target.label || target.id,
    channel,
    mapping,
    createdAt: dependency.createdAt || now,
    updatedAt: now,
  };
};

const flowPromptPersistConnection = async ({ dependency = {}, source = {}, target = {}, workspaceId = "" } = {}) => {
  if (!window.TrackerLensConnectionsStore?.upsert || !source?.id || !target?.id) return null;
  const connection = flowPromptConnectionFromDependency({ dependency, source, target, workspaceId });
  return window.TrackerLensConnectionsStore.upsert(connection);
};

const flowPromptNodePortNames = (node = {}, side = "out") =>
  (side === "in" ? node.inputs || [] : node.outputs || [])
    .map((port) => flowPromptPortName(port, ""))
    .filter(Boolean);

const flowPromptPickPreferredPort = (ports = [], preferences = [], fallback = "") => {
  const names = ports.map((port) => flowPromptPortName(port, "")).filter(Boolean);
  if (!names.length) return fallback || "";
  const normalized = new Map(names.map((name) => [flowPromptNormalize(name), name]));
  const preferred = preferences.map(flowPromptNormalize).find((name) => normalized.has(name));
  return preferred ? normalized.get(preferred) : names[0] || fallback || "";
};

const flowPromptPortPreferencesForLink = (source = {}, target = {}, edge = {}) => {
  const sourceLabel = flowPromptNormalize(source.label || source.subtype || source.type || "");
  const targetLabel = flowPromptNormalize(target.label || target.subtype || target.type || "");
  const sourceSubtype = flowPromptNormalize(source.subtype || nodeSubtype(source));
  const targetSubtype = flowPromptNormalize(target.subtype || nodeSubtype(target));
  const sourcePrefs = [];
  const targetPrefs = [];

  if (targetSubtype === "agent-bridge" || targetLabel.includes("agent bridge")) {
    sourcePrefs.push("action", "decision", "task", "analysis");
    targetPrefs.push("agent_control", "agent-control", "listening");
  }
  if (sourceSubtype === "agent-bridge" || sourceLabel.includes("agent bridge")) {
    sourcePrefs.push("action", "agent_control");
    targetPrefs.push("input", "raw", "task");
  }
  if (targetSubtype === "split" || targetLabel.includes("split")) {
    sourcePrefs.push("action", "decision", "output", "task", "raw");
    targetPrefs.push("input");
  }
  if (targetSubtype === "condition" || targetLabel.includes("condition")) {
    sourcePrefs.push("decision", "action", "output", "task", "raw");
    targetPrefs.push("input");
  }
  if (targetSubtype === "task" || targetLabel.includes("task node")) {
    sourcePrefs.push("flow.in", "task", "output", "raw");
    targetPrefs.push("task");
  }
  if (target.type === "aiAgent" || targetLabel.includes("ai ") || targetLabel.includes("agent")) {
    targetPrefs.push("task", "input");
  }
  if (targetLabel.includes("preview") || targetSubtype === "preview") {
    sourcePrefs.push("action", "output", "analysis", "summary", "decision", "a", "b", "raw");
    targetPrefs.push("input", "raw", "all");
  }
  if (sourceSubtype === "flow-in" || sourceLabel.includes("flow in")) {
    sourcePrefs.push("flow.in", "output");
  }
  if (targetSubtype === "flow-out" || targetLabel.includes("flow out")) {
    targetPrefs.push("flow.out", "input");
  }
  if (sourceSubtype === "orchestrator" || sourceLabel.includes("orchestrator")) {
    sourcePrefs.push(targetSubtype === "agent-bridge" ? "action" : "decision", "action", "done", "error");
  }
  if (sourceSubtype === "task" || sourceLabel.includes("task node")) {
    sourcePrefs.push("task");
  }

  const explicitSource = edge.sourcePort || edge.fromPort || edge.output || "";
  const explicitTarget = edge.targetPort || edge.toPort || edge.input || "";
  return {
    source: [explicitSource, ...sourcePrefs, "output", "raw", "task"].filter(Boolean),
    target: [explicitTarget, ...targetPrefs, "input", "raw", "all"].filter(Boolean),
  };
};

const flowPromptResolvePlanPorts = (source = {}, target = {}, edge = {}) => {
  const prefs = flowPromptPortPreferencesForLink(source, target, edge);
  const sourcePort = flowPromptPickPreferredPort(flowPromptNodePortNames(source, "out"), prefs.source, edge.sourcePort || "output");
  const targetPort = flowPromptPickPreferredPort(flowPromptNodePortNames(target, "in"), prefs.target, edge.targetPort || "input");
  const channel = sourcePort || source.channels?.[0] || "runtime";
  return { sourcePort, targetPort, channel };
};

const flowPromptAnalyzePlan = (plan = {}) => {
  const nodeRefs = new Map();
  const analyzedNodes = (plan.nodes || []).map((spec, index) => {
    const existing = flowPromptFindExistingNode(spec);
    const ref = existing || flowPromptNodeFromSpec({ spec, workspaceId: currentWorkspaceId(), index });
    [
      spec.label,
      spec.key,
      spec.name,
      existing?.label,
      existing?.id,
      ref?.label,
      ref?.id,
    ].filter(Boolean).forEach((key) => nodeRefs.set(key, ref));
    return { spec, index, existing, node: ref, action: existing ? "reuse" : "create" };
  });
  const analyzedEdges = (plan.edges || []).map((edge, index) => {
    const source = nodeRefs.get(edge.sourceKey);
    const target = nodeRefs.get(edge.targetKey);
    const resolvedEdge = source && target ? edge : {
      ...edge,
      sourcePort: "",
      targetPort: "",
    };
    const { sourcePort, targetPort, channel } = flowPromptResolvePlanPorts(source, target, resolvedEdge);
    const duplicate = (state.runtime.dependencies || []).find((dependency) =>
      dependency.sourceNodeId === source?.id &&
      dependency.targetNodeId === target?.id &&
      String(dependency.channel || "") === String(channel || "")
    );
    return { ...edge, index, source, target, sourcePort, targetPort, channel, duplicate };
  });
  return { ...plan, analyzedNodes, analyzedEdges };
};

const flowPromptPlanPreflight = (analysis = {}) => {
  const nodes = analysis.analyzedNodes || [];
  const edges = analysis.analyzedEdges || [];
  const blockers = [];
  const warnings = [];
  const checks = [];
  const nodeChecks = nodes.map((item) => {
    const spec = item.spec || {};
    const paletteItem = flowPromptPaletteItem(spec.label) || flowPromptStrictPaletteItemForAiNode(spec);
    const status = !paletteItem
      ? "blocked"
      : item.existing?.id
        ? "reuse"
        : "create";
    if (!paletteItem) {
      blockers.push(`Nodo non presente nella palette: ${spec.label || spec.subtype || "senza nome"}.`);
    }
    return {
      label: spec.label || item.node?.label || "Node",
      action: item.existing?.id ? "reuse" : "create",
      status,
      palette: Boolean(paletteItem),
      detail: item.existing?.id
        ? `Riuso nodo esistente: ${item.existing.label || item.existing.id}`
        : paletteItem
          ? "Nodo palette valido"
          : "Nodo non validato",
    };
  });
  const edgeChecks = edges.map((edge) => {
    const source = edge.source || {};
    const target = edge.target || {};
    const sourcePorts = flowPromptNodePortNames(source, "out");
    const targetPorts = flowPromptNodePortNames(target, "in");
    const sourceOk = Boolean(edge.source?.id && edge.target?.id);
    const sourcePortOk = !edge.sourcePort || sourcePorts.includes(edge.sourcePort);
    const targetPortOk = !edge.targetPort || targetPorts.includes(edge.targetPort);
    const duplicate = Boolean(edge.duplicate);
    const status = !sourceOk || !sourcePortOk || !targetPortOk
      ? "blocked"
      : duplicate
        ? "reuse"
        : "create";
    if (!sourceOk) blockers.push(`Link incompleto: ${edge.sourceKey || edge.sourceLabel || "source"} -> ${edge.targetKey || edge.targetLabel || "target"}.`);
    if (!sourcePortOk) blockers.push(`Porta OUT non valida su ${source.label || edge.sourceKey}: ${edge.sourcePort}.`);
    if (!targetPortOk) blockers.push(`Porta IN non valida su ${target.label || edge.targetKey}: ${edge.targetPort}.`);
    if (duplicate) warnings.push(`Link gia presente: ${source.label || edge.sourceKey} -> ${target.label || edge.targetKey}.`);
    return {
      sourceLabel: source.label || edge.sourceLabel || edge.sourceKey || "source",
      targetLabel: target.label || edge.targetLabel || edge.targetKey || "target",
      sourcePort: edge.sourcePort || "",
      targetPort: edge.targetPort || "",
      channel: edge.channel || "",
      duplicate,
      status,
    };
  });
  const destructiveActions = (analysis.actions || []).filter((action) =>
    ["delete", "deleteNode", "disconnect", "remove"].includes(action?.type || action?.action)
  );
  if (destructiveActions.length) {
    blockers.push("Il piano contiene azioni distruttive: bloccato per questa modalita.");
  }
  checks.push({
    label: "Palette",
    status: nodeChecks.every((item) => item.palette) ? "ok" : "blocked",
    detail: `${nodeChecks.filter((item) => item.palette).length}/${nodeChecks.length} nodi validati`,
  });
  checks.push({
    label: "Porte IN/OUT",
    status: edgeChecks.every((item) => item.status !== "blocked") ? "ok" : "blocked",
    detail: `${edgeChecks.filter((item) => item.status !== "blocked").length}/${edgeChecks.length} link validati`,
  });
  checks.push({
    label: "Duplicati",
    status: edgeChecks.some((item) => item.duplicate) ? "warn" : "ok",
    detail: edgeChecks.some((item) => item.duplicate) ? "Alcuni link saranno riusati" : "Nessun link duplicato",
  });
  checks.push({
    label: "Azioni distruttive",
    status: destructiveActions.length ? "blocked" : "ok",
    detail: destructiveActions.length ? `${destructiveActions.length} azioni bloccate` : "Nessuna azione distruttiva",
  });
  const createdNodes = nodeChecks.filter((item) => item.action === "create").length;
  const reusedNodes = nodeChecks.filter((item) => item.action === "reuse").length;
  const createdEdges = edgeChecks.filter((item) => item.status === "create").length;
  const reusedEdges = edgeChecks.filter((item) => item.status === "reuse").length;
  return {
    ok: blockers.length === 0,
    status: blockers.length ? "blocked" : warnings.length ? "warn" : "ready",
    summary: blockers.length
      ? "Piano bloccato: correggere i problemi prima di applicare."
      : `Pronto: ${createdNodes} nodi da creare, ${reusedNodes} da riusare, ${createdEdges} link da creare, ${reusedEdges} da riusare.`,
    whatWillHappen: [
      createdNodes ? `${createdNodes} nodi saranno creati` : "",
      reusedNodes ? `${reusedNodes} nodi esistenti saranno riusati` : "",
      createdEdges ? `${createdEdges} link saranno creati` : "",
      reusedEdges ? `${reusedEdges} link esistenti saranno riusati` : "",
    ].filter(Boolean),
    checks,
    nodes: nodeChecks,
    edges: edgeChecks,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
  };
};

const flowPromptMaterializePlan = async (analysis = {}) => {
  const workspaceId = await ensureRuntimeWorkspaceScope();
  const savedNodes = [];
  const reusedNodes = [];
  const createdEdges = [];
  const reusedEdges = [];
  const nodeByLabel = new Map();

  for (const item of analysis.analyzedNodes || []) {
    if (item.existing?.id) {
      reusedNodes.push(item.existing);
      nodeByLabel.set(item.spec.label, item.existing);
      continue;
    }
    const node = { ...item.node, workspaceId, flowPosition: item.node.flowPosition || flowPromptPositionForIndex(item.index) };
    const saved = await window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode?.({ node });
    if (saved?.id && window.TrackerLensChannelRegistry?.upsertChannelsForRuntimeNode) {
      await window.TrackerLensChannelRegistry.upsertChannelsForRuntimeNode({ node: saved });
    }
    savedNodes.push(saved || node);
    nodeByLabel.set(item.spec.label, saved || node);
  }

  for (const edge of analysis.analyzedEdges || []) {
    const source = nodeByLabel.get(edge.sourceKey) || edge.source;
    const target = nodeByLabel.get(edge.targetKey) || edge.target;
    if (!source?.id || !target?.id) continue;
    const { sourcePort, targetPort, channel } = flowPromptResolvePlanPorts(source, target, edge);
    const duplicate = (state.runtime.dependencies || []).find((dependency) =>
      dependency.sourceNodeId === source.id &&
      dependency.targetNodeId === target.id &&
      String(dependency.channel || "") === String(channel || "")
    );
    if (duplicate) {
      reusedEdges.push(duplicate);
      continue;
    }
    const dependency = {
      id: `dep_prompt_${safeRuntimeId(workspaceId)}_${safeRuntimeId(source.id)}_${safeRuntimeId(target.id)}_${Date.now()}_${edge.index}`,
      workspaceId,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      sourceType: source.type || "node",
      targetType: target.type || "node",
      channel,
      connectionId: `prompt_chat_${Date.now()}_${edge.index}`,
      status: "active",
      metadata: {
        sourcePort,
        targetPort,
        generatedBy: "flow-prompt-chat",
      },
      createdAt: new Date().toISOString(),
    };
    const saved = await window.TrackerLensRuntimeGraphStore?.upsertDependency?.({ dependency });
    if (saved) {
      const connection = await flowPromptPersistConnection({ dependency: saved, source, target, workspaceId });
      if (connection) {
        state.connections = [
          ...(state.connections || []).filter((item) => item.id !== connection.id),
          connection,
        ];
      }
      createdEdges.push(saved);
    }
  }

  await loadRuntime({ force: true });
  const focusNode = savedNodes[0] || reusedNodes[0];
  if (focusNode?.id) {
    setFocusState({
      mode: "dependencies",
      nodeId: focusNode.id,
      nodeType: focusNode.type || "",
      edgeId: "",
      channel: focusNode.channels?.[0] || focusNode.outputs?.[0] || "",
      connectionId: "",
    });
    state.inspectorOpen = true;
    mount({ preserveScroll: true });
  }

  return { savedNodes, reusedNodes, createdEdges, reusedEdges };
};

const openFlowPromptChatDialog = async (options = {}) => {
  const existingAside = document.querySelector("[data-flow-prompt-aside]");
  if (existingAside) {
    flowPromptSaveOpenState(true);
    existingAside.classList.add("is-open");
    if (!options.restore) existingAside.querySelector("textarea")?.focus?.();
    return;
  }
  const workspaceId = await ensureRuntimeWorkspaceScope();
  flowPromptSaveOpenState(true, workspaceId);
  const draft = {
    workspaceId,
    chats: [],
    activeChat: flowPromptNewChat(workspaceId),
    prompt: "",
    analysis: null,
    busy: false,
    activity: null,
    loadingHistory: true,
    result: null,
    error: "",
    dismissedIntroChatIds: new Set(),
    view: "chat",
  };
  let aside = null;

  const activeMessages = () => Array.isArray(draft.activeChat?.messages) ? draft.activeChat.messages : [];

  const setActiveChat = (chat) => {
    draft.activeChat = chat || flowPromptNewChat(draft.workspaceId);
    draft.view = "chat";
    draft.prompt = "";
    draft.analysis = null;
    draft.result = null;
    draft.activity = null;
    draft.error = "";
  };

  const persistActiveChat = async () => {
    draft.activeChat = await flowPromptSaveChat(draft.activeChat);
    const index = draft.chats.findIndex((chat) => chat.id === draft.activeChat.id);
    if (index >= 0) draft.chats[index] = draft.activeChat;
    else draft.chats.unshift(draft.activeChat);
    draft.chats = draft.chats
      .slice()
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    return draft.activeChat;
  };

  const appendMessage = async (message = {}) => {
    const now = flowPromptNow();
    const nextMessage = {
      id: flowPromptMessageId(message.role || "msg"),
      role: "assistant",
      kind: "text",
      content: "",
      createdAt: now,
      ...message,
    };
    const messages = [...activeMessages(), nextMessage];
    draft.activeChat = {
      ...draft.activeChat,
      title: draft.activeChat.title === "Nuova chat" && nextMessage.role === "user"
        ? flowPromptChatTitle(nextMessage.content)
        : draft.activeChat.title,
      messages,
      updatedAt: now,
    };
    await persistActiveChat();
    return nextMessage;
  };

  const promptBeforeMessage = (messageId = "") => {
    const messages = activeMessages();
    const index = messages.findIndex((item) => item.id === messageId);
    const before = index >= 0 ? messages.slice(0, index) : messages;
    return [...before].reverse().find((item) => item.role === "user" && item.content)?.content || "";
  };

  const messageById = (messageId = "") =>
    activeMessages().find((item) => item.id === messageId) || null;

  const scrollToMessage = (messageId = "") => {
    if (!messageId) return;
    const root = document.querySelector("[data-flow-prompt-chat]");
    const messages = Array.from(root?.querySelectorAll("[data-flow-prompt-message-id]") || []);
    const target = messages.find((item) => item.getAttribute("data-flow-prompt-message-id") === messageId);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("is-highlighted");
    window.setTimeout(() => target.classList.remove("is-highlighted"), 1600);
  };

  const openMessageBrainDetails = (messageId = "") => {
    const root = document.querySelector("[data-flow-prompt-chat]");
    const messages = Array.from(root?.querySelectorAll("[data-flow-prompt-message-id]") || []);
    const target = messages.find((item) => item.getAttribute("data-flow-prompt-message-id") === messageId);
    const details = target?.querySelector?.(".tl-flow-prompt-brain-details");
    if (!details) return;
    details.open = true;
    details.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("is-highlighted");
    window.setTimeout(() => target.classList.remove("is-highlighted"), 1400);
  };

  const focusPromptDraft = () => {
    refresh();
    requestAnimationFrame(() => {
      const textarea = document.querySelector("[data-flow-prompt-chat] textarea");
      if (!textarea) return;
      textarea.value = draft.prompt || "";
      textarea.focus();
      textarea.setSelectionRange?.(textarea.value.length, textarea.value.length);
    });
  };

  const patternMemoryMeta = (item = {}) => {
    if (!item.meta) return {};
    if (typeof item.meta === "object") return item.meta;
    try {
      return JSON.parse(item.meta);
    } catch {
      return {};
    }
  };

  const listPatternMemories = async (query = "") => {
    if (!window.TrackerLensAiRuntimeStore?.listMemory) return [];
    const records = await window.TrackerLensAiRuntimeStore.listMemory({
      scope: "workspace",
      workspaceId: currentWorkspaceId() || "runtime",
      agentId: "flow-map-agent",
      query,
      limit: 100,
    }).catch(() => []);
    return records
      .filter((item) => ["flow-chat-approved-pattern", "flow-chat-rejected-pattern"].includes(item.kind))
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
  };

  const canLearnFromMessage = (message = {}) =>
    message.role === "assistant" &&
    ["plan", "agent-report", "text"].includes(message.kind) &&
    !message.feedback?.rating;

  const canImproveMessage = (message = {}) =>
    message.role === "assistant" &&
    ["plan", "agent-report", "text"].includes(message.kind);

  const updateMessageFeedback = async (messageId = "", feedback = {}) => {
    const messages = activeMessages().map((item) =>
      item.id === messageId
        ? {
          ...item,
          feedback: feedback
            ? { ...(item.feedback || {}), ...feedback, updatedAt: flowPromptNow() }
            : null,
        }
        : item
    );
    draft.activeChat = {
      ...draft.activeChat,
      messages,
      updatedAt: flowPromptNow(),
    };
    await persistActiveChat();
  };

  const forgetMessageMemory = async (message = {}) => {
    if (!message?.id || draft.busy) return;
    draft.busy = true;
    draft.error = "";
    setActivity({
      label: "Rimuovo memoria",
      detail: "Sto eliminando il pattern confermato dalla memoria workspace.",
      steps: ["Identificazione memoria", "Forget workspace", "Aggiornamento chat"],
    });
    try {
      const prompt = message.feedback?.prompt || promptBeforeMessage(message.id);
      const payload = flowPromptApprovedMessageMemoryPayload({ message, prompt });
      const stableName = payload ? [
        payload.kind,
        prompt || message.content || "",
        (payload.meta?.nodes || []).join("-"),
        (payload.meta?.edges || []).join("-"),
      ].join(" ").slice(0, 220) : "";
      const fallbackId = payload ? [
        "mem",
        "workspace",
        currentWorkspaceId() || "runtime",
        "flow-map-agent",
        payload.kind,
        stableName,
      ].map((value) => safeRuntimeId(value)).filter(Boolean).join("_") : "";
      const memoryIds = [...new Set([message.feedback?.memoryId, fallbackId].filter(Boolean))];
      if (window.TrackerLensAiRuntimeStore?.forgetMemory) {
        for (const id of memoryIds) {
          await window.TrackerLensAiRuntimeStore.forgetMemory(id).catch(() => null);
        }
      }
      await updateMessageFeedback(message.id, null);
    } catch (error) {
      draft.error = error?.message || "Errore rimozione memoria Flow Chat.";
    } finally {
      draft.busy = false;
      draft.activity = null;
      refresh();
    }
  };

  const learnFromMessage = async (message = {}, rating = "approved") => {
    if (!message?.id || draft.busy) return;
    draft.busy = true;
    draft.error = "";
    setActivity({
      label: rating === "approved" ? "Memorizzo pattern" : "Registro feedback",
      detail: rating === "approved"
        ? "Sto salvando questa risposta come pattern confermato del workspace."
        : "Sto marcando questa risposta come non riutilizzabile.",
      steps: rating === "approved"
        ? ["Feedback esplicito", "Memoria workspace", "Aggiornamento chat"]
        : ["Feedback esplicito", "Memoria negativa", "Aggiornamento chat"],
    });
    try {
      const prompt = promptBeforeMessage(message.id);
      const saved = rating === "approved"
        ? await flowPromptRememberApprovedMessage({ message, prompt })
        : await flowPromptRememberRejectedMessage({ message, prompt });
      await updateMessageFeedback(message.id, {
        rating,
        memoryId: saved?.id || "",
        prompt,
      });
    } catch (error) {
      draft.error = error?.message || "Errore salvataggio feedback Flow Chat.";
    } finally {
      draft.busy = false;
      draft.activity = null;
      refresh();
    }
  };

  const refresh = () => {
    const asideRoot = document.querySelector("[data-flow-prompt-aside]");
    const root = document.querySelector("[data-flow-prompt-chat]");
    if (asideRoot) asideRoot.replaceChildren(...renderAsideShell());
    else if (root) root.replaceChildren(...renderContentBody());
    else return;
    requestAnimationFrame(() => {
      const currentRoot = document.querySelector("[data-flow-prompt-chat]");
      const timeline = currentRoot?.querySelector(".tl-flow-prompt-thread");
      if (timeline) timeline.scrollTop = timeline.scrollHeight;
    });
  };

  const setActivity = (activity = null) => {
    draft.activity = activity ? {
      title: "AI Flow Agent",
      label: "",
      detail: "",
      steps: [],
      startedAt: flowPromptNow(),
      ...activity,
      updatedAt: flowPromptNow(),
    } : null;
    refresh();
  };

  const plannerProgressActivity = (progress = {}) => {
    const attempt = progress.attempt || 1;
    const maxAttempts = progress.maxAttempts || 3;
    const repairStep = attempt > 1 ? `Self repair ${attempt - 1}/${Math.max(1, maxAttempts - 1)}` : "Prima generazione JSON";
    return {
      label: progress.label || "Planner AI",
      detail: progress.detail || "Sto preparando un piano validabile.",
      steps: [
        "Lettura Brain, RAG e memoria",
        repairStep,
        progress.phase === "fallback" ? "Fallback locale" : "Preflight reale",
        progress.phase === "validated" ? "Piano validato" : "Correzione in corso",
      ],
    };
  };

  const loadHistory = async () => {
    draft.loadingHistory = true;
    refresh();
    try {
      draft.chats = await flowPromptListChats(draft.workspaceId);
      setActiveChat(draft.chats[0] || flowPromptNewChat(draft.workspaceId));
    } catch (error) {
      draft.error = error?.message || "Errore caricamento storico AI Flow Chat.";
    } finally {
      draft.loadingHistory = false;
      refresh();
    }
  };

  const startNewChat = async () => {
    setActiveChat(flowPromptNewChat(draft.workspaceId));
    draft.view = "chat";
    refresh();
  };

  const dismissIntro = () => {
    if (draft.activeChat?.id) draft.dismissedIntroChatIds.add(draft.activeChat.id);
    refresh();
  };

  const deleteChat = async (chat, event) => {
    event?.stopPropagation?.();
    if (!chat?.id || draft.busy) return;
    const confirmed = window.confirm(`Eliminare la chat "${chat.title || "Chat"}"?`);
    if (!confirmed) return;
    draft.error = "";
    try {
      await flowPromptDeleteChat(chat.id);
      draft.chats = draft.chats.filter((item) => item.id !== chat.id);
      if (draft.activeChat?.id === chat.id) {
        setActiveChat(draft.chats[0] || flowPromptNewChat(draft.workspaceId));
      }
    } catch (error) {
      draft.error = error?.message || "Errore eliminazione chat.";
    }
    refresh();
  };

  const appendAiResponseForPrompt = async (prompt = "", { refinedFrom = "", promptForBrain = "", forceAgentReport = false } = {}) => {
    const effectivePrompt = String(prompt || "").trim();
    if (!effectivePrompt) return null;
    const conversationContext = flowPromptConversationContext(activeMessages(), effectivePrompt);
    if (forceAgentReport || flowPromptIsAgentQuestion(effectivePrompt)) {
      const report = await flowPromptBuildAgentReport(effectivePrompt, { promptForBrain, conversationContext });
      if (refinedFrom) {
        report.refinedFrom = refinedFrom;
        report.debug = { ...(report.debug || {}), refinedFrom };
      }
      draft.analysis = null;
      return appendMessage({
        role: "assistant",
        kind: "agent-report",
        content: report.content,
        agentReport: report,
        refinedFrom,
      });
    }
    if (!flowPromptShouldPlanFromPrompt(effectivePrompt, conversationContext)) {
      const reply = await flowPromptBuildConversationalReply(effectivePrompt, { conversationContext });
      draft.analysis = null;
      return appendMessage({
        role: "assistant",
        kind: "text",
        content: reply,
        refinedFrom,
      });
    }
    draft.analysis = flowPromptAnalyzePlan(await flowPromptBuildPlanWithAiFallback(effectivePrompt, {
      conversationContext,
      onProgress: (progress) => setActivity(plannerProgressActivity(progress)),
    }));
    return appendMessage({
      role: "assistant",
      kind: "plan",
      content: draft.analysis.planner?.mode === "fallback" && draft.analysis.planner?.error
        ? `${draft.analysis.summary || "Piano generato."}\n\nAvviso AI: ${draft.analysis.planner.error}\nUso il fallback locale per continuare.`
        : draft.analysis.summary || "Piano generato.",
      plan: flowPromptPlanSnapshot(draft.analysis),
      refinedFrom,
    });
  };

  const improveMessage = async (message = {}) => {
    if (!message?.id || draft.busy) return;
    const originalPrompt = promptBeforeMessage(message.id);
    if (!originalPrompt) {
      draft.error = "Non trovo il prompt utente precedente per migliorare questa risposta.";
      refresh();
      return;
    }
    const lang = flowPromptQuestionLanguage(originalPrompt);
    const localizedImprove = {
      en: [
        "Improve the previous answer while keeping the same intent and the same language as the user question.",
        "Be more precise, operational, and consistent with Trackers Lens.",
        "Do not create a flow if the original question was an explanation or advice.",
        message.content ? `Previous answer to improve: ${message.content}` : "",
      ],
      es: [
        "Mejora la respuesta anterior manteniendo la misma intencion y el mismo idioma de la pregunta.",
        "Se mas preciso, operativo y coherente con Trackers Lens.",
        "No crees un flow si la pregunta original era una explicacion o un consejo.",
        message.content ? `Respuesta anterior a mejorar: ${message.content}` : "",
      ],
      fr: [
        "Ameliore la reponse precedente en gardant la meme intention et la meme langue que la question.",
        "Sois plus precis, operationnel et coherent avec Trackers Lens.",
        "Ne cree pas de flow si la question originale etait une explication ou un conseil.",
        message.content ? `Reponse precedente a ameliorer: ${message.content}` : "",
      ],
      de: [
        "Verbessere die vorherige Antwort mit derselben Absicht und derselben Sprache wie die Frage.",
        "Sei praziser, operativer und konsistent mit Trackers Lens.",
        "Erstelle keinen Flow, wenn die ursprungliche Frage eine Erklarung oder Empfehlung war.",
        message.content ? `Vorherige Antwort zur Verbesserung: ${message.content}` : "",
      ],
      it: [
        "Migliora la risposta precedente mantenendo la stessa intenzione e la stessa lingua della domanda.",
        "Sii piu preciso, operativo e coerente con Trackers Lens.",
        "Non creare un flow se la domanda era una spiegazione o un consiglio.",
        message.content ? `Risposta precedente da migliorare: ${message.content}` : "",
      ],
    };
    const improvementInstruction = localizedImprove[lang] || localizedImprove.it;
    const improvementPrompt = [
      originalPrompt,
      "",
      ...improvementInstruction,
    ].filter(Boolean).join("\n");
    draft.busy = true;
    draft.error = "";
    setActivity({
      label: "Miglioro risposta",
      detail: "Sto rigenerando con Brain, RAG e memoria aggiornati.",
      steps: ["Prompt originale", "Contesto Brain", "Nuova risposta"],
    });
    try {
      await appendAiResponseForPrompt(originalPrompt, {
        refinedFrom: message.id,
        promptForBrain: improvementPrompt,
        forceAgentReport: message.kind === "agent-report",
      });
    } catch (error) {
      draft.error = error?.message || "Errore miglioramento risposta Flow Chat.";
    } finally {
      draft.busy = false;
      draft.activity = null;
      refresh();
    }
  };

  const useMessageAsTemplate = (message = {}) => {
    const prompt = promptBeforeMessage(message.id);
    draft.prompt = [
      prompt || "",
      message.content ? `\nUsa questa risposta come template Trackers Lens:\n${message.content}` : "",
    ].filter(Boolean).join("\n").trim();
    focusPromptDraft();
  };

  const createFlowFromMessage = async (message = {}) => {
    if (!message?.id || draft.busy) return;
    if (message.kind === "plan" && message.plan) {
      await createPlanSnapshot(message.plan);
      return;
    }
    const sourcePrompt = promptBeforeMessage(message.id);
    const content = String(message.content || "").trim();
    const prompt = [
      "crea un flow operativo da questa risposta Trackers Lens.",
      sourcePrompt ? `Richiesta originale: ${sourcePrompt}` : "",
      content ? `Risposta sorgente: ${content}` : "",
      "Usa solo nodi palette reali, porte IN/OUT valide e collegamenti espliciti.",
    ].filter(Boolean).join("\n");
    await analyze(prompt);
  };

  const makeMessageOperational = async (message = {}) => {
    if (!message?.id || draft.busy) return;
    const originalPrompt = promptBeforeMessage(message.id);
    if (!originalPrompt) {
      draft.error = "Non trovo il prompt utente precedente per rendere operativa questa risposta.";
      refresh();
      return;
    }
    const lang = flowPromptQuestionLanguage(originalPrompt);
    const language = flowPromptLanguageName(lang);
    const operationalPrompt = [
      originalPrompt,
      "",
      `Rewrite the previous answer in ${language}, keeping the original intent.`,
      "Make it operational for Trackers Lens: include recommended palette nodes, IN/OUT ports, links, technical reason, and when to use each part.",
      "Do not create or apply the flow automatically. Return professional guidance first.",
      message.content ? `Previous answer: ${message.content}` : "",
    ].filter(Boolean).join("\n");
    draft.busy = true;
    draft.error = "";
    setActivity({
      label: "Rendo operativa",
      detail: "Sto trasformando la risposta in istruzioni tecniche con nodi, porte e link.",
      steps: ["Prompt originale", "Contesto operativo", "Risposta strutturata"],
    });
    try {
      await appendAiResponseForPrompt(originalPrompt, {
        refinedFrom: message.id,
        promptForBrain: operationalPrompt,
        forceAgentReport: true,
      });
    } catch (error) {
      draft.error = error?.message || "Errore trasformazione operativa Flow Chat.";
    } finally {
      draft.busy = false;
      draft.activity = null;
      refresh();
    }
  };

  const openSavedPatternsDialog = async () => {
    let query = "";
    let patterns = await listPatternMemories(query);
    let dialog = null;
    const renderPatternRow = (item = {}) => {
      const meta = patternMemoryMeta(item);
      const nodes = Array.isArray(meta.nodes) ? meta.nodes : [];
      const edges = Array.isArray(meta.edges) ? meta.edges : [];
      const prompt = meta.prompt || "";
      const rejected = item.kind === "flow-chat-rejected-pattern";
      return _.div(
        { class: `tl-flow-prompt-pattern-row${rejected ? " is-rejected" : ""}` },
        _.span({ class: "tl-flow-prompt-pattern-icon" }, icon(rejected ? "block" : meta.messageKind === "plan" ? "account_tree" : "memory", "sm")),
        _.div(
          { class: "tl-flow-prompt-pattern-main" },
          _.strong(item.name || "Pattern Flow Chat"),
          _.p(item.summary || item.text || ""),
          _.div(
            { class: "tl-flow-prompt-pattern-meta" },
            nodes.length ? _.code(`${nodes.length} nodi`) : null,
            edges.length ? _.code(`${edges.length} link`) : null,
            _.code(rejected ? "Non usare" : "Approvato"),
            meta.messageKind ? _.code(meta.messageKind) : null,
            item.updatedAt ? _.time(new Date(item.updatedAt).toLocaleString()) : null
          )
        ),
        _.div(
          { class: "tl-flow-prompt-pattern-actions" },
          rejected ? null : btn({
            class: "is-ghost is-icon-only",
            "aria-label": "Usa pattern",
            title: "Carica questo pattern nel prompt",
            onclick: () => {
              draft.prompt = prompt || item.text || item.summary || "";
              dialog?.close?.();
              focusPromptDraft();
            },
          }, icon("input", "sm")),
          rejected ? null : btn({
            class: "is-ghost is-icon-only",
            "aria-label": "Crea flow da pattern",
            title: "Prepara un flow da questo pattern",
            onclick: () => {
              dialog?.close?.();
              analyze(`crea un flow professionale da questo pattern salvato:\n${item.text || item.summary || prompt}`);
            },
          }, icon("add_link", "sm")),
          btn({
            class: "is-ghost is-danger is-icon-only",
            "aria-label": "Elimina pattern",
            title: rejected ? "Elimina questa memoria negativa" : "Elimina questo pattern dalla memoria",
            onclick: async () => {
              if (!window.confirm(rejected ? "Eliminare questa memoria negativa?" : "Eliminare questo pattern salvato?")) return;
              await window.TrackerLensAiRuntimeStore?.forgetMemory?.(item.id);
              patterns = await listPatternMemories(query);
              refreshDialog();
              refresh();
            },
          }, icon("delete", "sm"))
        )
      );
    };
    const renderBody = () => _.div(
      { class: "tl-flow-prompt-pattern-dialog-body" },
      _.label(
        { class: "tl-flow-prompt-pattern-search" },
        icon("search", "sm"),
        _.input({
          type: "search",
          value: query,
          placeholder: "Cerca pattern salvati o rifiutati...",
          oninput: async (event) => {
            query = event.currentTarget.value || "";
            patterns = await listPatternMemories(query);
            refreshDialog();
          },
        })
      ),
      _.div(
        { class: "tl-flow-prompt-pattern-list" },
        ...(patterns.length
          ? patterns.map(renderPatternRow)
          : [_.p({ class: "tl-flow-prompt-inventory-empty" }, "Nessun pattern salvato o rifiutato per questa Flow Map.")])
      )
    );
    const refreshDialog = () => {
      const host = document.querySelector("[data-flow-prompt-pattern-dialog]");
      if (host) host.replaceChildren(renderBody());
    };
    dialog = _.Dialog({
      class: "tl-flow-prompt-pattern-dialog",
      panelClass: "tl-flow-prompt-pattern-dialog-panel",
      size: "lg",
      title: "Pattern salvati",
      subtitle: "Memorie approvate e rifiutate da AI Flow Chat.",
      icon: "memory",
      closeButton: true,
      scrollable: true,
      bodyMaxHeight: "68vh",
      content: () => _.div({ "data-flow-prompt-pattern-dialog": "true" }, renderBody()),
      actions: ({ close }) => _.Toolbar(
        { align: "end", gap: 8 },
        btn({
          onclick: async () => {
            patterns = await listPatternMemories(query);
            refreshDialog();
          },
        }, icon("refresh", "sm"), "Aggiorna"),
        btn({ onclick: close }, "Chiudi")
      ),
    });
    dialog.open();
  };

  const latestPlanMessage = () =>
    [...activeMessages()].reverse().find((message) => message.kind === "plan" && message.plan) || null;

  const applyLastPlanFromPrompt = async (prompt = "", intent = "prepare") => {
    const lastPlan = latestPlanMessage();
    if (!lastPlan?.plan) {
      draft.analysis = null;
      await appendMessage({
        role: "assistant",
        kind: "error",
        content: "Non trovo un piano precedente da usare. Genera prima un piano, poi posso applicarlo o prepararlo.",
      });
      return true;
    }
    draft.analysis = flowPromptAnalyzePlan(planFromSnapshot(lastPlan.plan));
    const preflight = flowPromptPlanPreflight(draft.analysis);
    if (!preflight.ok) {
      await appendMessage({
        role: "assistant",
        kind: "error",
        content: `Ho recuperato l'ultimo piano, ma non posso applicarlo perche non passa il controllo attuale.\n${preflight.summary}\n${preflight.blockers.join("\n")}`,
      });
      return true;
    }
    if (intent === "apply") {
      setActivity({
        label: "Uso l'ultimo piano",
        detail: "Ho recuperato il piano valido dalla chat e lo applico con preflight e undo snapshot.",
        steps: ["Recupero piano", "Preflight", "Create flow"],
      });
      await create();
      return true;
    }
    await appendMessage({
      role: "assistant",
      kind: "plan",
      content: "Ho recuperato l'ultimo piano valido dalla chat. Pronto per Crea flow.",
      plan: flowPromptPlanSnapshot(draft.analysis),
    });
    return true;
  };

  const analyze = async (promptOverride = null) => {
    draft.error = "";
    const prompt = String(promptOverride ?? draft.prompt ?? "").trim();
    if (!prompt) {
      draft.error = "Scrivi un prompt per generare nodi e collegamenti.";
      refresh();
      return;
    }
    draft.busy = true;
    setActivity({
      label: "Prompt inviato",
      detail: "Sto registrando la richiesta nella chat.",
      steps: ["Ricezione prompt", "Salvataggio nello storico"],
    });
    draft.result = null;
    try {
      await appendMessage({ role: "user", kind: "prompt", content: prompt });
      const conversationContext = flowPromptConversationContext(activeMessages(), prompt);
      setActivity({
        label: "Analisi richiesta",
        detail: "Sto decidendo se usare i comandi Flow Map o il planner di creazione.",
        steps: ["Prompt ricevuto", "Classificazione intento"],
      });
      const lastPlanActionIntent = flowPromptLastPlanActionIntent(prompt);
      if (lastPlanActionIntent) {
        setActivity({
          label: lastPlanActionIntent === "apply" ? "Applico piano" : "Recupero piano",
          detail: "Sto cercando l'ultimo piano valido nella conversazione.",
          steps: ["Ultimo piano", "Preflight", lastPlanActionIntent === "apply" ? "Create flow" : "Piano pronto"],
        });
        await applyLastPlanFromPrompt(prompt, lastPlanActionIntent);
        draft.prompt = "";
        setActivity(null);
        return;
      }
      const preference = flowPromptExtractPreferenceMemory(prompt);
      if (preference) {
        setActivity({
          label: "Memorizzo preferenza",
          detail: "Sto salvando una preferenza workspace confermata nella memoria AI.",
          steps: ["Preferenza esplicita", "Salvataggio memoria", "Conferma chat"],
        });
        const saved = await flowPromptRememberPreference(prompt);
        draft.analysis = null;
        await appendMessage({
          role: "assistant",
          kind: "agent-report",
          content: saved
            ? `Memorizzato: ${preference.text}`
            : "Non sono riuscito a salvare la preferenza nella memoria AI.",
          agentReport: {
            kind: "memory-preference",
            intent: "memory",
            content: saved ? `Memorizzato: ${preference.text}` : "Memoria AI non disponibile.",
            memory: saved ? [saved] : [],
            debug: { preference, saved },
          },
        });
        draft.prompt = "";
        setActivity(null);
        return;
      }
      if (flowPromptIsAgentQuestion(prompt)) {
        setActivity({
          label: "Leggo il runtime",
          detail: "Sto raccogliendo nodi, collegamenti, canali, eventi e log del workspace.",
          steps: ["Inventario Flow Map", "Query runtime scoped", "Diagnostica strutturale"],
        });
        const report = await flowPromptBuildAgentReport(prompt, { conversationContext });
        draft.analysis = null;
        await appendMessage({
          role: "assistant",
          kind: "agent-report",
          content: report.content,
          agentReport: report,
        });
        draft.prompt = "";
        setActivity(null);
        return;
      }
      if (!flowPromptShouldPlanFromPrompt(prompt, conversationContext)) {
        setActivity({
          label: "Risposta chat",
          detail: "Sto usando AI Settings per rispondere senza creare nodi.",
          steps: ["Contesto Flow Map", "Provider AI", "Risposta generale"],
        });
        const reply = await flowPromptBuildConversationalReply(prompt, { conversationContext });
        draft.analysis = null;
        await appendMessage({
          role: "assistant",
          kind: "text",
          content: reply,
        });
        draft.prompt = "";
        setActivity(null);
        return;
      }
      setActivity({
        label: "Creo il piano",
        detail: "Sto controllando nodi esistenti e preparando il piano con AI Settings.",
        steps: ["Lettura AI Settings", "Planner AI o fallback locale", "Controllo duplicati"],
      });
      draft.analysis = flowPromptAnalyzePlan(await flowPromptBuildPlanWithAiFallback(prompt, {
        conversationContext,
        onProgress: (progress) => setActivity(plannerProgressActivity(progress)),
      }));
      setActivity({
        label: "Piano pronto",
        detail: "Sto preparando il riepilogo con nodi da creare, riusare e collegare.",
        steps: ["Piano normalizzato", "Duplicati verificati", "Risposta in corso"],
      });
      await appendMessage({
        role: "assistant",
        kind: "plan",
        content: draft.analysis.planner?.mode === "fallback" && draft.analysis.planner?.error
          ? `${draft.analysis.summary || "Piano generato."}\n\nAvviso AI: ${draft.analysis.planner.error}\nUso il fallback locale per continuare.`
          : draft.analysis.summary || "Piano generato.",
        plan: flowPromptPlanSnapshot(draft.analysis),
      });
      draft.prompt = "";
      setActivity(null);
    } catch (error) {
      draft.error = error?.message || "Errore salvataggio storico AI Flow Chat.";
    } finally {
      draft.busy = false;
      draft.activity = null;
      refresh();
    }
  };

  const create = async () => {
    if (!draft.analysis) await analyze();
    if (!draft.analysis) return;
    const preflight = flowPromptPlanPreflight(draft.analysis);
    if (!preflight.ok) {
      await appendMessage({
        role: "assistant",
        kind: "error",
        content: `${preflight.summary}\n${preflight.blockers.join("\n")}`,
      }).catch(() => null);
      refresh();
      return;
    }
    draft.busy = true;
    draft.error = "";
    setActivity({
      label: "Applico con controllo",
      detail: "Sto catturando uno snapshot e scrivendo solo nodi/link validati.",
      steps: ["Snapshot undo", "Materializzazione nodi", "Creazione dependency"],
    });
    try {
      const snapshot = await captureAgentSnapshot("Before Flow Chat create");
      draft.result = await flowPromptMaterializePlan(draft.analysis);
      draft.result.snapshotId = snapshot?.id || "";
      draft.result.preflight = preflight;
      draft.result.warnings = preflight.warnings || [];
      draft.result.completion = flowPromptBuildCompletionSummary(draft.analysis, draft.result, preflight);
      setActivity({
        label: "Finalizzo",
        detail: "Sto aggiornando il canvas e salvando il risultato nello storico.",
        steps: ["Runtime aggiornato", "Focus canvas", "Risposta finale"],
      });
      const summary = flowPromptResultSummary(draft.result);
      await appendMessage({
        role: "assistant",
        kind: "result",
        content: summary.warnings?.length
          ? `Flow creato e validato. Warning: ${summary.warnings.length}.`
          : "Flow creato e validato.",
        result: summary,
      });
      draft.analysis = null;
    } catch (error) {
      draft.error = error?.message || "Errore creazione flow da prompt.";
      await appendMessage({
        role: "assistant",
        kind: "error",
        content: draft.error,
      }).catch(() => null);
    } finally {
      draft.busy = false;
      draft.activity = null;
      refresh();
    }
  };

  const captureAgentSnapshot = async (label = "Flow Map Agent apply") => {
    const workspaceId = await ensureRuntimeWorkspaceScope();
    const runtime = window.TrackerLensRuntimeSnapshotStore?.load
      ? await window.TrackerLensRuntimeSnapshotStore.load({ includeConnections: true, workspaceId }).catch(() => null)
      : null;
    return window.TrackerLensTimeTravelStore?.capture
      ? window.TrackerLensTimeTravelStore.capture({
        workspaceId,
        reason: "flow-map-agent-apply",
        label,
        state: runtime,
      }).catch(() => null)
      : null;
  };

  const restoreAgentSnapshot = async (snapshotId = "") => {
    if (!snapshotId || draft.busy || !window.TrackerLensTimeTravelStore?.restore) return;
    draft.busy = true;
    draft.error = "";
    setActivity({
      label: "Ripristino snapshot",
      detail: "Sto tornando allo stato precedente all'apply.",
      steps: ["Lettura snapshot", "Restore runtime graph", "Refresh Flow Map"],
    });
    try {
      await window.TrackerLensTimeTravelStore.restore({
        snapshotId,
        stores: ["channels", "flows", "runtimeNodes", "runtimeDependencies", "connections"],
      });
      await loadRuntime({ force: true });
      await appendMessage({
        role: "assistant",
        kind: "result",
        content: "Snapshot ripristinato. Ho riportato il Flow Map allo stato precedente all'apply.",
        result: { createdNodes: 0, reusedNodes: 0, createdEdges: 0, reusedEdges: 0 },
      });
      mount({ preserveScroll: true });
    } catch (error) {
      draft.error = error?.message || "Errore ripristino snapshot.";
      await appendMessage({ role: "assistant", kind: "error", content: draft.error }).catch(() => null);
    } finally {
      draft.busy = false;
      draft.activity = null;
      refresh();
    }
  };

  const focusAgentNode = (nodeId = "") => {
    const node = flowPromptRuntimeNodeById(nodeId);
    if (!node) return;
    setFocusState({
      mode: "dependencies",
      nodeId: node.id,
      nodeType: node.type || "",
      edgeId: "",
      channel: node.channels?.[0] || node.outputs?.[0] || "",
      connectionId: "",
    });
    state.inspectorOpen = true;
    mount({ preserveScroll: true });
  };

  const focusRuntimeNodeOnCanvas = (nodeId = "", { inspector = false } = {}) => {
    const node = flowPromptRuntimeNodeById(nodeId);
    if (!node) return;
    if (typeof bringNodeToFront === "function") bringNodeToFront(node.id);
    setFocusState({
      mode: "dependencies",
      nodeId: node.id,
      nodeType: node.type || "",
      edgeId: "",
      channel: node.channels?.[0] || node.outputs?.[0] || "",
      connectionId: "",
    });
    state.inspectorOpen = Boolean(inspector);
    mount({ preserveScroll: true });
  };

  const retryRuntimeNodeTest = (nodeId = "") => {
    const node = flowPromptRuntimeNodeById(nodeId);
    if (!node || draft.busy) return;
    if (typeof runFlowMapLiveTest === "function") runFlowMapLiveTest(node);
  };

  const assertAgentActionToolReady = (action = {}) => {
    const toolName = flowPromptAgentToolForAction(action);
    const tool = flowPromptAgentTool(toolName);
    if (!tool) {
      throw new Error(`Tool Flow Agent non registrato per azione: ${action.type || "unknown"}`);
    }
    if (tool.status !== "ready") {
      throw new Error(`Tool Flow Agent non disponibile: ${tool.name} (${tool.status}).`);
    }
    if (!tool.mutates) {
      throw new Error(`Tool Flow Agent non mutativo: ${tool.name}.`);
    }
    return tool;
  };

  const flowPromptValidateAgentAction = (action = {}) => {
    const tool = assertAgentActionToolReady(action);
    if (!action || action.status !== "ready") {
      return { ok: false, reason: "Azione non pronta per Apply.", action, tool };
    }
    if (flowPromptActionAlreadyApplied(action)) {
      return { ok: false, reason: "Azione gia applicata nel runtime corrente.", action, tool };
    }
    if (action.type === "connect") {
      const source = flowPromptRuntimeNodeById(action.source?.id || action.sourceNodeId || "");
      const target = flowPromptRuntimeNodeById(action.target?.id || action.targetNodeId || "");
      if (!source) return { ok: false, reason: "Nodo sorgente non trovato.", action, tool };
      if (!target) return { ok: false, reason: "Nodo target non trovato.", action, tool };
      if (!source.outputs?.length && !source.channels?.length) {
        return { ok: false, reason: `${source.label || source.id} non espone output/channel validi.`, action, tool };
      }
      if (!target.inputs?.length) {
        return { ok: false, reason: `${target.label || target.id} non espone input validi.`, action, tool };
      }
      const sourcePort = action.sourcePort || source.outputs?.[0] || source.channels?.[0] || "output";
      const targetPort = action.targetPort || target.inputs?.[0] || "input";
      const channel = action.channel || sourcePort || source.channels?.[0] || "runtime";
      if (flowPromptRuntimeDependencyExists({ ...action, source, target, channel, sourcePort })) {
        return { ok: false, reason: "Il collegamento esiste gia nel runtime corrente.", action, tool };
      }
      return { ok: true, action: { ...action, source, target, sourcePort, targetPort, channel }, tool };
    }
    if (action.type === "renameNode") {
      const node = flowPromptRuntimeNodeById(action.nodeId);
      const nextLabel = String(action.nextLabel || "").trim();
      if (!node) return { ok: false, reason: "Nodo da rinominare non trovato.", action, tool };
      if (!nextLabel) return { ok: false, reason: "Nuovo nome vuoto.", action, tool };
      if (String(node.label || "") === nextLabel) return { ok: false, reason: "Il nodo ha gia questo nome.", action, tool };
      return { ok: true, action: { ...action, node, previousLabel: node.label, nextLabel }, tool };
    }
    if (action.type === "deleteNode") {
      const node = flowPromptRuntimeNodeById(action.nodeId);
      if (!node) return { ok: false, reason: "Nodo da eliminare non trovato.", action, tool };
      const relatedDependencyIds = (state.runtime.dependencies || [])
        .filter((dependency) => dependency.sourceNodeId === node.id || dependency.targetNodeId === node.id)
        .map((dependency) => dependency.id)
        .filter(Boolean);
      return { ok: true, action: { ...action, node, nodeId: node.id, label: node.label || node.id, relatedDependencyIds }, tool };
    }
    if (action.type === "duplicateNode") {
      const node = flowPromptRuntimeNodeById(action.nodeId);
      const nextLabel = String(action.nextLabel || "").trim();
      if (!node) return { ok: false, reason: "Nodo da duplicare non trovato.", action, tool };
      if (!nextLabel) return { ok: false, reason: "Nome duplicato vuoto.", action, tool };
      const duplicateExists = (state.runtime.nodes || []).some((item) =>
        (String(item.label || "") === nextLabel && item.metadata?.duplicatedFrom === node.id) ||
        (action.newNodeId && item.id === action.newNodeId)
      );
      if (duplicateExists) return { ok: false, reason: "Questo duplicato esiste gia.", action, tool };
      return { ok: true, action: { ...action, node, nodeId: node.id, nextLabel }, tool };
    }
    if (action.type === "moveNode") {
      const node = flowPromptRuntimeNodeById(action.nodeId);
      const nextPosition = action.nextPosition || {};
      if (!node) return { ok: false, reason: "Nodo da spostare non trovato.", action, tool };
      if (!Number.isFinite(flowWorldNumber(nextPosition.x, NaN)) || !Number.isFinite(flowWorldNumber(nextPosition.y, NaN))) {
        return { ok: false, reason: "Posizione target non valida.", action, tool };
      }
      return { ok: true, action: { ...action, node, nodeId: node.id, nextPosition }, tool };
    }
    if (action.type === "updateNodeConfig") {
      const node = flowPromptRuntimeNodeById(action.nodeId);
      const value = String(action.value || "").trim();
      const field = flowPromptNormalizeConfigFieldName(action.field);
      if (!node) return { ok: false, reason: "Nodo da aggiornare non trovato.", action, tool };
      if (!value) return { ok: false, reason: "Valore configurazione vuoto.", action, tool };
      const target = action.target || "config";
      if (target === "config" && field === "endpoint") {
        const validation = flowPromptValidateEndpointCandidate({
          value,
          method: node.metadata?.config?.method || "GET",
        });
        if (!validation.ok) return { ok: false, reason: validation.reason, action: { ...action, validation }, tool };
        return { ok: true, action: { ...action, node, field, target, value: validation.endpoint, validation }, tool };
      }
      return { ok: true, action: { ...action, node, field, target }, tool };
    }
    if (action.type === "deleteDependencies") {
      const ids = (action.dependencyIds || []).filter(Boolean);
      const existingIds = ids.filter((id) =>
        (state.runtime.dependencies || []).some((dependency) => dependency.id === id)
      );
      if (!ids.length) return { ok: false, reason: "Nessun collegamento indicato per la rimozione.", action, tool };
      if (!existingIds.length) return { ok: false, reason: "I collegamenti sono gia stati rimossi.", action, tool };
      return { ok: true, action: { ...action, dependencyIds: existingIds }, tool };
    }
    return { ok: false, reason: `Azione non supportata dall'executor: ${action.type || "unknown"}.`, action, tool };
  };

  const applySingleAgentAction = async (action = {}) => {
    assertAgentActionToolReady(action);
    if (action.type === "connect") {
      const workspaceId = await ensureRuntimeWorkspaceScope();
      const dependency = {
        id: `dep_agent_${safeRuntimeId(workspaceId)}_${safeRuntimeId(action.source.id)}_${safeRuntimeId(action.target.id)}_${Date.now()}`,
        workspaceId,
        sourceNodeId: action.source.id,
        targetNodeId: action.target.id,
        sourceType: action.source.type || "node",
        targetType: action.target.type || "node",
        channel: action.channel || action.sourcePort || "runtime",
        connectionId: `flow_agent_${Date.now()}`,
        status: "active",
        metadata: {
          sourcePort: action.sourcePort || "output",
          targetPort: action.targetPort || "input",
          generatedBy: "flow-map-agent",
        },
        createdAt: new Date().toISOString(),
      };
      await window.TrackerLensRuntimeGraphStore?.upsertDependency?.({ dependency });
      const connection = await flowPromptPersistConnection({
        dependency,
        source: action.source,
        target: action.target,
        workspaceId,
      });
      if (connection) {
        state.connections = [
          ...(state.connections || []).filter((item) => item.id !== connection.id),
          connection,
        ];
      }
      return { type: "connect", label: `${action.source.label} -> ${action.target.label}`, focusNodeId: action.target.id };
    }

    if (action.type === "renameNode") {
      const node = flowPromptRuntimeNodeById(action.nodeId);
      if (!node) throw new Error(`Nodo non trovato: ${action.nodeId}`);
      await window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode?.({
        node: { ...node, label: action.nextLabel, updatedAt: new Date().toISOString() },
      });
      return { type: "renameNode", label: `${action.previousLabel} -> ${action.nextLabel}`, focusNodeId: node.id };
    }

    if (action.type === "deleteNode") {
      const node = flowPromptRuntimeNodeById(action.nodeId);
      if (!node) throw new Error(`Nodo non trovato: ${action.nodeId}`);
      const workspaceId = node.workspaceId || await ensureRuntimeWorkspaceScope();
      await window.TrackerLensRuntimeGraphStore?.deleteRuntimeNodeReferences?.({
        nodeId: node.id,
        workspaceId,
      });
      await window.TrackerLensEventLogStore?.cleanupNodeReferences?.({
        nodeIds: [node.id],
        workspaceId,
      }).catch(() => null);
      await window.TrackerLensChannelRegistry?.cleanupNodeReferences?.({
        nodeId: node.id,
        workspaceId,
      }).catch(() => null);
      return {
        type: "deleteNode",
        label: `${node.label || node.id} eliminato`,
        deletedNodeId: node.id,
        removedDependencies: action.relatedDependencyIds?.length || 0,
      };
    }

    if (action.type === "duplicateNode") {
      const node = flowPromptRuntimeNodeById(action.nodeId);
      if (!node) throw new Error(`Nodo non trovato: ${action.nodeId}`);
      const workspaceId = node.workspaceId || await ensureRuntimeWorkspaceScope();
      const now = new Date().toISOString();
      const basePosition = node.flowPosition || node.position || { x: 0, y: 0 };
      const id = action.newNodeId || `agent_duplicate_${safeRuntimeId(workspaceId)}_${safeRuntimeId(node.type || "node")}_${Date.now()}`;
      const nextNode = {
        ...node,
        id,
        workspaceId,
        label: action.nextLabel,
        sourceRef: id,
        assetId: node.assetId || "",
        flowPosition: {
          x: flowCoordinate(flowWorldNumber(basePosition.x) + 180),
          y: flowCoordinate(flowWorldNumber(basePosition.y) + 120),
          width: flowNodeWidth(basePosition),
        },
        position: { ...(node.position || { x: 1, y: 1 }) },
        runtime: { ...(node.runtime || {}), status: "idle" },
        metadata: {
          ...(node.metadata || {}),
          duplicatedFrom: node.id,
          generatedBy: "flow-map-agent",
        },
        createdAt: now,
        updatedAt: now,
      };
      await window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode?.({ node: nextNode });
      if (window.TrackerLensChannelRegistry?.upsertChannelsForRuntimeNode) {
        await window.TrackerLensChannelRegistry.upsertChannelsForRuntimeNode({ node: nextNode }).catch(() => null);
      }
      return { type: "duplicateNode", label: `${node.label || node.id} duplicato come ${nextNode.label}`, focusNodeId: nextNode.id };
    }

    if (action.type === "moveNode") {
      const node = flowPromptRuntimeNodeById(action.nodeId);
      if (!node) throw new Error(`Nodo non trovato: ${action.nodeId}`);
      const nextNode = {
        ...node,
        flowPosition: {
          x: flowCoordinate(flowWorldNumber(action.nextPosition.x)),
          y: flowCoordinate(flowWorldNumber(action.nextPosition.y)),
          width: flowNodeWidth(action.nextPosition || node.flowPosition || node.position || {}),
        },
        updatedAt: new Date().toISOString(),
      };
      await window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode?.({ node: nextNode });
      return { type: "moveNode", label: `${node.label || node.id} spostato`, focusNodeId: node.id };
    }

    if (action.type === "updateNodeConfig") {
      const node = flowPromptRuntimeNodeById(action.nodeId);
      if (!node) throw new Error(`Nodo non trovato: ${action.nodeId}`);
      const metadata = { ...(node.metadata || {}) };
      const config = { ...(metadata.config || {}) };
      const field = flowPromptNormalizeConfigFieldName(action.field);
      let nextNode = { ...node, metadata: { ...metadata, config } };
      if (action.target === "output") {
        nextNode.outputs = [action.value, ...(node.outputs || []).slice(1)].filter(Boolean);
        nextNode.channels = [...new Set([...(node.channels || []), action.value].filter(Boolean))];
      } else if (action.target === "input") {
        nextNode.inputs = [action.value, ...(node.inputs || []).slice(1)].filter(Boolean);
        nextNode.channels = [...new Set([...(node.channels || []), action.value].filter(Boolean))];
      } else if (action.target === "channel") {
        nextNode.channels = [...new Set([action.value, ...(node.channels || []).slice(1)].filter(Boolean))];
      } else {
        config[field] = action.value;
      }
      nextNode.updatedAt = new Date().toISOString();
      await window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode?.({ node: nextNode });
      if (window.TrackerLensChannelRegistry?.upsertChannelsForRuntimeNode) {
        await window.TrackerLensChannelRegistry.upsertChannelsForRuntimeNode({ node: nextNode }).catch(() => null);
      }
      return { type: "updateNodeConfig", label: `${node.label}: ${field} = ${action.value}`, focusNodeId: node.id };
    }

    if (action.type === "deleteDependencies") {
      const ids = action.dependencyIds || [];
      await window.TrackerLensRuntimeGraphStore?.deleteRecords?.(
        window.TrackerLensRuntimeGraphStore.STORES.runtimeDependencies,
        ids
      );
      return { type: "deleteDependencies", label: `${ids.length} collegamenti rimossi` };
    }

    return { type: action.type || "unknown", label: action.summary || "azione applicata" };
  };

  const applyAgentAction = async (action = {}) => {
    if (!action || draft.busy) return;
    const actions = action.type === "batch" ? (action.actions || []) : [action];
    const runnable = actions.filter((item) => item.status === "ready" && !flowPromptActionAlreadyApplied(item));
    const blockedByTool = runnable.find((item) => {
      const toolName = flowPromptAgentToolForAction(item);
      return !toolName || !flowPromptAgentToolIsReady(toolName);
    });
    if (blockedByTool) {
      const toolName = flowPromptAgentToolForAction(blockedByTool);
      const tool = flowPromptAgentTool(toolName);
      draft.error = tool
        ? `Tool non disponibile: ${tool.label || tool.name} (${tool.status}).`
        : `Tool non registrato per azione: ${blockedByTool.type || "unknown"}.`;
      await appendMessage({
        role: "assistant",
        kind: "error",
        content: draft.error,
      }).catch(() => null);
      refresh();
      return;
    }
    if (!runnable.length || flowPromptEffectiveActionStatus(action) !== "ready") {
      if (flowPromptActionAlreadyApplied(action)) {
        const appliedAt = flowPromptNow();
        action.status = "applied";
        action.appliedAt = action.appliedAt || appliedAt;
        actions.forEach((item) => {
          if (flowPromptActionAlreadyApplied(item)) {
            item.status = "applied";
            item.appliedAt = item.appliedAt || appliedAt;
          }
        });
        await persistActiveChat().catch(() => null);
        refresh();
      }
      return;
    }
    draft.busy = true;
    draft.error = "";
    setActivity({
      label: "Applico modifica",
      detail: "Sto applicando il piano sul runtime graph.",
      steps: ["Validazione step", "Snapshot per step", "Esecuzione azioni", "Refresh Flow Map"],
    });
    try {
      const executionPlan = flowPromptBuildGenericAgentPlan(action, {
        prompt: action.summary || "",
        source: "executor",
      });
      const applied = [];
      const snapshots = [];
      for (const item of runnable) {
        const validation = flowPromptValidateAgentAction(item);
        if (!validation.ok) {
          item.status = "blocked";
          item.validation = validation;
          throw new Error(`${flowPromptPlannerStepTitle(item)} bloccato: ${validation.reason}`);
        }
        const stepTitle = flowPromptPlannerStepTitle(validation.action);
        setActivity({
          label: "Applico modifica",
          detail: stepTitle,
          steps: ["Validazione completata", "Snapshot undo", "Scrittura runtime", "Refresh Flow Map"],
        });
        const stepSnapshot = await captureAgentSnapshot(`${action.summary || "Flow Map Agent apply"} · ${stepTitle}`);
        if (stepSnapshot?.id) snapshots.push(stepSnapshot);
        const result = await applySingleAgentAction(validation.action);
        applied.push({
          ...result,
          stepId: item.stepId || "",
          tool: flowPromptAgentToolForAction(item),
          snapshotId: stepSnapshot?.id || "",
          validation: { ok: true, reason: validation.reason || "validated" },
        });
        await loadRuntime({ force: true });
      }
      const snapshotId = snapshots[0]?.id || "";
      const appliedAt = flowPromptNow();
      action.status = "applied";
      action.appliedAt = appliedAt;
      action.snapshotId = snapshotId;
      action.execution = {
        plan: flowPromptDebugAgentPlan(executionPlan),
        snapshots: snapshots.map((snapshot) => ({ id: snapshot.id, label: snapshot.label || "" })),
        appliedSteps: applied,
      };
      runnable.forEach((item) => {
        item.status = "applied";
        item.appliedAt = appliedAt;
        item.snapshotId = applied.find((result) => result.stepId && result.stepId === item.stepId)?.snapshotId || snapshotId;
      });
      await loadRuntime({ force: true });
      await flowPromptRememberWorkspaceEvent({
        kind: "apply",
        prompt: action.prompt || action.summary || "",
        summary: `Apply completato: ${applied.map((item) => item.label).join("; ")}.`,
        result: { applied, snapshotId },
      });
      await flowPromptRememberAppliedActions({
        prompt: action.prompt || action.summary || "",
        applied,
        actions: runnable,
      });
      await appendMessage({
        role: "assistant",
        kind: "result",
        content: `Apply completato: ${applied.map((item) => item.label).join("; ")}.`,
        result: {
          createdNodes: applied.filter((item) => item.type === "duplicateNode").length,
          reusedNodes: applied.filter((item) => ["renameNode", "updateNodeConfig", "deleteNode", "moveNode"].includes(item.type)).length,
          createdEdges: applied.filter((item) => item.type === "connect").length,
          reusedEdges: 0,
          snapshotId,
          focusNodeId: applied.find((item) => item.focusNodeId)?.focusNodeId || "",
          applied,
          snapshots: snapshots.map((snapshot) => snapshot.id).filter(Boolean),
        },
      });
      mount({ preserveScroll: true });
    } catch (error) {
      draft.error = error?.message || "Errore applicazione piano agente.";
      await persistActiveChat().catch(() => null);
      await appendMessage({ role: "assistant", kind: "error", content: draft.error }).catch(() => null);
    } finally {
      draft.busy = false;
      draft.activity = null;
      refresh();
    }
  };

  const planFromSnapshot = (snapshot = {}) => ({
    prompt: snapshot.summary || "Flow Chat plan",
    summary: snapshot.summary || `Piano: ${snapshot.nodes?.length || 0} nodi e ${snapshot.edges?.length || 0} collegamenti.`,
    planner: snapshot.planner || {},
    nodes: (snapshot.nodes || []).map((node) =>
      flowPromptSpecFromPalette(node.label || "Generated Node", {
        type: node.type || "",
        subtype: node.subtype || "",
        icon: node.icon || "extension",
      })
    ),
    edges: (snapshot.edges || []).map((edge) => ({
      sourceKey: edge.sourceKey || edge.sourceLabel || "",
      targetKey: edge.targetKey || edge.targetLabel || "",
      sourcePort: edge.sourcePort || "",
      targetPort: edge.targetPort || "",
    })).filter((edge) => edge.sourceKey && edge.targetKey),
  });

  const createPlanSnapshot = async (snapshot = {}) => {
    draft.analysis = flowPromptAnalyzePlan(planFromSnapshot(snapshot));
    await create();
  };

  const brainActionPromptForNode = (label = "") => {
    const normalized = flowPromptNormalize(label);
    if (normalized === "agent bridge") return "crea un flow professionale per agenti con task, orchestrator, agent bridge e preview";
    if (normalized === "orchestrator agent") return "crea un flow professionale per agenti con task, orchestrator, agent bridge, split e preview";
    if (normalized === "flow in" || normalized === "flow out") return "crea un flow map componibile con Flow In, Orchestrator Agent, Agent Bridge, Flow Out e Preview";
    if (normalized === "split") return "crea un flow professionale per agenti con task, orchestrator, bridge, split e preview";
    if (normalized === "condition") return "crea un flow professionale per agenti con task, orchestrator, condition e preview";
    if (normalized === "preview") return "crea un flow professionale con task, orchestrator agent, agent bridge e preview";
    return label ? `crea un flow con ${label} e preview` : "";
  };

  const brainQuickActions = (brain = {}, architectureAdvice = null) => {
    const labels = new Set([
      ...(brain?.recommendedNodes || []).map((item) => item.label),
      ...(architectureAdvice?.recommendations || []).map((item) => item.label),
    ].filter(Boolean));
    const actions = [];
    const add = (key, label, prompt, iconName = "ads_click") => {
      if (!prompt || actions.some((item) => item.key === key)) return;
      actions.push({ key, label, prompt, iconName });
    };
    if (labels.has("Agent Bridge") || labels.has("Orchestrator Agent")) {
      add(
        "agent-pattern",
        "Crea pattern agentico",
        "crea un flow professionale per agenti con task, orchestrator, agent bridge, split e preview",
        "hub"
      );
    }
    if (labels.has("Agent Bridge")) {
      add("agent-bridge", "Inserisci Agent Bridge", brainActionPromptForNode("Agent Bridge"), "network_node");
    }
    if (labels.has("Flow In") || labels.has("Flow Out")) {
      add(
        "flow-boundary",
        "Crea boundary Flow In/Out",
        "crea un flow map componibile con Flow In, Orchestrator Agent, Agent Bridge, Flow Out e Preview",
        "account_tree"
      );
    }
    if (labels.has("Split") || labels.has("Condition")) {
      add(
        "routing",
        "Crea routing agentico",
        labels.has("Condition")
          ? "crea un flow professionale per agenti con task, orchestrator, condition e preview"
          : "crea un flow professionale per agenti con task, orchestrator, bridge, split e preview",
        "alt_route"
      );
    }
    return actions.slice(0, 4);
  };

  const planRefinementActions = (plan = {}) => {
    const labels = new Set((plan.nodes || []).map((node) => flowPromptNormalize(node.label || "")));
    const hasAgentBridge = labels.has("agent bridge");
    const hasOrchestrator = labels.has("orchestrator agent");
    const hasSplit = labels.has("split");
    const hasCondition = labels.has("condition");
    const hasFlowBoundary = labels.has("flow in") || labels.has("flow out");
    const hasPreview = labels.has("preview");
    const actions = [];
    const add = (key, label, prompt, iconName = "tune") => {
      if (!prompt || actions.some((item) => item.key === key || item.prompt === prompt)) return;
      actions.push({ key, label, prompt, iconName });
    };

    if ((hasAgentBridge || hasOrchestrator) && !hasFlowBoundary) {
      add(
        "flow-boundary",
        "Aggiungi Flow In/Out",
        "modifica il piano: crea un flow map componibile per agenti con Flow In, Task Node, Orchestrator Agent, Agent Bridge, Split, Flow Out e Preview",
        "account_tree"
      );
    }
    if ((hasAgentBridge || hasOrchestrator) && hasSplit && !hasCondition) {
      add(
        "condition-routing",
        "Usa Condition",
        "modifica il piano: crea un flow professionale per agenti con Task Node, Orchestrator Agent, Agent Bridge, Condition e Preview",
        "alt_route"
      );
    }
    if ((hasAgentBridge || hasOrchestrator) && !hasSplit && !hasCondition) {
      add(
        "split-routing",
        "Aggiungi Split",
        "modifica il piano: crea un flow professionale per agenti con Task Node, Orchestrator Agent, Agent Bridge, Split e Preview",
        "call_split"
      );
    }
    if (hasAgentBridge && (hasSplit || hasCondition)) {
      add(
        "minimal-agent",
        "Semplifica",
        "modifica il piano: crea un flow agentico minimo con Task Node, Orchestrator Agent, Agent Bridge e Preview",
        "compress"
      );
    }
    if (hasPreview && (hasAgentBridge || hasOrchestrator)) {
      add(
        "explain-plan",
        "Spiega prima",
        `spiegami questo piano prima di crearlo: ${plan.summary || "flow agentico con bridge, routing e preview"}`,
        "info"
      );
    }
    return actions.slice(0, 4);
  };

  const renderPlanSnapshot = (plan = {}) => {
    const refinementActions = planRefinementActions(plan);
    const preflight = plan.preflight || null;
    const similarPatterns = plan.similarPatterns || [];
    const memoryGuard = plan.memoryGuard || null;
    const conversationLabel = flowPromptConversationContextLabel(plan.conversationContext);
    const selfRepair = plan.planner?.selfRepair || null;
    const preflightExpanded = Boolean(preflight && (!preflight.ok || preflight.warnings?.length || preflight.blockers?.length));
    const workLead = flowPromptBuildWorkLeadSummary(plan);
    const renderPreflight = () => !preflight ? null : _.details(
      { class: `tl-flow-prompt-preflight is-${preflight.status || "ready"}`, ...(preflightExpanded ? { open: true } : {}) },
      _.summary(
        icon(preflight.ok ? "verified" : "warning", "sm"),
        _.span(
          _.strong(preflight.ok ? "Applica con controllo" : "Controllo bloccato"),
          _.em(preflight.summary || "Validazione piano")
        ),
        icon("expand_more", "sm")
      ),
      _.div(
        { class: "tl-flow-prompt-preflight-body" },
        preflight.whatWillHappen?.length ? _.section(
          _.h4("Cosa fara"),
          ...preflight.whatWillHappen.map((item) => _.span(icon("check_circle", "sm"), item))
        ) : null,
        preflight.checks?.length ? _.section(
          _.h4("Validazioni"),
          ...preflight.checks.map((item) =>
            _.span(
              { class: `is-${item.status || "ok"}` },
              icon(item.status === "blocked" ? "error" : item.status === "warn" ? "warning" : "check_circle", "sm"),
              _.strong(item.label),
              _.em(item.detail || "")
            )
          )
        ) : null,
        preflight.blockers?.length ? _.section(
          _.h4("Blocchi"),
          ...preflight.blockers.map((item) => _.span({ class: "is-blocked" }, icon("error", "sm"), item))
        ) : null,
        preflight.warnings?.length ? _.section(
          _.h4("Rischi / conflitti"),
          ...preflight.warnings.map((item) => _.span({ class: "is-warn" }, icon("warning", "sm"), item))
        ) : null
      )
    );
    const renderSelfRepair = () => !selfRepair?.attempts ? null : _.details(
      { class: "tl-flow-prompt-self-repair" },
      _.summary(
        icon(selfRepair.repaired ? "auto_fix_high" : "fact_check", "sm"),
        _.span(
          _.strong(selfRepair.repaired ? "Self repair" : "Validazione AI"),
          _.em(`${selfRepair.attempts} tentativ${selfRepair.attempts === 1 ? "o" : "i"}${selfRepair.repaired ? " · corretto" : ""}`)
        ),
        icon("expand_more", "sm")
      ),
      _.div(
        { class: "tl-flow-prompt-self-repair-list" },
        ...(selfRepair.log || []).map((item) =>
          _.span(
            { class: item.ok ? "is-ok" : "is-warn" },
            icon(item.ok ? "check_circle" : item.json ? "sync_problem" : "data_object", "sm"),
            _.strong(`Tentativo ${item.attempt}`),
            _.em(item.ok
              ? "JSON e preflight validi"
              : item.json
                ? (item.errors?.[0] || "Preflight da correggere")
                : "JSON non valido")
          )
        )
      )
    );
    const similarPatternPrompt = (pattern = {}) => {
      const lang = flowPromptQuestionLanguage(plan.prompt || draft.prompt || "");
      const lines = lang === "en"
        ? [
          "Create a flow using this approved pattern as reference:",
          pattern.prompt || pattern.text || pattern.name || "",
          pattern.nodes?.length ? `Pattern nodes: ${pattern.nodes.join(", ")}` : "",
          pattern.edges?.length ? `Pattern links: ${pattern.edges.join("; ")}` : "",
        ]
        : [
          "crea un flow usando questo pattern approvato come riferimento:",
          pattern.prompt || pattern.text || pattern.name || "",
          pattern.nodes?.length ? `Nodi pattern: ${pattern.nodes.join(", ")}` : "",
          pattern.edges?.length ? `Link pattern: ${pattern.edges.join("; ")}` : "",
        ];
      return lines.filter(Boolean).join("\n");
    };
    const renderSimilarPatterns = () => !similarPatterns.length ? null : _.details(
      { class: "tl-flow-prompt-pattern-hints" },
      _.summary(
        icon("memory", "sm"),
        _.span(_.strong("Pattern simili"), _.em(`${similarPatterns.length} dalla memoria`)),
        icon("expand_more", "sm")
      ),
      _.div(
        { class: "tl-flow-prompt-pattern-hint-list" },
        ...similarPatterns.map((pattern) =>
          _.div(
            { class: "tl-flow-prompt-pattern-hint" },
            _.span(
              icon("auto_awesome_motion", "sm"),
              _.strong(pattern.name || "Pattern salvato"),
              _.em([
                pattern.nodes?.length ? `${pattern.nodes.length} nodi` : "",
                pattern.edges?.length ? `${pattern.edges.length} link` : "",
                pattern.quality?.label ? `qualita ${pattern.quality.label}` : "",
              ].filter(Boolean).join(" · ") || "pattern")
            ),
            btn({
              class: "is-ghost is-icon-only",
              "aria-label": "Usa pattern simile",
              disabled: draft.busy,
              title: "Rigenera usando questo pattern approvato",
              onclick: () => analyze(similarPatternPrompt(pattern)),
            }, icon("input", "sm"))
          )
        )
      )
    );
    return _.div(
      { class: "tl-flow-prompt-message-plan" },
      _.div(
        { class: `tl-flow-prompt-planner-badge is-${plan.planner?.mode || "local"}` },
        icon(["ai", "ai-brain"].includes(plan.planner?.mode) ? "psychology" : "rule", "sm"),
        _.span(flowPromptPlannerLabel(plan.planner))
      ),
      plan.notice ? _.div(
        { class: "tl-flow-prompt-endpoint-source-warning" },
        icon("warning", "sm"),
        _.span(plan.notice)
      ) : null,
      memoryGuard ? _.div(
        { class: "tl-flow-prompt-endpoint-source-warning is-memory-guard" },
        icon("block", "sm"),
        _.span([
          memoryGuard.excludedByRejection ? `${memoryGuard.excludedByRejection} pattern esclusi dalla memoria negativa` : "",
          memoryGuard.rejectedPatterns ? `${memoryGuard.rejectedPatterns} rifiuti considerati` : "",
        ].filter(Boolean).join(" · ") || "Memoria negativa attiva")
      ) : null,
      conversationLabel ? _.div(
        { class: "tl-flow-prompt-endpoint-source-warning is-conversation-context" },
        icon("forum", "sm"),
        _.span(conversationLabel)
      ) : null,
      renderSelfRepair(),
      _.details(
        { class: "tl-flow-prompt-worklead" },
        _.summary(
          { class: "tl-flow-prompt-worklead-head" },
          icon("assignment_turned_in", "sm"),
          _.span(_.strong("Capo lavoro"), _.em(workLead.next)),
          _.code(workLead.plan),
          icon("expand_more", "sm")
        ),
        _.div(
          { class: "tl-flow-prompt-worklead-rows" },
          _.span(_.strong("Obiettivo"), _.em(workLead.objective)),
          workLead.constraints.length ? _.span(_.strong("Vincoli"), _.em(workLead.constraints.join(" · "))) : null,
          _.span(_.strong("Piano"), _.em(workLead.plan)),
          _.span(_.strong("Verifica"), _.em(workLead.verification))
        )
      ),
      _.div(
        { class: "tl-flow-prompt-mini-grid" },
        _.section(
          _.h4("Nodi"),
          ...(plan.nodes || []).map((node) =>
            _.span({ class: `tl-flow-prompt-mini-row is-${node.action || "create"}` },
              icon(node.icon || "extension", "sm"),
              _.strong(node.label || "Node"),
              _.em(node.action === "reuse" ? "reuse" : "create")
            )
          )
        ),
        _.section(
          _.h4("Links"),
          ...(plan.edges || []).map((edge) =>
            _.span({ class: `tl-flow-prompt-mini-row${edge.duplicate ? " is-reuse" : ""}` },
              icon(edge.duplicate ? "link" : "add_link", "sm"),
              _.strong(`${edge.sourceLabel} -> ${edge.targetLabel}`),
              _.em(edge.duplicate ? "reuse" : `${edge.sourcePort} -> ${edge.targetPort}`)
            )
          )
        )
      ),
      renderPreflight(),
      renderSimilarPatterns(),
      refinementActions.length ? _.details(
        { class: "tl-flow-prompt-plan-options" },
        _.summary(
          icon("tune", "sm"),
          _.span(_.strong("Opzioni"), _.em(`${refinementActions.length} alternative`)),
          icon("expand_more", "sm")
        ),
        _.div(
          { class: "tl-flow-prompt-choice-buttons" },
          ...refinementActions.map((action) =>
            btn({
              class: "is-ghost",
              disabled: draft.busy,
              onclick: () => analyze(action.prompt),
              title: action.prompt,
            }, icon(action.iconName || "tune", "sm"), action.label)
          )
        )
      ) : null,
      (plan.nodes || []).length ? _.div(
        { class: "tl-flow-prompt-plan-actions" },
        btn({
          class: "is-primary",
          disabled: draft.busy || preflight?.ok === false,
          onclick: () => createPlanSnapshot(plan),
        }, icon("add_link", "sm"), "Crea flow")
      ) : null
    );
  };

  const renderInventorySnapshot = (inventory = {}) =>
    _.div(
      { class: "tl-flow-prompt-inventory" },
      _.div(
        { class: "tl-flow-prompt-inventory-grid" },
        _.section(
          _.h4(`Nodi (${inventory.nodes?.length || 0})`),
          ...((inventory.nodes || []).length
            ? inventory.nodes.map((node) =>
              _.div(
                { class: "tl-flow-prompt-inventory-row" },
                icon(node.icon || "extension", "sm"),
                _.span(_.strong(node.label || node.id), _.em(`${node.type} · ${node.subtype} · ${node.status}`)),
                _.code(`${node.inputs.length} IN · ${node.outputs.length} OUT`)
              )
            )
            : [_.p({ class: "tl-flow-prompt-inventory-empty" }, "Nessun nodo nel workspace corrente.")])
        ),
        _.section(
          _.h4(`Collegamenti (${inventory.edges?.length || 0})`),
          ...((inventory.edges || []).length
            ? inventory.edges.map((edge) =>
              _.div(
                { class: "tl-flow-prompt-inventory-row" },
                icon("link", "sm"),
                _.span(_.strong(`${edge.sourceLabel} -> ${edge.targetLabel}`), _.em(edge.channel || "runtime")),
                _.code(`${edge.sourcePort || "out"} -> ${edge.targetPort || "in"}`)
              )
            )
            : [_.p({ class: "tl-flow-prompt-inventory-empty" }, "Nessun collegamento nel workspace corrente.")])
        )
      )
    );

  const renderAgentReport = (report = {}) => {
    const context = report.context || {};
    const diagnostics = report.diagnostics || [];
    const intent = report.intent || "summary";
    const query = report.query || {};
    const queryModel = report.queryModel || {};
    const architectureAdvice = report.architectureAdvice || null;
    const brain = report.brain || null;
    const brainContext = report.brainContext || null;
    const queryItems = query.items || [];
    const pendingAction = report.pendingAction || null;
    const pendingStatus = flowPromptEffectiveActionStatus(pendingAction);
    const compactNatural = Boolean(report.compactNatural || report.debug?.compactNatural);
    const isApplyPlan = !!pendingAction && ["mutation", "connect", "disconnect", "deleteNode", "duplicateNode", "moveNode", "rename", "config", "fix", "fixRuntimeError"].includes(intent);
    const showOverview = !isApplyPlan && !compactNatural;
    const showDiagnostics = !compactNatural && intent === "diagnostics";
    const showChannels = !compactNatural && ["channels", "database"].includes(intent);
    const showRuntime = !compactNatural && ["runtime", "database"].includes(intent);
    const showNodes = !compactNatural && ["nodes", "explain"].includes(intent);
    const showEdges = !compactNatural && ["edges", "explain"].includes(intent);
    const showConfig = !compactNatural && ["config", "database"].includes(intent);
    const showMemory = !compactNatural && intent === "memory";
    const wantsRuntimeErrors = intent === "runtime" && flowPromptNormalize(query.filter) === "error";
    const renderBrain = () => {
      if (!brain && !brainContext) return null;
      const actions = brainQuickActions(brain, architectureAdvice);
      const language = flowPromptLanguageName(flowPromptQuestionLanguage(brainContext?.prompt || report.debug?.prompt || ""));
      const refinedFrom = report.refinedFrom || report.debug?.refinedFrom || "";
      const sourceIds = new Set(brain?.sources || []);
      const ragItems = (brainContext?.rag || [])
        .filter((item) => !sourceIds.size || sourceIds.has(item.id))
        .slice(0, 6);
      const memoryItems = (brainContext?.memory || []).slice(0, 5);
      const providerHealth = brainContext?.selectedRuntime?.providerHealth || null;
      const agentRuntime = brainContext?.selectedRuntime?.agentRuntime || null;
      const uiLang = flowPromptQuestionLanguage(brainContext?.prompt || report.debug?.prompt || "");
      return _.details(
        { class: "tl-flow-prompt-brain-details" },
        _.summary(
          icon(brain?.planner?.mode === "llm-json" ? "psychology" : "rule", "sm"),
          _.span(
            _.strong(flowPromptUiText("brainDetails", uiLang)),
            _.em(`${intent} · ${language} · ${Math.round((brain?.confidence || 0) * 100)}%`)
          ),
          icon("expand_more", "sm")
        ),
        _.div(
          { class: "tl-flow-prompt-brain-body" },
          _.span(
            { class: "tl-flow-prompt-query-card-head" },
            icon(brain?.planner?.mode === "llm-json" ? "psychology" : "rule", "sm"),
            _.strong(brain?.planner?.mode === "llm-json" ? "LLM + RAG" : "Fallback locale"),
            _.code(brain?.planner?.model || brain?.planner?.error || "local")
          ),
          _.div(
            { class: "tl-flow-prompt-query-card-grid" },
            _.span(_.strong(intent), _.em("intent")),
            _.span(_.strong(language), _.em("lingua")),
            brainContext?.isRefinement ? _.span(_.strong("yes"), _.em("refinement")) : null,
            refinedFrom ? _.span(_.strong(refinedFrom.slice(-8)), _.em("refinedFrom")) : null,
            brainContext?.conversationContext?.active ? _.span(_.strong("yes"), _.em("contesto chat")) : null,
            _.span(_.strong(String(brainContext?.rag?.length || 0)), _.em("RAG")),
            _.span(_.strong(String(brainContext?.memory?.length || 0)), _.em("memoria")),
            _.span(_.strong(String(brainContext?.approvedPatterns?.length || 0)), _.em("pattern ok")),
            _.span(_.strong(String(brainContext?.rejectedPatterns?.length || 0)), _.em("pattern no")),
            _.span(_.strong(String(brain?.recommendedNodes?.length || 0)), _.em("nodi validati")),
            _.span(_.strong(String(Math.round((brain?.confidence || 0) * 100))), _.em("confidence"))
          ),
          brain?.planner?.error ? _.small(`AI: ${brain.planner.error}`) : null,
          providerHealth ? _.div(
            { class: "tl-flow-prompt-brain-list" },
            _.em(flowPromptUiText("providerHealth", uiLang)),
            _.span(
              icon(providerHealth.ready ? "check_circle" : "warning", "sm"),
              _.strong(providerHealth.summary || "Provider health"),
              _.code(providerHealth.primary?.model || providerHealth.primary?.issue || "provider")
            ),
            ...((providerHealth.providers || []).slice(0, 4).map((provider) =>
              _.span(
                icon(provider.ready ? "radio_button_checked" : "error", "sm"),
                _.strong(provider.name || provider.id),
                _.code([provider.provider, provider.model || provider.issue || "model"].filter(Boolean).join(" · "))
              )
            ))
          ) : null,
          agentRuntime?.available ? _.div(
            { class: "tl-flow-prompt-brain-list" },
            _.em(flowPromptUiText("agentRuntime", uiLang)),
            _.span(
              icon("smart_toy", "sm"),
              _.strong(`${agentRuntime.summary?.nodes || 0} nodes · ${agentRuntime.summary?.dependencies || 0} links`),
              _.code(agentRuntime.version || "agent-runtime")
            ),
            agentRuntime.trace ? _.span(
              icon(agentRuntime.trace.status === "blocked" ? "warning" : "timeline", "sm"),
              _.strong(`${agentRuntime.trace.mode || "trace"} · ${agentRuntime.trace.steps || 0} steps`),
              _.code(agentRuntime.trace.status || "trace")
            ) : null,
            ...((agentRuntime.fixes || []).slice(0, 4).map((fix) =>
              _.span(
                icon(fix.safe ? "build" : "manage_search", "sm"),
                _.strong(fix.problem || fix.type || "Runtime fix"),
                _.code(fix.safe ? "safe" : "manual")
              )
            ))
          ) : null,
          ragItems.length ? _.div(
            { class: "tl-flow-prompt-brain-list" },
            _.em(flowPromptUiText("ragSources", uiLang)),
            ...ragItems.map((item) =>
              _.span(
                icon(item.source === "docs" ? "article" : "hub", "sm"),
                _.strong(item.title || item.id),
                _.code(item.id)
              )
            )
          ) : null,
          memoryItems.length ? _.div(
            { class: "tl-flow-prompt-brain-list" },
            _.em(flowPromptUiText("memoryRank", uiLang)),
            ...memoryItems.map((item) =>
              _.span(
                icon("memory", "sm"),
                _.strong(item.name || item.kind || "Memory"),
                _.code(item.kind || item.scope || "workspace")
              )
            )
          ) : null,
          brain?.recommendedNodes?.length ? _.div(
            { class: "tl-flow-prompt-brain-list" },
            _.em("Nodi palette validati"),
            ...brain.recommendedNodes.slice(0, 6).map((item) =>
              _.span(
                icon("check_circle", "sm"),
                _.strong(item.label),
                _.code("palette"),
                item.role ? _.small(item.role) : null
              )
            )
          ) : null,
          actions.length ? _.div(
            { class: "tl-flow-prompt-choice-group" },
            _.em("Azioni rapide"),
            _.div(
              { class: "tl-flow-prompt-choice-buttons" },
              ...actions.map((action) =>
                btn({
                  class: "is-ghost",
                  disabled: draft.busy,
                  onclick: () => analyze(action.prompt),
                  title: action.prompt,
                }, icon(action.iconName || "ads_click", "sm"), action.label)
              )
            )
          ) : null
        )
      );
    };
    const renderArchitectureAdvice = () => !architectureAdvice ? null : _.section(
      _.h4("Consiglio architettura"),
      architectureAdvice.pattern ? _.p(_.strong("Pattern: "), architectureAdvice.pattern) : null,
      ...(architectureAdvice.recommendations || []).slice(0, 6).map((item) =>
        _.div(
          { class: "tl-flow-prompt-query-card" },
          _.span(
            { class: "tl-flow-prompt-query-card-head" },
            icon(item.alreadyInWorkspace ? "check_circle" : "add_circle", "sm"),
            _.strong(item.label || "Nodo"),
            _.code(item.alreadyInWorkspace ? "gia presente" : "da inserire")
          ),
          _.div(
            { class: "tl-flow-prompt-query-card-grid" },
            _.span(_.strong(String(item.inputs?.length || 0)), _.em("input")),
            _.span(_.strong(String(item.outputs?.length || 0)), _.em("output")),
            _.span(_.strong(item.role || "-"), _.em("ruolo")),
            _.span(_.strong(item.useWhen || "-"), _.em("quando"))
          ),
          item.reason ? _.small(item.reason) : null,
          item.inputs?.length ? _.small(`IN: ${item.inputs.join(", ")}`) : null,
          item.outputs?.length ? _.small(`OUT: ${item.outputs.join(", ")}`) : null,
          item.nextStep ? _.small(`Step: ${item.nextStep}`) : null
        )
      )
    );
    const renderChoiceGroup = (label = "", choices = []) =>
      choices.length ? _.div(
        { class: "tl-flow-prompt-choice-group" },
        _.em(label),
        _.div(
          { class: "tl-flow-prompt-choice-buttons" },
          ...choices.slice(0, 3).map((choice) =>
            btn({
              class: "is-ghost",
              disabled: draft.busy,
              onclick: () => analyze(choice.prompt),
              title: choice.detail || "",
            }, icon("ads_click", "sm"), choice.label)
          )
        )
      ) : null;
    const renderChoiceButtons = (item = {}) => {
      if (!item.choices?.length) return null;
      const sourceChoices = item.choices.filter((choice) => choice.role === "source");
      const targetChoices = item.choices.filter((choice) => choice.role === "target");
      const otherChoices = item.choices.filter((choice) => !["source", "target"].includes(choice.role));
      return _.div(
        { class: "tl-flow-prompt-choice-list" },
        renderChoiceGroup("Source", sourceChoices),
        renderChoiceGroup("Target", targetChoices),
        renderChoiceGroup("Opzioni", otherChoices)
      );
    };
    const renderEndpointCandidates = (item = {}) => {
      const candidates = (item.candidates || []).filter(Boolean);
      if (!candidates.length) return null;
      const usesAiFallback = candidates.some((candidate) =>
        candidate.researchSource === "ai-fallback" ||
        candidate.sourceConfidence === "ai-fallback" ||
        candidate.discoveryMethod === "ai-fallback"
      );
      return _.div(
        { class: "tl-flow-prompt-endpoint-candidates" },
        usesAiFallback ? _.div(
          { class: "tl-flow-prompt-endpoint-source-warning" },
          icon("warning", "sm"),
          _.span("Fallback AI usata: verifica la documentazione prima di usare questi endpoint.")
        ) : null,
        ...candidates.map((candidate) => {
          const targetLabel = item.node?.label || item.targetNodeId || "REST API";
          const prompt = `imposta endpoint di ${targetLabel} a ${candidate.endpoint}`;
          const verificationStatus = candidate.verification?.status || "not-checked";
          const verificationLabel = verificationStatus === "verified"
            ? "verified"
            : verificationStatus === "http-warning"
              ? "http warning"
              : verificationStatus === "unverified"
                ? "not verified"
                : "not checked";
          return _.div(
            { class: `tl-flow-prompt-endpoint-candidate ${candidate.usable ? "is-usable" : "is-blocked"} is-${verificationStatus}` },
            _.span(
              _.strong(candidate.title || candidate.endpoint),
              _.em(candidate.endpoint),
              _.small(
                { class: "tl-flow-prompt-endpoint-meta" },
                _.code(verificationLabel),
                _.code(candidate.sourceConfidence || "ai-suggested"),
                candidate.researchSource ? _.code(candidate.researchSource) : null,
                candidate.verification?.verifier ? _.code(candidate.verification.verifier) : null,
                candidate.discoveryMethod ? _.code(candidate.discoveryMethod) : null,
                candidate.confidence ? _.code(`confidence: ${candidate.confidence}`) : null
              ),
              candidate.sourceUrl ? _.small(`source: ${candidate.sourceUrl}`) : _.small("source: AI suggestion, verify before production"),
              candidate.apiSpec?.path ? _.small(`openapi: ${candidate.method || "GET"} ${candidate.apiSpec.path}${candidate.apiSpec.operationId ? ` · ${candidate.apiSpec.operationId}` : ""}`) : null,
              candidate.verification?.reason ? _.small(`check: ${candidate.verification.reason}`) : null,
              candidate.reason ? _.small(candidate.reason) : null
            ),
            candidate.usable ? btn({
              class: "is-primary",
              disabled: draft.busy,
              onclick: () => analyze(prompt),
              title: "Prepara Apply con questo URL esplicito",
            }, icon("check", "sm"), "Use") : _.code(candidate.validation?.reason || "non valido")
          );
        })
      );
    };
    const renderDependencyImpact = (item = {}) => {
      const impact = item.impact || null;
      if (!impact) return null;
      const severity = impact.severity || "low";
      return _.div(
        { class: `tl-flow-prompt-impact is-${severity}` },
        _.span(
          icon(severity === "high" ? "report" : severity === "medium" ? "warning" : "info", "sm"),
          _.strong(impact.title || "Impatto runtime"),
          _.code(severity)
        ),
        impact.summary ? _.p(impact.summary) : null,
        impact.items?.length ? _.ul(
          ...impact.items.slice(0, 6).map((item) => _.li(item))
        ) : null
      );
    };
    const renderAgentPlanSteps = () => {
      const agentPlan = report.agentPlan || flowPromptBuildGenericAgentPlan(pendingAction, {
        prompt: report.debug?.prompt || "",
        source: report.debug?.selectedPlan || "local",
      });
      const steps = (agentPlan?.steps || []).filter(Boolean);
      if (!steps.length) {
        return [_.p({ class: "tl-flow-prompt-inventory-empty" }, pendingAction.summary || "Nessuna azione applicabile.")];
      }
      return [
        _.div(
          { class: `tl-flow-prompt-agent-plan-meta is-${agentPlan.status || "blocked"}` },
          _.span(_.strong(agentPlan.planner || "flow-agent-plan"), _.em(`${steps.length} step · ${agentPlan.status || "blocked"}`)),
          _.span((agentPlan.tools || []).map((tool) => tool.name).join(", ") || "no tools")
        ),
        ...steps.map((step) => {
        const action = step.action || {};
        const itemStatus = step.status === "done" ? "applied" : step.status;
        const itemIcon = action.type === "researchEndpoint"
          ? "travel_explore"
          : itemStatus === "ready" || itemStatus === "applied"
            ? "check_circle"
            : "warning";
        const statusLabel = itemStatus === "applied"
          ? "applied"
          : itemStatus === "ready"
            ? (step.mutates ? "ready to apply" : "ready")
            : action.impactOnly
              ? "impact only"
              : action.guardReason === "dependency-confirmation-required"
                ? "needs confirm"
                : action.choices?.length
                  ? "needs choice"
                  : "blocked";
        return _.div(
          { class: `tl-flow-prompt-action-step is-${itemStatus}` },
          _.span({ class: "tl-flow-prompt-step-index" }, String(step.order || "")),
          _.span(
            _.strong(
              icon(itemIcon, "sm"),
              _.span(step.title || action.type || "Step"),
              _.code({ class: `tl-flow-prompt-step-status is-${itemStatus}` }, statusLabel)
            ),
            _.em(step.summary || flowPromptActionSummary(action)),
            _.span(
              { class: "tl-flow-prompt-step-meta" },
              step.tool ? _.code(`${step.tool} · ${step.toolStatus || "unknown"}`) : null,
              step.mutates ? _.small("write") : _.small("read")
            ),
            step.dependsOn?.length ? _.small(`depends on ${step.dependsOn.join(", ")}`) : null,
            renderDependencyImpact(action),
            renderEndpointCandidates(action)
          ),
          renderChoiceButtons(action)
        );
        }),
      ];
    };
    const renderDebugPanel = () => {
      const debug = report.debug || {};
      if (!debug.intent && !debug.localPlan && !debug.normalizedCommand) return null;
      return _.details(
        { class: "tl-flow-prompt-debug-panel" },
        _.summary(
          icon("bug_report", "sm"),
          _.span(
            _.strong("Dev inspector"),
            _.em(`${debug.intent || "intent"} · ${debug.selectedPlan || "no plan"}`)
          ),
          icon("expand_more", "sm")
        ),
        _.pre(JSON.stringify({
          intent: debug.intent,
          metric: debug.metric,
          filter: debug.filter,
          selectedPlan: debug.selectedPlan,
          reason: debug.reason,
          toolRegistry: flowPromptAgentToolManifest(),
          genericPlan: debug.genericPlan || flowPromptDebugAgentPlan(report.agentPlan),
          queryInsights: report.queryInsights || debug.queryInsights,
          queryModel: report.queryModel || debug.queryModel,
          memory: report.memory || debug.memory,
          normalizedCommand: debug.normalizedCommand,
          localPlan: debug.localPlan,
          aiPlan: debug.aiPlan,
        }, null, 2))
      );
    };
    const renderRuntimeRecord = (record = {}) => {
      const status = record.level || record.status || record.severity || "info";
      const isError = ["error", "failed", "failure"].includes(flowPromptNormalize(status));
      const runtimeInsight = (queryModel.runtime?.errorInsights || []).find((item) => item.recordId === record.id)
        || (isError ? flowPromptRuntimeErrorDiagnosis(context, record) : null);
      const title = record.message || record.eventType || record.channel || record.id || "runtime";
      const subtitle = record.nodeId || record.sourceNodeId || record.targetNodeId || record.workspaceId || record.channel || "";
      const timestamp = record.timestamp || record.createdAt || record.updatedAt || record.at || record.time || "";
      const details = [
        ["id", record.id],
        ["workspace", record.workspaceId],
        ["run", record.runId || record.context?.runId],
        ["node", record.nodeId || record.context?.nodeId],
        ["channel", record.channel],
        ["event", record.eventType],
        ["url", record.requestUrl || record.endpoint || record.url || record.context?.requestUrl || record.context?.endpoint || record.context?.url],
        ["method", record.method || record.context?.method],
        ["status", record.status || record.context?.status],
        ["status text", record.statusText || record.context?.statusText],
        ["kind", record.errorKind || record.context?.errorKind],
        ["diagnostic", record.diagnostic || record.context?.diagnostic],
        ["time", timestamp ? new Date(timestamp).toLocaleString() : ""],
      ].filter(([, value]) => value !== undefined && value !== null && value !== "");
      return _.details(
        { class: `tl-flow-prompt-runtime-record ${isError ? "is-error" : "is-info"}` },
        _.summary(
          { title: "Apri dettagli runtime" },
          icon(isError ? "error" : "bolt", "sm"),
          _.span(_.strong(title), _.em(subtitle || "runtime record")),
          _.code(status),
          icon("expand_more", "sm")
        ),
        _.div(
          { class: "tl-flow-prompt-runtime-detail" },
          runtimeInsight ? _.div(
            { class: "tl-flow-prompt-runtime-diagnosis" },
            _.span(
              { class: "tl-flow-prompt-runtime-diagnosis-head" },
              icon("medical_information", "sm"),
              _.strong("Diagnosi runtime"),
              runtimeInsight.kind ? _.code(runtimeInsight.kind) : null
            ),
            _.p(runtimeInsight.cause || "Errore runtime registrato nel flow log."),
            runtimeInsight.suggestion ? _.small(runtimeInsight.suggestion) : null,
            _.div(
              { class: "tl-flow-prompt-runtime-actions" },
              runtimeInsight.nodeId ? btn({
                class: "is-ghost",
                disabled: draft.busy,
                onclick: (event) => {
                  event.preventDefault();
                  focusRuntimeNodeOnCanvas(runtimeInsight.nodeId, { inspector: false });
                },
              }, icon("center_focus_strong", "sm"), "Focus") : null,
              runtimeInsight.canInspect ? btn({
                class: "is-ghost",
                disabled: draft.busy,
                onclick: (event) => {
                  event.preventDefault();
                  focusRuntimeNodeOnCanvas(runtimeInsight.nodeId, { inspector: true });
                },
              }, icon("right_panel_open", "sm"), "Inspector") : null,
              runtimeInsight.canRetry ? btn({
                class: "is-ghost",
                disabled: draft.busy,
                onclick: (event) => {
                  event.preventDefault();
                  retryRuntimeNodeTest(runtimeInsight.nodeId);
                },
              }, icon("play_arrow", "sm"), "Retry") : null,
              runtimeInsight.nodeId ? btn({
                class: "is-ghost",
                disabled: draft.busy,
                onclick: (event) => {
                  event.preventDefault();
                  const recordPart = record.id ? ` record ${record.id}` : "";
                  const nodePart = runtimeInsight.nodeLabel || runtimeInsight.nodeId;
                  analyze(`prepara fix errore runtime${recordPart} per nodo "${nodePart}"`);
                },
              }, icon("build_circle", "sm"), "Prepare Fix") : null,
              runtimeInsight.canPrepareEndpointConfig ? btn({
                class: "is-primary",
                disabled: draft.busy,
                onclick: (event) => {
                  event.preventDefault();
                  analyze(`configura endpoint di ${runtimeInsight.nodeLabel || runtimeInsight.nodeId}`);
                },
              }, icon("edit", "sm"), "Configura URL") : null
            )
          ) : null,
          details.length ? _.div(
            { class: "tl-flow-prompt-runtime-meta" },
            ...details.map(([label, value]) => _.span(_.strong(label), _.em(String(value))))
          ) : null,
          _.pre(JSON.stringify(record, null, 2))
        )
      );
    };
    const renderQueryModelDetails = () => {
      if (compactNatural) return [];
      const sections = [];
      if (brain || brainContext) sections.push(renderBrain());
      if (architectureAdvice) sections.push(renderArchitectureAdvice());
      if ((showNodes || showConfig) && queryModel.nodes?.length) {
        sections.push(_.section(
          _.h4(`Dettaglio nodi (${queryModel.nodes.length})`),
          ...queryModel.nodes.slice(0, 5).map((item) => {
            const node = item.node || {};
            const connectivity = item.connectivity || {};
            const configKeys = Object.keys(item.config || {});
            return _.div(
              { class: "tl-flow-prompt-query-card" },
              _.span(
                { class: "tl-flow-prompt-query-card-head" },
                icon(node.icon || "extension", "sm"),
                _.strong(node.label || node.id || "Node"),
                _.code(node.status || "idle")
              ),
              _.div(
                { class: "tl-flow-prompt-query-card-grid" },
                _.span(_.strong(String(connectivity.incoming?.length || 0)), _.em("in link")),
                _.span(_.strong(String(connectivity.outgoing?.length || 0)), _.em("out link")),
                _.span(_.strong(String(connectivity.channels?.length || 0)), _.em("channels")),
                _.span(_.strong(String(configKeys.length)), _.em("config"))
              ),
              configKeys.length ? _.small(`config: ${configKeys.slice(0, 8).join(", ")}`) : null,
              connectivity.channels?.length ? _.small(`channels: ${connectivity.channels.slice(0, 8).join(", ")}`) : null
            );
          })
        ));
      }
      if ((showChannels || intent === "explain") && queryModel.channels?.length) {
        sections.push(_.section(
          _.h4(`Lineage canali (${queryModel.channels.length})`),
          ...queryModel.channels.slice(0, 8).map((item) =>
            _.div(
              { class: "tl-flow-prompt-query-card" },
              _.span(
                { class: "tl-flow-prompt-query-card-head" },
                icon("hub", "sm"),
                _.strong(item.name || "channel"),
                _.code(item.channel?.status || item.channel?.health || "active")
              ),
              _.div(
                { class: "tl-flow-prompt-query-card-grid" },
                _.span(_.strong(String(item.producers?.length || 0)), _.em("producer")),
                _.span(_.strong(String(item.consumers?.length || 0)), _.em("consumer")),
                _.span(_.strong(String(item.edges?.length || 0)), _.em("link")),
                _.span(_.strong(String(item.recentEvents?.length || 0)), _.em("eventi"))
              ),
              item.producers?.length ? _.small(`produce: ${item.producers.slice(0, 4).map((node) => node.label || node.id).join(", ")}`) : null,
              item.consumers?.length ? _.small(`consume: ${item.consumers.slice(0, 4).map((node) => node.label || node.id).join(", ")}`) : null,
              item.inspect?.references?.length ? _.small(`registry refs: ${item.inspect.references.length}`) : null
            )
          )
        ));
      }
      if (showConfig) {
        const ai = queryModel.settings?.ai || {};
        sections.push(_.section(
          _.h4("Settings e AI Runtime"),
          _.div(
            { class: "tl-flow-prompt-query-card" },
            _.span({ class: "tl-flow-prompt-query-card-head" }, icon("tune", "sm"), _.strong("AI Provider"), _.code(ai.provider || "not set")),
            _.div(
              { class: "tl-flow-prompt-query-card-grid" },
              _.span(_.strong(ai.model || "-"), _.em("model")),
              _.span(_.strong(String(ai.temperature ?? "-")), _.em("temp")),
              _.span(_.strong(String(ai.maxTokens ?? "-")), _.em("tokens")),
              _.span(_.strong(ai.localFirst === null ? "-" : String(ai.localFirst)), _.em("local first"))
            )
          ),
          ...(queryModel.aiRuntime?.providers || []).slice(0, 5).map((provider) =>
            _.div(
              { class: "tl-flow-prompt-inventory-row" },
              icon("psychology", "sm"),
              _.span(_.strong(provider.name || provider.id), _.em(provider.provider || "provider")),
              _.code(provider.model || provider.status || "configured")
            )
          )
        ));
      }
      if (showMemory) {
        sections.push(_.section(
          _.h4(`Memoria workspace (${queryModel.memory?.length || 0})`),
          ...(queryModel.memory?.length ? queryModel.memory.slice(0, 8).map((item) =>
            _.div(
              { class: "tl-flow-prompt-query-card" },
              _.span({ class: "tl-flow-prompt-query-card-head" }, icon("memory", "sm"), _.strong(item.name || item.kind || "Memory"), _.code(item.scope || "workspace")),
              _.small(item.text || item.summary || item.content || "")
            )
          ) : [_.p({ class: "tl-flow-prompt-inventory-empty" }, "Nessuna memoria workspace rilevante.")])
        ));
      }
      if (showRuntime && !wantsRuntimeErrors && queryModel.runtime?.recent?.length) {
        sections.push(_.section(
          _.h4("Runtime timeline"),
          ...queryModel.runtime.recent.slice(0, 8).map(renderRuntimeRecord)
        ));
      }
      return sections;
    };
    const renderDiagnosticsPanel = () => {
      const errors = diagnostics.filter((issue) => issue.severity === "error").length;
      const warnings = diagnostics.length - errors;
      const fixActions = diagnostics.map((issue) => issue.fixAction).filter((action) => action?.status === "ready");
      const canFixAll = fixActions.length > 1 && fixActions.every((action) => action.type === "deleteDependencies");
      return _.details(
        { class: "tl-flow-prompt-diagnostics-panel" },
        _.summary(
          icon(errors ? "error" : "warning", "sm"),
          _.span(
            _.strong("Diagnostica"),
            _.em(diagnostics.length
              ? `${errors} errori · ${warnings} warning`
              : "Nessun problema strutturale evidente")
          ),
          icon("expand_more", "sm")
        ),
        diagnostics.length ? _.div(
          { class: "tl-flow-prompt-diagnostics-list" },
          canFixAll ? _.div(
            { class: "tl-flow-prompt-diagnostics-actions" },
            btn({
              class: "is-primary",
              disabled: draft.busy,
              onclick: (event) => {
                event.preventDefault();
                applyAgentAction(flowPromptBatchPlan(fixActions, `Rimuovo ${fixActions.length} collegamenti rotti.`));
              },
            }, icon("auto_fix_high", "sm"), "Fix all")
          ) : null,
          ...diagnostics.map((issue) => {
            const title = issue.title || issue.message || issue.summary || "Problema Flow Map";
            const detail = issue.detail || issue.description || issue.reason || issue.id || "";
            return _.div(
              { class: `tl-flow-prompt-diagnostic is-${issue.severity || "warning"}` },
              icon(issue.severity === "error" ? "error" : "warning", "sm"),
              _.span(_.strong(title), _.em(detail)),
              issue.fixAction ? btn({
                class: "is-ghost",
                disabled: draft.busy,
                onclick: (event) => {
                  event.preventDefault();
                  applyAgentAction(flowPromptBatchPlan([issue.fixAction], issue.fixAction.summary || title));
                },
              }, icon("build", "sm"), "Fix") : null
            );
          })
        ) : null
      );
    };
    return _.div(
      { class: `tl-flow-prompt-agent-report${compactNatural ? " is-compact-natural" : ""}` },
      showOverview ? _.div(
        { class: "tl-flow-prompt-agent-kpis" },
        _.span(icon("account_tree", "sm"), _.strong(String(context.nodes?.length || 0)), _.em("nodi")),
        _.span(icon("link", "sm"), _.strong(String(context.edges?.length || 0)), _.em("link")),
        _.span(icon("hub", "sm"), _.strong(String(context.channels?.length || 0)), _.em("canali")),
        _.span(icon("bolt", "sm"), _.strong(String(context.events?.length || 0)), _.em("eventi")),
        _.span(icon("subject", "sm"), _.strong(String(context.flowLogs?.length || 0)), _.em("log"))
      ) : null,
      pendingAction ? _.section(
        _.h4("Piano modifica"),
        _.div(
          { class: `tl-flow-prompt-action-plan is-${pendingStatus}` },
          icon(pendingStatus === "ready" ? "add_link" : pendingStatus === "applied" ? "check_circle" : pendingStatus === "duplicate" ? "link" : "warning", "sm"),
          _.span(
            _.strong(pendingStatus === "ready" ? "Pronto per Apply" : pendingStatus === "applied" ? "Applicato" : pendingStatus === "duplicate" ? "Gia presente" : "Bloccato"),
            _.em(pendingAction.summary || "")
          ),
          pendingStatus === "ready" ? btn({
            class: "is-primary",
            disabled: draft.busy,
            onclick: () => applyAgentAction(pendingAction),
          }, icon("check", "sm"), "Apply") : null
        ),
        ...renderAgentPlanSteps()
      ) : null,
      showNodes ? _.section(
        _.h4(`Nodi (${query.filter ? query.total : context.nodes?.length || 0})`),
        ...((query.filter ? queryItems : context.nodes || []).length
          ? (query.filter ? queryItems : context.nodes || []).slice(0, 10).map((node) =>
            _.div(
              { class: "tl-flow-prompt-inventory-row" },
              icon(node.icon || "extension", "sm"),
              _.span(_.strong(node.label || node.id), _.em(`${node.type} · ${node.subtype} · ${node.status}`)),
              _.code(`${node.inputs?.length || 0} IN · ${node.outputs?.length || 0} OUT`)
            )
          )
          : [_.p({ class: "tl-flow-prompt-inventory-empty" }, "Nessun nodo nel workspace corrente.")])
      ) : null,
      showEdges ? _.section(
        _.h4(`Collegamenti (${query.filter ? query.total : context.edges?.length || 0})`),
        ...((query.filter ? queryItems : context.edges || []).length
          ? (query.filter ? queryItems : context.edges || []).slice(0, 10).map((edge) =>
            _.div(
              { class: "tl-flow-prompt-inventory-row" },
              icon("link", "sm"),
              _.span(_.strong(`${edge.sourceLabel} -> ${edge.targetLabel}`), _.em(edge.channel || "runtime")),
              _.code(`${edge.sourcePort || "out"} -> ${edge.targetPort || "in"}`)
            )
          )
          : [_.p({ class: "tl-flow-prompt-inventory-empty" }, "Nessun collegamento nel workspace corrente.")])
      ) : null,
      showDiagnostics ? renderDiagnosticsPanel() : null,
      showChannels && context.channels?.length ? _.section(
        _.h4(`Canali (${query.filter ? query.total : context.channels.length})`),
        ...(query.filter ? queryItems : context.channels).slice(0, 12).map((channel) =>
          _.div(
            { class: "tl-flow-prompt-inventory-row" },
            icon("hub", "sm"),
            _.span(_.strong(channel.name || channel.id || "channel"), _.em(channel.lastEmittedAt ? `ultimo emit ${new Date(channel.lastEmittedAt).toLocaleString()}` : channel.workspaceId || "runtime")),
            _.code(channel.status || channel.health || "active")
          )
        )
      ) : null,
      showRuntime && (context.flowLogs?.length || context.events?.length || wantsRuntimeErrors) ? _.section(
        _.h4(`Runtime recente (${query.filter ? query.total : (context.flowLogs?.length || 0) + (context.events?.length || 0)})`),
        ...((wantsRuntimeErrors
          ? (queryModel.runtime?.errors || [])
          : query.filter
            ? queryItems
            : [...(context.flowLogs || []).slice(0, 4), ...(context.events || []).slice(0, 4)]
        ).slice(0, 6).map(renderRuntimeRecord)),
        wantsRuntimeErrors && !(queryModel.runtime?.errors || []).length ? _.div(
          { class: "tl-flow-prompt-query-card" },
          _.span(
            { class: "tl-flow-prompt-query-card-head" },
            icon("check_circle", "sm"),
            _.strong("Nessun errore runtime recente"),
            _.code("clean")
          )
        ) : null
      ) : null,
      ...renderQueryModelDetails(),
      pendingAction ? renderDebugPanel() : null
    );
  };

  const renderActivity = () => {
    if (!draft.activity) return null;
    const activity = draft.activity;
    return _.article(
      { class: "tl-flow-prompt-message is-assistant is-thinking", "aria-live": "polite" },
      _.details(
        { class: "tl-flow-prompt-thinking" },
        _.summary(
          { class: "tl-flow-prompt-thinking-main" },
          _.span(icon("auto_awesome", "sm"), _.strong(activity.title || "AI Flow Agent")),
          _.span(_.strong(activity.label || "Sto lavorando"), _.em(activity.detail || "Analisi in corso")),
          _.time(new Date(activity.updatedAt || Date.now()).toLocaleTimeString()),
          _.span({ class: "tl-flow-prompt-thinking-dots", "aria-hidden": "true" }, _.i(), _.i(), _.i())
        ),
        _.div(
          { class: "tl-flow-prompt-thinking-body" },
          _.span({ class: "tl-flow-prompt-thinking-orbit" }, icon("hub", "sm")),
          _.div(
            { class: "tl-flow-prompt-thinking-detail" },
            _.strong(activity.label || "Sto lavorando"),
            _.em(activity.detail || "Analisi in corso")
          ),
          activity.steps?.length ? _.div(
            { class: "tl-flow-prompt-thinking-steps" },
            ...activity.steps.map((step, index) =>
              _.span(
                { class: index === activity.steps.length - 1 ? "is-active" : "is-done" },
                icon(index === activity.steps.length - 1 ? "sync" : "check", "sm"),
                _.em(step)
              )
            )
          ) : null
        )
      )
    );
  };

  const renderInlineMarkdown = (text = "") => {
    const parts = [];
    const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
    let cursor = 0;
    String(text || "").replace(pattern, (match, _token, offset) => {
      if (offset > cursor) parts.push(text.slice(cursor, offset));
      if (match.startsWith("`")) parts.push(_.code(match.slice(1, -1)));
      else parts.push(_.strong(match.slice(2, -2)));
      cursor = offset + match.length;
      return match;
    });
    if (cursor < text.length) parts.push(text.slice(cursor));
    return parts.length ? parts : [text];
  };

  const renderMessageContent = (content = "") => {
    const raw = String(content || "");
    if (!raw.trim()) return _.p("");
    const lines = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    if (lines.length <= 1) return _.p(...renderInlineMarkdown(raw.trim()));
    return _.div(
      { class: "tl-flow-prompt-message-body" },
      ...lines.map((line) => {
        const ordered = line.match(/^(\d+)[.)]\s+(.+)$/);
        const bullet = line.match(/^[-*]\s+(.+)$/);
        if (ordered || bullet) {
          return _.p(
            { class: "tl-flow-prompt-message-line is-list" },
            _.span({ class: "tl-flow-prompt-message-marker" }, ordered ? `${ordered[1]}.` : "•"),
            _.span(...renderInlineMarkdown(ordered ? ordered[2] : bullet[1]))
          );
        }
        return _.p({ class: "tl-flow-prompt-message-line" }, ...renderInlineMarkdown(line));
      })
    );
  };

  const renderMessagePostActions = (message = {}) => {
    if (message.role !== "assistant" || !["plan", "agent-report", "text"].includes(message.kind)) return null;
    if (message.agentReport?.compactNatural || message.agentReport?.debug?.compactNatural) return null;
    const hasBrain = Boolean(message.agentReport?.brain || message.agentReport?.brainContext);
    const canCreate = message.kind === "plan" || message.content || message.agentReport;
    const secondaryActions = [
      btn({
        class: "is-ghost",
        disabled: draft.busy,
        title: "Carica questa risposta nel prompt come template",
        onclick: () => useMessageAsTemplate(message),
      }, icon("input", "sm"), "Usa template"),
      btn({
        class: "is-ghost",
        disabled: draft.busy,
        title: "Trasforma in risposta operativa con nodi, porte e link",
        onclick: () => makeMessageOperational(message),
      }, icon("construction", "sm"), "Rendi operativo"),
      hasBrain ? btn({
        class: "is-ghost",
        disabled: draft.busy,
        title: "Apri Brain details",
        onclick: () => openMessageBrainDetails(message.id),
      }, icon("psychology", "sm"), "Brain details") : null,
    ].filter(Boolean);
    return _.div(
      { class: "tl-flow-prompt-post-actions" },
      canCreate ? btn({
        class: "is-ghost",
        disabled: draft.busy,
        title: message.kind === "plan" ? "Crea questo flow" : "Prepara un flow operativo da questa risposta",
        onclick: () => createFlowFromMessage(message),
      }, icon("add_link", "sm"), message.kind === "plan" ? "Crea flow" : "Crea flow da risposta") : null,
      canLearnFromMessage(message) ? btn({
        class: "is-ghost",
        disabled: draft.busy,
        title: "Salva questa risposta come pattern confermato",
        onclick: () => learnFromMessage(message, "approved"),
      }, icon("memory", "sm"), "Salva pattern") : null,
      canLearnFromMessage(message) ? btn({
        class: "is-ghost is-icon-only",
        "aria-label": "Non usare come pattern",
        disabled: draft.busy,
        title: "Non riusare questa risposta come esempio",
        onclick: () => learnFromMessage(message, "rejected"),
      }, icon("block", "sm")) : null,
      secondaryActions.length ? _.details(
        { class: "tl-flow-prompt-more-actions" },
        _.summary(
          { title: "Altre azioni" },
          icon("more_horiz", "sm"),
          _.span("Altro")
        ),
        _.div(...secondaryActions)
      ) : null
    );
  };

  const renderResultSnapshot = (result = {}) =>
    _.div(
      { class: "tl-flow-prompt-result-report" },
      result.completion ? _.section(
        { class: "tl-flow-prompt-completion" },
        _.div(
          { class: "tl-flow-prompt-completion-head" },
          icon(result.warnings?.length ? "task_alt" : "verified", "sm"),
          _.span(
            _.strong(result.completion.status || "Obiettivo raggiunto"),
            _.em(result.completion.goal || "Flow applicato con controllo.")
          )
        ),
        result.completion.details?.length ? _.div(
          { class: "tl-flow-prompt-completion-list" },
          ...result.completion.details.map((item) => _.span(icon("check_circle", "sm"), item))
        ) : null,
        result.completion.links?.length ? _.details(
          { class: "tl-flow-prompt-completion-links" },
          _.summary(icon("add_link", "sm"), _.strong("Collegamenti"), _.em(`${result.completion.links.length} principali`), icon("expand_more", "sm")),
          _.div(...result.completion.links.map((item) => _.code(item)))
        ) : null,
        result.completion.nextStep ? _.p({ class: "tl-flow-prompt-completion-next" }, result.completion.nextStep) : null
      ) : null,
      _.div(
        { class: "tl-flow-prompt-result is-inline" },
        icon("check_circle", "sm"),
        _.span(
          result.applied?.length
            ? result.applied.map((item) => item.label).join(" · ")
            : `${result.createdNodes} creati · ${result.reusedNodes} riusati · ${result.createdEdges} link creati · ${result.reusedEdges} link riusati`
        ),
        result.focusNodeId ? btn({
          class: "is-ghost",
          disabled: draft.busy,
          onclick: () => focusAgentNode(result.focusNodeId),
        }, icon("right_panel_open", "sm"), "Inspector") : null,
        result.focusNodeId ? btn({
          class: "is-ghost",
          disabled: draft.busy,
          onclick: () => retryRuntimeNodeTest(result.focusNodeId),
        }, icon("play_arrow", "sm"), "Retry") : null,
        result.snapshotId ? btn({
          class: "is-ghost",
          disabled: draft.busy,
          title: "Ripristina lo snapshot precedente",
          onclick: () => restoreAgentSnapshot(result.snapshotId),
        }, icon("undo", "sm"), "Undo") : null
      ),
      result.warnings?.length ? _.div(
        { class: "tl-flow-prompt-result-warnings" },
        _.strong(icon("warning", "sm"), "Warning"),
        ...result.warnings.map((item) => _.span(item))
      ) : null,
      result.preflight?.checks?.length ? _.details(
        {
          class: "tl-flow-prompt-result-checks",
          ...(result.warnings?.length || result.preflight?.blockers?.length ? { open: true } : {}),
        },
        _.summary(
          icon("fact_check", "sm"),
          _.span(_.strong("Controlli tecnici"), _.em(result.preflight.summary || "Preflight completato")),
          icon("expand_more", "sm")
        ),
        _.div(
          ...result.preflight.checks.map((item) =>
            _.span(
              { class: `is-${item.status || "ok"}` },
              icon(item.status === "warn" ? "warning" : item.status === "blocked" ? "error" : "check_circle", "sm"),
              _.strong(item.label),
              _.em(item.detail || "")
            )
          )
        )
      ) : null
    );

  const renderMessage = (message = {}) => {
    const refinedSource = message.refinedFrom ? messageById(message.refinedFrom) : null;
    return _.article(
      {
        class: `tl-flow-prompt-message is-${message.role || "assistant"} is-${message.kind || "text"}`,
        "data-flow-prompt-message-id": message.id || "",
      },
      _.div(
        { class: "tl-flow-prompt-message-head" },
        _.span(icon(message.role === "user" ? "person" : "auto_awesome", "sm"), _.strong(message.role === "user" ? "Tu" : "AI Flow Chat")),
        _.div(
          { class: "tl-flow-prompt-message-meta" },
          message.refinedFrom ? _.span(
            {
              class: "tl-flow-prompt-feedback-pill is-revision",
              title: refinedSource
                ? "Risposta migliorata da una risposta precedente"
                : "Risposta migliorata da una risposta precedente non trovata nello storico corrente",
            },
            icon("history", "sm"),
            "Revisione"
          ) : null,
          message.refinedFrom ? _.div(
            { class: "tl-flow-prompt-feedback-actions" },
            btn({
              class: "is-ghost is-icon-only",
              "aria-label": "Vai alla risposta originale",
              disabled: draft.busy || !refinedSource,
              title: refinedSource ? "Mostra la risposta originale" : "Risposta originale non disponibile",
              onclick: () => scrollToMessage(message.refinedFrom),
            }, icon("subdirectory_arrow_left", "sm"))
          ) : null,
          message.feedback?.rating === "approved" ? _.span({ class: "tl-flow-prompt-feedback-pill is-approved" }, icon("memory", "sm"), "Memorizzato") : null,
          message.feedback?.rating === "rejected" ? _.span({ class: "tl-flow-prompt-feedback-pill is-rejected" }, icon("block", "sm"), "Non usare") : null,
          message.feedback?.rating === "approved" ? _.div(
            { class: "tl-flow-prompt-feedback-actions" },
            btn({
              class: "is-ghost is-danger is-icon-only",
              "aria-label": "Dimentica memoria",
              disabled: draft.busy,
              title: "Rimuovi questa memoria confermata",
              onclick: () => forgetMessageMemory(message),
            }, icon("delete", "sm"))
          ) : null,
          canImproveMessage(message) ? _.div(
            { class: "tl-flow-prompt-feedback-actions" },
            btn({
              class: "is-ghost is-icon-only",
              "aria-label": "Migliora risposta",
              disabled: draft.busy,
              title: "Migliora questa risposta con Brain, RAG e memoria",
              onclick: () => improveMessage(message),
            }, icon("auto_fix_high", "sm"))
          ) : null
        )
      ),
      renderMessageContent(message.content || ""),
      message.kind === "plan" && message.plan ? renderPlanSnapshot(message.plan) : null,
      message.kind === "inventory" && message.inventory ? renderInventorySnapshot(message.inventory) : null,
      message.kind === "agent-report" && message.agentReport ? renderAgentReport(message.agentReport) : null,
      message.kind === "result" && message.result ? renderResultSnapshot(message.result) : null,
      renderMessagePostActions(message),
      _.footer(
        { class: "tl-flow-prompt-message-foot" },
        _.time(new Date(message.createdAt || Date.now()).toLocaleString())
      )
    );
  };

  const renderChatList = () =>
    _.aside(
      { class: "tl-flow-prompt-history" },
      _.div(
        { class: "tl-flow-prompt-history-head" },
        _.strong("Storico"),
        btn({ "aria-label": "Nuova chat", title: "Nuova chat", onclick: startNewChat }, icon("add", "sm"))
      ),
      draft.loadingHistory ? _.div({ class: "tl-flow-prompt-history-empty" }, icon("hourglass_empty", "sm"), _.span("Caricamento")) : null,
      !draft.loadingHistory && !draft.chats.length ? _.div({ class: "tl-flow-prompt-history-empty" }, icon("forum", "sm"), _.span("Nessuna chat salvata")) : null,
      _.div(
        { class: "tl-flow-prompt-history-list" },
        ...draft.chats.map((chat) =>
          _.div(
            { class: `tl-flow-prompt-history-item${chat.id === draft.activeChat?.id ? " is-active" : ""}` },
            _.button(
              {
                type: "button",
                class: "tl-flow-prompt-history-open",
                onclick: () => {
                  setActiveChat(chat);
                  draft.view = "chat";
                  refresh();
                },
              },
              _.span({ class: "tl-flow-prompt-history-icon" }, icon("forum", "sm")),
              _.span(
                { class: "tl-flow-prompt-history-text" },
                _.strong(chat.title || "Chat"),
                _.em(`${chat.messages?.length || 0} messaggi · ${new Date(chat.updatedAt || chat.createdAt || Date.now()).toLocaleDateString()}`)
              )
            ),
            _.button(
              {
                type: "button",
                class: "tl-flow-prompt-history-delete",
                title: "Elimina chat",
                "aria-label": `Elimina chat ${chat.title || "Chat"}`,
                disabled: draft.busy,
                onclick: (event) => deleteChat(chat, event),
              },
              icon("delete", "sm")
            )
          )
        )
      )
    );

  function renderContentBody() {
    const showIntro = !activeMessages().length && !draft.dismissedIntroChatIds.has(draft.activeChat?.id);
    if (draft.view === "history") {
      return [renderChatList()];
    }
    return [
      _.section(
        { class: "tl-flow-prompt-conversation" },
        showIntro ? _.div(
          { class: "tl-flow-prompt-intro" },
          icon("auto_awesome", "md"),
          _.div(
            _.strong(draft.activeChat?.title || "Prompt to Flow Map"),
            _.span(`Workspace: ${currentWorkspaceName()} · storico persistente IndexedDB`)
          ),
          _.button(
            {
              type: "button",
              class: "tl-flow-prompt-intro-close",
              title: "Nascondi suggerimento",
              "aria-label": "Nascondi suggerimento",
              onclick: dismissIntro,
            },
            icon("close", "sm")
          )
        ) : null,
        _.div(
          { class: "tl-flow-prompt-thread" },
          ...(activeMessages().length
            ? [...activeMessages().map(renderMessage), renderActivity()].filter(Boolean)
            : [draft.activity ? renderActivity() : _.div(
              { class: "tl-flow-prompt-empty" },
              icon("hub", "md"),
              _.strong("Descrivi il risultato"),
              _.span("La chat mantiene lo storico e genera Task/Source, Orchestrator Agent, AI Agents, Processor, Actions, Storage, Lens o Preview.")
            )])
        ),
        draft.error ? _.div({ class: "tl-flow-prompt-error" }, icon("error", "sm"), _.span(draft.error)) : null,
        _.div(
          { class: "tl-flow-prompt-composer" },
          _.label(
            { class: "tl-flow-prompt-field" },
            _.span("Prompt"),
            _.textarea({
              rows: 2,
              value: draft.prompt,
              placeholder: "Esempio: crea un flow con REST API, orchestrator agent, analyzer, storage, preview e notifica",
              oninput: (event) => {
                draft.prompt = event.currentTarget.value;
                draft.analysis = null;
                draft.result = null;
              },
              onkeydown: (event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  const prompt = String(event.currentTarget.value || "").trim();
                  if (!prompt) {
                    analyze("");
                    return;
                  }
                  draft.prompt = "";
                  event.currentTarget.value = "";
                  draft.analysis = null;
                  draft.result = null;
                  analyze(prompt);
                }
              },
            })
          )
        )
      )
    ];
  }

  function renderContent() {
    return _.div(
      { class: `tl-flow-prompt-chat is-${draft.view}`, "data-flow-prompt-chat": "true" },
      ...renderContentBody()
    );
  }

  const closeAside = () => {
    if (!aside) return;
    flowPromptSaveOpenState(false, draft.workspaceId || workspaceId);
    aside.classList.remove("is-open");
    window.setTimeout(() => aside?.remove?.(), 180);
  };

  function renderAsideHeader() {
    const isHistory = draft.view === "history";
    const activeTitle = draft.activeChat?.title || "Nuova chat";
    return _.header(
      { class: "tl-flow-prompt-aside-head" },
      isHistory ? _.span({ class: "tl-flow-prompt-aside-icon" }, icon("forum", "sm")) : btn({
        class: "is-ghost tl-flow-prompt-aside-back",
        "aria-label": "Mostra storico chat",
        title: "Storico chat",
        onclick: () => {
          draft.view = "history";
          refresh();
        },
      }, icon("arrow_back", "sm")),
      _.span(
        { class: "tl-flow-prompt-aside-title" },
        _.strong(isHistory ? "Chat history" : activeTitle),
        _.em(isHistory ? `${draft.chats.length} chat salvate` : "Flow Map agent")
      ),
      _.div(
        { class: "tl-flow-prompt-aside-actions" },
        btn({
          class: "is-ghost is-icon-only",
          "aria-label": "Pattern salvati",
          title: "Pattern salvati",
          onclick: openSavedPatternsDialog,
        }, icon("memory", "sm"))
      ),
      btn({
        class: "is-ghost is-icon-only tl-flow-prompt-aside-close",
        dense: true,
        "aria-label": "Chiudi AI Flow Chat",
        title: "Chiudi",
        onclick: closeAside,
      }, icon("close", "sm"))
    );
  }

  function renderAsideShell() {
    return [
      renderAsideHeader(),
      renderContent(),
    ];
  }

  aside = _.aside(
    { class: "tl-flow-prompt-aside", "data-flow-prompt-aside": "true", "aria-label": "AI Flow Chat" },
    ...renderAsideShell()
  );
  document.body.appendChild(aside);
  requestAnimationFrame(() => {
    aside?.classList.add("is-open");
    if (!options.restore) aside?.querySelector("textarea")?.focus?.();
  });
  loadHistory();
};

window.TrackerLensOpenFlowPromptChat = openFlowPromptChatDialog;
window.TrackerLensFlowPromptChat = {
  ...(window.TrackerLensFlowPromptChat || {}),
  runRuntimeErrorMemoryTests: flowPromptRunRuntimeErrorMemoryTests,
  runMemoryRecallTests: flowPromptRunMemoryRecallTests,
  runFlowChatHardeningTests: flowPromptRunFlowChatHardeningTests,
};

const flowPromptRestoreOpenState = () => {
  if (document.querySelector("[data-flow-prompt-aside]")) return;
  if (!flowPromptShouldRestoreOpen()) return;
  openFlowPromptChatDialog({ restore: true }).catch((error) => {
    console.warn("AI Flow Chat restore non completato:", error);
  });
};

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", () => window.setTimeout(flowPromptRestoreOpenState, 250), { once: true });
} else {
  window.setTimeout(flowPromptRestoreOpenState, 250);
}
