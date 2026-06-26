window.TrackerLensAiAgentRuntime = (() => {
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

  const nodeConfig = (node = {}) =>
    node.metadata?.config && typeof node.metadata.config === "object" && !Array.isArray(node.metadata.config)
      ? node.metadata.config
      : {};

  const agentExecutionMode = (node = {}) =>
    String(nodeConfig(node).executionMode || node.metadata?.runtimeMetadata?.executionMode || "on_event").toLowerCase();

  const isEventDrivenExecutionMode = (mode = "") =>
    ["on_event", "continuous"].includes(String(mode || "").toLowerCase());

  const splitList = (value = "") =>
    Array.isArray(value) ? value.filter(Boolean).map(String) : String(value || "").split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);

  const configFromAgentRecord = (agent = {}) => ({
    runtimeAgentId: agent.id || "",
    description: agent.description || "",
    icon: agent.icon || "psychology",
    color: agent.color || "gold",
    category: agent.category || "Runtime Intelligence",
    tags: Array.isArray(agent.tags) ? agent.tags.join(", ") : String(agent.tags || ""),
    version: agent.version || "1.0.0",
    templateId: agent.templateId || "",
    agentType: agent.runtime?.agentType || "analyzer",
    executionMode: agent.runtime?.executionMode || "on_event",
    priority: agent.runtime?.priority ?? 5,
    retryPolicy: agent.runtime?.retryPolicy || "exponential",
    timeoutMs: agent.runtime?.timeoutMs ?? 120000,
    cooldownMs: agent.runtime?.cooldownMs ?? 0,
    queueLimit: agent.runtime?.queueLimit ?? 25,
    parallelJobs: agent.runtime?.parallelJobs ?? 1,
    maxConcurrentTasks: agent.runtime?.parallelJobs ?? agent.runtime?.maxConcurrentTasks ?? 1,
    dropPolicy: agent.runtime?.dropPolicy || "queue",
    providerProfile: agent.provider?.profileId || "",
    provider: agent.provider?.providerType || agent.provider?.provider || "ollama",
    providerType: agent.provider?.providerType || agent.provider?.provider || "ollama",
    model: agent.provider?.model || "local-model",
    temperature: agent.provider?.temperature ?? 0.2,
    maxTokens: agent.provider?.maxTokens ?? 800,
    topP: agent.provider?.topP ?? 0.9,
    streaming: String(Boolean(agent.provider?.streaming)),
    responseFormat: agent.provider?.responseFormat || "json",
    inputChannels: splitList(agent.channels?.inputs).join(", "),
    payloadMapping: agent.channels?.payloadMapping || "",
    requiredInputs: splitList(agent.channels?.requiredInputs).join(", "),
    contextSources: splitList(agent.channels?.contextSources).join(", "),
    eventTriggers: splitList(agent.channels?.eventTriggers).join(", "),
    inputDataMode: agent.channels?.inputDataMode || "latest",
    inputHistoryLimit: agent.channels?.inputHistoryLimit ?? 5,
    output: agent.channels?.outputChannel || agent.channels?.outputs?.[0] || `ai.${agent.runtime?.agentType || "agent"}.output`,
    outputFormat: agent.channels?.outputFormat || "json",
    emitStrategy: agent.channels?.emitStrategy || "on_success",
    eventPriority: agent.channels?.eventPriority || "normal",
    systemPrompt: agent.promptConfig?.systemPrompt || "",
    prompt: agent.promptConfig?.template || "",
    promptTemplate: agent.promptConfig?.template || "",
    dynamicVariables: splitList(agent.promptConfig?.variables).join(", "),
    promptStrategy: agent.promptConfig?.strategy || "contextual",
    outputInstructions: agent.promptConfig?.outputInstructions || "",
    memoryMode: agent.memory?.mode || "workspace",
    memorySize: agent.memory?.size ?? 20,
    memoryExpiration: agent.memory?.expiration || "24h",
    memoryPersistence: agent.memory?.persistence || "workspace",
    memoryCompression: agent.memory?.compression || "summary",
    contextWindow: agent.memory?.contextWindow ?? 6,
    ...(agent.permissions || {}),
    ...(agent.debug || {}),
    ...(agent.metrics || {}),
  });

  const resolveNodeConfig = async (node = {}) => {
    const config = nodeConfig(node);
    if (!node.metadata?.aiAgentAlias) return config;
    const sourceId = node.metadata?.aliasSourceAgentId || config.aliasSourceAgentId || "";
    if (!sourceId) return config;
    try {
      const data = await window.TrackerLensAiRuntimeStore?.list?.();
      const agent = (data?.agents || []).find((item) => item.id === sourceId);
      return agent ? { ...config, ...configFromAgentRecord(agent), aliasSourceAgentId: sourceId } : config;
    } catch (error) {
      console.warn("AI alias config non risolto", error);
      return config;
    }
  };

  const nodeStatus = (node = {}) =>
    String(node.runtime?.status || node.metadata?.runtimeStatus || node.status || "idle").toLowerCase();

  const isRunnableAgent = (node = {}) =>
    (node.type === "aiAgent" || node.metadata?.category === "ai-agents") &&
    nodeSubtype(node) !== "orchestrator" &&
    !node.metadata?.library &&
    !node.metadata?.draft &&
    isEventDrivenExecutionMode(agentExecutionMode(node)) &&
    !["paused", "disabled", "error", "disconnected"].includes(nodeStatus(node));

  const agentInputs = (node = {}, dependencies = []) => {
    const incomingDependencies = (dependencies || []).filter((dependency) => dependency.targetNodeId === node.id);
    const incoming = incomingDependencies
      .map((dependency) => dependency.channel || dependency.metadata?.targetPort || dependency.metadata?.sourcePort)
      .filter(Boolean);
    if (incoming.length) return unique(incoming);
    return unique([...(node.inputs || []), ...(node.channels || [])]);
  };

  const agentAcceptsDependencyEvent = ({ node = {}, event = {}, dependencies = [] } = {}) => {
    const incomingDependencies = (dependencies || []).filter((dependency) => dependency.targetNodeId === node.id);
    if (!incomingDependencies.length) return true;
    if (event?.targetNodeId && event.targetNodeId === node.id) return true;
    const eventChannel = String(event?.channel || "");
    const sourceNodeId = String(event?.sourceNodeId || "");
    return incomingDependencies.some((dependency) =>
      String(dependency.sourceNodeId || "") === sourceNodeId &&
      String(dependency.channel || dependency.metadata?.targetPort || dependency.metadata?.sourcePort || "") === eventChannel
    );
  };

  const agentOutput = (node = {}, config = {}) =>
    config.output || node.outputs?.[0] || node.channels?.[0] || `${nodeSubtype(node) || "ai"}.response`;

  const inputDataMode = (config = {}) =>
    String(config.inputDataMode || config.inputRequestMode || "latest").toLowerCase();

  const compactJson = (value, max = 2600) => {
    let text = "";
    try {
      text = JSON.stringify(value ?? {}, null, 2);
    } catch {
      text = String(value ?? "");
    }
    return text.length > max ? `${text.slice(0, max)}\n...` : text;
  };

  const isRagContextEvent = ({ payload = {}, event = {} } = {}) =>
    event?.channel === "knowledge.rag.context" ||
    (event?.eventType === "knowledge_emit" && event?.meta?.subtype === "rag-search" && payload?.context !== undefined) ||
    (payload?.queryId && Array.isArray(payload?.results) && payload?.context !== undefined);

  const isGraphContextEvent = ({ payload = {}, event = {} } = {}) =>
    event?.channel === "knowledge.graph.context" ||
    (event?.eventType === "knowledge_emit" && event?.meta?.subtype === "graph-query" && payload?.context !== undefined) ||
    (payload?.queryId && Array.isArray(payload?.entities) && Array.isArray(payload?.relations) && payload?.context !== undefined);

  const normalizeRagContext = ({ payload = {}, event = {} } = {}) => {
    if (!isRagContextEvent({ payload, event })) return null;
    const results = Array.isArray(payload.results) ? payload.results : [];
    const sources = results.map((result, index) => ({
      index: index + 1,
      chunkId: result.chunkId || "",
      documentId: result.documentId || "",
      score: Number.isFinite(Number(result.score)) ? Number(result.score) : null,
      text: String(result.text || "").slice(0, 1200),
      metadata: result.metadata || {},
    }));
    return {
      query: String(payload.query || payload.question || "").trim(),
      queryId: payload.queryId || payload.id || "",
      context: String(payload.context || "").trim(),
      resultCount: Number(payload.resultCount ?? results.length) || 0,
      sources,
      scope: payload.scope || {},
      inputChannel: event?.channel || "",
      inputEventId: event?.id || "",
    };
  };

  const renderRagPromptBlock = (ragContext = null) => {
    if (!ragContext) return "";
    const sourceLines = (ragContext.sources || []).map((source) => {
      const score = Number.isFinite(source.score) ? ` score=${source.score.toFixed(3)}` : "";
      const document = source.documentId ? ` document=${source.documentId}` : "";
      return `[${source.index}]${score}${document}\n${source.text}`;
    }).join("\n\n");
    return [
      "Knowledge RAG context:",
      ragContext.query ? `Query: ${ragContext.query}` : "",
      ragContext.context ? `Context:\n${ragContext.context}` : "",
      sourceLines ? `Sources:\n${sourceLines}` : "",
      "Use the Knowledge RAG context as the primary factual source. If the context is insufficient, say what is missing instead of inventing facts.",
    ].filter(Boolean).join("\n\n");
  };

  const normalizeGraphContext = ({ payload = {}, event = {} } = {}) => {
    if (!isGraphContextEvent({ payload, event })) return null;
    const entities = Array.isArray(payload.entities) ? payload.entities : [];
    const relations = Array.isArray(payload.relations) ? payload.relations : [];
    const evidence = Array.isArray(payload.evidence) ? payload.evidence : [];
    const compactText = (value = "", max = 3600) => {
      const text = String(value || "").trim();
      return text.length > max ? `${text.slice(0, max)}\n...` : text;
    };
    return {
      query: String(payload.query || payload.question || "").trim(),
      queryId: payload.queryId || payload.id || "",
      context: compactText(payload.context, 4200),
      resultCount: Number(payload.resultCount ?? entities.length) || 0,
      relationCount: Number(payload.relationCount ?? relations.length) || 0,
      entities: entities.slice(0, 16).map((entity) => ({
        id: entity.id || "",
        label: entity.label || "",
        entityType: entity.entityType || "",
        confidence: Number.isFinite(Number(entity.confidence)) ? Number(entity.confidence) : null,
        connections: Number.isFinite(Number(entity.connections)) ? Number(entity.connections) : null,
        score: Number.isFinite(Number(entity.score)) ? Number(entity.score) : null,
        documentId: entity.documentId || "",
        chunkId: entity.chunkId || "",
      })),
      relations: relations.slice(0, 32).map((relation) => ({
        id: relation.id || "",
        sourceEntityId: relation.sourceEntityId || "",
        targetEntityId: relation.targetEntityId || "",
        sourceLabel: relation.sourceLabel || "",
        targetLabel: relation.targetLabel || "",
        relationType: relation.relationType || "",
        confidence: Number.isFinite(Number(relation.confidence)) ? Number(relation.confidence) : null,
        score: Number.isFinite(Number(relation.score)) ? Number(relation.score) : null,
        direct: relation.direct === true,
        documentId: relation.documentId || "",
        chunkId: relation.chunkId || "",
      })),
      evidence: evidence.slice(0, 4).map((item, index) => ({
        index: item.index || index + 1,
        chunkId: item.chunkId || "",
        documentId: item.documentId || "",
        text: compactText(item.text, 520),
        metadata: item.metadata || {},
      })),
      scope: payload.scope || {},
      inputChannel: event?.channel || "",
      inputEventId: event?.id || "",
    };
  };

  const renderGraphPromptBlock = (graphContext = null) => {
    if (!graphContext) return "";
    const evidenceLines = (graphContext.evidence || []).map((source, index) =>
      `[${index + 1}] document=${source.documentId || ""} chunk=${source.chunkId || ""}\n${String(source.text || "").slice(0, 520)}`
    ).join("\n\n");
    return [
      "Knowledge Graph context:",
      graphContext.query ? `Query: ${graphContext.query}` : "",
      graphContext.context ? `Graph neighborhood:\n${graphContext.context}` : "",
      evidenceLines ? `Evidence:\n${evidenceLines}` : "",
      "Use the Knowledge Graph context as structured memory. Prefer explicit relations and evidence over generic assumptions.",
    ].filter(Boolean).join("\n\n");
  };

  const compactTextValue = (value = "", max = 900) => {
    const text = String(value || "").trim();
    if (!text) return "";
    return text.length > max ? `${text.slice(0, max)}\n...` : text;
  };

  const resultAnswerText = (result = {}) => {
    if (typeof result.text === "string" && result.text.trim()) return result.text.trim();
    if (typeof result.response?.text === "string" && result.response.text.trim()) return result.response.text.trim();
    if (typeof result.response === "string" && result.response.trim()) return result.response.trim();
    if (result.response !== undefined && result.response !== null) return compactJson(result.response, 1200);
    if (typeof result.summary === "string" && result.summary.trim()) return result.summary.trim();
    return "";
  };

  const cleanRelation = (relation = {}) => ({
    source: relation.sourceLabel || relation.source || "",
    type: relation.relationType || relation.type || "",
    target: relation.targetLabel || relation.target || "",
    confidence: Number.isFinite(Number(relation.confidence)) ? Number(relation.confidence) : null,
    score: Number.isFinite(Number(relation.score)) ? Number(relation.score) : null,
    direct: relation.direct === true,
    documentId: relation.documentId || "",
    chunkId: relation.chunkId || "",
  });

  const cleanEntity = (entity = {}) => ({
    label: entity.label || "",
    type: entity.entityType || entity.type || "",
    confidence: Number.isFinite(Number(entity.confidence)) ? Number(entity.confidence) : null,
    connections: Number.isFinite(Number(entity.connections)) ? Number(entity.connections) : null,
    score: Number.isFinite(Number(entity.score)) ? Number(entity.score) : null,
    documentId: entity.documentId || "",
    chunkId: entity.chunkId || "",
  });

  const cleanEvidence = (item = {}, index = 0) => ({
    index: item.index || index + 1,
    documentId: item.documentId || "",
    chunkId: item.chunkId || "",
    text: compactTextValue(item.text, 520),
  });

  const buildCleanAiPayload = ({ result = {}, config = {} } = {}) => {
    const mode = String(config.emitMode || config.outputMode || "").toLowerCase();
    const graphContext = result.graphContext || null;
    const ragContext = result.ragContext || null;
    if (!graphContext && !ragContext && !["clean", "answer"].includes(mode)) return result;

    const answer = resultAnswerText(result);
    const base = {
      provider: result.provider || "",
      model: result.model || "",
      role: result.role || "",
      answer,
      response: { text: answer },
      text: answer,
      usage: result.usage || {},
      cost: result.cost || {},
      latencyMs: result.latencyMs ?? null,
      inputChannel: result.inputChannel || "",
    };

    if (graphContext) {
      return {
        ...base,
        contextType: "knowledge-graph",
        question: graphContext.query || "",
        graph: {
          queryId: graphContext.queryId || "",
          resultCount: graphContext.resultCount ?? 0,
          relationCount: graphContext.relationCount ?? 0,
          scope: graphContext.scope || {},
          entities: (graphContext.entities || []).slice(0, 10).map(cleanEntity),
          relations: (graphContext.relations || []).slice(0, 16).map(cleanRelation),
          evidence: (graphContext.evidence || []).slice(0, 4).map(cleanEvidence),
        },
      };
    }

    if (ragContext) {
      return {
        ...base,
        contextType: "rag",
        question: ragContext.query || "",
        rag: {
          queryId: ragContext.queryId || "",
          resultCount: ragContext.resultCount ?? 0,
          scope: ragContext.scope || {},
          sources: (ragContext.sources || []).slice(0, 6).map((source, index) => ({
            index: source.index || index + 1,
            score: Number.isFinite(Number(source.score)) ? Number(source.score) : null,
            documentId: source.documentId || "",
            chunkId: source.chunkId || "",
            text: compactTextValue(source.text, 520),
          })),
        },
      };
    }

    return base;
  };

  const renderPromptTemplate = (template = "", context = {}) =>
    String(template || "").replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, token) => {
      const key = String(token || "").trim();
      const value = key.split(".").reduce((current, part) => {
        if (current === undefined || current === null) return undefined;
        return current[part];
      }, context);
      if (value === undefined || value === null) return "";
      return typeof value === "string" ? value : compactJson(value, 3600);
    });

  const buildPrompt = ({ node, payload, event, memory = "", config = nodeConfig(node) }) => {
    const subtype = nodeSubtype(node);
    const ragContext = config.ragContext || normalizeRagContext({ payload, event });
    const graphContext = config.graphContext || normalizeGraphContext({ payload, event });
    const ragPromptBlock = renderRagPromptBlock(ragContext);
    const hasCustomPromptTemplate = Boolean(String(config.promptTemplate || config.prompt || config.instruction || "").trim());
    const graphPromptBlock = hasCustomPromptTemplate ? "" : renderGraphPromptBlock(graphContext);
    const systemPrompt = String(config.systemPrompt || "").trim() ||
      `You are a Trackers Lens ${subtype || "AI"} runtime node.`;
    const template = String(config.promptTemplate || config.prompt || config.instruction || "").trim() ||
      (ragContext
        ? "Answer the Knowledge query using the provided RAG context.\n\nQuery: {{ragContext.query}}\n\nContext:\n{{ragContext.context}}\n\nPayload: {{payload}}\nMemory: {{memory}}"
        : graphContext
          ? "Answer the Knowledge Graph query using the provided graph context.\n\nQuery: {{graphContext.query}}\n\nGraph context:\n{{graphContext.context}}\n\nPayload: {{payload}}\nMemory: {{memory}}"
        : "Analyze this runtime event:\n\nChannel: {{channel}}\nPayload: {{payload}}\nMemory: {{memory}}");
    const outputInstructions = String(config.outputInstructions || "").trim() ||
      "Return structured runtime output ready for channel emission.";
    const context = {
      channel: event.channel || "default",
      timestamp: new Date().toISOString(),
      workspace: node.workspaceId || "",
      memory,
      event,
      payload,
      node: {
        id: node.id,
        label: node.label || node.id,
        role: config.agentType || subtype || "agent",
      },
      inputDataContext: config.inputDataContext || null,
      ragContext,
      graphContext,
    };
    return [
      systemPrompt,
      `\nNode: ${node.label || node.id}`,
      `Role: ${config.agentType || subtype || "agent"}`,
      config.inputDataContext ? `Input data context:\n${compactJson(config.inputDataContext)}` : "",
      ragPromptBlock ? `\n${ragPromptBlock}` : "",
      graphPromptBlock ? `\n${graphPromptBlock}` : "",
      `\nTask:\n${renderPromptTemplate(template, context)}`,
      `\nOutput instructions:\n${outputInstructions}`,
    ].filter(Boolean).join("\n");
  };

  const collectInputDataContext = async ({ node, event, workspaceId, config = {}, runtime = {} } = {}) => {
    const mode = inputDataMode(config);
    if (mode === "off" || mode === "none") return null;
    const historyLimit = Math.max(1, Math.min(50, Number(config.inputHistoryLimit || 5)));
    const dependencyInputs = (runtime.dependencies || [])
      .filter((dependency) => dependency.targetNodeId === node.id)
      .map((dependency) => dependency.channel || dependency.metadata?.targetPort)
      .filter(Boolean);
    const inputChannels = unique([...(node.inputs || []), ...(node.channels || []), ...dependencyInputs])
      .filter((channel) => channel && channel !== event?.channel);
    if (!inputChannels.length) return null;
    const events = await window.TrackerLensEventLogStore?.listEvents?.().catch(() => []);
    const byChannel = {};
    const workspaceAliases = new Set([workspaceId || "workspace_global", workspaceId === "workspace_global" ? "global" : "workspace_global"]);
    inputChannels.forEach((channel) => {
      const channelEvents = (events || [])
        .filter((item) => workspaceAliases.has(item.workspaceId || "global"))
        .filter((item) => item.channel === channel)
        .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
      byChannel[channel] = {
        required: String(config.requiredInputChannels || "").split(/[\n,]+/).map((item) => item.trim()).includes(channel),
        latest: channelEvents[0]?.payload ?? null,
        latestAt: channelEvents[0]?.createdAt || "",
        history: mode === "history" || mode === "latest_history"
          ? channelEvents.slice(0, historyLimit).map((item) => ({
            eventId: item.id,
            eventType: item.eventType,
            createdAt: item.createdAt,
            payload: item.payload,
          }))
          : [],
      };
    });
    return byChannel;
  };

  const fallbackResponse = ({ node, payload, event, reason = "", ragContext = null, graphContext = null }) => {
    const subtype = nodeSubtype(node);
    const keys = payload && typeof payload === "object" && !Array.isArray(payload) ? Object.keys(payload).slice(0, 12) : [];
    return {
      provider: "fallback",
      model: "local-rule",
      role: subtype || "agent",
      summary: keys.length ? `Payload ricevuto con campi: ${keys.join(", ")}` : "Payload ricevuto dal runtime graph.",
      decision: subtype === "decision" ? "review" : "ok",
      confidence: reason ? 0.42 : 0.58,
      inputChannel: event.channel || "",
      reason,
      ragContext,
      graphContext,
      payloadPreview: keys.length ? Object.fromEntries(keys.slice(0, 6).map((key) => [key, payload[key]])) : clonePayload(payload),
    };
  };

  const isLocalAiEndpoint = (endpoint = "") => {
    try {
      const url = new URL(endpoint);
      return ["127.0.0.1", "localhost", "::1"].includes(url.hostname) &&
        ["1234", "11434", ""].includes(url.port) &&
        /\/(v1\/chat\/completions|v1\/responses|api\/generate)$/.test(url.pathname);
    } catch {
      return false;
    }
  };

  const postAiJson = async ({ url = "", body = {}, headers = {} } = {}) => {
    if (isLocalAiEndpoint(url) && typeof window !== "undefined" && /^https?:/i.test(window.location?.protocol || "")) {
      const proxyResponse = await fetch("api/ai-chat-proxy.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: url, body }),
      }).catch(() => null);
      const contentType = proxyResponse?.headers?.get?.("content-type") || "";
      if (proxyResponse && proxyResponse.status !== 404 && contentType.includes("application/json")) {
        return proxyResponse;
      }
    }
    return fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  };

  const pickProvider = async (config = {}) => {
    const data = await window.TrackerLensAiRuntimeStore?.list?.().catch(() => null);
    const providers = data?.providers || window.TrackerLensAiRuntimeStore?.localProviderDefaults?.() || [];
    const requestedProfile = String(config.providerProfile || config.profileId || "").trim();
    const requestedType = String(config.providerType || config.provider || "").toLowerCase();
    const requested = String(config.provider || config.providerType || "").toLowerCase();
    return providers.find((provider) => requestedProfile && provider.id === requestedProfile)
      || providers.find((provider) =>
        requestedType &&
        [provider.id, provider.name, provider.provider, provider.providerType].some((value) => String(value || "").toLowerCase() === requestedType))
      || providers.find((provider) =>
        requested &&
        [provider.id, provider.name, provider.provider, provider.providerType].some((value) => String(value || "").toLowerCase().includes(requested)))
      || providers.find((provider) => provider.local && provider.status === "online")
      || providers.find((provider) => provider.local)
      || providers[0]
      || null;
  };

  const callOllama = async ({ provider, model, prompt }) => {
    const endpoint = String(provider.endpoint || "http://127.0.0.1:11434").replace(/\/+$/g, "");
    const response = await postAiJson({
      url: `${endpoint}/api/generate`,
      headers: { "Content-Type": "application/json" },
      body: { model, prompt, stream: false },
    });
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
    const data = await response.json();
    return {
      text: data.response || "",
      usage: {
        promptTokens: data.prompt_eval_count || 0,
        completionTokens: data.eval_count || 0,
        totalTokens: Number(data.prompt_eval_count || 0) + Number(data.eval_count || 0),
      },
      raw: data,
    };
  };

  const withLmStudioApiBase = (endpoint = "") => {
    const clean = String(endpoint || "http://127.0.0.1:1234").replace(/\/+$/g, "");
    return clean.endsWith("/v1") ? clean : `${clean}/v1`;
  };

  const resolveLmStudioModel = async ({ provider = {}, model = "" } = {}) => {
    const requested = String(model || provider.model || "").trim();
    const endpoint = withLmStudioApiBase(provider.endpoint);
    try {
      const response = await fetch(`${endpoint}/models`);
      if (!response.ok) return requested || "local-model";
      const data = await response.json();
      const models = Array.isArray(data?.data) ? data.data : [];
      const exact = models.find((item) => String(item.id || "") === requested);
      if (exact) return exact.id;
      const fuzzy = requested && requested !== "local-model"
        ? models.find((item) => String(item.id || "").toLowerCase().includes(requested.toLowerCase()))
        : null;
      if (fuzzy) return fuzzy.id;
      const chatModel = models.find((item) => !/embed/i.test(String(item.id || ""))) || models[0];
      return chatModel?.id || requested || "local-model";
    } catch {
      return requested || "local-model";
    }
  };

  const callLmStudio = async ({ provider, model, prompt }) => {
    const endpoint = withLmStudioApiBase(provider.endpoint);
    const resolvedModel = await resolveLmStudioModel({ provider, model });
    const response = await postAiJson({
      url: `${endpoint}/chat/completions`,
      headers: { "Content-Type": "application/json" },
      body: {
        model: resolvedModel,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
      },
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`LM Studio HTTP ${response.status}${errorText ? `: ${errorText.slice(0, 180)}` : ""}`);
    }
    const data = await response.json();
    return {
      text: data.choices?.[0]?.message?.content || "",
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
      },
      model: resolvedModel,
      raw: data,
    };
  };

  const stripJsonFence = (text = "") => {
    const clean = String(text || "").trim();
    const fenced = clean.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return fenced ? fenced[1].trim() : clean;
  };

  const firstJsonObject = (text = "") => {
    const clean = String(text || "");
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    return start >= 0 && end > start ? clean.slice(start, end + 1).trim() : "";
  };

  const parseAiText = (text = "") => {
    const clean = String(text || "").trim();
    if (!clean) return { text: "" };
    const candidates = unique([
      clean,
      stripJsonFence(clean),
      firstJsonObject(stripJsonFence(clean)),
      firstJsonObject(clean),
    ]);
    for (const candidate of candidates) {
      if (!candidate) continue;
      try {
        return JSON.parse(candidate);
      } catch {
        // Continue with the next normalized candidate.
      }
    }
    return { text: clean };
  };

  const estimateCost = ({ usage = {}, provider = {}, config = {} } = {}) => {
    const inputRate = Number(config.inputCostPer1k || provider.inputCostPer1k || provider.promptCostPer1k || 0);
    const outputRate = Number(config.outputCostPer1k || provider.outputCostPer1k || provider.completionCostPer1k || 0);
    const promptTokens = Number(usage.promptTokens || usage.prompt_tokens || 0);
    const completionTokens = Number(usage.completionTokens || usage.completion_tokens || 0);
    const total = ((promptTokens / 1000) * inputRate) + ((completionTokens / 1000) * outputRate);
    return {
      currency: config.costCurrency || provider.costCurrency || "USD",
      inputCostPer1k: inputRate,
      outputCostPer1k: outputRate,
      estimated: Math.round(total * 1000000) / 1000000,
    };
  };

  class AiAgentRuntime {
    constructor({ workspaceId = "workspace_global" } = {}) {
      this.workspaceId = workspaceId;
      this.unsubscribers = [];
      this.signature = "";
      this.bus = null;
      this.executionKeys = new Set();
      this.runtime = { nodes: [], dependencies: [] };
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
            runtime: "ai-agent",
            subtype: nodeSubtype(node),
            ...context,
          },
        });
        await window.TrackerLensAiRuntimeStore?.upsertLog?.({
          id: `ai_log_${node?.id || "agent"}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          workspaceId: this.workspaceId,
          agentId: node?.id || "",
          source: node?.label || node?.id || "AI Agent",
          message,
          status: level,
          context,
          createdAt: new Date().toISOString(),
        });
      } catch (error) {
        console.warn("AI agent runtime log non persistito", error);
      }
    }

    buildSignature(runtime = {}) {
      const agents = (runtime.nodes || [])
        .filter(isRunnableAgent)
        .map((node) => ({
          id: node.id,
          status: nodeStatus(node),
          subtype: nodeSubtype(node),
          inputs: agentInputs(node, runtime.dependencies || []),
          outputs: node.outputs || [],
          config: nodeConfig(node),
          incomingMappings: (runtime.dependencies || [])
            .filter((dependency) => dependency.targetNodeId === node.id)
            .map((dependency) => ({ id: dependency.id, channel: dependency.channel, metadata: dependency.metadata || {} })),
        }));
      return JSON.stringify(agents);
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

      (runtime.nodes || []).filter(isRunnableAgent).forEach((node) => {
        agentInputs(node, runtime.dependencies || []).forEach((channel) => {
          const unsubscribe = this.bus.on(channel, (payload, event) => {
            this.handleEvent({ node, payload, event });
          }, {
            id: `ai_agent_${node.id}_${channel}`,
            targetNodeId: node.id,
            metadata: { runtime: "ai-agent", subtype: nodeSubtype(node) },
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

    async performExecution({ node, payload, event }) {
      const config = await resolveNodeConfig(node);
      const inputDataContext = await collectInputDataContext({ node, event, workspaceId: this.workspaceId, config, runtime: this.runtime });
      const ragContext = normalizeRagContext({ payload, event });
      const graphContext = normalizeGraphContext({ payload, event });
      const promptConfig = {
        ...config,
        ...(inputDataContext ? { inputDataContext } : {}),
        ...(ragContext ? { ragContext } : {}),
        ...(graphContext ? { graphContext } : {}),
      };
      const provider = await pickProvider(config);
      const model = String(config.model || provider?.model || "local-model");
      const memoryDisabled = ["off", "none", "disabled"].includes(String(config.memoryMode || "").toLowerCase());
      const memory = memoryDisabled ? "" : await window.TrackerLensAiRuntimeStore?.buildMemoryContext?.({
        workspaceId: this.workspaceId,
        agentId: node.id,
        query: event.channel || nodeSubtype(node),
        limit: 6,
      }).catch(() => "");
      const prompt = buildPrompt({ node, payload, event, memory, config: promptConfig });
      const jobId = `ai_job_${node.id}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const runId = event.meta?.runId || payload?.runId || "";
      await window.TrackerLensAiRuntimeStore?.upsertJob?.({
        id: jobId,
        workspaceId: this.workspaceId,
        runId,
        agentId: node.id,
        agent: node.label || node.id,
        task: event.channel || "runtime event",
        prompt,
        memoryContext: memory,
        inputDataContext,
        ragContext,
        graphContext,
        status: "running",
        provider: provider?.name || provider?.provider || "fallback",
        model,
        createdAt: new Date().toISOString(),
      });

      const startedAt = performance.now();
      try {
        let ai = null;
        const providerName = String(provider?.provider || provider?.name || "").toLowerCase();
        if (providerName.includes("ollama")) {
          ai = await callOllama({ provider, model, prompt });
        } else if (providerName.includes("lm") || providerName.includes("studio")) {
          ai = await callLmStudio({ provider, model, prompt });
        } else {
          throw new Error("Provider AI non configurato per chat runtime");
        }
        const latencyMs = Math.round(performance.now() - startedAt);
        const result = {
          provider: provider?.name || provider?.provider || "local",
          model: ai.model || model,
          role: nodeSubtype(node),
          response: parseAiText(ai.text),
          text: ai.text,
          usage: ai.usage || {},
          cost: estimateCost({ usage: ai.usage || {}, provider, config }),
          latencyMs,
          inputChannel: event.channel || "",
          prompt,
          memoryContext: memory,
          inputDataContext,
          ragContext,
          graphContext,
        };
        await window.TrackerLensAiRuntimeStore?.upsertJob?.({
          id: jobId,
          workspaceId: this.workspaceId,
          runId,
          agentId: node.id,
          agent: node.label || node.id,
          task: event.channel || "runtime event",
          status: "completed",
          provider: result.provider,
          model,
          durationMs: latencyMs,
          tokens: result.usage.totalTokens || 0,
          cost: result.cost,
          prompt,
          memoryContext: memory,
          inputDataContext,
          ragContext,
          graphContext,
          result,
          updatedAt: new Date().toISOString(),
        });
        return result;
      } catch (error) {
        const latencyMs = Math.round(performance.now() - startedAt);
        const result = fallbackResponse({ node, payload, event, reason: error?.message || String(error), ragContext, graphContext });
        await window.TrackerLensAiRuntimeStore?.upsertJob?.({
          id: jobId,
          workspaceId: this.workspaceId,
          runId,
          agentId: node.id,
          agent: node.label || node.id,
          task: event.channel || "runtime event",
          status: "fallback",
          provider: result.provider,
          model: result.model,
          durationMs: latencyMs,
          tokens: 0,
          cost: estimateCost({ usage: {}, provider, config }),
          prompt,
          memoryContext: memory,
          inputDataContext,
          ragContext,
          graphContext,
          result,
          error: error?.message || String(error),
          updatedAt: new Date().toISOString(),
        });
        return result;
      }
    }

    async execute({ node, payload, event }) {
      const runner = () => this.performExecution({ node, payload, event });
      if (!this.execution?.enqueue) return runner();
      return this.execution.enqueue({
        node,
        bus: this.bus,
        task: runner,
        context: {
          runtime: "ai-agent",
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
        event?.meta?.aiAgentRuntime === node.id ||
        event?.meta?.flowMapDirectAiExecution
      ) return;
      if (!agentAcceptsDependencyEvent({ node, event, dependencies: this.runtime?.dependencies || [] })) {
        await this.log({
          node,
          level: "debug",
          message: `AI agent skipped unlinked ${event?.channel || "event"}: ${node.label || node.id}`,
          context: {
            inputChannel: event?.channel || "",
            sourceNodeId: event?.sourceNodeId || "",
            inputEventId: event?.id || "",
          },
        });
        return;
      }
      const runId = event.meta?.runId || payload?.runId || "";
      const executionKey = `${node.id}:${runId || "live"}:${event.id || event.channel || Date.now()}`;
      if (this.executionKeys.has(executionKey)) return;
      this.executionKeys.add(executionKey);
      if (this.executionKeys.size > 300) this.executionKeys = new Set([...this.executionKeys].slice(-180));
      const startedAt = performance.now();
      try {
        const mapped = await this.applyIncomingMapping({ node, payload, event });
        payload = mapped.payload;
        event = mapped.event;
        const result = await this.execute({ node, payload, event });
        const latencyMs = Math.round(performance.now() - startedAt);
        const config = await resolveNodeConfig(node);
        const channel = agentOutput(node, config);
        const emitPayload = buildCleanAiPayload({ result, config });
        await this.bus.emit(channel, emitPayload, {
          workspaceId: this.workspaceId,
          eventType: "ai_agent_response",
          sourceNodeId: node.id,
          latencyMs,
          meta: {
            aiAgentRuntime: node.id,
            inputEventId: event.id || "",
            inputChannel: event.channel || "",
            runId,
            provider: result.provider || "",
            model: result.model || "",
            ragQueryId: result.ragContext?.queryId || "",
            ragResultCount: result.ragContext?.resultCount ?? null,
            graphQueryId: result.graphContext?.queryId || "",
            graphResultCount: result.graphContext?.resultCount ?? null,
            graphRelationCount: result.graphContext?.relationCount ?? null,
          },
        });
        await this.log({
          node,
          message: `AI agent emitted ${channel}: ${node.label || node.id}`,
          context: { inputChannel: event.channel, outputChannel: channel, inputEventId: event.id, runId, result: emitPayload, latencyMs },
        });
        if (nodeSubtype(node) === "memory") {
          await window.TrackerLensAiRuntimeStore?.remember?.({
            scope: "short",
            workspaceId: this.workspaceId,
            agentId: node.id,
            kind: "runtime-response",
            name: node.label || node.id,
            text: typeof result.text === "string" ? result.text : JSON.stringify(result.response || result),
          });
        }
      } catch (error) {
        await this.bus?.emit?.("ai.error", {
          error: error.message || String(error),
          nodeId: node.id,
          payload,
        }, {
          workspaceId: this.workspaceId,
          eventType: "ai_agent_error",
          sourceNodeId: node.id,
          status: "error",
          meta: { aiAgentRuntime: node.id, inputEventId: event.id || "" },
        });
        await this.log({
          node,
          level: "error",
          message: `AI agent error: ${error.message || error}`,
          context: { inputChannel: event.channel, inputEventId: event.id, error: error.message || String(error) },
        });
      }
    }
  }

  const get = (workspaceId = "workspace_global") => {
    const key = workspaceId || "workspace_global";
    if (!instances.has(key)) instances.set(key, new AiAgentRuntime({ workspaceId: key }));
    return instances.get(key);
  };

  return {
    get,
    AiAgentRuntime,
  };
})();
