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
    String(value || "knowledge").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "knowledge";
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
    const document = {
      id: config.documentId || uniqueId("kdoc"),
      workspaceId,
      sourceId: config.sourceId || event?.sourceNodeId || node?.id || "",
      sourceType: config.sourceType || "runtime-channel",
      title: config.title || payload?.title || node?.label || "Knowledge Document",
      mimeType: config.mimeType || payload?.mimeType || "text/plain",
      language: config.language || payload?.language || "",
      text,
      metadata: {
        ...(payload?.metadata && typeof payload.metadata === "object" ? payload.metadata : {}),
        inputChannel: event?.channel || "",
        nodeId: node?.id || "",
        collectionId: config.collectionId || payload?.collectionId || payload?.metadata?.collectionId || "",
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
          collectionId: config.collectionId || document.metadata?.collectionId || "",
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
          collectionId: config.collectionId || chunk.metadata?.collectionId || "",
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
