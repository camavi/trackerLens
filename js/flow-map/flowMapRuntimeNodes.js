// Flow Map runtime node configuration, custom node forms and graph links.
// Extracted from js/flowMapView.js; loaded in order by flowMap.html.
const AI_AGENT_NODE_RUNTIME_STATUS_LABELS = {
  idle: "Idle",
  queued: "Queued",
  working: "Working",
  planning: "Planning",
  waiting_for_tools: "Using tools",
  waiting_for_user: "Needs user",
  waiting_for_permission: "Needs permission",
  running_llm: "Calling model",
  emitting: "Emitting",
  complete: "Complete",
  completed: "Complete",
  fallback: "Fallback",
  warning: "Warning",
  error: "Error",
  cancelled: "Cancelled",
  paused: "Paused",
};

const AI_AGENT_NODE_RUNTIME_STEP_LABELS = {
  received: "Received event",
  mapping: "Applied mapping",
  input_context: "Loaded input",
  connected_tools: "Using tools",
  memory: "Loaded memory",
  prompt: "Built prompt",
  llm: "Calling model",
  continuation: "Continuing output",
  fallback: "Fallback",
  emit: "Emitted output",
  complete: "Complete",
  error: "Error",
};

const aiAgentRuntimeBadgeTone = (status = "") => {
  const value = String(status || "").toLowerCase();
  if (["error", "cancelled"].includes(value)) return "red";
  if (["waiting_for_user", "waiting_for_permission", "fallback", "paused", "warning"].includes(value)) return "gold";
  if (["working", "planning", "waiting_for_tools", "running_llm", "emitting", "queued"].includes(value)) return "violet";
  if (["complete", "completed"].includes(value)) return "green";
  return "blue";
};

const aiAgentRuntimeActivity = (node = {}) => {
  if (node.type !== "aiAgent" || typeof filteredRuntimeEvents !== "function") return null;
  const event = (filteredRuntimeEvents() || [])
    .filter((item) =>
      item.eventType === "ai_agent_step" ||
      item.channel === "ai.agent.step" ||
      item.meta?.stepType
    )
    .filter((item) =>
      item.sourceNodeId === node.id ||
      item.meta?.aiAgentRuntime === node.id ||
      item.payload?.agentId === node.id
    )
    .sort((a, b) => Date.parse(b.createdAt || b.updatedAt || 0) - Date.parse(a.createdAt || a.updatedAt || 0))[0];
  if (!event) return null;
  const status = event.payload?.status || event.status || event.payload?.step?.status || "working";
  const step = event.payload?.step || {};
  const stepType = step.type || event.meta?.stepType || "";
  return {
    status,
    label: AI_AGENT_NODE_RUNTIME_STATUS_LABELS[String(status || "").toLowerCase()] || status || "Working",
    tone: aiAgentRuntimeBadgeTone(status),
    stepLabel: step.label || AI_AGENT_NODE_RUNTIME_STEP_LABELS[String(stepType).toLowerCase()] || stepType,
    summary: step.summary || "",
    createdAt: event.createdAt || event.updatedAt || "",
  };
};

const nodeBadges = (node = {}, live = null) => {
  const badges = [];
  const sandbox = nodeSandboxReport(node);
  const perf = nodePerformance(node);
  const agentRuntime = aiAgentRuntimeActivity(node);
  if (node.metadata?.library) {
    badges.push({ label: "Library", tone: "blue" });
  } else if (node.metadata?.aiAgentAlias || isEmbeddedFlowMapNode(node)) {
    badges.push({ label: "Alias", tone: "blue" });
  } else if (isDraftNode(node)) {
    badges.push({ label: "Draft", tone: "gold" });
  } else if (node.metadata?.configured || isInlineConfigNode(node)) {
    badges.push({ label: node.metadata?.configured ? "Configured" : "Runtime", tone: "violet" });
  } else {
    badges.push({ label: node.status || "Active", tone: "green" });
  }
  if (agentRuntime) badges.push({ label: agentRuntime.label, tone: agentRuntime.tone });

  if (sandbox.status === "error") badges.push({ label: "Sandbox", tone: "red" });
  else if (sandbox.status === "policy") badges.push({ label: "Policy", tone: "gold" });
  if (live?.status === "error") badges.push({ label: "Error", tone: "red" });
  else if (live?.status === "overloaded") badges.push({ label: "Overload", tone: "red" });
  else if (live?.status === "queued") badges.push({ label: "Queued", tone: "gold" });
  else if (live?.status === "busy") badges.push({ label: "Busy", tone: "gold" });
  else if (live) badges.push({ label: "Live", tone: "green" });
  if (perf) badges.push({ label: performanceLabel(perf), tone: performanceTone(perf) });

  return badges.slice(0, 3);
};

const runtimeOverviewStats = () => {
  const nodes = state.runtime.nodes || [];
  const flowLogs = state.runtime.flowLogs || [];
  return {
    runtime: nodes.filter((node) => !node.metadata?.library).length,
    configured: nodes.filter((node) => node.metadata?.configured || (!node.metadata?.library && !isDraftNode(node))).length,
    draft: nodes.filter(isDraftNode).length,
    warningLogs: flowLogs.filter((log) => (log.level || "info") === "warning").length,
    errorLogs: flowLogs.filter((log) => (log.level || "info") === "error").length,
  };
};

const configureNode = (node) => {
  if (isFlowBoundaryNode(node) && !node.metadata?.library) {
    requestFlowPortDialog(node);
    return;
  }
  if (node?.type === "boxTracker" && !node.metadata?.library) {
    const item = { ...(paletteItemForNode(node) || {}), editorType: "boxTracker" };
    openPaletteNode(item, node);
    return;
  }
  if (node?.type === "boxLens" && !node.metadata?.library) {
    const item = { ...(paletteItemForNode(node) || {}), editorType: "boxLens" };
    openPaletteNode(item, node);
    return;
  }
  if (node?.type === "aiAgent" && !node.metadata?.library) {
    requestAiAgentRuntimeConfig(node);
    return;
  }
  if (isCustomRuntimeNode(node) && !node.metadata?.library) {
    requestCustomRuntimeNodeConfig(node);
    return;
  }
  if (isInlineConfigNode(node) && !node.metadata?.library) {
    requestRuntimeNodeConfig(node);
    return;
  }
  const item = paletteItemForNode(node);
  if (item) {
    openPaletteNode(item, node);
    return;
  }
  const query = new URLSearchParams();
  if (node.workspaceId) query.set("workspaceId", node.workspaceId);
  if (node.id) query.set("runtimeNodeId", node.id);
  if (node.type) query.set("type", node.type);
  window.location.assign(`connections.html?${query.toString()}`);
};

const nodeConfigObject = (node = {}) => {
  const config = node.metadata?.config;
  if (config && typeof config === "object" && !Array.isArray(config)) return config;
  return {};
};

const FLOW_PORT_TYPES = Object.freeze([
  { value: "string", label: "Stringa" },
  { value: "int", label: "Int" },
  { value: "float", label: "Float" },
  { value: "object", label: "Oggetto" },
  { value: "array", label: "Array" },
  { value: "bool", label: "Boolean" },
]);

const flowPortTypeLabel = (type = "") =>
  FLOW_PORT_TYPES.find((item) => item.value === type)?.label || type || "Any";

const flowPortSubtype = (node = {}) =>
  String(node?.metadata?.subtype || node?.subtype || "").toLowerCase();

const isFlowBoundaryNode = (node = {}) => {
  const subtype = flowPortSubtype(node);
  const label = String(node?.metadata?.paletteLabel || node?.label || "").toLowerCase();
  return node?.type === "flowPort" || subtype === "flow-in" || subtype === "flow-out" || label === "flow in" || label === "flow out";
};

const isEmbeddedFlowMapNode = (node = {}) =>
  node?.type === "flowMap" && Boolean(node?.metadata?.embeddedFlowMap || node?.metadata?.flowMapId);

const flowPortDirection = (node = {}) =>
  flowPortSubtype(node) === "flow-out" || String(node?.label || "").toLowerCase() === "flow out" ? "in" : "out";

const flowPortDefaultName = (node = {}) =>
  flowPortDirection(node) === "in" ? "flow.out" : "flow.in";

const normalizeFlowPortName = (name = "") =>
  String(name || "").trim().replace(/\s+/g, "_").slice(0, 48);

const normalizeFlowPortType = (type = "") => {
  const value = String(type || "").toLowerCase();
  return FLOW_PORT_TYPES.some((item) => item.value === value) ? value : "string";
};

const normalizeFlowPortDef = (port = {}, fallbackName = "port") => {
  const rawName = typeof port === "string" ? port : port.name || port.key || port.channel || port.id || fallbackName;
  return {
    id: String(port.id || rawName || fallbackName).replace(/[^A-Za-z0-9_.:-]/g, "_"),
    name: normalizeFlowPortName(rawName || fallbackName) || fallbackName,
    type: normalizeFlowPortType(port.type || port.valueType || "string"),
    schema: port.schema || port.payloadSchema || null,
    required: Boolean(port.required),
  };
};

const flowPortDefinitions = (node = {}) => {
  const direction = flowPortDirection(node);
  const stored = Array.isArray(node.metadata?.flowPorts) ? node.metadata.flowPorts : [];
  const source = stored.length ? stored : direction === "in" ? node.inputs || [] : node.outputs || [];
  const reserved = new Set(["all", "agent_control"]);
  const ports = source
    .map((port, index) => normalizeFlowPortDef(port, `${flowPortDefaultName(node)}.${index + 1}`))
    .filter((port) => port.name && !reserved.has(port.name));
  if (ports.length) return ports;
  return [normalizeFlowPortDef({ name: flowPortDefaultName(node), type: "object" }, flowPortDefaultName(node))];
};

const flowPortPatchForDefinitions = (node = {}, definitions = []) => {
  const direction = flowPortDirection(node);
  const ports = definitions.length ? definitions : [normalizeFlowPortDef({ name: flowPortDefaultName(node), type: "object" })];
  const inputs = direction === "in" ? ports : [];
  const outputs = direction === "out" ? ports : [];
  const channels = [...new Set([...inputs, ...outputs].map((port) => port.name))];
  return {
    inputs,
    outputs,
    channels,
    metadata: {
      flowPorts: ports,
      hasInput: direction === "in",
      hasOutput: direction === "out",
      manifest: {
        ...(node.metadata?.manifest || {}),
        inputs,
        outputs,
      },
    },
  };
};

const requestFlowPortDialog = (node, editingPortName = "") => {
  if (!isFlowBoundaryNode(node)) return;
  const currentPorts = flowPortDefinitions(node);
  const existing = currentPorts.find((port) => port.name === editingPortName) || null;
  const formId = `tl-flow-port-${String(node.id || Date.now()).replace(/[^A-Za-z0-9_-]/g, "_")}`;
  let formRef = null;
  const formValue = (name, fallback = "") => {
    const form = formRef || document.getElementById(formId);
    const field = form?.querySelector?.(`[name="${name}"], [data-config-key="${name}"]`);
    const value = field?.value ?? field?.dataset?.value ?? field?.textContent ?? "";
    return String(value || fallback || "").trim();
  };
  const save = async (close) => {
    const rawName = formValue("name", existing?.name || "");
    const type = formValue("type", existing?.type || "string");
    const name = normalizeFlowPortName(rawName);
    if (!name) {
      state.error = "Inserisci il nome della porta.";
      setErrorSignal?.(state.error);
      return;
    }
    const duplicate = currentPorts.some((port) => port.name === name && port.name !== existing?.name);
    if (duplicate) {
      state.error = `La porta "${name}" esiste gia.`;
      setErrorSignal?.(state.error);
      return;
    }
    const nextPort = normalizeFlowPortDef({
      ...(existing || {}),
      id: existing?.id || name,
      name,
      type: normalizeFlowPortType(type),
    }, name);
    const nextPorts = existing
      ? currentPorts.map((port) => port.name === existing.name ? nextPort : port)
      : [...currentPorts.filter((port) => port.name !== flowPortDefaultName(node)), nextPort];
    await persistNodeRuntimePatch({
      node,
      patch: flowPortPatchForDefinitions(node, nextPorts),
      message: `${flowPortSubtype(node) === "flow-out" ? "Flow Out" : "Flow In"} port saved: ${name}`,
      action: "flow-port-saved",
    });
    close?.();
  };
  const directionLabel = flowPortDirection(node) === "in" ? "sinistra" : "destra";
  const dialog = _.Dialog({
    class: "tl-flow-config-dialog tl-flow-port-dialog",
    panelClass: "tl-flow-config-panel tl-flow-port-panel",
    size: "sm",
    title: existing ? "Modifica porta" : "Aggiungi porta",
    subtitle: `${node.label || "Flow Port"} · porta a ${directionLabel}`,
    icon: existing ? "edit" : "add",
    closeButton: true,
    content: () => _.form(
      {
        id: formId,
        class: "tl-flow-config-form",
        onsubmit: (event) => {
          event.preventDefault();
          save(() => dialog.close());
        },
      },
      _.label(
        { class: "tl-flow-config-field" },
        _.span("Nome"),
        _.input({ name: "name", value: existing?.name || "", placeholder: "payload", autocomplete: "off" })
      ),
      _.label(
        { class: "tl-flow-config-field" },
        _.span("Tipo"),
        _.select(
          { name: "type" },
          ...FLOW_PORT_TYPES.map((item) => _.option({ value: item.value, selected: item.value === (existing?.type || "string") }, item.label))
        )
      )
    ),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ type: "button", onclick: close }, "Annulla"),
      btn({ type: "button", class: "st-btn-primary", onclick: () => save(close) }, icon("save", "sm"), existing ? "Salva" : "Aggiungi")
    ),
  });
  dialog.open();
  formRef = document.getElementById(formId);
};

const configStringValue = (node = {}) => {
  const config = node.metadata?.config;
  if (!config) return "";
  return typeof config === "string" ? config : JSON.stringify(config, null, 2);
};

const runtimeNodeConfigDefaults = (node = {}) => {
  const channels = nodeChannels(node);
  const metadata = node.metadata || {};
  const paletteLabel = metadata.paletteLabel || node.label || "";
  const config = nodeConfigObject(node);
  const subtype = nodeSubtype(node);
  const common = {
    label: node.label || paletteLabel || node.id,
    input: config.input || node.inputs?.[0] || channels[0] || state.focus.channel || "default",
    output: config.output || node.outputs?.[0] || channels[0] || state.focus.channel || "default",
    mode: metadata.mode || metadata.processorType || metadata.actionType || metadata.agentRole || subtype || paletteLabel || node.type || "runtime",
    config: configStringValue(node),
    configObject: config,
    runtimeStatus: metadata.runtimeStatus || node.runtime?.status || node.status || "idle",
  };
  if (subtype === "condition") {
    return {
      ...common,
      conditionField: config.conditionField || config.field || "payload.value",
      conditionOperator: config.conditionOperator || config.operator || ">",
      conditionValue: config.conditionValue || config.value || "",
      trueOutput: config.trueOutput || node.outputs?.[0] || "true",
      falseOutput: config.falseOutput || node.outputs?.[1] || "false",
    };
  }
  if (node.type === "action") return { ...common, output: "", config: metadata.target || common.config };
  if (node.type === "aiAgent") return { ...common, mode: metadata.agentRole || paletteLabel || "Analyzer" };
  return common;
};

const readConfigField = (form, name, fallback = "") =>
  form?.querySelector?.(`[name="${name}"]`)?.value?.trim?.() || fallback;

const parseConfigObject = (value = "") => {
  const text = String(value || "").trim();
  if (!text || !/^[{\[]/.test(text)) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const parsePayloadItemValue = (value = "", type = "string") => {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (type === "int" || type === "integer") return Number.parseInt(text, 10) || 0;
  if (type === "float" || type === "number") return Number.parseFloat(text) || 0;
  if (type === "boolean" || type === "bool") return text === "true" || text === "1" || text === "yes";
  if (type === "json") {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  if (!/^[{\["'\d\-tfn]/i.test(text)) return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const stringifyPayloadItemValue = (value) => {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const payloadItemTypeOptions = Object.freeze([
  "string",
  "int",
  "float",
  "boolean",
  "note",
  "select",
  "json",
]);

const payloadItemLabel = (key = "") => String(key || "")
  .replace(/[_-]+/g, " ")
  .replace(/([a-z])([A-Z])/g, "$1 $2")
  .replace(/\b\w/g, (char) => char.toUpperCase())
  .trim();

const payloadItemIconOptions = () => {
  if (typeof FLOW_COMPONENT_ICON_OPTIONS !== "undefined" && Array.isArray(FLOW_COMPONENT_ICON_OPTIONS)) {
    return FLOW_COMPONENT_ICON_OPTIONS;
  }
  return [
    { value: "", label: "Default", icon: "data_object" },
    { value: "data_object", label: "Data Object", icon: "data_object" },
    { value: "search", label: "Search", icon: "search" },
    { value: "tune", label: "Tune", icon: "tune" },
    { value: "article", label: "Article", icon: "article" },
  ];
};

const payloadItemIcon = (item = {}) => String(item.icon || "").trim() || "data_object";
const payloadItemIconColor = (item = {}) => String(item.iconColor || item.color || "").trim();
const payloadItemIconStyle = (item = {}) => {
  const color = payloadItemIconColor(item);
  return color ? { "--payload-icon-saved-color": color, "--payload-icon-color": color, "--set-color": color } : null;
};
const payloadItemIconNode = (item = {}) => {
  const color = payloadItemIconColor(item);
  return _.Icon({
    name: payloadItemIcon(item),
    size: "sm",
    style: color ? { color } : null,
  });
};
const applyPayloadIconStyle = (element, item = {}) => {
  if (!element?.style) return;
  const color = payloadItemIconColor(item);
  if (color) {
    element.style.setProperty("--payload-icon-saved-color", color);
    element.style.setProperty("--payload-icon-color", color);
    element.style.setProperty("--set-color", color);
  } else {
    element.style.removeProperty("--payload-icon-saved-color");
    element.style.removeProperty("--set-color");
  }
};

const payloadEditorDefaultItems = (node = {}, config = {}) => {
  const subtype = nodeSubtype(node);
  const category = nodeCategory(node);
  if (subtype === "manual-json") {
    const parsed = parseConfigObject(config.json || config.payload || config.testPayload || config.manualJson) || {};
    const entries = Object.keys(parsed).length
      ? Object.entries(parsed).map(([key, value], index) => ({
        id: `payload_${key}_${index}`,
        key,
        label: payloadItemLabel(key),
        value: stringifyPayloadItemValue(value),
        type: typeof value === "number" && Number.isInteger(value) ? "int" : typeof value === "number" ? "float" : typeof value === "boolean" ? "boolean" : typeof value === "object" ? "json" : "string",
        icon: "",
        iconColor: "",
        description: "",
        enabled: true,
        visible: ["query", "question", "collectionId", "documentId", "depth", "topK", "maxEvidence", "maxRelations"].includes(key) || index < 4,
      }))
      : [{ id: "payload_value", key: "value", label: "Value", value: "", type: "string", icon: "", iconColor: "", description: "", enabled: true, visible: true }];
    return entries;
  }
  if (subtype === "task") {
    return [
      { id: "payload_objective", key: "objective", label: "Objective", value: config.objective || "", type: "note", icon: "", iconColor: "", description: "", enabled: true, visible: true },
      { id: "payload_context", key: "context", label: "Context", value: config.context || "", type: "note", icon: "", iconColor: "", description: "", enabled: true, visible: false },
      { id: "payload_priority", key: "priority", label: "Priority", value: config.priority || "normal", type: "select", options: "normal, high, urgent", icon: "", iconColor: "", description: "", enabled: true, visible: true },
    ];
  }
  if (subtype === "knowledge-mechanism-cue-agent") {
    return [
      { id: "payload_query", key: "query", label: "Query", value: config.query || "", type: "note", icon: "search", iconColor: "", description: "", enabled: true, visible: true },
      { id: "payload_collectionId", key: "collectionId", label: "Collection", value: config.collectionId || "", type: "string", icon: "folder", iconColor: "", description: "", enabled: true, visible: true },
      { id: "payload_documentId", key: "documentId", label: "Document", value: config.documentId || "", type: "string", icon: "article", iconColor: "", description: "", enabled: true, visible: false },
      { id: "payload_maxChunks", key: "maxChunks", label: "Max chunks", value: config.maxChunks || "24", type: "int", icon: "segment", iconColor: "", description: "", enabled: true, visible: true },
      { id: "payload_maxChunkTokens", key: "maxChunkTokens", label: "Max tokens", value: config.maxChunkTokens || config.mechanismCueChunkTokens || "155", type: "int", icon: "data_object", iconColor: "", description: "", enabled: true, visible: true },
    ];
  }
  if (subtype === "graph-query") {
    return [
      { id: "payload_query", key: "query", label: "Query", value: config.query || "", type: "note", icon: "search", iconColor: "", description: "", enabled: true, visible: true },
      { id: "payload_collectionId", key: "collectionId", label: "Collection", value: config.collectionId || "", type: "string", icon: "folder", iconColor: "", description: "", enabled: true, visible: true },
      { id: "payload_depth", key: "depth", label: "Depth", value: config.depth || "2", type: "int", icon: "account_tree", iconColor: "", description: "", enabled: true, visible: true },
      { id: "payload_topK", key: "topK", label: "Top K", value: config.topK || "12", type: "int", icon: "filter_alt", iconColor: "", description: "", enabled: true, visible: true },
      { id: "payload_maxRelations", key: "maxRelations", label: "Max relations", value: config.maxRelations || "18", type: "int", icon: "hub", iconColor: "", description: "", enabled: true, visible: false },
      { id: "payload_maxEvidence", key: "maxEvidence", label: "Max evidence", value: config.maxEvidence || "6", type: "int", icon: "article", iconColor: "", description: "", enabled: true, visible: true },
      { id: "payload_evidenceMode", key: "evidenceMode", label: "Evidence mode", value: config.evidenceMode || "balanced", type: "select", options: "focused, balanced, full_ordered, debug_trace", icon: "rule", iconColor: "", description: "", enabled: true, visible: true },
    ];
  }
  if (category === "sources" && (config.payloadJson || config.payload || config.testPayload)) {
    const parsed = parseConfigObject(config.payloadJson || config.payload || config.testPayload) || {};
    return Object.entries(parsed).map(([key, value], index) => ({
      id: `payload_${key}_${index}`,
      key,
      label: payloadItemLabel(key),
      value: stringifyPayloadItemValue(value),
      type: typeof value === "number" && Number.isInteger(value) ? "int" : typeof value === "number" ? "float" : typeof value === "boolean" ? "boolean" : typeof value === "object" ? "json" : "string",
      icon: "",
      iconColor: "",
      description: "",
      enabled: true,
      visible: index < 4,
    }));
  }
  return [];
};

const normalizePayloadEditorItems = (node = {}, config = {}) => {
  const raw = Array.isArray(config.payloadItems)
    ? config.payloadItems
    : (() => {
      try {
        const parsed = JSON.parse(String(config.payloadItems || ""));
        return Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    })();
  const base = Array.isArray(raw) && raw.length ? raw : payloadEditorDefaultItems(node, config);
  return (base || []).map((item, index) => {
    const key = String(item?.key || `field_${index + 1}`).trim() || `field_${index + 1}`;
    return {
      id: String(item?.id || `payload_${key}_${index}`).replace(/[^A-Za-z0-9_-]/g, "_"),
      key,
      label: String(item?.label || payloadItemLabel(key) || key),
      value: stringifyPayloadItemValue(item?.value ?? ""),
      type: payloadItemTypeOptions.includes(String(item?.type || "").toLowerCase()) ? String(item.type).toLowerCase() : "string",
      options: String(item?.options || ""),
      icon: String(item?.icon || ""),
      iconColor: String(item?.iconColor || item?.color || ""),
      description: String(item?.description || ""),
      enabled: item?.enabled !== false && item?.enabled !== "false",
      visible: item?.visible !== false && item?.visible !== "false",
    };
  });
};

const payloadEditorAvailable = (node = {}, config = {}) =>
  ["manual-json", "task", "graph-query", "knowledge-mechanism-cue-agent"].includes(nodeSubtype(node)) ||
  (nodeCategory(node) === "sources" && Boolean(config.payloadJson || config.payload || config.testPayload));

const payloadObjectFromItems = (items = []) => {
  const payload = {};
  items.forEach((item) => {
    const key = String(item?.key || "").trim();
    if (!key || item.enabled === false || item.enabled === "false") return;
    payload[key] = parsePayloadItemValue(item.value, item.type);
  });
  return payload;
};

const readPayloadEditorItems = (form) => {
  const field = form?.querySelector?.("[data-config-key='payloadItems']");
  if (!field?.value) return null;
  try {
    const parsed = JSON.parse(field.value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const syncPayloadEditorHidden = (root) => {
  if (!root) return;
  const hidden = root.querySelector("[data-config-key='payloadItems']");
  if (!hidden) return;
  const items = Array.from(root.querySelectorAll("[data-payload-item]")).map((row, index) => ({
    id: row.dataset.payloadItem || `payload_item_${index}`,
    key: row.querySelector("[data-payload-key]")?.value?.trim?.() || `field_${index + 1}`,
    label: row.querySelector("[data-payload-label]")?.value?.trim?.() || "",
    value: row.querySelector("[data-payload-value]")?.value ?? "",
    type: row.querySelector("[data-payload-type]")?.value || "string",
    options: row.querySelector("[data-payload-options]")?.value || "",
    icon: row.querySelector("[data-payload-icon]")?.value || "",
    iconColor: row.querySelector("[data-payload-icon-color]")?.value || "",
    description: row.querySelector("[data-payload-description]")?.value || "",
    enabled: Boolean(row.querySelector("[data-payload-enabled]")?.checked),
    visible: Boolean(row.querySelector("[data-payload-visible]")?.checked),
  }));
  hidden.value = JSON.stringify(items);
};

const payloadItemValuePreview = (item = {}) => {
  const value = String(item.value ?? "").replace(/\s+/g, " ").trim();
  return value || "empty";
};

const payloadItemSelectOptions = (item = {}) =>
  String(item.options || "")
    .split(/[,\n]/)
    .map((option) => option.trim())
    .filter(Boolean);

const payloadEditorCmsValue = (value) => value?.target?.value ?? value;

const updatePayloadEditorRowValue = (source, value = "") => {
  const row = source?.closest?.("[data-payload-item]");
  const root = source?.closest?.(".tl-flow-payload-editor");
  const hidden = row?.querySelector?.("[data-payload-value]");
  if (hidden) hidden.value = String(value ?? "");
  syncPayloadEditorHidden(root);
};

const updatePayloadEditorRowValueById = (id = "", value = "") => {
  const row = document.querySelector(`[data-payload-item="${String(id).replace(/"/g, '\\"')}"]`);
  const root = row?.closest?.(".tl-flow-payload-editor");
  const hidden = row?.querySelector?.("[data-payload-value]");
  if (hidden) hidden.value = String(value ?? "");
  syncPayloadEditorHidden(root);
};

const renderPayloadEditorValueControl = (item = {}) => {
  if (item.type === "boolean") {
    return _.Toggle({
      size: "sm",
      checked: item.value === true || item.value === "true" || item.value === "1",
      onChange: (checked) => updatePayloadEditorRowValueById(item.id, checked ? "true" : "false"),
    });
  }
  if (item.type === "select") {
    const options = payloadItemSelectOptions(item);
    return _.Select({
      size: "sm",
      label: item.label || payloadItemLabel(item.key) || "Value",
      class: "tl-flow-payload-row-value-control",
      icon: payloadItemIconNode(item),
      style: payloadItemIconStyle(item),
      value: item.value || options[0] || "",
      options: (options.length ? options : [item.value || ""]).map((value) => ({ value, label: value })),
      slots: { arrow: () => icon("keyboard_arrow_down", "sm") },
      onChange: (value) => updatePayloadEditorRowValueById(item.id, String(payloadEditorCmsValue(value) || "")),
    });
  }
  return _.Input({
    size: "sm",
    label: item.label || payloadItemLabel(item.key) || "Value",
    class: "tl-flow-payload-row-value-control",
    icon: payloadItemIconNode(item),
    style: payloadItemIconStyle(item),
    type: item.type === "int" || item.type === "float" ? "number" : "text",
    step: item.type === "float" ? "0.01" : item.type === "int" ? "1" : undefined,
    value: String(item.value ?? ""),
    autocomplete: "off",
    "aria-label": `${item.label || item.key || "Payload"} value`,
    onInput: (event) => updatePayloadEditorRowValue(event.currentTarget, payloadEditorCmsValue(event)),
  });
};

const writePayloadEditorRowDataset = (row, item = {}) => {
  if (!row) return;
  applyPayloadIconStyle(row, item);
  row.querySelector("[data-payload-key]").value = item.key || "";
  row.querySelector("[data-payload-label]").value = item.label || "";
  row.querySelector("[data-payload-value]").value = item.value ?? "";
  row.querySelector("[data-payload-type]").value = item.type || "string";
  row.querySelector("[data-payload-options]").value = item.options || "";
  const iconField = row.querySelector("[data-payload-icon]");
  if (iconField) iconField.value = item.icon || "";
  const iconColorField = row.querySelector("[data-payload-icon-color]");
  if (iconColorField) iconColorField.value = item.iconColor || "";
  const descriptionField = row.querySelector("[data-payload-description]");
  if (descriptionField) descriptionField.value = item.description || "";
  const label = row.querySelector("[data-payload-preview-label]");
  const meta = row.querySelector("[data-payload-preview-meta]");
  const valueSlot = row.querySelector("[data-payload-value-slot]");
  if (label) label.textContent = "";
  if (meta) meta.textContent = `${item.key || "field"} · ${item.type || "string"}`;
  if (valueSlot) {
    applyPayloadIconStyle(valueSlot, item);
    valueSlot.replaceChildren(renderPayloadEditorValueControl(item));
  }
};

const openPayloadItemDialog = ({ root, row = null, item = {}, formId = "", index = 0 } = {}) => {
  let draft = {
    id: item.id || `payload_custom_${Date.now()}`,
    key: item.key || `field_${index + 1}`,
    label: item.label || `Field ${index + 1}`,
    value: item.value ?? "",
    type: item.type || "string",
    options: item.options || "",
    icon: item.icon || "",
    iconColor: item.iconColor || "",
    description: item.description || "",
    enabled: item.enabled !== false,
    visible: item.visible !== false,
  };
  let dialog = null;
  const selectOptions = (values) => values.map((value) => ({ value, label: value }));
  const save = (close) => {
    const targetRow = row || renderPayloadEditorRow({ item: draft, formId, index });
    writePayloadEditorRowDataset(targetRow, draft);
    const enabled = targetRow.querySelector("[data-payload-enabled]");
    const visible = targetRow.querySelector("[data-payload-visible]");
    if (enabled) enabled.checked = Boolean(draft.enabled);
    if (visible) visible.checked = Boolean(draft.visible);
    if (!row) root?.querySelector?.(".tl-flow-payload-editor-list")?.append?.(targetRow);
    syncPayloadEditorHidden(root);
    close?.();
  };
  const valueField = () => {
    if (draft.type === "select") {
      const options = payloadItemSelectOptions(draft);
      return _.div(
        { class: "tl-flow-config-grid" },
        _.Input({
          size: "sm",
          label: "Options",
          value: draft.options,
          placeholder: "balanced, focused, full_ordered",
          autocomplete: "off",
          onInput: (event) => {
            draft.options = String(payloadEditorCmsValue(event) || "");
          },
        }),
        _.Select({
          size: "sm",
          label: "Value",
          value: draft.value || options[0] || "",
          options: selectOptions(options.length ? options : [draft.value || ""]),
          slots: { arrow: () => icon("keyboard_arrow_down", "sm") },
          onChange: (value) => {
            draft.value = String(payloadEditorCmsValue(value) || "");
          },
        })
      );
    }
    if (draft.type === "boolean") {
      return _.div(
        { class: "tl-flow-config-field is-check" },
        _.span("Value"),
        _.Toggle({
          size: "sm",
          checked: draft.value === true || draft.value === "true" || draft.value === "1",
          onChange: (checked) => {
            draft.value = checked ? "true" : "false";
          },
        })
      );
    }
    return _.Input({
      size: "sm",
      label: "Value",
      type: draft.type === "int" || draft.type === "float" ? "number" : "text",
      step: draft.type === "float" ? "0.01" : draft.type === "int" ? "1" : undefined,
      value: String(draft.value ?? ""),
      autocomplete: "off",
      placeholder: draft.type === "json" ? "{ \"value\": true }" : "",
      onInput: (event) => {
        draft.value = String(payloadEditorCmsValue(event) || "");
      },
    });
  };
  const content = ({ close }) => _.div(
    { class: "tl-flow-payload-item-dialog-body" },
    _.div(
      { class: "tl-flow-config-grid" },
      _.Input({
        size: "sm",
        label: "Key",
        value: draft.key,
        autocomplete: "off",
        onInput: (event) => {
          draft.key = String(payloadEditorCmsValue(event) || "");
        },
      }),
      _.Input({
        size: "sm",
        label: "Label",
        value: draft.label,
        autocomplete: "off",
        onInput: (event) => {
          draft.label = String(payloadEditorCmsValue(event) || "");
        },
      }),
      _.Input({
        size: "sm",
        label: "Description",
        value: draft.description,
        autocomplete: "off",
        placeholder: "What this payload item controls",
        onInput: (event) => {
          draft.description = String(payloadEditorCmsValue(event) || "");
        },
      }),
      _.Select({
        size: "sm",
        label: "Icon",
        class: "tl-flow-payload-icon-select",
        style: draft.iconColor ? { "--payload-icon-saved-color": draft.iconColor, "--payload-icon-color": draft.iconColor, "--set-color": draft.iconColor } : null,
        value: draft.icon || "",
        options: payloadItemIconOptions(),
        filterable: true,
        clearable: true,
        filterPlaceholder: "Search icon",
        icon: payloadItemIconNode(draft),
        slots: { arrow: () => icon("keyboard_arrow_down", "sm") },
        onChange: (value) => {
          draft.icon = String(payloadEditorCmsValue(value) || "").trim();
        },
      }),
      _.Input({
        size: "sm",
        label: "Icon color",
        class: "tl-flow-payload-icon-color",
        type: "color",
        icon: "palette",
        value: draft.iconColor || "#22c55e",
        onInput: (event) => {
          draft.iconColor = String(payloadEditorCmsValue(event) || "").trim();
          event.currentTarget
            ?.closest?.(".tl-flow-payload-item-dialog-body")
            ?.querySelector?.(".tl-flow-payload-icon-select")
            ?.style?.setProperty?.("--payload-icon-saved-color", draft.iconColor);
          event.currentTarget
            ?.closest?.(".tl-flow-payload-item-dialog-body")
            ?.querySelector?.(".tl-flow-payload-icon-select")
            ?.style?.setProperty?.("--payload-icon-color", draft.iconColor);
          event.currentTarget
            ?.closest?.(".tl-flow-payload-item-dialog-body")
            ?.querySelector?.(".tl-flow-payload-icon-select")
            ?.style?.setProperty?.("--set-color", draft.iconColor);
          event.currentTarget
            ?.closest?.(".tl-flow-payload-item-dialog-body")
            ?.querySelectorAll?.(".tl-flow-payload-icon-select .cms-addon .cms-icon")
            ?.forEach?.((node) => {
              node.style.color = draft.iconColor;
            });
        },
      }),
      _.Select({
        size: "sm",
        label: "Type",
        value: draft.type,
        options: selectOptions(payloadItemTypeOptions),
        slots: { arrow: () => icon("keyboard_arrow_down", "sm") },
        onChange: (value) => {
          draft.type = String(payloadEditorCmsValue(value) || "string");
          dialog?.close?.();
          openPayloadItemDialog({ root, row, item: draft, formId, index });
        },
      }),
      _.div(
        { class: "tl-flow-config-field is-check" },
        _.span("Enabled"),
        _.Toggle({
          size: "sm",
          checked: draft.enabled,
          onChange: (checked) => {
            draft.enabled = Boolean(checked);
          },
        })
      ),
      _.div(
        { class: "tl-flow-config-field is-check" },
        _.span("Visible on node"),
        _.Toggle({
          size: "sm",
          checked: draft.visible,
          onChange: (checked) => {
            draft.visible = Boolean(checked);
          },
        })
      )
    ),
    valueField(),
    _.Toolbar(
      { align: "end", gap: 8 },
      btn({ type: "button", onclick: close }, "Cancel"),
      btn({ type: "button", class: "st-btn-primary", onclick: () => save(close) }, icon("save", "sm"), "Save Payload")
    )
  );
  dialog = _.Dialog({
    class: "tl-flow-config-dialog tl-flow-payload-item-dialog",
    panelClass: "tl-flow-config-panel tl-flow-payload-item-panel",
    size: "md",
    title: row ? "Edit payload item" : "Add payload item",
    subtitle: draft.label || draft.key,
    icon: "data_object",
    closeButton: true,
    closeOnOutside: false,
    closeOnBackdrop: false,
    content,
  });
  dialog.open();
};

const renderPayloadEditorRow = ({ item, formId, index }) => {
  return _.div(
    { class: "tl-flow-payload-editor-row", "data-payload-item": item.id || `payload_item_${index}`, style: payloadItemIconStyle(item) },
    _.input({ type: "hidden", "data-payload-key": "true", value: item.key }),
    _.input({ type: "hidden", "data-payload-label": "true", value: item.label }),
    _.input({ type: "hidden", "data-payload-value": "true", value: item.value }),
    _.input({ type: "hidden", "data-payload-type": "true", value: item.type || "string" }),
    _.input({ type: "hidden", "data-payload-options": "true", value: item.options || "" }),
    _.input({ type: "hidden", "data-payload-icon": "true", value: item.icon || "" }),
    _.input({ type: "hidden", "data-payload-icon-color": "true", value: item.iconColor || "" }),
    _.input({ type: "hidden", "data-payload-description": "true", value: item.description || "" }),
    _.div(
      { class: "tl-flow-payload-editor-preview", title: payloadItemValuePreview(item) },
      _.strong({ "data-payload-preview-label": "true" }, ""),
      _.div({ class: "tl-flow-payload-editor-value-slot", "data-payload-value-slot": "true", style: payloadItemIconStyle(item) }, renderPayloadEditorValueControl(item)),
      _.em({ "data-payload-preview-meta": "true" }, `${item.key || "field"} · ${item.type || "string"}`)
    ),
    _.label(
      { class: "tl-flow-payload-editor-toggle", title: "Use this item in emitted payload/config" },
      _.input({ type: "checkbox", checked: item.enabled, "data-payload-enabled": "true", onchange: (event) => syncPayloadEditorHidden(event.currentTarget.closest(".tl-flow-payload-editor")) }),
      _.span("on")
    ),
    _.label(
      { class: "tl-flow-payload-editor-toggle", title: "Show this item on the node card" },
      _.input({ type: "checkbox", checked: item.visible, "data-payload-visible": "true", onchange: (event) => syncPayloadEditorHidden(event.currentTarget.closest(".tl-flow-payload-editor")) }),
      _.span("node")
    ),
    btn({
      type: "button",
      class: "tl-flow-payload-editor-edit",
      title: "Edit payload item",
      onclick: (event) => {
        const row = event.currentTarget.closest("[data-payload-item]");
        const root = event.currentTarget.closest(".tl-flow-payload-editor");
        const draft = {
          id: row?.dataset.payloadItem || item.id,
          key: row?.querySelector("[data-payload-key]")?.value || item.key,
          label: row?.querySelector("[data-payload-label]")?.value || item.label,
          value: row?.querySelector("[data-payload-value]")?.value || item.value,
          type: row?.querySelector("[data-payload-type]")?.value || item.type || "string",
          options: row?.querySelector("[data-payload-options]")?.value || item.options || "",
          icon: row?.querySelector("[data-payload-icon]")?.value || item.icon || "",
          iconColor: row?.querySelector("[data-payload-icon-color]")?.value || item.iconColor || "",
          description: row?.querySelector("[data-payload-description]")?.value || item.description || "",
          enabled: Boolean(row?.querySelector("[data-payload-enabled]")?.checked),
          visible: Boolean(row?.querySelector("[data-payload-visible]")?.checked),
        };
        openPayloadItemDialog({ root, row, item: draft, formId, index });
      },
    }, icon("edit", "sm")),
    btn({
      type: "button",
      class: "tl-flow-payload-editor-remove",
      title: "Remove payload item",
      onclick: (event) => {
        const root = event.currentTarget.closest(".tl-flow-payload-editor");
        event.currentTarget.closest("[data-payload-item]")?.remove?.();
        syncPayloadEditorHidden(root);
      },
    }, icon("close", "sm"))
  );
};

const renderPayloadEditor = ({ node = {}, defaults = {}, formId = "" } = {}) => {
  const config = defaults.configObject || nodeConfigObject(node);
  if (!payloadEditorAvailable(node, config)) return null;
  const items = normalizePayloadEditorItems(node, config);
  return _.section(
    { class: "tl-flow-config-section tl-flow-payload-editor", "data-payload-editor-root": "true" },
    _.div(
      { class: "tl-flow-payload-editor-head" },
      _.div(
        _.h3("Payload editor"),
        _.p("Each payload item can be enabled for runtime and pinned on the node card.")
      ),
      btn({
        type: "button",
        class: "tl-flow-payload-editor-add",
        onclick: (event) => {
          const root = event.currentTarget.closest(".tl-flow-payload-editor");
          const list = root?.querySelector?.(".tl-flow-payload-editor-list");
          if (!root || !list) return;
          const index = list.querySelectorAll("[data-payload-item]").length;
          const item = { id: `payload_custom_${Date.now()}`, key: `field_${index + 1}`, label: `Field ${index + 1}`, value: "", type: "string", icon: "", iconColor: "", description: "", enabled: true, visible: true };
          openPayloadItemDialog({ root, item, formId, index });
        },
      }, icon("add", "sm"), "Add Payload")
    ),
    _.input({ type: "hidden", "data-config-key": "payloadItems", value: JSON.stringify(items) }),
    _.div(
      { class: "tl-flow-payload-editor-list" },
      ...items.map((item, index) => renderPayloadEditorRow({ item, formId, index }))
    )
  );
};

const flattenRuntimeConfig = (config = {}) => {
  const source = config && typeof config === "object" && !Array.isArray(config) ? { ...config } : {};
  const nested = parseConfigObject(source.config);
  if (!nested) return source;
  delete source.config;
  return { ...source, ...flattenRuntimeConfig(nested) };
};

const readConfigMap = (form, node = {}) => {
  const config = {};
  Array.from(form?.querySelectorAll?.("[data-config-key]") || []).forEach((field) => {
    if (field.disabled) return;
    const key = field.dataset.configKey;
    if (!key) return;
    const value = field.type === "checkbox" ? field.checked : field.value?.trim?.() || "";
    if (key === "config") {
      const parsed = parseConfigObject(value);
      if (parsed) Object.assign(config, flattenRuntimeConfig(parsed));
      else if (value) config.config = value;
      return;
    }
    config[key] = value;
  });
  const payloadItems = readPayloadEditorItems(form);
  if (payloadItems) {
    config.payloadItems = payloadItems;
    const subtype = nodeSubtype(node);
    if (subtype === "manual-json") config.json = JSON.stringify(payloadObjectFromItems(payloadItems), null, 2);
    else if (["graph-query", "task"].includes(subtype)) {
      payloadItems.forEach((item) => {
        const key = String(item?.key || "").trim();
        if (!key) return;
        config[key] = item.enabled === false || item.enabled === "false" ? "" : parsePayloadItemValue(item.value, item.type);
      });
    }
  }
  return flattenRuntimeConfig(config);
};

const runtimeContractSchemaFields = (schema = {}) =>
  window.TrackerLensRuntimeContract?.normalizeSettingsSchema
    ? window.TrackerLensRuntimeContract.normalizeSettingsSchema(schema)
    : Object.entries(schema || {}).map(([key, type]) => ({ key, label: key, type: String(type || "string") }));

const AI_PROVIDER_CONFIG_KEYS = new Set(["providerProfile", "providerType", "model", "temperature", "maxTokens", "maxContinuationCalls", "topP", "streaming", "responseFormat"]);
const AI_PROMPT_CONFIG_KEYS = new Set(["systemPrompt", "promptTemplate", "outputInstructions"]);
const KNOWLEDGE_RULE_MODE_CONFIG_KEYS = new Set(["entityMode", "dictionaryMode", "eventMode", "enrichmentMode", "cueMode", "queryExpansionMode", "compositionMode"]);
const AI_PROVIDER_FIELD_DEFINITIONS = Object.freeze([
  { key: "providerProfile", label: "Provider Profile", type: "ai-provider-profile" },
  { key: "providerType", label: "Provider Type", type: "ai-provider-type" },
  { key: "model", label: "Model", type: "ai-model" },
  { key: "temperature", label: "Temperature", type: "number", placeholder: "0.2", defaultValue: "0.2", step: "0.1" },
  { key: "maxTokens", label: "Max Tokens", type: "number", placeholder: "800", defaultValue: "800" },
  { key: "maxContinuationCalls", label: "Max Continuations", type: "number", placeholder: "10", defaultValue: "10" },
  { key: "topP", label: "Top P", type: "number", placeholder: "0.9", defaultValue: "0.9", step: "0.05" },
  { key: "streaming", label: "Streaming", type: "select", options: ["false", "true"], defaultValue: "false" },
  { key: "responseFormat", label: "Response Format", type: "select", options: ["json", "structured", "text", "markdown"], defaultValue: "json" },
]);

const withAiProviderConfigFields = (fields = [], { includeAdvanced = true } = {}) => [
  ...AI_PROVIDER_FIELD_DEFINITIONS.filter((field) => includeAdvanced || ["providerProfile", "providerType", "model"].includes(field.key)),
  ...fields.filter((field) => !AI_PROVIDER_CONFIG_KEYS.has(field.key)),
];

const knowledgeAiPromptDefaults = (subtype = "") => {
  if (subtype === "knowledge-dictionary-builder") {
    return {
      systemPrompt: "You are a Knowledge Dictionary Builder. Build a reusable lexical memory from local chunks only, preserving source-language terms and evidence.",
      promptTemplate: "Use the supplied chunks to propose stable names, roles, places, objects, concepts, creatures, sources, aliases, semantic hints and relation cues that improve later graph extraction without inventing labels.",
      outputInstructions: "Return strict JSON with entries. Every entry must include term, type, aliases, confidence, explanation and an exact evidence.quote copied from a supplied chunk. Reject weak fragments and unsupported aliases.",
    };
  }
  if (subtype === "knowledge-event-builder") {
    return {
      systemPrompt: "You are a Knowledge Event Builder. Extract ordered, evidence-backed narrative and semantic events from local document chunks while preserving temporal order and causal roles.",
      promptTemplate: "Use only provided chunks and dictionary terms. Extract explicit actions, state changes, causality, preparation, transformation, speech, failed attempts and outcomes as separate ordered events with source-language labels.",
      outputInstructions: "Return strict JSON with events and rejectedCandidates. Every accepted event must include eventType, subject, objects, confidence, evidence.chunkId, exact evidence.quote and explanation. Do not infer facts outside evidence.",
    };
  }
  if (subtype === "entity-extractor") {
    return {
      systemPrompt: "You are a Knowledge Entity Extractor.\nExtract only evidence-backed entities and explicit relations from the supplied chunks.\nUse only relationType values from allowedRelationTypes exactly as written.\nDo not invent relationType names.\nIf no allowed relationType fits the evidence, omit the relation.\nEvery entity and relation must include an exact evidence.quote copied from a supplied chunk.\nReturn only strict JSON.",
      promptTemplate: "Use supplied chunks and dictionary terms to propose precise entities and directly supported relations. Keep entities stable, avoid weak fragments, and do not collapse later consequences into earlier causes.",
      outputInstructions: "Return strict JSON with entities and relations.\nrelationType must be one of allowedRelationTypes exactly.\nDo not invent relationType names.\nIf no allowed relationType fits the evidence, omit the relation.\nEvery accepted entity/relation must include confidence, explanation and an exact evidence.quote copied from a supplied chunk.\nOmit unsupported candidates.",
    };
  }
  if (subtype === "semantic-relation-enricher") {
    return {
      systemPrompt: "You are a Semantic Relation Enricher. Classify candidate entity pairs into high-signal semantic relations using only supplied evidence. For narrative text, respect event order and causal roles.",
      promptTemplate: "Use only candidate evidence text and chunk context. Prefer explicit semantic relations over generic links and reject unsupported pairs. Use healed_by only when the evidence directly shows the patient being cured by that object/source. If an object gains a healing property after the cure, classify that as has_property or causes only when supported, not as person healed_by object.",
      outputInstructions: "Return strict JSON with relations containing candidateId, relationType, confidence and explanation.",
    };
  }
  if (subtype === "knowledge-graph-builder-agent") {
    return {
      systemPrompt: "You are a Knowledge Graph Builder Agent. Build a verified, evidence-backed knowledge graph from local document chunks while preserving temporal order, causal roles and source-language labels.",
      promptTemplate: "Use chunks, existing entities and base relations as context. Propose only stable entities and precise relations directly supported by exact source quotes. Prefer explicit narrative or domain semantics over generic links, but reject weak or absent evidence.",
      outputInstructions: "Return strict JSON with entities, relations and rejectedCandidates. Every accepted entity/relation must include confidence, explanation and an exact evidence.quote copied from one supplied chunk. Do not infer unsupported sequence, cause, count or identity.",
    };
  }
  if (subtype === "knowledge-mechanism-cue-agent") {
    return {
      systemPrompt: "You are a Knowledge Mechanism Cue Agent. You do not answer the user. You identify only document-grounded retrieval cues that help find the concrete method, cause, transformation and direct outcome evidence in the supplied chunks.",
      promptTemplate: "Read the question and chunk previews in document order. For how/process/healing questions, prioritize the required sequence: item/tool/substance, preparation, container, transformation, action performed by or on the target, and the target's direct state change. Separate those from later consequences, background, public effects or generic setup.",
      outputInstructions: "Return strict JSON with operationalTerms, transformationTerms, outcomeTerms, downrankTerms and rationale. Use only exact source-language words or short phrases present in the chunks. Put later consequences or broad properties after the target outcome in downrankTerms unless the question asks for those consequences. Do not add final-answer wording or causal conclusions.",
    };
  }
  if (subtype === "graph-query") {
    return {
      systemPrompt: "You are a Knowledge Graph Query Expander. Improve retrieval only from the user's query and runtime intent. Do not answer, summarize, filter evidence or decide what the final answer should contain.",
      promptTemplate: "Generate generic, multilingual retrieval terms that can help find relevant entities, relations, events and chunks. Preserve the original query meaning and never add story-specific names, causal conclusions or answer boundaries.",
      outputInstructions: "Return strict JSON with retrievalTerms, optional intentHints and a short retrieval-only rationale. Omit unsupported or over-specific terms. Terms must be generic verbs/concepts, not proper names unless already present in the user query.",
    };
  }
  if (subtype === "knowledge-reasoning-composer") {
    return {
      systemPrompt: "You are a Knowledge Reasoning Composer. Build an answer plan from supplied graph evidence without inventing facts.",
      promptTemplate: "Use the local reasoning plan, graph evidence and original source excerpts. Improve evidence focus and selected evidence while preserving enough source text for the downstream LLM.",
      outputInstructions: "Return strict JSON with answerFocus and selectedEvidenceQuotes. Every selected quote must appear verbatim in the supplied evidence. Do not add final-answer boundaries, brevity rules or semantic narrowing.",
    };
  }
  return {
    systemPrompt: "You are a Trackers Lens Knowledge AI node. Use only provided runtime context and return structured, evidence-backed output.",
    promptTemplate: "Process the provided payload according to this node's Knowledge contract.",
    outputInstructions: "Return strict JSON only.",
  };
};

const knowledgeAiPromptFieldDefinitions = (subtype = "") => {
  const defaults = knowledgeAiPromptDefaults(subtype);
  return [
    { key: "systemPrompt", label: "System Prompt", type: "textarea", rows: 6, defaultValue: defaults.systemPrompt },
    { key: "promptTemplate", label: "Prompt Template", type: "textarea", rows: 7, defaultValue: defaults.promptTemplate },
    { key: "outputInstructions", label: "Output Instructions", type: "textarea", rows: 5, defaultValue: defaults.outputInstructions },
  ];
};

const knowledgeCustomRulesDefaults = (subtype = "") => {
  const base = {
    version: 1,
    mode: "extend",
    modeHelp: "extend aggiunge questi valori ai default runtime; replace sostituisce i default dichiarativi supportati quando presenti.",
  };
  const graphSourceTerms = [
    "dice", "disse", "detto", "racconta", "spiega", "rivela", "indica", "comunica", "avverte",
    "segreto", "soluzione", "consiglio", "istruzione", "informazione", "metodo", "luogo",
    "tells", "told", "says", "said", "explains", "reveals", "warns", "secret", "solution", "advice", "instruction", "method", "place",
    "dijo", "cuenta", "explica", "revela", "advierte", "secreto", "solucion", "consejo", "metodo",
    "dit", "raconte", "explique", "revele", "conseil", "methode",
    "sagt", "sagte", "erklart", "geheimnis", "losung", "methode",
  ];
  const graphDangerTerms = [
    "pericolo", "pericoli", "pericoloso", "rischio", "ostacolo", "minaccia", "attacco", "ferisce", "ferito", "mostro", "nemico", "affronta",
    "danger", "dangerous", "risk", "obstacle", "threat", "attack", "injured", "wounded", "monster", "enemy", "confront",
    "peligro", "riesgo", "amenaza", "ataque", "herido", "monstruo",
    "danger", "dangereux", "risque", "menace", "attaque", "blesse", "monstre",
    "gefahr", "risiko", "bedrohung", "angriff", "verletzt",
  ];
  const mechanismTerms = {
    operational: [
      "beve", "bevve", "bevuto", "bere", "drink", "drank", "drinks",
      "riempie", "fill", "filled",
      "immerge", "immerse", "immerso", "immersa",
    ],
    transformation: ["trasforma", "trasformandosi", "bollire", "bolle", "boil", "boiled"],
    outcome: ["parla", "parlare", "parola", "voce", "grido", "speak", "voice", "word"],
    downrank: [],
    terms: ["cura", "guarire", "guarito", "heal", "healed", "processo", "metodo", "cause", "outcome"],
  };
  const dictionaryTypes = {
    location: [],
    object: [],
    creature: [],
    concept: [],
    role: [],
  };
  const entityTerms = {
    ...dictionaryTypes,
    source: [],
    symbol: [],
    technology: ["api", "runtime", "indexeddb", "ollama", "studio", "openai", "rag", "json", "php", "javascript"],
  };
  const eventRules = [
    { eventType: "cannot_speak", cuePatterns: ["non\\\\s+(?:pu[oò]|poteva|riesce|riusciva|riusc[iì])\\\\s+(?:a\\\\s+)?parlare", "non\\\\s+parlava", "cannot\\\\s+speak", "could\\\\s+not\\\\s+speak", "unable\\\\s+to\\\\s+speak"], negativePatterns: [], objectHints: ["voce", "voice", "parola", "speech"], confidence: 0.78 },
    { eventType: "finds", cuePatterns: ["trovarono", "trov[oò]", "scopr[iì]", "found", "finds", "discovered", "discover"], negativePatterns: [], objectHints: [], confidence: 0.68 },
    { eventType: "seeks", cuePatterns: ["cercando", "cerca", "cercava", "cercare", "seeks", "searches", "looking for"], negativePatterns: [], objectHints: ["cura", "cure", "soluzione", "solution"], confidence: 0.72 },
    { eventType: "fills", cuePatterns: ["riempirono", "riemp[iì]", "riempire", "filled", "fills"], negativePatterns: [], objectHints: [], confidence: 0.82 },
    { eventType: "immerses", cuePatterns: ["immersero", "immerse", "immerso", "immersa", "immergere", "dipped", "immersed"], negativePatterns: [], objectHints: [], confidence: 0.86 },
    { eventType: "transforms", cuePatterns: ["trasformandosi", "trasform[oò]", "trasforma", "became", "becomes", "turned into", "transform"], negativePatterns: [], objectHints: [], confidence: 0.88 },
    { eventType: "takes", cuePatterns: ["prese", "prende", "presero", "took", "takes"], negativePatterns: [], objectHints: [], confidence: 0.7 },
    { eventType: "drinks", cuePatterns: ["bevve", "beve", "bevuto", "bere", "drank", "drinks", "drink"], negativePatterns: [], objectHints: [], confidence: 0.92 },
    { eventType: "has_property", cuePatterns: ["possiede", "possedeva", "possiedono", "possesses", "possessed", "potere", "poteri", "propriet[aà]", "capacit[aà]", "power", "property", "ability"], negativePatterns: [], objectHints: [], confidence: 0.76 },
    { eventType: "heals", cuePatterns: ["guar[iì]", "guarito", "guarire", "guarisce", "cur[oò]", "curare", "healed", "heals", "cured", "cure"], negativePatterns: [], objectHints: [], confidence: 0.9 },
    { eventType: "speaks", cuePatterns: ["parl[oò]", "parla", "pronunciava", "pronunci[oò]", "disse", "dice", "grid[oò]", "speak", "spoke", "said", "shouted"], negativePatterns: ["far|fare|modo\\\\s+per|desideri|possa|potesse|riusc[iì]|riuscire"], objectHints: [], confidence: 0.82 },
    { eventType: "moves", cuePatterns: ["corsero", "and[oò]", "andarono", "scese", "scesero", "went", "ran", "walked"], negativePatterns: [], objectHints: [], confidence: 0.42 },
    { eventType: "signals", cuePatterns: ["sorrise", "annu[iì]", "guard[oò]", "smiled", "nodded", "looked"], negativePatterns: [], objectHints: [], confidence: 0.4 },
  ];
  if (subtype === "graph-query") {
    return {
      ...base,
      expansionTerms: {
        source: graphSourceTerms,
        danger: graphDangerTerms,
        retrieval: [],
      },
      mechanismTerms,
    };
  }
  if (subtype === "knowledge-mechanism-cue-agent") {
    return {
      ...base,
      mechanismTerms,
    };
  }
  if (subtype === "semantic-relation-enricher") {
    return {
      ...base,
      semanticRelationRules: [
        {
          relationType: "friend_of",
          sourceTypes: ["proper-noun"],
          targetTypes: ["proper-noun"],
          cuePatterns: ["friend|friends|friendship|amico|amica|amici|amicizia|amigo|amiga|amistad|ami|amie|freund"],
          negativePatterns: [],
          confidence: 0.74,
          explanation: "friendship cue",
        },
        {
          relationType: "helps",
          sourceTypes: ["proper-noun"],
          targetTypes: ["proper-noun", "creature", "concept"],
          cuePatterns: ["help|helps|helped|aiuta|aiuto|aiut[oò]|ayuda|aide|hilft"],
          negativePatterns: ["tried|tries|tent|cerca|prova"],
          confidence: 0.72,
          explanation: "help cue",
        },
        {
          relationType: "tries_to_help",
          sourceTypes: ["proper-noun"],
          targetTypes: ["proper-noun", "creature", "concept"],
          cuePatterns: ["tried.{0,80}help|tries.{0,80}help|cerca.{0,80}aiut|tenta.{0,80}aiut|prova.{0,80}aiut"],
          negativePatterns: [],
          confidence: 0.7,
          explanation: "attempted help cue",
        },
        {
          relationType: "healed_by",
          sourceTypes: ["proper-noun"],
          targetTypes: ["object", "source"],
          cuePatterns: ["heal|healed|heals|cure|cured|cura|cur[oò]|guarisce|guar[iì]|guarito"],
          negativePatterns: ["bastone|stick|spada|sword|arma|weapon|pietra|stone"],
          confidence: 0.78,
          explanation: "healing cue",
        },
        {
          relationType: "cannot_speak",
          sourceTypes: ["proper-noun"],
          targetTypes: ["concept", "quote"],
          cuePatterns: ["cannot.{0,80}speak|could not.{0,80}speak|unable.{0,80}speak|non poteva.{0,80}parlare|non riesce.{0,80}parlare|mute|muto|muta"],
          negativePatterns: [],
          confidence: 0.76,
          explanation: "failed speech cue",
        },
        {
          relationType: "uses",
          sourceTypes: ["proper-noun"],
          targetTypes: ["object"],
          cuePatterns: ["uses|used|using|utilizza|utilizz[oò]|usa|us[oò]|afferra|prende|prese|takes|took|with|con"],
          negativePatterns: [],
          confidence: 0.72,
          explanation: "use/action-object cue",
        },
        {
          relationType: "has_property",
          sourceTypes: ["object", "concept", "source"],
          targetTypes: ["concept", "object"],
          cuePatterns: ["has|had|property|quality|possesses|possessed|possiede|possedeva|propriet[aà]|potere|capacit"],
          negativePatterns: [],
          confidence: 0.64,
          explanation: "property cue",
        },
        {
          relationType: "lives_in",
          sourceTypes: ["proper-noun"],
          targetTypes: ["location"],
          cuePatterns: ["lives|lived|dwells|abita|abitava|vive|viveva|habite|wohn"],
          negativePatterns: [],
          confidence: 0.68,
          explanation: "location residence cue",
        },
        {
          relationType: "opposes",
          sourceTypes: ["proper-noun", "creature"],
          targetTypes: ["proper-noun", "creature", "concept"],
          cuePatterns: ["opposes|opposed|against|contro|oppone|contrasta|defeats|sconfigge"],
          negativePatterns: [],
          confidence: 0.7,
          explanation: "opposition cue",
        },
      ],
    };
  }
  if (subtype === "entity-extractor") {
    return {
      ...base,
      notes: "Declarative Entity rules used in Rules/Hybrid mode. Executable code is ignored.",
      stopWords: [],
      seedTerms: [],
      entityTypes: [],
      entityTerms,
    };
  }
  if (subtype === "knowledge-dictionary-builder") {
    return {
      ...base,
      notes: "Declarative Dictionary rules used in Rules/Hybrid mode. Executable code is ignored.",
      stopWords: [],
      blockTerms: [],
      dictionaryTypes,
    };
  }
  if (subtype === "knowledge-event-builder") {
    return {
      ...base,
      notes: "Declarative Event rules used in Rules/Hybrid mode. eventType must be a supported Knowledge event type. Executable code is ignored.",
      blockedEventTerms: [],
      objectHints: [],
      eventRules,
    };
  }
  if (subtype === "knowledge-reasoning-composer") {
    return {
      ...base,
      notes: "Reasoning Composer rules are configured by its structured fields and graph/reasoning context. This JSON is declarative metadata; executable code is ignored.",
    };
  }
  return {
    ...base,
    notes: "Custom declarative rules for this Knowledge node. The runtime ignores executable code.",
  };
};

const parseKnowledgeCustomRules = (value = "") => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  const text = String(value || "").trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
};

const knowledgeCustomRulesText = (node = {}, subtype = "") => {
  const current = nodeConfigObject(node).customRules;
  const isLegacyPlaceholder = (value = {}) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const keys = Object.keys(value).sort();
    return keys.every((key) => ["mode", "modeHelp", "notes", "version"].includes(key)) &&
      /runtime ignores executable code/i.test(String(value.notes || ""));
  };
  if (typeof current === "string" && current.trim()) {
    const parsed = parseKnowledgeCustomRules(current);
    if (isLegacyPlaceholder(parsed)) return JSON.stringify(knowledgeCustomRulesDefaults(subtype), null, 2);
    return parsed ? JSON.stringify(parsed, null, 2) : current;
  }
  if (isLegacyPlaceholder(current)) return JSON.stringify(knowledgeCustomRulesDefaults(subtype), null, 2);
  if (current && typeof current === "object" && !Array.isArray(current)) return JSON.stringify(current, null, 2);
  return JSON.stringify(knowledgeCustomRulesDefaults(subtype), null, 2);
};

const knowledgeRulesModeValue = (form = null) => {
  const field = form?.querySelector?.("[data-knowledge-rule-mode-field='true']");
  return String(field?.value || "").toLowerCase();
};

const knowledgeRulesActive = (form = null) => ["rules", "hybrid"].includes(knowledgeRulesModeValue(form));

const knowledgeRuleModeKeyForSubtype = (subtype = "") => ({
  "entity-extractor": "entityMode",
  "knowledge-dictionary-builder": "dictionaryMode",
  "knowledge-event-builder": "eventMode",
  "semantic-relation-enricher": "enrichmentMode",
  "knowledge-mechanism-cue-agent": "cueMode",
  "graph-query": "queryExpansionMode",
  "knowledge-reasoning-composer": "compositionMode",
}[subtype] || "");

const knowledgeRulesActiveForNode = (node = {}, subtype = "") => {
  const key = knowledgeRuleModeKeyForSubtype(subtype);
  if (!key) return false;
  return ["rules", "hybrid"].includes(String(nodeConfigObject(node)[key] || "").toLowerCase());
};

const refreshKnowledgeRulesButtons = (form = null) => {
  if (!form) return;
  const active = knowledgeRulesActive(form);
  form.querySelectorAll("[data-knowledge-rules-action='true']").forEach((item) => {
    item.hidden = !active;
    item.style.display = active ? "" : "none";
  });
};

const openKnowledgeCustomRulesDialog = ({ node = {}, subtype = "", form = null, hidden = null } = {}) => {
  const input = hidden || form?.querySelector?.("[data-config-key='customRules']");
  const initialText = String(input?.value || knowledgeCustomRulesText(node, subtype));
  const editorId = `tl-rules-editor-${Date.now()}`;
  let editor = null;
  let latestText = initialText;
  let errorNode = null;
  const validate = () => {
    try {
      const parsed = JSON.parse(latestText || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("customRules deve essere un oggetto JSON.");
      if (errorNode) errorNode.textContent = "";
      return parsed;
    } catch (error) {
      if (errorNode) errorNode.textContent = error?.message || "JSON non valido.";
      return null;
    }
  };
  const dialog = _.Dialog({
    class: "tl-flow-config-dialog tl-flow-rules-dialog",
    panelClass: "tl-flow-config-panel tl-flow-rules-panel",
    size: "lg",
    title: "Edit Rules",
    subtitle: `${node.label || node.id || subtype} · customRules`,
    icon: "rule",
    closeButton: true,
    closeOnOutside: false,
    closeOnBackdrop: false,
    content: () => _.div(
      { class: "tl-flow-rules-editor-body" },
      _.input({ type: "hidden", id: `${editorId}-fallback`, value: initialText }),
      _.div({ id: editorId, class: "tl-flow-rules-codemirror-host" }),
      _.p({ class: "tl-flow-muted" }, "JSON dichiarativo. Viene applicato quando la modalità del nodo è Rules o Hybrid; non viene eseguito codice JavaScript."),
      _.p({ class: "tl-flow-error-text", id: `${editorId}-error` })
    ),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({
        onclick: () => {
          const formatted = JSON.stringify(knowledgeCustomRulesDefaults(subtype), null, 2);
          latestText = formatted;
          editor?.setValue?.(formatted);
        },
      }, icon("restart_alt", "sm"), "Reset default"),
      btn({
        onclick: () => {
          const parsed = validate();
          if (!parsed) return;
          const formatted = JSON.stringify(parsed, null, 2);
          latestText = formatted;
          editor?.setValue?.(formatted);
        },
      }, icon("check", "sm"), "Validate"),
      btn({ onclick: close }, "Cancel"),
      btn({
        class: "st-btn-primary",
        onclick: () => {
          const parsed = validate();
          if (!parsed) return;
          if (input) input.value = JSON.stringify(parsed, null, 2);
          editor?.destroy?.();
          close();
        },
      }, icon("save", "sm"), "Save Rules")
    ),
  });
  dialog.open();
  errorNode = document.getElementById(`${editorId}-error`);
  const host = document.getElementById(editorId);
  if (host && window.TLCodeMirror?.createEditor) {
    editor = window.TLCodeMirror.createEditor({
      parent: host,
      doc: initialText,
      language: "javascript",
      onChange: (value) => {
        latestText = value;
        if (errorNode) errorNode.textContent = "";
      },
    });
    queueMicrotask(() => editor?.focus?.());
  } else {
    host?.replaceChildren?.(_.textarea({
      rows: 18,
      value: initialText,
      oninput: (event) => {
        latestText = event.currentTarget.value;
      },
    }));
  }
};

const renderKnowledgeCustomRulesControl = ({ node = {}, subtype = "", formId = "" } = {}) => {
  if (!subtype || !formId || !knowledgeRuleModeKeyForSubtype(subtype)) return null;
  const active = knowledgeRulesActiveForNode(node, subtype);
  return _.div(
    {
      class: "tl-flow-config-field is-wide tl-flow-rules-control",
      "data-knowledge-rules-action": "true",
      hidden: !active,
      style: active ? null : { display: "none" },
    },
    _.input({ type: "hidden", "data-config-key": "customRules", value: knowledgeCustomRulesText(node, subtype) }),
    btn({
      class: "st-btn-primary tl-flow-rules-edit-action",
      onclick: (event) => {
        event.preventDefault();
        const form = document.getElementById(formId) || event.currentTarget.closest("form");
        openKnowledgeCustomRulesDialog({
          node,
          subtype,
          form,
          hidden: form?.querySelector?.("[data-config-key='customRules']"),
        });
      },
    }, icon("rule", "sm"), "Edit Rules")
  );
};

const runtimeNodeUpdateFromValues = ({ node, values = {} }) => {
  const defaults = runtimeNodeConfigDefaults(node);
  const label = values.label ?? defaults.label;
  const input = values.input ?? defaults.input;
  const output = values.output ?? defaults.output;
  const mode = values.mode ?? defaults.mode;
  const runtimeStatus = values.runtimeStatus ?? defaults.runtimeStatus;
  const config = flattenRuntimeConfig({ ...defaults.configObject, ...(values.config || {}) });
  const subtype = nodeSubtype(node);
  const category = nodeCategory(node);
  const outputs = subtype === "agent-bridge"
    ? ["action"]
    : subtype === "condition"
      ? [config.trueOutput || defaults.trueOutput || "true", config.falseOutput || defaults.falseOutput || "false"].filter(Boolean)
      : category === "actions" || category === "storage" || category === "lens" || category === "dev"
        ? []
        : [output].filter(Boolean);
  const inputs = subtype === "agent-bridge"
    ? [AGENT_CONTROL_PORT_NAME, "listening"]
    : category === "sources" ? [] : [input].filter(Boolean);
  const manifestInputs = category === "sources" ? sourceConfigInputPorts(subtype) : inputs;
  const channels = [...new Set([...inputs, ...outputs].filter(Boolean))];
  const previousMetadata = node.metadata || {};
  const manifest = nodeManifest({
    type: node.type === "boxLens" ? "lens" : node.type,
    subtype,
    category,
    inputs: manifestInputs,
    outputs,
    permissions: previousMetadata.permissions || previousMetadata.manifest?.permissions || node.permissions || [],
    settingsSchema: previousMetadata.settingsSchema || previousMetadata.manifest?.settingsSchema || {},
    runtime: previousMetadata.runtimeMetadata || previousMetadata.manifest?.runtime || node.runtime || {},
    render: previousMetadata.manifest?.render || null,
    execute: previousMetadata.manifest?.execute || null,
    persist: previousMetadata.manifest?.persist || null,
  });

  return {
    node: {
      ...node,
      label,
      inputs,
      outputs,
      channels,
      status: runtimeStatus,
      runtime: {
        ...(node.runtime || {}),
        status: runtimeStatus,
        active: runtimeStatus !== "paused" && runtimeStatus !== "disabled",
      },
      metadata: {
        ...previousMetadata,
        draft: false,
        configured: true,
        mode,
        config,
        runtimeStatus,
        subtype,
        category,
        manifest,
        permissions: manifest.permissions,
        settingsSchema: manifest.settingsSchema,
        runtimeMetadata: manifest.runtime,
        processorType: node.type === "processor" ? subtype : previousMetadata.processorType,
        actionType: node.type === "action" ? subtype : previousMetadata.actionType,
        agentRole: node.type === "aiAgent" ? subtype : previousMetadata.agentRole,
      },
    },
    channels,
  };
};

const configFieldDefinitions = (node = {}) => {
  const subtype = nodeSubtype(node);
  const category = nodeCategory(node);
  const schema = node.metadata?.settingsSchema || node.metadata?.manifest?.settingsSchema || {};
  const schemaFields = runtimeContractSchemaFields(schema)
    .filter((field) => !(category === "dev" && subtype === "preview" && field.key === "mode"));
  const mergeSchemaFields = (fields = []) => [
    ...fields,
    ...schemaFields.filter((field) => !fields.some((item) => item.key === field.key)),
  ];
  if (subtype === "condition") {
    return mergeSchemaFields([
      { key: "conditionField", label: "Field / Path", placeholder: "payload.price" },
      { key: "conditionOperator", label: "Operator", type: "select", options: [">", ">=", "<", "<=", "==", "!=", "contains", "exists"] },
      { key: "conditionValue", label: "Compare Value", placeholder: "100000" },
      { key: "trueOutput", label: "True output port", placeholder: "true" },
      { key: "falseOutput", label: "False output port", placeholder: "false" },
    ]);
  }
  if (subtype === "filter") {
    return mergeSchemaFields([
      { key: "filterPath", label: "Field / Path", placeholder: "payload.status" },
      { key: "filterOperator", label: "Operator", type: "select", options: ["==", "!=", ">", ">=", "<", "<=", "contains", "exists"] },
      { key: "filterValue", label: "Value", placeholder: "active" },
    ]);
  }
  if (subtype === "transform" || subtype === "map" || subtype === "formatter") {
    return mergeSchemaFields([
      { key: "expression", label: "Transform Expression", type: "textarea", placeholder: "return { ...payload, normalized: true }" },
    ]);
  }
  if (["throttle", "debounce"].includes(subtype)) {
    return mergeSchemaFields([
      { key: "windowMs", label: "Window (ms)", placeholder: "1000" },
      { key: "strategy", label: "Strategy", type: "select", options: ["leading", "trailing", "latest"] },
    ]);
  }
  if (["merge", "split", "reduce", "aggregator"].includes(subtype)) {
    return mergeSchemaFields([
      { key: "strategy", label: "Strategy", placeholder: subtype === "split" ? "by path / predicate" : "merge by timestamp" },
      { key: "windowSize", label: "Window size", placeholder: "100" },
    ]);
  }
  if (subtype === "validator") {
    return mergeSchemaFields([
      { key: "schema", label: "Validation Schema", type: "textarea", placeholder: "{ \"required\": [\"price\"] }" },
    ]);
  }
  if (subtype === "agent-bridge") {
    return mergeSchemaFields([]);
  }
  if (category === "sources") {
    if (subtype === "task") {
      return mergeSchemaFields([
        { key: "objective", label: "Objective", type: "textarea", placeholder: "Describe what the agent must achieve." },
        { key: "context", label: "Context", type: "textarea", placeholder: "Operational context, data notes or user intent." },
        { key: "priority", label: "Priority", type: "select", options: ["normal", "high", "urgent"] },
        { key: "successCondition", label: "Success condition", type: "textarea", placeholder: "How the agent knows the objective is complete." },
        { key: "constraints", label: "Constraints / Policy", type: "textarea", placeholder: "One rule per line, limits, allowed actions or safety policy." },
        { key: "maxIterations", label: "Max iterations", placeholder: "5" },
        { key: "timeoutMs", label: "Timeout (ms)", placeholder: "30000" },
        { key: "payloadJson", label: "Payload JSON", type: "textarea", placeholder: "{ \"itemId\": \"demo-1\", \"value\": 42 }" },
        { key: "emitChannel", label: "Emit channel", placeholder: "task" },
      ]);
    }
    if (subtype === "manual-json") {
      return [];
    }
    if (subtype === "text-input" || subtype === "manual-input") {
      return mergeSchemaFields([
        { key: "text", label: "Text Payload", type: "textarea", placeholder: "Scrivi qui il dato da passare al flow..." },
        { key: "emitChannel", label: "Emit channel", placeholder: "raw" },
      ]);
    }
    if (subtype === "image-source") {
      return mergeSchemaFields([
        { key: "imageUrl", label: "Image URL", placeholder: "https://example.com/image.png" },
        { key: "imageDataUrl", label: "Upload image", type: "image-file", placeholder: "Select image file" },
        { key: "alt", label: "Alt / caption", placeholder: "Image description" },
        { key: "emitChannel", label: "Emit channel", placeholder: "image" },
      ]);
    }
    if (subtype === "audio-source") {
      return mergeSchemaFields([
        { key: "audioUrl", label: "Audio URL", placeholder: "https://example.com/audio.mp3" },
        { key: "audioDataUrl", label: "Upload audio", type: "audio-file", placeholder: "Select audio file" },
        { key: "transcript", label: "Transcript / notes", type: "textarea", placeholder: "Optional transcript or notes" },
        { key: "emitChannel", label: "Emit channel", placeholder: "audio" },
      ]);
    }
    if (subtype === "file-source") {
      return mergeSchemaFields([
        { key: "fileDataUrl", label: "Upload file", type: "file", placeholder: "Select file" },
        { key: "fileName", label: "File name", placeholder: "payload.csv" },
        { key: "mimeType", label: "MIME type", placeholder: "text/csv" },
        { key: "emitChannel", label: "Emit channel", placeholder: "file" },
      ]);
    }
    if (subtype === "files-source") {
      return mergeSchemaFields([
        { key: "filesJson", label: "Files metadata JSON", type: "textarea", placeholder: "[{ \"name\": \"image.png\", \"type\": \"image/png\" }]" },
        { key: "batchLabel", label: "Batch label", placeholder: "import batch" },
        { key: "emitChannel", label: "Emit channel", placeholder: "files" },
      ]);
    }
    const fields = [
      { key: "endpoint", label: "Endpoint / Source", placeholder: "https://api.example.com/data" },
      { key: "method", label: "Method", type: "select", options: ["GET", "POST", "PUT", "PATCH"] },
      { key: "headers", label: "Headers JSON", type: "textarea", placeholder: "{ \"Authorization\": \"Bearer ...\" }" },
      { key: "queryParams", label: "Query Params JSON", type: "textarea", placeholder: "{ \"limit\": 10, \"page\": 1 }" },
      { key: "requestBody", label: "Request Body JSON", type: "textarea", placeholder: "{ \"value\": \"{{payload.value}}\" }" },
      { key: "intervalMs", label: "Poll interval (ms)", placeholder: "5000" },
      { key: "testPayload", label: "Manual Test Payload", type: "textarea", placeholder: "{ \"value\": 100, \"status\": \"active\" }" },
    ];
    if (subtype === "websocket") fields.splice(2, 0, { key: "keepWebSocketOpen", label: "Keep WebSocket open", type: "checkbox" });
    return mergeSchemaFields(fields);
  }
  if (category === "trackers") {
    return mergeSchemaFields([
      { key: "emitChannel", label: "Emit channel", placeholder: "sensor.value" },
      { key: "parser", label: "Parser path", placeholder: "payload.data" },
      { key: "retryPolicy", label: "Retry policy", type: "select", options: ["none", "linear", "exponential"] },
      { key: "testPayload", label: "Test Payload", type: "textarea", placeholder: "{ \"price\": 100000, \"status\": \"active\" }" },
    ]);
  }
  if (category === "ai-agents") {
    return mergeSchemaFields([
      { key: "provider", label: "Provider", placeholder: "openai/local" },
      { key: "model", label: "Model", placeholder: "gpt-4.1-mini" },
      { key: "prompt", label: "Prompt / Instruction", type: "textarea", placeholder: "Analyze incoming payload and emit a decision." },
      { key: "testPayload", label: "Direct Test Payload", type: "textarea", placeholder: "{ \"text\": \"Analyze this payload\", \"value\": 42 }" },
      { key: "expectedOutput", label: "Expected Output", type: "textarea", placeholder: "{ \"decision\": \"ok\" } oppure testo atteso" },
      { key: "assertPath", label: "Assert path", placeholder: "response.decision" },
      { key: "assertOperator", label: "Assert operator", type: "select", options: ["contains", "equals", "exists", "json-contains", "regex"] },
      { key: "assertValue", label: "Assert value", placeholder: "ok" },
      { key: "inputCostPer1k", label: "Input cost / 1k", placeholder: "0" },
      { key: "outputCostPer1k", label: "Output cost / 1k", placeholder: "0" },
    ]);
  }
  if (category === "knowledge") {
    if (["document-store", "text-knowledge", "workspace-memory", "conversation-memory"].includes(subtype)) {
      return [
        { key: "title", label: "Title", placeholder: "Knowledge Document" },
        { key: "sourceType", label: "Source type", type: "select", options: ["manual", "channel", "json", "markdown"] },
        { key: "language", label: "Language", placeholder: "auto, it, en, es, fr, de" },
        { key: "collectionId", label: "Collection ID", placeholder: "knowledge_sample_current" },
        { key: "replayAllDocuments", label: "Replay all documents", type: "checkbox", defaultValue: false },
        { key: "outputChannel", label: "Output channel", placeholder: "knowledge.document.created" },
      ];
    }
    if (subtype === "chunk-processor") {
      return mergeSchemaFields([
        { key: "strategy", label: "Chunk strategy", type: "select", options: ["structured", "section", "token"], defaultValue: "structured" },
        { key: "maxChunkTokens", label: "Max chunk tokens", type: "number", placeholder: "225", visibleForStrategies: ["structured", "section", "token"] },
        { key: "chunkOverlapTokens", label: "Overlap tokens", type: "number", placeholder: "30", visibleForStrategies: ["structured"] },
        { key: "collectionId", label: "Collection ID", placeholder: "knowledge_sample_current" },
        { key: "replaceExisting", label: "Replace existing chunks", type: "checkbox", defaultValue: true },
        { key: "outputChannel", label: "Output channel", placeholder: "knowledge.chunk.created" },
      ]);
    }
    if (subtype === "embedding-generator" || subtype === "vector-memory") {
      return withAiProviderConfigFields([
        { key: "dimensions", label: "Dimensions", placeholder: "96" },
        { key: "collectionId", label: "Collection ID", placeholder: "knowledge_sample_current" },
        { key: "outputChannel", label: "Output channel", placeholder: "knowledge.embedding.created" },
      ], { includeAdvanced: false });
    }
    if (subtype === "rag-search") {
      return [
        { key: "query", label: "Query", type: "textarea", placeholder: "How old is Adam?" },
        { key: "topK", label: "Top K", placeholder: "4" },
        { key: "similarityThreshold", label: "Similarity threshold", placeholder: "0.08" },
        { key: "maxContextTokens", label: "Max context tokens", placeholder: "1200" },
        { key: "includeMetadata", label: "Include metadata", type: "checkbox", defaultValue: true },
        { key: "collectionId", label: "Collection ID", placeholder: "knowledge_sample_current" },
        { key: "outputChannel", label: "Output channel", placeholder: "knowledge.rag.context" },
      ];
    }
    if (subtype === "entity-extractor") {
      return withAiProviderConfigFields([
        { key: "entityMode", label: "Entity mode", type: "select", options: ["llm", "hybrid", "rules"], defaultValue: "llm" },
        ...knowledgeAiPromptFieldDefinitions(subtype),
        { key: "extractionMode", label: "Extraction mode", type: "select", options: ["strict", "balanced", "wide"], defaultValue: "strict" },
        { key: "allowDocumentInput", label: "Allow direct document input", type: "checkbox", defaultValue: false },
        { key: "useDictionarySeeds", label: "Use Dictionary seeds", type: "checkbox", defaultValue: true },
        { key: "minDictionarySeedTier", label: "Min Dictionary seed tier", type: "select", options: ["core", "typed"], defaultValue: "typed" },
        { key: "maxDictionarySeeds", label: "Max Dictionary seeds", placeholder: "48" },
        { key: "entityTypes", label: "Entity types", placeholder: "proper-noun, technology, symbol, url, email" },
        { key: "seedTerms", label: "Seed terms", type: "textarea", placeholder: "Trackers Lens\nKnowledge Runtime" },
        { key: "stopWords", label: "Stop words", type: "textarea", placeholder: "aunque\nhola\nfrustrada" },
        { key: "confidenceThreshold", label: "Confidence threshold", placeholder: "0.6" },
        { key: "maxEntities", label: "Max entities", placeholder: "24" },
        { key: "maxRelations", label: "Max relations", placeholder: "36" },
        { key: "maxChunks", label: "Max AI chunks", placeholder: "8" },
        { key: "maxChunkTokens", label: "Max tokens per AI chunk", type: "number", placeholder: "400" },
        { key: "relationType", label: "Relation type", placeholder: "co_occurs" },
        { key: "replaceExisting", label: "Replace existing graph records", type: "checkbox", defaultValue: true },
        { key: "collectionId", label: "Collection ID", placeholder: "knowledge_sample_current" },
        { key: "outputChannel", label: "Output channel", placeholder: "knowledge.entity.created" },
      ]);
    }
    if (subtype === "knowledge-dictionary-builder") {
      return withAiProviderConfigFields([
        { key: "dictionaryMode", label: "Dictionary mode", type: "select", options: ["llm", "hybrid", "rules"], defaultValue: "llm" },
        ...knowledgeAiPromptFieldDefinitions(subtype),
        { key: "scope", label: "Dictionary scope", type: "select", options: ["document", "collection", "workspace"], defaultValue: "document" },
        { key: "language", label: "Language", placeholder: "auto, it, en, es, fr, de" },
        { key: "maxTerms", label: "Max terms", placeholder: "120" },
        { key: "minFrequency", label: "Min frequency", placeholder: "1" },
        { key: "maxChunks", label: "Max AI chunks", placeholder: "8" },
        { key: "maxChunkTokens", label: "Max tokens per AI chunk", type: "number", placeholder: "400" },
        { key: "previewTerms", label: "Preview terms", placeholder: "16" },
        { key: "previewIds", label: "Preview IDs", placeholder: "40" },
        { key: "replaceExisting", label: "Replace document dictionary", type: "checkbox", defaultValue: true },
        { key: "documentId", label: "Document ID", placeholder: "optional" },
        { key: "collectionId", label: "Collection ID", placeholder: "knowledge_sample_current" },
        { key: "outputChannel", label: "Output channel", placeholder: "knowledge.dictionary.updated" },
      ]);
    }
    if (subtype === "knowledge-event-builder") {
      return withAiProviderConfigFields([
        { key: "eventMode", label: "Event mode", type: "select", options: ["llm", "hybrid", "rules"], defaultValue: "llm" },
        ...knowledgeAiPromptFieldDefinitions(subtype),
        { key: "maxEvents", label: "Max events", placeholder: "80" },
        { key: "confidenceThreshold", label: "Confidence threshold", placeholder: "0.55" },
        { key: "previewEvents", label: "Preview events", placeholder: "16" },
        { key: "previewIds", label: "Preview IDs", placeholder: "60" },
        { key: "replaceExisting", label: "Replace document events", type: "checkbox", defaultValue: true },
        { key: "documentId", label: "Document ID", placeholder: "optional" },
        { key: "collectionId", label: "Collection ID", placeholder: "knowledge_sample_current" },
        { key: "outputChannel", label: "Output channel", placeholder: "knowledge.events.updated" },
      ]);
    }
    if (subtype === "structured-knowledge-store") {
      return [
        { key: "schemaId", label: "Schema ID", placeholder: "structured/v1" },
        { key: "schemaVersion", label: "Schema version", placeholder: "1" },
        { key: "recordType", label: "Default record type", placeholder: "record, kingdom, pack, product..." },
        { key: "collectionId", label: "Collection ID", placeholder: "structured_default" },
        { key: "worldId", label: "World ID", placeholder: "optional" },
        { key: "parentId", label: "Parent ID", placeholder: "optional" },
        { key: "record", label: "Seed record", type: "textarea", placeholder: "{ \"type\": \"kingdom\", \"name\": \"Regno delle Tempeste\" }" },
        { key: "records", label: "Seed records", type: "textarea", placeholder: "[{ \"type\": \"kingdom\", \"name\": \"Regno delle Tempeste\" }]" },
        { key: "replaceExisting", label: "Replace scope records", type: "checkbox", defaultValue: false },
        { key: "outputChannel", label: "Output channel", placeholder: "structured.record.created" },
      ];
    }
    if (subtype === "world-database") {
      return [
        { key: "worldId", label: "World ID", placeholder: "world_storms" },
        { key: "worldName", label: "World name", placeholder: "Mondo delle Tempeste" },
        { key: "schemaVersion", label: "Schema version", placeholder: "1" },
        { key: "collectionId", label: "Collection ID", placeholder: "worldbuilding" },
        { key: "worldJson", label: "World JSON", type: "textarea", placeholder: "{ \"name\": \"...\", \"kingdoms\": [], \"packs\": [], \"storyBlocks\": [] }" },
        { key: "records", label: "World records", type: "textarea", placeholder: "[{ \"type\": \"kingdom\", \"name\": \"Regno delle Tempeste\" }]" },
        { key: "replaceExisting", label: "Replace world records", type: "checkbox", defaultValue: false },
        { key: "outputChannel", label: "Output channel", placeholder: "world.database.updated" },
      ];
    }
    if (subtype === "knowledge-graph") {
      return [
        { key: "graphScope", label: "Graph scope", type: "select", options: ["workspace", "document", "collection"] },
        { key: "autoClearGraph", label: "Auto clear snapshots", type: "checkbox", defaultValue: false },
        { key: "documentId", label: "Document ID", placeholder: "optional" },
        { key: "collectionId", label: "Collection ID", placeholder: "knowledge_sample_current" },
        { key: "topEntities", label: "Top entities", placeholder: "12" },
        { key: "maxRelations", label: "Max relations", placeholder: "24" },
        { key: "outputChannel", label: "Output channel", placeholder: "knowledge.graph.updated" },
      ];
    }
    if (subtype === "semantic-relation-enricher") {
      return withAiProviderConfigFields([
        { key: "enrichmentMode", label: "Enrichment mode", type: "select", options: ["ai", "hybrid", "rules"], defaultValue: "ai" },
        ...knowledgeAiPromptFieldDefinitions(subtype),
        { key: "maxRelations", label: "Max semantic relations", placeholder: "48" },
        { key: "confidenceThreshold", label: "Confidence threshold", placeholder: "0.55" },
        { key: "relationTypes", label: "Allowed relation types", placeholder: "friend_of,helps,tries_to_help" },
        { key: "replaceExisting", label: "Replace existing semantic relations", type: "checkbox", defaultValue: true },
        { key: "documentId", label: "Document ID", placeholder: "optional" },
        { key: "collectionId", label: "Collection ID", placeholder: "knowledge_sample_current" },
        { key: "outputChannel", label: "Output channel", placeholder: "knowledge.semantic.relations" },
      ]);
    }
    if (subtype === "knowledge-graph-builder-agent") {
      return withAiProviderConfigFields([
        ...knowledgeAiPromptFieldDefinitions(subtype),
        { key: "domainHint", label: "Domain hint", type: "textarea", placeholder: "technical documentation, narrative story, theology, API docs..." },
        { key: "maxChunks", label: "Max chunks", placeholder: "6" },
        { key: "maxChunkTokens", label: "Max tokens per AI chunk", type: "number", placeholder: "450" },
        { key: "maxEntities", label: "Max accepted entities", placeholder: "40" },
        { key: "maxRelations", label: "Max accepted relations", placeholder: "48" },
        { key: "confidenceThreshold", label: "Confidence threshold", placeholder: "0.65" },
        { key: "relationTypes", label: "Allowed relation types", placeholder: "uses,implements,explains,stores_in,retrieves_from,powered_by" },
        { key: "technicalNormalization", label: "Technical normalization", type: "checkbox", defaultValue: true },
        { key: "replaceExisting", label: "Replace existing builder graph", type: "checkbox", defaultValue: true },
        { key: "documentId", label: "Document ID", placeholder: "optional" },
        { key: "collectionId", label: "Collection ID", placeholder: "knowledge_sample_current" },
        { key: "outputChannel", label: "Output channel", placeholder: "knowledge.graph.proposed" },
      ]);
    }
    if (subtype === "knowledge-mechanism-cue-agent") {
      return withAiProviderConfigFields([
        { key: "cueMode", label: "Cue mode", type: "select", options: ["llm", "hybrid", "rules"], defaultValue: "llm" },
        ...knowledgeAiPromptFieldDefinitions(subtype),
        { key: "query", label: "Query", type: "textarea", placeholder: "how does the process happen?" },
        { key: "maxChunks", label: "Max chunks", placeholder: "24" },
        { key: "maxChunkTokens", label: "Max tokens per AI chunk", type: "number", placeholder: "155" },
        { key: "graphScope", label: "Graph scope", type: "select", options: ["workspace", "document", "collection"], defaultValue: "document" },
        { key: "documentId", label: "Document ID", placeholder: "optional" },
        { key: "collectionId", label: "Collection ID", placeholder: "knowledge_sample_current" },
        { key: "outputChannel", label: "Output channel", placeholder: "knowledge.mechanism.cues" },
      ]);
    }
    if (subtype === "graph-query") {
      return withAiProviderConfigFields([
        { key: "queryExpansionMode", label: "Query expansion mode", type: "select", options: ["llm", "hybrid", "rules"], defaultValue: "llm" },
        ...knowledgeAiPromptFieldDefinitions(subtype),
        { key: "query", label: "Query", type: "textarea", placeholder: "Dio, Abramo, fede..." },
        { key: "depth", label: "Depth", placeholder: "1" },
        { key: "topK", label: "Top entities", placeholder: "12" },
        { key: "maxRelations", label: "Max relations", placeholder: "48" },
        { key: "maxEvidence", label: "Max evidence chunks", placeholder: "6" },
        { key: "evidenceMode", label: "Evidence mode", type: "select", options: ["focused", "balanced", "full_ordered", "debug_trace"], defaultValue: "balanced" },
        { key: "includeAdjacentChunks", label: "Include adjacent chunks", type: "checkbox", defaultValue: false },
        { key: "preserveDocumentOrder", label: "Preserve document order", type: "checkbox", defaultValue: false },
        { key: "protectedEvidence", label: "Protected evidence", type: "checkbox", defaultValue: true },
        { key: "maxContextChars", label: "Max context chars", placeholder: "5200" },
        { key: "relationTypes", label: "Relation types", placeholder: "mentions,references,co_occurs" },
        { key: "includeEvidence", label: "Include evidence", type: "checkbox", defaultValue: true },
        { key: "includeIsolated", label: "Include isolated entities", type: "checkbox", defaultValue: false },
        { key: "preferLatestDocument", label: "Use latest document", type: "checkbox", defaultValue: true },
        { key: "graphScope", label: "Graph scope", type: "select", options: ["workspace", "document", "collection"], defaultValue: "document" },
        { key: "documentId", label: "Document ID", placeholder: "optional" },
        { key: "collectionId", label: "Collection ID", placeholder: "knowledge_sample_current" },
        { key: "outputChannel", label: "Output channel", placeholder: "knowledge.graph.context" },
      ]);
    }
    if (subtype === "knowledge-reasoning-composer") {
      return withAiProviderConfigFields([
        { key: "compositionMode", label: "Composition mode", type: "select", options: ["llm", "hybrid", "rules"], defaultValue: "llm" },
        { key: "intentMode", label: "Intent mode", type: "select", options: ["auto", "source", "mechanism", "danger", "definition", "timeline", "comparison", "fact"], defaultValue: "auto" },
        ...knowledgeAiPromptFieldDefinitions(subtype),
        { key: "maxFacts", label: "Max facts", placeholder: "8" },
        { key: "maxEvents", label: "Max events", placeholder: "12" },
        { key: "includeBackground", label: "Include background", type: "checkbox", defaultValue: false },
        { key: "maxContextChars", label: "Max context chars", placeholder: "4800" },
        { key: "outputChannel", label: "Output channel", placeholder: "knowledge.graph.context" },
      ]);
    }
    return [
      { key: "title", label: "Title", placeholder: "Knowledge Document" },
      { key: "sourceType", label: "Source type", placeholder: "manual" },
      { key: "language", label: "Language", placeholder: "en" },
      { key: "collectionId", label: "Collection ID", placeholder: "knowledge_sample_current" },
      { key: "outputChannel", label: "Output channel", placeholder: "knowledge.document.created" },
    ];
  }
  if (category === "lens") {
    return mergeSchemaFields([
      { key: "viewMode", label: "View mode", type: "select", options: ["chart", "stat", "table", "feed", "terminal"] },
      { key: "refreshMs", label: "Refresh (ms)", placeholder: "1000" },
      { key: "displayPath", label: "Display path", placeholder: "payload.value" },
    ]);
  }
  if (category === "actions") {
    if (subtype === "runtime-trigger") {
      return mergeSchemaFields([
        { key: "targetChannel", label: "Target channel", placeholder: "alerts.price" },
        { key: "template", label: "Payload Template", type: "textarea", placeholder: "{ \"triggered\": true, \"value\": \"{{payload.value}}\" }" },
      ]);
    }
    if (subtype === "telegram") {
      return mergeSchemaFields([
        { key: "botToken", label: "Bot token", placeholder: "123456:ABC..." },
        { key: "chatId", label: "Chat ID", placeholder: "-1001234567890" },
        { key: "target", label: "Override URL", placeholder: "https://api.telegram.org/bot.../sendMessage" },
        { key: "template", label: "Message Template", type: "textarea", placeholder: "{ \"text\": \"{{payload.value}}\" } oppure testo semplice" },
        { key: "retryPolicy", label: "Retry policy", type: "select", options: ["none", "linear", "exponential"] },
      ]);
    }
    if (subtype === "whatsapp") {
      return mergeSchemaFields([
        { key: "target", label: "API / Provider URL", placeholder: "https://graph.facebook.com/v19.0/<phone_number_id>/messages" },
        { key: "accessToken", label: "Access token", placeholder: "Bearer token opzionale" },
        { key: "to", label: "Recipient", placeholder: "+391234567890" },
        { key: "template", label: "Message Template", type: "textarea", placeholder: "{ \"text\": \"{{payload.value}}\" } oppure payload provider" },
        { key: "retryPolicy", label: "Retry policy", type: "select", options: ["none", "linear", "exponential"] },
      ]);
    }
    if (subtype === "http-write") {
      return mergeSchemaFields([
        { key: "target", label: "URL", placeholder: "https://api.example.com/resource/1" },
        { key: "method", label: "Method", type: "select", options: ["PUT", "PATCH", "POST"] },
        { key: "headers", label: "Headers JSON", type: "textarea", placeholder: "{ \"Authorization\": \"Bearer ...\" }" },
        { key: "template", label: "Payload Template", type: "textarea", placeholder: "{ \"value\": \"{{payload.value}}\" }" },
        { key: "retryPolicy", label: "Retry policy", type: "select", options: ["none", "linear", "exponential"] },
      ]);
    }
    if (["webhook-post", "webhook-call", "discord", "slack", "email"].includes(subtype)) {
      return mergeSchemaFields([
        { key: "target", label: "Target URL", placeholder: "https://..." },
        { key: "headers", label: "Headers JSON", type: "textarea", placeholder: "{ \"Authorization\": \"Bearer ...\" }" },
        { key: "template", label: "Payload Template", type: "textarea", placeholder: "{ \"text\": \"{{payload.value}}\" }" },
        { key: "retryPolicy", label: "Retry policy", type: "select", options: ["none", "linear", "exponential"] },
      ]);
    }
    return mergeSchemaFields([
      { key: "target", label: "Target", placeholder: "webhook/chat/email" },
      { key: "template", label: "Payload Template", type: "textarea", placeholder: "{ \"text\": \"{{payload.value}}\" }" },
      { key: "retryPolicy", label: "Retry policy", type: "select", options: ["none", "linear", "exponential"] },
    ]);
  }
  if (category === "storage") {
    return mergeSchemaFields([
      { key: "storeName", label: "Store / Bucket", placeholder: "tl_history" },
      { key: "keyPath", label: "Key path", placeholder: "id" },
      { key: "retention", label: "Retention", placeholder: "30d" },
    ]);
  }
  if (category === "dev") {
    return mergeSchemaFields([
      { key: "previewMode", label: "Preview mode", type: "select", options: ["auto", "json", "raw"] },
      { key: "maxChars", label: "Max chars", placeholder: "2000" },
    ]);
  }
  return mergeSchemaFields([
    { key: "config", label: "Runtime Config", type: "textarea", placeholder: "JSON, rule, target or prompt" },
  ]);
};

const executionFieldDefinitions = () => [
  { key: "maxConcurrentTasks", label: "Max concurrent tasks", placeholder: "1" },
  { key: "queueLimit", label: "Queue limit", placeholder: "10" },
  { key: "timeoutMs", label: "Timeout (ms)", placeholder: "30000" },
  { key: "dropPolicy", label: "Drop policy", type: "select", options: ["queue", "reject", "latest"] },
];

const agentCapabilityFieldDefinitions = (node = {}) => {
  const subtype = nodeSubtype(node);
  if (subtype === "task" || subtype === "orchestrator") return [];
  return [
    { key: "agentVisible", label: "Agent visible", type: "checkbox", defaultValue: true },
    { key: "agentPurpose", label: "Purpose", type: "textarea", placeholder: "Describe what this node does for agents." },
    { key: "agentKeywords", label: "Keywords", type: "textarea", placeholder: "One keyword per line or comma separated." },
    { key: "agentProduces", label: "Produces", type: "textarea", placeholder: "Data, events, files or results this node produces." },
    { key: "agentConsumes", label: "Consumes", type: "textarea", placeholder: "Payloads or commands this node expects." },
    { key: "agentOutputSchema", label: "Output schema / paths", type: "textarea", placeholder: "Example: symbol=data.s, price=data.c, status=payload.status" },
    { key: "agentSampleOutput", label: "Sample output", type: "textarea", placeholder: "{ \"value\": 42, \"status\": \"ok\" }" },
  ];
};

const channelSetKey = (values = []) =>
  [...new Set(values.filter(Boolean).map(String))].sort().join("|");

const stopNodeControlEvent = (event) => {
  event.stopPropagation();
};

const inlineConfigFields = (node = {}) => {
  const subtype = nodeSubtype(node);
  const category = nodeCategory(node);
  if (subtype === "condition") {
    return [
      { key: "conditionField", label: "Field", placeholder: "payload.value" },
      { key: "conditionOperator", label: "Op", type: "select", options: [">", ">=", "<", "<=", "==", "!=", "contains", "exists"] },
      { key: "conditionValue", label: "Value", placeholder: "100000" },
    ];
  }
  if (subtype === "filter") {
    return [
      { key: "filterPath", label: "Path", placeholder: "payload.status" },
      { key: "filterOperator", label: "Op", type: "select", options: ["==", "!=", ">", ">=", "<", "<=", "contains", "exists"] },
      { key: "filterValue", label: "Value", placeholder: "active" },
    ];
  }
  if (subtype === "transform" || subtype === "map" || subtype === "formatter") {
    return [
      { key: "expression", label: "Expr", placeholder: "payload.value" },
    ];
  }
  if (subtype === "agent-bridge") {
    return [];
  }
  if (["throttle", "debounce"].includes(subtype)) {
    return [
      { key: "windowMs", label: "ms", placeholder: "1000" },
      { key: "strategy", label: "Mode", type: "select", options: ["leading", "trailing", "latest"] },
    ];
  }
  if (category === "sources") {
    if (subtype === "task") {
      return [
        { key: "objective", label: "Goal", placeholder: "Analyze incoming data and report action" },
        { key: "priority", label: "Priority", type: "select", options: ["normal", "high", "urgent"] },
        { key: "successCondition", label: "Done", placeholder: "completed" },
      ];
    }
    if (subtype === "manual-json") {
      return [
        { key: "emitChannel", label: "Emit", placeholder: "raw" },
        { key: "json", label: "JSON", placeholder: "{mela:'prova'}" },
      ];
    }
    if (subtype === "text-input" || subtype === "manual-input") {
      return [
        { key: "emitChannel", label: "Emit", placeholder: "raw" },
        { key: "text", label: "Text", placeholder: "value" },
      ];
    }
    if (subtype === "image-source") {
      return [
        { key: "emitChannel", label: "Emit", placeholder: "image" },
        { key: "imageUrl", label: "Image URL", placeholder: "https://..." },
      ];
    }
    if (subtype === "audio-source") {
      return [
        { key: "emitChannel", label: "Emit", placeholder: "audio" },
        { key: "audioUrl", label: "Audio URL", placeholder: "https://..." },
      ];
    }
    if (subtype === "file-source") {
      return [
        { key: "emitChannel", label: "Emit", placeholder: "file" },
        { key: "fileName", label: "Name", placeholder: "payload.csv" },
      ];
    }
    if (subtype === "files-source") {
      return [
        { key: "emitChannel", label: "Emit", placeholder: "files" },
        { key: "batchLabel", label: "Batch", placeholder: "import batch" },
      ];
    }
    const fields = [
      { key: "method", label: "Method", type: "select", options: ["GET", "POST", "PUT", "PATCH"] },
      { key: "endpoint", label: "URL", placeholder: "https://..." },
    ];
    if (subtype === "websocket") fields.push({ key: "keepWebSocketOpen", label: "Keep", type: "checkbox" });
    return fields;
  }
  if (category === "trackers") {
    return [
      { key: "emitChannel", label: "Emit", placeholder: "sensor.value" },
      { key: "parser", label: "Path", placeholder: "payload.data" },
    ];
  }
  if (category === "ai-agents") {
    if (subtype === "orchestrator") {
      return [
        { key: "executionMode", label: "Mode", type: "select", options: ["manual", "on_event", "continuous"] },
        { key: "maxSteps", label: "Max", placeholder: "6" },
        { key: "allowedNodeTypes", label: "Allow", placeholder: "processors, ai-agents, actions, storage" },
      ];
    }
    return [
      { key: "provider", label: "Provider", placeholder: "local" },
      { key: "model", label: "Model", placeholder: "model" },
      { key: "assertValue", label: "Expect", placeholder: "ok" },
    ];
  }
  if (category === "lens") {
    return [
      { key: "viewMode", label: "View", type: "select", options: ["chart", "stat", "table", "feed", "terminal"] },
      { key: "displayPath", label: "Path", placeholder: "payload.value" },
    ];
  }
  if (category === "actions") {
    if (subtype === "runtime-trigger") {
      return [
        { key: "targetChannel", label: "Emit", placeholder: "alerts.price" },
      ];
    }
    if (subtype === "telegram") {
      return [
        { key: "chatId", label: "Chat", placeholder: "-100..." },
      ];
    }
    if (subtype === "whatsapp") {
      return [
        { key: "to", label: "To", placeholder: "+39..." },
        { key: "target", label: "URL", placeholder: "https://..." },
      ];
    }
    if (subtype === "http-write") {
      return [
        { key: "method", label: "Method", type: "select", options: ["PUT", "PATCH", "POST"] },
        { key: "target", label: "URL", placeholder: "https://..." },
      ];
    }
    return [
      { key: "target", label: "Target", placeholder: "webhook/chat" },
      { key: "retryPolicy", label: "Retry", type: "select", options: ["none", "linear", "exponential"] },
    ];
  }
  if (category === "storage") {
    return [
      { key: "storeName", label: "Store", placeholder: "tl_history" },
      { key: "retention", label: "Keep", placeholder: "30d" },
    ];
  }
  if (category === "dev") {
    return [
      { key: "previewMode", label: "Mode", type: "select", options: ["auto", "json", "raw"] },
      { key: "maxChars", label: "Max", placeholder: "2000" },
    ];
  }
  return [
    { key: "config", label: "Config", placeholder: "value" },
  ];
};

const persistInlineRuntimeNodeConfig = async ({ node, patch = {}, values = {}, reload = true, focus = true, record = true, channels = true } = {}) => {
  if (!node?.id || node.metadata?.library) return;
  const defaults = runtimeNodeConfigDefaults(node);
  const update = runtimeNodeUpdateFromValues({
    node,
    values: {
      label: values.label ?? defaults.label,
      input: values.input ?? defaults.input,
      output: values.output ?? defaults.output,
      mode: values.mode ?? defaults.mode,
      runtimeStatus: values.runtimeStatus ?? defaults.runtimeStatus,
      config: { ...defaults.configObject, ...patch },
    },
  });

  try {
    state.runtime.nodes = (state.runtime.nodes || []).map((item) => item.id === update.node.id ? update.node : item);
    await window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode?.({ node: update.node });
    if (channels && window.TrackerLensChannelRegistry?.upsertChannelsForRuntimeNode) {
      await window.TrackerLensChannelRegistry.upsertChannelsForRuntimeNode({ node: update.node });
    }
    if (record) {
      await recordFlowAction({
        workspaceId: update.node.workspaceId || "global",
        nodeId: update.node.id,
        message: `Runtime node inline setting updated: ${update.node.label || update.node.id}`,
        context: {
          action: "runtime-node-inline-configured",
          nodeType: update.node.type || "",
          changed: Object.keys(patch),
        },
      });
    }
    if (focus) {
      setFocusState({
        mode: "dependencies",
        nodeId: update.node.id,
        edgeId: "",
        nodeType: update.node.type,
        channel: update.channels[0] || "",
        connectionId: "",
      });
    }
    if (reload) await loadRuntime({ force: true, silent: true });
  } catch (error) {
    console.error("Errore configurazione inline runtime node:", error);
    state.error = error?.message || "Errore configurazione inline runtime node";
    mount();
  }
};

const testTelegramActionNode = async (node = {}, event = null) => {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  if (!node?.id) return;
  const button = event?.currentTarget || null;
  if (button) {
    button.disabled = true;
    button.classList.add("is-running");
  }
  try {
    const runtime = window.TrackerLensActionRuntime?.get?.(node.workspaceId || state.filters.workspaceId || "workspace_global");
    if (!runtime?.testNode) throw new Error("Action runtime non disponibile");
    const result = await runtime.testNode({ node });
    await recordFlowAction({
      workspaceId: node.workspaceId || state.filters.workspaceId || "workspace_global",
      nodeId: node.id,
      level: result?.ok ? "info" : "error",
      message: result?.ok ? `Telegram test sent: ${node.label || node.id}` : `Telegram test error: ${result?.error || "unknown"}`,
      context: {
        action: "telegram-action-test",
        result,
      },
    });
    if (!result?.ok) {
      state.error = result?.error || "Telegram test non riuscito";
      setErrorSignal?.(state.error);
    }
    await loadRuntime({ force: true, silent: true });
  } catch (error) {
    state.error = error?.message || "Telegram test non riuscito";
    setErrorSignal?.(state.error);
    await recordFlowAction({
      workspaceId: node.workspaceId || state.filters.workspaceId || "workspace_global",
      nodeId: node.id,
      level: "error",
      message: state.error,
      context: { action: "telegram-action-test" },
    });
    mount();
  } finally {
    if (button) {
      button.disabled = false;
      button.classList.remove("is-running");
    }
  }
};

const previewRecordForNode = (node = {}) =>
  state.previewPayloads[node.id] || null;

const clearTargetsForNode = (node = {}) => {
  if (!node?.id) return [];
  if (typeof downstreamNodeTree === "function") {
    const tree = downstreamNodeTree(node);
    if (tree.nodes?.length) return tree.nodes;
  }
  return [node];
};

const clearPreviewNodePayload = (node = {}, { cascade = false } = {}) => {
  markPreviewNodesClean(cascade ? clearTargetsForNode(node) : [node], { remount: true });
};

const requestClearPreviewNodePayload = (node = {}) => {
  if (!node?.id) return;
  const targets = clearTargetsForNode(node);
  const childCount = Math.max(0, targets.length - 1);
  if (!childCount || typeof _?.Dialog !== "function") {
    clearPreviewNodePayload(node, { cascade: false });
    return;
  }
  const dialog = _.Dialog({
    class: "tl-flow-edge-delete-dialog",
    panelClass: "tl-flow-edge-delete-panel",
    size: "md",
    title: "Clear preview payload?",
    subtitle: node.label || node.id,
    icon: "delete_sweep",
    closeButton: true,
    content: () => _.div(
      { class: "tl-flow-edge-delete-body" },
      _.p("Scegli se pulire solo questo nodo o anche tutti i figli collegati."),
      _.div(_.span("Node"), _.strong(node.label || node.id)),
      _.div(_.span("Children"), _.strong(String(childCount)))
    ),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: close }, "Cancel"),
      btn({
        onclick: () => {
          clearPreviewNodePayload(node, { cascade: false });
          close();
        },
      }, icon("delete_sweep", "sm"), "Solo Node"),
      btn({
        class: "is-danger",
        onclick: () => {
          clearPreviewNodePayload(node, { cascade: true });
          close();
        },
      }, icon("account_tree", "sm"), "Node + figli")
    ),
  });
  dialog.open();
};

const previewValueText = (value, mode = "auto") => {
  if (mode === "raw") return typeof value === "string" ? value : prettyRuntimeValue(value);
  if (mode === "json") {
    if (typeof value === "string") {
      try {
        return JSON.stringify(JSON.parse(value), null, 2);
      } catch (_) {
        return value;
      }
    }
    return prettyRuntimeValue(value);
  }
  return typeof value === "string" ? value : prettyRuntimeValue(value);
};

const escapePreviewHtml = (value = "") =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char]));

const highlightedJsonLineHtml = (line = "") => {
  const tokenRegex = /("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  let html = "";
  let cursor = 0;
  let match = tokenRegex.exec(line);
  while (match) {
    const token = match[0];
    if (match.index > cursor) html += escapePreviewHtml(line.slice(cursor, match.index));
    let className = "tl-json-number is-int";
    if (/^"/.test(token)) className = /:\s*$/.test(token) ? "tl-json-key" : "tl-json-string";
    else if (/true|false/.test(token)) className = "tl-json-boolean";
    else if (/null/.test(token)) className = "tl-json-null";
    else if (/[.eE]/.test(token)) className = "tl-json-number is-float";
    html += `<span class="${className}">${escapePreviewHtml(token)}</span>`;
    cursor = match.index + token.length;
    match = tokenRegex.exec(line);
  }
  if (cursor < line.length) html += escapePreviewHtml(line.slice(cursor));
  return html;
};

const highlightedJsonHtml = (text = "") =>
  String(text ?? "").split("\n").map((line) =>
    `<span class="tl-code-line"><span class="tl-code-line-content">${highlightedJsonLineHtml(line)}</span></span>`
  ).join("");

const countPreviewMatches = (text = "", query = "") => {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  const haystack = String(text || "").toLowerCase();
  while (index < haystack.length) {
    const found = haystack.indexOf(needle, index);
    if (found < 0) break;
    count += 1;
    index = found + Math.max(1, needle.length);
  }
  return count;
};

const applyPreviewSearchMarks = (root, query = "", activeIndex = 0) => {
  const needle = String(query || "").trim();
  if (!root || !needle) return 0;
  const lowerNeedle = needle.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  let matchIndex = 0;
  textNodes.forEach((textNode) => {
    const text = textNode.nodeValue || "";
    const lowerText = text.toLowerCase();
    let cursor = 0;
    let found = lowerText.indexOf(lowerNeedle, cursor);
    if (found < 0) return;
    const fragment = document.createDocumentFragment();
    while (found >= 0) {
      if (found > cursor) fragment.appendChild(document.createTextNode(text.slice(cursor, found)));
      const mark = document.createElement("mark");
      mark.className = `tl-preview-search-hit${matchIndex === activeIndex ? " is-active" : ""}`;
      mark.textContent = text.slice(found, found + needle.length);
      fragment.appendChild(mark);
      matchIndex += 1;
      cursor = found + needle.length;
      found = lowerText.indexOf(lowerNeedle, cursor);
    }
    if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)));
    textNode.parentNode?.replaceChild(fragment, textNode);
  });
  return matchIndex;
};

const previewCodeBlock = ({ text = "", mode = "auto", query = "", activeMatch = 0 } = {}) => {
  const pre = document.createElement("pre");
  const jsonLike = mode === "json" || (mode === "auto" && /^[\s]*[{\[]/.test(text));
  pre.className = `tl-flow-preview-full-code is-${mode}${jsonLike ? " is-json" : ""}`;
  pre.innerHTML = jsonLike ? highlightedJsonHtml(text) : escapePreviewHtml(text);
  applyPreviewSearchMarks(pre, query, activeMatch);
  window.setTimeout(() => {
    pre.querySelector(".tl-preview-search-hit.is-active")?.scrollIntoView?.({ block: "center", inline: "nearest" });
  }, 0);
  return pre;
};

const previewGraphSourceValue = (value) => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return value;
  }
};

const previewGraphKind = (value) => {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
};

const previewGraphSummary = (value) => {
  if (Array.isArray(value)) return `${value.length} items`;
  if (value && typeof value === "object") return `${Object.keys(value).length} keys`;
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Number(value.toFixed?.(4) ?? value));
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  return String(value);
};

const buildPreviewGraphTree = (value, { maxNodes = 360 } = {}) => {
  let count = 0;
  let truncated = false;
  const seen = new WeakSet();
  const build = (entryValue, key = "ROOT", path = "root", depth = 0) => {
    count += 1;
    const isCircular = entryValue && typeof entryValue === "object" && seen.has(entryValue);
    const node = {
      id: path,
      key,
      kind: isCircular ? "circular" : previewGraphKind(entryValue),
      summary: isCircular ? "[Circular]" : previewGraphSummary(entryValue),
      depth,
      children: [],
    };
    if (isCircular) return node;
    if (count >= maxNodes) {
      truncated = true;
      return node;
    }
    if (entryValue && typeof entryValue === "object") {
      seen.add(entryValue);
      const entries = Array.isArray(entryValue)
        ? entryValue.map((item, index) => [`[${index}]`, item])
        : Object.entries(entryValue);
      for (const [childKey, childValue] of entries) {
        if (count >= maxNodes) {
          truncated = true;
          break;
        }
        node.children.push(build(childValue, childKey, `${path}.${String(childKey).replace(/[^\w-]/g, "_")}`, depth + 1));
      }
    }
    return node;
  };
  return { root: build(previewGraphSourceValue(value)), truncated, count };
};

const layoutPreviewGraphTree = (root) => {
  const nodeWidth = 184;
  const nodeHeight = 42;
  const levelGap = 236;
  const rowGap = 62;
  let row = 0;
  let maxDepth = 0;
  const visit = (node) => {
    maxDepth = Math.max(maxDepth, node.depth);
    if (!node.children.length) {
      node.x = 64 + node.depth * levelGap;
      node.y = 56 + row * rowGap;
      row += 1;
      return node.y;
    }
    const childYs = node.children.map(visit);
    node.x = 64 + node.depth * levelGap;
    node.y = childYs.reduce((sum, value) => sum + value, 0) / childYs.length;
    return node.y;
  };
  visit(root);
  return {
    width: Math.max(760, 128 + maxDepth * levelGap + nodeWidth),
    height: Math.max(460, 112 + Math.max(1, row) * rowGap),
    nodeWidth,
    nodeHeight,
  };
};

const drawPreviewGraph = (canvas, tree, layout, query = "") => {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.ceil(layout.width * dpr);
  canvas.height = Math.ceil(layout.height * dpr);
  canvas.style.width = `${layout.width}px`;
  canvas.style.height = `${layout.height}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, layout.width, layout.height);
  const needle = String(query || "").trim().toLowerCase();
  const matches = (node) => needle && `${node.key} ${node.summary} ${node.kind}`.toLowerCase().includes(needle);
  const ellipsize = (text, max) => {
    const value = String(text ?? "");
    return value.length > max ? `${value.slice(0, Math.max(0, max - 3))}...` : value;
  };
  const roundedRect = (x, y, width, height, radius) => {
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(x, y, width, height, radius);
      return;
    }
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
  };
  const walk = (node, callback) => {
    callback(node);
    node.children.forEach((child) => walk(child, callback));
  };
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = "rgba(74, 222, 128, 0.52)";
  walk(tree, (node) => {
    node.children.forEach((child) => {
      const startX = node.x + layout.nodeWidth;
      const startY = node.y + layout.nodeHeight / 2;
      const endX = child.x;
      const endY = child.y + layout.nodeHeight / 2;
      const control = Math.max(52, (endX - startX) * 0.48);
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.bezierCurveTo(startX + control, startY, endX - control, endY, endX, endY);
      ctx.stroke();
    });
  });
  walk(tree, (node) => {
    const x = node.x;
    const y = node.y;
    const active = matches(node);
    const accent = node.kind === "object" || node.kind === "array" ? "#6ee7b7" : "#67e8f9";
    ctx.save();
    ctx.shadowColor = active ? "rgba(250, 204, 21, 0.52)" : "rgba(14, 165, 233, 0.16)";
    ctx.shadowBlur = active ? 18 : 8;
    ctx.fillStyle = active ? "rgba(45, 35, 10, 0.96)" : "rgba(15, 23, 42, 0.94)";
    ctx.strokeStyle = active ? "rgba(250, 204, 21, 0.86)" : "rgba(129, 140, 248, 0.52)";
    ctx.lineWidth = active ? 1.6 : 1;
    ctx.beginPath();
    roundedRect(x, y, layout.nodeWidth, layout.nodeHeight, 6);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(x + 12, y + 13, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = "600 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    ctx.fillStyle = "#c084fc";
    ctx.fillText(ellipsize(node.key, 22), x + 24, y + 16);
    ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    ctx.fillStyle = node.kind === "number" ? "#fbbf24" : node.kind === "string" ? "#f0abfc" : "rgba(226, 232, 240, 0.88)";
    ctx.fillText(ellipsize(node.summary, 24), x + 24, y + 32);
    ctx.fillStyle = "rgba(148, 163, 184, 0.72)";
    ctx.textAlign = "right";
    ctx.fillText(node.kind, x + layout.nodeWidth - 10, y + 16);
    ctx.restore();
  });
};

const renderPreviewGraphCanvas = ({ value, query = "" } = {}) => {
  const { root, truncated, count } = buildPreviewGraphTree(value);
  const layout = layoutPreviewGraphTree(root);
  const shell = document.createElement("div");
  shell.className = "tl-flow-preview-graph-shell";
  const meta = document.createElement("div");
  meta.className = "tl-flow-preview-graph-meta";
  meta.textContent = truncated ? `Graph view · ${count}+ nodes · truncated` : `Graph view · ${count} nodes`;
  const scroller = document.createElement("div");
  scroller.className = "tl-flow-preview-graph-scroll";
  const canvas = document.createElement("canvas");
  canvas.className = "tl-flow-preview-graph-canvas";
  scroller.appendChild(canvas);
  shell.append(meta, scroller);
  window.requestAnimationFrame(() => drawPreviewGraph(canvas, root, layout, query));
  return shell;
};

const previewTextForRecord = (record = null, mode = "auto", maxChars = 2000) => {
  if (!record) return "Nessun payload dati ricevuto.\nI pulse di routing/test sono ignorati dal Preview.";
  const payload = record.payload;
  const originalPayload = record.originalPayload;
  const hasOriginalPayload = originalPayload !== undefined && originalPayload !== null;
  const mappingStatus = record.mappingWarnings?.length
    ? "warning"
    : record.mapping
      ? (hasOriginalPayload ? "applied" : "pass-through")
      : "raw";
  const warningText = record.mappingWarnings?.length
    ? `Mapping warnings:\n${record.mappingWarnings.map((warning) => `- ${warning}`).join("\n")}\n\n`
    : "";
  const mappingText = record.mapping
    ? `Mapping: ${record.mapping.mode || "pass-through"} · ${mappingStatus}${record.mappingDependencyId ? ` · ${record.mappingDependencyId}` : ""}\n\n`
    : "";
  const text = previewValueText(payload, mode);
  const originalText = hasOriginalPayload
    ? `\n\nOriginal payload:\n${previewValueText(originalPayload, mode)}`
    : "";
  const fullText = `${warningText}${mappingText}Mapped payload:\n${text}${originalText}`;
  return fullText.length > maxChars ? `${fullText.slice(0, maxChars)}\n...` : fullText;
};

const openPreviewPayloadDialog = (node = {}, options = {}) => {
  const record = options.record || previewRecordForNode(node);
  if (!record) return;
  const config = nodeRuntimeConfig(node);
  const mode = String(config.previewMode || config.mode || "auto").toLowerCase();
  const previewKey = options.previewKey || node.id || `preview_${Date.now()}`;
  const tabs = [
    { id: "mapped", label: "Mapped", value: record.payload },
    { id: "graph", label: "Graph", value: record.payload, view: "graph" },
    record.originalPayload !== undefined && record.originalPayload !== null
      ? { id: "original", label: "Original", value: record.originalPayload }
      : null,
    { id: "raw", label: "Raw", value: record.rawPayload ?? record.payload, mode: "raw" },
  ].filter(Boolean);
  let activeTab = tabs[0]?.id || "mapped";
  let searchQuery = "";
  let activeMatch = 0;
  const active = () => tabs.find((tab) => tab.id === activeTab) || tabs[0];
  const renderBody = () => {
    const tab = active();
    const isGraphView = tab.view === "graph";
    const text = previewValueText(tab.value, isGraphView ? "json" : (tab.mode || mode));
    const matchCount = countPreviewMatches(text, searchQuery);
    if (!matchCount) activeMatch = 0;
    else activeMatch = Math.max(0, Math.min(activeMatch, matchCount - 1));
    const restoreSearchFocus = () => {
      window.setTimeout(() => {
        const input = document.querySelector(`[data-preview-search-input="${escapeSelectorValue(previewKey)}"]`);
        if (!input) return;
        input.focus?.();
        input.setSelectionRange?.(input.value.length, input.value.length);
      }, 0);
    };
    const refreshDialogBody = ({ focusSearch = false } = {}) => {
      const host = document.querySelector(`[data-preview-dialog-body="${escapeSelectorValue(previewKey)}"]`);
      if (host) host.replaceChildren(renderBody());
      if (focusSearch) restoreSearchFocus();
    };
    return _.div(
      { class: "tl-flow-preview-dialog-body" },
      _.div(
        { class: "tl-flow-preview-dialog-tabs" },
        ...tabs.map((tabItem) => btn({
          class: tabItem.id === activeTab ? "is-active" : "",
          onclick: () => {
            activeTab = tabItem.id;
            activeMatch = 0;
            refreshDialogBody();
          },
        }, tabItem.label))
      ),
      _.div(
        { class: "tl-flow-preview-searchbar" },
        _.label(
          { class: "tl-flow-preview-search" },
          icon("search", "sm"),
          _.input({
            "data-preview-search-input": previewKey,
            value: searchQuery,
            placeholder: "Search payload",
            "aria-label": "Search payload",
            autocomplete: "off",
            oninput: (event) => {
              searchQuery = event.currentTarget.value;
              activeMatch = 0;
              refreshDialogBody({ focusSearch: true });
            },
            onkeydown: (event) => {
              event.stopPropagation();
              if (event.key === "Enter" && matchCount) {
                event.preventDefault();
                activeMatch = event.shiftKey
                  ? (activeMatch - 1 + matchCount) % matchCount
                  : (activeMatch + 1) % matchCount;
                refreshDialogBody({ focusSearch: true });
              }
            },
          })
        ),
        _.span({ class: "tl-flow-preview-search-count" }, searchQuery ? `${matchCount ? activeMatch + 1 : 0}/${matchCount}` : "0/0"),
        btn({
          class: "tl-flow-preview-search-nav",
          title: "Previous match",
          disabled: !matchCount,
          onclick: () => {
            activeMatch = (activeMatch - 1 + matchCount) % matchCount;
            refreshDialogBody();
          },
        }, icon("keyboard_arrow_up", "sm")),
        btn({
          class: "tl-flow-preview-search-nav",
          title: "Next match",
          disabled: !matchCount,
          onclick: () => {
            activeMatch = (activeMatch + 1) % matchCount;
            refreshDialogBody();
          },
        }, icon("keyboard_arrow_down", "sm"))
      ),
      isGraphView
        ? renderPreviewGraphCanvas({ value: tab.value, query: searchQuery })
        : previewCodeBlock({ text, mode: tab.mode || mode, query: searchQuery, activeMatch })
    );
  };
  const dialog = _.Dialog({
    class: "tl-flow-preview-dialog",
    panelClass: "tl-flow-config-panel tl-flow-preview-dialog-panel",
    size: "lg",
    title: options.title || `${node.label || "Preview"} payload`,
    subtitle: options.subtitle || `${record.channel || "runtime"} · ${record.eventType || "event"} · ${formatShortDate(record.createdAt)}`,
    icon: options.icon || "visibility",
    closeButton: true,
    content: () => _.div({ "data-preview-dialog-body": previewKey }, renderBody()),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: () => copyRuntimeValue(active()?.value) }, icon("content_copy", "sm"), "Copy"),
      btn({ onclick: close }, "Close")
    ),
  });
  dialog.open();
};

const renderPreviewNodePanel = (node = {}) => {
  const config = nodeRuntimeConfig(node);
  const record = previewRecordForNode(node);
  const mode = String(config.previewMode || config.mode || "auto").toLowerCase();
  const maxChars = Math.max(200, Math.min(12000, Number(config.maxChars || 2000)));
  return _.div(
    { class: "tl-flow-node-preview", "data-flow-preview-panel": node.id },
    _.div(
      { class: "tl-flow-node-preview-head" },
      _.span(
        { class: "tl-flow-node-preview-title" },
        record ? `${record.channel} · ${record.eventType} · ${formatShortDate(record.createdAt)}` : "Waiting for data payload"
      ),
      _.span(
        { class: "tl-flow-node-preview-actions" },
        record ? copyRuntimeButton(record.payload, "Copy preview payload") : null,
        record?.originalPayload !== undefined && record.originalPayload !== null ? copyRuntimeButton(record.originalPayload, "Copy original payload") : null,
        record ? btn({
          class: "tl-flow-copy-btn",
          title: "View full preview payload",
          onPointerDown: stopNodeControlEvent,
          onclick: (event) => {
            event.preventDefault();
            event.stopPropagation();
            openPreviewPayloadDialog(node);
          },
        }, icon("open_in_full", "sm")) : null,
        record ? btn({
          class: "tl-flow-copy-btn is-clear",
          title: "Clear preview payload",
          onPointerDown: stopNodeControlEvent,
          onclick: (event) => {
            event.preventDefault();
            event.stopPropagation();
            requestClearPreviewNodePayload(node);
          },
        }, icon("delete_sweep", "sm")) : null
      )
    ),
    _.pre(previewTextForRecord(record, mode, maxChars))
  );
};

const mediaSourceDropSpec = (subtype = "") => {
  if (subtype === "image-source") return {
    accept: "image/*",
    multiple: false,
    iconName: "add_photo_alternate",
    title: "Drop image",
    hint: "or click to select",
    dataKey: "imageDataUrl",
    nameKey: "imageFileName",
    typeKey: "imageMimeType",
    typePrefix: "image/",
  };
  if (subtype === "audio-source") return {
    accept: "audio/*",
    multiple: false,
    iconName: "library_music",
    title: "Drop audio",
    hint: "or click to select",
    dataKey: "audioDataUrl",
    nameKey: "audioFileName",
    typeKey: "audioMimeType",
    typePrefix: "audio/",
  };
  if (subtype === "file-source") return {
    accept: "",
    multiple: false,
    iconName: "upload_file",
    title: "Drop file",
    hint: "or click to select",
    dataKey: "fileDataUrl",
    nameKey: "fileName",
    typeKey: "mimeType",
    typePrefix: "",
  };
  if (subtype === "files-source") return {
    accept: "",
    multiple: true,
    iconName: "drive_folder_upload",
    title: "Drop files",
    hint: "or click to select",
    dataKey: "filesData",
    nameKey: "batchLabel",
    typeKey: "mimeType",
    typePrefix: "",
  };
  return null;
};

const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ""));
  reader.onerror = () => reject(reader.error || new Error("File read failed"));
  reader.readAsDataURL(file);
});

const persistMediaSourceFiles = async ({ node = {}, files = [], spec = null } = {}) => {
  const selectedFiles = Array.from(files || []).filter(Boolean);
  if (!node?.id || !selectedFiles.length || !spec) return;
  const validFiles = spec.typePrefix
    ? selectedFiles.filter((file) => String(file.type || "").startsWith(spec.typePrefix))
    : selectedFiles;
  if (!validFiles.length) return;
  if (spec.multiple) {
    const entries = await Promise.all(validFiles.map(async (file) => ({
      name: file.name || "file",
      type: file.type || "application/octet-stream",
      size: file.size || 0,
      dataUrl: await readFileAsDataUrl(file),
    })));
    persistInlineRuntimeNodeConfig({
      node,
      patch: {
        filesData: entries,
        filesJson: JSON.stringify(entries.map(({ name, type, size }) => ({ name, type, size })), null, 2),
        batchLabel: entries.length === 1 ? entries[0].name : `${entries.length} files`,
      },
    });
    return;
  }
  const file = validFiles[0];
  persistInlineRuntimeNodeConfig({
    node,
    patch: {
      [spec.dataKey]: await readFileAsDataUrl(file),
      [spec.nameKey]: file.name || "",
      [spec.typeKey]: file.type || "application/octet-stream",
    },
  });
};

const renderMediaSourceDropzone = (node = {}, config = {}) => {
  const subtype = nodeSubtype(node);
  const spec = mediaSourceDropSpec(subtype);
  if (!spec) return null;
  const inputId = `tl-flow-media-source-${String(node.id || "").replace(/[^A-Za-z0-9_-]/g, "_")}`;
  const filesData = Array.isArray(config.filesData) ? config.filesData : [];
  const dataUrl = String(config[spec.dataKey] || "").trim();
  const remoteUrl = subtype === "image-source"
    ? String(config.imageUrl || "").trim()
    : subtype === "audio-source"
      ? String(config.audioUrl || "").trim()
      : "";
  const previewUrl = dataUrl || remoteUrl;
  const hasValue = Boolean(previewUrl || filesData.length || config[spec.nameKey]);
  const handleFiles = (files) => persistMediaSourceFiles({ node, files, spec });
  const handleDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    handleFiles(event.dataTransfer?.files || []);
  };
  const summary = spec.multiple
    ? `${filesData.length || 0} file${(filesData.length || 0) === 1 ? "" : "s"}`
    : config[spec.nameKey] || (previewUrl ? "local media" : "");
  return _.label(
    {
      class: `tl-flow-node-media-drop is-${subtype}${hasValue ? " has-media" : ""}`,
      htmlFor: inputId,
      title: `${spec.title} here or click to select`,
      onPointerDown: stopNodeControlEvent,
      onclick: stopNodeControlEvent,
      ondragover: (event) => {
        event.preventDefault();
        event.stopPropagation();
      },
      ondrop: handleDrop,
    },
    _.input({
      id: inputId,
      type: "file",
      accept: spec.accept,
      multiple: spec.multiple,
      onchange: (event) => handleFiles(event.currentTarget.files || []),
    }),
    subtype === "image-source" && previewUrl ? _.img({ src: previewUrl, alt: config.alt || node.label || "Image source preview", loading: "lazy" }) : null,
    subtype === "audio-source" && previewUrl ? _.audio({ src: previewUrl, controls: true }) : null,
    subtype !== "image-source" || !previewUrl ? _.span(
      { class: "tl-flow-node-media-empty" },
      icon(spec.iconName, "sm"),
      _.strong(summary || spec.title),
      _.em(hasValue ? "Click or drop to replace" : spec.hint)
    ) : null,
    config.alt && subtype === "image-source" && previewUrl ? _.figcaption(config.alt) : null
  );
};

const mediaInlineHiddenKeys = (subtype = "") => {
  if (subtype === "image-source") return new Set(["imageUrl"]);
  if (subtype === "audio-source") return new Set(["audioUrl"]);
  if (subtype === "file-source") return new Set(["fileName"]);
  if (subtype === "files-source") return new Set(["batchLabel"]);
  return new Set();
};

const isKnowledgeDocumentStoreSubtype = (subtype = "") =>
  ["document-store", "text-knowledge", "workspace-memory", "conversation-memory"].includes(String(subtype || "").toLowerCase());

const shortInlineConfigValue = (value = "", fallback = "all") => {
  const clean = String(value || "").trim();
  if (!clean) return fallback;
  return clean.length > 28 ? `${clean.slice(0, 13)}...${clean.slice(-8)}` : clean;
};

const renderKnowledgeDocumentStoreInlineConfig = (node, config = {}) => {
  const row = ({ iconName = "settings", label = "", value = "", title = "" } = {}) =>
    _.span(
      { class: "tl-flow-kdoc-config-chip", title: title || `${label}: ${value || "all"}` },
      icon(iconName, "sm"),
      _.strong(label),
      _.em(shortInlineConfigValue(value))
    );
  return _.div(
    { class: "tl-flow-node-inline-config is-kdoc", onPointerDown: stopNodeControlEvent, onclick: stopNodeControlEvent },
    _.div(
      { class: "tl-flow-kdoc-config-grid" },
      row({ iconName: "folder", label: "Collection", value: config.collectionId || "", title: `Collection: ${config.collectionId || "all"}` }),
      row({ iconName: "translate", label: "Language", value: config.language || "auto" }),
      row({ iconName: "input", label: "Source", value: config.sourceType || "channel" }),
      row({ iconName: "outbox", label: "Output", value: config.outputChannel || config.output || "knowledge.document.created" })
    ),
    config.title ? _.div(
      { class: "tl-flow-kdoc-config-title", title: config.title },
      icon("article", "sm"),
      _.span(shortInlineConfigValue(config.title, "Knowledge Document"))
    ) : null
  );
};

const boolInlineConfigValue = (value, yes = "yes", no = "no") =>
  value === true || value === "true" || value === 1 || value === "1" ? yes : no;

const visiblePayloadInlineRows = (node = {}, config = {}, { limit = 8 } = {}) => {
  if (!payloadEditorAvailable(node, config)) return [];
  return normalizePayloadEditorItems(node, config)
    .filter((item) => item.enabled && item.visible)
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      key: item.key,
      type: item.type || "string",
      options: item.options || "",
      description: item.description || "",
      iconName: payloadItemIcon(item),
      iconColor: payloadItemIconColor(item),
      label: item.label || payloadItemLabel(item.key),
      value: item.value || "empty",
    }));
};

const payloadInlineSaveTimers = new Map();

const persistPayloadInlineValue = async ({ node = {}, item = {}, value = "", debounce = 0, refresh = false } = {}) => {
  if (!node?.id || !item?.key) return;
  const timerKey = `${node.id}:${item.id || item.key}`;
  if (payloadInlineSaveTimers.has(timerKey)) window.clearTimeout(payloadInlineSaveTimers.get(timerKey));
  const run = async () => {
    payloadInlineSaveTimers.delete(timerKey);
    const current = nodeById(node.id) || node;
    const subtype = nodeSubtype(current);
    const config = nodeConfigObject(current);
    const items = normalizePayloadEditorItems(current, config);
    let changed = false;
    const nextItems = items.map((entry) => {
      const matches = item.id
        ? entry.id === item.id
        : String(entry.key || "") === String(item.key || "");
      if (!matches) return entry;
      const nextValue = String(value ?? "");
      if (String(entry.value ?? "") === nextValue) return entry;
      changed = true;
      return { ...entry, value: nextValue };
    });
    if (!changed) return;
    const nextConfig = {
      ...config,
      payloadItems: nextItems,
    };
    if (subtype === "manual-json") {
      nextConfig.json = JSON.stringify(payloadObjectFromItems(nextItems), null, 2);
    } else if (["graph-query", "task"].includes(subtype)) {
      nextConfig[item.key] = parsePayloadItemValue(value, item.type || "string");
    }
    await persistInlineRuntimeNodeConfig({
      node: current,
      patch: nextConfig,
      reload: false,
      focus: false,
      record: false,
      channels: false,
    });
    if (refresh) mount();
  };
  if (debounce > 0) {
    payloadInlineSaveTimers.set(timerKey, window.setTimeout(run, debounce));
  } else {
    await run();
  }
};

const openPayloadNoteInlineDialog = (node = {}, item = {}, value = "") => {
  let draftValue = String(value || "");
  const label = item.label || payloadItemLabel(item.key) || "Prompt";
  const textarea = _.textarea({
    class: "tl-flow-payload-note-dialog-textarea",
    rows: 12,
    value: draftValue,
    placeholder: item.description || `Write ${label.toLowerCase()}...`,
    spellcheck: "true",
    onPointerDown: stopNodeControlEvent,
    onclick: stopNodeControlEvent,
    onInput: (event) => {
      event.stopPropagation();
      draftValue = String(event.currentTarget?.value || "");
    },
    onkeydown: (event) => {
      event.stopPropagation();
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        dialog.close();
        persistPayloadInlineValue({ node, item, value: draftValue, refresh: true });
      }
    },
  });
  const dialog = _.Dialog({
    class: "tl-flow-payload-note-dialog",
    panelClass: "tl-flow-payload-note-dialog-panel",
    size: "lg",
    title: label,
    subtitle: node.label || node.id || "",
    icon: item.iconName || "article",
    closeButton: true,
    content: () => _.div(
      { class: "tl-flow-payload-note-dialog-body" },
      textarea
    ),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: close }, "Cancel"),
      btn({
        color: "primary",
        onclick: () => {
          close();
          persistPayloadInlineValue({ node, item, value: draftValue, refresh: true });
        },
      }, icon("save", "sm"), "Save")
    ),
  });
  dialog.open();
  requestAnimationFrame(() => {
    textarea.focus?.();
    textarea.setSelectionRange?.(textarea.value.length, textarea.value.length);
  });
};

const renderPayloadInlineControl = (node = {}, item = {}) => {
  let savedValue = String(item.value === "empty" ? "" : item.value ?? "");
  let currentValue = savedValue;
  const stop = (event) => {
    event?.stopPropagation?.();
    event?.nativeEvent?.stopPropagation?.();
  };
  const commit = (event) => {
    stop(event);
    const value = String(payloadEditorCmsValue(event) ?? event?.currentTarget?.value ?? "");
    currentValue = value;
    if (value === savedValue) return;
    savedValue = value;
    persistPayloadInlineValue({ node, item, value });
  };
  const oninput = (event) => {
    stop(event);
    const value = String(payloadEditorCmsValue(event) ?? event?.currentTarget?.value ?? "");
    currentValue = value;
    persistPayloadInlineValue({ node, item, value, debounce: 350 });
  };
  const onkeydown = (event) => {
    stop(event);
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget?.blur?.();
    } else if (event.key === "Escape") {
      event.preventDefault();
      currentValue = savedValue;
      if (event.currentTarget) event.currentTarget.value = savedValue;
      event.currentTarget?.blur?.();
    }
  };
  if (item.type === "boolean") {
    return _.Toggle({
      size: "sm",
      checked: currentValue === "true" || currentValue === "1",
      onPointerDown: stop,
      onclick: stop,
      onChange: (checked) => {
        const value = checked ? "true" : "false";
        savedValue = value;
        currentValue = value;
        persistPayloadInlineValue({ node, item, value });
      },
    });
  }
  if (item.type === "select") {
    const options = payloadItemSelectOptions(item);
    return _.Select({
      size: "sm",
      label: item.label || payloadItemLabel(item.key) || "Value",
      class: "tl-flow-payload-inline-control",
      icon: payloadItemIconNode({ icon: item.iconName, iconColor: item.iconColor }),
      iconRight: item.description ? _.Icon({ name: "info", size: "sm", tooltip: item.description }) : null,
      style: item.iconColor ? { "--payload-icon-saved-color": item.iconColor, "--payload-icon-color": item.iconColor, "--set-color": item.iconColor } : null,
      value: currentValue || options[0] || "",
      options: (options.length ? options : [currentValue || ""]).map((value) => ({ value, label: value })),
      slots: { arrow: () => icon("keyboard_arrow_down", "sm") },
      onPointerDown: stop,
      onclick: stop,
      onkeydown,
      onkeyup: stop,
      onChange: (value) => {
        const nextValue = String(payloadEditorCmsValue(value) || "");
        savedValue = nextValue;
        currentValue = nextValue;
        persistPayloadInlineValue({ node, item, value: nextValue });
      },
    });
  }
  if (item.type === "note" || item.type === "textarea") {
    const displayValue = currentValue.trim() || "Open prompt editor";
    return btn({
      class: "tl-flow-payload-inline-control tl-flow-payload-note-open",
      title: currentValue ? `${item.label}: ${currentValue}` : `Open ${item.label || "prompt"} editor`,
      onPointerDown: stop,
      onclick: (event) => {
        event.preventDefault();
        stop(event);
        openPayloadNoteInlineDialog(node, item, currentValue);
      },
    },
    payloadItemIconNode({ icon: item.iconName, iconColor: item.iconColor }),
    _.span({ class: "tl-flow-payload-note-open-copy" },
      _.strong(item.label || payloadItemLabel(item.key) || "Prompt"),
      _.em(shortInlineConfigValue(displayValue, "empty"))
    ),
    icon("open_in_new", "sm"));
  }
  return _.Input({
    size: "sm",
    label: item.label || payloadItemLabel(item.key) || "Value",
    class: "tl-flow-payload-inline-control",
    icon: payloadItemIconNode({ icon: item.iconName, iconColor: item.iconColor }),
    iconRight: item.description ? _.Icon({ name: "info", size: "sm", tooltip: item.description }) : null,
    style: item.iconColor ? { "--payload-icon-saved-color": item.iconColor, "--payload-icon-color": item.iconColor, "--set-color": item.iconColor } : null,
    type: item.type === "int" || item.type === "float" ? "number" : "text",
    step: item.type === "float" ? "0.01" : item.type === "int" ? "1" : undefined,
    value: currentValue,
    autocomplete: "off",
    onPointerDown: stop,
    onclick: stop,
    onInput: oninput,
    onBlur: commit,
    slots: {
      input: ({ input }) => {
        input.addEventListener("beforeinput", stop);
        input.addEventListener("input", stop);
        input.addEventListener("change", stop);
        input.addEventListener("keydown", onkeydown);
        input.addEventListener("keypress", stop);
        input.addEventListener("keyup", stop);
        return input;
      },
    },
  });
};

const knowledgeInlineConfigRows = (subtype = "", config = {}) => {
  const output = config.outputChannel || config.output || "";
  const payloadRows = visiblePayloadInlineRows({ type: "knowledge", metadata: { subtype, category: "knowledge" } }, config);
  const rows = {
    "chunk-processor": [
      { iconName: "article", label: "Strategy", value: config.strategy || "structured" },
      { iconName: "data_object", label: "Max tokens", value: config.maxChunkTokens || config.tokenBudget || Math.max(80, Math.round((Number(config.chunkSize) || 900) / 4)) },
      { iconName: "tune", label: "Overlap tokens", value: config.chunkOverlapTokens || config.overlapTokens || Math.round((Number(config.chunkOverlap) || 120) / 4) },
      { iconName: "tune", label: "Replace", value: boolInlineConfigValue(config.replaceExisting ?? true) },
      { iconName: "folder", label: "Collection", value: config.collectionId || "" },
      { iconName: "hub", label: "Output", value: output || "knowledge.chunk.created" },
    ],
    "embedding-generator": [
      { iconName: "tune", label: "Provider", value: config.providerProfile || config.provider || "local" },
      { iconName: "memory", label: "Model", value: config.model || "local-hash" },
      { iconName: "data_object", label: "Dims", value: config.dimensions || "96" },
      { iconName: "folder", label: "Collection", value: config.collectionId || "" },
      { iconName: "hub", label: "Output", value: output || "knowledge.embedding.created" },
    ],
    "vector-memory": [
      { iconName: "tune", label: "Provider", value: config.providerProfile || config.provider || "local" },
      { iconName: "memory", label: "Model", value: config.model || "local-hash" },
      { iconName: "data_object", label: "Dims", value: config.dimensions || "96" },
      { iconName: "folder", label: "Collection", value: config.collectionId || "" },
      { iconName: "hub", label: "Output", value: output || "knowledge.embedding.created" },
    ],
    "rag-search": [
      { iconName: "search", label: "Query", value: config.query || "event query" },
      { iconName: "tune", label: "Top K", value: config.topK || "5" },
      { iconName: "speed", label: "Threshold", value: config.similarityThreshold ?? "0.08" },
      { iconName: "article", label: "Context", value: config.maxContextTokens || "1200" },
      { iconName: "folder", label: "Collection", value: config.collectionId || "" },
      { iconName: "hub", label: "Output", value: output || "knowledge.rag.context" },
    ],
    "entity-extractor": [
      { iconName: "psychology", label: "AI", value: config.entityMode || "llm" },
      { iconName: "tune", label: "Mode", value: config.extractionMode || "strict" },
      { iconName: "memory", label: "Dict", value: boolInlineConfigValue(config.useDictionarySeeds ?? true, "seeds", "off") },
      { iconName: "data_object", label: "Entities", value: config.maxEntities || "24" },
      { iconName: "hub", label: "Relations", value: config.maxRelations || "36" },
      { iconName: "data_object", label: "Chunk tokens", value: config.maxChunkTokens || (config.maxChunkChars ? Math.max(80, Math.round(Number(config.maxChunkChars) / 4)) : "400") },
      { iconName: "tune", label: "Replace", value: boolInlineConfigValue(config.replaceExisting ?? true) },
      { iconName: "folder", label: "Collection", value: config.collectionId || "" },
      { iconName: "hub", label: "Output", value: output || "knowledge.entity.created" },
    ],
    "knowledge-dictionary-builder": [
      { iconName: "psychology", label: "Mode", value: config.dictionaryMode || "llm" },
      { iconName: "filter_alt", label: "Scope", value: config.scope || "document" },
      { iconName: "translate", label: "Language", value: config.language || "auto" },
      { iconName: "data_object", label: "Limit", value: config.maxTerms || "120" },
      { iconName: "tune", label: "Replace", value: boolInlineConfigValue(config.replaceExisting ?? true) },
      { iconName: "folder", label: "Collection", value: config.collectionId || "" },
      { iconName: "hub", label: "Output", value: output || "knowledge.dictionary.updated" },
    ],
    "knowledge-event-builder": [
      { iconName: "timeline", label: "Mode", value: config.eventMode || (config.extractionMode === "ai" ? "llm" : config.extractionMode) || "llm" },
      { iconName: "tune", label: "Provider", value: config.providerProfile || config.providerType || "lm-studio" },
      { iconName: "data_object", label: "Events", value: config.maxEvents || "80" },
      { iconName: "tune", label: "Replace", value: boolInlineConfigValue(config.replaceExisting ?? true) },
      { iconName: "folder", label: "Collection", value: config.collectionId || "" },
      { iconName: "hub", label: "Output", value: output || "knowledge.events.updated" },
    ],
    "structured-knowledge-store": [
      { iconName: "schema", label: "Schema", value: config.schemaId || "structured/v1" },
      { iconName: "category", label: "Type", value: config.recordType || "record" },
      { iconName: "folder", label: "Collection", value: config.collectionId || "structured_default" },
      { iconName: "public", label: "World", value: config.worldId || "" },
      { iconName: "tune", label: "Replace", value: boolInlineConfigValue(config.replaceExisting ?? false) },
      { iconName: "hub", label: "Output", value: output || "structured.record.created" },
    ],
    "world-database": [
      { iconName: "public", label: "World", value: config.worldId || config.worldName || "world" },
      { iconName: "schema", label: "Schema", value: "worldbuilding/v1" },
      { iconName: "folder", label: "Collection", value: config.collectionId || "worldbuilding" },
      { iconName: "tune", label: "Replace", value: boolInlineConfigValue(config.replaceExisting ?? false) },
      { iconName: "hub", label: "Output", value: output || "world.database.updated" },
    ],
    "knowledge-graph": [
      { iconName: "filter_alt", label: "Scope", value: config.graphScope || (config.documentId ? "document" : config.collectionId ? "collection" : "workspace") },
      { iconName: "account_tree", label: "Entities", value: config.topEntities || "12" },
      { iconName: "hub", label: "Relations", value: config.maxRelations || "120" },
      { iconName: "tune", label: "Auto clear", value: boolInlineConfigValue(config.autoClearGraph || config.autoClearSnapshots) },
      { iconName: "folder", label: "Collection", value: config.collectionId || "" },
      { iconName: "hub", label: "Output", value: output || "knowledge.graph.updated" },
    ],
    "semantic-relation-enricher": [
      { iconName: "psychology", label: "Mode", value: config.enrichmentMode || "ai" },
      { iconName: "tune", label: "Provider", value: config.providerProfile || config.providerType || "lm-studio" },
      { iconName: "hub", label: "Relations", value: config.maxRelations || "48" },
      { iconName: "speed", label: "Confidence", value: config.confidenceThreshold ?? "0.55" },
      { iconName: "tune", label: "Replace", value: boolInlineConfigValue(config.replaceExisting ?? true) },
      { iconName: "folder", label: "Collection", value: config.collectionId || "" },
      { iconName: "hub", label: "Output", value: output || "knowledge.semantic.relations" },
    ],
    "knowledge-graph-builder-agent": [
      { iconName: "auto_awesome", label: "Provider", value: config.providerProfile || config.provider || "local" },
      { iconName: "memory", label: "Model", value: config.model || "local-model" },
      { iconName: "article", label: "Chunks", value: config.maxChunks || "6" },
      { iconName: "data_object", label: "Chunk tokens", value: config.maxChunkTokens || (config.maxChunkChars ? Math.max(80, Math.round(Number(config.maxChunkChars) / 4)) : "450") },
      { iconName: "hub", label: "Relations", value: config.maxRelations || "48" },
      { iconName: "speed", label: "Confidence", value: config.confidenceThreshold ?? "0.65" },
      { iconName: "tune", label: "Replace", value: boolInlineConfigValue(config.replaceExisting ?? true) },
      { iconName: "folder", label: "Collection", value: config.collectionId || "" },
      { iconName: "hub", label: "Output", value: output || "knowledge.graph.proposed" },
    ],
    "knowledge-mechanism-cue-agent": [
      { iconName: "psychology_alt", label: "Mode", value: config.cueMode || "llm" },
      { iconName: "tune", label: "Provider", value: config.providerProfile || config.providerType || "lm-studio" },
      { iconName: "search", label: "Query", value: config.query || "runtime query" },
      { iconName: "article", label: "Chunks", value: config.maxChunks || "24" },
      { iconName: "folder", label: "Collection", value: config.collectionId || "" },
      { iconName: "hub", label: "Output", value: output || "knowledge.mechanism.cues" },
    ],
    "graph-query": payloadRows.length ? [
      ...payloadRows,
      { iconName: "hub", label: "Output", value: output || "knowledge.graph.context" },
    ] : [
      { iconName: "filter_alt", label: "Scope", value: config.graphScope || (config.documentId ? "document" : config.collectionId ? "collection" : "workspace") },
      { iconName: "psychology", label: "Expansion", value: config.queryExpansionMode || "llm" },
      { iconName: "search", label: "Query", value: config.query || "event query" },
      { iconName: "tune", label: "Depth", value: config.depth || "1" },
      { iconName: "data_object", label: "Top K", value: config.topK || "12" },
      { iconName: "article", label: "Evidence", value: config.maxEvidence || "6" },
      { iconName: "rule", label: "Evidence mode", value: config.evidenceMode || "balanced" },
      { iconName: "folder", label: "Collection", value: config.collectionId || "" },
      { iconName: "hub", label: "Output", value: output || "knowledge.graph.context" },
    ],
    "knowledge-reasoning-composer": [
      { iconName: "psychology", label: "Mode", value: config.compositionMode || "llm" },
      { iconName: "schema", label: "Intent", value: config.intentMode || "auto" },
      { iconName: "fact_check", label: "Facts", value: config.maxFacts || "8" },
      { iconName: "timeline", label: "Events", value: config.maxEvents || "12" },
      { iconName: "article", label: "Background", value: boolInlineConfigValue(config.includeBackground ?? false) },
      { iconName: "hub", label: "Output", value: output || "knowledge.graph.context" },
    ],
  }[subtype] || [];
  if (config.documentId) {
    return [
      { iconName: "article", label: "Document", value: config.documentId },
      ...rows,
    ];
  }
  return rows;
};

const renderKnowledgeInlineConfig = (node, config = {}) => {
  const subtype = nodeSubtype(node);
  const rows = knowledgeInlineConfigRows(subtype, config);
  if (!rows.length) return null;
  const payloadRows = visiblePayloadInlineRows(node, config);
  const renderPayloadRows = subtype === "graph-query" && payloadRows.length > 0;
  return _.div(
    { class: "tl-flow-node-inline-config is-knowledge-config", onPointerDown: stopNodeControlEvent, onclick: stopNodeControlEvent },
    renderPayloadRows ? _.div(
      { class: "tl-flow-payload-inline-list" },
      ...payloadRows.map((item) => _.div(
        {
          class: "tl-flow-payload-inline-row",
          style: payloadItemIconStyle(item),
          title: `${item.label}: ${item.value || "empty"}`,
          onPointerDown: stopNodeControlEvent,
          onclick: stopNodeControlEvent,
        },
        renderPayloadInlineControl(node, item)
      ))
    ) : _.div(
      { class: "tl-flow-kdoc-config-grid" },
      ...rows.map((item) => _.span(
        { class: "tl-flow-kdoc-config-chip", title: `${item.label}: ${item.value || "all"}` },
        icon(item.iconName || "settings", "sm"),
        _.strong(item.label),
        _.em(shortInlineConfigValue(item.value))
      ))
    )
  );
};

const runtimeInlineConfigRows = (node = {}, config = {}) => {
  const subtype = nodeSubtype(node);
  const category = nodeCategory(node);
  const emit = config.emitChannel || config.outputChannel || config.output || "";
  const payloadRows = visiblePayloadInlineRows(node, config);
  if (category === "sources") {
    if (subtype === "task") {
      return payloadRows.length ? payloadRows : [
        { iconName: "article", label: "Goal", value: config.objective || "task" },
        { iconName: "tune", label: "Priority", value: config.priority || "normal" },
        { iconName: "speed", label: "Max", value: config.maxIterations || "5" },
        { iconName: "hub", label: "Emit", value: emit || "task" },
      ];
    }
    if (subtype === "manual-json") {
      return payloadRows.length ? payloadRows : [
        { iconName: "hub", label: "Emit", value: emit || "raw" },
        { iconName: "data_object", label: "Payload", value: config.json || "JSON" },
      ];
    }
    if (subtype === "text-input" || subtype === "manual-input") {
      return [
        { iconName: "hub", label: "Emit", value: emit || "raw" },
        { iconName: "article", label: "Text", value: config.text || "manual text" },
      ];
    }
    if (subtype === "image-source") {
      return [
        { iconName: "hub", label: "Emit", value: emit || "image" },
        { iconName: "article", label: "Image", value: config.imageUrl || config.imageFileName || "upload" },
        { iconName: "article", label: "Alt", value: config.alt || "none" },
      ];
    }
    if (subtype === "audio-source") {
      return [
        { iconName: "hub", label: "Emit", value: emit || "audio" },
        { iconName: "article", label: "Audio", value: config.audioUrl || config.audioFileName || "upload" },
        { iconName: "article", label: "Notes", value: config.transcript || "none" },
      ];
    }
    if (subtype === "file-source") {
      return [
        { iconName: "hub", label: "Emit", value: emit || "file" },
        { iconName: "article", label: "File", value: config.fileName || "upload" },
        { iconName: "data_object", label: "MIME", value: config.mimeType || "auto" },
      ];
    }
    if (subtype === "files-source") {
      return [
        { iconName: "hub", label: "Emit", value: emit || "files" },
        { iconName: "folder", label: "Batch", value: config.batchLabel || "import" },
        { iconName: "data_object", label: "Files", value: config.filesJson || config.files || "array" },
      ];
    }
    return [
      { iconName: "tune", label: "Method", value: config.method || (subtype === "websocket" ? "WS" : "GET") },
      { iconName: "hub", label: "Source", value: config.endpoint || config.url || config.source || subtype || "source" },
      { iconName: "speed", label: "Poll", value: config.intervalMs || "manual" },
      { iconName: "hub", label: "Emit", value: emit || "raw" },
    ];
  }
  if (category === "processors") {
    if (subtype === "condition") {
      return [
        { iconName: "filter_alt", label: "Field", value: config.conditionField || config.field || "payload.value" },
        { iconName: "tune", label: "Op", value: config.conditionOperator || config.operator || ">" },
        { iconName: "data_object", label: "Value", value: config.conditionValue || config.value || "set" },
        { iconName: "hub", label: "Routes", value: `${config.trueOutput || "true"} / ${config.falseOutput || "false"}` },
      ];
    }
    if (subtype === "filter") {
      return [
        { iconName: "filter_alt", label: "Path", value: config.filterPath || "payload.status" },
        { iconName: "tune", label: "Op", value: config.filterOperator || "==" },
        { iconName: "data_object", label: "Value", value: config.filterValue || "active" },
      ];
    }
    if (subtype === "transform" || subtype === "map" || subtype === "formatter") {
      return [
        { iconName: "tune", label: "Expr", value: config.expression || "payload" },
        { iconName: "hub", label: "Output", value: config.output || "output" },
      ];
    }
    if (["throttle", "debounce"].includes(subtype)) {
      return [
        { iconName: "speed", label: "Window", value: config.windowMs || "1000" },
        { iconName: "tune", label: "Mode", value: config.strategy || "latest" },
      ];
    }
    if (["merge", "split", "reduce", "aggregator"].includes(subtype)) {
      return [
        { iconName: "tune", label: "Strategy", value: config.strategy || subtype },
        { iconName: "data_object", label: "Window", value: config.windowSize || "100" },
      ];
    }
    if (subtype === "validator") {
      return [
        { iconName: "data_object", label: "Schema", value: config.schema || "required" },
        { iconName: "hub", label: "Routes", value: "valid / invalid" },
      ];
    }
    return [
      { iconName: "tune", label: "Mode", value: config.mode || subtype || "processor" },
      { iconName: "data_object", label: "Config", value: config.config || config.parser || config.path || "default" },
    ];
  }
  if (category === "ai-agents") {
    if (subtype === "orchestrator") {
      return [
        { iconName: "hub", label: "Mode", value: config.executionMode || "on_event" },
        { iconName: "speed", label: "Steps", value: config.maxSteps || config.maxIterations || "6" },
        { iconName: "tune", label: "Allow", value: config.allowedNodeTypes || "runtime" },
      ];
    }
    return [
      { iconName: "tune", label: "Provider", value: config.provider || "local" },
      { iconName: "memory", label: "Model", value: config.model || "model" },
      { iconName: "article", label: "Prompt", value: config.prompt || "default" },
      { iconName: "data_object", label: "Expect", value: config.assertValue || config.expectedOutput || "none" },
    ];
  }
  if (category === "actions") {
    if (subtype === "runtime-trigger") {
      return [
        { iconName: "bolt", label: "Emit", value: config.targetChannel || emit || "trigger" },
        { iconName: "data_object", label: "Payload", value: config.template || "event" },
      ];
    }
    if (subtype === "telegram") {
      return [
        { iconName: "hub", label: "Chat", value: config.chatId || "not set" },
        { iconName: "hub", label: "Target", value: config.target || "Telegram API" },
        { iconName: "tune", label: "Retry", value: config.retryPolicy || "none" },
      ];
    }
    if (subtype === "whatsapp") {
      return [
        { iconName: "hub", label: "To", value: config.to || "not set" },
        { iconName: "hub", label: "Target", value: config.target || "provider" },
        { iconName: "tune", label: "Retry", value: config.retryPolicy || "none" },
      ];
    }
    if (subtype === "http-write") {
      return [
        { iconName: "tune", label: "Method", value: config.method || "POST" },
        { iconName: "hub", label: "Target", value: config.target || "URL" },
        { iconName: "data_object", label: "Payload", value: config.template || "event" },
      ];
    }
    return [
      { iconName: "hub", label: "Target", value: config.target || subtype || "action" },
      { iconName: "data_object", label: "Payload", value: config.template || "event" },
      { iconName: "tune", label: "Retry", value: config.retryPolicy || "none" },
    ];
  }
  if (category === "storage") {
    return [
      { iconName: "storage", label: "Store", value: config.storeName || config.bucket || subtype || "store" },
      { iconName: "data_object", label: "Key", value: config.keyPath || "id" },
      { iconName: "speed", label: "Keep", value: config.retention || "default" },
    ];
  }
  if (category === "dev") {
    return [
      { iconName: "visibility", label: "Mode", value: config.previewMode || config.mode || "auto" },
      { iconName: "data_object", label: "Max", value: config.maxChars || "2000" },
    ];
  }
  return [];
};

const renderRuntimeChipInlineConfig = (node, config = {}) => {
  const rows = runtimeInlineConfigRows(node, config);
  if (!rows.length) return null;
  const subtype = nodeSubtype(node);
  const payloadRows = visiblePayloadInlineRows(node, config);
  const renderPayloadRows = payloadRows.length > 0 && ["manual-json", "task"].includes(subtype);
  return _.div(
    { class: "tl-flow-node-inline-config is-runtime-config", onPointerDown: stopNodeControlEvent, onclick: stopNodeControlEvent },
    mediaSourceDropSpec(subtype) ? renderMediaSourceDropzone(node, config) : null,
    renderPayloadRows ? _.div(
      { class: "tl-flow-payload-inline-list" },
      ...payloadRows.map((item) => _.div(
        {
          class: "tl-flow-payload-inline-row",
          style: payloadItemIconStyle(item),
          title: `${item.label}: ${item.value || "empty"}`,
          onPointerDown: stopNodeControlEvent,
          onclick: stopNodeControlEvent,
        },
        renderPayloadInlineControl(node, item)
      ))
    ) : _.div(
      { class: "tl-flow-kdoc-config-grid" },
      ...rows.map((item) => _.span(
        { class: "tl-flow-kdoc-config-chip", title: `${item.label}: ${item.value || "all"}` },
        icon(item.iconName || "settings", "sm"),
        _.strong(item.label),
        _.em(shortInlineConfigValue(item.value))
      ))
    ),
    subtype === "telegram" ? btn({
      class: "tl-flow-inline-editor-btn",
      title: "Send Telegram test message",
      onPointerDown: stopNodeControlEvent,
      onclick: (event) => testTelegramActionNode(node, event),
    }, icon("send", "sm"), "Test") : null
  );
};

const fallbackInlineFieldValue = (node = {}, config = {}, definition = {}) => {
  const defaults = runtimeNodeConfigDefaults(node);
  const value = config[definition.key] ?? defaults[definition.key] ?? definition.defaultValue ?? "";
  if (definition.type === "checkbox" || definition.type === "boolean" || definition.type === "toggle") {
    return boolInlineConfigValue(value);
  }
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch (_) {
      return definition.label || definition.key || "object";
    }
  }
  return value || definition.placeholder || definition.label || definition.key || "default";
};

const renderFallbackInlineConfig = (node, config = {}, fields = []) => {
  const subtype = nodeSubtype(node);
  const visibleFields = fields.filter((definition) => !mediaInlineHiddenKeys(subtype).has(definition.key)).slice(0, 6);
  if (!visibleFields.length) return null;
  return _.div(
    { class: "tl-flow-node-inline-config is-runtime-config is-fallback", onPointerDown: stopNodeControlEvent, onclick: stopNodeControlEvent },
    mediaSourceDropSpec(subtype) ? renderMediaSourceDropzone(node, config) : null,
    _.div(
      { class: "tl-flow-kdoc-config-grid" },
      ...visibleFields.map((definition) => _.span(
        { class: "tl-flow-kdoc-config-chip", title: `${definition.label}: ${fallbackInlineFieldValue(node, config, definition)}` },
        icon(definition.type === "checkbox" ? "tune" : definition.type === "select" ? "filter_alt" : "data_object", "sm"),
        _.strong(definition.label || definition.key),
        _.em(shortInlineConfigValue(fallbackInlineFieldValue(node, config, definition), "default"))
      ))
    )
  );
};

const renderInlineNodeSettings = (node) => {
  if (!isInlineConfigNode(node) || node.metadata?.library) return null;
  if (isCustomRuntimeNode(node)) return renderCustomRuntimeNodeInlineForm(node);
  if (isPreviewNode(node)) return renderPreviewNodePanel(node);
  if (node.type === "boxTracker" || node.type === "boxLens") {
    return _.div(
      { class: "tl-flow-node-inline-config is-external" },
      btn({
        class: "tl-flow-inline-editor-btn",
        onPointerDown: stopNodeControlEvent,
        onclick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          configureNode(node);
        },
      }, icon("open_in_new", "sm"), node.type === "boxTracker" ? "Tracker Editor" : "Lens Editor")
    );
  }

  const defaults = runtimeNodeConfigDefaults(node);
  const config = defaults.configObject || {};
  const fields = inlineConfigFields(node).slice(0, 3);
  const subtype = nodeSubtype(node);
  if (nodeCategory(node) === "knowledge" && isKnowledgeDocumentStoreSubtype(subtype)) {
    return renderKnowledgeDocumentStoreInlineConfig(node, config);
  }
  if (nodeCategory(node) === "knowledge") {
    const knowledgeConfig = renderKnowledgeInlineConfig(node, config);
    if (knowledgeConfig) return knowledgeConfig;
  }
  const runtimeChipConfig = renderRuntimeChipInlineConfig(node, config);
  if (runtimeChipConfig) return runtimeChipConfig;
  return renderFallbackInlineConfig(node, config, fields);
};

const customConfigValue = (config = {}, field = {}) => {
  const value = config[field.key];
  if (value !== undefined && value !== null) return value;
  const settings = nodeBuilderComponentSettings(field);
  if (field.type === "toggle" || field.type === "checkbox" || field.type === "boolean") return Boolean(settings.defaultChecked);
  if (field.type === "radio") return settings.defaultValue || nodeBuilderFieldOptions(field)[0]?.value || "option-1";
  if (field.type === "select") return settings.defaultValue || nodeBuilderFieldOptions(field)[0]?.value || "";
  if (field.type === "number" || field.type === "slider" || field.type === "rating") return Number(settings.defaultValue) || 0;
  if (settings.defaultValue !== undefined && settings.defaultValue !== null) return settings.defaultValue;
  return "";
};

const customInlineSaveTimers = new Map();

const persistCustomInlineValue = ({ node = {}, key = "", value = "", debounce = 0 } = {}) => {
  if (!node?.id || !key) return;
  const timerKey = `${node.id}:${key}`;
  if (customInlineSaveTimers.has(timerKey)) window.clearTimeout(customInlineSaveTimers.get(timerKey));
  const run = async () => {
    customInlineSaveTimers.delete(timerKey);
    const current = nodeById(node.id) || node;
    const nextConfig = {
      ...nodeConfigObject(current),
      [key]: value,
    };
    const nextNode = customRuntimeNodeUpdate({
      node: current,
      label: current.label || node.label,
      runtimeStatus: current.metadata?.runtimeStatus || current.runtime?.status || current.status || "idle",
      config: nextConfig,
    });
    state.runtime.nodes = (state.runtime.nodes || []).map((item) => item.id === nextNode.id ? nextNode : item);
    try {
      await window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode?.({ node: nextNode });
    } catch (error) {
      console.error("Errore salvataggio campo custom runtime node:", error);
      state.error = error?.message || "Errore salvataggio campo custom runtime node";
      setErrorSignal(state.error);
    }
  };
  if (debounce > 0) {
    customInlineSaveTimers.set(timerKey, window.setTimeout(run, debounce));
  } else {
    run();
  }
};

const renderCustomRuntimeNodeInlineComponent = (node = {}, layoutNode = {}, config = {}) => {
  const settings = nodeBuilderComponentSettings(layoutNode);
  if (settings.visibleOnNode === false) return null;
  const label = layoutNode.label || layoutNode.key || layoutNode.type || "Field";
  if (NODE_BUILDER_CONTAINER_TYPES.has(layoutNode.type)) {
    const children = layoutNode.children?.length
      ? layoutNode.children.map((child) => renderCustomRuntimeNodeInlineComponent(node, child, config)).filter(Boolean)
      : [];
    return _.div(
      { class: `tl-flow-node-builder-preview-form-node is-${layoutNode.type}` },
      _.div(
        { class: "tl-flow-node-builder-preview-form-head" },
        icon(nodeBuilderComponentIcon(layoutNode.type), "sm"),
        _.strong(label),
        _.em(layoutNode.type)
      ),
      _.div(
        { class: "tl-flow-node-builder-preview-form-children" },
        ...(children.length ? children : [_.span({ class: "tl-flow-node-builder-preview-empty" }, "Empty container")])
      )
    );
  }
  if (layoutNode.type === "badge" || layoutNode.type === "chip") {
    return _.span(
      { class: `tl-flow-node-builder-live-token is-${layoutNode.type}` },
      icon(nodeBuilderComponentIcon(layoutNode.type), "sm"),
      label
    );
  }
  const key = layoutNode.key || layoutNode.id;
  const readCmsValue = (nextValue) => nextValue?.target?.value ?? nextValue;
  const readCmsChecked = (nextValue) => nextValue?.target?.checked ?? nextValue;
  const readCmsDateValue = (nextValue) => {
    const raw = readCmsValue(nextValue);
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.toISOString().slice(0, 10);
    return String(raw || "");
  };
  const stopInlineControlEvent = (event) => {
    event.stopPropagation();
  };
  const value = customConfigValue(config, { ...layoutNode, key });
  if (layoutNode.type === "select") {
    const options = nodeBuilderFieldOptions(layoutNode);
    return _.Select({
      class: "tl-flow-node-builder-live-field",
      size: "sm",
      label,
      value: String(value || settings.defaultValue || options[0]?.value || ""),
      options,
      slots: { arrow: () => icon("keyboard_arrow_down", "sm") },
      onPointerDown: stopInlineControlEvent,
      onclick: stopInlineControlEvent,
      onChange: (nextValue) => persistCustomInlineValue({ node, key, value: String(readCmsValue(nextValue) || "") }),
    });
  }
  if (layoutNode.type === "checkbox") {
    return _.div(
      { class: "tl-flow-node-builder-live-check", onPointerDown: stopInlineControlEvent, onclick: stopInlineControlEvent },
      _.span(label),
      _.Checkbox({
        class: "tl-flow-node-builder-live-check-control",
        size: "sm",
        checked: Boolean(value),
        title: label,
        color: settings.color || "success",
        outline: true,
        ...(settings.icon ? { checkedIcon: settings.icon } : {}),
        onChange: (checked) => persistCustomInlineValue({ node, key, value: Boolean(readCmsChecked(checked)) }),
      })
    );
  }
  if (layoutNode.type === "radio") {
    return _.div(
      { class: "tl-flow-node-builder-live-check", onPointerDown: stopInlineControlEvent, onclick: stopInlineControlEvent },
      _.span(label),
      _.Radio({
        class: "tl-flow-node-builder-live-check-control",
        size: "sm",
        checked: Boolean(value),
        title: label,
        color: settings.color || "success",
        outline: true,
        ...(settings.icon ? { checkedIcon: settings.icon } : {}),
        onChange: () => persistCustomInlineValue({ node, key, value: settings.defaultValue || nodeBuilderFieldOptions(layoutNode)[0]?.value || "option-1" }),
      })
    );
  }
  if (layoutNode.type === "toggle" || layoutNode.type === "boolean") {
    return _.div(
      { class: "tl-flow-node-builder-live-toggle", onPointerDown: stopInlineControlEvent, onclick: stopInlineControlEvent },
      _.span(label),
      _.Toggle({
        class: "tl-flow-node-builder-live-toggle-control",
        size: "sm",
        checked: Boolean(value),
        color: settings.color || "success",
        ...(settings.icon ? { iconOn: settings.icon, checkedIcon: settings.icon } : {}),
        onChange: (checked) => persistCustomInlineValue({ node, key, value: Boolean(readCmsChecked(checked)) }),
      })
    );
  }
  if (layoutNode.type === "rating") {
    return _.div(
      { class: "tl-flow-node-builder-live-field", onPointerDown: stopInlineControlEvent, onclick: stopInlineControlEvent },
      _.span(label),
      _.Rating ? _.Rating({
        size: "sm",
        value: Number(value) || 0,
        max: Number(settings.max) || 5,
        colorSelected: settings.color || "primary",
        onChange: (nextValue) => persistCustomInlineValue({ node, key, value: Number(readCmsValue(nextValue)) || 0 }),
      }) : _.Input({
        class: "tl-flow-node-builder-live-field",
        size: "sm",
        label,
        value: String(value || "0"),
        onInput: (event) => persistCustomInlineValue({ node, key, value: Number(readCmsValue(event)) || 0, debounce: 350 }),
      })
    );
  }
  if (layoutNode.type === "date") {
    return _.Date ? _.Date({
      class: "tl-flow-node-builder-live-field",
      size: "sm",
      label,
      value: String(value || ""),
      ...(settings.icon ? { icon: settings.icon } : {}),
      onPointerDown: stopInlineControlEvent,
      onclick: stopInlineControlEvent,
      onChange: (nextValue) => persistCustomInlineValue({ node, key, value: readCmsDateValue(nextValue) }),
    }) : _.Input({
      class: "tl-flow-node-builder-live-field",
      size: "sm",
      label,
      value: String(value || ""),
      ...(settings.icon ? { icon: settings.icon } : {}),
      onPointerDown: stopInlineControlEvent,
      onclick: stopInlineControlEvent,
      onInput: (event) => persistCustomInlineValue({ node, key, value: String(readCmsValue(event) || ""), debounce: 350 }),
    });
  }
  if (layoutNode.type === "time") {
    return _.Time ? _.Time({
      class: "tl-flow-node-builder-live-field",
      size: "sm",
      label,
      value: String(value || ""),
      ...(settings.icon ? { icon: settings.icon } : {}),
      onPointerDown: stopInlineControlEvent,
      onclick: stopInlineControlEvent,
      onChange: (nextValue) => persistCustomInlineValue({ node, key, value: String(readCmsValue(nextValue) || "") }),
    }) : _.Input({
      class: "tl-flow-node-builder-live-field",
      size: "sm",
      label,
      value: String(value || ""),
      onPointerDown: stopInlineControlEvent,
      onclick: stopInlineControlEvent,
      onInput: (event) => persistCustomInlineValue({ node, key, value: String(readCmsValue(event) || ""), debounce: 350 }),
    });
  }
  if (layoutNode.type === "slider" || layoutNode.type === "number") {
    return _.div(
      { class: "tl-flow-node-builder-live-field", onPointerDown: stopInlineControlEvent, onclick: stopInlineControlEvent },
      _.span(label),
      _.Slider ? _.Slider({
        size: "sm",
        showValue: true,
        value: Number(value) || 0,
        min: Number(settings.min) || 0,
        max: Number(settings.max) || 100,
        step: Number(settings.step) || 1,
        color: settings.color || "primary",
        onChange: (nextValue) => persistCustomInlineValue({ node, key, value: Number(readCmsValue(nextValue)) || 0 }),
      }) : _.Input({
        class: "tl-flow-node-builder-live-field",
        size: "sm",
        label,
        value: String(value || "0"),
        onPointerDown: stopInlineControlEvent,
        onclick: stopInlineControlEvent,
        onInput: (event) => persistCustomInlineValue({ node, key, value: Number(readCmsValue(event)) || 0, debounce: 350 }),
      })
    );
  }
  return _.Input({
    class: "tl-flow-node-builder-live-field",
    size: "sm",
    label,
    value: String(value || ""),
    placeholder: layoutNode.key || label,
    autocomplete: "off",
    onPointerDown: stopInlineControlEvent,
    onclick: stopInlineControlEvent,
    onInput: (event) => persistCustomInlineValue({ node, key, value: String(readCmsValue(event) || ""), debounce: 350 }),
  });
};

const renderCustomRuntimeNodeInlineForm = (node = {}) => {
  const layout = customNodeFormLayout(node);
  if (!layout.length) return null;
  const config = nodeConfigObject(node);
  return _.div(
    { class: "tl-flow-node-builder-live-form tl-flow-custom-node-live-form", onPointerDown: stopNodeControlEvent, onclick: stopNodeControlEvent },
    ...layout.map((layoutNode) => renderCustomRuntimeNodeInlineComponent(node, layoutNode, config)).filter(Boolean)
  );
};

const requestRuntimeNodeChannelWarning = ({ node, form, close, dependencies }) => {
  const dialog = _.Dialog({
    class: "tl-flow-edge-delete-dialog",
    panelClass: "tl-flow-edge-delete-panel",
    size: "md",
    title: "Channel usati nel runtime",
    subtitle: node.label || node.id,
    icon: "warning_amber",
    closeButton: true,
    content: () => _.div(
      { class: "tl-flow-edge-delete-body" },
      _.p("Questo nodo ha collegamenti attivi. Cambiare input/output puo modificare il routing degli eventi."),
      _.div(_.span("Node"), _.strong(node.label || node.id)),
      _.div(_.span("Dependencies"), _.strong(String(dependencies.length))),
      _.div(_.span("Action"), _.strong("Save Anyway aggiornera node e Channel Registry"))
    ),
    actions: ({ close: closeWarning }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: closeWarning }, "Cancel"),
      btn({
        class: "is-danger",
        onclick: () => {
          closeWarning();
          persistRuntimeNodeConfig({ node, form, close, force: true });
        },
      }, icon("warning_amber", "sm"), "Save Anyway")
    ),
  });
  dialog.open();
};

const persistRuntimeNodeConfig = async ({ node, form, close, force = false }) => {
  const defaults = runtimeNodeConfigDefaults(node);
  const update = runtimeNodeUpdateFromValues({
    node,
    values: {
      label: readConfigField(form, "label", defaults.label),
      input: readConfigField(form, "input", defaults.input),
      output: readConfigField(form, "output", defaults.output),
      mode: readConfigField(form, "mode", defaults.mode),
      runtimeStatus: readConfigField(form, "runtimeStatus", defaults.runtimeStatus),
      config: { ...defaults.configObject, ...readConfigMap(form, node) },
    },
  });
  const nextNode = update.node;
  const channels = update.channels;
  const dependencies = selectedDependencies(node);
  const previousChannels = channelSetKey([...(node.inputs || []), ...(node.outputs || [])]);
  const nextChannels = channelSetKey([...(nextNode.inputs || []), ...(nextNode.outputs || [])]);
  if (!force && dependencies.length && previousChannels !== nextChannels) {
    requestRuntimeNodeChannelWarning({ node, form, close, dependencies });
    return;
  }

  try {
    await window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode?.({ node: nextNode });
    if (window.TrackerLensChannelRegistry?.upsertChannelsForRuntimeNode) {
      await window.TrackerLensChannelRegistry.upsertChannelsForRuntimeNode({ node: nextNode });
    }
    await recordFlowAction({
      workspaceId: nextNode.workspaceId || "global",
      nodeId: nextNode.id,
      message: `Runtime node configured: ${nextNode.label || nextNode.id}`,
      context: {
        action: "runtime-node-configured",
        nodeType: nextNode.type || "",
        channels,
        forced: Boolean(force),
      },
    });
    setFocusState({
      mode: "dependencies",
      nodeId: nextNode.id,
      edgeId: "",
      nodeType: nextNode.type,
      channel: channels[0] || "",
      connectionId: "",
    });
    close?.();
    await loadRuntime();
  } catch (error) {
    console.error("Errore configurazione runtime node:", error);
    state.error = error?.message || "Errore configurazione runtime node";
    mount();
  }
};

const flowAiConfigValue = (value = "") => Array.isArray(value) ? value.join(", ") : String(value || "");

let runtimeDefaultAiSettingsCache = null;

const normalizeRuntimeProviderName = (value = "") =>
  String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");

const readRuntimeDefaultAiSettings = async () => {
  if (runtimeDefaultAiSettingsCache) return runtimeDefaultAiSettingsCache;
  const fallback = {
    provider: "Ollama",
    model: "llama3.1",
    temperature: 0.72,
    maxTokens: 2048,
    localFirst: true,
  };
  if (!window.indexedDB) {
    runtimeDefaultAiSettingsCache = fallback;
    return runtimeDefaultAiSettingsCache;
  }
  const dbName = window.tlConfig?.DB_NAME || "TrackersLens";
  const storeName = window.tlConfig?.TABLES?.TL_SETTINGS || "tl_settings";
  runtimeDefaultAiSettingsCache = await new Promise((resolve) => {
    const request = indexedDB.open(dbName);
    request.onerror = () => resolve(fallback);
    request.onsuccess = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.close();
        resolve(fallback);
        return;
      }
      const transaction = db.transaction(storeName, "readonly");
      const store = transaction.objectStore(storeName);
      const get = store.get("global");
      get.onsuccess = () => {
        db.close();
        resolve({ ...fallback, ...(get.result?.settings?.ai || {}) });
      };
      get.onerror = () => {
        db.close();
        resolve(fallback);
      };
    };
  });
  return runtimeDefaultAiSettingsCache;
};

const runtimeDefaultAiProviderConfig = async (providers = []) => {
  const settings = await readRuntimeDefaultAiSettings();
  const selected = normalizeRuntimeProviderName(settings.provider);
  const provider = providers.find((item) => {
    const candidates = [item.id, item.name, item.provider, item.providerType].map(normalizeRuntimeProviderName);
    return candidates.some((candidate) => candidate && (candidate === selected || candidate.includes(selected) || selected.includes(candidate)));
  }) || null;
  const providerType = provider?.providerType || provider?.provider || (selected.includes("lmstudio") ? "lm-studio" : selected.includes("ollama") ? "ollama" : selected || "ollama");
  return {
    providerProfile: provider?.id || "",
    providerType,
    model: settings.model || provider?.model || provider?.defaultModel || (providerType === "ollama" ? "llama3.1" : "local-model"),
    temperature: settings.temperature ?? 0.2,
    maxTokens: settings.maxTokens ?? 800,
  };
};

const runtimeAiProvidersForConfig = async () => {
  let providers = [];
  try {
    providers = (await window.TrackerLensAiRuntimeStore?.list?.())?.providers || [];
  } catch (error) {
    console.warn("Provider AI non caricati per default runtime:", error);
  }
  if (!providers.length) providers = window.TrackerLensAiRuntimeStore?.localProviderDefaults?.() || [];
  return providers;
};

const runtimeDefaultAiConfigForDialog = async () => {
  const providers = await runtimeAiProvidersForConfig();
  return {
    providers,
    defaults: await runtimeDefaultAiProviderConfig(providers),
  };
};

const aiAgentConfigBool = (value, fallback = true) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return String(value).toLowerCase() !== "false";
};

const aiAgentFromRuntimeNode = (node = {}, aiDefaults = {}) => {
  const defaults = runtimeNodeConfigDefaults(node);
  const config = defaults.configObject || {};
  const subtype = nodeSubtype(node);
  const knowledgeAgentType =
    subtype === "knowledge-event-builder" ? "classifier" :
      subtype === "semantic-relation-enricher" ? "classifier" :
        subtype === "knowledge-graph-builder-agent" ? "planner" :
          subtype === "knowledge-mechanism-cue-agent" ? "classifier" :
            subtype === "orchestrator" ? "planner" :
              "";
  const agentType = config.agentType || knowledgeAgentType || subtype || "analyzer";
  const split = window.TrackerLensAiAgentEditor?.splitList || ((value) => String(value || "").split(/[\n,]+/).map((item) => item.trim()).filter(Boolean));
  return {
    id: config.runtimeAgentId || `runtime_agent_${node.workspaceId || state.filters.workspaceId || "workspace_global"}_${node.id}`,
    scope: "runtime",
    kind: "runtime",
    workspaceId: node.workspaceId || state.filters.workspaceId || "workspace_global",
    templateId: config.templateId || "",
    name: defaults.label || node.label || "AI Agent",
    description: config.description || "Flow Map AI runtime worker",
    icon: config.icon || graphIcon(node) || "psychology",
    color: config.color || "gold",
    category: config.category || "Runtime Intelligence",
    tags: split(config.tags),
    version: config.version || "1.0.0",
    status: defaults.runtimeStatus || "active",
    runtime: {
      agentType,
      executionMode: config.executionMode || "on_event",
      priority: config.priority ?? 5,
      retryPolicy: config.retryPolicy || "exponential",
      timeoutMs: config.timeoutMs ?? 120000,
      cooldownMs: config.cooldownMs ?? 0,
      queueLimit: config.queueLimit ?? 25,
      parallelJobs: config.parallelJobs ?? 1,
      dropPolicy: config.dropPolicy || "queue",
      triggerPolicy: config.triggerPolicy || "connected_event",
    },
    provider: {
      profileId: config.providerProfile || aiDefaults.providerProfile || "",
      providerType: config.providerType || config.provider || aiDefaults.providerType || "ollama",
      model: config.model || aiDefaults.model || "local-model",
      temperature: config.temperature ?? aiDefaults.temperature ?? 0.2,
      maxTokens: config.maxTokens ?? aiDefaults.maxTokens ?? 800,
      maxContinuationCalls: config.maxContinuationCalls ?? aiDefaults.maxContinuationCalls ?? 10,
      topP: config.topP ?? 0.9,
      streaming: config.streaming === true || config.streaming === "true",
      responseFormat: config.responseFormat || "json",
    },
    channels: {
      inputs: config.inputChannels ? split(config.inputChannels) : [defaults.input].filter(Boolean),
      payloadMapping: config.payloadMapping || "source.value -> observed_value\nevents.recent -> latest_events",
      requiredInputs: split(config.requiredInputs || defaults.input),
      contextSources: split(config.contextSources || "workspace, memory, last-event"),
      eventTriggers: split(config.eventTriggers || defaults.input),
      inputDataMode: config.inputDataMode || "latest",
      inputHistoryLimit: config.inputHistoryLimit ?? 5,
      outputs: [defaults.output].filter(Boolean),
      outputChannel: defaults.output || `ai.${agentType}.output`,
      outputFormat: config.outputFormat || config.responseFormat || "json",
      emitStrategy: config.emitStrategy || "on_success",
      eventPriority: config.eventPriority || "normal",
    },
    promptConfig: {
      systemPrompt: config.systemPrompt || knowledgeAiPromptDefaults(subtype).systemPrompt || "You are a runtime intelligence worker. Analyze events and emit operational output.",
      template: config.promptTemplate || config.prompt || knowledgeAiPromptDefaults(subtype).promptTemplate || "Analyze this runtime event:\n\nChannel: {{channel}}\nPayload: {{payload}}\nMemory: {{memory}}",
      variables: split(config.dynamicVariables || "{{channel}}, {{timestamp}}, {{workspace}}, {{memory}}, {{event}}, {{payload}}"),
      strategy: config.promptStrategy || "contextual",
      outputInstructions: config.outputInstructions || knowledgeAiPromptDefaults(subtype).outputInstructions || "Return structured runtime output ready for channel emission.",
    },
    memory: {
      mode: config.memoryMode || "workspace",
      size: config.memorySize ?? 20,
      expiration: config.memoryExpiration || "24h",
      persistence: config.memoryPersistence || "workspace",
      compression: config.memoryCompression || "summary",
      contextWindow: config.contextWindow ?? 6,
      readMemory: aiAgentConfigBool(config.readMemory, true),
      saveResponses: aiAgentConfigBool(config.saveResponsesToMemory, true),
    },
    permissions: {
      canAccessWeb: config.canAccessWeb === true || config.canAccessWeb === "true",
      canAccessMemory: config.canAccessMemory !== "false",
      canEmitChannels: config.canEmitChannels !== "false",
      canExecuteActions: config.canExecuteActions === true || config.canExecuteActions === "true",
      canSaveStorage: config.canSaveStorage === true || config.canSaveStorage === "true",
      canReadWorkspace: config.canReadWorkspace !== "false",
      canAccessRuntimeLogs: config.canAccessRuntimeLogs !== "false",
    },
    debug: {
      enableLogs: config.enableLogs !== "false",
      savePrompts: config.savePrompts !== "false",
      saveResponses: aiAgentConfigBool(config.saveResponses, true),
      runtimeMetrics: config.runtimeMetrics !== "false",
      debugMode: config.debugMode === true || config.debugMode === "true",
    },
    metrics: {
      executionCount: Number(config.executionCount || 0),
      avgResponseTimeMs: Number(config.avgResponseTimeMs || 0),
      tokenUsage: Number(config.tokenUsage || 0),
      successRate: Number(config.successRate || 0),
      queueSize: Number(config.queueSize || 0),
      activeJobs: Number(config.activeJobs || 0),
      memoryUsage: Number(config.memoryUsage || 0),
    },
  };
};

const aiAgentPayloadConfig = (payload = {}) => ({
  runtimeAgentId: payload.id || "",
  description: payload.description || "",
  icon: payload.icon || "psychology",
  color: payload.color || "gold",
  category: payload.category || "Runtime Intelligence",
  tags: flowAiConfigValue(payload.tags),
  version: payload.version || "1.0.0",
  templateId: payload.templateId || "",
  agentType: payload.runtime?.agentType || "analyzer",
  executionMode: payload.runtime?.executionMode || "on_event",
  priority: payload.runtime?.priority ?? 5,
  retryPolicy: payload.runtime?.retryPolicy || "exponential",
  timeoutMs: payload.runtime?.timeoutMs ?? 120000,
  cooldownMs: payload.runtime?.cooldownMs ?? 0,
  queueLimit: payload.runtime?.queueLimit ?? 25,
  parallelJobs: payload.runtime?.parallelJobs ?? 1,
  maxConcurrentTasks: payload.runtime?.parallelJobs ?? 1,
  dropPolicy: payload.runtime?.dropPolicy || "queue",
  triggerPolicy: payload.runtime?.triggerPolicy || "connected_event",
  providerProfile: payload.provider?.profileId || "",
  providerType: payload.provider?.providerType || "ollama",
  model: payload.provider?.model || "local-model",
  temperature: payload.provider?.temperature ?? 0.2,
  maxTokens: payload.provider?.maxTokens ?? 800,
  maxContinuationCalls: payload.provider?.maxContinuationCalls ?? 10,
  topP: payload.provider?.topP ?? 0.9,
  streaming: String(Boolean(payload.provider?.streaming)),
  responseFormat: payload.provider?.responseFormat || "json",
  inputChannels: flowAiConfigValue(payload.channels?.inputs),
  payloadMapping: payload.channels?.payloadMapping || "",
  requiredInputs: flowAiConfigValue(payload.channels?.requiredInputs),
  contextSources: flowAiConfigValue(payload.channels?.contextSources),
  eventTriggers: flowAiConfigValue(payload.channels?.eventTriggers),
  inputDataMode: payload.channels?.inputDataMode || "latest",
  inputHistoryLimit: payload.channels?.inputHistoryLimit ?? 5,
  outputFormat: payload.channels?.outputFormat || "json",
  emitStrategy: payload.channels?.emitStrategy || "on_success",
  eventPriority: payload.channels?.eventPriority || "normal",
  systemPrompt: payload.promptConfig?.systemPrompt || "",
  promptTemplate: payload.promptConfig?.template || "",
  dynamicVariables: flowAiConfigValue(payload.promptConfig?.variables),
  promptStrategy: payload.promptConfig?.strategy || "contextual",
  outputInstructions: payload.promptConfig?.outputInstructions || "",
  memoryMode: payload.memory?.mode || "workspace",
  memorySize: payload.memory?.size ?? 20,
  memoryExpiration: payload.memory?.expiration || "24h",
  memoryPersistence: payload.memory?.persistence || "workspace",
  memoryCompression: payload.memory?.compression || "summary",
  contextWindow: payload.memory?.contextWindow ?? 6,
  readMemory: payload.memory?.readMemory !== false,
  saveResponsesToMemory: payload.memory?.saveResponses !== false,
  ...Object.fromEntries(Object.entries(payload.permissions || {}).map(([key, value]) => [key, String(Boolean(value))])),
  ...Object.fromEntries(Object.entries(payload.debug || {}).map(([key, value]) => [key, String(Boolean(value))])),
  ...payload.metrics,
});

const knowledgeAiEditorCustomConfigMap = ({ form = null, dialog = null } = {}) => {
  const config = { ...readConfigMap(form) };
  const roots = [
    form?.closest?.(".tl-ai-agent-dialog"),
    dialog?.element,
    dialog?.el,
    document.querySelector(".tl-ai-agent-dialog"),
  ].filter(Boolean);
  roots.forEach((root) => {
    Object.assign(config, readConfigMap(root));
  });
  return config;
};

const persistKnowledgeAiEditorPayload = async ({ node, payload, form, dialog, close }) => {
  const defaults = runtimeNodeConfigDefaults(node);
  const agentConfig = aiAgentPayloadConfig(payload);
  const customConfig = knowledgeAiEditorCustomConfigMap({ form, dialog });
  const input = payload.channels?.inputs?.[0] || defaults.input;
  const output = payload.channels?.outputChannel || payload.channels?.outputs?.[0] || defaults.output;
  const update = runtimeNodeUpdateFromValues({
    node,
    values: {
      label: payload.name || defaults.label,
      input,
      output,
      mode: nodeSubtype(node) || defaults.mode,
      runtimeStatus: payload.status || defaults.runtimeStatus,
      config: {
        ...defaults.configObject,
        ...agentConfig,
        ...customConfig,
      },
    },
  });
  const nextNode = update.node;
  await window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode?.({ node: nextNode });
  await window.TrackerLensChannelRegistry?.upsertChannelsForRuntimeNode?.({ node: nextNode });
  await recordFlowAction({
    workspaceId: nextNode.workspaceId || state.filters.workspaceId || "workspace_global",
    nodeId: nextNode.id,
    message: `Knowledge AI node configured: ${nextNode.label || nextNode.id}`,
    context: {
      action: "knowledge-ai-node-configured",
      subtype: nodeSubtype(nextNode),
      providerProfile: nextNode.metadata?.config?.providerProfile || "",
      model: nextNode.metadata?.config?.model || "",
      channels: update.channels,
    },
  });
  close?.();
  await loadRuntime({ force: true });
};

const findSavedAiAgent = async (agentId = "") => {
  if (!agentId) return null;
  try {
    const data = await window.TrackerLensAiRuntimeStore?.list?.();
    return (data?.agents || []).find((agent) => agent.id === agentId) || null;
  } catch (error) {
    console.warn("Agente AI condiviso non caricato:", error);
  }
  return null;
};

const aiAgentAliasSourceId = (node = {}) =>
  node.metadata?.aliasSourceAgentId || node.metadata?.config?.aliasSourceAgentId || "";

const resolveAiAgentEditorRecord = async (node = {}) => {
  const { defaults: aiDefaults } = await runtimeDefaultAiConfigForDialog();
  if (!node.metadata?.aiAgentAlias) return { ...aiAgentFromRuntimeNode(node, aiDefaults), nodeId: node.id, runtimeNodeId: node.id };
  const source = await findSavedAiAgent(aiAgentAliasSourceId(node));
  if (!source) return { ...aiAgentFromRuntimeNode(node, aiDefaults), nodeId: node.id, runtimeNodeId: node.id };
  return {
    ...mergeAiAgentAliasOverrides(source, aiAgentAliasOverrides(node)),
    nodeId: node.id,
    runtimeNodeId: node.id,
    workspaceId: source.workspaceId || node.workspaceId || state.filters.workspaceId || "workspace_global",
  };
};

const aiAliasFlattenPaths = (value = {}, prefix = "") => {
  if (!isAiAliasPlainObject(value)) return prefix ? [prefix] : [];
  const paths = [];
  Object.entries(value).forEach(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isAiAliasPlainObject(child)) paths.push(...aiAliasFlattenPaths(child, path));
    else paths.push(path);
  });
  return paths;
};

const aiAliasValueAtPath = (value = {}, path = "") =>
  String(path || "").split(".").filter(Boolean).reduce((current, key) => current?.[key], value);

const aiAliasDisplayValue = (value) => {
  if (value === undefined) return "inherited";
  if (value === null) return "null";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "[]";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const aiAliasPolicyRows = (record = {}, nodeConfig = {}) => {
  const runtime = record.runtime || {};
  const memory = record.memory || {};
  const freshRun = nodeConfig.freshRun === true || nodeConfig.freshRun === "true";
  const readMemory = nodeConfig.readMemory === false || nodeConfig.readMemory === "false"
    ? false
    : memory.readMemory !== false;
  const saveResponses = nodeConfig.saveResponsesToMemory === false || nodeConfig.saveResponsesToMemory === "false"
    ? false
    : memory.saveResponses !== false;
  return [
    ["Trigger", nodeConfig.triggerPolicy || runtime.triggerPolicy || "connected_event"],
    ["Fresh", freshRun ? "on" : "off"],
    ["Read memory", readMemory ? "on" : "off"],
    ["Save responses", saveResponses ? "on" : "off"],
    ["Persistence", nodeConfig.memoryPersistence || memory.persistence || "workspace"],
    ["Input history", nodeConfig.inputDataMode || record.channels?.inputDataMode || "latest"],
  ];
};

const renderAiAliasInfoCard = (title = "", rows = []) =>
  _.div(
    { class: "tl-ai-agent-alias-diagnostics-card" },
    _.h4(title),
    ...rows.map(([label, value]) => _.div(
      { class: "tl-ai-agent-alias-diagnostics-row" },
      _.span(label),
      _.strong(aiAliasDisplayValue(value))
    ))
  );

const openAiAgentAliasDiagnostics = async (node = {}) => {
  if (!node?.id || !node.metadata?.aiAgentAlias) return;
  const sourceId = aiAgentAliasSourceId(node);
  const source = await findSavedAiAgent(sourceId);
  const localOverrides = aiAgentAliasOverrides(node);
  const { defaults: aiDefaults } = source ? { defaults: {} } : await runtimeDefaultAiConfigForDialog();
  const localRecord = aiAgentFromRuntimeNode(node, aiDefaults);
  const resolved = source ? mergeAiAgentAliasOverrides(source, localOverrides) : localRecord;
  const config = nodeRuntimeConfig(node);
  const overridePaths = aiAliasFlattenPaths(localOverrides);
  const dialog = _.Dialog({
    class: "tl-ai-agent-alias-diagnostics-dialog",
    panelClass: "tl-ai-agent-alias-diagnostics-panel",
    size: "lg",
    title: "Alias Diagnostics",
    subtitle: node.label || node.id,
    icon: "account_tree",
    closeButton: true,
    scrollable: true,
    bodyMaxHeight: "72vh",
    content: () => _.div(
      { class: "tl-ai-agent-alias-diagnostics" },
      _.div(
        { class: "tl-ai-agent-alias-diagnostics-grid" },
        renderAiAliasInfoCard("Source Agent", [
          ["ID", sourceId || "missing"],
          ["Name", source?.name || "not found"],
          ["Scope", source?.scope || node.metadata?.aliasSourceScope || ""],
          ["Version", source?.version || ""],
        ]),
        renderAiAliasInfoCard("Alias Node", [
          ["Node ID", node.id],
          ["Name", node.label],
          ["Workspace", node.workspaceId || state.filters.workspaceId || ""],
          ["Override count", overridePaths.length],
        ]),
        renderAiAliasInfoCard("Resolved Policy", aiAliasPolicyRows(resolved, config))
      ),
      _.div(
        { class: "tl-ai-agent-alias-diagnostics-card is-wide" },
        _.h4("Local Overrides"),
        overridePaths.length
          ? _.div(
            { class: "tl-ai-agent-alias-overrides-list" },
            ...overridePaths.map((path) => _.div(
              { class: "tl-ai-agent-alias-diagnostics-row" },
              _.span(path),
              _.strong(aiAliasDisplayValue(aiAliasValueAtPath(localOverrides, path)))
            ))
          )
          : _.p("No local overrides. This alias currently inherits all fields from the source agent."),
        _.details(
          { class: "tl-ai-agent-alias-raw" },
          _.summary("Raw override JSON"),
          _.pre(JSON.stringify(localOverrides, null, 2))
        )
      )
    ),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: () => copyRuntimeValue({ sourceId, nodeId: node.id, overrides: localOverrides, resolved }) }, icon("content_copy", "sm"), "Copy"),
      btn({ onclick: close }, "Close")
    ),
  });
  dialog.open();
};

const persistAiAgentEditorPayload = async ({ node, payload, form, close }) => {
  const customConfig = readConfigMap(form);
  if (node.metadata?.aiAgentAlias) {
    const aliasId = aiAgentAliasSourceId(node) || payload.id;
    const source = await findSavedAiAgent(aliasId);
    const aliasOverrides = source ? aiAliasOverridesFromPayload(payload, source) : aiAliasPickOverrideFields(payload);
    const resolvedPayload = source ? mergeAiAgentAliasOverrides(source, aliasOverrides) : payload;
    const { agentType, inputChannels, outputChannel } = aiAgentChannelsForRecord(resolvedPayload);
    const permissionFlags = normalizeAiAgentPermissionFlags(resolvedPayload.permissions);
    const permissions = normalizeAssetPermissions(permissionFlags);
    await window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode?.({
      node: {
        ...node,
        label: resolvedPayload.name || node.label,
        status: resolvedPayload.status || node.status || "active",
        inputs: inputChannels.slice(0, 1),
        outputs: [outputChannel].filter(Boolean),
        channels: [...new Set([...inputChannels.slice(0, 1), outputChannel].filter(Boolean))],
        runtime: {
          ...(node.runtime || {}),
          status: resolvedPayload.status || node.status || "active",
          active: resolvedPayload.status !== "paused" && resolvedPayload.status !== "disabled",
        },
        metadata: {
          ...(node.metadata || {}),
          configured: true,
          aiAgentAlias: true,
          aliasOverrides,
          aliasSourceAgentId: aliasId,
          aliasSourceScope: source?.scope || node.metadata?.aliasSourceScope || "template",
          icon: resolvedPayload.icon || node.metadata?.icon || "psychology",
          subtype: agentType,
          agentRole: agentType,
          templateId: source?.scope === "runtime" ? source.templateId || aliasId : aliasId,
          runtimeStatus: resolvedPayload.status || node.metadata?.runtimeStatus || "active",
          config: {
            ...(node.metadata?.config || {}),
            ...aiAgentPayloadConfig(resolvedPayload),
            ...customConfig,
            aliasSourceAgentId: aliasId,
            aliasSourceScope: source?.scope || node.metadata?.aliasSourceScope || "template",
            aliasOverrides,
            templateId: source?.scope === "runtime" ? source.templateId || aliasId : aliasId,
            linked: "alias",
          },
          manifest: nodeManifest({
            type: "aiAgent",
            subtype: agentType,
            category: "ai-agents",
            inputs: inputChannels.slice(0, 1),
            outputs: [outputChannel].filter(Boolean),
            permissions,
            runtime: resolvedPayload.runtime || {},
          }),
          permissions,
          runtimeMetadata: resolvedPayload.runtime || {},
        },
        updatedAt: new Date().toISOString(),
      },
    });
    await recordFlowAction({
      workspaceId: node.workspaceId || "global",
      nodeId: node.id,
      message: `AI agent alias overrides saved: ${resolvedPayload.name || aliasId}`,
      context: { action: "ai-agent-alias-overrides-saved", agentId: aliasId, overrideKeys: Object.keys(aliasOverrides) },
    });
    close?.();
    await loadRuntime({ force: true });
    return;
  }
  const outputChannel = payload.channels?.outputChannel || payload.channels?.outputs?.[0] || `ai.${payload.runtime?.agentType || "agent"}.output`;
  const inputChannel = payload.channels?.inputs?.[0] || "task";
  const update = runtimeNodeUpdateFromValues({
    node,
    values: {
      label: payload.name || node.label,
      input: inputChannel,
      output: outputChannel,
      mode: payload.runtime?.agentType || nodeSubtype(node),
      runtimeStatus: payload.status || "active",
      config: { ...nodeConfigObject(node), ...aiAgentPayloadConfig(payload), ...customConfig },
    },
  });
  await window.TrackerLensAiRuntimeStore?.upsertRuntimeAgent?.({
    ...payload,
    id: payload.id || `runtime_agent_${payload.workspaceId || node.workspaceId || "workspace_global"}_${node.id}`,
    runtimeNodeId: node.id,
    scope: "runtime",
    kind: "runtime",
    workspaceId: payload.workspaceId || node.workspaceId || state.filters.workspaceId || "workspace_global",
  });
  await window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode?.({ node: update.node });
  if (window.TrackerLensChannelRegistry?.upsertChannelsForRuntimeNode) {
    await window.TrackerLensChannelRegistry.upsertChannelsForRuntimeNode({ node: update.node });
  }
  await recordFlowAction({
    workspaceId: update.node.workspaceId || "global",
    nodeId: update.node.id,
    message: `AI runtime agent configured: ${update.node.label || update.node.id}`,
    context: { action: "ai-agent-editor-configured", nodeType: "aiAgent", channels: update.channels },
  });
  setFocusState({
    mode: "dependencies",
    nodeId: update.node.id,
    edgeId: "",
    nodeType: update.node.type,
    channel: update.channels[0] || "",
    connectionId: "",
  });
  close?.();
  await loadRuntime();
};

const persistOrchestratorAiEditorPayload = async ({ node, payload, form, close }) => {
  const previousMetadata = node.metadata || {};
  const baseConfig = {
    ...nodeConfigObject(node),
    ...aiAgentPayloadConfig(payload),
    ...readConfigMap(form),
  };
  const boolString = (value, fallback = false) => String(value === true || value === "true" || value === "on" || (!value && fallback));
  const input = payload.channels?.inputs?.[0] || baseConfig.taskInput || "task";
  const outputs = [
    baseConfig.outputDecision || "decision",
    baseConfig.outputAction || "action",
    baseConfig.outputDone || "done",
    baseConfig.outputError || "error",
  ].filter(Boolean);
  const runtimeStatus = payload.status || previousMetadata.runtimeStatus || node.runtime?.status || node.status || "active";
  const normalizedConfig = {
    ...baseConfig,
    goal: baseConfig.goal || "Decide which connected nodes should run for each incoming payload.",
    taskInput: input,
    executionMode: payload.runtime?.executionMode || baseConfig.executionMode || "on_event",
    autonomousMode: boolString(baseConfig.autonomousMode, false),
    requireConfirmation: boolString(baseConfig.requireConfirmation, false),
    verboseTrace: boolString(baseConfig.verboseTrace, true),
    savePrompts: boolString(baseConfig.savePrompts, true),
    saveDecisions: boolString(baseConfig.saveDecisions, true),
    debugMode: boolString(baseConfig.debugMode, false),
    maxIterations: String(baseConfig.maxIterations || "5"),
    iterationDelayMs: String(baseConfig.iterationDelayMs || "1200"),
    stopCondition: baseConfig.stopCondition || "completed",
    feedbackWindow: String(baseConfig.feedbackWindow || "12"),
    allowedNodeTypes: baseConfig.allowedNodeTypes || "processors, ai-agents, actions, storage, lens, dev",
    dispatchStrategy: baseConfig.dispatchStrategy || "linked_order",
    plannerStrategy: baseConfig.plannerStrategy || "ai-first",
    routePolicy: baseConfig.routePolicy || "direct-linked-only",
    maxSteps: String(baseConfig.maxSteps || "6"),
    maxConcurrentTasks: String(baseConfig.maxConcurrentTasks || baseConfig.parallelJobs || "1"),
    queueLimit: String(baseConfig.queueLimit || "10"),
    timeoutMs: String(baseConfig.timeoutMs || "30000"),
    dropPolicy: baseConfig.dropPolicy || "queue",
    outputDecision: outputs[0] || "decision",
    outputAction: outputs[1] || "action",
    outputDone: outputs[2] || "done",
    outputError: outputs[3] || "error",
  };
  const manifest = nodeManifest({
    type: "aiAgent",
    subtype: "orchestrator",
    category: "ai-agents",
    inputs: [input],
    outputs,
    permissions: ["ai.invoke", "graph.dispatch", "channel.emit"],
    settingsSchema: {
      goal: "string",
      systemPrompt: "string",
      providerProfile: "string",
      providerType: "string",
      model: "string",
      executionMode: "manual|on_event|continuous|autonomous",
      autonomousMode: "boolean",
      maxIterations: "number",
      iterationDelayMs: "number",
      stopCondition: "string",
      feedbackWindow: "number",
      allowedNodeTypes: "array",
      dispatchStrategy: "linked_order|priority|first_success|all",
      plannerStrategy: "ai-first|graph-first|goal-first|feedback-first|legacy",
      routePolicy: "direct-linked-only|agent-control|all-linked",
      maxSteps: "number",
      maxConcurrentTasks: "number",
      queueLimit: "number",
      timeoutMs: "number",
      dropPolicy: "queue|reject|latest",
      outputDecision: "string",
      outputAction: "string",
      outputDone: "string",
      outputError: "string",
      requireConfirmation: "boolean",
      verboseTrace: "boolean",
      savePrompts: "boolean",
      saveDecisions: "boolean",
      debugMode: "boolean",
    },
    runtime: {
      executionMode: normalizedConfig.executionMode,
      orchestrator: true,
      autonomous: normalizedConfig.autonomousMode === "true",
    },
  });
  const nextNode = {
    ...node,
    label: payload.name || node.label || "Orchestrator Agent",
    inputs: [input],
    outputs,
    channels: [...new Set([input, ...outputs])],
    status: runtimeStatus,
    runtime: {
      ...(node.runtime || {}),
      status: runtimeStatus,
      active: !["paused", "disabled"].includes(runtimeStatus),
    },
    metadata: {
      ...previousMetadata,
      draft: false,
      configured: true,
      mode: "Orchestrator",
      config: normalizedConfig,
      runtimeStatus,
      subtype: "orchestrator",
      category: "ai-agents",
      manifest,
      permissions: manifest.permissions,
      settingsSchema: manifest.settingsSchema,
      runtimeMetadata: manifest.runtime,
      agentRole: "orchestrator",
      description: payload.description || "Central runtime brain that decides and dispatches connected nodes.",
    },
    updatedAt: new Date().toISOString(),
  };
  await window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode?.({ node: nextNode });
  await window.TrackerLensChannelRegistry?.upsertChannelsForRuntimeNode?.({ node: nextNode });
  await recordFlowAction({
    workspaceId: node.workspaceId || state.filters.workspaceId || "workspace_global",
    nodeId: node.id,
    message: `Orchestrator Agent configured: ${nextNode.label || node.id}`,
    context: { action: "orchestrator-config", config: normalizedConfig },
  });
  close?.();
  await loadRuntime({ force: true });
};

const detachAiAgentAliasNode = async ({ node, close = null } = {}) => {
  if (!node?.id || !node.metadata?.aiAgentAlias) return;
  const source = await findSavedAiAgent(aiAgentAliasSourceId(node));
  const { defaults: aiDefaults } = source ? { defaults: {} } : await runtimeDefaultAiConfigForDialog();
  const payload = source
    ? mergeAiAgentAliasOverrides(source, aiAgentAliasOverrides(node))
    : aiAgentFromRuntimeNode(node, aiDefaults);
  const workspaceId = node.workspaceId || state.filters.workspaceId || "workspace_global";
  const runtimeAgentId = `runtime_agent_${safeRuntimeId(workspaceId)}_${safeRuntimeId(payload.id || node.id)}_${Date.now()}`;
  const copyPayload = {
    ...(payload.raw && typeof payload.raw === "object" ? payload.raw : {}),
    ...payload,
    id: runtimeAgentId,
    scope: "runtime",
    kind: "runtime",
    workspaceId,
    templateId: payload.scope === "runtime" ? payload.templateId || payload.id : payload.id,
    runtimeNodeId: node.id,
  };
  const { agentType, inputChannels, outputChannel } = aiAgentChannelsForRecord(copyPayload);
  const permissionFlags = normalizeAiAgentPermissionFlags(copyPayload.permissions);
  const permissions = normalizeAssetPermissions(permissionFlags);
  const nextNode = {
    ...node,
    label: copyPayload.name || node.label,
    status: copyPayload.status || node.status || "active",
    inputs: inputChannels.slice(0, 1),
    outputs: [outputChannel].filter(Boolean),
    channels: [...new Set([...inputChannels.slice(0, 1), outputChannel].filter(Boolean))],
    metadata: {
      ...(node.metadata || {}),
      aiAgentAlias: false,
      detachedFromAgentId: aiAgentAliasSourceId(node),
      aliasSourceAgentId: "",
      aliasSourceScope: "",
      paletteLabel: "Existing Agent Copy",
      runtimeAgentId,
      templateId: copyPayload.templateId || "",
      subtype: agentType,
      agentRole: agentType,
      config: {
        ...aiAgentPayloadConfig(copyPayload),
        runtimeAgentId,
        templateId: copyPayload.templateId || "",
      },
      manifest: nodeManifest({
        type: "aiAgent",
        subtype: agentType,
        category: "ai-agents",
        inputs: inputChannels.slice(0, 1),
        outputs: [outputChannel].filter(Boolean),
        permissions,
        runtime: copyPayload.runtime || {},
      }),
      permissions,
      runtimeMetadata: copyPayload.runtime || {},
    },
    updatedAt: new Date().toISOString(),
  };
  await window.TrackerLensAiRuntimeStore?.upsertRuntimeAgent?.({
    ...copyPayload,
    permissions: permissionFlags,
  });
  await window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode?.({ node: nextNode });
  if (window.TrackerLensChannelRegistry?.upsertChannelsForRuntimeNode) {
    await window.TrackerLensChannelRegistry.upsertChannelsForRuntimeNode({ node: nextNode });
  }
  await recordFlowAction({
    workspaceId,
    nodeId: node.id,
    message: `AI agent alias converted to copy: ${nextNode.label || node.id}`,
    context: { action: "ai-agent-alias-detached", sourceAgentId: aiAgentAliasSourceId(node), runtimeAgentId },
  });
  close?.();
  await loadRuntime({ force: true });
};

const resetAiAgentAliasNode = async ({ node, close = null } = {}) => {
  if (!node?.id || !node.metadata?.aiAgentAlias) return;
  const aliasId = aiAgentAliasSourceId(node);
  const source = await findSavedAiAgent(aliasId);
  if (!source) {
    window.alert("L'agente originale collegato a questo alias non è più disponibile.");
    return;
  }
  const { agentType, inputChannels, outputChannel } = aiAgentChannelsForRecord(source);
  const permissionFlags = normalizeAiAgentPermissionFlags(source.permissions);
  const permissions = normalizeAssetPermissions(permissionFlags);
  const nextNode = {
    ...node,
    label: source.name || node.label,
    status: source.status || node.status || "active",
    inputs: inputChannels.slice(0, 1),
    outputs: [outputChannel].filter(Boolean),
    channels: [...new Set([...inputChannels.slice(0, 1), outputChannel].filter(Boolean))],
    runtime: {
      ...(node.runtime || {}),
      status: source.status || node.status || "active",
      active: source.status !== "paused" && source.status !== "disabled",
    },
    metadata: {
      ...(node.metadata || {}),
      configured: true,
      aiAgentAlias: true,
      aliasOverrides: {},
      aliasSourceAgentId: aliasId,
      aliasSourceScope: source.scope || node.metadata?.aliasSourceScope || "template",
      icon: source.icon || node.metadata?.icon || "psychology",
      subtype: agentType,
      agentRole: agentType,
      templateId: source.scope === "runtime" ? source.templateId || aliasId : aliasId,
      runtimeStatus: source.status || node.metadata?.runtimeStatus || "active",
      config: {
        ...aiAgentPayloadConfig(source),
        aliasSourceAgentId: aliasId,
        aliasSourceScope: source.scope || node.metadata?.aliasSourceScope || "template",
        aliasOverrides: {},
        templateId: source.scope === "runtime" ? source.templateId || aliasId : aliasId,
        linked: "alias",
      },
      manifest: nodeManifest({
        type: "aiAgent",
        subtype: agentType,
        category: "ai-agents",
        inputs: inputChannels.slice(0, 1),
        outputs: [outputChannel].filter(Boolean),
        permissions,
        runtime: source.runtime || {},
      }),
      permissions,
      runtimeMetadata: source.runtime || {},
    },
    updatedAt: new Date().toISOString(),
  };
  await window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode?.({ node: nextNode });
  if (window.TrackerLensChannelRegistry?.upsertChannelsForRuntimeNode) {
    await window.TrackerLensChannelRegistry.upsertChannelsForRuntimeNode({ node: nextNode });
  }
  await recordFlowAction({
    workspaceId: nextNode.workspaceId || state.filters.workspaceId || "workspace_global",
    nodeId: nextNode.id,
    message: `AI agent alias reset to source: ${nextNode.label || aliasId}`,
    context: { action: "ai-agent-alias-reset", sourceAgentId: aliasId },
  });
  close?.();
  await loadRuntime({ force: true });
};

const requestAiAgentRuntimeConfig = async (node) => {
  if (!node?.id || !window.TrackerLensAiAgentEditor?.open) return;
  const { providers } = await runtimeDefaultAiConfigForDialog();
  const subtype = nodeSubtype(node);
  const config = nodeConfigObject(node);
  const configInput = (label, key, fallback = "", extra = {}) => _.label(
    { class: "tl-flow-config-field" },
    _.span(label),
    _.input({
      "data-config-key": key,
      value: config[key] ?? fallback,
      autocomplete: "off",
      type: extra.type || "text",
      placeholder: extra.placeholder || "",
      ...(extra.step ? { step: extra.step } : {}),
    })
  );
  const configTextarea = (label, key, fallback = "", rows = 4) => _.label(
    { class: "tl-flow-config-field is-wide" },
    _.span(label),
    _.textarea({
      "data-config-key": key,
      rows,
      value: config[key] ?? fallback,
    })
  );
  const configSelect = (label, key, fallback = "", options = []) => {
    const value = String(config[key] ?? fallback);
    return _.label(
      { class: "tl-flow-config-field" },
      _.span(label),
      _.select(
        { "data-config-key": key, value },
        ...options.map((option) => _.option({ value: option, selected: option === value }, option))
      )
    );
  };
  const orchestratorTabs = subtype === "orchestrator" ? [
    {
      name: "orchestrator",
      label: "Orchestrator",
      icon: "hub",
      content: _.div(
        { class: "tl-ai-agent-tab-grid is-wide" },
        configTextarea("Goal", "goal", "Decide which connected nodes should run for each incoming payload.", 5),
        configSelect("Planner strategy", "plannerStrategy", "ai-first", ["ai-first", "graph-first", "goal-first", "feedback-first", "legacy"]),
        configSelect("Dispatch strategy", "dispatchStrategy", "linked_order", ["linked_order", "priority", "first_success", "all"]),
        configSelect("Route policy", "routePolicy", "direct-linked-only", ["direct-linked-only", "agent-control", "all-linked"]),
        configInput("Allowed node types", "allowedNodeTypes", "processors, ai-agents, actions, storage, lens, dev"),
        configInput("Max steps per iteration", "maxSteps", "6", { type: "number" }),
        configSelect("Autonomous mode", "autonomousMode", "false", ["false", "true"]),
        configInput("Max iterations", "maxIterations", "5", { type: "number" }),
        configInput("Delay between iterations (ms)", "iterationDelayMs", "1200", { type: "number" }),
        configInput("Stop condition", "stopCondition", "completed"),
        configInput("Feedback events", "feedbackWindow", "12", { type: "number" }),
        configSelect("Require confirmation", "requireConfirmation", "false", ["false", "true"]),
        configInput("Decision output", "outputDecision", "decision"),
        configInput("Action output", "outputAction", "action"),
        configInput("Done output", "outputDone", "done"),
        configInput("Error output", "outputError", "error")
      ),
    },
  ] : [];
  window.TrackerLensAiAgentEditor.open({
    agent: await resolveAiAgentEditorRecord(node),
    providers,
    title: "AI Runtime Agent Editor",
    subtitle: node.metadata?.aiAgentAlias
      ? `${node.label || node.id} · Shared alias`
      : `${node.label || node.id} · Flow Map runtime node`,
    footerActions: node.metadata?.aiAgentAlias
      ? ({ close }) => _.div(
        { class: "tl-ai-agent-alias-footer-actions" },
        btn({
          onclick: () => resetAiAgentAliasNode({ node, close }),
        }, icon("restart_alt", "sm"), "Reset"),
        btn({
          onclick: () => detachAiAgentAliasNode({ node, close }),
        }, icon("link_off", "sm"), "Make Copy")
      )
      : null,
    customTabs: orchestratorTabs,
    onSave: ({ payload, form, close }) => subtype === "orchestrator"
      ? persistOrchestratorAiEditorPayload({ node, payload, form, close })
      : persistAiAgentEditorPayload({ node, payload, form, close }),
  });
};

const customRuntimeNodeUpdate = ({ node, label, runtimeStatus, config }) => {
  const previousMetadata = node.metadata || {};
  const layout = customNodeFormLayout(node);
  const fields = collectNodeBuilderDataFields(layout);
  const settingsSchema = nodeBuilderSettingsSchemaFromLayout(layout);
  const inputs = normalizeNodeBuilderPorts(node.inputs || previousMetadata.manifest?.inputs || ["input"], "in");
  const outputs = normalizeNodeBuilderPorts(node.outputs || previousMetadata.manifest?.outputs || ["output"], "out");
  const manifest = nodeManifest({
    type: "custom",
    subtype: nodeSubtype(node) || "custom",
    category: nodeCategory(node) || "custom",
    inputs,
    outputs,
    permissions: previousMetadata.permissions || previousMetadata.manifest?.permissions || node.permissions || [],
    settingsSchema,
    runtime: previousMetadata.runtimeMetadata || previousMetadata.manifest?.runtime || node.runtime || {},
    render: previousMetadata.manifest?.render || null,
    execute: previousMetadata.execute || previousMetadata.manifest?.execute || null,
    persist: previousMetadata.manifest?.persist || null,
  });
  return {
    ...node,
    label: label || node.label || "Custom Node",
    status: runtimeStatus || node.status || "idle",
    inputs: inputs.map((port) => port.name || "input"),
    outputs: outputs.map((port) => port.name || "output"),
    channels: [...new Set([...inputs, ...outputs].map((port) => port.name).filter(Boolean))],
    runtime: {
      ...(node.runtime || {}),
      status: runtimeStatus || node.runtime?.status || node.status || "idle",
      active: !["paused", "disabled"].includes(runtimeStatus || node.runtime?.status || node.status || "idle"),
    },
    metadata: {
      ...previousMetadata,
      draft: false,
      configured: true,
      customNode: true,
      config,
      runtimeConfig: previousMetadata.runtimeConfig || {},
      execute: previousMetadata.execute || manifest.execute || null,
      runtimeStatus: runtimeStatus || previousMetadata.runtimeStatus || node.runtime?.status || node.status || "idle",
      formLayout: layout,
      formSchema: {
        ...(previousMetadata.formSchema || {}),
        fields,
        layout,
      },
      settingsSchema,
      manifest: {
        ...manifest,
        formLayout: layout,
      },
      permissions: manifest.permissions,
      runtimeMetadata: manifest.runtime,
    },
    updatedAt: new Date().toISOString(),
  };
};

const persistCustomRuntimeNodeConfig = async ({ node, draft = {}, close }) => {
  const nextNode = customRuntimeNodeUpdate({
    node,
    label: draft.label || node.label,
    runtimeStatus: draft.runtimeStatus || node.metadata?.runtimeStatus || node.runtime?.status || node.status || "idle",
    config: draft.config || {},
  });
  try {
    await window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode?.({ node: nextNode });
    if (window.TrackerLensChannelRegistry?.upsertChannelsForRuntimeNode) {
      await window.TrackerLensChannelRegistry.upsertChannelsForRuntimeNode({ node: nextNode });
    }
    await recordFlowAction({
      workspaceId: nextNode.workspaceId || "global",
      nodeId: nextNode.id,
      message: `Custom runtime node configured: ${nextNode.label || nextNode.id}`,
      context: {
        action: "custom-runtime-node-configured",
        nodeType: nextNode.type || "custom",
        fields: customNodeDataFields(nextNode).map((field) => field.key),
      },
    });
    setFocusState({
      mode: "dependencies",
      nodeId: nextNode.id,
      edgeId: "",
      nodeType: nextNode.type,
      channel: nextNode.channels?.[0] || "",
      connectionId: "",
    });
    close?.();
    await loadRuntime({ force: true });
  } catch (error) {
    console.error("Errore configurazione custom runtime node:", error);
    state.error = error?.message || "Errore configurazione custom runtime node";
    mount();
  }
};

const renderCustomConfigComponent = (layoutNode = {}, draft = {}) => {
  const settings = nodeBuilderComponentSettings(layoutNode);
  const label = layoutNode.label || layoutNode.key || layoutNode.type || "Field";
  if (NODE_BUILDER_CONTAINER_TYPES.has(layoutNode.type)) {
    return _.div(
      { class: `tl-flow-node-builder-preview-form-node tl-flow-custom-config-container is-${layoutNode.type}` },
      _.div(
        { class: "tl-flow-node-builder-preview-form-head" },
        icon(nodeBuilderComponentIcon(layoutNode.type), "sm"),
        _.strong(label),
        _.em(layoutNode.type)
      ),
      _.div(
        { class: "tl-flow-node-builder-preview-form-children" },
        ...(layoutNode.children || []).map((child) => renderCustomConfigComponent(child, draft))
      )
    );
  }
  if (layoutNode.type === "badge" || layoutNode.type === "chip") {
    return _.span({ class: `tl-flow-node-builder-live-token is-${layoutNode.type}` }, icon(nodeBuilderComponentIcon(layoutNode.type), "sm"), label);
  }
  const key = layoutNode.key || layoutNode.id;
  const readCmsValue = (value) => value?.target?.value ?? value;
  const readCmsChecked = (nextValue) => nextValue?.target?.checked ?? nextValue;
  const readCmsDateValue = (nextValue) => {
    const raw = readCmsValue(nextValue);
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.toISOString().slice(0, 10);
    return String(raw || "");
  };
  const value = customConfigValue(draft.config, { ...layoutNode, key });
  if (layoutNode.type === "select") {
    const options = nodeBuilderFieldOptions(layoutNode);
    return _.Select({
      size: "sm",
      label,
      value: String(value || settings.defaultValue || options[0]?.value || ""),
      options,
      slots: { arrow: () => icon("keyboard_arrow_down", "sm") },
      onChange: (nextValue) => {
        draft.config[key] = String(readCmsValue(nextValue) || "");
      },
    });
  }
  if (layoutNode.type === "checkbox") {
    return _.div(
      { class: "tl-flow-config-check-row" },
      _.span(label),
      _.Checkbox({
        class: "tl-flow-config-check-control",
        size: "sm",
        checked: Boolean(value),
        title: label,
        color: settings.color || "success",
        outline: true,
        ...(settings.icon ? { checkedIcon: settings.icon } : {}),
        onChange: (checked) => {
          draft.config[key] = Boolean(readCmsChecked(checked));
        },
      })
    );
  }
  if (layoutNode.type === "radio") {
    return _.div(
      { class: "tl-flow-config-check-row" },
      _.span(label),
      _.Radio({
        class: "tl-flow-config-check-control",
        size: "sm",
        checked: Boolean(value),
        title: label,
        color: settings.color || "success",
        outline: true,
        ...(settings.icon ? { checkedIcon: settings.icon } : {}),
        onChange: () => {
          draft.config[key] = settings.defaultValue || nodeBuilderFieldOptions(layoutNode)[0]?.value || "option-1";
        },
      })
    );
  }
  if (layoutNode.type === "toggle" || layoutNode.type === "boolean") {
    return _.div(
      { class: "tl-flow-config-toggle-row" },
      _.span(label),
      _.Toggle({
        size: "sm",
        checked: Boolean(value),
        color: settings.color || "success",
        ...(settings.icon ? { iconOn: settings.icon, checkedIcon: settings.icon } : {}),
        onChange: (checked) => {
          draft.config[key] = Boolean(readCmsChecked(checked));
        },
      })
    );
  }
  if (layoutNode.type === "rating") {
    return _.div(
      { class: "tl-flow-config-slider-row" },
      _.span(label),
      _.Rating ? _.Rating({
        size: "sm",
        value: Number(value) || 0,
        max: Number(settings.max) || 5,
        colorSelected: settings.color || "primary",
        onChange: (nextValue) => {
          draft.config[key] = Number(readCmsValue(nextValue)) || 0;
        },
      }) : _.Input({
        size: "sm",
        label,
        value: String(value || "0"),
        onInput: (event) => {
          draft.config[key] = Number(readCmsValue(event)) || 0;
        },
      })
    );
  }
  if (layoutNode.type === "date") {
    return _.Date ? _.Date({
      size: "sm",
      label,
      value: String(value || ""),
      ...(settings.icon ? { icon: settings.icon } : {}),
      onChange: (nextValue) => {
        draft.config[key] = readCmsDateValue(nextValue);
      },
    }) : _.Input({
      size: "sm",
      label,
      value: String(value || ""),
      onInput: (event) => {
        draft.config[key] = String(readCmsValue(event) || "");
      },
    });
  }
  if (layoutNode.type === "time") {
    return _.Time ? _.Time({
      size: "sm",
      label,
      value: String(value || ""),
      ...(settings.icon ? { icon: settings.icon } : {}),
      onChange: (nextValue) => {
        draft.config[key] = String(readCmsValue(nextValue) || "");
      },
    }) : _.Input({
      size: "sm",
      label,
      value: String(value || ""),
      onInput: (event) => {
        draft.config[key] = String(readCmsValue(event) || "");
      },
    });
  }
  if (layoutNode.type === "slider") {
    return _.div(
      { class: "tl-flow-config-slider-row" },
      _.span(label),
      _.Slider ? _.Slider({
        size: "sm",
        showValue: true,
        value: Number(value) || 0,
        min: Number(settings.min) || 0,
        max: Number(settings.max) || 100,
        step: Number(settings.step) || 1,
        color: settings.color || "primary",
        onChange: (nextValue) => {
          draft.config[key] = Number(readCmsValue(nextValue)) || 0;
        },
      }) : _.Input({
        size: "sm",
        label,
        value: String(value || "0"),
        onInput: (event) => {
          draft.config[key] = Number(readCmsValue(event)) || 0;
        },
      })
    );
  }
  return _.Input({
    size: "sm",
    label,
    value: String(value || ""),
    autocomplete: "off",
    onInput: (event) => {
      draft.config[key] = String(readCmsValue(event) || "");
    },
  });
};

const requestCustomRuntimeNodeConfig = (node) => {
  if (!node?.id) return;
  const layout = customNodeFormLayout(node);
  const readCmsValue = (value) => value?.target?.value ?? value;
  const draft = {
    label: node.label || "Custom Node",
    runtimeStatus: node.metadata?.runtimeStatus || node.runtime?.status || node.status || "idle",
    config: { ...nodeConfigObject(node) },
  };
  const dialog = _.Dialog({
    class: "tl-flow-config-dialog",
    panelClass: "tl-flow-config-panel",
    size: "md",
    title: "Custom Node Settings",
    subtitle: `${nodeSubtype(node)} · ${node.label || node.id}`,
    icon: graphIcon(node),
    closeButton: true,
    content: () => _.div(
      { class: "tl-flow-config-form tl-flow-custom-config-form" },
      _.p("Modifica i valori del nodo custom usando il layout creato nel Node Builder."),
      _.div(
        { class: "tl-flow-config-grid" },
        _.Input({
          size: "sm",
          label: "Node title",
          value: draft.label,
          autocomplete: "off",
          onInput: (event) => {
            draft.label = String(readCmsValue(event) || "");
          },
        }),
        _.Select({
          size: "sm",
          label: "Runtime state",
          value: draft.runtimeStatus,
          options: ["idle", "active", "running", "warning", "paused", "error", "disconnected"].map((value) => ({ value, label: value })),
          slots: { arrow: () => icon("keyboard_arrow_down", "sm") },
          onChange: (value) => {
            draft.runtimeStatus = String(readCmsValue(value) || "idle");
          },
        })
      ),
      _.section(
        { class: "tl-flow-config-section" },
        _.h3("Form Layout"),
        layout.length
          ? _.div({ class: "tl-flow-node-builder-live-form" }, ...layout.map((layoutNode) => renderCustomConfigComponent(layoutNode, draft)))
          : _.p("Questo nodo custom non contiene ancora un layout form.")
      )
    ),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({
        onclick: () => {
          close();
          openNodeBuilderDialog({
            editNode: nodeById(node.id) || node,
            nodeTemplate: nodeBuilderTemplateFromCustomNode(nodeById(node.id) || node),
          });
        },
      }, icon("add_box", "sm"), "Customize Node"),
      btn({ onclick: close }, "Cancel"),
      btn({ class: "st-btn-primary", onclick: () => persistCustomRuntimeNodeConfig({ node, draft, close }) }, icon("save", "sm"), "Save Node")
    ),
  });
  dialog.open();
};

const requestOrchestratorAgentConfig = (node) => {
  if (!node?.id) return;
  const readCmsValue = (value) => value?.target?.value ?? value;
  const config = nodeConfigObject(node);
  const draft = {
    label: node.label || "Orchestrator Agent",
    runtimeStatus: node.metadata?.runtimeStatus || node.runtime?.status || node.status || "idle",
    config: {
      goal: config.goal || "Decide which connected nodes should run for each incoming payload.",
      systemPrompt: config.systemPrompt || "You are the central Trackers Lens orchestrator. Read payload, inspect available connected nodes, choose safe steps, and keep every decision traceable.",
      executionMode: config.executionMode || "on_event",
      autonomousMode: String(config.autonomousMode || config.autonomous || "false") === "true",
      maxIterations: config.maxIterations || "5",
      iterationDelayMs: config.iterationDelayMs || "1200",
      stopCondition: config.stopCondition || "completed",
      feedbackWindow: config.feedbackWindow || "12",
      allowedNodeTypes: config.allowedNodeTypes || "processors, ai-agents, actions, storage, lens, dev",
      maxSteps: config.maxSteps || "6",
      dispatchStrategy: config.dispatchStrategy || "linked_order",
      plannerStrategy: config.plannerStrategy || "ai-first",
      routePolicy: config.routePolicy || "direct-linked-only",
      providerProfile: config.providerProfile || "",
      providerType: config.providerType || config.provider || "local",
      model: config.model || "local-model",
      temperature: config.temperature || "0.2",
      maxTokens: config.maxTokens || "1200",
      responseFormat: config.responseFormat || "json",
      memoryMode: config.memoryMode || "workspace",
      memorySize: config.memorySize || "30",
      contextWindow: config.contextWindow || "8",
      traceRetention: config.traceRetention || "workspace",
      outputDecision: config.outputDecision || "decision",
      outputAction: config.outputAction || "action",
      outputDone: config.outputDone || "done",
      outputError: config.outputError || "error",
      maxConcurrentTasks: config.maxConcurrentTasks || config.parallelJobs || "1",
      queueLimit: config.queueLimit || "10",
      timeoutMs: config.timeoutMs || "30000",
      dropPolicy: config.dropPolicy || "queue",
      decisionName: config.decisionName || "execute_downstream",
      requireConfirmation: String(config.requireConfirmation || "false") === "true",
      verboseTrace: String(config.verboseTrace || "true") !== "false",
      savePrompts: String(config.savePrompts || "true") !== "false",
      saveDecisions: String(config.saveDecisions || "true") !== "false",
      debugMode: String(config.debugMode || "false") === "true",
      testPayload: config.testPayload || "{ \"task\": \"Route this payload through the connected graph\", \"confirmed\": true }",
    },
  };
  const update = (key, value) => {
    draft.config[key] = value;
  };
  const save = async (close) => {
    const previousMetadata = node.metadata || {};
    const inputs = ["task"];
    const outputs = ["decision", "action", "done", "error"];
    const normalizedConfig = {
      ...draft.config,
      autonomousMode: String(Boolean(draft.config.autonomousMode)),
      requireConfirmation: String(Boolean(draft.config.requireConfirmation)),
      verboseTrace: String(Boolean(draft.config.verboseTrace)),
      maxIterations: String(draft.config.maxIterations || "5"),
      iterationDelayMs: String(draft.config.iterationDelayMs || "1200"),
      stopCondition: draft.config.stopCondition || "completed",
      feedbackWindow: String(draft.config.feedbackWindow || "12"),
      maxSteps: String(draft.config.maxSteps || "6"),
      memorySize: String(draft.config.memorySize || "30"),
      contextWindow: String(draft.config.contextWindow || "8"),
      maxConcurrentTasks: String(draft.config.maxConcurrentTasks || "1"),
      queueLimit: String(draft.config.queueLimit || "10"),
      timeoutMs: String(draft.config.timeoutMs || "30000"),
      dropPolicy: draft.config.dropPolicy || "queue",
      savePrompts: String(Boolean(draft.config.savePrompts)),
      saveDecisions: String(Boolean(draft.config.saveDecisions)),
      debugMode: String(Boolean(draft.config.debugMode)),
    };
    const manifest = nodeManifest({
      type: "aiAgent",
      subtype: "orchestrator",
      category: "ai-agents",
      inputs,
      outputs,
      permissions: ["ai.invoke", "graph.dispatch", "channel.emit"],
      settingsSchema: {
        goal: "string",
        systemPrompt: "string",
        executionMode: "manual|on_event|continuous|autonomous",
        autonomousMode: "boolean",
        maxIterations: "number",
        iterationDelayMs: "number",
        stopCondition: "string",
        feedbackWindow: "number",
        allowedNodeTypes: "array",
        dispatchStrategy: "linked_order|priority|first_success|all",
        plannerStrategy: "ai-first|graph-first|goal-first|feedback-first|legacy",
        routePolicy: "direct-linked-only|agent-control|all-linked",
        maxSteps: "number",
        maxConcurrentTasks: "number",
        queueLimit: "number",
        timeoutMs: "number",
        dropPolicy: "queue|reject|latest",
        requireConfirmation: "boolean",
        verboseTrace: "boolean",
        savePrompts: "boolean",
        saveDecisions: "boolean",
        debugMode: "boolean",
      },
      runtime: { executionMode: normalizedConfig.executionMode, orchestrator: true, autonomous: normalizedConfig.autonomousMode === "true" },
    });
    const nextNode = {
      ...node,
      label: draft.label || node.label || "Orchestrator Agent",
      inputs,
      outputs,
      channels: [...new Set([...inputs, ...outputs])],
      status: draft.runtimeStatus,
      runtime: {
        ...(node.runtime || {}),
        status: draft.runtimeStatus,
        active: !["paused", "disabled"].includes(draft.runtimeStatus),
      },
      metadata: {
        ...previousMetadata,
        draft: false,
        configured: true,
        mode: "Orchestrator",
        config: normalizedConfig,
        runtimeStatus: draft.runtimeStatus,
        subtype: "orchestrator",
        category: "ai-agents",
        manifest,
        permissions: manifest.permissions,
        settingsSchema: manifest.settingsSchema,
        runtimeMetadata: manifest.runtime,
        agentRole: "orchestrator",
        description: "Central runtime brain that decides and dispatches connected nodes.",
      },
      updatedAt: new Date().toISOString(),
    };
    await window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode?.({ node: nextNode });
    await window.TrackerLensChannelRegistry?.upsertChannelsForRuntimeNode?.({ node: nextNode });
    await recordFlowAction({
      workspaceId: node.workspaceId || state.filters.workspaceId || "workspace_global",
      nodeId: node.id,
      message: `Orchestrator Agent configured: ${nextNode.label || node.id}`,
      context: { action: "orchestrator-config", config: normalizedConfig },
    });
    close?.();
    await loadRuntime({ force: true });
  };
  const selectOptions = (values) => values.map((value) => ({ value, label: value }));
  const tabModel = window.CMSwift?.reactive?.signal?.("general");
  const formId = `tl-flow-orchestrator-${String(node.id || Date.now()).replace(/[^A-Za-z0-9_-]/g, "_")}`;
  const inputField = (label, key, extra = {}) => _.Input({
    size: "sm",
    label,
    value: String(draft.config[key] ?? ""),
    autocomplete: "off",
    onInput: (event) => update(key, String(readCmsValue(event) || "")),
    ...extra,
  });
  const selectField = (label, key, options = []) => _.Select({
    size: "sm",
    label,
    value: String(draft.config[key] ?? ""),
    options: selectOptions(options),
    slots: { arrow: () => icon("keyboard_arrow_down", "sm") },
    onChange: (value) => update(key, String(readCmsValue(value) || options[0] || "")),
  });
  const textareaField = (label, key, rows = 5, placeholder = "") => _.label(
    { class: "tl-ai-agent-textarea-field" },
    _.span(label),
    _.textarea({
      rows,
      value: String(draft.config[key] || ""),
      placeholder,
      oninput: (event) => update(key, event.currentTarget.value),
    })
  );
  const toggleField = (label, key) => _.div(
    { class: "tl-flow-config-toggle-row" },
    _.span(label),
    _.Toggle({
      size: "sm",
      checked: Boolean(draft.config[key]),
      onChange: (checked) => update(key, Boolean(checked)),
    })
  );
  const previewCard = (title, text, codeText = "") => _.div(
    { class: "tl-ai-agent-preview-card" },
    _.strong(title),
    _.p(text),
    codeText ? _.code(codeText) : null
  );
  const dialog = _.Dialog({
    class: "tl-ai-agent-dialog tl-flow-orchestrator-dialog",
    panelClass: "tl-ai-agent-runtime-panel tl-flow-orchestrator-panel",
    size: "xl",
    title: draft.label || "Orchestrator Agent",
    subtitle: `${node.label || node.id} · central graph runtime`,
    icon: "hub",
    closeButton: true,
    closeOnOutside: false,
    closeOnBackdrop: false,
    scrollable: true,
    bodyMaxHeight: "76vh",
    content: ({ close }) => _.form(
      {
        id: formId,
        class: "tl-ai-agent-runtime-editor tl-flow-orchestrator-editor",
        onsubmit: async (event) => {
          event.preventDefault();
          await save(close);
        },
      },
      _.TabPanel({
        class: "tl-ai-agent-tabs tl-flow-orchestrator-tabs",
        model: tabModel,
        orientation: "horizontal",
        variant: "soft",
        tabs: [
          {
            name: "general",
            label: "General",
            icon: "hub",
            content: _.div(
              { class: "tl-ai-agent-tab-grid" },
              _.Input({
                size: "sm",
                label: "Node title",
                value: draft.label,
                autocomplete: "off",
                onInput: (event) => {
                  draft.label = String(readCmsValue(event) || "");
                },
              }),
              inputField("Orchestrator role", "orchestratorRole", { placeholder: "central graph runtime" }),
              textareaField("Goal", "goal", 5, "What should this orchestrator accomplish?"),
              textareaField("System policy", "systemPrompt", 6, "Decision policy, constraints, tone and safety rules."),
              previewCard("Graph scope", "The Orchestrator dispatches directly linked nodes and keeps a trace for every decision.", `${(state.runtime.dependencies || []).filter((dependency) => dependency.sourceNodeId === node.id).length} links · ${(node.outputs || []).length || 4} outputs`)
            ),
          },
          {
            name: "runtime",
            label: "Runtime",
            icon: "account_tree",
            content: _.div(
              { class: "tl-ai-agent-tab-grid" },
              _.Select({
                size: "sm",
                label: "Runtime state",
                value: draft.runtimeStatus,
                options: selectOptions(["idle", "active", "running", "warning", "paused", "error", "disconnected"]),
                slots: { arrow: () => icon("keyboard_arrow_down", "sm") },
                onChange: (value) => {
                  draft.runtimeStatus = String(readCmsValue(value) || "idle");
                },
              }),
              selectField("Execution mode", "executionMode", ["manual", "on_event", "continuous", "autonomous"]),
              inputField("Priority", "priority", { type: "number" }),
              inputField("Max concurrent tasks", "maxConcurrentTasks", { type: "number" }),
              inputField("Queue limit", "queueLimit", { type: "number" }),
              inputField("Timeout (ms)", "timeoutMs", { type: "number" }),
              inputField("Cooldown (ms)", "cooldownMs", { type: "number" }),
              selectField("Drop policy", "dropPolicy", ["queue", "reject", "latest"])
            ),
          },
          {
            name: "planner",
            label: "Planner",
            icon: "route",
            content: _.div(
              { class: "tl-ai-agent-tab-grid" },
              inputField("Decision name", "decisionName"),
              selectField("Planner strategy", "plannerStrategy", ["ai-first", "graph-first", "goal-first", "feedback-first", "legacy"]),
              selectField("Dispatch strategy", "dispatchStrategy", ["linked_order", "priority", "first_success", "all"]),
              selectField("Route policy", "routePolicy", ["direct-linked-only", "agent-control", "all-linked"]),
              inputField("Allowed node types", "allowedNodeTypes"),
              inputField("Max steps per iteration", "maxSteps", { type: "number" }),
              previewCard("Planning contract", "Each plan is emitted as a decision, then every accepted step is dispatched as a traceable runtime event.", "decision -> step[] -> feedback -> done")
            ),
          },
          {
            name: "provider",
            label: "AI Provider",
            icon: "dns",
            content: _.div(
              { class: "tl-ai-agent-tab-grid" },
              inputField("Provider profile", "providerProfile"),
              selectField("Provider type", "providerType", ["local", "ollama", "lm-studio", "openai", "claude", "gemini", "custom"]),
              inputField("Model", "model"),
              inputField("Temperature", "temperature", { type: "number", step: "0.1" }),
              inputField("Max tokens", "maxTokens", { type: "number" }),
              inputField("Max continuations", "maxContinuationCalls", { type: "number" }),
              selectField("Response format", "responseFormat", ["json", "structured", "text", "markdown"]),
              previewCard("Decision provider", "Provider settings are stored with the Orchestrator mission contract and can be used by autonomous planning.")
            ),
          },
          {
            name: "inputs",
            label: "Inputs",
            icon: "input",
            content: _.div(
              { class: "tl-ai-agent-tab-grid" },
              inputField("Task input channel", "taskInput", { placeholder: "task" }),
              inputField("Context channels", "contextChannels", { placeholder: "market.data, agent.feedback" }),
              inputField("Required context", "requiredContext", { placeholder: "workspace, memory, last-event" }),
              selectField("Input data request", "inputDataMode", ["off", "latest", "history", "latest_history"]),
              inputField("Input history limit", "inputHistoryLimit", { type: "number" }),
              textareaField("Payload mapping", "payloadMapping", 5, "task -> mission.task\nfeedback -> mission.feedback"),
              previewCard("Task contract", "The Orchestrator receives missions on task and may enrich each iteration with feedback and connected node results.", "task -> mission -> plan")
            ),
          },
          {
            name: "autonomy",
            label: "Autonomy",
            icon: "autoplay",
            content: _.div(
              { class: "tl-ai-agent-tab-grid" },
              toggleField("Run until goal is reached", "autonomousMode"),
              inputField("Max iterations", "maxIterations", { type: "number" }),
              inputField("Delay between iterations (ms)", "iterationDelayMs", { type: "number" }),
              inputField("Stop condition", "stopCondition"),
              inputField("Feedback events", "feedbackWindow", { type: "number" }),
              selectField("Failure policy", "failurePolicy", ["stop", "retry", "skip-target", "ask-human"]),
              inputField("Max mission runtime (ms)", "maxMissionRuntimeMs", { type: "number" }),
              previewCard("Autonomy guardrails", "Autonomous missions stop on a completion signal, max iterations, blocked graph, timeout, or explicit error.")
            ),
          },
          {
            name: "memory",
            label: "Memory",
            icon: "memory",
            content: _.div(
              { class: "tl-ai-agent-tab-grid" },
              selectField("Memory mode", "memoryMode", ["none", "short", "workspace", "persistent"]),
              inputField("Memory size", "memorySize", { type: "number" }),
              inputField("Context window", "contextWindow", { type: "number" }),
              selectField("Trace retention", "traceRetention", ["none", "session", "workspace", "persistent"]),
              inputField("Mission memory key", "missionMemoryKey", { placeholder: "orchestrator.mission" }),
              toggleField("Save decisions", "saveDecisions"),
              toggleField("Save prompts", "savePrompts"),
              previewCard("Mission memory", "Each run keeps the decision, emitted steps, feedback window and final stop reason.")
            ),
          },
          {
            name: "outputs",
            label: "Outputs",
            icon: "output",
            content: _.div(
              { class: "tl-ai-agent-tab-grid" },
              inputField("Decision output", "outputDecision"),
              inputField("Action output", "outputAction"),
              inputField("Done output", "outputDone"),
              inputField("Error output", "outputError"),
              selectField("Emit strategy", "emitStrategy", ["always", "on_success", "on_change", "manual"]),
              selectField("Event priority", "eventPriority", ["low", "normal", "high", "critical"]),
              previewCard("Output channels", "The node keeps four stable outputs so downstream nodes can react to decisions, actions, completion and errors.", `${draft.config.outputDecision}, ${draft.config.outputAction}, ${draft.config.outputDone}, ${draft.config.outputError}`)
            ),
          },
          {
            name: "safety",
            label: "Safety",
            icon: "shield",
            content: _.div(
              { class: "tl-ai-agent-permission-grid" },
              toggleField("Require confirmation for external Actions", "requireConfirmation"),
              toggleField("Allow agent-to-agent dispatch", "allowAgentDispatch"),
              toggleField("Allow storage writes", "allowStorageWrites"),
              toggleField("Allow notification Actions", "allowNotifications"),
              toggleField("Allow webhook/network Actions", "allowNetworkActions"),
              toggleField("Verbose trace logs", "verboseTrace"),
              previewCard("Safety boundary", "Dangerous outputs can require confirmation while internal processor, lens and agent routes remain automatic.")
            ),
          },
          {
            name: "debug",
            label: "Debug/Test",
            icon: "bug_report",
            content: _.div(
              { class: "tl-ai-agent-tab-grid is-wide" },
              toggleField("Debug mode", "debugMode"),
              inputField("Trace label", "traceLabel", { placeholder: "market-mission-v1" }),
              textareaField("Direct test payload", "testPayload", 7, "{ \"task\": \"...\" }"),
              previewCard("Live test", "Use Pulse Test or Live Test to run the configured task through the Orchestrator and inspect decisions in Flow Logs.")
            ),
          },
        ],
      })
    ),
    actions: ({ close }) => _.Toolbar(
      { class: "tl-ai-agent-editor-footer", align: "end", gap: 8 },
      btn({ onclick: close }, "Cancel"),
      btn({ class: "st-btn-primary", onclick: () => save(close) }, icon("save", "sm"), "Save Orchestrator")
    ),
  });
  dialog.open();
};

const providerLabelForRuntimeConfig = (provider = {}) => {
  const name = provider.name || provider.provider || provider.id || "AI Provider";
  const model = provider.model || provider.defaultModel || "";
  const type = provider.provider || provider.providerType || "";
  return [name, model || type].filter(Boolean).join(" · ");
};

const aiProviderTypeOptions = (providers = []) => [
  ...new Set([
    "local",
    "ollama",
    "lm-studio",
    "openai",
    "anthropic",
    "gemini",
    "custom",
    ...providers.map((provider) => provider.provider || provider.providerType || "").filter(Boolean),
  ]),
];

const knowledgeAiNodeTabMeta = (subtype = "") => {
  if (subtype === "embedding-generator") return { label: "Embedding", icon: "scatter_plot" };
  if (subtype === "vector-memory") return { label: "Vector Memory", icon: "memory" };
  if (subtype === "knowledge-event-builder") return { label: "Event Builder", icon: "timeline" };
  if (subtype === "semantic-relation-enricher") return { label: "Semantic", icon: "psychology" };
  if (subtype === "knowledge-graph-builder-agent") return { label: "Graph Builder", icon: "auto_awesome" };
  if (subtype === "knowledge-mechanism-cue-agent") return { label: "Mechanism Cue", icon: "psychology_alt" };
  return { label: "Knowledge", icon: "schema" };
};

const requestRuntimeNodeConfig = async (node) => {
  if (!node?.id) return;
  const defaults = runtimeNodeConfigDefaults(node);
  const subtype = nodeSubtype(node);
  const category = nodeCategory(node);
  const configFields = configFieldDefinitions(node);
  const capabilityFields = agentCapabilityFieldDefinitions(node);
  const formId = `tl-flow-config-${String(node.id).replace(/[^A-Za-z0-9_-]/g, "_")}`;
  let formRef = null;
  let aiProviders = [];
  let aiConfigDefaults = {};
  if (configFields.some((definition) => String(definition.type || "").startsWith("ai-"))) {
    const aiDefaults = await runtimeDefaultAiConfigForDialog();
    aiProviders = aiDefaults.providers;
    aiConfigDefaults = aiDefaults.defaults;
  }
  const field = (name, label, value, placeholder = "") =>
    _.label(
      { class: "tl-flow-config-field" },
      _.span(label),
      _.input({ name, value, placeholder, autocomplete: "off" })
    );
  const selectField = (name, label, value, options = []) =>
    _.label(
      { class: "tl-flow-config-field" },
      _.span(label),
      _.select({ name, value }, ...options.map((option) => _.option({ value: option, selected: option === value }, option)))
    );
  const telegramTokenFromForm = () =>
    String(formRef?.querySelector?.('[data-config-key="botToken"]')?.value || defaults.configObject?.botToken || "").trim();
  const telegramApiUrl = (path = "") => {
    const token = telegramTokenFromForm();
    return token ? `https://api.telegram.org/bot${token}/${path.replace(/^\/+/, "")}` : "";
  };
  const warnMissingTelegramToken = () => {
    state.error = "Inserisci prima il Bot token Telegram.";
    setErrorSignal?.(state.error);
    mount();
  };
  const openTelegramUpdates = () => {
    const url = telegramApiUrl("getUpdates");
    if (!url) {
      warnMissingTelegramToken();
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };
  const generateTelegramSendMessageUrl = () => {
    const url = telegramApiUrl("sendMessage");
    if (!url) {
      warnMissingTelegramToken();
      return;
    }
    const targetInput = formRef?.querySelector?.('[data-config-key="target"]');
    if (targetInput) targetInput.value = url;
  };
  const syncAiProviderConfigFields = (providerId = "") => {
    const provider = aiProviders.find((item) => item.id === providerId) || null;
    if (!provider || !formRef) return;
    const typeInput = formRef.querySelector('[data-config-key="providerType"]');
    const modelInput = formRef.querySelector('[data-config-key="model"]');
    if (typeInput) typeInput.value = provider.provider || provider.providerType || typeInput.value || "local";
    if (modelInput) modelInput.value = provider.model || provider.defaultModel || modelInput.value || "local-model";
  };
  const refreshConditionalConfigFields = (form = formRef) => {
    if (!form) return;
    const strategy = String(form.querySelector('[data-config-key="strategy"]')?.value || "structured").trim().toLowerCase();
    const setConfigFieldVisible = (key = "", visible = true) => {
      const input = form.querySelector(`[data-config-key="${key}"]`);
      const fieldRoot = input?.closest?.(".tl-flow-config-field");
      if (!fieldRoot) return;
      fieldRoot.hidden = !visible;
      fieldRoot.style.display = visible ? "" : "none";
      input.disabled = !visible;
    };
    if (subtype === "chunk-processor") {
      setConfigFieldVisible("maxChunkTokens", ["structured", "section", "token"].includes(strategy));
      setConfigFieldVisible("chunkOverlapTokens", strategy === "structured");
      setConfigFieldVisible("chunkSize", false);
      setConfigFieldVisible("chunkOverlap", false);
    }
    Array.from(form.querySelectorAll("[data-visible-for-strategies]") || []).forEach((fieldRoot) => {
      const strategies = String(fieldRoot.dataset.visibleForStrategies || "")
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
      const visible = !strategies.length || strategies.includes(strategy);
      fieldRoot.hidden = !visible;
      fieldRoot.style.display = visible ? "" : "none";
      Array.from(fieldRoot.querySelectorAll("[data-config-key]") || []).forEach((input) => {
        input.disabled = !visible;
      });
    });
  };
  const configFieldAttrs = (definition = {}, className = "tl-flow-config-field") => ({
    class: className,
    ...(definition.visibleForStrategies ? { "data-visible-for-strategies": definition.visibleForStrategies.join(",") } : {}),
  });
  const configField = (definition) => {
    const value = defaults[definition.key] ?? defaults.configObject?.[definition.key] ??
      (AI_PROVIDER_CONFIG_KEYS.has(definition.key) ? aiConfigDefaults[definition.key] : undefined) ??
      (definition.key === "previewMode" ? defaults.configObject?.mode : undefined) ??
      definition.defaultValue ?? "";
    if (definition.type === "ai-provider-profile") {
      const options = [
        { value: "", label: "Auto / local-first" },
        ...aiProviders.map((provider) => ({ value: provider.id, label: providerLabelForRuntimeConfig(provider) })),
      ];
      return _.label(
        configFieldAttrs(definition),
        _.span(definition.label),
        _.select(
          {
            "data-config-key": definition.key,
            value,
            onchange: (event) => {
              syncAiProviderConfigFields(event.currentTarget.value);
              refreshConditionalConfigFields(event.currentTarget.closest("form"));
            },
          },
          ...options.map((option) => _.option({ value: option.value, selected: option.value === value }, option.label))
        )
      );
    }
    if (definition.type === "ai-provider-type") {
      const options = aiProviderTypeOptions(aiProviders);
      return _.label(
        configFieldAttrs(definition),
        _.span(definition.label),
        _.select(
          { "data-config-key": definition.key, value: value || options[0] || "local" },
          ...options.map((option) => _.option({ value: option, selected: option === value }, option))
        )
      );
    }
    if (definition.type === "ai-model") {
      const selectedProvider = aiProviders.find((provider) => provider.id === defaults.configObject?.providerProfile) || null;
      return _.label(
        configFieldAttrs(definition),
        _.span(definition.label),
        _.input({
          "data-config-key": definition.key,
          value: value || selectedProvider?.model || "",
          placeholder: selectedProvider?.model || "auto from provider profile",
          autocomplete: "off",
        })
      );
    }
    if (definition.type === "checkbox") {
      const inputId = `${formId}-${definition.key}`;
      return _.div(
        configFieldAttrs(definition, "tl-flow-config-field is-check"),
        _.span(definition.label),
        _.fragment(
          _.input({
            id: inputId,
            class: "tl-flow-config-hidden-check",
            "data-config-key": definition.key,
            type: "checkbox",
            checked: Boolean(value),
            tabindex: "-1",
            "aria-hidden": "true",
          }),
          _.Toggle({
            checked: Boolean(value),
            color: "success",
            onChange: (checked) => {
              const input = document.getElementById(inputId);
              if (input) input.checked = Boolean(checked);
            },
          })
        )
      );
    }
    if (definition.type === "select") {
      const isRuleModeField = KNOWLEDGE_RULE_MODE_CONFIG_KEYS.has(definition.key);
      const selectControl = _.label(
        configFieldAttrs(definition),
        _.span(definition.label),
        _.select(
          {
            "data-config-key": definition.key,
            ...(isRuleModeField ? { "data-knowledge-rule-mode-field": "true" } : {}),
            value,
            onchange: (event) => {
              const form = event.currentTarget.closest("form");
              if (isRuleModeField) refreshKnowledgeRulesButtons(form);
              refreshConditionalConfigFields(form);
            },
          },
          ...(definition.options || []).map((option) => _.option({ value: option, selected: option === value }, option))
        )
      );
      return isRuleModeField
        ? _.fragment(selectControl, renderKnowledgeCustomRulesControl({ node, subtype, formId }))
        : selectControl;
    }
    if (definition.type === "textarea") {
      return _.label(
        configFieldAttrs(definition, "tl-flow-config-field is-wide"),
        _.span(definition.label),
        _.textarea({ "data-config-key": definition.key, rows: definition.rows || 4, placeholder: definition.placeholder || "", value })
      );
    }
    if (subtype === "telegram" && definition.key === "chatId") {
      return _.label(
        configFieldAttrs(definition),
        _.span(
          definition.label,
          btn({
            class: "tl-flow-config-field-action",
            title: "Open Telegram getUpdates with this bot token",
            onclick: (event) => {
              event.preventDefault();
              event.stopPropagation();
              openTelegramUpdates();
            },
          }, icon("open_in_new", "sm"), "Get updates")
        ),
        _.input({ "data-config-key": definition.key, value, placeholder: definition.placeholder || "", autocomplete: "off" })
      );
    }
    if (subtype === "telegram" && definition.key === "target") {
      return _.label(
        configFieldAttrs(definition),
        _.span(
          definition.label,
          btn({
            class: "tl-flow-config-field-action",
            title: "Generate Telegram sendMessage URL with this bot token",
            onclick: (event) => {
              event.preventDefault();
              event.stopPropagation();
              generateTelegramSendMessageUrl();
            },
          }, icon("auto_fix_high", "sm"), "Generate")
        ),
        _.input({ "data-config-key": definition.key, value, placeholder: definition.placeholder || "", autocomplete: "off" })
      );
    }
    if (["image-file", "audio-file", "file"].includes(definition.type)) {
      const accept = definition.type === "image-file" ? "image/*" : definition.type === "audio-file" ? "audio/*" : "";
      const inputId = `${formId}-${definition.key}`;
      const fileLabelKey = definition.type === "image-file" ? "imageFileName" : definition.type === "audio-file" ? "audioFileName" : "fileName";
      const fileTypeKey = definition.type === "image-file" ? "imageMimeType" : definition.type === "audio-file" ? "audioMimeType" : "mimeType";
      return _.div(
        configFieldAttrs(definition, `tl-flow-config-field is-wide is-file${definition.type === "image-file" ? " is-image" : ""}`),
        _.span(definition.label),
        _.input({ id: inputId, "data-config-key": definition.key, type: "hidden", value }),
        _.input({
          type: "file",
          accept,
          onchange: (event) => {
            const file = event.currentTarget.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
              const hidden = document.getElementById(inputId);
              if (hidden) hidden.value = String(reader.result || "");
              const nameField = formRef?.querySelector?.(`[data-config-key="${fileLabelKey}"]`);
              const typeField = formRef?.querySelector?.(`[data-config-key="${fileTypeKey}"]`);
              if (nameField && !nameField.value) nameField.value = file.name;
              if (typeField && !typeField.value) typeField.value = file.type || "";
              const preview = formRef?.querySelector?.(`[data-file-preview-for="${definition.key}"]`);
              if (preview && definition.type === "image-file") preview.src = String(reader.result || "");
            };
            reader.readAsDataURL(file);
          },
        }),
        definition.type === "image-file" ? _.img({
          class: "tl-flow-config-image-preview",
          "data-file-preview-for": definition.key,
          src: value || defaults.configObject?.imageUrl || "",
          alt: "Image preview",
        }) : null
      );
    }
    return _.label(
      configFieldAttrs(definition),
      _.span(definition.label),
      _.input({
        "data-config-key": definition.key,
        value,
        placeholder: definition.placeholder || "",
        autocomplete: "off",
        type: definition.type === "number" ? "number" : subtype === "telegram" && definition.key === "botToken" ? "password" : "text",
        ...(definition.step ? { step: definition.step } : {}),
      })
    );
  };
  const hasAiProviderConfig = configFields.some((definition) => AI_PROVIDER_CONFIG_KEYS.has(definition.key));
  if (hasAiProviderConfig) {
    const knowledgeFields = configFields.filter((definition) =>
      !AI_PROVIDER_CONFIG_KEYS.has(definition.key) &&
      !AI_PROMPT_CONFIG_KEYS.has(definition.key) &&
      definition.key !== "outputChannel"
    );
    const nodeTab = knowledgeAiNodeTabMeta(subtype);
    if (window.TrackerLensAiAgentEditor?.open) {
      window.TrackerLensAiAgentEditor.open({
        agent: aiAgentFromRuntimeNode(node, aiConfigDefaults),
        providers: aiProviders,
        title: `Configure ${subtype}`,
        subtitle: `${node.label || node.id} · Knowledge AI runtime node`,
        saveLabel: "Save Node",
        cancelLabel: "Cancel",
        customTabs: knowledgeFields.length ? [
          {
            name: "knowledge-node",
            label: nodeTab.label,
            icon: nodeTab.icon,
            content: _.div(
              { class: "tl-ai-agent-tab-grid is-wide" },
              ...knowledgeFields.map(configField)
            ),
          },
        ] : [],
        onSave: ({ payload, form, dialog, close }) => persistKnowledgeAiEditorPayload({ node, payload, form, dialog, close }),
      });
      return;
    }
  }
  const dialog = _.Dialog({
    class: "tl-flow-config-dialog",
    panelClass: "tl-flow-config-panel",
    size: "md",
    title: `Configure ${subtype}`,
    subtitle: `${category} · ${node.label || node.id}`,
    icon: graphIcon(node),
    closeButton: true,
    content: () => _.form(
      {
        id: formId,
        class: "tl-flow-config-form",
        onsubmit: (event) => {
          event.preventDefault();
          persistRuntimeNodeConfig({ node, form: formRef || event.currentTarget, close: () => dialog.close() });
        },
      },
      _.p("Configura il nodo come componente runtime persistente. Le impostazioni vengono salvate nel runtime graph del workspace."),
      _.div(
        { class: "tl-flow-config-grid" },
        field("label", "Node title", defaults.label),
        selectField("runtimeStatus", "Runtime state", defaults.runtimeStatus, ["idle", "active", "running", "warning", "paused", "error", "disconnected"]),
        category === "sources" ? null : field("input", "Input port / channel", defaults.input),
        subtype === "condition"
          ? null
          : category === "actions" || category === "storage" || category === "lens"
            ? null
            : field("output", "Output port / channel", defaults.output),
        field("mode", "Runtime mode", defaults.mode)
      ),
      configFields.length ? _.section(
        { class: "tl-flow-config-section" },
        _.h3(`${subtype} settings`),
        ...configFields.map(configField)
      ) : null,
      renderPayloadEditor({ node, defaults, formId }),
      capabilityFields.length ? _.section(
        { class: "tl-flow-config-section" },
        _.h3("Agent Capability"),
        ...capabilityFields.map(configField)
      ) : null,
      _.section(
        { class: "tl-flow-config-section" },
        _.h3("Execution capacity"),
        ...executionFieldDefinitions().map(configField)
      )
    ),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: close }, "Cancel"),
      btn({ class: "st-btn-primary", onclick: () => persistRuntimeNodeConfig({ node, form: formRef || document.getElementById(formId), close }) }, icon("save", "sm"), "Save Node")
    ),
  });
  dialog.open();
  formRef = document.getElementById(formId);
  formRef?.addEventListener?.("change", (event) => {
    if (event.target?.matches?.('[data-config-key="strategy"]')) refreshConditionalConfigFields(formRef);
  });
  formRef?.addEventListener?.("input", (event) => {
    if (event.target?.matches?.('[data-config-key="strategy"]')) refreshConditionalConfigFields(formRef);
  });
  refreshConditionalConfigFields(formRef);
  window.setTimeout?.(() => refreshConditionalConfigFields(document.getElementById(formId)), 0);
};

const downstreamNodeTree = (rootNode = {}) => {
  if (!rootNode?.id) return { ids: new Set(), nodes: [], dependencies: [] };
  const bySource = new Map();
  (state.runtime.dependencies || []).forEach((dependency) => {
    if (!dependency.sourceNodeId || !dependency.targetNodeId) return;
    if (!bySource.has(dependency.sourceNodeId)) bySource.set(dependency.sourceNodeId, []);
    bySource.get(dependency.sourceNodeId).push(dependency);
  });

  const ids = new Set([rootNode.id]);
  const queue = [rootNode.id];
  const dependencies = [];
  while (queue.length) {
    const currentId = queue.shift();
    (bySource.get(currentId) || []).forEach((dependency) => {
      dependencies.push(dependency);
      if (!ids.has(dependency.targetNodeId)) {
        ids.add(dependency.targetNodeId);
        queue.push(dependency.targetNodeId);
      }
    });
  }

  return {
    ids,
    nodes: [...ids].map((id) => nodeById(id)).filter(Boolean),
    dependencies,
  };
};

const deletedNodeTreeSnapshot = (nodes = [], rootNode = nodes[0]) => {
  const nodeIds = new Set(nodes.map((node) => node?.id).filter(Boolean));
  const dependencyIds = new Set();
  const dependencies = (state.runtime.dependencies || []).filter((dependency) => {
    const related = nodeIds.has(dependency.sourceNodeId) || nodeIds.has(dependency.targetNodeId);
    if (related) dependencyIds.add(dependency.id);
    return related && !dependency.metadata?.virtual;
  });
  const channels = (state.runtime.channels || []).filter((channel) =>
    nodeIds.has(channel.producerNodeId) ||
    nodeIds.has(channel.producerBoxId) ||
    (Array.isArray(channel.subscribers) && channel.subscribers.some((nodeId) => nodeIds.has(nodeId))));
  return {
    node: rootNode ? JSON.parse(JSON.stringify(rootNode)) : null,
    nodes: JSON.parse(JSON.stringify(nodes)),
    dependencies: JSON.parse(JSON.stringify(dependencies)),
    channels: JSON.parse(JSON.stringify(channels)),
    dependencyIds: [...dependencyIds],
    rootNodeId: rootNode?.id || "",
    deletedAt: new Date().toISOString(),
  };
};

const deletedNodeSnapshot = (node) => deletedNodeTreeSnapshot([node], node);

const nodeConnectionIdsForNodeIds = async (nodeIds = []) => {
  const ids = new Set(nodeIds.filter(Boolean));
  if (!ids.size || !window.TrackerLensConnectionsStore?.list) return [];
  const connections = await window.TrackerLensConnectionsStore.list().catch(() => []);
  return [...new Set((connections || [])
    .filter((connection) =>
      ids.has(connection.sourceNodeId) ||
      ids.has(connection.targetNodeId) ||
      ids.has(connection.fromBoxId) ||
      ids.has(connection.toBoxId) ||
      ids.has(connection.fromNodeId) ||
      ids.has(connection.toNodeId))
    .map((connection) => connection.id)
    .filter(Boolean))];
};

const nodeConnectionIds = async (node = {}) => {
  if (!node?.id) return [];
  return nodeConnectionIdsForNodeIds([node.id]);
};

const cleanupNodeConnections = async (node = {}) => {
  const connectionIds = await nodeConnectionIds(node);
  if (!connectionIds.length) return [];
  await window.TrackerLensConnectionsStore?.removeMany?.(connectionIds);
  await Promise.all(connectionIds.map((connectionId) =>
    Promise.all([
      window.TrackerLensRuntimeGraphStore?.cleanupConnectionReferences?.({ connectionId }),
      window.TrackerLensEventLogStore?.cleanupConnectionReferences?.({ connectionId, workspaceId: node.workspaceId || "" }),
      window.TrackerLensConnectionsStore?.removeWorkspaceContentConnection?.(connectionId, { workspaceId: node.workspaceId || "" }),
    ])
  ));
  return connectionIds;
};

const cleanupNodeTreeConnections = async (nodes = []) => {
  const connectionIds = await nodeConnectionIdsForNodeIds(nodes.map((node) => node.id));
  if (!connectionIds.length) return [];
  await window.TrackerLensConnectionsStore?.removeMany?.(connectionIds);
  await Promise.all(connectionIds.map((connectionId) =>
    Promise.all([
      window.TrackerLensRuntimeGraphStore?.cleanupConnectionReferences?.({ connectionId }),
      window.TrackerLensEventLogStore?.cleanupConnectionReferences?.({ connectionId }),
      window.TrackerLensConnectionsStore?.removeWorkspaceContentConnection?.(connectionId),
    ])
  ));
  return connectionIds;
};

const runtimeKnowledgeTableName = (key = "", fallback = "") =>
  window.tlConfig?.TABLES?.[key] || fallback;

const isRuntimeKnowledgeDocumentStoreNode = (node = {}) =>
  nodeCategory(node) === "knowledge" && ["document-store", "text-knowledge", "workspace-memory", "conversation-memory"].includes(nodeSubtype(node));

const readRuntimeKnowledgeStore = async (storeName = "") => {
  if (!storeName) return [];
  if (window.TrackerLensKnowledgeRuntime?.listStore) {
    return window.TrackerLensKnowledgeRuntime.listStore(storeName).catch(() => []);
  }
  if (!window.indexedDB) return [];
  const dbName = window.tlConfig?.DB_NAME || "TrackersLens";
  return new Promise((resolve) => {
    const request = indexedDB.open(dbName);
    request.onerror = () => resolve([]);
    request.onsuccess = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.close();
        resolve([]);
        return;
      }
      const transaction = db.transaction(storeName, "readonly");
      const store = transaction.objectStore(storeName);
      const all = store.getAll();
      all.onsuccess = () => {
        db.close();
        resolve(Array.isArray(all.result) ? all.result : []);
      };
      all.onerror = () => {
        db.close();
        resolve([]);
      };
    };
  });
};

const deleteRuntimeKnowledgeStoreRecords = async (storeName = "", ids = []) => {
  const safeIds = [...new Set((ids || []).filter(Boolean))];
  if (!storeName || !safeIds.length) return 0;
  if (window.TrackerLensKnowledgeRuntime?.deleteRecords) {
    await window.TrackerLensKnowledgeRuntime.deleteRecords(storeName, safeIds);
    return safeIds.length;
  }
  if (!window.indexedDB) return 0;
  const dbName = window.tlConfig?.DB_NAME || "TrackersLens";
  return new Promise((resolve) => {
    const request = indexedDB.open(dbName);
    request.onerror = () => resolve(0);
    request.onsuccess = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.close();
        resolve(0);
        return;
      }
      const transaction = db.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      safeIds.forEach((id) => store.delete(id));
      transaction.oncomplete = () => {
        db.close();
        resolve(safeIds.length);
      };
      transaction.onerror = () => {
        db.close();
        resolve(0);
      };
    };
  });
};

const knowledgeDocumentStoreImpactForDelete = async (node = {}) => {
  const empty = {
    documents: [],
    documentIds: [],
    chunks: [],
    embeddings: [],
    entities: [],
    relations: [],
    dictionary: [],
    sources: [],
    metrics: [],
    hasGraphMapping: false,
  };
  if (!node?.id || !isRuntimeKnowledgeDocumentStoreNode(node)) return empty;
  const stores = {
    documents: runtimeKnowledgeTableName("TL_KNOWLEDGE_DOCUMENTS", "tl_knowledge_documents"),
    chunks: runtimeKnowledgeTableName("TL_KNOWLEDGE_CHUNKS", "tl_knowledge_chunks"),
    embeddings: runtimeKnowledgeTableName("TL_KNOWLEDGE_EMBEDDINGS", "tl_knowledge_embeddings"),
    entities: runtimeKnowledgeTableName("TL_KNOWLEDGE_ENTITIES", "tl_knowledge_entities"),
    relations: runtimeKnowledgeTableName("TL_KNOWLEDGE_RELATIONS", "tl_knowledge_relations"),
    dictionary: runtimeKnowledgeTableName("TL_KNOWLEDGE_DICTIONARY", "tl_knowledge_dictionary"),
    sources: runtimeKnowledgeTableName("TL_KNOWLEDGE_SOURCES", "tl_knowledge_sources"),
    metrics: runtimeKnowledgeTableName("TL_KNOWLEDGE_METRICS", "tl_knowledge_metrics"),
  };
  const workspaceId = node.workspaceId || state.filters.workspaceId || "workspace_global";
  const config = nodeConfigObject(node);
  const collectionId = String(config.collectionId || "").trim();
  const [documents, chunks, embeddings, entities, relations, dictionary, sources, metrics] = await Promise.all([
    readRuntimeKnowledgeStore(stores.documents),
    readRuntimeKnowledgeStore(stores.chunks),
    readRuntimeKnowledgeStore(stores.embeddings),
    readRuntimeKnowledgeStore(stores.entities),
    readRuntimeKnowledgeStore(stores.relations),
    readRuntimeKnowledgeStore(stores.dictionary),
    readRuntimeKnowledgeStore(stores.sources),
    readRuntimeKnowledgeStore(stores.metrics),
  ]);
  const scopedDocuments = (documents || [])
    .filter((document) => (document.workspaceId || "workspace_global") === workspaceId)
    .filter((document) => document.metadata?.nodeId === node.id || document.sourceId === `upload_${node.id}` || document.sourceId === `live_${node.id}` || document.sourceId === node.id)
    .filter((document) => !collectionId || document.metadata?.collectionId === collectionId);
  const documentIds = new Set(scopedDocuments.map((document) => document.id).filter(Boolean));
  if (!documentIds.size) return empty;
  const scopedChunks = (chunks || [])
    .filter((chunk) => (chunk.workspaceId || "workspace_global") === workspaceId)
    .filter((chunk) => documentIds.has(chunk.documentId));
  const chunkIds = new Set(scopedChunks.map((chunk) => chunk.id).filter(Boolean));
  const scopedEntities = (entities || [])
    .filter((entity) => (entity.workspaceId || "workspace_global") === workspaceId)
    .filter((entity) => documentIds.has(entity.documentId) || chunkIds.has(entity.chunkId));
  const entityIds = new Set(scopedEntities.map((entity) => entity.id).filter(Boolean));
  const scopedEmbeddings = (embeddings || [])
    .filter((embedding) => (embedding.workspaceId || "workspace_global") === workspaceId)
    .filter((embedding) => documentIds.has(embedding.documentId) || chunkIds.has(embedding.chunkId));
  const scopedRelations = (relations || [])
    .filter((relation) => (relation.workspaceId || "workspace_global") === workspaceId)
    .filter((relation) =>
      documentIds.has(relation.documentId) ||
      chunkIds.has(relation.chunkId) ||
      entityIds.has(relation.sourceEntityId) ||
      entityIds.has(relation.targetEntityId)
    );
  const scopedDictionary = (dictionary || [])
    .filter((entry) => (entry.workspaceId || "workspace_global") === workspaceId)
    .filter((entry) => documentIds.has(entry.documentId) || chunkIds.has(entry.chunkId));
  const scopedSources = (sources || [])
    .filter((source) => (source.workspaceId || "workspace_global") === workspaceId)
    .filter((source) => documentIds.has(source.documentId));
  const scopedMetrics = (metrics || [])
    .filter((metric) => (metric.workspaceId || "workspace_global") === workspaceId)
    .filter((metric) => documentIds.has(metric.value?.documentId));
  return {
    stores,
    documents: scopedDocuments,
    documentIds: [...documentIds],
    chunks: scopedChunks,
    embeddings: scopedEmbeddings,
    entities: scopedEntities,
    relations: scopedRelations,
    dictionary: scopedDictionary,
    sources: scopedSources,
    metrics: scopedMetrics,
    hasGraphMapping: Boolean(scopedChunks.length || scopedEmbeddings.length || scopedEntities.length || scopedRelations.length || scopedDictionary.length || scopedSources.length || scopedMetrics.length),
  };
};

const cleanupKnowledgeDocumentStoreGraphMapping = async ({ node = {}, impact = null } = {}) => {
  const scoped = impact || await knowledgeDocumentStoreImpactForDelete(node);
  if (!scoped?.hasGraphMapping || !scoped.stores) return { chunks: 0, embeddings: 0, entities: 0, relations: 0, dictionary: 0, sources: 0, metrics: 0 };
  await Promise.all([
    deleteRuntimeKnowledgeStoreRecords(scoped.stores.relations, scoped.relations.map((relation) => relation.id)),
    deleteRuntimeKnowledgeStoreRecords(scoped.stores.entities, scoped.entities.map((entity) => entity.id)),
    deleteRuntimeKnowledgeStoreRecords(scoped.stores.dictionary, scoped.dictionary.map((entry) => entry.id)),
    deleteRuntimeKnowledgeStoreRecords(scoped.stores.embeddings, scoped.embeddings.map((embedding) => embedding.id)),
    deleteRuntimeKnowledgeStoreRecords(scoped.stores.chunks, scoped.chunks.map((chunk) => chunk.id)),
    deleteRuntimeKnowledgeStoreRecords(scoped.stores.sources, scoped.sources.map((source) => source.id)),
    deleteRuntimeKnowledgeStoreRecords(scoped.stores.metrics, scoped.metrics.map((metric) => metric.id)),
  ]);
  return {
    chunks: scoped.chunks.length,
    embeddings: scoped.embeddings.length,
    entities: scoped.entities.length,
    relations: scoped.relations.length,
    dictionary: scoped.dictionary.length,
    sources: scoped.sources.length,
    metrics: scoped.metrics.length,
  };
};

const performDraftNodeDelete = async (node, closeDialog = null, options = {}) => {
  if (!node?.id) return;
  const knowledgeCleanup = options.cleanupKnowledgeGraphMapping
    ? await cleanupKnowledgeDocumentStoreGraphMapping({ node, impact: options.knowledgeImpact })
    : null;
  state.lastDeletedNode = deletedNodeSnapshot(node);
  const deletedConnectionIds = await cleanupNodeConnections(node);
  await window.TrackerLensRuntimeGraphStore?.deleteRuntimeNodeReferences?.({
    nodeId: node.id,
    workspaceId: node.workspaceId || "",
  });
  await window.TrackerLensEventLogStore?.cleanupNodeReferences?.({
    nodeIds: [node.id],
    workspaceId: node.workspaceId || "",
  });
  await window.TrackerLensChannelRegistry?.cleanupNodeReferences?.({
    nodeId: node.id,
    workspaceId: node.workspaceId || "",
  });
  await recordFlowAction({
    workspaceId: node.workspaceId || "global",
    nodeId: node.id,
    level: "warning",
    message: `Runtime node deleted: ${node.label || node.id}`,
    context: {
      action: "runtime-node-deleted",
      nodeType: node.type || "",
      dependencies: state.lastDeletedNode?.dependencies?.length || 0,
      connections: deletedConnectionIds.length,
      knowledgeGraphMappingCleanup: knowledgeCleanup,
    },
  });

  setFocusState({ mode: "", nodeId: "", edgeId: "", nodeType: "", channel: "", connectionId: "" });
  closeDialog?.();
  await loadRuntime();
};

const performDraftNodeTreeDelete = async (node, closeDialog = null) => {
  if (!node?.id) return;
  const tree = downstreamNodeTree(node);
  const nodes = tree.nodes.length ? tree.nodes : [node];
  const nodeIds = nodes.map((item) => item.id);
  state.lastDeletedNode = deletedNodeTreeSnapshot(nodes, node);
  const deletedConnectionIds = await cleanupNodeTreeConnections(nodes);
  await Promise.all(nodes.map((item) => window.TrackerLensRuntimeGraphStore?.deleteRuntimeNodeReferences?.({
    nodeId: item.id,
    workspaceId: item.workspaceId || node.workspaceId || "",
  })));
  await window.TrackerLensEventLogStore?.cleanupNodeReferences?.({
    nodeIds,
    workspaceId: node.workspaceId || "",
  });
  await Promise.all(nodes.map((item) => window.TrackerLensChannelRegistry?.cleanupNodeReferences?.({
    nodeId: item.id,
    workspaceId: item.workspaceId || node.workspaceId || "",
  })));
  await recordFlowAction({
    workspaceId: node.workspaceId || "global",
    nodeId: node.id,
    level: "warning",
    message: `Runtime node tree deleted: ${node.label || node.id}`,
    context: {
      action: "runtime-node-tree-deleted",
      nodeType: node.type || "",
      nodes: nodeIds.length,
      dependencies: state.lastDeletedNode?.dependencies?.length || 0,
      connections: deletedConnectionIds.length,
    },
  });

  setFocusState({ mode: "", nodeId: "", edgeId: "", nodeType: "", channel: "", connectionId: "" });
  closeDialog?.();
  await loadRuntime();
};

const restoreLastDeletedNode = async () => {
  const snapshot = state.lastDeletedNode;
  if (!snapshot?.node) return;
  try {
    const nodes = snapshot.nodes?.length ? snapshot.nodes : [snapshot.node];
    await Promise.all(nodes.map((node) => window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode?.({ node })));
    if (window.TrackerLensRuntimeGraphStore?.upsertDependency) {
      await Promise.all((snapshot.dependencies || []).map((dependency) =>
        window.TrackerLensRuntimeGraphStore.upsertDependency({ dependency })));
    }
    await window.TrackerLensChannelRegistry?.restoreChannelRecords?.(snapshot.channels || []);
    setFocusState({
      mode: "dependencies",
      nodeId: snapshot.node.id,
      edgeId: "",
      nodeType: snapshot.node.type || "",
      channel: nodeChannels(snapshot.node)[0] || "",
      connectionId: "",
    });
    state.lastDeletedNode = null;
    await loadRuntime();
  } catch (error) {
    console.error("Errore ripristino runtime node:", error);
    state.error = error?.message || "Errore ripristino runtime node";
    mount();
  }
};

const requestDraftNodeDelete = async (node) => {
  if (!node?.id) return;
  const dependencies = selectedDependencies(node);
  const summary = dependencySummary(node, dependencies);
  const tree = downstreamNodeTree(node);
  const embeddedFlowMapAlias = isEmbeddedFlowMapNode(node);
  const childCount = Math.max(0, tree.nodes.length - 1);
  const treeDependencyIds = new Set();
  (state.runtime.dependencies || []).forEach((dependency) => {
    if (tree.ids.has(dependency.sourceNodeId) || tree.ids.has(dependency.targetNodeId)) treeDependencyIds.add(dependency.id);
  });
  const draft = isDraftNode(node);
  const knowledgeImpact = await knowledgeDocumentStoreImpactForDelete(node);
  const hasKnowledgeGraphMapping = knowledgeImpact.hasGraphMapping;
  const dialog = _.Dialog({
    class: "tl-flow-edge-delete-dialog",
    panelClass: "tl-flow-edge-delete-panel",
    size: "md",
    title: hasKnowledgeGraphMapping
      ? "Document Store con Knowledge Graph"
      : embeddedFlowMapAlias
        ? "Eliminare questo alias Flow Map?"
        : dependencies.length
          ? `${draft ? "Questo draft" : "Questo nodo"} ha dependency runtime`
          : `Eliminare questo ${draft ? "draft" : "nodo"}?`,
    subtitle: node.label || node.id,
    icon: "delete",
    closeButton: true,
    content: () => _.div(
      { class: "tl-flow-edge-delete-body" },
      _.p(hasKnowledgeGraphMapping
        ? "Questo Document Store ha documenti gia trasformati in chunk, entities, relations o snapshot del Knowledge Graph. Puoi cancellare solo il nodo oppure cancellare anche la mappatura generata."
        : embeddedFlowMapAlias
          ? "Verranno rimossi solo questo nodo virtuale e i suoi collegamenti. Il Flow Map sorgente non verra modificato."
          : dependencies.length
            ? "Questo nodo e usato nel runtime. La cancellazione pulira anche dependency, channel registry, flow references ed event logs collegati."
            : "Il nodo verra rimosso dalla Flow Map."),
      _.div(_.span("Node"), _.strong(node.label || node.id)),
      _.div(_.span("Type"), _.strong(node.type || "runtime")),
      _.div(_.span("Workspace"), _.strong(node.workspaceId || "global")),
      _.div(_.span("Dependencies"), _.strong(`${dependencies.length} total · ${summary.incoming} in · ${summary.outgoing} out`)),
      hasKnowledgeGraphMapping ? _.div(_.span("Documents"), _.strong(String(knowledgeImpact.documents.length))) : null,
      hasKnowledgeGraphMapping ? _.div(_.span("Graph mapping"), _.strong(`${knowledgeImpact.chunks.length} chunks · ${knowledgeImpact.entities.length} entities · ${knowledgeImpact.relations.length} relations`)) : null,
      hasKnowledgeGraphMapping && knowledgeImpact.dictionary.length ? _.div(_.span("Dictionary"), _.strong(`${knowledgeImpact.dictionary.length} entries`)) : null,
      hasKnowledgeGraphMapping && knowledgeImpact.metrics.length ? _.div(_.span("Snapshots"), _.strong(`${knowledgeImpact.metrics.length} records`)) : null,
      childCount && !embeddedFlowMapAlias ? _.div(_.span("Children tree"), _.strong(`${childCount} children · ${treeDependencyIds.size} linked dependencies`)) : null,
      dependencies.length ? _.section(
        { class: "tl-flow-delete-dependencies" },
        _.h3("Impacted Links"),
        ...dependencies.slice(0, 5).map((dependency) => {
          const row = dependencyRow(node, dependency);
          return _.div(
            _.span(`${row.direction} · ${row.peer}`),
            _.strong(row.channel)
          );
        })
      ) : null
    ),
    actions: ({ close }) => hasKnowledgeGraphMapping
      ? _.div(
        { class: "tl-flow-kdoc-delete-actions" },
        _.div(
          { class: "tl-flow-kdoc-delete-actions-main" },
          btn({ class: "is-ghost", onclick: close }, "Cancel"),
          btn({
            class: "tl-flow-delete-node-only",
            onclick: () => performDraftNodeDelete(node, close),
          }, icon("delete", "sm"), "Delete Node Only")
        ),
        _.div(
          { class: "tl-flow-kdoc-delete-actions-danger" },
          childCount && !embeddedFlowMapAlias ? btn({ class: "is-danger", onclick: () => performDraftNodeTreeDelete(node, close) }, icon("delete_sweep", "sm"), "Force Delete All Children") : null,
          btn({
            class: "is-danger tl-flow-delete-node-graph",
            onclick: () => performDraftNodeDelete(node, close, { cleanupKnowledgeGraphMapping: true, knowledgeImpact }),
          }, icon("delete_sweep", "sm"), "Delete Node + Graph Mapping")
        )
      )
      : _.Toolbar(
        { align: "end", gap: 8 },
        btn({ onclick: close }, "Cancel"),
        childCount && !embeddedFlowMapAlias ? btn({ class: "is-danger", onclick: () => performDraftNodeTreeDelete(node, close) }, icon("delete_sweep", "sm"), "Force Delete All Children") : null,
        btn({ class: "is-danger", onclick: () => performDraftNodeDelete(node, close) }, icon("delete", "sm"), embeddedFlowMapAlias ? "Delete Alias" : dependencies.length ? "Force Delete" : draft ? "Delete Draft" : "Delete Node")
      ),
  });
  dialog.open();
};

const persistNodeRuntimePatch = async ({ node, patch = {}, message = "Runtime node updated", action = "runtime-node-updated" } = {}) => {
  if (!node?.id) return null;
  const nextNode = {
    ...node,
    ...patch,
    metadata: {
      ...(node.metadata || {}),
      ...(patch.metadata || {}),
    },
    runtime: {
      ...(node.runtime || {}),
      ...(patch.runtime || {}),
    },
  };
  await window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode?.({ node: nextNode });
  await recordFlowAction({
    workspaceId: nextNode.workspaceId || "global",
    nodeId: nextNode.id,
    message,
    context: { action, nodeType: nextNode.type || "", status: nextNode.status || "" },
  });
  setFocusState({
    mode: "dependencies",
    nodeId: nextNode.id,
    edgeId: "",
    nodeType: nextNode.type || "",
    channel: nodeChannels(nextNode)[0] || "",
    connectionId: "",
  });
  await loadRuntime({ force: true });
  return nextNode;
};

const patchRuntimeNodeInMemory = (nextNode = {}) => {
  if (!nextNode?.id) return null;
  state.runtime = {
    ...state.runtime,
    nodes: (state.runtime.nodes || []).map((node) => node.id === nextNode.id ? nextNode : node),
  };
  setRuntimeSignal(state.runtime);
  return nextNode;
};

const persistNodeUiPatch = async ({ node, metadata = {}, message = "Runtime node UI updated", action = "runtime-node-ui-updated" } = {}) => {
  if (!node?.id) return null;
  const nextNode = {
    ...node,
    metadata: {
      ...(node.metadata || {}),
      ...metadata,
    },
  };
  patchRuntimeNodeInMemory(nextNode);
  refreshPortUiDom();
  try {
    await window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode?.({ node: nextNode });
    await recordFlowAction({
      workspaceId: nextNode.workspaceId || "global",
      nodeId: nextNode.id,
      message,
      context: { action, nodeType: nextNode.type || "" },
    });
  } catch (error) {
    console.error("Errore salvataggio UI runtime node:", error);
    state.error = error?.message || "Errore salvataggio UI runtime node";
    setErrorSignal(state.error);
    mount({ preserveScroll: true });
  }
  return nextNode;
};

const setNodeRuntimeStatus = async (node, status = "idle") => {
  const active = !["paused", "disabled", "disconnected", "error"].includes(status);
  await persistNodeRuntimePatch({
    node,
    patch: {
      status,
      runtime: { status, active },
      metadata: {
        runtimeStatus: status,
        disabled: status === "disabled",
        paused: status === "paused",
      },
    },
    message: `Runtime node status: ${node.label || node.id} -> ${status}`,
    action: "runtime-node-status",
  });
};

const pauseNodeRuntime = (node) => setNodeRuntimeStatus(node, "paused");
const resumeNodeRuntime = (node) => setNodeRuntimeStatus(node, "active");
const disableNodeRuntime = (node) => setNodeRuntimeStatus(node, "disabled");

const toggleNodeCollapse = async (node) => {
  await persistNodeRuntimePatch({
    node,
    patch: { metadata: { collapsed: !node.metadata?.collapsed } },
    message: `Runtime node ${node.metadata?.collapsed ? "expanded" : "collapsed"}: ${node.label || node.id}`,
    action: "runtime-node-collapse",
  });
};

const duplicateRuntimeNode = async (node) => {
  if (!node?.id) return;
  const now = Date.now();
  const position = node.flowPosition || node.position || { x: 240, y: 180, width: FLOW_NODE_DEFAULT_WIDTH };
  const clone = {
    ...JSON.parse(JSON.stringify(node)),
    id: `node_${now}`,
    sourceRef: node.sourceRef || node.id,
    label: `${node.label || node.id} Copy`,
    status: "idle",
    runtime: { ...(node.runtime || {}), status: "idle", active: false },
    flowPosition: {
      x: flowCoordinate(flowWorldNumber(position.x) + 80),
      y: flowCoordinate(flowWorldNumber(position.y) + 80),
      width: flowNodeWidth(position),
    },
    metadata: {
      ...(node.metadata || {}),
      duplicatedFrom: node.id,
      runtimeStatus: "idle",
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode?.({ node: clone });
  await recordFlowAction({
    workspaceId: clone.workspaceId || "global",
    nodeId: clone.id,
    message: `Runtime node duplicated: ${node.label || node.id}`,
    context: { action: "runtime-node-duplicated", sourceNodeId: node.id, nodeType: node.type || "" },
  });
  setFocusState({ mode: "dependencies", nodeId: clone.id, edgeId: "", nodeType: clone.type || "", channel: nodeChannels(clone)[0] || "", connectionId: "" });
  await loadRuntime({ force: true });
};

const requestNodeRename = (node) => {
  if (!node?.id) return;
  let formRef = null;
  const formId = `tl-flow-rename-${String(node.id).replace(/[^A-Za-z0-9_-]/g, "_")}`;
  const save = async (close) => {
    const label = readConfigField(formRef || document.getElementById(formId), "label", node.label || node.id);
    await persistNodeRuntimePatch({
      node,
      patch: { label },
      message: `Runtime node renamed: ${label}`,
      action: "runtime-node-renamed",
    });
    close?.();
  };
  const dialog = _.Dialog({
    class: "tl-flow-config-dialog",
    panelClass: "tl-flow-config-panel",
    size: "sm",
    title: "Rename Node",
    subtitle: node.label || node.id,
    icon: "drive_file_rename_outline",
    closeButton: true,
    content: () => _.form(
      {
        id: formId,
        class: "tl-flow-config-form",
        onsubmit: (event) => {
          event.preventDefault();
          save(() => dialog.close());
        },
      },
      _.label(
        { class: "tl-flow-config-field" },
        _.span("Node title"),
        _.input({ name: "label", value: node.label || node.id, autocomplete: "off" })
      )
    ),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: close }, "Cancel"),
      btn({ class: "st-btn-primary", onclick: () => save(close) }, icon("save", "sm"), "Rename")
    ),
  });
  dialog.open();
  formRef = document.getElementById(formId);
};

const viewEdgeNode = (node) => {
  if (!node) return;
  selectNode(node);
};

const connectionWorkspaceId = (source, target) => {
  const sourceWorkspace = source?.workspaceId === "library_local" ? "" : source?.workspaceId || "";
  const targetWorkspace = target?.workspaceId === "library_local" ? "" : target?.workspaceId || "";
  return normalizeRuntimeWorkspaceId(sourceWorkspace || targetWorkspace || workspaceForDraft());
};

const isUnmaterializedLibraryNode = (node = {}) =>
  Boolean(node?.metadata?.library);

const isWorkspaceBoxNode = (node = {}) =>
  ["boxTracker", "boxLens"].includes(node?.type) &&
  !isDraftNode(node) &&
  !node?.metadata?.library &&
  !String(node?.id || "").startsWith("draft_");

const shouldSyncWorkspaceContentLink = (source = {}, target = {}) =>
  isWorkspaceBoxNode(source) && isWorkspaceBoxNode(target);

const channelForConnection = (source, target) => {
  const sourceChannels = nodeChannels(source);
  const targetChannels = nodeChannels(target);
  return sourceChannels.find((channel) => targetChannels.includes(channel)) ||
    sourceChannels[0] ||
    targetChannels[0] ||
    (state.filters.channel !== "all" ? state.filters.channel : "") ||
    "default";
};

const normalizePortChannel = (channel = "") =>
  !channel || channel === "all" ? "" : channel;

const channelForPortConnection = (source, target, sourcePort = "", targetPort = "") => {
  const normalizedSourcePort = normalizePortChannel(sourcePort);
  const normalizedTargetPort = normalizePortChannel(targetPort);
  if (nodeSubtype(target) === "agent-bridge" && normalizedTargetPort && normalizedTargetPort !== AGENT_CONTROL_PORT_NAME) {
    return normalizedTargetPort;
  }
  return normalizedSourcePort ||
    channelForConnection(source, target) ||
    normalizedTargetPort ||
    "default";
};

const bestTargetPortForChannel = (target = {}, channel = "") => {
  if (!target?.id || !channel) return "all";
  const ports = nodePortLabels(target, "in");
  return ports.includes(channel) ? channel : "all";
};

const inputPortLabel = (node = {}) =>
  node?.inputs?.[0] || nodeChannels(node)[0] || "input";

const outputPortLabel = (node = {}) =>
  node?.outputs?.[0] || nodeChannels(node)[0] || "output";

const AGENT_CONTROL_PORT_NAME = "agent_control";
const AGENT_CONTROL_PORT_TYPE = "agent-control";
const AGENT_CONTROL_PORT = Object.freeze({
  name: AGENT_CONTROL_PORT_NAME,
  type: AGENT_CONTROL_PORT_TYPE,
  schema: null,
  required: false,
  virtual: true,
  description: "Hybrid IN/OUT control port for AI agents.",
});

const isAgentControlPort = (port = {}) =>
  port?.type === AGENT_CONTROL_PORT_TYPE || port?.name === AGENT_CONTROL_PORT_NAME;

const isAgentControlNode = (node = {}) =>
  nodeCategory(node) === "ai-agents" || nodeSubtype(node) === "agent-bridge";

const withAgentControlPort = (node = {}, side = "out", ports = []) => {
  if (!node?.id) return ports;
  if (ports.some(isAgentControlPort)) return ports;
  return [...ports, { ...AGENT_CONTROL_PORT, direction: side === "in" ? "in" : "out" }];
};

const valueType = (value) => {
  if (Array.isArray(value)) return "array";
  if (value && typeof value === "object") return "object";
  if (typeof value === "number") return Number.isInteger(value) ? "int" : "float";
  if (typeof value === "boolean") return "bool";
  if (typeof value === "string") {
    const numeric = Number(value);
    if (value.trim() !== "" && !Number.isNaN(numeric)) return Number.isInteger(numeric) ? "int" : "float";
    return "string";
  }
  return "any";
};

const normalizePortDef = (port = "", fallbackType = "any") => {
  if (port && typeof port === "object") {
    const name = port.name || port.key || port.channel || port.id || "default";
    return {
      name: String(name),
      type: port.type || port.valueType || fallbackType || "any",
      schema: port.schema || port.payloadSchema || null,
      required: Boolean(port.required),
    };
  }
  return { name: String(port || "default"), type: fallbackType || "any", schema: null, required: false };
};

const inferPortType = (node = {}, side = "out", name = "") => {
  const category = nodeCategory(node);
  const subtype = nodeSubtype(node);
  const lowerName = String(name || "").toLowerCase();
  if (lowerName === "all") return side === "in" ? "any" : "object";
  if (lowerName === AGENT_CONTROL_PORT_NAME || lowerName === "agent-control") return AGENT_CONTROL_PORT_TYPE;
  if (["true", "false"].includes(lowerName)) return "event";
  if (lowerName === "event") return "event";
  if (["image", "thumbnail", "preview"].includes(lowerName)) return "image";
  if (["audio", "sound", "voice"].includes(lowerName)) return "audio";
  if (["file", "document", "blob"].includes(lowerName)) return "file";
  if (["files", "attachments"].includes(lowerName)) return "array";
  if (["input", "output", "raw", "record", "state", "channel"].includes(lowerName)) return "object";
  if (category === "sources") return side === "out" ? "object" : "never";
  if (category === "trackers") return "object";
  if (category === "processors") return subtype === "condition" && side === "out" ? "bool" : "object";
  if (category === "knowledge") return "object";
  if (category === "ai-agents") return side === "out" ? "object" : "object";
  if (category === "lens") return side === "in" ? "any" : "object";
  if (category === "actions") return "object";
  if (category === "storage") return "object";
  if (category === "dev") return side === "in" ? "any" : "object";
  return "any";
};

const declaredPortDefs = (node = {}, side = "out") => {
  const manifest = node.metadata?.manifest || {};
  const values = side === "in"
    ? (manifest.inputs?.length ? manifest.inputs : node.inputs || [])
    : (manifest.outputs?.length ? manifest.outputs : node.outputs || []);
  return (values || [])
    .filter(Boolean)
    .map((port) => {
      const normalized = normalizePortDef(port, inferPortType(node, side, typeof port === "object" ? port.name || port.key : port));
      return {
        ...normalized,
        type: normalized.type || inferPortType(node, side, normalized.name),
      };
    });
};

const normalizeAiAgentTaskPort = (node = {}, side = "in", port = {}) => {
  if (side !== "in" || nodeCategory(node) !== "ai-agents" || nodeSubtype(node) === "orchestrator") return port;
  return String(port.name || "").toLowerCase() === "input"
    ? { ...port, name: "task", legacyName: port.name || "input" }
    : port;
};

const sampleOutputFields = (node = {}) => {
  const sample = node?.metadata?.sampleOutput;
  if (!sample || typeof sample !== "object" || Array.isArray(sample)) return [];
  return Object.entries(sample)
    .map(([name, value]) => ({ name, type: valueType(value) }));
};

const nodePorts = (node = {}, side = "out") => {
  if (!node?.id) return [{ name: "all", type: side === "in" ? "any" : "object" }];
  if (isFlowBoundaryNode(node)) {
    return side === flowPortDirection(node) ? flowPortDefinitions(node) : [];
  }
  if (isEmbeddedFlowMapNode(node)) {
    const metadataPorts = side === "in" ? node.metadata?.inputPorts : node.metadata?.outputPorts;
    const declaredPorts = side === "in" ? node.inputs : node.outputs;
    const source = Array.isArray(metadataPorts) && metadataPorts.length ? metadataPorts : declaredPorts || [];
    const unique = new Map();
    source
      .filter(Boolean)
      .map((port) => normalizePortDef(port, inferPortType(node, side, typeof port === "object" ? port.name || port.key : port)))
      .forEach((port) => {
        if (!port.name || port.name === "all" || unique.has(port.name)) return;
        unique.set(port.name, port);
      });
    const ports = [...unique.values()];
    return ports.length
      ? [normalizePortDef({ name: "all", type: side === "in" ? "any" : "object" }, side === "in" ? "any" : "object"), ...ports]
      : [];
  }
  if (nodeSubtype(node) === "agent-bridge") {
    return side === "in"
      ? [
        { ...AGENT_CONTROL_PORT, direction: "in" },
        normalizePortDef({ name: "listening", type: "object", description: "Listen for the final response" }, "object"),
      ]
      : [
        normalizePortDef({ name: "action", type: "object", description: "Send payload to the controlled node" }, "object"),
      ];
  }
  if (side === "in" && nodeCategory(node) === "sources") {
    const isCustomSource = Boolean(node.metadata?.customNode || node.metadata?.paletteAction === "node-builder" || node.type === "custom");
    const manifestInputs = node.metadata?.manifest?.inputs || [];
    const sourceInputs = isCustomSource && Array.isArray(node.inputs) && node.inputs.length
      ? node.inputs
      : manifestInputs;
    const legacyDataInputs = new Set(["all", "raw", "input", "output", "channel"]);
    const declared = sourceInputs
      .map((port) => normalizePortDef(port, inferPortType(node, "in", typeof port === "object" ? port.name || port.key : port)))
      .filter((port) => isCustomSource || !legacyDataInputs.has(String(port.name || "").toLowerCase()));
    const ports = declared.length ? declared : sourceConfigInputPorts(nodeSubtype(node));
    const unique = new Map();
    ports
      .map((port) => normalizePortDef(port, inferPortType(node, "in", port.name || port.key || port)))
      .forEach((port) => {
        if (!port.name || unique.has(port.name)) return;
        unique.set(port.name, port);
      });
    return withAgentControlPort(node, "in", [...unique.values()]);
  }
  if (side === "out") {
    const fields = sampleOutputFields(node);
    if (fields.length) return withAgentControlPort(node, side, [{ name: "all", type: "object" }, ...fields]);
  }
  const declared = declaredPortDefs(node, side);
  const values = declared.length
    ? declared
    : (side === "in"
      ? (node.inputs?.length ? node.inputs : nodeChannels(node))
      : (node.outputs?.length ? node.outputs : nodeChannels(node)))
      .filter(Boolean)
      .map((name) => normalizePortDef(name, inferPortType(node, side, name)));
  const ports = values.length ? values : [normalizePortDef(side === "in" ? inputPortLabel(node) : outputPortLabel(node), inferPortType(node, side))];
  const unique = new Map();
  ports.forEach((port) => {
    const normalizedPort = normalizeAiAgentTaskPort(node, side, port);
    if (!normalizedPort.name || unique.has(normalizedPort.name)) return;
    unique.set(normalizedPort.name, { ...normalizedPort, type: normalizedPort.type || inferPortType(node, side, normalizedPort.name) });
  });
  return withAgentControlPort(node, side, [{ name: "all", type: side === "in" ? "any" : "object" }, ...unique.values()]);
};

const nodePortLabels = (node = {}, side = "out") => {
  return nodePorts(node, side).map((port) => port.name);
};

const portDisplayLabel = (port = {}, side = "out", ports = []) => {
  if (port.name !== "all") return port.name;
  return side === "in" ? `${ports.length} in` : `${ports.length} out`;
};

const portInlineLabel = (port = {}, side = "out", ports = []) => {
  if (isAgentControlPort(port)) return "";
  const label = port.name === "all" ? "all" : portDisplayLabel(port, side, ports);
  return label.length > 12 ? `${label.slice(0, 10)}...` : label;
};

const portTooltip = (port = {}, side = "out", ports = []) => {
  if (isAgentControlPort(port)) return `${side === "in" ? "Agent Control IN" : "Agent Control OUT"}: accepts AI agent control links`;
  const label = port.name === "all" ? "all" : portDisplayLabel(port, side, ports);
  return label.length > 12 ? `${side === "in" ? "Input" : "Output"}: ${label} (${port.type || "any"})` : "";
};

const portByName = (node = {}, side = "out", portName = "all") =>
  nodePorts(node, side).find((port) => port.name === portName) || nodePorts(node, side)[0] || { name: "all", type: "any" };

const connectionValidationMessage = (validation = {}, source = {}, target = {}) => {
  const reason = validation.reason || "porte non compatibili";
  const sourcePort = validation.sourcePort;
  const targetPort = validation.targetPort;
  const route = `${source?.label || source?.id || "Source"} -> ${target?.label || target?.id || "Target"}`;
  const ports = sourcePort && targetPort
    ? ` (${sourcePort.name}:${sourcePort.type || "any"} -> ${targetPort.name}:${targetPort.type || "any"})`
    : "";
  const hint = validation.hint ? ` Suggerimento: ${validation.hint}` : "";
  return `Link non valido: ${route}${ports}. ${reason}.${hint}`;
};

const normalizedPortType = (type = "any") => {
  if (["int", "float", "number"].includes(type)) return "number";
  if (["object", "array"].includes(type)) return "object";
  return type || "any";
};

const portsAreCompatible = (sourcePort = {}, targetPort = {}, target = {}, source = {}) => {
  const sourceType = normalizedPortType(sourcePort.type);
  const targetType = normalizedPortType(targetPort.type);
  if (sourceType === AGENT_CONTROL_PORT_TYPE || targetType === AGENT_CONTROL_PORT_TYPE) {
    return sourceType === AGENT_CONTROL_PORT_TYPE && targetType === AGENT_CONTROL_PORT_TYPE;
  }
  if (sourceType === "never" || targetType === "never") return false;
  if (sourceType === "any" || targetType === "any") return true;
  if (sourceType === targetType) return true;
  if (sourceType === "event" && targetType === "object") return true;
  if (sourceType === "object" && targetType === "event") return true;
  return ["processor", "knowledge", "aiAgent", "action", "devPreview"].includes(target.type) && targetType !== "never" && sourceType !== "bool";
};

const connectionValidation = (source, target, sourcePortName = "all", targetPortName = "all") => {
  if (!source?.id || !target?.id) return { ok: false, reason: "missing node" };
  if (source.id === target.id) return { ok: false, reason: "same node" };
  const sourcePorts = nodePorts(source, "out");
  const targetPorts = nodePorts(target, "in");
  if (!sourcePorts.length) return { ok: false, reason: `${source.label || source.id} has no output ports`, hint: "usa un nodo Source, Tracker, Processor o AI come sorgente" };
  if (!targetPorts.length) return { ok: false, reason: `${target.label || target.id} has no input ports`, hint: "collega verso un Processor, AI Agent, Lens, Action o Storage" };
  const requestedSourcePort = sourcePortName || "all";
  const requestedTargetPort = targetPortName || "all";
  const sourcePort = sourcePorts.find((port) => port.name === requestedSourcePort);
  const targetPort = targetPorts.find((port) => port.name === requestedTargetPort);
  if (!sourcePort) {
    return { ok: false, reason: `output port "${requestedSourcePort}" does not exist on ${source.label || source.id}`, hint: "usa una porta output visibile o riconfigura gli outputs del nodo" };
  }
  if (!targetPort) {
    return { ok: false, reason: `input port "${requestedTargetPort}" does not exist on ${target.label || target.id}`, sourcePort, hint: "rilascia su una porta input compatibile o riconfigura gli inputs del nodo" };
  }
  if (!portsAreCompatible(sourcePort, targetPort, target, source)) {
    return { ok: false, reason: `Incompatible ports: ${sourcePort.name}:${sourcePort.type || "any"} -> ${targetPort.name}:${targetPort.type || "any"}`, sourcePort, targetPort, hint: "usa una porta con tipo compatibile o passa da un Processor Transform/Formatter" };
  }
  const channel = channelForPortConnection(source, target, sourcePortName, targetPortName);
  const isAgentControlLink = isAgentControlPort(sourcePort) || isAgentControlPort(targetPort);
  const duplicate = state.runtime.dependencies.some((dependency) =>
    dependency.sourceNodeId === source.id &&
    dependency.targetNodeId === target.id &&
    (dependency.channel || "runtime") === channel);
  if (duplicate) return { ok: false, reason: "duplicate link", sourcePort, targetPort, hint: "seleziona il collegamento esistente o usa un channel/porta diversa" };
  if (isAgentControlLink) return { ok: true, reason: "", channel, sourcePort, targetPort };
  const engineValidation = window.TrackerLensGraphEngine?.validateConnection?.({
    source,
    target,
    channel,
    dependencies: state.runtime.dependencies || [],
  });
  if (engineValidation && !engineValidation.ok) {
    return { ok: false, reason: engineValidation.errors[0] || "invalid graph link", sourcePort, targetPort, hint: "controlla il tab Compatibility del Node Inspector" };
  }
  return { ok: true, reason: "", channel, sourcePort, targetPort };
};

const normalizeRuntimeLinkMapping = (mapping = {}) =>
  window.TrackerLensRuntimeContract?.normalizeConnectionMapping
    ? window.TrackerLensRuntimeContract.normalizeConnectionMapping(mapping)
    : {
      sourcePort: mapping.sourcePort || "all",
      targetPort: mapping.targetPort || "all",
      channel: mapping.channel || "",
      mode: mapping.mode || "pass-through",
      payloadPath: mapping.payloadPath || "",
      transform: mapping.transform || "",
      note: mapping.note || "",
      linkType: mapping.linkType || "data",
    };

const saveRuntimeLinkMapping = async ({ edge = null, source = null, target = null, mapping = {} } = {}) => {
  if (!edge?.id && !edge?.connectionId) return null;
  const now = new Date().toISOString();
  const normalized = normalizeRuntimeLinkMapping({
    ...(edge.mapping || {}),
    ...(edge.metadata || {}),
    ...mapping,
  });
  const workspaceId = normalizeRuntimeWorkspaceId(edge.workspaceId || source?.workspaceId || target?.workspaceId || state.filters.workspaceId || "workspace_global");
  let savedConnection = null;

  if (edge.connectionId && window.TrackerLensConnectionsStore?.upsert) {
    const existingConnection = (state.connections || []).find((connection) => connection.id === edge.connectionId) || null;
    savedConnection = {
      ...(existingConnection?.raw || existingConnection || {}),
      id: edge.connectionId,
      workspaceId,
      updatedAt: now,
      sourceNodeId: edge.sourceNodeId || source?.id || existingConnection?.sourceNodeId || existingConnection?.fromBoxId || "",
      targetNodeId: edge.targetNodeId || target?.id || existingConnection?.targetNodeId || existingConnection?.toBoxId || "",
      fromBoxId: edge.sourceNodeId || source?.id || existingConnection?.fromBoxId || "",
      toBoxId: edge.targetNodeId || target?.id || existingConnection?.toBoxId || "",
      channel: normalized.channel || edge.channel || existingConnection?.channel || "runtime",
      mapping: normalized,
    };
    await window.TrackerLensConnectionsStore.upsert(savedConnection);
  }

  const dependency = {
    ...edge,
    workspaceId,
    channel: normalized.channel || edge.channel || "runtime",
    metadata: {
      ...(edge.metadata || {}),
      source: edge.metadata?.source || "flow-map",
      ...normalized,
    },
    updatedAt: now,
  };
  await window.TrackerLensRuntimeGraphStore?.upsertDependency?.({ dependency });
  state.runtime.dependencies = (state.runtime.dependencies || []).map((item) =>
    item.id === dependency.id ? dependency : item
  );
  if (savedConnection) {
    state.connections = [
      ...(state.connections || []).filter((item) => item.id !== savedConnection.id),
      savedConnection,
    ];
  }
  await recordFlowAction({
    workspaceId,
    connectionId: edge.connectionId || edge.id,
    level: "info",
    message: `Runtime link mapping updated: ${source?.label || edge.sourceNodeId || "source"} -> ${target?.label || edge.targetNodeId || "target"}`,
    context: {
      action: "runtime-link-mapping-updated",
      dependencyId: edge.id || "",
      connectionId: edge.connectionId || "",
      sourceNodeId: edge.sourceNodeId || "",
      targetNodeId: edge.targetNodeId || "",
      mapping: normalized,
    },
  });
  await loadRuntime({ force: true, silent: true });
  const refreshed = (state.runtime.dependencies || []).find((item) => item.id === edge.id) || dependency;
  selectEdge(refreshed);
  mount({ preserveScroll: true });
  return refreshed;
};

const requestRuntimeLinkMappingDialog = ({ source, target, validation, sourcePort = "all", targetPort = "all", channel = "runtime", edge = null, initialMapping = null } = {}) => {
  const formId = `tl-flow-link-map-${Date.now()}`;
  let formRef = null;
  const editing = Boolean(edge?.id || edge?.connectionId);
  const currentMapping = normalizeRuntimeLinkMapping({
    sourcePort,
    targetPort,
    channel,
    ...(initialMapping || {}),
    ...(edge?.mapping || {}),
    ...(edge?.metadata || {}),
  });
  const sourcePortLabel = `${validation.sourcePort?.name || sourcePort}:${validation.sourcePort?.type || "any"}`;
  const targetPortLabel = `${validation.targetPort?.name || targetPort}:${validation.targetPort?.type || "any"}`;
  const read = (name, fallback = "") => {
    const root = formRef || document.getElementById(formId);
    const field = root?.querySelector?.(`[data-mapping-key="${name}"], [name="${name}"]`);
    const value = field?.value ?? field?.textContent ?? "";
    return String(value).trim() || fallback;
  };
  const validateMappingDraft = (mapping = {}) => {
    if (mapping.mode === "json-map") {
      if (!mapping.transform) return "json-map richiede un oggetto JSON nel campo Transform / mapping.";
      try {
        const parsed = JSON.parse(mapping.transform);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return "json-map deve essere un oggetto JSON, per esempio { \"prezzo\": \"prova\" }.";
        }
      } catch (error) {
        return `json-map non valido: ${error.message || error}`;
      }
    }
    if (mapping.mode === "template" && !mapping.transform) {
      return "template richiede un testo nel campo Transform / mapping.";
    }
    return "";
  };
  const dialog = _.Dialog({
    class: "tl-flow-config-dialog",
    panelClass: "tl-flow-config-panel",
    title: "Connection Mapping",
    subtitle: `${source?.label || source?.id || "Source"} -> ${target?.label || target?.id || "Target"}`,
    icon: "route",
    closeButton: true,
    content: () => {
      formRef = _.form(
        {
          id: formId,
          class: "tl-flow-config-grid",
          onsubmit: async (event) => {
            event.preventDefault();
            const mapping = normalizeRuntimeLinkMapping({
              sourcePort,
              targetPort,
              channel,
              mode: read("mode", "pass-through"),
              payloadPath: read("payloadPath", ""),
              transform: read("transform", ""),
              note: read("note", ""),
              linkType: read(
                "linkType",
                currentMapping.linkType ||
                  (validation.sourcePort?.type === AGENT_CONTROL_PORT_TYPE || validation.targetPort?.type === AGENT_CONTROL_PORT_TYPE
                    ? AGENT_CONTROL_PORT_TYPE
                    : "data")
              ),
            });
            dialog.close();
            try {
              if (editing) {
                await saveRuntimeLinkMapping({ edge, source, target, mapping });
                return;
              }
              await createRuntimeLink(source, target, { sourcePort, targetPort, mapping, configure: false });
            } catch (error) {
              state.error = error?.message || "Mapping non salvato.";
              mount({ preserveScroll: true });
            }
          },
        },
        _.label(
          { class: "tl-flow-config-field" },
          _.span("Source port"),
          _.input({ value: sourcePortLabel, disabled: true })
        ),
        _.label(
          { class: "tl-flow-config-field" },
          _.span("Target port"),
          _.input({ value: targetPortLabel, disabled: true })
        ),
        _.label(
          { class: "tl-flow-config-field" },
          _.span("Channel"),
          _.input({ value: currentMapping.channel || channel, disabled: true })
        ),
        _.label(
          { class: "tl-flow-config-field" },
          _.span("Mapping mode"),
          _.select(
            { name: "mode", "data-mapping-key": "mode", value: currentMapping.mode || "pass-through" },
            ...["pass-through", "path", "json-map", "template", "custom-transform"].map((mode) =>
              _.option({ value: mode, selected: mode === (currentMapping.mode || "pass-through") }, mode))
          )
        ),
        _.label(
          { class: "tl-flow-config-field" },
          _.span("Link role"),
          _.select(
            {
              name: "linkType",
              "data-mapping-key": "linkType",
              value: currentMapping.linkType || "data",
            },
            ...[
              ["data", "Data flow"],
              ["tool-access", "Agent tool access"],
              ["optional-hint", "Optional hint"],
              ["rebuild-trigger", "Rebuild trigger"],
              [AGENT_CONTROL_PORT_TYPE, "Agent control"],
            ].map(([value, label]) =>
              _.option({ value, selected: value === (currentMapping.linkType || "data") }, label))
          )
        ),
        _.label(
          { class: "tl-flow-config-field is-wide" },
          _.span("Payload path"),
          _.input({ name: "payloadPath", "data-mapping-key": "payloadPath", value: currentMapping.payloadPath || "", placeholder: "payload.data.price oppure lascia vuoto per payload completo", autocomplete: "off" })
        ),
        _.label(
          { class: "tl-flow-config-field is-wide" },
          _.span("Transform / mapping"),
          _.textarea({
            name: "transform",
            "data-mapping-key": "transform",
            value: currentMapping.transform || "",
            rows: 5,
            placeholder: "{ \"prezzo\": \"prova\", \"symbol\": \"data.s\", \"price\": \"number:data.c\" }",
          }, currentMapping.transform || "")
        ),
        _.label(
          { class: "tl-flow-config-field is-wide" },
          _.span("Note"),
          _.input({ name: "note", "data-mapping-key": "note", value: currentMapping.note || "", placeholder: "Intento del mapping o vincoli runtime", autocomplete: "off" })
        )
      );
      return formRef;
    },
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: close }, "Cancel"),
      btn({
        onclick: () => {
          formRef?.requestSubmit?.();
        },
      }, icon("save", "sm"), editing ? "Save Mapping" : "Create Link")
    ),
  });
  dialog.open();
};

const startLinkFromNode = (node) => {
  if (!node?.id) return;
  state.linkingSourceId = node.id;
  mount();
};

const cancelLinkMode = () => {
  state.linkingSourceId = "";
  state.linkingPort = "";
  state.linkHoverTargetId = "";
  state.linkHoverPort = "";
  mount();
};

const createRuntimeLink = async (source, target, options = {}) => {
  const scopedWorkspaceId = await ensureRuntimeWorkspaceScope();
  if (!source || !target?.id || source.id === target.id) {
    state.error = !source
      ? "Link non creato: nodo sorgente non trovato."
      : !target?.id
        ? "Link non creato: rilascia il collegamento sopra un nodo target."
        : "Link non creato: non puoi collegare un nodo a se stesso.";
    mount();
    return;
  }
  const sourcePort = options.sourcePort || state.linkingPort || "all";
  const targetPort = options.targetPort || "all";
  const now = new Date().toISOString();
  const workspaceId = normalizeRuntimeWorkspaceId(connectionWorkspaceId(source, target) || scopedWorkspaceId);
  const channel = channelForPortConnection(source, target, sourcePort, targetPort);
  const existing = state.runtime.dependencies.find((dependency) =>
    dependency.sourceNodeId === source.id &&
    dependency.targetNodeId === target.id &&
    (dependency.channel || "runtime") === channel);
  if (existing) {
    state.linkingSourceId = "";
    selectEdge(existing);
    return;
  }
  const validation = connectionValidation(source, target, sourcePort, targetPort);
  if (!validation.ok) {
    await recordFlowAction({
      workspaceId,
      nodeId: target.id,
      level: "warning",
      message: connectionValidationMessage(validation, source, target),
      context: {
        action: "flow-map-link-blocked",
        sourceNodeId: source.id,
        targetNodeId: target.id,
        sourcePort,
        targetPort,
        channel,
        reason: validation.reason || "",
        hint: validation.hint || "",
        sourcePortType: validation.sourcePort?.type || "",
        targetPortType: validation.targetPort?.type || "",
      },
    });
    state.error = connectionValidationMessage(validation, source, target);
    state.activeStatusPanel = "logs";
    mount();
    return;
  }
  const agentControlLink = validation.sourcePort?.type === AGENT_CONTROL_PORT_TYPE || validation.targetPort?.type === AGENT_CONTROL_PORT_TYPE;
  if (options.configure !== false && !options.mapping && !agentControlLink) {
    requestRuntimeLinkMappingDialog({ source, target, validation, sourcePort, targetPort, channel });
    return;
  }
  const linkMapping = normalizeRuntimeLinkMapping({
    sourcePort,
    targetPort,
    channel,
    ...(options.mapping || {}),
    linkType: options.mapping?.linkType || (agentControlLink ? AGENT_CONTROL_PORT_TYPE : "data"),
  });
  const connectionId = `flow_conn_${Date.now()}`;
  const connection = {
    id: connectionId,
    name: `${source.label || source.id} -> ${target.label || target.id}`,
    type: `${source.type || "node"} -> ${target.type || "node"}`,
    from: source.label || source.id,
    fromKind: source.type || "node",
    to: target.label || target.id,
    targetMeta: target.sourceRef || target.assetId || target.id,
    status: "active",
    lastTest: "Mai",
    result: "Creato dalla Flow Map",
    method: "EVENT",
    frequency: channel,
    timeout: "10 secondi",
    retries: 0,
    createdAt: now,
    updatedAt: now,
    endpoint: `flowmap://${workspaceId}/${connectionId}`,
    workspaceId,
    workspaceName: workspaceId,
    fromBoxId: source.id,
    toBoxId: target.id,
    sourceNodeId: source.id,
    targetNodeId: target.id,
    sourceName: source.label || source.id,
    targetName: target.label || target.id,
    channel,
    mapping: linkMapping,
  };
  let runtimeConnection = connection;
  let workspaceSync = null;

  try {
    if (window.TrackerLensConnectionsStore?.upsertLibraryTrackerWorkspaceLink && isUnmaterializedLibraryNode(source)) {
      workspaceSync = await window.TrackerLensConnectionsStore.upsertLibraryTrackerWorkspaceLink({ source, target, connection });
      if (!workspaceSync?.connection) {
        throw new Error("Collegamento Library non materializzato nel workspace.");
      }
      runtimeConnection = workspaceSync?.connection || connection;
    } else if (shouldSyncWorkspaceContentLink(source, target) && window.TrackerLensConnectionsStore?.upsertAndSyncWorkspace) {
      await window.TrackerLensConnectionsStore.upsertAndSyncWorkspace(connection);
    } else {
      await window.TrackerLensConnectionsStore?.upsert?.(connection);
    }
    const dependency = {
      id: `dep_${workspaceId}_${runtimeConnection.id || connectionId}`.replace(/[^A-Za-z0-9_-]/g, "_"),
      workspaceId,
      sourceNodeId: runtimeConnection.fromBoxId || source.id,
      targetNodeId: runtimeConnection.toBoxId || target.id,
      sourceType: source.type || "node",
      targetType: target.type || "node",
      channel: runtimeConnection.channel || channel,
      connectionId: runtimeConnection.id || connectionId,
      status: "active",
      metadata: {
        source: "flow-map",
        ...linkMapping,
        sourceHandleSide: options.sourceHandleSide || "",
        sourceHandleCorner: options.sourceHandleCorner || "",
      },
      createdAt: now,
      updatedAt: now,
    };
    if (workspaceSync?.workspace && window.TrackerLensRuntimeGraphStore?.syncWorkspaceGraph) {
      await window.TrackerLensRuntimeGraphStore.syncWorkspaceGraph({
        workspace: workspaceSync.workspace,
        boxes: workspaceSync.boxes || [],
        connections: workspaceSync.connections || [],
      });
    }
    await window.TrackerLensRuntimeGraphStore?.upsertDependency?.({ dependency });
    state.optimisticDependencies = [
      dependency,
      ...(state.optimisticDependencies || []).filter((item) => dependencyKey(item) !== dependencyKey(dependency)),
    ].slice(0, 20);
    state.runtime.dependencies = [
      ...(state.runtime.dependencies || []).filter((item) => item.id !== dependency.id),
      dependency,
    ];
    state.connections = [
      ...(state.connections || []).filter((item) => item.id !== (runtimeConnection.id || connectionId)),
      runtimeConnection,
    ];
    await recordFlowAction({
      workspaceId,
      connectionId: runtimeConnection.id || connectionId,
      message: `Runtime link created: ${runtimeConnection.name || connection.name}`,
      context: {
        action: "runtime-link-created",
        sourceNodeId: runtimeConnection.fromBoxId || source.id,
        targetNodeId: runtimeConnection.toBoxId || target.id,
        sourcePort,
        targetPort,
        channel: runtimeConnection.channel || channel,
      },
    });
    state.linkingSourceId = "";
    state.linkingPort = "";
    setFocusState({
      mode: "edge",
      nodeId: "",
      edgeId: dependency.id,
      nodeType: "",
      channel: runtimeConnection.channel || channel,
      connectionId: runtimeConnection.id || connectionId,
    });
    await loadRuntime({ force: true });
    const loadedDependency = state.runtime.dependencies.find((item) => item.id === dependency.id);
    if (!loadedDependency) {
      state.runtime.dependencies = [
        ...(state.runtime.dependencies || []),
        dependency,
      ];
      state.connections = [
        ...(state.connections || []).filter((item) => item.id !== (runtimeConnection.id || connectionId)),
        runtimeConnection,
      ];
      setRuntimeSignal(state.runtime);
      mount();
    }
  } catch (error) {
    console.error("Errore creazione collegamento Flow Map:", error);
    state.error = error?.message || "Errore creazione collegamento Flow Map";
    mount();
  }
};
