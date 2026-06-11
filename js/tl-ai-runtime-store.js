window.TrackerLensAiRuntimeStore = (() => {
  const DB_NAME = "TrackersLens";
  const STORES = {
    providers: "tl_ai_providers",
    agents: "tl_ai_agents",
    runtime: "tl_ai_runtime",
    jobs: "tl_ai_jobs",
    logs: "tl_ai_logs",
    memory: "tl_ai_memory",
    prompts: "tl_ai_prompts",
    promptFlows: "tl_ai_prompt_flows",
    metrics: "tl_ai_metrics",
  };
  const BASE_STORES = ["tl_widgets", "tl_pages", "tl_connections"];
  const MEMORY_SCOPES = ["short", "workspace", "global"];
  const MEMORY_LIMITS = {
    short: 120,
    workspace: 500,
    global: 1000,
  };
  const LOCAL_PROVIDER_DEFS = [
    {
      id: "local_ollama",
      name: "Ollama",
      provider: "ollama",
      model: "llama3.1",
      endpoint: "http://127.0.0.1:11434",
      healthPath: "/api/tags",
      local: true,
      priority: 10,
      status: "idle",
      icon: "memory",
    },
    {
      id: "local_lm_studio",
      name: "LM Studio",
      provider: "lm-studio",
      model: "local-model",
      endpoint: "http://127.0.0.1:1234/v1",
      healthPath: "/models",
      local: true,
      priority: 20,
      status: "idle",
      icon: "dns",
    },
  ];
  const STORE_INDEXES = {
    [STORES.providers]: ["status", "updatedAt"],
    [STORES.agents]: ["status", "updatedAt", "workspaceId"],
    [STORES.runtime]: ["status", "updatedAt", "workspaceId", "templateId"],
    [STORES.jobs]: ["status", "updatedAt", "workspaceId", "agentId"],
    [STORES.logs]: ["status", "updatedAt", "workspaceId", "agentId"],
    [STORES.memory]: ["status", "updatedAt", "scope", "workspaceId", "agentId", "kind"],
    [STORES.prompts]: ["status", "updatedAt", "workspaceId"],
    [STORES.promptFlows]: ["status", "updatedAt", "workspaceId"],
    [STORES.metrics]: ["status", "updatedAt", "workspaceId", "agentId"],
  };

  const normalizeText = (value, fallback = "") => {
    if (value === null || value === undefined) return fallback;
    return String(value).trim() || fallback;
  };

  const contentOf = (record) =>
    record?.content && typeof record.content === "object" ? record.content : record || {};

  const safeId = (value = "") => normalizeText(value, "memory").replace(/[^A-Za-z0-9_-]/g, "_");
  const providerKey = (provider = {}) => normalizeText(provider.id || provider.provider || provider.name).toLowerCase();

  const createIndexes = (store, indexes = []) => {
    indexes.forEach((indexName) => {
      if (!store.indexNames.contains(indexName)) {
        store.createIndex(indexName, indexName, { unique: false });
      }
    });
  };

  const openDb = (version = undefined) =>
    new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("IndexedDB non disponibile"));
        return;
      }

      const request = version ? indexedDB.open(DB_NAME, version) : indexedDB.open(DB_NAME);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        Object.entries(STORE_INDEXES).forEach(([storeName, indexes]) => {
          const store = db.objectStoreNames.contains(storeName)
            ? event.target.transaction.objectStore(storeName)
            : db.createObjectStore(storeName, { keyPath: "id" });
          createIndexes(store, indexes);
        });
      };
      request.onsuccess = (event) => {
        const db = event.target.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = (event) => reject(event.target.error || new Error("Errore apertura IndexedDB"));
      request.onblocked = () => reject(new Error("IndexedDB bloccato da un'altra scheda"));
    });

  const ensureStores = async () => {
    const db = await openDb();
    const missing = Object.values(STORES).filter((storeName) => !db.objectStoreNames.contains(storeName));
    const missingIndexes = Object.entries(STORE_INDEXES).some(([storeName, indexes]) => {
      if (!db.objectStoreNames.contains(storeName)) return true;
      const transaction = db.transaction(storeName, "readonly");
      const store = transaction.objectStore(storeName);
      return indexes.some((indexName) => !store.indexNames.contains(indexName));
    });
    if (!missing.length && !missingIndexes) return db;

    const nextVersion = db.version + 1;
    db.close();
    return openDb(nextVersion);
  };

  const readAllFromDb = (db, storeName) =>
    new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains(storeName)) {
        resolve([]);
        return;
      }

      const transaction = db.transaction(storeName, "readonly");
      const request = transaction.objectStore(storeName).getAll();
      request.onsuccess = (event) => resolve(Array.from(event.target.result || []));
      request.onerror = (event) => reject(event.target.error || new Error(`Errore lettura ${storeName}`));
    });

  const write = async (storeName, record) => {
    const db = await ensureStores();
    try {
      const now = new Date().toISOString();
      const payload = {
        ...record,
        id: normalizeText(record.id, `${storeName}_${Date.now()}`),
        updatedAt: now,
        createdAt: normalizeText(record.createdAt, now),
      };
      return await new Promise((resolve, reject) => {
        const request = db.transaction(storeName, "readwrite").objectStore(storeName).put(payload);
        request.onsuccess = () => resolve(payload);
        request.onerror = (event) => reject(event.target.error || new Error(`Errore salvataggio ${storeName}`));
      });
    } finally {
      db.close();
    }
  };

  const deleteRecord = async (storeName, id) => {
    if (!id) return null;
    const db = await ensureStores();
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction(storeName, "readwrite").objectStore(storeName).delete(id);
        request.onsuccess = () => resolve(id);
        request.onerror = (event) => reject(event.target.error || new Error(`Errore eliminazione ${storeName}`));
      });
    } finally {
      db.close();
    }
  };

  const statusTone = (value = "") => {
    const status = String(value).toLowerCase();
    if (["error", "failed", "timeout", "offline"].includes(status)) return "error";
    if (["queued", "warning", "warn", "idle"].includes(status)) return "warn";
    if (["completed", "complete", "done", "success"].includes(status)) return "complete";
    return "online";
  };

  const normalizeProvider = (record, index) => {
    const content = contentOf(record);
    const local = Boolean(content.local || content.localFirst || /^local_/.test(record?.id || content.id || ""));
    return {
      id: normalizeText(record?.id || content.id, `provider_${index}`),
      name: normalizeText(content.name || content.provider, "Provider AI"),
      provider: normalizeText(content.provider || content.name, "custom"),
      model: normalizeText(content.model || content.defaultModel || content.runtime?.model, "modello non configurato"),
      endpoint: normalizeText(content.endpoint || content.baseUrl || content.runtime?.endpoint),
      healthPath: normalizeText(content.healthPath || content.runtime?.healthPath),
      status: normalizeText(content.status || content.state, "idle"),
      latencyMs: Number(content.latencyMs || content.latency || 0),
      local,
      priority: Number(content.priority || (local ? 50 : 100)),
      icon: normalizeText(content.icon, local ? "memory" : "psychology"),
      updatedAt: normalizeText(content.updatedAt || record?.updatedAt || content.createdAt || record?.createdAt),
      raw: record,
    };
  };

  const normalizeAgent = (record, index) => {
    const content = contentOf(record);
    const runtime = content.runtime && typeof content.runtime === "object" ? content.runtime : {};
    const provider = content.provider && typeof content.provider === "object" ? content.provider : {};
    const channels = content.channels && typeof content.channels === "object" ? content.channels : {};
    const prompt = content.promptConfig && typeof content.promptConfig === "object" ? content.promptConfig : {};
    const memory = content.memory && typeof content.memory === "object" ? content.memory : {};
    const permissions = content.permissions && typeof content.permissions === "object" ? content.permissions : {};
    const debug = content.debug && typeof content.debug === "object" ? content.debug : {};
    const metrics = content.metrics && typeof content.metrics === "object" ? content.metrics : {};
    return {
      id: normalizeText(record?.id || content.id, `agent_${index}`),
      name: normalizeText(content.name || content.title, "AI Agent"),
      description: normalizeText(content.description || content.prompt || content.task, "Agente AI locale"),
      status: normalizeText(content.status || content.state, content.active === false ? "idle" : "active"),
      icon: normalizeText(content.icon, "psychology"),
      color: normalizeText(content.color || content.tone, "violet"),
      category: normalizeText(content.category, "Runtime Intelligence"),
      tags: Array.isArray(content.tags) ? content.tags.map(String) : normalizeText(content.tags).split(",").map((item) => item.trim()).filter(Boolean),
      version: normalizeText(content.version, "1.0.0"),
      scope: normalizeText(content.scope || content.kind, "template"),
      workspaceId: normalizeText(content.workspaceId || record?.workspaceId),
      templateId: normalizeText(content.templateId || record?.templateId),
      runtime,
      provider,
      channels,
      promptConfig: prompt,
      memory,
      permissions,
      debug,
      metrics,
      updatedAt: normalizeText(content.updatedAt || record?.updatedAt || content.createdAt || record?.createdAt),
      raw: record,
    };
  };

  const normalizeRuntimeAgent = (record, index) => {
    const normalized = normalizeAgent({ ...record, scope: "runtime" }, index);
    return {
      ...normalized,
      id: normalizeText(record?.id || normalized.id, `runtime_agent_${index}`),
      scope: "runtime",
      templateId: normalizeText(record?.templateId || normalized.templateId),
      workspaceId: normalizeText(record?.workspaceId || normalized.workspaceId, "workspace_global"),
    };
  };

  const normalizeJob = (record, index) => {
    const content = contentOf(record);
    return {
      id: normalizeText(record?.id || content.id, `job_${index}`),
      workspaceId: normalizeText(content.workspaceId || record?.workspaceId),
      runId: normalizeText(content.runId || record?.runId),
      agentId: normalizeText(content.agentId || record?.agentId),
      agent: normalizeText(content.agent || content.agentName || content.source || content.name, "Runtime AI"),
      task: normalizeText(content.task || content.title || content.prompt || content.description, "Job AI"),
      status: normalizeText(content.status || content.state, "queued"),
      provider: normalizeText(content.provider || content.result?.provider),
      model: normalizeText(content.model || content.result?.model),
      prompt: normalizeText(content.prompt || content.result?.prompt),
      memoryContext: normalizeText(content.memoryContext || content.result?.memoryContext),
      startedAt: normalizeText(content.startedAt || content.createdAt || record?.createdAt || content.updatedAt || record?.updatedAt),
      durationMs: Number(content.durationMs || content.duration || 0),
      tokens: Number(content.tokens || content.tokenCount || content.usage?.total_tokens || content.result?.usage?.totalTokens || 0),
      cost: content.cost || content.result?.cost || null,
      result: content.result || null,
      updatedAt: normalizeText(content.updatedAt || record?.updatedAt || content.startedAt || record?.createdAt),
      raw: record,
    };
  };

  const normalizeLog = (record, index) => {
    const content = contentOf(record);
    return {
      id: normalizeText(record?.id || content.id, `log_${index}`),
      time: normalizeText(content.time || content.createdAt || record?.createdAt || content.updatedAt || record?.updatedAt),
      source: normalizeText(content.source || content.agent || content.name, "AI Runtime"),
      message: normalizeText(content.message || content.result || content.description, "Evento runtime AI"),
      status: normalizeText(content.status || content.level, "info"),
      updatedAt: normalizeText(content.updatedAt || record?.updatedAt || content.time || record?.createdAt),
      raw: record,
    };
  };

  const normalizeMemory = (record, index) => {
    const content = contentOf(record);
    const count = Array.isArray(content.items) ? content.items.length : Number(content.count || content.itemsCount || 0);
    const scope = MEMORY_SCOPES.includes(content.scope) ? content.scope : "workspace";
    return {
      id: normalizeText(record?.id || content.id, `memory_${index}`),
      scope,
      workspaceId: normalizeText(content.workspaceId || record?.workspaceId, scope === "global" ? "global" : "workspace_global"),
      agentId: normalizeText(content.agentId || content.agent || record?.agentId, "shared"),
      kind: normalizeText(content.kind || content.type, "note"),
      name: normalizeText(content.name || content.title || content.key, scope === "short" ? "Short memory" : scope === "global" ? "Global memory" : "Workspace memory"),
      meta: normalizeText(content.meta || content.description || content.summary || content.updatedAt || record?.updatedAt, "Context locale"),
      text: normalizeText(content.text || content.value || content.content || content.summary),
      tags: Array.isArray(content.tags) ? content.tags.map(String) : [],
      weight: Number(content.weight || content.score || 1),
      count: count || 1,
      icon: normalizeText(content.icon, scope === "short" ? "history" : scope === "global" ? "database" : "dashboard_customize"),
      updatedAt: normalizeText(content.updatedAt || record?.updatedAt || content.createdAt || record?.createdAt),
      raw: record,
    };
  };

  const normalizePromptFlow = (record, index) => {
    const content = contentOf(record);
    return {
      id: normalizeText(record?.id || content.id, `prompt_flow_${index}`),
      name: normalizeText(content.name || content.title, "Prompt"),
      description: normalizeText(content.description || content.summary || content.meta, "Prompt salvato"),
      prompt: normalizeText(content.prompt || content.text || content.value || content.content),
      category: normalizeText(content.category || content.group || content.type, "Generale"),
      status: normalizeText(content.status || content.state, "idle"),
      blocks: Array.isArray(content.blocks) ? content.blocks : [],
      icon: normalizeText(content.icon, "psychology"),
      tone: normalizeText(content.tone || content.color, "gold"),
      updatedAt: normalizeText(content.updatedAt || record?.updatedAt || content.createdAt || record?.createdAt),
      raw: record,
    };
  };

  const normalizeMetric = (record, index) => {
    const content = contentOf(record);
    return {
      id: normalizeText(record?.id || content.id, `ai_metric_${index}`),
      workspaceId: normalizeText(content.workspaceId || record?.workspaceId),
      agentId: normalizeText(content.agentId || record?.agentId),
      executionCount: Number(content.executionCount || content.count || 0),
      avgResponseTimeMs: Number(content.avgResponseTimeMs || content.latencyMs || 0),
      tokenUsage: Number(content.tokenUsage || content.tokens || 0),
      successRate: Number(content.successRate || 0),
      queueSize: Number(content.queueSize || 0),
      activeJobs: Number(content.activeJobs || 0),
      memoryUsage: Number(content.memoryUsage || 0),
      status: normalizeText(content.status || content.state, "idle"),
      updatedAt: normalizeText(content.updatedAt || record?.updatedAt || content.createdAt || record?.createdAt),
      raw: record,
    };
  };

  const normalizeWidget = (record, index) => {
    const content = contentOf(record);
    return {
      id: normalizeText(record?.id || content.id, `widget_${index}`),
      name: normalizeText(content.name || content.title, "Widget"),
      type: normalizeText(content.type || content.kind || content.boxType, "boxLens"),
      category: normalizeText(content.category || content.trackerType || content.source, "Local"),
      description: normalizeText(content.description || content.prompt || content.query),
      endpoint: normalizeText(content.endpoint || content.runtime?.endpoint),
      active: content.active !== false,
      updatedAt: normalizeText(content.updatedAt || record?.updatedAt || content.createdAt || record?.createdAt),
      raw: record,
    };
  };

  const normalizeWorkspace = (record, index) => {
    const content = contentOf(record);
    return {
      id: normalizeText(record?.id || content.id, `workspace_${index}`),
      name: normalizeText(content.name || content.title, `Workspace ${index + 1}`),
      boxes: Array.isArray(content.boxes) ? content.boxes : [],
      connections: Array.isArray(content.connections) ? content.connections : [],
      updatedAt: normalizeText(content.updatedAt || record?.updatedAt || content.createdAt || record?.createdAt),
      raw: record,
    };
  };

  const isAiLike = (item) => /ai|openai|anthropic|gemini|ollama|llm|prompt|agent|model|gpt|claude/i.test([
    item.name,
    item.type,
    item.category,
    item.description,
    item.endpoint,
    item.provider,
  ].filter(Boolean).join(" "));

  const derivedAgents = (widgets, pages, connections) => {
    const widgetAgents = widgets.filter(isAiLike).map((widget, index) => ({
      id: `widget_agent_${widget.id}`,
      name: widget.name,
      description: widget.description || `${widget.type} · ${widget.category}`,
      status: widget.active ? "active" : "idle",
      icon: widget.type === "boxTracker" ? "radar" : "psychology",
      updatedAt: widget.updatedAt,
      raw: widget.raw,
    }));
    const connectionAgents = connections.filter(isAiLike).map((connection, index) => ({
      id: `connection_agent_${connection.id || index}`,
      name: connection.name || connection.from || "AI Connection",
      description: `${connection.type || "Connessione"} · ${connection.result || connection.status || "locale"}`,
      status: connection.status || "active",
      icon: "hub",
      updatedAt: connection.updatedAt || connection.createdAt,
      raw: connection.raw || connection,
    }));
    const workspaceAgents = pages.flatMap((page) =>
      page.boxes.filter(isAiLike).map((box) => ({
        id: `workspace_agent_${page.id}_${box.id}`,
        name: box.name || box.title || "AI box",
        description: `${page.name} · ${box.type || "box"}`,
        status: box.active === false ? "idle" : "active",
        icon: box.type === "boxTracker" ? "radar" : "dashboard_customize",
        updatedAt: page.updatedAt,
        raw: box,
      }))
    );
    return [...widgetAgents, ...connectionAgents, ...workspaceAgents];
  };

  const derivedMemory = (widgets, pages, connections) => [
    { id: "memory_widgets", scope: "global", name: "Widget AI rilevati", meta: "tl_widgets", count: widgets.filter(isAiLike).length, icon: "deployed_code" },
    { id: "memory_workspaces", scope: "workspace", name: "Workspace context", meta: "tl_pages", count: pages.reduce((sum, page) => sum + page.boxes.length, 0), icon: "dashboard_customize" },
    { id: "memory_connections", scope: "workspace", name: "Connessioni AI", meta: "tl_connections", count: connections.filter(isAiLike).length, icon: "hub" },
  ].filter((item) => item.count > 0);

  const scopeSummaryMemory = (records = []) => {
    const grouped = MEMORY_SCOPES.map((scope) => {
      const items = records.filter((item) => item.scope === scope);
      return {
        id: `memory_scope_${scope}`,
        scope,
        name: scope === "short" ? "Short memory" : scope === "workspace" ? "Workspace memory" : "Global memory",
        meta: scope === "short" ? "Sessione locale" : scope === "workspace" ? "Context per workspace" : "Conoscenza globale locale",
        count: items.length,
        icon: scope === "short" ? "history" : scope === "workspace" ? "dashboard_customize" : "database",
        updatedAt: items.map((item) => item.updatedAt).filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || "",
        raw: { items },
      };
    });
    return grouped.filter((item) => item.count > 0);
  };

  const normalizeMemoryInput = (record = {}) => {
    const now = new Date().toISOString();
    const scope = MEMORY_SCOPES.includes(record.scope) ? record.scope : "workspace";
    const workspaceId = normalizeText(record.workspaceId, scope === "global" ? "global" : "workspace_global");
    const agentId = normalizeText(record.agentId || record.agent, "shared");
    const kind = normalizeText(record.kind || record.type, "note");
    const text = normalizeText(record.text || record.content || record.value || record.summary);
    const baseId = [
      "mem",
      scope,
      workspaceId,
      agentId,
      kind,
      Date.now(),
    ].map(safeId).join("_");
    return {
      status: normalizeText(record.status, "active"),
      createdAt: normalizeText(record.createdAt, now),
      ...record,
      id: normalizeText(record.id, baseId),
      scope,
      workspaceId,
      agentId,
      kind,
      name: normalizeText(record.name || record.title, kind === "fact" ? "Fact" : "Memory"),
      text,
      summary: normalizeText(record.summary, text.slice(0, 160)),
      tags: Array.isArray(record.tags) ? record.tags.map(String) : [],
      weight: Number(record.weight || 1),
      updatedAt: now,
    };
  };

  const readMemoryRecords = async () => {
    const db = await ensureStores();
    try {
      return (await readAllFromDb(db, STORES.memory)).map(normalizeMemory);
    } finally {
      db.close();
    }
  };

  const memoryQueryScore = (item = {}, query = "") => {
    const q = normalizeText(query).toLowerCase();
    if (!q) return 1;
    const haystack = [item.name, item.kind, item.meta, item.text, item.tags.join(" ")]
      .join(" ")
      .toLowerCase();
    if (haystack.includes(q)) return 100;
    const tokens = q.split(/[^a-z0-9._:-]+/i).filter((token) => token.length > 2);
    if (!tokens.length) return 0;
    return tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
  };

  const listMemory = async ({ scope = "", workspaceId = "", agentId = "", query = "", limit = 50 } = {}) => {
    const records = await readMemoryRecords();
    return records
      .filter((item) => !scope || item.scope === scope)
      .filter((item) => !workspaceId || item.workspaceId === workspaceId || item.scope === "global")
      .filter((item) => !agentId || item.agentId === agentId || item.agentId === "shared")
      .map((item) => ({ item, queryScore: memoryQueryScore(item, query) }))
      .filter(({ queryScore }) => !query || queryScore > 0)
      .sort((a, b) => (b.queryScore - a.queryScore) || (b.item.weight - a.item.weight) || (new Date(b.item.updatedAt) - new Date(a.item.updatedAt)))
      .map(({ item }) => item)
      .slice(0, limit);
  };

  const buildMemoryContext = async ({ workspaceId = "", agentId = "", query = "", limit = 12 } = {}) => {
    const scoped = await Promise.all([
      listMemory({ scope: "short", workspaceId, agentId, query, limit: Math.ceil(limit / 3) }),
      listMemory({ scope: "workspace", workspaceId, agentId, query, limit: Math.ceil(limit / 3) }),
      listMemory({ scope: "global", workspaceId, agentId, query, limit: Math.ceil(limit / 3) }),
    ]);
    return scoped.flat().slice(0, limit).map((item) => ({
      id: item.id,
      scope: item.scope,
      kind: item.kind,
      name: item.name,
      text: item.text || item.meta || item.name,
      summary: item.raw?.summary || item.meta || "",
      meta: item.meta || "",
      weight: item.weight,
      tags: item.tags,
      updatedAt: item.updatedAt,
    }));
  };

  const cleanupShortMemory = async ({ limit = MEMORY_LIMITS.short } = {}) => {
    const records = await listMemory({ scope: "short", limit: 10000 });
    const stale = records.slice(limit);
    await Promise.all(stale.map((item) => deleteRecord(STORES.memory, item.id)));
    return { deleted: stale.length, kept: Math.min(records.length, limit) };
  };

  const remember = async (record = {}) => {
    const payload = normalizeMemoryInput(record);
    const saved = await write(STORES.memory, payload);
    if (payload.scope === "short") cleanupShortMemory().catch((error) => console.warn("Cleanup short memory non completato:", error));
    return normalizeMemory(saved, 0);
  };

  const forgetMemory = (id) => deleteRecord(STORES.memory, id);

  const localProviderDefaults = () => LOCAL_PROVIDER_DEFS.map((provider) => ({ ...provider }));

  const seedLocalProviders = async () => {
    const db = await ensureStores();
    try {
      const existing = (await readAllFromDb(db, STORES.providers)).map(normalizeProvider);
      const existingKeys = new Set(existing.map(providerKey));
      const missing = LOCAL_PROVIDER_DEFS.filter((provider) => !existingKeys.has(providerKey(provider)));
      await Promise.all(missing.map((provider) => write(STORES.providers, {
        ...provider,
        status: "idle",
        localFirst: true,
      })));
      return { created: missing.length, existing: existing.length };
    } finally {
      db.close();
    }
  };

  const providerHealthUrl = (provider = {}) => {
    const endpoint = normalizeText(provider.endpoint || provider.baseUrl).replace(/\/+$/g, "");
    const path = normalizeText(provider.healthPath, provider.provider === "ollama" ? "/api/tags" : "/models");
    return `${endpoint}${path.startsWith("/") ? path : `/${path}`}`;
  };

  const probeProvider = async (provider = {}, { timeoutMs = 1400 } = {}) => {
    const started = performance.now();
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(providerHealthUrl(provider), {
        method: "GET",
        signal: controller.signal,
      });
      const latencyMs = Math.max(1, Math.round(performance.now() - started));
      const status = response.ok ? "online" : "offline";
      const next = await write(STORES.providers, {
        ...provider,
        status,
        latencyMs,
        lastProbeAt: new Date().toISOString(),
      });
      return normalizeProvider(next, 0);
    } catch (error) {
      const latencyMs = Math.max(1, Math.round(performance.now() - started));
      const next = await write(STORES.providers, {
        ...provider,
        status: "offline",
        latencyMs,
        lastError: error?.message || "Provider probe failed",
        lastProbeAt: new Date().toISOString(),
      });
      return normalizeProvider(next, 0);
    } finally {
      window.clearTimeout(timer);
    }
  };

  const probeLocalProviders = async () => {
    await seedLocalProviders();
    const providers = await list().then((data) => data.providers);
    const localProviders = providers.filter((provider) => provider.local);
    return Promise.all(localProviders.map((provider) => probeProvider(provider)));
  };

  const list = async () => {
    const db = await ensureStores();
    try {
      const [providerRecords, agentRecords, runtimeRecords, jobRecords, logRecords, memoryRecords, promptRecords, promptFlowRecords, metricRecords, widgetRecords, pageRecords, connectionRecords] = await Promise.all([
        readAllFromDb(db, STORES.providers),
        readAllFromDb(db, STORES.agents),
        readAllFromDb(db, STORES.runtime),
        readAllFromDb(db, STORES.jobs),
        readAllFromDb(db, STORES.logs),
        readAllFromDb(db, STORES.memory),
        readAllFromDb(db, STORES.prompts),
        readAllFromDb(db, STORES.promptFlows),
        readAllFromDb(db, STORES.metrics),
        readAllFromDb(db, "tl_widgets"),
        readAllFromDb(db, "tl_pages"),
        window.TrackerLensConnectionsStore?.list?.() || readAllFromDb(db, "tl_connections"),
      ]);
      const widgets = widgetRecords.map(normalizeWidget);
      const pages = pageRecords.map(normalizeWorkspace);
      const connections = connectionRecords;
      const agents = [
        ...agentRecords.map(normalizeAgent),
        ...runtimeRecords.map(normalizeRuntimeAgent),
        ...derivedAgents(widgets, pages, connections),
      ];
      const memoryRecordsNormalized = memoryRecords.map(normalizeMemory);

      const normalizedProviders = providerRecords.map(normalizeProvider);
      const seededLocalProviders = localProviderDefaults()
        .filter((provider) => !normalizedProviders.some((item) => providerKey(item) === providerKey(provider)))
        .map(normalizeProvider);
      const providers = [...normalizedProviders, ...seededLocalProviders]
        .sort((a, b) => (Number(a.priority) || 100) - (Number(b.priority) || 100));

      return {
        providers,
        agents,
        jobs: jobRecords.map(normalizeJob),
        logs: logRecords.map(normalizeLog),
        memory: [
          ...scopeSummaryMemory(memoryRecordsNormalized),
          ...memoryRecordsNormalized.slice(0, 8),
          ...derivedMemory(widgets, pages, connections),
        ],
        promptFlows: [...promptRecords, ...promptFlowRecords].map(normalizePromptFlow),
        runtime: runtimeRecords.map(normalizeRuntimeAgent),
        metrics: metricRecords.map(normalizeMetric),
        widgets,
        pages,
        connections,
        stores: BASE_STORES.concat(Object.values(STORES)),
      };
    } finally {
      db.close();
    }
  };

  return {
    STORES,
    MEMORY_SCOPES,
    MEMORY_LIMITS,
    LOCAL_PROVIDER_DEFS,
    buildMemoryContext,
    cleanupShortMemory,
    forgetMemory,
    list,
    listMemory,
    localProviderDefaults,
    probeLocalProviders,
    probeProvider,
    remember,
    seedLocalProviders,
    upsertProvider: (record) => write(STORES.providers, record),
    deleteProvider: (id) => deleteRecord(STORES.providers, id),
    upsertAgent: (record) => write(STORES.agents, record),
    upsertRuntimeAgent: (record) => write(STORES.runtime, record),
    deleteAgent: (id) => deleteRecord(STORES.agents, id),
    deleteRuntimeAgent: (id) => deleteRecord(STORES.runtime, id),
    upsertJob: (record) => write(STORES.jobs, record),
    upsertLog: (record) => write(STORES.logs, record),
    upsertMemory: remember,
    upsertMetric: (record) => write(STORES.metrics, record),
    upsertPrompt: (record) => write(STORES.prompts, record),
    upsertPromptFlow: (record) => write(STORES.prompts, record),
    deletePromptFlow: async (id) => {
      await deleteRecord(STORES.prompts, id);
      return deleteRecord(STORES.promptFlows, id);
    },
    statusTone,
  };
})();
