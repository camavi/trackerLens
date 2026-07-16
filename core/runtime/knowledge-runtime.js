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
    "agnello", "arca", "calice", "croce", "pane", "sangue", "tempio"
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
  const nodeIncomingDependencies = (node = {}, dependencies = []) =>
    (dependencies || []).filter((dependency) => dependency.targetNodeId === node.id);
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

  const graphQueryIntent = (query = "") => {
    const normalized = normalizeEntityToken(query);
    const asksDefinition = /\b(?:chi|cosa|cos|che|what|who|que|qué|quien|quién|quoi|qui|was|wer)\b/.test(normalized) ||
      /\b(?:e|è|is|es|est|ist)\b/.test(normalized);
    const asksRelation = /\b(?:relazione|relation|relacion|relación|lien|beziehung|tra|between|entre|zwischen)\b/.test(normalized);
    const asksInstrument = /\b(?:usa|usare|utilizza|utilizzare|usa|used|use|uses|with|against|contro|con|strumento|tool|weapon|arma|object|oggetto)\b/.test(normalized);
    const asksCause = /\b(?:perche|perché|why|porque|por qué|pourquoi|warum)\b/.test(normalized);
    const asksProcess = /\b(?:dettagli|dettaglio|passaggi|passo|processo|sequenza|timeline|come|how|como|cómo|comment|wie|explain|spiega|spiegami)\b/.test(normalized);
    const asksHealing = /\b(?:come|how|como|cómo|comment|wie)\b/.test(normalized) &&
      /\b(?:guar|cura|heal|cure|recuper|ritrov|riacquist|voce|parlare|speak|voice|voz|hablar|parler)\b/.test(normalized);
    return {
      definition: asksDefinition,
      relation: asksRelation,
      instrument: asksInstrument,
      cause: asksCause,
      process: asksProcess || asksCause || asksHealing,
      healing: asksHealing,
    };
  };

  const graphRelationWeight = (relationType = "", intent = {}) => {
    const type = String(relationType || "co_occurs").toLowerCase();
    const weights = {
      cannot_speak: 9,
      healed_by: intent.healing ? 8.5 : 9,
      gives_to: 8,
      receives_from: 8,
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
      explains: 7,
      friend_of: 7,
      has_property: intent.healing ? 8.5 : 7,
      lives_in: 7,
      discovers: 7,
      is_part_of: 7,
      says: 7,
      represents: 7,
      reveals: 7,
      teaches: 7,
      establishes: 7,
      fulfills: 7,
      foreshadows: 7,
      helps: 6,
      appears_in: intent.definition ? 1 : 5,
      travels_to: intent.definition ? 1 : 5,
      encounters: 5,
      confronts: 5,
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

  const graphHealingMechanismCueScore = (text = "", intent = {}) => {
    if (!intent.healing) return 0;
    const normalized = normalizeEntityToken(text);
    if (!normalized) return 0;
    let score = 0;
    if (/\b(?:fiore|flower|fleur|flor|acqua|agua|water|eau|sorgente|source|spring|fonte|tazza|cup|t[eé]|tea|infusione|tisana)\b/.test(normalized)) score += 8;
    if (/\b(?:riemp|fill|filled|immerse|immerso|immersa|sumerg|mette|messo|messa|prepara|prepar|bollire|bolle|bolliva|boil|boiled|trasforma|trasformandosi|beve|bevve|bevuto|bere|drink|drank|drinks)\b/.test(normalized)) score += 10;
    if (/\b(?:liber|voce|parlare|parla|parlò|speak|voice|voz|hablar|parler|guar|cura|heal|cure|potere|poteri)\b/.test(normalized)) score += 5;
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
    if (intent.cause && ["transforms", "drinks", "heals", "speaks"].includes(event.eventType)) score += 8;
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
    const chunks = splitText(sourceText, {
      chunkSize: config.chunkSize || config.maxChunkChars || 900,
      overlap: config.chunkOverlap || config.overlap || 120,
    });
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
    if (position < 0) return { text: cleanText.slice(0, 240), quote: cleanTerm, startOffset: null, endOffset: null };
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
    "albero", "alberi", "bosco", "casa", "castello", "caverna", "foresta", "giardino", "luogo", "montagna", "regno", "sentiero", "sorgente", "strada", "villaggio",
    "cave", "castle", "forest", "garden", "kingdom", "mountain", "path", "road", "tree", "trees", "village", "wood", "woods",
    "arbol", "arboles", "árbol", "árboles", "bosque", "castillo", "cueva", "montana", "montaña", "pueblo", "reino",
    "arbre", "arbres", "bois", "chateau", "château", "foret", "forêt", "montagne", "royaume", "village",
  ]);

  const dictionaryObjectTokens = new Set([
    "acqua", "bastone", "fiore", "fuoco", "libro", "pietra", "pietre", "roccia", "rocce", "spada", "tazza", "te", "tè",
    "book", "cup", "fire", "flower", "rock", "rocks", "stone", "stones", "sword",
    "flor", "fuego", "libro", "piedra", "piedras", "roca", "rocas", "taza",
    "feu", "fleur", "livre", "pierre", "pierres", "roche", "roches", "tasse",
  ]);

  const dictionaryConceptTokens = new Set([
    "amicizia", "compassione", "coraggio", "cura", "desiderio", "immaginazione", "intelligenza", "parola", "silenzio", "voce",
    "courage", "cure", "friendship", "imagination", "silence", "voice",
    "amistad", "cura", "imaginacion", "imaginación", "silencio", "voz",
    "amitie", "amitié", "courage", "guerison", "guérison", "silence", "voix",
  ]);

  const dictionaryRoleTokens = new Set([
    "anziana", "anziano", "bambina", "bambino", "giovane", "mago", "ragazza", "ragazzo", "uomo", "vecchia", "vecchio",
    "child", "elder", "girl", "man", "old man", "old woman", "wizard", "woman",
  ]);

  const dictionaryTypeCandidates = (term = "", text = "") => {
    const normalized = dictionaryLemma(term, detectLanguage(text));
    const head = normalized.split(/\s+/).filter(Boolean)[0] || normalized;
    const lexicalType = dictionaryLocationTokens.has(head)
      ? "location"
      : dictionaryObjectTokens.has(head)
        ? "object"
        : dictionaryConceptTokens.has(normalized) || dictionaryConceptTokens.has(head)
          ? "concept"
          : dictionaryRoleTokens.has(normalized) || dictionaryRoleTokens.has(head)
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

  const extractDictionaryCandidates = (chunks = [], { language = "", maxTerms = 120, minFrequency = 1 } = {}) => {
    const profile = languageProfiles[language] || {};
    const stopWords = new Set([
      ...entityStopWords,
      ...(profile.stopWords || []).map(normalizeEntityToken),
      ...(profile.weakStarts || []).map(normalizeEntityToken),
      ...dictionaryFunctionTokens,
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
    const language = detectLanguage(combinedText, preferredRuntimeLanguage(config, payload) || scopedChunks[0]?.metadata?.language || "");
    const maxTerms = Math.max(8, Number(config.maxTerms || 120));
    const minFrequency = Math.max(1, Number(config.minFrequency || 1));
    const scope = String(config.scope || "document").trim().toLowerCase() || "document";
    const replaceExisting = config.replaceExisting !== false;
    if (replaceExisting && documentId) await deleteDictionaryEntries({ workspaceId, documentId });
    const now = nowIso();
    const candidates = extractDictionaryCandidates(scopedChunks, { language, maxTerms, minFrequency });
    const records = [];
    for (const candidate of candidates) {
      const chunk = candidate.evidenceChunk || scopedChunks[0] || {};
      const evidence = dictionaryEvidenceFor(chunk.text || "", candidate.term);
      const lemma = dictionaryLemma(candidate.term, language);
      const typeCandidates = dictionaryTypeCandidates(candidate.term, chunk.text || "");
      const confidence = Math.min(0.95, 0.48 + Math.min(0.35, candidate.count / 20) + (candidate.source === "proper-noun" ? 0.12 : 0));
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
        aliases: [candidate.term].filter(Boolean),
        typeCandidates,
        tier,
        usableAsSeed: tier === "core" || tier === "typed",
        seedScore,
        semanticHints: [],
        relationCues: [],
        confidence,
        evidence,
        source: {
          method: "rule-dictionary",
          nodeId: node?.id || "",
          inputChannel: event?.channel || "",
          occurrenceCount: candidate.count,
          sourceChunkIds: [...candidate.chunkIds].filter(Boolean).slice(0, 12),
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
        ...records.slice(0, 20).map((entry, index) =>
          `[D${index + 1}] ${entry.term} -> ${entry.typeCandidates?.[0]?.type || "term"} tier=${entry.tier || "weak"} seed=${entry.usableAsSeed ? "yes" : "no"} (${Number(entry.confidence || 0).toFixed(2)})`
        ),
      ].join("\n")
      : "Knowledge Dictionary: no terms";
    const previewEntries = records.slice(0, Math.max(6, Number(config.previewTerms || 16))).map((entry) => ({
      id: entry.id,
      term: entry.term,
      lemma: entry.lemma,
      typeCandidates: entry.typeCandidates,
      tier: entry.tier,
      usableAsSeed: entry.usableAsSeed,
      seedScore: entry.seedScore,
      confidence: entry.confidence,
      evidence: entry.evidence,
      source: {
        method: entry.source?.method || "",
        occurrenceCount: entry.source?.occurrenceCount || 0,
        sourceChunkIds: (entry.source?.sourceChunkIds || []).slice(0, 4),
      },
    }));
    return {
      id: uniqueId("kdict_batch"),
      workspaceId,
      collectionId,
      documentId,
      language,
      scope,
      dictionaryEntries: previewEntries,
      dictionaryEntryIds: records.slice(0, Math.max(10, Number(config.previewIds || 40))).map((entry) => entry.id),
      dictionaryEntryIdsTruncated: records.length > Math.max(10, Number(config.previewIds || 40)),
      dictionaryCount: records.length,
      previewCount: previewEntries.length,
      tierCounts: records.reduce((acc, entry) => {
        const tier = entry.tier || "weak";
        acc[tier] = (acc[tier] || 0) + 1;
        return acc;
      }, {}),
      usableSeedCount: records.filter((entry) => entry.usableAsSeed).length,
      context,
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

  const narrativeObjectHints = [
    "tazza", "tè", "tea", "acqua", "water", "sorgente", "source", "spring", "fiore", "flower", "fleur", "flor",
    "bastone", "stick", "voce", "voice", "parola", "speech", "troll", "mostro", "monster",
  ];

  const inferNarrativeEventType = (sentence = "") => {
    const normalized = normalizeEntityToken(sentence);
    if (/^[a-zà-ÿ]{1,3}\s/.test(String(sentence || "").trim())) return "";
    if (!/[.!?;:»”"]$/.test(String(sentence || "").trim()) && normalized.split(/\s+/).length <= 8) return "";
    const match = narrativeActionLexicon.find((entry) => entry.patterns.some((pattern) => pattern.test(normalized)));
    if (match?.type === "fills" && (
      /\b(?:musica|risate|speranza|gioia|paura|silenzio|sound|music|laughter|hope)\b/.test(normalized) ||
      !/\b(?:tazza|cup|bicchiere|bottle|bottiglia|contenitore|acqua|water|tea|t[eé]|liquido|liquid)\b/.test(normalized)
    )) return "";
    if (match?.type === "heals" && /\b(?:potra|potrà|potrebbe|dovra|dovrà|pu[oò]|puo|can|could|will|would|pourra|pourrait)\b.{0,60}\b(?:guarire|guarito|heal|healed|cure|cured)\b/.test(normalized)) return "";
    if (match?.type === "speaks" && /\b(?:far|fare|modo\s+per|desideri|possa|potesse|riusc[iì]|riuscire)\b.{0,80}\b(?:parlare|speak|talk)\b/.test(normalized)) return "";
    return match?.type || "";
  };

  const narrativeActionCueIndex = (sentence = "", eventType = "") => {
    const normalized = normalizeEntityToken(sentence);
    const entries = eventType
      ? narrativeActionLexicon.filter((entry) => entry.type === eventType)
      : narrativeActionLexicon;
    const positions = entries.flatMap((entry) =>
      entry.patterns.map((pattern) => {
        const match = normalized.match(pattern);
        return match ? match.index || 0 : -1;
      }).filter((index) => index >= 0)
    );
    return positions.length ? Math.min(...positions) : -1;
  };

  const sentenceHasNarrativeAction = (sentence = "", eventType = "") => narrativeActionCueIndex(sentence, eventType) >= 0;

  const knowledgePronounPattern = /^(?:i|me|you|he|she|it|we|they|him|her|them|lui|lei|egli|ella|esso|essa|noi|voi|loro|essi|esse|lo|la|li|le|gli|elles|ils|elle|eux|ellos|ellas|el|ella)$/i;

  const isKnowledgePronounMention = (value = "") =>
    knowledgePronounPattern.test(normalizeEntityToken(value));

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
      ...(previous.recentParticipants || []),
      ...(previous.participants || []),
      ...(previous.subject ? [previous.subject] : []),
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
    evidenceSpan: String(sentence || "").slice(0, 260),
    sourceMention: sourceMention || subject || "",
    participants: unique(participants.filter(Boolean)),
  });

  const narrativeObjectPosition = (sentence = "", term = "") => {
    const key = normalizeEntityToken(term);
    if (!key) return -1;
    const match = normalizeEntityToken(sentence).match(new RegExp(`\\b${escapedRegExp(key)}\\b`));
    return match ? match.index || 0 : -1;
  };

  const isNarrativeLiquidOrContainer = (term = "") =>
    /\b(?:acqua|water|agua|eau|t[eé]|tea|tazza|cup|bicchiere|glass|bottle|bottiglia|contenitore|container|sorgente|source|spring)\b/.test(normalizeEntityToken(term));

  const narrowNarrativeEventObjects = (sentence = "", eventType = "", objects = []) => {
    const sorted = [...objects].sort((left, right) => narrativeObjectPosition(sentence, left) - narrativeObjectPosition(sentence, right));
    if (eventType === "fills") {
      const selected = sorted.filter(isNarrativeLiquidOrContainer);
      return selected.length ? selected : sorted;
    }
    if (eventType === "immerses") {
      const actionIndex = narrativeActionCueIndex(sentence, "immerses");
      const afterAction = sorted.filter((term) => {
        const position = narrativeObjectPosition(sentence, term);
        return position < 0 || actionIndex < 0 || position >= actionIndex;
      });
      const movedObjects = afterAction.filter((term) => !isNarrativeLiquidOrContainer(term));
      return movedObjects.length ? movedObjects : (afterAction.length ? afterAction : sorted);
    }
    return sorted;
  };

  const buildNarrativeEventSpecs = (sentence = "", eventType = "", objects = []) => {
    if (eventType === "fills" && sentenceHasNarrativeAction(sentence, "immerses")) {
      return [
        { eventType: "fills", objects: narrowNarrativeEventObjects(sentence, "fills", objects) },
        { eventType: "immerses", objects: narrowNarrativeEventObjects(sentence, "immerses", objects) },
      ].filter((spec) => spec.objects.length || spec.eventType === eventType);
    }
    return [{ eventType, objects: narrowNarrativeEventObjects(sentence, eventType, objects) }];
  };

  const inferNarrativeEventSubjectResolution = (sentence = "", dictionaryEntries = [], eventType = "", previous = {}) => {
    const properEntries = narrativeSubjectDictionaryEntries(dictionaryEntries);
    const normalizedSentence = normalizeEntityToken(sentence);
    const actionIndex = narrativeActionCueIndex(sentence, eventType);
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
        return {
          subject: previousParticipants.join(", "),
          participants: previousParticipants,
          subjectResolution: narrativeSubjectResolution({ subject: previousParticipants.join(", "), method: "context-window", confidence: 0.72, sentence, sourceMention: firstToken || "they", participants: previousParticipants }),
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

  const inferNarrativeEventSubject = (sentence = "", dictionaryEntries = [], eventType = "", previousSubject = "") =>
    inferNarrativeEventSubjectResolution(sentence, dictionaryEntries, eventType, { subject: previousSubject }).subject;

  const inferNarrativeEventObjects = (sentence = "", dictionaryEntries = []) => {
    const normalizedSentence = normalizeEntityToken(sentence);
    const dictionaryObjects = dictionaryEntries
      .filter((entry) => ["object", "concept", "location", "creature"].includes(String(entry.typeCandidates?.[0]?.type || "").toLowerCase()))
      .map((entry) => entry.term || entry.lemma || "")
      .filter(Boolean);
    return unique([...dictionaryObjects, ...narrativeObjectHints]
      .filter((term) => {
        const key = normalizeEntityToken(term);
        return key && new RegExp(`\\b${escapedRegExp(key)}\\b`).test(normalizedSentence);
      })
      .sort((a, b) => b.length - a.length))
      .slice(0, 8);
  };

  const narrativeEventImportance = (eventType = "", objects = [], sentence = "") => {
    const normalized = normalizeEntityToken(`${sentence} ${objects.join(" ")}`);
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
    }[eventType] || 0.55;
    if (/\b(?:tazza|cup|t[eé]|tea|acqua|water|fiore|flower|sorgente|source|voce|voice|guar|heal|cure)\b/.test(normalized)) score += 0.08;
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
    const cleanSubject = subject && !isKnowledgePronounMention(subject) ? subject : "";
    const cleanObjects = (objects || []).filter(Boolean);
    const cleanContextObjects = (contextObjects || []).filter(Boolean);
    const roles = {
      agent: cleanSubject ? [cleanSubject] : [],
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
    roles.participants = unique([...(participants || []), cleanSubject, ...cleanObjects, ...roles.destination].filter(Boolean));
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

  const knowledgeEventCandidateKey = (candidate = {}) => [
    candidate.chunkId || candidate.chunk?.id || "",
    normalizeKnowledgeEventType(candidate.eventType),
    normalizeKnowledgeText(candidate.evidence?.quote || candidate.quote || "").slice(0, 180),
  ].join("::");

  const normalizeAiKnowledgeEventTypeForEvidence = (eventType = "", quote = "") => {
    const type = normalizeKnowledgeEventType(eventType);
    const normalized = normalizeEntityToken(quote);
    if (!type) return { eventType: "", reason: "event-type-not-allowed" };
    if (type === "has_property" && !/\b(?:possiede|possedeva|possiedono|possesses|possessed|potere|poteri|propriet[aà]|capacit[aà]|power|property|ability|pouvoir|capacit[eé])\b/.test(normalized)) {
      return { eventType: "", reason: "property-cue-not-supported" };
    }
    if (type === "speaks" && (
      /\b(?:prov[oò]|riprov[oò]|try|tried|tries|tent[oò]|tentava)\b.{0,80}\b(?:parlare|speak|talk)\b.{0,100}\b(?:nulla|silenzio|nothing|silence)\b/.test(normalized) ||
      /\b(?:non\s+(?:pu[oò]|poteva|potendo|riesce|riusciva|riusc[iì])\s+(?:a\s+)?parlare|cannot\s+speak|could\s+not\s+speak|unable\s+to\s+speak)\b/.test(normalized)
    )) {
      return { eventType: "cannot_speak", reason: "normalized-failed-speech" };
    }
    return { eventType: type, reason: "" };
  };

  const callKnowledgeEventAi = async ({ chunks = [], dictionaryEntries = [], config = {} } = {}) => {
    const mode = String(config.extractionMode || config.mode || "rules").toLowerCase();
    if (!["ai", "hybrid"].includes(mode) || !chunks.length) return { events: [], provider: "", model: "", error: "", promptMode: "" };
    const provider = await pickAiProvider({ ...config, enrichmentMode: "ai" });
    if (!provider) return { events: [], provider: "", model: "", error: "provider-not-found", promptMode: "" };
    const providerType = String(provider.provider || provider.providerType || config.providerType || config.provider || "").toLowerCase();
    const requestedModel = String(config.model || provider.model || (providerType === "ollama" ? "llama3.1" : "local-model")).trim();
    const model = providerType === "ollama"
      ? requestedModel
      : await resolveOpenAiCompatibleModel({ provider, model: requestedModel });
    const allowedTypes = [...knowledgeEventTypes];
    const systemPrompt = knowledgeAiTextConfig(
      config.systemPrompt,
      "You are a Knowledge Event Builder. Extract ordered, evidence-backed narrative and semantic events from local document chunks."
    );
    const promptTemplate = knowledgeAiTextConfig(
      config.promptTemplate,
      "Use only provided chunks and dictionary terms. Return strict JSON with events, rejectedCandidates, exact evidence quotes, source-language labels, ordered event types and short explanations."
    );
    const outputInstructions = knowledgeAiTextConfig(
      config.outputInstructions,
      "Every accepted event must include eventType, subject, objects, confidence, evidence.chunkId, evidence.quote and explanation. Do not invent facts outside evidence."
    );
    const promptFor = ({ mode: promptMode = "full" } = {}) => {
      const compact = promptMode === "compact";
      const micro = promptMode === "micro";
      const chunkLimit = micro ? 1 : compact ? Math.min(2, chunks.length) : chunks.length;
      const chunkChars = micro ? 900 : compact ? 1400 : Math.max(600, Math.min(3600, Number(config.maxChunkChars || 2200)));
      const termLimit = micro ? 12 : compact ? 24 : 60;
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
        "Use only facts explicitly supported by the text. Do not infer outside the quote.",
        "Every event MUST include evidence.quote copied verbatim from exactly one chunk.",
        "Split compound sentences into separate ordered events when they contain separate actions.",
        "Use speaks only for successful speech/output. Failed attempts or silence are cannot_speak.",
        "Use has_property only when the quote explicitly states a property, power or ability.",
        "Keep subjects and objects in the source text language when possible.",
        "Prefer events that explain causality, preparation, action, transformation, healing, speech, asking/giving/receiving and conflict.",
        `Allowed eventType values: ${allowedTypes.join(", ")}`,
        `Limits: events <= ${Math.max(1, Math.min(120, Number(config.maxEvents || 80)))}.`,
        "Schema:",
        JSON.stringify(schema),
        JSON.stringify({
          dictionaryTerms: dictionaryEntries.slice(0, termLimit).map((entry) => ({
            term: entry.term,
            type: entry.typeCandidates?.[0]?.type || "term",
            tier: entry.tier || "",
          })),
          chunks: chunks.slice(0, chunkLimit).map((chunk) => ({
            id: chunk.id,
            ordinal: chunk.ordinal ?? chunk.index ?? chunk.start ?? 0,
            text: String(chunk.text || "").slice(0, chunkChars),
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
      for (const promptMode of ["full", "compact", "micro"]) {
        const prompt = promptFor({ mode: promptMode });
        const body = providerType === "ollama"
          ? {
            model,
            prompt,
            stream: false,
            options: {
              temperature: knowledgeAiNumberConfig(config.temperature, 0.05),
              top_p: knowledgeAiNumberConfig(config.topP, 0.9),
              num_predict: Math.max(128, knowledgeAiNumberConfig(config.maxTokens, 1200)),
            },
          }
          : {
            model,
            messages: [{ role: "user", content: prompt }],
            temperature: knowledgeAiNumberConfig(config.temperature, 0.05),
            max_tokens: Math.max(128, knowledgeAiNumberConfig(config.maxTokens, 1200)),
            top_p: knowledgeAiNumberConfig(config.topP, 0.9),
          };
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
        const proposal = parseAiJsonObject(text);
        if (Array.isArray(proposal?.events)) {
          return {
            events: proposal.events,
            rejectedCandidates: Array.isArray(proposal.rejectedCandidates) ? proposal.rejectedCandidates : [],
            provider: provider.id || providerType || "provider",
            model: data.model || model,
            usage: totalUsage,
            error: "",
            promptMode,
          };
        }
        lastError = "invalid-ai-json";
      }
      return { events: [], rejectedCandidates: [], provider: provider.id || providerType || "provider", model, usage: totalUsage, error: lastError || "empty-ai-events", promptMode: "" };
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
    const maxEvents = Math.max(1, Math.min(240, Number(config.maxEvents || 80)));
    const minConfidence = Math.max(0, Math.min(1, Number(config.confidenceThreshold ?? 0.55)));
    const now = nowIso();
    const chunkById = new Map(scopedChunks.map((chunk) => [chunk.id, chunk]));
    const extractionMode = String(config.extractionMode || config.mode || "rules").toLowerCase();
    const wantsAi = ["ai", "hybrid"].includes(extractionMode);
    const wantsRules = true;
    const ruleCandidates = [];
    let previousContext = { subject: "", participants: [] };
    if (wantsRules) {
      for (const chunk of scopedChunks) {
        const sentences = narrativeSentenceSplit(chunk.text || "");
        for (let sentenceIndex = 0; sentenceIndex < sentences.length && ruleCandidates.length < maxEvents; sentenceIndex += 1) {
          const sentence = sentences[sentenceIndex];
          const eventType = inferNarrativeEventType(sentence);
          if (!eventType) continue;
          const objects = inferNarrativeEventObjects(sentence, dictionaryEntries);
          const eventSpecs = buildNarrativeEventSpecs(sentence, eventType, objects);
          for (const spec of eventSpecs) {
            if (ruleCandidates.length >= maxEvents) break;
            const subjectInfo = inferNarrativeEventSubjectResolution(sentence, dictionaryEntries, spec.eventType, previousContext);
            const subject = subjectInfo.subject || "";
            const confidence = narrativeEventImportance(spec.eventType, spec.objects, sentence);
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
                quote: offsets.quote.slice(0, 520),
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
              ...(subjectInfo.participants || []),
              subject,
              ...mentionedParticipants,
              ...spec.objects.filter((item) => isNarrativeParticipantMention(item, dictionaryEntries)),
            ].filter((item) => item && !isKnowledgePronounMention(item)));
            previousContext = {
              subject: subject && !isKnowledgePronounMention(subject) ? subject : previousContext.subject || "",
              participants: candidateParticipants,
              recentParticipants: unique([
                ...candidateParticipants,
                ...(previousContext.recentParticipants || []),
                ...(previousContext.participants || []),
              ].filter((item) => item && !isKnowledgePronounMention(item))).slice(0, 6),
            };
          }
        }
      }
    }
    const aiResult = wantsAi
      ? await callKnowledgeEventAi({ chunks: scopedChunks, dictionaryEntries, config })
      : { events: [], rejectedCandidates: [], provider: "", model: "", error: "", promptMode: "" };
    if (wantsAi && aiResult.usage?.totalTokens) {
      await persistKnowledgeNodeTokenUsage({ node, usage: aiResult.usage, provider: aiResult.provider, model: aiResult.model });
    }
    const rejectedCandidates = Array.isArray(aiResult.rejectedCandidates) ? [...aiResult.rejectedCandidates] : [];
    const aiCandidates = [];
    if (wantsAi) {
      for (const item of (aiResult.events || []).slice(0, maxEvents * 2)) {
        const quote = String(item?.evidence?.quote || item?.quote || "").replace(/\s+/g, " ").trim();
        const normalizedAiEvent = normalizeAiKnowledgeEventTypeForEvidence(item?.eventType || item?.type || "", quote);
        const eventType = normalizedAiEvent.eventType;
        if (!eventType) {
          rejectedCandidates.push({ label: item?.eventType || "", reason: normalizedAiEvent.reason || "event-type-not-allowed", quote: quote.slice(0, 120) });
          continue;
        }
        const chunk = chunkById.get(item?.evidence?.chunkId || item?.chunkId || "") ||
          scopedChunks.find((candidateChunk) => quote && evidenceQuoteInChunk(candidateChunk, quote));
        if (!chunk || !evidenceQuoteInChunk(chunk, quote)) {
          rejectedCandidates.push({ label: eventType, reason: "missing-event-evidence", quote: quote.slice(0, 120) });
          continue;
        }
        const confidence = Math.min(0.98, Number(item.confidence || 0));
        if (confidence < minConfidence) continue;
        const objects = normalizeKnowledgeEventObjects(item.objects || item.object || item.target || []);
        const rawSubject = String(item.subject || item.actor || "").replace(/\s+/g, " ").trim().slice(0, 96);
        const aiSubjectInfo = rawSubject && !isKnowledgePronounMention(rawSubject)
          ? {
            subject: rawSubject,
            participants: [rawSubject],
            subjectResolution: narrativeSubjectResolution({ subject: rawSubject, method: "explicit", confidence: 0.76, sentence: quote, sourceMention: rawSubject, participants: [rawSubject] }),
          }
          : inferNarrativeEventSubjectResolution(quote, dictionaryEntries, eventType, { subject: "", participants: [] });
        const subject = aiSubjectInfo.subject || "";
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
            quote: offsets.quote.slice(0, 520),
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
          explanation: String(item.explanation || normalizedAiEvent.reason || "").slice(0, 260),
        });
      }
    }
    const useRuleFallback = wantsAi && aiResult.error && !aiCandidates.length;
    const candidateSource = extractionMode === "ai" && !useRuleFallback
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
      const subject = String(candidate.subject || "").replace(/\s+/g, " ").trim().slice(0, 96);
      const participants = unique([
        ...(candidate.participants || []),
        subject,
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
    const previewLimit = Math.max(10, Number(config.previewEvents || 24));
    const highValueEventTypes = new Set(["finds", "fills", "immerses", "transforms", "takes", "drinks", "heals", "speaks", "cannot_speak", "seeks", "has_property"]);
    const previewSelection = unique([
      ...records.slice(0, Math.min(8, previewLimit)).map((entry) => entry.id),
      ...records.filter((entry) => highValueEventTypes.has(entry.eventType) && Number(entry.confidence || 0) >= 0.72).map((entry) => entry.id),
    ])
      .map((id) => records.find((entry) => entry.id === id))
      .filter(Boolean)
      .slice(0, previewLimit)
      .sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
    const context = records.length
      ? [
        `Knowledge Events: ${records.length} ordered event(s)`,
        ...previewSelection.map((entry) =>
          `[EV${entry.sequence}] ${entry.subject || "event"} -${entry.eventType}-> ${entry.objects.join(", ") || "context"} evidence="${String(entry.evidence?.quote || "").slice(0, 180)}"`
        ),
      ].join("\n")
      : "Knowledge Events: none";
    const previewEvents = previewSelection.map((entry) => ({
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
      events: previewEvents,
      eventIds: records.slice(0, Math.max(10, Number(config.previewIds || 60))).map((entry) => entry.id),
      eventIdsTruncated: records.length > Math.max(10, Number(config.previewIds || 60)),
      extractionMode,
      provider: aiResult.provider || "",
      model: aiResult.model || "",
      error: aiResult.error || "",
      proposed: {
        aiEventCount: aiCandidates.length,
        ruleEventCount: ruleCandidates.length,
        promptMode: aiResult.promptMode || "",
        ruleFallback: useRuleFallback,
        rejectedCandidates,
      },
      context,
      status: useRuleFallback ? "fallback" : "ready",
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

  const inferRelationType = (source = {}, target = {}, fallback = "co_occurs") => {
    const types = new Set([source.entityType || "term", target.entityType || "term"]);
    const sourceRelationType = inferSourceRelationType(source, target);
    if (sourceRelationType) return sourceRelationType;
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
    const sourceRelationType = inferSourceRelationType(source, target);
    if (sourceRelationType) return sourceRelationType;
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
    if (hasAny([/\b(?:adempie|adempiuto|compie|compiuto|realizza|realizzato|porta a compimento|fulfill|fulfilled)\b/])) return "fulfills";
    if (hasAny([/\b(?:prefigura|prefigurato|figura|anticipa|anticipato|annuncia|annunciato|tipo|foreshadow|prefigure)\b/, /\bombra\s+(?:di|del|della|dei|delle)\b/])) return "foreshadows";
    if (hasAny([/\b(?:alleanza|patto|promessa|promette|promise|covenant)\b/]) && (hasPerson || hasConcept)) return "establishes";
    if (hasAny([/\b(?:insegna|insegnamento|dottrina|spiega|mostra|dimostra|teach|teaches|shows)\b/]) && (hasPerson || hasConcept)) return "teaches";
    if (hasAny([/\b(?:sacrificio|offerta|agnello|sangue|pane|calice|croce|rappresenta|simbolo|significa|represent|symbolizes)\b/]) && (hasObject || hasConcept)) return "represents";
    if (
      hasAny([/\b(?:peccato|morte|nemico|condanna|contro|oppone|opposto|contrasta|sconfigge|vince|opposes|defeats|against)\b/]) &&
      (
        (hasCreature && (hasPerson || hasObject)) ||
        (hasPerson && !hasConcept && !hasLocation && !hasObject) ||
        (hasPerson && hasConcept && hasAny([/\b(?:peccato|morte|nemico|condanna)\b/]))
      )
    ) return "opposes";
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
    if (relationType === "references") return { source: left, target: right };
    if (relationType === "mentions") {
      const source = [left, right].find((entity) => isSourceEntity(entity));
      const target = [left, right].find((entity) => !isSourceEntity(entity));
      return source && target ? { source, target } : { source: left, target: right };
    }
    if (["appears_in", "interacts_with", "expresses", "encounters", "says", "uses", "heals", "confronts", "helps", "travels_to", "reveals", "fulfills", "foreshadows", "establishes", "teaches", "opposes"].includes(relationType)) {
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
    const normalized = normalizeEntityToken(label);
    let canonical = label;
    if (normalized === "abramo") canonical = "Abrahamo";
    if (candidate.entityType === "object") {
      if (/^fuente de agua\s+/.test(normalized)) canonical = "fuente de agua";
      if (/^agua\s+(?:de|del|della|du|of)\s+/.test(normalized)) canonical = "agua";
      if (/^water\s+(?:source|spring)\s+/.test(normalized)) canonical = "water source";
    }
    if (/^ombra\s+(?:uno|due|tre|1|2|3)$/.test(normalized)) canonical = "ombra";
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
    const languageConfig = { ...config, text: clean, language: detectLanguage(clean, config.language || "") };
    const candidates = [];
    const push = (value = "", source = "pattern", confidence = 0.72, entityType = "") => {
      const rawLabel = String(value || "").replace(/\s+/g, " ").trim();
      const label = ["seed", "dictionary-seed"].includes(source) ? rawLabel : cleanEntityPhrase(rawLabel, languageConfig);
      if (label.length < 2 || label.length > 96) return;
      if (isWeakEntityLabelForLanguage(label, source, languageConfig, clean)) return;
      if (!["seed", "dictionary-seed"].includes(source) && isEntityStopWord(label, languageConfig)) return;
      const inferredType = entityType || inferEntityType(label, source);
      candidates.push({ label, source, confidence, entityType: inferContextualEntityType(label, inferredType, clean) });
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
      /\b(?:genannt|namens|mein\s+name\s+ist|ich\s+heiße|ich\s+heisse)\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ'’-]{2,}(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'’-]{2,}){0,2})/giu,
    ].forEach((pattern) => {
      [...clean.matchAll(pattern)].forEach((match) => push(match[1], "declared-name", 0.88, "proper-noun"));
    });
    [
      {
        entityType: "location",
        source: "keyword-location",
        pattern: new RegExp(`\\b((?:bosque|forest|foresta|foret|forêt|wald|bäume|baeume|castillo|castle|chateau|château|schloss|burg|montaña|mountain|montagne|berg|felsen|steine|caverna|cave|grotta|höhle|hoehle|reino|kingdom|regno|reich|pueblo|village|dorf|rio|río|river|fiume|fluss|camino|sendero|path|trail|weg|pfad)(?:${keywordConnectorTail}|${keywordTail}))\\b`, "giu"),
      },
      {
        entityType: "object",
        source: "keyword-object",
        pattern: new RegExp(`\\b((?:flor|flower|fiore|fleur|blume|fuente|source|spring|fontana|manantial|quelle|agua|water|acqua|eau|wasser|té|te|tea|tee|taza|cup|becher|tasse|antorcha|torch|torcia|fackel|palo|stick|bastone|stock)(?:${keywordConnectorTail}|${keywordTail}))\\b`, "giu"),
      },
      {
        entityType: "creature",
        source: "keyword-creature",
        pattern: /\b(troll|monstruo|monster|mostro|ungeheuer|monster|creature|kreatur|criatura|cervatillo|fawn|cerbiatto|rehkitz|bestias salvajes|wild beasts|bêtes sauvages|wilde tiere)\b/giu,
      },
      {
        entityType: "concept",
        source: "keyword-concept",
        pattern: /\b(autocontrol|self-control|selbstbeherrschung|resiliencia|resilience|widerstandsfähigkeit|widerstandsfaehigkeit|disciplina|discipline|disziplin|optimismo|optimism|optimismus|determinación|determinacion|determination|entschlossenheit|miedo|fear|paura|angst|esperanza|hope|espoir|hoffnung|amistad|friendship|amitié|freundschaft|coraje|courage|mut|compasión|compasion|compassion|mitgefühl|mitgefuehl)\b/giu,
      },
    ].forEach(pushKeywordMatches);
    (clean.match(/\b[A-ZÀ-Ý][A-Za-zÀ-ÿ'’-]+(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'’-]+){0,3}\b/g) || [])
      .forEach((value) => push(value, "proper-noun", value.includes(" ") ? 0.82 : 0.64));
    splitConfigList(config.seedTerms || config.terms).forEach((value) => {
      if (value && clean.toLowerCase().includes(value.toLowerCase())) push(value, "seed", 0.9);
    });
    (config.dictionarySeedEntries || []).forEach((entry) => {
      const label = String(entry.term || entry.label || "").trim();
      if (!label || !clean.toLowerCase().includes(label.toLowerCase())) return;
      const type = String(entry.typeCandidates?.[0]?.type || entry.entityType || inferEntityType(label)).toLowerCase();
      const confidence = Math.max(0.72, Math.min(0.96, Number(entry.seedScore || entry.confidence || 0.78)));
      push(label, "dictionary-seed", confidence, type);
    });
    const allowedTypes = splitConfigList(config.entityTypes).map((value) => value.toLowerCase());
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
    return deduped.slice(0, Math.max(1, Math.min(80, Number(config.maxEntities || 24))));
  };

  const dictionarySeedsForDocument = async ({ workspaceId, documentId = "", collectionId = "", payload = {}, config = {} } = {}) => {
    const useDictionarySeeds = config.useDictionarySeeds !== false && String(config.useDictionarySeeds || "true").toLowerCase() !== "false";
    if (!useDictionarySeeds) return [];
    const tierOrder = { core: 3, typed: 2, context: 1, weak: 0 };
    const minTier = String(config.minDictionarySeedTier || "typed").toLowerCase();
    const minRank = tierOrder[minTier] ?? tierOrder.typed;
    const maxSeeds = Math.max(1, Math.min(160, Number(config.maxDictionarySeeds || 48)));
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
    const maxRelations = Math.max(0, Math.min(240, Number(config.maxRelations || (dictionaryDrivenExtraction ? 64 : 120))));
    const maxRelationsPerChunk = Math.max(0, Math.min(40, Number(config.maxRelationsPerChunk || (dictionaryDrivenExtraction ? 6 : 12))));
    const maxRelationsPerEntityPerChunk = Math.max(1, Math.min(12, Number(config.maxRelationsPerEntityPerChunk || (dictionaryDrivenExtraction ? 2 : 3))));
    const maxRelationDistance = Math.max(120, Math.min(1200, Number(config.maxRelationDistance || (dictionaryDrivenExtraction ? 360 : 520))));
    const relationRecords = new Map();
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
      const candidates = entityCandidatesFromText(chunk.text || "", chunkConfig);
      const chunkEntities = [];
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
        const sourceRelationType = inferSourceRelationType(source, target);
        const relationType = config.relationType ||
          sourceRelationType ||
          (dictionaryDrivenExtraction
            ? inferConservativeRelationType(source, target)
            : narrativeRelationType || inferRelationType(source, target));
        if (dictionaryDrivenExtraction && !relationTypeAllowedForDictionaryPass(relationType, source, target, Boolean(narrativeRelationType))) continue;
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
            language,
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
      quote: textSlice.slice(0, 420),
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
      quote: quote.slice(0, 420),
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
    const healerLooksHealing = /\b(?:acqua|agua|water|eau|fiore|flower|fleur|sorgente|source|fonte|rimedio|remede|remède|cura|tazza|cup|infusione|tisana|tea|t[eé])\b/.test(healerLabel);
    if (!healerLooksHealing) return null;
    const hasHealingCue = /\b(?:guarire|guari|guarì|guarisce|guarito|cura|curare|heal|healed|heals|cure|cured|potere|poteri|poder|pouvoir|recupera|recuperò|recupero|ritrova|ritrovò|riacquista|riacquistò|torn[oò] a parlare|pouvoir de gu[eé]rir)\b/.test(cleanText);
    const hasSpeechRecoveryCue = /\b(?:voce|parlare|parlo|parlò|parla|parlava|speak|speaks|spoke|voice|talk|voz|hablar|parler)\b/.test(cleanText);
    if (!hasHealingCue || !hasSpeechRecoveryCue) return null;
    const patientPositions = [...cleanText.matchAll(new RegExp(`\\b${escapedRegExp(patientLabel)}\\b`, "g"))].map((match) => match.index || 0);
    const healerPositions = [...cleanText.matchAll(new RegExp(`\\b${escapedRegExp(healerLabel)}\\b`, "g"))].map((match) => match.index || 0);
    let best = null;
    patientPositions.forEach((patientPosition) => {
      healerPositions.forEach((healerPosition) => {
        const distance = Math.abs(patientPosition - healerPosition);
        if (distance > 900) return;
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
      quote: quote.slice(0, 420),
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
    const mechanismLooksHealing = /\b(?:acqua|agua|water|eau|fiore|flower|fleur|sorgente|source|fonte|rimedio|remede|remède|cura|tazza|cup|infusione|tisana|tea|t[eé])\b/.test(mechanismLabel);
    const outcomeLooksSpeech = semanticSpeechConcept(outcome) ||
      /\b(?:voce|parola|parlare|speech|voice|speaking|speak|voz|habla|parole)\b/.test(outcomeLabel);
    if (!mechanismLooksHealing || !outcomeLooksSpeech) return null;
    const hasHealingCue = /\b(?:guarire|guari|guarì|guarisce|guarito|cura|curare|heal|healed|heals|cure|cured|potere|poteri|poder|pouvoir|magica|magico|recupera|recuperò|ritrova|ritrovò|riacquista|riacquistò)\b/.test(cleanText);
    const hasPreparationCue = /\b(?:immerse|immerso|immersa|immergere|mise|messo|messa|mette|mettere|prepara|preparò|preparare|beve|bevve|bevuto|bere|drink|drank|drinks|cup|tazza|sorgente|source|spring)\b/.test(cleanText);
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
      quote: quote.slice(0, 420),
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
      entity.entityType === "object" &&
      !semanticWeakEntity(entity) &&
      /\b(?:acqua|agua|water|eau|fiore|flower|fleur|sorgente|source|fonte|rimedio|remede|remède|cura|tazza|cup|infusione|tisana|tea|t[eé])\b/.test(normalizeEntityToken(entity.label || ""))
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

  const inferRuleSemanticRelation = ({ source = {}, target = {}, relation = {}, chunk = {} } = {}) => {
    if (!source?.id || !target?.id || source.id === target.id) return null;
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
    const healingObjectPatterns = [/\b(?:acqua|agua|water|eau|fiore|fleur|flower|infusione|tisana|tea|t[eé]|remede|remède|rimedio|cura|fonte|source|sorgente)\b/];
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
    return String(text || "").replace(/\s+/g, " ").trim().slice(0, 300);
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

  const parseAiJsonObject = (text = "") => {
    const clean = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(clean.slice(start, end + 1));
    } catch {
      return null;
    }
  };

  const callSemanticAi = async ({ candidates = [], config = {} } = {}) => {
    const mode = String(config.enrichmentMode || "rules").toLowerCase();
    if (!["ai", "hybrid"].includes(mode) || !candidates.length) return { relations: [], provider: "", model: "", error: "" };
    const provider = await pickAiProvider(config);
    if (!provider) return { relations: [], provider: "", model: "", error: "provider-not-found" };
    const providerType = String(provider.provider || provider.providerType || config.providerType || config.provider || "").toLowerCase();
    const model = String(config.model || provider.model || (providerType === "ollama" ? "llama3.1" : "local-model")).trim();
    const systemPrompt = knowledgeAiTextConfig(
      config.systemPrompt,
      "You are a Semantic Relation Enricher. Classify candidate entity pairs into high-signal semantic relations using only supplied evidence."
    );
    const promptTemplate = knowledgeAiTextConfig(
      config.promptTemplate,
      "Use only candidate evidence text. Prefer explicit semantic relations over generic links and reject unsupported pairs."
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
      JSON.stringify({ candidates: candidates.slice(0, 24) }, null, 2),
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
            num_predict: Math.max(128, knowledgeAiNumberConfig(config.maxTokens, 900)),
          },
        }
        : {
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: knowledgeAiNumberConfig(config.temperature, 0.1),
          max_tokens: Math.max(128, knowledgeAiNumberConfig(config.maxTokens, 900)),
          top_p: knowledgeAiNumberConfig(config.topP, 0.9),
        };
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
    const maxEntities = Math.max(1, Math.min(120, Number(config.maxEntities || 40)));
    const maxRelations = Math.max(1, Math.min(160, Number(config.maxRelations || 48)));
    const systemPrompt = knowledgeAiTextConfig(
      config.systemPrompt,
      "You are a Knowledge Graph Builder Agent. Build a verified knowledge graph from local document chunks with evidence-backed entities and relations."
    );
    const promptTemplate = knowledgeAiTextConfig(
      config.promptTemplate,
      "Use chunks, existing entities and relations as context. Prefer precise domain relations, preserve source-language labels and reject weak or absent evidence."
    );
    const outputInstructions = knowledgeAiTextConfig(
      config.outputInstructions,
      "Return strict JSON with entities, relations and rejectedCandidates. Every accepted entity/relation must include an exact evidence quote."
    );
    const promptFor = ({ mode = "full" } = {}) => {
      const compact = mode === "compact";
      const micro = mode === "micro";
      const chunkLimit = micro ? 1 : compact ? 1 : chunks.length;
      const chunkChars = micro ? 520 : compact ? 900 : Math.max(400, Math.min(3200, Number(config.maxChunkChars || 1800)));
      const entityLimit = micro ? 0 : compact ? 12 : 80;
      const relationLimit = micro ? 0 : compact ? 12 : 80;
      const effectiveMaxEntities = micro ? Math.min(maxEntities, 12) : compact ? Math.min(maxEntities, 20) : maxEntities;
      const effectiveMaxRelations = micro ? Math.min(maxRelations, 8) : compact ? Math.min(maxRelations, 16) : maxRelations;
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
        `Limits: entities <= ${effectiveMaxEntities}, relations <= ${effectiveMaxRelations}.`,
        !micro && config.domainHint ? `Domain hint: ${String(config.domainHint).slice(0, compact ? 160 : 400)}` : "",
        "Schema:",
        JSON.stringify(compactSchema),
        JSON.stringify({
          chunks: chunks.slice(0, chunkLimit).map((chunk) => ({ id: chunk.id, text: String(chunk.text || "").slice(0, chunkChars) })),
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
      let totalUsage = {};
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
              num_predict: Math.max(128, knowledgeAiNumberConfig(config.maxTokens, 1400)),
            },
          }
          : {
            model,
            messages: [{ role: "user", content: prompt }],
            temperature: knowledgeAiNumberConfig(config.temperature, 0.05),
            max_tokens: Math.max(128, knowledgeAiNumberConfig(config.maxTokens, 1400)),
            top_p: knowledgeAiNumberConfig(config.topP, 0.9),
          };
        response = await postChatJson({ url, body, headers: headersForProvider(provider, config) });
        if (response.ok) {
          const data = await response.json();
          const text = data.response || data.choices?.[0]?.message?.content || data.output_text || "";
          const usage = knowledgeAiUsageFromResponse({ data, prompt, text });
          totalUsage = addKnowledgeAiUsage(totalUsage, usage);
          proposal = parseAiJsonObject(text);
          const hasPayload = Array.isArray(proposal?.entities) || Array.isArray(proposal?.relations);
          const hasSignal = (proposal?.entities || []).length || (proposal?.relations || []).length || (proposal?.rejectedCandidates || []).length;
          if (hasPayload && hasSignal) {
            return {
              proposal,
              provider: provider.id || providerType || "provider",
              model: data.model || model,
              usage: totalUsage,
              promptMode: usedMode,
              error: "",
            };
          }
          lastError = hasPayload ? "empty-ai-proposal" : "invalid-ai-json";
          continue;
        }
        const errorText = await chatErrorText(response);
        lastError = `HTTP ${response.status}${errorText ? `: ${errorText}` : ""}`;
        const canShrink = response.status === 400 || /context|token|too large|size/i.test(errorText);
        if (!canShrink) break;
      }
      if (!response?.ok) {
        return { proposal: null, provider: provider.id || providerType, model, usage: totalUsage, error: lastError || "ai-error" };
      }
      return { proposal, provider: provider.id || providerType || "provider", model, usage: totalUsage, promptMode: usedMode, error: lastError || "empty-ai-proposal" };
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
    return String(found || "").replace(/\s+/g, " ").trim().slice(0, 420);
  };

  const graphBuilderEvidenceBetween = (text = "", source = {}, target = {}, radius = 180) =>
    String(relationContextBetween(text, source, target, radius) || "").replace(/\s+/g, " ").trim().slice(0, 420);

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
    const maxChunks = Math.max(1, Math.min(24, Number(config.maxChunks || 6)));
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
    const maxEntities = Math.max(1, Math.min(120, Number(config.maxEntities || 40)));
    const maxRelations = Math.max(1, Math.min(160, Number(config.maxRelations || 48)));
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
          explanation: String(item.explanation || "").slice(0, 260),
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
        ...acceptedRelations.slice(0, 40).map((relation, index) =>
          `[GB${index + 1}] ${relation.sourceLabel} -${relation.relationType}-> ${relation.targetLabel} confidence=${Number(relation.confidence || 0).toFixed(2)} evidence="${String(relation.evidence?.quote || "").slice(0, 180)}"`
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
    const maxRelations = Math.max(1, Math.min(160, Number(config.maxRelations || 48)));
    const threshold = Math.max(0, Math.min(1, Number(config.confidenceThreshold ?? 0.55)));
    const now = nowIso();
    const candidates = workspaceRelations.slice(0, Math.max(maxRelations * 2, 24)).map((relation) => {
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
    const ruleResults = candidates
      .map((candidate) => ({ candidate, semantic: inferRuleSemanticRelation({ source: candidate.source, target: candidate.target, relation: candidate.relation, chunk: candidate.chunk }) }))
      .filter((item) => item.semantic && item.semantic.confidence >= threshold)
      .filter((item) => semanticRelationAllowed(item.semantic.relationType, config));
    const supplementalRuleResults = scopedChunks
      .flatMap((chunk) => [
        ...inferSupplementalUseRelationsForChunk({ chunk, entities: workspaceEntities, workspaceId, config }),
        ...inferSupplementalHealingRelationsForChunk({ chunk, entities: workspaceEntities, workspaceId, config }),
      ])
      .filter((item) => item.semantic && item.semantic.confidence >= threshold)
      .slice(0, Math.max(0, maxRelations - ruleResults.length));
    const aiInput = candidates
      .filter((candidate) => !ruleResults.some((item) => item.candidate.id === candidate.id))
      .map((candidate) => ({
        candidateId: candidate.id,
        sourceLabel: candidate.source.label,
        sourceType: candidate.source.entityType,
        targetLabel: candidate.target.label,
        targetType: candidate.target.entityType,
        originalRelationType: candidate.relation.relationType,
        evidence: candidate.text,
      }));
    const aiResult = await callSemanticAi({ candidates: aiInput, config });
    if (aiResult.usage?.totalTokens) {
      await persistKnowledgeNodeTokenUsage({ node, usage: aiResult.usage, provider: aiResult.provider, model: aiResult.model });
    }
    const aiByCandidateId = new Map((aiResult.relations || [])
      .filter((item) => semanticRelationTypes.has(String(item.relationType || "").toLowerCase()))
      .filter((item) => semanticRelationAllowed(item.relationType, config))
      .map((item) => [String(item.candidateId || ""), item]));
    const semanticItems = [...ruleResults, ...supplementalRuleResults];
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
          explanation: String(ai.explanation || "AI semantic classification").slice(0, 260),
          method: "ai-semantic",
          providerId: aiResult.provider,
          model: aiResult.model,
        },
      });
    });
    const existingSemanticKeys = new Set(byWorkspace(relationsAll, workspaceId)
      .filter((relation) => relation.metadata?.semantic)
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
          aiFallbackReason: semantic.method === "rule" ? aiResult.error || "" : "",
        },
        createdAt: now,
        updatedAt: now,
      };
      semanticRelations.push(await putRecord(STORES.relations, record));
    }
    const context = semanticRelations.length
      ? [
        "Semantic Knowledge Graph relations:",
        ...semanticRelations.slice(0, 40).map((relation, index) =>
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
      context,
      ai: {
        provider: aiResult.provider || "",
        model: aiResult.model || "",
        fallbackReason: aiResult.error || "",
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
      .slice(0, Math.max(1, Math.min(50, Number(config.topEntities || 12))));
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

  const queryGraph = async ({ workspaceId, query = "", config = {}, payload = {} } = {}) => {
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
    const depth = Math.max(1, Math.min(3, Number(payload?.depth || config.depth || 1)));
    const topK = Math.max(1, Math.min(80, Number(payload?.topK || config.topK || 12)));
    const maxRelations = Math.max(1, Math.min(240, Number(payload?.maxRelations || config.maxRelations || 48)));
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
    const maxEvidence = protectedEvidenceEnabled && (intent.process || intent.healing || intent.cause)
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
      const nonSeedQueryHitCount = nonSeedQueryTokens.reduce((count, token) => count + (token && text.includes(token) ? 1 : 0), 0);
      const healingMechanismScore = graphHealingMechanismCueScore(chunk.text || "", intent);
      const highMatch = seedLabels.length > 1
        ? matchedSeedCount >= 2 || (intent.healing && matchedSeedCount >= 1 && healingMechanismScore >= 18)
        : matchedSeedCount >= 1 && (!intent.instrument || nonSeedQueryHitCount >= 1 || (intent.healing && healingMechanismScore >= 18));
      if (!highMatch) return;
      const score = (matchedSeedCount * 8) + (queryHitCount * 2) + (intent.instrument ? 6 : 0) + (intent.healing ? 6 : 0) + healingMechanismScore;
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
    const entitiesResultRaw = (includeIsolated || !relationsResultRaw.length ? allEntitiesResultRaw : connectedEntitiesRaw)
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
    const chunkIds = new Set([
      ...entitiesResult.map((entity) => entity.chunkId).filter(Boolean),
      ...relationsResult.map((relation) => relation.chunkId).filter(Boolean),
    ]);
    const matchedLabels = rankedSeeds.map((item) => item.entity.label).filter(Boolean);
    const normalizedMatchedLabels = matchedLabels.map(normalizeEntityToken).filter(Boolean);
    const evidenceScore = (chunk = {}) => {
      const text = normalizeEntityToken(chunk.text || "");
      let score = 0;
      rankedSeeds.forEach(({ entity, score: seedScore }) => {
        if (text.includes(normalizeEntityToken(entity.label))) score += 12 + seedScore;
      });
      queryTokens.forEach((token) => {
        if (text.includes(token)) score += 3;
      });
      score += graphDefinitionCueScore(chunk.text || "", intent);
      score += graphHealingMechanismCueScore(chunk.text || "", intent);
      if (chunkIds.has(chunk.id)) score += 2;
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
            graphHealingMechanismCueScore(chunk.text || "", intent) >= 18;
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
        score: scoreKnowledgeEventForQuery(item, queryTokens, seedLabels, intent),
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
    const relationLines = relationsResult.slice(0, Math.min(40, maxRelations)).map((relation, index) => {
      const source = entityById.get(relation.sourceEntityId);
      const target = entityById.get(relation.targetEntityId);
      const marker = relation.direct ? " direct" : "";
      const semantic = relation.metadata?.semantic ? " semantic" : "";
      const method = relation.extraction?.method ? ` method=${relation.extraction.method}` : "";
      const original = relation.metadata?.originalRelationType ? ` original=${relation.metadata.originalRelationType}` : "";
      const explanation = relation.metadata?.explanation ? ` evidence=${String(relation.metadata.explanation).slice(0, 140)}` : "";
      const quote = relation.evidence?.quote || relation.metadata?.evidence?.quote || "";
      const quoteText = quote ? ` quote="${String(quote).slice(0, 180)}"` : "";
      return `[R${index + 1}${marker}${semantic}] ${source?.label || relation.sourceEntityId} -${relation.relationType || "related_to"}-> ${target?.label || relation.targetEntityId}${method}${original}${explanation}${quoteText}`;
    });
    const entityLines = entitiesResult.slice(0, 30).map((entity, index) =>
      `[E${index + 1}${entity.matched ? " match" : ""}] ${entity.label || entity.id} (${entity.entityType || "entity"}, connections=${entity.connections || 0}, score=${Number(entity.score || 0).toFixed(2)})`
    );
    const eventLines = eventsResult.map((item, index) =>
      `[EV${index + 1} seq=${item.sequence} score=${Number(item.score || 0).toFixed(2)}] ${item.subject || "event"} -${item.eventType}-> ${(item.objects || []).join(", ") || "context"} quote="${String(item.evidence?.quote || item.evidence?.text || "").slice(0, 220)}"`
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
    const mechanismEvidenceTerms = unique(mechanismEvidenceEvents.flatMap((item) => [
      ...(item.objects || []),
      ...(item.roles?.patient || []),
      ...(item.roles?.object || []),
      ...(item.roles?.destination || []),
      item.eventType === "drinks" ? "beve bevve drink drinks" : "",
      item.eventType === "fills" ? "riempie riempirono fill filled tazza cup" : "",
      item.eventType === "immerses" ? "immerge immersero immerse fiore flower" : "",
      item.eventType === "transforms" ? "trasforma trasformandosi bollire tè tea" : "",
      item.eventType === "speaks" ? "parla parlare parola voce grido speak voice" : "",
      intent.healing ? "fiore flower fleur flor acqua water eau agua sorgente source spring fonte tazza cup tè te tea infusione tisana beve bevve drink drank drinks" : "",
    ])
      .flatMap((value) => normalizeEntityToken(value).split(/\s+/))
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !queryStopWords.has(token))
      .filter((token) => !seedLabels.some((label) => label === token)));
    const mechanismOperationalTerms = new Set([
      "fiore", "flower", "fleur", "flor",
      "acqua", "water", "eau", "agua",
      "sorgente", "source", "spring", "fonte",
      "tazza", "cup", "te", "tea", "infusione", "tisana",
      "beve", "bevve", "bevuto", "bere", "drink", "drank", "drinks",
      "riempie", "riempirono", "fill", "filled",
      "immerge", "immersero", "immerse", "immerso", "immersa",
      "trasforma", "trasformandosi", "bollire", "boil", "boiled",
    ]);
    const mechanismOutcomeTerms = new Set(["parla", "parlare", "parola", "voce", "grido", "speak", "voice", "word"]);
    const evidenceCandidateMeta = (candidate = {}) => {
      const text = candidate.chunk?.text || "";
      const queryMatches = graphEvidenceMatchedTokens(text, queryTokens);
      const seedMatches = graphEvidenceMatchedTokens(text, seedLabels);
      const eventMatches = graphEvidenceMatchedTokens(text, eventChainTerms);
      const mechanismMatches = graphEvidenceMatchedTokens(text, mechanismEvidenceTerms);
      const operationalMatches = mechanismMatches.filter((token) => mechanismOperationalTerms.has(token));
      const outcomeMatches = mechanismMatches.filter((token) => mechanismOutcomeTerms.has(token));
      const healingCueScore = graphHealingMechanismCueScore(text, intent);
      const selected = false;
      const linked = chunkIds.has(candidate.chunk?.id);
      const highMatch = chunkScoreById.has(candidate.chunk?.id);
      const normalizedText = normalizeEntityToken(text);
      const instructionCue = /\b(?:importante|dovr|deve|devono|prepar|using|use|must|should|required|requires|needed|necessar|soluzione|solution|trovare|found|find)\b/.test(normalizedText);
      const outcomeSuccessCue = /\b(?:grido|usc[iì]|voglio parlare|pronunci|rison|risuon|finally spoke|began to speak|voice rang|spoke|parola dopo)\b/.test(normalizedText);
      const protectedKind = operationalMatches.length >= 2
        ? (instructionCue ? "setup" : "operation")
        : outcomeMatches.length >= 2 && healingCueScore >= 13 && outcomeSuccessCue
          ? "outcome"
          : "";
      return {
        chunk: candidate.chunk,
        score: candidate.score,
        selected,
        linked,
        highMatch,
        queryMatches,
        seedMatches,
        eventMatches,
        mechanismMatches,
        operationalMatches,
        outcomeMatches,
        healingCueScore,
        protectedKind,
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
    if (includeAdjacentChunks && mechanismProtectedEvidence.length) {
      const candidateByOrdinal = new Map(evidenceCandidateMetaList.map((item) => [Number(item.chunk?.ordinal ?? item.chunk?.index ?? -1), item]));
      mechanismProtectedEvidence.forEach((item) => {
        const ordinal = Number(item.chunk?.ordinal ?? item.chunk?.index ?? -1);
        [ordinal - 1, ordinal + 1].forEach((nearby) => {
          const adjacent = candidateByOrdinal.get(nearby);
          if (adjacent) addEvidenceCandidate({ ...adjacent, adjacentToChunkId: item.chunk?.id });
        });
      });
    }
    evidenceCandidateMetaList
      .sort((a, b) => b.score - a.score || String(a.chunk?.id || "").localeCompare(String(b.chunk?.id || "")))
      .forEach(addEvidenceCandidate);
    const snippetLabels = intent.healing || intent.process || intent.cause
      ? unique([...mechanismEvidenceTerms, "tazza", "tè", "tea", "fiore", "acqua", "sorgente", "beve", "bevve", "drink", ...matchedLabels])
      : matchedLabels;
    const orderedEvidenceCandidates = preserveDocumentOrder
      ? [...selectedEvidenceCandidates].sort((a, b) => Number(a.chunk?.ordinal ?? a.chunk?.index ?? 0) - Number(b.chunk?.ordinal ?? b.chunk?.index ?? 0))
      : selectedEvidenceCandidates;
    const evidence = orderedEvidenceCandidates.map((item, index) => ({
      index: index + 1,
      chunkId: item.chunk.id,
      documentId: item.chunk.documentId,
      text: graphEvidenceSnippet(item.chunk.text || "", snippetLabels, 900),
      metadata: item.chunk.metadata || {},
      score: item.score,
      selectionReason: evidenceMode === "full_ordered"
        ? "full-ordered"
        : mechanismProtectedEvidence.some((protectedItem) => protectedItem.chunk?.id === item.chunk.id)
        ? "mechanism-protected"
        : item.adjacentToChunkId
          ? "adjacent"
        : "ranked-score",
    }));
    const evidenceSelectionReasonById = new Map(evidence.map((item) => [item.chunkId, item.selectionReason]));
    const evidenceLines = evidence.map((item) => `[S${item.index} score=${Number(item.score || 0).toFixed(2)} reason=${item.selectionReason || "ranked"}] ${String(item.text || "").slice(0, 720)}`);
    const selectedEvidenceChunkIds = new Set(evidence.map((item) => item.chunkId).filter(Boolean));
    const evidenceTrace = scopedChunks
      .map((chunk) => {
        const text = chunk.text || "";
        const queryMatches = graphEvidenceMatchedTokens(text, queryTokens);
        const seedMatches = graphEvidenceMatchedTokens(text, seedLabels);
        const eventMatches = graphEvidenceMatchedTokens(text, eventChainTerms);
        const mechanismMatches = graphEvidenceMatchedTokens(text, mechanismEvidenceTerms);
        const operationalMatches = mechanismMatches.filter((token) => mechanismOperationalTerms.has(token));
        const outcomeMatches = mechanismMatches.filter((token) => mechanismOutcomeTerms.has(token));
        const healingCueScore = graphHealingMechanismCueScore(text, intent);
        const selected = selectedEvidenceChunkIds.has(chunk.id);
        const mechanismProtectedItem = mechanismProtectedEvidence.find((item) => item.chunk?.id === chunk.id);
        const mechanismProtected = Boolean(mechanismProtectedItem);
        const linked = chunkIds.has(chunk.id);
        const highMatch = chunkScoreById.has(chunk.id);
        const score = evidenceScore(chunk);
        const reasons = [
          selected ? "selected-evidence" : "",
          selected && evidenceSelectionReasonById.get(chunk.id) ? `selection-${evidenceSelectionReasonById.get(chunk.id)}` : "",
          mechanismProtected ? "mechanism-protected-evidence" : "",
          linked ? "linked-entity-or-relation" : "",
          highMatch ? "high-match-chunk" : "",
          queryMatches.length ? "query-token-match" : "",
          seedMatches.length ? "seed-label-match" : "",
          eventMatches.length ? "event-chain-term-match" : "",
          mechanismMatches.length ? "mechanism-term-match" : "",
          healingCueScore >= 18 ? "healing-mechanism-cue" : "",
        ].filter(Boolean);
        return {
          chunkId: chunk.id,
          documentId: chunk.documentId,
          ordinal: chunk.ordinal ?? chunk.index ?? null,
          selected,
          score,
          reasons,
          queryMatches,
          seedMatches,
          eventMatches,
          mechanismMatches,
          operationalMatches,
          outcomeMatches,
          healingCueScore,
          protectedKind: mechanismProtectedItem?.protectedKind || "",
          textPreview: String(text).slice(0, 360),
        };
      })
      .filter((item) => item.score > 0 || item.reasons.length)
      .sort((a, b) => Number(a.ordinal ?? 0) - Number(b.ordinal ?? 0))
      .slice(0, Math.max(24, Math.min(120, Number(payload?.debugEvidenceLimit || config.debugEvidenceLimit || 80))));
    const evidenceTraceLines = evidenceTrace.map((item) =>
      `[C${item.ordinal ?? "?"}${item.selected ? " selected" : ""} score=${Number(item.score || 0).toFixed(2)}] reasons=${item.reasons.join(",") || "none"} kind=${item.protectedKind || "-"} query=${item.queryMatches.join("|") || "-"} seed=${item.seedMatches.join("|") || "-"} event=${item.eventMatches.slice(0, 12).join("|") || "-"} mechanism=${item.mechanismMatches.slice(0, 12).join("|") || "-"} operational=${item.operationalMatches.slice(0, 12).join("|") || "-"} outcome=${item.outcomeMatches.slice(0, 12).join("|") || "-"} text="${String(item.textPreview || "").replace(/\s+/g, " ").slice(0, 220)}"`
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
    const maxContextChars = Math.max(1200, Math.min(12000, Number(payload?.maxContextChars || config.maxContextChars || 5200)));
    const context = rawContext.length > maxContextChars ? `${rawContext.slice(0, maxContextChars)}\n...` : rawContext;
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
        seedLabels,
        selectedEvidenceChunkIds: [...selectedEvidenceChunkIds],
        mechanismProtectedChunkIds: mechanismProtectedEvidence.map((item) => item.chunk?.id).filter(Boolean),
        evidenceMode,
        includeAdjacentChunks,
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
        evidenceMode,
        includeAdjacentChunks,
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
    const depth = Math.max(1, Math.min(3, Number(payload?.depth || config.depth || 1)));
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
    return score;
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
    const cutMarkers = [
      "\nDa quel momento",
      "\nCon il cuore pieno di gioia",
      "\nQuando tornarono",
      "\nIn suo onore",
    ];
    const cutIndex = cutMarkers
      .map((marker) => value.indexOf(marker))
      .filter((index) => index > 0)
      .sort((left, right) => left - right)[0];
    return cutIndex ? value.slice(0, cutIndex).trim() : value;
  };

  const composeFocusedSourceEvidence = ({ evidence = [], tokens = [], eventFacts = [], maxItems = 2, maxChars = 1800 } = {}) => {
    if (!Array.isArray(evidence) || !evidence.length) return "";
    const protectedEvidence = evidence
      .filter((item) => item.selectionReason === "mechanism-protected")
      .sort((left, right) => Number(left.index || 0) - Number(right.index || 0))
      .slice(0, maxItems)
      .map((item) => trimMechanismSourceEvidence(reasoningEvidenceText(item)))
      .filter(Boolean)
      .map((text) => text.length > maxChars ? `${text.slice(0, maxChars)}\n...` : text);
    if (protectedEvidence.length) return unique(protectedEvidence).join("\n\n");
    const eventSnippets = eventFacts
      .map((fact) => String(fact.evidence || "").trim())
      .filter((item) => item.length >= 24);
    const scoredEvidence = evidence
      .map((item) => {
        const text = reasoningEvidenceText(item);
        if (!text) return { text: "", score: 0 };
        const normalized = normalizeEntityToken(text);
        const tokenScore = tokens.reduce((score, token) => score + (token && normalized.includes(token) ? 4 : 0), 0);
        const eventScore = eventSnippets.reduce((score, snippet) => {
          const compactSnippet = normalizeEntityToken(snippet).slice(0, 120);
          return score + (compactSnippet && normalized.includes(compactSnippet) ? 10 : 0);
        }, 0);
        return { text, score: tokenScore + eventScore };
      })
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, maxItems)
      .map((item) => trimMechanismSourceEvidence(item.text))
      .filter(Boolean)
      .map((text) => text.length > maxChars ? `${text.slice(0, maxChars)}\n...` : text);
    return unique(scoredEvidence).join("\n\n");
  };

  const composeKnowledgeReasoningPlan = ({ workspaceId = "", node = {}, payload = {}, event = {}, config = {} } = {}) => {
    const query = String(payload?.query || payload?.question || payload?.text || config.query || "").trim();
    const queryIntent = payload?.scope?.queryIntent || payload?.queryIntent || config.queryIntent || null;
    const intent = detectReasoningIntent(query, { ...config, queryIntent });
    const tokens = reasoningTokens(query);
    const maxFacts = Math.max(1, Math.min(24, Number(config.maxFacts || payload?.maxFacts || (intent === "mechanism" ? 14 : 8))));
    const maxEvents = Math.max(1, Math.min(30, Number(config.maxEvents || payload?.maxEvents || 12)));
    const includeBackground = config.includeBackground === true || config.includeBackground === "true" || payload?.includeBackground === true;
    const events = Array.isArray(payload?.events) ? payload.events : [];
    const relations = Array.isArray(payload?.relations) ? payload.relations : [];
    const selectedEvents = intent === "mechanism"
      ? mechanismEventsForReasoning(events, tokens, maxEvents)
      : events
        .map((item) => ({ item, score: scoreReasoningEvent(item, tokens, intent) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxEvents)
        .sort((a, b) => Number(a.item.sequence || 0) - Number(b.item.sequence || 0))
        .map(({ item }) => item);
    const eventFacts = selectedEvents.map((item, index) => reasoningFactFromEvent(item, index, events));
    const rankedRelations = relations
      .map((item) => ({ item, score: scoreReasoningRelation(item, tokens, intent) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);
    const supportingRelations = (intent === "mechanism" && eventFacts.length ? [] : rankedRelations)
      .filter(({ item }) => includeBackground || !["appears_in", "context_for", "co_occurs", "associated_with"].includes(item.relationType || item.type || ""))
      .slice(0, Math.max(0, maxFacts - Math.min(eventFacts.length, maxFacts)))
      .map(({ item }, index) => reasoningFactFromRelation(item, index));
    const requiredFacts = [...eventFacts, ...supportingRelations].slice(0, maxFacts);
    const excludedContext = [
      intent === "mechanism" ? "Do not append later aftermath, celebration, movement or background context unless the user asked for consequences." : "",
      intent === "mechanism" ? "Do not replace the concrete event chain with a broad summary relation." : "",
      "Do not introduce subjects, containers, tools, places or causal links that are not present in required facts or evidence.",
    ].filter(Boolean);
    const responseInstructions = [
      intent === "mechanism" ? "Answer as an ordered explanation: include the relevant setup/prelude when evidence is provided, then each concrete action, then the first successful outcome." : "",
      intent === "mechanism" ? "Include the final outcome evidence when the chain contains it, especially the first proof that the mechanism succeeded." : "",
      intent === "mechanism" ? "Do not infer that the mechanism happens in a previous prelude location unless the selected evidence explicitly says the mechanism continues there." : "",
    ].filter(Boolean);
    const eventEvidenceText = unique(eventFacts.map((fact) => String(fact.evidence || "").trim()).filter(Boolean)).join("\n\n");
    const focusedSourceEvidence = composeFocusedSourceEvidence({
      evidence: payload?.evidence || [],
      tokens,
      eventFacts,
      maxItems: intent === "mechanism" ? 5 : 1,
      maxChars: intent === "mechanism" ? 1600 : 1000,
    });
    const primaryEvidenceText = unique([eventEvidenceText, focusedSourceEvidence].filter(Boolean)).join("\n\nFocused source excerpt:\n");
    const plan = {
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
      evidenceQuotes: unique(requiredFacts.map((fact) => String(fact.evidence || "").trim()).filter(Boolean)).slice(0, 12),
      primaryEvidenceText,
      sourceQueryId: payload?.queryId || payload?.id || "",
      sourceNodeId: event?.sourceNodeId || "",
      createdAt: nowIso(),
    };
    const eventLines = eventFacts.map((fact, index) => {
      const destination = fact.roles?.destination?.length ? ` destination=${fact.roles.destination.join(", ")}` : "";
      const patient = fact.roles?.patient?.length ? ` patient=${fact.roles.patient.join(", ")}` : "";
      return `[F${index + 1}] seq=${fact.sequence ?? ""} ${fact.subject || "event"} -${fact.eventType}-> ${(fact.objects || []).join(", ") || "context"}${patient}${destination} evidence="${String(fact.evidence || "").slice(0, 220)}"`;
    });
    const relationLines = supportingRelations.map((fact, index) =>
      `[R${index + 1}] ${fact.source || "source"} -${fact.relationType}-> ${fact.target || "target"} evidence="${String(fact.evidence || "").slice(0, 180)}"`
    );
    const reasoningContext = [
      `Knowledge Reasoning Plan: ${intent}`,
      query ? `Question: ${query}` : "",
      plan.primaryEvidenceText ? `Primary evidence text:\n${plan.primaryEvidenceText}` : "",
      eventLines.length ? `Required event chain:\n${eventLines.join("\n")}` : "",
      relationLines.length ? `Supporting relations:\n${relationLines.join("\n")}` : "",
      responseInstructions.length ? `Answer instructions:\n- ${responseInstructions.join("\n- ")}` : "",
      excludedContext.length ? `Boundaries:\n- ${excludedContext.join("\n- ")}` : "",
    ].filter(Boolean).join("\n\n");
    const maxContextChars = Math.max(1200, Math.min(12000, Number(config.maxContextChars || payload?.maxContextChars || 4800)));
    const composedContext = [
      reasoningContext,
      includeBackground && payload?.context ? `Source graph context:\n${String(payload.context).slice(0, maxContextChars)}` : "",
    ].filter(Boolean).join("\n\n");
    return {
      ...payload,
      id: plan.id,
      queryId: payload?.queryId || payload?.id || "",
      query,
      reasoningPlan: plan,
      context: composedContext.length > maxContextChars ? `${composedContext.slice(0, maxContextChars)}\n...` : composedContext,
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
            result = await queryGraph({ workspaceId: this.workspaceId, query, payload, config });
          }
          outputChannel = nodeOutput(node, config, "knowledge.graph.context");
        } else if (subtype === "knowledge-reasoning-composer") {
          result = composeKnowledgeReasoningPlan({ workspaceId: this.workspaceId, node, payload, event, config });
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
