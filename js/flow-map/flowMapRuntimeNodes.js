// Flow Map runtime node configuration, custom node forms and graph links.
// Extracted from js/flowMapView.js; loaded in order by flowMap.html.
const nodeBadges = (node = {}, live = null) => {
  const badges = [];
  const sandbox = nodeSandboxReport(node);
  const perf = nodePerformance(node);
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
  if (node?.type === "aiAgent" && nodeSubtype(node) === "orchestrator" && !node.metadata?.library) {
    requestOrchestratorAgentConfig(node);
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
      btn({ type: "button", class: "is-primary", onclick: () => save(close) }, icon("save", "sm"), existing ? "Salva" : "Aggiungi")
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

const flattenRuntimeConfig = (config = {}) => {
  const source = config && typeof config === "object" && !Array.isArray(config) ? { ...config } : {};
  const nested = parseConfigObject(source.config);
  if (!nested) return source;
  delete source.config;
  return { ...source, ...flattenRuntimeConfig(nested) };
};

const readConfigMap = (form) => {
  const config = {};
  Array.from(form?.querySelectorAll?.("[data-config-key]") || []).forEach((field) => {
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
  return flattenRuntimeConfig(config);
};

const runtimeContractSchemaFields = (schema = {}) =>
  window.TrackerLensRuntimeContract?.normalizeSettingsSchema
    ? window.TrackerLensRuntimeContract.normalizeSettingsSchema(schema)
    : Object.entries(schema || {}).map(([key, type]) => ({ key, label: key, type: String(type || "string") }));

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
  const schemaFields = runtimeContractSchemaFields(schema);
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
      return mergeSchemaFields([
        { key: "json", label: "JSON Payload", type: "textarea", placeholder: "{ \"mela\": \"prova\" } oppure {mela:'prova'}" },
        { key: "emitChannel", label: "Emit channel", placeholder: "raw" },
      ]);
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
    if (subtype === "embedding-generator" || subtype === "vector-memory") {
      return [
        { key: "providerProfile", label: "Provider profile", placeholder: "local-hash, local_ollama, local_lm_studio" },
        { key: "model", label: "Model", placeholder: "tl-local-hash-v1" },
        { key: "dimensions", label: "Dimensions", placeholder: "96" },
        { key: "collectionId", label: "Collection ID", placeholder: "knowledge_sample_current" },
        { key: "outputChannel", label: "Output channel", placeholder: "knowledge.embedding.created" },
      ];
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
      return [
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
        { key: "relationType", label: "Relation type", placeholder: "co_occurs" },
        { key: "collectionId", label: "Collection ID", placeholder: "knowledge_sample_current" },
        { key: "outputChannel", label: "Output channel", placeholder: "knowledge.entity.created" },
      ];
    }
    if (subtype === "knowledge-dictionary-builder") {
      return [
        { key: "scope", label: "Dictionary scope", type: "select", options: ["document", "collection", "workspace"], defaultValue: "document" },
        { key: "language", label: "Language", placeholder: "auto, it, en, es, fr, de" },
        { key: "maxTerms", label: "Max terms", placeholder: "120" },
        { key: "minFrequency", label: "Min frequency", placeholder: "1" },
        { key: "previewTerms", label: "Preview terms", placeholder: "16" },
        { key: "previewIds", label: "Preview IDs", placeholder: "40" },
        { key: "replaceExisting", label: "Replace document dictionary", type: "checkbox", defaultValue: true },
        { key: "documentId", label: "Document ID", placeholder: "optional" },
        { key: "collectionId", label: "Collection ID", placeholder: "knowledge_sample_current" },
        { key: "outputChannel", label: "Output channel", placeholder: "knowledge.dictionary.updated" },
      ];
    }
    if (subtype === "knowledge-event-builder") {
      return [
        { key: "extractionMode", label: "Extraction mode", type: "select", options: ["rules", "ai", "hybrid"], defaultValue: "rules" },
        { key: "providerProfile", label: "Provider profile", placeholder: "optional for ai/hybrid" },
        { key: "model", label: "Model", placeholder: "optional" },
        { key: "maxEvents", label: "Max events", placeholder: "80" },
        { key: "confidenceThreshold", label: "Confidence threshold", placeholder: "0.55" },
        { key: "previewEvents", label: "Preview events", placeholder: "16" },
        { key: "previewIds", label: "Preview IDs", placeholder: "60" },
        { key: "replaceExisting", label: "Replace document events", type: "checkbox", defaultValue: true },
        { key: "documentId", label: "Document ID", placeholder: "optional" },
        { key: "collectionId", label: "Collection ID", placeholder: "knowledge_sample_current" },
        { key: "outputChannel", label: "Output channel", placeholder: "knowledge.events.updated" },
      ];
    }
    if (subtype === "knowledge-graph") {
      return [
        { key: "graphScope", label: "Graph scope", type: "select", options: ["workspace", "document", "collection"] },
        { key: "documentId", label: "Document ID", placeholder: "optional" },
        { key: "collectionId", label: "Collection ID", placeholder: "knowledge_sample_current" },
        { key: "topEntities", label: "Top entities", placeholder: "12" },
        { key: "maxRelations", label: "Max relations", placeholder: "24" },
        { key: "outputChannel", label: "Output channel", placeholder: "knowledge.graph.updated" },
      ];
    }
    if (subtype === "semantic-relation-enricher") {
      return [
        { key: "enrichmentMode", label: "Enrichment mode", type: "select", options: ["rules", "ai", "hybrid"], defaultValue: "rules" },
        { key: "providerProfile", label: "Provider profile", placeholder: "local_ollama, local_lm_studio" },
        { key: "model", label: "Model", placeholder: "local-model" },
        { key: "maxRelations", label: "Max semantic relations", placeholder: "48" },
        { key: "confidenceThreshold", label: "Confidence threshold", placeholder: "0.55" },
        { key: "relationTypes", label: "Allowed relation types", placeholder: "friend_of,helps,tries_to_help" },
        { key: "documentId", label: "Document ID", placeholder: "optional" },
        { key: "collectionId", label: "Collection ID", placeholder: "knowledge_sample_current" },
        { key: "outputChannel", label: "Output channel", placeholder: "knowledge.semantic.relations" },
      ];
    }
    if (subtype === "knowledge-graph-builder-agent") {
      return [
        { key: "providerProfile", label: "Provider profile", placeholder: "local_ollama, local_lm_studio" },
        { key: "model", label: "Model", placeholder: "local-model" },
        { key: "domainHint", label: "Domain hint", type: "textarea", placeholder: "technical documentation, narrative story, theology, API docs..." },
        { key: "maxChunks", label: "Max chunks", placeholder: "6" },
        { key: "maxChunkChars", label: "Max chars per chunk", placeholder: "1800" },
        { key: "maxEntities", label: "Max accepted entities", placeholder: "40" },
        { key: "maxRelations", label: "Max accepted relations", placeholder: "48" },
        { key: "confidenceThreshold", label: "Confidence threshold", placeholder: "0.65" },
        { key: "relationTypes", label: "Allowed relation types", placeholder: "uses,implements,explains,stores_in,retrieves_from,powered_by" },
        { key: "technicalNormalization", label: "Technical normalization", type: "checkbox", defaultValue: true },
        { key: "replaceExisting", label: "Replace existing builder graph", type: "checkbox", defaultValue: true },
        { key: "documentId", label: "Document ID", placeholder: "optional" },
        { key: "collectionId", label: "Collection ID", placeholder: "knowledge_sample_current" },
        { key: "outputChannel", label: "Output channel", placeholder: "knowledge.graph.proposed" },
      ];
    }
    if (subtype === "graph-query") {
      return mergeSchemaFields([
        { key: "query", label: "Query", type: "textarea", placeholder: "Dio, Abramo, fede..." },
        { key: "depth", label: "Depth", placeholder: "1" },
        { key: "topK", label: "Top entities", placeholder: "12" },
        { key: "maxRelations", label: "Max relations", placeholder: "48" },
        { key: "maxEvidence", label: "Max evidence chunks", placeholder: "6" },
        { key: "maxContextChars", label: "Max context chars", placeholder: "5200" },
        { key: "relationTypes", label: "Relation types", placeholder: "mentions,references,co_occurs" },
        { key: "includeEvidence", label: "Include evidence", type: "checkbox", defaultValue: true },
        { key: "includeIsolated", label: "Include isolated entities", type: "checkbox", defaultValue: false },
        { key: "preferLatestDocument", label: "Use latest document", type: "checkbox", defaultValue: true },
        { key: "documentId", label: "Document ID", placeholder: "optional" },
        { key: "collectionId", label: "Collection ID", placeholder: "knowledge_sample_current" },
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

const persistInlineRuntimeNodeConfig = async ({ node, patch = {}, values = {} }) => {
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
    await window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode?.({ node: update.node });
    if (window.TrackerLensChannelRegistry?.upsertChannelsForRuntimeNode) {
      await window.TrackerLensChannelRegistry.upsertChannelsForRuntimeNode({ node: update.node });
    }
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
    setFocusState({
      mode: "dependencies",
      nodeId: update.node.id,
      edgeId: "",
      nodeType: update.node.type,
      channel: update.channels[0] || "",
      connectionId: "",
    });
    await loadRuntime({ force: true, silent: true });
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

const clearPreviewNodePayload = (node = {}) => {
  markPreviewNodeClean(node, { remount: true });
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
  const asRaw = typeof payload === "string" ? payload : prettyRuntimeValue(payload);
  const text = mode === "raw" && typeof payload !== "string"
    ? String(payload)
    : asRaw;
  const originalText = hasOriginalPayload
    ? `\n\nOriginal payload:\n${typeof originalPayload === "string" ? originalPayload : prettyRuntimeValue(originalPayload)}`
    : "";
  const fullText = `${warningText}${mappingText}Mapped payload:\n${text}${originalText}`;
  return fullText.length > maxChars ? `${fullText.slice(0, maxChars)}\n...` : fullText;
};

const renderPreviewNodePanel = (node = {}) => {
  const config = nodeRuntimeConfig(node);
  const record = previewRecordForNode(node);
  const mode = String(config.previewMode || "auto").toLowerCase();
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
          class: "tl-flow-copy-btn is-clear",
          title: "Clear preview payload",
          onPointerDown: stopNodeControlEvent,
          onclick: (event) => {
            event.preventDefault();
            event.stopPropagation();
            clearPreviewNodePayload(node);
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
  const hiddenInlineKeys = mediaInlineHiddenKeys(subtype);
  const renderedFields = fields.filter((definition) => !hiddenInlineKeys.has(definition.key));
  const saveField = (definition, event) => {
    const value = definition.type === "checkbox" ? event.currentTarget.checked : event.currentTarget.value;
    persistInlineRuntimeNodeConfig({ node, patch: { [definition.key]: value } });
  };
  const control = (definition) => {
    const value = config[definition.key] ?? defaults[definition.key] ?? "";
    const common = {
      "aria-label": definition.label,
      title: definition.label,
      onPointerDown: stopNodeControlEvent,
      onclick: stopNodeControlEvent,
      onchange: (event) => saveField(definition, event),
    };
    if (definition.type === "select") {
      return _.select(
        { ...common, class: "tl-flow-inline-select", value },
        ...(definition.options || []).map((option) => _.option({ value: option, selected: option === value }, option))
      );
    }
    if (["checkbox", "boolean", "toggle"].includes(definition.type)) {
      return _.Toggle({
        class: "tl-flow-inline-toggle",
        checked: Boolean(value),
        color: "success",
        dense: true,
        onPointerDown: stopNodeControlEvent,
        onclick: stopNodeControlEvent,
        onChange: (checked) => persistInlineRuntimeNodeConfig({ node, patch: { [definition.key]: Boolean(checked) } }),
      });
    }
    return _.input({
      ...common,
      class: "tl-flow-inline-input",
      value,
      placeholder: definition.placeholder || "",
      autocomplete: "off",
      onkeydown: (event) => {
        event.stopPropagation();
        if (event.key === "Enter") event.currentTarget.blur();
      },
    });
  };

  return _.div(
    { class: "tl-flow-node-inline-config", onPointerDown: stopNodeControlEvent, onclick: stopNodeControlEvent },
    mediaSourceDropSpec(subtype) ? renderMediaSourceDropzone(node, config) : null,
    ...renderedFields.map((definition) => _.label(
      { class: `tl-flow-inline-row is-${definition.type || "text"}` },
      _.span({ class: "tl-flow-inline-label" }, definition.label),
      control(definition)
    )),
    subtype === "telegram" ? btn({
      class: "tl-flow-inline-editor-btn",
      title: "Send Telegram test message",
      onPointerDown: stopNodeControlEvent,
      onclick: (event) => testTelegramActionNode(node, event),
    }, icon("send", "sm"), "Test") : null
  );
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
      config: { ...defaults.configObject, ...readConfigMap(form) },
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

const aiAgentFromRuntimeNode = (node = {}) => {
  const defaults = runtimeNodeConfigDefaults(node);
  const config = defaults.configObject || {};
  const agentType = config.agentType || nodeSubtype(node) || "analyzer";
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
    },
    provider: {
      profileId: config.providerProfile || "",
      providerType: config.providerType || config.provider || "ollama",
      model: config.model || "local-model",
      temperature: config.temperature ?? 0.2,
      maxTokens: config.maxTokens ?? 800,
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
      systemPrompt: config.systemPrompt || "You are a runtime intelligence worker. Analyze events and emit operational output.",
      template: config.promptTemplate || config.prompt || "Analyze this runtime event:\n\nChannel: {{channel}}\nPayload: {{payload}}\nMemory: {{memory}}",
      variables: split(config.dynamicVariables || "{{channel}}, {{timestamp}}, {{workspace}}, {{memory}}, {{event}}, {{payload}}"),
      strategy: config.promptStrategy || "contextual",
      outputInstructions: config.outputInstructions || "Return structured runtime output ready for channel emission.",
    },
    memory: {
      mode: config.memoryMode || "workspace",
      size: config.memorySize ?? 20,
      expiration: config.memoryExpiration || "24h",
      persistence: config.memoryPersistence || "workspace",
      compression: config.memoryCompression || "summary",
      contextWindow: config.contextWindow ?? 6,
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
      saveResponses: config.saveResponses !== "false",
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
  providerProfile: payload.provider?.profileId || "",
  providerType: payload.provider?.providerType || "ollama",
  model: payload.provider?.model || "local-model",
  temperature: payload.provider?.temperature ?? 0.2,
  maxTokens: payload.provider?.maxTokens ?? 800,
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
  ...Object.fromEntries(Object.entries(payload.permissions || {}).map(([key, value]) => [key, String(Boolean(value))])),
  ...Object.fromEntries(Object.entries(payload.debug || {}).map(([key, value]) => [key, String(Boolean(value))])),
  ...payload.metrics,
});

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
  if (!node.metadata?.aiAgentAlias) return aiAgentFromRuntimeNode(node);
  const source = await findSavedAiAgent(aiAgentAliasSourceId(node));
  if (!source) return aiAgentFromRuntimeNode(node);
  return {
    ...source,
    workspaceId: source.workspaceId || node.workspaceId || state.filters.workspaceId || "workspace_global",
  };
};

const persistAiAgentEditorPayload = async ({ node, payload, close }) => {
  if (node.metadata?.aiAgentAlias) {
    if (payload.scope === "runtime") {
      await window.TrackerLensAiRuntimeStore?.upsertRuntimeAgent?.(payload);
    } else {
      await window.TrackerLensAiRuntimeStore?.upsertAgent?.(payload);
    }
    const { agentType, inputChannels, outputChannel } = aiAgentChannelsForRecord(payload);
    const aliasId = aiAgentAliasSourceId(node) || payload.id;
    const aliasNodes = state.runtime.nodes.filter((item) =>
      item.type === "aiAgent" &&
      item.metadata?.aiAgentAlias &&
      (aiAgentAliasSourceId(item) === aliasId || item.id === node.id)
    );
    const permissionFlags = normalizeAiAgentPermissionFlags(payload.permissions);
    const permissions = normalizeAssetPermissions(permissionFlags);
    await Promise.all(aliasNodes.map((aliasNode) => window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode?.({
      node: {
        ...aliasNode,
        label: payload.name || aliasNode.label,
        status: payload.status || aliasNode.status || "active",
        inputs: inputChannels.slice(0, 1),
        outputs: [outputChannel].filter(Boolean),
        channels: [...new Set([...inputChannels.slice(0, 1), outputChannel].filter(Boolean))],
        runtime: {
          ...(aliasNode.runtime || {}),
          status: payload.status || aliasNode.status || "active",
          active: payload.status !== "paused" && payload.status !== "disabled",
        },
        metadata: {
          ...(aliasNode.metadata || {}),
          configured: true,
          aiAgentAlias: true,
          aliasSourceAgentId: aliasId,
          aliasSourceScope: payload.scope || aliasNode.metadata?.aliasSourceScope || "template",
          icon: payload.icon || aliasNode.metadata?.icon || "psychology",
          subtype: agentType,
          agentRole: agentType,
          templateId: payload.scope === "runtime" ? payload.templateId || aliasId : aliasId,
          runtimeStatus: payload.status || aliasNode.metadata?.runtimeStatus || "active",
          config: {
            ...(aliasNode.metadata?.config || {}),
            aliasSourceAgentId: aliasId,
            aliasSourceScope: payload.scope || aliasNode.metadata?.aliasSourceScope || "template",
            templateId: payload.scope === "runtime" ? payload.templateId || aliasId : aliasId,
            linked: "alias",
          },
          manifest: nodeManifest({
            type: "aiAgent",
            subtype: agentType,
            category: "ai-agents",
            inputs: inputChannels.slice(0, 1),
            outputs: [outputChannel].filter(Boolean),
            permissions,
            runtime: payload.runtime || {},
          }),
          permissions,
          runtimeMetadata: payload.runtime || {},
        },
        updatedAt: new Date().toISOString(),
      },
    })));
    await recordFlowAction({
      workspaceId: node.workspaceId || "global",
      nodeId: node.id,
      message: `Shared AI agent updated through alias: ${payload.name || payload.id}`,
      context: { action: "ai-agent-alias-source-updated", agentId: aliasId, aliasCount: aliasNodes.length },
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
      config: { ...nodeConfigObject(node), ...aiAgentPayloadConfig(payload) },
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

const detachAiAgentAliasNode = async ({ node, close = null } = {}) => {
  if (!node?.id || !node.metadata?.aiAgentAlias) return;
  const source = await findSavedAiAgent(aiAgentAliasSourceId(node));
  const payload = source || aiAgentFromRuntimeNode(node);
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

const requestAiAgentRuntimeConfig = async (node) => {
  if (!node?.id || !window.TrackerLensAiAgentEditor?.open) return;
  let providers = [];
  try {
    providers = (await window.TrackerLensAiRuntimeStore?.list?.())?.providers || [];
  } catch (error) {
    console.warn("Provider AI non caricati per Flow Map:", error);
  }
  window.TrackerLensAiAgentEditor.open({
    agent: await resolveAiAgentEditorRecord(node),
    providers,
    title: "AI Runtime Agent Editor",
    subtitle: node.metadata?.aiAgentAlias
      ? `${node.label || node.id} · Shared alias`
      : `${node.label || node.id} · Flow Map runtime node`,
    footerActions: node.metadata?.aiAgentAlias
      ? ({ close }) => btn({
        onclick: () => detachAiAgentAliasNode({ node, close }),
      }, icon("link_off", "sm"), "Make Copy")
      : null,
    onSave: ({ payload, close }) => persistAiAgentEditorPayload({ node, payload, close }),
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
      btn({ class: "is-primary", onclick: () => persistCustomRuntimeNodeConfig({ node, draft, close }) }, icon("save", "sm"), "Save Node")
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
      btn({ class: "tl-ai-save-btn", onclick: () => save(close) }, icon("save", "sm"), "Save Orchestrator")
    ),
  });
  dialog.open();
};

const requestRuntimeNodeConfig = (node) => {
  if (!node?.id) return;
  const defaults = runtimeNodeConfigDefaults(node);
  const subtype = nodeSubtype(node);
  const category = nodeCategory(node);
  const configFields = configFieldDefinitions(node);
  const capabilityFields = agentCapabilityFieldDefinitions(node);
  const formId = `tl-flow-config-${String(node.id).replace(/[^A-Za-z0-9_-]/g, "_")}`;
  let formRef = null;
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
  const configField = (definition) => {
    const value = defaults[definition.key] ?? defaults.configObject?.[definition.key] ?? definition.defaultValue ?? "";
    if (definition.type === "checkbox") {
      const inputId = `${formId}-${definition.key}`;
      return _.div(
        { class: "tl-flow-config-field is-check" },
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
      return _.label(
        { class: "tl-flow-config-field" },
        _.span(definition.label),
        _.select(
          { "data-config-key": definition.key, value },
          ...(definition.options || []).map((option) => _.option({ value: option, selected: option === value }, option))
        )
      );
    }
    if (definition.type === "textarea") {
      return _.label(
        { class: "tl-flow-config-field is-wide" },
        _.span(definition.label),
        _.textarea({ "data-config-key": definition.key, rows: 4, placeholder: definition.placeholder || "", value })
      );
    }
    if (subtype === "telegram" && definition.key === "chatId") {
      return _.label(
        { class: "tl-flow-config-field" },
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
        { class: "tl-flow-config-field" },
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
        { class: `tl-flow-config-field is-wide is-file${definition.type === "image-file" ? " is-image" : ""}` },
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
      { class: "tl-flow-config-field" },
      _.span(definition.label),
      _.input({ "data-config-key": definition.key, value, placeholder: definition.placeholder || "", autocomplete: "off", type: subtype === "telegram" && definition.key === "botToken" ? "password" : "text" })
    );
  };
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
      _.section(
        { class: "tl-flow-config-section" },
        _.h3(`${subtype} settings`),
        ...configFields.map(configField)
      ),
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
      btn({ class: "is-primary", onclick: () => persistRuntimeNodeConfig({ node, form: formRef || document.getElementById(formId), close }) }, icon("save", "sm"), "Save Node")
    ),
  });
  dialog.open();
  formRef = document.getElementById(formId);
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

const performDraftNodeDelete = async (node, closeDialog = null) => {
  if (!node?.id) return;
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

const requestDraftNodeDelete = (node) => {
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
  const dialog = _.Dialog({
    class: "tl-flow-edge-delete-dialog",
    panelClass: "tl-flow-edge-delete-panel",
    size: "md",
    title: embeddedFlowMapAlias
      ? "Eliminare questo alias Flow Map?"
      : dependencies.length
        ? `${draft ? "Questo draft" : "Questo nodo"} ha dependency runtime`
        : `Eliminare questo ${draft ? "draft" : "nodo"}?`,
    subtitle: node.label || node.id,
    icon: "delete",
    closeButton: true,
    content: () => _.div(
      { class: "tl-flow-edge-delete-body" },
      _.p(embeddedFlowMapAlias
        ? "Verranno rimossi solo questo nodo virtuale e i suoi collegamenti. Il Flow Map sorgente non verra modificato."
        : dependencies.length
          ? "Questo nodo e usato nel runtime. La cancellazione pulira anche dependency, channel registry, flow references ed event logs collegati."
          : "Il nodo verra rimosso dalla Flow Map."),
      _.div(_.span("Node"), _.strong(node.label || node.id)),
      _.div(_.span("Type"), _.strong(node.type || "runtime")),
      _.div(_.span("Workspace"), _.strong(node.workspaceId || "global")),
      _.div(_.span("Dependencies"), _.strong(`${dependencies.length} total · ${summary.incoming} in · ${summary.outgoing} out`)),
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
    actions: ({ close }) => _.Toolbar(
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
  const position = node.flowPosition || node.position || { x: "42%", y: "42%" };
  const offsetPercent = (value, offset) => {
    const numeric = parseFloat(value);
    if (!Number.isFinite(numeric)) return value;
    return flowCoordinate(numeric + offset);
  };
  const clone = {
    ...JSON.parse(JSON.stringify(node)),
    id: `node_${now}`,
    sourceRef: node.sourceRef || node.id,
    label: `${node.label || node.id} Copy`,
    status: "idle",
    runtime: { ...(node.runtime || {}), status: "idle", active: false },
    flowPosition: {
      x: offsetPercent(position.x, 5),
      y: offsetPercent(position.y, 5),
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
      btn({ class: "is-primary", onclick: () => save(close) }, icon("save", "sm"), "Rename")
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
    return sourceType === AGENT_CONTROL_PORT_TYPE &&
      targetType === AGENT_CONTROL_PORT_TYPE &&
      isAgentControlNode(source);
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
              linkType: validation.sourcePort?.type === AGENT_CONTROL_PORT_TYPE || validation.targetPort?.type === AGENT_CONTROL_PORT_TYPE
                ? AGENT_CONTROL_PORT_TYPE
                : "data",
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
    linkType: agentControlLink ? AGENT_CONTROL_PORT_TYPE : (options.mapping?.linkType || "data"),
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
