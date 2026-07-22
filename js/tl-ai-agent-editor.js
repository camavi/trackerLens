window.TrackerLensAiAgentEditor = (() => {
  const _ = window.CMSwift || window._;
  const icon = (name, size = "md") => _.Icon({ name, size });
  const btn = (props, ...children) => _.Btn({ type: "button", ...props }, ...children);
  const dot = (tone = "online") => _.span({ class: `tl-ai-dot is-${tone}`, "aria-hidden": "true" });
  const selectValueOf = (value) => value?.target?.value ?? value;
  const optionItems = (items = []) => items.map((item) => typeof item === "string" ? ({ value: item, label: item }) : item);
  const splitList = (value = "") => String(value || "").split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
  const csvOf = (value = []) => Array.isArray(value) ? value.join(", ") : String(value || "");
  const cleanText = (value = "", fallback = "") => String(value ?? fallback ?? "").trim();
  const rawAgent = (agent = null) => agent?.raw && typeof agent.raw === "object" ? agent.raw : agent || {};
  const agentField = (agent, key, fallback = "") => rawAgent(agent)?.[key] ?? agent?.[key] ?? fallback;
  const agentNested = (agent, key) => {
    const raw = rawAgent(agent);
    return raw?.[key] && typeof raw[key] === "object" ? raw[key] : agent?.[key] && typeof agent[key] === "object" ? agent[key] : {};
  };
  const agentFormValue = (form, name) => {
    if (!form) return "";
    if (name === "model") {
      const modelFields = Array.from(form.querySelectorAll("[data-ai-model-value='true'], [name='model']"));
      const selected = modelFields
        .map((field) => field?.value?.trim?.() || "")
        .filter(Boolean)
        .at(-1);
      if (selected) return selected;
    }
    return form.querySelector?.(`[name="${name}"]`)?.value?.trim?.() || "";
  };
  const boolValue = (form, name, fallback = false) => {
    const value = agentFormValue(form, name);
    if (!value) return fallback;
    return value === "true" || value === "on" || value === "1";
  };
  const numberValue = (form, name, fallback = 0) => {
    const value = Number(agentFormValue(form, name));
    return Number.isFinite(value) ? value : fallback;
  };
  const statusTone = (status = "") => window.TrackerLensAiRuntimeStore?.statusTone?.(status) || "warn";
  const selectedProviderId = (agent = null) =>
    agentNested(agent, "provider").profileId || agentNested(agent, "provider").providerId || "";
  const providerLabel = (provider = {}) =>
    `${provider.name || provider.provider || "Provider"} · ${provider.model || provider.provider || "model"}`;

  const normalizeProviderName = (value = "") =>
    cleanText(value).toLowerCase().replace(/[\s_-]+/g, "");

  const fallbackProviderConfig = (providerType = "") => {
    const key = normalizeProviderName(providerType);
    if (key.includes("lmstudio")) {
      return {
        id: "local_lm_studio",
        name: "LM Studio",
        provider: "lm-studio",
        providerType: "lm-studio",
        endpoint: "http://127.0.0.1:1234/v1",
        modelPath: "/models",
        model: "local-model",
      };
    }
    if (key.includes("ollama")) {
      return {
        id: "local_ollama",
        name: "Ollama",
        provider: "ollama",
        providerType: "ollama",
        endpoint: "http://127.0.0.1:11434",
        modelPath: "/api/tags",
        model: "llama3.1",
      };
    }
    return null;
  };

  const joinEndpointPath = (base = "", path = "") => {
    const cleanBase = cleanText(base).replace(/\/+$/, "");
    const cleanPath = cleanText(path).replace(/^\/+/, "");
    if (!cleanBase) return "";
    return cleanPath ? `${cleanBase}/${cleanPath}` : cleanBase;
  };

  const aiProviderModelPaths = (provider = {}) => {
    const kind = normalizeProviderName(provider.provider || provider.providerType || provider.name || provider.id);
    if (kind.includes("ollama")) return [provider.modelPath || "/api/tags", "/api/tags"];
    if (kind.includes("lmstudio")) return [provider.modelPath || "/models", "/api/v1/models", "/v1/models"];
    return [provider.modelPath, provider.healthPath, "/models", "/api/v1/models"].filter(Boolean);
  };

  const aiProviderModelUrls = (provider = {}) => {
    const base = cleanText(provider.endpoint || provider.baseUrl).replace(/\/+$/, "");
    if (!base) return [];
    const kind = normalizeProviderName(provider.provider || provider.providerType || provider.name || provider.id);
    const urls = aiProviderModelPaths(provider).map((path) => joinEndpointPath(base, path));
    if (kind.includes("lmstudio")) {
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
      .map((item) => cleanText(item?.id || item?.name || item?.model || item))
      .filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
  };

  const fetchAiProviderModels = async (provider = {}) => {
    if (!provider?.endpoint && !provider?.baseUrl) return { models: [], error: "Provider endpoint non configurato" };
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

  const AI_AGENT_TYPES = ["analyzer", "summarizer", "decision", "classifier", "predictor", "memory", "router", "planner", "debugger"];
  const AI_EXECUTION_MODES = ["on_event", "interval", "continuous", "manual", "scheduled"];
  const AI_DROP_POLICIES = ["queue", "reject", "latest"];
  const AI_INPUT_DATA_MODES = ["off", "latest", "history", "latest_history"];
  const AI_AGENT_STATUSES = ["active", "idle", "running", "warning", "paused", "error", "disconnected", "disabled", "experimental"];
  const AI_RESPONSE_FORMATS = ["text", "json", "markdown", "structured", "signal"];
  const AI_PROMPT_STRATEGIES = ["simple", "contextual", "memory-aware", "multi-step", "chain-of-thought", "structured-output"];
  const AI_MEMORY_MODES = ["none", "short", "workspace", "persistent"];
  const AI_PROVIDER_TYPES = ["local", "openai", "claude", "gemini", "ollama", "lm-studio", "custom"];
  const AI_PERMISSION_FIELDS = [
    ["canAccessWeb", "Can Access Web"],
    ["canAccessMemory", "Can Access Memory"],
    ["canEmitChannels", "Can Emit Channels"],
    ["canExecuteActions", "Can Execute Actions"],
    ["canSaveStorage", "Can Save Storage"],
    ["canReadWorkspace", "Can Read Workspace"],
    ["canAccessRuntimeLogs", "Can Access Runtime Logs"],
  ];
  const AI_DEBUG_FIELDS = [
    ["enableLogs", "Enable Logs"],
    ["savePrompts", "Save Prompts"],
    ["saveResponses", "Save Responses"],
    ["runtimeMetrics", "Runtime Metrics"],
    ["debugMode", "Debug Mode"],
  ];

  const contractFromForm = (form, current = null) => {
    const scope = agentFormValue(form, "scope") || "template";
    const name = agentFormValue(form, "name");
    const agentType = agentFormValue(form, "agentType") || "analyzer";
    const outputChannel = agentFormValue(form, "outputChannel") || `ai.${agentType}.output`;
    const inputChannels = splitList(agentFormValue(form, "inputChannels"))
      .map((channel) => String(channel || "").trim().toLowerCase() === "input" ? "task" : channel);
    const outputChannels = splitList(outputChannel);
    const permissions = Object.fromEntries(AI_PERMISSION_FIELDS.map(([key]) => [key, boolValue(form, key, key === "canEmitChannels" || key === "canReadWorkspace")]));
    const debug = Object.fromEntries(AI_DEBUG_FIELDS.map(([key]) => [key, boolValue(form, key, key !== "debugMode")]));
    const now = new Date().toISOString();
    return {
      ...(current?.id ? { id: current.id, createdAt: current.raw?.createdAt || current.createdAt } : {}),
      scope,
      kind: scope,
      templateId: scope === "runtime" ? agentFormValue(form, "templateId") || current?.templateId || "" : "",
      workspaceId: scope === "runtime" ? agentFormValue(form, "workspaceId") || current?.workspaceId || "workspace_global" : "",
      name,
      title: name,
      description: agentFormValue(form, "description") || "Runtime intelligence worker",
      icon: agentFormValue(form, "icon") || "psychology",
      color: agentFormValue(form, "color") || "gold",
      category: agentFormValue(form, "category") || "Runtime Intelligence",
      tags: splitList(agentFormValue(form, "tags")),
      version: agentFormValue(form, "version") || "1.0.0",
      status: agentFormValue(form, "status") || "active",
      runtime: {
        nodeType: "aiAgent",
        agentType,
        executionMode: agentFormValue(form, "executionMode") || "on_event",
        priority: numberValue(form, "priority", 5),
        retryPolicy: agentFormValue(form, "retryPolicy") || "exponential",
        timeoutMs: numberValue(form, "timeoutMs", 120000),
        cooldownMs: numberValue(form, "cooldownMs", 0),
        queueLimit: numberValue(form, "queueLimit", 25),
        parallelJobs: numberValue(form, "parallelJobs", 1),
        dropPolicy: agentFormValue(form, "dropPolicy") || "queue",
        state: "idle",
      },
      provider: {
        profileId: agentFormValue(form, "providerProfile"),
        providerType: agentFormValue(form, "providerType") || "ollama",
        model: agentFormValue(form, "model") || "local-model",
        temperature: numberValue(form, "temperature", 0.2),
        maxTokens: numberValue(form, "maxTokens", 800),
        topP: numberValue(form, "topP", 0.9),
        streaming: boolValue(form, "streaming", false),
        responseFormat: agentFormValue(form, "responseFormat") || "json",
      },
      channels: {
        inputs: inputChannels,
        payloadMapping: agentFormValue(form, "payloadMapping"),
        requiredInputs: splitList(agentFormValue(form, "requiredInputs")),
        contextSources: splitList(agentFormValue(form, "contextSources")),
        eventTriggers: splitList(agentFormValue(form, "eventTriggers")),
        inputDataMode: agentFormValue(form, "inputDataMode") || "latest",
        inputHistoryLimit: numberValue(form, "inputHistoryLimit", 5),
        outputs: outputChannels,
        outputChannel,
        outputFormat: agentFormValue(form, "outputFormat") || "json",
        emitStrategy: agentFormValue(form, "emitStrategy") || "on_success",
        eventPriority: agentFormValue(form, "eventPriority") || "normal",
      },
      promptConfig: {
        systemPrompt: agentFormValue(form, "systemPrompt"),
        template: agentFormValue(form, "promptTemplate"),
        variables: splitList(agentFormValue(form, "dynamicVariables")),
        strategy: agentFormValue(form, "promptStrategy") || "contextual",
        outputInstructions: agentFormValue(form, "outputInstructions"),
      },
      memory: {
        mode: agentFormValue(form, "memoryMode") || "workspace",
        size: numberValue(form, "memorySize", 20),
        expiration: agentFormValue(form, "memoryExpiration") || "24h",
        persistence: agentFormValue(form, "memoryPersistence") || "workspace",
        compression: agentFormValue(form, "memoryCompression") || "summary",
        contextWindow: numberValue(form, "contextWindow", 6),
      },
      permissions,
      debug,
      metrics: {
        executionCount: numberValue(form, "executionCount", current?.metrics?.executionCount || 0),
        avgResponseTimeMs: numberValue(form, "avgResponseTimeMs", current?.metrics?.avgResponseTimeMs || 0),
        tokenUsage: numberValue(form, "tokenUsage", current?.metrics?.tokenUsage || 0),
        successRate: numberValue(form, "successRate", current?.metrics?.successRate || 0),
        queueSize: numberValue(form, "queueSize", current?.metrics?.queueSize || 0),
        activeJobs: numberValue(form, "activeJobs", current?.metrics?.activeJobs || 0),
        memoryUsage: numberValue(form, "memoryUsage", current?.metrics?.memoryUsage || 0),
      },
      runtimeManifest: {
        type: "aiAgent",
        subtype: agentType,
        inputs: inputChannels.map((channel) => ({ id: channel, channel, type: "object" })),
        outputs: outputChannels.map((channel) => ({ id: channel, channel, type: "object" })),
        permissions: Object.entries(permissions).filter(([, enabled]) => enabled).map(([key]) => key),
        updatedAt: now,
      },
      updatedAt: now,
    };
  };

  const agentInput = (label, name, value = "", extra = {}) =>
    _.Input({ label, name, value: value ?? "", ...extra });
  const agentSelect = (label, name, value, options, extra = {}) =>
    _.div(
      { class: "tl-ai-agent-field" },
      _.input({ type: "hidden", name, value: value ?? "" }),
      _.Select({
        label,
        value: value ?? "",
        options: optionItems(options),
        slots: { arrow: () => icon("keyboard_arrow_down", "sm") },
        onChange: (nextValue) => {
          const value = selectValueOf(nextValue);
          const input = document.querySelector(`.tl-ai-agent-runtime-editor input[name='${name}']`);
          if (input) input.value = selectValueOf(nextValue);
          extra.onChange?.(value);
        },
      })
    );
  const agentBooleanSelect = (label, name, value = false) =>
    agentSelect(label, name, value ? "true" : "false", [{ value: "true", label: "Enabled" }, { value: "false", label: "Disabled" }]);
  const agentTextarea = (label, name, value = "", rows = 5, placeholder = "") =>
    _.label({ class: "tl-ai-agent-textarea-field" }, _.span(label), _.textarea({ name, rows, placeholder, value: value || "" }));

  const openRuntimeEditorShell = ({
    title = "AI Runtime Agent Editor",
    subtitle = "Flow Map runtime node",
    icon: iconName = "psychology",
    formId = `tl-ai-runtime-editor-${Date.now()}`,
    tabs = [],
    initialTab = "general",
    formClass = "",
    dialogClass = "",
    panelClass = "",
    saveLabel = "Salva Runtime Agent",
    cancelLabel = "Annulla",
    footerActions = null,
    onSave = null,
  } = {}) => {
    const tabModel = window.CMSwift.reactive.signal(initialTab || tabs[0]?.name || "general");
    let dialog = null;
    const saveFromForm = async ({ close }) => {
      await onSave?.({ form: document.getElementById(formId), close, dialog, formId });
    };
    dialog = _.Dialog({
      class: ["tl-ai-agent-dialog", dialogClass].filter(Boolean).join(" "),
      panelClass: ["tl-ai-agent-runtime-panel", panelClass].filter(Boolean).join(" "),
      size: "xl",
      title,
      subtitle,
      icon: iconName,
      closeButton: true,
      closeOnOutside: false,
      closeOnBackdrop: false,
      scrollable: true,
      bodyMaxHeight: "76vh",
      content: ({ close }) => _.form(
        {
          id: formId,
          class: ["tl-ai-agent-runtime-editor", formClass].filter(Boolean).join(" "),
          onsubmit: async (event) => {
            event.preventDefault();
            await saveFromForm({ close });
          },
        },
        _.TabPanel({
          class: "tl-ai-agent-tabs",
          model: tabModel,
          orientation: "horizontal",
          variant: "soft",
          tabs,
        })
      ),
      actions: ({ close }) => _.Toolbar(
        { class: "tl-ai-agent-editor-footer", align: "end", gap: 8 },
        typeof footerActions === "function" ? footerActions({ close, formId, dialog }) : null,
        btn({ onclick: close }, cancelLabel),
        btn({
          class: "st-btn-primary",
          onclick: async () => saveFromForm({ close }),
        }, icon("save", "sm"), saveLabel)
      ),
    });
    dialog.open();
    return dialog;
  };

  const open = ({ agent = null, providers = [], title = "", subtitle = "", onSave = null, footerActions = null, customTabs = [], saveLabel = "Salva Runtime Agent", cancelLabel = "Annulla" } = {}) => {
    const raw = rawAgent(agent);
    const runtime = agentNested(agent, "runtime");
    const provider = agentNested(agent, "provider");
    const channels = agentNested(agent, "channels");
    const promptConfig = agentNested(agent, "promptConfig");
    const memoryConfig = agentNested(agent, "memory");
    const permissions = agentNested(agent, "permissions");
    const debug = agentNested(agent, "debug");
    const agentMetrics = agentNested(agent, "metrics");
    const isEdit = Boolean(agent?.id);
    const values = {
      scope: agentField(agent, "scope", raw.workspaceId ? "runtime" : "template"),
      name: agentField(agent, "name", ""),
      description: agentField(agent, "description", ""),
      icon: agentField(agent, "icon", "psychology"),
      color: agentField(agent, "color", "gold"),
      category: agentField(agent, "category", "Runtime Intelligence"),
      tags: csvOf(agentField(agent, "tags", [])),
      version: agentField(agent, "version", "1.0.0"),
      status: raw.status || (agent?.status === "online" ? "active" : agent?.status) || "active",
      workspaceId: agentField(agent, "workspaceId", ""),
      templateId: agentField(agent, "templateId", ""),
    };
    const inputChannels = channels.inputs || raw.inputs || ["task"];
    const outputChannel = channels.outputChannel || channels.outputs?.[0] || raw.output || "ai.agent.output";
    const providerProfiles = [
      { value: "", label: "Auto / local-first" },
      ...providers.filter((item) => !item.placeholder).map((item) => ({ value: item.id, label: providerLabel(item) })),
    ];
    const modelState = {
      providerKey: "",
      loading: false,
      error: "",
      items: [],
      value: provider.model || "local-model",
      url: "",
    };
    const tabModel = window.CMSwift.reactive.signal("general");
    const formId = `tl-ai-agent-editor-${String(agent?.id || Date.now()).replace(/[^A-Za-z0-9_-]/g, "_")}`;
    const dialogTitle = title || values.name || "Runtime Intelligence Agent";
    const dialogSubtitle = subtitle || values.description || "Event-driven AI node for runtime channels";
    let dialog = null;
    const saveFromForm = async ({ form, close }) => {
      if (!form) return;
      const payload = contractFromForm(form, agent);
      if (!payload.name) {
        form.querySelector("[name='name']")?.focus?.();
        return;
      }
      await onSave?.({ payload, form, close, agent, dialog });
    };
    const providerForModelLookup = (form = document.getElementById(formId)) => {
      const providerProfile = agentFormValue(form, "providerProfile");
      const providerType = agentFormValue(form, "providerType") || provider.providerType || provider.provider || "ollama";
      const selectedProvider = providers.find((item) => item.id === providerProfile) || null;
      if (selectedProvider) return selectedProvider;
      const normalizedType = normalizeProviderName(providerType);
      return providers.find((item) => {
        const itemType = normalizeProviderName(item.provider || item.providerType || item.name || item.id);
        return itemType === normalizedType || itemType.includes(normalizedType) || normalizedType.includes(itemType);
      }) || fallbackProviderConfig(providerType) || {};
    };
    const modelProviderKey = (providerConfig = {}) =>
      [providerConfig.id, providerConfig.name, providerConfig.provider, providerConfig.providerType, providerConfig.endpoint || providerConfig.baseUrl]
        .map((item) => cleanText(item))
        .filter(Boolean)
        .join("|");
    const updateModelField = () => {
      const host = document.querySelector(`#${formId} [data-ai-model-field-host="true"]`);
      if (host) host.replaceWith(agentModelSelect());
    };
    const loadModelsForCurrentProvider = async ({ force = false } = {}) => {
      const form = document.getElementById(formId);
      if (!form) return;
      const providerConfig = providerForModelLookup(form);
      const key = modelProviderKey(providerConfig);
      if (!force && modelState.providerKey === key && (modelState.items.length || modelState.loading)) return;
      modelState.providerKey = key;
      modelState.loading = true;
      modelState.error = "";
      modelState.items = [];
      modelState.value = agentFormValue(form, "model") || modelState.value || providerConfig.model || providerConfig.defaultModel || "";
      updateModelField();
      const result = await fetchAiProviderModels(providerConfig);
      const currentModel = agentFormValue(document.getElementById(formId), "model") || modelState.value || providerConfig.model || providerConfig.defaultModel || "";
      modelState.loading = false;
      modelState.error = result.error || "";
      modelState.items = result.models || [];
      modelState.url = result.url || "";
      modelState.value = currentModel && (modelState.items.includes(currentModel) || !modelState.items.length)
        ? currentModel
        : modelState.items[0] || currentModel || "";
      updateModelField();
    };
    const agentModelSelect = () => {
      const currentValue = modelState.value || provider.model || "local-model";
      const options = modelState.items.length
        ? [...new Set([currentValue, ...modelState.items].filter(Boolean))]
        : [currentValue || "", ""].filter((item, index, items) => item || index === items.length - 1);
      const label = modelState.loading ? "Model (loading...)" : modelState.error ? "Model (fallback)" : "Model";
      return _.div(
        { class: "tl-ai-agent-field tl-ai-agent-model-field", "data-ai-model-field-host": "true" },
        _.input({ type: "hidden", name: "model", "data-ai-model-value": "true", value: currentValue }),
        _.Select({
          label,
          value: currentValue,
          options: optionItems(options.map((item) => ({
            value: item,
            label: item || (modelState.loading ? "Loading models..." : "No models loaded"),
          }))),
          slots: { arrow: () => icon("keyboard_arrow_down", "sm") },
          onChange: (nextValue) => {
            const value = selectValueOf(nextValue);
            modelState.value = value;
            document.querySelectorAll(`#${formId} input[name='model'], #${formId} [data-ai-model-value='true']`).forEach((input) => {
              input.value = value;
            });
          },
        }),
        _.small(
          { class: `tl-ai-agent-model-meta${modelState.error ? " is-error" : ""}` },
          modelState.loading
            ? "Loading models from provider..."
            : modelState.items.length
              ? `${modelState.items.length} models available`
              : modelState.error || "Model list unavailable; saved value is still editable after provider refresh."
        )
      );
    };
    const syncProviderFieldsAndModels = (providerId = "") => {
      const selected = providers.find((item) => item.id === providerId);
      if (!selected) {
        loadModelsForCurrentProvider({ force: true });
        return;
      }
      const form = document.getElementById(formId) || document.querySelector(".tl-ai-agent-runtime-editor");
      const providerType = form?.querySelector?.("input[name='providerType']");
      const model = form?.querySelector?.("input[name='model']");
      if (providerType) providerType.value = selected.providerType || selected.provider || providerType.value || "local";
      if (model) {
        model.value = selected.model || selected.defaultModel || model.value || "local-model";
        modelState.value = model.value;
      }
      loadModelsForCurrentProvider({ force: true });
    };
    const tabs = [
      {
        name: "general",
        label: "General",
        icon: "badge",
        content: _.div(
          { class: "tl-ai-agent-tab-grid" },
          agentSelect("Agent Scope", "scope", values.scope, [{ value: "template", label: "Library Agent Template" }, { value: "runtime", label: "Runtime Agent Instance" }]),
          agentInput("Name", "name", values.name, { required: true, placeholder: "Runtime Data Analyzer" }),
          agentInput("Description", "description", values.description, { placeholder: "Analyzes runtime events and emits AI insight channels" }),
          agentInput("Icon", "icon", values.icon),
          agentSelect("Color", "color", values.color, ["gold", "green", "blue"]),
          agentInput("Category", "category", values.category),
          agentInput("Tags", "tags", values.tags, { placeholder: "operations, events, risk" }),
          agentInput("Version", "version", values.version),
          agentSelect("Status", "status", values.status, AI_AGENT_STATUSES),
          agentInput("Workspace ID", "workspaceId", values.workspaceId, { placeholder: "workspace_global" }),
          agentInput("Template ID", "templateId", values.templateId, { placeholder: "agent template id for runtime instances" })
        ),
      },
      {
        name: "runtime",
        label: "Runtime",
        icon: "hub",
        content: _.div(
          { class: "tl-ai-agent-tab-grid" },
          agentSelect("Agent Type", "agentType", runtime.agentType || runtime.type || "analyzer", AI_AGENT_TYPES),
          agentSelect("Execution Mode", "executionMode", runtime.executionMode || "on_event", AI_EXECUTION_MODES),
          agentInput("Runtime Priority", "priority", runtime.priority ?? 5, { type: "number" }),
          agentSelect("Retry Policy", "retryPolicy", runtime.retryPolicy || "exponential", ["none", "linear", "exponential", "dead-letter"]),
          agentInput("Timeout (ms)", "timeoutMs", runtime.timeoutMs ?? 120000, { type: "number" }),
          agentInput("Cooldown (ms)", "cooldownMs", runtime.cooldownMs ?? 0, { type: "number" }),
          agentInput("Queue Limit", "queueLimit", runtime.queueLimit ?? 25, { type: "number" }),
          agentInput("Parallel Jobs", "parallelJobs", runtime.parallelJobs ?? 1, { type: "number" }),
          agentSelect("Drop Policy", "dropPolicy", runtime.dropPolicy || "queue", AI_DROP_POLICIES)
        ),
      },
      {
        name: "provider",
        label: "AI Provider",
        icon: "dns",
        content: _.div(
          { class: "tl-ai-agent-tab-grid" },
          agentSelect("Provider Profile", "providerProfile", selectedProviderId(agent), providerProfiles, {
            onChange: syncProviderFieldsAndModels,
          }),
          agentSelect("Provider Type", "providerType", provider.providerType || provider.provider || "ollama", AI_PROVIDER_TYPES, {
            onChange: () => loadModelsForCurrentProvider({ force: true }),
          }),
          agentModelSelect(),
          agentInput("Temperature", "temperature", provider.temperature ?? 0.2, { type: "number", step: "0.1" }),
          agentInput("Max Tokens", "maxTokens", provider.maxTokens ?? 800, { type: "number" }),
          agentInput("Top P", "topP", provider.topP ?? 0.9, { type: "number", step: "0.05" }),
          agentBooleanSelect("Streaming", "streaming", Boolean(provider.streaming)),
          agentSelect("Response Format", "responseFormat", provider.responseFormat || "json", AI_RESPONSE_FORMATS)
        ),
      },
      ...customTabs,
      {
        name: "inputs",
        label: "Inputs",
        icon: "input",
        content: _.div(
          { class: "tl-ai-agent-tab-grid" },
          agentInput("Input Channels", "inputChannels", csvOf(inputChannels), { placeholder: "source.value, events.recent" }),
          agentInput("Required Inputs", "requiredInputs", csvOf(channels.requiredInputs || []), { placeholder: "source.value" }),
          agentInput("Context Sources", "contextSources", csvOf(channels.contextSources || []), { placeholder: "workspace, memory, last-event" }),
          agentInput("Event Triggers", "eventTriggers", csvOf(channels.eventTriggers || inputChannels), { placeholder: "channel.emit, manual.test" }),
          agentSelect("Input Data Request", "inputDataMode", channels.inputDataMode || raw.inputDataMode || "latest", AI_INPUT_DATA_MODES),
          agentInput("Input History Limit", "inputHistoryLimit", channels.inputHistoryLimit ?? raw.inputHistoryLimit ?? 5, { type: "number" }),
          agentTextarea("Payload Mapping", "payloadMapping", channels.payloadMapping || "source.value -> observed_value\nevents.recent -> latest_events", 5),
          _.div({ class: "tl-ai-agent-preview-card" }, _.strong("Input Preview"), _.p("Last event, frequency and schema are populated by runtime channel telemetry."), _.code(`channels: ${csvOf(inputChannels) || "task"}`))
        ),
      },
      {
        name: "prompt",
        label: "Prompt",
        icon: "article",
        content: _.div(
          { class: "tl-ai-agent-tab-grid is-wide" },
          agentTextarea("System Prompt", "systemPrompt", promptConfig.systemPrompt || "You are a runtime intelligence worker. Analyze events and emit operational output.", 5),
          agentTextarea("Prompt Template", "promptTemplate", promptConfig.template || "Analyze this runtime event:\n\nChannel: {{channel}}\nPayload: {{payload}}\nMemory: {{memory}}", 7),
          agentInput("Dynamic Variables", "dynamicVariables", csvOf(promptConfig.variables || ["{{channel}}", "{{timestamp}}", "{{workspace}}", "{{memory}}", "{{event}}", "{{payload}}"])),
          agentSelect("Prompt Strategy", "promptStrategy", promptConfig.strategy || "contextual", AI_PROMPT_STRATEGIES),
          agentTextarea("Output Instructions", "outputInstructions", promptConfig.outputInstructions || "Return structured runtime output ready for channel emission.", 4)
        ),
      },
      {
        name: "memory",
        label: "Memory",
        icon: "memory",
        content: _.div(
          { class: "tl-ai-agent-tab-grid" },
          agentSelect("Memory Mode", "memoryMode", memoryConfig.mode || "workspace", AI_MEMORY_MODES),
          agentInput("Memory Size", "memorySize", memoryConfig.size ?? 20, { type: "number" }),
          agentInput("Expiration", "memoryExpiration", memoryConfig.expiration || "24h"),
          agentSelect("Persistence", "memoryPersistence", memoryConfig.persistence || "workspace", ["none", "short", "workspace", "persistent"]),
          agentSelect("Compression", "memoryCompression", memoryConfig.compression || "summary", ["none", "summary", "semantic", "rolling-window"]),
          agentInput("Context Window", "contextWindow", memoryConfig.contextWindow ?? 6, { type: "number" })
        ),
      },
      {
        name: "outputs",
        label: "Outputs",
        icon: "output",
        content: _.div(
          { class: "tl-ai-agent-tab-grid" },
          agentInput("Output Channel", "outputChannel", outputChannel, { placeholder: "ai.market.analysis" }),
          agentSelect("Output Format", "outputFormat", channels.outputFormat || provider.responseFormat || "json", AI_RESPONSE_FORMATS),
          agentSelect("Emit Strategy", "emitStrategy", channels.emitStrategy || "on_success", ["on_success", "always", "on_change", "threshold", "manual"]),
          agentSelect("Event Priority", "eventPriority", channels.eventPriority || "normal", ["low", "normal", "high", "critical"]),
          _.div({ class: "tl-ai-agent-preview-card" }, _.strong("Runtime Flow"), _.p("Channel consumer -> prompt generation -> provider call -> memory update -> output channel emit."), _.code(`${csvOf(inputChannels) || "task"} -> ${outputChannel}`))
        ),
      },
      {
        name: "permissions",
        label: "Permissions",
        icon: "shield",
        content: _.div(
          { class: "tl-ai-agent-permission-grid" },
          ...AI_PERMISSION_FIELDS.map(([key, label]) => agentBooleanSelect(label, key, permissions[key] ?? (key === "canEmitChannels" || key === "canReadWorkspace")))
        ),
      },
      {
        name: "debug",
        label: "Debug",
        icon: "bug_report",
        content: _.div(
          { class: "tl-ai-agent-tab-grid" },
          ...AI_DEBUG_FIELDS.map(([key, label]) => agentBooleanSelect(label, key, debug[key] ?? key !== "debugMode")),
          agentInput("Execution Count", "executionCount", agentMetrics.executionCount ?? 0, { type: "number" }),
          agentInput("Avg Response Time (ms)", "avgResponseTimeMs", agentMetrics.avgResponseTimeMs ?? 0, { type: "number" }),
          agentInput("Token Usage", "tokenUsage", agentMetrics.tokenUsage ?? 0, { type: "number" }),
          agentInput("Success Rate", "successRate", agentMetrics.successRate ?? 0, { type: "number" }),
          agentInput("Queue Size", "queueSize", agentMetrics.queueSize ?? 0, { type: "number" }),
          agentInput("Active Jobs", "activeJobs", agentMetrics.activeJobs ?? 0, { type: "number" }),
          agentInput("Memory Usage", "memoryUsage", agentMetrics.memoryUsage ?? 0, { type: "number" })
        ),
      },
    ];
    dialog = _.Dialog({
      class: "tl-ai-agent-dialog",
      panelClass: "tl-ai-agent-runtime-panel",
      size: "xl",
      title: dialogTitle,
      subtitle: dialogSubtitle,
      icon: values.icon || "psychology",
      closeButton: true,
      closeOnOutside: false,
      closeOnBackdrop: false,
      scrollable: true,
      bodyMaxHeight: "76vh",
      content: ({ close }) => _.form(
        {
          id: formId,
          class: "tl-ai-agent-runtime-editor",
          onsubmit: async (event) => {
            event.preventDefault();
            await saveFromForm({ form: event.currentTarget, close });
          },
        },
        _.TabPanel({
          class: "tl-ai-agent-tabs",
          model: tabModel,
          orientation: "horizontal",
          variant: "soft",
          tabs,
        })
      ),
      actions: ({ close }) => _.Toolbar(
        { class: "tl-ai-agent-editor-footer", align: "end", gap: 8 },
        typeof footerActions === "function" ? footerActions({ close, formId, dialog }) : null,
        btn({ onclick: close }, cancelLabel),
        btn({
          class: "st-btn-primary",
          "data-ai-agent-save": "true",
          onclick: async () => saveFromForm({ form: document.getElementById(formId), close }),
        }, icon("save", "sm"), saveLabel)
      ),
    });
    dialog.open();
    window.setTimeout(() => loadModelsForCurrentProvider({ force: true }), 0);
    return dialog;
  };

  return {
    open,
    openRuntimeEditorShell,
    contractFromForm,
    splitList,
  };
})();
