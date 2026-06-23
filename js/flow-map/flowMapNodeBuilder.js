// Flow Map palette manifest and custom Node Builder.
// Extracted from js/flowMapView.js; loaded in order by flowMap.html.
const manifestPortDef = (port = "", fallbackType = "any") => {
  if (port && typeof port === "object") {
    return {
      ...port,
      name: String(port.name || port.key || port.channel || port.id || "default"),
      type: port.type || port.valueType || fallbackType,
      schema: port.schema || port.payloadSchema || null,
      required: Boolean(port.required),
    };
  }
  const name = String(port || "default");
  const lowerName = name.toLowerCase();
  const inferredType = ["true", "false"].includes(lowerName)
    ? "event"
    : lowerName === "event"
      ? "event"
      : ["raw", "input", "output", "record", "state", "channel"].includes(lowerName)
        ? "object"
        : fallbackType;
  return { name, type: inferredType, schema: null, required: false };
};

const sourceConfigInputPorts = (subtype = "") => {
  const kind = String(subtype || "").toLowerCase();
  const url = { name: "url", type: "string", required: true, description: "Endpoint URL" };
  const params = { name: "params", type: "record", description: "Query parameters" };
  const headers = { name: "headers", type: "record", description: "Request headers" };
  if (kind === "websocket") {
    return [
      { ...url, description: "wss/ws endpoint URL" },
      params,
      { name: "protocols", type: "array", description: "WebSocket subprotocols" },
      { ...headers, description: "Headers only when routed through a server/proxy connector" },
    ];
  }
  if (["rest", "rss", "youtube"].includes(kind)) return [url, params, headers];
  if (kind === "webhook") return [
    { name: "secret", type: "string", description: "Webhook signing secret" },
    headers,
  ];
  if (kind === "indexeddb-source") return [
    { name: "store", type: "string", required: true, description: "IndexedDB store name" },
    { name: "query", type: "record", description: "Local query/filter" },
  ];
  if (kind === "image-source") return [
    { name: "image", type: "image", description: "Image file or URL" },
    { name: "metadata", type: "record", description: "Image metadata and tags" },
  ];
  if (kind === "audio-source") return [
    { name: "audio", type: "audio", description: "Audio file or URL" },
    { name: "metadata", type: "record", description: "Audio metadata and tags" },
  ];
  if (kind === "file-source") return [
    { name: "file", type: "file", description: "Single file payload" },
    { name: "metadata", type: "record", description: "File metadata and tags" },
  ];
  if (kind === "files-source") return [
    { name: "files", type: "array", description: "Multiple file payloads" },
    { name: "metadata", type: "record", description: "Batch metadata and tags" },
  ];
  return [];
};

const nodeManifest = ({
  type,
  subtype,
  category,
  inputs = [],
  outputs = [],
  permissions = [],
  settingsSchema = {},
  runtime = {},
  render = null,
  execute = null,
  persist = null,
}) => {
  const manifestInputs = category === "sources" && !inputs.length
    ? sourceConfigInputPorts(subtype)
    : inputs;
  const manifest = {
    version: "1.0.0",
    runtimeVersion: window.TrackerLensRuntimeManifest?.RUNTIME_VERSION || "0.1.0",
    type,
    subtype,
    category,
    inputs: manifestInputs.map((port) => manifestPortDef(port, category === "lens" ? "any" : "object")),
    outputs: outputs.map((port) => manifestPortDef(port, "object")),
    permissions,
    settingsSchema,
    runtime,
    metadata: {
      runtimeType: type,
      subtype,
      category,
    },
    ...(render ? { render } : {}),
    ...(execute ? { execute } : {}),
    ...(persist ? { persist } : {}),
  };
  return window.TrackerLensRuntimeManifest?.normalizeManifest
    ? window.TrackerLensRuntimeManifest.normalizeManifest(manifest)
    : manifest;
};

const paletteNode = ({
  label,
  icon,
  tone,
  nodeType,
  subtype,
  category,
  inputs = [],
  outputs = [],
  permissions = [],
  settingsSchema = {},
  runtime = {},
  url = "",
  trackerSource = "",
  runtimeMode = "",
  connectionType = "",
  render = null,
  execute = null,
  persist = null,
}) => ({
  label,
  icon,
  tone,
  nodeType,
  subtype,
  category,
  inputs,
  outputs,
  permissions,
  settingsSchema,
  runtime,
  url,
  trackerSource,
  runtimeMode,
  connectionType,
  manifest: nodeManifest({
    type: nodeType === "boxLens" ? "lens" : nodeType,
    subtype,
    category,
    inputs,
    outputs,
    permissions,
    settingsSchema,
    runtime,
    render,
    execute,
    persist,
  }),
});

const nodePalette = [
  ["Sources", [
    paletteNode({ label: "REST API", icon: "api", tone: "green", nodeType: "source", subtype: "rest", category: "sources", outputs: ["raw"], permissions: ["network.fetch"], connectionType: "Source: REST API" }),
    paletteNode({ label: "WebSocket", icon: "settings_input_antenna", tone: "green", nodeType: "source", subtype: "websocket", category: "sources", outputs: ["raw"], permissions: ["network.websocket"], connectionType: "Source: WebSocket" }),
    paletteNode({ label: "RSS Feed", icon: "rss_feed", tone: "green", nodeType: "source", subtype: "rss", category: "sources", outputs: ["raw"], permissions: ["network.fetch"], connectionType: "Source: RSS Feed" }),
    paletteNode({ label: "Webhook", icon: "webhook", tone: "green", nodeType: "source", subtype: "webhook", category: "sources", outputs: ["raw"], permissions: ["webhook.receive"], connectionType: "Webhook" }),
    paletteNode({ label: "YouTube API", icon: "smart_display", tone: "green", nodeType: "source", subtype: "youtube", category: "sources", outputs: ["raw"], permissions: ["network.fetch"], connectionType: "Source: YouTube API" }),
    paletteNode({ label: "Manual JSON", icon: "data_object", tone: "green", nodeType: "source", subtype: "manual-json", category: "sources", outputs: ["raw"], settingsSchema: { json: "object" }, connectionType: "Source: Manual JSON" }),
    paletteNode({ label: "Text Input", icon: "notes", tone: "green", nodeType: "source", subtype: "text-input", category: "sources", outputs: ["raw"], settingsSchema: { text: "string" }, connectionType: "Source: Text Input" }),
    paletteNode({ label: "Image Source", icon: "image", tone: "teal", nodeType: "source", subtype: "image-source", category: "sources", outputs: ["image"], settingsSchema: { imageUrl: "string", imageDataUrl: "string", alt: "string" }, connectionType: "Source: Image" }),
    paletteNode({ label: "Audio Source", icon: "graphic_eq", tone: "teal", nodeType: "source", subtype: "audio-source", category: "sources", outputs: ["audio"], settingsSchema: { audioUrl: "string", audioDataUrl: "string", transcript: "string" }, connectionType: "Source: Audio" }),
    paletteNode({ label: "File Source", icon: "upload_file", tone: "teal", nodeType: "source", subtype: "file-source", category: "sources", outputs: ["file"], settingsSchema: { fileName: "string", fileDataUrl: "string", mimeType: "string" }, connectionType: "Source: File" }),
    paletteNode({ label: "Files Batch", icon: "drive_folder_upload", tone: "teal", nodeType: "source", subtype: "files-source", category: "sources", outputs: ["files"], settingsSchema: { files: "array" }, connectionType: "Source: Files" }),
    paletteNode({ label: "IndexedDB Source", icon: "database", tone: "cyan", nodeType: "source", subtype: "indexeddb-source", category: "sources", outputs: ["raw"], permissions: ["indexeddb.read"], connectionType: "Source: IndexedDB" }),
  ]],
  ["Trackers", [
    paletteNode({ label: "Box Tracker", icon: "storage", tone: "gold", nodeType: "boxTracker", subtype: "box-tracker", category: "trackers", inputs: ["raw"], outputs: ["channel"], permissions: ["channel.emit"], trackerSource: "websocket", runtimeMode: "real-time" }),
    paletteNode({ label: "Existing Tracker", icon: "inventory_2", tone: "orange", nodeType: "boxTracker", subtype: "existing", category: "trackers", inputs: ["raw"], outputs: ["channel"], permissions: ["channel.emit"] }),
    paletteNode({ label: "Realtime Tracker", icon: "sync_alt", tone: "orange", nodeType: "boxTracker", subtype: "realtime", category: "trackers", inputs: ["raw"], outputs: ["channel"], permissions: ["channel.emit"], trackerSource: "websocket", runtimeMode: "real-time" }),
    paletteNode({ label: "Polling Tracker", icon: "update", tone: "gold", nodeType: "boxTracker", subtype: "polling", category: "trackers", inputs: ["raw"], outputs: ["channel"], permissions: ["channel.emit"], trackerSource: "rest", runtimeMode: "interval" }),
  ]],
  ["Flow Maps", [
    paletteNode({ label: "Flow In", icon: "login", tone: "green", nodeType: "flowPort", subtype: "flow-in", category: "flow-maps", outputs: ["flow.in"], permissions: ["flow.input"], connectionType: "Flow Map Input" }),
    paletteNode({ label: "Flow Out", icon: "logout", tone: "cyan", nodeType: "flowPort", subtype: "flow-out", category: "flow-maps", inputs: ["flow.out"], permissions: ["flow.output"], connectionType: "Flow Map Output" }),
    paletteNode({ label: "Flow Map", icon: "account_tree", tone: "blue", nodeType: "flowMap", subtype: "existing", category: "flow-maps", inputs: ["flow.in"], outputs: ["flow.out"], permissions: ["flow.invoke"] }),
  ]],
  ["Processors", [
    paletteNode({ label: "Agent Bridge", icon: "network_node", tone: "cyan", nodeType: "processor", subtype: "agent-bridge", category: "processors", inputs: ["agent_control", "listening"], outputs: ["action"], permissions: ["graph.dispatch", "channel.emit"], settingsSchema: { support: "single-agent" }, runtime: { bridge: true, controlPort: "agent_control", compact: true }, connectionType: "Agent Bridge" }),
    paletteNode({ label: "Filter", icon: "filter_alt", tone: "purple", nodeType: "processor", subtype: "filter", category: "processors", inputs: ["input"], outputs: ["output"], connectionType: "Processor: Filter" }),
    paletteNode({ label: "Transform", icon: "tune", tone: "purple", nodeType: "processor", subtype: "transform", category: "processors", inputs: ["input"], outputs: ["output"], connectionType: "Processor: Transform" }),
    paletteNode({ label: "Condition", icon: "alt_route", tone: "purple", nodeType: "processor", subtype: "condition", category: "processors", inputs: ["input"], outputs: ["true", "false"], connectionType: "Processor: Condition" }),
    paletteNode({ label: "Throttle", icon: "speed", tone: "purple", nodeType: "processor", subtype: "throttle", category: "processors", inputs: ["input"], outputs: ["output"], connectionType: "Processor: Throttle" }),
    paletteNode({ label: "Debounce", icon: "timer", tone: "purple", nodeType: "processor", subtype: "debounce", category: "processors", inputs: ["input"], outputs: ["output"], connectionType: "Processor: Debounce" }),
    paletteNode({ label: "Merge", icon: "call_merge", tone: "purple", nodeType: "processor", subtype: "merge", category: "processors", inputs: ["a", "b"], outputs: ["output"], connectionType: "Processor: Merge" }),
    paletteNode({ label: "Split", icon: "call_split", tone: "purple", nodeType: "processor", subtype: "split", category: "processors", inputs: ["input"], outputs: ["a", "b"], connectionType: "Processor: Split" }),
    paletteNode({ label: "Map", icon: "account_tree", tone: "purple", nodeType: "processor", subtype: "map", category: "processors", inputs: ["input"], outputs: ["output"], connectionType: "Processor: Map" }),
    paletteNode({ label: "Reduce", icon: "functions", tone: "purple", nodeType: "processor", subtype: "reduce", category: "processors", inputs: ["input"], outputs: ["output"], connectionType: "Processor: Reduce" }),
    paletteNode({ label: "Formatter", icon: "format_shapes", tone: "purple", nodeType: "processor", subtype: "formatter", category: "processors", inputs: ["input"], outputs: ["output"], connectionType: "Processor: Formatter" }),
    paletteNode({ label: "Validator", icon: "fact_check", tone: "purple", nodeType: "processor", subtype: "validator", category: "processors", inputs: ["input"], outputs: ["valid", "invalid"], connectionType: "Processor: Validator" }),
    paletteNode({ label: "Aggregator", icon: "stacked_bar_chart", tone: "purple", nodeType: "processor", subtype: "aggregator", category: "processors", inputs: ["input"], outputs: ["output"], connectionType: "Processor: Aggregator" }),
    paletteNode({ label: "Cache", icon: "cached", tone: "purple", nodeType: "processor", subtype: "cache", category: "processors", inputs: ["input"], outputs: ["output"], connectionType: "Processor: Cache" }),
    paletteNode({ label: "Parser", icon: "schema", tone: "purple", nodeType: "processor", subtype: "parser", category: "processors", inputs: ["raw"], outputs: ["output"], connectionType: "Processor: Parser" }),
  ]],
  ["Knowledge", [
    paletteNode({ label: "Document Store", icon: "menu_book", tone: "cyan", nodeType: "knowledge", subtype: "document-store", category: "knowledge", inputs: ["document"], outputs: ["knowledge.document.created"], permissions: ["indexeddb.write"], settingsSchema: { title: "string", sourceType: "manual|channel|json|markdown", language: "string", collectionId: "string", outputChannel: "string" }, runtime: { localFirst: true, store: "tl_knowledge_documents" }, connectionType: "Knowledge: Document Store" }),
    paletteNode({ label: "Text Knowledge", icon: "article", tone: "green", nodeType: "knowledge", subtype: "text-knowledge", category: "knowledge", inputs: ["text"], outputs: ["knowledge.document.created"], permissions: ["indexeddb.write"], settingsSchema: { title: "string", text: "string", language: "string", outputChannel: "string" }, runtime: { localFirst: true, sourceType: "manual" }, connectionType: "Knowledge: Text" }),
    paletteNode({ label: "Chunk Processor", icon: "segment", tone: "cyan", nodeType: "knowledge", subtype: "chunk-processor", category: "knowledge", inputs: ["knowledge.document.created"], outputs: ["knowledge.chunk.created"], permissions: ["indexeddb.write"], settingsSchema: { chunkSize: "number", chunkOverlap: "number", strategy: "fixed|paragraph|markdown", collectionId: "string", replaceExisting: "boolean", outputChannel: "string" }, runtime: { localFirst: true, store: "tl_knowledge_chunks" }, connectionType: "Knowledge: Chunk Processor" }),
    paletteNode({ label: "Embedding Generator", icon: "scatter_plot", tone: "green", nodeType: "knowledge", subtype: "embedding-generator", category: "knowledge", inputs: ["knowledge.chunk.created"], outputs: ["knowledge.embedding.created"], permissions: ["indexeddb.write", "ai.provider"], settingsSchema: { providerProfile: "string", model: "string", dimensions: "number", collectionId: "string", outputChannel: "string" }, runtime: { localFirst: true, store: "tl_knowledge_embeddings", algorithm: "local-hash-cosine" }, connectionType: "Knowledge: Embeddings" }),
    paletteNode({ label: "RAG Search", icon: "travel_explore", tone: "cyan", nodeType: "knowledge", subtype: "rag-search", category: "knowledge", inputs: ["knowledge.search.query", "knowledge.embedding.created"], outputs: ["knowledge.rag.context"], permissions: ["indexeddb.read"], settingsSchema: { query: "string", topK: "number", similarityThreshold: "number", maxContextTokens: "number", includeMetadata: "boolean", collectionId: "string", outputChannel: "string" }, runtime: { localFirst: true, retrieval: "cosine" }, connectionType: "Knowledge: RAG Search" }),
    paletteNode({ label: "Vector Memory", icon: "memory", tone: "green", nodeType: "knowledge", subtype: "vector-memory", category: "knowledge", inputs: ["knowledge.chunk.created"], outputs: ["knowledge.embedding.created"], permissions: ["indexeddb.write"], settingsSchema: { providerProfile: "string", model: "string", dimensions: "number", outputChannel: "string" }, runtime: { localFirst: true, store: "tl_knowledge_embeddings" }, connectionType: "Knowledge: Vector Memory" }),
    paletteNode({ label: "Knowledge Graph", icon: "hub", tone: "cyan", nodeType: "knowledge", subtype: "knowledge-graph", category: "knowledge", inputs: ["knowledge.entity.created", "knowledge.relation.created"], outputs: ["knowledge.graph.updated"], permissions: ["indexeddb.read"], settingsSchema: { graphScope: "workspace|document", outputChannel: "string" }, runtime: { localFirst: true, phase: "graph-base" }, connectionType: "Knowledge: Graph" }),
    paletteNode({ label: "Entity Extractor", icon: "account_tree", tone: "green", nodeType: "knowledge", subtype: "entity-extractor", category: "knowledge", inputs: ["knowledge.chunk.created"], outputs: ["knowledge.entity.created"], permissions: ["indexeddb.write", "ai.invoke"], settingsSchema: { entityTypes: "array", confidenceThreshold: "number", outputChannel: "string" }, runtime: { localFirst: true, store: "tl_knowledge_entities" }, connectionType: "Knowledge: Entity Extractor" }),
    paletteNode({ label: "Workspace Memory", icon: "psychology_alt", tone: "cyan", nodeType: "knowledge", subtype: "workspace-memory", category: "knowledge", inputs: ["memory"], outputs: ["knowledge.document.created"], permissions: ["indexeddb.write"], settingsSchema: { title: "string", memoryScope: "workspace", outputChannel: "string" }, runtime: { localFirst: true, memoryScope: "workspace" }, connectionType: "Knowledge: Workspace Memory" }),
    paletteNode({ label: "Conversation Memory", icon: "forum", tone: "green", nodeType: "knowledge", subtype: "conversation-memory", category: "knowledge", inputs: ["conversation"], outputs: ["knowledge.document.created"], permissions: ["indexeddb.write"], settingsSchema: { title: "string", sessionId: "string", outputChannel: "string" }, runtime: { localFirst: true, memoryScope: "conversation" }, connectionType: "Knowledge: Conversation Memory" }),
  ]],
  ["AI Agents", [
    paletteNode({ label: "Existing Agents", icon: "inventory_2", tone: "gold", nodeType: "aiAgent", subtype: "existing", category: "ai-agents", inputs: ["task"], outputs: ["analysis"], permissions: ["ai.invoke"] }),
    paletteNode({ label: "Task Node", icon: "assignment", tone: "gold", nodeType: "source", subtype: "task", category: "sources", outputs: ["task"], settingsSchema: { objective: "string", context: "string", priority: "normal|high|urgent", successCondition: "string", constraints: "string", maxIterations: "number", timeoutMs: "number", payloadJson: "object" }, runtime: { taskSource: true, outputChannel: "task" }, connectionType: "Agent Task" }),
    paletteNode({ label: "Orchestrator Agent", icon: "hub", tone: "gold", nodeType: "aiAgent", subtype: "orchestrator", category: "ai-agents", inputs: ["task"], outputs: ["decision", "action", "done", "error"], permissions: ["ai.invoke", "graph.dispatch", "channel.emit"], settingsSchema: { goal: "string", executionMode: "on_event|manual|continuous|autonomous", autonomousMode: "boolean", allowedNodeTypes: "array", maxSteps: "number", maxIterations: "number", stopCondition: "string", requireConfirmation: "boolean" }, runtime: { executionMode: "on_event", orchestrator: true }, connectionType: "AI Orchestrator" }),
    paletteNode({ label: "AI Analyzer", icon: "psychology", tone: "gold", nodeType: "aiAgent", subtype: "analyzer", category: "ai-agents", inputs: ["task"], outputs: ["analysis"], permissions: ["ai.invoke"], url: "ai.html" }),
    paletteNode({ label: "AI Sentiment", icon: "mood", tone: "pink", nodeType: "aiAgent", subtype: "sentiment", category: "ai-agents", inputs: ["task"], outputs: ["sentiment"], permissions: ["ai.invoke"], url: "ai.html" }),
    paletteNode({ label: "AI Summarizer", icon: "summarize", tone: "violet", nodeType: "aiAgent", subtype: "summarizer", category: "ai-agents", inputs: ["task"], outputs: ["summary"], permissions: ["ai.invoke"], url: "ai.html" }),
    paletteNode({ label: "AI Classifier", icon: "category", tone: "pink", nodeType: "aiAgent", subtype: "classifier", category: "ai-agents", inputs: ["task"], outputs: ["class"], permissions: ["ai.invoke"], url: "ai.html" }),
    paletteNode({ label: "AI Predictor", icon: "online_prediction", tone: "violet", nodeType: "aiAgent", subtype: "predictor", category: "ai-agents", inputs: ["task"], outputs: ["prediction"], permissions: ["ai.invoke"], url: "ai.html" }),
    paletteNode({ label: "AI Memory", icon: "memory", tone: "pink", nodeType: "aiAgent", subtype: "memory", category: "ai-agents", inputs: ["task"], outputs: ["context"], permissions: ["ai.memory"], url: "ai.html" }),
    paletteNode({ label: "AI Planner", icon: "route", tone: "violet", nodeType: "aiAgent", subtype: "planner", category: "ai-agents", inputs: ["task"], outputs: ["plan"], permissions: ["ai.invoke"], url: "ai.html" }),
    paletteNode({ label: "AI Router", icon: "alt_route", tone: "pink", nodeType: "aiAgent", subtype: "router", category: "ai-agents", inputs: ["task"], outputs: ["route"], permissions: ["ai.invoke"], url: "ai.html" }),
    paletteNode({ label: "AI Debugger", icon: "bug_report", tone: "violet", nodeType: "aiAgent", subtype: "debugger", category: "ai-agents", inputs: ["task"], outputs: ["diagnostic"], permissions: ["ai.invoke"], url: "ai.html" }),
    paletteNode({ label: "AI Decision", icon: "rule", tone: "pink", nodeType: "aiAgent", subtype: "decision", category: "ai-agents", inputs: ["task"], outputs: ["decision"], permissions: ["ai.invoke"], url: "ai.html" }),
  ]],
  ["Actions", [
    paletteNode({ label: "Telegram Message", icon: "send", tone: "orange", nodeType: "action", subtype: "telegram", category: "actions", inputs: ["event"], permissions: ["network.fetch"], execute: {}, connectionType: "Telegram Message" }),
    paletteNode({ label: "WhatsApp Message", icon: "chat", tone: "green", nodeType: "action", subtype: "whatsapp", category: "actions", inputs: ["event"], permissions: ["network.fetch"], execute: {}, connectionType: "WhatsApp Message" }),
    paletteNode({ label: "Email", icon: "mail", tone: "orange", nodeType: "action", subtype: "email", category: "actions", inputs: ["event"], permissions: ["network.fetch"], execute: {}, connectionType: "Email" }),
    paletteNode({ label: "Webhook POST", icon: "webhook", tone: "red", nodeType: "action", subtype: "webhook-post", category: "actions", inputs: ["event"], permissions: ["network.fetch"], execute: {}, connectionType: "Webhook POST" }),
    paletteNode({ label: "HTTP PUT/PATCH", icon: "published_with_changes", tone: "red", nodeType: "action", subtype: "http-write", category: "actions", inputs: ["event"], permissions: ["network.fetch"], execute: {}, connectionType: "HTTP PUT/PATCH" }),
    paletteNode({ label: "Browser Notification", icon: "notifications", tone: "orange", nodeType: "action", subtype: "notification", category: "actions", inputs: ["event"], permissions: ["notifications"], execute: {}, connectionType: "Browser Notification" }),
    paletteNode({ label: "Discord Message", icon: "forum", tone: "red", nodeType: "action", subtype: "discord", category: "actions", inputs: ["event"], permissions: ["network.fetch"], execute: {}, connectionType: "Discord Message" }),
    paletteNode({ label: "Slack Message", icon: "tag", tone: "purple", nodeType: "action", subtype: "slack", category: "actions", inputs: ["event"], permissions: ["network.fetch"], execute: {}, connectionType: "Slack Message" }),
    paletteNode({ label: "Sound Alert", icon: "volume_up", tone: "red", nodeType: "action", subtype: "sound-alert", category: "actions", inputs: ["event"], execute: {}, connectionType: "Sound Alert" }),
    paletteNode({ label: "Popup Alert", icon: "open_in_new", tone: "orange", nodeType: "action", subtype: "popup-alert", category: "actions", inputs: ["event"], execute: {}, connectionType: "Popup Alert" }),
    paletteNode({ label: "Runtime Trigger", icon: "bolt", tone: "red", nodeType: "action", subtype: "runtime-trigger", category: "actions", inputs: ["event"], outputs: ["trigger"], execute: {}, connectionType: "Runtime Trigger" }),
  ]],
  ["Storage", [
    paletteNode({ label: "Save DB Record", icon: "database", tone: "cyan", nodeType: "storage", subtype: "indexeddb", category: "storage", inputs: ["record"], permissions: ["indexeddb.write"], persist: {}, url: "database.html" }),
    paletteNode({ label: "Save File", icon: "file_download", tone: "cyan", nodeType: "storage", subtype: "file-export", category: "storage", inputs: ["record"], permissions: ["file.write"], persist: {} }),
    paletteNode({ label: "Local Cache", icon: "cached", tone: "green", nodeType: "storage", subtype: "local-cache", category: "storage", inputs: ["record"], permissions: ["cache.write"], persist: {} }),
    paletteNode({ label: "Runtime Memory", icon: "memory", tone: "cyan", nodeType: "storage", subtype: "runtime-memory", category: "storage", inputs: ["record"], permissions: ["memory.write"], persist: {} }),
    paletteNode({ label: "Snapshot", icon: "camera", tone: "green", nodeType: "storage", subtype: "snapshot", category: "storage", inputs: ["state"], permissions: ["snapshot.write"], persist: {} }),
    paletteNode({ label: "JSON Export", icon: "data_object", tone: "green", nodeType: "storage", subtype: "json-export", category: "storage", inputs: ["record"], permissions: ["file.write"], persist: {} }),
    paletteNode({ label: "CSV Export", icon: "table_view", tone: "cyan", nodeType: "storage", subtype: "csv-export", category: "storage", inputs: ["record"], permissions: ["file.write"], persist: {} }),
    paletteNode({ label: "History Store", icon: "history", tone: "green", nodeType: "storage", subtype: "history-store", category: "storage", inputs: ["event"], permissions: ["history.write"], persist: {} }),
  ]],
  ["Dev", [
    paletteNode({ label: "Preview", icon: "visibility", tone: "blue", nodeType: "devPreview", subtype: "preview", category: "dev", inputs: ["raw"], settingsSchema: { mode: "raw|json" } }),
  ]],
];

const flatPalette = () => nodePalette.flatMap(([, items]) => items);

const paletteItemForNode = (node = {}) => {
  const label = node.metadata?.paletteLabel || node.label || "";
  return flatPalette().find((item) => item.label === label) ||
    flatPalette().find((item) => item.nodeType === node.type) ||
    null;
};

const blankNodeTemplate = () => paletteNode({
  label: "Blank Custom Node",
  icon: "add_box",
  tone: "gold",
  nodeType: "custom",
  subtype: "custom",
  category: "custom",
  inputs: ["input"],
  outputs: ["output"],
  settingsSchema: {},
});

const NODE_BUILDER_TEMPLATE_STORAGE_KEY = "trackersLens.flowMap.nodeBuilder.templates";

const loadSavedNodeBuilderTemplates = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(NODE_BUILDER_TEMPLATE_STORAGE_KEY) || "[]");
    return Array.isArray(saved) ? saved.filter((item) => item && item.label) : [];
  } catch (_) {
    return [];
  }
};

const saveNodeBuilderTemplate = (template = {}) => {
  const saved = loadSavedNodeBuilderTemplates();
  const next = {
    ...template,
    savedTemplate: true,
    savedAt: new Date().toISOString(),
  };
  const id = nodeBuilderTemplateId("My Templates", next);
  const existing = saved.filter((item) => nodeBuilderTemplateId("My Templates", item) !== id);
  try {
    localStorage.setItem(NODE_BUILDER_TEMPLATE_STORAGE_KEY, JSON.stringify([next, ...existing].slice(0, 40)));
  } catch (_) {
    // Local template persistence is optional in restricted contexts.
  }
  return next;
};

const nodeBuilderTemplateGroups = () => [
  ["Custom", [blankNodeTemplate()]],
  ...(loadSavedNodeBuilderTemplates().length ? [["My Templates", loadSavedNodeBuilderTemplates()]] : []),
  ...nodePalette,
];

const nodeBuilderTemplateId = (group = "", item = {}) =>
  `${String(group || "templates").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${String(item.label || item.nodeType || "node").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

const nodeBuilderTemplateSearchText = (group = "", item = {}) =>
  [
    group,
    item.label,
    item.nodeType,
    item.subtype,
    item.category,
    item.connectionType,
    item.trackerSource,
    item.runtimeMode,
    ...(item.permissions || []),
  ].filter(Boolean).join(" ").toLowerCase();

const nodeBuilderCmswiftComponents = [
  { label: "Badge", type: "content", icon: "label", description: "Status badge" },
  { label: "Chip", type: "content", icon: "sell", description: "Compact token" },
  { label: "Input", type: "form", icon: "input", description: "Text field" },
  { label: "Select", type: "form", icon: "arrow_drop_down_circle", description: "Option menu" },
  { label: "Toggle", type: "form", icon: "toggle_on", description: "Boolean switch" },
  { label: "Checkbox", type: "form", icon: "check_box", description: "Check control" },
  { label: "Slider", type: "form", icon: "tune", description: "Numeric range" },
  { label: "Radio", type: "form", icon: "radio_button_checked", description: "Single choice" },
  { label: "Rating", type: "form", icon: "star", description: "Star rating" },
  { label: "Date", type: "form", icon: "calendar_today", description: "Date picker" },
  { label: "Time", type: "form", icon: "schedule", description: "Time picker" },
];

const normalizeNodeBuilderPorts = (ports = [], side = "in") => {
  const values = Array.isArray(ports) && ports.length ? ports : [side === "in" ? "input" : "output"];
  return values.map((port) => {
    if (typeof port === "object" && port) {
      return {
        ...port,
        name: port.name || port.key || port.label || (side === "in" ? "input" : "output"),
        type: port.type || "object",
        visible: port.visible !== false,
        required: Boolean(port.required),
        description: port.description || "",
        schema: port.schema || null,
        sourceMode: side === "out" ? (port.sourceMode || port.source || "runtimeResult") : "",
        sourcePath: side === "out" ? (port.sourcePath || port.path || "") : "",
        sourceComponentKey: side === "out" ? (port.sourceComponentKey || "") : "",
        expression: side === "out" ? (port.expression || "") : "",
      };
    }
    return {
      name: String(port || (side === "in" ? "input" : "output")),
      type: "object",
      visible: true,
      required: false,
      description: "",
      schema: null,
      sourceMode: side === "out" ? "runtimeResult" : "",
      sourcePath: "",
      sourceComponentKey: "",
      expression: "",
    };
  });
};

const defaultNodeBuilderTemplate = () =>
  nodeBuilderTemplateGroups()[0]?.[1]?.[0] || blankNodeTemplate();

const NODE_BUILDER_CONTAINER_TYPES = new Set(["card", "row", "col"]);
const NODE_BUILDER_DATA_COMPONENT_TYPES = new Set(["input", "select", "toggle", "checkbox", "slider", "radio", "rating", "date", "time", "string", "number", "boolean", "object", "array", "textarea"]);

const nodeBuilderComponentSchemaType = (type = "input") => ({
  input: "string",
  textarea: "textarea",
  select: "select",
  toggle: "toggle",
  checkbox: "boolean",
  slider: "number",
  radio: "radio",
  rating: "number",
  date: "date",
  time: "time",
  string: "string",
  number: "number",
  boolean: "boolean",
  object: "object",
  array: "array",
}[type] || type || "string");

const nodeBuilderComponentIcon = (type = "input") => ({
  card: "view_agenda",
  row: "view_stream",
  col: "view_column",
  input: "input",
  string: "input",
  textarea: "notes",
  number: "pin",
  boolean: "toggle_on",
  toggle: "toggle_on",
  checkbox: "check_box",
  select: "arrow_drop_down_circle",
  slider: "tune",
  radio: "radio_button_checked",
  rating: "star",
  date: "calendar_today",
  time: "schedule",
  badge: "label",
  chip: "sell",
}[type] || "dynamic_form");

const NODE_BUILDER_COLOR_OPTIONS = ["primary", "secondary", "success", "warning", "danger", "info", "light", "dark"];

const NODE_BUILDER_PORT_TYPE_OPTIONS = [
  "object",
  "array",
  "string",
  "number",
  "integer",
  "float",
  "boolean",
  "image",
  "file",
  "blob",
  "json",
  "event",
  "record",
  "date",
  "time",
  "any",
].map((type) => ({ value: type, label: type }));

const NODE_BUILDER_OUTPUT_SOURCE_OPTIONS = [
  { value: "runtimeResult", label: "Runtime result" },
  { value: "formData", label: "Full form data" },
  { value: "component", label: "Single component" },
  { value: "static", label: "Static value" },
  { value: "function", label: "Function / mapping" },
];

const nodeBuilderDefaultComponentSettings = (type = "input") => ({
  visibleOnNode: true,
  exposeInput: false,
  exposeOutput: false,
  icon: null,
  color: type === "slider" || type === "rating" ? "primary" : "success",
  defaultValue: type === "select" || type === "radio" ? "option-1" : "",
  defaultChecked: false,
  min: 0,
  max: type === "rating" ? 5 : 100,
  step: 1,
  options: [
    { value: "option-1", label: "Option 1" },
    { value: "option-2", label: "Option 2" },
  ],
});

const normalizeNodeBuilderOptions = (options = []) => {
  const values = Array.isArray(options) ? options : String(options || "").split(",");
  const normalized = values
    .map((option, index) => {
      if (typeof option === "object" && option) {
        const value = String(option.value || option.label || `option-${index + 1}`).trim();
        return value ? { value, label: String(option.label || value).trim() || value } : null;
      }
      const value = String(option || "").trim();
      return value ? { value, label: value } : null;
    })
    .filter(Boolean);
  return normalized.length ? normalized : nodeBuilderDefaultComponentSettings("select").options;
};

const nodeBuilderOptionsText = (options = []) =>
  normalizeNodeBuilderOptions(options).map((option) => option.label === option.value ? option.value : `${option.label}:${option.value}`).join(", ");

const nodeBuilderOptionsFromText = (value = "") =>
  normalizeNodeBuilderOptions(String(value || "").split(",").map((entry, index) => {
    const [label, optionValue] = String(entry || "").split(":").map((part) => part.trim());
    const resolvedValue = optionValue || label || `option-${index + 1}`;
    return { label: label || resolvedValue, value: resolvedValue };
  }));

const normalizeNodeBuilderSettings = (type = "input", settings = {}) => {
  const defaults = nodeBuilderDefaultComponentSettings(type);
  const next = { ...defaults, ...(settings || {}) };
  next.visibleOnNode = settings.visibleOnNode !== false;
  next.exposeInput = Boolean(settings.exposeInput);
  next.exposeOutput = Boolean(settings.exposeOutput);
  next.icon = next.icon ? String(next.icon).trim() : null;
  next.color = String(next.color || defaults.color || "success").trim();
  next.defaultValue = next.defaultValue ?? defaults.defaultValue ?? "";
  next.defaultChecked = Boolean(next.defaultChecked);
  next.min = Number.isFinite(Number(next.min)) ? Number(next.min) : defaults.min;
  next.max = Number.isFinite(Number(next.max)) ? Number(next.max) : defaults.max;
  next.step = Number.isFinite(Number(next.step)) ? Number(next.step) : defaults.step;
  next.options = normalizeNodeBuilderOptions(next.options);
  return next;
};

const nodeBuilderComponentSettings = (node = {}) =>
  normalizeNodeBuilderSettings(node.type || "input", node.settings || {});

const nodeBuilderFieldOptions = (node = {}) =>
  normalizeNodeBuilderOptions(nodeBuilderComponentSettings(node).options);

const nodeBuilderPortNameForField = (field = {}) =>
  String(field.key || field.label || field.id || "field").replace(/[^A-Za-z0-9_.-]/g, "_");

const nodeBuilderId = (prefix = "item") =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

const nodeBuilderFieldsFromTemplate = (template = {}) => {
  const entries = Object.entries(template.settingsSchema || {});
  return (entries.length ? entries : [["name", "string"], ["enabled", "toggle"]]).map(([key, type]) => ({
    id: `field_${String(key || "field").replace(/[^A-Za-z0-9_-]/g, "_")}_${Math.random().toString(36).slice(2, 6)}`,
    key: String(key || "field"),
    label: String(key || "Field"),
    type: String(type || "string"),
    required: false,
  }));
};

const normalizeNodeBuilderLayout = (nodes = []) =>
  (Array.isArray(nodes) ? nodes : []).map((node) => {
    const type = String(node?.type || "input");
    const normalized = {
      id: node?.id || nodeBuilderId(type),
      type,
      label: node?.label || node?.key || (NODE_BUILDER_CONTAINER_TYPES.has(type) ? type.toUpperCase() : "Field"),
      key: node?.key || "",
      required: Boolean(node?.required),
      settings: normalizeNodeBuilderSettings(type, node?.settings || {}),
    };
    if (NODE_BUILDER_CONTAINER_TYPES.has(type)) {
      normalized.children = normalizeNodeBuilderLayout(node?.children || []);
    } else if (!normalized.key) {
      normalized.key = String(normalized.label || "field").replace(/[^A-Za-z0-9_.-]/g, "_").toLowerCase();
    }
    return normalized;
  });

const nodeBuilderLayoutFromFields = (fields = []) =>
  normalizeNodeBuilderLayout((fields || []).map((field) => {
    const type = String(field.type || "input");
    if (NODE_BUILDER_CONTAINER_TYPES.has(type)) {
      return {
        id: field.id || nodeBuilderId(type),
        type,
        label: field.label || type.toUpperCase(),
        key: field.key || "",
        settings: normalizeNodeBuilderSettings(type, field.settings || {}),
        children: normalizeNodeBuilderLayout(field.children || []),
      };
    }
    return {
      id: field.id || nodeBuilderId("field"),
      type,
      label: field.label || field.key || "Field",
      key: field.key || "field",
      required: Boolean(field.required),
      settings: normalizeNodeBuilderSettings(type, field.settings || {}),
    };
  }));

const walkNodeBuilderLayout = (nodes = [], visitor = () => { }, parent = null) => {
  (nodes || []).forEach((node, index) => {
    visitor(node, parent, index);
    if (NODE_BUILDER_CONTAINER_TYPES.has(node.type)) {
      walkNodeBuilderLayout(node.children || [], visitor, node);
    }
  });
};

const findNodeBuilderLayoutNode = (nodes = [], nodeId = "") => {
  let found = null;
  walkNodeBuilderLayout(nodes, (node, parent, index) => {
    if (!found && node.id === nodeId) found = { node, parent, index };
  });
  return found;
};

const removeNodeBuilderLayoutNode = (nodes = [], nodeId = "") => {
  const found = findNodeBuilderLayoutNode(nodes, nodeId);
  if (!found) return false;
  const list = found.parent ? found.parent.children : nodes;
  if (!found.parent && list.length <= 1) return false;
  list.splice(found.index, 1);
  return true;
};

const syncNodeBuilderComponentPort = (builder = {}, field = {}, side = "in", enabled = false) => {
  const listKey = side === "in" ? "inputs" : "outputs";
  const ports = normalizeNodeBuilderPorts(builder[listKey] || [], side);
  const sourceId = field.id || "";
  const name = nodeBuilderPortNameForField(field);
  const type = nodeBuilderComponentSchemaType(field.type || "input");
  const existingIndex = ports.findIndex((port) => port.sourceComponentId === sourceId);
  if (enabled) {
    const nextPort = {
      ...(existingIndex >= 0 ? ports[existingIndex] : {}),
      name,
      type,
      visible: true,
      sourceComponentId: sourceId,
      sourceComponentKey: field.key || name,
    };
    if (existingIndex >= 0) ports[existingIndex] = nextPort;
    else ports.push(nextPort);
  } else if (existingIndex >= 0) {
    ports.splice(existingIndex, 1);
  }
  builder[listKey] = ports.length ? ports : normalizeNodeBuilderPorts([], side);
};

const collectNodeBuilderDataFields = (layout = []) => {
  const fields = [];
  walkNodeBuilderLayout(layout, (node) => {
    if (NODE_BUILDER_DATA_COMPONENT_TYPES.has(node.type)) {
      fields.push({
        id: node.id,
        key: node.key || String(node.label || "field").replace(/[^A-Za-z0-9_.-]/g, "_").toLowerCase(),
        label: node.label || node.key || "Field",
        type: nodeBuilderComponentSchemaType(node.type),
        component: node.type,
        required: Boolean(node.required),
        settings: nodeBuilderComponentSettings(node),
      });
    }
  });
  return fields;
};

const nodeBuilderSettingsSchemaFromLayout = (layout = []) =>
  Object.fromEntries(collectNodeBuilderDataFields(layout).map((field) => [field.key || field.label || "field", field.type || "string"]));

const nodeBuilderDefaultConfigFromLayout = (layout = []) =>
  Object.fromEntries(collectNodeBuilderDataFields(layout).map((field) => [field.key || field.label || "field", customConfigValue({}, field)]));

const NODE_BUILDER_RUNTIME_OPTIONS = [
  { value: "form", label: "Form only" },
  { value: "rest", label: "REST API" },
  { value: "websocket", label: "WebSocket" },
  { value: "rss", label: "RSS Feed" },
];

const NODE_BUILDER_HTTP_METHOD_OPTIONS = ["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => ({ value: method, label: method }));

const nodeBuilderRuntimeKind = (builder = {}) =>
  String(builder.runtimeConnector || builder.runtime?.connector || builder.execute?.kind || "form").toLowerCase();

const nodeBuilderRuntimePermissions = (kind = "form") => {
  if (kind === "websocket") return ["network.websocket"];
  if (kind === "rest" || kind === "rss") return ["network.fetch"];
  return [];
};

const nodeBuilderRuntimeConfig = (builder = {}) => {
  const kind = nodeBuilderRuntimeKind(builder);
  return {
    runtimeConnector: kind,
    endpoint: String(builder.endpoint || "").trim(),
    method: String(builder.method || "GET").toUpperCase(),
    requestBody: String(builder.requestBody || ""),
    keepWebSocketOpen: Boolean(builder.keepWebSocketOpen),
  };
};

const nodeBuilderRuntimeExecute = (builder = {}) => {
  const config = nodeBuilderRuntimeConfig(builder);
  if (config.runtimeConnector === "form") return null;
  return {
    kind: config.runtimeConnector,
    endpoint: config.endpoint,
    method: config.method,
    keepOpen: config.keepWebSocketOpen,
  };
};

const nodeBuilderRuntimeModeLabel = (builder = {}) => {
  const kind = nodeBuilderRuntimeKind(builder);
  if (kind === "rest") return "manual / REST test";
  if (kind === "websocket") return builder.keepWebSocketOpen ? "manual / WebSocket stream" : "manual / WebSocket test";
  if (kind === "rss") return "manual / RSS fetch";
  return builder.runtimeMode || "manual / form";
};

const nodeBuilderStateFromTemplate = (template = {}, group = "Custom") => {
  const fields = nodeBuilderFieldsFromTemplate(template);
  const formLayout = normalizeNodeBuilderLayout(template.formLayout || template.formSchema?.layout || nodeBuilderLayoutFromFields(fields));
  const runtimeConfig = {
    ...(template.runtimeConfig || {}),
    ...(template.config || {}),
  };
  const runtimeConnector = String(template.runtimeConnector || template.execute?.kind || template.manifest?.execute?.kind || runtimeConfig.runtimeConnector || "form").toLowerCase();
  return {
    sourceGroup: group,
    label: template.label || "Custom Node",
    nodeType: template.nodeType || "custom",
    subtype: template.subtype || "custom",
    category: template.category || String(group || "custom").toLowerCase(),
    icon: template.icon || "extension",
    tone: template.tone || "gold",
    connectionType: template.connectionType || template.trackerSource || "",
    runtimeConnector,
    endpoint: runtimeConfig.endpoint || template.endpoint || template.manifest?.execute?.endpoint || "",
    method: runtimeConfig.method || template.method || template.manifest?.execute?.method || "GET",
    requestBody: runtimeConfig.requestBody || runtimeConfig.body || template.requestBody || "",
    keepWebSocketOpen: Boolean(runtimeConfig.keepWebSocketOpen || runtimeConfig.keepOpen || template.keepWebSocketOpen || template.manifest?.execute?.keepOpen),
    runtimeMode: template.runtimeMode || template.runtime?.mode || nodeBuilderRuntimeModeLabel({ runtimeConnector, keepWebSocketOpen: Boolean(runtimeConfig.keepWebSocketOpen || template.keepWebSocketOpen) }),
    permissions: Array.isArray(template.permissions) ? [...template.permissions] : nodeBuilderRuntimePermissions(runtimeConnector),
    formLayout,
    fields: collectNodeBuilderDataFields(formLayout),
    inputs: normalizeNodeBuilderPorts(template.inputs || template.manifest?.inputs || ["input"], "in").map((port) => ({ ...port, visible: true })),
    outputs: normalizeNodeBuilderPorts(template.outputs || template.manifest?.outputs || ["output"], "out").map((port) => ({ ...port, visible: true })),
  };
};

const nodeBuilderStateToTemplate = (builder = {}) => {
  const formLayout = normalizeNodeBuilderLayout(builder.formLayout || nodeBuilderLayoutFromFields(builder.fields || []));
  const settingsSchema = nodeBuilderSettingsSchemaFromLayout(formLayout);
  const fields = collectNodeBuilderDataFields(formLayout);
  const runtimeConfig = nodeBuilderRuntimeConfig(builder);
  const execute = nodeBuilderRuntimeExecute(builder);
  const runtimePermissions = nodeBuilderRuntimePermissions(runtimeConfig.runtimeConnector);
  const permissions = [...new Set([...(Array.isArray(builder.permissions) ? builder.permissions : []), ...runtimePermissions])];
  const serializePort = (port = {}, side = "in") => ({
    name: port.name || (side === "in" ? "input" : "output"),
    type: port.type || "object",
    visible: port.visible !== false,
    required: Boolean(port.required),
    description: port.description || "",
    schema: port.schema || null,
    ...(port.sourceComponentId ? { sourceComponentId: port.sourceComponentId, sourceComponentKey: port.sourceComponentKey || "" } : {}),
    ...(side === "out" ? {
      sourceMode: port.sourceMode || "runtimeResult",
      sourcePath: port.sourcePath || "",
      sourceComponentKey: port.sourceComponentKey || "",
      expression: port.expression || "",
    } : {}),
  });
  return {
    label: builder.label || "Custom Node",
    icon: builder.icon || "extension",
    tone: builder.tone || "gold",
    nodeType: builder.nodeType || "custom",
    subtype: builder.subtype || "custom",
    category: builder.category || "custom",
    inputs: (builder.inputs || []).map((port) => serializePort(port, "in")),
    outputs: (builder.outputs || []).map((port) => serializePort(port, "out")),
    permissions,
    runtimeConnector: runtimeConfig.runtimeConnector,
    runtimeConfig,
    runtimeMode: nodeBuilderRuntimeModeLabel(builder),
    connectionType: builder.connectionType || "",
    execute,
    formLayout,
    fields,
    settingsSchema,
    manifest: {
      type: builder.nodeType || "custom",
      subtype: builder.subtype || "custom",
      category: builder.category || "custom",
      inputs: (builder.inputs || []).map((port) => serializePort(port, "in")),
      outputs: (builder.outputs || []).map((port) => serializePort(port, "out")),
      permissions,
      settingsSchema,
      runtime: {
        mode: nodeBuilderRuntimeModeLabel(builder),
        connector: runtimeConfig.runtimeConnector,
      },
      ...(execute ? { execute } : {}),
    },
  };
};

const renderNodeBuilderPreviewComponent = (node = {}) => {
  const settings = nodeBuilderComponentSettings(node);
  if (settings.visibleOnNode === false) return null;
  const label = node.label || node.key || node.type || "Component";
  if (NODE_BUILDER_CONTAINER_TYPES.has(node.type)) {
    const children = node.children?.length
      ? node.children.map((child) => renderNodeBuilderPreviewComponent(child)).filter(Boolean)
      : [];
    return _.div(
      { class: `tl-flow-node-builder-preview-form-node is-${node.type}` },
      _.div(
        { class: "tl-flow-node-builder-preview-form-head" },
        icon(nodeBuilderComponentIcon(node.type), "sm"),
        _.strong(label),
        _.em(node.type)
      ),
      _.div(
        { class: "tl-flow-node-builder-preview-form-children" },
        ...(children.length ? children : [_.span({ class: "tl-flow-node-builder-preview-empty" }, "Empty container")])
      )
    );
  }
  if (node.type === "badge" || node.type === "chip") {
    return _.span(
      { class: `tl-flow-node-builder-live-token is-${node.type}` },
      icon(settings.icon || nodeBuilderComponentIcon(node.type), "sm"),
      label
    );
  }
  if (node.type === "select") {
    const options = nodeBuilderFieldOptions(node);
    return _.Select({
      class: "tl-flow-node-builder-live-field",
      size: "sm",
      label,
      value: settings.defaultValue || options[0]?.value || "",
      disabled: true,
      options,
      slots: { arrow: () => icon("keyboard_arrow_down", "sm") },
    });
  }
  if (node.type === "checkbox") {
    return _.div(
      { class: "tl-flow-node-builder-live-check" },
      _.span(label),
      _.Checkbox({
        class: "tl-flow-node-builder-live-check-control",
        size: "sm",
        checked: Boolean(settings.defaultChecked),
        title: label,
        disabled: true,
        color: settings.color || "success",
        outline: true,
        ...(settings.icon ? { checkedIcon: settings.icon } : {}),
      })
    );
  }
  if (node.type === "radio") {
    return _.div(
      { class: "tl-flow-node-builder-live-check" },
      _.span(label),
      _.Radio({
        class: "tl-flow-node-builder-live-check-control",
        size: "sm",
        checked: Boolean(settings.defaultValue),
        title: label,
        disabled: true,
        color: settings.color || "success",
        outline: true,
        ...(settings.icon ? { checkedIcon: settings.icon } : {}),
      })
    );
  }
  if (node.type === "toggle" || node.type === "boolean") {
    return _.div(
      { class: "tl-flow-node-builder-live-toggle" },
      _.span(label),
      _.Toggle({
        class: "tl-flow-node-builder-live-toggle-control",
        size: "sm",
        checked: Boolean(settings.defaultChecked),
        color: settings.color || "success",
        disabled: true,
        ...(settings.icon ? { iconOn: settings.icon, checkedIcon: settings.icon } : {}),
      })
    );
  }
  if (node.type === "rating") {
    return _.div(
      { class: "tl-flow-node-builder-live-field" },
      _.span(label),
      _.Rating ? _.Rating({
        size: "sm",
        value: Number(settings.defaultValue) || 0,
        max: Number(settings.max) || 5,
        readonly: true,
        colorSelected: settings.color || "primary",
      }) : _.span(`${Number(settings.defaultValue) || 0} / ${Number(settings.max) || 5}`)
    );
  }
  if (node.type === "date") {
    return _.Date ? _.Date({
      class: "tl-flow-node-builder-live-field",
      size: "sm",
      label,
      value: String(settings.defaultValue || ""),
      disabled: true,
      ...(settings.icon ? { icon: settings.icon } : {}),
    }) : _.Input({ class: "tl-flow-node-builder-live-field", size: "sm", label, value: String(settings.defaultValue || ""), disabled: true });
  }
  if (node.type === "time") {
    return _.Time ? _.Time({
      class: "tl-flow-node-builder-live-field",
      size: "sm",
      label,
      value: String(settings.defaultValue || ""),
      disabled: true,
      ...(settings.icon ? { icon: settings.icon } : {}),
    }) : _.Input({ class: "tl-flow-node-builder-live-field", size: "sm", label, value: String(settings.defaultValue || ""), disabled: true });
  }
  if (node.type === "slider" || node.type === "number") {
    return _.div(
      { class: "tl-flow-node-builder-live-field" },
      _.span(label),
      _.Slider ? _.Slider({
        size: "sm",
        value: Number(settings.defaultValue) || Number(settings.min) || 0,
        min: Number(settings.min) || 0,
        max: Number(settings.max) || 100,
        step: Number(settings.step) || 1,
        color: settings.color || "primary",
        disabled: true,
        showValue: true,
      }) : _.div({ class: "tl-flow-node-builder-live-slider" })
    );
  }
  return _.Input({
    class: "tl-flow-node-builder-live-field",
    size: "sm",
    label,
    value: node.type === "textarea" ? (settings.defaultValue || "Preview text") : String(settings.defaultValue || ""),
    placeholder: node.key || label,
    disabled: true,
    ...(settings.icon ? { icon: settings.icon } : {}),
  });
};

const renderNodeBuilderPreviewFormNodes = (layout = []) => {
  const nodes = normalizeNodeBuilderLayout(layout);
  return nodes.length
    ? nodes.map((node) => renderNodeBuilderPreviewComponent(node)).filter(Boolean)
    : [
      _.div(
        { class: "tl-flow-node-builder-preview-form-empty is-inline" },
        icon("view_agenda", "sm"),
        _.strong("No form layout"),
        _.span("Add a Card or drag components into Form Fields.")
      )
    ];
};

const renderNodeBuilderPreview = (template = defaultNodeBuilderTemplate()) => {
  const inputs = normalizeNodeBuilderPorts(template.inputs || template.manifest?.inputs || ["input"], "in").filter((port) => port.visible !== false).slice(0, 4);
  const outputs = normalizeNodeBuilderPorts(template.outputs || template.manifest?.outputs || ["output"], "out").filter((port) => port.visible !== false).slice(0, 4);
  const tone = template.tone || "gold";
  const runtimeKind = nodeBuilderRuntimeKind(template);
  const runtimeSummary = runtimeKind === "form"
    ? (template.connectionType || template.trackerSource || "Template loaded for this workspace.")
    : `${runtimeKind.toUpperCase()} · ${template.endpoint || template.runtimeConfig?.endpoint || "endpoint required"}`;
  return _.div(
    { class: "tl-flow-node-builder-preview-stack" },
    _.div(
      { class: `tl-flow-node-builder-preview-node is-${tone}` },
      _.div(
        { class: "tl-flow-node-builder-preview-head" },
        _.span({ class: `tl-flow-node-icon is-${tone}` }, icon(template.icon || "extension", "md")),
        _.span(
          { class: "tl-flow-node-builder-preview-title" },
          _.strong(template.label || "Custom Node"),
          _.em(`${template.nodeType || "node"} · ${template.subtype || "custom"}`)
        ),
        _.span({ class: "tl-flow-status is-active" }, _.span(), "active")
      ),
      _.div(
        { class: "tl-flow-node-builder-preview-body" },
        _.small(runtimeSummary),
        _.div(
          { class: "tl-flow-node-builder-live-form" },
          ...renderNodeBuilderPreviewFormNodes(template.formLayout || template.formSchema?.layout || [])
        ),
        _.div(
          { class: "tl-flow-node-builder-preview-ports" },
          _.span("IN"),
          ...inputs.map((port) => _.em(port.name || port.label || "input")),
          _.span("OUT"),
          ...outputs.map((port) => _.em(port.name || port.label || "output"))
        )
      ),
      _.div(
        { class: "tl-flow-node-builder-preview-footer" },
        _.span(`${inputs.length} IN · ${outputs.length} OUT`),
        btn({ class: "tl-flow-node-test-btn", disabled: true, title: runtimeKind === "form" ? "Preview only" : "Create the node, then use this Play button on the canvas" }, icon("play_arrow", "sm"))
      )
    )
  );
};

const renderNodeBuilderFormLayout = (layout = [], depth = 0) => {
  const nodes = normalizeNodeBuilderLayout(layout);
  if (!nodes.length && depth === 0) {
    return [
      _.div(
        { class: "tl-flow-node-builder-empty-layout" },
        icon("dynamic_form", "sm"),
        _.strong("No form components"),
        _.span("Add a Card, Row, Col or input-like component.")
      ),
    ];
  }
  return nodes.map((node, index) => {
    const isContainer = NODE_BUILDER_CONTAINER_TYPES.has(node.type);
    const settings = nodeBuilderComponentSettings(node);
    const statusParts = isContainer
      ? [`${node.type} container`]
      : [
        `${node.type} · ${node.key || "display"}`,
        settings.visibleOnNode === false ? "hidden" : "visible",
        settings.exposeInput ? "IN" : "",
        settings.exposeOutput ? "OUT" : "",
      ].filter(Boolean);
    const childActions = isContainer ? _.span(
      { class: "tl-flow-node-builder-row-actions" },
      btn({ title: "Add Row", "aria-label": "Add Row", "data-node-builder-add-child": `${node.id}:row` }, icon("view_stream", "sm")),
      btn({ title: "Add Col", "aria-label": "Add Col", "data-node-builder-add-child": `${node.id}:col` }, icon("view_column", "sm")),
      btn({ title: "Add Input", "aria-label": "Add Input", "data-node-builder-add-child": `${node.id}:input` }, icon("input", "sm")),
      btn({ title: "Add Select", "aria-label": "Add Select", "data-node-builder-add-child": `${node.id}:select` }, icon("arrow_drop_down_circle", "sm"))
    ) : null;
    return _.div(
      {
        class: `tl-flow-node-builder-layout-node is-${node.type}${isContainer ? " is-container" : " is-leaf"}`,
        "data-node-builder-layout-id": node.id,
        ...(isContainer ? { "data-node-builder-drop-container": node.id } : {}),
        style: `--builder-depth:${depth}`,
      },
      _.div(
        { class: "tl-flow-node-builder-layout-head" },
        icon(nodeBuilderComponentIcon(node.type), "sm"),
        _.span(
          { class: "tl-flow-node-builder-row-main" },
          _.strong(node.label || node.key || node.type),
          _.em(statusParts.join(" · "))
        ),
        node.key && !isContainer ? _.code(node.key) : null,
        childActions,
        btn({ title: "Component settings", "aria-label": "Component settings", "data-node-builder-edit-field": node.id }, icon("tune", "sm")),
        btn({ title: "Remove component", "aria-label": "Remove component", "data-node-builder-delete-field": node.id, disabled: depth === 0 && nodes.length <= 1 && index === 0 }, icon("delete", "sm"))
      ),
      isContainer ? _.div(
        { class: "tl-flow-node-builder-layout-children" },
        ...(node.children?.length
          ? renderNodeBuilderFormLayout(node.children, depth + 1)
          : [_.div({ class: "tl-flow-node-builder-layout-empty" }, "Add components inside this container.")])
      ) : null
    );
  });
};

const renderNodeBuilderPortRows = (ports = [], side = "in") =>
  normalizeNodeBuilderPorts(ports, side).map((port, index) => _.div(
    { class: `tl-flow-node-builder-port-row${port.visible === false ? " is-hidden-port" : ""}`, "data-node-builder-port-side": side, "data-node-builder-port-index": index },
    icon("drag_indicator", "sm"),
    _.span(
      { class: "tl-flow-node-builder-row-main" },
      _.strong(port.name || port.label || (side === "in" ? "input" : "output")),
      _.em(side === "out"
        ? `${port.type || "object"} · ${port.sourceMode || "runtimeResult"}${port.sourceComponentKey ? `:${port.sourceComponentKey}` : ""}`
        : `${port.type || "object"}${port.required ? " · required" : ""}`)
    ),
    btn({ title: "Port settings", "aria-label": "Port settings", "data-node-builder-edit-port": `${side}:${index}` }, icon("tune", "sm")),
    btn({ title: port.visible === false ? "Show on node" : "Hide from node", "aria-label": port.visible === false ? "Show on node" : "Hide from node", "data-node-builder-toggle-port": `${side}:${index}` }, icon(port.visible === false ? "visibility_off" : "visibility", "sm")),
    btn({ title: "Remove port", "aria-label": "Remove port", "data-node-builder-delete-port": `${side}:${index}`, disabled: ports.length <= 1 }, icon("delete", "sm"))
  ));

const renderNodeBuilderCmswiftComponents = () =>
  nodeBuilderCmswiftComponents.map((component) => _.button(
    {
      type: "button",
      class: "tl-flow-node-builder-component",
      title: component.description || component.label,
      "aria-label": `CMSwift ${component.label}`,
      "data-node-builder-add-component": component.label.toLowerCase(),
    },
    icon("drag_indicator", "sm"),
    _.span({ class: "tl-flow-node-builder-component-icon" }, icon(component.icon || "widgets", "sm")),
    _.span(
      { class: "tl-flow-node-builder-template-main" },
      _.strong(component.label),
      _.em(`${component.type} · ${component.description}`)
    )
  ));

const openNodeBuilderDialog = (options = {}) => {
  const groups = nodeBuilderTemplateGroups();
  const templates = groups.flatMap(([group, items]) => items.map((item) => ({ group, item, id: nodeBuilderTemplateId(group, item) })));
  const editNode = options.editNode || null;
  const editTemplate = options.nodeTemplate || null;
  const editMode = Boolean(editNode?.id && editTemplate);
  let selectedId = editMode ? "editing-custom-node" : options.templateId || templates[0]?.id || "";
  let selected = editMode
    ? { group: "Custom Node", item: editTemplate, id: selectedId }
    : templates.find((entry) => entry.id === selectedId) || templates[0] || { group: "Custom", item: blankNodeTemplate(), id: "custom-blank-custom-node" };
  let builder = nodeBuilderStateFromTemplate(selected.item, selected.group);

  const rootFor = (eventOrElement) =>
    eventOrElement?.currentTarget?.closest?.(".tl-flow-node-builder") ||
    eventOrElement?.target?.closest?.(".tl-flow-node-builder") ||
    eventOrElement?.closest?.(".tl-flow-node-builder") ||
    document.querySelector(".tl-flow-node-builder");

  const readBuilderGeneral = (root) => {
    if (!root) return;
    builder.label = root.querySelector("[data-node-builder-field='label']")?.value?.trim() || builder.label || "Custom Node";
    builder.category = root.querySelector("[data-node-builder-field='category']")?.value?.trim() || builder.category || "custom";
    builder.icon = root.querySelector("[data-node-builder-field='icon']")?.value?.trim() || builder.icon || "extension";
    builder.tone = root.querySelector("[data-node-builder-field='tone']")?.value?.trim() || builder.tone || "gold";
    builder.subtype = root.querySelector("[data-node-builder-field='subtype']")?.value?.trim() || builder.subtype || "custom";
    const runtimeConnectorInput = root.querySelector("[data-node-builder-runtime='connector']");
    const endpointInput = root.querySelector("[data-node-builder-runtime='endpoint']");
    const methodInput = root.querySelector("[data-node-builder-runtime='method']");
    const bodyInput = root.querySelector("[data-node-builder-runtime='requestBody']");
    if (runtimeConnectorInput) builder.runtimeConnector = runtimeConnectorInput.value?.trim() || "form";
    if (endpointInput) builder.endpoint = endpointInput.value?.trim() || "";
    if (methodInput) builder.method = methodInput.value?.trim() || "GET";
    if (bodyInput) builder.requestBody = bodyInput.value || "";
  };

  const refreshNodeBuilder = (root, { full = false } = {}) => {
    if (!root) return;
    if (full) {
      const labelInput = root.querySelector("[data-node-builder-field='label']");
      const categoryInput = root.querySelector("[data-node-builder-field='category']");
      const iconInput = root.querySelector("[data-node-builder-field='icon']");
      const toneInput = root.querySelector("[data-node-builder-field='tone']");
      const subtypeInput = root.querySelector("[data-node-builder-field='subtype']");
      if (labelInput) labelInput.value = builder.label || "Custom Node";
      if (categoryInput) categoryInput.value = builder.category || "custom";
      if (iconInput) iconInput.value = builder.icon || "extension";
      if (toneInput) toneInput.value = builder.tone || "gold";
      if (subtypeInput) subtypeInput.value = builder.subtype || "custom";
      const runtime = root.querySelector("[data-node-builder-runtime-panel]");
      if (runtime) runtime.replaceChildren(renderNodeBuilderRuntimePanel(root));
      const fields = root.querySelector("[data-node-builder-fields]");
      if (fields) fields.replaceChildren(...renderNodeBuilderFormLayout(builder.formLayout || []));
      const inputPorts = root.querySelector("[data-node-builder-inputs]");
      if (inputPorts) inputPorts.replaceChildren(...renderNodeBuilderPortRows(builder.inputs, "in"));
      const outputPorts = root.querySelector("[data-node-builder-outputs]");
      if (outputPorts) outputPorts.replaceChildren(...renderNodeBuilderPortRows(builder.outputs, "out"));
    }
    const title = root.querySelector("[data-node-builder-active-title]");
    const meta = root.querySelector("[data-node-builder-active-meta]");
    const summary = root.querySelector("[data-node-builder-active-summary]");
    const runtimeExecution = root.querySelector("[data-node-builder-runtime-execution]");
    const runtimePermissions = root.querySelector("[data-node-builder-runtime-permissions]");
    if (title) title.textContent = builder.label || "Custom Node";
    if (meta) meta.textContent = `${builder.sourceGroup || "Custom"} · ${builder.nodeType || "node"} · ${builder.subtype || "custom"}`;
    if (summary) summary.textContent = builder.connectionType || "Template loaded for this workspace.";
    builder.runtimeMode = nodeBuilderRuntimeModeLabel(builder);
    const runtimePermissionsValue = [...new Set([...(builder.permissions || []), ...nodeBuilderRuntimePermissions(nodeBuilderRuntimeKind(builder))])];
    if (runtimeExecution) runtimeExecution.textContent = builder.runtimeMode || "manual / form";
    if (runtimePermissions) runtimePermissions.textContent = runtimePermissionsValue.join(", ") || "none";
    const preview = root.querySelector("[data-node-builder-preview]");
    if (preview) preview.replaceChildren(renderNodeBuilderPreview(builder));
  };

  const syncSelection = (root, nextId) => {
    if (editMode) return;
    selectedId = nextId || selectedId;
    selected = templates.find((entry) => entry.id === selectedId) || selected;
    builder = nodeBuilderStateFromTemplate(selected.item, selected.group);
    root.querySelectorAll("[data-node-builder-template]").forEach((button) => {
      button.classList.toggle("is-selected", button.dataset.nodeBuilderTemplate === selectedId);
    });
    refreshNodeBuilder(root, { full: true });
  };

  const filterTemplates = (root, query = "") => {
    const needle = String(query || "").trim().toLowerCase();
    let visibleGroups = 0;
    root.querySelectorAll("[data-node-builder-template-group]").forEach((section) => {
      let visibleItems = 0;
      section.querySelectorAll("[data-node-builder-template]").forEach((button) => {
        const matched = !needle || String(button.dataset.nodeBuilderSearch || "").includes(needle);
        button.hidden = !matched;
        if (matched) visibleItems += 1;
      });
      section.hidden = visibleItems === 0;
      if (visibleItems) visibleGroups += 1;
    });
    const empty = root.querySelector("[data-node-builder-empty]");
    if (empty) empty.hidden = visibleGroups > 0;
  };

  const toggleSideCard = (button) => {
    const card = button?.closest?.("[data-node-builder-side-card]");
    const body = card?.querySelector?.("[data-node-builder-side-body]");
    if (!card || !body) return;
    const collapsed = !card.classList.contains("is-collapsed");
    card.classList.toggle("is-collapsed", collapsed);
    button.setAttribute("aria-expanded", String(!collapsed));
    body.hidden = collapsed;
  };

  const editBuilderField = (fieldId = "", root = null) => {
    const found = findNodeBuilderLayoutNode(builder.formLayout || [], fieldId);
    const field = found?.node;
    if (!field) return;
    const isContainer = NODE_BUILDER_CONTAINER_TYPES.has(field.type);
    const formId = `tl-node-builder-field-${field.id}`;
    let labelValue = field.label || field.key || "Field";
    let keyValue = field.key || "field";
    let typeValue = field.type || "string";
    let requiredValue = Boolean(field.required);
    const settingsValue = { ...nodeBuilderComponentSettings(field) };
    let optionsValue = nodeBuilderOptionsText(settingsValue.options);
    const readCmsValue = (value) => value?.target?.value ?? value;
    const typeOptions = (isContainer ? ["card", "row", "col"] : ["input", "string", "number", "boolean", "object", "array", "toggle", "checkbox", "radio", "select", "slider", "rating", "date", "time", "textarea", "badge", "chip"])
      .map((type) => ({ value: type, label: type }));
    const colorOptions = NODE_BUILDER_COLOR_OPTIONS.map((color) => ({ value: color, label: color }));
    const renderSettingToggle = (label, checked, onChange) => _.div(
      { class: "tl-flow-config-toggle-row" },
      _.span(label),
      _.Toggle({
        size: "sm",
        checked,
        color: "success",
        onChange,
      })
    );
    const renderComponentSettings = () => {
      if (isContainer) return null;
      const currentType = String(typeValue || field.type || "input");
      const optionTypes = new Set(["select", "radio"]);
      const booleanTypes = new Set(["checkbox", "toggle", "boolean"]);
      const rangedTypes = new Set(["slider", "number", "rating"]);
      const dateTimeTypes = new Set(["date", "time"]);
      return _.div(
        { class: "tl-flow-config-section" },
        _.h3("Component"),
        _.div(
          { class: "tl-flow-config-grid" },
          _.Select({
            size: "sm",
            label: "Icon",
            value: settingsValue.icon || "",
            options: FLOW_COMPONENT_ICON_OPTIONS,
            filterable: true,
            clearable: true,
            filterPlaceholder: "Search icon",
            icon: settingsValue.icon || "auto_awesome",
            slots: { arrow: () => icon("keyboard_arrow_down", "sm") },
            onChange: (value) => {
              settingsValue.icon = String(readCmsValue(value) || "").trim() || null;
            },
          }),
          _.Select({
            size: "sm",
            label: "Color",
            value: settingsValue.color || "success",
            options: colorOptions,
            slots: { arrow: () => icon("keyboard_arrow_down", "sm") },
            onChange: (value) => {
              settingsValue.color = String(readCmsValue(value) || "success");
            },
          })
        ),
        renderSettingToggle("Visible on node", settingsValue.visibleOnNode !== false, (checked) => {
          settingsValue.visibleOnNode = Boolean(checked);
        }),
        renderSettingToggle("Expose as IN port", Boolean(settingsValue.exposeInput), (checked) => {
          settingsValue.exposeInput = Boolean(checked);
        }),
        renderSettingToggle("Expose as OUT port", Boolean(settingsValue.exposeOutput), (checked) => {
          settingsValue.exposeOutput = Boolean(checked);
        }),
        booleanTypes.has(currentType) ? renderSettingToggle("Default state", Boolean(settingsValue.defaultChecked), (checked) => {
          settingsValue.defaultChecked = Boolean(checked);
        }) : null,
        optionTypes.has(currentType) ? _.Input({
          size: "sm",
          label: "Options",
          value: optionsValue,
          placeholder: "Option 1:option-1, Option 2:option-2",
          autocomplete: "off",
          onInput: (event) => {
            optionsValue = String(readCmsValue(event) || "");
          },
        }) : null,
        optionTypes.has(currentType) ? _.Input({
          size: "sm",
          label: "Default",
          value: String(settingsValue.defaultValue || ""),
          placeholder: "option-1",
          autocomplete: "off",
          onInput: (event) => {
            settingsValue.defaultValue = String(readCmsValue(event) || "");
          },
        }) : null,
        rangedTypes.has(currentType) ? _.div(
          { class: "tl-flow-config-grid" },
          _.Input({
            size: "sm",
            label: "Min",
            value: String(settingsValue.min ?? 0),
            autocomplete: "off",
            onInput: (event) => {
              settingsValue.min = Number(readCmsValue(event)) || 0;
            },
          }),
          _.Input({
            size: "sm",
            label: "Max",
            value: String(settingsValue.max ?? (currentType === "rating" ? 5 : 100)),
            autocomplete: "off",
            onInput: (event) => {
              settingsValue.max = Number(readCmsValue(event)) || (currentType === "rating" ? 5 : 100);
            },
          }),
          _.Input({
            size: "sm",
            label: "Step",
            value: String(settingsValue.step ?? 1),
            autocomplete: "off",
            onInput: (event) => {
              settingsValue.step = Number(readCmsValue(event)) || 1;
            },
          }),
          _.Input({
            size: "sm",
            label: "Default",
            value: String(settingsValue.defaultValue ?? ""),
            autocomplete: "off",
            onInput: (event) => {
              settingsValue.defaultValue = Number(readCmsValue(event)) || 0;
            },
          })
        ) : null,
        dateTimeTypes.has(currentType) || ["input", "string", "textarea"].includes(currentType) ? _.Input({
          size: "sm",
          label: "Default value",
          value: String(settingsValue.defaultValue || ""),
          autocomplete: "off",
          onInput: (event) => {
            settingsValue.defaultValue = String(readCmsValue(event) || "");
          },
        }) : null
      );
    };
    const saveFieldSettings = () => {
      const label = String(labelValue || "").trim() || field.label || field.key || "Field";
      field.label = label;
      field.key = isContainer ? "" : (String(keyValue || "").trim() || label).replace(/[^A-Za-z0-9_.-]/g, "_");
      field.type = String(typeValue || "string");
      if (NODE_BUILDER_CONTAINER_TYPES.has(field.type) && !Array.isArray(field.children)) field.children = [];
      if (!NODE_BUILDER_CONTAINER_TYPES.has(field.type)) delete field.children;
      field.required = Boolean(requiredValue);
      field.settings = normalizeNodeBuilderSettings(field.type, {
        ...settingsValue,
        options: nodeBuilderOptionsFromText(optionsValue),
      });
      syncNodeBuilderComponentPort(builder, field, "in", Boolean(field.settings.exposeInput));
      syncNodeBuilderComponentPort(builder, field, "out", Boolean(field.settings.exposeOutput));
      builder.fields = collectNodeBuilderDataFields(builder.formLayout || []);
      fieldDialog.close();
      refreshNodeBuilder(root, { full: true });
    };
    const fieldDialog = _.Dialog({
      class: "tl-flow-node-builder-dialog",
      panelClass: "tl-flow-config-panel",
      size: "md",
      title: isContainer ? "Container Settings" : "Field Settings",
      subtitle: field.key || field.label || "field",
      icon: "dynamic_form",
      closeButton: true,
      content: () => _.form(
        {
          id: formId,
          class: "tl-flow-config-form",
          onsubmit: (event) => {
            event.preventDefault();
            saveFieldSettings();
          },
        },
        _.Input({
          size: "sm",
          label: "Label",
          value: labelValue,
          autocomplete: "off",
          onInput: (event) => {
            labelValue = String(readCmsValue(event) || "");
          },
        }),
        isContainer ? null : _.Input({
          size: "sm",
          label: "Key",
          value: keyValue,
          autocomplete: "off",
          onInput: (event) => {
            keyValue = String(readCmsValue(event) || "");
          },
        }),
        _.Select({
          size: "sm",
          label: "Type",
          value: typeValue,
          options: typeOptions,
          slots: { arrow: () => icon("keyboard_arrow_down", "sm") },
          onChange: (value) => {
            typeValue = String(readCmsValue(value) || "string");
          },
        }),
        isContainer ? null : _.div(
          { class: "tl-flow-config-toggle-row" },
          _.span("Required"),
          _.Toggle({
            size: "sm",
            checked: requiredValue,
            color: "success",
            onChange: (checked) => {
              requiredValue = Boolean(checked);
            },
          })
        ),
        renderComponentSettings()
      ),
      actions: ({ close }) => _.Toolbar(
        { align: "end", gap: 8 },
        btn({ onclick: close }, "Cancel"),
        btn({ class: "is-primary", onclick: saveFieldSettings }, icon("save", "sm"), "Save Field")
      ),
    });
    fieldDialog.open();
  };

  const addBuilderField = (root) => {
    readBuilderGeneral(root);
    const count = collectNodeBuilderDataFields(builder.formLayout || []).length + 1;
    builder.formLayout = builder.formLayout || [];
    builder.formLayout.push({
      id: nodeBuilderId("field"),
      key: `field_${count}`,
      label: `Field ${count}`,
      type: "input",
      required: false,
    });
    builder.fields = collectNodeBuilderDataFields(builder.formLayout);
    refreshNodeBuilder(root, { full: true });
  };

  const addBuilderCard = (root) => {
    readBuilderGeneral(root);
    let count = 1;
    walkNodeBuilderLayout(builder.formLayout || [], (node) => {
      if (node.type === "card") count += 1;
    });
    builder.formLayout = builder.formLayout || [];
    builder.formLayout.push({
      id: nodeBuilderId("card"),
      label: `Card ${count}`,
      type: "card",
      children: [],
    });
    builder.fields = collectNodeBuilderDataFields(builder.formLayout);
    refreshNodeBuilder(root, { full: true });
  };

  const deleteBuilderField = (fieldId = "", root = null) => {
    const found = findNodeBuilderLayoutNode(builder.formLayout || [], fieldId);
    if (found?.node) {
      walkNodeBuilderLayout([found.node], (node) => {
        syncNodeBuilderComponentPort(builder, node, "in", false);
        syncNodeBuilderComponentPort(builder, node, "out", false);
      });
    }
    if (!removeNodeBuilderLayoutNode(builder.formLayout || [], fieldId)) return;
    builder.fields = collectNodeBuilderDataFields(builder.formLayout || []);
    refreshNodeBuilder(root, { full: true });
  };

  const addBuilderComponent = (type = "input", root = null, parentId = "") => {
    readBuilderGeneral(root);
    const componentType = String(type || "input");
    const isContainer = NODE_BUILDER_CONTAINER_TYPES.has(componentType);
    const siblings = parentId
      ? findNodeBuilderLayoutNode(builder.formLayout || [], parentId)?.node?.children
      : builder.formLayout;
    const list = siblings || builder.formLayout || [];
    const count = list.filter((item) => item.type === componentType).length + 1;
    const label = `${componentType.charAt(0).toUpperCase()}${componentType.slice(1)} ${count}`;
    const next = {
      id: nodeBuilderId(componentType),
      type: componentType,
      label,
      settings: normalizeNodeBuilderSettings(componentType, {}),
      ...(isContainer
        ? { children: [] }
        : {
          key: `${componentType === "input" ? "field" : componentType}_${collectNodeBuilderDataFields(builder.formLayout || []).length + 1}`,
          required: false,
        }),
    };
    if (parentId) {
      const parent = findNodeBuilderLayoutNode(builder.formLayout || [], parentId)?.node;
      if (parent && NODE_BUILDER_CONTAINER_TYPES.has(parent.type)) {
        parent.children = parent.children || [];
        parent.children.push(next);
      }
    } else {
      builder.formLayout = builder.formLayout || [];
      builder.formLayout.push(next);
    }
    builder.fields = collectNodeBuilderDataFields(builder.formLayout || []);
    refreshNodeBuilder(root, { full: true });
  };

  const clearBuilderDropTargets = (root) => {
    root?.querySelectorAll?.(".is-builder-drop-target").forEach((element) => element.classList.remove("is-builder-drop-target"));
  };

  const resolveBuilderDropTarget = (eventOrElement) => {
    const source = eventOrElement?.target || eventOrElement;
    const container = source?.closest?.("[data-node-builder-drop-container]");
    if (container) return container;
    return source?.closest?.("[data-node-builder-drop-root]");
  };

  const resolveBuilderDropTargetFromPoint = (root, clientX, clientY) => {
    const element = document.elementFromPoint(clientX, clientY);
    if (!element || !root?.contains?.(element)) return null;
    return resolveBuilderDropTarget(element);
  };

  const builderDropParentId = (target) =>
    target?.dataset?.nodeBuilderDropContainer || "";

  let builderComponentDrag = null;
  let suppressBuilderComponentClick = false;

  const createBuilderDragGhost = (component) => {
    const rect = component.getBoundingClientRect();
    const ghost = component.cloneNode(true);
    ghost.classList.add("tl-flow-node-builder-drag-ghost");
    ghost.style.width = `${rect.width}px`;
    document.body.appendChild(ghost);
    return ghost;
  };

  const moveBuilderDragGhost = (drag, clientX, clientY) => {
    if (!drag?.ghost) return;
    drag.ghost.style.transform = `translate3d(${clientX + 12}px, ${clientY + 12}px, 0)`;
  };

  const updateBuilderPointerDropTarget = (drag, clientX, clientY) => {
    clearBuilderDropTargets(drag.root);
    const target = resolveBuilderDropTargetFromPoint(drag.root, clientX, clientY);
    drag.dropTarget = target;
    target?.classList.add("is-builder-drop-target");
  };

  const cleanupBuilderComponentPointerDrag = () => {
    if (!builderComponentDrag) return;
    clearBuilderDropTargets(builderComponentDrag.root);
    builderComponentDrag.source?.classList.remove("is-dragging");
    builderComponentDrag.ghost?.remove();
    document.body.classList.remove("is-node-builder-component-dragging");
    document.removeEventListener("pointermove", moveBuilderComponentPointerDrag);
    document.removeEventListener("pointerup", endBuilderComponentPointerDrag);
    document.removeEventListener("pointercancel", cancelBuilderComponentPointerDrag);
    builderComponentDrag = null;
    if (suppressBuilderComponentClick) {
      window.setTimeout(() => {
        suppressBuilderComponentClick = false;
      }, 120);
    }
  };

  function moveBuilderComponentPointerDrag(event) {
    const drag = builderComponentDrag;
    if (!drag) return;
    const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4;
    if (moved) {
      drag.moved = true;
      suppressBuilderComponentClick = true;
      if (!drag.ghost) drag.ghost = createBuilderDragGhost(drag.source);
      moveBuilderDragGhost(drag, event.clientX, event.clientY);
      updateBuilderPointerDropTarget(drag, event.clientX, event.clientY);
      event.preventDefault();
    }
  }

  function endBuilderComponentPointerDrag(event) {
    const drag = builderComponentDrag;
    if (!drag) return;
    if (drag.moved && drag.dropTarget) {
      addBuilderComponent(drag.type, drag.root, builderDropParentId(drag.dropTarget));
    }
    cleanupBuilderComponentPointerDrag();
  }

  function cancelBuilderComponentPointerDrag() {
    cleanupBuilderComponentPointerDrag();
  }

  const beginBuilderComponentPointerDrag = (event) => {
    const component = event.target.closest?.("[data-node-builder-add-component]");
    if (!component || event.button !== 0) return;
    const type = component.dataset.nodeBuilderAddComponent || "";
    if (!type) return;
    const root = rootFor(event);
    if (!root) return;
    event.preventDefault();
    builderComponentDrag = {
      root,
      source: component,
      type,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      ghost: null,
      dropTarget: null,
    };
    component.classList.add("is-dragging");
    document.body.classList.add("is-node-builder-component-dragging");
    document.addEventListener("pointermove", moveBuilderComponentPointerDrag);
    document.addEventListener("pointerup", endBuilderComponentPointerDrag, { once: true });
    document.addEventListener("pointercancel", cancelBuilderComponentPointerDrag, { once: true });
  };

  const nodeBuilderComponentPortOptions = () => [
    { value: "", label: "None" },
    ...collectNodeBuilderDataFields(builder.formLayout || []).map((field) => ({
      value: field.key,
      label: `${field.label || field.key} · ${field.type || "field"}`,
    })),
  ];

  const editBuilderPort = (payload = "", root = null) => {
    const [side, indexValue] = String(payload).split(":");
    const listKey = side === "out" ? "outputs" : "inputs";
    const list = normalizeNodeBuilderPorts(builder[listKey] || [], side);
    const index = Number(indexValue);
    const port = list[index];
    if (!port) return;
    const readCmsValue = (value) => value?.target?.value ?? value;
    const componentOptions = nodeBuilderComponentPortOptions();
    const draft = {
      name: port.name || (side === "out" ? "output" : "input"),
      type: port.type || "object",
      required: Boolean(port.required),
      visible: port.visible !== false,
      description: port.description || "",
      schemaText: typeof port.schema === "string" ? port.schema : port.schema ? JSON.stringify(port.schema, null, 2) : "",
      sourceMode: port.sourceMode || "runtimeResult",
      sourcePath: port.sourcePath || "",
      sourceComponentKey: port.sourceComponentKey || "",
      expression: port.expression || "",
    };
    const savePortSettings = () => {
      const next = {
        ...port,
        name: String(draft.name || "").trim().replace(/[^A-Za-z0-9_.-]/g, "_") || (side === "out" ? "output" : "input"),
        type: String(draft.type || "object"),
        required: Boolean(draft.required),
        visible: draft.visible !== false,
        description: String(draft.description || "").trim(),
        schema: String(draft.schemaText || "").trim()
          ? (parseTestPayload(draft.schemaText) || String(draft.schemaText || "").trim())
          : null,
      };
      if (side === "out") {
        next.sourceMode = draft.sourceMode || "runtimeResult";
        next.sourcePath = String(draft.sourcePath || "").trim();
        next.sourceComponentKey = String(draft.sourceComponentKey || "").trim();
        next.expression = String(draft.expression || "").trim();
      }
      list[index] = next;
      builder[listKey] = list;
      builder.fields = collectNodeBuilderDataFields(builder.formLayout || []);
      portDialog.close();
      refreshNodeBuilder(root, { full: true });
    };
    const portDialog = _.Dialog({
      class: "tl-flow-node-builder-dialog",
      panelClass: "tl-flow-config-panel",
      size: "md",
      title: side === "out" ? "Output Port Settings" : "Input Port Settings",
      subtitle: port.name || (side === "out" ? "output" : "input"),
      icon: side === "out" ? "output" : "input",
      closeButton: true,
      content: () => _.form(
        {
          class: "tl-flow-config-form",
          onsubmit: (event) => {
            event.preventDefault();
            savePortSettings();
          },
        },
        _.div(
          { class: "tl-flow-config-grid" },
          _.Input({
            size: "sm",
            label: "Port name",
            value: draft.name,
            autocomplete: "off",
            onInput: (event) => {
              draft.name = String(readCmsValue(event) || "");
            },
          }),
          _.Select({
            size: "sm",
            label: "Data type",
            value: draft.type,
            options: NODE_BUILDER_PORT_TYPE_OPTIONS,
            filterable: true,
            slots: { arrow: () => icon("keyboard_arrow_down", "sm") },
            onChange: (value) => {
              draft.type = String(readCmsValue(value) || "object");
            },
          })
        ),
        _.div(
          { class: "tl-flow-config-toggle-row" },
          _.span(side === "out" ? "Show on node" : "Required input"),
          _.Toggle({
            size: "sm",
            checked: side === "out" ? draft.visible !== false : draft.required,
            color: "success",
            onChange: (checked) => {
              if (side === "out") draft.visible = Boolean(checked);
              else draft.required = Boolean(checked);
            },
          })
        ),
        _.Input({
          size: "sm",
          label: "Description",
          value: draft.description,
          placeholder: side === "out" ? "Payload produced by this output" : "Expected incoming payload",
          autocomplete: "off",
          onInput: (event) => {
            draft.description = String(readCmsValue(event) || "");
          },
        }),
        _.Input({
          size: "sm",
          label: "JSON schema",
          value: draft.schemaText,
          placeholder: "{\"type\":\"object\"}",
          autocomplete: "off",
          onInput: (event) => {
            draft.schemaText = String(readCmsValue(event) || "");
          },
        }),
        side === "out" ? _.div(
          { class: "tl-flow-config-section" },
          _.h3("Output Source"),
          _.Select({
            size: "sm",
            label: "Source",
            value: draft.sourceMode,
            options: NODE_BUILDER_OUTPUT_SOURCE_OPTIONS,
            slots: { arrow: () => icon("keyboard_arrow_down", "sm") },
            onChange: (value) => {
              draft.sourceMode = String(readCmsValue(value) || "runtimeResult");
            },
          }),
          _.Select({
            size: "sm",
            label: "Component",
            value: draft.sourceComponentKey,
            options: componentOptions,
            filterable: true,
            slots: { arrow: () => icon("keyboard_arrow_down", "sm") },
            onChange: (value) => {
              draft.sourceComponentKey = String(readCmsValue(value) || "");
            },
          }),
          _.Input({
            size: "sm",
            label: "Path",
            value: draft.sourcePath,
            placeholder: "data.price or payload.result",
            autocomplete: "off",
            onInput: (event) => {
              draft.sourcePath = String(readCmsValue(event) || "");
            },
          }),
          _.Input({
            size: "sm",
            label: "Static / function",
            value: draft.expression,
            placeholder: "Static value or return { value: data.name }",
            autocomplete: "off",
            onInput: (event) => {
              draft.expression = String(readCmsValue(event) || "");
            },
          })
        ) : null
      ),
      actions: ({ close }) => _.Toolbar(
        { align: "end", gap: 8 },
        btn({ onclick: close }, "Cancel"),
        btn({ class: "is-primary", onclick: savePortSettings }, icon("save", "sm"), "Save Port")
      ),
    });
    portDialog.open();
  };

  const addBuilderPort = (side = "in", root = null) => {
    const list = side === "out" ? builder.outputs : builder.inputs;
    list.push({
      name: side === "out" ? `output_${list.length + 1}` : `input_${list.length + 1}`,
      type: "object",
      visible: true,
      required: false,
      description: "",
      sourceMode: side === "out" ? "runtimeResult" : "",
    });
    refreshNodeBuilder(root, { full: true });
  };

  const toggleBuilderPort = (payload = "", root = null) => {
    const [side, indexValue] = String(payload).split(":");
    const list = side === "out" ? builder.outputs : builder.inputs;
    const index = Number(indexValue);
    if (!list[index]) return;
    list[index].visible = list[index].visible === false;
    refreshNodeBuilder(root, { full: true });
  };

  const deleteBuilderPort = (payload = "", root = null) => {
    const [side, indexValue] = String(payload).split(":");
    const list = side === "out" ? builder.outputs : builder.inputs;
    const index = Number(indexValue);
    if (!list[index] || list.length <= 1) return;
    list.splice(index, 1);
    refreshNodeBuilder(root, { full: true });
  };

  const readBuilderRuntimeValue = (value) => value?.target?.value ?? value;

  const updateBuilderRuntime = (root, patch = {}, full = false) => {
    builder = {
      ...builder,
      ...patch,
    };
    builder.runtimeMode = nodeBuilderRuntimeModeLabel(builder);
    builder.permissions = [...new Set([...(builder.permissions || []).filter((permission) => !["network.fetch", "network.websocket"].includes(permission)), ...nodeBuilderRuntimePermissions(nodeBuilderRuntimeKind(builder))])];
    refreshNodeBuilder(root || document.querySelector(".tl-flow-node-builder"), { full });
  };

  const renderNodeBuilderRuntimePanel = (root = null) => {
    const kind = nodeBuilderRuntimeKind(builder);
    const isNetwork = kind !== "form";
    return _.div(
      { class: "tl-flow-node-builder-runtime-panel" },
      _.div(
        { class: "tl-flow-node-builder-runtime-grid" },
        _.Select({
          size: "sm",
          label: "Runtime call",
          value: kind,
          options: NODE_BUILDER_RUNTIME_OPTIONS,
          "data-node-builder-runtime": "connector",
          slots: { arrow: () => icon("keyboard_arrow_down", "sm") },
          onChange: (value) => updateBuilderRuntime(root || document.querySelector(".tl-flow-node-builder"), { runtimeConnector: String(readBuilderRuntimeValue(value) || "form") }, true),
        }),
        isNetwork ? _.Input({
          size: "sm",
          label: kind === "websocket" ? "WebSocket URL" : kind === "rss" ? "RSS URL" : "Endpoint",
          value: builder.endpoint || "",
          placeholder: kind === "websocket" ? "wss://stream.example.com/feed" : "https://api.example.com/data",
          autocomplete: "off",
          "data-node-builder-runtime": "endpoint",
          onInput: (event) => {
            builder.endpoint = String(readBuilderRuntimeValue(event) || "");
            refreshNodeBuilder(root || document.querySelector(".tl-flow-node-builder"));
          },
        }) : null,
        kind === "rest" ? _.Select({
          size: "sm",
          label: "Method",
          value: builder.method || "GET",
          options: NODE_BUILDER_HTTP_METHOD_OPTIONS,
          "data-node-builder-runtime": "method",
          slots: { arrow: () => icon("keyboard_arrow_down", "sm") },
          onChange: (value) => updateBuilderRuntime(root || document.querySelector(".tl-flow-node-builder"), { method: String(readBuilderRuntimeValue(value) || "GET").toUpperCase() }),
        }) : null,
        kind === "rest" ? _.Input({
          size: "sm",
          label: "JSON body",
          value: builder.requestBody || "",
          placeholder: "{\"query\":\"status\"}",
          autocomplete: "off",
          "data-node-builder-runtime": "requestBody",
          onInput: (event) => {
            builder.requestBody = String(readBuilderRuntimeValue(event) || "");
          },
        }) : null
      ),
      kind === "websocket" ? _.div(
        { class: "tl-flow-config-toggle-row" },
        _.span("Keep WebSocket open"),
        _.Toggle({
          size: "sm",
          checked: Boolean(builder.keepWebSocketOpen),
          color: "success",
          onChange: (checked) => updateBuilderRuntime(root || document.querySelector(".tl-flow-node-builder"), { keepWebSocketOpen: Boolean(checked) }),
        })
      ) : null,
      _.p(
        { class: "tl-flow-node-builder-runtime-help" },
        isNetwork
          ? "Il play del nodo esegue questa chiamata e pubblica il payload sulle porte OUT collegate."
          : "Form only salva dati/config del nodo. Scegli REST, WebSocket o RSS per abilitare test runtime dal canvas."
      )
    );
  };

  const saveBuilderTemplateAction = (root) => {
    readBuilderGeneral(root);
    saveNodeBuilderTemplate(nodeBuilderStateToTemplate(builder));
    const button = root?.closest?.(".cms-dialog")?.querySelector?.("[data-node-builder-save-template]");
    if (button) {
      button.classList.add("is-saved");
      button.textContent = "Saved";
      window.setTimeout(() => {
        button.classList.remove("is-saved");
        button.replaceChildren(icon("save", "sm"), "Save Template");
      }, 1200);
    }
  };

  const createNodeFromBuilderAction = async (root, close) => {
    readBuilderGeneral(root);
    const item = nodeBuilderStateToTemplate(builder);
    try {
      const workspaceId = await ensureRuntimeWorkspaceScope();
      const now = new Date().toISOString();
      const portChannels = [...new Set([...(item.inputs || []), ...(item.outputs || [])].map((port) => port.name || port).filter(Boolean))];
      let node = {
        id: `custom_${safeRuntimeId(workspaceId)}_${Date.now()}`,
        workspaceId,
        type: item.nodeType || "custom",
        label: item.label || "Custom Node",
        inputs: item.inputs || [],
        outputs: item.outputs || [],
        flowPosition: options.flowPosition || defaultAssetFlowPosition(),
        channels: portChannels,
        sourceRef: "",
        assetId: "",
        status: "idle",
        runtime: { status: "idle", active: false },
        metadata: {
          paletteLabel: item.label || "Custom Node",
          paletteAction: "node-builder",
          tone: item.tone || "gold",
          icon: item.icon || "extension",
          runtimeType: item.nodeType || "custom",
          subtype: item.subtype || "custom",
          category: item.category || "custom",
          manifest: item.manifest || null,
          execute: item.execute || null,
          runtimeConfig: item.runtimeConfig || {},
          runtimeMetadata: item.manifest?.runtime || { mode: item.runtimeMode || "manual / form", connector: item.runtimeConnector || "form" },
          permissions: item.permissions || [],
          settingsSchema: item.settingsSchema || {},
          formSchema: {
            fields: item.fields || [],
            layout: item.formLayout || [],
          },
          formLayout: item.formLayout || [],
          portUi: {
            in: { hidden: (builder.inputs || []).filter((port) => port.visible === false).map((port) => port.name) },
            out: { hidden: (builder.outputs || []).filter((port) => port.visible === false).map((port) => port.name) },
          },
          customNode: true,
        },
        createdAt: now,
        updatedAt: now,
      };
      node = customRuntimeNodeUpdate({
        node,
        label: item.label || "Custom Node",
        runtimeStatus: "idle",
        config: {
          ...nodeBuilderDefaultConfigFromLayout(item.formLayout || []),
          ...(item.runtimeConfig || {}),
        },
      });
      node = await window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode?.({ node });
      if (node?.id && window.TrackerLensChannelRegistry?.upsertChannelsForRuntimeNode) {
        await window.TrackerLensChannelRegistry.upsertChannelsForRuntimeNode({ node });
      }
      if (node?.id) {
        setFocusState({
          mode: "dependencies",
          nodeId: node.id,
          edgeId: "",
          nodeType: node.type,
          channel: node.channels?.[0] || "",
          connectionId: "",
        });
        state.inspectorOpen = true;
      }
      close?.();
      await loadRuntime({ force: true });
    } catch (error) {
      state.error = error?.message || "Errore creazione custom node";
      setErrorSignal(state.error);
      mount();
    }
  };

  const saveExistingNodeFromBuilderAction = async (root, close) => {
    if (!editMode || !editNode?.id) return;
    readBuilderGeneral(root);
    const item = nodeBuilderStateToTemplate(builder);
    const current = nodeById(editNode.id) || editNode;
    const previousMetadata = current.metadata || {};
    const baseNode = {
      ...current,
      type: item.nodeType || current.type || "custom",
      label: item.label || current.label || "Custom Node",
      inputs: item.inputs || [],
      outputs: item.outputs || [],
      metadata: {
        ...previousMetadata,
        paletteLabel: item.label || previousMetadata.paletteLabel || "Custom Node",
        paletteAction: previousMetadata.paletteAction || "node-builder",
        tone: item.tone || previousMetadata.tone || "gold",
        icon: item.icon || previousMetadata.icon || "extension",
        runtimeType: item.nodeType || previousMetadata.runtimeType || "custom",
        subtype: item.subtype || previousMetadata.subtype || "custom",
        category: item.category || previousMetadata.category || "custom",
        manifest: item.manifest || previousMetadata.manifest || null,
        execute: item.execute || previousMetadata.execute || null,
        runtimeConfig: item.runtimeConfig || previousMetadata.runtimeConfig || {},
        runtimeMetadata: item.manifest?.runtime || previousMetadata.runtimeMetadata || previousMetadata.manifest?.runtime || { mode: item.runtimeMode || "manual / form", connector: item.runtimeConnector || "form" },
        permissions: item.permissions || previousMetadata.permissions || [],
        settingsSchema: item.settingsSchema || {},
        formSchema: {
          ...(previousMetadata.formSchema || {}),
          fields: item.fields || [],
          layout: item.formLayout || [],
        },
        formLayout: item.formLayout || [],
        portUi: {
          ...(previousMetadata.portUi || {}),
          in: { ...(previousMetadata.portUi?.in || {}), hidden: (builder.inputs || []).filter((port) => port.visible === false).map((port) => port.name) },
          out: { ...(previousMetadata.portUi?.out || {}), hidden: (builder.outputs || []).filter((port) => port.visible === false).map((port) => port.name) },
        },
        customNode: true,
      },
    };
    const nextNode = customRuntimeNodeUpdate({
      node: baseNode,
      label: item.label || current.label,
      runtimeStatus: current.metadata?.runtimeStatus || current.runtime?.status || current.status || "idle",
      config: { ...nodeBuilderDefaultConfigFromLayout(item.formLayout || []), ...nodeConfigObject(current), ...(item.runtimeConfig || {}) },
    });
    try {
      await window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode?.({ node: nextNode });
      if (window.TrackerLensChannelRegistry?.upsertChannelsForRuntimeNode) {
        await window.TrackerLensChannelRegistry.upsertChannelsForRuntimeNode({ node: nextNode });
      }
      await recordFlowAction({
        workspaceId: nextNode.workspaceId || "global",
        nodeId: nextNode.id,
        message: `Custom node layout updated: ${nextNode.label || nextNode.id}`,
        context: {
          action: "custom-runtime-node-builder-updated",
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
      state.inspectorOpen = true;
      close?.();
      await loadRuntime({ force: true });
    } catch (error) {
      state.error = error?.message || "Errore aggiornamento custom node";
      setErrorSignal(state.error);
      mount();
    }
  };

  const dialog = _.Dialog({
    class: "tl-flow-node-builder-dialog",
    panelClass: "tl-flow-node-builder-panel",
    size: "xl",
    closeOnOutside: false,
    closeOnBackdrop: false,
    title: editMode ? "Edit Custom Node" : "Create Node",
    subtitle: editMode ? "Continue customizing this node form, ports and runtime contract." : "Search a node template, load it, then customize form, ports and runtime contract.",
    icon: editMode ? "edit_note" : "add_box",
    closeButton: true,
    content: () => _.div(
      {
        class: "tl-flow-node-builder",
        onpointerdown: beginBuilderComponentPointerDrag,
        onclick: (event) => {
          const root = rootFor(event);
          const fieldEdit = event.target.closest?.("[data-node-builder-edit-field]");
          const fieldDelete = event.target.closest?.("[data-node-builder-delete-field]");
          const portEdit = event.target.closest?.("[data-node-builder-edit-port]");
          const portToggle = event.target.closest?.("[data-node-builder-toggle-port]");
          const portDelete = event.target.closest?.("[data-node-builder-delete-port]");
          const portAdd = event.target.closest?.("[data-node-builder-add-port]");
          const sideToggle = event.target.closest?.("[data-node-builder-toggle-side-card]");
          const childAdd = event.target.closest?.("[data-node-builder-add-child]");
          const componentAdd = event.target.closest?.("[data-node-builder-add-component]");
          if (fieldEdit) {
            event.preventDefault();
            editBuilderField(fieldEdit.dataset.nodeBuilderEditField, root);
          } else if (portEdit) {
            event.preventDefault();
            editBuilderPort(portEdit.dataset.nodeBuilderEditPort, root);
          } else if (fieldDelete) {
            event.preventDefault();
            deleteBuilderField(fieldDelete.dataset.nodeBuilderDeleteField, root);
          } else if (portToggle) {
            event.preventDefault();
            toggleBuilderPort(portToggle.dataset.nodeBuilderTogglePort, root);
          } else if (portDelete) {
            event.preventDefault();
            deleteBuilderPort(portDelete.dataset.nodeBuilderDeletePort, root);
          } else if (portAdd) {
            event.preventDefault();
            addBuilderPort(portAdd.dataset.nodeBuilderAddPort, root);
          } else if (sideToggle) {
            event.preventDefault();
            toggleSideCard(sideToggle);
          } else if (childAdd) {
            event.preventDefault();
            const [parentId, type] = String(childAdd.dataset.nodeBuilderAddChild || "").split(":");
            addBuilderComponent(type, root, parentId);
          } else if (componentAdd) {
            event.preventDefault();
            if (suppressBuilderComponentClick) {
              suppressBuilderComponentClick = false;
              return;
            }
            addBuilderComponent(componentAdd.dataset.nodeBuilderAddComponent, root);
          }
        },
      },
      _.aside(
        { class: "tl-flow-node-builder-templates" },
        _.section(
          { class: "tl-flow-node-builder-side-card", "data-node-builder-side-card": "components" },
          _.button(
            { type: "button", class: "tl-flow-node-builder-side-head", "data-node-builder-toggle-side-card": "components", "aria-expanded": "true" },
            _.span(icon("view_quilt", "sm"), _.strong("Components")),
            icon("expand_less", "sm")
          ),
          _.div(
            { class: "tl-flow-node-builder-side-body", "data-node-builder-side-body": "components" },
            _.div({ class: "tl-flow-node-builder-component-list" }, ...renderNodeBuilderCmswiftComponents())
          )
        ),
        _.section(
          { class: "tl-flow-node-builder-side-card", "data-node-builder-side-card": "templates", hidden: editMode },
          _.button(
            { type: "button", class: "tl-flow-node-builder-side-head", "data-node-builder-toggle-side-card": "templates", "aria-expanded": "true" },
            _.span(icon("category", "sm"), _.strong("Templates")),
            icon("expand_less", "sm")
          ),
          _.div(
            { class: "tl-flow-node-builder-side-body", "data-node-builder-side-body": "templates" },
            _.div(
              { class: "tl-flow-node-builder-search" },
              icon("search", "sm"),
              _.input({
                type: "search",
                placeholder: "Search templates",
                "aria-label": "Search node templates",
                oninput: (event) => filterTemplates(event.currentTarget.closest(".tl-flow-node-builder"), event.currentTarget.value),
              })
            ),
            _.div(
              { class: "tl-flow-node-builder-template-scroll" },
              ...groups.map(([group, items]) => _.section(
                { "data-node-builder-template-group": group },
                _.h3(group),
                ...items.map((item) => {
                  const id = nodeBuilderTemplateId(group, item);
                  return _.button(
                    {
                      type: "button",
                      class: `tl-flow-node-builder-template is-${item.tone || "cyan"}${id === selectedId ? " is-selected" : ""}`,
                      "data-node-builder-template": id,
                      "data-node-builder-search": nodeBuilderTemplateSearchText(group, item),
                      onclick: (event) => syncSelection(event.currentTarget.closest(".tl-flow-node-builder"), id),
                    },
                    _.span({ class: "tl-flow-node-builder-template-icon" }, icon(item.icon || "extension", "sm")),
                    _.span(
                      { class: "tl-flow-node-builder-template-main" },
                      _.strong(item.label || "Node Template"),
                      _.em(`${item.nodeType || "node"} · ${item.subtype || "custom"}`)
                    )
                  );
                })
              )),
              _.div(
                { class: "tl-flow-palette-empty", "data-node-builder-empty": "true", hidden: true },
                icon("search_off", "sm"),
                _.strong("No templates found"),
                _.span("Try another name, type or permission.")
              )
            )
          )
        )
      ),
      _.main(
        { class: "tl-flow-node-builder-main" },
        _.section(
          { class: "tl-flow-node-builder-card" },
          _.div(
            { class: "tl-flow-node-builder-card-head" },
            _.span(icon("tune", "sm"), _.strong("General")),
            _.em({ "data-node-builder-active-meta": "true" }, `${selected.group} · ${selected.item.nodeType || "node"} · ${selected.item.subtype || "custom"}`)
          ),
          _.div(
            { class: "tl-flow-node-builder-general" },
            _.Input({
              class: "tl-flow-node-builder-general-control",
              size: "sm",
              label: "Name",
              value: builder.label || "Custom Node",
              autocomplete: "off",
              "data-node-builder-field": "label",
              onInput: (event) => {
                readBuilderGeneral(rootFor(event));
                refreshNodeBuilder(rootFor(event));
              },
            }),
            _.Select({
              class: "tl-flow-node-builder-general-control",
              size: "sm",
              label: "Category",
              value: builder.category || "custom",
              options: FLOW_NODE_CATEGORY_OPTIONS,
              "data-node-builder-field": "category",
              slots: { arrow: () => icon("keyboard_arrow_down", "sm") },
              onChange: (value) => {
                builder.category = value?.target?.value || value || "custom";
                refreshNodeBuilder(rootFor(document.querySelector(".tl-flow-node-builder")));
              },
            }),
            _.Input({
              class: "tl-flow-node-builder-general-control",
              size: "sm",
              label: "Subtype",
              value: builder.subtype || "custom",
              autocomplete: "off",
              "data-node-builder-field": "subtype",
              onInput: (event) => {
                readBuilderGeneral(rootFor(event));
                refreshNodeBuilder(rootFor(event));
              },
            }),
            _.Select({
              class: "tl-flow-node-builder-general-control",
              size: "sm",
              label: "Icon",
              value: builder.icon || "extension",
              options: FLOW_NODE_ICON_OPTIONS,
              filterable: true,
              filterPlaceholder: "Search icon",
              "data-node-builder-field": "icon",
              icon: builder.icon || "extension",
              slots: { arrow: () => icon("keyboard_arrow_down", "sm") },
              onChange: (value) => {
                builder.icon = value?.target?.value || value || "extension";
                refreshNodeBuilder(rootFor(document.querySelector(".tl-flow-node-builder")));
              },
            }),
            _.Select({
              class: "tl-flow-node-builder-general-control",
              size: "sm",
              label: "Tone",
              value: builder.tone || "gold",
              options: FLOW_NODE_TONE_OPTIONS,
              "data-node-builder-field": "tone",
              slots: { arrow: () => icon("keyboard_arrow_down", "sm") },
              onChange: (value) => {
                builder.tone = value?.target?.value || value || "gold";
                refreshNodeBuilder(rootFor(document.querySelector(".tl-flow-node-builder")));
              },
            })
          )
        ),
        _.section(
          { class: "tl-flow-node-builder-card" },
          _.div(
            { class: "tl-flow-node-builder-card-head" },
            _.span(icon("dynamic_form", "sm"), _.strong("Form Fields")),
            _.span(
              { class: "tl-flow-node-builder-head-actions" },
              btn({ title: "Add Card", onclick: (event) => { event.preventDefault(); addBuilderCard(rootFor(event)); } }, icon("view_agenda", "sm"), "Add Card"),
              btn({ title: "Add Field", onclick: (event) => { event.preventDefault(); addBuilderField(rootFor(event)); } }, icon("add", "sm"), "Add Field")
            )
          ),
          _.div({ class: "tl-flow-node-builder-rows", "data-node-builder-fields": "true", "data-node-builder-drop-root": "true" }, ...renderNodeBuilderFormLayout(builder.formLayout || []))
        ),
        _.section(
          { class: "tl-flow-node-builder-card" },
          _.div(
            { class: "tl-flow-node-builder-card-head" },
            _.span(icon("hub", "sm"), _.strong("Ports")),
            _.em("Manifest IN / OUT")
          ),
          _.div(
            { class: "tl-flow-node-builder-ports" },
            _.div(
              _.h4("Inputs", btn({ title: "Add input", "aria-label": "Add input", "data-node-builder-add-port": "in" }, icon("add", "sm"))),
              _.div({ "data-node-builder-inputs": "true" }, ...renderNodeBuilderPortRows(builder.inputs, "in"))
            ),
            _.div(
              _.h4("Outputs", btn({ title: "Add output", "aria-label": "Add output", "data-node-builder-add-port": "out" }, icon("add", "sm"))),
              _.div({ "data-node-builder-outputs": "true" }, ...renderNodeBuilderPortRows(builder.outputs, "out"))
            )
          )
        ),
        _.section(
          { class: "tl-flow-node-builder-card" },
          _.div(
            { class: "tl-flow-node-builder-card-head" },
            _.span(icon("bolt", "sm"), _.strong("Runtime")),
            _.em("Call + test")
          ),
          _.div({ "data-node-builder-runtime-panel": "true" }, renderNodeBuilderRuntimePanel()),
          _.div(
            { class: "tl-flow-node-builder-runtime" },
            _.span("Execution"),
            _.strong({ "data-node-builder-runtime-execution": "true" }, nodeBuilderRuntimeModeLabel(builder)),
            _.span("Permissions"),
            _.strong({ "data-node-builder-runtime-permissions": "true" }, [...new Set([...(builder.permissions || []), ...nodeBuilderRuntimePermissions(nodeBuilderRuntimeKind(builder))])].join(", ") || "none")
          )
        )
      ),
      _.aside(
        { class: "tl-flow-node-builder-preview" },
        _.div(
          { class: "tl-flow-node-builder-preview-summary" },
          _.strong({ "data-node-builder-active-title": "true" }, builder.label || "Custom Node"),
          _.span({ "data-node-builder-active-summary": "true" }, builder.connectionType || "Template loaded for this workspace.")
        ),
        _.div({ "data-node-builder-preview": "true" }, renderNodeBuilderPreview(builder))
      )
    ),
    actions: ({ close }) => _.Toolbar(
      { class: "tl-flow-node-builder-actions", align: "end", gap: 8 },
      btn({ class: "tl-flow-node-builder-action is-cancel", onclick: close }, "Cancel"),
      btn({ class: "tl-flow-node-builder-action is-template", "data-node-builder-save-template": "true", onclick: (event) => saveBuilderTemplateAction(rootFor(event)) }, icon("save", "sm"), "Save Template"),
      editMode
        ? btn({ class: "tl-flow-node-builder-action is-create is-primary", onclick: (event) => saveExistingNodeFromBuilderAction(rootFor(event), close) }, icon("save", "sm"), "Save Node")
        : btn({ class: "tl-flow-node-builder-action is-create is-primary", onclick: (event) => createNodeFromBuilderAction(rootFor(event), close) }, icon("save", "sm"), "Create Node")
    ),
  });
  dialog.open();
};

window.TrackerLensOpenNodeBuilder = openNodeBuilderDialog;

const isDraftNode = (node = {}) =>
  Boolean(node.metadata?.draft || node.status === "draft" || String(node.id || "").startsWith("draft_"));

const isInlineConfigNode = (node = {}) =>
  ["source", "boxTracker", "processor", "knowledge", "aiAgent", "boxLens", "lens", "action", "storage", "devPreview", "custom"].includes(node.type);

const isCustomRuntimeNode = (node = {}) =>
  node.type === "custom" || node.metadata?.customNode === true || Boolean(node.metadata?.formSchema || node.metadata?.formLayout);

const customNodeFormLayout = (node = {}) =>
  normalizeNodeBuilderLayout(
    node.metadata?.formSchema?.layout ||
    node.metadata?.formLayout ||
    node.metadata?.manifest?.formLayout ||
    []
  );

const customNodeDataFields = (node = {}) =>
  collectNodeBuilderDataFields(customNodeFormLayout(node));

const nodeBuilderTemplateFromCustomNode = (node = {}) => {
  const metadata = node.metadata || {};
  const hiddenIn = new Set(metadata.portUi?.in?.hidden || []);
  const hiddenOut = new Set(metadata.portUi?.out?.hidden || []);
  return {
    label: node.label || metadata.paletteLabel || "Custom Node",
    icon: metadata.icon || graphIcon(node) || "extension",
    tone: metadata.tone || graphTone(node) || "gold",
    nodeType: node.type || metadata.runtimeType || "custom",
    subtype: nodeSubtype(node) || "custom",
    category: nodeCategory(node) || "custom",
    inputs: normalizeNodeBuilderPorts(node.inputs || metadata.manifest?.inputs || ["input"], "in")
      .map((port) => ({ ...port, visible: !hiddenIn.has(port.name) })),
    outputs: normalizeNodeBuilderPorts(node.outputs || metadata.manifest?.outputs || ["output"], "out")
      .map((port) => ({ ...port, visible: !hiddenOut.has(port.name) })),
    permissions: metadata.permissions || metadata.manifest?.permissions || node.permissions || [],
    runtimeMode: metadata.runtimeMetadata?.mode || metadata.manifest?.runtime?.mode || "manual / on event",
    runtimeConnector: metadata.runtimeConfig?.runtimeConnector || metadata.execute?.kind || metadata.manifest?.execute?.kind || metadata.runtimeMetadata?.connector || "form",
    runtimeConfig: {
      ...(metadata.runtimeConfig || {}),
      ...(nodeConfigObject(node) || {}),
    },
    execute: metadata.execute || metadata.manifest?.execute || null,
    connectionType: metadata.paletteAction === "node-builder" ? "Custom node builder" : metadata.paletteAction || "",
    formLayout: customNodeFormLayout(node),
    formSchema: metadata.formSchema || {},
    settingsSchema: metadata.settingsSchema || metadata.manifest?.settingsSchema || {},
    manifest: metadata.manifest || null,
  };
};
