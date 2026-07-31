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

  const isPlainObject = (value) =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value);

  const cloneValue = (value) => {
    if (value === undefined) return undefined;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  };

  const mergeAgentAliasOverrides = (source = {}, overrides = {}) => {
    const merge = (base, local) => {
      if (local === undefined) return cloneValue(base);
      if (isPlainObject(base) && isPlainObject(local)) {
        const result = { ...cloneValue(base) };
        Object.keys(local).forEach((key) => {
          result[key] = merge(base[key], local[key]);
        });
        return result;
      }
      return cloneValue(local);
    };
    return merge(source || {}, overrides || {});
  };

  const agentAliasOverrides = (node = {}, config = {}) =>
    isPlainObject(node.metadata?.aliasOverrides)
      ? node.metadata.aliasOverrides
      : isPlainObject(config.aliasOverrides)
        ? config.aliasOverrides
        : {};

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
    triggerPolicy: agent.runtime?.triggerPolicy || "connected_event",
    providerProfile: agent.provider?.profileId || "",
    provider: agent.provider?.providerType || agent.provider?.provider || "ollama",
    providerType: agent.provider?.providerType || agent.provider?.provider || "ollama",
    model: agent.provider?.model || "local-model",
    temperature: agent.provider?.temperature ?? 0.2,
    maxTokens: agent.provider?.maxTokens ?? 800,
    maxContinuationCalls: agent.provider?.maxContinuationCalls ?? 10,
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
    readMemory: agent.memory?.readMemory !== false,
    saveResponsesToMemory: agent.memory?.saveResponses !== false,
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
      return agent
        ? {
          ...config,
          ...configFromAgentRecord(mergeAgentAliasOverrides(agent, agentAliasOverrides(node, config))),
          aliasSourceAgentId: sourceId,
          aliasOverrides: agentAliasOverrides(node, config),
        }
        : config;
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
      .filter((dependency) => String(dependency.metadata?.linkType || dependency.mapping?.linkType || "data") !== "tool-access")
      .map((dependency) => dependency.channel || dependency.metadata?.targetPort || dependency.metadata?.sourcePort)
      .filter(Boolean);
    if (incoming.length) return unique(incoming);
    return unique([...(node.inputs || []), ...(node.channels || [])]);
  };

  const isToolAccessDependency = (dependency = {}) =>
    String(dependency.metadata?.linkType || dependency.mapping?.linkType || "data") === "tool-access";

  const dependencyEventChannel = (dependency = {}) =>
    String(dependency.channel || dependency.metadata?.targetPort || dependency.metadata?.sourcePort || "");

  const matchingAgentDependencyForEvent = ({ node = {}, event = {}, dependencies = [] } = {}) => {
    const incomingDependencies = (dependencies || []).filter((dependency) => dependency.targetNodeId === node.id);
    const eventChannel = String(event?.channel || "");
    const sourceNodeId = String(event?.sourceNodeId || "");
    return incomingDependencies.find((dependency) =>
      !isToolAccessDependency(dependency) &&
      String(dependency.sourceNodeId || "") === sourceNodeId &&
      dependencyEventChannel(dependency) === eventChannel
    ) || null;
  };

  const agentAcceptsDependencyEvent = ({ node = {}, event = {}, dependencies = [] } = {}) => {
    const policy = String(nodeConfig(node).triggerPolicy || "connected_event").toLowerCase();
    if (policy === "manual_only") return false;
    const incomingDependencies = (dependencies || []).filter((dependency) => dependency.targetNodeId === node.id);
    if (!incomingDependencies.length) return policy === "accepted_input" || event?.targetNodeId === node.id;
    if (event?.targetNodeId && event.targetNodeId === node.id) return true;
    return Boolean(matchingAgentDependencyForEvent({ node, event, dependencies }));
  };

  const buildAgentTriggerTrace = ({ node = {}, event = {}, dependencies = [], nodes = [] } = {}) => {
    const incomingDependencies = (dependencies || []).filter((dependency) => dependency.targetNodeId === node.id);
    const dependency = matchingAgentDependencyForEvent({ node, event, dependencies }) ||
      (event?.targetNodeId === node.id
        ? incomingDependencies.find((item) => !isToolAccessDependency(item) && (!event?.sourceNodeId || item.sourceNodeId === event.sourceNodeId)) || null
        : null);
    const nodesById = new Map((nodes || []).map((item) => [item.id, item]));
    const sourceNode = nodesById.get(event?.sourceNodeId || dependency?.sourceNodeId || "") || {};
    const targetNode = nodesById.get(node.id) || node;
    const triggerPolicy = String(nodeConfig(node).triggerPolicy || "connected_event").toLowerCase();
    const mode = triggerPolicy === "manual_only"
      ? "manual-only"
      : event?.meta?.flowMapDirectAiExecution
      ? "direct-test"
      : event?.targetNodeId === node.id
        ? "targeted-event"
        : dependency
          ? "connected-event"
          : incomingDependencies.length
            ? "unmatched"
            : "open-input";
    return {
      mode,
      freshRun: Boolean(nodeConfig(node).freshRun || event?.meta?.freshRun),
      inputChannel: event?.channel || "",
      inputEventId: event?.id || "",
      sourceNodeId: event?.sourceNodeId || dependency?.sourceNodeId || "",
      sourceLabel: sourceNode.label || event?.sourceNodeId || dependency?.sourceNodeId || "",
      targetNodeId: node.id || "",
      targetLabel: targetNode.label || node.label || node.id || "",
      dependencyId: dependency?.id || dependency?.connectionId || "",
      connectionId: dependency?.connectionId || "",
      dependencyChannel: dependencyEventChannel(dependency),
      sourcePort: dependency?.metadata?.sourcePort || dependency?.sourcePort || "",
      targetPort: dependency?.metadata?.targetPort || dependency?.targetPort || "",
      linkType: dependency?.metadata?.linkType || dependency?.mapping?.linkType || "data",
      incomingDependencyCount: incomingDependencies.length,
      triggerPolicy,
    };
  };

  const agentOutput = (node = {}, config = {}) =>
    config.output || node.outputs?.[0] || node.channels?.[0] || `${nodeSubtype(node) || "ai"}.response`;

  const inputDataMode = (config = {}) =>
    String(config.inputDataMode || config.inputRequestMode || "latest").toLowerCase();

  const compactJson = (value) => {
    let text = "";
    try {
      text = JSON.stringify(value ?? {}, null, 2);
    } catch {
      text = String(value ?? "");
    }
    return text;
  };

  const buildRuntimeInputTrace = ({
    node = {},
    payload = {},
    event = {},
    config = {},
    prompt = "",
    memory = "",
    inputDataContext = null,
    ragContext = null,
    graphContext = null,
    toolContext = null,
    triggerTrace = null,
  } = {}) => ({
    agentId: node.id || "",
    agentLabel: node.label || node.id || "",
    inputEvent: {
      id: event.id || "",
      channel: event.channel || "",
      eventType: event.eventType || "",
      sourceNodeId: event.sourceNodeId || "",
      runId: event.meta?.runId || payload?.runId || "",
      createdAt: event.createdAt || "",
      freshRun: Boolean(config.freshRun || event.meta?.freshRun || payload?.__tlFreshRun),
    },
    trigger: triggerTrace,
    objective: payload?.objective || payload?.Objective || payload?.task || payload?.query || payload?.question || "",
    payload,
    config: {
      inputDataMode: config.inputDataMode || "",
      freshRun: Boolean(config.freshRun || event.meta?.freshRun || payload?.__tlFreshRun),
      triggerPolicy: config.triggerPolicy || "connected_event",
      inputHistoryLimit: config.inputHistoryLimit ?? "",
      memoryMode: config.memoryMode || "",
      memoryPersistence: config.memoryPersistence || "",
      contextWindow: config.contextWindow ?? "",
      readMemory: config.readMemory ?? "",
      saveResponsesToMemory: config.saveResponsesToMemory ?? config.saveResponses ?? "",
      promptStrategy: config.promptStrategy || "",
      outputFormat: config.outputFormat || config.responseFormat || "",
    },
    prompt,
    promptChars: String(prompt || "").length,
    memoryContext: memory,
    memoryChars: String(memory || "").length,
    inputDataContext,
    ragContext,
    graphContext,
    toolContext,
  });

  const isRagContextEvent = ({ payload = {}, event = {} } = {}) =>
    event?.channel === "knowledge.rag.context" ||
    (event?.eventType === "knowledge_emit" && event?.meta?.subtype === "rag-search" && payload?.context !== undefined) ||
    (payload?.queryId && Array.isArray(payload?.results) && payload?.context !== undefined);

  const isGraphContextEvent = ({ payload = {}, event = {} } = {}) =>
    event?.channel === "knowledge.graph.context" ||
    event?.channel === "knowledge.reasoning.plan" ||
    (event?.eventType === "knowledge_emit" && event?.meta?.subtype === "graph-query" && payload?.context !== undefined) ||
    (event?.eventType === "knowledge_reasoning_plan" && payload?.reasoningPlan) ||
    (event?.eventType === "knowledge_emit" && event?.meta?.subtype === "knowledge-reasoning-composer" && payload?.reasoningPlan) ||
    (payload?.queryId && Array.isArray(payload?.entities) && Array.isArray(payload?.relations) && payload?.context !== undefined);

  const normalizeRagContext = ({ payload = {}, event = {} } = {}) => {
    if (!isRagContextEvent({ payload, event })) return null;
    const results = Array.isArray(payload.results) ? payload.results : [];
    const sources = results.map((result, index) => ({
      index: index + 1,
      chunkId: result.chunkId || "",
      documentId: result.documentId || "",
      score: Number.isFinite(Number(result.score)) ? Number(result.score) : null,
      text: String(result.text || ""),
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
    const events = Array.isArray(payload.events) ? payload.events : [];
    const evidence = Array.isArray(payload.evidence) ? payload.evidence : [];
    return {
      query: String(payload.query || payload.question || "").trim(),
      queryId: payload.queryId || payload.id || "",
      context: String(payload.context || "").trim(),
      resultCount: Number(payload.resultCount ?? entities.length) || 0,
      relationCount: Number(payload.relationCount ?? relations.length) || 0,
      eventCount: Number(payload.eventCount ?? events.length) || 0,
      entities: entities.map((entity) => ({
        id: entity.id || "",
        label: entity.label || "",
        entityType: entity.entityType || "",
        confidence: Number.isFinite(Number(entity.confidence)) ? Number(entity.confidence) : null,
        connections: Number.isFinite(Number(entity.connections)) ? Number(entity.connections) : null,
        score: Number.isFinite(Number(entity.score)) ? Number(entity.score) : null,
        documentId: entity.documentId || "",
        chunkId: entity.chunkId || "",
      })),
      relations: relations.map((relation) => ({
        id: relation.id || "",
        sourceEntityId: relation.sourceEntityId || "",
        targetEntityId: relation.targetEntityId || "",
        sourceLabel: relation.sourceLabel || "",
        targetLabel: relation.targetLabel || "",
        relationType: relation.relationType || "",
        confidence: Number.isFinite(Number(relation.confidence)) ? Number(relation.confidence) : null,
        score: Number.isFinite(Number(relation.score)) ? Number(relation.score) : null,
        direct: relation.direct === true,
        semantic: relation.metadata?.semantic === true || relation.semantic === true,
        method: relation.extraction?.method || relation.method || "",
        originalType: relation.metadata?.originalRelationType || relation.originalType || "",
        explanation: relation.metadata?.explanation || relation.explanation || "",
        evidence: relation.evidence?.quote || relation.evidence?.text || relation.metadata?.evidence?.quote || relation.metadata?.evidence?.text || relation.evidence || "",
        documentId: relation.documentId || "",
        chunkId: relation.chunkId || "",
      })),
      events: events.map((item) => ({
        id: item.id || "",
        sequence: Number.isFinite(Number(item.sequence)) ? Number(item.sequence) : null,
        eventType: item.eventType || "",
        subject: item.subject || "",
        objects: Array.isArray(item.objects) ? item.objects : [],
        participants: Array.isArray(item.participants) ? item.participants : [],
        roles: item.roles || {},
        subjectResolution: item.subjectResolution || null,
        polarity: item.polarity || "",
        modality: item.modality || "",
        aspect: item.aspect || "",
        confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : null,
        score: Number.isFinite(Number(item.score)) ? Number(item.score) : null,
        evidence: item.evidence?.quote || item.evidence?.text || "",
      })),
      evidence: evidence.map((item, index) => ({
        index: item.index || index + 1,
        chunkId: item.chunkId || "",
        documentId: item.documentId || "",
        text: String(item.text || "").trim(),
        metadata: item.metadata || {},
      })),
      reasoningPlan: payload.reasoningPlan || null,
      contextType: payload.contextType || (payload.reasoningPlan ? "knowledge-reasoning" : "knowledge-graph"),
      scope: payload.scope || {},
      inputChannel: event?.channel || "",
      inputEventId: event?.id || "",
    };
  };

  const renderGraphPromptBlock = (graphContext = null) => {
    if (!graphContext) return "";
    const reasoningPlan = graphContext.reasoningPlan || null;
    const primaryEvidenceText = String(reasoningPlan?.primaryEvidenceText || "").trim();
    const reasoningLines = reasoningPlan?.requiredFacts?.length
      ? reasoningPlan.requiredFacts.map((fact, index) => {
        if (fact.kind === "event") {
          const patient = fact.roles?.patient?.length ? ` patient=${fact.roles.patient.join(", ")}` : "";
          const destination = fact.roles?.destination?.length ? ` destination=${fact.roles.destination.join(", ")}` : "";
          const evidence = fact.evidence ? `\n  evidence: ${String(fact.evidence)}` : "";
          return `[F${index + 1}] seq=${fact.sequence ?? ""} ${fact.subject || "event"} -${fact.eventType}-> ${(fact.objects || []).join(", ") || "context"}${patient}${destination}${evidence}`;
        }
        const evidence = fact.evidence ? `\n  evidence: ${String(fact.evidence)}` : "";
        return `[F${index + 1}] ${fact.source || "source"} -${fact.relationType || "related_to"}-> ${fact.target || "target"}${evidence}`;
      }).join("\n")
      : "";
    const reasoningBoundaries = reasoningPlan?.excludedContext?.length
      ? reasoningPlan.excludedContext.map((item) => `- ${item}`).join("\n")
      : "";
    const reasoningInstructions = reasoningPlan?.responseInstructions?.length
      ? reasoningPlan.responseInstructions.map((item) => `- ${item}`).join("\n")
      : "";
    const relationLines = reasoningPlan ? "" : (graphContext.relations || []).map((relation, index) => {
      const flags = [
        relation.direct ? "direct" : "",
        relation.semantic ? "semantic" : "",
        relation.method ? `method=${relation.method}` : "",
        relation.originalType ? `original=${relation.originalType}` : "",
      ].filter(Boolean).join(" ");
      const evidence = relation.evidence ? `\n  evidence: ${String(relation.evidence)}` : "";
      const explanation = relation.explanation ? `\n  explanation: ${String(relation.explanation)}` : "";
      return `[R${index + 1}${flags ? ` ${flags}` : ""}] ${relation.sourceLabel || relation.sourceEntityId} -${relation.relationType}-> ${relation.targetLabel || relation.targetEntityId}${evidence}${explanation}`;
    }).join("\n");
    const evidenceLines = reasoningPlan && primaryEvidenceText ? "" : (graphContext.evidence || []).map((source, index) =>
      `[${index + 1}] document=${source.documentId || ""} chunk=${source.chunkId || ""}\n${String(source.text || "")}`
    ).join("\n\n");
    const eventLines = reasoningPlan ? "" : (graphContext.events || []).map((item, index) => {
      const sequence = item.sequence !== null && item.sequence !== undefined ? ` seq=${item.sequence}` : "";
      const score = item.score !== null && item.score !== undefined ? ` score=${Number(item.score || 0).toFixed(2)}` : "";
      const objects = (item.objects || []).join(", ") || "context";
      const flags = [item.aspect, item.modality, item.polarity].filter(Boolean).join(" ");
      const roles = item.roles?.agent?.length || item.roles?.patient?.length || item.roles?.destination?.length
        ? `\n  roles: agent=${(item.roles.agent || []).join(", ") || "?"}; patient=${(item.roles.patient || []).join(", ") || "?"}; object=${(item.roles.object || []).join(", ") || "?"}; destination=${(item.roles.destination || []).join(", ") || "?"}`
        : "";
      const resolution = item.subjectResolution?.method
        ? `\n  subjectResolution: ${item.subjectResolution.method} confidence=${Number(item.subjectResolution.confidence || 0).toFixed(2)}`
        : "";
      const evidence = item.evidence ? `\n  evidence: ${String(item.evidence)}` : "";
      return `[EV${index + 1}${sequence}${score}${flags ? ` ${flags}` : ""}] ${item.subject || "event"} -${item.eventType}-> ${objects}${roles}${resolution}${evidence}`;
    }).join("\n");
    return [
      "Knowledge Graph context:",
      graphContext.query ? `Query: ${graphContext.query}` : "",
      reasoningPlan ? `Reasoning intent: ${reasoningPlan.intent || "fact"}` : "",
      primaryEvidenceText ? `Primary evidence text:\n${primaryEvidenceText}` : "",
      reasoningLines ? `Reasoning required facts:\n${reasoningLines}` : "",
      reasoningInstructions ? `Reasoning answer instructions:\n${reasoningInstructions}` : "",
      reasoningBoundaries ? `Reasoning boundaries:\n${reasoningBoundaries}` : "",
      !reasoningPlan && graphContext.context ? `Graph neighborhood:\n${graphContext.context}` : "",
      relationLines ? `Structured relations:\n${relationLines}` : "",
      eventLines ? `Structured events:\n${eventLines}` : "",
      evidenceLines ? `Evidence:\n${evidenceLines}` : "",
      "If a Reasoning Plan is present, answer primarily from Primary evidence text when it is available. Treat Reasoning required facts as a navigation and verification layer over that text, and Reasoning boundaries as factual limits. Use graph relations/events only to clarify the focused evidence, not to override it. Use direct semantic relations and ordered Structured events as primary evidence when no Primary evidence text is available. For how/why questions, include the concrete ordered event chain when evidence provides one; do not answer only with a broad summary relation such as healed_by/causes if the events explain the mechanism. Use broad relations only when they directly clarify the same mechanism. If focused evidence is present, answer from it instead of saying evidence is missing. Prefer explicit evidence over generic assumptions. Preserve the roles, objects, tools, places and sequence found in the evidence; do not move details between nearby facts unless a quote explicitly supports that merge. Do not compress separate source details into a new label unless that exact label appears in evidence. Always answer in the same language as the user query, not the source document language. Translate graph labels only as needed to answer naturally in the query language. Do not add parenthesized translations or original source terms unless the user explicitly asks for translation or the original term is essential to disambiguate. Write fluent, idiomatic prose instead of literally verbalizing graph relation names.",
    ].filter(Boolean).join("\n\n");
  };

  const compactTextValue = (value = "") => {
    const text = String(value || "").trim();
    return text || "";
  };

  const resultAnswerText = (result = {}) => {
    if (typeof result.text === "string" && result.text.trim()) return result.text.trim();
    if (typeof result.response?.text === "string" && result.response.text.trim()) return result.response.text.trim();
    if (typeof result.response === "string" && result.response.trim()) return result.response.trim();
    if (result.response !== undefined && result.response !== null) {
      if (typeof result.response === "object" && !Array.isArray(result.response) && !Object.values(result.response).some((value) => String(value || "").trim())) return "";
      return compactJson(result.response);
    }
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
    semantic: relation.metadata?.semantic === true || relation.semantic === true,
    method: relation.extraction?.method || relation.method || "",
    originalType: relation.metadata?.originalRelationType || relation.originalType || "",
    evidence: relation.evidence?.quote || relation.evidence?.text || relation.metadata?.evidence?.quote || relation.metadata?.evidence?.text || relation.evidence || relation.metadata?.explanation || "",
    explanation: relation.metadata?.explanation || relation.explanation || "",
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

  const cleanEvent = (item = {}) => ({
    sequence: Number.isFinite(Number(item.sequence)) ? Number(item.sequence) : null,
    type: item.eventType || item.type || "",
    subject: item.subject || "",
    objects: Array.isArray(item.objects) ? item.objects : [],
    participants: Array.isArray(item.participants) ? item.participants : [],
    roles: item.roles || {},
    subjectResolution: item.subjectResolution || null,
    polarity: item.polarity || "",
    modality: item.modality || "",
    aspect: item.aspect || "",
    confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : null,
    score: Number.isFinite(Number(item.score)) ? Number(item.score) : null,
    evidence: item.evidence?.quote || item.evidence?.text || item.evidence || "",
  });

  const cleanEvidence = (item = {}, index = 0) => ({
    index: item.index || index + 1,
    documentId: item.documentId || "",
    chunkId: item.chunkId || "",
    text: compactTextValue(item.text),
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
        contextType: graphContext.contextType || "knowledge-graph",
        question: graphContext.query || "",
        graph: {
          queryId: graphContext.queryId || "",
          resultCount: graphContext.resultCount ?? 0,
          relationCount: graphContext.relationCount ?? 0,
          eventCount: graphContext.eventCount ?? 0,
          scope: graphContext.scope || {},
          reasoningPlan: graphContext.reasoningPlan ? {
            id: graphContext.reasoningPlan.id || "",
            intent: graphContext.reasoningPlan.intent || "",
            status: graphContext.reasoningPlan.status || "",
            primaryEvidenceText: compactTextValue(graphContext.reasoningPlan.primaryEvidenceText || ""),
            requiredFacts: graphContext.reasoningPlan.requiredFacts || [],
            responseInstructions: graphContext.reasoningPlan.responseInstructions || [],
            excludedContext: graphContext.reasoningPlan.excludedContext || [],
          } : null,
          entities: (graphContext.entities || []).map(cleanEntity),
          relations: (graphContext.relations || []).map(cleanRelation),
          events: (graphContext.events || []).map(cleanEvent),
          evidence: (graphContext.evidence || []).map(cleanEvidence),
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
          sources: (ragContext.sources || []).map((source, index) => ({
            index: source.index || index + 1,
            score: Number.isFinite(Number(source.score)) ? Number(source.score) : null,
            documentId: source.documentId || "",
            chunkId: source.chunkId || "",
            text: compactTextValue(source.text),
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

  const toolObservationQuery = ({ payload = {}, event = {} } = {}) =>
    String(
      payload.query ||
      payload.question ||
      payload.objective ||
      payload.task ||
      payload.prompt ||
      payload.message ||
      payload.text ||
      payload.context ||
      ""
    ).trim();

  const connectedToolManifestsForAgent = async ({ node = {}, workspaceId = "", runtime = null } = {}) => {
    if (!node?.id || !window.TrackerLensAgentRuntime?.inspectConnectedTools) return null;
    return window.TrackerLensAgentRuntime.inspectConnectedTools({
      workspaceId,
      nodeId: node.id,
      runtime,
    }).catch(() => null);
  };

  const chooseAgentToolCalls = ({ manifests = [], query = "", ragContext = null, graphContext = null, config = {} } = {}) => {
    if (!query || ["off", "none", "disabled"].includes(String(config.connectedToolMode || config.agentToolMode || "").toLowerCase())) return [];
    const calls = [];
    const pushTool = (toolNames = [], args = {}) => {
      const manifest = manifests.find((item) => (item.tools || []).some((tool) => toolNames.includes(tool.name)));
      const tool = manifest?.tools?.find((item) => toolNames.includes(item.name));
      if (!manifest || !tool || tool.mode !== "read") return false;
      if (calls.some((call) => call.nodeId === manifest.nodeId && call.tool === tool.name)) return false;
      calls.push({ nodeId: manifest.nodeId, nodeLabel: manifest.label || manifest.nodeId, relation: manifest.relation || "", tool: tool.name, args });
      return true;
    };
    const configuredLimit = Number(config.connectedToolLimit || 0);
    const limit = Number.isFinite(configuredLimit) && configuredLimit > 0 ? Math.floor(configuredLimit) : Number.POSITIVE_INFINITY;
    if (!ragContext && !graphContext) pushTool(["searchChunks"], { query });
    pushTool(["getTimeline", "findEvents"], { query });
    pushTool(["defineTerm"], { term: query, query });
    pushTool(["findRelations", "findEntities"], { query });
    pushTool(["getGraphEvidence"], { query });
    if (!calls.some((call) => call.tool === "searchChunks")) pushTool(["searchChunks"], { query });
    return calls.slice(0, limit);
  };

  const callProviderText = async ({ provider = null, model = "", prompt = "", maxTokens = 800 } = {}) => {
    const type = String(provider?.provider || provider?.providerType || "").toLowerCase();
    if (type.includes("ollama")) return callOllama({ provider, model, prompt, maxTokens });
    if (type.includes("lm-studio") || type.includes("lmstudio") || type.includes("openai")) {
      return callLmStudio({ provider, model, prompt, maxTokens });
    }
    return callLmStudio({ provider: provider || {}, model, prompt, maxTokens });
  };

  const toolManifestSummary = (manifests = []) =>
    (manifests || []).map((manifest) => ({
      nodeId: manifest.nodeId,
      label: manifest.label || manifest.nodeId,
      subtype: manifest.subtype || "",
      relation: manifest.relation || "",
      tools: (manifest.tools || [])
        .filter((tool) => tool.mode === "read")
        .map((tool) => ({ name: tool.name, purpose: tool.purpose || "", requiresEvidence: Boolean(tool.requiresEvidence) })),
    })).filter((manifest) => manifest.tools.length);

  const validatePlannedToolCalls = ({ plan = {}, manifests = [], query = "", config = {} } = {}) => {
    const manifestByNode = new Map((manifests || []).map((manifest) => [manifest.nodeId, manifest]));
    const configuredLimit = Number(config.connectedToolLimit || config.plannerToolLimit || 0);
    const limit = Number.isFinite(configuredLimit) && configuredLimit > 0 ? Math.floor(configuredLimit) : Number.POSITIVE_INFINITY;
    const steps = Array.isArray(plan?.steps) ? plan.steps : Array.isArray(plan?.toolCalls) ? plan.toolCalls : [];
    const calls = [];
    for (const step of steps) {
      const nodeId = String(step.nodeId || step.targetNodeId || "").trim();
      const toolName = String(step.tool || step.toolName || "").trim();
      const manifest = manifestByNode.get(nodeId);
      const tool = manifest?.tools?.find((item) => item.name === toolName && item.mode === "read");
      if (!manifest || !tool) continue;
      const args = step.args && typeof step.args === "object" && !Array.isArray(step.args) ? step.args : {};
      calls.push({
        nodeId,
        nodeLabel: manifest.label || nodeId,
        relation: manifest.relation || "",
        tool: tool.name,
        args: {
          query,
          ...args,
        },
        plannedReason: String(step.reason || step.purpose || ""),
      });
      if (calls.length >= limit) break;
    }
    return calls;
  };

  const planConnectedToolCalls = async ({ manifests = [], query = "", payload = {}, event = {}, provider = null, model = "", config = {} } = {}) => {
    const mode = String(config.connectedToolPlanner || config.agentToolPlanner || "llm").toLowerCase();
    if (!query || ["off", "none", "disabled", "heuristic"].includes(mode)) return { calls: [], plan: null, error: "" };
    const availableTools = toolManifestSummary(manifests);
    if (!availableTools.length) return { calls: [], plan: null, error: "no-tools" };
    const prompt = [
      "You are a Trackers Lens tool planner.",
      "Plan read-only tool calls for the connected nodes. Return ONLY one JSON object, no markdown.",
      "Use the cheapest specific tools first. If source evidence may be needed, include searchChunks/getFullDocument/getGraphEvidence as appropriate.",
      "Do not answer the user. Only plan tool calls.",
      "Schema: {\"intent\":\"\",\"steps\":[{\"nodeId\":\"\",\"tool\":\"\",\"args\":{},\"reason\":\"\"}],\"verification\":\"\"}",
      JSON.stringify({
        question: query,
        payload: {
          question: payload.question || payload.query || "",
          documentId: payload.documentId || "",
          collectionId: payload.collectionId || "",
          purpose: payload.purpose || "",
        },
        inputChannel: event?.channel || "",
        availableTools,
        ...(Number.isFinite(Number(config.connectedToolLimit || config.plannerToolLimit)) && Number(config.connectedToolLimit || config.plannerToolLimit) > 0
          ? { maxSteps: Math.floor(Number(config.connectedToolLimit || config.plannerToolLimit)) }
          : {}),
      }),
    ].join("\n\n");
    try {
      const ai = await callProviderText({ provider, model, prompt, maxTokens: Math.max(1, Math.floor(Number(config.plannerMaxTokens || config.maxTokens || 420))) });
      const plan = parseAiText(ai.text || "");
      const calls = validatePlannedToolCalls({ plan, manifests, query, config });
      return { calls, plan, usage: ai.usage || {}, error: calls.length ? "" : "empty-plan" };
    } catch (error) {
      return { calls: [], plan: null, error: error?.message || String(error) };
    }
  };

  const collectConnectedToolObservations = async ({ node = {}, payload = {}, event = {}, workspaceId = "", runtime = {}, config = {}, ragContext = null, graphContext = null } = {}) => {
    if (!window.TrackerLensAgentRuntime?.callConnectedNodeTool) return { manifest: null, calls: [], observations: [], error: "" };
    const manifest = await connectedToolManifestsForAgent({ node, workspaceId, runtime });
    const query = toolObservationQuery({ payload, event });
    const provider = await pickProvider(config);
    const model = String(config.model || provider?.model || "local-model");
    const readableManifests = toolManifestSummary(manifest?.manifests || []);
    const planned = readableManifests.length <= 1
      ? { calls: [], plan: null, error: "single-connected-node" }
      : await planConnectedToolCalls({ manifests: manifest?.manifests || [], query, payload, event, provider, model, config });
    const calls = planned.calls.length
      ? planned.calls
      : chooseAgentToolCalls({ manifests: manifest?.manifests || [], query, ragContext, graphContext, config });
    const observations = [];
    const hasCall = (nodeId = "", tool = "") => calls.some((call) => call.nodeId === nodeId && call.tool === tool) ||
      observations.some((observation) => observation.nodeId === nodeId && observation.tool === tool);
    const manifestForNode = (nodeId = "") => (manifest?.manifests || []).find((item) => item.nodeId === nodeId) || null;
    const nodeHasTool = (nodeId = "", toolName = "") =>
      Boolean(manifestForNode(nodeId)?.tools?.some((tool) => tool.name === toolName && tool.mode === "read"));
    const scopedDocumentId = /^kdoc_/i.test(String(payload.documentId || "")) ? String(payload.documentId || "") : "";
    const runToolCall = async (call = {}) => {
      const startedAt = performance.now();
      try {
        const result = await window.TrackerLensAgentRuntime.callConnectedNodeTool({
          workspaceId,
          nodeId: call.nodeId,
          tool: call.tool,
          args: call.args,
          agentNodeId: node.id,
          runtime,
        });
        const observation = {
          ...call,
          ok: result?.ok !== false,
          status: result?.status || "",
          confidence: result?.confidence ?? null,
          limitations: result?.limitations || [],
          itemCount: Array.isArray(result?.items) ? result.items.length : 0,
          evidence: result?.evidence || [],
          items: result?.items || [],
          answer: result?.answer || "",
          usage: result?.usage || {},
          debug: result?.debug || {},
          latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
        };
        observations.push(observation);
        return observation;
      } catch (error) {
        const observation = {
          ...call,
          ok: false,
          status: "error",
          error: error?.message || String(error),
          latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
        };
        observations.push(observation);
        return observation;
      }
    };
    for (const call of calls) {
      const observation = await runToolCall(call);
      const needsSourceFallback = call.tool === "searchChunks" &&
        observation.ok !== false &&
        nodeHasTool(call.nodeId, "getFullDocument") &&
        !hasCall(call.nodeId, "getFullDocument");
      if (needsSourceFallback) {
        await runToolCall({
          nodeId: call.nodeId,
          nodeLabel: call.nodeLabel,
          relation: call.relation || "",
          tool: "getFullDocument",
          args: {
            documentId: scopedDocumentId,
            collectionId: payload.collectionId || payload.metadata?.collectionId || "",
            maxChars: Number.isFinite(Number(config.connectedToolDocumentChars || config.maxDocumentChars)) && Number(config.connectedToolDocumentChars || config.maxDocumentChars) > 0
              ? Math.floor(Number(config.connectedToolDocumentChars || config.maxDocumentChars))
              : 0,
          },
          plannedReason: "Full-document read on the same connected Document tool for source verification.",
        });
      }
    }
    return { manifest, plan: planned.plan, plannerError: planned.error || "", calls, observations, error: "" };
  };

  const renderToolObservationBlock = (toolContext = null) => {
    const observations = toolContext?.observations || [];
    if (!observations.length) return "";
    const planText = toolContext?.plan
      ? `Planner intent: ${String(toolContext.plan.intent || "")}\nPlanner verification: ${String(toolContext.plan.verification || "")}`
      : toolContext?.plannerError
        ? `Planner fallback: ${toolContext.plannerError}`
        : "";
    const lines = observations.map((observation, index) => {
      const evidence = (observation.evidence || [])
        .map((item, evidenceIndex) => `  [E${index + 1}.${evidenceIndex + 1}] ${item.sourceType || "evidence"} doc=${item.documentId || ""} chunk=${item.chunkId || ""}\n  ${String(item.text || "")}`)
        .join("\n");
      const limitations = observation.limitations?.length ? `\n  limitations: ${observation.limitations.join("; ")}` : "";
      const answer = observation.answer ? `\n  answer: ${String(observation.answer)}` : "";
      const debug = observation.debug && Object.keys(observation.debug).length
        ? [
          `documents=${observation.debug.documentCount ?? "N/D"}`,
          `chunks=${observation.debug.chunkCount ?? "N/D"}`,
          observation.debug.selectedChunkCount !== undefined ? `selectedChunks=${observation.debug.selectedChunkCount}` : "",
          observation.debug.sourceMode ? `source=${observation.debug.sourceMode}` : "",
          observation.debug.fullDocumentChars !== undefined ? `fullChars=${observation.debug.fullDocumentChars}` : "",
          observation.debug.returnedChars !== undefined ? `returnedChars=${observation.debug.returnedChars}` : "",
          observation.debug.truncated !== undefined ? `truncated=${observation.debug.truncated ? "yes" : "no"}` : "",
        ].filter(Boolean).join(" ")
        : "";
      const debugLine = debug ? `\n  debug: ${debug}` : "";
      return `[T${index + 1}] ${observation.nodeLabel || observation.nodeId}.${observation.tool} status=${observation.status || "ready"} confidence=${Number.isFinite(Number(observation.confidence)) ? Number(observation.confidence).toFixed(2) : "N/D"} items=${observation.itemCount ?? 0}${debugLine}${answer}${limitations}${evidence ? `\n${evidence}` : ""}`;
    }).join("\n\n");
    return [
      "Connected tool observations:",
      planText,
      lines,
      "Use these observations as runtime evidence. Source-bearing evidence text has higher authority than derived graph/dictionary/event facts. If observations are empty or limited, say what is missing instead of inventing facts.",
    ].join("\n\n");
  };

  const buildPrompt = ({ node, payload, event, memory = "", config = nodeConfig(node) }) => {
    const subtype = nodeSubtype(node);
    const ragContext = config.ragContext || normalizeRagContext({ payload, event });
    const graphContext = config.graphContext || normalizeGraphContext({ payload, event });
    const ragPromptBlock = renderRagPromptBlock(ragContext);
    const toolPromptBlock = renderToolObservationBlock(config.toolContext || null);
    const hasCustomPromptTemplate = Boolean(String(config.promptTemplate || config.prompt || config.instruction || "").trim());
    const graphPromptBlock = renderGraphPromptBlock(graphContext);
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
      toolContext: config.toolContext || null,
    };
    return [
      systemPrompt,
      `\nNode: ${node.label || node.id}`,
      `Role: ${config.agentType || subtype || "agent"}`,
      config.inputDataContext ? `Input data context:\n${compactJson(config.inputDataContext)}` : "",
      ragPromptBlock ? `\n${ragPromptBlock}` : "",
      graphPromptBlock ? `\n${graphPromptBlock}` : "",
      toolPromptBlock ? `\n${toolPromptBlock}` : "",
      `\nTask:\n${renderPromptTemplate(template, context)}`,
      `\nOutput instructions:\n${outputInstructions}`,
    ].filter(Boolean).join("\n");
  };

  const collectInputDataContext = async ({ node, event, workspaceId, config = {}, runtime = {} } = {}) => {
    const mode = inputDataMode(config);
    if (mode === "off" || mode === "none") return null;
    const configuredHistoryLimit = Number(config.inputHistoryLimit || 0);
    const historyLimit = Number.isFinite(configuredHistoryLimit) && configuredHistoryLimit > 0
      ? Math.floor(configuredHistoryLimit)
      : Number.POSITIVE_INFINITY;
    const dependencyInputs = (runtime.dependencies || [])
      .filter((dependency) => dependency.targetNodeId === node.id)
      .filter((dependency) => String(dependency.metadata?.linkType || dependency.mapping?.linkType || "data") !== "tool-access")
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
      const keys = payload && typeof payload === "object" && !Array.isArray(payload) ? Object.keys(payload) : [];
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
      payloadPreview: clonePayload(payload),
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

  const callOllama = async ({ provider, model, prompt, maxTokens = 800 }) => {
    const endpoint = String(provider.endpoint || "http://127.0.0.1:11434").replace(/\/+$/g, "");
    const response = await postAiJson({
      url: `${endpoint}/api/generate`,
      headers: { "Content-Type": "application/json" },
      body: { model, prompt, stream: false, options: { num_predict: maxTokens } },
    });
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
    const data = await response.json();
    const text = data.response || "";
    return {
      text,
      usage: usageFromAiResponse({ data, prompt, text }),
      finishReason: data.done_reason || "",
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

  const callLmStudio = async ({ provider, model, prompt, maxTokens = 800 }) => {
    const endpoint = withLmStudioApiBase(provider.endpoint);
    const resolvedModel = await resolveLmStudioModel({ provider, model });
    const response = await postAiJson({
      url: `${endpoint}/chat/completions`,
      headers: { "Content-Type": "application/json" },
      body: {
        model: resolvedModel,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: maxTokens,
      },
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`LM Studio HTTP ${response.status}${errorText ? `: ${errorText}` : ""}`);
    }
    const data = await response.json();
    const choice = data.choices?.[0] || {};
    const message = choice.message || {};
    let text = String(message.content || "").trim();
    if (!text && choice.finish_reason === "length" && String(message.reasoning_content || "").trim()) {
      const repairPrompt = [
        "The previous model response used the completion budget for reasoning and left message.content empty.",
        "Use the notes below only to write the final answer.",
        "Return only the final answer, no reasoning labels, no JSON, no markdown.",
        "Answer in the same language as the user's question.",
        "",
        "Notes:",
        String(message.reasoning_content || ""),
      ].join("\n");
      const repairMaxTokens = Math.max(1, Math.floor(Number(maxTokens || 800)));
      const repairResponse = await postAiJson({
        url: `${endpoint}/chat/completions`,
        headers: { "Content-Type": "application/json" },
        body: {
          model: resolvedModel,
          messages: [{ role: "user", content: repairPrompt }],
          temperature: 0.1,
          max_tokens: repairMaxTokens,
        },
      }).catch(() => null);
      if (repairResponse?.ok) {
        const repairData = await repairResponse.json().catch(() => null);
        text = String(repairData?.choices?.[0]?.message?.content || "").trim();
      }
    }
    return {
      text,
      usage: usageFromAiResponse({ data, prompt, text }),
      model: resolvedModel,
      finishReason: choice.finish_reason || "",
      raw: data,
    };
  };

  const callAiProvider = async ({ provider = {}, model = "", prompt = "", maxTokens = 800 } = {}) => {
    const providerName = String(provider?.provider || provider?.name || "").toLowerCase();
    if (providerName.includes("ollama")) return callOllama({ provider, model, prompt, maxTokens });
    if (providerName.includes("lm") || providerName.includes("studio")) return callLmStudio({ provider, model, prompt, maxTokens });
    throw new Error("Provider AI non configurato per chat runtime");
  };

  const mergeContinuationText = (base = "", addition = "") => {
    const current = String(base || "").trimEnd();
    const next = String(addition || "").trim();
    if (!current) return next;
    if (!next) return current;
    if (current.endsWith(next)) return current;
    const tail = current.slice(-600);
    for (let size = Math.min(tail.length, next.length, 240); size >= 24; size -= 1) {
      if (tail.endsWith(next.slice(0, size))) {
        return `${current}${next.slice(size)}`;
      }
    }
    return `${current}\n\n${next}`;
  };

  const buildContinuationPrompt = ({ originalPrompt = "", generatedText = "", attempt = 1 } = {}) => [
    "Continue the assistant output below exactly from the point where it stopped.",
    "Do not repeat completed paragraphs.",
    "Do not add analysis, metadata, labels, JSON or markdown fences.",
    "Preserve the same language, tone, names and style.",
    "If the text is already complete, write only the natural final continuation or ending.",
    "",
    "Original task:",
    String(originalPrompt || ""),
    "",
    `Current output to continue (attempt ${attempt}):`,
    String(generatedText || ""),
  ].join("\n");

  const memoryScopeForPersistence = (config = {}, subtype = "") => {
    const persistence = String(config.memoryPersistence || "").toLowerCase();
    if (["none", "off", "disabled"].includes(persistence)) return "";
    if (["short", "workspace", "global"].includes(persistence)) return persistence;
    if (persistence === "persistent") return "workspace";
    return subtype === "memory" ? "short" : "workspace";
  };

  const shouldSaveResponseToMemory = (config = {}, subtype = "") => {
    if (String(config.saveResponsesToMemory ?? config.saveResponses ?? "true").toLowerCase() === "false") return false;
    return Boolean(memoryScopeForPersistence(config, subtype));
  };

  const shouldReadMemory = (config = {}) => {
    if (String(config.readMemory ?? "true").toLowerCase() === "false") return false;
    return !["off", "none", "disabled"].includes(String(config.memoryMode || "").toLowerCase());
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

  const estimateAiTokens = (value = "") =>
    Math.max(0, Math.ceil(String(value || "").length / 4));

  const usageFromAiResponse = ({ data = {}, prompt = "", text = "" } = {}) => {
    const promptTokens = Number(data.usage?.prompt_tokens || data.prompt_eval_count || 0) || estimateAiTokens(prompt);
    const completionTokens = Number(data.usage?.completion_tokens || data.eval_count || 0) || estimateAiTokens(text);
    const totalTokens = Number(data.usage?.total_tokens || 0) || promptTokens + completionTokens;
    return { promptTokens, completionTokens, totalTokens };
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

  const normalizeTokenUsage = (usage = {}) => {
    const promptTokens = Number(usage.promptTokens || usage.prompt_tokens || 0);
    const completionTokens = Number(usage.completionTokens || usage.completion_tokens || 0);
    const totalTokens = Number(usage.totalTokens || usage.total_tokens || promptTokens + completionTokens || 0);
    return {
      promptTokens: Number.isFinite(promptTokens) ? promptTokens : 0,
      completionTokens: Number.isFinite(completionTokens) ? completionTokens : 0,
      totalTokens: Number.isFinite(totalTokens) ? totalTokens : 0,
    };
  };

  const AI_AGENT_STEP_LABELS = {
    received: "Received event",
    mapping: "Applied mapping",
    input_context: "Loaded input context",
    connected_tools: "Observed connected tools",
    memory: "Loaded memory",
    prompt: "Built prompt",
    llm: "Called model",
    fallback: "Used fallback",
    continuation: "Continued output",
    emit: "Emitted output",
    complete: "Completed",
    error: "Error",
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

    async recordTokenUsage({ node, usage = {}, provider = "", model = "" } = {}) {
      const normalized = normalizeTokenUsage(usage);
      if (!node?.id || !normalized.totalTokens) return;
      const current = (this.runtime.nodes || []).find((item) => item.id === node.id) || node;
      const previous = current.metadata?.tokenUsage || {};
      const nextUsage = {
        totalTokens: Number(previous.totalTokens || 0) + normalized.totalTokens,
        totalPromptTokens: Number(previous.totalPromptTokens || 0) + normalized.promptTokens,
        totalCompletionTokens: Number(previous.totalCompletionTokens || 0) + normalized.completionTokens,
        lastTokens: normalized.totalTokens,
        lastPromptTokens: normalized.promptTokens,
        lastCompletionTokens: normalized.completionTokens,
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
        console.warn("AI token usage non persistito", error);
      }
    }

    async recordStep({ node, jobId = "", runId = "", steps = [], step = {}, status = "working", patch = {} } = {}) {
      if (!node?.id || !jobId) return steps;
      const now = new Date().toISOString();
      const stepStatus = String(step.status || status || "working").toLowerCase();
      const isTerminalStep = ["complete", "completed", "warning", "error", "fallback", "skipped"].includes(stepStatus);
      const nextStep = {
        id: step.id || `step_${steps.length + 1}`,
        type: step.type || "step",
        label: step.label || AI_AGENT_STEP_LABELS[step.type] || "Runtime step",
        status: step.status || status || "working",
        summary: step.summary || "",
        detail: step.detail || "",
        payload: step.payload || null,
        startedAt: step.startedAt || now,
        completedAt: isTerminalStep ? now : step.completedAt || "",
      };
      let replaceIndex = -1;
      if (isTerminalStep && nextStep.type) {
        for (let index = steps.length - 1; index >= 0; index -= 1) {
          const previous = steps[index] || {};
          if (previous.type === nextStep.type && String(previous.status || "").toLowerCase() === "working") {
            replaceIndex = index;
            break;
          }
        }
      }
      const nextSteps = replaceIndex >= 0
        ? steps.map((item, index) => index === replaceIndex ? {
          ...item,
          ...nextStep,
          id: item.id || nextStep.id,
          startedAt: item.startedAt || nextStep.startedAt,
        } : item)
        : [...steps, nextStep];
      const currentStep = nextSteps[nextSteps.length - 1] || null;
      try {
        const existingData = await window.TrackerLensAiRuntimeStore?.list?.().catch(() => null);
        const existingJob = (existingData?.jobs || []).find((job) => job.id === jobId || job.raw?.id === jobId);
        const existingRaw = existingJob?.raw && typeof existingJob.raw === "object" ? existingJob.raw : {};
        await window.TrackerLensAiRuntimeStore?.upsertJob?.({
          ...existingRaw,
          id: jobId,
          workspaceId: this.workspaceId,
          runId,
          agentId: node.id,
          agent: node.label || node.id,
          status,
          runtimeStatus: status,
          currentStep,
          steps: nextSteps,
          updatedAt: now,
          ...patch,
        });
        await this.bus?.emit?.("ai.agent.step", {
          jobId,
          runId,
          agentId: node.id,
          agentLabel: node.label || node.id,
          status,
          step: nextStep,
          stepsCount: nextSteps.length,
        }, {
          workspaceId: this.workspaceId,
          eventType: "ai_agent_step",
          sourceNodeId: node.id,
          status,
          meta: {
            aiAgentRuntime: node.id,
            jobId,
            runId,
            stepType: nextStep.type,
          },
        });
      } catch (error) {
        console.warn("AI agent step non persistito", error);
      }
      return nextSteps;
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
      let config = await resolveNodeConfig(node);
      if (config.freshRun || event?.meta?.freshRun || payload?.__tlFreshRun) {
        config = {
          ...config,
          inputDataMode: "off",
          readMemory: false,
        };
      }
      const jobId = `ai_job_${node.id}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const runId = event.meta?.runId || payload?.runId || "";
      const triggerTrace = buildAgentTriggerTrace({
        node,
        event,
        dependencies: this.runtime?.dependencies || [],
        nodes: this.runtime?.nodes || [],
      });
      let steps = [];
      steps = await this.recordStep({
        node,
        jobId,
        runId,
        steps,
        status: "working",
        step: {
          type: "received",
          status: "complete",
          summary: `Input event ${event?.channel || "runtime"} received.`,
          payload: { inputChannel: event?.channel || "", inputEventId: event?.id || "", sourceNodeId: event?.sourceNodeId || "", trigger: triggerTrace },
        },
      });
      const inputDataContext = await collectInputDataContext({ node, event, workspaceId: this.workspaceId, config, runtime: this.runtime });
      steps = await this.recordStep({
        node,
        jobId,
        runId,
        steps,
        status: "working",
        step: {
          type: "input_context",
          status: "complete",
          summary: inputDataContext ? "Loaded linked input context." : "No additional linked input context.",
          payload: inputDataContext ? { channels: Object.keys(inputDataContext) } : null,
        },
      });
      const ragContext = normalizeRagContext({ payload, event });
      const graphContext = normalizeGraphContext({ payload, event });
      const toolContext = await collectConnectedToolObservations({
        node,
        payload,
        event,
        workspaceId: this.workspaceId,
        runtime: this.runtime,
        config,
        ragContext,
        graphContext,
      });
      steps = await this.recordStep({
        node,
        jobId,
        runId,
        steps,
        status: toolContext?.observations?.length ? "waiting_for_tools" : "working",
        step: {
          type: "connected_tools",
          status: "complete",
          summary: toolContext?.observations?.length
            ? `Collected ${toolContext.observations.length} connected tool observation${toolContext.observations.length === 1 ? "" : "s"}.`
            : "No connected tool observations required.",
          payload: {
            plannerError: toolContext?.plannerError || "",
            calls: (toolContext?.calls || []).map((call) => ({ nodeId: call.nodeId, tool: call.tool })),
            observations: (toolContext?.observations || []).map((item) => ({ nodeId: item.nodeId, tool: item.tool, ok: item.ok !== false, status: item.status || "" })),
          },
        },
      });
      if (toolContext?.observations?.length) {
        await this.bus?.emit?.("agent.tool.observation", {
          runId: event.meta?.runId || payload?.runId || "",
          aiAgentNodeId: node.id,
          agentLabel: node.label || node.id,
          query: toolObservationQuery({ payload, event }),
          observations: clonePayload(toolContext.observations),
          observedAt: new Date().toISOString(),
        }, {
          workspaceId: this.workspaceId,
          eventType: "ai_agent_tool_observation",
          sourceNodeId: node.id,
          status: toolContext.observations.some((item) => item.ok) ? "ok" : "warning",
          meta: {
            aiAgentRuntime: node.id,
            inputEventId: event.id || "",
            inputChannel: event.channel || "",
            runId: event.meta?.runId || payload?.runId || "",
          },
        });
      }
      const promptConfig = {
        ...config,
        ...(inputDataContext ? { inputDataContext } : {}),
        ...(ragContext ? { ragContext } : {}),
        ...(graphContext ? { graphContext } : {}),
        ...(toolContext?.observations?.length ? { toolContext } : {}),
      };
      const provider = await pickProvider(config);
      const model = String(config.model || provider?.model || "local-model");
      const memoryReadEnabled = shouldReadMemory(config);
      const memory = !memoryReadEnabled ? "" : await window.TrackerLensAiRuntimeStore?.buildMemoryContext?.({
        workspaceId: this.workspaceId,
        agentId: node.id,
        query: event.channel || nodeSubtype(node),
        limit: 6,
      }).catch(() => "");
      steps = await this.recordStep({
        node,
        jobId,
        runId,
        steps,
        status: "working",
        step: {
          type: "memory",
          status: "complete",
          summary: memoryReadEnabled ? "Loaded workspace memory context." : "Memory read disabled for this agent.",
          payload: {
            disabled: !memoryReadEnabled,
            readMemory: memoryReadEnabled,
            hasMemory: Boolean(memory),
            persistence: config.memoryPersistence || "",
            saveResponsesToMemory: shouldSaveResponseToMemory(config, nodeSubtype(node)),
          },
        },
      });
      const prompt = buildPrompt({ node, payload, event, memory, config: promptConfig });
      const inputTrace = buildRuntimeInputTrace({
        node,
        payload,
        event,
        config,
        prompt,
        memory,
        inputDataContext,
        ragContext,
        graphContext,
        toolContext,
        triggerTrace,
      });
      const configMaxTokens = Number(config.maxTokens || 0);
      const providerMaxTokens = Number(provider?.maxTokens || 0);
      const maxTokens = Math.max(1, Math.floor(Number(configMaxTokens || providerMaxTokens || 800)));
      const maxContinuationCalls = Math.max(0, Number(config.maxContinuationCalls ?? config.continuationCalls ?? 10));
      steps = await this.recordStep({
        node,
        jobId,
        runId,
        steps,
        status: "planning",
        step: {
          type: "prompt",
          status: "complete",
          summary: "Prompt assembled for provider call.",
          payload: {
            promptChars: prompt.length,
            provider: provider?.name || provider?.provider || "fallback",
            model,
            maxTokens,
            maxContinuationCalls,
            configMaxTokens: config.maxTokens ?? "",
            providerMaxTokens: provider?.maxTokens ?? "",
            aliasSourceAgentId: config.aliasSourceAgentId || "",
          },
        },
      });
      await window.TrackerLensAiRuntimeStore?.upsertJob?.({
        id: jobId,
        workspaceId: this.workspaceId,
        runId,
        agentId: node.id,
        agent: node.label || node.id,
        task: event.channel || "runtime event",
        prompt,
        inputTrace,
        memoryContext: memory,
        inputDataContext,
        ragContext,
        graphContext,
        toolContext,
        status: "running_llm",
        runtimeStatus: "running_llm",
        currentStep: steps[steps.length - 1] || null,
        steps,
        provider: provider?.name || provider?.provider || "fallback",
        model,
        createdAt: new Date().toISOString(),
      });

      const startedAt = performance.now();
      try {
        let ai = null;
        steps = await this.recordStep({
          node,
          jobId,
          runId,
          steps,
          status: "running_llm",
          step: {
            type: "llm",
            status: "working",
            summary: `Calling ${provider?.name || provider?.provider || "provider"} with ${model}.`,
            payload: { provider: provider?.name || provider?.provider || "", model, maxTokens, maxContinuationCalls },
          },
        });
        ai = await callAiProvider({ provider, model, prompt, maxTokens });
        let text = ai.text || "";
        let finishReason = ai.finishReason || "";
        let usage = normalizeTokenUsage(ai.usage || {});
        const continuations = [];
        for (let attempt = 1; finishReason === "length" && (maxContinuationCalls === 0 || attempt <= maxContinuationCalls); attempt += 1) {
          const continuationPrompt = buildContinuationPrompt({ originalPrompt: prompt, generatedText: text, attempt });
          steps = await this.recordStep({
            node,
            jobId,
            runId,
            steps,
            status: "running_llm",
            step: {
              type: "continuation",
              status: "working",
              summary: `Continuing output after token limit (${attempt}/${maxContinuationCalls || "unlimited"}).`,
              payload: { attempt, maxTokens, currentChars: text.length },
            },
          });
          const continuation = await callAiProvider({ provider, model, prompt: continuationPrompt, maxTokens });
          const continuationText = continuation.text || "";
          text = mergeContinuationText(text, continuationText);
          finishReason = continuation.finishReason || "";
          const continuationUsage = normalizeTokenUsage(continuation.usage || {});
          usage = normalizeTokenUsage({
            promptTokens: usage.promptTokens + continuationUsage.promptTokens,
            completionTokens: usage.completionTokens + continuationUsage.completionTokens,
            totalTokens: usage.totalTokens + continuationUsage.totalTokens,
          });
          continuations.push({
            attempt,
            finishReason,
            chars: continuationText.length,
            totalChars: text.length,
            usage: continuationUsage,
          });
          steps = await this.recordStep({
            node,
            jobId,
            runId,
            steps,
            status: finishReason === "length" ? "running_llm" : "emitting",
            step: {
              type: "continuation",
              status: finishReason === "length" ? "warning" : "complete",
              summary: finishReason === "length"
                ? `Continuation ${attempt} also stopped at max token limit.`
                : `Continuation ${attempt} completed.`,
              payload: { attempt, maxTokens, finishReason, addedChars: continuationText.length, totalChars: text.length, tokens: continuationUsage.totalTokens },
            },
          });
        }
        const latencyMs = Math.round(performance.now() - startedAt);
        const result = {
          provider: provider?.name || provider?.provider || "local",
          model: ai.model || model,
          role: nodeSubtype(node),
          response: parseAiText(text),
          text,
          usage,
          finishReason,
          continuations,
          cost: estimateCost({ usage, provider, config }),
          latencyMs,
          inputChannel: event.channel || "",
          prompt,
          inputTrace,
          memoryContext: memory,
          inputDataContext,
          ragContext,
          graphContext,
          toolContext,
          jobId,
          runtimeStatus: "emitting",
          steps,
        };
        steps = await this.recordStep({
          node,
          jobId,
          runId,
          steps,
          status: "emitting",
          step: {
            type: "llm",
            status: result.finishReason === "length" ? "warning" : "complete",
            summary: result.finishReason === "length"
              ? `Model stopped at max token limit after ${latencyMs}ms and ${continuations.length} continuation${continuations.length === 1 ? "" : "s"}.`
              : `Model response received in ${latencyMs}ms.`,
            payload: { latencyMs, tokens: result.usage.totalTokens || 0, model: result.model, maxTokens, finishReason: result.finishReason, continuations: continuations.length },
          },
        });
        result.steps = steps;
        result.runtimeStatus = "emitting";
        await window.TrackerLensAiRuntimeStore?.upsertJob?.({
          id: jobId,
          workspaceId: this.workspaceId,
          runId,
          agentId: node.id,
          agent: node.label || node.id,
          task: event.channel || "runtime event",
          status: "completed",
          runtimeStatus: "complete",
          currentStep: steps[steps.length - 1] || null,
          steps,
          provider: result.provider,
          model,
          durationMs: latencyMs,
          tokens: result.usage.totalTokens || 0,
          cost: result.cost,
          prompt,
          inputTrace,
          memoryContext: memory,
          inputDataContext,
          ragContext,
          graphContext,
          toolContext,
          result,
          updatedAt: new Date().toISOString(),
        });
        await this.recordTokenUsage({ node, usage: result.usage, provider: result.provider, model: result.model });
        return result;
      } catch (error) {
        const latencyMs = Math.round(performance.now() - startedAt);
        const result = {
          ...fallbackResponse({ node, payload, event, reason: error?.message || String(error), ragContext, graphContext }),
          toolContext,
          jobId,
          runtimeStatus: "fallback",
          steps,
        };
        steps = await this.recordStep({
          node,
          jobId,
          runId,
          steps,
          status: "fallback",
          step: {
            type: "fallback",
            status: "fallback",
            summary: "Provider failed; local fallback result created.",
            detail: error?.message || String(error),
          },
        });
        result.steps = steps;
        result.runtimeStatus = "fallback";
        await window.TrackerLensAiRuntimeStore?.upsertJob?.({
          id: jobId,
          workspaceId: this.workspaceId,
          runId,
          agentId: node.id,
          agent: node.label || node.id,
          task: event.channel || "runtime event",
          status: "fallback",
          runtimeStatus: "fallback",
          currentStep: steps[steps.length - 1] || null,
          steps,
          provider: result.provider,
          model: result.model,
          durationMs: latencyMs,
          tokens: 0,
          cost: estimateCost({ usage: {}, provider, config }),
          prompt,
          inputTrace,
          memoryContext: memory,
          inputDataContext,
          ragContext,
          graphContext,
          toolContext,
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
        if (result?.jobId && Array.isArray(result.steps)) {
          const emitSteps = await this.recordStep({
            node,
            jobId: result.jobId,
            runId,
            steps: result.steps,
            status: "complete",
            step: {
              type: "emit",
              status: "complete",
              summary: `Output emitted on ${channel}.`,
              payload: { outputChannel: channel, latencyMs },
            },
          });
          await this.recordStep({
            node,
            jobId: result.jobId,
            runId,
            steps: emitSteps,
            status: "complete",
            step: {
              type: "complete",
              status: "complete",
              summary: "Agent runtime completed.",
              payload: { outputChannel: channel },
            },
          });
        }
        await this.log({
          node,
          message: `AI agent emitted ${channel}: ${node.label || node.id}`,
          context: { inputChannel: event.channel, outputChannel: channel, inputEventId: event.id, runId, result: emitPayload, latencyMs },
        });
        const subtype = nodeSubtype(node);
        const memoryScope = memoryScopeForPersistence(config, subtype);
        if (shouldSaveResponseToMemory(config, subtype)) {
          const resultText = typeof result.text === "string" ? result.text : JSON.stringify(result.response || result);
          await window.TrackerLensAiRuntimeStore?.remember?.({
            scope: memoryScope,
            workspaceId: this.workspaceId,
            agentId: node.id,
            kind: "runtime-response",
            name: `${node.label || node.id} response`,
            text: resultText,
            summary: resultText,
            tags: [subtype || "agent", "runtime-response", channel].filter(Boolean),
            weight: subtype === "memory" ? 1.2 : 1,
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
