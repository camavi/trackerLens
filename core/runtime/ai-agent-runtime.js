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
    const incoming = dependencies
      .filter((dependency) => dependency.targetNodeId === node.id)
      .map((dependency) => dependency.channel || dependency.metadata?.targetPort)
      .filter(Boolean);
    return unique([...(node.inputs || []), ...(node.channels || []), ...incoming]);
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

  const renderPromptTemplate = (template = "", context = {}) =>
    String(template || "").replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, token) => {
      const key = String(token || "").trim();
      const value = context[key];
      if (value === undefined || value === null) return "";
      return typeof value === "string" ? value : compactJson(value, 3600);
    });

  const buildPrompt = ({ node, payload, event, memory = "", config = nodeConfig(node) }) => {
    const subtype = nodeSubtype(node);
    const systemPrompt = String(config.systemPrompt || "").trim() ||
      `You are a Trackers Lens ${subtype || "AI"} runtime node.`;
    const template = String(config.promptTemplate || config.prompt || config.instruction || "").trim() ||
      "Analyze this runtime event:\n\nChannel: {{channel}}\nPayload: {{payload}}\nMemory: {{memory}}";
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
    };
    return [
      systemPrompt,
      `\nNode: ${node.label || node.id}`,
      `Role: ${config.agentType || subtype || "agent"}`,
      config.inputDataContext ? `Input data context:\n${compactJson(config.inputDataContext)}` : "",
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

  const fallbackResponse = ({ node, payload, event, reason = "" }) => {
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
      payloadPreview: keys.length ? Object.fromEntries(keys.slice(0, 6).map((key) => [key, payload[key]])) : clonePayload(payload),
    };
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
    const response = await fetch(`${endpoint}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false }),
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
    const response = await fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: resolvedModel,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
      }),
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
      const promptConfig = inputDataContext ? { ...config, inputDataContext } : config;
      const provider = await pickProvider(config);
      const model = String(config.model || provider?.model || "local-model");
      const memory = await window.TrackerLensAiRuntimeStore?.buildMemoryContext?.({
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
          result,
          updatedAt: new Date().toISOString(),
        });
        return result;
      } catch (error) {
        const latencyMs = Math.round(performance.now() - startedAt);
        const result = fallbackResponse({ node, payload, event, reason: error?.message || String(error) });
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
        const channel = agentOutput(node, await resolveNodeConfig(node));
        await this.bus.emit(channel, result, {
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
          },
        });
        await this.log({
          node,
          message: `AI agent emitted ${channel}: ${node.label || node.id}`,
          context: { inputChannel: event.channel, outputChannel: channel, inputEventId: event.id, runId, result, latencyMs },
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
