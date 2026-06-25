window.TrackerLensKnowledgeRuntime = (() => {
  const instances = new Map();
  const DB_NAME = window.tlConfig?.DB_NAME || "TrackersLens";

  const tableName = (key, fallback) => window.tlConfig?.TABLES?.[key] || fallback;
  const STORES = {
    documents: tableName("TL_KNOWLEDGE_DOCUMENTS", "tl_knowledge_documents"),
    chunks: tableName("TL_KNOWLEDGE_CHUNKS", "tl_knowledge_chunks"),
    embeddings: tableName("TL_KNOWLEDGE_EMBEDDINGS", "tl_knowledge_embeddings"),
    entities: tableName("TL_KNOWLEDGE_ENTITIES", "tl_knowledge_entities"),
    relations: tableName("TL_KNOWLEDGE_RELATIONS", "tl_knowledge_relations"),
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

  const splitConfigList = (value = "") =>
    Array.isArray(value)
      ? value.filter(Boolean).map((item) => String(item).trim()).filter(Boolean)
      : String(value || "").split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);

  const entityStopWords = new Set([
    "a", "al", "all", "alla", "alle", "anche", "and", "are", "as", "at", "avec", "but", "by",
    "che", "con", "da", "de", "del", "della", "des", "di", "do", "du", "e", "el", "en", "et",
    "for", "from", "gli", "ha", "has", "have", "i", "il", "in", "is", "it", "la", "las", "le",
    "le", "les", "lo", "los", "ma", "mas", "many", "me", "mi", "mis", "more", "much", "muchas", "muchos",
    "muy", "nel", "no", "non", "of", "on", "or", "para", "per", "por", "que", "se", "si", "sin", "son", "su", "sus", "the",
    "to", "tra", "un", "una", "uno", "y", "ahora", "aunque", "como", "cuando", "era",
    "estuve", "hola", "pero", "pues", "realmente", "avec", "dans", "pour", "sur"
  ]);

  const normalizeEntityToken = (value = "") =>
    normalizeKnowledgeText(String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, ""));

  const isEntityStopWord = (label = "", config = {}) => {
    const words = normalizeEntityToken(label).split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const customStopWords = new Set(splitConfigList(config.stopWords || config.entityStopWords).map(normalizeEntityToken));
    if (words.every((word) => entityStopWords.has(word) || customStopWords.has(word))) return true;
    if (words.length === 1 && words[0].length <= 2) return true;
    return false;
  };

  const cleanEntityPhrase = (value = "", config = {}) => {
    const customStopWords = new Set(splitConfigList(config.stopWords || config.entityStopWords).map(normalizeEntityToken));
    const isStop = (word = "") => {
      const normalized = normalizeEntityToken(word);
      return entityStopWords.has(normalized) || customStopWords.has(normalized);
    };
    const words = String(value || "").replace(/\s+/g, " ").trim().split(/\s+/).filter(Boolean);
    while (words.length > 1 && isStop(words[0])) words.shift();
    while (words.length > 1 && isStop(words[words.length - 1])) words.pop();
    return words.join(" ").trim();
  };

  const keywordBlockedTail = "a\\b|al\\b|ante\\b|comenz[oó]\\b|con\\b|corr[ií]eron\\b|de\\b|del\\b|el\\b|en\\b|encontraron\\b|era\\b|estaba\\b|hacia\\b|la\\b|las\\b|le\\b|les\\b|lo\\b|los\\b|para\\b|por\\b|que\\b|resplandec[ií]a\\b|se\\b|ten[ií]a\\b|tenia\\b|un\\b|una\\b|uno\\b|y\\b|como\\b|cuando\\b|donde\\b|llamada\\b|llamado\\b|joven\\b|persona\\b|viv[ií]a\\b|vivia\\b|lleno\\b|llena\\b|muy\\b";
  const keywordTail = `(?:\\s+(?!${keywordBlockedTail})[\\p{L}\\p{N}'’_-]+){0,2}`;
  const keywordConnectorTail = `(?:\\s+(?:de|del|de la|de los|of|the|di|della|du|des|la|las|los)\\s+(?!${keywordBlockedTail})[\\p{L}\\p{N}'’_-]+(?:\\s+(?!${keywordBlockedTail})[\\p{L}\\p{N}'’_-]+){0,1})?`;

  const splitText = (text = "", { chunkSize = 900, overlap = 120 } = {}) => {
    const clean = String(text || "").replace(/\r\n/g, "\n").trim();
    if (!clean) return [];
    const size = Math.max(160, Number(chunkSize) || 900);
    const step = Math.max(80, size - Math.max(0, Number(overlap) || 0));
    const chunks = [];
    for (let start = 0; start < clean.length; start += step) {
      const value = clean.slice(start, start + size).trim();
      if (value) chunks.push({ text: value, start, end: start + value.length });
      if (start + size >= clean.length) break;
    }
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
      throw new Error(`Embedding HTTP ${response.status}${errorText ? `: ${errorText.slice(0, 180)}` : ""}`);
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
  const nodeStatus = (node = {}) =>
    String(node.runtime?.status || node.metadata?.runtimeStatus || node.status || "idle").toLowerCase();
  const isKnowledgeNode = (node = {}) =>
    (node.type === "knowledge" || node.metadata?.category === "knowledge") &&
    !node.metadata?.library &&
    !["paused", "disabled", "error", "disconnected"].includes(nodeStatus(node));
  const unique = (values = []) => [...new Set(values.filter(Boolean).map(String))];
  const nodeInputs = (node = {}, dependencies = []) => {
    const incoming = dependencies
      .filter((dependency) => dependency.targetNodeId === node.id)
      .map((dependency) => dependency.channel || dependency.metadata?.targetPort)
      .filter(Boolean);
    return unique([...(node.inputs || []), ...(node.channels || []), ...incoming]);
  };
  const nodeOutput = (node = {}, config = {}, fallback = "knowledge.output") =>
    config.outputChannel || config.output || node.outputs?.[0] || fallback;
  const assignedEmbeddingNodeIds = (node = {}, runtime = {}) =>
    unique((runtime.dependencies || [])
      .filter((dependency) => dependency.targetNodeId === node.id)
      .filter((dependency) => (dependency.channel || dependency.metadata?.sourcePort || dependency.metadata?.targetPort) === "knowledge.embedding.created")
      .map((dependency) => dependency.sourceNodeId));

  const createDocument = async ({ workspaceId, node, payload, event, config = {} } = {}) => {
    const now = nowIso();
    const text = extractInputText(payload, config);
    if (!text.trim()) throw new Error("Knowledge document vuoto");
    const payloadSourceType = String(payload?.sourceType || "").trim();
    const eventOrigin = String(event?.meta?.origin || "").trim();
    const isUploadedDocument = payloadSourceType === "upload" || eventOrigin === "knowledge-upload";
    const isLiveReplayDocument = payloadSourceType === "live-test-replay" || event?.eventType === "flow_live_knowledge_document";
    const preferPayloadScope = isUploadedDocument || isLiveReplayDocument;
    const document = {
      id: preferPayloadScope
        ? (payload?.documentId || payload?.id || uniqueId("kdoc"))
        : (config.documentId || payload?.documentId || payload?.id || uniqueId("kdoc")),
      workspaceId,
      sourceId: config.sourceId || event?.sourceNodeId || node?.id || "",
      sourceType: preferPayloadScope ? (payloadSourceType || config.sourceType || "runtime-channel") : (config.sourceType || payloadSourceType || "runtime-channel"),
      title: preferPayloadScope ? (payload?.title || config.title || node?.label || "Knowledge Document") : (config.title || payload?.title || node?.label || "Knowledge Document"),
      mimeType: preferPayloadScope ? (payload?.mimeType || config.mimeType || "text/plain") : (config.mimeType || payload?.mimeType || "text/plain"),
      language: preferPayloadScope ? (payload?.language || config.language || "") : (config.language || payload?.language || ""),
      text,
      metadata: {
        ...(payload?.metadata && typeof payload.metadata === "object" ? payload.metadata : {}),
        inputChannel: event?.channel || "",
        nodeId: node?.id || "",
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
    const chunks = splitText(sourceText, {
      chunkSize: config.chunkSize || config.maxChunkChars || 900,
      overlap: config.chunkOverlap || config.overlap || 120,
    });
    const now = nowIso();
    const records = [];
    if (config.replaceExisting !== false) {
      await deleteChunksAndEmbeddings({ workspaceId, documentId: document.id || documentId });
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
          collectionId: document.metadata?.collectionId || config.collectionId || "",
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
    for (const chunk of chunks.filter(Boolean)) {
      const embedding = await resolveEmbeddingVector({ text: chunk.text || "", config });
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
    return {
      embeddings: records,
      provider: records[0]?.provider || "local-hash",
      model: records[0]?.model || "tl-local-hash-v1",
    };
  };

  const inferEntityType = (value = "", source = "") => {
    const clean = String(value || "").trim();
    if (/^https?:\/\//i.test(clean)) return "url";
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return "email";
    if (source === "declared-name") return "proper-noun";
    if (/^[A-ZÀ-Ý0-9][A-ZÀ-Ý0-9'’_-]*(?:\s+[A-ZÀ-Ý0-9][A-ZÀ-Ý0-9'’_-]*)+$/.test(clean) && /[A-ZÀ-Ý]/.test(clean)) return "quote";
    if (/^[A-Z0-9]{2,8}$/.test(clean) && /[A-Z]/.test(clean)) return "symbol";
    if (/\b(api|runtime|indexeddb|ollama|studio|openai|rag|json|php|javascript)\b/i.test(clean)) return "technology";
    if (/^[A-ZÀ-Ý][A-Za-zÀ-ÿ'’-]+(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'’-]+){0,3}$/.test(clean)) return "proper-noun";
    return "term";
  };

  const escapedRegExp = (value = "") =>
    String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const inferRelationType = (source = {}, target = {}, fallback = "co_occurs") => {
    const types = new Set([source.entityType || "term", target.entityType || "term"]);
    if (types.has("proper-noun") && types.has("quote")) return fallback || "co_occurs";
    if (types.has("proper-noun") && types.has("creature")) return "encounters";
    if (types.has("proper-noun") && types.has("object")) return "interacts_with";
    if (types.has("proper-noun") && types.has("location")) return "appears_in";
    if (types.has("proper-noun") && types.has("concept")) return "expresses";
    if (types.has("location") && types.has("creature")) return "contains";
    if (types.has("location") && types.has("object")) return "contains";
    if (types.has("location") && types.has("concept")) return "context_for";
    if (types.has("object") && types.has("concept")) return "associated_with";
    if (types.has("symbol") && types.has("location")) return "marks";
    if (types.has("symbol") && types.has("quote")) return "part_of";
    return fallback || "co_occurs";
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

  const quoteSpokenByPerson = (text = "", person = {}, quote = {}) => {
    const personKey = normalizeEntityToken(person?.label);
    const quoteLabel = String(quote?.label || "");
    if (!personKey || !quoteLabel) return false;
    const personPositions = entityLabelPositions(text, person.label);
    const quotePositions = entityLabelPositions(text, quoteLabel);
    if (!personPositions.length || !quotePositions.length) return false;
    const speechPattern = new RegExp(`\\b${escapedRegExp(personKey)}\\b(?:\\s+[a-z0-9'’_-]+){0,30}\\s+(?:dijo|respondio|pregunto|grito|hablar|pronuncio|pronunciar|voz|boca|said|asked|answered|shouted|spoke)\\b`);
    return quotePositions.some((quotePosition) =>
      personPositions.some((personPosition) => {
        if (personPosition >= quotePosition) return false;
        if (quotePosition - personPosition > 320) return false;
        const excerpt = normalizeEntityToken(String(text || "").slice(personPosition, quotePosition + quoteLabel.length));
        return speechPattern.test(excerpt);
      })
    );
  };

  const inferNarrativeRelationType = (text = "", source = {}, target = {}) => {
    const context = normalizeEntityToken(relationContextBetween(text, source, target));
    if (!context) return "";
    const types = new Set([source.entityType || "term", target.entityType || "term"]);
    const hasPerson = types.has("proper-noun");
    const hasObject = types.has("object");
    const hasLocation = types.has("location");
    const hasConcept = types.has("concept");
    const hasCreature = types.has("creature");
    const hasQuote = types.has("quote");
    const hasAny = (patterns = []) => patterns.some((pattern) => pattern.test(context));
    if (hasPerson && hasQuote) {
      const person = [source, target].find((entity) => entity.entityType === "proper-noun");
      const quote = [source, target].find((entity) => entity.entityType === "quote");
      return quoteSpokenByPerson(text, person, quote) ? "says" : "";
    }
    if (hasPerson && hasObject) {
      const person = [source, target].find((entity) => entity.entityType === "proper-noun");
      const object = [source, target].find((entity) => entity.entityType === "object");
      const cureContext = normalizeEntityToken(relationContextBetween(text, source, target, 360));
      const personKey = normalizeEntityToken(person?.label);
      const objectKey = normalizeEntityToken(object?.label);
      const personDrinkPattern = personKey
        ? new RegExp(`\\b${escapedRegExp(personKey)}(?:\\s+[a-z0-9'’_-]+){0,12}\\s+(?:bebi[oó]|beba|beber|tom[oó]|tomo|drink|drank)\\b`)
        : null;
      const personIsDrinkingSubject = Boolean(personDrinkPattern?.test(cureContext || context));
      const personReceivesCure = entityNearPattern(cureContext || context, person?.label, [/\b(?:bebi[oó]|beba|beber|tom[oó]|tomo|drink|drank)\b/], 180);
      const objectIsCure = /\b(?:te|agua)\b/.test(objectKey) &&
        entityNearPattern(cureContext || context, object?.label, [/\b(?:te|t[eé]|agua|cura|curar|milagro|healed)\b/], 160);
      const cureOutcome = /\b(?:hablar|voz|milagro|voice|speak)\b/.test(cureContext || context);
      if (personIsDrinkingSubject && personReceivesCure && objectIsCure && cureOutcome) return "heals";
      const personUses = entityNearPattern(context, person?.label, [/\b(?:bebi[oó]|beber|tom[oó]|tomar|sumergio|sumergi[oó]|preparar|preparo|prepar[oó]|lleno|llen[oó]|golpe[oó]|filled|drank|drink|immerse|prepar|hit|struck)\b/], 110);
      const objectUsed = entityNearPattern(context, object?.label, [/\b(?:bebi[oó]|beber|tom[oó]|tomar|sumergio|sumergi[oó]|preparar|preparo|prepar[oó]|lleno|llen[oó]|golpe[oó]|agua|flor|fuente|manantial|palo|taza|te|t[eé]|filled|drank|drink|immerse|prepar|hit|struck)\b/], 100);
      if (personUses && objectUsed) return "uses";
    }
    if (hasPerson && hasCreature && hasAny([/\b(?:golpe[oó]|ataco|atac[oó]|arremetio|arremeti[oó]|defend|attack|hit|struck|colp)\b/])) return "confronts";
    if (hasPerson && [source, target].every((entity) => entity.entityType === "proper-noun") && hasAny([/\b(?:ayud[oó]|ayudar|llevo|llev[oó]|tom[oó] su mano|amigo|amigos|helped|helps|took|friend|aiut|aide)\b/])) return "helps";
    if (hasPerson && hasLocation && !hasAny([/\b(?:aparecio|apareci[oó]|pregunto|pregunt[oó]|indico|indic[oó]|camino hacia|camino a)\b/]) && hasAny([/\b(?:emprendieron|llegaron|entraron|subieron|descendieron|regresar|regresaron|caminaron|viaje|travel|arrived|entered|returned|salir|partir)\b/])) return "travels_to";
    if (hasPerson && hasConcept && hasAny([/\b(?:record[oó]|demostraba|mostrando|llena de|lleno de|con\s+(?:determinacion|esperanza|coraje|compasion|autocontrol)|showed|remembered|felt)\b/])) return "expresses";
    if (hasObject && hasObject && source.id !== target.id && source.label !== target.label && hasAny([/\b(?:transform[oó]|transformandose|hervir|hervia|sumerg|became|turned|boil)\b/])) return "transforms";
    if (hasPerson && (hasConcept || hasQuote) && hasAny([/\b(?:revel[oó]|secreto|advirti[oó]|indic[oó]|donde|solucion|solution|revealed|warned|told)\b/])) return "reveals";
    if (hasLocation && (hasObject || hasCreature)) return "";
    return "";
  };

  const orientRelationPair = (left = {}, right = {}, relationType = "co_occurs") => {
    const withType = (type = "") => [left, right].find((entity) => entity.entityType === type) || null;
    const sourceFor = (sourceType = "", targetType = "") => {
      const source = withType(sourceType);
      const target = withType(targetType);
      return source && target ? { source, target } : { source: left, target: right };
    };
    if (["appears_in", "interacts_with", "expresses", "encounters", "says", "uses", "heals", "confronts", "helps", "travels_to", "reveals"].includes(relationType)) {
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
      }[relationType];
      if (relationType === "helps") {
        const [first, second] = [left, right].filter((entity) => entity.entityType === "proper-noun");
        return first && second ? { source: first, target: second } : { source: left, target: right };
      }
      if (relationType === "heals" && withType("object") && withType("proper-noun")) return sourceFor("object", "proper-noun");
      return sourceFor("proper-noun", targetType);
    }
    if (["contains", "context_for"].includes(relationType)) {
      const targetType = relationType === "context_for"
        ? "concept"
        : (withType("creature") ? "creature" : "object");
      return sourceFor("location", targetType);
    }
    if (relationType === "associated_with") return sourceFor("object", "concept");
    if (relationType === "transforms") return sourceFor("object", "object");
    if (relationType === "marks") return sourceFor("symbol", "location");
    if (relationType === "part_of") return sourceFor("symbol", "quote");
    return { source: left, target: right };
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

  const isEntityAllowedByMode = (candidate = {}, text = "", config = {}) => {
    if (["seed", "declared-name"].includes(candidate.source) || String(candidate.source || "").startsWith("keyword-")) return true;
    if (["url", "email", "symbol", "quote", "technology", "location", "object", "creature", "concept"].includes(candidate.entityType)) return true;
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
    const normalized = normalizeEntityToken(label);
    let canonical = label;
    if (candidate.entityType === "object") {
      if (/^fuente de agua\s+/.test(normalized)) canonical = "fuente de agua";
      if (/^agua\s+(?:de|del|della|du|of)\s+/.test(normalized)) canonical = "agua";
      if (/^water\s+(?:source|spring)\s+/.test(normalized)) canonical = "water source";
    }
    if (candidate.entityType === "location" && /^castillo\s+de\s+musica$/.test(normalized)) canonical = "castillo";
    if (canonical === label) return candidate;
    return {
      ...candidate,
      label: canonical,
      aliases: [...new Set([...(candidate.aliases || []), label])],
    };
  };

  const entityCandidatesFromText = (text = "", config = {}) => {
    const clean = String(text || "");
    const candidates = [];
    const push = (value = "", source = "pattern", confidence = 0.72, entityType = "") => {
      const rawLabel = String(value || "").replace(/\s+/g, " ").trim();
      const label = source === "seed" ? rawLabel : cleanEntityPhrase(rawLabel, config);
      if (label.length < 2 || label.length > 96) return;
      if (source !== "seed" && isEntityStopWord(label, config)) return;
      candidates.push({ label, source, confidence, entityType: entityType || inferEntityType(label, source) });
    };
    const pushKeywordMatches = ({ pattern, source, entityType, confidence = 0.76 } = {}) => {
      if (!pattern) return;
      [...clean.matchAll(pattern)].forEach((match) => push(match[1] || match[0], source, confidence, entityType));
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
    ].forEach((pattern) => {
      [...clean.matchAll(pattern)].forEach((match) => push(match[1], "declared-name", 0.88, "proper-noun"));
    });
    [
      {
        entityType: "location",
        source: "keyword-location",
        pattern: new RegExp(`\\b((?:bosque|forest|foresta|foret|forêt|castillo|castle|chateau|château|montaña|mountain|montagne|caverna|cave|grotta|reino|kingdom|regno|pueblo|village|rio|río|river|fiume|camino|sendero|path|trail)(?:${keywordConnectorTail}|${keywordTail}))\\b`, "giu"),
      },
      {
        entityType: "object",
        source: "keyword-object",
        pattern: new RegExp(`\\b((?:flor|flower|fiore|fleur|fuente|source|spring|fontana|manantial|agua|water|acqua|eau|té|te|tea|taza|cup|antorcha|torch|torcia|palo|stick|bastone)(?:${keywordConnectorTail}|${keywordTail}))\\b`, "giu"),
      },
      {
        entityType: "creature",
        source: "keyword-creature",
        pattern: /\b(troll|monstruo|monster|mostro|creature|criatura|cervatillo|fawn|cerbiatto|bestias salvajes|wild beasts|bêtes sauvages)\b/giu,
      },
      {
        entityType: "concept",
        source: "keyword-concept",
        pattern: /\b(autocontrol|self-control|resiliencia|resilience|disciplina|discipline|optimismo|optimism|determinación|determinacion|determination|miedo|fear|paura|esperanza|hope|espoir|amistad|friendship|amitié|coraje|courage|compasión|compasion|compassion)\b/giu,
      },
    ].forEach(pushKeywordMatches);
    (clean.match(/\b[A-ZÀ-Ý][A-Za-zÀ-ÿ'’-]+(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'’-]+){0,3}\b/g) || [])
      .forEach((value) => push(value, "proper-noun", value.includes(" ") ? 0.82 : 0.64));
    splitConfigList(config.seedTerms || config.terms).forEach((value) => {
      if (value && clean.toLowerCase().includes(value.toLowerCase())) push(value, "seed", 0.9);
    });
    const allowedTypes = splitConfigList(config.entityTypes).map((value) => value.toLowerCase());
    const threshold = Math.max(0, Math.min(1, Number(config.confidenceThreshold ?? 0.6)));
    const seen = new Map();
    candidates
      .filter((candidate) => candidate.confidence >= threshold)
      .filter((candidate) => candidate.source === "seed" || !isEntityStopWord(candidate.label, config))
      .filter((candidate) => isEntityAllowedByMode(candidate, clean, config))
      .filter((candidate) => !allowedTypes.length || allowedTypes.includes(candidate.entityType.toLowerCase()))
      .map((candidate) => canonicalEntityCandidate(candidate, config))
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
    return deduped.slice(0, Math.max(1, Math.min(80, Number(config.maxEntities || 24))));
  };

  const createEntitiesAndRelations = async ({ workspaceId, node, payload, event, config = {} } = {}) => {
    const inputChannel = String(event?.channel || "").trim();
    const allowDocumentInput = config.allowDocumentInput === true || String(config.allowDocumentInput || "").toLowerCase() === "true";
    const canReadDocumentChunks = inputChannel === "knowledge.chunk.created" || allowDocumentInput;
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
      await deleteEntitiesAndRelations({
        workspaceId,
        chunkIds: validChunks.map((chunk) => chunk.id),
        documentId: payload?.documentId || "",
      });
    }
    const now = nowIso();
    const entities = [];
    const relations = [];
    const maxRelations = Math.max(0, Math.min(240, Number(config.maxRelations || 120)));
    const maxRelationsPerChunk = Math.max(0, Math.min(40, Number(config.maxRelationsPerChunk || 12)));
    const maxRelationsPerEntityPerChunk = Math.max(1, Math.min(12, Number(config.maxRelationsPerEntityPerChunk || 3)));
    const maxRelationDistance = Math.max(120, Math.min(1200, Number(config.maxRelationDistance || 520)));
    const relationRecords = new Map();
    for (const chunk of validChunks) {
      const candidates = entityCandidatesFromText(chunk.text || "", config);
      const chunkEntities = [];
      for (const candidate of candidates) {
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
            collectionId: chunk.metadata?.collectionId || config.collectionId || "",
            aliases,
          },
          createdAt: previousEntity?.createdAt || now,
          updatedAt: now,
        };
        entities.push(await putRecord(STORES.entities, record));
        chunkEntities.push(record);
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
          const narrativeRelationType = inferNarrativeRelationType(chunk.text || "", source, target);
          const proximityScore = Number.isFinite(distance) ? Math.max(0, 0.18 - (distance / maxRelationDistance) * 0.18) : 0;
          const score = confidence +
            proximityScore +
            (narrativeRelationType ? 0.2 : 0) +
            (hasPerson && hasNarrative ? 0.22 : 0) +
            (hasPerson ? 0.1 : 0) +
            (types.has("quote") ? 0.08 : 0) +
            (types.has("creature") || types.has("object") ? 0.06 : 0) -
            (source.entityType === target.entityType ? 0.08 : 0);
          relationCandidates.push({ source, target, confidence, score, narrativeRelationType });
        }
      }
      const selectedRelationCandidates = relationCandidates
        .sort((left, right) => right.score - left.score || String(left.source.label || "").localeCompare(String(right.source.label || "")));
      const chunkEntityRelationCounts = new Map();
      let chunkRelationCount = 0;
      for (const { source, target, confidence, narrativeRelationType } of selectedRelationCandidates) {
        if (relations.length >= maxRelations || chunkRelationCount >= maxRelationsPerChunk) break;
        const sourceLocalCount = chunkEntityRelationCounts.get(source.id) || 0;
        const targetLocalCount = chunkEntityRelationCounts.get(target.id) || 0;
        if (sourceLocalCount >= maxRelationsPerEntityPerChunk || targetLocalCount >= maxRelationsPerEntityPerChunk) continue;
        const relationType = config.relationType || narrativeRelationType || inferRelationType(source, target);
        const oriented = orientRelationPair(source, target, relationType);
        const relationSource = oriented.source || source;
        const relationTarget = oriented.target || target;
        if (relationSource.id === relationTarget.id) continue;
        const relationKey = [
          chunk.documentId || payload?.documentId || workspaceId,
          relationType,
          relationSource.id,
          relationTarget.id,
        ].join("::");
        const existingRelation = relationRecords.get(relationKey);
        if (existingRelation) {
          const chunkIds = new Set([...(existingRelation.metadata?.chunkIds || []), chunk.id || ""].filter(Boolean));
          const occurrenceCount = Number(existingRelation.metadata?.occurrenceCount || 1) + 1;
          const updatedRelation = {
            ...existingRelation,
            confidence: Math.max(Number(existingRelation.confidence || 0), Number(confidence || 0)),
            metadata: {
              ...(existingRelation.metadata || {}),
              chunkIds: [...chunkIds],
              occurrenceCount,
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
            collectionId: chunk.metadata?.collectionId || config.collectionId || "",
            chunkIds: [chunk.id || ""].filter(Boolean),
            occurrenceCount: 1,
          },
          createdAt: now,
          updatedAt: now,
        };
        relationRecords.set(relationKey, relation);
        relations.push(await putRecord(STORES.relations, relation));
        chunkRelationCount += 1;
        chunkEntityRelationCounts.set(source.id, sourceLocalCount + 1);
        chunkEntityRelationCounts.set(target.id, targetLocalCount + 1);
      }
    }
    return {
      documentId: validChunks[0]?.documentId || payload?.documentId || "",
      collectionId: validChunks[0]?.metadata?.collectionId || payload?.collectionId || payload?.metadata?.collectionId || config.collectionId || "",
      entities,
      relations,
      entityCount: entities.length,
      relationCount: relations.length,
    };
  };

  const buildKnowledgeGraphSnapshot = async ({ workspaceId, payload = {}, config = {} } = {}) => {
    const [entities, relations] = await Promise.all([
      listStore(STORES.entities),
      listStore(STORES.relations),
    ]);
    const collectionId = String(payload?.collectionId || payload?.metadata?.collectionId || config.collectionId || "").trim();
    const documentId = String(payload?.documentId || config.documentId || "").trim();
    const scopedEntities = byWorkspace(entities, workspaceId)
      .filter((entity) => !documentId || entity.documentId === documentId)
      .filter((entity) => !collectionId || entity.metadata?.collectionId === collectionId);
    const entityIds = new Set(scopedEntities.map((entity) => entity.id));
    const scopedRelations = byWorkspace(relations, workspaceId)
      .filter((relation) => entityIds.has(relation.sourceEntityId) && entityIds.has(relation.targetEntityId))
      .filter((relation) => !collectionId || relation.metadata?.collectionId === collectionId);
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
      .slice(0, Math.max(1, Math.min(50, Number(config.topEntities || 12))));
    const snapshot = {
      id: uniqueId("kgraph"),
      workspaceId,
      collectionId,
      documentId,
      entityCount: scopedEntities.length,
      relationCount: scopedRelations.length,
      topEntities,
      relations: scopedRelations.slice(0, Math.max(1, Math.min(240, Number(config.maxRelations || 120)))),
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
        collectionId,
        documentId,
      },
      createdAt: snapshot.createdAt,
    });
    return snapshot;
  };

  const search = async ({ workspaceId, query = "", config = {}, allowedEmbeddingNodeIds = [] } = {}) => {
    const cleanQuery = String(query || config.query || "").trim();
    if (!cleanQuery) throw new Error("Query Knowledge vuota");
    const topK = Math.max(1, Math.min(50, Number(config.topK || 5)));
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

  class KnowledgeRuntime {
    constructor({ workspaceId = "workspace_global" } = {}) {
      this.workspaceId = workspaceId;
      this.unsubscribers = [];
      this.signature = "";
      this.bus = null;
      this.runtime = { nodes: [], dependencies: [] };
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
      if (!node?.id || event?.sourceNodeId === node.id || event?.meta?.knowledgeRuntime === node.id) return;
      const startedAt = performance.now();
      const config = nodeConfig(node);
      const subtype = nodeSubtype(node);
      const runId = event?.meta?.runId || payload?.runId || "";
      try {
        let outputChannel = nodeOutput(node, config, "knowledge.output");
        let result = null;
        if (subtype === "document-store" || subtype === "text-knowledge" || subtype === "workspace-memory" || subtype === "conversation-memory") {
          const document = await createDocument({ workspaceId: this.workspaceId, node, payload, event, config });
          result = { document, documentId: document.id };
          outputChannel = nodeOutput(node, config, "knowledge.document.created");
        } else if (subtype === "chunk-processor") {
          result = await createChunks({ workspaceId: this.workspaceId, node, payload, event, config });
          outputChannel = nodeOutput(node, config, "knowledge.chunk.created");
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
              },
            });
          }
          outputChannel = nodeOutput(node, config, "knowledge.entity.created");
        } else if (subtype === "knowledge-graph") {
          result = await buildKnowledgeGraphSnapshot({ workspaceId: this.workspaceId, payload, config });
          outputChannel = nodeOutput(node, config, "knowledge.graph.updated");
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
          },
        });
        await this.log({
          node,
          message: `Knowledge emitted ${outputChannel}: ${node.label || node.id}`,
          context: { outputChannel, inputChannel: event?.channel || "", latencyMs },
        });
      } catch (error) {
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
      }
    }
  }

  const get = (workspaceId = "workspace_global") => {
    const key = workspaceId || "workspace_global";
    if (!instances.has(key)) instances.set(key, new KnowledgeRuntime({ workspaceId: key }));
    return instances.get(key);
  };

  return {
    STORES,
    ensureStores,
    listStore,
    getRecord,
    putRecord,
    deleteRecords,
    createDocument,
    createChunks,
    createEmbeddings,
    search,
    cosineSimilarity,
    tokenVector,
    get,
    KnowledgeRuntime,
  };
})();
