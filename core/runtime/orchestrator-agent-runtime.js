window.TrackerLensOrchestratorAgentRuntime = (() => {
  const instances = new Map();

  const clonePayload = (payload) => {
    try {
      if (typeof structuredClone === "function") return structuredClone(payload);
    } catch {
      // JSON fallback below.
    }
    try {
      return JSON.parse(JSON.stringify(payload));
    } catch {
      return payload;
    }
  };

  const unique = (values = []) =>
    [...new Set(values.filter(Boolean).map(String))];

  const nodeSubtype = (node = {}) =>
    String(node.metadata?.subtype || node.metadata?.manifest?.subtype || node.metadata?.agentRole || node.type || "").toLowerCase();

  const nodeCategory = (node = {}) =>
    String(node.metadata?.category || node.metadata?.manifest?.category || node.type || "").toLowerCase();

  const nodeConfig = (node = {}) =>
    node.metadata?.config && typeof node.metadata.config === "object" && !Array.isArray(node.metadata.config)
      ? node.metadata.config
      : {};

  const nodeStatus = (node = {}) =>
    String(node.runtime?.status || node.metadata?.runtimeStatus || node.status || "idle").toLowerCase();

  const executionMode = (node = {}) =>
    String(nodeConfig(node).executionMode || node.metadata?.runtimeMetadata?.executionMode || "on_event").toLowerCase();

  const isEventDriven = (mode = "") =>
    ["on_event", "continuous", "autonomous"].includes(String(mode || "").toLowerCase());

  const isRunnableOrchestrator = (node = {}) =>
    node.type === "aiAgent" &&
    nodeSubtype(node) === "orchestrator" &&
    !node.metadata?.library &&
    !node.metadata?.draft &&
    isEventDriven(executionMode(node)) &&
    !["paused", "disabled", "error", "disconnected"].includes(nodeStatus(node));

  const nodeInputs = (node = {}, dependencies = []) => {
    const incoming = dependencies
      .filter((dependency) => dependency.targetNodeId === node.id)
      .filter((dependency) => String(dependency.metadata?.linkType || dependency.mapping?.linkType || "data") !== "tool-access")
      .map((dependency) => dependency.channel || dependency.metadata?.targetPort)
      .filter(Boolean);
    return unique([...(node.inputs || []), ...(node.channels || []), ...incoming]);
  };

  const compactJson = (value, max = 1800) => {
    let text = "";
    try {
      text = JSON.stringify(value ?? {}, null, 2);
    } catch {
      text = String(value ?? "");
    }
    return text.length > max ? `${text.slice(0, max)}\n...` : text;
  };

  const parseJsonLoose = (text = "") => {
    const clean = String(text || "").trim();
    if (!clean) return null;
    const candidates = [
      clean,
      clean.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim(),
      clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1),
    ].filter(Boolean);
    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate);
      } catch {
        // Try next candidate.
      }
    }
    return null;
  };

  const parseObjectLoose = (value = null) => {
    if (!value) return {};
    if (typeof value === "object" && !Array.isArray(value)) return value;
    const parsed = parseJsonLoose(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  };

  const urlWithQueryParams = (endpoint = "", params = {}) => {
    const clean = String(endpoint || "").trim();
    const entries = Object.entries(params || {}).filter(([, value]) => value !== undefined && value !== null && value !== "");
    if (!clean || !entries.length) return clean;
    try {
      const url = new URL(clean, window.location?.origin || "http://localhost");
      entries.forEach(([key, value]) => {
        if (Array.isArray(value)) {
          value.forEach((item) => url.searchParams.append(key, String(item)));
        } else {
          url.searchParams.set(key, String(value));
        }
      });
      return url.toString();
    } catch {
      const query = entries
        .flatMap(([key, value]) => Array.isArray(value)
          ? value.map((item) => [key, item])
          : [[key, value]])
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
        .join("&");
      return `${clean}${clean.includes("?") ? "&" : "?"}${query}`;
    }
  };

  const getPath = (source, path = "") =>
    String(path || "")
      .replace(/\[(\d+)\]/g, ".$1")
      .split(".")
      .filter(Boolean)
      .reduce((value, key) => value?.[key], source);

  const renderTemplate = (template = "", context = {}) =>
    String(template || "").replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, token) => {
      const key = String(token || "").trim();
      const value = key === "payload"
        ? context.payload
        : key.startsWith("payload.")
          ? getPath(context.payload, key.replace(/^payload\./, ""))
          : getPath(context.payload, key);
      if (value === undefined || value === null) return "";
      return typeof value === "object" ? JSON.stringify(value) : String(value);
    });

  const configValueWithTemplate = (value = "", context = {}) =>
    typeof value === "string" ? renderTemplate(value, context) : value;

  const listFromConfig = (value = "", fallback = []) => {
    const source = Array.isArray(value) ? value : String(value || "").split(/[\n,]+/);
    const items = source.map((item) => String(item || "").trim()).filter(Boolean);
    return items.length ? items : fallback;
  };

  const typedPorts = (ports = []) =>
    (Array.isArray(ports) ? ports : [])
      .map((port) => typeof port === "object" ? port.name || port.id || port.key : port)
      .filter(Boolean)
      .map(String);

  const nodeOutputs = (node = {}) =>
    unique([
      ...(node.outputs || []),
      ...(node.channels || []),
      ...(node.metadata?.manifest?.outputs || []).map((port) => typeof port === "object" ? port.name || port.key : port),
    ]);

  const nodeInputPorts = (node = {}) =>
    unique([
      ...(node.inputs || []),
      ...(node.channels || []),
      ...(node.metadata?.manifest?.inputs || []).map((port) => typeof port === "object" ? port.name || port.key : port),
    ]);

  const splitList = (value = "") =>
    Array.isArray(value)
      ? value.map((item) => String(item || "").trim()).filter(Boolean)
      : String(value || "").split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);

  const parseToolDeclarationValue = (value = null) => {
    if (!value) return null;
    if (typeof value === "object") return value;
    return parseJsonLoose(value);
  };

  const toolInputSchema = (properties = {}, required = []) => ({
    type: "object",
    properties,
    required,
  });

  const makeReadTool = ({ name = "", label = "", purpose = "", inputSchema = {}, outputs = {}, requiresEvidence = false } = {}) => ({
    name,
    label: label || name,
    mode: "read",
    purpose,
    inputSchema,
    outputs,
    cost: { tokens: "low", latency: "low" },
    requiresEvidence: Boolean(requiresEvidence),
  });

  const defaultAgentToolsForNode = (node = {}) => {
    const subtype = nodeSubtype(node);
    const category = nodeCategory(node);
    if (["document-store", "text-knowledge", "workspace-memory", "conversation-memory"].includes(subtype)) {
      return [
        makeReadTool({
          name: "getDocumentInfo",
          label: "Get Document Info",
          purpose: "Return document ids, title, language, collection and chunk availability for this node scope.",
          inputSchema: toolInputSchema({ documentId: { type: "string" } }),
          outputs: { documents: "array", scope: "object" },
        }),
        makeReadTool({
          name: "getFullDocument",
          label: "Get Full Document",
          purpose: "Return full source text when allowed by size and node scope.",
          inputSchema: toolInputSchema({ documentId: { type: "string" }, maxChars: { type: "number" } }),
          outputs: { text: "string", evidence: "array" },
          requiresEvidence: true,
        }),
        makeReadTool({
          name: "searchChunks",
          label: "Search Chunks",
          purpose: "Find source text passages related to a query.",
          inputSchema: toolInputSchema({ query: { type: "string" }, limit: { type: "number" } }, ["query"]),
          outputs: { items: "array", evidence: "array" },
          requiresEvidence: true,
        }),
        makeReadTool({
          name: "getChunkWindow",
          label: "Get Chunk Window",
          purpose: "Return source chunks around a chunk id or ordinal.",
          inputSchema: toolInputSchema({ chunkId: { type: "string" }, ordinal: { type: "number" }, radius: { type: "number" } }),
          outputs: { chunks: "array", evidence: "array" },
          requiresEvidence: true,
        }),
      ];
    }
    if (["knowledge-dictionary-builder", "dictionary-builder"].includes(subtype)) {
      return [
        makeReadTool({
          name: "defineTerm",
          label: "Define Term",
          purpose: "Explain a term, aliases and type candidates in document context.",
          inputSchema: toolInputSchema({ term: { type: "string" }, documentId: { type: "string" } }, ["term"]),
          outputs: { entries: "array", evidence: "array" },
          requiresEvidence: true,
        }),
        makeReadTool({
          name: "resolveAmbiguity",
          label: "Resolve Ambiguity",
          purpose: "Return possible meanings for an ambiguous word or name.",
          inputSchema: toolInputSchema({ term: { type: "string" }, query: { type: "string" } }, ["term"]),
          outputs: { candidates: "array", evidence: "array" },
          requiresEvidence: true,
        }),
        makeReadTool({
          name: "listKeyTerms",
          label: "List Key Terms",
          purpose: "Return high-value dictionary terms usable for planning and retrieval.",
          inputSchema: toolInputSchema({ limit: { type: "number" }, tier: { type: "string" } }),
          outputs: { terms: "array", scope: "object" },
        }),
      ];
    }
    if (["knowledge-event-builder", "event-builder"].includes(subtype)) {
      return [
        makeReadTool({
          name: "getTimeline",
          label: "Get Timeline",
          purpose: "Return ordered events related to a query, participant or document.",
          inputSchema: toolInputSchema({ query: { type: "string" }, participant: { type: "string" }, limit: { type: "number" } }),
          outputs: { events: "array", evidence: "array" },
          requiresEvidence: true,
        }),
        makeReadTool({
          name: "findEvents",
          label: "Find Events",
          purpose: "Search persisted events by participant, event type or text.",
          inputSchema: toolInputSchema({ query: { type: "string" }, eventType: { type: "string" }, participant: { type: "string" } }),
          outputs: { events: "array", evidence: "array" },
          requiresEvidence: true,
        }),
        makeReadTool({
          name: "verifyEvent",
          label: "Verify Event",
          purpose: "Check whether a proposed event is supported by persisted evidence.",
          inputSchema: toolInputSchema({ claim: { type: "string" }, eventType: { type: "string" } }, ["claim"]),
          outputs: { supported: "boolean", evidence: "array", limitations: "array" },
          requiresEvidence: true,
        }),
      ];
    }
    if (["structured-knowledge-store", "world-database"].includes(subtype)) {
      return [
        makeReadTool({
          name: "listRecords",
          label: "List Records",
          purpose: "Return structured records by schema, type, collection, world or query.",
          inputSchema: toolInputSchema({ query: { type: "string" }, recordType: { type: "string" }, collectionId: { type: "string" }, worldId: { type: "string" } }),
          outputs: { records: "array", typeCounts: "object" },
        }),
        makeReadTool({
          name: "getWorldSummary",
          label: "Get World Summary",
          purpose: "Return worldbuilding record counts, validation warnings and main world records.",
          inputSchema: toolInputSchema({ worldId: { type: "string" }, collectionId: { type: "string" } }),
          outputs: { world: "object", records: "array", validation: "array" },
        }),
        makeReadTool({
          name: "exportWorldGraph",
          label: "Export World Graph",
          purpose: "Return graph-shaped entities and relations derived from structured worldbuilding records.",
          inputSchema: toolInputSchema({ worldId: { type: "string" }, collectionId: { type: "string" } }),
          outputs: { entities: "array", relations: "array" },
        }),
      ];
    }
    if (["graph-query", "knowledge-graph", "knowledge-reasoning-composer", "semantic-relation-enricher", "knowledge-graph-builder-agent", "entity-extractor"].includes(subtype)) {
      return [
        makeReadTool({
          name: "findEntities",
          label: "Find Entities",
          purpose: "Search graph entities by query, aliases and type.",
          inputSchema: toolInputSchema({ query: { type: "string" }, entityType: { type: "string" }, limit: { type: "number" } }, ["query"]),
          outputs: { entities: "array", evidence: "array" },
        }),
        makeReadTool({
          name: "findRelations",
          label: "Find Relations",
          purpose: "Find graph relations for query/entity pairs.",
          inputSchema: toolInputSchema({ query: { type: "string" }, source: { type: "string" }, target: { type: "string" }, relationType: { type: "string" } }),
          outputs: { relations: "array", evidence: "array" },
          requiresEvidence: true,
        }),
        makeReadTool({
          name: "getGraphEvidence",
          label: "Get Graph Evidence",
          purpose: "Return source evidence behind graph facts.",
          inputSchema: toolInputSchema({ query: { type: "string" }, relationId: { type: "string" }, entityId: { type: "string" } }),
          outputs: { evidence: "array", limitations: "array" },
          requiresEvidence: true,
        }),
      ];
    }
    if (subtype === "rag-search" || subtype === "embedding-generator" || subtype === "vector-memory") {
      return [
        makeReadTool({
          name: "searchChunks",
          label: "Search Chunks",
          purpose: "Retrieve semantically related chunks from the connected knowledge index.",
          inputSchema: toolInputSchema({ query: { type: "string" }, limit: { type: "number" } }, ["query"]),
          outputs: { items: "array", evidence: "array" },
          requiresEvidence: true,
        }),
      ];
    }
    if (category === "dev" || node.type === "devPreview") {
      return [
        makeReadTool({
          name: "showObservation",
          label: "Show Observation",
          purpose: "Display tool observations and evidence for QA.",
          inputSchema: toolInputSchema({ runId: { type: "string" }, observation: { type: "object" } }),
          outputs: { displayed: "boolean" },
        }),
        makeReadTool({
          name: "showAnswerTrace",
          label: "Show Answer Trace",
          purpose: "Display Agent plan, tool calls, verification result and final answer.",
          inputSchema: toolInputSchema({ runId: { type: "string" }, trace: { type: "object" } }),
          outputs: { displayed: "boolean" },
        }),
      ];
    }
    return [];
  };

  const normalizeAgentTool = (tool = {}, node = {}) => {
    const name = String(tool.name || tool.id || "").trim();
    if (!name) return null;
    const mode = String(tool.mode || "read").toLowerCase().trim();
    const safeMode = ["read", "plan", "verify", "mutate"].includes(mode) ? mode : "read";
    return {
      name,
      label: String(tool.label || name).trim(),
      mode: safeMode,
      purpose: String(tool.purpose || tool.description || "").trim(),
      inputSchema: tool.inputSchema || tool.inputs || {},
      outputs: tool.outputs || tool.outputSchema || {},
      cost: tool.cost || { tokens: "low", latency: "low" },
      requiresEvidence: Boolean(tool.requiresEvidence),
      mcpName: `tl.node.${node.id || "node"}.${name}`,
    };
  };

  const nodeAgentTools = (node = {}) => {
    const config = nodeConfig(node);
    const declared = parseToolDeclarationValue(config.agentTools || node.metadata?.agentTools || node.metadata?.manifest?.agentTools);
    const declaredTools = Array.isArray(declared?.tools)
      ? declared.tools
      : Array.isArray(declared)
        ? declared
        : [];
    const source = declaredTools.length ? declaredTools : defaultAgentToolsForNode(node);
    return source
      .map((tool) => normalizeAgentTool(tool, node))
      .filter(Boolean)
      .slice(0, 24);
  };

  const nodeCapability = (node = {}) => {
    const config = nodeConfig(node);
    const agentTools = nodeAgentTools(node);
    return {
      visible: String(config.agentVisible ?? config.agent_visible ?? "true") !== "false",
      purpose: String(config.agentPurpose || config.purpose || node.description || node.metadata?.description || "").trim(),
      keywords: splitList(config.agentKeywords || config.keywords),
      produces: splitList(config.agentProduces || config.produces),
      consumes: splitList(config.agentConsumes || config.consumes),
      outputSchema: String(config.agentOutputSchema || config.outputSchema || "").trim(),
      sampleOutput: String(config.agentSampleOutput || config.sampleOutput || config.testPayload || "").trim(),
      agentTools,
      toolCount: agentTools.length,
    };
  };

  const capabilitySearchText = (node = {}) => {
    const capability = nodeCapability(node);
    const config = nodeConfig(node);
    return [
      node.label,
      nodeSubtype(node),
      nodeCategory(node),
      nodeEndpoint(node),
      config.endpoint,
      config.url,
      config.wsUrl,
      capability.purpose,
      capability.keywords.join(" "),
      capability.produces.join(" "),
      capability.consumes.join(" "),
      capability.outputSchema,
      capability.sampleOutput,
    ].filter(Boolean).join(" ").toLowerCase();
  };

  const outgoingDependencies = ({ node, runtime }) =>
    (runtime.dependencies || [])
      .filter((dependency) => dependency.sourceNodeId === node.id && !dependency.metadata?.virtual)
      .filter((dependency) => String(dependency.metadata?.linkType || dependency.mapping?.linkType || "data") !== "tool-access")
      .map((dependency) => ({
        ...dependency,
        targetNode: (runtime.nodes || []).find((item) => item.id === dependency.targetNodeId) || null,
      }))
      .filter((dependency) => dependency.targetNode);

  const isAgentControlDependency = (dependency = {}) => {
    const value = String(dependency.channel || dependency.metadata?.sourcePort || dependency.metadata?.targetPort || "").toLowerCase();
    return value === "agent_control" || value === "agent-control";
  };

  const connectedDependencies = ({ node, runtime }) =>
    (runtime.dependencies || [])
      .filter((dependency) =>
        dependency.sourceNodeId === node.id ||
        (dependency.sourceNodeId === node.id && isAgentControlDependency(dependency)) ||
        (dependency.targetNodeId === node.id && isAgentControlDependency(dependency)))
      .map((dependency) => ({
        ...dependency,
        targetNode: (runtime.nodes || []).find((item) => item.id === dependency.targetNodeId) || null,
        sourceNode: (runtime.nodes || []).find((item) => item.id === dependency.sourceNodeId) || null,
      }));

  const graphNeighborhood = ({ node, runtime }) => {
    const nodesById = new Map((runtime.nodes || []).map((item) => [item.id, item]));
    const relatedIds = new Set([node.id]);
    (runtime.dependencies || []).forEach((dependency) => {
      if (dependency.sourceNodeId === node.id || dependency.targetNodeId === node.id) {
        relatedIds.add(dependency.sourceNodeId);
        relatedIds.add(dependency.targetNodeId);
      }
    });
    const related = (runtime.nodes || [])
      .filter((item) => relatedIds.has(item.id))
      .map((item) => ({
        nodeId: item.id,
        label: item.label || item.id,
        type: item.type || "",
        category: nodeCategory(item),
        subtype: nodeSubtype(item),
        status: nodeStatus(item),
        inputs: nodeInputPorts(item),
        outputs: nodeOutputs(item),
        capability: nodeCapability(item),
        config: {
          endpoint: nodeConfig(item).endpoint || nodeConfig(item).url || nodeConfig(item).wsUrl || "",
          method: nodeConfig(item).method || "",
          emitChannel: nodeConfig(item).emitChannel || "",
        },
      }));
    const links = (runtime.dependencies || [])
      .filter((dependency) => relatedIds.has(dependency.sourceNodeId) && relatedIds.has(dependency.targetNodeId))
      .map((dependency) => ({
        id: dependency.id || "",
        sourceNodeId: dependency.sourceNodeId,
        sourceLabel: nodesById.get(dependency.sourceNodeId)?.label || dependency.sourceNodeId,
        targetNodeId: dependency.targetNodeId,
        targetLabel: nodesById.get(dependency.targetNodeId)?.label || dependency.targetNodeId,
        channel: dependency.channel || "",
        sourcePort: dependency.metadata?.sourcePort || dependency.sourcePort || "",
        targetPort: dependency.metadata?.targetPort || dependency.targetPort || "",
      }));
    return { nodes: related, links };
  };

  const targetIsConfigured = (target = {}) => {
    const category = nodeCategory(target);
    const config = nodeConfig(target);
    if (category === "actions") {
      const subtype = nodeSubtype(target);
      if (subtype === "notification" || subtype === "runtime-trigger" || subtype === "popup-alert" || subtype === "sound-alert") return true;
      if (subtype === "telegram") return Boolean(config.target || (config.botToken && config.chatId));
      return Boolean(config.target);
    }
    if (category === "storage") return true;
    if (category === "knowledge" || target.type === "knowledge") return true;
    if (target.type === "aiAgent") return true;
    if (target.type === "processor" || category === "processors") return true;
    if (target.type === "devPreview" || category === "dev") return true;
    if (category === "lens" || target.type === "lens" || target.type === "boxLens") return true;
    return true;
  };

  const defaultAllowedCategories = ["sources", "trackers", "processors", "knowledge", "ai-agents", "actions", "storage", "lens", "dev"];

  const pickProvider = async (config = {}) => {
    const data = await window.TrackerLensAiRuntimeStore?.list?.().catch(() => null);
    const providers = data?.providers || window.TrackerLensAiRuntimeStore?.localProviderDefaults?.() || [];
    const requested = String(config.providerType || config.provider || config.providerProfile || "").toLowerCase();
    return providers.find((provider) =>
      requested &&
      [provider.id, provider.name, provider.provider].some((value) => String(value || "").toLowerCase().includes(requested)))
      || providers.find((provider) => provider.local && provider.status === "online")
      || providers.find((provider) => provider.local)
      || providers[0]
      || null;
  };

  const withLmStudioApiBase = (endpoint = "") => {
    const clean = String(endpoint || "http://127.0.0.1:1234").replace(/\/+$/g, "");
    return clean.endsWith("/v1") ? clean : `${clean}/v1`;
  };

  const resolveLmStudioModel = async ({ provider = {}, model = "" } = {}) => {
    const requested = String(model || provider.model || "").trim();
    if (requested && requested !== "local-model") return requested;
    const endpoint = withLmStudioApiBase(provider.endpoint);
    try {
      const response = await fetch(`${endpoint}/models`);
      if (!response.ok) return requested || "local-model";
      const data = await response.json();
      const models = Array.isArray(data?.data) ? data.data : [];
      const chatModel = models.find((item) => !/embed/i.test(String(item.id || ""))) || models[0];
      return chatModel?.id || requested || "local-model";
    } catch {
      return requested || "local-model";
    }
  };

  const estimateAiTokens = (value = "") =>
    Math.max(0, Math.ceil(String(value || "").length / 4));

  const usageFromAiResponse = ({ data = {}, prompt = "", text = "" } = {}) => {
    const promptTokens = Number(data.usage?.prompt_tokens || data.prompt_eval_count || 0) || estimateAiTokens(prompt);
    const completionTokens = Number(data.usage?.completion_tokens || data.eval_count || 0) || estimateAiTokens(text);
    const totalTokens = Number(data.usage?.total_tokens || 0) || promptTokens + completionTokens;
    return { promptTokens, completionTokens, totalTokens };
  };

  const callLmStudio = async ({ provider = {}, model = "", prompt = "", config = {} } = {}) => {
    const endpoint = withLmStudioApiBase(provider.endpoint);
    const resolvedModel = await resolveLmStudioModel({ provider, model });
    const response = await fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: resolvedModel,
        messages: [{ role: "user", content: prompt }],
        temperature: Number(config.temperature || 0.2),
        max_tokens: Math.max(128, Number(config.maxTokens || 1200)),
      }),
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`LM Studio HTTP ${response.status}${errorText ? `: ${errorText}` : ""}`);
    }
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "";
    return { text, model: resolvedModel, usage: usageFromAiResponse({ data, prompt, text }), raw: data };
  };

  const callOllama = async ({ provider = {}, model = "", prompt = "" } = {}) => {
    const endpoint = String(provider.endpoint || "http://127.0.0.1:11434").replace(/\/+$/g, "");
    const response = await fetch(`${endpoint}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: model || provider.model || "local-model", prompt, stream: false }),
    });
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
    const data = await response.json();
    const text = data.response || "";
    return { text, model: model || provider.model || "local-model", usage: usageFromAiResponse({ data, prompt, text }), raw: data };
  };

  const askPlannerAi = async ({ node, runtime, payload, event, phase = "initial", observation = null } = {}) => {
    const config = nodeConfig(node);
    const provider = await pickProvider(config);
    if (!provider) throw new Error("Nessun provider AI disponibile per Orchestrator planner");
    const graph = graphNeighborhood({ node, runtime });
    const prompt = [
      "You are the Trackers Lens Orchestrator planner.",
      "Return ONLY valid JSON, no markdown.",
      "Available actions:",
      "- run_node: activate a source/runtime node and observe its result.",
      "- call_tool: call a read-only connected node tool and observe its evidence before deciding the next step.",
      "- send_result: send the last observed result to a target node. You may include transform as a JSON object mapping output keys to source paths.",
      "- finish: mark the task complete.",
      "Schema:",
      "{\"canExecute\":true,\"reason\":\"\",\"steps\":[{\"action\":\"call_tool\",\"nodeId\":\"...\",\"tool\":\"searchChunks\",\"args\":{\"query\":\"...\",\"limit\":6}},{\"action\":\"run_node\",\"nodeId\":\"...\",\"outputChannel\":\"raw\"},{\"action\":\"send_result\",\"nodeId\":\"...\",\"inputChannel\":\"done\",\"from\":\"lastResult\",\"transform\":{\"price\":\"number:data.c\"}},{\"action\":\"finish\"}]}",
      "Rules:",
      "- Choose source nodes by matching the task intent against node capability, purpose, keywords, produces, schema, label, and endpoint.",
      "- For document QA or knowledge questions, prefer call_tool on connected Document/Dictionary/Event/Graph tools before run_node. Use source-bearing evidence tools such as searchChunks/getFullDocument/getTimeline/getGraphEvidence to verify the answer.",
      "- call_tool can use only read tools declared in graph node capability.agentTools. Use nodeId plus tool name, or the MCP-style tool name.",
      "- If a tool result is empty or low-confidence, call a broader source tool before finishing.",
      "- If the task asks for multiple distinct items and multiple matching source nodes exist, run each matching source and send each transformed result to the requested targets.",
      "- Never choose the Task Node as run_node; the Task Node is only the instruction source.",
      "- Do not send the task itself to Preview unless no data source exists.",
      "- If the task asks for a clean JSON, include transform in send_result.",
      "- If the task asks for multiple targets, return one send_result step for each target.",
      "- If Telegram/Slack/Discord/Email actions are connected and requested, send the transformed lastResult to those action nodes too.",
      "- Prefer direct Orchestrator links and agent_control links.",
      "- Use send_result only after run_node produced an observation.",
      `Phase: ${phase}`,
      `Orchestrator: ${node.label || node.id}`,
      `Input event: ${event.channel || ""}`,
      `Task payload:\n${compactJson(payload, 1800)}`,
      `Graph nodes and links:\n${compactJson(graph, 4200)}`,
      observation ? `Observation:\n${compactJson(observation, 2200)}` : "",
    ].filter(Boolean).join("\n\n");
    const providerName = String(provider.provider || provider.name || "").toLowerCase();
    const model = String(config.model || provider.model || "local-model");
    const ai = providerName.includes("ollama")
      ? await callOllama({ provider, model, prompt })
      : await callLmStudio({ provider, model, prompt, config });
    const plan = parseJsonLoose(ai.text);
    if (!plan || !Array.isArray(plan.steps)) throw new Error("Planner AI non ha restituito JSON steps valido");
    return {
      provider: provider.name || provider.provider || "local",
      model: ai.model || model,
      usage: ai.usage || {},
      prompt,
      rawText: ai.text,
      ...plan,
    };
  };

  const isTargetAllowed = ({ target, config }) => {
    const category = nodeCategory(target);
    const allowed = unique([
      ...listFromConfig(config.allowedNodeTypes || config.allowedCategories, defaultAllowedCategories),
      "sources",
      "source",
      "trackers",
      "boxtracker",
    ])
      .map((item) => item.toLowerCase());
    const aliases = new Set([category, target.type, nodeSubtype(target)].map((item) => String(item || "").toLowerCase()));
    return allowed.some((item) => aliases.has(item) || item === "all");
  };

  const externalActionNeedsConfirmation = ({ target, config, payload }) => {
    if (nodeCategory(target) !== "actions") return false;
    if (String(config.requireConfirmation || "false") !== "true") return false;
    return !(payload?.confirmed === true || payload?.orchestratorConfirmed === true);
  };

  const nodeEndpoint = (node = {}) => {
    const config = nodeConfig(node);
    return String(config.endpoint || config.url || config.wsUrl || config.source || node.metadata?.endpoint || node.endpoint || "").trim();
  };

  const parseResponsePayload = (value) => {
    if (value === undefined || value === null) return {};
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return { text: value };
    }
  };

  const outputChannelsForNode = (node = {}, fallback = "raw") =>
    (unique([
      nodeConfig(node).emitChannel,
      nodeConfig(node).outputChannel,
      ...nodeOutputs(node),
    ].filter((channel) => channel && channel !== "all")).slice(0, 8)).length
      ? unique([
        nodeConfig(node).emitChannel,
        nodeConfig(node).outputChannel,
        ...nodeOutputs(node),
      ].filter((channel) => channel && channel !== "all")).slice(0, 8)
      : [fallback];

  const isWebSocketEndpoint = (endpoint = "") =>
    /^wss?:\/\//i.test(String(endpoint || "").trim());

  const executeSourceNode = ({ runtime, bus, workspaceId, runId, node, outputChannel = "", inputPayload = null } = {}) =>
    new Promise((resolve, reject) => {
      const endpoint = nodeEndpoint(node);
      const subtype = nodeSubtype(node);
      const config = nodeConfig(node);
      const channels = outputChannel
        ? [outputChannel]
        : outputChannelsForNode(node, subtype === "task" ? "task" : "raw");
      const started = performance.now();
      const emitResult = async (payload, status = "ok") => {
        const latencyMs = Math.max(1, Math.round(performance.now() - started));
        for (const channel of channels) {
          await bus?.emit?.(channel, payload, {
            workspaceId,
            eventType: "orchestrator_node_result",
            sourceNodeId: node.id,
            latencyMs,
            status,
            meta: {
              runId,
              orchestratorExecution: true,
              executedNodeId: node.id,
            },
          });
        }
        return { nodeId: node.id, label: node.label || node.id, channels, payload, latencyMs, status };
      };

      if (subtype === "task") {
        const payload = {
          type: "agent_task",
          objective: String(config.objective || config.goal || node.label || "Agent task").trim(),
          context: String(config.context || "").trim(),
          priority: String(config.priority || "normal").trim() || "normal",
          successCondition: String(config.successCondition || config.stopCondition || "completed").trim(),
          payload: parseJsonLoose(config.payloadJson || config.payload || config.testPayload) || {},
          runId,
          sourceNodeId: node.id,
          emittedAt: new Date().toISOString(),
        };
        emitResult(payload).then(resolve).catch(reject);
        return;
      }

      if (!endpoint && nodeCategory(node) === "sources") {
        reject(new Error(`${node.label || node.id}: endpoint mancante`));
        return;
      }

      if (isWebSocketEndpoint(endpoint) || subtype === "websocket") {
        let socket = null;
        let settled = false;
        const timeout = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          try {
            if (socket && socket.readyState <= WebSocket.OPEN) socket.close();
          } catch {
            // Ignore transient socket close failures.
          }
          reject(new Error(`WebSocket timeout dopo 15s: ${endpoint}`));
        }, 15000);
        const finish = (callback, value) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          try {
            if (socket && socket.readyState <= WebSocket.OPEN) socket.close();
          } catch {
            // Ignore transient socket close failures.
          }
          callback(value);
        };
        try {
          socket = new WebSocket(endpoint);
        } catch (error) {
          finish(reject, error);
          return;
        }
        socket.onmessage = async (message) => {
          try {
            const payload = {
              live: true,
              runId,
              endpoint,
              data: parseResponsePayload(message.data),
              receivedAt: new Date().toISOString(),
            };
            finish(resolve, await emitResult(payload));
          } catch (error) {
            finish(reject, error);
          }
        };
        socket.onerror = () => finish(reject, new Error(`Errore WebSocket ${endpoint}`));
        socket.onclose = () => {
          if (!settled) finish(reject, new Error(`WebSocket chiuso senza payload: ${endpoint}`));
        };
        return;
      }

      const method = String(config.method || "GET").toUpperCase();
      const templateContext = { payload: inputPayload || {} };
      const headers = { Accept: "application/json", ...parseObjectLoose(configValueWithTemplate(config.headers, templateContext)) };
      const requestEndpoint = urlWithQueryParams(
        endpoint,
        parseObjectLoose(configValueWithTemplate(config.queryParams || config.params, templateContext))
      );
      const body = parseJsonLoose(configValueWithTemplate(config.requestBody || config.body || config.testPayload || config.payload, templateContext));
      const init = { method, headers };
      if (method !== "GET" && body) {
        if (!headers["Content-Type"] && !headers["content-type"]) headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(body);
      }
      fetch(requestEndpoint, init)
        .then(async (response) => {
          const text = await response.text();
          return emitResult({
            live: true,
            runId,
            status: response.status,
            ok: response.ok,
            endpoint: requestEndpoint,
            method,
            data: parseResponsePayload(text),
            receivedAt: new Date().toISOString(),
          }, response.ok ? "ok" : "error");
        })
        .then(resolve)
        .catch(reject);
    });

  const isTaskSourceNode = (node = {}) =>
    nodeSubtype(node) === "task" || String(node.metadata?.paletteLabel || node.label || "").toLowerCase() === "task node";

  const sourceScoreForTask = (node = {}, text = "") => {
    if (isTaskSourceNode(node)) return -100;
    const capability = nodeCapability(node);
    if (!capability.visible) return -100;
    const source = capabilitySearchText(node);
    const task = String(text || "").toLowerCase();
    const taskTokens = taskTerms(task);
    let score = 0;
    if (nodeCategory(node) === "sources" || node.type === "source" || node.type === "boxTracker") score += 4;
    if (nodeCategory(node) === "trackers") score += 3;
    taskTokens.forEach((term) => {
      if (source.includes(term)) score += 2;
      if (capability.keywords.some((item) => item.toLowerCase().includes(term))) score += 4;
      if (capability.produces.some((item) => item.toLowerCase().includes(term))) score += 4;
      if (capability.purpose.toLowerCase().includes(term)) score += 3;
    });
    return score;
  };

  const taskTerms = (text = "") => {
    const stopwords = new Set([
      "the", "and", "then", "with", "from", "into", "this", "that", "per", "con", "del", "della", "dello", "degli", "delle",
      "uno", "una", "poi", "che", "come", "node", "nodo", "prezzo", "price", "attuale", "current", "manda", "send",
      "preview", "telegram", "message", "messaggio", "json", "pulito", "clean", "source", "sorgente", "monitora",
    ]);
    return unique(String(text || "").toLowerCase()
      .match(/[a-z0-9][a-z0-9_-]{1,}/g) || [])
      .filter((term) => !stopwords.has(term) && term.length > 1)
      .slice(0, 40);
  };

  const requestedDiscriminators = (text = "", candidates = []) => {
    const candidateTexts = candidates.map(capabilitySearchText);
    return taskTerms(text).filter((term) => {
      const matches = candidateTexts.filter((candidateText) => candidateText.includes(term)).length;
      return matches > 0 && matches < Math.max(2, candidates.length);
    });
  };

  const outgoingCandidateNodes = ({ node, runtime, payload } = {}) => {
    const taskText = [payload?.objective, payload?.task, payload?.context, compactJson(payload?.payload || {}, 300)].filter(Boolean).join("\n");
    const connected = connectedDependencies({ node, runtime })
      .flatMap((dependency) => [dependency.targetNode, dependency.sourceNode])
      .filter(Boolean)
      .filter((item) => item.id !== node.id);
    const graphSources = (runtime.nodes || [])
      .filter((item) =>
        !isTaskSourceNode(item) &&
        (nodeCategory(item) === "sources" || nodeCategory(item) === "trackers" || item.type === "source" || item.type === "boxTracker"))
      .filter((item) => sourceScoreForTask(item, taskText) > 0);
    return [...new Map([...connected, ...graphSources].map((item) => [item.id, item])).values()];
  };

  const preferredSourceForTask = ({ node, runtime, payload } = {}) => {
    const taskText = [payload?.objective, payload?.task, payload?.context, compactJson(payload?.payload || {}, 300)].filter(Boolean).join("\n");
    return preferredSourcesForTask({ node, runtime, payload, taskText })[0] || null;
  };

  const preferredSourcesForTask = ({ node, runtime, payload, taskText = "" } = {}) => {
    const text = taskText || [payload?.objective, payload?.task, payload?.context, compactJson(payload?.payload || {}, 300)].filter(Boolean).join("\n");
    const candidateNodes = outgoingCandidateNodes({ node, runtime, payload });
    const sourceCandidates = candidateNodes.filter((target) =>
      !isTaskSourceNode(target) &&
      (nodeCategory(target) === "sources" || nodeCategory(target) === "trackers" || target.type === "source" || target.type === "boxTracker"));
    const discriminators = requestedDiscriminators(text, sourceCandidates);
    if (discriminators.length) {
      const byDiscriminator = discriminators
        .map((term) => sourceCandidates
          .map((target) => ({ target, score: sourceScoreForTask(target, text), text: capabilitySearchText(target) }))
          .filter((item) => item.score > 0 && item.text.includes(term))
          .sort((a, b) => b.score - a.score)[0]?.target)
        .filter(Boolean);
      if (byDiscriminator.length) return [...new Map(byDiscriminator.map((item) => [item.id, item])).values()];
    }
    const best = sourceCandidates
      .map((target) => ({ target, score: sourceScoreForTask(target, taskText) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.target;
    return best ? [best] : [sourceCandidates[0]].filter(Boolean);
  };

  const repairPlannerSteps = ({ node, runtime, payload, event, steps = [] } = {}) => {
    const normalized = (steps || []).map(normalizePlannerStep).filter((step) => step.action);
    const sources = preferredSourcesForTask({ node, runtime, payload });
    const source = sources[0] || null;
    if (!source) return normalized;
    const nodesById = new Map((runtime.nodes || []).map((item) => [item.id, item]));
    const inputSourceId = event.sourceNodeId || payload?.sourceNodeId || "";
    let replaced = false;
    const repaired = normalized.map((step) => {
      if (step.action !== "run_node") return step;
      const target = nodesById.get(step.nodeId) ||
        (runtime.nodes || []).find((item) => String(item.label || "").toLowerCase() === String(step.nodeId || "").toLowerCase());
      if (target && !isTaskSourceNode(target) && target.id !== inputSourceId) return step;
      replaced = true;
      return {
        ...step,
        nodeId: source.id,
        outputChannel: nodeOutputs(source).find((channel) => channel === "raw") || nodeConfig(source).emitChannel || nodeOutputs(source)[0] || "raw",
        reason: step.reason || "planner-repaired-source",
      };
    });
    if (!repaired.some((step) => step.action === "run_node") && normalized.some((step) => step.action === "send_result")) {
      replaced = true;
      repaired.unshift({
        action: "run_node",
        nodeId: source.id,
        outputChannel: nodeOutputs(source).find((channel) => channel === "raw") || nodeConfig(source).emitChannel || nodeOutputs(source)[0] || "raw",
        inputChannel: "",
        from: "",
        reason: "planner-inserted-source",
      });
    }
    const result = replaced ? repaired : normalized;
    if (sources.length <= 1) return result;
    const existingRunIds = new Set(result.filter((step) => step.action === "run_node").map((step) => step.nodeId));
    const sendTargets = result.filter((step) => step.action === "send_result");
    const finishSteps = result.filter((step) => step.action === "finish");
    const withoutFinish = result.filter((step) => step.action !== "finish");
    const appended = [];
    sources
      .filter((item) => !existingRunIds.has(item.id))
      .forEach((item) => {
        appended.push({
          action: "run_node",
          nodeId: item.id,
          outputChannel: nodeOutputs(item).find((channel) => channel === "raw") || nodeConfig(item).emitChannel || nodeOutputs(item)[0] || "raw",
          inputChannel: "",
          from: "",
          reason: "planner-inserted-missing-source",
        });
        sendTargets.forEach((targetStep) => appended.push({ ...targetStep, reason: targetStep.reason || "planner-reused-target-for-missing-source" }));
      });
    return appended.length ? [...withoutFinish, ...appended, ...(finishSteps.length ? finishSteps : [{ action: "finish" }])] : result;
  };

  const fallbackAiPlan = ({ node, runtime, payload, event } = {}) => {
    const config = nodeConfig(node);
    const dependencies = outgoingDependencies({ node, runtime });
    const candidateNodes = outgoingCandidateNodes({ node, runtime, payload });
    const taskText = [
      payload?.objective,
      payload?.task,
      payload?.context,
      payload?.successCondition,
      JSON.stringify(payload?.payload || {}),
    ].filter(Boolean).join(" ").toLowerCase();
    const sources = preferredSourcesForTask({ node, runtime, payload, taskText });
    const preview = candidateNodes.find((target) => target.type === "devPreview" || nodeSubtype(target) === "preview" || nodeCategory(target) === "dev") || null;
    const actionTargets = candidateNodes.filter((target) => {
      if (nodeCategory(target) !== "actions" && target.type !== "action") return false;
      const label = `${target.label || ""} ${nodeSubtype(target)}`.toLowerCase();
      if (/telegram/.test(taskText)) return /telegram/.test(label);
      if (/slack/.test(taskText)) return /slack/.test(label);
      if (/discord/.test(taskText)) return /discord/.test(label);
      if (/email|mail/.test(taskText)) return /email|mail/.test(label);
      return /messaggio|message|invia|send/.test(taskText);
    });
    const steps = [];
    sources.forEach((source) => {
      const outputChannel = nodeOutputs(source).find((channel) => channel === "raw") || nodeConfig(source).emitChannel || nodeOutputs(source)[0] || "raw";
      steps.push({ action: "run_node", nodeId: source.id, outputChannel, reason: "fallback-source-match" });
      if (preview) {
        const previewDependency = dependencies.find((dependency) => dependency.targetNode?.id === preview.id);
        steps.push({
          action: "send_result",
          nodeId: preview.id,
          inputChannel: previewDependency?.channel || previewDependency?.metadata?.targetPort || "done",
          from: "lastResult",
          reason: "fallback-preview-target",
        });
      }
      actionTargets.forEach((target) => {
        const dependency = dependencies.find((item) => item.targetNode?.id === target.id);
        steps.push({
          action: "send_result",
          nodeId: target.id,
          inputChannel: dependency?.channel || dependency?.metadata?.targetPort || "event",
          from: "lastResult",
          reason: "fallback-action-target",
        });
      });
    });
    steps.push({ action: "finish" });
    const canRoute = Boolean(sources.length && (preview || actionTargets.length));
    return {
      provider: "fallback",
      model: "rule-planner",
      canExecute: Boolean(steps.length > 1),
      reason: canRoute ? "source-target-route" : "fallback route incomplete",
      steps,
      runId: event.meta?.runId || payload?.runId || `orch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      decision: canRoute ? String(config.decisionName || "execute_downstream") : "blocked",
    };
  };

  const normalizePlannerStep = (step = {}) => {
    const rawTool = String(step.tool || step.toolName || step.mcpName || "").trim();
    const mcpTool = rawTool.match(/^tl\.node\.([^.]+)\.([A-Za-z0-9_-]+)$/);
    return {
      action: String(step.action || step.type || "").trim().toLowerCase(),
      nodeId: String(step.nodeId || step.targetNodeId || step.node || mcpTool?.[1] || "").trim(),
      tool: mcpTool?.[2] || rawTool,
      args: step.args && typeof step.args === "object" && !Array.isArray(step.args) ? step.args : {},
      outputChannel: String(step.outputChannel || step.channel || step.sourcePort || "").trim(),
      inputChannel: String(step.inputChannel || step.channel || step.targetPort || "").trim(),
      from: String(step.from || step.source || "").trim(),
      reason: String(step.reason || "").trim(),
      transform: step.transform && typeof step.transform === "object" && !Array.isArray(step.transform) ? step.transform : null,
    };
  };

  const valueAtPath = (source, path = "") => {
    const parts = String(path || "").trim().split(".").filter(Boolean);
    if (!parts.length) return source;
    return parts.reduce((value, key) => {
      if (value === undefined || value === null) return undefined;
      if (Array.isArray(value) && /^\d+$/.test(key)) return value[Number(key)];
      return value?.[key];
    }, source);
  };

  const signalFromChangePercent = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "normal";
    if (numeric <= -3) return "low_alert";
    if (numeric >= 3) return "high_alert";
    return "normal";
  };

  const runtimeAlertMessage = (current = {}, source = {}) => {
    const label = current.symbol || current.label || valueAtPath(source, "data.s") || valueAtPath(source, "name") || "runtime-event";
    const value = current.price ?? current.value ?? valueAtPath(source, "data.c") ?? valueAtPath(source, "value") ?? "";
    const changePercent = current.changePercent ?? valueAtPath(source, "data.P") ?? "";
    const signal = current.signal || signalFromChangePercent(changePercent);
    return [
      `${label}${value !== "" ? ` ${value}` : ""}`,
      changePercent !== "" ? `Change: ${changePercent}%` : "",
      `Signal: ${signal}`,
    ].filter(Boolean).join("\n");
  };

  const transformValue = (source, expression = "", current = {}) => {
    if (typeof expression !== "string") return expression;
    const text = expression.trim();
    const numberPrefix = "number:";
    const stringPrefix = "string:";
    const boolPrefix = "bool:";
    const signalPrefix = "signal:";
    if (text.startsWith(numberPrefix)) {
      const value = valueAtPath(source, text.slice(numberPrefix.length));
      const numeric = Number(value);
      return Number.isNaN(numeric) ? null : numeric;
    }
    if (text.startsWith(stringPrefix)) {
      const value = valueAtPath(source, text.slice(stringPrefix.length));
      return value === undefined || value === null ? "" : String(value);
    }
    if (text.startsWith(boolPrefix)) return Boolean(valueAtPath(source, text.slice(boolPrefix.length)));
    if (text === "runtime_signal" || text === "signal") {
      return signalFromChangePercent(current.changePercent ?? source.changePercent ?? valueAtPath(source, "data.P"));
    }
    if (text.startsWith(signalPrefix)) {
      const path = text.slice(signalPrefix.length);
      return signalFromChangePercent(current[path] ?? valueAtPath(source, path));
    }
    if (text === "runtime_alert_message" || text === "alert_message") return runtimeAlertMessage(current, source);
    const pathValue = valueAtPath(source, text);
    return pathValue === undefined ? expression : pathValue;
  };

  const applyTransform = (source, transform = null) => {
    if (!transform || typeof transform !== "object" || Array.isArray(transform)) return source;
    return Object.entries(transform).reduce((result, [key, expression]) => {
      result[key] = transformValue(source, expression, result);
      return result;
    }, {});
  };

  const inferTransformFromTask = (taskPayload = {}) => {
    const text = [taskPayload?.objective, taskPayload?.task, taskPayload?.context].filter(Boolean).join("\n").toLowerCase();
    const transform = {};
    if (/symbol|simbolo/.test(text)) transform.symbol = "data.s";
    if (/price|prezzo|value|valore/.test(text)) transform.value = "number:data.c";
    if (/changepercent|change percent|percentuale|variazione/.test(text)) transform.changePercent = "number:data.P";
    if (/source|sorgente/.test(text)) transform.source = "runtime";
    if (/receivedat|received at|timestamp/.test(text)) transform.receivedAt = "receivedAt";
    if (/signal|segnale/.test(text)) transform.signal = "runtime_signal";
    if (/message|messaggio/.test(text)) transform.message = "runtime_alert_message";
    return Object.keys(transform).length ? transform : null;
  };

  const buildStepPayload = ({ orchestrator, target, payload, event, decision, stepIndex }) => ({
    orchestrator: {
      nodeId: orchestrator.id,
      label: orchestrator.label || orchestrator.id,
      decision: decision.decision,
      runId: decision.runId,
      stepIndex,
    },
    input: clonePayload(payload),
    event: {
      id: event.id || "",
      channel: event.channel || "",
      eventType: event.eventType || "",
      sourceNodeId: event.sourceNodeId || "",
      createdAt: event.createdAt || "",
    },
    target: {
      nodeId: target.id,
      label: target.label || target.id,
      type: target.type || "",
      category: nodeCategory(target),
      subtype: nodeSubtype(target),
    },
  });

  const missionConfig = (node = {}) => {
    const config = nodeConfig(node);
    const mode = executionMode(node);
    return {
      enabled: mode === "autonomous" || String(config.autonomousMode || config.autonomous || "false") === "true",
      maxIterations: Math.max(1, Math.min(50, Number(config.maxIterations || 5))),
      iterationDelayMs: Math.max(0, Math.min(60000, Number(config.iterationDelayMs || 1200))),
      stopCondition: String(config.stopCondition || "completed").trim().toLowerCase(),
      feedbackWindow: Math.max(1, Math.min(50, Number(config.feedbackWindow || 12))),
    };
  };

  const wait = (ms = 0) =>
    new Promise((resolve) => {
      const timer = typeof window?.setTimeout === "function" ? window.setTimeout : setTimeout;
      timer(resolve, Math.max(0, Number(ms) || 0));
    });

  const searchableOutcomeText = (payload = {}) => {
    if (!payload || typeof payload !== "object") return String(payload || "");
    return [
      payload.text,
      payload.message,
      payload.summary,
      payload.reason,
      payload.result?.text,
      payload.result?.message,
      payload.result?.summary,
      payload.response?.text,
      payload.response?.message,
      payload.response?.summary,
      payload.output?.text,
      payload.output?.message,
      payload.output?.summary,
    ].filter(Boolean).join("\n").toLowerCase();
  };

  const payloadLooksComplete = (payload = {}, stopCondition = "completed") => {
    if (!payload || typeof payload !== "object") return String(payload || "").toLowerCase().includes(stopCondition);
    const status = String(payload.status || payload.state || payload.result?.status || payload.response?.status || "").toLowerCase();
    const decision = String(payload.decision || payload.result?.decision || payload.response?.decision || "").toLowerCase();
    if (payload.completed === true || payload.done === true || payload.success === true || payload.goalReached === true) return true;
    if (["completed", "complete", "done", "success", "succeeded", "goal_reached"].includes(status)) return true;
    if (["completed", "complete", "done", "success", "goal_reached"].includes(decision)) return true;
    return stopCondition ? searchableOutcomeText(payload).includes(stopCondition) : false;
  };

  const missionIsComplete = ({ payload = {}, result = {}, feedback = [], stopCondition = "completed" } = {}) =>
    payloadLooksComplete(payload, stopCondition) ||
    payloadLooksComplete(result, stopCondition) ||
    feedback.some((item) => payloadLooksComplete(item.payload, stopCondition));

  const planFromGraph = ({ node, runtime, payload, event }) => {
    const config = nodeConfig(node);
    const maxSteps = Math.max(1, Math.min(20, Number(config.maxSteps || 6)));
    const runId = event.meta?.runId || payload?.runId || `orch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const dependencies = outgoingDependencies({ node, runtime });
    const steps = [];
    const skipped = [];

    dependencies.forEach((dependency) => {
      const target = dependency.targetNode;
      const reason = !isTargetAllowed({ target, config })
        ? "target-not-allowed"
        : !targetIsConfigured(target)
          ? "target-not-configured"
          : externalActionNeedsConfirmation({ target, config, payload })
            ? "confirmation-required"
            : "";
      if (reason) {
        skipped.push({
          nodeId: target.id,
          label: target.label || target.id,
          category: nodeCategory(target),
          subtype: nodeSubtype(target),
          reason,
        });
        return;
      }
      if (steps.length >= maxSteps) {
        skipped.push({ nodeId: target.id, label: target.label || target.id, reason: "max-steps-reached" });
        return;
      }
      steps.push({
        id: `step_${steps.length + 1}`,
        nodeId: target.id,
        label: target.label || target.id,
        type: target.type || "",
        category: nodeCategory(target),
        subtype: nodeSubtype(target),
        channel: dependency.channel || dependency.metadata?.targetPort || target.inputs?.[0] || "input",
        sourcePort: dependency.metadata?.sourcePort || "",
        targetPort: dependency.metadata?.targetPort || target.inputs?.[0] || "",
      });
    });

    const decision = steps.length
      ? String(config.decisionName || "execute_downstream")
      : skipped.length
        ? "blocked"
        : "no_targets";

    return {
      runId,
      decision,
      goal: config.goal || config.systemPrompt || "Orchestrate connected runtime nodes.",
      mode: executionMode(node),
      inputChannel: event.channel || "",
      availableTargets: dependencies.map((dependency) => ({
        nodeId: dependency.targetNode.id,
        label: dependency.targetNode.label || dependency.targetNode.id,
        category: nodeCategory(dependency.targetNode),
        subtype: nodeSubtype(dependency.targetNode),
        channel: dependency.channel || "",
      })),
      steps,
      skipped,
      payloadPreview: compactJson(payload, 900),
      createdAt: new Date().toISOString(),
    };
  };

  class OrchestratorAgentRuntime {
    constructor({ workspaceId = "workspace_global" } = {}) {
      this.workspaceId = workspaceId;
      this.unsubscribers = [];
      this.signature = "";
      this.bus = null;
      this.runtime = { nodes: [], dependencies: [] };
      this.executionKeys = new Set();
      this.execution = window.TrackerLensNodeExecutionController?.get?.(this.workspaceId) || null;
    }

    stop() {
      this.unsubscribers.forEach((unsubscribe) => unsubscribe?.());
      this.unsubscribers = [];
      this.signature = "";
    }

    async log({ node, level = "info", message = "", context = {} } = {}) {
      try {
        await window.TrackerLensEventLogStore?.recordFlowLog?.({
          workspaceId: this.workspaceId,
          nodeId: node?.id || "",
          level,
          message,
          context: {
            runtime: "orchestrator-agent",
            subtype: nodeSubtype(node),
            ...context,
          },
        });
        await window.TrackerLensAiRuntimeStore?.upsertLog?.({
          id: `orch_log_${node?.id || "agent"}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          workspaceId: this.workspaceId,
          agentId: node?.id || "",
          source: node?.label || node?.id || "Orchestrator Agent",
          message,
          status: level,
          context,
          createdAt: new Date().toISOString(),
        });
      } catch (error) {
        console.warn("Orchestrator runtime log non persistito", error);
      }
    }

    async recordTokenUsage({ node, usage = {}, provider = "", model = "" } = {}) {
      const promptTokens = Number(usage.promptTokens || usage.prompt_tokens || 0);
      const completionTokens = Number(usage.completionTokens || usage.completion_tokens || 0);
      const totalTokens = Number(usage.totalTokens || usage.total_tokens || promptTokens + completionTokens || 0);
      if (!node?.id || !totalTokens) return;
      const current = (this.runtime.nodes || []).find((item) => item.id === node.id) || node;
      const previous = current.metadata?.tokenUsage || {};
      const nextUsage = {
        totalTokens: Number(previous.totalTokens || 0) + totalTokens,
        totalPromptTokens: Number(previous.totalPromptTokens || 0) + promptTokens,
        totalCompletionTokens: Number(previous.totalCompletionTokens || 0) + completionTokens,
        lastTokens: totalTokens,
        lastPromptTokens: promptTokens,
        lastCompletionTokens: completionTokens,
        provider: provider || previous.provider || "",
        model: model || previous.model || "",
        updatedAt: new Date().toISOString(),
      };
      const nextNode = {
        ...current,
        metadata: {
          ...(current.metadata || {}),
          tokenUsage: nextUsage,
          config: {
            ...(current.metadata?.config || {}),
            tokenUsage: nextUsage.totalTokens,
            lastTokens: nextUsage.lastTokens,
          },
        },
        updatedAt: new Date().toISOString(),
      };
      this.runtime.nodes = (this.runtime.nodes || []).map((item) => item.id === nextNode.id ? nextNode : item);
      try {
        await window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode?.({ node: nextNode });
      } catch (error) {
        console.warn("Orchestrator token usage non persistito", error);
      }
    }

    clearTokenUsageForNodes(ids = []) {
      const targets = new Set((ids || []).filter(Boolean).map(String));
      if (!targets.size) return;
      this.runtime.nodes = (this.runtime.nodes || []).map((node) => {
        if (!targets.has(node.id)) return node;
        return {
          ...node,
          metadata: {
            ...(node.metadata || {}),
            tokenUsage: {
              totalTokens: 0,
              totalPromptTokens: 0,
              totalCompletionTokens: 0,
              lastTokens: 0,
              lastPromptTokens: 0,
              lastCompletionTokens: 0,
              clearedAt: new Date().toISOString(),
            },
            config: {
              ...(node.metadata?.config || {}),
              tokenUsage: 0,
              lastTokens: 0,
            },
          },
        };
      });
    }

    buildSignature(runtime = {}) {
      const orchestrators = (runtime.nodes || [])
        .filter(isRunnableOrchestrator)
        .map((node) => ({
          id: node.id,
          status: nodeStatus(node),
          inputs: nodeInputs(node, runtime.dependencies || []),
          outputs: node.outputs || [],
          config: nodeConfig(node),
          incomingMappings: (runtime.dependencies || [])
            .filter((dependency) => dependency.targetNodeId === node.id)
            .filter((dependency) => String(dependency.metadata?.linkType || dependency.mapping?.linkType || "data") !== "tool-access")
            .map((dependency) => ({ id: dependency.id, channel: dependency.channel, metadata: dependency.metadata || {} })),
          outgoing: outgoingDependencies({ node, runtime }).map((dependency) => ({
            id: dependency.id,
            targetNodeId: dependency.targetNodeId,
            channel: dependency.channel,
            targetStatus: nodeStatus(dependency.targetNode),
            targetConfig: nodeConfig(dependency.targetNode),
          })),
        }));
      return JSON.stringify(orchestrators);
    }

    start({ runtime = {}, workspaceId = this.workspaceId } = {}) {
      this.workspaceId = workspaceId || this.workspaceId || "workspace_global";
      this.runtime = runtime || { nodes: [], dependencies: [] };
      this.execution = window.TrackerLensNodeExecutionController?.get?.(this.workspaceId) || this.execution;
      const nextSignature = this.buildSignature(runtime);
      if (nextSignature === this.signature && this.bus) return this;
      this.stop();
      this.signature = nextSignature;
      this.bus = window.TrackerLensEventBus?.get?.(this.workspaceId, {
        eventStore: window.TrackerLensEventLogStore,
        channelRegistry: window.TrackerLensChannelRegistry,
      });
      if (!this.bus) return this;

      (runtime.nodes || []).filter(isRunnableOrchestrator).forEach((node) => {
        nodeInputs(node, runtime.dependencies || []).forEach((channel) => {
          const unsubscribe = this.bus.on(channel, (payload, event) => {
            this.handleEvent({ node, payload, event });
          }, {
            id: `orchestrator_${node.id}_${channel}`,
            targetNodeId: node.id,
            metadata: { runtime: "orchestrator-agent", subtype: nodeSubtype(node) },
          });
          this.unsubscribers.push(unsubscribe);
        });
      });
      return this;
    }

    async applyIncomingMapping({ node, payload, event } = {}) {
      const dependency = window.TrackerLensRuntimeContract?.incomingDependencyForEvent?.({
        runtime: this.runtime,
        node,
        event,
      });
      const mapping = dependency?.metadata || null;
      if (!mapping || !window.TrackerLensRuntimeContract?.applyConnectionMapping) {
        return { payload, event, dependency, mappingResult: null };
      }
      const result = window.TrackerLensRuntimeContract.applyConnectionMapping(payload, mapping);
      if (result.changed || result.warnings.length) {
        await this.log({
          node,
          level: result.warnings.length ? "warning" : "info",
          message: result.warnings.length ? `Connection mapping warning: ${node.label || node.id}` : `Connection mapping applied: ${node.label || node.id}`,
          context: {
            action: "connection-mapping-applied",
            dependencyId: dependency.id || "",
            inputChannel: event?.channel || "",
            mode: result.mapping.mode,
            payloadPath: result.mapping.payloadPath,
            transformed: result.changed,
            warnings: result.warnings,
          },
        });
      }
      return {
        payload: result.payload,
        event: {
          ...event,
          meta: {
            ...(event?.meta || {}),
            mappedPayload: result.changed,
            mappingMode: result.mapping.mode,
            mappingDependencyId: dependency.id || "",
          },
        },
        dependency,
        mappingResult: result,
      };
    }

    async collectMissionFeedback({ runId = "", since = 0, limit = 12 } = {}) {
      if (!runId) return [];
      const events = await window.TrackerLensEventLogStore?.listEvents?.().catch(() => []);
      const workspaceAliases = new Set([this.workspaceId || "workspace_global", this.workspaceId === "workspace_global" ? "global" : "workspace_global"]);
      return (events || [])
        .filter((item) => workspaceAliases.has(item.workspaceId || "global"))
        .filter((item) => item.meta?.runId === runId || item.payload?.runId === runId)
        .filter((item) => !since || Date.parse(item.createdAt || 0) >= since)
        .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
        .slice(0, limit)
        .map((item) => ({
          id: item.id || "",
          channel: item.channel || "",
          eventType: item.eventType || "",
          sourceNodeId: item.sourceNodeId || "",
          createdAt: item.createdAt || "",
          payload: clonePayload(item.payload),
        }));
    }

    startStatusHeartbeat({ node, runId = "", event = {}, phase = "waiting", label = "", targetLabel = "" } = {}) {
      if (!node?.id || !this.bus?.emit) return () => {};
      let stopped = false;
      const emitWaitingStatus = () => {
        if (stopped) return;
        this.bus.emit("orchestrator.status", {
          phase,
          runId,
          nodeId: node.id,
          label: label || targetLabel || "Waiting",
          targetLabel,
          startedAt: new Date().toISOString(),
        }, {
          workspaceId: this.workspaceId,
          eventType: "orchestrator_waiting",
          sourceNodeId: node.id,
          status: "busy",
          meta: {
            orchestratorRuntime: node.id,
            inputEventId: event.id || "",
            inputChannel: event.channel || "",
            runId,
          },
        }).catch(() => {});
      };
      emitWaitingStatus();
      const timer = globalThis.setInterval?.(emitWaitingStatus, 1800);
      return () => {
        stopped = true;
        if (timer) globalThis.clearInterval?.(timer);
      };
    }

    async buildPlannerDecision({ node, payload = {}, event = {}, runtime = this.runtime, phase = "initial", observation = null } = {}) {
      const runId = event.meta?.runId || payload?.runId || `orch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const fallback = fallbackAiPlan({ node, runtime, payload, event });
      try {
        const aiPlan = await askPlannerAi({ node, runtime, payload, event, phase, observation });
        const steps = repairPlannerSteps({ node, runtime, payload, event, steps: aiPlan.steps || [] });
        if (!steps.length) throw new Error("Planner AI senza step eseguibili");
        await this.recordTokenUsage({ node, usage: aiPlan.usage, provider: aiPlan.provider, model: aiPlan.model });
        return {
          ...fallback,
          ...aiPlan,
          runId,
          decision: steps.some((step) => step.action === "run_node" || step.action === "call_tool" || step.action === "send_result")
            ? String(nodeConfig(node).decisionName || "execute_downstream")
            : "blocked",
          steps,
          fallbackUsed: false,
          usage: aiPlan.usage || {},
          createdAt: new Date().toISOString(),
        };
      } catch (error) {
        await this.log({
          node,
          level: "warning",
          message: `Orchestrator AI planner fallback: ${error.message || error}`,
          context: {
            action: "orchestrator-ai-planner-fallback",
            runId,
            error: error.message || String(error),
            fallback,
          },
        });
        return {
          ...fallback,
          runId,
          fallbackUsed: true,
          plannerError: error.message || String(error),
          createdAt: new Date().toISOString(),
        };
      }
    }

    async sendPlannerResult({ node, target, payload, channel = "", runId = "", event = {}, step = {}, taskPayload = {} } = {}) {
      const emitChannel = channel || node.outputs?.[2] || "done";
      const rawPayload = payload?.payload && payload.nodeId && payload.channels
        ? payload.payload
        : payload;
      const inferredTransform = inferTransformFromTask(taskPayload);
      const transform = step.transform && inferredTransform
        ? { ...inferredTransform, ...step.transform }
        : step.transform || inferredTransform;
      const resultPayload = applyTransform(rawPayload, transform);
      const emittedEvent = await this.bus?.emit?.(emitChannel, resultPayload, {
        workspaceId: this.workspaceId,
        eventType: "orchestrator_result",
        sourceNodeId: node.id,
        targetNodeId: target?.id || "",
        meta: {
          orchestratorRuntime: node.id,
          inputEventId: event.id || "",
          inputChannel: event.channel || "",
          targetPort: step.inputChannel || "",
          targetNodeId: target?.id || "",
          runId,
          plannerStep: step.action || "send_result",
          transformed: Boolean(transform),
        },
      });
      return {
        action: "send_result",
        nodeId: target?.id || "",
        label: target?.label || target?.id || "",
        channel: emitChannel,
        eventId: emittedEvent?.id || "",
        payload: clonePayload(resultPayload),
        transform: transform ? clonePayload(transform) : null,
      };
    }

    async performPlannedExecution({ node, payload = {}, event = {}, runtime = this.runtime } = {}) {
      const startedAt = performance.now();
      const plannedRunId = event.meta?.runId || payload?.runId || `orch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      await this.bus?.emit?.("orchestrator.status", {
        phase: "planning",
        runId: plannedRunId,
        nodeId: node.id,
        label: node.label || node.id,
        task: payload?.objective || payload?.task || "",
        startedAt: new Date().toISOString(),
      }, {
        workspaceId: this.workspaceId,
        eventType: "orchestrator_planning",
        sourceNodeId: node.id,
        status: "busy",
        meta: {
          orchestratorRuntime: node.id,
          inputEventId: event.id || "",
          inputChannel: event.channel || "",
          runId: plannedRunId,
        },
      });
      const stopPlanningHeartbeat = this.startStatusHeartbeat({
        node,
        runId: plannedRunId,
        event,
        phase: "waiting",
        label: "Waiting for AI planner",
        targetLabel: "AI planner",
      });
      let decision;
      try {
        decision = await this.buildPlannerDecision({ node, payload, event, runtime });
      } finally {
        stopPlanningHeartbeat();
      }
      const decisionChannel = node.outputs?.[0] || "decision";
      await this.bus?.emit?.(decisionChannel, {
        runId: decision.runId,
        decision: decision.decision || "execute_downstream",
        canExecute: decision.canExecute !== false,
        reason: decision.reason || "",
        provider: decision.provider || "",
        model: decision.model || "",
        fallbackUsed: Boolean(decision.fallbackUsed),
        steps: decision.steps || [],
        graph: graphNeighborhood({ node, runtime }),
        task: clonePayload(payload),
        createdAt: decision.createdAt || new Date().toISOString(),
      }, {
        workspaceId: this.workspaceId,
        eventType: "orchestrator_plan",
        sourceNodeId: node.id,
        meta: {
          orchestratorRuntime: node.id,
          inputEventId: event.id || "",
          inputChannel: event.channel || "",
          runId: decision.runId,
        },
      });

      const observations = [];
      const emitted = [];
      const skipped = [];
      let lastResult = null;
      let toolCallCount = 0;
      const nodesById = new Map((runtime.nodes || []).map((item) => [item.id, item]));
      const resolveStepTarget = (step = {}) =>
        nodesById.get(step.nodeId) ||
        (runtime.nodes || []).find((item) => String(item.label || "").toLowerCase() === String(step.nodeId || "").toLowerCase()) ||
        (runtime.nodes || []).find((item) => String(item.label || "").toLowerCase().includes(String(step.nodeId || "").toLowerCase()));

      const stepQueue = [...(decision.steps || [])];
      while (stepQueue.length) {
        const rawStep = stepQueue.shift();
        const step = normalizePlannerStep(rawStep);
        if (step.action === "finish") break;
        const target = resolveStepTarget(step);
        if (!target) {
          skipped.push({ ...step, reason: "target-not-found" });
          continue;
        }
        if (!isTargetAllowed({ target, config: nodeConfig(node) })) {
          skipped.push({ ...step, label: target.label || target.id, reason: "target-not-allowed" });
          continue;
        }
        if (step.action === "call_tool") {
          toolCallCount += 1;
          if (toolCallCount > 8) {
            skipped.push({ ...step, label: target.label || target.id, reason: "tool-call-limit" });
            continue;
          }
          if (!window.TrackerLensAgentRuntime?.callConnectedNodeTool) {
            skipped.push({ ...step, label: target.label || target.id, reason: "agent-tool-runtime-unavailable" });
            continue;
          }
          try {
            await this.bus?.emit?.("orchestrator.status", {
              phase: "tool_call",
              runId: decision.runId,
              nodeId: node.id,
              targetNodeId: target.id,
              targetLabel: target.label || target.id,
              action: "call_tool",
              tool: step.tool,
              startedAt: new Date().toISOString(),
            }, {
              workspaceId: this.workspaceId,
              eventType: "orchestrator_tool_calling",
              sourceNodeId: node.id,
              targetNodeId: target.id,
              status: "busy",
              meta: {
                orchestratorRuntime: node.id,
                targetNodeId: target.id,
                runId: decision.runId,
                plannerStep: "call_tool",
                tool: step.tool,
              },
            });
            const startedToolAt = performance.now();
            const toolResult = await window.TrackerLensAgentRuntime.callConnectedNodeTool({
              workspaceId: this.workspaceId,
              nodeId: target.id,
              tool: step.tool,
              args: step.args || {},
              agentNodeId: node.id,
              runtime,
            });
            const latencyMs = Math.max(1, Math.round(performance.now() - startedToolAt));
            const result = {
              nodeId: target.id,
              label: target.label || target.id,
              channels: ["agent.tool.observation"],
              payload: toolResult,
              latencyMs,
              status: toolResult?.ok === false ? "warning" : "ok",
            };
            lastResult = result;
            observations.push({
              ...step,
              label: target.label || target.id,
              tool: step.tool,
              args: clonePayload(step.args || {}),
              payload: clonePayload(toolResult),
              latencyMs,
            });
            await this.bus?.emit?.("agent.tool.observation", {
              runId: decision.runId,
              orchestratorNodeId: node.id,
              targetNodeId: target.id,
              targetLabel: target.label || target.id,
              tool: step.tool,
              args: clonePayload(step.args || {}),
              result: clonePayload(toolResult),
              latencyMs,
              observedAt: new Date().toISOString(),
            }, {
              workspaceId: this.workspaceId,
              eventType: "orchestrator_tool_observation",
              sourceNodeId: node.id,
              targetNodeId: target.id,
              latencyMs,
              status: toolResult?.ok === false ? "warning" : "ok",
              meta: {
                orchestratorRuntime: node.id,
                runId: decision.runId,
                plannerStep: "call_tool",
                tool: step.tool,
              },
            });
            const stopObservationHeartbeat = this.startStatusHeartbeat({
              node,
              runId: decision.runId,
              event,
              phase: "waiting",
              label: "Waiting after tool observation",
              targetLabel: "AI planner",
            });
            let nextDecision;
            try {
              nextDecision = await this.buildPlannerDecision({
                node,
                payload,
                event,
                runtime,
                phase: "observe",
                observation: {
                  executedStep: step,
                  result,
                  previousPlan: decision.steps || [],
                },
              });
            } finally {
              stopObservationHeartbeat();
            }
            const nextSteps = (nextDecision.steps || [])
              .map(normalizePlannerStep)
              .filter((item) => item.action && item.action !== "run_node");
            if (nextSteps.length) {
              const pending = stepQueue.map(normalizePlannerStep);
              const seenTargets = new Set(nextSteps
                .filter((item) => item.action === "send_result")
                .map((item) => `${item.action}:${item.nodeId}:${item.inputChannel}`));
              const preservedPending = pending.filter((item) => {
                if (item.action !== "send_result") return item.action !== "finish";
                const key = `${item.action}:${item.nodeId}:${item.inputChannel}`;
                return !seenTargets.has(key);
              });
              stepQueue.splice(0, stepQueue.length, ...nextSteps, ...preservedPending);
            }
          } catch (error) {
            skipped.push({ ...step, label: target.label || target.id, reason: "call-tool-error", error: error.message || String(error) });
          }
          continue;
        }
        if (step.action === "run_node") {
          try {
            await this.bus?.emit?.("orchestrator.status", {
              phase: "executing",
              runId: decision.runId,
              nodeId: node.id,
              targetNodeId: target.id,
              targetLabel: target.label || target.id,
              action: "run_node",
              startedAt: new Date().toISOString(),
            }, {
              workspaceId: this.workspaceId,
              eventType: "orchestrator_executing",
              sourceNodeId: node.id,
              targetNodeId: target.id,
              status: "busy",
              meta: {
                orchestratorRuntime: node.id,
                executedNodeId: target.id,
                runId: decision.runId,
                plannerStep: "run_node",
              },
            });
            const result = await executeSourceNode({
              runtime,
              bus: this.bus,
              workspaceId: this.workspaceId,
              runId: decision.runId,
              node: target,
              outputChannel: step.outputChannel,
              inputPayload: lastResult?.payload || payload,
            });
            lastResult = result;
            observations.push({
              ...step,
              label: target.label || target.id,
              channels: result.channels || [],
              payload: clonePayload(result.payload),
              latencyMs: result.latencyMs || 0,
            });
            const stopObservationHeartbeat = this.startStatusHeartbeat({
              node,
              runId: decision.runId,
              event,
              phase: "waiting",
              label: "Waiting for next command",
              targetLabel: "AI planner",
            });
            let nextDecision;
            try {
              nextDecision = await this.buildPlannerDecision({
                node,
                payload,
                event,
                runtime,
                phase: "observe",
                observation: {
                  executedStep: step,
                  result,
                  previousPlan: decision.steps || [],
                },
              });
            } finally {
              stopObservationHeartbeat();
            }
            const nextSteps = (nextDecision.steps || [])
              .map(normalizePlannerStep)
              .filter((item) => item.action && item.action !== "run_node");
            if (nextSteps.length) {
              const pending = stepQueue.map(normalizePlannerStep);
              const hasPendingRunNode = pending.some((item) => item.action === "run_node");
              const seenTargets = new Set(nextSteps
                .filter((item) => item.action === "send_result")
                .map((item) => `${item.action}:${item.nodeId}:${item.inputChannel}`));
              const preservedPending = pending.filter((item) => {
                if (item.action !== "send_result") return item.action !== "finish";
                const key = `${item.action}:${item.nodeId}:${item.inputChannel}`;
                return !seenTargets.has(key);
              });
              const followUpSteps = hasPendingRunNode ? nextSteps.filter((item) => item.action !== "finish") : nextSteps;
              const finishSteps = hasPendingRunNode ? nextSteps.filter((item) => item.action === "finish") : [];
              stepQueue.splice(0, stepQueue.length, ...followUpSteps, ...preservedPending, ...finishSteps);
            }
          } catch (error) {
            skipped.push({ ...step, label: target.label || target.id, reason: "run-node-error", error: error.message || String(error) });
          }
          continue;
        }
        if (step.action === "send_result") {
          if (!lastResult) {
            skipped.push({ ...step, label: target.label || target.id, reason: "missing-observation" });
            continue;
          }
          const routeDependency = (runtime.dependencies || [])
            .find((dependency) => dependency.sourceNodeId === node.id && dependency.targetNodeId === target.id);
          await this.bus?.emit?.("orchestrator.status", {
            phase: "sending",
            runId: decision.runId,
            nodeId: node.id,
            targetNodeId: target.id,
            targetLabel: target.label || target.id,
            action: "send_result",
            startedAt: new Date().toISOString(),
          }, {
            workspaceId: this.workspaceId,
            eventType: "orchestrator_sending",
            sourceNodeId: node.id,
            targetNodeId: target.id,
            status: "busy",
            meta: {
              orchestratorRuntime: node.id,
              runId: decision.runId,
              plannerStep: "send_result",
            },
          });
          const emittedResult = await this.sendPlannerResult({
            node,
            target,
            payload: lastResult,
            channel: routeDependency?.channel || routeDependency?.metadata?.targetPort || step.inputChannel || node.outputs?.[2] || "done",
            runId: decision.runId,
            event,
            step,
            taskPayload: payload,
          });
          emitted.push(emittedResult);
          continue;
        }
        skipped.push({ ...step, label: target.label || target.id, reason: "unsupported-action" });
      }

      const latencyMs = Math.round(performance.now() - startedAt);
      const completed = Boolean(emitted.length || observations.length) && !skipped.some((item) => item.reason === "run-node-error");
      const result = {
        runId: decision.runId,
        decision: decision.decision || "execute_downstream",
        provider: decision.provider || "",
        model: decision.model || "",
        fallbackUsed: Boolean(decision.fallbackUsed),
        plannerError: decision.plannerError || "",
        status: completed ? "completed" : skipped.length ? "blocked" : "idle",
        steps: decision.steps || [],
        observations,
        emitted,
        skipped,
        latencyMs,
      };

      if (!emitted.length) {
        await this.bus?.emit?.(node.outputs?.[2] || "done", result, {
          workspaceId: this.workspaceId,
          eventType: "orchestrator_done",
          sourceNodeId: node.id,
          latencyMs,
          meta: {
            orchestratorRuntime: node.id,
            inputEventId: event.id || "",
            inputChannel: event.channel || "",
            runId: decision.runId,
          },
        });
      }
      await this.log({
        node,
        level: result.status === "completed" ? "info" : "warning",
        message: `Orchestrator planned execution: ${node.label || node.id}`,
        context: {
          runId: result.runId,
          inputChannel: event.channel || "",
          decision: result.decision,
          provider: result.provider,
          model: result.model,
          fallbackUsed: result.fallbackUsed,
          observations: result.observations,
          emitted: result.emitted,
          skipped: result.skipped,
          latencyMs,
        },
      });
      return result;
    }

    async performSingleExecution({ node, payload = {}, event = {}, runtime = this.runtime } = {}) {
      const plannerMode = String(nodeConfig(node).plannerStrategy || "ai-first").toLowerCase();
      if (plannerMode !== "legacy") {
        return this.performPlannedExecution({ node, payload, event, runtime });
      }
      const decision = planFromGraph({ node, runtime, payload, event });
      const startedAt = performance.now();
      const decisionChannel = node.outputs?.[0] || "decision";
      const doneChannel = node.outputs?.[2] || "done";
      const linkedChannels = new Set(decision.steps.map((step) => step.channel).filter(Boolean));
      if (!linkedChannels.has(decisionChannel)) {
        await this.bus?.emit?.(decisionChannel, decision, {
          workspaceId: this.workspaceId,
          eventType: "orchestrator_decision",
          sourceNodeId: node.id,
          meta: {
            orchestratorRuntime: node.id,
            inputEventId: event.id || "",
            inputChannel: event.channel || "",
            runId: decision.runId,
          },
        });
      }

      const emitted = [];
      for (const [index, step] of decision.steps.entries()) {
        const target = (runtime.nodes || []).find((item) => item.id === step.nodeId);
        if (!target) continue;
        const stepPayload = buildStepPayload({
          orchestrator: node,
          target,
          payload,
          event,
          decision,
          stepIndex: index + 1,
        });
        const emittedEvent = await this.bus?.emit?.(step.channel, stepPayload, {
          workspaceId: this.workspaceId,
          eventType: "orchestrator_step",
          sourceNodeId: node.id,
          targetNodeId: step.nodeId,
          meta: {
            orchestratorRuntime: node.id,
            inputEventId: event.id || "",
            inputChannel: event.channel || "",
            targetPort: step.targetPort || "",
            runId: decision.runId,
            stepId: step.id,
          },
        });
        emitted.push({
          ...step,
          eventId: emittedEvent?.id || "",
        });
      }

      const latencyMs = Math.round(performance.now() - startedAt);
      const result = {
        ...decision,
        emitted,
        latencyMs,
        status: emitted.length ? "executed" : decision.skipped.length ? "blocked" : "idle",
      };
      if (!linkedChannels.has(doneChannel)) {
        await this.bus?.emit?.(doneChannel, result, {
          workspaceId: this.workspaceId,
          eventType: "orchestrator_done",
          sourceNodeId: node.id,
          latencyMs,
          meta: {
            orchestratorRuntime: node.id,
            inputEventId: event.id || "",
            inputChannel: event.channel || "",
            runId: decision.runId,
          },
        });
      }
      await this.log({
        node,
        message: `Orchestrator decision: ${node.label || node.id}`,
        context: {
          runId: decision.runId,
          inputChannel: event.channel || "",
          decision: result.decision,
          steps: result.steps,
          skipped: result.skipped,
          emitted,
          latencyMs,
        },
      });
      return result;
    }

    async performAutonomousExecution({ node, payload = {}, event = {}, runtime = this.runtime } = {}) {
      const config = missionConfig(node);
      const runId = event.meta?.runId || payload?.runId || `mission_${node.id}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const startedAt = performance.now();
      const mission = {
        runId,
        goal: nodeConfig(node).goal || "Reach the configured objective.",
        status: "running",
        iterations: [],
        completed: false,
        stopReason: "",
        startedAt: new Date().toISOString(),
      };
      let currentPayload = {
        ...clonePayload(payload),
        runId,
        mission: {
          runId,
          goal: mission.goal,
          iteration: 0,
          status: "running",
        },
      };

      await this.bus?.emit?.("orchestrator.mission", mission, {
        workspaceId: this.workspaceId,
        eventType: "orchestrator_mission_started",
        sourceNodeId: node.id,
        meta: {
          orchestratorRuntime: node.id,
          inputEventId: event.id || "",
          inputChannel: event.channel || "",
          runId,
          autonomousMission: true,
        },
      });

      for (let iteration = 1; iteration <= config.maxIterations; iteration += 1) {
        const iterationStarted = Date.now();
        const iterationPayload = {
          ...currentPayload,
          mission: {
            ...(currentPayload.mission || {}),
            runId,
            goal: mission.goal,
            iteration,
            maxIterations: config.maxIterations,
            stopCondition: config.stopCondition,
            status: "running",
          },
        };
        const iterationEvent = {
          ...event,
          meta: {
            ...(event.meta || {}),
            runId,
            autonomousMission: true,
            autonomousIteration: iteration,
          },
        };
        const result = await this.performSingleExecution({ node, payload: iterationPayload, event: iterationEvent, runtime });
        if (config.iterationDelayMs) await wait(config.iterationDelayMs);
        const feedback = await this.collectMissionFeedback({
          runId,
          since: iterationStarted,
          limit: config.feedbackWindow,
        });
        const completed = missionIsComplete({
          payload: iterationPayload,
          result,
          feedback,
          stopCondition: config.stopCondition,
        });
        mission.iterations.push({
          iteration,
          decision: result.decision,
          status: result.status,
          emitted: result.emitted || [],
          skipped: result.skipped || [],
          feedback,
          completed,
        });
        if (completed) {
          mission.completed = true;
          mission.status = "completed";
          mission.stopReason = "stop-condition";
          break;
        }
        if (!result.steps?.length && !result.emitted?.length) {
          mission.status = "blocked";
          mission.stopReason = result.skipped?.length ? "blocked" : "no-targets";
          break;
        }
        currentPayload = {
          ...iterationPayload,
          feedback,
          previousDecision: result,
        };
      }

      if (!mission.stopReason) {
        mission.status = mission.completed ? "completed" : "max_iterations";
        mission.stopReason = mission.completed ? "stop-condition" : "max-iterations";
      }
      mission.completedAt = new Date().toISOString();
      mission.latencyMs = Math.round(performance.now() - startedAt);

      await this.bus?.emit?.(node.outputs?.[2] || "done", mission, {
        workspaceId: this.workspaceId,
        eventType: mission.completed ? "orchestrator_mission_completed" : "orchestrator_mission_stopped",
        sourceNodeId: node.id,
        latencyMs: mission.latencyMs,
        meta: {
          orchestratorRuntime: node.id,
          inputEventId: event.id || "",
          inputChannel: event.channel || "",
          runId,
          autonomousMission: true,
          stopReason: mission.stopReason,
        },
      });
      await this.log({
        node,
        level: mission.completed ? "info" : "warning",
        message: `Autonomous mission ${mission.status}: ${node.label || node.id}`,
        context: mission,
      });
      return mission;
    }

    async performExecution({ node, payload = {}, event = {}, runtime = this.runtime } = {}) {
      if (missionConfig(node).enabled && !event.meta?.autonomousIteration) {
        return this.performAutonomousExecution({ node, payload, event, runtime });
      }
      return this.performSingleExecution({ node, payload, event, runtime });
    }

    async execute({ node, payload = {}, event = {}, runtime = this.runtime } = {}) {
      const runner = () => this.performExecution({ node, payload, event, runtime });
      if (!this.execution?.enqueue) return runner();
      return this.execution.enqueue({
        node,
        bus: this.bus,
        task: runner,
        context: {
          runtime: "orchestrator-agent",
          inputEventId: event?.id || "",
          inputChannel: event?.channel || "",
          runId: event?.meta?.runId || payload?.runId || "",
        },
      });
    }

    async handleEvent({ node, payload, event }) {
      if (
        !node?.id ||
        event?.sourceNodeId === node.id ||
        event?.meta?.orchestratorRuntime === node.id
      ) return;
      const runId = event.meta?.runId || payload?.runId || "";
      const executionKey = `${node.id}:${runId || "live"}:${event.id || event.channel || Date.now()}`;
      if (this.executionKeys.has(executionKey)) return;
      this.executionKeys.add(executionKey);
      if (this.executionKeys.size > 300) this.executionKeys = new Set([...this.executionKeys].slice(-180));
      try {
        const mapped = await this.applyIncomingMapping({ node, payload, event });
        payload = mapped.payload;
        event = mapped.event;
        await this.execute({ node, payload, event, runtime: this.runtime });
      } catch (error) {
        await this.bus?.emit?.(node.outputs?.[3] || "error", {
          error: error.message || String(error),
          nodeId: node.id,
          payload: clonePayload(payload),
        }, {
          workspaceId: this.workspaceId,
          eventType: "orchestrator_error",
          sourceNodeId: node.id,
          status: "error",
          meta: { orchestratorRuntime: node.id, inputEventId: event.id || "" },
        });
        await this.log({
          node,
          level: "error",
          message: `Orchestrator error: ${error.message || error}`,
          context: { inputChannel: event.channel, inputEventId: event.id, error: error.message || String(error) },
        });
      }
    }
  }

  const get = (workspaceId = "workspace_global") => {
    const key = workspaceId || "workspace_global";
    if (!instances.has(key)) instances.set(key, new OrchestratorAgentRuntime({ workspaceId: key }));
    return instances.get(key);
  };

  return {
    get,
    OrchestratorAgentRuntime,
    isRunnableOrchestrator,
  };
})();
