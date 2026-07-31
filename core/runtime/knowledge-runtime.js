window.TrackerLensKnowledgeRuntime = (() => {
  const instances = new Map();
  const tokenUsageTotals = new Map();
  const graphAutoClearRuns = new Set();
  const DB_NAME = window.tlConfig?.DB_NAME || "TrackersLens";

  const tableName = (key, fallback) => window.tlConfig?.TABLES?.[key] || fallback;
  const STORES = {
    documents: tableName("TL_KNOWLEDGE_DOCUMENTS", "tl_knowledge_documents"),
    chunks: tableName("TL_KNOWLEDGE_CHUNKS", "tl_knowledge_chunks"),
    embeddings: tableName("TL_KNOWLEDGE_EMBEDDINGS", "tl_knowledge_embeddings"),
    entities: tableName("TL_KNOWLEDGE_ENTITIES", "tl_knowledge_entities"),
    relations: tableName("TL_KNOWLEDGE_RELATIONS", "tl_knowledge_relations"),
    dictionary: tableName("TL_KNOWLEDGE_DICTIONARY", "tl_knowledge_dictionary"),
    events: tableName("TL_KNOWLEDGE_EVENTS", "tl_knowledge_events"),
    structured: tableName("TL_STRUCTURED_KNOWLEDGE", "tl_structured_knowledge"),
    queries: tableName("TL_KNOWLEDGE_QUERIES", "tl_knowledge_queries"),
    sources: tableName("TL_KNOWLEDGE_SOURCES", "tl_knowledge_sources"),
    metrics: tableName("TL_KNOWLEDGE_METRICS", "tl_knowledge_metrics"),
  };

  const STORE_DEFINITIONS = [
    { name: STORES.documents, columns: ["workspaceId", "sourceId", "status", "createdAt", "updatedAt"] },
    { name: STORES.chunks, columns: ["workspaceId", "documentId", "sourceId", "createdAt"] },
    { name: STORES.embeddings, columns: ["workspaceId", "documentId", "chunkId", "provider", "model", "createdAt"] },
    { name: STORES.entities, columns: ["workspaceId", "documentId", "chunkId", "entityType", "createdAt"] },
    { name: STORES.relations, columns: ["workspaceId", "sourceEntityId", "targetEntityId", "relationType", "createdAt"] },
    { name: STORES.dictionary, columns: ["workspaceId", "documentId", "collectionId", "language", "term", "lemma", "scope", "createdAt"] },
    { name: STORES.events, columns: ["workspaceId", "documentId", "collectionId", "chunkId", "eventType", "sequence", "createdAt"] },
    { name: STORES.structured, columns: ["workspaceId", "collectionId", "schemaId", "recordType", "parentId", "worldId", "createdAt"] },
    { name: STORES.queries, columns: ["workspaceId", "query", "status", "createdAt"] },
    { name: STORES.sources, columns: ["workspaceId", "sourceType", "status", "createdAt"] },
    { name: STORES.metrics, columns: ["workspaceId", "metric", "createdAt"] },
  ];

  const nowIso = () => new Date().toISOString();
  const safeId = (value = "knowledge") =>
    String(value || "knowledge")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9_-]/g, "_")
      .slice(0, 80) || "knowledge";
  const uniqueId = (prefix = "knowledge") => {
    if (window.crypto?.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  };

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

  const textOf = (value = "") => {
    if (typeof value === "string") return value;
    if (value === null || value === undefined) return "";
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };

  const createIndexes = (store, columns = []) => {
    columns.forEach((column) => {
      if (!store.indexNames.contains(column)) store.createIndex(column, column, { unique: false });
    });
  };

  const ensureStores = () => new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB non disponibile"));
      return;
    }
    const request = indexedDB.open(DB_NAME);
    request.onerror = (event) => reject(event.target.error || new Error("Errore apertura IndexedDB"));
    request.onsuccess = (event) => {
      const db = event.target.result;
      const missing = STORE_DEFINITIONS.filter((definition) => !db.objectStoreNames.contains(definition.name));
      if (!missing.length) {
        resolve(db);
        return;
      }
      const nextVersion = db.version + 1;
      db.close();
      const upgrade = indexedDB.open(DB_NAME, nextVersion);
      upgrade.onerror = (errorEvent) => reject(errorEvent.target.error || new Error("Errore upgrade IndexedDB Knowledge"));
      upgrade.onupgradeneeded = (upgradeEvent) => {
        const upgradeDb = upgradeEvent.target.result;
        STORE_DEFINITIONS.forEach((definition) => {
          if (upgradeDb.objectStoreNames.contains(definition.name)) return;
          createIndexes(upgradeDb.createObjectStore(definition.name, { keyPath: "id" }), definition.columns);
        });
      };
      upgrade.onsuccess = (upgradeEvent) => resolve(upgradeEvent.target.result);
    };
  });

  const putRecord = async (storeName, record = {}) => {
    const db = await ensureStores();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, "readwrite");
        transaction.objectStore(storeName).put(record);
        transaction.oncomplete = () => resolve(record);
        transaction.onerror = (event) => reject(event.target.error || new Error(`Errore scrittura ${storeName}`));
      });
    } finally {
      db.close();
    }
  };

  const listStore = async (storeName) => {
    const db = await ensureStores();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, "readonly");
        const request = transaction.objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = (event) => reject(event.target.error || new Error(`Errore lettura ${storeName}`));
      });
    } finally {
      db.close();
    }
  };

  const getRecord = async (storeName, id = "") => {
    if (!id) return null;
    const db = await ensureStores();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, "readonly");
        const request = transaction.objectStore(storeName).get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = (event) => reject(event.target.error || new Error(`Errore lettura ${storeName}`));
      });
    } finally {
      db.close();
    }
  };

  const deleteRecords = async (storeName, ids = []) => {
    const safeIds = [...new Set((ids || []).filter(Boolean).map(String))];
    if (!safeIds.length) return [];
    const db = await ensureStores();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, "readwrite");
        const store = transaction.objectStore(storeName);
        safeIds.forEach((id) => store.delete(id));
        transaction.oncomplete = () => resolve(safeIds);
        transaction.onerror = (event) => reject(event.target.error || new Error(`Errore eliminazione ${storeName}`));
      });
    } finally {
      db.close();
    }
  };

  const byWorkspace = (records = [], workspaceId = "workspace_global") =>
    records.filter((record) => (record.workspaceId || "workspace_global") === workspaceId);

  const deleteChunksAndEmbeddings = async ({ workspaceId, documentId = "" } = {}) => {
    if (!documentId) return { chunks: 0, embeddings: 0 };
    const [chunks, embeddings] = await Promise.all([
      listStore(STORES.chunks),
      listStore(STORES.embeddings),
    ]);
    const staleChunks = byWorkspace(chunks, workspaceId).filter((chunk) => chunk.documentId === documentId);
    const staleChunkIds = new Set(staleChunks.map((chunk) => chunk.id));
    const staleEmbeddings = byWorkspace(embeddings, workspaceId)
      .filter((embedding) => embedding.documentId === documentId || staleChunkIds.has(embedding.chunkId));
    await Promise.all([
      deleteRecords(STORES.embeddings, staleEmbeddings.map((embedding) => embedding.id)),
      deleteRecords(STORES.chunks, staleChunks.map((chunk) => chunk.id)),
    ]);
    return { chunks: staleChunks.length, embeddings: staleEmbeddings.length };
  };

  const deleteEntitiesAndRelations = async ({ workspaceId, chunkIds = [], documentId = "" } = {}) => {
    const safeChunkIds = new Set((chunkIds || []).filter(Boolean).map(String));
    const [entities, relations] = await Promise.all([
      listStore(STORES.entities),
      listStore(STORES.relations),
    ]);
    const staleEntities = byWorkspace(entities, workspaceId).filter((entity) =>
      (documentId && entity.documentId === documentId) || safeChunkIds.has(entity.chunkId || "")
    );
    const staleEntityIds = new Set(staleEntities.map((entity) => entity.id));
    const staleRelations = byWorkspace(relations, workspaceId).filter((relation) =>
      staleEntityIds.has(relation.sourceEntityId) ||
      staleEntityIds.has(relation.targetEntityId) ||
      (documentId && relation.documentId === documentId) ||
      safeChunkIds.has(relation.chunkId || "")
    );
    await Promise.all([
      deleteRecords(STORES.relations, staleRelations.map((relation) => relation.id)),
      deleteRecords(STORES.entities, staleEntities.map((entity) => entity.id)),
    ]);
    return { entities: staleEntities.length, relations: staleRelations.length };
  };

  const clearGraphIndex = async ({ workspaceId, collectionId = "", documentId = "", graphScope = "" } = {}) => {
    const scope = String(graphScope || (documentId ? "document" : collectionId ? "collection" : "workspace")).toLowerCase();
    const [entities, relations, metrics, queries] = await Promise.all([
      listStore(STORES.entities),
      listStore(STORES.relations),
      listStore(STORES.metrics),
      listStore(STORES.queries),
    ]);
    const scopedEntities = byWorkspace(entities, workspaceId)
      .filter((entity) => !collectionId || entity.metadata?.collectionId === collectionId)
      .filter((entity) => scope !== "document" || !documentId || entity.documentId === documentId);
    const scopedEntityIds = new Set(scopedEntities.map((entity) => entity.id));
    const scopedDocumentIds = new Set(scopedEntities.map((entity) => entity.documentId).filter(Boolean));
    const scopedRelations = byWorkspace(relations, workspaceId)
      .filter((relation) =>
        scopedEntityIds.has(relation.sourceEntityId) ||
        scopedEntityIds.has(relation.targetEntityId) ||
        (scope === "document" && documentId && relation.documentId === documentId) ||
        (scope !== "document" && scopedDocumentIds.has(relation.documentId))
      )
      .filter((relation) => !collectionId || relation.metadata?.collectionId === collectionId);
    const scopedMetrics = byWorkspace(metrics, workspaceId)
      .filter((metric) => metric.metric === "knowledge.graph.snapshot")
      .filter((metric) => !collectionId || metric.value?.collectionId === collectionId)
      .filter((metric) => scope !== "document" || !documentId || metric.value?.documentId === documentId);
    const scopedQueries = byWorkspace(queries, workspaceId)
      .filter((query) => !collectionId || query.scope?.collectionId === collectionId || query.collectionId === collectionId)
      .filter((query) => scope !== "document" || !documentId || query.scope?.documentId === documentId || query.documentId === documentId);
    await Promise.all([
      deleteRecords(STORES.relations, scopedRelations.map((relation) => relation.id)),
      deleteRecords(STORES.entities, scopedEntities.map((entity) => entity.id)),
      deleteRecords(STORES.metrics, scopedMetrics.map((metric) => metric.id)),
      deleteRecords(STORES.queries, scopedQueries.map((query) => query.id)),
    ]);
    return {
      entities: scopedEntities.length,
      relations: scopedRelations.length,
      snapshots: scopedMetrics.length,
      queries: scopedQueries.length,
      documentIds: [...scopedDocumentIds],
      graphScope: scope,
      collectionId,
      documentId: scope === "document" ? documentId : "",
    };
  };

  const deleteSemanticRelations = async ({ workspaceId, collectionId = "", documentId = "", nodeId = "" } = {}) => {
    const relations = await listStore(STORES.relations);
    const staleRelations = byWorkspace(relations, workspaceId)
      .filter((relation) => relation.metadata?.semantic)
      .filter((relation) => !relation.metadata?.graphBuilder)
      .filter((relation) => !collectionId || relation.metadata?.collectionId === collectionId)
      .filter((relation) => !documentId || relation.documentId === documentId)
      .filter((relation) => !nodeId || relation.metadata?.nodeId === nodeId);
    await deleteRecords(STORES.relations, staleRelations.map((relation) => relation.id));
    return { relations: staleRelations.length, ids: staleRelations.map((relation) => relation.id) };
  };

  const clearGraphSnapshots = async ({ workspaceId, collectionId = "", documentId = "", graphScope = "" } = {}) => {
    const scope = String(graphScope || (documentId ? "document" : collectionId ? "collection" : "workspace")).toLowerCase();
    const metrics = await listStore(STORES.metrics);
    const scopedMetrics = byWorkspace(metrics, workspaceId)
      .filter((metric) => metric.metric === "knowledge.graph.snapshot")
      .filter((metric) => !collectionId || metric.value?.collectionId === collectionId)
      .filter((metric) => scope !== "document" || !documentId || metric.value?.documentId === documentId);
    await deleteRecords(STORES.metrics, scopedMetrics.map((metric) => metric.id));
    return { snapshots: scopedMetrics.length, graphScope: scope, collectionId, documentId: scope === "document" ? documentId : "" };
  };

  const deleteDictionaryEntries = async ({ workspaceId, documentId = "", chunkIds = [] } = {}) => {
    const safeChunkIds = new Set((chunkIds || []).filter(Boolean).map(String));
    if (!documentId && !safeChunkIds.size) return { dictionary: 0 };
    const entries = await listStore(STORES.dictionary);
    const staleEntries = byWorkspace(entries, workspaceId).filter((entry) =>
      (documentId && entry.documentId === documentId) || safeChunkIds.has(entry.chunkId || "")
    );
    await deleteRecords(STORES.dictionary, staleEntries.map((entry) => entry.id));
    return { dictionary: staleEntries.length };
  };

  const deleteKnowledgeEvents = async ({ workspaceId, documentId = "", chunkIds = [] } = {}) => {
    const safeChunkIds = new Set((chunkIds || []).filter(Boolean).map(String));
    if (!documentId && !safeChunkIds.size) return { events: 0 };
    const events = await listStore(STORES.events);
    const staleEvents = byWorkspace(events, workspaceId).filter((entry) =>
      (documentId && entry.documentId === documentId) || safeChunkIds.has(entry.chunkId || "")
    );
    await deleteRecords(STORES.events, staleEvents.map((entry) => entry.id));
    return { events: staleEvents.length };
  };

  const normalizeKnowledgeText = (text = "") =>
    String(text || "").toLowerCase().replace(/\s+/g, " ").trim();

  const looksLikeKnowledgeEnvelope = (text = "") => {
    const clean = String(text || "");
    const lowered = clean.toLowerCase();
    const envelopeHits = [
      '"workspaceid"',
      '\\"workspaceid\\"',
      '"sourceid"',
      '\\"sourceid\\"',
      '"metadata"',
      '\\"metadata\\"',
      '"createdat"',
      '\\"createdat\\"',
      '"updatedat"',
      '\\"updatedat\\"',
    ].filter((token) => lowered.includes(token)).length;
    return envelopeHits >= 3;
  };

  const extractInputText = (payload = {}, config = {}) => {
    if (config.text) return String(config.text);
    if (typeof payload === "string") return payload;
    return textOf(payload?.text || payload?.content || payload?.body || payload?.markdown || payload?.document || payload);
  };

  const compactDebugText = (text = "", limit = 0) => {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    return Number(limit) > 0 ? clean.slice(0, Number(limit)) : clean;
  };

  const knowledgeRuntimeDebugStack = [];

  const knowledgeRuntimeJsonPreview = (value) => {
    try {
      const text = JSON.stringify(value ?? null, null, 2);
      return text;
    } catch {
      return String(value ?? "");
    }
  };

  const knowledgeRuntimeResultSummary = (result = null) => {
    if (!result || typeof result !== "object") return {};
    return {
      status: result.status || "",
      documentId: result.documentId || "",
      collectionId: result.collectionId || "",
      provider: result.provider || result.ai?.provider || "",
      model: result.model || result.ai?.model || "",
      error: result.error || result.ai?.error || "",
      fallbackReason: result.fallbackReason || result.ai?.fallbackReason || "",
      promptMode: result.promptMode || result.ai?.promptMode || "",
      counts: {
        documents: result.document ? 1 : undefined,
        chunks: result.chunkCount ?? result.chunks?.length,
        dictionary: result.dictionaryCount ?? result.dictionaryEntries?.length,
        events: result.eventCount ?? result.events?.length,
        entities: result.entityCount ?? result.entities?.length,
        relations: result.relationCount ?? result.relations?.length,
        semanticRelations: result.semanticRelationCount ?? result.semanticRelations?.length,
        graphEntities: result.graph?.entityCount ?? result.snapshot?.entityCount,
        graphRelations: result.graph?.relationCount ?? result.snapshot?.relationCount,
      },
    };
  };

  const beginKnowledgeRuntimeDebug = (context = {}) => {
    const entry = { ...context, entries: [] };
    knowledgeRuntimeDebugStack.push(entry);
    return entry;
  };

  const endKnowledgeRuntimeDebug = (entry = null) => {
    const index = knowledgeRuntimeDebugStack.lastIndexOf(entry);
    if (index >= 0) knowledgeRuntimeDebugStack.splice(index, 1);
  };

  const latestKnowledgeRuntimeDebugEntry = (entry = {}) =>
    [...(entry.entries || [])].reverse().find((item) => item.type !== "node-input") ||
    [...(entry.entries || [])].reverse()[0] ||
    null;

  const knowledgeLlmDebug = (type = "debug", payload = {}) => {
    const active = knowledgeRuntimeDebugStack[knowledgeRuntimeDebugStack.length - 1];
    if (!active) return null;
    const entry = {
      type,
      at: nowIso(),
      ...payload,
      prompt: payload?.prompt || payload?.promptPreview || "",
      promptPreview: payload?.promptPreview || payload?.prompt || "",
    };
    active.entries.push(entry);
    if (active.entries.length > 80) active.entries.splice(0, active.entries.length - 80);
    flushKnowledgeRuntimeDebug(active, { status: "working" });
    return entry;
  };

  const knowledgeRuntimeSteps = ({ inputStep = null, debugEntries = [], result = null, outputChannel = "", latencyMs = 0, error = null } = {}) => {
    const steps = [];
    if (inputStep) steps.push(inputStep);
    debugEntries.filter((entry) => entry.type !== "node-input").forEach((entry, index) => {
      const promptChars = Number(entry.promptChars || 0);
      const maxTokens = Number(entry.maxTokens || 0);
      const status = result || outputChannel || error ? "complete" : (entry.status || "working");
      steps.push({
        id: `knowledge_llm_${index + 1}`,
        type: "llm",
        label: [entry.type || "LLM request", entry.promptMode].filter(Boolean).join(" · "),
        status,
        summary: `${entry.promptMode || "request"} · ${[entry.providerType || entry.provider || "", entry.model || ""].filter(Boolean).join(" / ") || "provider"}`,
        detail: [
          entry.sentChunkCount || entry.sourceChunkCount ? `${entry.sentChunkCount || 0}/${entry.sourceChunkCount || 0} chunks` : "",
          promptChars ? `${promptChars} prompt chars` : "",
          maxTokens ? `${maxTokens} sent max tokens` : "",
          entry.configuredMaxTokens ? `${entry.configuredMaxTokens} configured max tokens` : "",
          Number.isFinite(Number(entry.acceptedEntityCount)) ? `${entry.acceptedEntityCount}/${entry.proposedEntityCount ?? "?"} entities accepted` : "",
          Number.isFinite(Number(entry.acceptedRelationCount)) ? `${entry.acceptedRelationCount}/${entry.proposedRelationCount ?? "?"} relations accepted` : "",
          entry.error ? `error=${entry.error}` : "",
        ].filter(Boolean).join(" · "),
        payload: entry,
      });
    });
    if (result) {
      const summary = knowledgeRuntimeResultSummary(result);
      steps.push({
        id: "knowledge_result",
        type: "result",
        label: "Validated result",
        status: summary.error ? "warning" : "complete",
        summary: [
          summary.promptMode ? `promptMode=${summary.promptMode}` : "",
          summary.fallbackReason ? `fallback=${summary.fallbackReason}` : "",
          summary.error ? `error=${summary.error}` : "",
        ].filter(Boolean).join(" · ") || "Runtime result created.",
        payload: summary,
      });
    }
    if (outputChannel) {
      steps.push({
        id: "knowledge_emit",
        type: "emit",
        label: "Emitted output",
        status: "complete",
        summary: `Output emitted on ${outputChannel}.`,
        payload: { outputChannel, latencyMs },
      });
    }
    if (error) {
      steps.push({
        id: "knowledge_error",
        type: "error",
        label: "Runtime error",
        status: "error",
        summary: error.message || String(error),
      });
    }
    return steps;
  };

  const upsertKnowledgeRuntimeJob = async (record = {}) => {
    if (!window.TrackerLensAiRuntimeStore?.upsertJob) return null;
    try {
      return await window.TrackerLensAiRuntimeStore.upsertJob(record);
    } catch (error) {
      console.warn("Knowledge runtime job non persistito", error);
      return null;
    }
  };

  const flushKnowledgeRuntimeDebug = (entry = {}, { status = "working" } = {}) => {
    if (!entry?.jobId || !entry?.nodeId || !entry?.inputStep) return;
    if (entry.flushTimer) clearTimeout(entry.flushTimer);
    entry.flushTimer = setTimeout(() => {
      entry.flushTimer = 0;
      const latest = latestKnowledgeRuntimeDebugEntry(entry);
      const steps = knowledgeRuntimeSteps({
        inputStep: entry.inputStep,
        debugEntries: entry.entries || [],
      });
      const currentStep = steps[steps.length - 1] || entry.inputStep;
      const provider = latest?.provider || latest?.providerType || entry.provider || "";
      const model = latest?.model || entry.model || "";
      upsertKnowledgeRuntimeJob({
        id: entry.jobId,
        workspaceId: entry.workspaceId,
        runId: entry.runId || "",
        agentId: entry.nodeId,
        runtimeNodeId: entry.nodeId,
        agent: entry.nodeLabel || entry.nodeId,
        task: entry.inputStep?.payload?.inputChannel || "knowledge runtime event",
        status,
        runtimeStatus: status,
        currentStep,
        steps,
        provider,
        model,
        prompt: latest?.prompt || latest?.promptPreview || "",
        inputTrace: entry.inputStep.payload || {},
        result: {
          status,
          debug: entry.entries || [],
        },
        updatedAt: nowIso(),
      }).catch(() => null);
      entry.bus?.emit?.("knowledge.runtime.step", {
        nodeId: entry.nodeId,
        status,
        step: currentStep,
        promptMode: latest?.promptMode || "",
        provider,
        model,
      }, {
        workspaceId: entry.workspaceId,
        eventType: "knowledge_runtime_step",
        sourceNodeId: entry.nodeId,
        status,
        meta: {
          knowledgeRuntime: entry.nodeId,
          runtimeActivityVisual: true,
          runId: entry.runId || "",
          subtype: entry.subtype || "",
          stepType: currentStep.type || "",
          visualUntil: runtimeVisualUntil(),
        },
      }).catch(() => null);
    }, 0);
  };

  const splitConfigList = (value = "") =>
    Array.isArray(value)
      ? value.filter(Boolean).map((item) => String(item).trim()).filter(Boolean)
      : String(value || "").split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);

  const normalizeLanguage = (value = "") => {
    const language = String(value || "").trim().toLowerCase().split(/[-_]/)[0];
    return ["it", "es", "en", "fr", "de"].includes(language) ? language : "";
  };

  const languageProfiles = {
    it: {
      stopWords: ["alla", "alle", "allo", "anche", "ancora", "aveva", "avevano", "che", "chi", "come", "con", "cosa", "da", "del", "della", "delle", "di", "dopo", "dove", "era", "erano", "gli", "il", "in", "io", "la", "le", "lei", "loro", "lui", "ma", "mentre", "mi", "nel", "non", "per", "perche", "perché", "poi", "quale", "quando", "questa", "questo", "si", "sono", "sua", "suo", "tra", "una"],
      weakStarts: ["allora", "andiamo", "aveva", "certo", "chiese", "disse", "doveva", "ecco", "erano", "guardò", "guardo", "mentre", "rispose", "sussurrò", "venne", "vide"],
    },
    es: {
      stopWords: ["a", "ahora", "al", "aunque", "como", "con", "cuando", "de", "del", "donde", "el", "ella", "en", "era", "la", "las", "lo", "los", "mas", "más", "mi", "muy", "no", "para", "pero", "por", "que", "se", "sin", "solo", "sólo", "su", "sus", "un", "una", "y"],
      weakStarts: ["comenzó", "dijo", "entonces", "estaba", "había", "mientras", "respondió", "solo", "sólo", "susurró", "tenía", "vio"],
    },
    en: {
      stopWords: ["a", "an", "and", "are", "as", "at", "because", "but", "by", "even", "for", "from", "have", "he", "her", "him", "his", "how", "in", "is", "it", "its", "life", "many", "more", "nothing", "of", "on", "one", "only", "or", "search", "she", "that", "the", "their", "then", "they", "this", "to", "was", "we", "we ll", "were", "what", "who", "with", "you"],
      weakStarts: ["asked", "because", "began", "called", "came", "could", "even", "how", "life", "load", "nothing", "one", "only", "powered", "query", "said", "saw", "search", "step", "then", "type", "we", "we ll", "what", "whispered", "who", "would", "you"],
    },
    fr: {
      stopWords: ["a", "au", "avec", "bien", "c'était", "cetait", "ce", "ces", "comme", "dans", "de", "des", "du", "elle", "en", "et", "il", "ils", "je", "la", "le", "les", "leur", "leurs", "lui", "mais", "meme", "même", "ne", "nous", "ou", "par", "pas", "plus", "pour", "puis", "que", "qui", "rien", "se", "ses", "son", "sur", "un", "une", "vie", "vous"],
      weakStarts: ["alors", "avait", "bien", "c'était", "cetait", "demanda", "dit", "etait", "était", "ils", "leurs", "meme", "même", "plus", "puis", "repondit", "répondit", "rien", "ses", "vie", "vit"],
    },
    de: {
      stopWords: ["aber", "als", "am", "an", "auch", "auf", "aus", "bei", "bis", "da", "dann", "das", "dass", "dem", "den", "der", "des", "die", "doch", "du", "ein", "eine", "einem", "einen", "einer", "eines", "er", "es", "etwas", "für", "hatte", "ich", "ihm", "ihn", "ihr", "ihre", "im", "in", "ist", "ja", "kein", "keine", "mit", "nach", "nicht", "nichts", "nur", "oder", "sie", "so", "und", "von", "war", "waren", "was", "weil", "wenn", "wer", "wie", "wir", "zu", "zum", "zur"],
      weakStarts: ["aber", "als", "auch", "dann", "doch", "fragte", "ging", "hatte", "kam", "nur", "rief", "sagte", "sah", "war", "waren", "weil", "wenn"],
    },
  };

  const scoreLanguage = (text = "", language = "") => {
    const profile = languageProfiles[language];
    if (!profile) return 0;
    const tokens = (normalizeKnowledgeText(text).match(/[a-zà-ÿ]{2,}/gi) || []).map(normalizeEntityToken);
    const counts = tokens.reduce((map, token) => map.set(token, (map.get(token) || 0) + 1), new Map());
    return profile.stopWords.reduce((score, word) => {
      const token = normalizeEntityToken(word);
      if (token.length < 2) return score;
      return score + Math.min(6, counts.get(token) || 0);
    }, 0);
  };

  const detectLanguage = (text = "", preferred = "") => {
    const explicit = normalizeLanguage(preferred);
    if (explicit) return explicit;
    const scores = Object.keys(languageProfiles)
      .map((language) => ({ language, score: scoreLanguage(text, language) }))
      .sort((left, right) => right.score - left.score);
    return scores[0]?.score > 1 ? scores[0].language : "auto";
  };

  const languageProfileFor = (config = {}, text = "") => {
    const language = detectLanguage(text, config.language || config.lang || config.locale || config.metadata?.language || "");
    return {
      language,
      profile: languageProfiles[language] || null,
    };
  };

  const preferredRuntimeLanguage = (config = {}, payload = {}) =>
    normalizeLanguage(config.language || config.lang || config.locale || payload?.languageOverride || payload?.metadata?.languageOverride || "");

  const entityStopWords = new Set([
    "a", "al", "all", "alla", "alle", "allo", "agli", "allora", "anche", "ancora", "and", "andiamo", "ando", "andò", "are", "as", "at", "avec", "but", "by", "c",
    "aveva", "avevano", "che", "chi", "chiese", "ci", "come", "con", "cosa", "cosi", "così", "cosí", "cui", "da", "dai", "dagli", "dalla", "dalle", "de", "del", "della", "delle", "degli", "dei", "dello", "des", "di", "disse", "do", "dove", "dunque", "du", "e", "ecco", "egli", "ella", "el", "en", "et",
    "dopo", "eravamo", "esclamo", "esclamò", "for", "fra", "from", "gli", "grido", "gridò", "ha", "has", "have", "i", "il", "in", "io", "is", "it", "la", "las", "le",
    "lei", "les", "li", "lo", "loro", "los", "lui", "ma", "mas", "many", "me", "mentre", "mi", "mie", "miei", "mio", "mia", "mis", "more", "much", "muchas", "muchos",
    "muy", "ne", "nei", "nel", "nella", "nelle", "negli", "nello", "no", "noi", "non", "nostra", "nostre", "nostri", "nostro", "of", "on", "or", "o", "oppure", "para", "parlo", "parlò", "per", "perche", "perché", "poiche", "poiché", "poi", "por", "qua", "quale", "quali", "quando", "quanto", "quella", "quelle", "quelli", "quello", "questa", "queste", "questi", "questo", "que", "qui", "rispose", "se", "si", "sin", "sommo", "son", "sussurro", "sussurrò", "su", "sua", "sue", "sugli", "sui", "sul", "sulla", "sulle", "sullo", "suo", "suoi", "sus", "the",
    "colei", "colui", "coloro", "costei", "costui", "devo", "deve", "devono", "doveva", "dovevano", "ogni", "ora", "presto", "qualcosa", "semplice", "siamo", "sono", "ti", "to", "tra", "tu", "tua", "tue", "tuo", "tuoi", "tutti", "tutto", "tutte", "tutta", "un", "una", "uno", "uscita", "vecchio", "veniva", "venivano", "venne", "vennero", "viene", "vengono", "vi", "via", "vide", "voi", "vostra", "vostre", "vostri", "vostro", "y", "ahora", "aunque", "como", "cuando", "era",
    "estuve", "etait", "hola", "pero", "pues", "realmente", "avec", "dans", "pour", "sur"
  ]);

  const weakSentenceStartEntityTokens = new Set([
    "aiuto", "allora", "andiamo", "ando", "andò", "aveva", "avevano", "chiedilo", "chiese", "come", "cosi", "così", "cosí", "disse", "dove", "dunque", "ecco", "egli", "ella", "essa", "essi", "esso", "esse",
    "c", "dopo", "eravamo", "esclamo", "esclamò", "etait", "grido", "gridò",
    "mentre", "perche", "perché", "poiche", "poiché", "poi", "quale", "quali", "quando", "quanto", "quella", "quelle", "quelli", "quello",
    "colei", "colui", "coloro", "costei", "costui", "devo", "deve", "devono", "doveva", "dovevano", "ogni", "ora", "presto", "qualcosa", "questa", "queste", "questi", "questo", "rispose", "semplice", "siamo", "sommo", "sono", "sua", "sue", "suo", "suoi", "sussurro", "sussurrò", "tutti", "tutto", "tutte", "tutta", "uscita", "vecchio", "veniva", "venivano", "venne", "vennero", "viene", "vengono", "via", "vide"
  ]);

  const semanticLocationEntityTokens = new Set([
    "canaan", "egitto", "gerusalemme", "giordano", "israele", "roma", "sinai"
  ]);

  const semanticConceptEntityTokens = new Set([
    "alleanza", "amore", "assoluzione", "benedizione", "fede", "grazia", "giustizia", "gloria", "legge", "luce", "morte",
    "hoffnung", "ombra", "pace", "parola", "peccato", "preghiera", "promessa", "redenzione", "salvezza", "santita", "santità",
    "scrittura", "verita", "verità", "vita"
  ]);

  const semanticObjectEntityTokens = new Set([
    "agnello", "arca", "calice", "croce", "pane", "sangue", "tempio", "torch", "torcia"
  ]);

  const semanticRoleEntityTokens = new Set([
    "alte frau", "alter mann", "anciana", "anciano", "anziana", "anziano", "elder", "old woman", "old man", "vieil homme", "vieille femme"
  ]);

  const knownAcronymEntityTokens = new Set([
    "ai", "aids", "api", "cpu", "css", "db", "gpu", "hiv", "html", "json", "llm", "rag", "sql", "ui", "url"
  ]);

  const sourceEntityCueToken = "(?:book|chapter|collection|document|epistle|gospel|letter|passage|scripture|section|source|text|volume|work|capitolo|documento|fonte|lettera|libro|opera|passaggio|sezione|scrittura|testo|volumen|capitulo|capítulo|fuente|obra|pasaje|seccion|sección|chapitre|livre|oeuvre|texte|werk|buch|dokument|kapitel|quelle|schrift)";
  const sourceEntityCuePattern = new RegExp(`\\b${sourceEntityCueToken}\\b`);

  const isSourceEntity = (entity = {}) =>
    String(entity.entityType || entity.type || "").toLowerCase() === "source";

  const inferSourceRelationType = (source = {}, target = {}) => {
    const sourceIsSource = isSourceEntity(source);
    const targetIsSource = isSourceEntity(target);
    if (sourceIsSource && targetIsSource && source.id !== target.id) return "references";
    if (sourceIsSource !== targetIsSource) return "mentions";
    return "";
  };

  const normalizeEntityToken = (value = "") =>
    normalizeKnowledgeText(String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}_-]+/gu, " "));

  const isNumericOnlyEntity = (label = "") => {
    const normalized = normalizeEntityToken(label);
    return /\d/.test(normalized) && !/[a-z]/i.test(normalized);
  };

  const isWeakEntityLabel = (label = "", source = "") => {
    if (source === "seed" || source === "declared-name") return false;
    const words = normalizeEntityToken(label).split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const normalized = words.join(" ");
    if (typeof dictionaryWeakLexicalEntry === "function" && dictionaryWeakLexicalEntry(label, normalized)) return true;
    if (isNumericOnlyEntity(label)) return true;
    if (source === "symbol") {
      const normalized = normalizeEntityToken(label);
      const hasTechnicalMarker = /[\d_-]/.test(label);
      if (!hasTechnicalMarker && !knownAcronymEntityTokens.has(normalized)) return true;
    }
    if (source === "quote") {
      const lexicalWords = words.filter((word) => /[a-z]/i.test(word) && word.length >= 2);
      const digitHeavy = words.some((word) => /\d/.test(word));
      if (lexicalWords.length < 2 || digitHeavy) return true;
    }
    if (words.length === 1 && weakSentenceStartEntityTokens.has(words[0])) return true;
    if (source === "proper-noun" && words.every((word) => entityStopWords.has(word) || weakSentenceStartEntityTokens.has(word))) return true;
    return false;
  };

  const languageStopWordSet = (config = {}, text = "") => {
    const { profile } = languageProfileFor(config, text);
    return new Set([
      ...entityStopWords,
      ...(profile?.stopWords || []).map(normalizeEntityToken),
      ...splitConfigList(config.stopWords || config.entityStopWords).map(normalizeEntityToken),
    ]);
  };

  const languageWeakStartSet = (config = {}, text = "") => {
    const { profile } = languageProfileFor(config, text);
    return new Set([
      ...weakSentenceStartEntityTokens,
      ...(profile?.weakStarts || []).map(normalizeEntityToken),
    ]);
  };

  const isWeakEntityLabelForLanguage = (label = "", source = "", config = {}, text = "") => {
    const words = normalizeEntityToken(label).split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    if (source === "seed") return false;
    const language = detectLanguage(text || config.text || "", config.language || "");
    if (language === "de" && source === "proper-noun") return true;
    if (isWeakEntityLabel(label, source)) return true;
    const weakStarts = languageWeakStartSet(config, text);
    const stopWords = languageStopWordSet(config, text);
    if (words.length === 1 && weakStarts.has(words[0])) return true;
    if (["we ll", "we re", "we ve", "you ll", "you re", "you ve"].includes(words.join(" "))) return true;
    if (source === "proper-noun" && words.length === 1 && weakStarts.has(words[0])) return true;
    if (source === "declared-name" && words.every((word) => stopWords.has(word) || weakStarts.has(word))) return true;
    if (source === "declared-name") return false;
    if (source === "proper-noun" && words.every((word) => stopWords.has(word) || weakStarts.has(word))) return true;
    if (source === "proper-noun" && words.length === 1 && stopWords.has(words[0])) return true;
    return false;
  };

  const isEntityStopWord = (label = "", config = {}) => {
    const words = normalizeEntityToken(label).split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const stopWords = languageStopWordSet(config, config.text || "");
    if (words.every((word) => stopWords.has(word))) return true;
    if (words.length === 1 && words[0].length <= 2) return true;
    return false;
  };

  const cleanEntityPhrase = (value = "", config = {}) => {
    const stopWords = languageStopWordSet(config, config.text || "");
    const weakStarts = languageWeakStartSet(config, config.text || "");
    const isStop = (word = "") => {
      const normalized = normalizeEntityToken(word);
      return stopWords.has(normalized) || weakStarts.has(normalized);
    };
    const words = String(value || "")
      .replace(/\b[lL]['’](?=[a-zà-ÿ])/g, "")
      .replace(/\b(?:[Ww]e|[Yy]ou|[Tt]hey|[Ii])['’](?:ll|re|ve|d)\b/g, "")
      .replace(/^['’]?était$/i, "")
      .replace(/\b([A-ZÀ-Ý][A-Za-zÀ-ÿ]+)['’]s\b/g, "$1")
      .replace(/\b[Cc]['’]était\s+(?=[A-ZÀ-Ý])/g, "")
      .replace(/\b[Cc]etait\s+(?=[A-ZÀ-Ý])/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    while (words.length > 1 && isStop(words[0])) words.shift();
    while (words.length > 1 && isStop(words[words.length - 1])) words.pop();
    if (words.length > 2 && /^[A-ZÀ-Ý]/.test(words[0]) && isStop(words[1])) {
      return words[0].trim();
    }
    return words.join(" ").trim();
  };

  const estimateChunkTokens = (text = "") => {
    const tokens = String(text || "").match(/[\p{L}\p{N}_]+(?:['’.-][\p{L}\p{N}_]+)*/gu) || [];
    return tokens.length || Math.ceil(String(text || "").length / 4);
  };

  const trimTextToEstimatedTokens = (text = "", tokenLimit = 0) => {
    const value = String(text || "");
    const limit = Math.floor(Number(tokenLimit || 0));
    if (!value || limit <= 0 || estimateChunkTokens(value) <= limit) return value;
    const words = [...value.matchAll(/\S+/g)];
    let tokenCount = 0;
    let end = 0;
    for (const word of words) {
      const nextTokens = estimateChunkTokens(word[0]);
      if (end > 0 && tokenCount + nextTokens > limit) break;
      tokenCount += nextTokens;
      end = (word.index || 0) + word[0].length;
    }
    return value.slice(0, end || Math.max(1, Math.floor(limit * 4))).trim();
  };

  const promptChunkTokenBudget = ({ maxChunkTokens = 0, maxChunkChars = 0, defaultChunkTokens = 400 } = {}) => {
    const explicitTokens = Number(maxChunkTokens || 0);
    if (Number.isFinite(explicitTokens) && explicitTokens > 0) return Math.max(1, Math.floor(explicitTokens));
    const legacyChars = Number(maxChunkChars || 0);
    if (Number.isFinite(legacyChars) && legacyChars > 0) return Math.max(1, Math.round(legacyChars / 4));
    return Math.max(0, Math.floor(Number(defaultChunkTokens || 0)));
  };

  const normalizeChunkStrategy = (strategy = "structured") => {
    const mode = String(strategy || "structured").toLowerCase().trim();
    if (["fixed", "paragraph", "markdown"].includes(mode)) return "structured";
    return ["structured", "section", "token"].includes(mode) ? mode : "structured";
  };

  const chunkTokenBudget = ({ chunkSize = 900, maxChunkTokens = 0 } = {}) => {
    const explicit = Number(maxChunkTokens || 0);
    if (explicit > 0) return Math.max(80, Math.floor(explicit));
    return Math.max(80, Math.round((Number(chunkSize) || 900) / 4));
  };

  const chunkOverlapBudget = ({ overlap = 120, chunkOverlapTokens = 0, tokenBudget = 225 } = {}) => {
    const explicit = Number(chunkOverlapTokens || 0);
    const estimated = explicit > 0 ? explicit : Math.round((Number(overlap) || 0) / 4);
    return Math.max(0, Math.min(Math.floor(tokenBudget * 0.3), Math.floor(estimated)));
  };

  const trimChunkRange = (text = "", start = 0, end = text.length) => {
    let nextStart = Math.max(0, Math.min(text.length, start));
    let nextEnd = Math.max(nextStart, Math.min(text.length, end));
    while (nextStart < nextEnd && /\s/.test(text[nextStart])) nextStart += 1;
    while (nextEnd > nextStart && /\s/.test(text[nextEnd - 1])) nextEnd -= 1;
    return { start: nextStart, end: nextEnd };
  };

  const isChunkHeading = (block = "") => {
    const line = String(block || "").trim();
    if (!line || line.length > 140 || /\n/.test(line)) return false;
    if (/^#{1,6}\s+\S/.test(line)) return true;
    if (/^\d+(?:\.\d+)*[.)]?\s+\S/.test(line) && !/[.!?]$/.test(line)) return true;
    return /^[A-ZÀ-Ý0-9][\p{L}\p{N}\s:'’()/-]+$/u.test(line) && !/[.!?]$/.test(line);
  };

  const normalizeHeadingText = (text = "") =>
    String(text || "")
      .replace(/^#{1,6}\s+/, "")
      .replace(/^\d+(?:\.\d+)*[.)]?\s+/, "")
      .replace(/\s+/g, " ")
      .trim();

  const splitOversizedBlock = ({ text = "", start = 0, end = 0, page = 1, sectionPath = [] } = {}, tokenBudget = 225, overlapTokens = 0) => {
    const words = [...String(text || "").matchAll(/\S+/g)];
    const chunks = [];
    let cursor = 0;
    while (cursor < words.length) {
      let tokenCount = 0;
      let last = cursor;
      while (last < words.length) {
        const nextTokens = estimateChunkTokens(words[last][0]);
        if (last > cursor && tokenCount + nextTokens > tokenBudget) break;
        tokenCount += nextTokens;
        last += 1;
      }
      const firstWord = words[cursor];
      const lastWord = words[Math.max(cursor, last - 1)];
      const range = trimChunkRange(text, firstWord.index || 0, (lastWord.index || 0) + lastWord[0].length);
      const value = text.slice(range.start, range.end);
      if (value) {
        chunks.push({
          text: value,
          start: start + range.start,
          end: start + range.end,
          page,
          sectionPath,
          tokenEstimate: estimateChunkTokens(value),
        });
      }
      if (last >= words.length) break;
      if (!overlapTokens) {
        cursor = last;
        continue;
      }
      let overlapWordCount = 0;
      let overlapTokenCount = 0;
      while (last - overlapWordCount > cursor) {
        const nextTokens = estimateChunkTokens(words[last - overlapWordCount - 1]?.[0] || "");
        if (overlapWordCount && overlapTokenCount + nextTokens > overlapTokens) break;
        overlapTokenCount += nextTokens;
        overlapWordCount += 1;
        if (overlapTokenCount >= overlapTokens) break;
      }
      cursor = Math.max(cursor + 1, last - overlapWordCount);
    }
    return chunks.length ? chunks : [{ text, start, end, page, sectionPath, tokenEstimate: estimateChunkTokens(text) }];
  };

  const parseChunkBlocks = (text = "") => {
    const clean = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    if (!clean) return [];
    const blocks = [];
    let page = 1;
    let sectionPath = [];
    const regex = /\S[\s\S]*?(?=\n\s*\n|\f|$)/g;
    for (const match of clean.matchAll(regex)) {
      const rawStart = match.index || 0;
      const rawEnd = rawStart + match[0].length;
      const range = trimChunkRange(clean, rawStart, rawEnd);
      const value = clean.slice(range.start, range.end);
      if (!value) continue;
      const formFeedsBefore = (clean.slice(rawStart, range.start).match(/\f/g) || []).length;
      page += formFeedsBefore;
      const heading = isChunkHeading(value);
      if (heading) sectionPath = [normalizeHeadingText(value)].filter(Boolean);
      blocks.push({
        text: value,
        start: range.start,
        end: range.end,
        page,
        type: heading ? "heading" : "paragraph",
        sectionPath: sectionPath.slice(),
        tokenEstimate: estimateChunkTokens(value),
      });
      page += (clean.slice(range.end, rawEnd).match(/\f/g) || []).length;
    }
    return blocks;
  };

  const splitText = (text = "", { chunkSize = 900, overlap = 120, strategy = "structured", maxChunkTokens = 0, chunkOverlapTokens = 0 } = {}) => {
    const blocks = parseChunkBlocks(text);
    if (!blocks.length) return [];
    const mode = normalizeChunkStrategy(strategy);
    const tokenBudget = chunkTokenBudget({ chunkSize, maxChunkTokens });
    const overlapTokens = mode === "structured" ? chunkOverlapBudget({ overlap, chunkOverlapTokens, tokenBudget }) : 0;
    const chunks = [];
    let current = [];
    let currentTokens = 0;
    let currentIsOverlap = false;

    const currentText = () => current.map((block) => block.text).join("\n\n").trim();
    const flush = () => {
      const textValue = currentText();
      if (!textValue || !current.length) {
        current = [];
        currentTokens = 0;
        currentIsOverlap = false;
        return;
      }
      const first = current[0];
      const last = current[current.length - 1];
      chunks.push({
        text: textValue,
        start: first.start,
        end: last.end,
        page: first.page,
        endPage: last.page,
        sectionPath: last.sectionPath || first.sectionPath || [],
        tokenEstimate: estimateChunkTokens(textValue),
      });
      if (!overlapTokens || mode === "section") {
        current = [];
        currentTokens = 0;
        currentIsOverlap = false;
        return;
      }
      const tail = [];
      let tailTokens = 0;
      for (let index = current.length - 1; index >= 0; index -= 1) {
        const block = current[index];
        if (tail.length && tailTokens + block.tokenEstimate > overlapTokens) break;
        tail.unshift(block);
        tailTokens += block.tokenEstimate;
      }
      current = tail;
      currentTokens = tailTokens;
      currentIsOverlap = Boolean(tail.length);
    };

    blocks.forEach((block) => {
      if (block.tokenEstimate > tokenBudget) {
        flush();
        chunks.push(...splitOversizedBlock(block, tokenBudget, overlapTokens));
        current = [];
        currentTokens = 0;
        currentIsOverlap = false;
        return;
      }
      const crossesPage = mode !== "token" && current.length && current[current.length - 1].page !== block.page;
      const overBudget = current.length && currentTokens + block.tokenEstimate > tokenBudget;
      const newSection = mode === "section" && current.length && block.type === "heading";
      if (currentIsOverlap && (crossesPage || overBudget || newSection)) {
        current = [];
        currentTokens = 0;
        currentIsOverlap = false;
      } else if (crossesPage || overBudget || newSection) {
        flush();
      }
      current.push(block);
      currentTokens += block.tokenEstimate;
      currentIsOverlap = false;
    });
    flush();
    return chunks;
  };

  const tokenVector = (text = "", dimensions = 96) => {
    const vector = new Array(dimensions).fill(0);
    const tokens = String(text || "").toLowerCase().match(/[a-z0-9_à-ÿ]{2,}/gi) || [];
    tokens.forEach((token) => {
      let hash = 2166136261;
      for (let i = 0; i < token.length; i += 1) {
        hash ^= token.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      vector[Math.abs(hash) % dimensions] += 1;
    });
    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
    return vector.map((value) => Math.round((value / magnitude) * 1000000) / 1000000);
  };

  const cosineSimilarity = (left = [], right = []) => {
    const length = Math.min(left.length, right.length);
    if (!length) return 0;
    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;
    for (let index = 0; index < length; index += 1) {
      dot += Number(left[index] || 0) * Number(right[index] || 0);
      leftNorm += Number(left[index] || 0) ** 2;
      rightNorm += Number(right[index] || 0) ** 2;
    }
    const divisor = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
    return divisor ? dot / divisor : 0;
  };

  const providerKey = (provider = {}) =>
    String(provider.id || provider.provider || provider.name || "").trim().toLowerCase();

  const providerContent = (provider = {}) =>
    provider?.raw?.content && typeof provider.raw.content === "object" ? provider.raw.content : provider?.raw || provider || {};

  const providerSecret = (provider = {}, config = {}) => {
    const content = providerContent(provider);
    return String(
      config.apiKey ||
      config.token ||
      provider.apiKey ||
      provider.token ||
      content.apiKey ||
      content.token ||
      content.secret ||
      ""
    ).trim();
  };

  const headersForProvider = (provider = {}, config = {}) => {
    const headers = { "Content-Type": "application/json" };
    const secret = providerSecret(provider, config);
    if (secret) headers.Authorization = `Bearer ${secret}`;
    return headers;
  };

  const openAiJsonModeSupported = (providerType = "", config = {}) => {
    const type = String(providerType || config.providerType || config.provider || "").toLowerCase();
    const forced = config.forceResponseFormat === true || String(config.forceResponseFormat || "").toLowerCase() === "true";
    if (forced) return true;
    if (type.includes("lm-studio") || type.includes("lmstudio")) return false;
    return ["openai", "openai-compatible", "custom-openai"].some((item) => type.includes(item));
  };

  const withJsonObjectResponseFormat = (body = {}, providerType = "", config = {}) =>
    openAiJsonModeSupported(providerType, config)
      ? { ...body, response_format: { type: "json_object" } }
      : body;

  const isLmStudioProvider = (providerType = "", provider = {}) =>
    /lm[-_\s]?studio|lmstudio/i.test([
      providerType,
      provider.provider,
      provider.providerType,
      provider.id,
      provider.name,
    ].filter(Boolean).join(" "));

  const knowledgeContextSize = (config = {}, providerType = "", provider = {}) => {
    const explicit = Number(config.contextSize || config.contextWindow || config.contextTokens || config.nCtx || provider.contextSize || provider.nCtx || 0);
    if (Number.isFinite(explicit) && explicit >= 1024) return explicit;
    return isLmStudioProvider(providerType, provider) ? 4096 : 8192;
  };

  const knowledgeCompletionLimit = ({ config = {}, providerType = "", provider = {}, requested = 900, min = 128, max = 1800 } = {}) => {
    const hasExplicitWanted = config.maxTokens !== null && config.maxTokens !== undefined && config.maxTokens !== "";
    const wanted = knowledgeAiNumberConfig(config.maxTokens, requested);
    if (hasExplicitWanted) return Math.max(1, Math.floor(wanted));
    const nodeCompletionLimit = Number(config.completionTokenLimit || config.maxCompletionTokens || 0);
    const providerCompletionLimit = Number(provider.completionTokenLimit || provider.maxCompletionTokens || 0);
    const explicitCompletionLimit = Number.isFinite(nodeCompletionLimit) && nodeCompletionLimit > 0
      ? nodeCompletionLimit
      : Number.isFinite(providerCompletionLimit) && providerCompletionLimit > 0
        ? providerCompletionLimit
        : 0;
    const value = Number.isFinite(explicitCompletionLimit) && explicitCompletionLimit > 0
      ? explicitCompletionLimit
      : wanted;
    return Math.max(1, Math.floor(value));
  };

  const knowledgeCompletionDebug = ({ config = {}, providerType = "", provider = {}, requested = 900, min = 128, max = 1800 } = {}) => {
    const hasExplicitWanted = config.maxTokens !== null && config.maxTokens !== undefined && config.maxTokens !== "";
    const wanted = knowledgeAiNumberConfig(config.maxTokens, requested);
    const nodeCompletionLimit = hasExplicitWanted ? 0 : Number(config.completionTokenLimit || config.maxCompletionTokens || 0);
    const providerCompletionLimit = Number(provider.completionTokenLimit || provider.maxCompletionTokens || 0);
    const explicitCompletionLimit = Number.isFinite(nodeCompletionLimit) && nodeCompletionLimit > 0
      ? nodeCompletionLimit
      : !hasExplicitWanted && Number.isFinite(providerCompletionLimit) && providerCompletionLimit > 0
        ? providerCompletionLimit
        : 0;
    const effectiveMaxTokens = knowledgeCompletionLimit({ config, providerType, provider, requested, min, max });
    return {
      hasExplicitWanted,
      userMaxTokensHonored: hasExplicitWanted,
      wanted,
      effectiveMaxTokens,
      nodeCompletionLimit,
      providerCompletionLimit,
      explicitCompletionLimit,
    };
  };

  const knowledgePromptBudget = ({ config = {}, providerType = "", provider = {}, chunksLength = 1, defaultChunkLimit = 8, defaultChunkChars = 1600, defaultChunkTokens = 0 } = {}) => {
    const explicitChunkLimit = Number(config.maxChunks || 0);
    const rawChunkLimit = Number.isFinite(explicitChunkLimit) && explicitChunkLimit > 0
      ? Math.floor(explicitChunkLimit)
      : Math.max(1, Number(chunksLength || defaultChunkLimit || 1));
    const rawChunkTokens = promptChunkTokenBudget({
      maxChunkTokens: config.maxChunkTokens || config.aiChunkTokens || config.chunkTokens || config.tokenBudget,
      maxChunkChars: config.maxChunkChars,
      defaultChunkTokens,
    });
    return { chunkLimit: Math.min(rawChunkLimit, chunksLength || rawChunkLimit), maxChunkTokens: rawChunkTokens, maxChunkChars: rawChunkTokens > 0 ? rawChunkTokens * 4 : 0 };
  };

  const pickEmbeddingProvider = async (config = {}) => {
    const requestedProfile = String(config.providerProfile || config.profileId || "").trim();
    const requestedType = String(config.providerType || config.provider || "").trim().toLowerCase();
    const requested = String(config.provider || config.providerProfile || "").trim().toLowerCase();
    if ([requestedProfile, requestedType, requested].some((value) => ["local", "local-hash", "tl-local-hash-v1"].includes(value))) {
      return null;
    }
    const data = await window.TrackerLensAiRuntimeStore?.list?.().catch(() => null);
    const providers = data?.providers || window.TrackerLensAiRuntimeStore?.localProviderDefaults?.() || [];
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

  const withApiBase = (endpoint = "", fallback = "http://127.0.0.1:1234") => {
    const clean = String(endpoint || fallback).replace(/\/+$/g, "");
    return clean.endsWith("/v1") ? clean : `${clean}/v1`;
  };

  const extractEmbeddingVector = (data = {}) => {
    const direct = Array.isArray(data.embedding) ? data.embedding : null;
    const firstData = Array.isArray(data.data) ? data.data[0] : null;
    const firstEmbedding = Array.isArray(firstData?.embedding) ? firstData.embedding : null;
    const firstOllama = Array.isArray(data.embeddings) && Array.isArray(data.embeddings[0]) ? data.embeddings[0] : null;
    const vector = direct || firstEmbedding || firstOllama || [];
    return vector.map(Number).filter((value) => Number.isFinite(value));
  };

  const isLocalEmbeddingEndpoint = (endpoint = "") => {
    try {
      const url = new URL(endpoint);
      return ["127.0.0.1", "localhost", "::1"].includes(url.hostname) &&
        ["1234", "11434", ""].includes(url.port) &&
        /\/(v1\/embeddings|api\/embeddings|api\/embed)$/.test(url.pathname);
    } catch {
      return false;
    }
  };

  const postEmbeddingJson = async ({ url = "", body = {}, headers = {} } = {}) => {
    if (isLocalEmbeddingEndpoint(url) && typeof window !== "undefined" && /^https?:/i.test(window.location?.protocol || "")) {
      const proxyResponse = await fetch("api/ai-embedding-proxy.php", {
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

  const callOllamaEmbedding = async ({ provider = {}, model = "", text = "" } = {}) => {
    const endpoint = String(provider.endpoint || "http://127.0.0.1:11434").replace(/\/+$/g, "");
    const requestedModel = String(model || provider.model || "nomic-embed-text").trim();
    const attempts = [
      {
        url: `${endpoint}/api/embeddings`,
        body: { model: requestedModel, prompt: text },
      },
      {
        url: `${endpoint}/api/embed`,
        body: { model: requestedModel, input: text },
      },
    ];
    let lastError = "";
    for (const attempt of attempts) {
      const response = await postEmbeddingJson({
        url: attempt.url,
        body: attempt.body,
        headers: { "Content-Type": "application/json" },
      }).catch((error) => {
        lastError = error?.message || "Ollama embedding fetch failed";
        return null;
      });
      if (!response) continue;
      if (!response.ok) {
        lastError = `Ollama HTTP ${response.status}`;
        continue;
      }
      const data = await response.json();
      const vector = extractEmbeddingVector(data);
      if (vector.length) return { vector, model: requestedModel, raw: data };
      lastError = "Ollama embedding response vuota";
    }
    throw new Error(lastError || "Ollama embedding non disponibile");
  };

  const callOpenAiCompatibleEmbedding = async ({ provider = {}, config = {}, model = "", text = "" } = {}) => {
    const providerType = String(provider.provider || provider.providerType || config.providerType || config.provider || "").toLowerCase();
    const fallbackBase = providerType === "openai" ? "https://api.openai.com/v1" : "http://127.0.0.1:1234/v1";
    const endpoint = withApiBase(provider.endpoint || config.endpoint || config.baseUrl, fallbackBase);
    const requestedModel = String(model || provider.model || (providerType === "openai" ? "text-embedding-3-small" : "local-model")).trim();
    const body = { model: requestedModel, input: text };
    if ((config.providerDimensions === true || config.useConfiguredDimensions === true) && Number(config.dimensions)) {
      body.dimensions = Number(config.dimensions);
    }
    const response = await postEmbeddingJson({
      url: `${endpoint}/embeddings`,
      body,
      headers: headersForProvider(provider, config),
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`Embedding HTTP ${response.status}${errorText ? `: ${errorText}` : ""}`);
    }
    const data = await response.json();
    const vector = extractEmbeddingVector(data);
    if (!vector.length) throw new Error("Embedding response vuota");
    return { vector, model: data.model || requestedModel, raw: data };
  };

  const resolveEmbeddingVector = async ({ text = "", config = {}, providerHint = null, modelHint = "" } = {}) => {
    const localDimensions = Math.max(16, Math.min(512, Number(config.dimensions || 96)));
    const requestedProvider = String(config.providerProfile || config.provider || providerHint?.provider || providerHint?.id || "").trim();
    const requestedModel = String(modelHint || config.model || providerHint?.model || "").trim();
    const wantsLocal = !requestedProvider || ["local", "local-hash", "tl-local-hash-v1"].includes(requestedProvider.toLowerCase());
    if (wantsLocal) {
      const model = requestedModel || "tl-local-hash-v1";
      return {
        vector: tokenVector(text, localDimensions),
        provider: "local-hash",
        model,
        generatedBy: "local-browser",
      };
    }

    const provider = providerHint || await pickEmbeddingProvider(config);
    if (!provider) {
      return {
        vector: tokenVector(text, localDimensions),
        provider: "local-hash",
        model: requestedModel || "tl-local-hash-v1",
        generatedBy: "local-browser",
        fallbackReason: "provider-not-found",
      };
    }

    const type = String(provider.provider || provider.providerType || config.providerType || config.provider || "").toLowerCase();
    try {
      const result = type === "ollama"
        ? await callOllamaEmbedding({ provider, model: requestedModel || provider.model, text })
        : await callOpenAiCompatibleEmbedding({ provider, config, model: requestedModel || provider.model, text });
      return {
        vector: result.vector,
        provider: provider.id || provider.provider || requestedProvider || "provider",
        providerType: type || "openai-compatible",
        model: result.model || requestedModel || provider.model || "embedding-model",
        generatedBy: "ai-provider",
      };
    } catch (error) {
      return {
        vector: tokenVector(text, localDimensions),
        provider: "local-hash",
        model: "tl-local-hash-v1",
        generatedBy: "local-browser",
        fallbackReason: error?.message || "provider-error",
        requestedProvider: providerKey(provider) || requestedProvider,
        requestedModel: requestedModel || provider.model || "",
      };
    }
  };

  const nodeSubtype = (node = {}) =>
    String(node.metadata?.subtype || node.metadata?.manifest?.subtype || node.type || "").toLowerCase();
  const nodeConfig = (node = {}) =>
    node.metadata?.config && typeof node.metadata.config === "object" && !Array.isArray(node.metadata.config)
      ? node.metadata.config
      : {};
  const isAgentToolsSampleNode = (node = {}) =>
    /agent tools sample/i.test([
      node.id,
      node.label,
      node.metadata?.paletteAction,
      node.metadata?.source,
      node.metadata?.config?.purpose,
    ].filter(Boolean).join(" "));
  const agentToolsBoundedKnowledgeConfig = (node = {}, config = {}) => {
    if (!isAgentToolsSampleNode(node)) return config;
    return {
      ...config,
      dictionaryMode: config.dictionaryMode || "hybrid",
      eventMode: config.eventMode || "llm",
      entityMode: config.entityMode || "llm",
      compositionMode: config.compositionMode || "hybrid",
    };
  };
  const nodeStatus = (node = {}) =>
    String(node.runtime?.status || node.metadata?.runtimeStatus || node.status || "idle").toLowerCase();
  const isKnowledgeNode = (node = {}) =>
    (node.type === "knowledge" || node.metadata?.category === "knowledge") &&
    !node.metadata?.library &&
    !["paused", "disabled", "error", "disconnected"].includes(nodeStatus(node));
  const unique = (values = []) => [...new Set(values.filter(Boolean).map(String))];
  const isToolAccessDependency = (dependency = {}) =>
    String(dependency.metadata?.linkType || dependency.mapping?.linkType || "") === "tool-access";
  const nodeIncomingDependencies = (node = {}, dependencies = []) =>
    (dependencies || []).filter((dependency) => dependency.targetNodeId === node.id && !isToolAccessDependency(dependency));
  const dependencyChannel = (dependency = {}) =>
    dependency.channel || dependency.metadata?.targetPort || dependency.metadata?.sourcePort || "";
  const dependencyChannels = (dependency = {}) =>
    unique([
      dependency.channel,
      dependency.sourcePort,
      dependency.targetPort,
      dependency.output,
      dependency.input,
      dependency.metadata?.channel,
      dependency.metadata?.sourcePort,
      dependency.metadata?.targetPort,
      dependency.metadata?.output,
      dependency.metadata?.input,
    ].filter((channel) => channel && channel !== "all"));
  const dependencyUsesAllChannel = (dependency = {}) =>
    [
      dependency.channel,
      dependency.sourcePort,
      dependency.targetPort,
      dependency.output,
      dependency.input,
      dependency.metadata?.channel,
      dependency.metadata?.sourcePort,
      dependency.metadata?.targetPort,
      dependency.metadata?.output,
      dependency.metadata?.input,
    ].some((channel) => String(channel || "") === "all");
  const dependencyAcceptsChannel = (dependency = {}, eventChannel = "") =>
    dependencyUsesAllChannel(dependency) || dependencyChannels(dependency).includes(String(eventChannel || ""));
  const nodeInputs = (node = {}, dependencies = []) => {
    const incomingDependencies = nodeIncomingDependencies(node, dependencies);
    const incoming = incomingDependencies
      .flatMap(dependencyChannels)
      .filter(Boolean);
    if (incoming.length) return unique(incoming);
    return unique([...(node.inputs || []), ...(node.channels || [])]);
  };
  const allowsUnlinkedKnowledgeEvents = (node = {}) =>
    ["document-store", "text-knowledge", "workspace-memory", "conversation-memory"].includes(nodeSubtype(node));
  const acceptsDependencyEvent = ({ node = {}, event = {}, dependencies = [] } = {}) => {
    const incomingDependencies = nodeIncomingDependencies(node, dependencies);
    if (event?.targetNodeId && event.targetNodeId === node.id) return true;
    if (!incomingDependencies.length) return allowsUnlinkedKnowledgeEvents(node);
    const eventChannel = String(event?.channel || "");
    const sourceNodeId = String(event?.sourceNodeId || "");
    return incomingDependencies.some((dependency) =>
      String(dependency.sourceNodeId || "") === sourceNodeId &&
      dependencyAcceptsChannel(dependency, eventChannel)
    );
  };
  const dependencyForRuntimeEvent = ({ node = {}, event = {}, dependencies = [] } = {}) => {
    const eventChannel = String(event?.channel || "");
    const sourceNodeId = String(event?.sourceNodeId || "");
    return nodeIncomingDependencies(node, dependencies).find((dependency) =>
      String(dependency.sourceNodeId || "") === sourceNodeId &&
      dependencyAcceptsChannel(dependency, eventChannel)
    ) || null;
  };
  const runtimeVisualUntil = (durationMs = 12000) =>
    new Date(Date.now() + Math.max(3000, Number(durationMs) || 12000)).toISOString();
  const emitKnowledgeRuntimeActivity = async ({
    bus,
    workspaceId = "workspace_global",
    runtime = {},
    node = {},
    event = {},
    runId = "",
    subtype = "",
    status = "busy",
    phase = "processing",
    label = "",
    durationMs = 9000,
  } = {}) => {
    if (!bus?.emit || !node?.id) return null;
    const dependency = dependencyForRuntimeEvent({ node, event, dependencies: runtime.dependencies || [] });
    const visualUntil = runtimeVisualUntil(durationMs);
    return bus.emit("knowledge.runtime.activity", {
      nodeId: node.id,
      phase,
      targetLabel: label || node.label || node.id,
      inputChannel: event?.channel || "",
      visualUntil,
    }, {
      workspaceId,
      eventType: "knowledge_runtime_activity",
      sourceNodeId: event?.sourceNodeId || dependency?.sourceNodeId || "",
      targetNodeId: node.id,
      status,
      meta: {
        knowledgeRuntime: node.id,
        runtimeActivityVisual: true,
        dependencyId: dependency?.id || "",
        inputEventId: event?.id || "",
        inputChannel: event?.channel || "",
        runId,
        subtype,
        phase,
        targetLabel: label || node.label || node.id,
        visualUntil,
      },
    }).catch(() => null);
  };
  const hasGraphSourceDependency = (node = {}, dependencies = []) =>
    nodeIncomingDependencies(node, dependencies)
      .some((dependency) => dependencyChannel(dependency) === "knowledge.graph.updated");
  const nodeOutput = (node = {}, config = {}, fallback = "knowledge.output") =>
    config.outputChannel || config.output || node.outputs?.[0] || fallback;
  const assignedEmbeddingNodeIds = (node = {}, runtime = {}) =>
    unique((runtime.dependencies || [])
      .filter((dependency) => dependency.targetNodeId === node.id)
      .filter((dependency) => (dependency.channel || dependency.metadata?.sourcePort || dependency.metadata?.targetPort) === "knowledge.embedding.created")
      .map((dependency) => dependency.sourceNodeId));

  const relationMatchesType = (relation = {}, allowedTypes = []) =>
    !allowedTypes.length || allowedTypes.includes(String(relation.relationType || "").toLowerCase());

  const graphEntityText = (entity = {}) =>
    [entity.label, entity.id, entity.entityType, ...(entity.metadata?.aliases || [])].map((value) => String(value || "")).join(" ");

  const scoreGraphEntity = (entity = {}, queryTokens = [], cleanQuery = "") => {
    const haystack = normalizeEntityToken(graphEntityText(entity));
    if (!haystack) return 0;
    let score = cleanQuery && haystack.includes(cleanQuery) ? 8 : 0;
    queryTokens.forEach((token) => {
      if (!token || token.length < 2) return;
      if (haystack === token) score += 6;
      else if (haystack.includes(token)) score += 3;
    });
    if (score <= 0) return 0;
    return score + Math.min(3, Number(entity.confidence || 0) * 3);
  };

  const graphDangerIntentPattern = /\b(?:pericol\w*|risch\w*|ostacol\w*|minacc\w*|attacc\w*|attacco|ferit\w*|ferisc\w*|ferend\w*|ferir\w*|colp\w*|mostr\w*|nemic\w*|ennemic\w*|affront\w*|danger\w*|risk\w*|obstacle\w*|threat\w*|attack\w*|hurt\w*|injur\w*|wound\w*|violent\w*|monster\w*|enem\w*|face|faced|facing|confront\w*|peligro\w*|riesgo\w*|obst[aá]cul\w*|amenaz\w*|ataque|ataca\w*|herid\w*|monstru\w*|enfrent\w*|dangereux|risque\w*|menace\w*|attaque\w*|bless\w*|monstre\w*|affront\w*|gefahr\w*|gefährlich\w*|risiko\w*|hindernis\w*|bedrohung\w*|angriff\w*|verletzt\w*)\b/;

  const graphQueryIntent = (query = "") => {
    const normalized = normalizeEntityToken(query);
    const asksDanger = graphDangerIntentPattern.test(normalized);
    const asksDefinition = /\b(?:chi|cosa|cos|che|what|who|que|qué|quien|quién|quoi|qui|was|wer)\b/.test(normalized) ||
      /\b(?:e|è|is|es|est|ist)\b/.test(normalized);
    const asksSource = /\b(?:chi|who|quien|quién|qui|wer)\b/.test(normalized) &&
      /\b(?:dice|disse|detto|racconta|raccont[oò]|spiega|spieg[oò]|rivela|rivel[oò]|indica|indic[oò]|comunica|comunic[oò]|avverte|avvert[iì]|tells|told|says|said|explains|explained|reveals|revealed|warns|warned|indicates|indicated)\b/.test(normalized);
    const asksRelation = /\b(?:relazione|relation|relacion|relación|lien|beziehung|tra|between|entre|zwischen)\b/.test(normalized);
    const asksInstrument = /\b(?:usa|usare|utilizza|utilizzare|usa|used|use|uses|with|against|contro|con|strumento|tool|weapon|arma|object|oggetto)\b/.test(normalized);
    const asksCause = /\b(?:perche|perché|why|porque|por qué|pourquoi|warum)\b/.test(normalized);
    const asksProcess = /\b(?:dettagli|dettaglio|passaggi|passo|processo|sequenza|timeline|come|how|como|cómo|comment|wie|explain|spiega|spiegami)\b/.test(normalized);
    const asksHealing = /\b(?:come|how|como|cómo|comment|wie)\b/.test(normalized) &&
      /\b(?:guar|cura|heal|cure|recuper|ritrov|riacquist|voce|parlare|speak|voice|voz|hablar|parler)\b/.test(normalized);
    return {
      definition: asksDefinition && !asksDanger,
      source: asksSource,
      relation: asksRelation,
      instrument: asksInstrument,
      cause: asksCause,
      process: !asksSource && !asksDanger && (asksProcess || asksCause || asksHealing),
      healing: !asksSource && asksHealing,
      danger: asksDanger,
    };
  };

  const graphRelationWeight = (relationType = "", intent = {}) => {
    const type = String(relationType || "co_occurs").toLowerCase();
    const weights = {
      cannot_speak: 9,
      healed_by: intent.healing ? 8.5 : 9,
      gives_to: intent.source ? 9 : 8,
      receives_from: intent.source ? 9 : 8,
      asks_for: 8,
      tries_to_help: 8,
      implements: 8,
      interfaces_with: 8,
      connects_to: 8,
      retrieves_from: 8,
      stores_in: 8,
      loads: 8,
      splits: 8,
      splits_into: 8,
      processes: 8,
      transforms: 8,
      powered_by: 8,
      configures: 7,
      protects: 8,
      seeks: 8,
      causes: intent.healing ? 10 : 8,
      leads_to: intent.healing ? 9.5 : 8,
      works_for: 8,
      depends_on: 7,
      explains: intent.source ? 10 : 7,
      friend_of: 7,
      has_property: intent.healing ? 8.5 : 7,
      lives_in: 7,
      discovers: 7,
      is_part_of: 7,
      says: intent.source ? 11 : 7,
      represents: 7,
      reveals: intent.source ? 11 : 7,
      teaches: intent.source ? 10 : 7,
      establishes: 7,
      fulfills: 7,
      foreshadows: 7,
      helps: 6,
      appears_in: intent.definition ? 1 : 5,
      travels_to: intent.definition ? 1 : 5,
      encounters: 5,
      confronts: intent.danger ? 10 : 5,
      attacks: intent.danger ? 11 : 5,
      hurts: intent.danger ? 10 : 5,
      threatens: intent.danger ? 10 : 5,
      opposes: intent.danger ? 10 : 5,
      expresses: 5,
      uses: 7,
      contains: 4,
      context_for: intent.definition ? 2 : 4,
      associated_with: intent.healing ? 5 : 3,
      interacts_with: 3,
      mentions: 3,
      references: 3,
      co_occurs: intent.definition ? 1.5 : 1,
    };
    return weights[type] ?? 2;
  };

  const scoreGraphRelation = (relation = {}, { seedScoreById = new Map(), entityById = new Map(), intent = {}, chunkScoreById = new Map() } = {}) => {
    const sourceScore = seedScoreById.get(relation.sourceEntityId) || 0;
    const targetScore = seedScoreById.get(relation.targetEntityId) || 0;
    const touchesSeed = sourceScore || targetScore;
    const source = entityById.get(relation.sourceEntityId);
    const target = entityById.get(relation.targetEntityId);
    const directness = touchesSeed ? 20 + Math.max(sourceScore, targetScore) : 0;
    const typeWeight = graphRelationWeight(relation.relationType, intent);
    const confidence = Number(relation.confidence || 0) * 3;
    const hasEvidence = Boolean(
      relation.evidence?.quote ||
      relation.evidence?.text ||
      relation.metadata?.evidence?.quote ||
      relation.metadata?.evidence?.text ||
      relation.metadata?.explanation
    );
    const semanticBonus = relation.metadata?.semantic ? 8 : 0;
    const evidenceBonus = hasEvidence ? 5 : 0;
    const chunkBonus = chunkScoreById.get(relation.chunkId || relation.evidence?.chunkId || relation.metadata?.evidence?.chunkId || "") || 0;
    const entityConfidence = Math.max(Number(source?.confidence || 0), Number(target?.confidence || 0));
    let intentBonus = 0;
    if (intent.definition && touchesSeed) {
      const seedId = sourceScore ? relation.sourceEntityId : relation.targetEntityId;
      const other = entityById.get(seedId === relation.sourceEntityId ? relation.targetEntityId : relation.sourceEntityId);
      const otherType = String(other?.entityType || "").toLowerCase();
      if (otherType === "proper-noun") intentBonus += 6;
      if (otherType === "quote") intentBonus += 5;
      if (otherType === "concept") intentBonus += 3;
      if (otherType === "creature") intentBonus += 2;
      if (otherType === "object") intentBonus += 1;
      if (otherType === "location") intentBonus -= 5;
    }
    if (intent.source) {
      const relationType = String(relation.relationType || "").toLowerCase();
      if (["says", "reveals", "teaches", "explains", "asks_for", "gives_to", "receives_from"].includes(relationType)) intentBonus += 12;
      if (hasEvidence) intentBonus += 5;
      if (["proper-noun", "role"].includes(String(source?.entityType || "").toLowerCase()) ||
        ["proper-noun", "role"].includes(String(target?.entityType || "").toLowerCase())) intentBonus += 4;
      if (["appears_in", "context_for", "co_occurs", "associated_with"].includes(relationType)) intentBonus -= 10;
    }
    if (intent.danger) {
      const relationType = String(relation.relationType || "").toLowerCase();
      const evidenceText = [
        relation.evidence?.quote || relation.evidence?.text || "",
        relation.metadata?.evidence?.quote || relation.metadata?.evidence?.text || "",
        relation.metadata?.explanation || "",
      ].join(" ");
      if (["encounters", "confronts", "attacks", "hurts", "threatens", "opposes"].includes(relationType)) intentBonus += 10;
      if (graphDangerCueScore(evidenceText, intent) >= 10) intentBonus += 8;
      if (["appears_in", "context_for", "co_occurs", "associated_with"].includes(relationType)) intentBonus -= 6;
    }
    return directness + typeWeight + confidence + semanticBonus + evidenceBonus + chunkBonus + entityConfidence + intentBonus;
  };

  const graphDefinitionCueScore = (text = "", intent = {}) => {
    if (!intent.definition) return 0;
    const normalized = normalizeEntityToken(text);
    const cues = [
      " e ", " era ", " is ", " was ", " es ", " est ", " ist ",
      " bambino", " ragazzo", " amico", " personaggio", " nato", " vive",
      " child", " boy", " friend", " character", " born", " lives",
      " niño", " amigo", " personaje", " nacido", " vive",
      " enfant", " ami", " personnage", " ne ", " né ", " vit",
      " kind", " freund", " figur", " geboren", " lebt",
    ];
    return cues.reduce((score, cue) => score + (normalized.includes(normalizeEntityToken(cue)) ? 2 : 0), 0);
  };

  const graphSourceCueScore = (text = "", intent = {}) => {
    if (!intent.source) return 0;
    const normalized = normalizeEntityToken(text);
    if (!normalized) return 0;
    let score = 0;
    if (/\b(?:dice|disse|detto|racconta|racconto|raccontò|spiega|spiego|spiegò|rivela|rivelo|rivelò|indica|indico|indicò|comunica|comunico|comunicò|avverte|avverti|avvertì|tells|told|says|said|explains|explained|reveals|revealed|warns|warned|indicates|indicated)\b/.test(normalized)) score += 14;
    if (/\b(?:chi|who|quien|quién|qui|wer|anziano|anziana|elder|old man|old woman|anciano|anciana|vieil homme|vieille femme)\b/.test(normalized)) score += 6;
    if (/\b(?:cura|guarire|guar|heal|cure|voce|parlare|speak|voice|soluzione|solution|segreto|secret|consiglio|advice|istruzione|instruction)\b/.test(normalized)) score += 5;
    return score;
  };

  const graphDangerCueScore = (text = "", intent = {}) => {
    if (!intent.danger) return 0;
    const normalized = normalizeEntityToken(text);
    if (!normalized) return 0;
    let score = 0;
    if (/\b(?:pericol\w*|danger\w*|peligro\w*|dangereux|gefahr\w*|gefährlich\w*|risque\w*|risk\w*|risch\w*)\b/.test(normalized)) score += 8;
    if (/\b(?:ostacol\w*|obstacle\w*|obst[aá]cul\w*|hindernis\w*|cammino difficile|percorso difficile|difficult path|difficile)\b/.test(normalized)) score += 6;
    if (/\b(?:minacc\w*|threat\w*|menace\w*|bedrohung\w*|nemic\w*|ennemic\w*|enem\w*|monstr\w*|mostr\w*|monster\w*)\b/.test(normalized)) score += 8;
    if (/\b(?:attacc\w*|attacco|colp\w*|ferit\w*|ferisc\w*|ferend\w*|ferir\w*|violent\w*|hurt\w*|injur\w*|wound\w*|attack\w*|ataque|ataca\w*|herid\w*|bless\w*|verletz\w*)\b/.test(normalized)) score += 10;
    if (/\b(?:affront\w*|face|faced|facing|confront\w*|enfrent\w*|affronter|begegnet)\b/.test(normalized)) score += 5;
    if (/\b(?:oscura|oscuro|dark|darkness|sombre|foresta|forest|bosque|wald)\b/.test(normalized) &&
      /\b(?:pericol\w*|danger\w*|mostr\w*|monster\w*|minacc\w*|threat\w*|attacc\w*|attack\w*|ostacol\w*|obstacle\w*)\b/.test(normalized)) score += 4;
    return score;
  };

  const graphDangerExpansionTokens = ({ intent = {}, stopWords = new Set() } = {}) => {
    if (!intent.danger) return [];
    const terms = [
      "pericolo", "pericoli", "pericoloso", "rischio", "ostacolo", "ostacoli", "minaccia", "attacco", "attacca", "ferisce", "ferito", "colpisce", "violento", "mostro", "nemico", "ennemico", "affronta",
      "danger", "dangerous", "risk", "obstacle", "obstacles", "threat", "attack", "attacks", "hurt", "injured", "wounded", "violent", "monster", "enemy", "face", "faced", "confront",
      "peligro", "peligroso", "riesgo", "obstaculo", "amenaza", "ataque", "herido", "monstruo", "enfrenta",
      "danger", "dangereux", "risque", "obstacle", "menace", "attaque", "blesse", "monstre", "affronte",
      "gefahr", "gefährlich", "risiko", "hindernis", "bedrohung", "angriff", "verletzt", "monster",
    ];
    return unique(terms)
      .flatMap((value) => normalizeEntityToken(value).split(/\s+/))
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !stopWords.has(token));
  };

  const graphSourceExpansionTokens = ({ query = "", intent = {}, stopWords = new Set() } = {}) => {
    if (!intent.source) return [];
    const terms = [
      "dice", "disse", "detto", "racconta", "racconto", "raccontò", "spiega", "spiegò", "rivela", "rivelò", "indica", "indicò", "comunica", "comunicò", "avverte", "avvertì",
      "segreto", "soluzione", "consiglio", "istruzione", "informazione", "metodo", "luogo", "pericolo", "pericoloso",
      "tells", "told", "says", "said", "explains", "explained", "reveals", "revealed", "warns", "warned", "indicates", "indicated",
      "secret", "solution", "advice", "instruction", "information", "method", "place", "danger", "dangerous",
      "dice", "dijo", "cuenta", "contó", "explica", "explicó", "revela", "reveló", "indica", "indicó", "advierte", "advirtió",
      "secreto", "solución", "consejo", "instrucción", "información", "método", "lugar", "peligro", "peligroso",
      "dit", "raconte", "raconta", "explique", "révèle", "révéla", "indique", "avertit",
      "secret", "solution", "conseil", "instruction", "information", "méthode", "lieu", "danger", "dangereux",
      "sagt", "sagte", "erzählt", "erzählte", "erklärt", "erklärte", "offenbart", "warnte", "zeigt",
      "geheimnis", "lösung", "rat", "anweisung", "information", "methode", "ort", "gefahr", "gefährlich",
    ];
    return unique(terms)
      .flatMap((value) => normalizeEntityToken(value).split(/\s+/))
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !stopWords.has(token));
  };

  const graphQueryExpansionMode = (config = {}) => {
    const mode = String(config.queryExpansionMode || config.expansionMode || config.compositionMode || "llm").toLowerCase().trim();
    if (mode === "ai") return "llm";
    return ["rules", "llm", "hybrid"].includes(mode) ? mode : "rules";
  };

  const customKnowledgeRules = (config = {}) => {
    const raw = config.customRules;
    if (!raw) return {};
    if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
    try {
      const parsed = JSON.parse(String(raw || ""));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  };

  const customRulesMode = (rules = {}) =>
    String(rules.mode || "extend").toLowerCase().trim() === "replace" ? "replace" : "extend";

  const customRuleValues = (...values) => unique(values.flatMap((value) => {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") return value.split(/[\n,]+/g);
    return [];
  }).map((item) => String(item || "").trim()).filter(Boolean));

  const customRuleRegexes = (values = []) =>
    customRuleValues(values)
      .map((value) => String(value || "").trim())
      .filter((value) => value.length >= 2 && value.length <= 160)
      .map((value) => {
        try {
          return new RegExp(value, "iu");
        } catch (_) {
          return new RegExp(escapedRegExp(value), "iu");
        }
      });

  const customRulesReplace = (rules = {}, key = "") =>
    customRulesMode(rules) === "replace" && Boolean(rules[key]);

  const customRuleTokens = (values = [], { stopWords = new Set(), queryTokens = [] } = {}) =>
    graphQueryExpansionTokensFromValues(values, { stopWords, queryTokens: Array.isArray(queryTokens) ? queryTokens : [] });

  const graphQueryExpansionTokensFromValues = (values = [], { stopWords = new Set(), queryTokens = [] } = {}) =>
    unique((Array.isArray(values) ? values : [])
      .flatMap((value) => normalizeEntityToken(value).split(/\s+/))
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && token.length <= 32)
      .filter((token) => !stopWords.has(token))
      .filter((token) => !queryTokens.includes(token))
      .filter((token) => !/^\d+$/.test(token)));

  const callGraphQueryExpansionAi = async ({ query = "", intent = {}, config = {}, stopWords = new Set(), queryTokens = [] } = {}) => {
    const mode = graphQueryExpansionMode(config);
    if (!["llm", "hybrid"].includes(mode)) return { tokens: [], provider: "", model: "", usage: {}, error: "", promptMode: "" };
    const hasExplicitProvider = Boolean(config.providerProfile || config.profileId || config.providerType || config.provider || config.model);
    const providerConfig = hasExplicitProvider ? config : { ...config, providerType: "lm-studio" };
    const provider = await pickAiProvider({ ...providerConfig, enrichmentMode: "ai" });
    if (!provider) return { tokens: [], provider: "", model: "", usage: {}, error: "provider-not-found", promptMode: "" };
    const providerType = String(provider.provider || provider.providerType || providerConfig.providerType || providerConfig.provider || "").toLowerCase();
    const requestedModel = String(providerConfig.model || provider.model || (providerType === "ollama" ? "llama3.1" : "local-model")).trim();
    const model = providerType === "ollama"
      ? requestedModel
      : await resolveOpenAiCompatibleModel({ provider, model: requestedModel });
    const promptBudget = knowledgePromptBudget({ config, providerType, provider, chunksLength: chunks.length, defaultChunkLimit: chunks.length || 8, defaultChunkChars: 2200 });
    const systemPrompt = knowledgeAiTextConfig(
      config.systemPrompt,
      "You are a Knowledge Graph Query Expander. Improve retrieval only from the user's query and runtime intent. Do not answer, summarize, filter evidence or decide what the final answer should contain."
    );
    const promptTemplate = knowledgeAiTextConfig(
      config.promptTemplate,
      "Generate generic, multilingual retrieval terms that can help find relevant entities, relations, events and chunks. Preserve the original query meaning and never add story-specific names, causal conclusions or answer boundaries."
    );
    const outputInstructions = knowledgeAiTextConfig(
      config.outputInstructions,
      "Return strict JSON with retrievalTerms, optional intentHints and a short retrieval-only rationale. Omit unsupported or over-specific terms. Terms must be generic verbs/concepts, not proper names unless already present in the user query."
    );
    const prompt = [
      systemPrompt,
      promptTemplate,
      outputInstructions,
      "Return ONLY one valid JSON object. No markdown.",
      "Do not include final-answer wording, sentence limits, exclusions, or semantic filters.",
      "Do not include book/story-specific names that are not in the query.",
      "Prefer multilingual communication/search terms when the query asks who said, revealed, explained, indicated, warned or told something.",
      "Prefer generic danger/challenge/search terms when the query asks about dangers, risks, threats, attacks, injuries or obstacles.",
      JSON.stringify({
        schema: {
          retrievalTerms: ["generic retrieval term"],
          intentHints: ["source|mechanism|danger|definition|fact"],
          rationale: "short retrieval-only note",
        },
        query,
        detectedIntent: intent,
        existingQueryTokens: queryTokens,
      }),
    ].join("\n\n");
    try {
      const endpoint = String(provider.endpoint || (providerType === "ollama" ? "http://127.0.0.1:11434" : "http://127.0.0.1:1234")).replace(/\/+$/g, "");
      const url = providerType === "ollama"
        ? `${endpoint}/api/generate`
        : `${endpoint.endsWith("/v1") ? endpoint : `${endpoint}/v1`}/chat/completions`;
      const body = providerType === "ollama"
        ? {
          model,
          prompt,
          stream: false,
          options: {
            temperature: knowledgeAiNumberConfig(config.temperature, 0.05),
            top_p: knowledgeAiNumberConfig(config.topP, 0.9),
            num_predict: knowledgeCompletionLimit({ config, providerType, provider, requested: 360, min: 96 }),
          },
        }
        : {
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: knowledgeAiNumberConfig(config.temperature, 0.05),
          max_tokens: knowledgeCompletionLimit({ config, providerType, provider, requested: 360, min: 96 }),
          top_p: knowledgeAiNumberConfig(config.topP, 0.9),
        };
      knowledgeLlmDebug("graph-query-expansion:request", {
        mode,
        provider: provider.id || providerType || "",
        providerType,
        model,
        promptChars: prompt.length,
        maxTokens: body.max_tokens || body.options?.num_predict || 0,
        query: compactDebugText(query),
        promptPreview: compactDebugText(prompt),
      });
      const response = await postChatJson({ url, body, headers: headersForProvider(provider, config) });
      if (!response.ok) {
        const errorText = await chatErrorText(response);
        return { tokens: [], provider: provider.id || providerType || "provider", model, usage: {}, error: `HTTP ${response.status}${errorText ? `: ${errorText}` : ""}`, promptMode: "" };
      }
      const data = await response.json();
      const text = data.response || data.choices?.[0]?.message?.content || data.output_text || "";
      const patch = parseAiJsonObject(text);
      const usage = knowledgeAiUsageFromResponse({ data, prompt, text });
      const tokens = graphQueryExpansionTokensFromValues(patch?.retrievalTerms || [], { stopWords, queryTokens });
      return {
        tokens,
        provider: provider.id || providerType || "provider",
        model: data.model || model,
        usage,
        error: patch ? "" : "invalid-ai-json",
        promptMode: "json",
        intentHints: Array.isArray(patch?.intentHints) ? patch.intentHints.map((item) => String(item || "").trim()).filter(Boolean) : [],
        rationale: String(patch?.rationale || ""),
      };
    } catch (error) {
      return { tokens: [], provider: provider.id || providerType || "provider", model, usage: {}, error: error?.message || "ai-error", promptMode: "" };
    }
  };

  const graphMechanismCueMode = (config = {}) => {
    const mode = String(config.mechanismCueMode || config.queryExpansionMode || config.expansionMode || config.compositionMode || "llm").toLowerCase().trim();
    if (mode === "ai") return "llm";
    return ["rules", "llm", "hybrid"].includes(mode) ? mode : "rules";
  };

  const graphMechanismCueTokensFromValues = (values = [], { stopWords = new Set(), queryTokens = [], sourceTokens = new Set() } = {}) =>
    graphQueryExpansionTokensFromValues(values, { stopWords, queryTokens })
      .filter((token) => sourceTokens.has(token) || queryTokens.includes(token));

  const callGraphMechanismCueAi = async ({
    query = "",
    intent = {},
    chunks = [],
    relations = [],
    events = [],
    config = {},
    stopWords = new Set(),
    queryTokens = [],
  } = {}) => {
    const mode = graphMechanismCueMode(config);
    if (!["llm", "hybrid"].includes(mode) || !(intent.process || intent.healing || intent.cause)) {
      return { terms: [], operationalTerms: [], transformationTerms: [], outcomeTerms: [], downrankTerms: [], provider: "", model: "", usage: {}, error: "", promptMode: "" };
    }
    const configuredMechanismChunkLimit = Number(config.mechanismCueChunkLimit || config.maxChunks || 0);
    const chunkLimit = Number.isFinite(configuredMechanismChunkLimit) && configuredMechanismChunkLimit > 0
      ? Math.floor(configuredMechanismChunkLimit)
      : chunks.length;
    const candidateChunks = [...(Array.isArray(chunks) ? chunks : [])]
      .slice(0, chunkLimit)
      .sort((left, right) => Number(left.ordinal ?? left.index ?? 0) - Number(right.ordinal ?? right.index ?? 0))
      .map((chunk) => ({
        id: chunk.id || "",
        ordinal: chunk.ordinal ?? chunk.index ?? null,
        text: trimTextToEstimatedTokens(
          String(chunk.text || "").replace(/\s+/g, " "),
          promptChunkTokenBudget({
            maxChunkTokens: config.mechanismCueChunkTokens || config.maxChunkTokens || config.aiChunkTokens,
            maxChunkChars: config.mechanismCueChunkChars || config.maxChunkChars,
              defaultChunkTokens: 0,
          })
        ),
      }))
      .filter((chunk) => chunk.text);
    if (!candidateChunks.length) {
      return { terms: [], operationalTerms: [], transformationTerms: [], outcomeTerms: [], downrankTerms: [], provider: "", model: "", usage: {}, error: "no-candidate-chunks", promptMode: "" };
    }
    const sourceText = [
      query,
      candidateChunks.map((chunk) => chunk.text).join(" "),
      (Array.isArray(events) ? events : []).map((item) => [
        item.subject,
        item.eventType,
        ...(item.objects || []),
        ...(item.participants || []),
        item.evidence?.quote || item.evidence?.text || "",
      ].join(" ")).join(" "),
      (Array.isArray(relations) ? relations : []).map((item) => [
        item.sourceLabel,
        item.targetLabel,
        item.relationType,
        item.metadata?.explanation || "",
        item.evidence?.quote || "",
      ].join(" ")).join(" "),
    ].join(" ");
    const sourceTokens = new Set(normalizeEntityToken(sourceText)
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !stopWords.has(token)));
    const hasExplicitProvider = Boolean(config.providerProfile || config.profileId || config.providerType || config.provider || config.model);
    const providerConfig = hasExplicitProvider ? config : { ...config, providerType: "lm-studio" };
    const provider = await pickAiProvider({ ...providerConfig, enrichmentMode: "ai" });
    if (!provider) {
      return { terms: [], operationalTerms: [], transformationTerms: [], outcomeTerms: [], downrankTerms: [], provider: "", model: "", usage: {}, error: "provider-not-found", promptMode: "" };
    }
    const providerType = String(provider.provider || provider.providerType || providerConfig.providerType || providerConfig.provider || "").toLowerCase();
    const requestedModel = String(providerConfig.model || provider.model || (providerType === "ollama" ? "llama3.1" : "local-model")).trim();
    const model = providerType === "ollama"
      ? requestedModel
      : await resolveOpenAiCompatibleModel({ provider, model: requestedModel });
    const currentMechanismCueDefaults = {
      systemPrompt: "You are a Knowledge Mechanism Cue Agent. You do not answer the user. You identify only document-grounded retrieval cues that help find the concrete method, cause, transformation and direct outcome evidence in the supplied chunks.",
      promptTemplate: "Read the question and chunk previews in document order. For how/process/healing questions, prioritize the required sequence: item/tool/substance, preparation, container, transformation, action performed by or on the target, and the target's direct state change. Separate those from later consequences, background, public effects or generic setup.",
      outputInstructions: "Return strict JSON with operationalTerms, transformationTerms, outcomeTerms, downrankTerms and rationale. Use only exact source-language words or short phrases present in the chunks. Put later consequences or broad properties after the target outcome in downrankTerms unless the question asks for those consequences. Do not add final-answer wording or causal conclusions.",
    };
    const staleMechanismCueDefaults = new Set([
      "You are a Knowledge Mechanism Cue Agent. You do not answer the user. You identify only document-grounded retrieval cues that help find process, cause, method, transformation and outcome evidence in the supplied chunks.",
      "Read the question and chunk previews. Return short source-language terms or phrases that appear in the supplied material and can help Graph Query rank the real mechanism. Separate setup/actions, transformations, outcomes and generic background terms.",
      "Return strict JSON with operationalTerms, transformationTerms, outcomeTerms, downrankTerms and rationale. Do not add final-answer wording, causal conclusions or terms absent from the chunks. Put background/setup clues that should not dominate retrieval in downrankTerms.",
    ]);
    const cuePromptConfig = (value = "", fallback = "") => {
      const text = String(value || "").trim();
      return knowledgeAiTextConfig(staleMechanismCueDefaults.has(text) ? "" : text, fallback);
    };
    const systemPrompt = cuePromptConfig(
      config.mechanismCueSystemPrompt || config.systemPrompt,
      currentMechanismCueDefaults.systemPrompt
    );
    const promptTemplate = cuePromptConfig(
      config.mechanismCuePromptTemplate || config.promptTemplate,
      currentMechanismCueDefaults.promptTemplate
    );
    const outputInstructions = cuePromptConfig(
      config.mechanismCueOutputInstructions || config.outputInstructions,
      currentMechanismCueDefaults.outputInstructions
    );
    const prompt = [
      systemPrompt,
      promptTemplate,
      outputInstructions,
      "Return ONLY one valid JSON object. No markdown.",
      "Schema:",
      JSON.stringify({
        operationalTerms: ["object/action needed to perform the mechanism"],
        transformationTerms: ["change/process terms"],
        outcomeTerms: ["result/outcome terms"],
        downrankTerms: ["generic background/setup terms"],
        rationale: "one short retrieval-only note",
      }),
      JSON.stringify({
        query,
        detectedIntent: intent,
        chunks: candidateChunks,
        events: (Array.isArray(events) ? events : []).map((item) => ({
          sequence: item.sequence ?? null,
          subject: item.subject || "",
          eventType: item.eventType || "",
          objects: item.objects || [],
          quote: String(item.evidence?.quote || item.evidence?.text || ""),
        })),
      }),
    ].join("\n\n");
    const cueResultFromPatch = ({ patch = {}, usage = {}, promptMode = "json", model: resultModel = model, error = "" } = {}) => {
      const normalizeCueList = (values = []) => graphMechanismCueTokensFromValues(values, { stopWords, queryTokens, sourceTokens });
      const operationalTerms = normalizeCueList(patch.operationalTerms || []);
      const transformationTerms = normalizeCueList(patch.transformationTerms || []);
      const outcomeTerms = normalizeCueList(patch.outcomeTerms || []);
      const downrankTerms = normalizeCueList(patch.downrankTerms || []);
      const terms = unique([...operationalTerms, ...transformationTerms, ...outcomeTerms]);
      return {
        terms,
        operationalTerms,
        transformationTerms,
        outcomeTerms,
        downrankTerms,
        provider: provider.id || providerType || "provider",
        model: resultModel,
        usage,
        error,
        promptMode,
        rationale: String(patch.rationale || ""),
      };
    };
    try {
      const endpoint = String(provider.endpoint || (providerType === "ollama" ? "http://127.0.0.1:11434" : "http://127.0.0.1:1234")).replace(/\/+$/g, "");
      const url = providerType === "ollama"
        ? `${endpoint}/api/generate`
        : `${endpoint.endsWith("/v1") ? endpoint : `${endpoint}/v1`}/chat/completions`;
      const body = providerType === "ollama"
        ? {
          model,
          prompt,
          stream: false,
          format: "json",
          options: {
            temperature: knowledgeAiNumberConfig(config.temperature, 0.05),
            top_p: knowledgeAiNumberConfig(config.topP, 0.9),
            num_predict: knowledgeCompletionLimit({ config: { ...config, maxTokens: config.mechanismCueMaxTokens || config.maxTokens }, providerType, provider, requested: 420, min: 160 }),
          },
        }
        : withJsonObjectResponseFormat({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: knowledgeAiNumberConfig(config.temperature, 0.05),
          max_tokens: knowledgeCompletionLimit({ config: { ...config, maxTokens: config.mechanismCueMaxTokens || config.maxTokens }, providerType, provider, requested: 420, min: 160 }),
          top_p: knowledgeAiNumberConfig(config.topP, 0.9),
        }, providerType, config);
      knowledgeLlmDebug("graph-mechanism-cues:request", {
        mode,
        provider: provider.id || providerType || "",
        providerType,
        model,
        promptChars: prompt.length,
        chunkCount: candidateChunks.length,
        maxTokens: body.max_tokens || body.options?.num_predict || 0,
        query: compactDebugText(query),
        promptPreview: compactDebugText(prompt),
      });
      let response = await postChatJson({ url, body, headers: headersForProvider(provider, config) });
      let responseErrorText = response.ok ? "" : await chatErrorText(response);
      if (!response.ok && providerType !== "ollama" && /json|format/i.test(responseErrorText)) {
        const fallbackBody = { ...body };
        delete fallbackBody.response_format;
        response = await postChatJson({ url, body: fallbackBody, headers: headersForProvider(provider, config) });
        responseErrorText = response.ok ? "" : await chatErrorText(response);
      }
      if (!response.ok) {
        return { terms: [], operationalTerms: [], transformationTerms: [], outcomeTerms: [], downrankTerms: [], provider: provider.id || providerType || "provider", model, usage: {}, error: `HTTP ${response.status}${responseErrorText ? `: ${responseErrorText}` : ""}`, promptMode: "" };
      }
      const data = await response.json();
      const text = data.response || data.choices?.[0]?.message?.content || data.output_text || "";
      let patch = parseAiJsonObject(text);
      let usage = knowledgeAiUsageFromResponse({ data, prompt, text });
      let resultModel = data.model || model;
      let promptMode = "mechanism-cues";
      let repairText = "";
      if (!patch) {
        const repairPrompt = [
          "Convert this failed mechanism-cue response into one strict JSON object.",
          "Use only terms that appear in the supplied chunk text. Do not answer the question.",
          "Return ONLY JSON with operationalTerms, transformationTerms, outcomeTerms, downrankTerms and rationale.",
          "Schema:",
          JSON.stringify({
            operationalTerms: [],
            transformationTerms: [],
            outcomeTerms: [],
            downrankTerms: [],
            rationale: "",
          }),
          JSON.stringify({ rawResponse: String(text || ""), chunks: candidateChunks, query }),
        ].join("\n\n");
        const repairMaxTokens = knowledgeCompletionLimit({ config, providerType, provider, requested: 520, min: 1 });
        const repairBody = providerType === "ollama"
          ? { model, prompt: repairPrompt, stream: false, format: "json", options: { temperature: 0.01, top_p: 0.9, num_predict: repairMaxTokens } }
          : withJsonObjectResponseFormat({ model, messages: [{ role: "user", content: repairPrompt }], temperature: 0.01, max_tokens: repairMaxTokens, top_p: 0.9 }, providerType, config);
        let repairResponse = await postChatJson({ url, body: repairBody, headers: headersForProvider(provider, config) });
        let repairErrorText = repairResponse.ok ? "" : await chatErrorText(repairResponse);
        if (!repairResponse.ok && providerType !== "ollama" && /json|format/i.test(repairErrorText)) {
          const fallbackBody = { ...repairBody };
          delete fallbackBody.response_format;
          repairResponse = await postChatJson({ url, body: fallbackBody, headers: headersForProvider(provider, config) });
          repairErrorText = repairResponse.ok ? "" : await chatErrorText(repairResponse);
        }
        if (repairResponse.ok) {
          const repairData = await repairResponse.json();
          repairText = repairData.response || repairData.choices?.[0]?.message?.content || repairData.output_text || "";
          usage = addKnowledgeAiUsage(usage, knowledgeAiUsageFromResponse({ data: repairData, prompt: repairPrompt, text: repairText }));
          resultModel = repairData.model || resultModel;
          patch = parseAiJsonObject(repairText);
          promptMode = patch ? "mechanism-cues-repair" : "json";
        } else {
          promptMode = "json";
        }
      }
      if (!patch) {
        const salvagedTerms = graphMechanismCueTokensFromValues(
          unique([text, repairText]
            .join(" ")
            .replace(/```[a-z]*|```/gi, " ")
            .split(/[\s,;:.()[\]{}"“”'’«»!?/\\|-]+/g)
            .map((item) => item.trim())
            .filter(Boolean)),
          { stopWords, queryTokens, sourceTokens }
        );
        if (salvagedTerms.length) {
          return cueResultFromPatch({
            patch: {
              operationalTerms: salvagedTerms,
              transformationTerms: [],
              outcomeTerms: [],
              downrankTerms: [],
              rationale: "Recovered grounded cue terms from non-JSON LLM output.",
            },
            usage,
            promptMode: "mechanism-cues-salvaged",
            model: resultModel,
            error: "salvaged-non-json",
          });
        }
        return { terms: [], operationalTerms: [], transformationTerms: [], outcomeTerms: [], downrankTerms: [], provider: provider.id || providerType || "provider", model: data.model || model, usage, error: "invalid-ai-json", promptMode: "json" };
      }
      return cueResultFromPatch({ patch, usage, promptMode, model: resultModel });
    } catch (error) {
      return { terms: [], operationalTerms: [], transformationTerms: [], outcomeTerms: [], downrankTerms: [], provider: provider.id || providerType || "provider", model, usage: {}, error: error?.message || "ai-error", promptMode: "" };
    }
  };

  const emptyGraphMechanismCueResult = () => ({
    terms: [],
    operationalTerms: [],
    transformationTerms: [],
    outcomeTerms: [],
    downrankTerms: [],
    provider: "",
    model: "",
    usage: {},
    error: "",
    promptMode: "",
    rationale: "",
    external: false,
  });

  const normalizeGraphMechanismCuePayload = (value = {}, { external = false, sourceNodeId = "" } = {}) => {
    const cue = value?.mechanismCue && typeof value.mechanismCue === "object"
      ? value.mechanismCue
      : value && typeof value === "object"
        ? value
        : {};
    const cueList = (items = []) => graphQueryExpansionTokensFromValues(
      Array.isArray(items) ? items : String(items || "").split(/[\s,;]+/g)
    );
    const operationalTerms = cueList(cue.operationalTerms || cue.operationTerms || []);
    const transformationTerms = cueList(cue.transformationTerms || cue.transformTerms || []);
    const outcomeTerms = cueList(cue.outcomeTerms || cue.resultTerms || []);
    const downrankTerms = cueList(cue.downrankTerms || cue.backgroundTerms || []);
    const terms = unique([
      ...(cueList(cue.terms || cue.mechanismTerms || [])),
      ...operationalTerms,
      ...transformationTerms,
      ...outcomeTerms,
    ]);
    return {
      terms,
      operationalTerms,
      transformationTerms,
      outcomeTerms,
      downrankTerms,
      provider: String(cue.provider || value?.provider || ""),
      model: String(cue.model || value?.model || ""),
      usage: cue.usage && typeof cue.usage === "object" ? cue.usage : {},
      error: String(cue.error || value?.error || ""),
      promptMode: String(cue.promptMode || value?.promptMode || ""),
      rationale: String(cue.rationale || value?.rationale || ""),
      external,
      sourceNodeId: String(cue.sourceNodeId || value?.sourceNodeId || sourceNodeId || ""),
      id: String(value?.mechanismCueId || cue.id || value?.id || ""),
    };
  };

  const buildKnowledgeMechanismCues = async ({ workspaceId, node = {}, payload = {}, event = {}, config = {} } = {}) => {
    const query = String(payload?.query || payload?.text || payload?.question || payload?.entity || payload?.label || config.query || "").trim();
    if (!query) throw new Error("Knowledge Mechanism Cue query vuota");
    const collectionId = String(payload?.collectionId || payload?.metadata?.collectionId || config.collectionId || "").trim();
    const configuredDocumentId = String(payload?.documentId || config.documentId || "").trim();
    const rawGraphScope = String(payload?.graphScope || config.graphScope || "").toLowerCase();
    const graphScope = rawGraphScope === "document" && !configuredDocumentId && collectionId
      ? "collection"
      : rawGraphScope || (configuredDocumentId ? "document" : collectionId ? "collection" : "workspace");
    const aggregateDocuments = graphScope === "collection" || graphScope === "workspace" || graphScope === "all";
    const [chunksAll, relationsAll, eventsAll] = await Promise.all([
      listStore(STORES.chunks),
      listStore(STORES.relations),
      listStore(STORES.events),
    ]);
    const workspaceChunks = byWorkspace(chunksAll, workspaceId)
      .filter((chunk) => !collectionId || chunk.metadata?.collectionId === collectionId);
    const latestChunkDocument = [...workspaceChunks]
      .filter((chunk) => chunk.documentId)
      .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || "") - Date.parse(a.updatedAt || a.createdAt || ""))[0] || null;
    const documentId = aggregateDocuments ? "" : configuredDocumentId || latestChunkDocument?.documentId || "";
    const scopedChunks = workspaceChunks
      .filter((chunk) => !documentId || chunk.documentId === documentId)
      .sort((left, right) => Number(left.ordinal ?? left.index ?? 0) - Number(right.ordinal ?? right.index ?? 0));
    const scopedRelations = byWorkspace(relationsAll, workspaceId)
      .filter((relation) => !documentId || relation.documentId === documentId)
      .filter((relation) => !collectionId || relation.metadata?.collectionId === collectionId);
    const scopedEvents = byWorkspace(eventsAll, workspaceId)
      .filter((item) => !documentId || item.documentId === documentId)
      .filter((item) => !collectionId || item.collectionId === collectionId)
      .sort((left, right) => Number(left.sequence || 0) - Number(right.sequence || 0));
    const queryLanguage = detectLanguage(query, payload?.language || config.language || "");
    const queryStopWords = languageStopWordSet({ ...config, language: queryLanguage }, query);
    const queryTokens = normalizeEntityToken(query).split(/\s+/).filter((token) => token.length > 1 && !queryStopWords.has(token));
    const intent = graphQueryIntent(query);
    const cueConfig = {
      ...config,
      mechanismCueMode: config.cueMode || config.mechanismCueMode || config.queryExpansionMode || "llm",
      mechanismCueSystemPrompt: config.systemPrompt || config.mechanismCueSystemPrompt,
      mechanismCuePromptTemplate: config.promptTemplate || config.mechanismCuePromptTemplate,
      mechanismCueOutputInstructions: config.outputInstructions || config.mechanismCueOutputInstructions,
      mechanismCueChunkLimit: config.maxChunks || config.mechanismCueChunkLimit,
      mechanismCueChunkTokens: config.maxChunkTokens || config.mechanismCueChunkTokens,
      mechanismCueChunkChars: config.maxChunkChars || config.mechanismCueChunkChars,
    };
    let mechanismCue = await callGraphMechanismCueAi({
      query,
      intent,
      chunks: scopedChunks,
      relations: scopedRelations,
      events: scopedEvents,
      config: cueConfig,
      stopWords: queryStopWords,
      queryTokens,
    });
    const cueRules = customKnowledgeRules(cueConfig);
    const useCustomRuleCue = graphMechanismCueMode(cueConfig) !== "llm";
    if (useCustomRuleCue) {
      const customOperational = customRuleTokens(customRuleValues(cueRules.mechanismTerms?.operational, cueRules.mechanismTerms?.operations), { stopWords: queryStopWords });
      const customTransformation = customRuleTokens(customRuleValues(cueRules.mechanismTerms?.transformation, cueRules.mechanismTerms?.transformations), { stopWords: queryStopWords });
      const customOutcome = customRuleTokens(customRuleValues(cueRules.mechanismTerms?.outcome, cueRules.mechanismTerms?.outcomes), { stopWords: queryStopWords });
      const customDownrank = customRuleTokens(customRuleValues(cueRules.mechanismTerms?.downrank, cueRules.mechanismTerms?.background), { stopWords: queryStopWords });
      const customTerms = customRuleTokens(customRuleValues(cueRules.mechanismTerms?.terms, cueRules.mechanismTerms?.evidence), { stopWords: queryStopWords });
      if ([customOperational, customTransformation, customOutcome, customDownrank, customTerms].some((items) => items.length)) {
        mechanismCue = {
          ...mechanismCue,
          terms: unique([...(customRulesMode(cueRules) === "replace" ? [] : (mechanismCue.terms || [])), ...customTerms, ...customOperational, ...customTransformation, ...customOutcome]),
          operationalTerms: unique([...(customRulesMode(cueRules) === "replace" ? [] : (mechanismCue.operationalTerms || [])), ...customOperational]),
          transformationTerms: unique([...(customRulesMode(cueRules) === "replace" ? [] : (mechanismCue.transformationTerms || [])), ...customTransformation]),
          outcomeTerms: unique([...(customRulesMode(cueRules) === "replace" ? [] : (mechanismCue.outcomeTerms || [])), ...customOutcome]),
          downrankTerms: unique([...(customRulesMode(cueRules) === "replace" ? [] : (mechanismCue.downrankTerms || [])), ...customDownrank]),
          promptMode: mechanismCue.promptMode || "custom-rules",
          rationale: mechanismCue.rationale || "Custom declarative mechanism cue rules.",
        };
      }
    }
    if (mechanismCue.usage?.totalTokens) {
      await persistKnowledgeNodeTokenUsage({ node, usage: mechanismCue.usage, provider: mechanismCue.provider, model: mechanismCue.model });
    }
    const normalizedCue = normalizeGraphMechanismCuePayload(mechanismCue, { external: true, sourceNodeId: node.id });
    const context = [
      `Knowledge Mechanism Cues: ${query}`,
      `Scope: ${graphScope}${collectionId ? ` collection=${collectionId}` : ""}${documentId ? ` document=${documentId}` : ""}`,
      normalizedCue.terms.length ? `Terms: ${normalizedCue.terms.join(", ")}` : "Terms: none",
      normalizedCue.operationalTerms.length ? `Operational: ${normalizedCue.operationalTerms.join(", ")}` : "",
      normalizedCue.transformationTerms.length ? `Transformation: ${normalizedCue.transformationTerms.join(", ")}` : "",
      normalizedCue.outcomeTerms.length ? `Outcome: ${normalizedCue.outcomeTerms.join(", ")}` : "",
      normalizedCue.downrankTerms.length ? `Downrank: ${normalizedCue.downrankTerms.join(", ")}` : "",
      normalizedCue.rationale ? `Rationale: ${normalizedCue.rationale}` : "",
    ].filter(Boolean).join("\n");
    const record = {
      ...clonePayload(payload),
      id: uniqueId("kmechcue"),
      workspaceId,
      query,
      collectionId,
      documentId,
      graphScope,
      mechanismCue: normalizedCue,
      mechanismCueId: "",
      terms: normalizedCue.terms,
      operationalTerms: normalizedCue.operationalTerms,
      transformationTerms: normalizedCue.transformationTerms,
      outcomeTerms: normalizedCue.outcomeTerms,
      downrankTerms: normalizedCue.downrankTerms,
      context,
      ai: {
        provider: normalizedCue.provider,
        model: normalizedCue.model,
        error: normalizedCue.error,
        promptMode: normalizedCue.promptMode,
        rationale: normalizedCue.rationale,
      },
      source: {
        method: "llm-mechanism-cue-agent",
        inputChannel: event?.channel || "",
        sourceNodeId: event?.sourceNodeId || "",
        chunkCount: scopedChunks.length,
        eventCount: scopedEvents.length,
        relationCount: scopedRelations.length,
      },
      createdAt: nowIso(),
    };
    record.mechanismCueId = record.id;
    record.mechanismCue = { ...normalizedCue, id: record.id, sourceNodeId: node.id };
    return record;
  };

  const graphHealingMechanismCueScore = (text = "", intent = {}) => {
    if (!intent.healing) return 0;
    const normalized = normalizeEntityToken(text);
    if (!normalized) return 0;
    let score = 0;
    if (/\b(?:prepara|prepar\w*|prepare\w*|usa|usato|use\w*|riemp\w*|fill\w*|immerg\w*|immerse\w*|trasform\w*|transform\w*|boll\w*|boil\w*|beve|beva|bevve|bevuto|bere|drink|drank|drinks)\b/.test(normalized)) score += 10;
    if (/\b(?:guar\w*|cura\w*|heal\w*|cure\w*|potere|poteri|power|ability|capacit\w*)\b/.test(normalized)) score += 5;
    return score;
  };

  const graphEvidenceSnippet = (text = "", labels = [], max = 900) => {
    const source = String(text || "").trim();
    if (!source || source.length <= max) return source;
    const lower = source.toLowerCase();
    const matchedLabel = labels
      .map((label) => String(label || "").trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)
      .find((label) => lower.includes(label.toLowerCase()));
    if (!matchedLabel) return source.slice(0, max);
    const index = lower.indexOf(matchedLabel.toLowerCase());
    const start = Math.max(0, index - Math.floor(max * 0.35));
    const end = Math.min(source.length, start + max);
    const clipped = source.slice(start, end).trim();
    return start > 0 ? `...${clipped}` : clipped;
  };

  const scoreKnowledgeEventForQuery = (event = {}, queryTokens = [], seedLabels = [], intent = {}) => {
    const text = normalizeEntityToken([
      event.eventType,
      event.subject,
      event.action,
      ...(event.objects || []),
      ...(event.participants || []),
      event.evidence?.text || event.evidence?.quote || "",
    ].join(" "));
    if (!text) return 0;
    let score = 0;
    seedLabels.forEach((label) => {
      if (label && text.includes(label)) score += 10;
    });
    queryTokens.forEach((token) => {
      if (token && text.includes(token)) score += 4;
    });
    if (intent.healing && ["fills", "immerses", "transforms", "takes", "drinks", "heals", "speaks", "has_property"].includes(event.eventType)) score += 14;
    if (intent.healing && graphHealingMechanismCueScore(event.evidence?.text || event.evidence?.quote || "", intent) >= 8) score += 10;
    if (intent.source && ["speaks", "gives_to", "receives_from"].includes(event.eventType)) score += 10;
    if (intent.source && graphSourceCueScore(event.evidence?.text || event.evidence?.quote || "", intent) >= 14) score += 12;
    if (intent.cause && ["transforms", "drinks", "heals", "speaks"].includes(event.eventType)) score += 8;
    if (intent.danger && ["encounters", "confronts", "attacks", "hurts", "opposes", "threatens", "moves"].includes(event.eventType)) score += 10;
    if (intent.danger && graphDangerCueScore(event.evidence?.text || event.evidence?.quote || text, intent) >= 10) score += 14;
    if (score <= 0) return 0;
    score += Math.min(4, Number(event.confidence || 0) * 4);
    return score;
  };

  const graphEventEvidenceText = (event = {}) =>
    String(event.evidence?.text || event.evidence?.quote || event.evidence || "").trim();

  const graphEventNormalizedText = (event = {}) => normalizeEntityToken([
    event.eventType,
    event.subject,
    ...(event.objects || []),
    ...(event.participants || []),
    ...(event.roles?.agent || []),
    ...(event.roles?.patient || []),
    ...(event.roles?.object || []),
    ...(event.roles?.destination || []),
    graphEventEvidenceText(event),
  ].join(" "));

  const graphProcessOutcomeEventTypes = new Set([
    "speaks", "heals", "drinks", "receives_from", "gives_to", "takes", "causes", "leads_to", "transforms", "uses",
  ]);

  const graphProcessWindowEvents = ({ events = [], scoredEvents = [], queryTokens = [], seedLabels = [], intent = {}, maxEvents = 12 } = {}) => {
    if (!intent.process && !intent.cause && !intent.healing) return [];
    const ordered = [...events]
      .filter((item) => graphEventEvidenceText(item))
      .sort((left, right) => Number(left.sequence || 0) - Number(right.sequence || 0));
    if (!ordered.length) return [];
    const scoreById = new Map(scoredEvents.map(({ event, score }) => [event.id, score]));
    const eventOverlap = (event = {}) => {
      const text = graphEventNormalizedText(event);
      const tokenScore = queryTokens.reduce((score, token) => score + (token && text.includes(token) ? 1 : 0), 0);
      const seedScore = seedLabels.reduce((score, label) => score + (label && text.includes(label) ? 2 : 0), 0);
      return tokenScore + seedScore;
    };
    const anchors = ordered
      .map((event, index) => {
        const baseScore = scoreById.get(event.id) || 0;
        const overlap = eventOverlap(event);
        const outcomeBonus = graphProcessOutcomeEventTypes.has(event.eventType) ? 18 : 0;
        const healingBonus = intent.healing && graphHealingMechanismCueScore(graphEventEvidenceText(event), intent) >= 8 ? 8 : 0;
        const hasQuerySignal = baseScore > 0 || overlap > 0 || healingBonus > 0;
        return { event, index, score: hasQuerySignal ? baseScore + (overlap * 8) + outcomeBonus + healingBonus : 0 };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.index - a.index);
    const anchor = anchors[0];
    if (!anchor) return [];
    const before = Math.max(3, Math.min(10, Number(maxEvents) - 2));
    const start = Math.max(0, anchor.index - before);
    const end = Math.min(ordered.length - 1, anchor.index + 1);
    return ordered
      .slice(start, end + 1)
      .map((event, index) => ({
        event,
        score: Math.max(scoreById.get(event.id) || 0, 8 + Math.max(0, before - Math.abs((start + index) - anchor.index))),
      }))
      .slice(-maxEvents);
  };

  const graphEvidenceMatchedTokens = (text = "", tokens = []) => {
    const normalized = normalizeEntityToken(text);
    if (!normalized) return [];
    const normalizedTokens = new Set(normalized.split(/\s+/).filter(Boolean));
    return unique(tokens
      .map((token) => String(token || "").trim())
      .filter((token) => token.length >= 2)
      .filter((token) => token.length <= 4 ? normalizedTokens.has(token) : normalized.includes(token)));
  };

  const parseJsonLike = (value, fallback = null) => {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value === "object") return value;
    try {
      return JSON.parse(String(value));
    } catch {
      return fallback;
    }
  };

  const unwrapStructuredPayload = (payload = {}, config = {}) => {
    const candidates = [
      payload?.value,
      payload?.json,
      payload?.payload,
      payload?.data,
      payload?.body,
      payload,
      config.json,
      config.payloadJson,
      config.payload,
      config.manualJson,
    ];
    const isRuntimeEnvelope = (item = null) => item && typeof item === "object" && Boolean(item.__test || item.runId || item.nodeId || item.sourceNodeId || item.channel);
    const hasStructuredSignal = (item = null) => item && typeof item === "object" && !Array.isArray(item) && Boolean(
      item.world || item.records || item.record || item.items || item.kingdoms || item.regni || item.packs || item.branchi ||
      item.storyBlocks || item.stories || item.schemaId || item.recordType || item.type || item.kind ||
      (!isRuntimeEnvelope(item) && (item.name || item.title))
    );
    let firstObject = null;
    for (const candidate of candidates) {
      const parsed = parseJsonLike(candidate, candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        if (!firstObject) firstObject = parsed;
        if (hasStructuredSignal(parsed)) return parsed;
      }
    }
    return firstObject || (payload && typeof payload === "object" ? payload : {});
  };

  const structuredArray = (value) => {
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") return [value];
    return [];
  };

  const structuredPayloadRecords = (payload = {}, config = {}) => {
    const source = unwrapStructuredPayload(payload, config);
    const configRecords = parseJsonLike(config.records || config.seedRecords || "", null);
    const configRecord = parseJsonLike(config.record || config.seedRecord || "", null);
    return [
      ...structuredArray(source?.records),
      ...structuredArray(source?.record),
      ...structuredArray(source?.items),
      ...structuredArray(source?.data?.records),
      ...structuredArray(configRecords),
      ...structuredArray(configRecord),
    ].filter((item) => item && typeof item === "object");
  };

  const structuredRecordType = (item = {}, config = {}) =>
    String(item.recordType || item.type || item.kind || item.entityType || config.recordType || "record")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.:-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "record";

  const structuredRecordLabel = (item = {}) =>
    String(item.label || item.name || item.title || item.id || "").replace(/\s+/g, " ").trim();

  const structuredRecordData = (item = {}) => {
    const reserved = new Set([
      "id", "workspaceId", "collectionId", "schemaId", "schemaVersion", "recordType", "type", "kind", "parentId", "worldId",
      "label", "name", "title", "tags", "data", "metadata", "createdAt", "updatedAt",
    ]);
    const data = item.data && typeof item.data === "object" ? { ...item.data } : {};
    Object.entries(item || {}).forEach(([key, value]) => {
      if (!reserved.has(key)) data[key] = value;
    });
    return data;
  };

  const structuredRecordsForScope = async ({ workspaceId = "workspace_global", collectionId = "", schemaId = "", worldId = "" } = {}) =>
    byWorkspace(await listStore(STORES.structured), workspaceId)
      .filter((record) => !collectionId || record.collectionId === collectionId)
      .filter((record) => !schemaId || record.schemaId === schemaId)
      .filter((record) => !worldId || record.worldId === worldId);

  const buildStructuredKnowledgeStore = async ({ workspaceId, node, payload, event, config = {} } = {}) => {
    const now = nowIso();
    const collectionId = payload?.collectionId || payload?.metadata?.collectionId || config.collectionId || "structured_default";
    const schemaId = payload?.schemaId || config.schemaId || "structured/v1";
    const schemaVersion = payload?.schemaVersion || config.schemaVersion || "1";
    const worldId = payload?.worldId || config.worldId || "";
    const replaceExisting = config.replaceExisting === true || config.replaceExisting === "true";
    const records = structuredPayloadRecords(payload, config);
    if (!records.length) throw new Error("Structured Knowledge Store: nessun record JSON da salvare");
    if (replaceExisting) {
      const existing = await structuredRecordsForScope({ workspaceId, collectionId, schemaId, worldId });
      await deleteRecords(STORES.structured, existing.map((record) => record.id));
    }
    const saved = [];
    for (const item of records) {
      const recordType = structuredRecordType(item, config);
      const label = structuredRecordLabel(item);
      const id = item.id || `sk_${safeId(collectionId)}_${safeId(schemaId)}_${safeId(recordType)}_${safeId(label || uniqueId("record"))}`;
      const previous = await getRecord(STORES.structured, id).catch(() => null);
      const record = {
        id,
        workspaceId,
        collectionId,
        schemaId,
        schemaVersion,
        recordType,
        parentId: item.parentId || item.parent || config.parentId || "",
        worldId: item.worldId || worldId,
        label,
        tags: Array.isArray(item.tags) ? item.tags : String(item.tags || "").split(/[,;\n]+/).map((tag) => tag.trim()).filter(Boolean),
        data: structuredRecordData(item),
        metadata: {
          ...(item.metadata && typeof item.metadata === "object" ? item.metadata : {}),
          nodeId: node?.id || "",
          inputChannel: event?.channel || "",
          sourceNodeId: event?.sourceNodeId || "",
        },
        status: item.status || "ready",
        createdAt: previous?.createdAt || now,
        updatedAt: now,
      };
      saved.push(await putRecord(STORES.structured, record));
    }
    const scopedRecords = await structuredRecordsForScope({ workspaceId, collectionId, schemaId, worldId });
    const typeCounts = scopedRecords.reduce((counts, record) => {
      counts[record.recordType] = (counts[record.recordType] || 0) + 1;
      return counts;
    }, {});
    return {
      collectionId,
      schemaId,
      schemaVersion,
      worldId,
      records: saved,
      recordCount: saved.length,
      totalRecordCount: scopedRecords.length,
      typeCounts,
      context: {
        collectionId,
        schemaId,
        worldId,
        recordCount: scopedRecords.length,
        typeCounts,
        records: scopedRecords,
      },
    };
  };

  const worldTypeAliases = {
    kingdom: "kingdom",
    regno: "kingdom",
    realm: "kingdom",
    pack: "pack",
    branco: "pack",
    clan: "pack",
    class: "class",
    classe: "class",
    role: "class",
    personality: "personality",
    personalita: "personality",
    personalità: "personality",
    name: "name",
    nome: "name",
    storyblock: "story_block",
    "story-block": "story_block",
    story_block: "story_block",
    blocco_storia: "story_block",
    story: "story",
    storia: "story",
    territory: "territory",
    territorio: "territory",
    law: "law",
    legge: "law",
  };

  const normalizeWorldRecordType = (item = {}) => {
    const raw = structuredRecordType(item, { recordType: "world_item" }).replace(/^worldbuilding[_.:-]/, "");
    return worldTypeAliases[raw] || raw;
  };

  const worldPayloadRecords = (payload = {}, config = {}) => {
    const source = unwrapStructuredPayload(payload, config);
    const explicit = structuredPayloadRecords(source, config);
    const sourceLooksLikeWorld = source && typeof source === "object" && (
      source.kingdoms || source.regni || source.packs || source.branchi || source.storyBlocks || source.stories || source.name || source.title
    );
    const world = source?.world && typeof source.world === "object"
      ? source.world
      : sourceLooksLikeWorld
        ? source
        : parseJsonLike(config.worldJson || config.seedWorld || "", null);
    if (!world || typeof world !== "object") return explicit;
    const worldId = world.id || source.worldId || config.worldId || "";
    const records = [...explicit];
    if (world.name || world.title || world.id) records.push({ ...world, type: "world", worldId, data: { ...(world.data || {}), description: world.description || "" } });
    const appendTyped = (items = [], type = "") => structuredArray(items).forEach((item) => records.push({ ...item, type, worldId: item.worldId || worldId }));
    appendTyped(world.kingdoms || world.regni, "kingdom");
    appendTyped(world.packs || world.branchi || world.clans, "pack");
    appendTyped(world.classes || world.classi || world.roles, "class");
    appendTyped(world.personalities || world.personalita || world.personalità, "personality");
    appendTyped(world.names || world.nomi, "name");
    appendTyped(world.storyBlocks || world.story_blocks || world.blocchiStoria, "story_block");
    appendTyped(world.stories || world.storie, "story");
    return records;
  };

  const validateWorldRecords = (records = []) => {
    const warnings = [];
    const byId = new Map(records.map((record) => [record.id, record]));
    const byLabelType = new Map(records.map((record) => [`${record.recordType}::${normalizeEntityToken(record.label || record.id)}`, record]));
    const findEndpoint = (idOrLabel = "", type = "") => {
      if (!idOrLabel) return null;
      if (byId.has(idOrLabel)) return byId.get(idOrLabel);
      const key = `${type}::${normalizeEntityToken(idOrLabel)}`;
      return byLabelType.get(key) || null;
    };
    records.filter((record) => record.recordType === "pack").forEach((record) => {
      const kingdomRef = record.data?.kingdomId || record.data?.kingdom || record.parentId;
      if (!findEndpoint(kingdomRef, "kingdom")) warnings.push({ recordId: record.id, recordType: record.recordType, warning: "pack-missing-kingdom", ref: kingdomRef || "" });
    });
    records.filter((record) => record.recordType === "story").forEach((record) => {
      const blockRefs = structuredArray(record.data?.blocks || record.data?.storyBlocks);
      blockRefs.forEach((block) => {
        const blockRef = typeof block === "string" ? block : block.id || block.blockId || block.type || "";
        if (blockRef && !findEndpoint(blockRef, "story_block")) warnings.push({ recordId: record.id, recordType: record.recordType, warning: "story-missing-block", ref: blockRef });
      });
    });
    return warnings;
  };

  const worldGraphFromRecords = (records = []) => {
    const entities = records.map((record) => ({
      id: record.id,
      label: record.label || record.id,
      entityType: record.recordType,
      recordType: record.recordType,
      worldId: record.worldId || "",
    }));
    const byId = new Map(records.map((record) => [record.id, record]));
    const byTypeLabel = new Map(records.map((record) => [`${record.recordType}::${normalizeEntityToken(record.label || record.id)}`, record]));
    const resolve = (value = "", type = "") => byId.get(value) || byTypeLabel.get(`${type}::${normalizeEntityToken(value)}`) || null;
    const relations = [];
    const addRelation = (source, relationType, target) => {
      if (!source?.id || !target?.id || source.id === target.id) return;
      relations.push({
        id: `worldrel_${safeId(relationType)}_${safeId(source.id)}_${safeId(target.id)}`,
        sourceEntityId: source.id,
        targetEntityId: target.id,
        sourceLabel: source.label || source.id,
        targetLabel: target.label || target.id,
        relationType,
      });
    };
    records.forEach((record) => {
      if (record.parentId) addRelation(record, "belongs_to", byId.get(record.parentId));
      if (record.recordType === "pack") addRelation(record, "belongs_to", resolve(record.data?.kingdomId || record.data?.kingdom || "", "kingdom"));
      if (record.recordType === "territory") addRelation(record, "belongs_to", resolve(record.data?.packId || record.data?.pack || "", "pack"));
      if (record.recordType === "law") addRelation(resolve(record.data?.packId || record.data?.pack || "", "pack") || record, "follows", record);
      if (record.recordType === "story") {
        structuredArray(record.data?.blocks || record.data?.storyBlocks).forEach((block) => {
          const blockRef = typeof block === "string" ? block : block.id || block.blockId || block.type || "";
          addRelation(record, "uses_block", resolve(blockRef, "story_block"));
        });
      }
    });
    return { entities, relations };
  };

  const buildWorldDatabase = async ({ workspaceId, node, payload, event, config = {} } = {}) => {
    const now = nowIso();
    const source = unwrapStructuredPayload(payload, config);
    const collectionId = source?.collectionId || source?.metadata?.collectionId || config.collectionId || "worldbuilding";
    const schemaId = "worldbuilding/v1";
    const schemaVersion = source?.schemaVersion || config.schemaVersion || "1";
    const worldId = source?.worldId || source?.world?.id || source?.id || config.worldId || `world_${safeId(source?.world?.name || source?.name || config.worldName || collectionId)}`;
    const rawRecords = worldPayloadRecords(source, config);
    if (!rawRecords.length) throw new Error("World Database: nessun record worldbuilding da salvare");
    const normalizedRecords = rawRecords.map((item) => {
      const recordType = normalizeWorldRecordType(item);
      const label = structuredRecordLabel(item);
      return {
        ...item,
        recordType,
        type: recordType,
        worldId: item.worldId || worldId,
        parentId: item.parentId || item.kingdomId || item.packId || "",
        id: item.id || `world_${safeId(worldId)}_${safeId(recordType)}_${safeId(label || uniqueId(recordType))}`,
      };
    });
    const savedResult = await buildStructuredKnowledgeStore({
      workspaceId,
      node,
      payload: { records: normalizedRecords, collectionId, schemaId, schemaVersion, worldId },
      event,
      config: { ...config, collectionId, schemaId, schemaVersion, worldId },
    });
    const scopedRecords = await structuredRecordsForScope({ workspaceId, collectionId, schemaId, worldId });
    const validation = validateWorldRecords(scopedRecords);
    const graph = worldGraphFromRecords(scopedRecords);
    const world = {
      id: worldId,
      collectionId,
      schemaId,
      schemaVersion,
      recordCount: scopedRecords.length,
      typeCounts: savedResult.typeCounts,
      validation,
      updatedAt: now,
    };
    return {
      worldId,
      collectionId,
      schemaId,
      schemaVersion,
      world,
      records: savedResult.records,
      recordCount: savedResult.recordCount,
      totalRecordCount: savedResult.totalRecordCount,
      typeCounts: savedResult.typeCounts,
      validation,
      graph,
      context: {
        world,
        records: scopedRecords,
        graph,
      },
    };
  };

  const createDocument = async ({ workspaceId, node, payload, event, config = {} } = {}) => {
    const now = nowIso();
    const text = extractInputText(payload, config);
    if (!text.trim()) throw new Error("Knowledge document vuoto");
    const payloadSourceType = String(payload?.sourceType || "").trim();
    const eventOrigin = String(event?.meta?.origin || "").trim();
    const isUploadedDocument = payloadSourceType === "upload" || eventOrigin === "knowledge-upload";
    const isLiveReplayDocument = payloadSourceType === "live-test-replay" || event?.eventType === "flow_live_knowledge_document";
    const preferPayloadScope = isUploadedDocument || isLiveReplayDocument;
    const title = preferPayloadScope ? (payload?.title || config.title || node?.label || "Knowledge Document") : (config.title || payload?.title || node?.label || "Knowledge Document");
    const preferredLanguage = preferredRuntimeLanguage(config, payload);
    const language = detectLanguage(`${title}\n${text}`, preferredLanguage);
    const document = {
      id: preferPayloadScope
        ? (payload?.documentId || payload?.id || uniqueId("kdoc"))
        : (config.documentId || payload?.documentId || payload?.id || uniqueId("kdoc")),
      workspaceId,
      sourceId: config.sourceId || event?.sourceNodeId || node?.id || "",
      sourceType: preferPayloadScope ? (payloadSourceType || config.sourceType || "runtime-channel") : (config.sourceType || payloadSourceType || "runtime-channel"),
      title,
      mimeType: preferPayloadScope ? (payload?.mimeType || config.mimeType || "text/plain") : (config.mimeType || payload?.mimeType || "text/plain"),
      language,
      text,
      metadata: {
        ...(payload?.metadata && typeof payload.metadata === "object" ? payload.metadata : {}),
        inputChannel: event?.channel || "",
        nodeId: node?.id || "",
        enabled: payload?.metadata?.enabled !== false,
        language,
        languageDetected: !normalizeLanguage(preferredLanguage),
        collectionId: preferPayloadScope
          ? (payload?.collectionId || payload?.metadata?.collectionId || config.collectionId || "")
          : (config.collectionId || payload?.collectionId || payload?.metadata?.collectionId || ""),
      },
      status: "ready",
      createdAt: now,
      updatedAt: now,
    };
    await putRecord(STORES.documents, document);
    await putRecord(STORES.sources, {
      id: `ksource_${safeId(document.id)}`,
      workspaceId,
      sourceType: document.sourceType,
      sourceId: document.sourceId,
      documentId: document.id,
      status: "ready",
      createdAt: now,
      updatedAt: now,
    });
    return document;
  };

  const createChunks = async ({ workspaceId, node, payload, event, config = {} } = {}) => {
    const documentId = payload?.documentId || payload?.id || config.documentId || "";
    let document = payload?.document && typeof payload.document === "object" ? payload.document : null;
    if (!document && (payload?.text || payload?.content)) document = payload;
    if (!document && documentId) document = await getRecord(STORES.documents, documentId);
    if (!document) throw new Error("Documento Knowledge non trovato per chunking");
    const sourceText = extractInputText(document, {});
    if (looksLikeKnowledgeEnvelope(sourceText)) {
      throw new Error("Documento Knowledge non valido: envelope runtime ricevuto al posto del testo");
    }
    const chunkOptions = {
      chunkSize: config.chunkSize || config.maxChunkChars || 900,
      maxChunkTokens: config.maxChunkTokens || config.chunkTokens || config.tokenBudget || 0,
      overlap: config.chunkOverlap || config.overlap || 120,
      chunkOverlapTokens: config.chunkOverlapTokens || config.overlapTokens || 0,
      strategy: config.strategy || "fixed",
    };
    const chunks = splitText(sourceText, chunkOptions);
    const normalizedChunkStrategy = normalizeChunkStrategy(chunkOptions.strategy);
    const tokenBudget = chunkTokenBudget(chunkOptions);
    const overlapTokens = chunkOverlapBudget({ ...chunkOptions, tokenBudget });
    const now = nowIso();
    const records = [];
    const language = detectLanguage(sourceText, preferredRuntimeLanguage(config));
    if (config.replaceExisting !== false) {
      await Promise.all([
        deleteChunksAndEmbeddings({ workspaceId, documentId: document.id || documentId }),
        deleteDictionaryEntries({ workspaceId, documentId: document.id || documentId }),
        deleteKnowledgeEvents({ workspaceId, documentId: document.id || documentId }),
      ]);
    }
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      const record = {
        id: uniqueId("kchunk"),
        workspaceId,
        documentId: document.id || documentId,
        sourceId: document.sourceId || event?.sourceNodeId || "",
        ordinal: index,
        text: chunk.text,
        start: chunk.start,
        end: chunk.end,
        tokenCount: chunk.text.split(/\s+/).filter(Boolean).length,
        metadata: {
          title: document.title || "",
          inputChannel: event?.channel || "",
          nodeId: node?.id || "",
          language,
          collectionId: document.metadata?.collectionId || config.collectionId || "",
          chunking: {
            strategy: normalizedChunkStrategy,
            tokenBudget,
            overlapTokens,
            page: chunk.page || 1,
            endPage: chunk.endPage || chunk.page || 1,
            sectionPath: Array.isArray(chunk.sectionPath) ? chunk.sectionPath : [],
            tokenEstimate: chunk.tokenEstimate || chunk.text.split(/\s+/).filter(Boolean).length,
          },
        },
        createdAt: now,
      };
      records.push(await putRecord(STORES.chunks, record));
    }
    return { documentId: document.id || documentId, chunks: records };
  };

  const createEmbeddings = async ({ workspaceId, node, payload, event, config = {} } = {}) => {
    const chunks = Array.isArray(payload?.chunks)
      ? payload.chunks
      : payload?.chunkId
        ? [await getRecord(STORES.chunks, payload.chunkId)]
        : payload?.documentId
          ? byWorkspace(await listStore(STORES.chunks), workspaceId).filter((chunk) => chunk.documentId === payload.documentId)
          : [];
    const now = nowIso();
    const records = [];
    const embeddingUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };
    for (const chunk of chunks.filter(Boolean)) {
      const embedding = await resolveEmbeddingVector({ text: chunk.text || "", config });
      if (embedding.generatedBy === "ai-provider") {
        const promptTokens = estimateKnowledgeAiTokens(chunk.text || "");
        embeddingUsage.promptTokens += promptTokens;
        embeddingUsage.totalTokens += promptTokens;
      }
      const record = {
        id: `kembed_${safeId(chunk.id)}_${safeId(embedding.model)}`,
        workspaceId,
        documentId: chunk.documentId || "",
        chunkId: chunk.id,
        provider: embedding.provider,
        model: embedding.model,
        dimensions: embedding.vector.length,
        vector: embedding.vector,
        metadata: {
          generatedBy: embedding.generatedBy,
          inputChannel: event?.channel || "",
          nodeId: node?.id || "",
          sourceChunkNodeId: chunk.metadata?.nodeId || "",
          collectionId: chunk.metadata?.collectionId || config.collectionId || "",
          providerType: embedding.providerType || "",
          fallbackReason: embedding.fallbackReason || "",
          requestedProvider: embedding.requestedProvider || "",
          requestedModel: embedding.requestedModel || "",
        },
        createdAt: now,
      };
      records.push(await putRecord(STORES.embeddings, record));
    }
    if (embeddingUsage.totalTokens) {
      await persistKnowledgeNodeTokenUsage({
        node,
        usage: embeddingUsage,
        provider: records[0]?.provider || config.providerProfile || config.provider || "",
        model: records[0]?.model || config.model || "",
      });
    }
    return {
      embeddings: records,
      provider: records[0]?.provider || "local-hash",
      model: records[0]?.model || "tl-local-hash-v1",
    };
  };

  const dictionaryEvidenceFor = (text = "", term = "") => {
    const cleanText = String(text || "");
    const cleanTerm = String(term || "").trim();
    if (!cleanText || !cleanTerm) return { text: "", quote: "", startOffset: null, endOffset: null };
    const positions = entityLabelPositions(cleanText, cleanTerm);
    const position = positions[0] ?? cleanText.toLowerCase().indexOf(cleanTerm.toLowerCase());
    if (position < 0) return { text: cleanText, quote: cleanTerm, startOffset: null, endOffset: null };
    const start = Math.max(0, cleanText.lastIndexOf(".", position - 1) + 1, position - 140);
    const nextPeriod = cleanText.indexOf(".", position + cleanTerm.length);
    const end = Math.min(cleanText.length, nextPeriod >= 0 ? nextPeriod + 1 : position + cleanTerm.length + 140);
    return {
      text: cleanText.slice(start, end).trim(),
      quote: cleanText.slice(position, position + cleanTerm.length),
      startOffset: position,
      endOffset: position + cleanTerm.length,
    };
  };

  const orderedKnowledgeChunks = (chunks = []) =>
    [...chunks]
      .filter(Boolean)
      .sort((left, right) =>
        Number(left.ordinal ?? left.index ?? 0) - Number(right.ordinal ?? right.index ?? 0) ||
        Number(left.start ?? 0) - Number(right.start ?? 0) ||
        String(left.id || "").localeCompare(String(right.id || "")));

  const dictionaryEvidencePackFor = ({ term = "", aliases = [], chunks = [], maxItems = 8, snippetRadius = 180 } = {}) => {
    const labels = unique([term, ...(Array.isArray(aliases) ? aliases : [])]
      .map((label) => String(label || "").trim())
      .filter((label) => label.length >= 2)
      .map((label) => ({ label, key: normalizeEntityToken(label) }))
      .filter((item, index, list) => item.key && list.findIndex((candidate) => candidate.key === item.key) === index)
      .map((item) => item.label))
      .sort((left, right) => right.length - left.length);
    if (!labels.length) return [];
    const evidence = [];
    const seenEvidence = new Set();
    for (const chunk of orderedKnowledgeChunks(chunks)) {
      const text = String(chunk?.text || "");
      if (!text) continue;
      const matches = [];
      for (const label of labels) {
        for (const position of entityLabelPositions(text, label)) {
          matches.push({ label, position });
        }
      }
      matches
        .sort((left, right) => left.position - right.position || right.label.length - left.label.length)
        .forEach((match) => {
          if (evidence.length >= maxItems) return;
          const absoluteStart = Number(chunk.start ?? 0) + match.position;
          const absoluteEnd = absoluteStart + match.label.length;
          const evidenceKey = `${chunk.id || ""}:${absoluteStart}:${absoluteEnd}:${normalizeEntityToken(match.label)}`;
          if (seenEvidence.has(evidenceKey)) return;
          seenEvidence.add(evidenceKey);
          const start = Math.max(0, text.lastIndexOf(".", match.position - 1) + 1, match.position - snippetRadius);
          const nextPeriod = text.indexOf(".", match.position + match.label.length);
          const end = Math.min(text.length, nextPeriod >= 0 ? nextPeriod + 1 : match.position + match.label.length + snippetRadius);
          evidence.push({
            chunkId: chunk.id || "",
            ordinal: chunk.ordinal ?? chunk.index ?? null,
            start: absoluteStart,
            end: absoluteEnd,
            quote: text.slice(match.position, match.position + match.label.length),
            text: text.slice(start, end).trim(),
          });
        });
      if (evidence.length >= maxItems) break;
    }
    return evidence;
  };

  const dictionaryLemma = (term = "", language = "") => {
    const normalized = normalizeEntityToken(term)
      .replace(/^(?:l|il|lo|la|i|gli|le|un|uno|una|the|a|an)\s+/, "")
      .trim();
    if (!normalized) return "";
    const words = normalized.split(/\s+/).filter(Boolean);
    return words.map((word) => {
      if (["it", "es", "fr"].includes(language) && word.length > 5) return word.replace(/(?:mente|zione|zioni|idad|idades|ement|ations)$/i, "");
      if (language === "en" && word.length > 5) return word.replace(/(?:ing|ed|es|s)$/i, "");
      return word;
    }).join(" ");
  };

  const dictionaryLocationTokens = new Set([
    "albero", "alberi", "bosco", "casa", "castello", "caverna", "foresta", "giardino", "luogo", "montagna", "regno", "sentiero", "strada", "villaggio",
    "cave", "castle", "forest", "garden", "kingdom", "mountain", "path", "road", "tree", "trees", "village", "wood", "woods",
    "arbol", "arboles", "árbol", "árboles", "bosque", "castillo", "cueva", "montana", "montaña", "pueblo", "reino",
    "arbre", "arbres", "bois", "chateau", "château", "foret", "forêt", "montagne", "royaume", "village",
  ]);

  const dictionaryObjectTokens = new Set([
    "fuoco", "libro", "pietra", "pietre", "roccia", "rocce", "spada",
    "book", "fire", "rock", "rocks", "stone", "stones", "sword",
    "fuego", "libro", "piedra", "piedras", "roca", "rocas",
    "feu", "livre", "pierre", "pierres", "roche", "roches",
  ]);

  const dictionaryCreatureTokens = new Set([
    "creatura", "mostro",
    "creature", "monster",
    "criatura", "monstruo",
    "creature", "monstre",
    "kreatur", "monster",
  ]);

  const dictionaryConceptTokens = new Set([
    "amicizia", "compassione", "coraggio", "cura", "desiderio", "immaginazione", "intelligenza", "nemico", "parola", "paura", "pericolo", "pericoli", "scoraggiamento", "silenzio", "voce",
    "courage", "cure", "danger", "discouragement", "enemy", "fear", "friendship", "imagination", "silence", "threat", "voice",
    "amistad", "cura", "imaginacion", "imaginación", "miedo", "peligro", "silencio", "voz",
    "amitie", "amitié", "courage", "danger", "guerison", "guérison", "peur", "silence", "voix",
  ]);

  const dictionaryRoleTokens = new Set([
    "anziana", "anziano", "bambina", "bambino", "giovane", "mago", "ragazza", "ragazzo", "uomo", "vecchia", "vecchio",
    "child", "elder", "girl", "man", "old man", "old woman", "wizard", "woman",
  ]);

  const dictionaryCustomTypeTokens = (config = {}, type = "") => {
    const rules = customKnowledgeRules(config);
    const groups = rules.dictionaryTypes || rules.typeTerms || rules.termsByType || {};
    return new Set(customRuleValues(groups[type] || rules[`${type}Terms`]).map(dictionaryLemma).filter(Boolean));
  };

  const dictionaryTypeCandidates = (term = "", text = "", config = {}) => {
    const normalized = dictionaryLemma(term, detectLanguage(text));
    const head = normalized.split(/\s+/).filter(Boolean)[0] || normalized;
    const customLocations = dictionaryCustomTypeTokens(config, "location");
    const customObjects = dictionaryCustomTypeTokens(config, "object");
    const customCreatures = dictionaryCustomTypeTokens(config, "creature");
    const customConcepts = dictionaryCustomTypeTokens(config, "concept");
    const customRoles = dictionaryCustomTypeTokens(config, "role");
    const lexicalType = dictionaryLocationTokens.has(head) || customLocations.has(normalized) || customLocations.has(head)
      ? "location"
      : dictionaryObjectTokens.has(head) || customObjects.has(normalized) || customObjects.has(head)
        ? "object"
        : dictionaryCreatureTokens.has(normalized) || dictionaryCreatureTokens.has(head) || customCreatures.has(normalized) || customCreatures.has(head)
          ? "creature"
          : dictionaryConceptTokens.has(normalized) || dictionaryConceptTokens.has(head) || customConcepts.has(normalized) || customConcepts.has(head)
            ? "concept"
            : dictionaryRoleTokens.has(normalized) || dictionaryRoleTokens.has(head) || customRoles.has(normalized) || customRoles.has(head)
              ? "role"
              : "";
    const inferred = lexicalType || inferContextualEntityType(term, inferEntityType(term), text);
    const candidates = [{ type: inferred || "term", confidence: inferred === "proper-noun" ? 0.78 : 0.62, source: "local-context" }];
    if (sourceEntityCuePattern.test(normalizeEntityToken(text)) && normalized.length > 2) {
      candidates.push({ type: "source", confidence: 0.58, source: "source-cue" });
    }
    return candidates
      .filter((candidate, index, list) => list.findIndex((item) => item.type === candidate.type) === index)
      .slice(0, 4);
  };

  const dictionaryFunctionTokens = new Set([
    "altra", "altre", "altri", "altro", "l altra", "l altro", "l altra cosa", "quest altra", "quest altro",
    "all improvviso", "certo", "corsero", "davanti", "eppure", "finalmente", "fosse", "nonostante", "piu", "più", "sembrava", "tuttavia",
    "accesero", "anni", "arrivarono", "avrebbe", "buongiorno", "camminarono", "chiese", "ciao", "davvero", "decisero", "desideri",
    "disse", "due", "enorme", "era", "fare", "final", "fuggire", "giorno", "grande", "guardo", "lungo", "nome", "parlava",
    "pensava", "pieno", "rispose", "segui", "sempre", "solo", "stavo", "trovarono",
    "although", "before", "certainly", "finally", "however", "meanwhile", "suddenly", "therefore",
    "aunque", "cierto", "entonces", "finalmente", "mientras", "sin embargo",
    "alors", "cependant", "enfin", "lorsque", "pourtant", "soudain",
  ]);

  const dictionaryAnaphoricTokens = new Set([
    "altra", "altre", "altri", "altro", "l altra", "l altro", "the other", "another", "other",
    "questa", "queste", "questi", "questo", "quella", "quelle", "quelli", "quello",
    "esta", "este", "esa", "ese", "celle", "celui", "autre",
  ]);

  const dictionaryCommonModifierTokens = new Set([
    "azzurra", "azzurre", "azzurri", "azzurro", "blu", "blue", "negra", "negre", "negri", "nero", "nera", "nere", "neri",
    "black", "dry", "old", "red", "white", "secchi", "secca", "secco", "secche", "vecchia", "vecchie", "vecchi", "vecchio",
  ]);

  const dictionaryMultiwordHead = (normalized = "") =>
    String(normalized || "").split(/\s+/).filter(Boolean)[0] || "";

  const dictionaryWeakLexicalEntry = (term = "", lemma = "") => {
    const normalized = lemma || dictionaryLemma(term);
    if (!normalized) return true;
    const words = normalized.split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    if (/(?:^|\s)(?:d|l|dell|della|dello|delle|degli|dei|del|di|de|du|des|of|the)$/.test(normalized)) return true;
    if (dictionaryAnaphoricTokens.has(normalized)) return true;
    if (words.every((word) => dictionaryAnaphoricTokens.has(word) || dictionaryCommonModifierTokens.has(word))) return true;
    return false;
  };

  const dictionarySentenceStartWeak = (text = "", index = 0, term = "", language = "") => {
    const normalized = normalizeEntityToken(term);
    if (!normalized) return true;
    const profile = languageProfiles[language] || {};
    const weak = new Set([
      ...(profile.stopWords || []).map(normalizeEntityToken),
      ...(profile.weakStarts || []).map(normalizeEntityToken),
      ...dictionaryFunctionTokens,
      ...weakSentenceStartEntityTokens,
    ]);
    if (weak.has(normalized)) return true;
    const before = String(text || "").slice(Math.max(0, index - 3), index);
    const startsSentence = index <= 0 || /(^|[.!?;:\n]\s*)$/.test(before);
    if (!startsSentence) return false;
    if (/^(?:[A-ZÀ-Ý][a-zà-ÿ'’-]+)$/.test(String(term || "")) && !knownAcronymEntityTokens.has(normalized)) {
      const lower = String(term || "").toLocaleLowerCase();
      return lower !== String(term || "") && !/\b(?:di nome|chiamat[oa]|nome è|named|called)\s+$/i.test(String(text || "").slice(Math.max(0, index - 40), index));
    }
    return false;
  };

  const extractDictionaryCandidates = (chunks = [], { language = "", maxTerms = 120, minFrequency = 1, config = {} } = {}) => {
    const profile = languageProfiles[language] || {};
    const rules = customKnowledgeRules(config);
    const stopWords = new Set([
      ...entityStopWords,
      ...(profile.stopWords || []).map(normalizeEntityToken),
      ...(profile.weakStarts || []).map(normalizeEntityToken),
      ...dictionaryFunctionTokens,
      ...customRuleValues(rules.stopWords, rules.blockTerms, rules.dictionaryStopWords).map(normalizeEntityToken),
    ]);
    const candidates = new Map();
    const addCandidate = ({ term = "", chunk = {}, source = "token", weight = 1, index = -1 } = {}) => {
      const cleanTerm = String(term || "").replace(/\s+/g, " ").trim();
      const normalized = dictionaryLemma(cleanTerm, language);
      if (!normalized || normalized.length < 3 || normalized.length > 80) return;
      const words = normalized.split(/\s+/).filter(Boolean);
      if (stopWords.has(normalized) || weakSentenceStartEntityTokens.has(normalized) || dictionaryWeakLexicalEntry(cleanTerm, normalized)) return;
      if (words.some((word) => stopWords.has(word) || dictionaryFunctionTokens.has(word) || weakSentenceStartEntityTokens.has(word))) return;
      if (source === "proper-noun" && dictionarySentenceStartWeak(chunk?.text || "", index, cleanTerm, language)) return;
      if (isWeakEntityLabel(cleanTerm, source)) return;
      const key = normalized;
      const current = candidates.get(key) || {
        term: cleanTerm,
        normalized,
        count: 0,
        source,
        chunkIds: new Set(),
        evidenceChunk: chunk,
      };
      current.count += weight;
      current.chunkIds.add(chunk.id || "");
      if (source === "proper-noun" && current.source !== "proper-noun") current.source = source;
      if (!current.evidenceChunk?.text && chunk?.text) current.evidenceChunk = chunk;
      candidates.set(key, current);
    };
    chunks.forEach((chunk) => {
      const text = String(chunk?.text || "");
      for (const match of text.matchAll(/\b[A-ZÀ-Ý][A-Za-zÀ-ÿ'’-]{2,}(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'’-]{2,}){0,3}\b/g)) {
        addCandidate({ term: match[0], chunk, source: "proper-noun", weight: 3, index: match.index || 0 });
      }
      for (const match of text.matchAll(/[\p{L}][\p{L}'’-]{2,}/gu)) {
        addCandidate({ term: match[0], chunk, source: "term", weight: 1, index: match.index || 0 });
      }
    });
    return [...candidates.values()]
      .filter((candidate) => candidate.count >= minFrequency || candidate.source === "proper-noun")
      .sort((left, right) => (right.count - left.count) || left.term.localeCompare(right.term))
      .slice(0, maxTerms);
  };

  const extractSourceDictionaryAnchors = (chunks = [], { language = "", maxTerms = 120, config = {} } = {}) => {
    const rules = customKnowledgeRules(config);
    const groups = rules.dictionaryTypes || rules.typeTerms || rules.termsByType || {};
    const candidates = new Map();
    const tokens = unique([
      ...(customRulesReplace(rules, "dictionaryTypes") || customRulesReplace(rules, "typeTerms") || customRulesReplace(rules, "termsByType") ? [] : [
        ...dictionaryCreatureTokens,
        ...dictionaryConceptTokens,
        ...dictionaryLocationTokens,
        ...dictionaryObjectTokens,
        ...dictionaryRoleTokens,
      ]),
      ...customRuleValues(groups.creature, groups.concept, groups.location, groups.object, groups.role, rules.creatureTerms, rules.conceptTerms, rules.locationTerms, rules.objectTerms, rules.roleTerms),
    ]).sort((left, right) => right.length - left.length);
    const addAnchor = ({ term = "", chunk = {}, count = 2 } = {}) => {
      const cleanTerm = String(term || "").replace(/\s+/g, " ").trim();
      const normalized = dictionaryLemma(cleanTerm, language);
      if (!normalized || normalized.length < 3 || normalized.length > 80) return;
      if (dictionaryWeakLexicalEntry(cleanTerm, normalized)) return;
      const key = normalized;
      const current = candidates.get(key) || {
        term: cleanTerm,
        normalized,
        count: 0,
        source: "source-anchor-dictionary",
        chunkIds: new Set(),
        evidenceChunk: chunk,
      };
      current.count += count;
      current.chunkIds.add(chunk.id || "");
      if (!current.evidenceChunk?.text && chunk?.text) current.evidenceChunk = chunk;
      candidates.set(key, current);
    };
    chunks.forEach((chunk) => {
      const text = String(chunk?.text || "");
      tokens.forEach((token) => {
        const positions = entityLabelPositions(text, token);
        positions.forEach((position) => {
          const quote = text.slice(position, position + String(token).length);
          addAnchor({ term: quote || token, chunk, count: 2 });
        });
      });
    });
    return [...candidates.values()]
      .sort((left, right) => (right.count - left.count) || String(left.term || "").localeCompare(String(right.term || "")))
      .slice(0, maxTerms);
  };

  const dictionaryBuildMode = (config = {}) => {
    const mode = String(config.dictionaryMode || config.extractionMode || config.enrichmentMode || "llm").toLowerCase().trim();
    if (mode === "ai") return "llm";
    return ["rules", "llm", "hybrid"].includes(mode) ? mode : "rules";
  };

  const dictionaryQuoteSupported = (quote = "", chunks = []) => {
    const cleanQuote = String(quote || "").replace(/\s+/g, " ").trim();
    if (!cleanQuote) return null;
    return chunks.find((chunk) => String(chunk?.text || "").replace(/\s+/g, " ").includes(cleanQuote)) || null;
  };

  const normalizeAiDictionaryType = (value = "") => {
    const type = String(value || "").toLowerCase().trim().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    const allowed = new Set(["proper-noun", "role", "location", "object", "concept", "creature", "source", "symbol", "technology", "term"]);
    return allowed.has(type) ? type : "term";
  };

  const normalizeAiDictionaryCandidate = (item = {}, chunks = [], language = "") => {
    const term = String(item.term || item.label || item.name || "").replace(/\s+/g, " ").trim();
    if (!term || term.length < 2 || term.length > 80) return null;
    const quote = String(item.evidence?.quote || item.quote || item.evidenceQuote || "").replace(/\s+/g, " ").trim();
    const quoteChunk = dictionaryQuoteSupported(quote, chunks);
    const termChunk = quoteChunk || chunks.find((chunk) =>
      entityLabelPositions(String(chunk?.text || ""), term).length
    );
    if (!termChunk) return null;
    const lemma = dictionaryLemma(term, language);
    const exactPositions = entityLabelPositions(String(termChunk.text || ""), term);
    const firstExactPosition = exactPositions[0] ?? -1;
    const knownTypedLemma = dictionaryCreatureTokens.has(lemma) ||
      dictionaryConceptTokens.has(lemma) ||
      dictionaryLocationTokens.has(lemma) ||
      dictionaryObjectTokens.has(lemma) ||
      dictionaryRoleTokens.has(lemma);
    if (
      firstExactPosition >= 0 &&
      firstExactPosition <= 2 &&
      Number(termChunk.start || 0) > 0 &&
      /^[a-zà-ÿ]/.test(term) &&
      !knownTypedLemma
    ) {
      return null;
    }
    const profile = languageProfiles[language] || {};
    const stopWords = new Set([
      ...entityStopWords,
      ...(profile.stopWords || []).map(normalizeEntityToken),
      ...(profile.weakStarts || []).map(normalizeEntityToken),
      ...dictionaryFunctionTokens,
      ...weakSentenceStartEntityTokens,
    ]);
    const lemmaWords = lemma.split(/\s+/).filter(Boolean);
    const contentWords = lemmaWords.filter((word) =>
      !stopWords.has(word) &&
      !dictionaryFunctionTokens.has(word) &&
      !weakSentenceStartEntityTokens.has(word)
    );
    if (!lemma ||
      dictionaryWeakLexicalEntry(term, lemma) ||
      stopWords.has(lemma) ||
      !contentWords.length ||
      contentWords.length !== lemmaWords.length && contentWords.length < 2) {
      return null;
    }
    let type = normalizeAiDictionaryType(item.type || item.entityType || item.kind || item.typeCandidates?.[0]?.type || "");
    const properLike = type === "proper-noun" || type === "source" || type === "symbol";
    const hasProperCasing = /[A-ZÀ-Ý]/.test(term) || knownAcronymEntityTokens.has(lemma);
    if (properLike && !hasProperCasing) type = "term";
    const confidence = Math.max(0.4, Math.min(0.98, Number(item.confidence || 0.72)));
    const aliases = unique([term, ...(Array.isArray(item.aliases) ? item.aliases : [])]
      .map((alias) => String(alias || "").replace(/\s+/g, " ").trim())
      .filter((alias) => alias.length >= 2 && alias.length <= 80));
    return {
      term,
      normalized: lemma,
      count: Math.max(2, Number(item.occurrenceCount || 2)),
      source: "ai-dictionary",
      chunkIds: new Set([termChunk.id || ""].filter(Boolean)),
      evidenceChunk: termChunk,
      ai: {
        aliases,
        typeCandidates: [{ type, confidence, source: "llm-dictionary" }],
        semanticHints: Array.isArray(item.semanticHints) ? item.semanticHints.map((hint) => String(hint || "").trim()).filter(Boolean) : [],
        relationCues: Array.isArray(item.relationCues) ? item.relationCues.map((cue) => String(cue || "").trim()).filter(Boolean) : [],
        confidence,
        evidence: quoteChunk && quote ? {
          text: quote,
          quote,
          startOffset: String(termChunk.text || "").indexOf(quote),
          endOffset: String(termChunk.text || "").indexOf(quote) >= 0 ? String(termChunk.text || "").indexOf(quote) + quote.length : null,
        } : null,
        explanation: String(item.explanation || ""),
      },
    };
  };

  const callKnowledgeDictionaryAi = async ({ chunks = [], language = "", config = {} } = {}) => {
    const mode = dictionaryBuildMode(config);
    if (!["llm", "hybrid"].includes(mode)) return { candidates: [], provider: "", model: "", usage: {}, error: "", promptMode: "" };
    const hasExplicitProvider = Boolean(config.providerProfile || config.profileId || config.providerType || config.provider || config.model);
    const providerConfig = hasExplicitProvider ? config : { ...config, providerType: "lm-studio" };
    const provider = await pickAiProvider({ ...providerConfig, enrichmentMode: "ai" });
    if (!provider) return { candidates: [], provider: "", model: "", usage: {}, error: "provider-not-found", promptMode: "" };
    const providerType = String(provider.provider || provider.providerType || providerConfig.providerType || providerConfig.provider || "").toLowerCase();
    const requestedModel = String(providerConfig.model || provider.model || (providerType === "ollama" ? "llama3.1" : "local-model")).trim();
    const model = providerType === "ollama"
      ? requestedModel
      : await resolveOpenAiCompatibleModel({ provider, model: requestedModel });
    const maxTerms = Number.isFinite(Number(config.maxTerms)) && Number(config.maxTerms) > 0
      ? Math.floor(Number(config.maxTerms))
      : Number.POSITIVE_INFINITY;
    const promptBudget = knowledgePromptBudget({ config, providerType, provider, chunksLength: chunks.length, defaultChunkLimit: chunks.length || 8, defaultChunkChars: 1600 });
    const configuredChunkLimit = promptBudget.chunkLimit;
    const configuredMaxChunkTokens = promptBudget.maxChunkTokens;
    const localProvider = isLmStudioProvider(providerType, provider) || providerType === "ollama";
    const chunkPassLimit = Math.max(
      configuredChunkLimit,
      Math.min(
        chunks.length,
        Math.max(1, Number(
          config.maxChunkPasses ||
          config.llmChunkPasses ||
          config.chunkPassLimit ||
          config.maxLlmChunks ||
          chunks.length
        ))
      )
    );
    const systemPrompt = knowledgeAiTextConfig(
      config.systemPrompt,
      "You are a Knowledge Dictionary Builder. Build a reusable lexical memory from local chunks only, preserving source-language terms and evidence."
    );
    const promptTemplate = knowledgeAiTextConfig(
      config.promptTemplate,
      "Use the supplied chunks to propose stable names, roles, places, objects, concepts, creatures, sources, aliases, semantic hints and relation cues that improve later graph extraction without inventing labels."
    );
    const outputInstructions = knowledgeAiTextConfig(
      config.outputInstructions,
      "Return strict JSON with entries. Every entry must include term, type, aliases, confidence, explanation and an exact evidence.quote copied from a supplied chunk. Reject weak fragments and unsupported aliases."
    );
    try {
      const endpoint = String(provider.endpoint || (providerType === "ollama" ? "http://127.0.0.1:11434" : "http://127.0.0.1:1234")).replace(/\/+$/g, "");
      const url = providerType === "ollama"
        ? `${endpoint}/api/generate`
        : `${endpoint.endsWith("/v1") ? endpoint : `${endpoint}/v1`}/chat/completions`;
      const promptFor = ({ promptMode = "full", sourceChunks = chunks } = {}) => {
        const compact = promptMode === "compact";
        const micro = promptMode === "micro";
        const chunkPass = promptMode === "chunk";
        const chunkLimit = chunkPass ? 1 : configuredChunkLimit;
        const maxChunkTokens = configuredMaxChunkTokens;
        const maxEntries = Number.isFinite(maxTerms) ? maxTerms : undefined;
        return [
          systemPrompt,
          promptTemplate,
          outputInstructions,
          "Return ONLY one valid JSON object.",
          "The first character must be { and the last character must be }.",
          "Do not wrap JSON in markdown. Do not add prose before or after JSON.",
          "Do not invent entries. Do not include terms unsupported by an exact evidence quote.",
          "Every evidence.quote must be copied exactly from one supplied chunk.",
          "Prefer source-language labels. Keep aliases short and evidence-backed.",
          "If there are no valid entries, return {\"entries\":[]}.",
          chunkPass ? "For this chunk pass, extract only from the single supplied chunk." : "",
          JSON.stringify({
            schema: {
              entries: [{
                term: "source-language term",
                type: "proper-noun|role|location|object|concept|creature|source|symbol|technology|term",
                aliases: ["alias found or directly implied by evidence"],
                semanticHints: ["short hint"],
                relationCues: ["short relation cue"],
                confidence: 0.0,
                evidence: { chunkId: "chunk id", quote: "exact quote from chunk" },
                explanation: "why this term is reusable",
              }],
            },
            language,
            ...(Number.isFinite(maxEntries) ? { maxEntries } : {}),
            chunks: sourceChunks.slice(0, chunkLimit).map((chunk, index) => ({
              id: chunk.id || `chunk_${index + 1}`,
              ordinal: chunk.ordinal ?? chunk.index ?? index,
              text: trimTextToEstimatedTokens(chunk.text || "", maxChunkTokens),
            })),
          }),
        ].join("\n\n");
      };
      let lastError = "";
      let lastModel = model;
      let totalUsage = {};
      const attemptedChunkIds = new Set();
      const productiveChunkIds = new Set();
      const chunkIdsFromCandidates = (candidates = []) =>
        candidates
          .flatMap((candidate) => [...(candidate.chunkIds || [])])
          .filter(Boolean);
      const resultStatsFor = (candidates = []) => {
        const coveredIds = unique(chunkIdsFromCandidates(candidates));
        return {
          inputChunkCount: chunks.length,
          attemptedChunkCount: attemptedChunkIds.size,
          productiveChunkCount: productiveChunkIds.size || coveredIds.length,
          coveredChunkCount: coveredIds.length,
          coveredChunkIds: coveredIds,
        };
      };
      const validatedDictionaryPatch = (patch = {}, sourceChunks = chunks) =>
        (Array.isArray(patch.entries) ? patch.entries : [])
          .map((item) => normalizeAiDictionaryCandidate(item, sourceChunks, language))
          .filter(Boolean)
          .slice(0, maxTerms);
      const salvageDictionaryCandidatesFromText = ({ text = "", sourceChunks = chunks } = {}) => {
        const rawText = String(text || "");
        if (!rawText.trim()) return [];
        const termMap = new Map();
        const addTerm = (term = "", type = "") => {
          const cleanTerm = String(term || "")
            .replace(/^[\s"'“”‘’`*_:-]+|[\s"'“”‘’`*_.,;:-]+$/g, "")
            .replace(/\s+/g, " ")
            .trim();
          const normalized = dictionaryLemma(cleanTerm, language);
          if (!normalized || normalized.length < 3 || normalized.length > 80) return;
          const words = normalized.split(/\s+/).filter(Boolean);
          if (words.some((word) => word.length < 2)) return;
          if (/[\s](?:d|l|un|una|il|la|lo|the)$/i.test(normalized)) return;
          if (termMap.has(normalized)) return;
          termMap.set(normalized, { term: cleanTerm, type });
        };
        for (const match of rawText.matchAll(/["']?term["']?\s*[:=]\s*["'“”]?([^"',}\]\n\r]{2,80})/gi)) {
          addTerm(match[1]);
        }
        for (const match of rawText.matchAll(/(?:^|\n)\s*(?:[-*]|\d+[.)])\s*(?:\*\*)?([A-ZÀ-Ýa-zà-ÿ][A-Za-zÀ-ÿ'’ -]{2,80})(?:\*\*)?\s*(?:[:\-–]|$)/g)) {
          addTerm(match[1]);
        }
        for (const token of [...dictionaryCreatureTokens, ...dictionaryConceptTokens, ...dictionaryRoleTokens, ...dictionaryLocationTokens, ...dictionaryObjectTokens]) {
          const escaped = String(token).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          if (new RegExp(`\\b${escaped}\\b`, "i").test(rawText)) addTerm(token);
        }
        const sourceText = sourceChunks.map((chunk) => chunk?.text || "").join("\n");
        return [...termMap.values()]
          .map((item) => normalizeAiDictionaryCandidate({
            term: item.term,
            type: item.type || dictionaryTypeCandidates(item.term, sourceText)?.[0]?.type || "term",
            aliases: [item.term],
            confidence: 0.66,
            explanation: "Recovered from non-JSON LLM dictionary output and validated against source chunks.",
          }, sourceChunks, language))
          .filter(Boolean)
          .filter((candidate) => [...(candidate.chunkIds || [])].some((chunkId) => {
            const chunk = sourceChunks.find((item) => item?.id === chunkId);
            return entityLabelPositions(chunk?.text || "", candidate.term).length > 0;
          }))
          .slice(0, maxTerms);
      };
      const repairDictionaryJson = async ({ text = "", promptMode = "", sourceChunks = chunks } = {}) => {
        const rawText = String(text || "").trim();
        if (!rawText) return null;
        const repairPrompt = [
          "Convert the following model output into one strict JSON object for Knowledge Dictionary extraction.",
          "Return ONLY JSON. No markdown, no prose.",
          "Schema: {\"entries\":[{\"term\":\"\",\"type\":\"proper-noun|role|location|object|concept|creature|source|symbol|technology|term\",\"aliases\":[],\"semanticHints\":[],\"relationCues\":[],\"confidence\":0.0,\"evidence\":{\"chunkId\":\"\",\"quote\":\"\"},\"explanation\":\"\"}]}",
          "Keep only entries, labels and quotes already present in the model output. Do not invent new entries, aliases or evidence.",
          "Input:",
          rawText,
        ].join("\n\n");
        const repairMaxTokens = knowledgeCompletionLimit({ config, providerType, provider, requested: 700, min: 1 });
        const repairBody = providerType === "ollama"
          ? { model, prompt: repairPrompt, stream: false, format: "json", options: { temperature: 0.01, top_p: 0.9, num_predict: repairMaxTokens } }
          : withJsonObjectResponseFormat({ model, messages: [{ role: "user", content: repairPrompt }], temperature: 0.01, max_tokens: repairMaxTokens, top_p: 0.9 }, providerType, config);
        let repairResponse = await postChatJson({ url, body: repairBody, headers: headersForProvider(provider, config) });
        let repairErrorText = repairResponse.ok ? "" : await chatErrorText(repairResponse);
        if (!repairResponse.ok && providerType !== "ollama" && /json|format/i.test(repairErrorText)) {
          const fallbackBody = { ...repairBody };
          delete fallbackBody.response_format;
          repairResponse = await postChatJson({ url, body: fallbackBody, headers: headersForProvider(provider, config) });
          repairErrorText = repairResponse.ok ? "" : await chatErrorText(repairResponse);
        }
        if (!repairResponse.ok) {
          lastError = `repair-http-${repairResponse.status}${repairErrorText ? `: ${repairErrorText}` : ""}`;
          return null;
        }
        const repairData = await repairResponse.json();
        const repairText = repairData.response || repairData.choices?.[0]?.message?.content || repairData.output_text || "";
        totalUsage = addKnowledgeAiUsage(totalUsage, knowledgeAiUsageFromResponse({ data: repairData, prompt: repairPrompt, text: repairText }));
        lastModel = repairData.model || lastModel;
        const repairPatch = parseAiJsonObject(repairText);
        if (!repairPatch) return null;
        const candidates = validatedDictionaryPatch(repairPatch, sourceChunks);
        return candidates.length ? { candidates, promptMode: `${promptMode}-repair` } : null;
      };
      const runDictionaryPromptAttempt = async ({ promptMode = "full", sourceChunks = chunks } = {}) => {
        const chunkPass = promptMode === "chunk";
        const sentChunkLimit = chunkPass ? 1 : configuredChunkLimit;
        sourceChunks.slice(0, sentChunkLimit).forEach((chunk) => attemptedChunkIds.add(chunk.id || ""));
        const prompt = promptFor({ promptMode, sourceChunks });
        const completionMaxTokens = knowledgeCompletionLimit({ config, providerType, provider, requested: 1100, min: 1 });
        const body = providerType === "ollama"
          ? {
            model,
            prompt,
            stream: false,
            format: "json",
            options: {
              temperature: knowledgeAiNumberConfig(config.temperature, 0.05),
              top_p: knowledgeAiNumberConfig(config.topP, 0.9),
              num_predict: completionMaxTokens,
            },
          }
          : withJsonObjectResponseFormat({
            model,
            messages: [{ role: "user", content: prompt }],
            temperature: knowledgeAiNumberConfig(config.temperature, 0.05),
            max_tokens: completionMaxTokens,
            top_p: knowledgeAiNumberConfig(config.topP, 0.9),
          }, providerType, config);
        knowledgeLlmDebug("dictionary:request", {
          mode,
          promptMode,
          provider: provider.id || providerType || "",
          providerType,
          model,
          sourceChunkCount: sourceChunks.length,
          sentChunkCount: sentChunkLimit,
          sourceChunkIds: sourceChunks.slice(0, sentChunkLimit).map((chunk) => chunk.id || ""),
          promptChars: prompt.length,
          maxTokens: body.max_tokens || body.options?.num_predict || 0,
          promptPreview: compactDebugText(prompt),
        });
        let response = await postChatJson({ url, body, headers: headersForProvider(provider, config) });
        let errorText = response.ok ? "" : await chatErrorText(response);
        if (!response.ok && providerType !== "ollama" && /json|format/i.test(errorText)) {
          const fallbackBody = { ...body };
          delete fallbackBody.response_format;
          response = await postChatJson({ url, body: fallbackBody, headers: headersForProvider(provider, config) });
          errorText = response.ok ? "" : await chatErrorText(response);
        }
        if (!response.ok) {
          lastError = `HTTP ${response.status}${errorText ? `: ${errorText}` : ""}`;
          const canShrink = response.status === 400 || /context|token|too large|size|json|format/i.test(errorText);
          return { candidates: [], error: lastError, retryable: canShrink, promptMode };
        }
        const data = await response.json();
        const text = data.response || data.choices?.[0]?.message?.content || data.output_text || "";
        const usage = knowledgeAiUsageFromResponse({ data, prompt, text });
        totalUsage = addKnowledgeAiUsage(totalUsage, usage);
        lastModel = data.model || model;
        const patch = parseAiJsonObject(text);
        if (!patch) {
          lastError = "invalid-ai-json";
          const salvaged = salvageDictionaryCandidatesFromText({ text, sourceChunks });
          if (salvaged.length) {
            return { candidates: salvaged, error: "", retryable: false, promptMode: `${promptMode}-salvaged` };
          }
          if (mode === "hybrid") return { candidates: [], error: lastError, retryable: false, promptMode };
          const repaired = await repairDictionaryJson({ text, promptMode, sourceChunks });
          if (repaired) return { candidates: repaired.candidates, error: "", promptMode: repaired.promptMode };
          return { candidates: [], error: lastError, retryable: true, promptMode };
        }
        const candidates = validatedDictionaryPatch(patch, sourceChunks);
        if (!candidates.length && !micro) {
          lastError = "no-valid-ai-dictionary-candidates";
          return { candidates: [], error: lastError, retryable: true, promptMode };
        }
        return { candidates, error: candidates.length ? "" : "no-valid-ai-dictionary-candidates", promptMode };
      };
      const minGlobalDictionaryCandidates = Math.max(6, Math.min(maxTerms, Number(config.minLlmDictionaryTerms || Math.max(12, chunks.length))));
      let fallbackResult = null;
      for (const promptMode of (mode === "hybrid" ? ["full"] : ["full", "compact", "micro"])) {
        const attempt = await runDictionaryPromptAttempt({ promptMode });
        if (attempt.candidates.length >= minGlobalDictionaryCandidates) {
          return {
            candidates: attempt.candidates,
            provider: provider.id || providerType || "provider",
            model: lastModel,
            usage: totalUsage,
            error: "",
            promptMode: attempt.promptMode || promptMode,
            stats: resultStatsFor(attempt.candidates),
          };
        }
        if (attempt.candidates.length) fallbackResult = attempt;
        if (attempt.error && !attempt.retryable) break;
      }
      const chunkCandidates = [];
      const chunkPromptModes = [];
      const globalCandidates = fallbackResult?.candidates || [];
      const shouldRunChunkPass = mode === "llm" || (mode === "hybrid" && globalCandidates.length < minGlobalDictionaryCandidates);
      for (const chunk of (shouldRunChunkPass ? chunks.slice(0, chunkPassLimit) : [])) {
        attemptedChunkIds.add(chunk.id || "");
        const attempt = await runDictionaryPromptAttempt({ promptMode: "chunk", sourceChunks: [chunk] });
        if (attempt.candidates.length) {
          chunkCandidates.push(...attempt.candidates);
          chunkPromptModes.push(attempt.promptMode || "chunk");
          productiveChunkIds.add(chunk.id || "");
        }
      }
      if (globalCandidates.length || chunkCandidates.length) {
        const mergedCandidates = mergeDictionaryCandidates(globalCandidates, chunkCandidates, maxTerms);
        return {
          candidates: mergedCandidates,
          provider: provider.id || providerType || "provider",
          model: lastModel,
          usage: totalUsage,
          error: "",
          promptMode: unique([fallbackResult?.promptMode || "", ...chunkPromptModes]).join("+") || fallbackResult?.promptMode || "chunk",
          stats: resultStatsFor(mergedCandidates),
        };
      }
      if (fallbackResult) {
        return {
          candidates: fallbackResult.candidates,
          provider: provider.id || providerType || "provider",
          model: lastModel,
          usage: totalUsage,
          error: "",
          promptMode: fallbackResult.promptMode || "micro",
          stats: resultStatsFor(fallbackResult.candidates),
        };
      }
      return {
        candidates: [],
        provider: provider.id || providerType || "provider",
        model: lastModel,
        usage: totalUsage,
        error: lastError || "invalid-ai-json",
        promptMode: "",
        stats: resultStatsFor([]),
      };
    } catch (error) {
      return { candidates: [], provider: provider.id || providerType || "provider", model, usage: {}, error: error?.message || "ai-error", promptMode: "", stats: { inputChunkCount: chunks.length, attemptedChunkCount: 0, productiveChunkCount: 0, coveredChunkCount: 0, coveredChunkIds: [] } };
    }
  };

  const mergeDictionaryCandidates = (ruleCandidates = [], aiCandidates = [], maxTerms = 120) => {
    const merged = new Map();
    const add = (candidate = {}) => {
      const key = candidate.normalized || dictionaryLemma(candidate.term || "");
      if (!key) return;
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, candidate);
        return;
      }
      existing.count = Math.max(Number(existing.count || 0), Number(candidate.count || 0));
      existing.chunkIds = new Set([...(existing.chunkIds || []), ...(candidate.chunkIds || [])].filter(Boolean));
      existing.source = existing.source === candidate.source ? existing.source : "hybrid-dictionary";
      existing.ai = existing.ai || candidate.ai || null;
      if (!existing.ai && candidate.ai) existing.ai = candidate.ai;
      if (candidate.source === "proper-noun" && existing.source !== "proper-noun") existing.source = candidate.source;
    };
    [...ruleCandidates, ...aiCandidates].forEach(add);
    const candidateRank = (candidate = {}) => {
      const normalized = candidate.normalized || dictionaryLemma(candidate.term || "");
      const type = String(candidate.ai?.typeCandidates?.[0]?.type || dictionaryTypeCandidates(candidate.term || "", candidate.evidenceChunk?.text || "")?.[0]?.type || "term").toLowerCase();
      const typed = ["proper-noun", "source", "symbol", "location", "object", "concept", "role", "technology", "creature"].includes(type) ? 8 : 0;
      const knownAnchor = dictionaryCreatureTokens.has(normalized) ||
        dictionaryConceptTokens.has(normalized) ||
        dictionaryLocationTokens.has(normalized) ||
        dictionaryObjectTokens.has(normalized) ||
        dictionaryRoleTokens.has(normalized)
        ? 6
        : 0;
      const sourceScore = candidate.source === "source-anchor-dictionary"
        ? 5
        : candidate.ai
          ? 4
          : candidate.source === "proper-noun"
            ? 3
            : 0;
      const countScore = Math.min(6, Number(candidate.count || 0) / 2);
      return typed + knownAnchor + sourceScore + countScore + Number(candidate.ai?.confidence || 0);
    };
    return [...merged.values()]
      .sort((left, right) => {
        return candidateRank(right) - candidateRank(left) ||
          Number(right.count || 0) - Number(left.count || 0) ||
          String(left.term || "").localeCompare(String(right.term || ""));
      })
      .slice(0, maxTerms);
  };

  const hybridAiCountUsable = ({ count = 0, min = 1, promptMode = "" } = {}) => {
    const normalizedPromptMode = String(promptMode || "").toLowerCase();
    if (normalizedPromptMode === "micro") return false;
    return Number(count || 0) >= Number(min || 1);
  };

  const dictionaryTierFor = ({ term = "", lemma = "", typeCandidates = [], confidence = 0, occurrenceCount = 0 } = {}) => {
    const type = String(typeCandidates?.[0]?.type || "term").toLowerCase();
    const normalized = lemma || dictionaryLemma(term);
    const isProper = type === "proper-noun" || type === "source" || type === "symbol";
    const isTyped = ["location", "object", "concept", "role", "technology", "creature"].includes(type);
    if (isProper && (occurrenceCount >= 2 || confidence >= 0.78)) return "core";
    if (isTyped && (occurrenceCount >= 2 || confidence >= 0.68)) return "typed";
    if (dictionaryConceptTokens.has(normalized) || dictionaryLocationTokens.has(normalized) || dictionaryObjectTokens.has(normalized)) return "typed";
    if (type === "term" && occurrenceCount >= 4 && confidence >= 0.68) return "context";
    return "weak";
  };

  const dictionarySeedScoreFor = ({ tier = "weak", typeCandidates = [], confidence = 0, occurrenceCount = 0 } = {}) => {
    const type = String(typeCandidates?.[0]?.type || "term").toLowerCase();
    const tierScore = { core: 0.95, typed: 0.78, context: 0.42, weak: 0.12 }[tier] || 0.12;
    const typeScore = {
      "proper-noun": 0.14,
      source: 0.12,
      symbol: 0.1,
      location: 0.08,
      object: 0.08,
      creature: 0.09,
      concept: 0.07,
      role: 0.04,
      term: 0,
    }[type] || 0;
    const countScore = Math.min(0.12, Math.max(0, occurrenceCount) / 80);
    return Math.min(1, tierScore + typeScore + countScore + Math.max(0, Number(confidence || 0) - 0.7) * 0.08);
  };

  const buildKnowledgeDictionary = async ({ workspaceId, node, payload, event, config = {} } = {}) => {
    const payloadChunks = Array.isArray(payload?.chunks) ? payload.chunks.filter(Boolean) : [];
    const documentId = payload?.documentId || payload?.id || config.documentId || payloadChunks[0]?.documentId || "";
    const allChunks = payloadChunks.length
      ? payloadChunks
      : byWorkspace(await listStore(STORES.chunks), workspaceId)
        .filter((chunk) => (!documentId || chunk.documentId === documentId));
    const collectionId = config.collectionId || payload?.collectionId || payload?.metadata?.collectionId || allChunks[0]?.metadata?.collectionId || "";
    const scopedChunks = allChunks
      .filter((chunk) => !documentId || chunk.documentId === documentId)
      .filter((chunk) => !collectionId || chunk.metadata?.collectionId === collectionId || payloadChunks.length);
    if (!scopedChunks.length) throw new Error("Chunk Knowledge non trovati per Knowledge Dictionary Builder");
    const combinedText = scopedChunks.map((chunk) => chunk.text || "").join("\n\n");
    const effectiveConfig = agentToolsBoundedKnowledgeConfig(node, config);
    const language = detectLanguage(combinedText, preferredRuntimeLanguage(effectiveConfig, payload) || scopedChunks[0]?.metadata?.language || "");
    const maxTerms = Math.max(8, Number(effectiveConfig.maxTerms || 120));
    const minFrequency = Math.max(1, Number(effectiveConfig.minFrequency || 1));
    const scope = String(effectiveConfig.scope || "document").trim().toLowerCase() || "document";
    const mode = dictionaryBuildMode(effectiveConfig);
    const replaceExisting = effectiveConfig.replaceExisting !== false;
    if (replaceExisting && documentId) await deleteDictionaryEntries({ workspaceId, documentId });
    const now = nowIso();
    const aiResult = ["llm", "hybrid"].includes(mode)
      ? await callKnowledgeDictionaryAi({ chunks: scopedChunks, language, config: effectiveConfig })
      : { candidates: [], provider: "", model: "", usage: {}, error: "", promptMode: "" };
    if (aiResult.usage?.totalTokens) {
      await persistKnowledgeNodeTokenUsage({ node, usage: aiResult.usage, provider: aiResult.provider, model: aiResult.model });
    }
    const minHybridAiTerms = Math.max(4, Math.min(maxTerms, Number(effectiveConfig.minHybridAiTerms || Math.max(12, scopedChunks.length * 2))));
    const aiDictionaryUsable = hybridAiCountUsable({
      count: aiResult.candidates?.length || 0,
      min: minHybridAiTerms,
      promptMode: aiResult.promptMode || "",
    });
    const useRuleFallback = mode === "rules" ||
      (mode === "hybrid" && !aiDictionaryUsable);
    const useHybridCompletion = mode === "hybrid";
    const sourceAnchorCandidates = mode === "llm" || mode === "rules" || effectiveConfig.useSourceAnchors === false
      ? []
      : extractSourceDictionaryAnchors(scopedChunks, { language, maxTerms, config: effectiveConfig });
    const ruleCandidates = useRuleFallback || useHybridCompletion
      ? extractDictionaryCandidates(scopedChunks, { language, maxTerms, minFrequency, config: effectiveConfig })
      : [];
    const finalCandidates = mode === "llm"
      ? (aiResult.candidates || []).slice(0, maxTerms)
      : mode === "hybrid"
        ? mergeDictionaryCandidates(ruleCandidates, mergeDictionaryCandidates(sourceAnchorCandidates, aiResult.candidates || [], maxTerms), maxTerms)
        : mergeDictionaryCandidates(ruleCandidates, aiResult.candidates || [], maxTerms);
    const records = [];
    for (const candidate of finalCandidates) {
      const chunk = candidate.evidenceChunk || scopedChunks[0] || {};
      const evidence = candidate.ai?.evidence || dictionaryEvidenceFor(chunk.text || "", candidate.term);
      const lemma = dictionaryLemma(candidate.term, language);
      const candidateAliases = candidate.ai?.aliases?.length ? candidate.ai.aliases : [candidate.term].filter(Boolean);
      const evidencePack = dictionaryEvidencePackFor({
        term: candidate.term,
        aliases: candidateAliases,
        chunks: scopedChunks,
        maxItems: Math.max(1, Math.min(24, Number(effectiveConfig.evidencePackLimit || 8))),
      });
      const localTypeCandidates = dictionaryTypeCandidates(candidate.term, chunk.text || "", effectiveConfig);
      const aiTypeCandidates = candidate.ai?.typeCandidates || [];
      const localPrimaryType = String(localTypeCandidates[0]?.type || "").toLowerCase();
      const aiPrimaryType = String(aiTypeCandidates[0]?.type || "").toLowerCase();
      const localTypeIsStrong = ["proper-noun", "source", "location", "object", "concept", "role", "creature", "technology"].includes(localPrimaryType);
      const preferLocalType = localTypeIsStrong && aiPrimaryType && aiPrimaryType !== localPrimaryType;
      const typeCandidates = (candidate.ai?.typeCandidates?.length
        ? (preferLocalType ? [...localTypeCandidates, ...aiTypeCandidates] : [...aiTypeCandidates, ...localTypeCandidates])
        : localTypeCandidates)
        .filter((item, index, list) => item?.type && list.findIndex((candidateType) => candidateType?.type === item.type) === index);
      const localConfidence = Math.min(0.95, 0.48 + Math.min(0.35, candidate.count / 20) + (candidate.source === "proper-noun" ? 0.12 : 0));
      const confidence = candidate.ai?.confidence && !preferLocalType
        ? Math.min(0.98, Number(candidate.ai.confidence || 0))
        : localConfidence;
      const tier = dictionaryTierFor({ term: candidate.term, lemma, typeCandidates, confidence, occurrenceCount: candidate.count });
      const seedScore = dictionarySeedScoreFor({ tier, typeCandidates, confidence, occurrenceCount: candidate.count });
      const record = {
        id: `kdict_${safeId(workspaceId)}_${safeId(documentId || "doc")}_${safeId(lemma || candidate.normalized)}`,
        workspaceId,
        flowId: node?.flowId || node?.metadata?.flowId || payload?.flowId || "",
        collectionId,
        documentId,
        chunkId: chunk.id || "",
        language,
        scope,
        term: candidate.term,
        lemma,
        normalized: candidate.normalized,
        aliases: candidateAliases,
        typeCandidates,
        tier,
        usableAsSeed: tier === "core" || tier === "typed",
        seedScore,
        semanticHints: candidate.ai?.semanticHints || [],
        relationCues: candidate.ai?.relationCues || [],
        confidence,
        evidence,
        evidencePack,
        source: {
          method: candidate.source || (mode === "llm" ? "ai-dictionary" : "rule-dictionary"),
          nodeId: node?.id || "",
          inputChannel: event?.channel || "",
          occurrenceCount: candidate.count,
          sourceChunkIds: [...candidate.chunkIds].filter(Boolean),
          mode,
          provider: aiResult.provider || "",
          model: aiResult.model || "",
          aiError: aiResult.error || "",
          explanation: candidate.ai?.explanation || "",
        },
        status: "ready",
        createdAt: now,
        updatedAt: now,
      };
      records.push(await putRecord(STORES.dictionary, record));
    }
    const context = records.length
      ? [
        `Knowledge Dictionary (${language || "auto"}): ${records.length} terms`,
        ...records.map((entry, index) =>
          `[D${index + 1}] ${entry.term} -> ${entry.typeCandidates?.[0]?.type || "term"} tier=${entry.tier || "weak"} seed=${entry.usableAsSeed ? "yes" : "no"} (${Number(entry.confidence || 0).toFixed(2)})`
        ),
      ].join("\n")
      : "Knowledge Dictionary: no terms";
    const outputEntries = records.map((entry) => ({
      id: entry.id,
      term: entry.term,
      lemma: entry.lemma,
      typeCandidates: entry.typeCandidates,
      tier: entry.tier,
      usableAsSeed: entry.usableAsSeed,
      seedScore: entry.seedScore,
      confidence: entry.confidence,
      evidence: entry.evidence,
      evidencePack: entry.evidencePack || [],
      evidenceCount: Array.isArray(entry.evidencePack) ? entry.evidencePack.length : 0,
      source: {
        method: entry.source?.method || "",
        occurrenceCount: entry.source?.occurrenceCount || 0,
        sourceChunkIds: entry.source?.sourceChunkIds || [],
      },
    }));
    return {
      id: uniqueId("kdict_batch"),
      workspaceId,
      collectionId,
      documentId,
      language,
      scope,
      mode,
      ai: {
        provider: aiResult.provider || "",
        model: aiResult.model || "",
        error: aiResult.error || "",
        promptMode: aiResult.promptMode || "",
        candidateCount: aiResult.candidates?.length || 0,
        minHybridCandidates: minHybridAiTerms,
        hybridFallback: useRuleFallback,
        hybridMerged: mode === "hybrid",
        ruleCompletionCount: mode === "hybrid" || mode === "rules" ? ruleCandidates.length : 0,
        sourceAnchorCount: sourceAnchorCandidates.length,
        fallbackReason: useRuleFallback && mode === "hybrid" ? "sparse-ai-dictionary-output" : "",
        chunkCoverage: aiResult.stats || {
          inputChunkCount: scopedChunks.length,
          attemptedChunkCount: 0,
          productiveChunkCount: 0,
          coveredChunkCount: 0,
          coveredChunkIds: [],
        },
      },
      dictionaryEntries: outputEntries,
      dictionaryEntryIds: records.map((entry) => entry.id),
      dictionaryEntryIdsTruncated: false,
      dictionaryCount: records.length,
      previewCount: outputEntries.length,
      previewTruncated: false,
      tierCounts: records.reduce((acc, entry) => {
        const tier = entry.tier || "weak";
        acc[tier] = (acc[tier] || 0) + 1;
        return acc;
      }, {}),
      usableSeedCount: records.filter((entry) => entry.usableAsSeed).length,
      context,
      status: mode === "hybrid" && (aiResult.candidates?.length || 0) > 0 && useRuleFallback
        ? "partial-ai-merged"
        : useRuleFallback
          ? "fallback"
          : "ready",
      createdAt: now,
    };
  };

  const narrativeSentenceSplit = (text = "") =>
    String(text || "")
      .replace(/\r/g, "")
      .split(/(?<=[.!?])\s+|\n{2,}/)
      .map((sentence) => sentence.replace(/\s+/g, " ").trim())
      .filter((sentence) => sentence.length >= 12);

  const narrativeActionLexicon = [
    { type: "cannot_speak", patterns: [/\b(?:non\s+(?:pu[oò]|poteva|potendo|riesce|riusciva|riusc[iì])\s+(?:a\s+)?parlare|non\s+parlava|cannot\s+speak|could\s+not\s+speak|unable\s+to\s+speak|sin\s+voz|ne\s+pouvait\s+pas\s+parler)\b/] },
    { type: "finds", patterns: [/\b(?:trovarono|trov[oò]|scopr[iì]|found|finds|discovered|discover|encontr[oó]|trouv)\b/] },
    { type: "seeks", patterns: [/\b(?:cercando|cerca|cercava|cercare|seeks|searches|looking for|busca|cherch)\b/] },
    { type: "fills", patterns: [/\b(?:riempirono|riemp[iì]|riempire|filled|fills|llen[oó]|rempl)\b/] },
    { type: "immerses", patterns: [/\b(?:immersero|immerse|immerso|immersa|immergere|dipped|immersed|sumerg|plonge)\b/] },
    { type: "transforms", patterns: [/\b(?:trasformandosi|trasform[oò]|trasforma|became|becomes|turned into|transform|convirti[oó]|devient|deven)\b/] },
    { type: "takes", patterns: [/\b(?:prese|prende|presero|took|takes|tom[oó]|prend)\b/] },
    { type: "drinks", patterns: [/\b(?:bevve|beve|bevuto|bere|drank|drinks|drink|bebi[oó]|boit|but)\b/] },
    { type: "has_property", patterns: [/\b(?:possiede|possedeva|possiedono|possesses|possessed|potere|poteri|propriet[aà]|capacit[aà]|power|property|ability|pouvoir|capacit[eé])\b/] },
    { type: "heals", patterns: [/\b(?:guar[iì]|guarito|guarire|guarisce|cur[oò]|curare|healed|heals|cured|cure|gu[eé]ri|gueri)\b/] },
    { type: "speaks", patterns: [/\b(?:parl[oò]|parla|pronunciava|pronunci[oò]|disse|dice|grid[oò]|grido|speak|spoke|said|shouted|habl[oó]|parlait)\b/] },
    { type: "moves", patterns: [/\b(?:corsero|and[oò]|andarono|scese|scesero|went|ran|walked|corr|fueron|all[aè]rent)\b/] },
    { type: "signals", patterns: [/\b(?:sorrise|annu[iì]|guard[oò]|smiled|nodded|looked|sonri[oó]|regarda)\b/] },
  ];

  const narrativeObjectHints = [];

  const narrativeEventLexiconFor = (config = {}) => {
    const rules = customKnowledgeRules(config);
    const customEntries = (Array.isArray(rules.eventRules) ? rules.eventRules : [])
      .map((entry) => ({
        type: normalizeKnowledgeEventType(entry.eventType || entry.type),
        patterns: customRuleRegexes(entry.cuePatterns || entry.patterns || entry.terms),
        negativePatterns: customRuleRegexes(entry.negativePatterns || entry.blockedPatterns),
        confidence: Number(entry.confidence || 0) || 0,
      }))
      .filter((entry) => entry.type && entry.patterns.length);
    if (customRulesMode(rules) === "replace" && customEntries.length) return customEntries;
    return [...narrativeActionLexicon, ...customEntries];
  };

  const inferNarrativeEventType = (sentence = "", config = {}) => {
    const normalized = normalizeEntityToken(sentence);
    const rules = customKnowledgeRules(config);
    const blocked = customRuleRegexes(rules.blockedEventTerms || rules.eventStopTerms || rules.blockedTerms);
    if (blocked.some((pattern) => pattern.test(normalized))) return "";
    if (/^[a-zà-ÿ]{1,3}\s/.test(String(sentence || "").trim())) return "";
    if (!/[.!?;:»”"]$/.test(String(sentence || "").trim()) && normalized.split(/\s+/).length <= 8) return "";
    const match = narrativeEventLexiconFor(config).find((entry) =>
      entry.patterns.some((pattern) => pattern.test(normalized)) &&
      !(entry.negativePatterns || []).some((pattern) => pattern.test(normalized))
    );
    if (match?.type === "fills" && /\b(?:musica|risate|speranza|gioia|paura|silenzio|sound|music|laughter|hope)\b/.test(normalized)) return "";
    if (match?.type === "heals" && /\b(?:potra|potrà|potrebbe|dovra|dovrà|pu[oò]|puo|can|could|will|would|pourra|pourrait)\b.{0,60}\b(?:guarire|guarito|heal|healed|cure|cured)\b/.test(normalized)) return "";
    if (match?.type === "speaks" && /\b(?:far|fare|modo\s+per|desideri|possa|potesse|riusc[iì]|riuscire)\b.{0,80}\b(?:parlare|speak|talk)\b/.test(normalized)) return "";
    return match?.type || "";
  };

  const narrativeActionCueIndex = (sentence = "", eventType = "", config = {}) => {
    const normalized = normalizeEntityToken(sentence);
    const entries = eventType
      ? narrativeEventLexiconFor(config).filter((entry) => entry.type === eventType)
      : narrativeEventLexiconFor(config);
    const positions = entries.flatMap((entry) =>
      entry.patterns.map((pattern) => {
        const match = normalized.match(pattern);
        return match ? match.index || 0 : -1;
      }).filter((index) => index >= 0)
    );
    return positions.length ? Math.min(...positions) : -1;
  };

  const sentenceHasNarrativeAction = (sentence = "", eventType = "", config = {}) => narrativeActionCueIndex(sentence, eventType, config) >= 0;

  const knowledgePronounPattern = /^(?:i|me|you|he|she|it|we|they|him|her|them|lui|lei|egli|ella|esso|essa|noi|voi|loro|essi|esse|lo|la|li|le|gli|elles|ils|elle|eux|ellos|ellas|el|ella)$/i;

  const isKnowledgePronounMention = (value = "") =>
    knowledgePronounPattern.test(normalizeEntityToken(value));

  const normalizeKnowledgeEventActorList = (value = [], { maxItems = 6 } = {}) => {
    const source = Array.isArray(value) ? value : [value];
    return unique(source
      .flatMap((item) => String(item || "").split(/[,;|]/g))
      .map((item) => String(item || "").replace(/\s+/g, " ").trim())
      .filter((item) => item.length >= 2 && item.length <= 96)
      .filter((item) => !isKnowledgePronounMention(item)))
      .slice(0, maxItems);
  };

  const normalizeKnowledgeEventSubject = (value = "") =>
    normalizeKnowledgeEventActorList(value, { maxItems: 4 }).join(", ");

  const narrativeSubjectDictionaryEntries = (dictionaryEntries = []) =>
    dictionaryEntries
      .filter((entry) => ["core", "typed"].includes(entry.tier || "") || entry.usableAsSeed)
      .filter((entry) => ["proper-noun", "role"].includes(String(entry.typeCandidates?.[0]?.type || "").toLowerCase()))
      .map((entry) => entry.term || entry.lemma || "")
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);

  const narrativeMentionedParticipants = (sentence = "", dictionaryEntries = []) => {
    const normalizedSentence = normalizeEntityToken(sentence);
    if (!normalizedSentence) return [];
    return unique(narrativeSubjectDictionaryEntries(dictionaryEntries)
      .filter((term) => {
        const key = normalizeEntityToken(term);
        return key && new RegExp(`\\b${escapedRegExp(key)}\\b`).test(normalizedSentence);
      }))
      .slice(0, 6);
  };

  const hasObjectOrIndirectPronounMention = (sentence = "") =>
    /\b(?:gli|lui|lei|him|her|them|loro|elle|eux|ellos|ellas)\b/.test(normalizeEntityToken(sentence));

  const recentNarrativeParticipants = (previous = {}, sentence = "", dictionaryEntries = []) => {
    const mentioned = narrativeMentionedParticipants(sentence, dictionaryEntries);
    const recent = unique([
      ...normalizeKnowledgeEventActorList(previous.recentParticipants || []),
      ...normalizeKnowledgeEventActorList(previous.participants || []),
      ...normalizeKnowledgeEventActorList(previous.subject || ""),
    ].filter((item) => item && !isKnowledgePronounMention(item)));
    const withMentioned = unique([...mentioned, ...recent].filter(Boolean));
    return withMentioned.slice(0, 6);
  };

  const isNarrativeParticipantMention = (term = "", dictionaryEntries = []) => {
    const normalizedTerm = normalizeEntityToken(term);
    if (!normalizedTerm || isKnowledgePronounMention(normalizedTerm)) return false;
    return dictionaryEntries.some((entry) =>
      ["proper-noun", "role"].includes(String(entry.typeCandidates?.[0]?.type || "").toLowerCase()) &&
      normalizeEntityToken(entry.term || entry.lemma || "") === normalizedTerm
    );
  };

  const firstNarrativeToken = (sentence = "") =>
    normalizeEntityToken(sentence).split(/\s+/).filter(Boolean)[0] || "";

  const narrativeSubjectResolution = ({ subject = "", method = "unresolved", confidence = 0, sentence = "", sourceMention = "", participants = [] } = {}) => ({
    method,
    confidence: Math.max(0, Math.min(1, Number(confidence || 0))),
    evidenceSpan: String(sentence || ""),
    sourceMention: sourceMention || normalizeKnowledgeEventSubject(subject) || "",
    participants: normalizeKnowledgeEventActorList(participants),
  });

  const narrativeObjectPosition = (sentence = "", term = "") => {
    const key = normalizeEntityToken(term);
    if (!key) return -1;
    const match = normalizeEntityToken(sentence).match(new RegExp(`\\b${escapedRegExp(key)}\\b`));
    return match ? match.index || 0 : -1;
  };

  const isNarrativeLiquidOrContainer = (term = "") =>
    /\b(?:liquido|liquid|contenitore|container|recipient|vessel)\b/.test(normalizeEntityToken(term));

  const narrowNarrativeEventObjects = (sentence = "", eventType = "", objects = [], config = {}) => {
    const sorted = [...objects].sort((left, right) => narrativeObjectPosition(sentence, left) - narrativeObjectPosition(sentence, right));
    if (eventType === "fills") {
      const selected = sorted.filter(isNarrativeLiquidOrContainer);
      return selected.length ? selected : sorted;
    }
    if (eventType === "immerses") {
      const actionIndex = narrativeActionCueIndex(sentence, "immerses", config);
      const afterAction = sorted.filter((term) => {
        const position = narrativeObjectPosition(sentence, term);
        return position < 0 || actionIndex < 0 || position >= actionIndex;
      });
      const movedObjects = afterAction.filter((term) => !isNarrativeLiquidOrContainer(term));
      return movedObjects.length ? movedObjects : (afterAction.length ? afterAction : sorted);
    }
    return sorted;
  };

  const buildNarrativeEventSpecs = (sentence = "", eventType = "", objects = [], config = {}) => {
    if (eventType === "fills" && sentenceHasNarrativeAction(sentence, "immerses", config)) {
      return [
        { eventType: "fills", objects: narrowNarrativeEventObjects(sentence, "fills", objects, config) },
        { eventType: "immerses", objects: narrowNarrativeEventObjects(sentence, "immerses", objects, config) },
      ].filter((spec) => spec.objects.length || spec.eventType === eventType);
    }
    return [{ eventType, objects: narrowNarrativeEventObjects(sentence, eventType, objects, config) }];
  };

  const inferNarrativeEventSubjectResolution = (sentence = "", dictionaryEntries = [], eventType = "", previous = {}, config = {}) => {
    const properEntries = narrativeSubjectDictionaryEntries(dictionaryEntries);
    const normalizedSentence = normalizeEntityToken(sentence);
    const actionIndex = narrativeActionCueIndex(sentence, eventType, config);
    const mentionedParticipants = narrativeMentionedParticipants(sentence, dictionaryEntries);
    const recentParticipants = recentNarrativeParticipants(previous, sentence, dictionaryEntries);
    const found = properEntries.find((term) => {
      const key = normalizeEntityToken(term);
      if (!key) return false;
      const match = normalizedSentence.match(new RegExp(`\\b${escapedRegExp(key)}\\b`));
      if (!match) return false;
      const entityIndex = match.index || 0;
      return actionIndex < 0 || entityIndex <= actionIndex || entityIndex <= 8;
    });
    if (found) {
      const previousSubject = previous.subject && !isKnowledgePronounMention(previous.subject) ? previous.subject : "";
      const previousObjectCandidate = previousSubject ||
        (previous.recentParticipants || []).find((item) => item && item !== found && !isKnowledgePronounMention(item)) ||
        "";
      const participants = unique([
        found,
        ...mentionedParticipants,
        ...(previousObjectCandidate && previousObjectCandidate !== found && hasObjectOrIndirectPronounMention(sentence) ? [previousObjectCandidate] : []),
      ].filter(Boolean));
      return {
        subject: found,
        participants,
        subjectResolution: narrativeSubjectResolution({ subject: found, method: "explicit", confidence: 0.94, sentence, sourceMention: found, participants }),
      };
    }
    const firstToken = firstNarrativeToken(sentence);
    const previousSubject = previous.subject && !isKnowledgePronounMention(previous.subject) ? previous.subject : "";
    const previousParticipants = unique(recentParticipants.filter((item) => item && !isKnowledgePronounMention(item)));
    const pluralMention = /^(?:trovarono|corsero|riempirono|immersero|presero|andarono|arrivarono|scesero|they|found|ran|filled|went|arrived|loro|essi|elles|ils|ellos|ellas)\b/.test(normalizedSentence);
    if (pluralMention) {
      if (previousParticipants.length > 1) {
        const subject = normalizeKnowledgeEventSubject(previousParticipants);
        return {
          subject,
          participants: previousParticipants,
          subjectResolution: narrativeSubjectResolution({ subject, method: "context-window", confidence: 0.72, sentence, sourceMention: firstToken || "they", participants: previousParticipants }),
        };
      }
      return {
        subject: "",
        participants: [],
        subjectResolution: narrativeSubjectResolution({ method: "unresolved", confidence: 0.2, sentence, sourceMention: firstToken || "they" }),
      };
    }
    if (previousSubject && /^(?:lui|lei|egli|ella|he|she|elle)\b/.test(normalizedSentence)) {
      return {
        subject: previousSubject,
        participants: [previousSubject],
        subjectResolution: narrativeSubjectResolution({ subject: previousSubject, method: "coreference", confidence: 0.82, sentence, sourceMention: firstToken, participants: [previousSubject] }),
      };
    }
    if (previousSubject && eventType === "speaks" && /\b(?:sua bocca|his mouth|her mouth|sa bouche)\b/.test(normalizedSentence)) {
      return {
        subject: previousSubject,
        participants: [previousSubject],
        subjectResolution: narrativeSubjectResolution({ subject: previousSubject, method: "context-window", confidence: 0.76, sentence, sourceMention: "mouth", participants: [previousSubject] }),
      };
    }
    if (previousSubject && actionIndex <= 2 && !/\b(?:lo|la|lui|lei|egli|ella|he|she|elle)\b/.test(normalizedSentence)) {
      return {
        subject: previousSubject,
        participants: [previousSubject],
        subjectResolution: narrativeSubjectResolution({ subject: previousSubject, method: "context-window", confidence: 0.68, sentence, sourceMention: firstToken, participants: [previousSubject] }),
      };
    }
    if (/\b(?:loro|essi|they|ellos|elles|ils)\b/.test(normalizedSentence)) {
      return {
        subject: "",
        participants: [],
        subjectResolution: narrativeSubjectResolution({ method: "unresolved", confidence: 0.2, sentence, sourceMention: firstToken || "they" }),
      };
    }
    return {
      subject: "",
      participants: [],
      subjectResolution: narrativeSubjectResolution({ method: "unresolved", confidence: 0, sentence }),
    };
  };

  const inferNarrativeEventSubject = (sentence = "", dictionaryEntries = [], eventType = "", previousSubject = "", config = {}) =>
    inferNarrativeEventSubjectResolution(sentence, dictionaryEntries, eventType, { subject: previousSubject }, config).subject;

  const inferNarrativeEventObjects = (sentence = "", dictionaryEntries = [], config = {}) => {
    const normalizedSentence = normalizeEntityToken(sentence);
    const rules = customKnowledgeRules(config);
    const customHints = customRuleValues(
      rules.objectHints,
      rules.eventObjectHints,
      ...(Array.isArray(rules.eventRules) ? rules.eventRules.map((entry) => entry.objectHints || entry.objects) : [])
    );
    const dictionaryObjects = dictionaryEntries
      .filter((entry) => ["object", "concept", "location", "creature"].includes(String(entry.typeCandidates?.[0]?.type || "").toLowerCase()))
      .map((entry) => entry.term || entry.lemma || "")
      .filter(Boolean);
    return unique([...dictionaryObjects, ...narrativeObjectHints, ...customHints]
      .filter((term) => {
        const key = normalizeEntityToken(term);
        return key && new RegExp(`\\b${escapedRegExp(key)}\\b`).test(normalizedSentence);
      })
      .sort((a, b) => b.length - a.length))
      .slice(0, 8);
  };

  const narrativeEventImportance = (eventType = "", objects = [], sentence = "", config = {}) => {
    const normalized = normalizeEntityToken(`${sentence} ${objects.join(" ")}`);
    const rules = customKnowledgeRules(config);
    const customRule = (Array.isArray(rules.eventRules) ? rules.eventRules : [])
      .find((entry) => normalizeKnowledgeEventType(entry.eventType || entry.type) === eventType && Number(entry.confidence || 0) > 0);
    let score = {
      drinks: 0.92,
      transforms: 0.88,
      immerses: 0.86,
      fills: 0.82,
      has_property: 0.76,
      heals: 0.9,
      speaks: 0.82,
      cannot_speak: 0.78,
      seeks: 0.72,
      finds: 0.68,
      takes: 0.7,
      moves: 0.42,
      signals: 0.4,
    }[eventType] || Number(customRule?.confidence || 0) || 0.55;
    if (customRule?.confidence) score = Number(customRule.confidence);
    if (/\b(?:guar\w*|heal\w*|cure\w*|successo|result|outcome|esito)\b/.test(normalized)) score += 0.08;
    return Math.min(0.98, score);
  };

  const knowledgeEventPolarityForEvidence = (sentence = "", eventType = "") => {
    const normalized = normalizeEntityToken(sentence);
    if (eventType === "cannot_speak") return "negative";
    if (/\b(?:not|never|no|failed|fail|non|mai|nessun|niente|sin|pas|ne)\b.{0,80}\b(?:open|speak|drink|take|go|find|parlare|aprire|bere|prendere|trovare)\b/.test(normalized)) return "negative";
    return "positive";
  };

  const knowledgeEventModalityForEvidence = (sentence = "") => {
    const normalized = normalizeEntityToken(sentence);
    if (/\b(?:try|tried|tries|attempt|attempted|tent[oò]|tentava|cerc[oò]\s+di|prov[oò]|riprov[oò])\b/.test(normalized)) return "attempt";
    if (/\b(?:must|should|shall|deve|doveva|dovrebbe|obblig|required|may|might|could|can|pu[oò]|potrebbe|potra|potrà|would|will)\b/.test(normalized)) return "modal";
    if (/\b(?:said|claimed|states|reported|dice|disse|afferm[oò]|sostiene|secondo)\b/.test(normalized)) return "claim";
    return "asserted";
  };

  const knowledgeEventAspectForEvidence = (sentence = "", modality = "asserted") => {
    if (modality === "attempt") return "attempted";
    if (modality === "modal") return "prospective";
    if (modality === "claim") return "reported";
    if (/\b(?:started|began|inizi[oò]|iniziava|cominci[oò])\b/.test(normalizeEntityToken(sentence))) return "started";
    return "completed";
  };

  const knowledgeEventRolesFor = ({ eventType = "", subject = "", objects = [], participants = [], contextObjects = [] } = {}) => {
    const cleanSubject = normalizeKnowledgeEventSubject(subject);
    const cleanObjects = (objects || []).filter(Boolean);
    const cleanContextObjects = (contextObjects || []).filter(Boolean);
    const roles = {
      agent: cleanSubject ? normalizeKnowledgeEventActorList(cleanSubject, { maxItems: 4 }) : [],
      patient: [],
      object: cleanObjects,
      instrument: [],
      source: [],
      destination: [],
      location: [],
      beneficiary: [],
    };
    if (["moves"].includes(eventType)) {
      roles.destination = cleanObjects;
      roles.object = [];
    }
    if (["takes", "drinks", "immerses", "fills", "transforms"].includes(eventType)) {
      roles.patient = cleanObjects;
    }
    if (eventType === "immerses") {
      roles.destination = unique(cleanContextObjects.filter(isNarrativeLiquidOrContainer));
    }
    if (eventType === "has_property") {
      roles.object = [];
      roles.patient = cleanSubject ? [cleanSubject] : [];
    }
    roles.participants = unique([
      ...normalizeKnowledgeEventActorList(participants),
      ...normalizeKnowledgeEventActorList(cleanSubject),
      ...cleanObjects,
      ...roles.destination,
    ].filter(Boolean));
    return roles;
  };

  const knowledgeEventTypes = new Set([
    "cannot_speak", "finds", "seeks", "fills", "immerses", "transforms", "takes", "drinks",
    "has_property", "heals", "speaks", "moves", "signals", "helps", "tries_to_help",
    "protects", "opposes", "gives_to", "receives_from", "asks_for", "discovers", "causes", "leads_to",
  ]);

  const normalizeKnowledgeEventType = (value = "") => {
    const type = String(value || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    return knowledgeEventTypes.has(type) ? type : "";
  };

  const knowledgeAiTextConfig = (value = "", fallback = "") => {
    const text = String(value || "").replace(/\r\n/g, "\n").trim();
    return text || fallback;
  };

  const knowledgeAiNumberConfig = (value, fallback = 0) => {
    if (value === null || value === undefined || value === "") return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };

  const estimateKnowledgeAiTokens = (value = "") =>
    Math.max(0, Math.ceil(String(value || "").length / 4));

  const knowledgeAiUsageFromResponse = ({ data = {}, prompt = "", text = "" } = {}) => {
    const promptTokens = Number(data.usage?.prompt_tokens || data.prompt_eval_count || 0) || estimateKnowledgeAiTokens(prompt);
    const completionTokens = Number(data.usage?.completion_tokens || data.eval_count || 0) || estimateKnowledgeAiTokens(text);
    const totalTokens = Number(data.usage?.total_tokens || 0) || promptTokens + completionTokens;
    return { promptTokens, completionTokens, totalTokens };
  };

  const addKnowledgeAiUsage = (total = {}, usage = {}) => ({
    promptTokens: Number(total.promptTokens || 0) + Number(usage.promptTokens || usage.prompt_tokens || 0),
    completionTokens: Number(total.completionTokens || 0) + Number(usage.completionTokens || usage.completion_tokens || 0),
    totalTokens: Number(total.totalTokens || 0) + Number(usage.totalTokens || usage.total_tokens || 0),
  });

  const persistKnowledgeNodeTokenUsage = async ({ node, usage = {}, provider = "", model = "" } = {}) => {
    const totalTokens = Number(usage.totalTokens || usage.total_tokens || 0);
    if (!node?.id || !totalTokens) return;
    const previous = node.metadata?.tokenUsage || {};
    const previousTotal = tokenUsageTotals.has(node.id)
      ? Number(tokenUsageTotals.get(node.id) || 0)
      : Number(previous.totalTokens || 0);
    const nextUsage = {
      totalTokens: previousTotal + totalTokens,
      totalPromptTokens: Number(previous.totalPromptTokens || 0) + Number(usage.promptTokens || usage.prompt_tokens || 0),
      totalCompletionTokens: Number(previous.totalCompletionTokens || 0) + Number(usage.completionTokens || usage.completion_tokens || 0),
      lastTokens: totalTokens,
      lastPromptTokens: Number(usage.promptTokens || usage.prompt_tokens || 0),
      lastCompletionTokens: Number(usage.completionTokens || usage.completion_tokens || 0),
      provider: provider || previous.provider || "",
      model: model || previous.model || "",
      updatedAt: nowIso(),
    };
    tokenUsageTotals.set(node.id, nextUsage.totalTokens);
    const nextNode = {
      ...node,
      metadata: {
        ...(node.metadata || {}),
        tokenUsage: nextUsage,
        config: {
          ...(node.metadata?.config || {}),
          tokenUsage: nextUsage.totalTokens,
          lastTokens: nextUsage.lastTokens,
        },
      },
      updatedAt: nowIso(),
    };
    try {
      await window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode?.({ node: nextNode });
      const instance = instances.get(nextNode.workspaceId || node.workspaceId || "workspace_global");
      if (instance?.runtime?.nodes) {
        instance.runtime.nodes = (instance.runtime.nodes || []).map((item) => item.id === nextNode.id ? nextNode : item);
      }
    } catch (error) {
      console.warn("Knowledge token usage non persistito", error);
    }
  };

  const normalizeKnowledgeEventObjects = (value = []) => {
    const source = Array.isArray(value) ? value : String(value || "").split(/[,;|]/);
    return unique(source
      .map((item) => String(item || "").replace(/\s+/g, " ").trim())
      .filter((item) => item.length >= 2 && item.length <= 96))
      .slice(0, 8);
  };

  const knowledgeEventQuoteOffsets = (chunk = {}, quote = "") => {
    const text = String(chunk?.text || "");
    const cleanQuote = String(quote || "").replace(/\s+/g, " ").trim();
    if (!text || !cleanQuote) return { startOffset: null, endOffset: null, quote: cleanQuote };
    const direct = text.indexOf(cleanQuote);
    if (direct >= 0) return { startOffset: direct, endOffset: direct + cleanQuote.length, quote: cleanQuote };
    const normalizedText = text.replace(/\s+/g, " ");
    const normalizedIndex = normalizedText.indexOf(cleanQuote);
    return {
      startOffset: normalizedIndex >= 0 ? normalizedIndex : null,
      endOffset: normalizedIndex >= 0 ? normalizedIndex + cleanQuote.length : null,
      quote: cleanQuote,
    };
  };

  const knowledgeEventQuoteHasCleanBoundary = (chunk = {}, quote = "") => {
    const text = String(chunk?.text || "");
    const cleanQuote = String(quote || "").replace(/\s+/g, " ").trim();
    if (!text || !cleanQuote) return false;
    const direct = text.indexOf(cleanQuote);
    if (direct < 0) return true;
    const before = direct > 0 ? text[direct - 1] : "";
    const after = text[direct + cleanQuote.length] || "";
    const edgeLetter = /[A-Za-zÀ-ÖØ-öø-ÿ]/;
    const startsInsideWord = Boolean(before && edgeLetter.test(before) && edgeLetter.test(cleanQuote[0] || ""));
    const endsInsideWord = Boolean(after && edgeLetter.test(after) && edgeLetter.test(cleanQuote[cleanQuote.length - 1] || ""));
    return !startsInsideWord && !endsInsideWord;
  };

  const knowledgeEventCandidateKey = (candidate = {}) => [
    candidate.chunkId || candidate.chunk?.id || "",
    normalizeKnowledgeEventType(candidate.eventType),
    normalizeKnowledgeText(candidate.evidence?.quote || candidate.quote || ""),
  ].join("::");

  const normalizeAiKnowledgeEventTypeForEvidence = (eventType = "", quote = "") => {
    const type = normalizeKnowledgeEventType(eventType);
    const normalized = normalizeEntityToken(quote);
    if (!type) return { eventType: "", reason: "event-type-not-allowed" };
    if (type === "has_property" && !/\b(?:possiede|possedeva|possiedono|possesses|possessed|potere|poteri|propriet[aà]|capacit[aà]|power|property|ability|pouvoir|capacit[eé])\b/.test(normalized)) {
      return { eventType: "", reason: "property-cue-not-supported" };
    }
    if (["finds", "discovers"].includes(type) &&
      !/\b(?:trova|trov[oò]|trovarono|trovano|scopre|scopr[iì]|scoprirono|individua|individu[oò]|find|finds|found|discover|discovers|discovered|encounter|encounters|encountered|trouve|trouva|d[eé]couvre|d[eé]couvert|encuentra|encontr[oó]|descubre|descubri[oó]|findet|fand|entdeckt)\b/.test(normalized)) {
      return { eventType: "", reason: "discovery-cue-not-supported" };
    }
    if (type === "speaks" && (
      /\b(?:prov[oò]|riprov[oò]|try|tried|tries|tent[oò]|tentava)\b.{0,80}\b(?:parlare|speak|talk)\b.{0,100}\b(?:nulla|silenzio|nothing|silence)\b/.test(normalized) ||
      /\b(?:non\s+(?:pu[oò]|poteva|potendo|riesce|riusciva|riusc[iì])\s+(?:a\s+)?parlare|cannot\s+speak|could\s+not\s+speak|unable\s+to\s+speak)\b/.test(normalized)
    )) {
      return { eventType: "cannot_speak", reason: "normalized-failed-speech" };
    }
    return { eventType: type, reason: "" };
  };

  const knowledgeEventExtractionMode = (config = {}) => {
    const mode = String(config.eventMode || config.extractionMode || config.mode || "llm").toLowerCase().trim();
    if (mode === "ai") return "llm";
    return ["rules", "llm", "hybrid"].includes(mode) ? mode : "rules";
  };

  const callKnowledgeEventAi = async ({ chunks = [], dictionaryEntries = [], config = {} } = {}) => {
    const mode = knowledgeEventExtractionMode(config);
    if (!["llm", "hybrid"].includes(mode) || !chunks.length) return { events: [], provider: "", model: "", error: "", promptMode: "" };
    const provider = await pickAiProvider({ ...config, enrichmentMode: "ai" });
    if (!provider) return { events: [], provider: "", model: "", error: "provider-not-found", promptMode: "" };
    const providerType = String(provider.provider || provider.providerType || config.providerType || config.provider || "").toLowerCase();
    const requestedModel = String(config.model || provider.model || (providerType === "ollama" ? "llama3.1" : "local-model")).trim();
    const model = providerType === "ollama"
      ? requestedModel
      : await resolveOpenAiCompatibleModel({ provider, model: requestedModel });
    const promptBudget = knowledgePromptBudget({
      config,
      providerType,
      provider,
      chunksLength: chunks.length,
      defaultChunkLimit: chunks.length || 8,
      defaultChunkChars: 1600,
    });
    const allowedTypes = [...knowledgeEventTypes];
    const systemPrompt = knowledgeAiTextConfig(
      config.systemPrompt,
      "You are a Knowledge Event Builder. Extract ordered, evidence-backed narrative and semantic events from local document chunks while preserving temporal order and causal roles."
    );
    const promptTemplate = knowledgeAiTextConfig(
      config.promptTemplate,
      "Use only provided chunks and dictionary terms. Extract explicit actions, state changes, causality, preparation, transformation, speech, failed attempts and outcomes as separate ordered events with source-language labels."
    );
    const outputInstructions = knowledgeAiTextConfig(
      config.outputInstructions,
      "Return strict JSON with events and rejectedCandidates. Every accepted event must include eventType, subject, objects, confidence, evidence.chunkId, exact evidence.quote and explanation. Do not infer facts outside evidence."
    );
    const promptFor = ({ mode: promptMode = "full", sourceChunks = chunks } = {}) => {
      const compact = promptMode === "compact";
      const micro = promptMode === "micro";
      const chunkPass = promptMode === "chunk";
      const chunkLimit = chunkPass ? 1 : micro ? 1 : compact ? Math.min(2, promptBudget.chunkLimit, sourceChunks.length) : Math.min(promptBudget.chunkLimit, sourceChunks.length);
      const chunkTokens = chunkPass ? Math.min(225, promptBudget.maxChunkTokens) : micro ? Math.min(175, promptBudget.maxChunkTokens) : compact ? Math.min(250, promptBudget.maxChunkTokens) : promptBudget.maxChunkTokens;
      const termLimit = micro ? 12 : compact ? 24 : 60;
      const eventLimit = Number.isFinite(Number(config.maxEvents)) && Number(config.maxEvents) > 0
        ? Math.floor(Number(config.maxEvents))
        : undefined;
      const schema = {
        events: [{
          eventType: "fills",
          subject: "character or empty",
          objects: ["object"],
          confidence: 0.0,
          evidence: { chunkId: "chunk id", quote: "exact quote copied from chunk" },
          explanation: "short reason",
        }],
        rejectedCandidates: [],
      };
      return [
        systemPrompt,
        promptTemplate,
        outputInstructions,
        "Return ONLY one valid JSON object. The first character must be { and the last character must be }.",
        "Do not wrap JSON in markdown. Do not add prose before or after JSON.",
        "If there are no valid events, return {\"events\":[],\"rejectedCandidates\":[]}.",
        "Use only facts explicitly supported by the text. Do not infer outside the quote.",
        "Every event MUST include evidence.quote copied verbatim from exactly one chunk.",
        "Split compound sentences into separate ordered events when they contain separate actions.",
        "Use speaks only for successful speech/output. Failed attempts or silence are cannot_speak.",
        "Use has_property only when the quote explicitly states a property, power or ability.",
        "Keep subjects and objects in the source text language when possible.",
        "Prefer events that explain causality, preparation, action, transformation, healing, speech, asking/giving/receiving and conflict.",
        `Allowed eventType values: ${allowedTypes.join(", ")}`,
        Number.isFinite(eventLimit) ? `Limits: events <= ${eventLimit}.` : "",
        chunkPass ? "For this chunk pass, extract only from the single supplied chunk." : "",
        "Schema:",
        JSON.stringify(schema),
        JSON.stringify({
          dictionaryTerms: dictionaryEntries.slice(0, termLimit).map((entry) => ({
            term: entry.term,
            type: entry.typeCandidates?.[0]?.type || "term",
            tier: entry.tier || "",
          })),
          chunks: sourceChunks.slice(0, chunkLimit).map((chunk) => ({
            id: chunk.id,
            ordinal: chunk.ordinal ?? chunk.index ?? chunk.start ?? 0,
            text: trimTextToEstimatedTokens(chunk.text || "", chunkTokens),
          })),
        }),
      ].join("\n\n");
    };
    try {
      const endpoint = String(provider.endpoint || (providerType === "ollama" ? "http://127.0.0.1:11434" : "http://127.0.0.1:1234")).replace(/\/+$/g, "");
      const url = providerType === "ollama"
        ? `${endpoint}/api/generate`
        : `${endpoint.endsWith("/v1") ? endpoint : `${endpoint}/v1`}/chat/completions`;
      let lastError = "";
      let totalUsage = {};
      let lastModel = model;
      const salvageEventObjectsFromText = (text = "") => {
        const rawText = String(text || "");
        if (!rawText.trim()) return [];
        const events = [];
        const objectLikeMatches = rawText.match(/\{[\s\S]{0,2400}?\}/g) || [];
        const sources = objectLikeMatches.length ? objectLikeMatches : rawText.split(/\n(?=\s*(?:[-*]|\d+[.)]|eventType\b|type\b))/i);
        const valueFor = (source = "", keys = []) => {
          for (const key of keys) {
            const doubleQuoted = source.match(new RegExp(`["']?${key}["']?\\s*[:=]\\s*["“”]([^"“”\\n]{1,700})["“”]`, "i"));
            if (doubleQuoted?.[1]) return doubleQuoted[1];
            const singleQuoted = source.match(new RegExp(`["']?${key}["']?\\s*[:=]\\s*'([^'\\n]{1,700})'`, "i"));
            if (singleQuoted?.[1]) return singleQuoted[1];
            const bare = source.match(new RegExp(`\\b${key}\\b\\s*[:=]\\s*([^,;\\n]{1,180})`, "i"));
            if (bare?.[1]) return bare[1];
          }
          return "";
        };
        const arrayFor = (source = "", keys = []) => {
          for (const key of keys) {
            const bracket = source.match(new RegExp(`["']?${key}["']?\\s*[:=]\\s*\\[([^\\]]{0,500})\\]`, "i"));
            if (bracket?.[1]) {
              return bracket[1]
                .split(/[,;|]/g)
                .map((item) => item.replace(/^["'\s]+|["'\s]+$/g, "").trim())
                .filter(Boolean);
            }
          }
          return [];
        };
        for (const source of sources) {
          const eventType = valueFor(source, ["eventType", "type"]);
          if (!normalizeKnowledgeEventType(eventType)) continue;
          const quote = valueFor(source, ["quote", "evidence", "evidenceQuote"]);
          if (!quote || normalizeKnowledgeText(quote).length < 24) continue;
          const confidence = Number(valueFor(source, ["confidence", "score"])) || 0.72;
          events.push({
            eventType,
            subject: valueFor(source, ["subject", "actor", "agent"]),
            objects: arrayFor(source, ["objects", "object", "targets", "target"]),
            confidence,
            evidence: {
              chunkId: valueFor(source, ["chunkId"]),
              quote,
            },
            explanation: valueFor(source, ["explanation", "reason"]),
          });
        }
        return events;
      };
      const repairEventJson = async ({ text = "", promptMode = "" } = {}) => {
        const rawText = String(text || "").trim();
        if (!rawText) return null;
        const repairPrompt = [
          "Convert the following model output into one strict JSON object for event extraction.",
          "Return ONLY JSON. No markdown, no prose.",
          "Schema: {\"events\":[{\"eventType\":\"\",\"subject\":\"\",\"objects\":[],\"confidence\":0.0,\"evidence\":{\"chunkId\":\"\",\"quote\":\"\"},\"explanation\":\"\"}],\"rejectedCandidates\":[]}",
          "Keep only items already present in the model output. Do not invent new events, subjects, objects or quotes.",
          "Input:",
          rawText,
        ].join("\n\n");
        const repairMaxTokens = knowledgeCompletionLimit({ config, providerType, provider, requested: 700, min: 1 });
        const repairBody = providerType === "ollama"
          ? { model, prompt: repairPrompt, stream: false, format: "json", options: { temperature: 0.01, top_p: 0.9, num_predict: repairMaxTokens } }
          : withJsonObjectResponseFormat({ model, messages: [{ role: "user", content: repairPrompt }], temperature: 0.01, max_tokens: repairMaxTokens, top_p: 0.9 }, providerType, config);
        let repairResponse = await postChatJson({ url, body: repairBody, headers: headersForProvider(provider, config) });
        let repairErrorText = repairResponse.ok ? "" : await chatErrorText(repairResponse);
        if (!repairResponse.ok && providerType !== "ollama" && /json|format/i.test(repairErrorText)) {
          const fallbackBody = { ...repairBody };
          delete fallbackBody.response_format;
          repairResponse = await postChatJson({ url, body: fallbackBody, headers: headersForProvider(provider, config) });
          repairErrorText = repairResponse.ok ? "" : await chatErrorText(repairResponse);
        }
        if (!repairResponse.ok) {
          lastError = `repair-http-${repairResponse.status}${repairErrorText ? `: ${repairErrorText}` : ""}`;
          return null;
        }
        const repairData = await repairResponse.json();
        const repairText = repairData.response || repairData.choices?.[0]?.message?.content || repairData.output_text || "";
        totalUsage = addKnowledgeAiUsage(totalUsage, knowledgeAiUsageFromResponse({ data: repairData, prompt: repairPrompt, text: repairText }));
        lastModel = repairData.model || lastModel;
        const repaired = parseAiJsonObject(repairText);
        return Array.isArray(repaired?.events) ? { ...repaired, promptMode: `${promptMode}-repair` } : null;
      };
      const eventProposalHasValidCandidate = (events = [], sourceChunks = chunks) =>
        (events || []).some((item) => {
          const quote = String(item?.evidence?.quote || item?.quote || "").replace(/\s+/g, " ").trim();
          if (normalizeKnowledgeText(quote).length < 24) return false;
          if (!normalizeAiKnowledgeEventTypeForEvidence(item?.eventType || item?.type || "", quote).eventType) return false;
          const chunk = sourceChunks.find((candidateChunk) => quote && evidenceQuoteInChunk(candidateChunk, quote)) ||
            chunks.find((candidateChunk) => quote && evidenceQuoteInChunk(candidateChunk, quote));
          return Boolean(chunk && knowledgeEventQuoteHasCleanBoundary(chunk, quote));
        });
      const runEventPromptAttempt = async ({ promptMode = "full", sourceChunks = chunks } = {}) => {
        const prompt = promptFor({ mode: promptMode, sourceChunks });
        const completionMaxTokens = knowledgeCompletionLimit({ config, providerType, provider, requested: 900, min: 1 });
        const body = providerType === "ollama"
          ? {
            model,
            prompt,
            stream: false,
            options: {
              temperature: knowledgeAiNumberConfig(config.temperature, 0.05),
              top_p: knowledgeAiNumberConfig(config.topP, 0.9),
              num_predict: completionMaxTokens,
            },
          }
          : withJsonObjectResponseFormat({
            model,
            messages: [{ role: "user", content: prompt }],
            temperature: knowledgeAiNumberConfig(config.temperature, 0.05),
            max_tokens: completionMaxTokens,
            top_p: knowledgeAiNumberConfig(config.topP, 0.9),
          }, providerType, config);
        const eventPromptChunkLimit = promptMode === "chunk" ? 1 : promptMode === "micro" ? 1 : promptMode === "compact" ? Math.min(2, sourceChunks.length) : sourceChunks.length;
        knowledgeLlmDebug("event-builder:request", {
          mode,
          promptMode,
          provider: provider.id || providerType || "",
          providerType,
          model,
          sourceChunkCount: sourceChunks.length,
          sentChunkCount: eventPromptChunkLimit,
          sourceChunkIds: sourceChunks.slice(0, eventPromptChunkLimit).map((chunk) => chunk.id || ""),
          promptChars: prompt.length,
          maxTokens: body.max_tokens || body.options?.num_predict || 0,
          promptPreview: compactDebugText(prompt),
        });
        let response = await postChatJson({ url, body, headers: headersForProvider(provider, config) });
        let errorText = response.ok ? "" : await chatErrorText(response);
        if (!response.ok && providerType !== "ollama" && /json|format/i.test(errorText)) {
          const fallbackBody = { ...body };
          delete fallbackBody.response_format;
          response = await postChatJson({ url, body: fallbackBody, headers: headersForProvider(provider, config) });
          errorText = response.ok ? "" : await chatErrorText(response);
        }
        if (!response.ok) {
          lastError = `HTTP ${response.status}${errorText ? `: ${errorText}` : ""}`;
          return { events: [], rejectedCandidates: [], error: lastError, retryable: response.status === 400 || /context|token|too large|size|json|format/i.test(errorText), promptMode };
        }
        const data = await response.json();
        const text = data.response || data.choices?.[0]?.message?.content || data.output_text || "";
        const usage = knowledgeAiUsageFromResponse({ data, prompt, text });
        totalUsage = addKnowledgeAiUsage(totalUsage, usage);
        lastModel = data.model || lastModel;
        const proposal = parseAiJsonObject(text);
        if (Array.isArray(proposal?.events)) {
          if (!eventProposalHasValidCandidate(proposal.events, sourceChunks)) {
            lastError = "empty-accepted-ai-events";
            return { events: [], rejectedCandidates: Array.isArray(proposal.rejectedCandidates) ? proposal.rejectedCandidates : [], error: lastError, retryable: mode === "llm", promptMode };
          }
          return {
            events: proposal.events,
            rejectedCandidates: Array.isArray(proposal.rejectedCandidates) ? proposal.rejectedCandidates : [],
            provider: provider.id || providerType || "provider",
            model: lastModel,
            usage: totalUsage,
            error: "",
            promptMode,
          };
        }
        const salvagedEvents = salvageEventObjectsFromText(text);
        if (salvagedEvents.length) {
          if (!eventProposalHasValidCandidate(salvagedEvents, sourceChunks)) {
            lastError = "empty-accepted-ai-events";
            return { events: [], rejectedCandidates: [], error: lastError, retryable: mode === "llm", promptMode: `${promptMode}-salvage` };
          }
          return {
            events: salvagedEvents,
            rejectedCandidates: [],
            provider: provider.id || providerType || "provider",
            model: lastModel,
            usage: totalUsage,
            error: "",
            promptMode: `${promptMode}-salvage`,
          };
        }
        lastError = "invalid-ai-json";
        if (mode === "hybrid") return { events: [], rejectedCandidates: [], error: lastError, retryable: false, promptMode };
        const repaired = await repairEventJson({ text, promptMode });
        if (repaired) {
          return {
            events: repaired.events,
            rejectedCandidates: Array.isArray(repaired.rejectedCandidates) ? repaired.rejectedCandidates : [],
            provider: provider.id || providerType || "provider",
            model: lastModel,
            usage: totalUsage,
            error: "",
            promptMode: repaired.promptMode,
          };
        }
        return { events: [], rejectedCandidates: [], error: lastError, retryable: true, promptMode };
      };
      const llmEvents = [];
      const llmRejectedCandidates = [];
      const llmPromptModes = [];
      const maxAcceptedEvents = Number.isFinite(Number(config.maxEvents)) && Number(config.maxEvents) > 0
        ? Math.floor(Number(config.maxEvents))
        : Number.POSITIVE_INFINITY;
      for (const promptMode of (mode === "hybrid" ? ["full"] : ["full", "compact", "micro"])) {
        const attempt = await runEventPromptAttempt({ promptMode });
        if (Array.isArray(attempt.rejectedCandidates)) llmRejectedCandidates.push(...attempt.rejectedCandidates);
        if (Array.isArray(attempt.events) && attempt.events.length) {
          llmEvents.push(...attempt.events);
          llmPromptModes.push(attempt.promptMode || promptMode);
        }
        if (attempt.error && !attempt.retryable && mode !== "hybrid") break;
      }
      const chunkEvents = [];
      const chunkRejectedCandidates = [];
      const chunkPromptModes = [];
      const chunkPassLimit = Math.min(chunks.length, Math.max(1, Number(config.maxChunks || chunks.length || 1)));
      const shouldRunChunkPass = mode === "llm" || (mode === "hybrid" && llmEvents.length < Math.max(1, Math.min(8, Number(config.minHybridAiEvents || 4))));
      for (const chunk of (shouldRunChunkPass ? chunks.slice(0, chunkPassLimit) : [])) {
        const attempt = await runEventPromptAttempt({ promptMode: "chunk", sourceChunks: [chunk] });
        if (Array.isArray(attempt.events) && attempt.events.length) {
          chunkEvents.push(...attempt.events);
          chunkPromptModes.push(attempt.promptMode || "chunk");
        }
        if (Array.isArray(attempt.rejectedCandidates)) chunkRejectedCandidates.push(...attempt.rejectedCandidates);
        if (llmEvents.length + chunkEvents.length >= maxAcceptedEvents) break;
      }
      const combinedEvents = [...llmEvents, ...chunkEvents];
      const combinedRejectedCandidates = [...llmRejectedCandidates, ...chunkRejectedCandidates];
      const combinedPromptModes = unique([...llmPromptModes, ...chunkPromptModes]);
      if (combinedEvents.length) {
        return {
          events: combinedEvents.slice(0, maxAcceptedEvents),
          rejectedCandidates: combinedRejectedCandidates,
          provider: provider.id || providerType || "provider",
          model: lastModel,
          usage: totalUsage,
          error: "",
          promptMode: combinedPromptModes.join("+") || "chunk",
        };
      }
      return { events: [], rejectedCandidates: [], provider: provider.id || providerType || "provider", model: lastModel, usage: totalUsage, error: lastError || "empty-ai-events", promptMode: "" };
    } catch (error) {
      return { events: [], rejectedCandidates: [], provider: provider.id || providerType || "provider", model, usage: {}, error: error?.message || "ai-error", promptMode: "" };
    }
  };

  const buildKnowledgeEvents = async ({ workspaceId, node, payload = {}, event, config = {} } = {}) => {
    const payloadChunks = Array.isArray(payload?.chunks) ? payload.chunks.filter(Boolean) : [];
    const documentId = payload?.documentId || payload?.id || config.documentId || payloadChunks[0]?.documentId || "";
    const allChunks = payloadChunks.length
      ? payloadChunks
      : byWorkspace(await listStore(STORES.chunks), workspaceId)
        .filter((chunk) => (!documentId || chunk.documentId === documentId));
    const collectionId = config.collectionId || payload?.collectionId || payload?.metadata?.collectionId || allChunks[0]?.metadata?.collectionId || "";
    const chunkOrder = (chunk = {}) => {
      const ordinal = Number(chunk.ordinal);
      if (Number.isFinite(ordinal)) return ordinal;
      const index = Number(chunk.index);
      if (Number.isFinite(index)) return index;
      const start = Number(chunk.start);
      if (Number.isFinite(start)) return start / 100000;
      return 0;
    };
    const scopedChunks = allChunks
      .filter((chunk) => !documentId || chunk.documentId === documentId)
      .filter((chunk) => !collectionId || chunk.metadata?.collectionId === collectionId || payloadChunks.length)
      .sort((left, right) => chunkOrder(left) - chunkOrder(right) || Date.parse(left.createdAt || "") - Date.parse(right.createdAt || ""));
    if (!scopedChunks.length) throw new Error("Chunk Knowledge non trovati per Knowledge Event Builder");
    const selectedDocumentId = documentId || scopedChunks[0]?.documentId || "";
    const dictionaryEntries = byWorkspace(await listStore(STORES.dictionary), workspaceId)
      .filter((entry) => !selectedDocumentId || entry.documentId === selectedDocumentId)
      .filter((entry) => !collectionId || entry.collectionId === collectionId);
    const replaceExisting = config.replaceExisting !== false;
    if (replaceExisting && selectedDocumentId) await deleteKnowledgeEvents({ workspaceId, documentId: selectedDocumentId });
    const maxEvents = Number.isFinite(Number(config.maxEvents)) && Number(config.maxEvents) > 0
      ? Math.floor(Number(config.maxEvents))
      : Number.POSITIVE_INFINITY;
    const minConfidence = Math.max(0, Math.min(1, Number(config.confidenceThreshold ?? 0.55)));
    const now = nowIso();
    const chunkById = new Map(scopedChunks.map((chunk) => [chunk.id, chunk]));
    const effectiveConfig = agentToolsBoundedKnowledgeConfig(node, config);
    const extractionMode = knowledgeEventExtractionMode(effectiveConfig);
    const wantsAi = ["llm", "hybrid"].includes(extractionMode);
    const wantsRules = extractionMode !== "llm";
    const ruleCandidates = [];
    let previousContext = { subject: "", participants: [] };
    if (wantsRules) {
      for (const chunk of scopedChunks) {
        const sentences = narrativeSentenceSplit(chunk.text || "");
        for (let sentenceIndex = 0; sentenceIndex < sentences.length && ruleCandidates.length < maxEvents; sentenceIndex += 1) {
          const sentence = sentences[sentenceIndex];
          const eventType = inferNarrativeEventType(sentence, effectiveConfig);
          if (!eventType) continue;
          const objects = inferNarrativeEventObjects(sentence, dictionaryEntries, effectiveConfig);
          const eventSpecs = buildNarrativeEventSpecs(sentence, eventType, objects, effectiveConfig);
          for (const spec of eventSpecs) {
            if (ruleCandidates.length >= maxEvents) break;
            const subjectInfo = inferNarrativeEventSubjectResolution(sentence, dictionaryEntries, spec.eventType, previousContext, effectiveConfig);
            const subject = subjectInfo.subject || "";
            const confidence = narrativeEventImportance(spec.eventType, spec.objects, sentence, effectiveConfig);
            if (confidence < minConfidence) continue;
            const offsets = knowledgeEventQuoteOffsets(chunk, sentence);
            const modality = knowledgeEventModalityForEvidence(sentence);
            const polarity = knowledgeEventPolarityForEvidence(sentence, spec.eventType);
            ruleCandidates.push({
              chunk,
              chunkId: chunk.id || "",
              chunkIndex: chunkOrder(chunk),
              sentenceIndex,
              eventType: spec.eventType,
              subject,
              objects: spec.objects,
              participants: subjectInfo.participants || [],
              subjectResolution: subjectInfo.subjectResolution,
              roles: knowledgeEventRolesFor({ eventType: spec.eventType, subject, objects: spec.objects, participants: subjectInfo.participants || [], contextObjects: objects }),
              polarity,
              modality,
              aspect: knowledgeEventAspectForEvidence(sentence, modality),
              confidence,
              evidence: {
                text: sentence,
                quote: offsets.quote,
                startOffset: offsets.startOffset,
                endOffset: offsets.endOffset,
              },
              source: {
                method: "rule-event-builder",
                providerId: "",
                model: "",
                promptMode: "",
                promptVersion: "knowledge-event-v1",
              },
              explanation: "",
            });
            const mentionedParticipants = narrativeMentionedParticipants(sentence, dictionaryEntries);
            const candidateParticipants = unique([
              ...normalizeKnowledgeEventActorList(subjectInfo.participants || []),
              ...normalizeKnowledgeEventActorList(subject),
              ...mentionedParticipants,
              ...spec.objects.filter((item) => isNarrativeParticipantMention(item, dictionaryEntries)),
            ].filter((item) => item && !isKnowledgePronounMention(item)));
            previousContext = {
              subject: subject && !isKnowledgePronounMention(subject) ? normalizeKnowledgeEventSubject(subject) : previousContext.subject || "",
              participants: candidateParticipants,
              recentParticipants: unique([
                ...candidateParticipants,
                ...normalizeKnowledgeEventActorList(previousContext.recentParticipants || []),
                ...normalizeKnowledgeEventActorList(previousContext.participants || []),
              ].filter((item) => item && !isKnowledgePronounMention(item))),
            };
          }
        }
      }
    }
    const aiResult = wantsAi
      ? await callKnowledgeEventAi({ chunks: scopedChunks, dictionaryEntries, config: effectiveConfig })
      : { events: [], rejectedCandidates: [], provider: "", model: "", error: "", promptMode: "" };
    if (wantsAi && aiResult.usage?.totalTokens) {
      await persistKnowledgeNodeTokenUsage({ node, usage: aiResult.usage, provider: aiResult.provider, model: aiResult.model });
    }
    const rejectedCandidates = Array.isArray(aiResult.rejectedCandidates) ? [...aiResult.rejectedCandidates] : [];
    const aiCandidates = [];
    if (wantsAi) {
      for (const item of (aiResult.events || []).slice(0, maxEvents * 2)) {
        const quote = String(item?.evidence?.quote || item?.quote || "").replace(/\s+/g, " ").trim();
        if (normalizeKnowledgeText(quote).length < 24) {
          rejectedCandidates.push({ label: item?.eventType || item?.type || "", reason: "event-evidence-too-short", quote });
          continue;
        }
        const normalizedAiEvent = normalizeAiKnowledgeEventTypeForEvidence(item?.eventType || item?.type || "", quote);
        const eventType = normalizedAiEvent.eventType;
        if (!eventType) {
          rejectedCandidates.push({ label: item?.eventType || "", reason: normalizedAiEvent.reason || "event-type-not-allowed", quote });
          continue;
        }
        const chunk = chunkById.get(item?.evidence?.chunkId || item?.chunkId || "") ||
          scopedChunks.find((candidateChunk) => quote && evidenceQuoteInChunk(candidateChunk, quote));
        if (!chunk || !evidenceQuoteInChunk(chunk, quote)) {
          rejectedCandidates.push({ label: eventType, reason: "missing-event-evidence", quote });
          continue;
        }
        if (!knowledgeEventQuoteHasCleanBoundary(chunk, quote)) {
          rejectedCandidates.push({ label: eventType, reason: "event-evidence-boundary-cut", quote });
          continue;
        }
        const confidence = Math.min(0.98, Number(item.confidence || 0));
        if (confidence < minConfidence) continue;
        const objects = normalizeKnowledgeEventObjects(item.objects || item.object || item.target || []);
        const rawSubject = normalizeKnowledgeEventSubject(item.subject || item.actor || "");
        const aiSubjectInfo = rawSubject && !isKnowledgePronounMention(rawSubject)
          ? {
            subject: rawSubject,
            participants: normalizeKnowledgeEventActorList(rawSubject),
            subjectResolution: narrativeSubjectResolution({ subject: rawSubject, method: "explicit", confidence: 0.76, sentence: quote, sourceMention: rawSubject, participants: normalizeKnowledgeEventActorList(rawSubject) }),
          }
          : inferNarrativeEventSubjectResolution(quote, dictionaryEntries, eventType, { subject: "", participants: [] });
        const subject = normalizeKnowledgeEventSubject(aiSubjectInfo.subject || "");
        const offsets = knowledgeEventQuoteOffsets(chunk, quote);
        const modality = knowledgeEventModalityForEvidence(quote);
        const polarity = knowledgeEventPolarityForEvidence(quote, eventType);
        aiCandidates.push({
          chunk,
          chunkId: chunk.id || "",
          chunkIndex: chunkOrder(chunk),
          sentenceIndex: Math.max(0, Number(item.sentenceIndex || 0)),
          eventType,
          subject,
          objects,
          participants: aiSubjectInfo.participants || [],
          subjectResolution: aiSubjectInfo.subjectResolution,
          roles: knowledgeEventRolesFor({ eventType, subject, objects, participants: aiSubjectInfo.participants || [], contextObjects: objects }),
          polarity,
          modality,
          aspect: knowledgeEventAspectForEvidence(quote, modality),
          confidence,
          evidence: {
            text: quote,
            quote: offsets.quote,
            startOffset: offsets.startOffset,
            endOffset: offsets.endOffset,
          },
          source: {
            method: "ai-event-builder",
            providerId: aiResult.provider || "",
            model: aiResult.model || "",
            promptMode: aiResult.promptMode || "",
            promptVersion: "knowledge-event-ai-v1",
          },
          explanation: String(item.explanation || normalizedAiEvent.reason || ""),
        });
      }
    }
    const minHybridAiEvents = Math.max(3, Math.min(maxEvents, Number(config.minHybridAiEvents || Math.max(12, scopedChunks.length))));
    const aiEventsUsable = hybridAiCountUsable({
      count: aiCandidates.length,
      min: minHybridAiEvents,
      promptMode: aiResult.promptMode || "",
    });
    const useRuleFallback = extractionMode === "rules" ||
      (extractionMode === "hybrid" && !aiEventsUsable);
    const candidateSource = extractionMode === "llm"
      ? aiCandidates
      : extractionMode === "hybrid"
        ? [...aiCandidates, ...ruleCandidates]
        : ruleCandidates;
    const seen = new Set();
    const selectedCandidates = candidateSource
      .sort((left, right) =>
        Number(left.chunkIndex || 0) - Number(right.chunkIndex || 0) ||
        Number(left.evidence?.startOffset ?? 999999) - Number(right.evidence?.startOffset ?? 999999) ||
        (left.source?.method === "ai-event-builder" ? -1 : 1)
      )
      .filter((candidate) => {
        const key = knowledgeEventCandidateKey(candidate);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, maxEvents);
    const records = [];
    let sequence = 0;
    for (const candidate of selectedCandidates) {
      sequence += 1;
      const chunk = candidate.chunk || chunkById.get(candidate.chunkId || "") || scopedChunks[0] || {};
      const eventType = normalizeKnowledgeEventType(candidate.eventType);
      const objects = normalizeKnowledgeEventObjects(candidate.objects);
      const subject = normalizeKnowledgeEventSubject(candidate.subject || "");
      const participants = unique([
        ...normalizeKnowledgeEventActorList(candidate.participants || []),
        ...normalizeKnowledgeEventActorList(subject),
        ...objects,
      ].filter((item) => item && !isKnowledgePronounMention(item)));
      const subjectResolution = candidate.subjectResolution || narrativeSubjectResolution({
        subject,
        method: subject ? "explicit" : "unresolved",
        confidence: subject ? 0.6 : 0,
        sentence: candidate.evidence?.quote || candidate.evidence?.text || "",
        sourceMention: subject,
        participants: subject ? [subject] : [],
      });
      const roles = candidate.roles || knowledgeEventRolesFor({ eventType, subject, objects, participants, contextObjects: candidate.contextObjects || objects });
      const modality = candidate.modality || knowledgeEventModalityForEvidence(candidate.evidence?.quote || candidate.evidence?.text || "");
      const polarity = candidate.polarity || knowledgeEventPolarityForEvidence(candidate.evidence?.quote || candidate.evidence?.text || "", eventType);
      const record = {
        id: `kevent_${safeId(workspaceId)}_${safeId(selectedDocumentId || "doc")}_${String(sequence).padStart(4, "0")}_${safeId(eventType)}`,
        workspaceId,
        collectionId,
        documentId: chunk.documentId || selectedDocumentId,
        chunkId: chunk.id || "",
        sequence,
        chunkIndex: candidate.chunkIndex ?? chunkOrder(chunk),
        sentenceIndex: Number(candidate.sentenceIndex || 0),
        eventType,
        subject,
        action: eventType,
        objects,
        participants,
        roles,
        subjectResolution,
        polarity,
        modality,
        aspect: candidate.aspect || knowledgeEventAspectForEvidence(candidate.evidence?.quote || candidate.evidence?.text || "", modality),
        confidence: Math.max(minConfidence, Math.min(0.98, Number(candidate.confidence || minConfidence))),
        evidence: candidate.evidence,
        links: {
          previousEventId: records[records.length - 1]?.id || "",
          nextEventId: "",
          causes: [],
          enables: [],
        },
        source: {
          method: candidate.source?.method || "rule-event-builder",
          providerId: candidate.source?.providerId || "",
          model: candidate.source?.model || "",
          promptMode: candidate.source?.promptMode || "",
          nodeId: node?.id || "",
          inputChannel: event?.channel || "",
          promptVersion: candidate.source?.promptVersion || "knowledge-event-v1",
        },
        metadata: {
          ...(chunk.metadata || {}),
          language: chunk.metadata?.language || detectLanguage(chunk.text || "", config.language || ""),
          dictionaryEntryIds: dictionaryEntries
            .filter((entry) => [subject, ...objects, ...participants].some((term) => normalizeEntityToken(term) === normalizeEntityToken(entry.term || entry.lemma || "")))
            .map((entry) => entry.id)
            .slice(0, 12),
          explanation: candidate.explanation || "",
        },
        status: "ready",
        createdAt: now,
        updatedAt: now,
      };
      if (records.length) records[records.length - 1].links.nextEventId = record.id;
      records.push(await putRecord(STORES.events, record));
    }
      const highValueEventTypes = new Set(["finds", "fills", "immerses", "transforms", "takes", "drinks", "heals", "speaks", "cannot_speak", "seeks", "has_property"]);
      const previewSelection = unique([
        ...records.map((entry) => entry.id),
        ...records.filter((entry) => highValueEventTypes.has(entry.eventType) && Number(entry.confidence || 0) >= 0.72).map((entry) => entry.id),
      ])
        .map((id) => records.find((entry) => entry.id === id))
        .filter(Boolean)
        .sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
    const context = records.length
      ? [
        `Knowledge Events: ${records.length} ordered event(s)`,
        ...previewSelection.map((entry) =>
          `[EV${entry.sequence}] ${entry.subject || "event"} -${entry.eventType}-> ${entry.objects.join(", ") || "context"} evidence="${String(entry.evidence?.quote || "")}"`
        ),
      ].join("\n")
      : "Knowledge Events: none";
    const outputEvents = previewSelection.map((entry) => ({
      id: entry.id,
      sequence: entry.sequence,
      eventType: entry.eventType,
      subject: entry.subject,
      objects: entry.objects,
      participants: entry.participants,
      roles: entry.roles,
      subjectResolution: entry.subjectResolution,
      polarity: entry.polarity,
      modality: entry.modality,
      aspect: entry.aspect,
      confidence: entry.confidence,
      evidence: entry.evidence,
      source: entry.source,
    }));
    return {
      id: uniqueId("kevent_batch"),
      workspaceId,
      collectionId,
      documentId: selectedDocumentId,
      eventCount: records.length,
      events: outputEvents,
      eventIds: records.map((entry) => entry.id),
      eventIdsTruncated: false,
      extractionMode,
      provider: aiResult.provider || "",
      model: aiResult.model || "",
      error: aiResult.error || "",
      proposed: {
        aiEventCount: aiCandidates.length,
        ruleEventCount: ruleCandidates.length,
        minHybridEvents: minHybridAiEvents,
        promptMode: aiResult.promptMode || "",
        ruleFallback: useRuleFallback,
        hybridMerged: extractionMode === "hybrid",
        ruleCompletionCount: extractionMode === "hybrid" || extractionMode === "rules" ? ruleCandidates.length : 0,
        fallbackReason: useRuleFallback && extractionMode === "hybrid" ? "sparse-ai-event-output" : "",
        rejectedCandidates,
      },
      context,
      status: extractionMode === "hybrid" && aiCandidates.length > 0 && useRuleFallback
        ? "partial-ai-merged"
        : useRuleFallback
          ? "fallback"
          : "ready",
      createdAt: now,
    };
  };

  const inferEntityType = (value = "", source = "") => {
    const clean = String(value || "").trim();
    const normalized = normalizeEntityToken(clean);
    if (/^https?:\/\//i.test(clean)) return "url";
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return "email";
    if (source === "declared-name") return "proper-noun";
    if (/^[A-ZÀ-Ý0-9][A-ZÀ-Ý0-9'’_-]*(?:\s+[A-ZÀ-Ý0-9][A-ZÀ-Ý0-9'’_-]*)+$/.test(clean) && /[A-ZÀ-Ý]/.test(clean)) return "quote";
    if (/^[A-Z0-9]{2,8}$/.test(clean) && /[A-Z]/.test(clean)) return "symbol";
    if (/\b(api|runtime|indexeddb|ollama|studio|openai|rag|json|php|javascript)\b/i.test(clean)) return "technology";
    if (semanticLocationEntityTokens.has(normalized)) return "location";
    if (semanticConceptEntityTokens.has(normalized)) return "concept";
    if (semanticObjectEntityTokens.has(normalized)) return "object";
    if (semanticRoleEntityTokens.has(normalized)) return "term";
    if (/^[A-ZÀ-Ý][A-Za-zÀ-ÿ'’-]+(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'’-]+){0,3}$/.test(clean)) return "proper-noun";
    return "term";
  };

  const escapedRegExp = (value = "") =>
    String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const inferConservativeRelationType = (source = {}, target = {}, fallback = "co_occurs") => {
    const types = new Set([source.entityType || "term", target.entityType || "term"]);
    const sourceRelationType = inferSourceRelationType(source, target);
    if (sourceRelationType) return sourceRelationType;
    if (types.has("proper-noun") && types.has("location")) return "appears_in";
    if (types.has("location") && (types.has("object") || types.has("creature"))) return "contains";
    if (types.has("location") && types.has("concept")) return "context_for";
    if (types.has("object") && types.has("concept")) return "associated_with";
    return fallback;
  };

  const relationContextBetween = (text = "", left = {}, right = {}, radius = 180) => {
    const leftPositions = entityLabelPositions(text, left.label);
    const rightPositions = entityLabelPositions(text, right.label);
    if (!leftPositions.length || !rightPositions.length) return "";
    let best = null;
    leftPositions.forEach((leftPosition) => {
      rightPositions.forEach((rightPosition) => {
        const distance = Math.abs(leftPosition - rightPosition);
        if (!best || distance < best.distance) best = { leftPosition, rightPosition, distance };
      });
    });
    if (!best) return "";
    const start = Math.max(0, Math.min(best.leftPosition, best.rightPosition) - radius);
    const end = Math.min(String(text || "").length, Math.max(best.leftPosition, best.rightPosition) + radius);
    return String(text || "").slice(start, end).toLowerCase();
  };

  const entityNearPattern = (context = "", label = "", patterns = [], radius = 90) => {
    const cleanLabel = normalizeEntityToken(label);
    const cleanContext = normalizeEntityToken(context);
    if (!cleanLabel || !cleanContext) return false;
    const index = cleanContext.indexOf(cleanLabel);
    if (index < 0) return false;
    const start = Math.max(0, index - radius);
    const end = Math.min(cleanContext.length, index + cleanLabel.length + radius);
    const windowText = cleanContext.slice(start, end);
    return patterns.some((pattern) => pattern.test(windowText));
  };

  const orientRelationPair = (left = {}, right = {}, relationType = "co_occurs") => {
    const withType = (type = "") => [left, right].find((entity) => entity.entityType === type) || null;
    const sourceFor = (sourceType = "", targetType = "") => {
      const source = withType(sourceType);
      const target = withType(targetType);
      return source && target ? { source, target } : { source: left, target: right };
    };
    if (relationType === "references") return { source: left, target: right };
    if (relationType === "mentions") {
      const source = [left, right].find((entity) => isSourceEntity(entity));
      const target = [left, right].find((entity) => !isSourceEntity(entity));
      return source && target ? { source, target } : { source: left, target: right };
    }
    if (["appears_in", "interacts_with", "expresses", "encounters", "says", "uses", "heals", "confronts", "helps", "travels_to", "reveals", "fulfills", "foreshadows", "establishes", "teaches", "opposes", "has_property"].includes(relationType)) {
      const targetType = {
        appears_in: "location",
        interacts_with: "object",
        expresses: "concept",
        encounters: "creature",
        says: "quote",
        uses: "object",
        heals: withType("proper-noun") && withType("object") ? "proper-noun" : "object",
        confronts: "creature",
        helps: "proper-noun",
        travels_to: "location",
        reveals: withType("concept") ? "concept" : "quote",
        fulfills: withType("concept") ? "concept" : "proper-noun",
        foreshadows: withType("concept") ? "concept" : "proper-noun",
        establishes: withType("concept") ? "concept" : "proper-noun",
        teaches: withType("concept") ? "concept" : "proper-noun",
        opposes: withType("concept") ? "concept" : "proper-noun",
        has_property: "concept",
      }[relationType];
      if (relationType === "helps") {
        const [first, second] = [left, right].filter((entity) => entity.entityType === "proper-noun");
        return first && second ? { source: first, target: second } : { source: left, target: right };
      }
      if (relationType === "heals" && withType("object") && withType("proper-noun")) return sourceFor("object", "proper-noun");
      return sourceFor("proper-noun", targetType);
    }
    if (["contains", "context_for"].includes(relationType)) {
      if (relationType === "contains") {
        const container = [left, right].find((entity) =>
          /\b(?:contenitore|container|vessel|recipient)\b/i.test(String(entity.label || ""))
        );
        const contained = container ? [left, right].find((entity) => entity.id !== container.id) : null;
        if (container && contained) return { source: container, target: contained };
      }
      const targetType = relationType === "context_for"
        ? "concept"
        : (withType("creature") ? "creature" : "object");
      return sourceFor("location", targetType);
    }
    if (relationType === "associated_with") return sourceFor("object", "concept");
    if (relationType === "represents") return sourceFor(withType("object") ? "object" : "concept", withType("proper-noun") ? "proper-noun" : "concept");
    if (relationType === "transforms") return sourceFor("object", "object");
    if (relationType === "marks") return sourceFor("symbol", "location");
    if (relationType === "part_of") return sourceFor("symbol", "quote");
    return { source: left, target: right };
  };

  const normalizeRelationPair = (source = {}, target = {}, relationType = "co_occurs") => {
    const symmetricTypes = new Set(["co_occurs", "associated_with", "interacts_with"]);
    if (!symmetricTypes.has(relationType)) return { source, target };
    return String(source.id || "") <= String(target.id || "")
      ? { source, target }
      : { source: target, target: source };
  };

  const entityLabelPositions = (text = "", label = "") => {
    const cleanLabel = String(label || "").trim();
    if (!cleanLabel) return [];
    const escaped = escapedRegExp(cleanLabel);
    const regex = new RegExp(`(^|[^\\p{L}\\p{N}_])(${escaped})(?=$|[^\\p{L}\\p{N}_])`, "giu");
    const positions = [];
    for (const match of String(text || "").matchAll(regex)) {
      positions.push((match.index || 0) + String(match[1] || "").length);
    }
    return positions;
  };

  const inferContextualEntityType = (label = "", entityType = "", text = "") => {
    const fallback = entityType || inferEntityType(label);
    if (!["proper-noun", "term", "concept"].includes(String(fallback || "").toLowerCase())) return fallback;
    const normalizedLabel = normalizeEntityToken(label);
    if (!normalizedLabel || normalizedLabel.length < 3) return fallback;
    const normalizedText = normalizeEntityToken(text);
    const escapedLabel = escapedRegExp(normalizedLabel);
    const positions = [...normalizedText.matchAll(new RegExp(`\\b${escapedLabel}\\b`, "g"))].map((match) => match.index || 0);
    if (!positions.length) return fallback;
    const sourceNearLabel = positions.some((labelIndex) => {
      const context = normalizedText.slice(Math.max(0, labelIndex - 90), labelIndex + normalizedLabel.length + 90);
      return (
        new RegExp(`\\b${sourceEntityCueToken}(?:\\s+(?:di|de|del|della|of|to|a|ai|al|the|le|la|el|der|die|das)){0,3}\\s+${escapedLabel}\\b`).test(context) ||
        new RegExp(`\\b${escapedLabel}(?:\\s+(?:e|è|is|es|est|ist|as|come|como|comme|als|un|una|a|the|il|la|lo)){0,5}\\s+${sourceEntityCueToken}\\b`).test(context) ||
        new RegExp(`\\b(?:in|nel|nella|nei|nelle|en|dans|in dem|im)\\s+(?:il|la|lo|le|the|el|der|die|das)?\\s*${escapedLabel}\\b`).test(context) && sourceEntityCuePattern.test(normalizedText)
      );
    });
    return sourceNearLabel ? "source" : fallback;
  };

  const entityRelationDistance = (text = "", left = {}, right = {}) => {
    const leftPositions = entityLabelPositions(text, left.label);
    const rightPositions = entityLabelPositions(text, right.label);
    if (!leftPositions.length || !rightPositions.length) return Number.POSITIVE_INFINITY;
    let best = Number.POSITIVE_INFINITY;
    leftPositions.forEach((leftPosition) => {
      rightPositions.forEach((rightPosition) => {
        best = Math.min(best, Math.abs(leftPosition - rightPosition));
      });
    });
    return best;
  };

  const relationTypeAllowedForDictionaryPass = (relationType = "", source = {}, target = {}, hasNarrative = false) => {
    if (hasNarrative) return true;
    if (["appears_in", "contains", "context_for", "associated_with", "mentions", "references"].includes(relationType)) return true;
    if (relationType === "co_occurs") {
      const types = new Set([source.entityType || "term", target.entityType || "term"]);
      return types.has("proper-noun") && !types.has("concept") && !types.has("object");
    }
    return false;
  };

  const entityOccurrenceCount = (text = "", label = "") => {
    const cleanLabel = String(label || "").trim();
    if (!cleanLabel) return 0;
    const escaped = escapedRegExp(cleanLabel);
    const matches = String(text || "").match(new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, "giu"));
    return matches?.length || 0;
  };

  const entityExtractionMode = (config = {}) => {
    const mode = String(config.extractionMode || config.mode || "strict").trim().toLowerCase();
    return ["strict", "balanced", "wide"].includes(mode) ? mode : "strict";
  };

  const entityAiMode = (config = {}) => {
    const mode = String(config.entityMode || config.aiMode || "").trim().toLowerCase();
    if (["rules", "llm", "hybrid"].includes(mode)) return mode;
    const legacy = String(config.extractionMode || "").trim().toLowerCase();
    if (["rules", "llm", "hybrid"].includes(legacy)) return legacy;
    return "llm";
  };

  const entityQuoteSupported = (quote = "", chunks = []) => {
    const cleanQuote = String(quote || "").replace(/\s+/g, " ").trim();
    if (!cleanQuote) return null;
    return chunks.find((chunk) => String(chunk?.text || "").replace(/\s+/g, " ").includes(cleanQuote)) || null;
  };

  const normalizeAiEntityCandidate = (item = {}, chunks = [], config = {}) => {
    const label = String(item.label || item.term || item.name || "").replace(/\s+/g, " ").trim();
    if (!label || label.length < 2 || label.length > 96) return null;
    if (/^(?:entity label|label|term|concept|object|location|source|target|proper noun|proper-noun|role|creature|symbol|technology)$/i.test(label)) return null;
    const quote = String(item.evidence?.quote || item.quote || item.evidenceQuote || "").replace(/\s+/g, " ").trim();
    const quoteChunk = entityQuoteSupported(quote, chunks);
    const termChunk = quoteChunk || chunks.find((chunk) =>
      entityLabelPositions(String(chunk?.text || ""), label).length ||
      normalizeEntityToken(chunk?.text || "").includes(normalizeEntityToken(label))
    );
    if (!termChunk) return null;
    const languageConfig = { ...config, text: termChunk.text || "", language: detectLanguage(termChunk.text || "", config.language || "") };
    const cleanLabel = cleanEntityPhrase(label, languageConfig);
    if (!cleanLabel || isWeakEntityLabelForLanguage(cleanLabel, "ai-entity", languageConfig, termChunk.text || "")) return null;
    if (isEntityStopWord(cleanLabel, languageConfig)) return null;
    const localType = inferContextualEntityType(cleanLabel, inferEntityType(cleanLabel), termChunk.text || "");
    const aiType = normalizeAiDictionaryType(item.type || item.entityType || item.kind || localType);
    const entityType = localType && localType !== "term" ? localType : aiType;
    const confidence = Math.max(0.45, Math.min(0.98, Number(item.confidence || 0.74)));
    const aliases = unique([...(Array.isArray(item.aliases) ? item.aliases : [])]
      .map((alias) => String(alias || "").replace(/\s+/g, " ").trim())
      .filter((alias) => alias.length >= 2 && alias.length <= 96 && alias !== cleanLabel));
    return canonicalEntityCandidate({
      label: cleanLabel,
      source: "ai-entity",
      confidence,
      entityType,
      aliases,
      ai: {
        chunkId: termChunk.id || "",
        evidence: quoteChunk && quote ? {
          text: quote,
          quote,
          startOffset: String(termChunk.text || "").indexOf(quote),
          endOffset: String(termChunk.text || "").indexOf(quote) >= 0 ? String(termChunk.text || "").indexOf(quote) + quote.length : null,
        } : dictionaryEvidenceFor(termChunk.text || "", cleanLabel),
        explanation: String(item.explanation || ""),
        proposedType: aiType,
      },
    }, languageConfig);
  };

  const normalizeAiRelationType = (value = "") => {
    const raw = String(value || "related_to").toLowerCase().trim().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "related_to";
    if (/(?:contiene|contenere|contains?|contained|include|includes?|inside|part_of)/.test(raw)) return "contains";
    if (/(?:instruct|instruction|instructed|instructs|istru|indicat|indica|indicated|advice|advise|consigl)/.test(raw)) return "teaches";
    if (/(?:reveal|revealed|reveals|rivela|rivel|secret|segreto|told_secret|tell_secret|indicat|warn|avvert|spieg|explain)/.test(raw)) return "reveals";
    if (/(?:ask|asks|asked|request|requested|preg|chied|domand|question|information_from)/.test(raw)) return "asks_for";
    if (/(?:tell|told|says|said|speak|speaks|spoke|spoke_to|dice|disse|raccont|communicat|comunic|parl)/.test(raw)) return "says";
    if (/(?:teach|teaches|taught|insegna|apprend)/.test(raw)) return "teaches";
    if (/(?:receiving_care|care_from|cared_for|bend|bandag|ferite|wound_care)/.test(raw)) return "helps";
    if (/(?:help|helps|helped|aiut|assist)/.test(raw)) return "helps";
    if (/(?:interact|interacted|interaction|interacted_with|interag)/.test(raw)) return "interacts_with";
    if (/(?:action_on|performed_action_on)/.test(raw)) return "interacts_with";
    if (/(?:protect|protects|protected|salva|difend|defend)/.test(raw)) return "protects";
    if (/(?:oppose|opposes|opposed|against|contro|nemic|enemy)/.test(raw)) return "opposes";
    if (/(?:attack|attacks|attacked|attacc|hurt|hurts|ferisc|ferit|threat|threatens|minacc)/.test(raw)) return "confronts";
    if (/(?:cerca_cura|seek_cure|seeks_cure|search_cure|look_for_cure|looking_for_cure)/.test(raw)) return "tries_to_help";
    if (/(?:^|_)(?:heal|heals|healed|healing|cure|cures|cured|curare|cura|curato|guarire|guarito|guarisce)(?:_|$)/.test(raw)) return "healed_by";
    if (/(?:guard|guarda|guardò|look|looks|looked|watch|watches|watched|observe|observes|observed)/.test(raw)) return "co_occurs";
    if (/(?:give|gives|gave|donat|consegn)/.test(raw)) return "gives_to";
    if (/(?:receive|receives|received|ricev)/.test(raw)) return "receives_from";
    if (/(?:performed_action_with|action_with|used_in_action)/.test(raw)) return "uses";
    if (/(?:use|uses|used|utilizz|usa)/.test(raw)) return "uses";
    if (/(?:host|hosts|hosted|hosts_object|containerized|containerized_in|immersed_in|immerse|immersed|immergere|sumerg)/.test(raw)) return "contains";
    if (/(?:transform|transforms|transformed|transforms_into|became|turned_into|diventa|divenne|trasform)/.test(raw)) return "transforms";
    if (/(?:emanate|emanates|emanates_feature|emits|emana|diffonde)/.test(raw)) return "has_property";
    if (/(?:similar|similar_to|like|simile)/.test(raw)) return "associated_with";
    if (/(?:has_knowledge_of|knowledge_of|knows_of|aware_of|recall|recalls|remember|remembers|ricorda|ricord)/.test(raw)) return "references";
    if (/(?:^|_)(?:lead|leads|led|guide|guides|path|route|road|strada|sentiero|porta)(?:_|$)/.test(raw)) return "leads_to";
    if (/(?:live|lives|lived|abit|vive)/.test(raw)) return "lives_in";
    if (/(?:location|located|where|place|luogo|posto|found_at|is_found_at)/.test(raw)) return "appears_in";
    if (/(?:discover|discovers|discovered|scopr)/.test(raw)) return "discovers";
    if (/(?:friend|amico|amica)/.test(raw)) return "friend_of";
    if (/(?:attribute|property|name|has_name|has_attribute)/.test(raw)) return "has_property";
    return raw;
  };

  const entityAiRelationVocabulary = [
    "appears_in", "associated_with", "asks_for", "causes", "co_occurs", "confronts", "contains",
    "discovers", "expresses", "friend_of", "gives_to", "has_property", "healed_by", "helps",
    "interacts_with", "leads_to", "lives_in", "mentions", "opposes", "protects", "receives_from",
    "references", "represents", "says", "teaches", "transforms", "travels_to", "tries_to_help",
    "uses",
  ];

  const normalizeAiRelationCandidate = (item = {}, chunks = []) => {
    const sourceLabel = String(item.source || item.sourceLabel || item.from || "").replace(/\s+/g, " ").trim();
    const targetLabel = String(item.target || item.targetLabel || item.to || "").replace(/\s+/g, " ").trim();
    if (!sourceLabel || !targetLabel || normalizeEntityToken(sourceLabel) === normalizeEntityToken(targetLabel)) return null;
    const quote = String(item.evidence?.quote || item.quote || item.evidenceQuote || "").replace(/\s+/g, " ").trim();
    const quoteChunk = entityQuoteSupported(quote, chunks);
    const termChunk = quoteChunk || chunks.find((chunk) => {
      const text = normalizeEntityToken(chunk?.text || "");
      return text.includes(normalizeEntityToken(sourceLabel)) && text.includes(normalizeEntityToken(targetLabel));
    });
    if (!termChunk) return null;
    const rawRelationType = String(item.relationType || item.type || "related_to").toLowerCase().trim().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "related_to";
    const relationType = normalizeAiRelationType(rawRelationType);
    if (!entityAiRelationVocabulary.includes(relationType)) return null;
    return {
      sourceLabel,
      targetLabel,
      relationType,
      rawRelationType,
      confidence: Math.max(0.45, Math.min(0.98, Number(item.confidence || 0.7))),
      chunkId: termChunk.id || "",
      evidence: quoteChunk && quote ? {
        text: quote,
        quote,
        startOffset: String(termChunk.text || "").indexOf(quote),
        endOffset: String(termChunk.text || "").indexOf(quote) >= 0 ? String(termChunk.text || "").indexOf(quote) + quote.length : null,
      } : dictionaryEvidenceFor(termChunk.text || "", sourceLabel),
      explanation: String(item.explanation || ""),
    };
  };

  const callEntityExtractionAi = async ({ chunks = [], dictionaryEntries = [], config = {} } = {}) => {
    const mode = entityAiMode(config);
    if (!["llm", "hybrid"].includes(mode)) return { entities: [], relations: [], provider: "", model: "", usage: {}, error: "", promptMode: "" };
    const hasExplicitProvider = Boolean(config.providerProfile || config.profileId || config.providerType || config.provider || config.model);
    const providerConfig = hasExplicitProvider ? config : { ...config, providerType: "lm-studio" };
    const provider = await pickAiProvider({ ...providerConfig, enrichmentMode: "ai" });
    if (!provider) return { entities: [], relations: [], provider: "", model: "", usage: {}, error: "provider-not-found", promptMode: "" };
    const providerType = String(provider.provider || provider.providerType || providerConfig.providerType || providerConfig.provider || "").toLowerCase();
    const requestedModel = String(providerConfig.model || provider.model || (providerType === "ollama" ? "llama3.1" : "local-model")).trim();
    const model = providerType === "ollama"
      ? requestedModel
      : await resolveOpenAiCompatibleModel({ provider, model: requestedModel });
    const maxEntities = Number.isFinite(Number(config.maxEntities)) && Number(config.maxEntities) > 0
      ? Math.floor(Number(config.maxEntities))
      : Number.POSITIVE_INFINITY;
    const maxRelations = Number.isFinite(Number(config.maxRelations)) && Number(config.maxRelations) > 0
      ? Math.floor(Number(config.maxRelations))
      : Number.POSITIVE_INFINITY;
    const promptBudget = knowledgePromptBudget({ config, providerType, provider, chunksLength: chunks.length, defaultChunkLimit: chunks.length || 8, defaultChunkChars: 1600 });
    const configuredChunkLimit = promptBudget.chunkLimit;
    const configuredMaxChunkTokens = promptBudget.maxChunkTokens;
    const localProvider = isLmStudioProvider(providerType, provider) || providerType === "ollama";
    const chunkPassLimit = Math.max(
      configuredChunkLimit,
      Math.min(
        chunks.length,
        Math.max(1, Number(
          config.maxChunkPasses ||
          config.llmChunkPasses ||
          config.chunkPassLimit ||
          config.maxLlmChunks ||
          config.maxChunks ||
          chunks.length
        ))
      )
    );
    const systemPrompt = knowledgeAiTextConfig(config.systemPrompt, "You are a Knowledge Entity Extractor. Extract only evidence-backed entities and explicit relations from local chunks, preserving source-language labels and narrative context.");
    const promptTemplate = knowledgeAiTextConfig(config.promptTemplate, "Use supplied chunks and dictionary terms to propose precise entities and directly supported relations. Keep entities stable, avoid weak fragments, and do not collapse later consequences into earlier causes.");
    const outputInstructions = knowledgeAiTextConfig(
      config.outputInstructions,
      `Return strict JSON with entities and relations. relationType must be one of allowedRelationTypes exactly; do not invent relation names. Every accepted entity/relation must include confidence, explanation and an exact evidence.quote copied from a supplied chunk. Omit unsupported candidates.`
    );
    try {
      const endpoint = String(provider.endpoint || (providerType === "ollama" ? "http://127.0.0.1:11434" : "http://127.0.0.1:1234")).replace(/\/+$/g, "");
      const url = providerType === "ollama"
        ? `${endpoint}/api/generate`
        : `${endpoint.endsWith("/v1") ? endpoint : `${endpoint}/v1`}/chat/completions`;
      const promptFor = ({ promptMode = "full", sourceChunks = chunks } = {}) => {
        const compact = promptMode === "compact";
        const micro = promptMode === "micro";
        const chunkPass = promptMode === "chunk";
        const chunkLimit = chunkPass ? Math.min(1, sourceChunks.length) : micro ? Math.min(2, configuredChunkLimit) : compact ? Math.min(4, configuredChunkLimit) : configuredChunkLimit;
        const maxChunkTokens = chunkPass ? Math.min(350, configuredMaxChunkTokens) : micro ? Math.min(225, configuredMaxChunkTokens) : compact ? Math.min(300, configuredMaxChunkTokens) : configuredMaxChunkTokens;
        const promptMaxEntities = Number.isFinite(maxEntities) ? maxEntities : undefined;
        const promptMaxRelations = micro ? 0 : Number.isFinite(maxRelations) ? maxRelations : undefined;
        const schema = micro
          ? { entities: [{ label: "entity label", entityType: "proper-noun|role|location|object|concept|creature|source|symbol|technology|term", aliases: [], confidence: 0.0, evidence: { quote: "exact quote" }, explanation: "" }], relations: [] }
          : {
            entities: [{ label: "entity label", entityType: "proper-noun|role|location|object|concept|creature|source|symbol|technology|term", aliases: [], confidence: 0.0, evidence: { chunkId: "chunk id", quote: "exact quote" }, explanation: "" }],
            relations: [{ source: "entity label", relationType: "precise_relation_type", target: "entity label", confidence: 0.0, evidence: { chunkId: "chunk id", quote: "exact quote" }, explanation: "" }],
          };
        return [
          systemPrompt,
          promptTemplate,
          outputInstructions,
          "Return ONLY one valid JSON object. The first character must be { and the last character must be }.",
          "Do not wrap JSON in markdown. Do not add prose before or after JSON.",
          "Do not invent labels or relations. Every evidence.quote must be copied exactly from one supplied chunk.",
          "For every relation, source and target must be concrete labels, not entity types or placeholders. Never use target labels such as concept, creature, object, location, entity, person or thing unless that exact word is the evidence-backed label.",
          "Every relation endpoint must also appear in entities in the same JSON response. If the target is a property, state, object or abstract idea, add it as a concept/object entity with its exact source-language label.",
          "When no maxRelations is supplied, extract every explicit evidence-backed relation in the supplied chunks instead of only the top examples.",
          "If there are no valid entities or relations, return {\"entities\":[],\"relations\":[]}.",
          micro ? "For this micro pass, return only the most important entities and keep relations empty." : "",
          chunkPass ? "For this chunk pass, extract only from the single supplied chunk and prefer explicit relations between labels in that chunk." : "",
          JSON.stringify({
            schema,
            ...(Number.isFinite(promptMaxEntities) ? { maxEntities: promptMaxEntities } : {}),
            ...(Number.isFinite(promptMaxRelations) ? { maxRelations: promptMaxRelations } : {}),
            allowedRelationTypes: entityAiRelationVocabulary,
            dictionaryTerms: dictionaryEntries.slice(0, micro ? 20 : chunkPass ? 30 : 60).map((entry) => ({ term: entry.term, type: entry.typeCandidates?.[0]?.type || "", aliases: entry.aliases || [] })),
            chunks: sourceChunks.slice(0, chunkLimit).map((chunk, index) => ({ id: chunk.id || `chunk_${index + 1}`, ordinal: chunk.ordinal ?? chunk.index ?? index, text: trimTextToEstimatedTokens(chunk.text || "", maxChunkTokens) })),
          }),
        ].join("\n\n");
      };
      let lastError = "";
      let lastModel = model;
      let totalUsage = {};
      const validatedPatch = (patch = {}) => {
        const entityMap = new Map();
        const addEntity = (candidate = null) => {
          if (!candidate?.label) return;
          const key = normalizeEntityToken(candidate.label);
          if (!key) return;
          const existing = entityMap.get(key);
          if (!existing || Number(candidate.confidence || 0) > Number(existing.confidence || 0)) {
            entityMap.set(key, candidate);
          }
        };
        (Array.isArray(patch?.entities) ? patch.entities : [])
          .map((item) => normalizeAiEntityCandidate(item, chunks, config))
          .filter(Boolean)
          .forEach(addEntity);
        const relations = (Array.isArray(patch?.relations) ? patch.relations : [])
          .map((item) => normalizeAiRelationCandidate(item, chunks))
          .filter(Boolean)
          .slice(0, maxRelations);
        relations.forEach((relation) => {
          [
            { label: relation.sourceLabel, role: "source" },
            { label: relation.targetLabel, role: "target" },
          ].forEach(({ label, role }) => {
            addEntity(normalizeAiEntityCandidate({
              label,
              entityType: inferEntityType(label),
              confidence: Math.max(0.5, Number(relation.confidence || 0.7) - 0.04),
              evidence: relation.evidence,
              explanation: `Endpoint ${role} from accepted LLM relation ${relation.relationType}.`,
            }, chunks, config));
          });
        });
        const entities = [...entityMap.values()].slice(0, maxEntities);
        return { entities, relations };
      };
      const repairEntityJson = async ({ text = "", promptMode = "" } = {}) => {
        const rawText = String(text || "").trim();
        if (!rawText) return null;
        const repairPrompt = [
          "Convert the following model output into one strict JSON object for entity extraction.",
          "Return ONLY JSON. No markdown, no prose.",
          "Schema: {\"entities\":[{\"label\":\"\",\"entityType\":\"proper-noun|role|location|object|concept|creature|source|symbol|technology|term\",\"aliases\":[],\"confidence\":0.0,\"evidence\":{\"quote\":\"\"},\"explanation\":\"\"}],\"relations\":[{\"source\":\"\",\"relationType\":\"\",\"target\":\"\",\"confidence\":0.0,\"evidence\":{\"quote\":\"\"},\"explanation\":\"\"}]}",
          `Allowed relationType values: ${entityAiRelationVocabulary.join(", ")}.`,
          "If a relation does not fit one allowed relationType, omit it.",
          "Keep only items already present in the model output. Do not invent new labels, quotes or relations.",
          "Input:",
          rawText,
        ].join("\n\n");
        const repairMaxTokens = knowledgeCompletionLimit({ config, providerType, provider, requested: 700, min: 1 });
        const repairBody = providerType === "ollama"
          ? { model, prompt: repairPrompt, stream: false, format: "json", options: { temperature: 0.01, top_p: 0.9, num_predict: repairMaxTokens } }
          : withJsonObjectResponseFormat({ model, messages: [{ role: "user", content: repairPrompt }], temperature: 0.01, max_tokens: repairMaxTokens, top_p: 0.9 }, providerType, config);
        let repairResponse = await postChatJson({ url, body: repairBody, headers: headersForProvider(provider, config) });
        let repairErrorText = repairResponse.ok ? "" : await chatErrorText(repairResponse);
        if (!repairResponse.ok && providerType !== "ollama" && /json|format/i.test(repairErrorText)) {
          const fallbackBody = { ...repairBody };
          delete fallbackBody.response_format;
          repairResponse = await postChatJson({ url, body: fallbackBody, headers: headersForProvider(provider, config) });
          repairErrorText = repairResponse.ok ? "" : await chatErrorText(repairResponse);
        }
        if (!repairResponse.ok) {
          lastError = `repair-http-${repairResponse.status}${repairErrorText ? `: ${repairErrorText}` : ""}`;
          return null;
        }
        const repairData = await repairResponse.json();
        const repairText = repairData.response || repairData.choices?.[0]?.message?.content || repairData.output_text || "";
        totalUsage = addKnowledgeAiUsage(totalUsage, knowledgeAiUsageFromResponse({ data: repairData, prompt: repairPrompt, text: repairText }));
        lastModel = repairData.model || lastModel;
        const repairPatch = parseAiJsonObject(repairText);
        if (!repairPatch) return null;
        const validated = validatedPatch(repairPatch);
        if (!validated.entities.length && !validated.relations.length) return null;
        return { ...validated, promptMode: `${promptMode}-repair` };
      };
      const salvageEntityExtractionJson = (text = "") => {
        const source = String(text || "");
        const readArrayObjects = (key = "") => {
          const keyIndex = source.search(new RegExp(`"${key}"\\s*:\\s*\\[`, "i"));
          if (keyIndex < 0) return [];
          const openIndex = source.indexOf("[", keyIndex);
          if (openIndex < 0) return [];
          const items = [];
          let objectStart = -1;
          let depth = 0;
          let inString = false;
          let escaped = false;
          for (let index = openIndex + 1; index < source.length; index += 1) {
            const char = source[index];
            if (escaped) {
              escaped = false;
              continue;
            }
            if (char === "\\") {
              escaped = true;
              continue;
            }
            if (char === "\"") {
              inString = !inString;
              continue;
            }
            if (inString) continue;
            if (char === "{") {
              if (depth === 0) objectStart = index;
              depth += 1;
              continue;
            }
            if (char === "}") {
              depth -= 1;
              if (depth === 0 && objectStart >= 0) {
                const rawObject = source.slice(objectStart, index + 1)
                  .replace(/[“”]/g, "\"")
                  .replace(/[‘’]/g, "'")
                  .replace(/,\s*([}\]])/g, "$1");
                try {
                  items.push(JSON.parse(rawObject));
                } catch {}
                objectStart = -1;
              }
              continue;
            }
            if (char === "]" && depth === 0) break;
          }
          return items;
        };
        const patch = {
          entities: readArrayObjects("entities"),
          relations: readArrayObjects("relations"),
        };
        return patch.entities.length || patch.relations.length ? patch : null;
      };
      const runPromptAttempt = async ({ promptMode = "full", sourceChunks = chunks } = {}) => {
        const micro = promptMode === "micro";
        const prompt = promptFor({ promptMode, sourceChunks });
        const entityPromptChunkLimit = promptMode === "chunk" ? Math.min(1, sourceChunks.length) : micro ? Math.min(2, configuredChunkLimit) : promptMode === "compact" ? Math.min(4, configuredChunkLimit) : configuredChunkLimit;
        const completionMaxTokens = knowledgeCompletionLimit({ config, providerType, provider, requested: 1100, min: 1 });
        const completionDebug = knowledgeCompletionDebug({ config, providerType, provider, requested: 1100, min: 1 });
        const body = providerType === "ollama"
          ? { model, prompt, stream: false, format: "json", options: { temperature: knowledgeAiNumberConfig(config.temperature, 0.05), top_p: knowledgeAiNumberConfig(config.topP, 0.9), num_predict: completionMaxTokens } }
          : withJsonObjectResponseFormat({ model, messages: [{ role: "user", content: prompt }], temperature: knowledgeAiNumberConfig(config.temperature, 0.05), max_tokens: completionMaxTokens, top_p: knowledgeAiNumberConfig(config.topP, 0.9) }, providerType, config);
        const requestDebug = knowledgeLlmDebug("entity-extractor:request", {
          status: "working",
          mode,
          promptMode,
          provider: provider.id || providerType || "",
          providerType,
          model,
          sourceChunkCount: sourceChunks.length,
          sentChunkCount: entityPromptChunkLimit,
          sourceChunkIds: sourceChunks.slice(0, entityPromptChunkLimit).map((chunk) => chunk.id || ""),
          dictionaryTerms: dictionaryEntries.length,
          promptChars: prompt.length,
          configuredMaxTokens: knowledgeAiNumberConfig(config.maxTokens, 0),
          maxTokens: body.max_tokens || body.options?.num_predict || 0,
          completionDebug,
          prompt,
          sentChunks: sourceChunks.slice(0, entityPromptChunkLimit).map((chunk, index) => {
            const rawText = String(chunk.text || "");
            const sentText = trimTextToEstimatedTokens(rawText, promptMode === "chunk" ? Math.min(350, configuredMaxChunkTokens) : micro ? Math.min(225, configuredMaxChunkTokens) : promptMode === "compact" ? Math.min(300, configuredMaxChunkTokens) : configuredMaxChunkTokens);
            return {
              id: chunk.id || `chunk_${index + 1}`,
              ordinal: chunk.ordinal ?? chunk.index ?? index,
              rawTextChars: rawText.length,
              sentTextChars: sentText.length,
              sentText,
            };
          }),
        });
        let response = await postChatJson({ url, body, headers: headersForProvider(provider, config) });
        let errorText = response.ok ? "" : await chatErrorText(response);
        if (!response.ok && providerType !== "ollama" && /json|format/i.test(errorText)) {
          const fallbackBody = { ...body };
          delete fallbackBody.response_format;
          response = await postChatJson({ url, body: fallbackBody, headers: headersForProvider(provider, config) });
          errorText = response.ok ? "" : await chatErrorText(response);
        }
        if (!response.ok) {
          lastError = `HTTP ${response.status}${errorText ? `: ${errorText}` : ""}`;
          if (requestDebug) {
            Object.assign(requestDebug, {
              status: "error",
              completedAt: nowIso(),
              httpStatus: response.status,
              error: lastError,
              retryable: response.status === 400 || /context|token|too large|size|json|format/i.test(errorText),
            });
            flushKnowledgeRuntimeDebug(knowledgeRuntimeDebugStack[knowledgeRuntimeDebugStack.length - 1], { status: "working" });
          }
          return { entities: [], relations: [], error: lastError, retryable: response.status === 400 || /context|token|too large|size|json|format/i.test(errorText) };
        }
        const data = await response.json();
        const text = data.response || data.choices?.[0]?.message?.content || data.output_text || "";
        totalUsage = addKnowledgeAiUsage(totalUsage, knowledgeAiUsageFromResponse({ data, prompt, text }));
        lastModel = data.model || model;
        const patch = parseAiJsonObject(text);
        if (!patch) {
          lastError = "invalid-ai-json";
          const salvagedPatch = salvageEntityExtractionJson(text);
          if (salvagedPatch) {
            const salvaged = validatedPatch(salvagedPatch);
            if (salvaged.entities.length || salvaged.relations.length) {
              if (requestDebug) {
                Object.assign(requestDebug, {
                  status: "complete",
                  completedAt: nowIso(),
                  httpStatus: 200,
                  responseChars: String(text || "").length,
                  responseText: text,
                  jsonParsed: false,
                  salvaged: true,
                  parsedJson: salvagedPatch,
                  proposedEntityCount: salvagedPatch.entities.length,
                  proposedRelationCount: salvagedPatch.relations.length,
                  acceptedEntityCount: salvaged.entities.length,
                  acceptedRelationCount: salvaged.relations.length,
                });
                flushKnowledgeRuntimeDebug(knowledgeRuntimeDebugStack[knowledgeRuntimeDebugStack.length - 1], { status: "working" });
              }
              return { entities: salvaged.entities, relations: salvaged.relations, error: "", promptMode: `${promptMode}-salvaged` };
            }
          }
          const repaired = await repairEntityJson({ text, promptMode });
          if (repaired) {
            if (requestDebug) {
              Object.assign(requestDebug, {
                status: "complete",
                completedAt: nowIso(),
                httpStatus: 200,
                responseChars: String(text || "").length,
                responseText: text,
                jsonParsed: false,
                repaired: true,
                acceptedEntityCount: repaired.entities.length,
                acceptedRelationCount: repaired.relations.length,
              });
              flushKnowledgeRuntimeDebug(knowledgeRuntimeDebugStack[knowledgeRuntimeDebugStack.length - 1], { status: "working" });
            }
            return { entities: repaired.entities, relations: repaired.relations, error: "", promptMode: repaired.promptMode };
          }
          if (requestDebug) {
            Object.assign(requestDebug, {
              status: "warning",
              completedAt: nowIso(),
              httpStatus: 200,
              responseChars: String(text || "").length,
              responseText: text,
              jsonParsed: false,
              error: lastError,
              retryable: true,
            });
            flushKnowledgeRuntimeDebug(knowledgeRuntimeDebugStack[knowledgeRuntimeDebugStack.length - 1], { status: "working" });
          }
          return { entities: [], relations: [], error: lastError, retryable: true };
        }
        const { entities, relations } = validatedPatch(patch);
        if (!entities.length && !relations.length && !micro) {
          lastError = "no-valid-ai-entity-candidates";
          if (requestDebug) {
            Object.assign(requestDebug, {
              status: "warning",
              completedAt: nowIso(),
              httpStatus: 200,
              responseChars: String(text || "").length,
              responseText: text,
              jsonParsed: true,
              parsedJson: patch,
              proposedEntityCount: Array.isArray(patch?.entities) ? patch.entities.length : 0,
              proposedRelationCount: Array.isArray(patch?.relations) ? patch.relations.length : 0,
              acceptedEntityCount: 0,
              acceptedRelationCount: 0,
              error: lastError,
              retryable: true,
            });
            flushKnowledgeRuntimeDebug(knowledgeRuntimeDebugStack[knowledgeRuntimeDebugStack.length - 1], { status: "working" });
          }
          return { entities: [], relations: [], error: lastError, retryable: true };
        }
        if (requestDebug) {
          Object.assign(requestDebug, {
            status: "complete",
            completedAt: nowIso(),
            httpStatus: 200,
            responseChars: String(text || "").length,
            responseText: text,
            jsonParsed: true,
            parsedJson: patch,
            proposedEntityCount: Array.isArray(patch?.entities) ? patch.entities.length : 0,
            proposedRelationCount: Array.isArray(patch?.relations) ? patch.relations.length : 0,
            acceptedEntityCount: entities.length,
            acceptedRelationCount: relations.length,
            error: entities.length || relations.length ? "" : "no-valid-ai-entity-candidates",
          });
          flushKnowledgeRuntimeDebug(knowledgeRuntimeDebugStack[knowledgeRuntimeDebugStack.length - 1], { status: "working" });
        }
        return { entities, relations, error: entities.length || relations.length ? "" : "no-valid-ai-entity-candidates", promptMode };
      };
      let fallbackResult = null;
      const defaultMinGlobalEntityRelations = Math.max(2, Math.min(maxRelations || 2, Math.ceil(chunks.length * 1.5)));
      const defaultMinGlobalEntityCandidates = Math.max(3, Math.min(maxEntities, Math.ceil(chunks.length * 2)));
      const minGlobalEntityRelations = maxRelations <= 0
        ? 0
        : Math.max(1, Math.min(maxRelations, Number(config.minLlmEntityRelations || defaultMinGlobalEntityRelations)));
      const minGlobalEntityCandidates = Math.max(1, Math.min(maxEntities, Number(config.minLlmEntityCandidates || defaultMinGlobalEntityCandidates)));
      for (const promptMode of (mode === "hybrid" ? ["full"] : ["full", "compact", "micro"])) {
        const attempt = await runPromptAttempt({ promptMode });
        const attemptUsable = maxRelations === 0
          ? attempt.entities.length >= minGlobalEntityCandidates
          : attempt.relations.length >= minGlobalEntityRelations && attempt.entities.length >= Math.min(minGlobalEntityCandidates, maxEntities);
        if (attemptUsable && mode !== "llm") {
          return { entities: attempt.entities, relations: attempt.relations, provider: provider.id || providerType || "provider", model: lastModel, usage: totalUsage, error: "", promptMode: attempt.promptMode || promptMode };
        }
        if (attempt.entities.length || attempt.relations.length) fallbackResult = attempt;
        if (attemptUsable && mode === "llm") break;
        if (attempt.error && !attempt.retryable) break;
      }
      const chunkEntities = [];
      const chunkRelations = [];
      const chunkPromptModes = [];
      const globalEntities = fallbackResult?.entities || [];
      const globalRelations = fallbackResult?.relations || [];
      const shouldRunChunkPass = mode === "llm";
      for (const chunk of (shouldRunChunkPass ? chunks.slice(0, chunkPassLimit) : [])) {
        const attempt = await runPromptAttempt({ promptMode: "chunk", sourceChunks: [chunk] });
        if (attempt.entities.length || attempt.relations.length) {
          chunkEntities.push(...attempt.entities);
          chunkRelations.push(...attempt.relations);
          chunkPromptModes.push(attempt.promptMode || "chunk");
        }
      }
      const combinedEntities = [...globalEntities, ...chunkEntities];
      const combinedRelations = [...globalRelations, ...chunkRelations];
      if (combinedEntities.length || combinedRelations.length) {
        return {
          entities: combinedEntities.slice(0, maxEntities),
          relations: combinedRelations.slice(0, maxRelations),
          provider: provider.id || providerType || "provider",
          model: lastModel,
          usage: totalUsage,
          error: "",
          promptMode: unique([fallbackResult?.promptMode || "", ...chunkPromptModes]).join("+") || fallbackResult?.promptMode || "chunk",
        };
      }
      if (fallbackResult) {
        return { entities: fallbackResult.entities, relations: fallbackResult.relations, provider: provider.id || providerType || "provider", model: lastModel, usage: totalUsage, error: "", promptMode: fallbackResult.promptMode || "micro" };
      }
      return { entities: [], relations: [], provider: provider.id || providerType || "provider", model: lastModel, usage: totalUsage, error: lastError || "invalid-ai-json", promptMode: "" };
    } catch (error) {
      return { entities: [], relations: [], provider: provider.id || providerType || "provider", model, usage: {}, error: error?.message || "ai-error", promptMode: "" };
    }
  };

  const isEntityAllowedByMode = (candidate = {}, text = "", config = {}) => {
    if (["seed", "declared-name", "dictionary-seed"].includes(candidate.source) || String(candidate.source || "").startsWith("keyword-")) return true;
    if (["url", "email", "symbol", "quote", "technology", "location", "object", "creature", "concept", "source"].includes(candidate.entityType)) return true;
    const mode = entityExtractionMode(config);
    if (mode === "wide") return true;
    const label = String(candidate.label || "").trim();
    const words = label.split(/\s+/).filter(Boolean);
    const occurrences = entityOccurrenceCount(text, label);
    if (mode === "strict") {
      if (words.length >= 2) return candidate.confidence >= 0.78;
      return occurrences >= 2;
    }
    if (words.length >= 2) return true;
    return occurrences >= 2 || candidate.confidence >= 0.78;
  };

  const canonicalEntityCandidate = (candidate = {}, config = {}) => {
    const enabled = config.canonicalizeEntityAliases !== false && String(config.canonicalizeEntityAliases || "true").toLowerCase() !== "false";
    if (!enabled || ["seed", "declared-name"].includes(candidate.source)) return candidate;
    const label = String(candidate.label || "").replace(/\s+/g, " ").trim();
    return label === candidate.label ? candidate : { ...candidate, label };
  };

  const entityCandidatesFromText = (text = "", config = {}) => {
    const clean = String(text || "");
    const languageConfig = { ...config, text: clean, language: detectLanguage(clean, config.language || "") };
    const rules = customKnowledgeRules(config);
    const entityTermGroups = rules.entityTerms || rules.termsByType || {};
    const extraStopWords = new Set(customRuleValues(rules.stopWords, rules.blockTerms, rules.entityStopWords).map(normalizeEntityToken));
    const candidates = [];
    const push = (value = "", source = "pattern", confidence = 0.72, entityType = "") => {
      const rawLabel = String(value || "").replace(/\s+/g, " ").trim();
      const label = ["seed", "dictionary-seed"].includes(source) ? rawLabel : cleanEntityPhrase(rawLabel, languageConfig);
      if (label.length < 2 || label.length > 96) return;
      if (extraStopWords.has(normalizeEntityToken(label))) return;
      if (isWeakEntityLabelForLanguage(label, source, languageConfig, clean)) return;
      if (!["seed", "dictionary-seed"].includes(source) && isEntityStopWord(label, languageConfig)) return;
      const inferredType = entityType || inferEntityType(label, source);
      candidates.push({ label, source, confidence, entityType: inferContextualEntityType(label, inferredType, clean) });
    };
    (clean.match(/https?:\/\/[^\s)'"<>]+/gi) || []).forEach((value) => push(value, "url", 0.95));
    (clean.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).forEach((value) => push(value, "email", 0.95));
    (clean.match(/\b[A-Z][A-Z0-9_-]{1,12}\b/g) || []).forEach((value) => push(value, "symbol", 0.68));
    (clean.match(/\b[A-ZÀ-Ý0-9][A-ZÀ-Ý0-9'’_-]*(?:\s+[A-ZÀ-Ý0-9][A-ZÀ-Ý0-9'’_-]*){1,5}\b/g) || [])
      .forEach((value) => push(value, "quote", 0.78, "quote"));
    [
      /\b(?:mi\s+nombre\s+es|me\s+llamo|llamada|llamado|llaman)\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ'’-]{2,}(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'’-]{2,}){0,2})/giu,
      /\b(?:called|named|my\s+name\s+is)\s+([A-Z][A-Za-z'’-]{2,}(?:\s+[A-Z][A-Za-z'’-]{2,}){0,2})/giu,
      /\b(?:chiamata|chiamato|mi\s+chiamo|il\s+mio\s+nome\s+e)\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ'’-]{2,}(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'’-]{2,}){0,2})/giu,
      /\b(?:appelee|appele|je\s+m'appelle|mon\s+nom\s+est)\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ'’-]{2,}(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'’-]{2,}){0,2})/giu,
      /\b(?:genannt|namens|mein\s+name\s+ist|ich\s+heiße|ich\s+heisse)\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ'’-]{2,}(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'’-]{2,}){0,2})/giu,
    ].forEach((pattern) => {
      [...clean.matchAll(pattern)].forEach((match) => push(match[1], "declared-name", 0.88, "proper-noun"));
    });
    const pushCustomEntityTerms = (terms = [], entityType = "term") => {
      customRuleValues(terms).forEach((term) => {
        const cleanTerm = String(term || "").trim();
        if (!cleanTerm || !entityLabelPositions(clean, cleanTerm).length) return;
        push(cleanTerm, `custom-${entityType}`, Math.max(0.5, Math.min(0.98, Number(rules.confidence || 0.78))), entityType);
      });
    };
    pushCustomEntityTerms(entityTermGroups.location || rules.locationTerms, "location");
    pushCustomEntityTerms(entityTermGroups.object || rules.objectTerms, "object");
    pushCustomEntityTerms(entityTermGroups.creature || rules.creatureTerms, "creature");
    pushCustomEntityTerms(entityTermGroups.concept || rules.conceptTerms, "concept");
    pushCustomEntityTerms(entityTermGroups.role || rules.roleTerms, "role");
    pushCustomEntityTerms(entityTermGroups.source || rules.sourceTerms, "source");
    pushCustomEntityTerms(entityTermGroups.symbol || rules.symbolTerms, "symbol");
    pushCustomEntityTerms(entityTermGroups.technology || rules.technologyTerms, "technology");
    (clean.match(/\b[A-ZÀ-Ý][A-Za-zÀ-ÿ'’-]+(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'’-]+){0,3}\b/g) || [])
      .forEach((value) => push(value, "proper-noun", value.includes(" ") ? 0.82 : 0.64));
    customRuleValues(config.seedTerms || config.terms, rules.seedTerms, rules.seeds).forEach((value) => {
      if (value && clean.toLowerCase().includes(value.toLowerCase())) push(value, "seed", 0.9);
    });
    (config.dictionarySeedEntries || []).forEach((entry) => {
      const label = String(entry.term || entry.label || "").trim();
      if (!label || !clean.toLowerCase().includes(label.toLowerCase())) return;
      const type = String(entry.typeCandidates?.[0]?.type || entry.entityType || inferEntityType(label)).toLowerCase();
      const confidence = Math.max(0.72, Math.min(0.96, Number(entry.seedScore || entry.confidence || 0.78)));
      push(label, "dictionary-seed", confidence, type);
    });
    const allowedTypes = customRuleValues(config.entityTypes, rules.entityTypes, rules.allowedEntityTypes).map((value) => value.toLowerCase());
    const threshold = Math.max(0, Math.min(1, Number(config.confidenceThreshold ?? 0.6)));
    const seen = new Map();
    candidates
      .filter((candidate) => candidate.confidence >= threshold)
      .filter((candidate) => ["seed", "dictionary-seed"].includes(candidate.source) || !isEntityStopWord(candidate.label, languageConfig))
      .filter((candidate) => isEntityAllowedByMode(candidate, clean, languageConfig))
      .filter((candidate) => !allowedTypes.length || allowedTypes.includes(candidate.entityType.toLowerCase()))
      .map((candidate) => canonicalEntityCandidate(candidate, languageConfig))
      .forEach((candidate) => {
        const key = normalizeKnowledgeText(candidate.label);
        const previous = seen.get(key);
        if (!previous || candidate.confidence > previous.confidence) {
          seen.set(key, candidate);
          return;
        }
        if (candidate.aliases?.length) {
          previous.aliases = [...new Set([...(previous.aliases || []), ...candidate.aliases])];
        }
      });
    const deduped = [...seen.values()].filter((candidate) => {
      const key = normalizeKnowledgeText(candidate.label);
      if (key.length <= 3) {
        return ![...seen.keys()].some((otherKey) => otherKey !== key && otherKey.includes(key) && otherKey.length > key.length + 2);
      }
      return true;
    });
    const maxEntities = Number.isFinite(Number(config.maxEntities)) && Number(config.maxEntities) > 0
      ? Math.floor(Number(config.maxEntities))
      : Number.POSITIVE_INFINITY;
    return deduped.slice(0, maxEntities);
  };

  const dictionarySeedsForDocument = async ({ workspaceId, documentId = "", collectionId = "", payload = {}, config = {} } = {}) => {
    const useDictionarySeeds = config.useDictionarySeeds !== false && String(config.useDictionarySeeds || "true").toLowerCase() !== "false";
    if (!useDictionarySeeds) return [];
    const tierOrder = { core: 3, typed: 2, context: 1, weak: 0 };
    const minTier = String(config.minDictionarySeedTier || "typed").toLowerCase();
    const minRank = tierOrder[minTier] ?? tierOrder.typed;
    const maxSeeds = Number.isFinite(Number(config.maxDictionarySeeds)) && Number(config.maxDictionarySeeds) > 0
      ? Math.floor(Number(config.maxDictionarySeeds))
      : Number.POSITIVE_INFINITY;
    const payloadEntries = Array.isArray(payload?.dictionaryEntries) ? payload.dictionaryEntries : [];
    const storedEntries = documentId
      ? byWorkspace(await listStore(STORES.dictionary), workspaceId)
        .filter((entry) => entry.documentId === documentId)
        .filter((entry) => !collectionId || entry.collectionId === collectionId)
      : [];
    const entries = [...payloadEntries, ...storedEntries];
    const seen = new Map();
    entries
      .filter((entry) => entry && entry.usableAsSeed === true)
      .filter((entry) => (tierOrder[String(entry.tier || "weak").toLowerCase()] ?? 0) >= minRank)
      .sort((left, right) =>
        Number(right.seedScore || right.confidence || 0) - Number(left.seedScore || left.confidence || 0) ||
        String(left.term || "").localeCompare(String(right.term || ""))
      )
      .forEach((entry) => {
        const key = normalizeEntityToken(entry.term || entry.label || "");
        if (!key || seen.has(key)) return;
        seen.set(key, entry);
      });
    return [...seen.values()].slice(0, maxSeeds);
  };

  const findRelationEndpointEntity = (entities = [], label = "") => {
    const wanted = normalizeEntityToken(label);
    if (!wanted) return null;
    const candidates = (entities || []).filter(Boolean).map((entity) => {
      const labelKey = normalizeEntityToken(entity.label || "");
      const aliasKeys = (entity.metadata?.aliases || entity.aliases || []).map((alias) => normalizeEntityToken(alias)).filter(Boolean);
      const exact = labelKey === wanted || aliasKeys.includes(wanted);
      const compatible = exact ||
        (wanted.length > 3 && labelKey.includes(wanted)) ||
        (labelKey.length > 3 && wanted.includes(labelKey)) ||
        aliasKeys.some((aliasKey) => (wanted.length > 3 && aliasKey.includes(wanted)) || (aliasKey.length > 3 && wanted.includes(aliasKey)));
      if (!compatible) return null;
      return {
        entity,
        exact,
        distance: Math.abs(labelKey.length - wanted.length),
        confidence: Number(entity.confidence || 0),
      };
    }).filter(Boolean);
    candidates.sort((left, right) =>
      Number(right.exact) - Number(left.exact) ||
      left.distance - right.distance ||
      right.confidence - left.confidence
    );
    return candidates[0]?.entity || null;
  };

  const createEntitiesAndRelations = async ({ workspaceId, node, payload, event, config = {} } = {}) => {
    const inputChannel = String(event?.channel || "").trim();
    const allowDocumentInput = config.allowDocumentInput === true || String(config.allowDocumentInput || "").toLowerCase() === "true";
    const canReadDictionaryChunks = inputChannel === "knowledge.dictionary.updated" || inputChannel === "knowledge.lexicon.context";
    const dictionaryDrivenExtraction = canReadDictionaryChunks;
    const canReadDocumentChunks = inputChannel === "knowledge.chunk.created" || canReadDictionaryChunks || allowDocumentInput;
    const canReadInlineText = allowDocumentInput;
    const chunks = Array.isArray(payload?.chunks)
      ? payload.chunks
      : payload?.chunkId
        ? [await getRecord(STORES.chunks, payload.chunkId)]
        : payload?.documentId && canReadDocumentChunks
          ? byWorkspace(await listStore(STORES.chunks), workspaceId).filter((chunk) => chunk.documentId === payload.documentId)
          : (payload?.text || payload?.content) && canReadInlineText
            ? [{
              id: payload.chunkId || uniqueId("kchunk_inline"),
              workspaceId,
              documentId: payload.documentId || "",
              text: extractInputText(payload, {}),
              metadata: payload.metadata || {},
            }]
            : [];
    const validChunks = chunks.filter(Boolean).filter((chunk) => !looksLikeKnowledgeEnvelope(chunk.text || ""));
    if (!validChunks.length) throw new Error("Chunk Knowledge non trovato per entity extraction");
    if (config.replaceExisting !== false) {
      const chunkDocumentIds = [...new Set(validChunks.map((chunk) => chunk.documentId).filter(Boolean))];
      const cleanupDocumentId = payload?.documentId || (chunkDocumentIds.length === 1 ? chunkDocumentIds[0] : "");
      await deleteEntitiesAndRelations({
        workspaceId,
        chunkIds: validChunks.map((chunk) => chunk.id),
        documentId: cleanupDocumentId,
      });
    }
    const now = nowIso();
    const entities = [];
    const relations = [];
    const collectionId = validChunks[0]?.metadata?.collectionId || payload?.collectionId || payload?.metadata?.collectionId || config.collectionId || "";
    const dictionarySeedEntries = await dictionarySeedsForDocument({
      workspaceId,
      documentId: validChunks[0]?.documentId || payload?.documentId || "",
      collectionId,
      payload,
      config,
    });
    const dictionarySeedByLabel = new Map(dictionarySeedEntries.map((entry) => [
      normalizeEntityToken(entry.term || entry.label || ""),
      entry,
    ]));
    const effectiveConfig = agentToolsBoundedKnowledgeConfig(node, config);
    const mode = entityAiMode(effectiveConfig);
    const aiResult = ["llm", "hybrid"].includes(mode)
      ? await callEntityExtractionAi({ chunks: validChunks, dictionaryEntries: dictionarySeedEntries, config: effectiveConfig })
      : { entities: [], relations: [], provider: "", model: "", usage: {}, error: "", promptMode: "" };
    if (aiResult.usage?.totalTokens) {
      await persistKnowledgeNodeTokenUsage({ node, usage: aiResult.usage, provider: aiResult.provider, model: aiResult.model });
    }
    const aiEntitiesByChunkId = new Map();
    (aiResult.entities || []).forEach((candidate) => {
      const chunkId = candidate.ai?.chunkId || "";
      if (!chunkId) return;
      aiEntitiesByChunkId.set(chunkId, [...(aiEntitiesByChunkId.get(chunkId) || []), candidate]);
    });
    const aiRelationsByChunkId = new Map();
    (aiResult.relations || []).forEach((candidate) => {
      const chunkId = candidate.chunkId || "";
      if (!chunkId) return;
      aiRelationsByChunkId.set(chunkId, [...(aiRelationsByChunkId.get(chunkId) || []), candidate]);
    });
    const maxRelations = Number.isFinite(Number(config.maxRelations)) && Number(config.maxRelations) > 0
      ? Math.floor(Number(config.maxRelations))
      : Number.POSITIVE_INFINITY;
    const minHybridAiEntities = Number.isFinite(Number(config.minHybridAiEntities)) && Number(config.minHybridAiEntities) > 0
      ? Math.floor(Number(config.minHybridAiEntities))
      : 0;
    const minHybridAiRelations = maxRelations <= 0
      ? 0
      : Number.isFinite(Number(config.minHybridAiRelations)) && Number(config.minHybridAiRelations) > 0
        ? Math.floor(Number(config.minHybridAiRelations))
        : 0;
    const aiEntityCount = (aiResult.entities || []).length;
    const aiRelationCount = (aiResult.relations || []).length;
    const rawAiEntityOutputUsable = hybridAiCountUsable({
      count: aiEntityCount,
      min: minHybridAiEntities,
      promptMode: aiResult.promptMode || "",
    }) && (minHybridAiRelations <= 0 || aiRelationCount >= minHybridAiRelations);
    let useRuleFallback = mode === "rules" ||
      (mode === "hybrid" && !rawAiEntityOutputUsable);
    let fallbackReason = useRuleFallback && mode === "hybrid" ? "sparse-ai-entity-output" : "";
    const maxRelationsPerChunk = Number.isFinite(Number(config.maxRelationsPerChunk)) && Number(config.maxRelationsPerChunk) > 0
      ? Math.floor(Number(config.maxRelationsPerChunk))
      : Number.POSITIVE_INFINITY;
    const maxRelationsPerEntityPerChunk = Number.isFinite(Number(config.maxRelationsPerEntityPerChunk)) && Number(config.maxRelationsPerEntityPerChunk) > 0
      ? Math.floor(Number(config.maxRelationsPerEntityPerChunk))
      : Number.POSITIVE_INFINITY;
    const maxRelationDistance = Number.isFinite(Number(config.maxRelationDistance)) && Number(config.maxRelationDistance) > 0
      ? Number(config.maxRelationDistance)
      : Number.POSITIVE_INFINITY;
    const relationRecords = new Map();
    const relationMaterialization = {
      candidateCount: 0,
      aiCandidateCount: 0,
      createdCount: 0,
      duplicateCount: 0,
      missingEndpointCount: 0,
      capSkippedCount: 0,
      sameEndpointCount: 0,
      dictionaryFilteredCount: 0,
      missingEndpointSamples: [],
      duplicateSamples: [],
    };
    const entityOutputIndexById = new Map();
    for (let extractionPass = 0; extractionPass < 2; extractionPass += 1) {
      if (extractionPass === 1) {
        if (mode !== "hybrid") break;
        const acceptedAiOutputUsable = mode === "hybrid" && hybridAiCountUsable({
          count: entities.length,
          min: minHybridAiEntities,
          promptMode: aiResult.promptMode || "",
        }) && (minHybridAiRelations <= 0 || relations.length >= minHybridAiRelations);
        if (useRuleFallback || acceptedAiOutputUsable) break;
        useRuleFallback = true;
        fallbackReason = "sparse-accepted-entity-output";
      }
      for (const chunk of validChunks) {
        const language = detectLanguage(chunk.text || "", preferredRuntimeLanguage(config));
        const chunkConfig = {
          ...config,
          language,
          text: chunk.text || "",
          dictionarySeedEntries: dictionarySeedEntries.filter((entry) =>
            String(chunk.text || "").toLowerCase().includes(String(entry.term || entry.label || "").toLowerCase())
          ),
        };
        const ruleCandidates = useRuleFallback ? entityCandidatesFromText(chunk.text || "", chunkConfig) : [];
        const candidates = [...ruleCandidates, ...(aiEntitiesByChunkId.get(chunk.id || "") || [])];
        const chunkEntities = [];
        const chunkEntityIndexById = new Map();
        for (const candidate of candidates) {
        const dictionarySeed = candidate.source === "dictionary-seed"
          ? dictionarySeedByLabel.get(normalizeEntityToken(candidate.label || ""))
          : null;
        const entityId = `kentity_${safeId(workspaceId)}_${safeId(chunk.documentId || "doc")}_${safeId(candidate.label.toLowerCase())}`;
        const previousEntity = await getRecord(STORES.entities, entityId).catch(() => null);
        const aliases = [...new Set([
          ...(previousEntity?.metadata?.aliases || []),
          ...(candidate.aliases || []),
        ].filter(Boolean))];
        const record = {
          id: entityId,
          workspaceId,
          documentId: chunk.documentId || "",
          chunkId: chunk.id || "",
          label: candidate.label,
          normalized: normalizeKnowledgeText(candidate.label),
          entityType: candidate.entityType,
          confidence: Math.max(Number(previousEntity?.confidence || 0), Number(candidate.confidence || 0)),
          source: candidate.source,
          metadata: {
            ...(previousEntity?.metadata || {}),
            ...(chunk.metadata || {}),
            inputChannel: event?.channel || "",
            nodeId: node?.id || "",
            language,
            collectionId: chunk.metadata?.collectionId || config.collectionId || "",
            aliases,
            ai: candidate.ai ? {
              evidence: candidate.ai.evidence || null,
              explanation: candidate.ai.explanation || "",
              proposedType: candidate.ai.proposedType || "",
            } : previousEntity?.metadata?.ai || undefined,
            dictionary: candidate.source === "dictionary-seed"
              ? {
                tier: dictionarySeed?.tier || "",
                seedScore: dictionarySeed?.seedScore || 0,
              }
              : previousEntity?.metadata?.dictionary || undefined,
          },
          createdAt: previousEntity?.createdAt || now,
          updatedAt: now,
        };
        const savedRecord = await putRecord(STORES.entities, record);
        const entityOutputIndex = entityOutputIndexById.get(entityId);
        if (Number.isInteger(entityOutputIndex)) {
          entities[entityOutputIndex] = savedRecord;
        } else {
          entityOutputIndexById.set(entityId, entities.length);
          entities.push(savedRecord);
        }
        const chunkEntityIndex = chunkEntityIndexById.get(entityId);
        if (Number.isInteger(chunkEntityIndex)) {
          chunkEntities[chunkEntityIndex] = savedRecord;
        } else {
          chunkEntityIndexById.set(entityId, chunkEntities.length);
          chunkEntities.push(savedRecord);
        }
        }
        const relationCandidates = [];
        for (let left = 0; left < chunkEntities.length; left += 1) {
          for (let right = left + 1; right < chunkEntities.length; right += 1) {
          const source = chunkEntities[left];
          const target = chunkEntities[right];
          const sourceKey = normalizeEntityToken(source.label);
          const targetKey = normalizeEntityToken(target.label);
          const nestedSameType = source.entityType === target.entityType &&
            sourceKey !== targetKey &&
            (sourceKey.includes(targetKey) || targetKey.includes(sourceKey));
          if (nestedSameType) continue;
          const types = new Set([source.entityType, target.entityType]);
          const hasPerson = types.has("proper-noun");
          const hasNarrative = ["location", "object", "creature", "concept", "quote", "symbol"].some((type) => types.has(type));
          const confidence = Math.min(source.confidence || 0.6, target.confidence || 0.6);
          const distance = entityRelationDistance(chunk.text || "", source, target);
          if (distance > maxRelationDistance) continue;
          const proximityScore = Number.isFinite(distance) ? Math.max(0, 0.18 - (distance / maxRelationDistance) * 0.18) : 0;
          const score = confidence +
            proximityScore +
            (hasPerson && hasNarrative ? 0.22 : 0) +
            (hasPerson ? 0.1 : 0) +
            (types.has("quote") ? 0.08 : 0) +
            (types.has("creature") || types.has("object") ? 0.06 : 0) -
            (source.entityType === target.entityType ? 0.08 : 0);
          relationCandidates.push({ source, target, confidence, score });
          }
        }
        const selectedRelationCandidates = useRuleFallback
          ? relationCandidates.sort((left, right) => right.score - left.score || String(left.source.label || "").localeCompare(String(right.source.label || "")))
          : [];
        const aiChunkRelations = (aiRelationsByChunkId.get(chunk.id || "") || [])
          .map((candidate) => {
            const source = findRelationEndpointEntity(chunkEntities, candidate.sourceLabel) ||
              findRelationEndpointEntity(entities, candidate.sourceLabel);
            const target = findRelationEndpointEntity(chunkEntities, candidate.targetLabel) ||
              findRelationEndpointEntity(entities, candidate.targetLabel);
            if (!source || !target) {
              relationMaterialization.missingEndpointCount += 1;
              relationMaterialization.missingEndpointSamples.push({
                chunkId: chunk.id || "",
                sourceLabel: candidate.sourceLabel,
                targetLabel: candidate.targetLabel,
                relationType: candidate.relationType,
                sourceFound: Boolean(source),
                targetFound: Boolean(target),
                quote: candidate.evidence?.quote || candidate.evidence?.text || "",
              });
              return null;
            }
            if (source.id === target.id) {
              relationMaterialization.sameEndpointCount += 1;
              return null;
            }
            return {
              source,
              target,
              confidence: candidate.confidence,
              score: Number(candidate.confidence || 0) + 0.35,
              narrativeRelationType: candidate.relationType,
              ai: candidate,
            };
          })
          .filter(Boolean);
        const allSelectedRelationCandidates = [...aiChunkRelations, ...selectedRelationCandidates]
          .sort((left, right) => right.score - left.score || String(left.source.label || "").localeCompare(String(right.source.label || "")));
        relationMaterialization.candidateCount += allSelectedRelationCandidates.length;
        relationMaterialization.aiCandidateCount += aiChunkRelations.length;
        const chunkEntityRelationCounts = new Map();
        let chunkRelationCount = 0;
        for (const { source, target, confidence, ai } of allSelectedRelationCandidates) {
          if (relations.length >= maxRelations || chunkRelationCount >= maxRelationsPerChunk) {
            relationMaterialization.capSkippedCount += 1;
            break;
          }
          const sourceLocalCount = chunkEntityRelationCounts.get(source.id) || 0;
          const targetLocalCount = chunkEntityRelationCounts.get(target.id) || 0;
          if (sourceLocalCount >= maxRelationsPerEntityPerChunk || targetLocalCount >= maxRelationsPerEntityPerChunk) {
            relationMaterialization.capSkippedCount += 1;
            continue;
          }
          const sourceRelationType = inferSourceRelationType(source, target);
          const relationType = config.relationType ||
            ai?.relationType ||
            sourceRelationType ||
            inferConservativeRelationType(source, target);
          if (dictionaryDrivenExtraction && !relationTypeAllowedForDictionaryPass(relationType, source, target, false)) {
            relationMaterialization.dictionaryFilteredCount += 1;
            continue;
          }
          const oriented = orientRelationPair(source, target, relationType);
          const normalizedPair = normalizeRelationPair(oriented.source || source, oriented.target || target, relationType);
          const relationSource = normalizedPair.source || source;
          const relationTarget = normalizedPair.target || target;
          if (relationSource.id === relationTarget.id) continue;
          const relationKey = [
            chunk.documentId || payload?.documentId || workspaceId,
            relationType,
            relationSource.id,
            relationTarget.id,
          ].join("::");
          const existingRelation = relationRecords.get(relationKey);
          if (existingRelation) {
            relationMaterialization.duplicateCount += 1;
            relationMaterialization.duplicateSamples.push({
              source: relationSource.label,
              relationType,
              target: relationTarget.label,
              chunkId: chunk.id || "",
              quote: ai?.evidence?.quote || ai?.evidence?.text || "",
            });
            const chunkIds = new Set([...(existingRelation.metadata?.chunkIds || []), chunk.id || ""].filter(Boolean));
            const occurrenceCount = Number(existingRelation.metadata?.occurrenceCount || 1) + 1;
            const updatedRelation = {
              ...existingRelation,
              confidence: Math.max(Number(existingRelation.confidence || 0), Number(confidence || 0)),
              metadata: {
                ...(existingRelation.metadata || {}),
                chunkIds: [...chunkIds],
                occurrenceCount,
                ai: existingRelation.metadata?.ai || (ai ? {
                  relationType: ai.relationType || "",
                  rawRelationType: ai.rawRelationType || ai.relationType || "",
                  evidence: ai.evidence || null,
                  explanation: ai.explanation || "",
                  provider: aiResult.provider || "",
                  model: aiResult.model || "",
                } : undefined),
              },
              updatedAt: now,
            };
            relationRecords.set(relationKey, updatedRelation);
            const relationIndex = relations.findIndex((relation) => relation.id === existingRelation.id);
            if (relationIndex >= 0) relations[relationIndex] = await putRecord(STORES.relations, updatedRelation);
            chunkRelationCount += 1;
            chunkEntityRelationCounts.set(source.id, sourceLocalCount + 1);
            chunkEntityRelationCounts.set(target.id, targetLocalCount + 1);
            continue;
          }
          const relationId = `krelation_${safeId(chunk.documentId || payload?.documentId || workspaceId)}_${safeId(relationType)}_${safeId(relationSource.normalized || relationSource.label)}_${safeId(relationTarget.normalized || relationTarget.label)}`;
          const relation = {
            id: relationId,
            workspaceId,
            documentId: chunk.documentId || "",
            chunkId: chunk.id || "",
            sourceEntityId: relationSource.id,
            targetEntityId: relationTarget.id,
            sourceLabel: relationSource.label,
            targetLabel: relationTarget.label,
            relationType,
            confidence,
            metadata: {
              inputChannel: event?.channel || "",
              nodeId: node?.id || "",
              language,
              collectionId: chunk.metadata?.collectionId || config.collectionId || "",
              chunkIds: [chunk.id || ""].filter(Boolean),
              occurrenceCount: 1,
              ai: ai ? {
                relationType: ai.relationType || "",
                rawRelationType: ai.rawRelationType || ai.relationType || "",
                evidence: ai.evidence || null,
                explanation: ai.explanation || "",
                provider: aiResult.provider || "",
                model: aiResult.model || "",
              } : undefined,
            },
            createdAt: now,
            updatedAt: now,
          };
          relationRecords.set(relationKey, relation);
          relations.push(await putRecord(STORES.relations, relation));
          relationMaterialization.createdCount += 1;
          chunkRelationCount += 1;
          chunkEntityRelationCounts.set(source.id, sourceLocalCount + 1);
          chunkEntityRelationCounts.set(target.id, targetLocalCount + 1);
        }
      }
    }
    const aiRelationRecordCount = relations.filter((relation) => relation.metadata?.ai).length;
    return {
      documentId: validChunks[0]?.documentId || payload?.documentId || "",
      collectionId: validChunks[0]?.metadata?.collectionId || payload?.collectionId || payload?.metadata?.collectionId || config.collectionId || "",
      entities,
      relations,
      entityCount: entities.length,
      relationCount: relations.length,
      extractionMode: mode,
      ai: {
        provider: aiResult.provider || "",
        model: aiResult.model || "",
        error: aiResult.error || "",
        promptMode: aiResult.promptMode || "",
        entityCount: aiResult.entities?.length || 0,
        relationCount: aiResult.relations?.length || 0,
        acceptedRelationRecordCount: aiRelationRecordCount,
        droppedRelationCandidateCount: Math.max(0, (aiResult.relations?.length || 0) - aiRelationRecordCount),
        relationMaterialization,
        minHybridEntities: minHybridAiEntities,
        minHybridRelations: minHybridAiRelations,
        hybridFallback: useRuleFallback,
        hybridMerged: mode === "hybrid",
        ruleCompletionCount: mode === "hybrid" || mode === "rules" ? { entities: entities.length - (aiResult.entities?.length || 0), relations: relations.length - (aiResult.relations?.length || 0) } : { entities: 0, relations: 0 },
        fallbackReason,
      },
      status: mode === "hybrid" && ((aiResult.entities?.length || 0) > 0 || (aiResult.relations?.length || 0) > 0) && useRuleFallback
        ? "partial-ai-merged"
        : useRuleFallback
          ? "fallback"
          : "ready",
    };
  };

  const semanticRelationTypes = new Set([
    "friend_of", "helps", "tries_to_help", "healed_by", "cannot_speak", "has_property", "lives_in",
    "seeks", "protects", "opposes", "causes", "leads_to", "is_part_of", "teaches", "discovers",
    "asks_for", "receives_from", "gives_to", "works_for", "uses",
  ]);

  const graphBuilderRelationTypes = new Set([
    ...semanticRelationTypes,
    "uses", "implements", "explains", "stores_in", "retrieves_from", "powered_by", "depends_on",
    "interfaces_with", "connects_to", "configures", "loads", "splits", "splits_into", "processes", "transforms",
    "compares_with", "contains", "mentions", "references", "represents", "reveals", "encounters",
  ]);

  const semanticRelationLabels = {
    friend_of: "friendship cue",
    helps: "help cue",
    tries_to_help: "attempted help cue",
    healed_by: "healing cue",
    cannot_speak: "speech inability cue",
    has_property: "property cue",
    lives_in: "residence cue",
    seeks: "seeking cue",
    protects: "protection cue",
    opposes: "opposition cue",
    causes: "causal cue",
    leads_to: "outcome cue",
    is_part_of: "part-whole cue",
    teaches: "teaching cue",
    discovers: "discovery cue",
    asks_for: "request cue",
    receives_from: "receiving cue",
    gives_to: "giving cue",
    works_for: "employment cue",
    uses: "action-object cue",
  };

  const semanticContext = (text = "", source = {}, target = {}, radius = 280) =>
    relationContextBetween(text, source, target, radius) || String(text || "").slice(0, Math.min(900, String(text || "").length));

  const semanticEvidenceForRelation = (text = "", source = {}, target = {}) => {
    const fullText = String(text || "");
    const sourcePositions = entityLabelPositions(fullText, source.label || source.sourceLabel || "");
    const targetPositions = entityLabelPositions(fullText, target.label || target.targetLabel || "");
    let start = 0;
    let end = Math.min(fullText.length, 520);
    if (sourcePositions.length && targetPositions.length) {
      let best = null;
      sourcePositions.forEach((sourcePosition) => {
        targetPositions.forEach((targetPosition) => {
          const distance = Math.abs(sourcePosition - targetPosition);
          if (!best || distance < best.distance) best = { sourcePosition, targetPosition, distance };
        });
      });
      if (best) {
        start = Math.max(0, Math.min(best.sourcePosition, best.targetPosition) - 180);
        end = Math.min(fullText.length, Math.max(best.sourcePosition, best.targetPosition) + 260);
      }
    }
    const textSlice = fullText.slice(start, end).replace(/\s+/g, " ").trim();
    return {
      text: textSlice,
      quote: textSlice,
      startOffset: Number.isFinite(start) ? start : null,
      endOffset: Number.isFinite(end) ? end : null,
    };
  };

  const semanticEntityNear = (context = "", entity = {}, patterns = [], radius = 140) =>
    entityNearPattern(context, entity?.label || "", patterns, radius);

  const semanticEntityTypes = (source = {}, target = {}) => ({
    people: [source, target].filter((entity) => entity.entityType === "proper-noun"),
    concepts: [source, target].filter((entity) => entity.entityType === "concept"),
    objects: [source, target].filter((entity) => entity.entityType === "object"),
    locations: [source, target].filter((entity) => entity.entityType === "location"),
    sources: [source, target].filter((entity) => entity.entityType === "source"),
  });

  const semanticHasCueNearEntity = (text = "", entity = {}, patterns = [], radius = 150) =>
    semanticEntityNear(text, entity, patterns, radius);

  const semanticBothEntitiesNearCue = (text = "", source = {}, target = {}, patterns = [], radius = 180) =>
    semanticHasCueNearEntity(text, source, patterns, radius) &&
    semanticHasCueNearEntity(text, target, patterns, radius);

  const semanticCueBetweenEntities = (text = "", source = {}, target = {}, patterns = []) => {
    const context = normalizeEntityToken(relationContextBetween(text, source, target, 120));
    return Boolean(context) && patterns.some((pattern) => pattern.test(context));
  };

  const semanticCuePositions = (text = "", patterns = []) => {
    const cleanText = normalizeEntityToken(text);
    if (!cleanText) return [];
    return patterns.flatMap((pattern) => {
      const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
      const regex = new RegExp(pattern.source, flags);
      return [...cleanText.matchAll(regex)].map((match) => match.index || 0);
    });
  };

  const semanticEntityBeforeCue = (text = "", entity = {}, patterns = [], radius = 220) => {
    const cleanText = normalizeEntityToken(text);
    const cleanLabel = normalizeEntityToken(entity?.label || "");
    if (!cleanText || !cleanLabel) return false;
    const labelPositions = [...cleanText.matchAll(new RegExp(`\\b${escapedRegExp(cleanLabel)}\\b`, "g"))].map((match) => match.index || 0);
    const cuePositions = semanticCuePositions(text, patterns);
    return labelPositions.some((labelPosition) =>
      cuePositions.some((cuePosition) => cuePosition >= labelPosition && cuePosition - (labelPosition + cleanLabel.length) <= radius)
    );
  };

  const semanticEntityAfterCue = (text = "", entity = {}, patterns = [], radius = 220) => {
    const cleanText = normalizeEntityToken(text);
    const cleanLabel = normalizeEntityToken(entity?.label || "");
    if (!cleanText || !cleanLabel) return false;
    const labelPositions = [...cleanText.matchAll(new RegExp(`\\b${escapedRegExp(cleanLabel)}\\b`, "g"))].map((match) => match.index || 0);
    const cuePositions = semanticCuePositions(text, patterns);
    return labelPositions.some((labelPosition) =>
      cuePositions.some((cuePosition) => labelPosition >= cuePosition && labelPosition - cuePosition <= radius)
    );
  };

  const semanticPersonNearCue = (text = "", people = [], patterns = [], radius = 180) =>
    people.find((person) => semanticHasCueNearEntity(text, person, patterns, radius)) || null;

  const semanticPersonBeforeCue = (text = "", people = [], patterns = [], radius = 220) =>
    people.find((person) => semanticEntityBeforeCue(text, person, patterns, radius)) || null;

  const semanticNonPersonProperNoun = (entity = {}) => {
    const label = normalizeEntityToken(entity?.label || entity?.normalized || "");
    if (!label) return true;
    return /\b(?:castle|cave|forest|kingdom|mountain|river|road|spring|stone|tree|village|woods|albero|alberi|castello|caverna|foresta|montagna|regno|villaggio)\b/.test(label);
  };

  const semanticSpeechConcept = (entity = {}) =>
    /^(?:speech|voice|speaking|silence|voce|parola|silenzio|voz|habla|parole)$/.test(normalizeEntityToken(entity?.label || entity?.normalized || ""));

  const semanticDiscoveryTargetAllowed = (entity = {}) => {
    const label = normalizeEntityToken(entity?.label || entity?.normalized || "");
    const type = String(entity?.entityType || "").toLowerCase();
    if (!label) return false;
    if (/^(?:creature|courage|determination|discouragement|kingdom|village|compassion|friendship|paura|coraggio|determinazione)$/.test(label)) return false;
    return ["object", "creature", "source"].includes(type) || (type === "concept" && label.length > 10);
  };

  const semanticWeakEntity = (entity = {}) => {
    const label = normalizeEntityToken(entity?.label || entity?.normalized || "");
    if (!label) return true;
    return new Set(["we", "we ll", "we re", "we ve", "you", "you ll", "you re", "who", "what", "how", "then", "powered"]).has(label);
  };

  const semanticEntityAppearsInText = (entity = {}, text = "") => {
    const label = normalizeEntityToken(entity?.label || entity?.normalized || "");
    const cleanText = normalizeEntityToken(text);
    return Boolean(label && cleanText && new RegExp(`\\b${escapedRegExp(label)}\\b`).test(cleanText));
  };

  const semanticActionObjectEvidence = (text = "", person = {}, object = {}, blockingPeople = []) => {
    const fullText = String(text || "");
    const cleanText = normalizeEntityToken(fullText);
    const personLabel = normalizeEntityToken(person?.label || "");
    const objectLabel = normalizeEntityToken(object?.label || "");
    if (!cleanText || !personLabel || !objectLabel) return null;
    const objectPositions = [...cleanText.matchAll(new RegExp(`\\b${escapedRegExp(objectLabel)}\\b`, "g"))].map((match) => match.index || 0);
    const personPositions = [...cleanText.matchAll(new RegExp(`\\b${escapedRegExp(personLabel)}\\b`, "g"))].map((match) => match.index || 0);
    if (!objectPositions.length || !personPositions.length) return null;
    const actionPatterns = [
      /\b(?:uses|used|use|using|utilizza|utilizz[oò]|usa|us[oò]|afferra|afferr[oò]|prende|prese|preso|impugna|impugn[oò]|brandisce|brand[iì]|wields|wielded|grabs|grabbed|takes|took)\b/,
      /\b(?:colpisce|colp[iì]|colpito|hit|hits|struck|strike|strikes|attacca|attacc[oò]|attack|attacks|attacked)\b.{0,80}\b(?:con|with)\b/,
    ];
    const actionPositions = semanticCuePositions(cleanText, actionPatterns);
    if (!actionPositions.length) return null;
    let best = null;
    objectPositions.forEach((objectPosition) => {
      actionPositions.forEach((actionPosition) => {
        if (Math.abs(objectPosition - actionPosition) > 90) return;
        const personPosition = personPositions
          .filter((position) => position <= Math.max(objectPosition, actionPosition))
          .sort((a, b) => Math.abs(b - actionPosition) - Math.abs(a - actionPosition))
          .pop();
        if (!Number.isFinite(personPosition)) return;
        if (actionPosition - personPosition > 260) return;
        const hasCloserPersonBetween = blockingPeople.some((other) => {
          const otherLabel = normalizeEntityToken(other?.label || "");
          if (!otherLabel) return false;
          const otherPositions = [...cleanText.matchAll(new RegExp(`\\b${escapedRegExp(otherLabel)}\\b`, "g"))].map((match) => match.index || 0);
          return otherPositions.some((position) => position > personPosition && position <= actionPosition);
        });
        if (hasCloserPersonBetween) return;
        const distance = Math.abs(objectPosition - actionPosition) + Math.max(0, actionPosition - personPosition);
        if (!best || distance < best.distance) best = { personPosition, objectPosition, actionPosition, distance };
      });
    });
    if (!best) return null;
    const start = Math.max(0, Math.min(best.personPosition, best.actionPosition, best.objectPosition) - 140);
    const end = Math.min(fullText.length, Math.max(best.personPosition, best.actionPosition, best.objectPosition) + objectLabel.length + 220);
    const quote = fullText.slice(start, end).replace(/\s+/g, " ").trim();
    if (!quote) return null;
    return {
      text: quote,
      quote,
      startOffset: start,
      endOffset: end,
    };
  };

  const inferSupplementalUseRelationsForChunk = ({ chunk = {}, entities = [], workspaceId = "", config = {} } = {}) => {
    if (!semanticRelationAllowed("uses", config)) return [];
    const text = String(chunk?.text || "");
    if (!text) return [];
    const localEntities = entities.filter((entity) => semanticEntityAppearsInText(entity, text));
    const people = localEntities.filter((entity) => entity.entityType === "proper-noun" && !semanticNonPersonProperNoun(entity));
    const objects = localEntities.filter((entity) => entity.entityType === "object" && !semanticWeakEntity(entity));
    if (!people.length || !objects.length) return [];
    const results = [];
    people.slice(0, 8).forEach((person) => {
      objects.slice(0, 12).forEach((object) => {
        if (person.id === object.id) return;
        const evidence = semanticActionObjectEvidence(text, person, object, people.filter((other) => other.id !== person.id));
        if (!evidence) return;
        const relationId = `ksynthetic_${safeId(chunk.documentId || workspaceId)}_uses_${safeId(person.normalized || person.label)}_${safeId(object.normalized || object.label)}_${safeId(chunk.id || "")}`;
        results.push({
          candidate: {
            id: relationId,
            source: person,
            target: object,
            chunk,
            evidence,
            text: evidence.text,
            relation: {
              id: relationId,
              workspaceId,
              documentId: chunk.documentId || "",
              chunkId: chunk.id || "",
              sourceEntityId: person.id,
              targetEntityId: object.id,
              relationType: "context_for",
              confidence: 0.72,
              metadata: {
                collectionId: chunk.metadata?.collectionId || "",
                synthetic: true,
                supplementalSemantic: true,
              },
            },
          },
          semantic: {
            relationType: "uses",
            source: person,
            target: object,
            confidence: 0.76,
            evidence,
            explanation: semanticRelationLabels.uses,
            method: "rule",
          },
        });
      });
    });
    return results;
  };

  const semanticHealingEvidence = (text = "", patient = {}, healer = {}) => {
    const fullText = String(text || "");
    const cleanText = normalizeEntityToken(fullText);
    const patientLabel = normalizeEntityToken(patient?.label || "");
    const healerLabel = normalizeEntityToken(healer?.label || "");
    if (!cleanText || !patientLabel || !healerLabel) return null;
    if (!new RegExp(`\\b${escapedRegExp(patientLabel)}\\b`).test(cleanText)) return null;
    if (!new RegExp(`\\b${escapedRegExp(healerLabel)}\\b`).test(cleanText)) return null;
    const healerLooksHealing = ["object", "concept"].includes(String(healer.entityType || ""));
    if (!healerLooksHealing) return null;
    const hasHealingCue = /\b(?:guarire|guari|guarì|guarisce|guarito|cura|curare|heal|healed|heals|cure|cured|potere|poteri|poder|pouvoir|recupera|recuperò|recupero|ritrova|ritrovò|riacquista|riacquistò|torn[oò] a parlare|pouvoir de gu[eé]rir)\b/.test(cleanText);
    const hasSpeechRecoveryCue = /\b(?:voce|parlare|parlo|parlò|parla|parlava|speak|speaks|spoke|voice|talk|voz|hablar|parler)\b/.test(cleanText);
    if (!hasHealingCue || !hasSpeechRecoveryCue) return null;
    const patientPositions = [...cleanText.matchAll(new RegExp(`\\b${escapedRegExp(patientLabel)}\\b`, "g"))].map((match) => match.index || 0);
    const healerPositions = [...cleanText.matchAll(new RegExp(`\\b${escapedRegExp(healerLabel)}\\b`, "g"))].map((match) => match.index || 0);
    const directHealingActionPatterns = [
      /\b(?:beve|bevve|bevuto|bere|drink|drank|drinks|take|takes|took|prende|prese|preso|riceve|ricevette|receives|received)\b/,
      /\b(?:prepara|prepar[oò]|preparare|trasforma|trasform[oò]|immerge|immerse|immerso|immergere|riempie|riemp[iì]|fills|filled)\b/,
    ];
    const generalAftermathPatterns = [
      /\b(?:chiunque|anyone|whoever|qualunque|da quel momento|from then|notizia|possibilit[aà]|same possibility|possedeva il potere|possessed the power|potere di guarire)\b/,
    ];
    let best = null;
    patientPositions.forEach((patientPosition) => {
      healerPositions.forEach((healerPosition) => {
        const distance = Math.abs(patientPosition - healerPosition);
        if (distance > 900) return;
        const contextStart = Math.max(0, Math.min(patientPosition, healerPosition) - 260);
        const contextEnd = Math.min(cleanText.length, Math.max(patientPosition, healerPosition) + healerLabel.length + 360);
        const context = cleanText.slice(contextStart, contextEnd);
        const hasDirectAction = directHealingActionPatterns.some((pattern) => pattern.test(context));
        if (!hasDirectAction) return;
        const onlyGeneralAftermath = generalAftermathPatterns.some((pattern) => pattern.test(context)) &&
          !/\b(?:beve|bevve|bevuto|bere|drink|drank|drinks|prese|prende|took|takes)\b/.test(context);
        if (onlyGeneralAftermath) return;
        if (!best || distance < best.distance) best = { patientPosition, healerPosition, distance };
      });
    });
    if (!best) return null;
    const start = Math.max(0, Math.min(best.patientPosition, best.healerPosition) - 220);
    const end = Math.min(fullText.length, Math.max(best.patientPosition, best.healerPosition) + healerLabel.length + 360);
    const quote = fullText.slice(start, end).replace(/\s+/g, " ").trim();
    if (!quote) return null;
    return {
      text: quote,
      quote,
      startOffset: start,
      endOffset: end,
    };
  };

  const semanticHealingMechanismEvidence = (text = "", mechanism = {}, outcome = {}) => {
    const fullText = String(text || "");
    const cleanText = normalizeEntityToken(fullText);
    const mechanismLabel = normalizeEntityToken(mechanism?.label || "");
    const outcomeLabel = normalizeEntityToken(outcome?.label || "");
    if (!cleanText || !mechanismLabel || !outcomeLabel) return null;
    if (!new RegExp(`\\b${escapedRegExp(mechanismLabel)}\\b`).test(cleanText)) return null;
    if (!new RegExp(`\\b${escapedRegExp(outcomeLabel)}\\b`).test(cleanText)) return null;
    const mechanismLooksHealing = ["object", "concept"].includes(String(mechanism.entityType || ""));
    const outcomeLooksSpeech = semanticSpeechConcept(outcome) ||
      /\b(?:voce|parola|parlare|speech|voice|speaking|speak|voz|habla|parole)\b/.test(outcomeLabel);
    if (!mechanismLooksHealing || !outcomeLooksSpeech) return null;
    const hasHealingCue = /\b(?:guarire|guari|guarì|guarisce|guarito|cura|curare|heal|healed|heals|cure|cured|potere|poteri|poder|pouvoir|magica|magico|recupera|recuperò|ritrova|ritrovò|riacquista|riacquistò)\b/.test(cleanText);
    const hasPreparationCue = /\b(?:immerse|immerso|immersa|immergere|mise|messo|messa|mette|mettere|prepara|preparò|preparare|beve|bevve|bevuto|bere|drink|drank|drinks)\b/.test(cleanText);
    const hasSpeechCue = /\b(?:voce|parlare|parlo|parlò|parla|parlava|speak|speaks|spoke|voice|talk|voz|hablar|parler)\b/.test(cleanText);
    if (!hasHealingCue || !hasSpeechCue || !hasPreparationCue) return null;
    const mechanismPositions = [...cleanText.matchAll(new RegExp(`\\b${escapedRegExp(mechanismLabel)}\\b`, "g"))].map((match) => match.index || 0);
    const outcomePositions = [...cleanText.matchAll(new RegExp(`\\b${escapedRegExp(outcomeLabel)}\\b`, "g"))].map((match) => match.index || 0);
    let best = null;
    mechanismPositions.forEach((mechanismPosition) => {
      outcomePositions.forEach((outcomePosition) => {
        if (mechanismPosition > outcomePosition) return;
        const distance = Math.abs(mechanismPosition - outcomePosition);
        if (distance > 1000) return;
        if (!best || distance < best.distance) best = { mechanismPosition, outcomePosition, distance };
      });
    });
    if (!best) return null;
    const start = Math.max(0, Math.min(best.mechanismPosition, best.outcomePosition) - 260);
    const end = Math.min(fullText.length, Math.max(best.mechanismPosition, best.outcomePosition) + outcomeLabel.length + 420);
    const quote = fullText.slice(start, end).replace(/\s+/g, " ").trim();
    if (!quote) return null;
    return {
      text: quote,
      quote,
      startOffset: start,
      endOffset: end,
    };
  };

  const inferSupplementalHealingRelationsForChunk = ({ chunk = {}, entities = [], workspaceId = "", config = {} } = {}) => {
    if (!semanticRelationAllowed("healed_by", config)) return [];
    const text = String(chunk?.text || "");
    if (!text) return [];
    const localEntities = entities.filter((entity) => semanticEntityAppearsInText(entity, text));
    const people = localEntities.filter((entity) => entity.entityType === "proper-noun" && !semanticNonPersonProperNoun(entity));
    const healingObjectsRaw = localEntities.filter((entity) =>
      ["object", "concept"].includes(String(entity.entityType || "")) &&
      !semanticWeakEntity(entity)
    );
    const healingObjects = healingObjectsRaw
      .sort((a, b) => normalizeEntityToken(b.label || "").length - normalizeEntityToken(a.label || "").length)
      .filter((entity, index, items) => {
        const label = normalizeEntityToken(entity.label || "");
        return label && !items.slice(0, index).some((kept) => {
          const keptLabel = normalizeEntityToken(kept.label || "");
          return keptLabel && keptLabel !== label && new RegExp(`\\b${escapedRegExp(label)}\\b`).test(keptLabel);
        });
      });
    if (!people.length || !healingObjects.length) return [];
    const results = [];
    people.slice(0, 8).forEach((person) => {
      healingObjects.slice(0, 10).forEach((object) => {
        if (person.id === object.id) return;
        const evidence = semanticHealingEvidence(text, person, object);
        if (!evidence) return;
        const relationId = `ksynthetic_${safeId(chunk.documentId || workspaceId)}_healed_by_${safeId(person.normalized || person.label)}_${safeId(object.normalized || object.label)}_${safeId(chunk.id || "")}`;
        results.push({
          candidate: {
            id: relationId,
            source: person,
            target: object,
            chunk,
            evidence,
            text: evidence.text,
            relation: {
              id: relationId,
              workspaceId,
              documentId: chunk.documentId || "",
              chunkId: chunk.id || "",
              sourceEntityId: person.id,
              targetEntityId: object.id,
              relationType: "context_for",
              confidence: 0.74,
              metadata: {
                collectionId: chunk.metadata?.collectionId || "",
                synthetic: true,
                supplementalSemantic: true,
              },
            },
          },
          semantic: {
            relationType: "healed_by",
            source: person,
            target: object,
            confidence: 0.78,
            evidence,
            explanation: semanticRelationLabels.healed_by,
            method: "rule",
          },
        });
      });
    });
    return results;
  };

  const orientSemanticRelation = ({ relationType = "", source = {}, target = {}, text = "" } = {}) => {
    const sourceType = String(source.entityType || "");
    const targetType = String(target.entityType || "");
    const normalized = normalizeEntityToken(text);
    const sourceLabel = normalizeEntityToken(source.label || "");
    const targetLabel = normalizeEntityToken(target.label || "");
    const sourceBeforeTarget = normalized.indexOf(sourceLabel) >= 0 && normalized.indexOf(targetLabel) >= 0
      ? normalized.indexOf(sourceLabel) <= normalized.indexOf(targetLabel)
      : true;
    const typed = (type = "") => [source, target].find((entity) => String(entity.entityType || "") === type) || null;
    if (relationType === "healed_by") {
      const patient = [source, target].find((entity) => entity.entityType === "proper-noun") || target;
      const healer = [source, target].find((entity) => entity.id !== patient.id && ["object", "proper-noun", "source"].includes(entity.entityType)) || source;
      return { source: patient, target: healer };
    }
    if (relationType === "cannot_speak") {
      const people = [source, target].filter((entity) => entity.entityType === "proper-noun");
      const speechPatterns = [/\b(?:cannot|can t|could not|unable|mute|muto|muta|non poteva|non riesce|sin voz|no podia|no podia|ne pouvait pas|incapable)\b.{0,80}\b(?:speak|talk|parlare|parla|hablar|parler|sprechen|voce|voz)\b/];
      const patient = semanticPersonBeforeCue(text, people, speechPatterns, 260) || typed("proper-noun") || source;
      const concept = typed("concept") || typed("quote") || null;
      if (!concept) return { source: null, target: null };
      return { source: patient, target: concept };
    }
    if (["has_property", "seeks", "asks_for", "discovers", "teaches"].includes(relationType)) return { source: typed("proper-noun") || source, target: typed("concept") || typed("object") || target };
    if (relationType === "uses") return { source: typed("proper-noun") || source, target: typed("object") || target };
    if (relationType === "causes") {
      const mechanism = [source, target].find((entity) =>
        ["object", "source", "location"].includes(entity.entityType) &&
        semanticHealingMechanismEvidence(text, entity, [source, target].find((candidate) => candidate.id !== entity.id) || {})
      );
      const outcome = [source, target].find((entity) => entity.id !== mechanism?.id && semanticSpeechConcept(entity));
      if (mechanism && outcome) return { source: mechanism, target: outcome };
    }
    if (relationType === "lives_in") return { source: typed("proper-noun") || source, target: typed("location") || target };
    if (relationType === "is_part_of") return sourceType === "source" && targetType !== "source" ? { source: target, target: source } : { source, target };
    if (["gives_to", "receives_from"].includes(relationType) && sourceType === "proper-noun" && targetType === "proper-noun") {
      return sourceBeforeTarget ? { source, target } : { source: target, target: source };
    }
    if (relationType === "friend_of") return normalizeRelationPair(source, target, "co_occurs");
    return { source, target };
  };

  const customSemanticRulePatterns = (values = []) => customRuleValues(values).map((value) => {
    try {
      return new RegExp(value, "i");
    } catch (_) {
      return new RegExp(escapedRegExp(value), "i");
    }
  });

  const inferCustomSemanticRelation = ({ source = {}, target = {}, chunk = {}, config = {} } = {}) => {
    const rules = customKnowledgeRules(config);
    const relationRules = Array.isArray(rules.semanticRelationRules)
      ? rules.semanticRelationRules
      : Array.isArray(rules.relationRules)
        ? rules.relationRules
        : [];
    if (!relationRules.length) return null;
    const text = chunk?.text || "";
    const context = normalizeEntityToken(semanticContext(text, source, target));
    if (!context) return null;
    for (const rule of relationRules) {
      if (!rule || typeof rule !== "object") continue;
      const relationType = String(rule.relationType || rule.type || "").toLowerCase().trim();
      if (!relationType || !semanticRelationTypes.has(relationType) || !semanticRelationAllowed(relationType, config)) continue;
      const sourceTypes = customRuleValues(rule.sourceTypes || rule.sourceType);
      const targetTypes = customRuleValues(rule.targetTypes || rule.targetType);
      if (sourceTypes.length && !sourceTypes.includes(String(source.entityType || ""))) continue;
      if (targetTypes.length && !targetTypes.includes(String(target.entityType || ""))) continue;
      const cuePatterns = customSemanticRulePatterns(rule.cuePatterns || rule.patterns || rule.cues);
      const negativePatterns = customSemanticRulePatterns(rule.negativePatterns || rule.blockPatterns || rule.excludePatterns);
      if (negativePatterns.some((pattern) => pattern.test(context))) continue;
      if (!cuePatterns.length && rule.allowWithoutCue !== true) continue;
      if (cuePatterns.length && !cuePatterns.some((pattern) => pattern.test(context))) continue;
      const oriented = orientSemanticRelation({ relationType, source, target, text });
      if (!oriented.source?.id || !oriented.target?.id || oriented.source.id === oriented.target.id) continue;
      return {
        relationType,
        source: oriented.source,
        target: oriented.target,
        confidence: Math.max(0.4, Math.min(0.98, Number(rule.confidence || 0.72))),
        evidence: semanticEvidenceForRelation(text, oriented.source, oriented.target),
        explanation: String(rule.explanation || `custom rule: ${relationType}`),
        method: "custom-rule",
      };
    }
    return null;
  };

  const inferRuleSemanticRelation = ({ source = {}, target = {}, relation = {}, chunk = {}, config = {} } = {}) => {
    if (!source?.id || !target?.id || source.id === target.id) return null;
    const customRelation = inferCustomSemanticRelation({ source, target, chunk, config });
    if (customRelation) return customRelation;
    const text = chunk?.text || "";
    const context = normalizeEntityToken(semanticContext(text, source, target));
    if (!context) return null;
    const typed = semanticEntityTypes(source, target);
    const types = new Set([source.entityType || "", target.entityType || ""]);
    const people = typed.people.filter((entity) => !semanticNonPersonProperNoun(entity));
    const hasPerson = typed.people.length > 0;
    const hasLocation = typed.locations.length > 0;
    const hasConcept = typed.concepts.length > 0;
    const hasObject = typed.objects.length > 0;
    const hasSource = typed.sources.length > 0;
    const hasAny = (patterns = []) => patterns.some((pattern) => pattern.test(context));
    const friendPatterns = [/\b(?:friend|friends|friendship|amico|amica|amici|amicizia|amigo|amiga|amistad|ami|amie|amis|amies|freund|freundschaft)\b/];
    const attemptedHelpPatterns = [/\b(?:tried|tries|trying|attempted|cerca(?:va)?|tenta(?:va)?|prova(?:va)?|intenta(?:ba)?|essaya(?:it)?|tent(?:a|ait|er)|versucht(?:e)?)\b.{0,80}\b(?:help|aiut|ayud|aider|aid(?:e|er)?|helf)\b/];
    const helpPatterns = [/\b(?:helped|helps|help|aiuta|aiuto|aiut[oò]|ayuda|ayud[oó]|aide|aida|aid(?:e|er)?|hilft|half)\b/];
    const healPatterns = [/\b(?:heal|healed|heals|cure|cured|remede|remède|gueri|gu[eé]ri|guerir|gu[eé]rir|gu[eé]rison|cura|cur[oò]|guarisce|guar[iì]|guarito|sana|san[oó])\b/];
    const healingObjectPatterns = [/\b(?:remede|remède|rimedio|cura|cure|solution|soluzione)\b/];
    const weaponObjectPatterns = [/\b(?:bastone|stick|palo|spada|sword|arma|weapon|pietra|stone)\b/];
    const speechPatterns = [/\b(?:cannot|can t|could not|unable|mute|muto|muta|non poteva|non riesce|sin voz|no podia|no podia|ne pouvait pas|incapable)\b.{0,80}\b(?:speak|talk|parlare|parla|hablar|parler|sprechen|voce|voz)\b/];
    const propertyPatterns = [/\b(?:has|had|have|property|quality|possesses|possessed|possiede|possedeva|proprieta|proprietà|poder|pouvoir|potere|capacit[eé]|capacidad)\b/];
    const livesInPatterns = [/\b(?:lives|lived|dwells|abita|abitava|vive|viveva|vivia|vivía|habite|wohn)\b/];
    const seekPatterns = [/\b(?:seeks|seek|searches|search|looking for|find|cerca|cercava|trova|trovare|busca|chercher|sucht|findet)\b/];
    const opposePatterns = [/\b(?:opposes|opposed|against|contro|oppone|opposto|contrasta|contra|gegen|defeats|sconfigge|vince)\b/];
    const askPatterns = [/\b(?:asks for|asked for|request|requested|chiede|chiese|domanda|pide|pidio|pidió|demande|fragt nach)\b/];
    const receivePatterns = [/\b(?:receives|received|riceve|ricevette|recibe|recibio|recibió|reçoit|bekommt|erh[aä]lt)\b/];
    const givePatterns = [/\b(?:gives|gave|donates|diede|offre|consegna|entrega|donne|gibt)\b/];
    const discoveryPatterns = [/\b(?:discovers|discovered|finds|found|scopre|scopr[iì]|descubre|découvre|decouvre|entdeckt)\b/];
    let relationType = "";
    let confidence = Math.max(0.58, Math.min(0.94, Number(relation.confidence || 0.62) + 0.08));
    if (
      people.length === 2 &&
      (
        semanticBothEntitiesNearCue(text, source, target, friendPatterns, 110) ||
        semanticCueBetweenEntities(text, source, target, friendPatterns)
      )
    ) relationType = "friend_of";
    else if (hasPerson && semanticPersonNearCue(text, typed.people, attemptedHelpPatterns, 220)) relationType = "tries_to_help";
    else if (hasPerson && semanticPersonNearCue(text, typed.people, helpPatterns, 180)) relationType = "helps";
    else if (
      hasPerson &&
      hasObject &&
      semanticPersonBeforeCue(text, typed.people, healPatterns, 280) &&
      typed.objects.some((entity) =>
        healingObjectPatterns.some((pattern) => pattern.test(normalizeEntityToken(entity.label || ""))) &&
        !weaponObjectPatterns.some((pattern) => pattern.test(normalizeEntityToken(entity.label || ""))) &&
        semanticHasCueNearEntity(text, entity, healPatterns.concat(healingObjectPatterns), 220)
      )
    ) relationType = "healed_by";
    else if (
      hasObject &&
      hasConcept &&
      typed.concepts.some((concept) => semanticSpeechConcept(concept)) &&
      typed.objects.some((object) =>
        typed.concepts.some((concept) => semanticHealingMechanismEvidence(text, object, concept))
      )
    ) relationType = "causes";
    else if (
      hasPerson &&
      hasObject &&
      people.some((person) =>
        typed.objects.some((object) => semanticActionObjectEvidence(text, person, object, people.filter((other) => other.id !== person.id)))
      )
    ) relationType = "uses";
    else if (
      (hasConcept || types.has("quote")) &&
      people.length &&
      typed.concepts.concat([source, target].filter((entity) => entity.entityType === "quote")).some((entity) => semanticSpeechConcept(entity) || entity.entityType === "quote") &&
      semanticPersonBeforeCue(text, people, speechPatterns, 260)
    ) relationType = "cannot_speak";
    else if (
      hasPerson &&
      hasLocation &&
      semanticPersonBeforeCue(text, typed.people, livesInPatterns, 160) &&
      typed.locations.some((entity) => semanticEntityAfterCue(text, entity, livesInPatterns, 180))
    ) relationType = "lives_in";
    else if (
      hasPerson &&
      (hasObject || hasConcept || hasSource) &&
      semanticPersonBeforeCue(text, typed.people, seekPatterns, 220) &&
      typed.objects.concat(typed.concepts, typed.sources).some((entity) => !semanticWeakEntity(entity) && semanticEntityAfterCue(text, entity, seekPatterns, 240))
    ) relationType = "seeks";
    else if (hasPerson && hasAny([/\b(?:protects|protected|protect|difende|protegge|protesse|protege|prot[eè]ge|sch[uü]tz)\b/])) relationType = "protects";
    else if (
      hasAny(opposePatterns) &&
      (
        (typed.people.length && types.has("creature") && [source, target].some((entity) => entity.entityType === "creature" && semanticEntityAfterCue(text, entity, opposePatterns, 220))) ||
        (typed.people.length && typed.concepts.some((entity) =>
          /^(?:peccato|morte|nemico|condanna|male|paura|danger|pericolo)$/.test(normalizeEntityToken(entity.label || "")) &&
          semanticEntityAfterCue(text, entity, opposePatterns, 220)
        ))
      ) &&
      !hasLocation
    ) relationType = "opposes";
    else if (hasAny([/\b(?:causes|caused|cause|because|provoca|causa|caus[oò]|produce|produjo|provoque|weil)\b/])) relationType = "causes";
    else if (hasAny([/\b(?:leads to|led to|porta a|conduce a|conduit a|führt zu|risultato|outcome|consequence)\b/])) relationType = "leads_to";
    else if (hasSource && hasAny([/\b(?:part of|included in|belongs to|parte di|compreso in|appartiene a|parte de|incluido en|partie de|teil von)\b/])) relationType = "is_part_of";
    else if (hasAny([/\b(?:teaches|taught|teach|insegna|insegn[oò]|enseña|enseign|lehrt|spiega|explains)\b/])) relationType = "teaches";
    else if (
      people.length &&
      hasAny(discoveryPatterns) &&
      [source, target].some((entity) => {
        const discoverer = semanticPersonBeforeCue(text, people, discoveryPatterns, 120);
        if (!discoverer || entity.id === discoverer.id) return false;
        const contextText = normalizeEntityToken(semanticContext(text, discoverer, entity, 90));
        const cuePositions = semanticCuePositions(contextText, discoveryPatterns);
        const label = normalizeEntityToken(entity.label || "");
        const labelPositions = label
          ? [...contextText.matchAll(new RegExp(`\\b${escapedRegExp(label)}\\b`, "g"))].map((match) => match.index || 0)
          : [];
        return semanticDiscoveryTargetAllowed(entity) &&
          cuePositions.some((cuePosition) =>
            labelPositions.some((labelPosition) => labelPosition > cuePosition && labelPosition - cuePosition <= 55)
          );
      })
    ) relationType = "discovers";
    else if (
      hasPerson &&
      (hasObject || hasConcept || hasSource) &&
      semanticPersonBeforeCue(text, typed.people, askPatterns, 180) &&
      typed.objects.concat(typed.concepts, typed.sources).some((entity) => semanticEntityAfterCue(text, entity, askPatterns, 220))
    ) relationType = "asks_for";
    else if (
      typed.people.length >= 2 &&
      semanticBothEntitiesNearCue(text, source, target, receivePatterns, 180)
    ) relationType = "receives_from";
    else if (
      typed.people.length >= 2 &&
      semanticBothEntitiesNearCue(text, source, target, givePatterns, 180)
    ) relationType = "gives_to";
    else if (
      (hasConcept || hasObject) &&
      !hasLocation &&
      typed.objects.concat(typed.concepts).length >= 2 &&
      !typed.concepts.some((entity) => semanticSpeechConcept(entity)) &&
      hasAny(propertyPatterns) &&
      typed.objects.concat(typed.concepts).some((entity) => semanticHasCueNearEntity(text, entity, propertyPatterns, 180))
    ) {
      relationType = "has_property";
      confidence = Math.max(0.56, confidence - 0.08);
    }
    if (!relationType || !semanticRelationTypes.has(relationType)) return null;
    const oriented = orientSemanticRelation({ relationType, source, target, text });
    if (!oriented.source?.id || !oriented.target?.id || oriented.source.id === oriented.target.id) return null;
    const relationEvidence = relationType === "uses"
      ? semanticActionObjectEvidence(text, oriented.source, oriented.target, people.filter((other) => other.id !== oriented.source.id)) || semanticEvidenceForRelation(text, source, target)
      : relationType === "causes"
        ? semanticHealingMechanismEvidence(text, oriented.source, oriented.target) || semanticEvidenceForRelation(text, source, target)
        : semanticEvidenceForRelation(text, source, target);
    return {
      relationType,
      source: oriented.source,
      target: oriented.target,
      confidence,
      evidence: relationEvidence,
      explanation: semanticRelationLabels[relationType] || "semantic rule cue",
      method: "rule",
    };
  };

  const semanticRelationAllowed = (relationType = "", config = {}) => {
    const allowed = splitConfigList(config.relationTypes).map((item) => item.toLowerCase());
    return !allowed.length || allowed.includes(String(relationType || "").toLowerCase());
  };

  const pickAiProvider = async (config = {}) => {
    const requestedProfile = String(config.providerProfile || config.profileId || "").trim();
    const requestedType = String(config.providerType || config.provider || "").trim().toLowerCase();
    const requested = String(config.provider || config.providerProfile || "").trim().toLowerCase();
    if ([requestedProfile, requestedType, requested].some((value) => ["local", "rules", "none"].includes(value))) return null;
    const data = await window.TrackerLensAiRuntimeStore?.list?.().catch(() => null);
    const providers = data?.providers || window.TrackerLensAiRuntimeStore?.localProviderDefaults?.() || [];
    return providers.find((provider) => requestedProfile && provider.id === requestedProfile)
      || providers.find((provider) =>
        requestedType &&
        [provider.id, provider.name, provider.provider, provider.providerType].some((value) => String(value || "").toLowerCase() === requestedType))
      || providers.find((provider) =>
        requested &&
        [provider.id, provider.name, provider.provider, provider.providerType].some((value) => String(value || "").toLowerCase().includes(requested)))
      || providers.find((provider) => provider.local && provider.status === "online")
      || providers.find((provider) => provider.local)
      || null;
  };

  const isLocalChatEndpoint = (endpoint = "") => {
    try {
      const url = new URL(endpoint);
      return ["127.0.0.1", "localhost", "::1"].includes(url.hostname) &&
        ["1234", "11434", ""].includes(url.port) &&
        /\/(v1\/chat\/completions|v1\/responses|api\/generate)$/.test(url.pathname);
    } catch {
      return false;
    }
  };

  const postChatJson = async ({ url = "", body = {}, headers = {} } = {}) => {
    if (isLocalChatEndpoint(url) && typeof window !== "undefined" && /^https?:/i.test(window.location?.protocol || "")) {
      const proxyResponse = await fetch("api/ai-chat-proxy.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: url, body }),
      }).catch(() => null);
      const contentType = proxyResponse?.headers?.get?.("content-type") || "";
      if (proxyResponse && proxyResponse.status !== 404 && contentType.includes("application/json")) return proxyResponse;
    }
    return fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  };

  const chatErrorText = async (response = null) => {
    const text = await response?.text?.().catch(() => "");
    if (!text) return "";
    return String(text || "").replace(/\s+/g, " ").trim();
  };

  const withOpenAiChatApiBase = (endpoint = "") => {
    const clean = String(endpoint || "http://127.0.0.1:1234").replace(/\/+$/g, "");
    return clean.endsWith("/v1") ? clean : `${clean}/v1`;
  };

  const resolveOpenAiCompatibleModel = async ({ provider = {}, model = "" } = {}) => {
    const requested = String(model || provider.model || "").trim();
    const endpoint = withOpenAiChatApiBase(provider.endpoint);
    try {
      const response = await fetch(`${endpoint}/models`);
      if (!response.ok) return requested || "local-model";
      const data = await response.json();
      const models = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
      const ids = models.map((item) => String(item?.id || item?.name || item?.model || item || "").trim()).filter(Boolean);
      const exact = ids.find((id) => id === requested);
      if (exact) return exact;
      const fuzzy = requested && requested !== "local-model"
        ? ids.find((id) => id.toLowerCase().includes(requested.toLowerCase()) || requested.toLowerCase().includes(id.toLowerCase()))
        : "";
      if (fuzzy) return fuzzy;
      const chatModel = ids.find((id) => !/embed/i.test(id)) || ids[0];
      return chatModel || requested || "local-model";
    } catch {
      return requested || "local-model";
    }
  };

  const parseSemanticAiRelations = (text = "") => {
    const clean = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start < 0 || end <= start) return [];
    try {
      const parsed = JSON.parse(clean.slice(start, end + 1));
      return Array.isArray(parsed?.relations) ? parsed.relations : [];
    } catch {
      return [];
    }
  };

  const extractBalancedJsonObjectText = (text = "") => {
    const clean = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const start = clean.indexOf("{");
    if (start < 0) return "";
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let index = start; index < clean.length; index += 1) {
      const char = clean[index];
      if (escape) {
        escape = false;
        continue;
      }
      if (char === "\\") {
        escape = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (char === "{") depth += 1;
      if (char === "}") {
        depth -= 1;
        if (depth === 0) return clean.slice(start, index + 1);
      }
    }
    const end = clean.lastIndexOf("}");
    return end > start ? clean.slice(start, end + 1) : "";
  };

  const parseAiJsonObject = (text = "") => {
    const jsonText = extractBalancedJsonObjectText(text);
    if (!jsonText) return null;
    const attempts = [
      jsonText,
      jsonText
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/,\s*([}\]])/g, "$1"),
    ];
    for (const attempt of unique(attempts)) {
      try {
        return JSON.parse(attempt);
      } catch {}
    }
    return null;
  };

  const callSemanticAi = async ({ candidates = [], config = {} } = {}) => {
    const mode = String(config.enrichmentMode || "ai").toLowerCase();
    if (!["ai", "hybrid"].includes(mode) || !candidates.length) return { relations: [], provider: "", model: "", error: "" };
    const provider = await pickAiProvider(config);
    if (!provider) return { relations: [], provider: "", model: "", error: "provider-not-found" };
    const providerType = String(provider.provider || provider.providerType || config.providerType || config.provider || "").toLowerCase();
    const model = String(config.model || provider.model || (providerType === "ollama" ? "llama3.1" : "local-model")).trim();
    const systemPrompt = knowledgeAiTextConfig(
      config.systemPrompt,
      [
        "You are a Semantic Relation Enricher. Classify candidate entity pairs into high-signal semantic relations using only supplied evidence.",
        "For narrative text, respect event order and causal roles. Do not turn a later consequence into the direct cause of an earlier event.",
      ].join(" ")
    );
    const promptTemplate = knowledgeAiTextConfig(
      config.promptTemplate,
      [
        "Use only candidate evidence text and chunk context. Prefer explicit semantic relations over generic links and reject unsupported pairs.",
        "Use healed_by only when the evidence directly shows the patient being cured by that object/source, for example drinking, taking, receiving, preparing or using it.",
        "If an object gains a healing property after the cure, classify that as has_property or causes only when supported, not as person healed_by object.",
      ].join(" ")
    );
    const outputInstructions = knowledgeAiTextConfig(
      config.outputInstructions,
      "Return strict JSON with relations containing candidateId, relationType, confidence and explanation."
    );
    const prompt = [
      systemPrompt,
      promptTemplate,
      outputInstructions,
      `Allowed relation types: ${[...semanticRelationTypes].join(", ")}`,
      "Return strict JSON only: {\"relations\":[{\"candidateId\":\"...\",\"relationType\":\"helps\",\"confidence\":0.0,\"explanation\":\"short evidence reason\"}]}",
      "Use only the provided evidence text. Do not invent facts.",
      "Reject a candidate by omitting it from relations.",
      JSON.stringify({ candidates }, null, 2),
    ].join("\n\n");
    try {
      const endpoint = String(provider.endpoint || (providerType === "ollama" ? "http://127.0.0.1:11434" : "http://127.0.0.1:1234")).replace(/\/+$/g, "");
      const url = providerType === "ollama"
        ? `${endpoint}/api/generate`
        : `${endpoint.endsWith("/v1") ? endpoint : `${endpoint}/v1`}/chat/completions`;
      const body = providerType === "ollama"
        ? {
          model,
          prompt,
          stream: false,
          options: {
            temperature: knowledgeAiNumberConfig(config.temperature, 0.1),
            top_p: knowledgeAiNumberConfig(config.topP, 0.9),
            num_predict: knowledgeCompletionLimit({ config, providerType, provider, requested: 900, min: 1 }),
          },
        }
        : {
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: knowledgeAiNumberConfig(config.temperature, 0.1),
          max_tokens: knowledgeCompletionLimit({ config, providerType, provider, requested: 900, min: 1 }),
          top_p: knowledgeAiNumberConfig(config.topP, 0.9),
        };
      knowledgeLlmDebug("semantic-enricher:request", {
        mode,
        provider: provider.id || providerType || "",
        providerType,
        model,
        candidateCount: candidates.length,
        promptChars: prompt.length,
        maxTokens: body.max_tokens || body.options?.num_predict || 0,
        promptPreview: compactDebugText(prompt),
      });
      const response = await postChatJson({ url, body, headers: headersForProvider(provider, config) });
      if (!response.ok) return { relations: [], provider: provider.id || providerType, model, error: `HTTP ${response.status}` };
      const data = await response.json();
      const text = data.response || data.choices?.[0]?.message?.content || data.output_text || "";
      const usage = knowledgeAiUsageFromResponse({ data, prompt, text });
      return {
        relations: parseSemanticAiRelations(text),
        provider: provider.id || providerType || "provider",
        model: data.model || model,
        usage,
        error: "",
      };
    } catch (error) {
      return { relations: [], provider: provider.id || providerType || "provider", model, usage: {}, error: error?.message || "ai-error" };
    }
  };

  const builderAllowedRelationTypes = (config = {}) => {
    const configured = splitConfigList(config.relationTypes).map((item) => item.toLowerCase());
    const allowed = configured.length ? configured : [...graphBuilderRelationTypes];
    return new Set(allowed.filter((item) => graphBuilderRelationTypes.has(item)));
  };

  const callGraphBuilderAi = async ({ chunks = [], entities = [], relations = [], config = {} } = {}) => {
    const provider = await pickAiProvider({ ...config, enrichmentMode: "ai" });
    if (!provider) return { proposal: null, provider: "", model: "", error: "provider-not-found" };
    const providerType = String(provider.provider || provider.providerType || config.providerType || config.provider || "").toLowerCase();
    const requestedModel = String(config.model || provider.model || (providerType === "ollama" ? "llama3.1" : "local-model")).trim();
    const model = providerType === "ollama"
      ? requestedModel
      : await resolveOpenAiCompatibleModel({ provider, model: requestedModel });
    const allowedRelationTypes = [...builderAllowedRelationTypes(config)];
    const maxEntities = Number.isFinite(Number(config.maxEntities)) && Number(config.maxEntities) > 0
      ? Math.floor(Number(config.maxEntities))
      : Number.POSITIVE_INFINITY;
    const maxRelations = Number.isFinite(Number(config.maxRelations)) && Number(config.maxRelations) > 0
      ? Math.floor(Number(config.maxRelations))
      : Number.POSITIVE_INFINITY;
    const systemPrompt = knowledgeAiTextConfig(
      config.systemPrompt,
      "You are a Knowledge Graph Builder Agent. Build a verified, evidence-backed knowledge graph from local document chunks while preserving temporal order, causal roles and source-language labels."
    );
    const promptTemplate = knowledgeAiTextConfig(
      config.promptTemplate,
      "Use chunks, existing entities and base relations as context. Propose only stable entities and precise relations directly supported by exact source quotes. Prefer explicit narrative or domain semantics over generic links, but reject weak or absent evidence."
    );
    const outputInstructions = knowledgeAiTextConfig(
      config.outputInstructions,
      "Return strict JSON with entities, relations and rejectedCandidates. Every accepted entity/relation must include confidence, explanation and an exact evidence.quote copied from one supplied chunk. Do not infer unsupported sequence, cause, count or identity."
    );
    const promptFor = ({ mode = "full" } = {}) => {
      const compact = mode === "compact";
      const micro = mode === "micro";
      const chunkLimit = chunks.length;
      const chunkTokens = micro
        ? promptChunkTokenBudget({ maxChunkTokens: config.maxChunkTokens || config.aiChunkTokens || config.chunkTokens, maxChunkChars: config.maxChunkChars, defaultChunkTokens: 0 })
        : compact
          ? promptChunkTokenBudget({ maxChunkTokens: config.maxChunkTokens || config.aiChunkTokens || config.chunkTokens, maxChunkChars: config.maxChunkChars, defaultChunkTokens: 0 })
          : promptChunkTokenBudget({ maxChunkTokens: config.maxChunkTokens || config.aiChunkTokens || config.chunkTokens, maxChunkChars: config.maxChunkChars, defaultChunkTokens: 0 });
      const entityLimit = Number.POSITIVE_INFINITY;
      const relationLimit = Number.POSITIVE_INFINITY;
      const effectiveMaxEntities = maxEntities;
      const effectiveMaxRelations = maxRelations;
      const limitInstruction = [
        Number.isFinite(effectiveMaxEntities) ? `entities <= ${effectiveMaxEntities}` : "",
        Number.isFinite(effectiveMaxRelations) ? `relations <= ${effectiveMaxRelations}` : "",
      ].filter(Boolean).join(", ");
      const compactSchema = {
        entities: [{ label: "", entityType: "proper-noun|technology|concept|object|location|source|term|symbol", confidence: 0.0, evidence: { chunkId: "", quote: "" } }],
        relations: [{ sourceLabel: "", targetLabel: "", relationType: allowedRelationTypes[0] || "mentions", confidence: 0.0, evidence: { chunkId: "", quote: "" }, explanation: "" }],
        rejectedCandidates: [],
      };
      return [
        micro ? "Build a tiny verified knowledge graph. Return JSON only." : systemPrompt,
        promptTemplate,
        outputInstructions,
        "Every accepted entity and relation must include evidence.quote copied verbatim from one provided chunk.",
        "Reject weak or absent evidence. Do not invent facts.",
        "Prefer high-signal semantic relations over generic mentions/contains. For stories, prefer friend_of, helps, reveals, protects, opposes, healed_by, asks_for, gives_to, receives_from when explicit evidence supports them.",
        "Use mentions only for source/document/reference statements, not for ordinary character encounters.",
        `Allowed relationType values: ${allowedRelationTypes.join(", ")}`,
        limitInstruction ? `Limits: ${limitInstruction}.` : "No Trackers Lens entity/relation cap is applied; return every supported graph fact.",
        !micro && config.domainHint ? `Domain hint: ${String(config.domainHint)}` : "",
        "Schema:",
        JSON.stringify(compactSchema),
        JSON.stringify({
          chunks: chunks.slice(0, chunkLimit).map((chunk) => ({ id: chunk.id, text: trimTextToEstimatedTokens(chunk.text || "", chunkTokens) })),
          entities: entities.slice(0, entityLimit).map((entity) => ({ id: entity.id, label: entity.label, entityType: entity.entityType })),
          relations: relations.slice(0, relationLimit).map((relation) => ({ source: relation.sourceLabel, type: relation.relationType, target: relation.targetLabel })),
        }),
      ].filter(Boolean).join("\n\n");
    };
    try {
      const endpoint = String(provider.endpoint || (providerType === "ollama" ? "http://127.0.0.1:11434" : "http://127.0.0.1:1234")).replace(/\/+$/g, "");
      const url = providerType === "ollama"
        ? `${endpoint}/api/generate`
        : `${endpoint.endsWith("/v1") ? endpoint : `${endpoint}/v1`}/chat/completions`;
      const attemptModes = providerType === "ollama" ? ["full", "compact", "micro"] : ["full", "compact", "micro"];
      let response = null;
      let lastError = "";
      let usedMode = attemptModes[0];
      let proposal = null;
      let lastModel = model;
      let totalUsage = {};
      const proposalHasPayload = (item = null) =>
        Array.isArray(item?.entities) || Array.isArray(item?.relations) || Array.isArray(item?.rejectedCandidates);
      const proposalHasSignal = (item = null) =>
        (item?.entities || []).length || (item?.relations || []).length || (item?.rejectedCandidates || []).length;
      const repairGraphBuilderJson = async ({ text = "", mode = "" } = {}) => {
        const rawText = String(text || "").trim();
        if (!rawText) return null;
        const repairPrompt = [
          "Convert the following model output into one strict JSON object for Knowledge Graph Builder.",
          "Return ONLY JSON. No markdown, no prose.",
          "Schema: {\"entities\":[{\"label\":\"\",\"entityType\":\"proper-noun|technology|concept|object|location|source|term|symbol\",\"confidence\":0.0,\"evidence\":{\"chunkId\":\"\",\"quote\":\"\"},\"explanation\":\"\"}],\"relations\":[{\"sourceLabel\":\"\",\"targetLabel\":\"\",\"relationType\":\"\",\"confidence\":0.0,\"evidence\":{\"chunkId\":\"\",\"quote\":\"\"},\"explanation\":\"\"}],\"rejectedCandidates\":[]}",
          `Allowed relationType values: ${allowedRelationTypes.join(", ")}`,
          "Keep only labels, relation types and evidence quotes already present in the model output. Do not invent new graph facts.",
          "Input:",
          rawText,
        ].join("\n\n");
        const repairMaxTokens = knowledgeCompletionLimit({ config, providerType, provider, requested: 900, min: 1 });
        const repairBody = providerType === "ollama"
          ? { model, prompt: repairPrompt, stream: false, format: "json", options: { temperature: 0.01, top_p: 0.9, num_predict: repairMaxTokens } }
          : withJsonObjectResponseFormat({ model, messages: [{ role: "user", content: repairPrompt }], temperature: 0.01, max_tokens: repairMaxTokens, top_p: 0.9 }, providerType, config);
        let repairResponse = await postChatJson({ url, body: repairBody, headers: headersForProvider(provider, config) });
        let repairErrorText = repairResponse.ok ? "" : await chatErrorText(repairResponse);
        if (!repairResponse.ok && providerType !== "ollama" && /json|format/i.test(repairErrorText)) {
          const fallbackBody = { ...repairBody };
          delete fallbackBody.response_format;
          repairResponse = await postChatJson({ url, body: fallbackBody, headers: headersForProvider(provider, config) });
          repairErrorText = repairResponse.ok ? "" : await chatErrorText(repairResponse);
        }
        if (!repairResponse.ok) {
          lastError = `repair-http-${repairResponse.status}${repairErrorText ? `: ${repairErrorText}` : ""}`;
          return null;
        }
        const repairData = await repairResponse.json();
        const repairText = repairData.response || repairData.choices?.[0]?.message?.content || repairData.output_text || "";
        totalUsage = addKnowledgeAiUsage(totalUsage, knowledgeAiUsageFromResponse({ data: repairData, prompt: repairPrompt, text: repairText }));
        lastModel = repairData.model || lastModel;
        const repaired = parseAiJsonObject(repairText);
        if (!proposalHasPayload(repaired) || !proposalHasSignal(repaired)) return null;
        return { proposal: repaired, promptMode: `${mode}-repair` };
      };
      for (const mode of attemptModes) {
        usedMode = mode;
        const prompt = promptFor({ mode });
        const body = providerType === "ollama"
          ? {
            model,
            prompt,
            stream: false,
            options: {
              temperature: knowledgeAiNumberConfig(config.temperature, 0.05),
              top_p: knowledgeAiNumberConfig(config.topP, 0.9),
              num_predict: knowledgeCompletionLimit({ config, providerType, provider, requested: 1400, min: 1 }),
            },
          }
          : {
            model,
            messages: [{ role: "user", content: prompt }],
            temperature: knowledgeAiNumberConfig(config.temperature, 0.05),
            max_tokens: knowledgeCompletionLimit({ config, providerType, provider, requested: 1400, min: 1 }),
            top_p: knowledgeAiNumberConfig(config.topP, 0.9),
          };
        const requestBody = providerType === "ollama"
          ? body
          : withJsonObjectResponseFormat(body, providerType, config);
        knowledgeLlmDebug("graph-builder:request", {
          mode,
          provider: provider.id || providerType || "",
          providerType,
          model,
          chunkCount: chunks.length,
          entityCount: entities.length,
          relationCount: relations.length,
          promptChars: prompt.length,
          maxTokens: requestBody.max_tokens || requestBody.options?.num_predict || 0,
          promptPreview: compactDebugText(prompt),
        });
        response = await postChatJson({ url, body: requestBody, headers: headersForProvider(provider, config) });
        let errorText = response.ok ? "" : await chatErrorText(response);
        if (!response.ok && providerType !== "ollama" && /json|format/i.test(errorText)) {
          const fallbackBody = { ...requestBody };
          delete fallbackBody.response_format;
          response = await postChatJson({ url, body: fallbackBody, headers: headersForProvider(provider, config) });
          errorText = response.ok ? "" : await chatErrorText(response);
        }
        if (response.ok) {
          const data = await response.json();
          const text = data.response || data.choices?.[0]?.message?.content || data.output_text || "";
          const usage = knowledgeAiUsageFromResponse({ data, prompt, text });
          totalUsage = addKnowledgeAiUsage(totalUsage, usage);
          lastModel = data.model || lastModel;
          proposal = parseAiJsonObject(text);
          const hasPayload = proposalHasPayload(proposal);
          const hasSignal = proposalHasSignal(proposal);
          if (hasPayload && hasSignal) {
            return {
              proposal,
              provider: provider.id || providerType || "provider",
              model: lastModel,
              usage: totalUsage,
              promptMode: usedMode,
              error: "",
            };
          }
          if (!hasPayload) {
            const repaired = await repairGraphBuilderJson({ text, mode });
            if (repaired) {
              return {
                proposal: repaired.proposal,
                provider: provider.id || providerType || "provider",
                model: lastModel,
                usage: totalUsage,
                promptMode: repaired.promptMode,
                error: "",
              };
            }
          }
          lastError = hasPayload ? "empty-ai-proposal" : "invalid-ai-json";
          continue;
        }
        lastError = `HTTP ${response.status}${errorText ? `: ${errorText}` : ""}`;
        const canShrink = response.status === 400 || /context|token|too large|size/i.test(errorText);
        if (!canShrink) break;
      }
      if (!response?.ok) {
        return { proposal: null, provider: provider.id || providerType, model: lastModel, usage: totalUsage, error: lastError || "ai-error" };
      }
      return { proposal, provider: provider.id || providerType || "provider", model: lastModel, usage: totalUsage, promptMode: usedMode, error: lastError || "empty-ai-proposal" };
    } catch (error) {
      return { proposal: null, provider: provider.id || providerType || "provider", model, usage: {}, error: error?.message || "ai-error" };
    }
  };

  const evidenceQuoteInChunk = (chunk = {}, quote = "") => {
    const normalizedText = normalizeKnowledgeText(chunk?.text || "");
    const normalizedQuote = normalizeKnowledgeText(quote || "");
    return Boolean(normalizedQuote && normalizedQuote.length >= 8 && normalizedText.includes(normalizedQuote));
  };

  const graphBuilderEntityType = (value = "") => {
    const type = String(value || "term").toLowerCase();
    return ["proper-noun", "technology", "concept", "object", "location", "source", "term", "symbol"].includes(type) ? type : "term";
  };

  const graphBuilderNarrativeRelationTypes = new Set([
    "friend_of", "helps", "tries_to_help", "healed_by", "cannot_speak", "lives_in", "seeks",
    "protects", "opposes", "causes", "leads_to", "teaches", "discovers", "asks_for", "receives_from", "gives_to", "works_for", "encounters", "reveals",
  ]);

  const graphBuilderTechnicalRelationTypes = new Set([
    "uses", "implements", "explains", "stores_in", "retrieves_from", "powered_by", "depends_on",
    "interfaces_with", "connects_to", "configures", "loads", "splits", "splits_into", "processes", "transforms",
  ]);

  const graphBuilderTechnicalContext = (context = "", source = {}, target = {}) => {
    const text = normalizeEntityToken([
      context,
      source.label,
      source.normalized,
      source.entityType,
      target.label,
      target.normalized,
      target.entityType,
    ].filter(Boolean).join(" "));
    return /\b(?:api|app|application|browser|cache|class|client|code|component|config|configuration|database|db|dependency|endpoint|function|graph|http|indexeddb|interface|json|library|llm|model|node|php|prompt|provider|query|runtime|schema|script|server|service|store|system|token|tool|url|worker|workspace)\b/.test(text);
  };

  const graphBuilderTechnicalEntity = (entity = {}) =>
    ["source", "symbol", "technology"].includes(String(entity.entityType || "").toLowerCase()) ||
    graphBuilderTechnicalContext("", entity, {});

  const graphBuilderSymmetricRelationTypes = new Set(["friend_of", "compares_with"]);

  const graphBuilderLabelInText = (label = "", text = "") => {
    const normalizedLabel = normalizeEntityToken(label);
    const normalizedText = normalizeEntityToken(text);
    return Boolean(normalizedLabel && normalizedText && new RegExp(`\\b${escapedRegExp(normalizedLabel)}\\b`).test(normalizedText));
  };

  const graphBuilderEvidenceContext = (chunk = {}, quote = "", radius = 280) => {
    const text = String(chunk?.text || "");
    const cleanQuote = String(quote || "").trim();
    if (!text || !cleanQuote) return "";
    const index = text.indexOf(cleanQuote);
    if (index < 0) return cleanQuote;
    return text.slice(Math.max(0, index - radius), Math.min(text.length, index + cleanQuote.length + radius));
  };

  const graphBuilderWeakEntityCandidate = ({ label = "", entityType = "", quote = "", chunk = {} } = {}) => {
    const type = graphBuilderEntityType(entityType);
    const cleanLabel = String(label || "").trim();
    const normalizedLabel = normalizeEntityToken(cleanLabel);
    const normalizedQuote = normalizeEntityToken(quote);
    if (!normalizedLabel) return true;
    if (semanticWeakEntity({ label: cleanLabel })) return true;
    if (type === "proper-noun") {
      if (!/^[A-ZÀ-Ý]/.test(cleanLabel)) return true;
      const lexicalQuoteTokens = normalizedQuote.split(/\s+/).filter(Boolean);
      if (lexicalQuoteTokens.length <= 1 && normalizedQuote === normalizedLabel) return true;
    }
    if (["concept", "term"].includes(type) && normalizedQuote === normalizedLabel && normalizedLabel.length < 10) return true;
    const context = graphBuilderEvidenceContext(chunk, quote, 80);
    if (type === "proper-noun" && !graphBuilderLabelInText(cleanLabel, context)) return true;
    return false;
  };

  const graphBuilderRelationCompatible = ({ relationType = "", source = {}, target = {}, chunk = {}, quote = "" } = {}) => {
    const type = String(relationType || "").toLowerCase();
    const sourceType = String(source.entityType || "").toLowerCase();
    const targetType = String(target.entityType || "").toLowerCase();
    const context = graphBuilderEvidenceContext(chunk, quote, 320);
    if (type === "uses" && sourceType === "proper-noun" && targetType === "object") {
      const text = normalizeEntityToken(context);
      return graphBuilderLabelInText(source.label || source.sourceLabel || "", text) &&
        graphBuilderLabelInText(target.label || target.targetLabel || "", text) &&
        /\b(?:uses|used|use|using|utilizza|utilizz[oò]|usa|us[oò]|afferra|afferr[oò]|prende|prese|preso|impugna|impugn[oò]|brandisce|brand[iì]|wields|wielded|grabs|grabbed|takes|took|colpisce|colp[iì]|hit|hits|struck|strike|attacca|attacc[oò])\b/.test(text);
    }
    if (graphBuilderTechnicalRelationTypes.has(type)) {
      if (!graphBuilderTechnicalContext(context, source, target) && !graphBuilderTechnicalEntity(source) && !graphBuilderTechnicalEntity(target)) return false;
      return true;
    }
    if (!graphBuilderNarrativeRelationTypes.has(type)) return true;
    if (!graphBuilderLabelInText(source.label || source.sourceLabel || "", context)) return false;
    const targetLabel = normalizeEntityToken(target.label || target.targetLabel || "");
    const targetInContext = graphBuilderLabelInText(target.label || target.targetLabel || "", context);
    const speechCueTarget = type === "cannot_speak" &&
      ["speech", "voice", "voce", "parola", "speaking"].includes(targetLabel) &&
      /\b(?:cannot|can t|could not|unable|mute|speak|talk|voice|speech|non poteva|voce|parlare)\b/.test(normalizeEntityToken(context));
    if (!targetInContext && !speechCueTarget) return false;
    if (["friend_of", "helps", "tries_to_help", "protects", "teaches", "asks_for", "receives_from", "gives_to"].includes(type)) {
      if (sourceType !== "proper-noun") return false;
      if (!["proper-noun", "creature"].includes(targetType)) return false;
    }
    if (type === "friend_of" && !/\b(?:friend|friendship|amica|amico|amici|amicizia|legame|comprensione|bond)\b/.test(normalizeEntityToken(context))) return false;
    if (type === "mentions") {
      if (!["source", "technology"].includes(sourceType) && !["source", "technology"].includes(targetType)) return false;
    }
    if (type === "encounters") {
      if (!["proper-noun", "term"].includes(sourceType)) return false;
      if (!["proper-noun", "term", "creature"].includes(targetType)) return false;
      if (!/\b(?:meets|met|encounters|encountered|approaches|approached|avvicin[oò]|si avvicin[oò]|incontra|incontr[oò]|trova|trov[oò])\b/.test(normalizeEntityToken(context))) return false;
    }
    if (type === "works_for") {
      if (!["proper-noun", "source", "term"].includes(sourceType)) return false;
      if (!["proper-noun", "source", "technology", "term"].includes(targetType)) return false;
      if (!/\b(?:works for|work for|worked for|employee of|employed by|has a works for relationship|collaborates with|affiliated with|lavora per|empleado de|travaille pour)\b/.test(normalizeEntityToken(context))) return false;
    }
    if (type === "opposes") {
      const text = normalizeEntityToken(context);
      const strongOpposition = /\b(?:attack|attacked|struck|strike|hit|fight|fought|defeat|defeated|confront|confronted|against|opposes|opposed|contro|attacc|colp|sconfisse|sconfigge|affront|combatt)\b/.test(text);
      const weakDismissal = /\b(?:ignore|ignored|ignora|ignor[oò]|parole|words)\b/.test(text);
      if (!strongOpposition || weakDismissal) return false;
    }
    if (type === "seeks") {
      if (sourceType !== "proper-noun") return false;
      if (!["concept", "object", "source", "term"].includes(targetType)) return false;
    }
    if (type === "healed_by" && targetType === "concept") return false;
    if (type === "cannot_speak") {
      if (sourceType !== "proper-noun") return false;
      if (!["concept", "quote", "term"].includes(targetType)) return false;
      if (!["speech", "voice", "voce", "parola", "speaking"].includes(targetLabel)) return false;
    }
    if (["causes", "leads_to"].includes(type)) {
      const quoteText = normalizeEntityToken(quote);
      if (!graphBuilderLabelInText(source.label || source.sourceLabel || "", quoteText)) return false;
      if (!graphBuilderLabelInText(target.label || target.targetLabel || "", quoteText)) return false;
      if (!/\b(?:because|cause|caused|causes|leads to|led to|therefore|result|results|resulted|consequence|consequences|porta a|conduce|causa|caus[oò]|provoca|provoc[oò])\b/.test(quoteText)) return false;
    }
    return true;
  };

  const graphBuilderCredentialAtomLabels = new Set([
    "api key", "apikey", "credential", "credentials", "password", "secret", "token", "user name", "username",
  ]);

  const isGraphBuilderCredentialAtom = (label = "") =>
    graphBuilderCredentialAtomLabels.has(normalizeEntityToken(label));

  const normalizeGraphBuilderRelationType = (relation = {}) => {
    const relationType = String(relation?.relationType || "").toLowerCase().trim();
    const context = normalizeEntityToken([
      relation?.sourceLabel,
      relation?.targetLabel,
      relation?.evidence?.quote,
      relation?.explanation,
    ].filter(Boolean).join(" "));
    if (relationType === "helps") {
      if (/\b(?:interface|interfaces|interacting|interact|wrapper|adapter|client)\b/.test(context)) return "interfaces_with";
      if (/\b(?:connect|connection|url|database|endpoint)\b/.test(context)) return "connects_to";
      if (/\b(?:call|calls|called|method|function|invoke|invokes|uses|using)\b/.test(context)) return "uses";
    }
    if (relationType === "has_property" && /\b(?:works for|work for|worked for|employee of|employed by|has a works for relationship|affiliated with|lavora per|empleado de|travaille pour)\b/.test(context)) {
      return "works_for";
    }
    if (relationType === "mentions" && /\b(?:meets|met|encounters|encountered|approaches|approached|avvicin[oò]|si avvicin[oò]|incontra|incontr[oò])\b/.test(context)) {
      return "encounters";
    }
    if (relationType === "causes" && /\b(?:attack|attacked|struck|strike|hit|fight|fought|defeat|defeated|confront|confronted)\b/.test(context)) {
      return "opposes";
    }
    return relationType;
  };

  const normalizeGraphBuilderProposal = ({ proposal = {}, selectedChunks = [], config = {} } = {}) => {
    const entities = Array.isArray(proposal.entities) ? proposal.entities.map((item) => ({ ...item })) : [];
    const relations = Array.isArray(proposal.relations) ? proposal.relations.map((item) => ({ ...item })) : [];
    const rejectedCandidates = Array.isArray(proposal.rejectedCandidates) ? [...proposal.rejectedCandidates] : [];
    const normalizations = [];
    const chunkById = new Map(selectedChunks.map((chunk) => [chunk.id, chunk]));
    const fallbackChunk = selectedChunks[0] || null;
    const enabled = config.technicalNormalization !== false && String(config.technicalNormalization || "true").toLowerCase() !== "false";
    if (!enabled) return { entities, relations, rejectedCandidates, normalizations };

    relations.forEach((relation) => {
      const originalType = String(relation?.relationType || "").toLowerCase().trim();
      const normalizedType = normalizeGraphBuilderRelationType(relation);
      if (normalizedType && normalizedType !== originalType) {
        relation.relationType = normalizedType;
        relation.originalRelationType = originalType;
        normalizations.push({
          type: "relation-type",
          from: originalType,
          to: normalizedType,
          sourceLabel: relation.sourceLabel || "",
          targetLabel: relation.targetLabel || "",
        });
      }
      const relationType = String(relation?.relationType || "").toLowerCase().trim();
      const sourceLabel = normalizeEntityToken(relation?.sourceLabel || "");
      const targetLabel = normalizeEntityToken(relation?.targetLabel || "");
      const quote = normalizeEntityToken(relation?.evidence?.quote || "");
      if (
        relationType === "uses" &&
        sourceLabel &&
        targetLabel &&
        new RegExp(`\\busing\\s+${escapedRegExp(sourceLabel)}\\b`).test(quote) &&
        new RegExp(`\\b${escapedRegExp(targetLabel)}\\b`).test(quote)
      ) {
        const previousSource = relation.sourceLabel || "";
        relation.sourceLabel = relation.targetLabel || "";
        relation.targetLabel = previousSource;
        relation.originalRelationType = relation.originalRelationType || "uses";
        normalizations.push({
          type: "relation-orientation",
          relationType: "uses",
          from: `${previousSource} -> ${relation.sourceLabel || ""}`,
          to: `${relation.sourceLabel || ""} -> ${relation.targetLabel || ""}`,
        });
      }
    });

    const credentialRelations = relations.filter((relation) =>
      ["depends_on", "configures"].includes(String(relation?.relationType || "").toLowerCase()) &&
      isGraphBuilderCredentialAtom(relation?.targetLabel || "")
    );
    const credentialLabels = new Set(credentialRelations.map((relation) => normalizeEntityToken(relation.targetLabel || "")).filter(Boolean));
    if (credentialLabels.has("username") && credentialLabels.has("password")) {
      const seedRelation = credentialRelations.find((relation) => normalizeEntityToken(relation?.evidence?.quote || "").includes("username") && normalizeEntityToken(relation?.evidence?.quote || "").includes("password"))
        || credentialRelations[0];
      const seedChunk = chunkById.get(seedRelation?.evidence?.chunkId || "") || fallbackChunk;
      const quote = String(seedRelation?.evidence?.quote || "").trim();
      if (seedChunk && evidenceQuoteInChunk(seedChunk, quote)) {
        const aggregateLabel = "connection credentials";
        const aggregateKey = normalizeEntityToken(aggregateLabel);
        const hasAggregate = entities.some((entity) => normalizeEntityToken(entity?.label || "") === aggregateKey);
        if (!hasAggregate) {
          entities.push({
            label: aggregateLabel,
            entityType: "term",
            confidence: Math.max(0.72, Math.min(0.96, Number(seedRelation.confidence || 0.78))),
            evidence: { chunkId: seedChunk.id || "", quote },
          });
        }
        const sourceLabel = String(seedRelation.sourceLabel || "").trim();
        relations.push({
          sourceLabel,
          targetLabel: aggregateLabel,
          relationType: "depends_on",
          confidence: Math.max(0.72, Math.min(0.96, Number(seedRelation.confidence || 0.78))),
          evidence: { chunkId: seedChunk.id || "", quote },
          explanation: "Connection credentials are grouped from username/password evidence.",
          originalRelationType: "credential-aggregate",
        });
        normalizations.push({
          type: "credential-aggregate",
          labels: [...credentialLabels],
          sourceLabel,
          targetLabel: aggregateLabel,
        });
      }
    }

    const credentialRelationKeys = new Set(
      credentialLabels.has("username") && credentialLabels.has("password")
        ? ["username", "password"]
        : []
    );
    const filteredEntities = entities.filter((entity) => !credentialRelationKeys.has(normalizeEntityToken(entity?.label || "")));
    const filteredRelations = relations.filter((relation) => !credentialRelationKeys.has(normalizeEntityToken(relation?.targetLabel || "")));
    credentialRelationKeys.forEach((label) => rejectedCandidates.push({ label, reason: "normalized-into-connection-credentials" }));
    return { entities: filteredEntities, relations: filteredRelations, rejectedCandidates, normalizations };
  };

  const graphBuilderEvidenceSentence = (text = "", patterns = [], labels = []) => {
    const source = String(text || "");
    const sentences = source.match(/[^.!?\n\r]+[.!?]?/g) || [source];
    const normalizedLabels = labels.map((label) => normalizeEntityToken(label)).filter(Boolean);
    const found = sentences.find((sentence) => {
      const normalized = normalizeEntityToken(sentence);
      return patterns.some((pattern) => pattern.test(normalized)) &&
        normalizedLabels.every((label) => new RegExp(`\\b${escapedRegExp(label)}\\b`).test(normalized));
    });
    return String(found || "").replace(/\s+/g, " ").trim();
  };

  const graphBuilderEvidenceBetween = (text = "", source = {}, target = {}, radius = 180) =>
    String(relationContextBetween(text, source, target, radius) || "").replace(/\s+/g, " ").trim();

  const graphBuilderPersonBeforeTarget = (text = "", people = [], target = {}) => {
    const normalizedText = normalizeEntityToken(text);
    const targetLabel = normalizeEntityToken(target?.label || target?.targetLabel || "");
    if (!normalizedText || !targetLabel) return null;
    const targetPositions = [...normalizedText.matchAll(new RegExp(`\\b${escapedRegExp(targetLabel)}\\b`, "g"))].map((match) => match.index || 0);
    if (!targetPositions.length) return null;
    const targetPosition = Math.min(...targetPositions);
    const candidates = people
      .map((person) => {
        const label = normalizeEntityToken(person?.label || "");
        if (!label) return null;
        const positions = [...normalizedText.matchAll(new RegExp(`\\b${escapedRegExp(label)}\\b`, "g"))]
          .map((match) => match.index || 0)
          .filter((position) => position < targetPosition);
        if (!positions.length) return null;
        const position = Math.max(...positions);
        return { person, distance: targetPosition - position };
      })
      .filter(Boolean)
      .sort((left, right) => left.distance - right.distance);
    return candidates[0]?.person || null;
  };

  const addGraphBuilderSupplementalRelation = (relations = [], seen = new Set(), relation = {}) => {
    const key = [
      normalizeEntityToken(relation.sourceLabel || ""),
      String(relation.relationType || "").toLowerCase(),
      normalizeEntityToken(relation.targetLabel || ""),
      normalizeKnowledgeText(relation.evidence?.quote || ""),
    ].join("::");
    if (!relation.sourceLabel || !relation.targetLabel || !relation.relationType || !relation.evidence?.quote || seen.has(key)) return;
    seen.add(key);
    relations.push(relation);
  };

  const supplementGraphBuilderNarrativeRelations = ({ chunks = [], entityByLabel = new Map(), relations = [] } = {}) => {
    const supplemental = [];
    const seen = new Set(relations.map((relation) => [
      normalizeEntityToken(relation.sourceLabel || ""),
      String(relation.relationType || "").toLowerCase(),
      normalizeEntityToken(relation.targetLabel || ""),
      normalizeKnowledgeText(relation.evidence?.quote || ""),
    ].join("::")));
    const entities = [...entityByLabel.values()];
    const people = entities.filter((entity) =>
      String(entity.entityType || "").toLowerCase() === "proper-noun" &&
      !semanticNonPersonProperNoun(entity)
    );
    const quotes = entities.filter((entity) => String(entity.entityType || "").toLowerCase() === "quote");
    chunks.forEach((chunk) => {
      const text = String(chunk.text || "");
      const normalized = normalizeEntityToken(text);
      if (!normalized) return;
      const chunkPeople = people.filter((entity) => graphBuilderLabelInText(entity.label || "", text));
      if (chunkPeople.length >= 2 && /\b(?:friend|friendship|amica|amico|legame|comprensione|bond)\b/.test(normalized)) {
        for (let leftIndex = 0; leftIndex < chunkPeople.length; leftIndex += 1) {
          for (let rightIndex = leftIndex + 1; rightIndex < chunkPeople.length; rightIndex += 1) {
            const left = chunkPeople[leftIndex];
            const right = chunkPeople[rightIndex];
            const quote = graphBuilderEvidenceSentence(text, [/\b(?:friend|friendship|amica|amico|legame|comprensione|bond)\b/], [left.label, right.label]) ||
              graphBuilderEvidenceBetween(text, left, right, 160);
            if (!/\b(?:friend|friendship|amica|amico|legame|comprensione|bond)\b/.test(normalizeEntityToken(quote))) continue;
            addGraphBuilderSupplementalRelation(supplemental, seen, {
              sourceLabel: left.label,
              targetLabel: right.label,
              relationType: "friend_of",
              confidence: 0.86,
              evidence: { chunkId: chunk.id || "", quote },
              explanation: "Rule fallback found explicit friendship/bond evidence in the chunk.",
              originalRelationType: "rule-supplement",
            });
          }
        }
      }
      quotes.forEach((quoteEntity) => {
        if (!graphBuilderLabelInText(quoteEntity.label || "", text)) return;
        const speaker = graphBuilderPersonBeforeTarget(text, chunkPeople, quoteEntity);
        if (!speaker) return;
        const speakerContext = normalizeEntityToken(graphBuilderEvidenceBetween(text, speaker, quoteEntity, 220));
        if (!/\b(?:grido|grid[oò]|disse|dice|usc[iì]|shouted|said|cried|bocca|voce)\b/.test(speakerContext)) return;
        const quote = graphBuilderEvidenceSentence(text, [/\b(?:grido|grid[oò]|disse|dice|usc[iì]|shouted|said|cried)\b/], [speaker.label, quoteEntity.label]) ||
          graphBuilderEvidenceBetween(text, speaker, quoteEntity, 180) ||
          graphBuilderEvidenceSentence(text, [/\b(?:grido|grid[oò]|disse|dice|usc[iì]|shouted|said|cried)\b/], [quoteEntity.label]);
        addGraphBuilderSupplementalRelation(supplemental, seen, {
          sourceLabel: speaker.label,
          targetLabel: quoteEntity.label,
          relationType: "reveals",
          confidence: 0.84,
          evidence: { chunkId: chunk.id || "", quote },
          explanation: "Rule fallback found explicit speech/revelation evidence in the chunk.",
          originalRelationType: "rule-supplement",
        });
      });
    });
    return supplemental;
  };

  const buildKnowledgeGraphWithAi = async ({ workspaceId, node, payload = {}, event, config = {} } = {}) => {
    const [entitiesAll, relationsAll, chunksAll] = await Promise.all([
      listStore(STORES.entities),
      listStore(STORES.relations),
      listStore(STORES.chunks),
    ]);
    const collectionId = String(payload?.collectionId || payload?.metadata?.collectionId || config.collectionId || "").trim();
    const documentId = String(payload?.documentId || config.documentId || "").trim();
    const workspaceChunks = byWorkspace(chunksAll, workspaceId)
      .filter((chunk) => !collectionId || chunk.metadata?.collectionId === collectionId)
      .filter((chunk) => !documentId || chunk.documentId === documentId)
      .filter((chunk) => !looksLikeKnowledgeEnvelope(chunk.text || ""))
      .sort((left, right) => Date.parse(left.createdAt || "") - Date.parse(right.createdAt || ""));
    const payloadChunkIds = new Set((payload?.chunks || []).map((chunk) => chunk.id).filter(Boolean));
    const maxChunks = Number.isFinite(Number(config.maxChunks)) && Number(config.maxChunks) > 0 ? Math.floor(Number(config.maxChunks)) : Number.POSITIVE_INFINITY;
    const selectedChunks = (payloadChunkIds.size
      ? workspaceChunks.filter((chunk) => payloadChunkIds.has(chunk.id))
      : workspaceChunks
    ).slice(0, maxChunks);
    if (!selectedChunks.length) throw new Error("Chunk Knowledge non trovati per Knowledge Graph Builder Agent");
    const selectedDocumentId = documentId || selectedChunks[0]?.documentId || "";
    const replaceExistingBuilder = config.replaceExisting !== false && String(config.replaceExisting || "true").toLowerCase() !== "false";
    if (replaceExistingBuilder) {
      const staleBuilderRelations = byWorkspace(relationsAll, workspaceId)
        .filter((relation) => relation.metadata?.graphBuilder)
        .filter((relation) => !selectedDocumentId || relation.documentId === selectedDocumentId);
      const staleBuilderEntities = byWorkspace(entitiesAll, workspaceId)
        .filter((entity) => entity.metadata?.graphBuilder)
        .filter((entity) => !selectedDocumentId || entity.documentId === selectedDocumentId);
      await Promise.all([
        deleteRecords(STORES.relations, staleBuilderRelations.map((relation) => relation.id)),
        deleteRecords(STORES.entities, staleBuilderEntities.map((entity) => entity.id)),
      ]);
    }
    const staleBuilderEntityIds = new Set(byWorkspace(entitiesAll, workspaceId)
      .filter((entity) => entity.metadata?.graphBuilder)
      .filter((entity) => !selectedDocumentId || entity.documentId === selectedDocumentId)
      .map((entity) => entity.id));
    const workspaceEntities = byWorkspace(entitiesAll, workspaceId)
      .filter((entity) => !staleBuilderEntityIds.has(entity.id))
      .filter((entity) => !collectionId || entity.metadata?.collectionId === collectionId)
      .filter((entity) => !selectedDocumentId || entity.documentId === selectedDocumentId);
    const workspaceRelations = byWorkspace(relationsAll, workspaceId)
      .filter((relation) => !relation.metadata?.graphBuilder)
      .filter((relation) => !collectionId || relation.metadata?.collectionId === collectionId)
      .filter((relation) => !selectedDocumentId || relation.documentId === selectedDocumentId);
    const aiResult = await callGraphBuilderAi({ chunks: selectedChunks, entities: workspaceEntities, relations: workspaceRelations, config });
    if (aiResult.usage?.totalTokens) {
      await persistKnowledgeNodeTokenUsage({ node, usage: aiResult.usage, provider: aiResult.provider, model: aiResult.model });
    }
    const proposal = aiResult.proposal && typeof aiResult.proposal === "object" ? aiResult.proposal : {};
    const normalizedProposal = normalizeGraphBuilderProposal({ proposal, selectedChunks, config });
    const proposalEntities = normalizedProposal.entities;
    const proposalRelations = normalizedProposal.relations;
    const allowedRelationTypes = builderAllowedRelationTypes(config);
    const threshold = Math.max(0, Math.min(1, Number(config.confidenceThreshold ?? 0.65)));
    const maxEntities = Number.isFinite(Number(config.maxEntities)) && Number(config.maxEntities) > 0
      ? Math.floor(Number(config.maxEntities))
      : Number.POSITIVE_INFINITY;
    const maxRelations = Number.isFinite(Number(config.maxRelations)) && Number(config.maxRelations) > 0
      ? Math.floor(Number(config.maxRelations))
      : Number.POSITIVE_INFINITY;
    const chunkById = new Map(selectedChunks.map((chunk) => [chunk.id, chunk]));
    const fallbackChunk = selectedChunks[0];
    const entityByLabel = new Map(workspaceEntities.map((entity) => [normalizeEntityToken(entity.label || entity.normalized || ""), entity]));
    const acceptedEntities = [];
    const rejectedCandidates = [...normalizedProposal.rejectedCandidates];
    const now = nowIso();
    for (const item of proposalEntities.slice(0, maxEntities)) {
      const label = String(item?.label || "").replace(/\s+/g, " ").trim();
      if (!label || label.length > 96) continue;
      const quote = String(item?.evidence?.quote || "").trim();
      const chunk = chunkById.get(item?.evidence?.chunkId || "") || fallbackChunk;
      if (!evidenceQuoteInChunk(chunk, quote)) {
        rejectedCandidates.push({ label, reason: "missing-entity-evidence" });
        continue;
      }
      const key = normalizeEntityToken(label);
      const entityType = graphBuilderEntityType(item.entityType);
      if (!key || graphBuilderWeakEntityCandidate({ label, entityType, quote, chunk })) {
        rejectedCandidates.push({ label, reason: "weak-builder-entity" });
        continue;
      }
      const existing = entityByLabel.get(key);
      if (existing) {
        acceptedEntities.push(existing);
        continue;
      }
      const entityId = `kentity_${safeId(workspaceId)}_${safeId(chunk.documentId || selectedDocumentId || "doc")}_${safeId(key)}`;
      const record = {
        id: entityId,
        workspaceId,
        documentId: chunk.documentId || selectedDocumentId || "",
        chunkId: chunk.id || "",
        label,
        normalized: normalizeKnowledgeText(label),
        entityType,
        confidence: Math.max(threshold, Math.min(0.98, Number(item.confidence || 0.72))),
        source: "ai-graph-builder",
        metadata: {
          ...(chunk.metadata || {}),
          semantic: true,
          graphBuilder: true,
          inputChannel: event?.channel || "",
          nodeId: node?.id || "",
          language: chunk.metadata?.language || detectLanguage(chunk.text || "", config.language || ""),
          collectionId: chunk.metadata?.collectionId || collectionId,
          evidence: { quote, chunkId: chunk.id || "" },
          extraction: { method: "ai-graph-builder", providerId: aiResult.provider || "", model: aiResult.model || "", promptMode: aiResult.promptMode || "", promptVersion: "knowledge-graph-builder-v1" },
          aliases: [],
        },
        createdAt: now,
        updatedAt: now,
      };
      const saved = await putRecord(STORES.entities, record);
      entityByLabel.set(key, saved);
      acceptedEntities.push(saved);
    }
    proposalRelations.push(...supplementGraphBuilderNarrativeRelations({ chunks: selectedChunks, entityByLabel, relations: proposalRelations }));
    const existingSemanticKeys = new Set(byWorkspace(relationsAll, workspaceId)
      .filter((relation) => relation.metadata?.semantic || relation.metadata?.graphBuilder)
      .filter((relation) =>
        !(
          replaceExistingBuilder &&
          relation.metadata?.graphBuilder &&
          (!selectedDocumentId || relation.documentId === selectedDocumentId)
        )
      )
      .map((relation) => {
        const type = String(relation.relationType || "").toLowerCase();
        const pair = graphBuilderSymmetricRelationTypes.has(type)
          ? [relation.sourceEntityId || "", relation.targetEntityId || ""].sort()
          : [relation.sourceEntityId || "", relation.targetEntityId || ""];
        return [
          relation.documentId || "",
          type,
          pair[0],
          pair[1],
          graphBuilderSymmetricRelationTypes.has(type) ? "symmetric" : normalizeKnowledgeText(relation.evidence?.quote || ""),
        ].join("::");
      }));
    const acceptedRelations = [];
    for (const item of proposalRelations.slice(0, maxRelations)) {
      const relationType = String(item?.relationType || "").toLowerCase().trim();
      if (!allowedRelationTypes.has(relationType)) {
        rejectedCandidates.push({ label: `${item?.sourceLabel || ""} -> ${item?.targetLabel || ""}`, reason: "relation-type-not-allowed" });
        continue;
      }
      const confidence = Math.min(0.98, Number(item.confidence || 0));
      if (confidence < threshold) continue;
      const source = entityByLabel.get(normalizeEntityToken(item.sourceLabel || ""));
      const target = entityByLabel.get(normalizeEntityToken(item.targetLabel || ""));
      if (!source?.id || !target?.id || source.id === target.id) {
        rejectedCandidates.push({ label: `${item?.sourceLabel || ""} -> ${item?.targetLabel || ""}`, reason: "missing-accepted-entity" });
        continue;
      }
      const quote = String(item?.evidence?.quote || "").trim();
      const chunk = chunkById.get(item?.evidence?.chunkId || "") || fallbackChunk;
      if (!evidenceQuoteInChunk(chunk, quote)) {
        rejectedCandidates.push({ label: `${source.label} -> ${target.label}`, reason: "missing-relation-evidence" });
        continue;
      }
      if (!graphBuilderRelationCompatible({ relationType, source, target, chunk, quote })) {
        rejectedCandidates.push({ label: `${source.label} -> ${target.label}`, reason: "incompatible-narrative-relation" });
        continue;
      }
      const finalPair = relationType === "healed_by"
        ? orientSemanticRelation({ relationType, source, target, text: chunk?.text || quote || "" })
        : { source, target };
      const finalSource = finalPair.source || source;
      const finalTarget = finalPair.target || target;
      if (!finalSource?.id || !finalTarget?.id || finalSource.id === finalTarget.id) {
        rejectedCandidates.push({ label: `${source.label} -> ${target.label}`, reason: "invalid-oriented-relation" });
        continue;
      }
      const semanticKey = [
        chunk.documentId || selectedDocumentId || "",
        relationType,
        ...(graphBuilderSymmetricRelationTypes.has(relationType) ? [finalSource.id, finalTarget.id].sort() : [finalSource.id, finalTarget.id]),
        graphBuilderSymmetricRelationTypes.has(relationType) ? "symmetric" : normalizeKnowledgeText(quote),
      ].join("::");
      if (existingSemanticKeys.has(semanticKey)) continue;
      existingSemanticKeys.add(semanticKey);
      const relationId = `ksemantic_${safeId(chunk.documentId || selectedDocumentId || workspaceId)}_${safeId(relationType)}_${safeId(finalSource.normalized || finalSource.label)}_${safeId(finalTarget.normalized || finalTarget.label)}_${safeId(quote).slice(0, 28)}`;
      const record = {
        id: relationId,
        workspaceId,
        documentId: chunk.documentId || selectedDocumentId || "",
        chunkId: chunk.id || "",
        sourceEntityId: finalSource.id,
        targetEntityId: finalTarget.id,
        sourceLabel: finalSource.label,
        targetLabel: finalTarget.label,
        relationType,
        confidence,
        evidence: {
          text: quote,
          quote,
          startOffset: null,
          endOffset: null,
        },
        extraction: {
          method: "ai-graph-builder",
          providerId: aiResult.provider || "",
          model: aiResult.model || "",
          promptMode: aiResult.promptMode || "",
          promptVersion: "knowledge-graph-builder-v1",
        },
        metadata: {
          ...(chunk.metadata || {}),
          semantic: true,
          graphBuilder: true,
          inputChannel: event?.channel || "",
          nodeId: node?.id || "",
          collectionId: chunk.metadata?.collectionId || collectionId,
          originalRelationType: String(item.originalRelationType || item.relationType || "ai-proposed"),
          occurrenceCount: 1,
          sourceChunkIds: [chunk.id].filter(Boolean),
          explanation: String(item.explanation || ""),
          normalizations: normalizedProposal.normalizations.filter((normalization) =>
            !normalization.sourceLabel ||
            normalizeEntityToken(normalization.sourceLabel) === normalizeEntityToken(item.sourceLabel || "")
          ),
        },
        createdAt: now,
        updatedAt: now,
      };
      acceptedRelations.push(await putRecord(STORES.relations, record));
    }
    const context = acceptedRelations.length
      ? [
        "AI Knowledge Graph Builder accepted relations:",
        ...acceptedRelations.map((relation, index) =>
          `[GB${index + 1}] ${relation.sourceLabel} -${relation.relationType}-> ${relation.targetLabel} confidence=${Number(relation.confidence || 0).toFixed(2)} evidence="${String(relation.evidence?.quote || "")}"`
        ),
      ].join("\n")
      : "AI Knowledge Graph Builder accepted relations: none";
    return {
      id: uniqueId("kgraph_builder"),
      workspaceId,
      collectionId,
      documentId: selectedDocumentId,
      status: aiResult.error ? "fallback" : "ready",
      provider: aiResult.provider || "",
      model: aiResult.model || "",
      error: aiResult.error || "",
      proposed: {
        entityCount: proposalEntities.length,
        relationCount: proposalRelations.length,
        rawEntityCount: Array.isArray(proposal.entities) ? proposal.entities.length : 0,
        rawRelationCount: Array.isArray(proposal.relations) ? proposal.relations.length : 0,
        promptMode: aiResult.promptMode || "",
        normalizations: normalizedProposal.normalizations,
        rejectedCandidates,
      },
      entities: acceptedEntities,
      relations: acceptedRelations,
      semanticRelations: acceptedRelations,
      entityCount: acceptedEntities.length,
      relationCount: acceptedRelations.length,
      semanticRelationCount: acceptedRelations.length,
      context,
      createdAt: now,
    };
  };

  const enrichSemanticRelations = async ({ workspaceId, node, payload = {}, event, config = {} } = {}) => {
    const [entitiesAll, relationsAll, chunksAll] = await Promise.all([
      listStore(STORES.entities),
      listStore(STORES.relations),
      listStore(STORES.chunks),
    ]);
    const collectionId = String(payload?.collectionId || payload?.metadata?.collectionId || config.collectionId || "").trim();
    const documentId = String(payload?.documentId || config.documentId || "").trim();
    const workspaceEntities = byWorkspace(entitiesAll, workspaceId)
      .filter((entity) => !collectionId || entity.metadata?.collectionId === collectionId)
      .filter((entity) => !documentId || entity.documentId === documentId);
    const entityById = new Map(workspaceEntities.map((entity) => [entity.id, entity]));
    const payloadRelationIds = new Set((payload?.relations || []).map((relation) => relation.id).filter(Boolean));
    const workspaceRelations = byWorkspace(relationsAll, workspaceId)
      .filter((relation) => !relation.metadata?.semantic)
      .filter((relation) => entityById.has(relation.sourceEntityId) && entityById.has(relation.targetEntityId))
      .filter((relation) => !collectionId || relation.metadata?.collectionId === collectionId)
      .filter((relation) => !documentId || relation.documentId === documentId)
      .filter((relation) => !payloadRelationIds.size || payloadRelationIds.has(relation.id) || event?.channel === "knowledge.graph.updated");
    const scopedChunks = byWorkspace(chunksAll, workspaceId)
      .filter((chunk) => !collectionId || chunk.metadata?.collectionId === collectionId)
      .filter((chunk) => !documentId || chunk.documentId === documentId);
    const chunkById = new Map(scopedChunks.map((chunk) => [chunk.id, chunk]));
    const replaceExistingSemantic = config.replaceExisting !== false && String(config.replaceExisting || "true").toLowerCase() !== "false";
    const semanticCleanup = replaceExistingSemantic
      ? await deleteSemanticRelations({ workspaceId, collectionId, documentId, nodeId: node?.id || "" })
      : { relations: 0, ids: [] };
    const staleSemanticRelationIds = new Set(semanticCleanup.ids || []);
    const maxRelations = Number.isFinite(Number(config.maxRelations)) && Number(config.maxRelations) > 0
      ? Math.floor(Number(config.maxRelations))
      : Number.POSITIVE_INFINITY;
    const threshold = Math.max(0, Math.min(1, Number(config.confidenceThreshold ?? 0.55)));
    const enrichmentMode = ["ai", "hybrid"].includes(String(config.enrichmentMode || "ai").toLowerCase())
      ? String(config.enrichmentMode || "ai").toLowerCase()
      : "rules";
    const now = nowIso();
    const candidates = workspaceRelations.slice(0, Number.isFinite(maxRelations) ? maxRelations * 2 : Number.POSITIVE_INFINITY).map((relation) => {
      const source = entityById.get(relation.sourceEntityId);
      const target = entityById.get(relation.targetEntityId);
      const chunk = chunkById.get(relation.chunkId) || chunkById.get(relation.metadata?.chunkIds?.[0] || "");
      const evidence = semanticEvidenceForRelation(chunk?.text || "", source, target);
      return {
        id: relation.id,
        source,
        target,
        relation,
        chunk,
        evidence,
        text: evidence.text,
      };
    }).filter((candidate) => candidate.source && candidate.target);
    const aiInput = candidates
      .map((candidate) => ({
        candidateId: candidate.id,
        sourceLabel: candidate.source.label,
        sourceType: candidate.source.entityType,
        targetLabel: candidate.target.label,
        targetType: candidate.target.entityType,
        originalRelationType: candidate.relation.relationType,
        evidence: candidate.text,
        chunkContext: String(candidate.chunk?.text || ""),
      }));
    const aiResult = await callSemanticAi({ candidates: aiInput, config });
    if (aiResult.usage?.totalTokens) {
      await persistKnowledgeNodeTokenUsage({ node, usage: aiResult.usage, provider: aiResult.provider, model: aiResult.model });
    }
    const aiByCandidateId = new Map((aiResult.relations || [])
      .filter((item) => semanticRelationTypes.has(String(item.relationType || "").toLowerCase()))
      .filter((item) => semanticRelationAllowed(item.relationType, config))
      .map((item) => [String(item.candidateId || ""), item]));
    const semanticItems = [];
    candidates.forEach((candidate) => {
      const ai = aiByCandidateId.get(candidate.id);
      if (!ai) return;
      const relationType = String(ai.relationType || "").toLowerCase();
      const oriented = orientSemanticRelation({ relationType, source: candidate.source, target: candidate.target, text: candidate.chunk?.text || candidate.text || "" });
      if (!oriented.source?.id || !oriented.target?.id || oriented.source.id === oriented.target.id) return;
      semanticItems.push({
        candidate,
        semantic: {
          relationType,
          source: oriented.source,
          target: oriented.target,
          confidence: Math.max(threshold, Math.min(0.95, Number(ai.confidence || 0.7))),
          evidence: candidate.evidence,
          explanation: String(ai.explanation || "AI semantic classification"),
          method: "ai-semantic",
          providerId: aiResult.provider,
          model: aiResult.model,
        },
      });
    });
    const minHybridSemanticRelations = Math.max(2, Math.min(maxRelations, Number(config.minHybridSemanticRelations || Math.max(4, Math.ceil(candidates.length * 0.25)))));
    const useRuleFallback = enrichmentMode === "rules" ||
      (enrichmentMode === "hybrid" && semanticItems.length < minHybridSemanticRelations);
    const fallbackReason = useRuleFallback && enrichmentMode === "hybrid"
      ? (semanticItems.length ? "sparse-ai-semantic-output" : "empty-ai-semantic-output")
      : "";
    if (useRuleFallback) {
      const ruleResults = candidates
        .map((candidate) => ({ candidate, semantic: inferRuleSemanticRelation({ source: candidate.source, target: candidate.target, relation: candidate.relation, chunk: candidate.chunk, config }) }))
        .filter((item) => item.semantic && item.semantic.confidence >= threshold)
        .filter((item) => semanticRelationAllowed(item.semantic.relationType, config));
      const supplementalRuleResults = scopedChunks
        .flatMap((chunk) => [
          ...inferSupplementalUseRelationsForChunk({ chunk, entities: workspaceEntities, workspaceId, config }),
          ...inferSupplementalHealingRelationsForChunk({ chunk, entities: workspaceEntities, workspaceId, config }),
        ])
        .filter((item) => item.semantic && item.semantic.confidence >= threshold)
        .slice(0, Number.isFinite(maxRelations) ? Math.max(0, maxRelations - semanticItems.length - ruleResults.length) : Number.POSITIVE_INFINITY);
      semanticItems.push(...ruleResults, ...supplementalRuleResults);
    }
    const existingSemanticKeys = new Set(byWorkspace(relationsAll, workspaceId)
      .filter((relation) => relation.metadata?.semantic)
      .filter((relation) => !staleSemanticRelationIds.has(relation.id))
      .map((relation) => [
        relation.documentId || "",
        relation.relationType || "",
        relation.sourceEntityId || "",
        relation.targetEntityId || "",
        relation.metadata?.originalRelationId || "",
      ].join("::")));
    const semanticRelations = [];
    for (const { candidate, semantic } of semanticItems.slice(0, maxRelations)) {
      const relation = candidate.relation;
      const semanticSource = semantic.source;
      const semanticTarget = semantic.target;
      const semanticKey = [
        relation.documentId || "",
        semantic.relationType,
        semanticSource.id,
        semanticTarget.id,
        relation.id,
      ].join("::");
      if (existingSemanticKeys.has(semanticKey)) continue;
      existingSemanticKeys.add(semanticKey);
      const relationId = `ksemantic_${safeId(relation.documentId || workspaceId)}_${safeId(semantic.relationType)}_${safeId(semanticSource.normalized || semanticSource.label)}_${safeId(semanticTarget.normalized || semanticTarget.label)}_${safeId(relation.id)}`;
      const sourceChunkIds = [...new Set([relation.chunkId, ...(relation.metadata?.chunkIds || [])].filter(Boolean))];
      const record = {
        id: relationId,
        workspaceId,
        documentId: relation.documentId || candidate.chunk?.documentId || "",
        chunkId: relation.chunkId || candidate.chunk?.id || "",
        sourceEntityId: semanticSource.id,
        targetEntityId: semanticTarget.id,
        sourceLabel: semanticSource.label,
        targetLabel: semanticTarget.label,
        relationType: semantic.relationType,
        confidence: semantic.confidence,
        evidence: semantic.evidence || candidate.evidence || {},
        extraction: {
          method: semantic.method || "rule",
          providerId: semantic.providerId || "",
          model: semantic.model || "",
          promptVersion: "semantic-relation-v1",
        },
        metadata: {
          ...(relation.metadata || {}),
          semantic: true,
          inputChannel: event?.channel || "",
          nodeId: node?.id || "",
          collectionId: relation.metadata?.collectionId || candidate.chunk?.metadata?.collectionId || config.collectionId || "",
          originalRelationId: relation.id,
          originalRelationType: relation.relationType || "co_occurs",
          occurrenceCount: relation.metadata?.occurrenceCount || 1,
          sourceChunkIds,
          explanation: semantic.explanation || "",
          aiFallbackReason: semantic.method === "rule" ? fallbackReason || aiResult.error || "" : "",
        },
        createdAt: now,
        updatedAt: now,
      };
      semanticRelations.push(await putRecord(STORES.relations, record));
    }
    const context = semanticRelations.length
      ? [
        "Semantic Knowledge Graph relations:",
        ...semanticRelations.map((relation, index) =>
          `[SR${index + 1}] ${relation.sourceLabel} -${relation.relationType}-> ${relation.targetLabel} confidence=${Number(relation.confidence || 0).toFixed(2)} method=${relation.extraction?.method || "rule"}${relation.metadata?.explanation ? ` evidence=${relation.metadata.explanation}` : ""}`
        ),
      ].join("\n")
      : "Semantic Knowledge Graph relations: none";
    return {
      id: uniqueId("ksemantic_batch"),
      workspaceId,
      collectionId,
      documentId: semanticRelations[0]?.documentId || documentId || payload?.documentId || "",
      semanticRelations,
      relationCount: semanticRelations.length,
      semanticRelationCount: semanticRelations.length,
      clearedRelationCount: semanticCleanup.relations || 0,
      context,
      ai: {
        provider: aiResult.provider || "",
        model: aiResult.model || "",
        error: aiResult.error || "",
        relationCount: aiResult.relations?.length || 0,
        acceptedRelationCount: semanticItems.filter((item) => item.semantic?.method === "ai-semantic").length,
        minHybridSemanticRelations,
        hybridFallback: useRuleFallback,
        fallbackReason,
      },
      status: "ready",
      createdAt: now,
    };
  };

  const buildKnowledgeGraphSnapshot = async ({ workspaceId, node = {}, payload = {}, event, config = {} } = {}) => {
    const [entities, relations] = await Promise.all([
      listStore(STORES.entities),
      listStore(STORES.relations),
    ]);
    const collectionId = String(payload?.collectionId || payload?.metadata?.collectionId || config.collectionId || "").trim();
    const configuredDocumentId = String(payload?.documentId || config.documentId || "").trim();
    const rawGraphScope = String(payload?.graphScope || config.graphScope || "").toLowerCase();
    const graphScope = rawGraphScope === "document" && !configuredDocumentId && collectionId
      ? "collection"
      : rawGraphScope || (configuredDocumentId ? "document" : collectionId ? "collection" : "workspace");
    const aggregateDocuments = graphScope === "collection" || graphScope === "workspace" || graphScope === "all";
    const preferLatestDocument = payload?.preferLatestDocument === true || payload?.preferLatestDocument === "true" ||
      config.preferLatestDocument === true || config.preferLatestDocument === "true";
    const autoClearGraph = config.autoClearGraph === true || config.autoClearGraph === "true" || payload?.autoClearGraph === true || payload?.autoClearGraph === "true";
    if (autoClearGraph) {
      const runId = event?.meta?.runId || payload?.runId || event?.id || uniqueId("graph_run");
      const clearKey = `${workspaceId}:${node?.id || "knowledge-graph"}:${runId}`;
      if (!graphAutoClearRuns.has(clearKey)) {
        graphAutoClearRuns.add(clearKey);
        if (graphAutoClearRuns.size > 500) graphAutoClearRuns.delete(graphAutoClearRuns.values().next().value);
        await clearGraphSnapshots({ workspaceId, collectionId, documentId: configuredDocumentId, graphScope });
      }
    }
    const workspaceEntities = byWorkspace(entities, workspaceId)
      .filter((entity) => !collectionId || entity.metadata?.collectionId === collectionId);
    const latestDocumentEntity = [...workspaceEntities]
      .filter((entity) => entity.documentId)
      .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || "") - Date.parse(a.updatedAt || a.createdAt || ""))[0] || null;
    const configuredDocumentHasEntities = configuredDocumentId
      ? workspaceEntities.some((entity) => entity.documentId === configuredDocumentId)
      : false;
    const documentId = aggregateDocuments
      ? ""
      : configuredDocumentId && configuredDocumentHasEntities && !preferLatestDocument
      ? configuredDocumentId
      : latestDocumentEntity?.documentId || configuredDocumentId;
    const documentStatus = aggregateDocuments
      ? graphScope
      : configuredDocumentId && documentId && configuredDocumentId !== documentId
        ? "using latest document"
        : configuredDocumentId
          ? "configured"
          : "all";
    const scopedEntities = workspaceEntities
      .filter((entity) => !documentId || entity.documentId === documentId)
      .filter((entity) => !collectionId || entity.metadata?.collectionId === collectionId)
      .filter((entity) => !isWeakEntityLabelForLanguage(entity.label, entity.source, { ...config, language: entity.metadata?.language || config.language || "" }))
      .filter((entity) => entity.source === "seed" || !isEntityStopWord(entity.label, { ...config, language: entity.metadata?.language || config.language || "" }));
    const entityIds = new Set(scopedEntities.map((entity) => entity.id));
    const documentIds = unique(scopedEntities.map((entity) => entity.documentId).filter(Boolean));
    const scopedRelations = byWorkspace(relations, workspaceId)
      .filter((relation) => entityIds.has(relation.sourceEntityId) && entityIds.has(relation.targetEntityId))
      .filter((relation) => !collectionId || relation.metadata?.collectionId === collectionId);
    const semanticRelationCount = scopedRelations.filter((relation) => relation.metadata?.semantic).length;
    const topEntities = scopedEntities
      .map((entity) => ({
        id: entity.id,
        label: entity.label,
        entityType: entity.entityType,
        degree: scopedRelations.filter((relation) =>
          relation.sourceEntityId === entity.id || relation.targetEntityId === entity.id
        ).length,
        confidence: entity.confidence,
        aliases: entity.metadata?.aliases || [],
      }))
      .sort((a, b) => b.degree - a.degree || String(a.label).localeCompare(String(b.label)))
      .slice(0, Number.isFinite(Number(config.topEntities)) && Number(config.topEntities) > 0 ? Math.floor(Number(config.topEntities)) : Number.POSITIVE_INFINITY);
    const snapshot = {
      id: uniqueId("kgraph"),
      workspaceId,
      collectionId,
      documentId,
      documentIds,
      graphScope,
      documentStatus,
      entityCount: scopedEntities.length,
      relationCount: scopedRelations.length,
      semanticRelationCount,
      topEntities,
      relations: scopedRelations.slice(0, Number.isFinite(Number(config.maxRelations)) && Number(config.maxRelations) > 0 ? Math.floor(Number(config.maxRelations)) : Number.POSITIVE_INFINITY),
      status: "ready",
      createdAt: nowIso(),
    };
    await putRecord(STORES.metrics, {
      id: snapshot.id,
      workspaceId,
      metric: "knowledge.graph.snapshot",
      value: {
        entityCount: snapshot.entityCount,
        relationCount: snapshot.relationCount,
        semanticRelationCount: snapshot.semanticRelationCount,
        collectionId,
        documentId,
        documentIds,
        graphScope,
        documentStatus,
      },
      createdAt: snapshot.createdAt,
    });
    return snapshot;
  };

  const search = async ({ workspaceId, query = "", config = {}, allowedEmbeddingNodeIds = [] } = {}) => {
    const cleanQuery = String(query || config.query || "").trim();
    if (!cleanQuery) throw new Error("Query Knowledge vuota");
    const topK = Number.isFinite(Number(config.topK)) && Number(config.topK) > 0
      ? Math.floor(Number(config.topK))
      : chunks.length;
    const threshold = Math.max(0, Math.min(1, Number(config.similarityThreshold ?? 0.08)));
    const [embeddings, chunks] = await Promise.all([
      listStore(STORES.embeddings),
      listStore(STORES.chunks),
    ]);
    const allowedNodes = unique(allowedEmbeddingNodeIds);
    const collectionId = String(config.collectionId || config.indexId || "").trim();
    const workspaceEmbeddings = byWorkspace(embeddings, workspaceId)
      .filter((embedding) => !allowedNodes.length || allowedNodes.includes(embedding.metadata?.nodeId || ""))
      .filter((embedding) => !collectionId || embedding.metadata?.collectionId === collectionId);
    const requestedProvider = String(config.providerProfile || config.provider || "").trim();
    const requestedModel = String(config.model || "").trim();
    const firstCandidate = workspaceEmbeddings.find((embedding) =>
      (!requestedProvider || [embedding.provider, embedding.metadata?.requestedProvider].some((value) => String(value || "") === requestedProvider)) &&
      (!requestedModel || embedding.model === requestedModel)
    ) || workspaceEmbeddings[0] || null;
    const queryEmbedding = await resolveEmbeddingVector({
      text: cleanQuery,
      config: {
        ...config,
        provider: requestedProvider || firstCandidate?.provider || "local-hash",
        providerProfile: config.providerProfile || firstCandidate?.provider || "",
        model: requestedModel || firstCandidate?.model || "tl-local-hash-v1",
        dimensions: firstCandidate?.dimensions || config.dimensions || 96,
      },
    });
    const chunkById = new Map(byWorkspace(chunks, workspaceId).map((chunk) => [chunk.id, chunk]));
    const ranked = workspaceEmbeddings
      .filter((embedding) => embedding.provider === queryEmbedding.provider && embedding.model === queryEmbedding.model)
      .map((embedding) => {
        const chunk = chunkById.get(embedding.chunkId);
        if (!chunk) return null;
        if (looksLikeKnowledgeEnvelope(chunk.text || "")) return null;
        return {
          chunkId: chunk.id,
          documentId: chunk.documentId,
          score: cosineSimilarity(queryEmbedding.vector || [], embedding.vector || []),
          text: chunk.text || "",
          metadata: config.includeMetadata === false ? {} : {
            ...(chunk.metadata || {}),
            provider: embedding.provider,
            model: embedding.model,
            embeddingNodeId: embedding.metadata?.nodeId || "",
            scopedEmbeddingNodeIds: allowedNodes,
            collectionId: embedding.metadata?.collectionId || "",
          },
        };
      })
      .filter(Boolean)
      .filter((result) => result.score >= threshold)
      .sort((a, b) => b.score - a.score);
    const seenTexts = new Set();
    const results = [];
    for (const result of ranked) {
      const key = normalizeKnowledgeText(result.text);
      if (key && seenTexts.has(key)) continue;
      if (key) seenTexts.add(key);
      results.push(result);
      if (results.length >= topK) break;
    }
    const maxContextTokens = Math.max(120, Number(config.maxContextTokens || 1200));
    let usedTokens = 0;
    const context = results.map((result, index) => {
      const words = result.text.split(/\s+/).filter(Boolean);
      const remaining = maxContextTokens - usedTokens;
      const clipped = words.slice(0, Math.max(0, remaining)).join(" ");
      usedTokens += Math.min(words.length, Math.max(0, remaining));
      return clipped ? `[${index + 1}] ${clipped}` : "";
    }).filter(Boolean).join("\n\n");
    const record = {
      id: uniqueId("kquery"),
      workspaceId,
      query: cleanQuery,
      topK,
      similarityThreshold: threshold,
      results,
      resultCount: results.length,
      context,
      scope: {
        workspaceId,
        embeddingNodeIds: allowedNodes,
        collectionId,
        mode: allowedNodes.length ? "assigned-embedding-nodes" : "workspace",
      },
      status: "ready",
      createdAt: nowIso(),
    };
    await putRecord(STORES.queries, record);
    return record;
  };

  const queryGraph = async ({ workspaceId, node = {}, query = "", config = {}, payload = {}, event = {} } = {}) => {
    const cleanQuery = String(query || config.query || payload?.entity || payload?.label || "").trim();
    if (!cleanQuery) throw new Error("Query Knowledge Graph vuota");
    const collectionId = String(payload?.collectionId || payload?.metadata?.collectionId || config.collectionId || "").trim();
    const configuredDocumentId = String(payload?.documentId || config.documentId || "").trim();
    const rawGraphScope = String(payload?.graphScope || config.graphScope || "").toLowerCase();
    const graphScope = rawGraphScope === "document" && !configuredDocumentId && collectionId
      ? "collection"
      : rawGraphScope || (configuredDocumentId ? "document" : collectionId ? "collection" : "workspace");
    const aggregateDocuments = graphScope === "collection" || graphScope === "workspace" || graphScope === "all";
    const preferLatestDocument = payload?.preferLatestDocument === true || payload?.preferLatestDocument === "true" ||
      config.preferLatestDocument === true || config.preferLatestDocument === "true";
    const depth = Number.isFinite(Number(payload?.depth || config.depth)) && Number(payload?.depth || config.depth) > 0
      ? Math.floor(Number(payload?.depth || config.depth))
      : 1;
    const topK = Number.isFinite(Number(payload?.topK || config.topK)) && Number(payload?.topK || config.topK) > 0
      ? Math.floor(Number(payload?.topK || config.topK))
      : Number.POSITIVE_INFINITY;
    const maxRelations = Number.isFinite(Number(payload?.maxRelations || config.maxRelations)) && Number(payload?.maxRelations || config.maxRelations) > 0
      ? Math.floor(Number(payload?.maxRelations || config.maxRelations))
      : Number.POSITIVE_INFINITY;
    const includeEvidence = payload?.includeEvidence !== false && config.includeEvidence !== false;
    const evidenceModeRaw = String(payload?.evidenceMode || config.evidenceMode || "balanced").toLowerCase().trim().replace(/[\s-]+/g, "_");
    const evidenceMode = ["focused", "balanced", "full_ordered", "debug_trace"].includes(evidenceModeRaw) ? evidenceModeRaw : "balanced";
    const includeAdjacentChunks = payload?.includeAdjacentChunks === true || payload?.includeAdjacentChunks === "true" ||
      config.includeAdjacentChunks === true || config.includeAdjacentChunks === "true";
    const preserveDocumentOrder = payload?.preserveDocumentOrder === true || payload?.preserveDocumentOrder === "true" ||
      config.preserveDocumentOrder === true || config.preserveDocumentOrder === "true" || evidenceMode === "full_ordered";
    const protectedEvidenceEnabled = payload?.protectedEvidence !== false && payload?.protectedEvidence !== "false" &&
      config.protectedEvidence !== false && config.protectedEvidence !== "false" &&
      evidenceMode !== "focused" && evidenceMode !== "full_ordered";
    const includeIsolated = payload?.includeIsolated === true || payload?.includeIsolated === "true" ||
      config.includeIsolated === true || config.includeIsolated === "true";
    const relationTypes = splitConfigList(payload?.relationTypes || config.relationTypes).map((item) => item.toLowerCase());
    const cleanToken = normalizeEntityToken(cleanQuery);
    const queryLanguage = detectLanguage(cleanQuery, payload?.language || config.language || "");
    const queryStopWords = languageStopWordSet({ ...config, language: queryLanguage }, cleanQuery);
    const queryTokens = cleanToken.split(/\s+/).filter((token) => token.length > 1 && !queryStopWords.has(token));
    const intent = graphQueryIntent(cleanQuery);
    const hasExternalMechanismCue = Boolean(
      payload?.mechanismCue ||
      payload?.mechanismCueId ||
      payload?.operationalTerms ||
      event?.channel === "knowledge.mechanism.cues"
    );
    const externalMechanismCue = hasExternalMechanismCue
      ? normalizeGraphMechanismCuePayload(payload, { external: true, sourceNodeId: event?.sourceNodeId || "" })
      : null;
    const queryExpansionMode = graphQueryExpansionMode(config);
    const aiExpansion = ["llm", "hybrid"].includes(queryExpansionMode)
      ? await callGraphQueryExpansionAi({ query: cleanQuery, intent, config, stopWords: queryStopWords, queryTokens })
      : { tokens: [], provider: "", model: "", usage: {}, error: "", promptMode: "", intentHints: [], rationale: "" };
    if (aiExpansion.usage?.totalTokens) {
      await persistKnowledgeNodeTokenUsage({ node, usage: aiExpansion.usage, provider: aiExpansion.provider, model: aiExpansion.model });
    }
    const ruleSourceExpansionTokens = graphSourceExpansionTokens({ query: cleanQuery, intent, stopWords: queryStopWords });
    const ruleDangerExpansionTokens = graphDangerExpansionTokens({ intent, stopWords: queryStopWords });
    const rulesConfig = customKnowledgeRules(config);
    const customExpansionValues = customRuleValues(
      rulesConfig.expansionTerms?.retrieval,
      rulesConfig.expansionTerms?.all,
      rulesConfig.queryExpansionTerms,
      intent.source ? rulesConfig.expansionTerms?.source : [],
      intent.danger ? rulesConfig.expansionTerms?.danger : []
    );
    const customExpansionTokens = customRuleTokens(customExpansionValues, { stopWords: queryStopWords, queryTokens });
    const ruleExpansionTokens = customRulesMode(rulesConfig) === "replace" && customExpansionTokens.length
      ? customExpansionTokens
      : unique([...ruleSourceExpansionTokens, ...ruleDangerExpansionTokens, ...customExpansionTokens]);
    const sourceExpansionTokens = queryExpansionMode === "llm"
      ? unique(aiExpansion.tokens || [])
      : queryExpansionMode === "hybrid"
        ? unique((aiExpansion.tokens || []).length ? aiExpansion.tokens : ruleExpansionTokens)
        : ruleExpansionTokens;
    const retrievalTokens = unique([...queryTokens, ...sourceExpansionTokens]);
    const [entities, relations, chunks, eventsAll] = await Promise.all([
      listStore(STORES.entities),
      listStore(STORES.relations),
      listStore(STORES.chunks),
      listStore(STORES.events),
    ]);
    const workspaceEntities = byWorkspace(entities, workspaceId)
      .filter((entity) => !collectionId || entity.metadata?.collectionId === collectionId);
    const latestDocumentEntity = [...workspaceEntities]
      .filter((entity) => entity.documentId)
      .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || "") - Date.parse(a.updatedAt || a.createdAt || ""))[0] || null;
    const configuredDocumentHasEntities = configuredDocumentId
      ? workspaceEntities.some((entity) => entity.documentId === configuredDocumentId)
      : false;
    const documentId = aggregateDocuments
      ? ""
      : configuredDocumentId && configuredDocumentHasEntities && !preferLatestDocument
      ? configuredDocumentId
      : latestDocumentEntity?.documentId || configuredDocumentId;
    const documentStatus = aggregateDocuments
      ? graphScope
      : configuredDocumentId && documentId && configuredDocumentId !== documentId
        ? "using latest document"
        : configuredDocumentId
          ? "configured"
          : "all";
    const scopedEntities = workspaceEntities
      .filter((entity) => !documentId || entity.documentId === documentId)
      .filter((entity) => !isWeakEntityLabelForLanguage(entity.label, entity.source, { ...config, language: entity.metadata?.language || config.language || "" }))
      .filter((entity) => entity.source === "seed" || !isEntityStopWord(entity.label, { ...config, language: entity.metadata?.language || config.language || "" }));
    const scopedEntityIds = new Set(scopedEntities.map((entity) => entity.id));
    const entityById = new Map(scopedEntities.map((entity) => [entity.id, entity]));
    const scopedRelations = byWorkspace(relations, workspaceId)
      .filter((relation) => scopedEntityIds.has(relation.sourceEntityId) && scopedEntityIds.has(relation.targetEntityId))
      .filter((relation) => !documentId || relation.documentId === documentId)
      .filter((relation) => !collectionId || relation.metadata?.collectionId === collectionId)
      .filter((relation) => relationMatchesType(relation, relationTypes));
    const scopedChunks = byWorkspace(chunks, workspaceId)
      .filter((chunk) => !documentId || chunk.documentId === documentId)
      .filter((chunk) => !collectionId || chunk.metadata?.collectionId === collectionId);
    const requestedMaxEvidence = evidenceMode === "full_ordered"
      ? Math.max(0, scopedChunks.length)
      : Math.max(0, Math.min(24, Number(payload?.maxEvidence || config.maxEvidence || 6)));
    const earlyMechanismCueMode = graphMechanismCueMode(config);
    const maxEvidence = earlyMechanismCueMode === "llm" && (intent.process || intent.healing || intent.cause)
      ? Math.max(requestedMaxEvidence, Math.min(24, scopedChunks.length || 24))
      : protectedEvidenceEnabled && (intent.process || intent.healing || intent.cause || intent.danger)
      ? Math.max(requestedMaxEvidence, 6)
      : requestedMaxEvidence;
    const activeDocumentIds = new Set([
      ...scopedEntities.map((entity) => entity.documentId).filter(Boolean),
      ...scopedChunks.map((chunk) => chunk.documentId).filter(Boolean),
    ]);
    const scopedEvents = byWorkspace(eventsAll, workspaceId)
      .filter((item) => !documentId || item.documentId === documentId)
      .filter((item) => !collectionId || item.collectionId === collectionId)
      .filter((item) => !activeDocumentIds.size || activeDocumentIds.has(item.documentId))
      .sort((left, right) => Number(left.sequence || 0) - Number(right.sequence || 0));
    const rankedSeeds = scopedEntities
      .map((entity) => ({ entity, score: scoreGraphEntity(entity, queryTokens, cleanToken) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || String(a.entity.label || "").localeCompare(String(b.entity.label || "")))
      .slice(0, topK);
    const seedIds = new Set(rankedSeeds.map((item) => item.entity.id));
    const seedScoreById = new Map(rankedSeeds.map((item) => [item.entity.id, item.score]));
    const seedLabels = rankedSeeds.map((item) => normalizeEntityToken(item.entity.label || "")).filter(Boolean);
    const nonSeedQueryTokens = queryTokens.filter((token) =>
      !seedLabels.some((label) => label === token || label.includes(token) || token.includes(label))
    );
    const chunkScoreById = new Map();
    scopedChunks.forEach((chunk) => {
      const text = normalizeEntityToken(chunk.text || "");
      if (!text) return;
      const matchedSeedCount = seedLabels.reduce((count, label) => count + (label && text.includes(label) ? 1 : 0), 0);
      const queryHitCount = queryTokens.reduce((count, token) => count + (token && text.includes(token) ? 1 : 0), 0);
      const retrievalHitCount = retrievalTokens.reduce((count, token) => count + (token && text.includes(token) ? 1 : 0), 0);
      const sourceExpansionHitCount = sourceExpansionTokens.reduce((count, token) => count + (token && text.includes(token) ? 1 : 0), 0);
      const nonSeedQueryHitCount = nonSeedQueryTokens.reduce((count, token) => count + (token && text.includes(token) ? 1 : 0), 0);
      const healingMechanismScore = graphHealingMechanismCueScore(chunk.text || "", intent);
      const sourceCueScore = graphSourceCueScore(chunk.text || "", intent);
      const dangerCueScore = graphDangerCueScore(chunk.text || "", intent);
      const highMatch = seedLabels.length > 1
        ? matchedSeedCount >= 2 || (intent.healing && matchedSeedCount >= 1 && healingMechanismScore >= 18) || (intent.source && matchedSeedCount >= 1 && (sourceCueScore >= 14 || sourceExpansionHitCount >= 2)) || (intent.danger && matchedSeedCount >= 1 && dangerCueScore >= 10)
        : matchedSeedCount >= 1 && (!intent.instrument || nonSeedQueryHitCount >= 1 || (intent.healing && healingMechanismScore >= 18) || (intent.source && (sourceCueScore >= 14 || sourceExpansionHitCount >= 2)) || (intent.danger && dangerCueScore >= 10));
      if (!highMatch) return;
      const score = (matchedSeedCount * 8) + (queryHitCount * 2) + (intent.source || intent.danger ? sourceExpansionHitCount * 2 : 0) + (intent.instrument ? 6 : 0) + (intent.healing ? 6 : 0) + (intent.danger ? 6 : 0) + healingMechanismScore + sourceCueScore + dangerCueScore + Math.min(8, retrievalHitCount);
      if (score > 0) chunkScoreById.set(chunk.id, score);
    });
    const orderedScopedRelations = [...scopedRelations]
      .map((relation) => ({
        relation,
        score: scoreGraphRelation(relation, { seedScoreById, entityById, intent, chunkScoreById }),
      }))
      .sort((a, b) =>
        b.score - a.score ||
        String(a.relation.relationType || "").localeCompare(String(b.relation.relationType || ""))
      )
      .map((item) => item.relation);
    const selectedRelationIds = new Set();
    const selectedEntityIds = new Set(seedIds);
    let frontier = new Set(seedIds);
    for (let level = 0; level < depth && frontier.size; level += 1) {
      const next = new Set();
      orderedScopedRelations.forEach((relation) => {
        const touches = frontier.has(relation.sourceEntityId) || frontier.has(relation.targetEntityId);
        if (!touches || selectedRelationIds.size >= maxRelations) return;
        selectedRelationIds.add(relation.id);
        [relation.sourceEntityId, relation.targetEntityId].forEach((id) => {
          if (!selectedEntityIds.has(id)) next.add(id);
          selectedEntityIds.add(id);
        });
      });
      frontier = next;
    }
    const selectedRelations = scopedRelations.filter((relation) => selectedRelationIds.has(relation.id));
    if (!selectedRelations.length && rankedSeeds.length) {
      orderedScopedRelations
        .filter((relation) => seedIds.has(relation.sourceEntityId) || seedIds.has(relation.targetEntityId))
        .slice(0, maxRelations)
        .forEach((relation) => {
          selectedRelationIds.add(relation.id);
          selectedEntityIds.add(relation.sourceEntityId);
          selectedEntityIds.add(relation.targetEntityId);
        });
    }
    let answerExpansionRelationCount = 0;
    if (chunkScoreById.size && selectedRelationIds.size < maxRelations) {
      const expansionLimit = Math.min(maxRelations - selectedRelationIds.size, intent.instrument ? 12 : 8);
      orderedScopedRelations
        .filter((relation) => {
          if (selectedRelationIds.has(relation.id)) return false;
          const relationChunkId = relation.chunkId || relation.evidence?.chunkId || relation.metadata?.evidence?.chunkId || "";
          return chunkScoreById.has(relationChunkId);
        })
        .sort((a, b) => {
          const aChunk = chunkScoreById.get(a.chunkId || a.evidence?.chunkId || a.metadata?.evidence?.chunkId || "") || 0;
          const bChunk = chunkScoreById.get(b.chunkId || b.evidence?.chunkId || b.metadata?.evidence?.chunkId || "") || 0;
          return bChunk - aChunk ||
            scoreGraphRelation(b, { seedScoreById, entityById, intent, chunkScoreById }) -
            scoreGraphRelation(a, { seedScoreById, entityById, intent, chunkScoreById });
        })
        .slice(0, expansionLimit)
        .forEach((relation) => {
          selectedRelationIds.add(relation.id);
          answerExpansionRelationCount += 1;
          selectedEntityIds.add(relation.sourceEntityId);
          selectedEntityIds.add(relation.targetEntityId);
        });
    }
    const relationScoreById = new Map(orderedScopedRelations.map((relation) => [
      relation.id,
      scoreGraphRelation(relation, { seedScoreById, entityById, intent, chunkScoreById }),
    ]));
    const relationsResultRaw = orderedScopedRelations
      .filter((relation) => selectedRelationIds.has(relation.id))
      .slice(0, maxRelations);
    const degree = new Map();
    relationsResultRaw.forEach((relation) => {
      degree.set(relation.sourceEntityId, (degree.get(relation.sourceEntityId) || 0) + 1);
      degree.set(relation.targetEntityId, (degree.get(relation.targetEntityId) || 0) + 1);
    });
    const allEntitiesResultRaw = [...selectedEntityIds]
      .map((id) => entityById.get(id))
      .filter(Boolean)
      .sort((a, b) =>
        (seedScoreById.get(b.id) || 0) - (seedScoreById.get(a.id) || 0) ||
        (degree.get(b.id) || 0) - (degree.get(a.id) || 0) ||
        String(a.label || "").localeCompare(String(b.label || ""))
      );
    const connectedEntitiesRaw = allEntitiesResultRaw.filter((entity) => (degree.get(entity.id) || 0) > 0);
    const entitiesResultRaw = (includeIsolated || !relationsResultRaw.length
      ? allEntitiesResultRaw
      : allEntitiesResultRaw.filter((entity) => (degree.get(entity.id) || 0) > 0 || seedIds.has(entity.id)))
      .slice(0, Math.max(topK, 24));
    const isolatedEntityCount = allEntitiesResultRaw.filter((entity) => !(degree.get(entity.id) || 0)).length;
    const connectedEntityCount = connectedEntitiesRaw.length;
    const entitiesResult = entitiesResultRaw.map((entity) => ({
      ...entity,
      connections: degree.get(entity.id) || 0,
      score: seedScoreById.get(entity.id) || 0,
      matched: seedIds.has(entity.id),
    }));
    const relationsResult = relationsResultRaw.map((relation) => {
      const source = entityById.get(relation.sourceEntityId);
      const target = entityById.get(relation.targetEntityId);
      return {
        ...relation,
        sourceLabel: source?.label || relation.sourceEntityId,
        targetLabel: target?.label || relation.targetEntityId,
        score: relationScoreById.get(relation.id) || 0,
        direct: seedIds.has(relation.sourceEntityId) || seedIds.has(relation.targetEntityId),
      };
    });
    const seedChunkIds = new Set(rankedSeeds.map((item) => item.entity.chunkId).filter(Boolean));
    const chunkIds = new Set([
      ...entitiesResult.map((entity) => entity.chunkId).filter(Boolean),
      ...relationsResult.map((relation) => relation.chunkId).filter(Boolean),
      ...seedChunkIds,
    ]);
    const matchedLabels = rankedSeeds.map((item) => item.entity.label).filter(Boolean);
    const normalizedMatchedLabels = matchedLabels.map(normalizeEntityToken).filter(Boolean);
    const evidenceScore = (chunk = {}) => {
      const text = normalizeEntityToken(chunk.text || "");
      let score = 0;
      rankedSeeds.forEach(({ entity, score: seedScore }) => {
        if (text.includes(normalizeEntityToken(entity.label))) score += 12 + seedScore;
      });
      retrievalTokens.forEach((token) => {
        if (text.includes(token)) score += 3;
      });
      score += graphDefinitionCueScore(chunk.text || "", intent);
      score += graphHealingMechanismCueScore(chunk.text || "", intent);
      score += graphSourceCueScore(chunk.text || "", intent);
      score += graphDangerCueScore(chunk.text || "", intent);
      if (chunkIds.has(chunk.id)) score += 2;
      if (seedChunkIds.has(chunk.id)) score += 6;
      return score;
    };
    const evidenceCandidates = includeEvidence
      ? (evidenceMode === "full_ordered"
        ? [...scopedChunks]
          .sort((a, b) => Number(a.ordinal ?? a.index ?? 0) - Number(b.ordinal ?? b.index ?? 0))
        : scopedChunks
        .filter((chunk) => {
          if (chunkIds.has(chunk.id)) return true;
          const text = normalizeEntityToken(chunk.text || "");
          return normalizedMatchedLabels.some((label) => text.includes(label)) ||
            graphHealingMechanismCueScore(chunk.text || "", intent) >= 18 ||
            graphSourceCueScore(chunk.text || "", intent) >= 14 ||
            graphDangerCueScore(chunk.text || "", intent) >= 10;
        }))
        .map((chunk) => ({ chunk, score: evidenceScore(chunk) }))
        .filter((item) => evidenceMode === "full_ordered" || item.score > 0)
        .sort((a, b) => evidenceMode === "full_ordered"
          ? Number(a.chunk?.ordinal ?? a.chunk?.index ?? 0) - Number(b.chunk?.ordinal ?? b.chunk?.index ?? 0)
          : b.score - a.score || String(a.chunk.id || "").localeCompare(String(b.chunk.id || "")))
      : [];
    const scoredEvents = scopedEvents
      .map((item) => ({
        event: item,
        score: scoreKnowledgeEventForQuery(item, retrievalTokens, seedLabels, intent),
      }))
      .filter((item) => item.score > 0);
    const eventLimit = Math.max(0, Math.min(30, Number(payload?.maxEvents || config.maxEvents || (intent.healing || intent.cause ? 18 : 6))));
    const rankedEventsBase = [...scoredEvents]
      .sort((a, b) => b.score - a.score || Number(a.event.sequence || 0) - Number(b.event.sequence || 0))
      .slice(0, eventLimit);
    const healingChainEvents = intent.healing
      ? scoredEvents
        .filter(({ event: item }) =>
          ["finds", "fills", "immerses", "transforms", "takes", "drinks", "has_property", "speaks", "cannot_speak"].includes(item.eventType) &&
          (
            graphHealingMechanismCueScore(item.evidence?.text || item.evidence?.quote || "", intent) >= 8 ||
            /\b(?:liber|voce|parlare|parla|grido|speak|voice)\b/.test(normalizeEntityToken([
              item.subject,
              ...(item.objects || []),
              item.evidence?.text || item.evidence?.quote || "",
            ].join(" ")))
          )
        )
        .slice(0, 18)
      : [];
    const processWindowEvents = graphProcessWindowEvents({
      events: scopedEvents,
      scoredEvents,
      queryTokens,
      seedLabels,
      intent,
      maxEvents: eventLimit,
    });
    const rankedEventIds = new Set();
    const rankedEvents = [...processWindowEvents, ...rankedEventsBase, ...healingChainEvents]
      .filter(({ event: item }) => {
        if (rankedEventIds.has(item.id)) return false;
        rankedEventIds.add(item.id);
        return true;
      })
      .slice(0, eventLimit)
      .sort((a, b) => Number(a.event.sequence || 0) - Number(b.event.sequence || 0));
    const eventsResult = rankedEvents.map(({ event: item, score }) => ({
      id: item.id,
      sequence: item.sequence,
      eventType: item.eventType,
      subject: item.subject,
      objects: item.objects || [],
      participants: item.participants || [],
      roles: item.roles || {},
      subjectResolution: item.subjectResolution || null,
      polarity: item.polarity || "positive",
      modality: item.modality || "asserted",
      aspect: item.aspect || "completed",
      confidence: item.confidence,
      evidence: item.evidence,
      score,
    }));
    const relationLines = relationsResult.slice(0, maxRelations).map((relation, index) => {
      const source = entityById.get(relation.sourceEntityId);
      const target = entityById.get(relation.targetEntityId);
      const marker = relation.direct ? " direct" : "";
      const semantic = relation.metadata?.semantic ? " semantic" : "";
      const method = relation.extraction?.method ? ` method=${relation.extraction.method}` : "";
      const original = relation.metadata?.originalRelationType ? ` original=${relation.metadata.originalRelationType}` : "";
      const explanation = relation.metadata?.explanation ? ` evidence=${String(relation.metadata.explanation)}` : "";
      const quote = relation.evidence?.quote || relation.metadata?.evidence?.quote || "";
      const quoteText = quote ? ` quote="${String(quote)}"` : "";
      return `[R${index + 1}${marker}${semantic}] ${source?.label || relation.sourceEntityId} -${relation.relationType || "related_to"}-> ${target?.label || relation.targetEntityId}${method}${original}${explanation}${quoteText}`;
    });
    const entityLines = entitiesResult.map((entity, index) =>
      `[E${index + 1}${entity.matched ? " match" : ""}] ${entity.label || entity.id} (${entity.entityType || "entity"}, connections=${entity.connections || 0}, score=${Number(entity.score || 0).toFixed(2)})`
    );
    const eventLines = eventsResult.map((item, index) =>
      `[EV${index + 1} seq=${item.sequence} score=${Number(item.score || 0).toFixed(2)}] ${item.subject || "event"} -${item.eventType}-> ${(item.objects || []).join(", ") || "context"} quote="${String(item.evidence?.quote || item.evidence?.text || "")}"`
    );
    const eventChainTerms = unique(eventsResult.flatMap((item) => [
      item.eventType,
      item.subject,
      ...(item.objects || []),
      ...(item.participants || []),
      ...(item.roles?.agent || []),
      ...(item.roles?.patient || []),
      ...(item.roles?.object || []),
      ...(item.roles?.destination || []),
    ])
      .flatMap((value) => normalizeEntityToken(value).split(/\s+/))
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !queryStopWords.has(token)));
    const mechanismEvidenceEvents = intent.process || intent.healing || intent.cause
      ? mechanismEventsForReasoning(eventsResult, queryTokens, Math.max(12, eventLimit))
      : [];
    const mechanismCueMode = earlyMechanismCueMode;
    const mechanismCueChunkLimit = Math.max(6, Math.min(24, Number(config.mechanismCueChunkLimit || 24)));
    const mechanismCueChunks = scopedChunks.length <= mechanismCueChunkLimit
      ? scopedChunks
      : [...new Map(evidenceCandidates.map((item) => [item.chunk?.id, item.chunk]).filter(([id, chunk]) => id && chunk)).values()];
    const mechanismCueAi = externalMechanismCue ||
      (["llm", "hybrid"].includes(mechanismCueMode) && (intent.process || intent.healing || intent.cause)
      ? await callGraphMechanismCueAi({
        query: cleanQuery,
        intent,
        chunks: mechanismCueChunks.length ? mechanismCueChunks : scopedChunks,
        relations: relationsResult,
        events: eventsResult,
        config,
        stopWords: queryStopWords,
        queryTokens,
      })
      : emptyGraphMechanismCueResult());
    if (!mechanismCueAi.external && mechanismCueAi.usage?.totalTokens) {
      await persistKnowledgeNodeTokenUsage({ node, usage: mechanismCueAi.usage, provider: mechanismCueAi.provider, model: mechanismCueAi.model });
    }
    const mechanismSourceTokens = new Set(normalizeEntityToken([
      cleanQuery,
      scopedChunks.map((chunk) => chunk.text || "").join(" "),
      eventsResult.map((item) => [
        item.subject,
        item.eventType,
        ...(item.objects || []),
        ...(item.participants || []),
        ...(item.roles?.patient || []),
        ...(item.roles?.object || []),
        ...(item.roles?.destination || []),
        item.evidence?.quote || item.evidence?.text || "",
      ].join(" ")).join(" "),
      relationsResult.map((relation) => [
        relation.sourceLabel,
        relation.targetLabel,
        relation.relationType,
        relation.evidence?.quote || relation.metadata?.evidence?.quote || "",
      ].join(" ")).join(" "),
    ].join(" "))
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !queryStopWords.has(token)));
    const useRuleMechanismExpansion = mechanismCueMode !== "llm";
    const llmMechanismCueFailed = mechanismCueMode === "llm" &&
      (intent.process || intent.healing || intent.cause) &&
      !(mechanismCueAi.terms || []).length;
    const customMechanismTerms = {
      operational: customRuleTokens(customRuleValues(rulesConfig.mechanismTerms?.operational, rulesConfig.mechanismTerms?.operations), { stopWords: queryStopWords }),
      transformation: customRuleTokens(customRuleValues(rulesConfig.mechanismTerms?.transformation, rulesConfig.mechanismTerms?.transformations), { stopWords: queryStopWords }),
      outcome: customRuleTokens(customRuleValues(rulesConfig.mechanismTerms?.outcome, rulesConfig.mechanismTerms?.outcomes), { stopWords: queryStopWords }),
      downrank: customRuleTokens(customRuleValues(rulesConfig.mechanismTerms?.downrank, rulesConfig.mechanismTerms?.background), { stopWords: queryStopWords }),
      terms: customRuleTokens(customRuleValues(rulesConfig.mechanismTerms?.terms, rulesConfig.mechanismTerms?.evidence), { stopWords: queryStopWords }),
    };
    const baseMechanismEvidenceTerms = useRuleMechanismExpansion && (intent.healing || intent.process || intent.cause)
      ? "cure cura guarire guar guarito healed heal process processo method metodo step passaggio prepare prepara preparare use using usa usato cause causa result risultato outcome esito"
      : "";
    const mechanismEvidenceTerms = unique([
      baseMechanismEvidenceTerms,
      ...(mechanismCueAi.terms || []),
      ...(useRuleMechanismExpansion ? customMechanismTerms.terms : []),
      ...(useRuleMechanismExpansion ? customMechanismTerms.operational : []),
      ...(useRuleMechanismExpansion ? customMechanismTerms.transformation : []),
      ...(useRuleMechanismExpansion ? customMechanismTerms.outcome : []),
      ...mechanismEvidenceEvents.flatMap((item) => [
      ...(item.objects || []),
      ...(item.roles?.patient || []),
      ...(item.roles?.object || []),
      ...(item.roles?.destination || []),
      useRuleMechanismExpansion && item.eventType === "drinks" ? "beve bevve drink drinks" : "",
      useRuleMechanismExpansion && item.eventType === "fills" ? "riempie riempirono fill filled" : "",
      useRuleMechanismExpansion && item.eventType === "immerses" ? "immerge immersero immerse" : "",
      useRuleMechanismExpansion && item.eventType === "transforms" ? "trasforma trasformandosi bollire boil boiled" : "",
      useRuleMechanismExpansion && item.eventType === "speaks" ? "parla parlare parola voce grido speak voice" : "",
      ]),
    ]
      .flatMap((value) => normalizeEntityToken(value).split(/\s+/))
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !queryStopWords.has(token))
      .filter((token) => mechanismSourceTokens.has(token) || queryTokens.includes(token))
      .filter((token) => !seedLabels.some((label) => label === token)));
    const ruleMechanismOperationalTerms = useRuleMechanismExpansion ? [
      "beve", "beva", "bevve", "bevuto", "bere", "drink", "drank", "drinks",
      "riempie", "riempirono", "fill", "filled",
      "immerge", "immersero", "immerse", "immerso", "immersa",
      "trasforma", "trasformandosi", "bollire", "bolle", "boil", "boiled",
    ] : [];
    const mechanismOperationalTerms = new Set([
      ...(customRulesMode(rulesConfig) === "replace" && customMechanismTerms.operational.length ? [] : ruleMechanismOperationalTerms),
      ...(useRuleMechanismExpansion ? customMechanismTerms.operational : []),
      ...(mechanismCueAi.operationalTerms || []),
      ...(useRuleMechanismExpansion ? customMechanismTerms.transformation : []),
      ...(mechanismCueAi.transformationTerms || []),
    ]);
    const mechanismOutcomeTerms = new Set([
      ...(customRulesMode(rulesConfig) === "replace" && customMechanismTerms.outcome.length ? [] : (useRuleMechanismExpansion ? ["parla", "parlare", "parola", "voce", "grido", "speak", "voice", "word"] : [])),
      ...(useRuleMechanismExpansion ? customMechanismTerms.outcome : []),
      ...(mechanismCueAi.outcomeTerms || []),
    ]);
    const mechanismDownrankTerms = new Set([...(useRuleMechanismExpansion ? customMechanismTerms.downrank : []), ...(mechanismCueAi.downrankTerms || [])]);
    if (includeEvidence && llmMechanismCueFailed) {
      const evidenceCandidateIds = new Set(evidenceCandidates.map((item) => item.chunk?.id).filter(Boolean));
      scopedChunks.forEach((chunk) => {
        if (!chunk?.id || evidenceCandidateIds.has(chunk.id)) return;
        evidenceCandidateIds.add(chunk.id);
        evidenceCandidates.push({ chunk, score: evidenceScore(chunk) });
      });
      evidenceCandidates.sort((a, b) => Number(a.chunk?.ordinal ?? a.chunk?.index ?? 0) - Number(b.chunk?.ordinal ?? b.chunk?.index ?? 0));
    } else if (includeEvidence && mechanismEvidenceTerms.length) {
      const evidenceCandidateIds = new Set(evidenceCandidates.map((item) => item.chunk?.id).filter(Boolean));
      scopedChunks.forEach((chunk) => {
        if (!chunk?.id || evidenceCandidateIds.has(chunk.id)) return;
        const mechanismMatches = graphEvidenceMatchedTokens(chunk.text || "", mechanismEvidenceTerms);
        if (!mechanismMatches.length) return;
        evidenceCandidateIds.add(chunk.id);
        evidenceCandidates.push({
          chunk,
          score: evidenceScore(chunk) + Math.min(24, mechanismMatches.length * 5),
        });
      });
      evidenceCandidates.sort((a, b) => evidenceMode === "full_ordered"
        ? Number(a.chunk?.ordinal ?? a.chunk?.index ?? 0) - Number(b.chunk?.ordinal ?? b.chunk?.index ?? 0)
        : b.score - a.score || String(a.chunk?.id || "").localeCompare(String(b.chunk?.id || "")));
    }
    const evidenceCandidateMeta = (candidate = {}) => {
      const text = candidate.chunk?.text || "";
      const queryMatches = graphEvidenceMatchedTokens(text, queryTokens);
      const sourceExpansionMatches = graphEvidenceMatchedTokens(text, sourceExpansionTokens);
      const seedMatches = graphEvidenceMatchedTokens(text, seedLabels);
      const eventMatches = graphEvidenceMatchedTokens(text, eventChainTerms);
      const mechanismMatches = graphEvidenceMatchedTokens(text, mechanismEvidenceTerms);
      const operationalMatches = mechanismMatches.filter((token) => mechanismOperationalTerms.has(token));
      const outcomeMatches = mechanismMatches.filter((token) => mechanismOutcomeTerms.has(token));
      const downrankMatches = graphEvidenceMatchedTokens(text, [...mechanismDownrankTerms]);
      const healingCueScore = graphHealingMechanismCueScore(text, intent);
      const dangerCueScore = graphDangerCueScore(text, intent);
      const downrankPenalty = downrankMatches.length && !operationalMatches.length && !outcomeMatches.length
        ? Math.min(12, downrankMatches.length * 3)
        : 0;
      const selected = false;
      const linked = chunkIds.has(candidate.chunk?.id);
      const highMatch = chunkScoreById.has(candidate.chunk?.id);
      const normalizedText = normalizeEntityToken(text);
      const instructionCue = /\b(?:importante|dovr|deve|devono|prepar|using|use|must|should|required|requires|needed|necessar|soluzione|solution|trovare|found|find)\b/.test(normalizedText);
      const outcomeSuccessCue = /\b(?:successo|riesc\w*|risultato|esito|finally|began|completed|completato|otten\w*)\b/.test(normalizedText);
      const protectedKind = operationalMatches.length >= 2
        ? (instructionCue ? "setup" : "operation")
        : outcomeMatches.length >= 2 && healingCueScore >= 13 && outcomeSuccessCue
          ? "outcome"
          : "";
      const trimmedText = String(text || "").trim();
      const startsWithFragment = Boolean(trimmedText) && !/^(?:[—«"“'‘(]|\p{Lu}|\d)/u.test(trimmedText);
      const endsWithFragment = Boolean(trimmedText) && !/[.!?;:»”)"'\]]\s*$/u.test(trimmedText);
      return {
        chunk: candidate.chunk,
        score: Math.max(0, Number(candidate.score || 0) - downrankPenalty),
        rawScore: candidate.score,
        selected,
        linked,
        highMatch,
        queryMatches,
        sourceExpansionMatches,
        seedMatches,
        eventMatches,
        mechanismMatches,
        operationalMatches,
        outcomeMatches,
        downrankMatches,
        downrankPenalty,
        healingCueScore,
        dangerCueScore,
        protectedKind,
        startsWithFragment,
        endsWithFragment,
      };
    };
    const evidenceCandidateMetaList = evidenceCandidates.map(evidenceCandidateMeta);
    const mechanismProtectedLimit = maxEvidence > 0 ? Math.max(3, Math.min(6, maxEvidence - 1)) : 0;
    const mechanismProtectedKindOrder = new Map([["setup", 0], ["operation", 1], ["outcome", 2]]);
    const mechanismProtectedEvidence = protectedEvidenceEnabled && (intent.process || intent.healing || intent.cause) && mechanismProtectedLimit > 0
      ? evidenceCandidateMetaList
        .filter((item) => item.protectedKind)
        .filter((item) => item.healingCueScore >= 13 || item.highMatch || item.score >= 30)
        .sort((a, b) =>
          (mechanismProtectedKindOrder.get(a.protectedKind) ?? 9) - (mechanismProtectedKindOrder.get(b.protectedKind) ?? 9) ||
          Number(a.chunk?.ordinal ?? a.chunk?.index ?? 0) - Number(b.chunk?.ordinal ?? b.chunk?.index ?? 0))
        .slice(0, mechanismProtectedLimit)
      : [];
    const selectedEvidenceCandidates = [];
    const selectedEvidenceIds = new Set();
    const addEvidenceCandidate = (item = {}) => {
      const chunkId = item.chunk?.id;
      if (!chunkId || selectedEvidenceIds.has(chunkId) || selectedEvidenceCandidates.length >= maxEvidence) return;
      selectedEvidenceIds.add(chunkId);
      selectedEvidenceCandidates.push(item);
    };
    mechanismProtectedEvidence.forEach(addEvidenceCandidate);
    const autoAdjacentProtectedEvidence = protectedEvidenceEnabled && (intent.process || intent.healing || intent.cause);
    if ((includeAdjacentChunks || autoAdjacentProtectedEvidence) && mechanismProtectedEvidence.length) {
      const candidateByOrdinal = new Map(evidenceCandidateMetaList.map((item) => [Number(item.chunk?.ordinal ?? item.chunk?.index ?? -1), item]));
      const chunkByOrdinal = new Map(scopedChunks.map((chunk) => [Number(chunk.ordinal ?? chunk.index ?? -1), chunk]));
      mechanismProtectedEvidence.forEach((item) => {
        const ordinal = Number(item.chunk?.ordinal ?? item.chunk?.index ?? -1);
        const nearbyOrdinals = includeAdjacentChunks
          ? [ordinal - 1, ordinal + 1]
          : [
            item.startsWithFragment ? ordinal - 1 : null,
            item.endsWithFragment ? ordinal + 1 : null,
          ].filter((value) => Number.isFinite(value));
        nearbyOrdinals.forEach((nearby) => {
          const adjacent = candidateByOrdinal.get(nearby) ||
            (chunkByOrdinal.has(nearby)
              ? evidenceCandidateMeta({ chunk: chunkByOrdinal.get(nearby), score: evidenceScore(chunkByOrdinal.get(nearby)) })
              : null);
          if (adjacent) addEvidenceCandidate({ ...adjacent, adjacentToChunkId: item.chunk?.id, adjacentReason: includeAdjacentChunks ? "configured-adjacent" : "protected-boundary" });
        });
      });
    }
    evidenceCandidateMetaList
      .sort((a, b) => llmMechanismCueFailed
        ? Number(a.chunk?.ordinal ?? a.chunk?.index ?? 0) - Number(b.chunk?.ordinal ?? b.chunk?.index ?? 0)
        : b.score - a.score || String(a.chunk?.id || "").localeCompare(String(b.chunk?.id || "")))
      .forEach(addEvidenceCandidate);
    const snippetLabels = intent.source
      ? unique([...matchedLabels, ...sourceExpansionTokens])
      : intent.healing || intent.process || intent.cause
      ? unique([...mechanismEvidenceTerms, ...matchedLabels])
      : matchedLabels;
    const evidenceSnippetMax = intent.source ? 1600 : 900;
    const mechanismPriorityEvidence = autoAdjacentProtectedEvidence && !preserveDocumentOrder && evidenceMode !== "full_ordered";
    const orderedEvidenceCandidates = preserveDocumentOrder || (autoAdjacentProtectedEvidence && !mechanismPriorityEvidence)
      ? [...selectedEvidenceCandidates].sort((a, b) => Number(a.chunk?.ordinal ?? a.chunk?.index ?? 0) - Number(b.chunk?.ordinal ?? b.chunk?.index ?? 0))
      : selectedEvidenceCandidates;
    const evidence = orderedEvidenceCandidates.map((item, index) => ({
      index: index + 1,
      chunkId: item.chunk.id,
      documentId: item.chunk.documentId,
      text: graphEvidenceSnippet(item.chunk.text || "", snippetLabels, evidenceSnippetMax),
      metadata: item.chunk.metadata || {},
      score: item.score,
      selectionReason: evidenceMode === "full_ordered"
        ? "full-ordered"
        : mechanismProtectedEvidence.some((protectedItem) => protectedItem.chunk?.id === item.chunk.id)
        ? "mechanism-protected"
        : item.adjacentToChunkId
          ? item.adjacentReason || "adjacent"
        : "ranked-score",
    }));
    const evidenceSelectionReasonById = new Map(evidence.map((item) => [item.chunkId, item.selectionReason]));
    const evidenceLines = evidence.map((item) => `[S${item.index} score=${Number(item.score || 0).toFixed(2)} reason=${item.selectionReason || "ranked"}] ${String(item.text || "")}`);
    const selectedEvidenceChunkIds = new Set(evidence.map((item) => item.chunkId).filter(Boolean));
    const evidenceTrace = scopedChunks
      .map((chunk) => {
        const text = chunk.text || "";
        const queryMatches = graphEvidenceMatchedTokens(text, queryTokens);
        const sourceExpansionMatches = graphEvidenceMatchedTokens(text, sourceExpansionTokens);
        const seedMatches = graphEvidenceMatchedTokens(text, seedLabels);
        const eventMatches = graphEvidenceMatchedTokens(text, eventChainTerms);
        const mechanismMatches = graphEvidenceMatchedTokens(text, mechanismEvidenceTerms);
        const operationalMatches = mechanismMatches.filter((token) => mechanismOperationalTerms.has(token));
        const outcomeMatches = mechanismMatches.filter((token) => mechanismOutcomeTerms.has(token));
        const downrankMatches = graphEvidenceMatchedTokens(text, [...mechanismDownrankTerms]);
        const downrankPenalty = downrankMatches.length && !operationalMatches.length && !outcomeMatches.length
          ? Math.min(12, downrankMatches.length * 3)
          : 0;
        const healingCueScore = graphHealingMechanismCueScore(text, intent);
        const dangerCueScore = graphDangerCueScore(text, intent);
        const selected = selectedEvidenceChunkIds.has(chunk.id);
        const mechanismProtectedItem = mechanismProtectedEvidence.find((item) => item.chunk?.id === chunk.id);
        const mechanismProtected = Boolean(mechanismProtectedItem);
        const trimmedText = String(text || "").trim();
        const startsWithFragment = Boolean(trimmedText) && !/^(?:[—«"“'‘(]|\p{Lu}|\d)/u.test(trimmedText);
        const endsWithFragment = Boolean(trimmedText) && !/[.!?;:»”)"'\]]\s*$/u.test(trimmedText);
        const linked = chunkIds.has(chunk.id);
        const highMatch = chunkScoreById.has(chunk.id);
        const score = Math.max(0, evidenceScore(chunk) - downrankPenalty);
        const reasons = [
          selected ? "selected-evidence" : "",
          selected && evidenceSelectionReasonById.get(chunk.id) ? `selection-${evidenceSelectionReasonById.get(chunk.id)}` : "",
          mechanismProtected ? "mechanism-protected-evidence" : "",
          startsWithFragment ? "starts-with-fragment" : "",
          endsWithFragment ? "ends-with-fragment" : "",
          linked ? "linked-entity-or-relation" : "",
          highMatch ? "high-match-chunk" : "",
          queryMatches.length ? "query-token-match" : "",
          sourceExpansionMatches.length ? "source-expansion-match" : "",
          seedMatches.length ? "seed-label-match" : "",
          eventMatches.length ? "event-chain-term-match" : "",
          mechanismMatches.length ? "mechanism-term-match" : "",
          downrankPenalty ? "mechanism-background-downrank" : "",
          healingCueScore >= 18 ? "healing-mechanism-cue" : "",
          dangerCueScore >= 10 ? "danger-cue" : "",
        ].filter(Boolean);
        return {
          chunkId: chunk.id,
          documentId: chunk.documentId,
          ordinal: chunk.ordinal ?? chunk.index ?? null,
          selected,
          score,
          reasons,
          queryMatches,
          sourceExpansionMatches,
          seedMatches,
          eventMatches,
          mechanismMatches,
          operationalMatches,
          outcomeMatches,
          downrankMatches,
          downrankPenalty,
          healingCueScore,
          dangerCueScore,
          protectedKind: mechanismProtectedItem?.protectedKind || "",
          startsWithFragment,
          endsWithFragment,
          text: String(text),
        };
      })
      .filter((item) => item.score > 0 || item.reasons.length)
      .sort((a, b) => Number(a.ordinal ?? 0) - Number(b.ordinal ?? 0))
      .slice(0, Number.isFinite(Number(payload?.debugEvidenceLimit || config.debugEvidenceLimit)) && Number(payload?.debugEvidenceLimit || config.debugEvidenceLimit) > 0 ? Math.floor(Number(payload?.debugEvidenceLimit || config.debugEvidenceLimit)) : Number.POSITIVE_INFINITY);
    const evidenceTraceLines = evidenceTrace.map((item) =>
      `[C${item.ordinal ?? "?"}${item.selected ? " selected" : ""} score=${Number(item.score || 0).toFixed(2)}] reasons=${item.reasons.join(",") || "none"} kind=${item.protectedKind || "-"} query=${item.queryMatches.join("|") || "-"} source=${(item.sourceExpansionMatches || []).join("|") || "-"} seed=${item.seedMatches.join("|") || "-"} event=${item.eventMatches.join("|") || "-"} mechanism=${item.mechanismMatches.join("|") || "-"} downrank=${(item.downrankMatches || []).join("|") || "-"} danger=${Number(item.dangerCueScore || 0).toFixed(0)} operational=${item.operationalMatches.join("|") || "-"} outcome=${item.outcomeMatches.join("|") || "-"} text="${String(item.text || "").replace(/\s+/g, " ")}"`
    );
    const rawContext = [
      `Knowledge Graph query: ${cleanQuery}`,
      `Graph context mode: ${includeIsolated ? "debug-with-isolated" : "connected"} (${connectedEntityCount} connected, ${isolatedEntityCount} isolated candidates hidden)`,
      chunkScoreById.size ? `Answer evidence expansion: ${answerExpansionRelationCount} relation(s) from ${chunkScoreById.size} high-match chunk(s)` : "",
      processWindowEvents.length ? `Process event window: ${processWindowEvents.length} ordered predecessor/outcome event(s)` : "",
      rankedSeeds.length ? `Matched entities: ${rankedSeeds.map((item) => `${item.entity.label} score=${item.score.toFixed(2)}`).join(", ")}` : "",
      entityLines.length ? `Entities:\n${entityLines.join("\n")}` : "Entities: none",
      relationLines.length ? `Relations:\n${relationLines.join("\n")}` : "Relations: none",
      eventLines.length ? `Events:\n${eventLines.join("\n")}` : "",
      evidenceLines.length ? `Evidence:\n${evidenceLines.join("\n\n")}` : "",
      evidenceTraceLines.length ? `Evidence trace:\n${evidenceTraceLines.join("\n")}` : "",
    ].filter(Boolean).join("\n\n");
    const context = rawContext;
    const record = {
      id: uniqueId("kgquery"),
      workspaceId,
      query: cleanQuery,
      context,
      entities: entitiesResult,
      relations: relationsResult,
      events: eventsResult,
      evidence,
      debug: {
        evidenceTrace,
        eventChainTerms,
        mechanismEvidenceTerms,
        queryTokens,
        retrievalTokens,
        sourceExpansionTokens,
        ruleSourceExpansionTokens,
        ruleDangerExpansionTokens,
        aiSourceExpansionTokens: aiExpansion.tokens || [],
        queryExpansion: {
          mode: queryExpansionMode,
          provider: aiExpansion.provider || "",
          model: aiExpansion.model || "",
          error: aiExpansion.error || "",
          promptMode: aiExpansion.promptMode || "",
          intentHints: aiExpansion.intentHints || [],
          rationale: aiExpansion.rationale || "",
        },
        mechanismCue: {
          mode: mechanismCueMode,
          external: mechanismCueAi.external === true,
          sourceNodeId: mechanismCueAi.sourceNodeId || "",
          id: mechanismCueAi.id || "",
          provider: mechanismCueAi.provider || "",
          model: mechanismCueAi.model || "",
          error: mechanismCueAi.error || "",
          promptMode: mechanismCueAi.promptMode || "",
          operationalTerms: mechanismCueAi.operationalTerms || [],
          transformationTerms: mechanismCueAi.transformationTerms || [],
          outcomeTerms: mechanismCueAi.outcomeTerms || [],
          downrankTerms: mechanismCueAi.downrankTerms || [],
          terms: mechanismCueAi.terms || [],
          rationale: mechanismCueAi.rationale || "",
          failed: llmMechanismCueFailed,
        },
        seedLabels,
        selectedEvidenceChunkIds: [...selectedEvidenceChunkIds],
        mechanismProtectedChunkIds: mechanismProtectedEvidence.map((item) => item.chunk?.id).filter(Boolean),
        evidenceMode,
        includeAdjacentChunks,
        autoAdjacentProtectedEvidence,
        preserveDocumentOrder,
        protectedEvidence: protectedEvidenceEnabled,
      },
      resultCount: entitiesResult.length,
      relationCount: relationsResult.length,
      eventCount: eventsResult.length,
      scope: {
        workspaceId,
        collectionId,
        configuredDocumentId,
        documentId,
        documentIds: unique(scopedEntities.map((entity) => entity.documentId).filter(Boolean)),
        graphScope,
        documentStatus,
        depth,
        relationTypes,
        includeIsolated,
        connectedEntityCount,
        isolatedEntityCount,
        answerExpansionChunkCount: chunkScoreById.size,
        answerExpansionRelationCount,
        processWindowEventCount: processWindowEvents.length,
        evidenceTraceCount: evidenceTrace.length,
        queryExpansionMode,
        queryExpansionError: aiExpansion.error || "",
        mechanismCueError: mechanismCueAi.error || "",
        mechanismCueFailed: llmMechanismCueFailed,
        sourceExpansionTokenCount: sourceExpansionTokens.length,
        evidenceMode,
        includeAdjacentChunks,
        autoAdjacentProtectedEvidence,
        preserveDocumentOrder,
        protectedEvidence: protectedEvidenceEnabled,
        queryIntent: intent,
        eventCount: eventsResult.length,
        mode: "knowledge-graph",
      },
      status: "ready",
      createdAt: nowIso(),
    };
    await putRecord(STORES.queries, record);
    return record;
  };

  const emptyGraphQuery = async ({ workspaceId, query = "", config = {}, payload = {}, reason = "missing-graph-source" } = {}) => {
    const cleanQuery = String(query || config.query || payload?.entity || payload?.label || "").trim();
    const collectionId = String(payload?.collectionId || payload?.metadata?.collectionId || config.collectionId || "").trim();
    const configuredDocumentId = String(payload?.documentId || config.documentId || "").trim();
    const depth = Number.isFinite(Number(payload?.depth || config.depth)) && Number(payload?.depth || config.depth) > 0
      ? Math.floor(Number(payload?.depth || config.depth))
      : 1;
    const relationTypes = splitConfigList(payload?.relationTypes || config.relationTypes).map((item) => item.toLowerCase());
    const context = [
      `Knowledge Graph query: ${cleanQuery}`,
      `Graph source: ${reason}`,
      "Entities: none",
      "Relations: none",
    ].join("\n\n");
    const record = {
      id: uniqueId("kgquery"),
      workspaceId,
      query: cleanQuery,
      context,
      entities: [],
      relations: [],
      evidence: [],
      resultCount: 0,
      relationCount: 0,
      scope: {
        workspaceId,
        collectionId,
        configuredDocumentId,
        documentId: "",
        documentStatus: reason,
        depth,
        relationTypes,
        mode: "knowledge-graph",
      },
      status: reason,
      createdAt: nowIso(),
    };
    await putRecord(STORES.queries, record);
    return record;
  };

  const reasoningStopWords = new Set([
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "by", "is", "are", "was", "were",
    "il", "lo", "la", "i", "gli", "le", "un", "una", "e", "o", "di", "del", "della", "che", "con", "per", "come", "cosa", "chi",
    "el", "la", "los", "las", "un", "una", "y", "o", "de", "que", "con", "por", "como",
    "le", "la", "les", "un", "une", "et", "ou", "de", "des", "que", "avec", "pour", "comment",
  ]);

  const reasoningTokens = (value = "") =>
    unique(normalizeEntityToken(value)
      .split(/\s+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 3 && !reasoningStopWords.has(item)));

  const reasoningTokenOverlap = (tokens = [], value = "") => {
    const normalized = normalizeEntityToken(value);
    if (!normalized || !tokens.length) return 0;
    return tokens.reduce((score, token) => score + (new RegExp(`\\b${escapedRegExp(token)}\\b`).test(normalized) ? 1 : 0), 0);
  };

  const detectReasoningIntent = (query = "", config = {}) => {
    const configured = String(config.intentMode || "auto").toLowerCase().trim();
    if (configured && configured !== "auto") return configured;
    const normalized = normalizeEntityToken(query);
    if (config.queryIntent?.source) return "source";
    if (/^(?:who|chi|quien|quién|qui|wer)\b/.test(normalized) &&
      /\b(?:dice|disse|detto|racconta|racconto|raccontò|spiega|spiego|spiegò|rivela|rivelo|rivelò|indica|indico|indicò|comunica|comunico|comunicò|avverte|avverti|avvertì|tells|told|says|said|explains|explained|reveals|revealed|warns|warned|indicates|indicated)\b/.test(normalized)) return "source";
    if (config.queryIntent?.danger || graphDangerIntentPattern.test(normalized)) return "danger";
    if (config.queryIntent?.healing || config.queryIntent?.process || config.queryIntent?.cause) return "mechanism";
    if (/\b(?:how|come|como|cómo|comment|wie|why|perche|perché|porque|por que|pourquoi|warum|dettagli|dettaglio|passaggi|processo|spiega|spiegami)\b/.test(normalized)) return "mechanism";
    if (/^(?:when|quando|cu[aá]ndo|quand|wann)\b/.test(normalized) || /\b(?:timeline|sequence|ordine|sequenza|chronolog)\b/.test(normalized)) return "timeline";
    if (/^(?:who|what|chi|cosa|che cosa|que|qué|qui|quoi)\b/.test(normalized)) return "definition";
    if (/\b(?:compare|comparison|difference|differenza|diferencia|diff[eé]rence|versus|vs)\b/.test(normalized)) return "comparison";
    return "fact";
  };

  const eventReasoningText = (event = {}) => [
    event.eventType,
    event.subject,
    ...(event.objects || []),
    ...(event.participants || []),
    ...(event.roles?.agent || []),
    ...(event.roles?.patient || []),
    ...(event.roles?.object || []),
    ...(event.roles?.destination || []),
    event.evidence?.quote || event.evidence?.text || event.evidence || "",
  ].filter(Boolean).join(" ");

  const scoreReasoningEvent = (event = {}, tokens = [], intent = "fact") => {
    let score = Math.min(12, Number(event.score || 0));
    score += reasoningTokenOverlap(tokens, eventReasoningText(event)) * 12;
    if (event.evidence?.quote || event.evidence?.text || event.evidence) score += 4;
    if (event.roles?.patient?.length || event.roles?.destination?.length) score += 3;
    if (intent === "mechanism" && ["fills", "immerses", "transforms", "takes", "drinks", "gives_to", "receives_from", "causes", "leads_to", "speaks", "heals"].includes(event.eventType)) score += 8;
    if (intent === "mechanism" && event.eventType === "cannot_speak") score -= 6;
    if (intent === "danger" && ["encounters", "confronts", "attacks", "hurts", "opposes", "threatens"].includes(event.eventType)) score += 10;
    if (intent === "danger" && graphDangerCueScore(eventReasoningText(event), { danger: true }) >= 10) score += 14;
    if (intent === "danger" && ["fills", "immerses", "transforms", "drinks", "heals", "speaks"].includes(event.eventType) && graphDangerCueScore(eventReasoningText(event), { danger: true }) < 10) score -= 10;
    return score;
  };

  const dangerReasoningEventRelevant = (event = {}, tokens = []) => {
    const text = eventReasoningText(event);
    if (!text) return false;
    const relationType = String(event.eventType || "").toLowerCase();
    if (["encounters", "confronts", "attacks", "hurts", "threatens", "opposes"].includes(relationType)) return true;
    return graphDangerCueScore(text, { danger: true }) >= 10 && reasoningTokenOverlap(tokens, text) > 0;
  };

  const dangerReasoningRelationRelevant = (relation = {}, tokens = []) => {
    const text = relationReasoningText(relation);
    if (!text) return false;
    const relationType = String(relation.relationType || relation.type || "").toLowerCase();
    if (["encounters", "confronts", "attacks", "hurts", "threatens", "opposes"].includes(relationType)) return true;
    if (["asks_for", "gives_to", "receives_from", "says", "reveals", "teaches", "explains", "has_property", "healed_by", "cannot_speak", "friend_of", "lives_in", "appears_in", "context_for", "co_occurs", "associated_with"].includes(relationType)) {
      return false;
    }
    return graphDangerCueScore(text, { danger: true }) >= 10 && reasoningTokenOverlap(tokens, text) > 0;
  };

  const sourceReasoningEventRelevant = (event = {}, tokens = []) => {
    const text = eventReasoningText(event);
    const normalized = normalizeEntityToken(text);
    if (!normalized) return false;
    const sourceCue = graphSourceCueScore(text, { source: true }) >= 14;
    if (!sourceCue) return false;
    const overlap = reasoningTokenOverlap(tokens, text);
    const namesSource = /\b(?:anziano|anziana|elder|old man|old woman|anciano|anciana|vieil homme|vieille femme)\b/.test(normalized);
    const answerGoal = /\b(?:cura|guarire|guar|liber|voce|parlare|heal|cure|voice|speak)\b/.test(normalized);
    return overlap >= 2 || (namesSource && answerGoal);
  };

  const sourceReasoningRelationRelevant = (relation = {}, tokens = []) => {
    const text = reasoningEvidenceText(relation) || [
      relation.sourceLabel || relation.source || "",
      relation.relationType || relation.type || "",
      relation.targetLabel || relation.target || "",
    ].join(" ");
    const normalized = normalizeEntityToken(text);
    if (!normalized) return false;
    const relationType = String(relation.relationType || relation.type || "").toLowerCase();
    const sourceRelation = ["says", "reveals", "teaches", "explains", "asks_for", "gives_to", "receives_from"].includes(relationType);
    const sourceCue = sourceRelation || graphSourceCueScore(text, { source: true }) >= 14;
    if (!sourceCue) return false;
    const overlap = reasoningTokenOverlap(tokens, text);
    const namesSource = /\b(?:anziano|anziana|elder|old man|old woman|anciano|anciana|vieil homme|vieille femme)\b/.test(normalized);
    const answerGoal = /\b(?:cura|guarire|guar|liber|voce|parlare|heal|cure|voice|speak)\b/.test(normalized);
    return overlap >= 2 || (namesSource && answerGoal);
  };

  const mechanismProcessEventTypes = new Set(["fills", "immerses", "transforms", "takes", "drinks", "gives_to", "receives_from", "uses", "heals", "speaks"]);

  const mechanismCoreStartEventTypes = new Set(["fills", "immerses", "transforms", "causes", "leads_to", "has_property"]);

  const mechanismOperationalStartEventTypes = new Set(["fills", "immerses", "transforms", "uses", "gives_to", "receives_from", "takes", "drinks"]);

  const mechanismOutcomeEventTypes = new Set(["drinks", "speaks", "heals", "causes", "leads_to"]);

  const mechanismHasEvidence = (event = {}) =>
    Boolean(event.evidence?.quote || event.evidence?.text || event.evidence);

  const mechanismEventKey = (event = {}, index = 0) =>
    event.id || `${event.sequence ?? ""}:${event.eventType || ""}:${event.subject || ""}:${index}`;

  const mechanismQueryAsksSpeechOutcome = (tokens = []) =>
    tokens.some((token) => /^(?:voc|voce|voice|speak|spoken|parl|habl|voz|word|parol)/.test(token));

  const mechanismEventsForReasoning = (events = [], tokens = [], maxEvents = 12) => {
    const ordered = [...events].sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
    const coreStart = ordered.find((item) =>
      mechanismCoreStartEventTypes.has(item.eventType) &&
      mechanismHasEvidence(item)
    ) || ordered.find((item) => mechanismCoreStartEventTypes.has(item.eventType));
    const operationalStart = coreStart || ordered.find((item) =>
      mechanismOperationalStartEventTypes.has(item.eventType) &&
      mechanismHasEvidence(item)
    );
    if (!operationalStart) {
      return ordered
        .filter((item) => reasoningTokenOverlap(tokens, eventReasoningText(item)) > 0)
        .filter(mechanismHasEvidence)
        .slice(0, maxEvents);
    }
    const startSequence = Number(operationalStart.sequence || 0);
    const asksSpeechOutcome = mechanismQueryAsksSpeechOutcome(tokens);
    const outcome = ordered
      .map((item) => {
        const sequence = Number(item.sequence || 0);
        const overlap = reasoningTokenOverlap(tokens, eventReasoningText(item));
        const speechGoalScore = asksSpeechOutcome && item.eventType === "speaks" ? 18 : 0;
        const typeScore = item.eventType === "heals" ? 16 : item.eventType === "speaks" ? 12 : item.eventType === "drinks" ? 8 : 4;
        const hasSignal = sequence >= startSequence &&
          mechanismHasEvidence(item) &&
          mechanismOutcomeEventTypes.has(item.eventType) &&
          (overlap > 0 || speechGoalScore > 0 || ["drinks", "heals"].includes(item.eventType));
        return { item, sequence, score: hasSignal ? (overlap * 10) + speechGoalScore + typeScore : 0 };
      })
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score || right.sequence - left.sequence)[0]?.item;
    const endSequence = Number(outcome?.sequence || 0) || startSequence + 8;
    const prelude = ordered
      .filter((item) => {
        const sequence = Number(item.sequence || 0);
        return sequence < startSequence && sequence >= startSequence - 4;
      })
      .filter(mechanismHasEvidence)
      .slice(-3);
    const processEvents = ordered
      .filter((item) => {
        const sequence = Number(item.sequence || 0);
        if (sequence < startSequence || sequence > endSequence) return false;
        if (!mechanismProcessEventTypes.has(item.eventType) && !mechanismCoreStartEventTypes.has(item.eventType)) return false;
        return mechanismHasEvidence(item);
      });
    const outcomeTail = outcome ? ordered
      .filter((item) => {
        const sequence = Number(item.sequence || 0);
        if (sequence <= endSequence || sequence > endSequence + 3) return false;
        if (!mechanismHasEvidence(item)) return false;
        if (item.eventType === outcome.eventType) return true;
        if (mechanismOutcomeEventTypes.has(item.eventType) && reasoningTokenOverlap(tokens, eventReasoningText(item)) > 0) return true;
        return reasoningTokenOverlap(tokens, eventReasoningText(item)) > 1;
      })
      .slice(0, 3)
      : [];
    const seen = new Set();
    return [...prelude, ...processEvents, ...outcomeTail]
      .filter((item, index) => {
        const key = mechanismEventKey(item, index);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, maxEvents);
  };

  const enrichMechanismEventRoles = (event = {}, allEvents = []) => {
    if (event.eventType !== "immerses" || event.roles?.destination?.length) return event.roles || {};
    const eventEvidence = String(event.evidence?.quote || event.evidence?.text || event.evidence || "");
    const companion = allEvents.find((item) =>
      item.eventType === "fills" &&
      String(item.evidence?.quote || item.evidence?.text || item.evidence || "") === eventEvidence
    );
    if (!companion) return event.roles || {};
    const destination = unique([...(companion.roles?.patient || []), ...(companion.objects || [])].filter(isNarrativeLiquidOrContainer));
    return {
      ...(event.roles || {}),
      destination,
      participants: unique([...(event.roles?.participants || []), ...destination].filter(Boolean)),
    };
  };

  const relationReasoningText = (relation = {}) => [
    relation.relationType,
    relation.sourceLabel,
    relation.targetLabel,
    relation.source,
    relation.target,
    relation.evidence?.quote || relation.evidence?.text || relation.metadata?.evidence?.quote || relation.evidence || "",
    relation.metadata?.explanation || relation.explanation || "",
  ].filter(Boolean).join(" ");

  const scoreReasoningRelation = (relation = {}, tokens = [], intent = "fact") => {
    let score = Number(relation.score || 0);
    score += reasoningTokenOverlap(tokens, relationReasoningText(relation)) * 10;
    if (relation.direct) score += 4;
    if (relation.semantic || relation.metadata?.semantic) score += 4;
    if (relation.evidence || relation.evidence?.quote || relation.metadata?.evidence?.quote) score += 3;
    if (intent === "mechanism" && ["healed_by", "causes", "leads_to"].includes(relation.relationType)) score += 4;
    if (intent === "mechanism" && ["appears_in", "context_for", "co_occurs", "associated_with"].includes(relation.relationType)) score -= 8;
    if (intent === "source" && ["says", "reveals", "teaches", "explains", "asks_for", "gives_to", "receives_from"].includes(relation.relationType)) score += 18;
    if (intent === "source" && ["appears_in", "context_for", "co_occurs", "associated_with"].includes(relation.relationType)) score -= 12;
    if (intent === "danger" && ["encounters", "confronts", "attacks", "hurts", "threatens", "opposes"].includes(relation.relationType)) score += 14;
    if (intent === "danger" && graphDangerCueScore(relationReasoningText(relation), { danger: true }) >= 10) score += 12;
    if (intent === "danger" && ["appears_in", "context_for", "co_occurs", "associated_with"].includes(relation.relationType)) score -= 8;
    return score;
  };

  const reasoningFactFromEvent = (event = {}, index = 0, allEvents = []) => ({
    id: event.id || `event_${index + 1}`,
    kind: "event",
    sequence: event.sequence ?? null,
    eventType: event.eventType || "",
    subject: event.subject || "",
    objects: event.objects || [],
    roles: enrichMechanismEventRoles(event, allEvents),
    modality: event.modality || "asserted",
    aspect: event.aspect || "completed",
    polarity: event.polarity || "positive",
    confidence: Number(event.confidence || 0),
    evidence: event.evidence?.quote || event.evidence?.text || event.evidence || "",
    instruction: "Use this fact only as supported by its evidence.",
  });

  const reasoningFactFromRelation = (relation = {}, index = 0) => ({
    id: relation.id || `relation_${index + 1}`,
    kind: "relation",
    relationType: relation.relationType || relation.type || "",
    source: relation.sourceLabel || relation.source || "",
    target: relation.targetLabel || relation.target || "",
    confidence: Number(relation.confidence || 0),
    evidence: relation.evidence?.quote || relation.evidence?.text || relation.metadata?.evidence?.quote || relation.evidence || "",
    instruction: "Use as supporting relation, not as a replacement for a more precise event chain.",
  });

  const reasoningEvidenceText = (item = {}) =>
    String(item.text || item.evidence?.text || item.evidence?.quote || item.evidence || "").trim();

  const trimMechanismSourceEvidence = (text = "") => {
    const value = String(text || "").trim();
    if (!value) return "";
    return value;
  };

  const evidenceSentenceBoundaryIndex = (text = "", maxChars = 1800) => {
    if (!Number.isFinite(Number(maxChars)) || Number(maxChars) <= 0) return text.length;
    const limit = Math.max(120, Math.min(text.length, maxChars));
    const slice = text.slice(0, limit);
    const matches = [...slice.matchAll(/[.!?;:»”](?=\s|$)|\n(?=\s*[—«"A-ZÀ-Ý])/gu)];
    const boundary = matches.map((match) => match.index || 0).filter((index) => index > limit * 0.45).pop();
    return Number.isFinite(boundary) ? boundary + 1 : limit;
  };

  const trimLeadingEvidenceFragment = (text = "") => {
    const value = String(text || "").trim();
    if (!value) return "";
    if (/^(?:[—«"“]|[A-ZÀ-Ý0-9])/u.test(value)) return value;
    const cue = value.search(/(?:^|\n)\s*(?:[—«"“]|\p{Lu}[\p{L}'’-]*\b)/u);
    if (cue > 0 && cue <= 260) return value.slice(cue).trim();
    const sentence = value.search(/[.!?;:»”]\s+(?:[—«"“]|\p{Lu})/u);
    if (sentence > 0 && sentence <= 260) return value.slice(sentence + 1).trim();
    return value;
  };

  const cleanReasoningEvidenceText = (text = "", { maxChars = 1800, trimLeading = true } = {}) => {
    const limit = Number(maxChars);
    let value = String(text || "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!value) return "";
    if (trimLeading) value = trimLeadingEvidenceFragment(value);
    const paragraphs = value
      .split(/\n{2,}/g)
      .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const deduped = [];
    paragraphs.forEach((paragraph) => {
      const normalized = normalizeKnowledgeText(paragraph);
      if (!normalized) return;
      const duplicateIndex = deduped.findIndex((existing) => {
        const existingNormalized = normalizeKnowledgeText(existing);
        return existingNormalized.includes(normalized) || normalized.includes(existingNormalized);
      });
      if (duplicateIndex >= 0) {
        if (paragraph.length > deduped[duplicateIndex].length) deduped[duplicateIndex] = paragraph;
        return;
      }
      deduped.push(paragraph);
    });
    value = deduped.join("\n\n").trim();
    if (Number.isFinite(limit) && limit > 0 && value.length > limit) {
      const boundary = evidenceSentenceBoundaryIndex(value, limit);
      value = `${value.slice(0, boundary).trim()}\n...`;
    } else {
      const lastBoundary = Math.max(
        value.lastIndexOf("."),
        value.lastIndexOf("!"),
        value.lastIndexOf("?"),
        value.lastIndexOf(";"),
        value.lastIndexOf(":"),
        value.lastIndexOf("»"),
        value.lastIndexOf("”")
      );
      if (lastBoundary > value.length * 0.55 && value.length - lastBoundary <= 180) {
        value = value.slice(0, lastBoundary + 1).trim();
      }
    }
    return value;
  };

  const cleanReasoningEvidenceList = (items = [], { maxItems = 8, maxChars = 1800, preserveBlocks = false, trimLeading = true } = {}) => {
    const itemLimit = Number(maxItems);
    const output = [];
    items
      .map((item) => cleanReasoningEvidenceText(item, { maxChars, trimLeading }))
      .filter(Boolean)
      .flatMap((item) => preserveBlocks ? [item] : item.split(/\n{2,}/g).map((paragraph) => paragraph.trim()).filter(Boolean))
      .forEach((item) => {
        const normalized = normalizeKnowledgeText(item);
        const duplicateIndex = output.findIndex((existing) => {
          const existingNormalized = normalizeKnowledgeText(existing);
          return existingNormalized.includes(normalized) || normalized.includes(existingNormalized);
        });
        if (duplicateIndex >= 0) {
          if (item.length > output[duplicateIndex].length) output[duplicateIndex] = item;
          return;
        }
        output.push(item);
      });
    return output.slice(0, Number.isFinite(itemLimit) && itemLimit > 0 ? Math.floor(itemLimit) : Number.POSITIVE_INFINITY);
  };

  const joinReasoningEvidenceBlocks = (items = [], options = {}) =>
    cleanReasoningEvidenceList(items, options).join("\n\n");

  const evidenceDocumentOrder = (item = {}) => {
    const value = Number(item.index ?? item.ordinal ?? item.start ?? item.metadata?.index ?? item.metadata?.ordinal ?? 0);
    return Number.isFinite(value) ? value : 0;
  };

  const markEvidenceBoundaryFragments = (text = "") => {
    let value = String(text || "").trim();
    if (!value) return "";
    if (/^[a-zà-ÿ]/u.test(value)) value = `... ${value}`;
    if (/[A-Za-zÀ-ÿ0-9]$/u.test(value) && !/[.!?;:»”'"»)]$/u.test(value)) value = `${value} ...`;
    return value;
  };

  const composeFocusedSourceEvidence = ({ evidence = [], tokens = [], eventFacts = [], maxItems = 2, maxChars = 1800 } = {}) => {
    if (!Array.isArray(evidence) || !evidence.length) return "";
    const protectedEvidence = evidence
      .filter((item) => item.selectionReason === "mechanism-protected")
      .sort((left, right) => evidenceDocumentOrder(left) - evidenceDocumentOrder(right))
      .slice(0, Number.isFinite(Number(maxItems)) && Number(maxItems) > 0 ? Math.floor(Number(maxItems)) : Number.POSITIVE_INFINITY)
      .map((item) => cleanReasoningEvidenceText(markEvidenceBoundaryFragments(trimMechanismSourceEvidence(reasoningEvidenceText(item))), { maxChars, trimLeading: false }))
      .filter(Boolean);
    const eventSnippets = eventFacts
      .map((fact) => String(fact.evidence || "").trim())
      .filter((item) => item.length >= 24);
    const scoredEvidence = evidence
      .filter((item) => item.selectionReason !== "mechanism-protected")
      .map((item) => {
        const text = reasoningEvidenceText(item);
        if (!text) return { item, text: "", score: 0 };
        const normalized = normalizeEntityToken(text);
        const tokenScore = tokens.reduce((score, token) => score + (token && normalized.includes(token) ? 4 : 0), 0);
        const eventScore = eventSnippets.reduce((score, snippet) => {
          const compactSnippet = normalizeEntityToken(snippet);
          return score + (compactSnippet && normalized.includes(compactSnippet) ? 10 : 0);
        }, 0);
        return { item, text, score: tokenScore + eventScore };
      })
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, Number.isFinite(Number(maxItems)) && Number(maxItems) > 0 ? Math.max(0, Math.floor(Number(maxItems)) - protectedEvidence.length) : Number.POSITIVE_INFINITY)
      .sort((left, right) => evidenceDocumentOrder(left.item) - evidenceDocumentOrder(right.item))
      .map((item) => cleanReasoningEvidenceText(markEvidenceBoundaryFragments(trimMechanismSourceEvidence(item.text)), { maxChars, trimLeading: false }))
      .filter(Boolean);
    return cleanReasoningEvidenceList([...protectedEvidence, ...scoredEvidence], { maxItems, maxChars, preserveBlocks: true, trimLeading: false }).join("\n\n");
  };

  const reasoningCompositionMode = (config = {}) => {
    const mode = String(config.compositionMode || config.mode || "llm").toLowerCase().trim();
    if (mode === "ai") return "llm";
    return ["rules", "llm", "hybrid"].includes(mode) ? mode : "rules";
  };

  const reasoningEvidencePool = (payload = {}, plan = {}) =>
    unique([
      plan.primaryEvidenceText || "",
      payload.context || "",
      ...(payload.evidence || []).map((item) => item.text || item.evidence?.text || item.evidence?.quote || ""),
      ...(plan.requiredFacts || []).map((fact) => fact.evidence || ""),
    ].map((item) => String(item || "").trim()).filter(Boolean));

  const reasoningQuoteSupported = (quote = "", evidencePool = []) => {
    const cleanQuote = String(quote || "").replace(/\s+/g, " ").trim();
    if (cleanQuote.length < 8) return false;
    const normalizedQuote = normalizeKnowledgeText(cleanQuote);
    return evidencePool.some((item) => normalizeKnowledgeText(item).includes(normalizedQuote));
  };

  const reasoningMechanismOperationalEvidence = (text = "") => {
    const normalized = normalizeEntityToken(text);
    if (!normalized) return false;
    const strongOperation = /\b(?:use|using|used|uses|usa|usato|prepara|preparare|prepare|prepared|riemp\w*|fill\w*|immerg\w*|immerse\w*|trasform\w*|transform\w*|boll\w*|boil\w*|beve|beva|bevve|bevuto|bere|drink|drank|drinks)\b/.test(normalized);
    const materialCueCount = [
      /\b(?:source|material|ingredient|strumento|tool|mezzo|object|oggetto|elemento|substance|sostanza)\b/.test(normalized),
      /\b(?:outcome|result|risultato|esito|effect|effetto|successo|riesce|finally)\b/.test(normalized),
      /\b(?:process|processo|passaggio|step|method|metodo|mechanism|meccanismo)\b/.test(normalized),
    ].filter(Boolean).length;
    return strongOperation || materialCueCount >= 2;
  };

  const reasoningMechanismFocusSupported = ({ answerFocus = "", primaryEvidenceText = "", selectedEvidenceQuotes = [] } = {}) => {
    const focus = String(answerFocus || "").trim();
    if (!focus) return false;
    const evidenceText = [primaryEvidenceText, ...selectedEvidenceQuotes].join("\n\n");
    if (!reasoningMechanismOperationalEvidence(evidenceText)) return false;
    return true;
  };

  const salvageReasoningPatchFromText = (text = "") => {
    const answerFocus = String(text || "")
      .replace(/^```[a-z]*\s*/i, "")
      .replace(/\s*```$/i, "")
      .replace(/\s+/g, " ")
      .trim()
      ;
    if (!answerFocus) return null;
    return {
      answerFocus,
      selectedEvidenceQuotes: [],
      confidence: 0.35,
    };
  };

  const callReasoningComposerAi = async ({ payload = {}, localPlan = {}, config = {} } = {}) => {
    const mode = reasoningCompositionMode(config);
    if (!["llm", "hybrid"].includes(mode)) return { patch: null, provider: "", model: "", usage: {}, error: "", promptMode: "" };
    const hasExplicitProvider = Boolean(config.providerProfile || config.profileId || config.providerType || config.provider || config.model);
    const providerConfig = hasExplicitProvider ? config : { ...config, providerType: "lm-studio" };
    const provider = await pickAiProvider({ ...providerConfig, enrichmentMode: "ai" });
    if (!provider) return { patch: null, provider: "", model: "", usage: {}, error: "provider-not-found", promptMode: "" };
    const providerType = String(provider.provider || provider.providerType || providerConfig.providerType || providerConfig.provider || "").toLowerCase();
    const requestedModel = String(providerConfig.model || provider.model || (providerType === "ollama" ? "llama3.1" : "local-model")).trim();
    const model = providerType === "ollama"
      ? requestedModel
      : await resolveOpenAiCompatibleModel({ provider, model: requestedModel });
    const systemPrompt = knowledgeAiTextConfig(
      config.systemPrompt,
      "You are a Knowledge Reasoning Composer. Build an answer plan from supplied graph evidence without inventing facts."
    );
    const promptTemplate = knowledgeAiTextConfig(
      config.promptTemplate,
      "Use the local reasoning plan, graph evidence and original source excerpts. Improve evidence focus and selected evidence while preserving enough source text for the downstream LLM."
    );
    const outputInstructions = knowledgeAiTextConfig(
      config.outputInstructions,
      "Return strict JSON with answerFocus and selectedEvidenceQuotes. Use answerFocus only to name the evidence focus, not to decide final wording or answer length. Every selected quote must appear verbatim in the supplied evidence."
    );
    const evidencePool = reasoningEvidencePool(payload, localPlan);
    const schema = {
      answerFocus: "evidence focus/topic for the downstream LLM, not final wording or length",
      selectedEvidenceQuotes: ["verbatim quote from evidencePool"],
      confidence: 0.0,
    };
    const promptFor = ({ mode: promptMode = "full" } = {}) => {
      const compact = promptMode === "compact";
      const micro = promptMode === "micro";
      return [
        systemPrompt,
        promptTemplate,
        outputInstructions,
        "Return ONLY one valid JSON object. The first character must be { and the last character must be }.",
        "Do not wrap JSON in markdown. Do not add prose before or after JSON.",
        "Do not answer the user directly. Compose a plan for a later answer model.",
        "If older Reasoning Composer node instructions mention excludedContext, boundaries, brevity rules or answer-shape rules, ignore those parts.",
        "Do not constrain final verbosity, sentence count or tone; the downstream LLM must follow the user's prompt for that.",
        "Do not invent facts, speakers, relations, locations or outcomes.",
        "selectedEvidenceQuotes must be copied verbatim from evidencePool.",
        "For mechanism questions, selectedEvidenceQuotes must contain concrete operational evidence such as preparing, filling, immersing, transforming, drinking or the immediate outcome. Do not select background revelation/travel/location evidence unless it contains the actual operation.",
        "For mechanism questions, answerFocus must name the concrete operation/process, not the person who revealed it, the travel setup or later consequences.",
        "Prefer preserving source excerpts over over-filtering them.",
        "Schema:",
        JSON.stringify(schema),
        JSON.stringify({
          question: localPlan.query || payload.query || "",
          intent: localPlan.intent || "",
          localPlan: {
            requiredFacts: localPlan.requiredFacts || [],
            primaryEvidenceText: String(localPlan.primaryEvidenceText || ""),
          },
          evidencePool: evidencePool.map((item) => String(item || "")),
        }),
      ].join("\n\n");
    };
    try {
      const endpoint = String(provider.endpoint || (providerType === "ollama" ? "http://127.0.0.1:11434" : "http://127.0.0.1:1234")).replace(/\/+$/g, "");
      const url = providerType === "ollama"
        ? `${endpoint}/api/generate`
        : `${endpoint.endsWith("/v1") ? endpoint : `${endpoint}/v1`}/chat/completions`;
      let lastError = "";
      let lastText = "";
      let lastModel = model;
      let totalUsage = {};
      for (const promptMode of (mode === "hybrid" ? ["full"] : ["full", "compact", "micro"])) {
        const prompt = promptFor({ mode: promptMode });
        const body = providerType === "ollama"
          ? {
            model,
            prompt,
            stream: false,
            options: {
              temperature: knowledgeAiNumberConfig(config.temperature, 0.05),
              top_p: knowledgeAiNumberConfig(config.topP, 0.9),
              num_predict: knowledgeCompletionLimit({ config, providerType, provider, requested: 900, min: 1 }),
            },
          }
          : {
            model,
            messages: [{ role: "user", content: prompt }],
            temperature: knowledgeAiNumberConfig(config.temperature, 0.05),
            max_tokens: knowledgeCompletionLimit({ config, providerType, provider, requested: 900, min: 1 }),
            top_p: knowledgeAiNumberConfig(config.topP, 0.9),
          };
        knowledgeLlmDebug("reasoning-composer:request", {
          mode,
          promptMode,
          provider: provider.id || providerType || "",
          providerType,
          model,
          evidenceItems: evidencePool.length,
          promptChars: prompt.length,
          maxTokens: body.max_tokens || body.options?.num_predict || 0,
          promptPreview: compactDebugText(prompt),
        });
        const response = await postChatJson({ url, body, headers: headersForProvider(provider, config) });
        if (!response.ok) {
          const errorText = await chatErrorText(response);
          lastError = `HTTP ${response.status}${errorText ? `: ${errorText}` : ""}`;
          const canShrink = response.status === 400 || /context|token|too large|size/i.test(errorText);
          if (canShrink) continue;
          break;
        }
        const data = await response.json();
        const text = data.response || data.choices?.[0]?.message?.content || data.output_text || "";
        const usage = knowledgeAiUsageFromResponse({ data, prompt, text });
        totalUsage = addKnowledgeAiUsage(totalUsage, usage);
        lastText = text;
        lastModel = data.model || model;
        const patch = parseAiJsonObject(text);
        if (patch) {
          return {
            patch,
            provider: provider.id || providerType || "provider",
            model: lastModel,
            usage: totalUsage,
            error: "",
            promptMode,
          };
        }
        lastError = "invalid-ai-json";
      }
      const salvagedPatch = salvageReasoningPatchFromText(lastText);
      return {
        patch: salvagedPatch,
        provider: provider.id || providerType || "provider",
        model: lastModel,
        usage: totalUsage,
        error: salvagedPatch ? "salvaged-non-json" : (lastError || "invalid-ai-json"),
        promptMode: salvagedPatch ? "salvaged" : "",
      };
    } catch (error) {
      return { patch: null, provider: provider.id || providerType || "provider", model, usage: {}, error: error?.message || "ai-error", promptMode: "" };
    }
  };

  const mergeReasoningAiPatch = ({ payload = {}, plan = {}, aiResult = {}, config = {} } = {}) => {
    const mode = reasoningCompositionMode(config);
    const patch = aiResult?.patch && typeof aiResult.patch === "object" ? aiResult.patch : null;
    const evidencePool = reasoningEvidencePool(payload, plan);
    const intent = String(plan.intent || payload.intent || "").toLowerCase();
    const selectedEvidenceQuotes = Array.isArray(patch?.selectedEvidenceQuotes)
      ? unique(patch.selectedEvidenceQuotes
        .map((item) => String(item || "").replace(/\s+/g, " ").trim())
        .filter((item) => reasoningQuoteSupported(item, evidencePool))
        .filter((item) => intent !== "mechanism" || reasoningMechanismOperationalEvidence(item)))
        .slice(0, 8)
      : [];
    const cleanedSelectedEvidenceQuotes = cleanReasoningEvidenceList(selectedEvidenceQuotes, { maxItems: 8, maxChars: 1800 });
    const answerFocus = String(patch?.answerFocus || "").replace(/\s+/g, " ").trim();
    const acceptedAnswerFocus = intent === "mechanism"
      ? (reasoningMechanismFocusSupported({ answerFocus, primaryEvidenceText: plan.primaryEvidenceText || "", selectedEvidenceQuotes: cleanedSelectedEvidenceQuotes }) ? answerFocus : "")
      : answerFocus;
    const aiMetadata = {
      mode,
      provider: aiResult.provider || "",
      model: aiResult.model || "",
      error: aiResult.error || "",
      promptMode: aiResult.promptMode || "",
      confidence: Math.max(0, Math.min(1, Number(patch?.confidence || 0))),
      answerFocus,
      answerFocusAccepted: Boolean(acceptedAnswerFocus),
      selectedEvidenceQuotes: cleanedSelectedEvidenceQuotes,
    };
    return {
      ...plan,
      primaryEvidenceText: cleanedSelectedEvidenceQuotes.length
        ? cleanReasoningEvidenceList([plan.primaryEvidenceText || "", cleanedSelectedEvidenceQuotes.join("\n\n")], { maxItems: 10, maxChars: 2600, preserveBlocks: true, trimLeading: false }).join("\n\n")
        : cleanReasoningEvidenceText(plan.primaryEvidenceText || "", { maxChars: 3600 }),
      responseInstructions: unique([
        ...(acceptedAnswerFocus ? [`Answer focus: ${acceptedAnswerFocus}`] : []),
        ...(plan.responseInstructions || []),
      ]),
      excludedContext: [],
      evidenceQuotes: cleanReasoningEvidenceList([...(plan.evidenceQuotes || []), ...cleanedSelectedEvidenceQuotes], { maxItems: 12, maxChars: 1800 }),
      compositionMode: mode,
      ai: aiMetadata,
    };
  };

  const composeKnowledgeReasoningPlan = async ({ workspaceId = "", node = {}, payload = {}, event = {}, config = {} } = {}) => {
    const query = String(payload?.query || payload?.question || payload?.text || config.query || "").trim();
    const queryIntent = payload?.scope?.queryIntent || payload?.queryIntent || config.queryIntent || null;
    const intent = detectReasoningIntent(query, { ...config, queryIntent });
    const tokens = reasoningTokens(query);
    const maxFacts = Number.isFinite(Number(config.maxFacts || payload?.maxFacts)) && Number(config.maxFacts || payload?.maxFacts) > 0
      ? Math.floor(Number(config.maxFacts || payload?.maxFacts))
      : Number.POSITIVE_INFINITY;
    const maxEvents = Number.isFinite(Number(config.maxEvents || payload?.maxEvents)) && Number(config.maxEvents || payload?.maxEvents) > 0
      ? Math.floor(Number(config.maxEvents || payload?.maxEvents))
      : Number.POSITIVE_INFINITY;
    const includeBackground = config.includeBackground === true || config.includeBackground === "true" || payload?.includeBackground === true;
    const events = Array.isArray(payload?.events) ? payload.events : [];
    const relations = Array.isArray(payload?.relations) ? payload.relations : [];
    const selectedEvents = intent === "mechanism"
      ? mechanismEventsForReasoning(events, tokens, maxEvents)
      : intent === "source"
        ? events
          .map((item) => ({ item, score: scoreReasoningEvent(item, tokens, intent) }))
          .filter(({ item, score }) => score > 0 && sourceReasoningEventRelevant(item, tokens))
          .sort((a, b) => b.score - a.score)
          .slice(0, maxEvents)
          .sort((a, b) => Number(a.item.sequence || 0) - Number(b.item.sequence || 0))
          .map(({ item }) => item)
        : intent === "danger"
          ? events
            .map((item) => ({ item, score: scoreReasoningEvent(item, tokens, intent) }))
            .filter(({ item, score }) => score > 0 && dangerReasoningEventRelevant(item, tokens))
            .sort((a, b) => b.score - a.score)
            .slice(0, maxEvents)
            .sort((a, b) => Number(a.item.sequence || 0) - Number(b.item.sequence || 0))
            .map(({ item }) => item)
        : events
        .map((item) => ({ item, score: scoreReasoningEvent(item, tokens, intent) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxEvents)
        .sort((a, b) => Number(a.item.sequence || 0) - Number(b.item.sequence || 0))
        .map(({ item }) => item);
    const eventFacts = selectedEvents
      .map((item, index) => reasoningFactFromEvent(item, index, events))
      .map((fact) => ({
        ...fact,
        evidence: cleanReasoningEvidenceText(fact.evidence || "", { maxChars: 0 }),
      }));
    const rankedRelations = relations
      .map((item) => ({ item, score: scoreReasoningRelation(item, tokens, intent) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);
    const llmMechanismCueFailed = intent === "mechanism" && payload?.scope?.mechanismCueFailed === true;
    const broadMechanismEvidenceItems = llmMechanismCueFailed && Array.isArray(payload?.evidence)
      ? (() => {
        const orderedEvidence = [...payload.evidence].sort((left, right) => evidenceDocumentOrder(left) - evidenceDocumentOrder(right));
        const last = Math.max(0, orderedEvidence.length - 1);
        const sampleIndexes = unique([0, 1, Math.floor(last * 0.33), Math.floor(last * 0.5), last - 3, last - 2, last - 1, last]
          .filter((index) => index >= 0 && index <= last));
        return sampleIndexes
          .map((index) => orderedEvidence[index])
          .map((item) => cleanReasoningEvidenceText(markEvidenceBoundaryFragments(reasoningEvidenceText(item)), { maxChars: 0, trimLeading: false }))
          .filter(Boolean);
      })()
      : [];
    const focusedSourceEvidence = llmMechanismCueFailed
      ? ""
      : composeFocusedSourceEvidence({
      evidence: payload?.evidence || [],
      tokens,
      eventFacts,
      maxItems: 0,
      maxChars: 0,
    });
    const hasOperationalSourceEvidence = intent === "mechanism" && reasoningMechanismOperationalEvidence(focusedSourceEvidence);
    const supportingRelations = (intent === "mechanism" && (eventFacts.length || hasOperationalSourceEvidence) ? [] : rankedRelations)
      .filter(({ item }) => intent !== "source" || sourceReasoningRelationRelevant(item, tokens))
      .filter(({ item }) => intent !== "danger" || dangerReasoningRelationRelevant(item, tokens))
      .filter(({ item }) => includeBackground || !["appears_in", "context_for", "co_occurs", "associated_with"].includes(item.relationType || item.type || ""))
      .slice(0, Math.max(0, maxFacts - Math.min(eventFacts.length, maxFacts)))
      .map(({ item }, index) => reasoningFactFromRelation(item, index))
      .map((fact) => ({
        ...fact,
        evidence: cleanReasoningEvidenceText(fact.evidence || "", { maxChars: 0 }),
      }));
    const excludedContext = [];
    const responseInstructions = [
      "Use the supplied evidence as grounded context; final wording, detail level and emphasis follow the user's prompt.",
    ].filter(Boolean);
    const eventEvidenceText = joinReasoningEvidenceBlocks(
      eventFacts.map((fact) => String(fact.evidence || "").trim()).filter(Boolean),
      { maxItems: 0, maxChars: 0 }
    );
    const relationEvidenceText = joinReasoningEvidenceBlocks(
      supportingRelations.map((fact) => String(fact.evidence || "").trim()).filter(Boolean),
      { maxItems: 0, maxChars: 0 }
    );
    const sourceExcerptFacts = intent === "source" && focusedSourceEvidence
      ? [{
        id: "source_excerpt_1",
        kind: "source_excerpt",
        relationType: "source_evidence",
        source: "",
        target: "",
        confidence: 0.9,
        evidence: focusedSourceEvidence,
        instruction: "Use this source excerpt as the primary evidence for who communicated the information.",
      }]
      : [];
    const requiredFacts = [...sourceExcerptFacts, ...eventFacts, ...supportingRelations].slice(0, maxFacts);
    const primaryEvidenceText = intent === "mechanism"
      ? cleanReasoningEvidenceList(
        [...(llmMechanismCueFailed ? broadMechanismEvidenceItems : [focusedSourceEvidence]), eventEvidenceText, relationEvidenceText].filter(Boolean),
        { maxItems: 0, maxChars: 0, preserveBlocks: true, trimLeading: false }
      ).join("\n\n")
      : cleanReasoningEvidenceList(
        [focusedSourceEvidence, eventEvidenceText, relationEvidenceText].filter(Boolean),
        { maxItems: 0, maxChars: 0, preserveBlocks: true, trimLeading: false }
      ).join("\n\n");
    let plan = {
      id: uniqueId("kreason"),
      workspaceId,
      query,
      intent,
      status: requiredFacts.length ? "ready" : "empty",
      requiredFacts,
      eventChain: eventFacts,
      supportingRelations,
      excludedContext,
      responseInstructions,
      evidenceQuotes: unique(requiredFacts.map((fact) => String(fact.evidence || "").trim()).filter(Boolean)),
      primaryEvidenceText,
      sourceQueryId: payload?.queryId || payload?.id || "",
      sourceNodeId: event?.sourceNodeId || "",
      createdAt: nowIso(),
    };
    const compositionMode = reasoningCompositionMode(config);
    const aiResult = ["llm", "hybrid"].includes(compositionMode)
      ? await callReasoningComposerAi({ payload, localPlan: plan, config })
      : { patch: null, provider: "", model: "", usage: {}, error: "", promptMode: "" };
    if (aiResult.usage?.totalTokens) {
      await persistKnowledgeNodeTokenUsage({ node, usage: aiResult.usage, provider: aiResult.provider, model: aiResult.model });
    }
    if (compositionMode !== "rules") {
      plan = mergeReasoningAiPatch({ payload, plan, aiResult, config });
    } else {
      plan = { ...plan, compositionMode, ai: { mode: compositionMode, provider: "", model: "", error: "", selectedEvidenceQuotes: [] } };
    }
    const eventLines = eventFacts.map((fact, index) => {
      const destination = fact.roles?.destination?.length ? ` destination=${fact.roles.destination.join(", ")}` : "";
      const patient = fact.roles?.patient?.length ? ` patient=${fact.roles.patient.join(", ")}` : "";
      return `[F${index + 1}] seq=${fact.sequence ?? ""} ${fact.subject || "event"} -${fact.eventType}-> ${(fact.objects || []).join(", ") || "context"}${patient}${destination} evidence="${String(fact.evidence || "")}"`;
    });
    const relationLines = supportingRelations.map((fact, index) =>
      `[R${index + 1}] ${fact.source || "source"} -${fact.relationType}-> ${fact.target || "target"} evidence="${String(fact.evidence || "")}"`
    );
    const reasoningContext = [
      `Knowledge Reasoning Plan: ${intent}`,
      query ? `Question: ${query}` : "",
      plan.primaryEvidenceText ? `Primary evidence text:\n${plan.primaryEvidenceText}` : "",
      eventLines.length ? `Required event chain:\n${eventLines.join("\n")}` : "",
      relationLines.length ? `Supporting relations:\n${relationLines.join("\n")}` : "",
      plan.responseInstructions?.length ? `Answer instructions:\n- ${plan.responseInstructions.join("\n- ")}` : "",
      plan.ai?.answerFocusAccepted && plan.ai?.answerFocus ? `LLM reasoning focus:\n${plan.ai.answerFocus}` : "",
      plan.ai?.error ? `LLM reasoning note: ${plan.ai.error}` : "",
    ].filter(Boolean).join("\n\n");
    const composedContext = [
      reasoningContext,
      includeBackground && payload?.context ? `Source graph context:\n${String(payload.context)}` : "",
    ].filter(Boolean).join("\n\n");
    return {
      ...payload,
      id: plan.id,
      queryId: payload?.queryId || payload?.id || "",
      query,
      reasoningPlan: plan,
      context: composedContext,
      contextType: "knowledge-reasoning",
      status: plan.status,
      createdAt: plan.createdAt,
    };
  };

  class KnowledgeRuntime {
    constructor({ workspaceId = "workspace_global" } = {}) {
      this.workspaceId = workspaceId;
      this.unsubscribers = [];
      this.signature = "";
      this.bus = null;
      this.runtime = { nodes: [], dependencies: [] };
      this.executionKeys = new Set();
    }

    stop() {
      this.unsubscribers.forEach((unsubscribe) => unsubscribe?.());
      this.unsubscribers = [];
      this.signature = "";
    }

    buildSignature(runtime = {}) {
      return JSON.stringify((runtime.nodes || []).filter(isKnowledgeNode).map((node) => ({
        id: node.id,
        subtype: nodeSubtype(node),
        status: nodeStatus(node),
        inputs: nodeInputs(node, runtime.dependencies || []),
        outputs: node.outputs || [],
        config: nodeConfig(node),
      })));
    }

    async log({ node, level = "info", message = "", context = {} } = {}) {
      try {
        await window.TrackerLensEventLogStore?.recordFlowLog?.({
          workspaceId: this.workspaceId,
          nodeId: node?.id || "",
          level,
          message,
          context: { runtime: "knowledge", subtype: nodeSubtype(node), ...context },
        });
      } catch (error) {
        console.warn("Knowledge runtime log non persistito", error);
      }
    }

    clearTokenUsageForNodes(ids = []) {
      const targets = new Set((ids || []).filter(Boolean).map(String));
      if (!targets.size) return;
      targets.forEach((id) => tokenUsageTotals.set(id, 0));
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
              clearedAt: nowIso(),
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

    start({ runtime = {}, workspaceId = this.workspaceId } = {}) {
      this.workspaceId = workspaceId || this.workspaceId || "workspace_global";
      this.runtime = runtime || { nodes: [], dependencies: [] };
      const nextSignature = this.buildSignature(runtime);
      if (nextSignature === this.signature && this.bus) return this;
      this.stop();
      this.signature = nextSignature;
      this.bus = window.TrackerLensEventBus?.get?.(this.workspaceId, {
        eventStore: window.TrackerLensEventLogStore,
        channelRegistry: window.TrackerLensChannelRegistry,
      });
      if (!this.bus) return this;
      (runtime.nodes || []).filter(isKnowledgeNode).forEach((node) => {
        nodeInputs(node, runtime.dependencies || []).forEach((channel) => {
          const unsubscribe = this.bus.on(channel, (payload, event) => {
            this.handleEvent({ node, payload, event });
          }, {
            id: `knowledge_${node.id}_${channel}`,
            targetNodeId: node.id,
            metadata: { runtime: "knowledge", subtype: nodeSubtype(node) },
          });
          this.unsubscribers.push(unsubscribe);
        });
      });
      return this;
    }

    async handleEvent({ node, payload, event }) {
      if (event?.meta?.runtimeActivityVisual) return;
      if (!node?.id || event?.sourceNodeId === node.id || event?.meta?.knowledgeRuntime === node.id) return;
      if (!acceptsDependencyEvent({ node, event, dependencies: this.runtime?.dependencies || [] })) {
        await this.log({
          node,
          level: "debug",
          message: `Knowledge skipped unlinked ${event?.channel || "event"}: ${node.label || node.id}`,
          context: {
            inputChannel: event?.channel || "",
            sourceNodeId: event?.sourceNodeId || "",
            inputEventId: event?.id || "",
          },
        });
        return;
      }
      const startedAt = performance.now();
      const config = nodeConfig(node);
      const subtype = nodeSubtype(node);
      const runId = event?.meta?.runId || payload?.runId || "";
      const executionKey = `${node.id}:${runId || "live"}:${event?.id || event?.channel || Date.now()}`;
      if (this.executionKeys.has(executionKey)) return;
      this.executionKeys.add(executionKey);
      if (this.executionKeys.size > 500) this.executionKeys = new Set([...this.executionKeys].slice(-250));
      const jobId = `knowledge_job_${safeId(node.id)}_${safeId(runId || event?.id || Date.now())}`;
      const debugContext = beginKnowledgeRuntimeDebug({
        workspaceId: this.workspaceId,
        bus: this.bus,
        nodeId: node.id,
        nodeLabel: node.label || "",
        subtype,
        jobId,
        runId,
      });
      const inputStep = {
        id: "knowledge_input",
        type: "received",
        label: "Received input",
        status: "complete",
        summary: `Received ${event?.channel || "runtime event"}.`,
        payload: {
          inputChannel: event?.channel || "",
          sourceNodeId: event?.sourceNodeId || "",
          inputEventId: event?.id || "",
          runId,
          payloadKeys: payload && typeof payload === "object" ? Object.keys(payload) : [],
          payloadCounts: {
            chunks: Array.isArray(payload?.chunks) ? payload.chunks.length : 0,
            dictionaryEntries: Array.isArray(payload?.dictionaryEntries) ? payload.dictionaryEntries.length : 0,
            entities: Array.isArray(payload?.entities) ? payload.entities.length : 0,
            relations: Array.isArray(payload?.relations) ? payload.relations.length : 0,
            events: Array.isArray(payload?.events) ? payload.events.length : 0,
          },
          documentId: payload?.documentId || payload?.id || "",
          collectionId: payload?.collectionId || payload?.metadata?.collectionId || "",
        },
      };
      debugContext.inputStep = inputStep;
      debugContext.provider = config.providerProfile || config.providerType || config.provider || "";
      debugContext.model = config.model || "";
      await upsertKnowledgeRuntimeJob({
        id: jobId,
        workspaceId: this.workspaceId,
        runId,
        agentId: node.id,
        runtimeNodeId: node.id,
        agent: node.label || node.id,
        task: event?.channel || "knowledge runtime event",
        status: "working",
        runtimeStatus: "working",
        currentStep: inputStep,
        steps: [inputStep],
        provider: config.providerProfile || config.providerType || config.provider || "",
        model: config.model || "",
        inputTrace: inputStep.payload,
        result: null,
        updatedAt: nowIso(),
      });
      knowledgeLlmDebug("node-input", {
        workspaceId: this.workspaceId,
        nodeId: node.id,
        nodeLabel: node.label || "",
        subtype,
        inputChannel: event?.channel || "",
        sourceNodeId: event?.sourceNodeId || "",
        eventId: event?.id || "",
        runId,
        payloadKeys: payload && typeof payload === "object" ? Object.keys(payload) : [],
        payloadCounts: {
          chunks: Array.isArray(payload?.chunks) ? payload.chunks.length : 0,
          dictionaryEntries: Array.isArray(payload?.dictionaryEntries) ? payload.dictionaryEntries.length : 0,
          entities: Array.isArray(payload?.entities) ? payload.entities.length : 0,
          relations: Array.isArray(payload?.relations) ? payload.relations.length : 0,
          events: Array.isArray(payload?.events) ? payload.events.length : 0,
        },
        documentId: payload?.documentId || payload?.id || "",
        collectionId: payload?.collectionId || payload?.metadata?.collectionId || "",
      });
      try {
        await emitKnowledgeRuntimeActivity({
          bus: this.bus,
          workspaceId: this.workspaceId,
          runtime: this.runtime,
          node,
          event,
          runId,
          subtype,
          status: "busy",
          phase: "processing",
          label: "Processing input",
          durationMs: 12000,
        });
        let outputChannel = nodeOutput(node, config, "knowledge.output");
        let result = null;
        if (subtype === "document-store" || subtype === "text-knowledge" || subtype === "workspace-memory" || subtype === "conversation-memory") {
          const document = await createDocument({ workspaceId: this.workspaceId, node, payload, event, config });
          result = { document, documentId: document.id };
          outputChannel = nodeOutput(node, config, "knowledge.document.created");
        } else if (subtype === "chunk-processor") {
          result = await createChunks({ workspaceId: this.workspaceId, node, payload, event, config });
          outputChannel = nodeOutput(node, config, "knowledge.chunk.created");
        } else if (subtype === "knowledge-dictionary-builder") {
          result = await buildKnowledgeDictionary({ workspaceId: this.workspaceId, node, payload, event, config });
          await this.bus.emit("knowledge.lexicon.context", {
            documentId: result.documentId,
            collectionId: result.collectionId,
            language: result.language,
            scope: result.scope,
            dictionaryEntries: result.dictionaryEntries,
            dictionaryCount: result.dictionaryCount,
            context: result.context,
          }, {
            workspaceId: this.workspaceId,
            eventType: "knowledge_lexicon_context",
            sourceNodeId: node.id,
            meta: {
              knowledgeRuntime: node.id,
              inputEventId: event?.id || "",
              inputChannel: event?.channel || "",
              runId,
              subtype,
              visualUntil: runtimeVisualUntil(),
            },
          });
          outputChannel = nodeOutput(node, config, "knowledge.dictionary.updated");
        } else if (subtype === "knowledge-event-builder") {
          result = await buildKnowledgeEvents({ workspaceId: this.workspaceId, node, payload, event, config });
          await this.bus.emit("knowledge.event.context", {
            documentId: result.documentId,
            collectionId: result.collectionId,
            events: result.events,
            eventCount: result.eventCount,
            context: result.context,
          }, {
            workspaceId: this.workspaceId,
            eventType: "knowledge_event_context",
            sourceNodeId: node.id,
            meta: {
              knowledgeRuntime: node.id,
              inputEventId: event?.id || "",
              inputChannel: event?.channel || "",
              runId,
              subtype,
              visualUntil: runtimeVisualUntil(),
            },
          });
          outputChannel = nodeOutput(node, config, "knowledge.events.updated");
        } else if (subtype === "structured-knowledge-store") {
          result = await buildStructuredKnowledgeStore({ workspaceId: this.workspaceId, node, payload, event, config });
          await this.bus.emit("structured.collection.updated", {
            collectionId: result.collectionId,
            schemaId: result.schemaId,
            schemaVersion: result.schemaVersion,
            worldId: result.worldId,
            records: result.records,
            recordCount: result.recordCount,
            totalRecordCount: result.totalRecordCount,
            typeCounts: result.typeCounts,
            context: result.context,
          }, {
            workspaceId: this.workspaceId,
            eventType: "structured_collection_updated",
            sourceNodeId: node.id,
            meta: {
              knowledgeRuntime: node.id,
              inputEventId: event?.id || "",
              inputChannel: event?.channel || "",
              runId,
              subtype,
              visualUntil: runtimeVisualUntil(),
            },
          });
          outputChannel = nodeOutput(node, config, "structured.record.created");
        } else if (subtype === "world-database") {
          result = await buildWorldDatabase({ workspaceId: this.workspaceId, node, payload, event, config });
          await this.bus.emit("structured.collection.updated", {
            collectionId: result.collectionId,
            schemaId: result.schemaId,
            schemaVersion: result.schemaVersion,
            worldId: result.worldId,
            records: result.records,
            recordCount: result.recordCount,
            totalRecordCount: result.totalRecordCount,
            typeCounts: result.typeCounts,
            context: result.context,
          }, {
            workspaceId: this.workspaceId,
            eventType: "structured_collection_updated",
            sourceNodeId: node.id,
            meta: {
              knowledgeRuntime: node.id,
              inputEventId: event?.id || "",
              inputChannel: event?.channel || "",
              runId,
              subtype,
              visualUntil: runtimeVisualUntil(),
            },
          });
          await this.bus.emit("world.database.updated", {
            worldId: result.worldId,
            collectionId: result.collectionId,
            schemaId: result.schemaId,
            world: result.world,
            records: result.records,
            recordCount: result.recordCount,
            totalRecordCount: result.totalRecordCount,
            typeCounts: result.typeCounts,
            validation: result.validation,
            graph: result.graph,
            context: result.context,
          }, {
            workspaceId: this.workspaceId,
            eventType: "world_database_updated",
            sourceNodeId: node.id,
            meta: {
              knowledgeRuntime: node.id,
              inputEventId: event?.id || "",
              inputChannel: event?.channel || "",
              runId,
              subtype,
              visualUntil: runtimeVisualUntil(),
            },
          });
          await this.bus.emit("knowledge.graph.context", {
            worldId: result.worldId,
            collectionId: result.collectionId,
            entities: result.graph?.entities || [],
            relations: result.graph?.relations || [],
            entityCount: result.graph?.entities?.length || 0,
            relationCount: result.graph?.relations?.length || 0,
            context: result.context,
          }, {
            workspaceId: this.workspaceId,
            eventType: "world_graph_context",
            sourceNodeId: node.id,
            meta: {
              knowledgeRuntime: node.id,
              inputEventId: event?.id || "",
              inputChannel: event?.channel || "",
              runId,
              subtype,
              visualUntil: runtimeVisualUntil(),
            },
          });
          outputChannel = nodeOutput(node, config, "world.database.updated");
        } else if (subtype === "embedding-generator" || subtype === "vector-memory") {
          result = await createEmbeddings({ workspaceId: this.workspaceId, node, payload, event, config });
          outputChannel = nodeOutput(node, config, "knowledge.embedding.created");
        } else if (subtype === "entity-extractor") {
          result = await createEntitiesAndRelations({ workspaceId: this.workspaceId, node, payload, event, config });
          if (result.relations?.length) {
            await this.bus.emit("knowledge.relation.created", {
              documentId: result.documentId,
              relations: result.relations,
              relationCount: result.relationCount,
            }, {
              workspaceId: this.workspaceId,
              eventType: "knowledge_relation_created",
              sourceNodeId: node.id,
              meta: {
                knowledgeRuntime: node.id,
                inputEventId: event?.id || "",
                inputChannel: event?.channel || "",
                runId,
                subtype,
                visualUntil: runtimeVisualUntil(),
              },
            });
          }
          outputChannel = nodeOutput(node, config, "knowledge.entity.created");
        } else if (subtype === "knowledge-graph") {
          result = await buildKnowledgeGraphSnapshot({ workspaceId: this.workspaceId, node, payload, event, config });
          outputChannel = nodeOutput(node, config, "knowledge.graph.updated");
        } else if (subtype === "knowledge-mechanism-cue-agent") {
          result = await buildKnowledgeMechanismCues({ workspaceId: this.workspaceId, node, payload, event, config });
          outputChannel = nodeOutput(node, config, "knowledge.mechanism.cues");
        } else if (subtype === "semantic-relation-enricher") {
          result = await enrichSemanticRelations({ workspaceId: this.workspaceId, node, payload, event, config });
          if (result.semanticRelations?.length) {
            await this.bus.emit("knowledge.graph.enriched", {
              documentId: result.documentId,
              collectionId: result.collectionId,
              semanticRelations: result.semanticRelations,
              semanticRelationCount: result.semanticRelationCount,
              context: result.context,
              ai: result.ai,
            }, {
              workspaceId: this.workspaceId,
              eventType: "knowledge_graph_enriched",
              sourceNodeId: node.id,
              meta: {
                knowledgeRuntime: node.id,
                inputEventId: event?.id || "",
                inputChannel: event?.channel || "",
                runId,
                subtype,
                visualUntil: runtimeVisualUntil(),
              },
            });
          }
          outputChannel = nodeOutput(node, config, "knowledge.semantic.relations");
        } else if (subtype === "knowledge-graph-builder-agent") {
          await emitKnowledgeRuntimeActivity({
            bus: this.bus,
            workspaceId: this.workspaceId,
            runtime: this.runtime,
            node,
            event,
            runId,
            subtype,
            status: "busy",
            phase: "received",
            label: "Input received",
            durationMs: 30000,
          });
          await emitKnowledgeRuntimeActivity({
            bus: this.bus,
            workspaceId: this.workspaceId,
            runtime: this.runtime,
            node,
            event,
            runId,
            subtype,
            status: "busy",
            phase: "thinking",
            label: config.providerProfile || config.provider || config.model ? "Thinking with LLM" : "Building graph",
            durationMs: 180000,
          });
          let waitingHeartbeat = 0;
          const emitWaitingHeartbeat = () => emitKnowledgeRuntimeActivity({
            bus: this.bus,
            workspaceId: this.workspaceId,
            runtime: this.runtime,
            node,
            event,
            runId,
            subtype,
            status: "busy",
            phase: "thinking",
            label: config.providerProfile || config.provider || config.model ? "Thinking with LLM" : "Building graph",
            durationMs: 30000,
          });
          waitingHeartbeat = setInterval(() => {
            emitWaitingHeartbeat().catch(() => null);
          }, 2000);
          try {
            result = await buildKnowledgeGraphWithAi({ workspaceId: this.workspaceId, node, payload, event, config });
          } finally {
            clearInterval(waitingHeartbeat);
          }
          await emitKnowledgeRuntimeActivity({
            bus: this.bus,
            workspaceId: this.workspaceId,
            runtime: this.runtime,
            node,
            event,
            runId,
            subtype,
            status: "busy",
            phase: "emitting",
            label: "Emitting graph proposal",
            durationMs: 30000,
          });
          await this.bus.emit("knowledge.graph.proposed", {
            documentId: result.documentId,
            collectionId: result.collectionId,
            proposed: result.proposed,
            entityCount: result.entityCount,
            relationCount: result.relationCount,
            semanticRelationCount: result.semanticRelationCount,
            provider: result.provider,
            model: result.model,
            error: result.error,
          }, {
            workspaceId: this.workspaceId,
            eventType: "knowledge_graph_proposed",
            sourceNodeId: node.id,
            meta: {
              knowledgeRuntime: node.id,
              inputEventId: event?.id || "",
              inputChannel: event?.channel || "",
              runId,
              subtype,
              visualUntil: runtimeVisualUntil(),
            },
          });
          if (result.semanticRelations?.length) {
            await this.bus.emit("knowledge.graph.enriched", {
              documentId: result.documentId,
              collectionId: result.collectionId,
              semanticRelations: result.semanticRelations,
              semanticRelationCount: result.semanticRelationCount,
              context: result.context,
              ai: { provider: result.provider, model: result.model, fallbackReason: result.error || "" },
            }, {
              workspaceId: this.workspaceId,
              eventType: "knowledge_graph_enriched",
              sourceNodeId: node.id,
              meta: {
                knowledgeRuntime: node.id,
                inputEventId: event?.id || "",
                inputChannel: event?.channel || "",
                runId,
                subtype,
                visualUntil: runtimeVisualUntil(),
              },
            });
          }
          outputChannel = nodeOutput(node, config, "knowledge.graph.proposed");
        } else if (subtype === "graph-query") {
          const payloadQuery = payload?.query || payload?.text || payload?.question || payload?.entity || "";
          const isGraphUpdateSignal = event?.channel === "knowledge.graph.updated";
          const query = payloadQuery || (isGraphUpdateSignal ? "" : config.query || "");
          if (!String(query || "").trim()) {
            await this.log({
              node,
              message: `Knowledge Graph query signal ignored: ${node.label || node.id}`,
              context: {
                action: "graph-query-index-signal",
                inputChannel: event?.channel || "",
                sourceNodeId: event?.sourceNodeId || "",
                reason: "missing-query",
              },
            });
            const latencyMs = Math.round(performance.now() - startedAt);
            const skippedStep = {
              id: "knowledge_skipped",
              type: "skipped",
              label: "Skipped",
              status: "skipped",
              summary: "Graph Query ignored the signal because no query was available.",
              payload: { reason: "missing-query", inputChannel: event?.channel || "", latencyMs },
            };
            await upsertKnowledgeRuntimeJob({
              id: jobId,
              workspaceId: this.workspaceId,
              runId,
              agentId: node.id,
              runtimeNodeId: node.id,
              agent: node.label || node.id,
              task: event?.channel || "knowledge runtime event",
              status: "skipped",
              runtimeStatus: "skipped",
              currentStep: skippedStep,
              steps: [inputStep, skippedStep],
              provider: config.providerProfile || config.providerType || config.provider || "",
              model: config.model || "",
              durationMs: latencyMs,
              inputTrace: inputStep.payload,
              result: { status: "skipped", reason: "missing-query", debug: debugContext.entries },
              updatedAt: nowIso(),
            });
            return;
          }
          const allowGlobalGraphLookup = config.allowGlobalGraphLookup === true || config.allowGlobalGraphLookup === "true" ||
            payload?.allowGlobalGraphLookup === true || payload?.allowGlobalGraphLookup === "true";
          if (!allowGlobalGraphLookup && !hasGraphSourceDependency(node, this.runtime?.dependencies || [])) {
            result = await emptyGraphQuery({
              workspaceId: this.workspaceId,
              query,
              payload,
              config,
              reason: "missing-graph-source",
            });
          } else {
            result = await queryGraph({ workspaceId: this.workspaceId, node, query, payload, event, config });
          }
          outputChannel = nodeOutput(node, config, "knowledge.graph.context");
        } else if (subtype === "knowledge-reasoning-composer") {
          result = await composeKnowledgeReasoningPlan({ workspaceId: this.workspaceId, node, payload, event, config });
          await this.bus.emit("knowledge.reasoning.plan", result, {
            workspaceId: this.workspaceId,
            eventType: "knowledge_reasoning_plan",
            sourceNodeId: node.id,
            meta: {
              knowledgeRuntime: node.id,
              inputEventId: event?.id || "",
              inputChannel: event?.channel || "",
              runId,
              subtype,
              visualUntil: runtimeVisualUntil(),
            },
          });
          outputChannel = nodeOutput(node, config, "knowledge.graph.context");
        } else if (subtype === "rag-search") {
          const query = payload?.query || payload?.text || payload?.question || config.query || "";
          if (!String(query || "").trim()) {
            await this.log({
              node,
              message: `Knowledge RAG index signal ignored: ${node.label || node.id}`,
              context: {
                action: "rag-index-signal",
                inputChannel: event?.channel || "",
                reason: "missing-query",
              },
            });
            const latencyMs = Math.round(performance.now() - startedAt);
            const skippedStep = {
              id: "knowledge_skipped",
              type: "skipped",
              label: "Skipped",
              status: "skipped",
              summary: "RAG Search ignored the signal because no query was available.",
              payload: { reason: "missing-query", inputChannel: event?.channel || "", latencyMs },
            };
            await upsertKnowledgeRuntimeJob({
              id: jobId,
              workspaceId: this.workspaceId,
              runId,
              agentId: node.id,
              runtimeNodeId: node.id,
              agent: node.label || node.id,
              task: event?.channel || "knowledge runtime event",
              status: "skipped",
              runtimeStatus: "skipped",
              currentStep: skippedStep,
              steps: [inputStep, skippedStep],
              provider: config.providerProfile || config.providerType || config.provider || "",
              model: config.model || "",
              durationMs: latencyMs,
              inputTrace: inputStep.payload,
              result: { status: "skipped", reason: "missing-query", debug: debugContext.entries },
              updatedAt: nowIso(),
            });
            return;
          }
          const embeddingNodeIds = assignedEmbeddingNodeIds(node, this.runtime);
          result = await search({ workspaceId: this.workspaceId, query, config, allowedEmbeddingNodeIds: embeddingNodeIds });
          await this.bus.emit("knowledge.search.results", {
            query: result.query,
            results: result.results,
            resultCount: result.resultCount,
            queryId: result.id,
          }, {
            workspaceId: this.workspaceId,
            eventType: "knowledge_search_results",
            sourceNodeId: node.id,
            meta: {
              knowledgeRuntime: node.id,
              inputEventId: event?.id || "",
              inputChannel: event?.channel || "",
              runId,
              subtype,
              visualUntil: runtimeVisualUntil(),
            },
          });
          outputChannel = nodeOutput(node, config, "knowledge.rag.context");
        } else {
          result = { payload: clonePayload(payload), passthrough: true };
        }
        const latencyMs = Math.round(performance.now() - startedAt);
        await this.bus.emit(outputChannel, result, {
          workspaceId: this.workspaceId,
          eventType: "knowledge_emit",
          sourceNodeId: node.id,
          latencyMs,
          meta: {
            knowledgeRuntime: node.id,
            inputEventId: event?.id || "",
            inputChannel: event?.channel || "",
            runId,
            subtype,
            visualUntil: runtimeVisualUntil(),
          },
        });
        const resultSummary = knowledgeRuntimeResultSummary(result);
        const finalStatus = resultSummary.error
          ? "warning"
          : result?.status === "fallback"
            ? "fallback"
            : "complete";
        const steps = knowledgeRuntimeSteps({
          inputStep,
          debugEntries: debugContext.entries,
          result,
          outputChannel,
          latencyMs,
        });
        await upsertKnowledgeRuntimeJob({
          id: jobId,
          workspaceId: this.workspaceId,
          runId,
          agentId: node.id,
          runtimeNodeId: node.id,
          agent: node.label || node.id,
          task: event?.channel || "knowledge runtime event",
          status: finalStatus,
          runtimeStatus: finalStatus,
          currentStep: steps[steps.length - 1] || null,
          steps,
          provider: resultSummary.provider || config.providerProfile || config.providerType || config.provider || "",
          model: resultSummary.model || config.model || "",
          durationMs: latencyMs,
          tokens: node.metadata?.tokenUsage?.lastTokens || result?.usage?.totalTokens || result?.ai?.usage?.totalTokens || 0,
          prompt: (() => {
            const promptEntry = debugContext.entries.find((entry) => entry.prompt || entry.promptPreview);
            return promptEntry?.prompt || promptEntry?.promptPreview || "";
          })(),
          inputTrace: inputStep.payload,
          result: {
            ...resultSummary,
            preview: knowledgeRuntimeJsonPreview(result),
            fullResult: result,
            debug: debugContext.entries,
          },
          error: resultSummary.error || "",
          updatedAt: nowIso(),
        });
        if (subtype === "knowledge-graph-builder-agent") {
          await emitKnowledgeRuntimeActivity({
            bus: this.bus,
            workspaceId: this.workspaceId,
            runtime: this.runtime,
            node,
            event,
            runId,
            subtype,
            status: "complete",
            phase: "complete",
            label: "Task complete",
            durationMs: 9000,
          });
        }
        await this.log({
          node,
          message: `Knowledge emitted ${outputChannel}: ${node.label || node.id}`,
          context: { outputChannel, inputChannel: event?.channel || "", latencyMs },
        });
      } catch (error) {
        const latencyMs = Math.round(performance.now() - startedAt);
        const steps = knowledgeRuntimeSteps({
          inputStep,
          debugEntries: debugContext.entries,
          latencyMs,
          error,
        });
        await upsertKnowledgeRuntimeJob({
          id: jobId,
          workspaceId: this.workspaceId,
          runId,
          agentId: node.id,
          runtimeNodeId: node.id,
          agent: node.label || node.id,
          task: event?.channel || "knowledge runtime event",
          status: "error",
          runtimeStatus: "error",
          currentStep: steps[steps.length - 1] || null,
          steps,
          provider: config.providerProfile || config.providerType || config.provider || "",
          model: config.model || "",
          durationMs: latencyMs,
          tokens: node.metadata?.tokenUsage?.lastTokens || 0,
          prompt: (() => {
            const promptEntry = debugContext.entries.find((entry) => entry.prompt || entry.promptPreview);
            return promptEntry?.prompt || promptEntry?.promptPreview || "";
          })(),
          inputTrace: inputStep.payload,
          result: {
            error: error.message || String(error),
            debug: debugContext.entries,
          },
          error: error.message || String(error),
          updatedAt: nowIso(),
        });
        await this.bus.emit("knowledge.error", {
          error: error.message || String(error),
          nodeId: node.id,
          payload: clonePayload(payload),
        }, {
          workspaceId: this.workspaceId,
          eventType: "knowledge_error",
          sourceNodeId: node.id,
          status: "error",
          meta: { knowledgeRuntime: node.id, inputEventId: event?.id || "", runId },
        });
        await this.log({
          node,
          level: "error",
          message: `Knowledge error: ${error.message || error}`,
          context: { inputChannel: event?.channel || "", error: error.message || String(error) },
        });
      } finally {
        endKnowledgeRuntimeDebug(debugContext);
      }
    }
  }

  const get = (workspaceId = "workspace_global") => {
    const key = workspaceId || "workspace_global";
    if (!instances.has(key)) instances.set(key, new KnowledgeRuntime({ workspaceId: key }));
    return instances.get(key);
  };

  const debugNormalizeEventSentence = ({ sentence = "", dictionaryEntries = [], previous = {}, eventType = "" } = {}) => {
    const type = normalizeKnowledgeEventType(eventType) || inferNarrativeEventType(sentence);
    const objects = inferNarrativeEventObjects(sentence, dictionaryEntries);
    const subjectInfo = inferNarrativeEventSubjectResolution(sentence, dictionaryEntries, type, previous);
    const modality = knowledgeEventModalityForEvidence(sentence);
    const polarity = knowledgeEventPolarityForEvidence(sentence, type);
    const participants = unique([
      ...(subjectInfo.participants || []),
      subjectInfo.subject,
      ...objects,
    ].filter((item) => item && !isKnowledgePronounMention(item)));
    return {
      eventType: type,
      subject: subjectInfo.subject || "",
      objects,
      participants,
      roles: knowledgeEventRolesFor({ eventType: type, subject: subjectInfo.subject || "", objects, participants, contextObjects: objects }),
      subjectResolution: subjectInfo.subjectResolution,
      polarity,
      modality,
      aspect: knowledgeEventAspectForEvidence(sentence, modality),
    };
  };

  return {
    STORES,
    ensureStores,
    listStore,
    getRecord,
    putRecord,
    deleteRecords,
    clearGraphIndex,
    clearGraphSnapshots,
    createDocument,
    createChunks,
    createEmbeddings,
    buildStructuredKnowledgeStore,
    buildWorldDatabase,
    search,
    queryGraph,
    debugNormalizeEventSentence,
    normalizeLanguage,
    detectLanguage,
    languageProfiles,
    cosineSimilarity,
    tokenVector,
    get,
    KnowledgeRuntime,
  };
})();
