// Flow Map pulse/live/replay execution, runtime test payloads and shell/header helpers.
// Extracted from js/flowMapView.js; loaded in order by flowMap.html.
const isTestableStarterNode = (node = {}) => {
  const category = String(nodeCategory(node) || "").toLowerCase();
  const type = String(node.type || "").toLowerCase();
  const status = String(node.runtime?.status || node.metadata?.runtimeStatus || node.status || "").toLowerCase();
  return !node.metadata?.library &&
    !["paused", "disabled", "disconnected"].includes(status) &&
    (type === "source" || type === "boxtracker" || category === "sources" || category === "trackers" || isCustomNetworkSourceNode(node));
};

const customNetworkRuntimeKind = (node = {}) =>
  String(node.metadata?.runtimeConfig?.runtimeConnector || node.metadata?.execute?.kind || node.metadata?.manifest?.execute?.kind || nodeRuntimeConfig(node).runtimeConnector || "").toLowerCase();

const isCustomNetworkSourceNode = (node = {}) =>
  isCustomRuntimeNode(node) && ["rest", "websocket", "rss"].includes(customNetworkRuntimeKind(node));

const isCustomFormSourceNode = (node = {}) =>
  isCustomRuntimeNode(node) && ["", "form"].includes(customNetworkRuntimeKind(node));

const isDirectAiTestNode = (node = {}) =>
  !node.metadata?.library &&
  node.type === "aiAgent" &&
  !["paused", "disabled", "disconnected"].includes(String(node.runtime?.status || node.metadata?.runtimeStatus || node.status || "").toLowerCase());

const isOrchestratorAgentNode = (node = {}) =>
  node.type === "aiAgent" && String(nodeSubtype(node) || "").toLowerCase() === "orchestrator";

const isManualInputSource = (node = {}) => {
  const subtype = String(nodeSubtype(node) || "").toLowerCase();
  return nodeCategory(node) === "sources" && ["task", "manual-json", "text-input", "manual-input", "image-source", "audio-source", "file-source", "files-source"].includes(subtype);
};

const isKnowledgeDocumentStarterNode = (node = {}) => {
  const subtype = String(nodeSubtype(node) || "").toLowerCase();
  return nodeCategory(node) === "knowledge" && ["document-store", "text-knowledge", "workspace-memory", "conversation-memory"].includes(subtype);
};

const isLiveTestableStarterNode = (node = {}) =>
  isDirectAiTestNode(node) || isManualInputSource(node) || isKnowledgeDocumentStarterNode(node) || isCustomRuntimeNode(node) || (isTestableStarterNode(node) && Boolean(nodeEndpoint(node)));

const runtimeRuleGraph = () =>
  graphModelApi().build({
    runtime: state.runtime,
    filters: {
      ...state.filters,
      channel: "all",
      type: "all",
      origin: "all",
      state: "all",
      activity: "all",
      eventType: "all",
      logLevel: "all",
      runId: "all",
    },
  });

const nodeParentDependencies = (node = {}, graph = runtimeRuleGraph()) =>
  !node?.id ? [] : (graph.dependencies || [])
    .filter((dependency) => dependency.targetNodeId === node.id && dependency.sourceNodeId && dependency.sourceNodeId !== node.id)
    .filter((dependency) => {
      const port = String(dependency.channel || dependency.metadata?.sourcePort || dependency.metadata?.targetPort || "").toLowerCase();
      return port !== "agent_control" && port !== "agent-control";
    });

const isRootRuntimeNode = (node = {}, graph = runtimeRuleGraph()) =>
  Boolean(node?.id) && !nodeParentDependencies(node, graph).length;

const rootStartBlockedReason = (node = {}, graph = runtimeRuleGraph()) => {
  const parents = nodeParentDependencies(node, graph)
    .map((dependency) => (graph.nodes || []).find((item) => item.id === dependency.sourceNodeId))
    .filter(Boolean)
    .map((parent) => parent.label || parent.id);
  return parents.length
    ? `Parte dal parent: ${parents.slice(0, 2).join(", ")}${parents.length > 2 ? ` +${parents.length - 2}` : ""}`
    : "Solo i root node possono avviare test";
};

const isRootTestableStarterNode = (node = {}, graph = runtimeRuleGraph()) =>
  isRootRuntimeNode(node, graph) && isTestableStarterNode(node);

const isRootLiveTestableStarterNode = (node = {}, graph = runtimeRuleGraph()) =>
  isRootRuntimeNode(node, graph) && isLiveTestableStarterNode(node);

const testRunId = () => `flow_test_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

const uniqueStrings = (values = []) =>
  [...new Set(values.filter(Boolean).map(String))];

const nodeTestChannels = (node = {}) =>
  uniqueStrings([
    ...(node.outputs || []),
    ...nodeChannels(node),
    node.metadata?.config?.emitChannel,
    node.metadata?.config?.channel,
    node.metadata?.config?.outputChannel,
  ].filter((channel) => channel && channel !== "all")).slice(0, 8);

const parseTestPayload = (value) => {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch (_) {
    return null;
  }
};

const parseObjectPayload = (value) => {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  const parsed = parseTestPayload(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
};

const endpointWithQueryParams = (endpoint = "", params = {}) => {
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
  } catch (_) {
    const query = entries
      .flatMap(([key, value]) => Array.isArray(value)
        ? value.map((item) => [key, item])
        : [[key, value]])
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join("&");
    return `${clean}${clean.includes("?") ? "&" : "?"}${query}`;
  }
};

const parseManualJsonPayload = (value) => {
  const parsed = parseTestPayload(value);
  if (parsed) return parsed;
  const text = String(value || "").trim();
  if (!text) return null;
  try {
    const normalized = text
      .replace(/([{,]\s*)([A-Za-z_$][\w$-]*)(\s*:)/g, '$1"$2"$3')
      .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, inner) => JSON.stringify(inner.replace(/\\'/g, "'")));
    return JSON.parse(normalized);
  } catch (_) {
    return null;
  }
};

const taskPayloadForNode = (node = {}, runId = "") => {
  const config = node.metadata?.config || {};
  const payload = parseManualJsonPayload(config.payloadJson || config.payload || config.testPayload) || {};
  const constraints = String(config.constraints || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  return {
    type: "agent_task",
    objective: String(config.objective || config.goal || node.label || "Agent task").trim(),
    context: String(config.context || "").trim(),
    priority: String(config.priority || "normal").trim() || "normal",
    successCondition: String(config.successCondition || config.stopCondition || "completed").trim(),
    constraints,
    limits: {
      maxIterations: Math.max(1, Number(config.maxIterations || 5)),
      timeoutMs: Math.max(0, Number(config.timeoutMs || 30000)),
    },
    payload,
    task: String(config.objective || config.goal || node.label || "Agent task").trim(),
    __test: true,
    runId,
    sourceNodeId: node.id,
    emittedAt: new Date().toISOString(),
  };
};

const nodeOutgoingTestChannels = (node = {}, graph = graphModel()) => {
  const connected = (graph.dependencies || [])
    .filter((dependency) => dependency.sourceNodeId === node.id)
    .map((dependency) => dependency.channel || dependency.metadata?.sourcePort || dependency.metadata?.targetPort)
    .filter((channel) => channel && channel !== "all");
  return uniqueStrings([...connected, ...nodeTestChannels(node)]).slice(0, 8);
};

const nodeRuntimeConfig = (node = {}) => ({
  ...(node.metadata?.runtimeConfig || {}),
  ...(node.metadata?.config || {}),
  endpoint: node.metadata?.config?.endpoint || node.metadata?.runtimeConfig?.endpoint || node.metadata?.endpoint || node.endpoint || "",
  method: node.metadata?.config?.method || node.metadata?.runtimeConfig?.method || node.method || "GET",
});

const nodeEndpoint = (node = {}) => {
  const config = nodeRuntimeConfig(node);
  return String(config.endpoint || config.url || config.wsUrl || config.source || "").trim();
};

const isWebSocketEndpoint = (endpoint = "") => /^wss?:\/\//i.test(String(endpoint || "").trim());

const isLiveKeepOpenNode = (node = {}) => {
  const config = nodeRuntimeConfig(node);
  return Boolean(config.keepWebSocketOpen || config.keepOpen || config.liveStream);
};

const parseResponsePayload = (value) => {
  if (value === undefined || value === null) return {};
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return { text: value };
  }
};

const runtimeOutputPorts = (node = {}) =>
  normalizeNodeBuilderPorts(node.metadata?.manifest?.outputs || node.outputs || ["output"], "out");

const valueAtPath = (source, path = "") => {
  const parts = String(path || "").trim().split(".").filter(Boolean);
  if (!parts.length) return source;
  return parts.reduce((value, key) => {
    if (value === undefined || value === null) return undefined;
    if (Array.isArray(value) && /^\d+$/.test(key)) return value[Number(key)];
    return value?.[key];
  }, source);
};

const customNodeFormValues = (node = {}) => {
  const config = nodeConfigObject(node);
  return Object.fromEntries(customNodeDataFields(node).map((field) => [field.key, customConfigValue(config, field)]));
};

const staticOutputValue = (expression = "") => {
  const text = String(expression || "").trim();
  if (!text) return null;
  return parseTestPayload(text) ?? text;
};

const outputPayloadForPort = (node = {}, channel = "", basePayload = {}, context = {}) => {
  const port = runtimeOutputPorts(node).find((item) => item.name === channel) || null;
  if (!port) return basePayload;
  const formData = context.formData || customNodeFormValues(node);
  const mode = String(port.sourceMode || "runtimeResult");
  let data = basePayload;
  if (mode === "formData") data = formData;
  else if (mode === "component") data = formData[port.sourceComponentKey || port.sourcePath || ""];
  else if (mode === "static") data = staticOutputValue(port.expression || port.sourcePath);
  else if (mode === "function") {
    data = port.sourcePath ? valueAtPath({ payload: basePayload, data: basePayload?.data, form: formData }, port.sourcePath) : basePayload;
  } else if (port.sourcePath) {
    data = valueAtPath({ payload: basePayload, data: basePayload?.data, form: formData }, port.sourcePath);
  }
  return {
    ...basePayload,
    outputPort: port.name,
    outputSource: {
      mode,
      path: port.sourcePath || "",
      component: port.sourceComponentKey || "",
    },
    data: data === undefined ? null : data,
  };
};

const nodeTestPayload = (node = {}, runId = "") => {
  const config = node.metadata?.config || {};
  const subtype = nodeSubtype(node);
  if (subtype === "task") return taskPayloadForNode(node, runId);
  if (subtype === "image-source") {
    return {
      live: true,
      runId,
      nodeId: node.id,
      type: "image",
      url: config.imageUrl || "",
      dataUrl: config.imageDataUrl || "",
      alt: config.alt || "",
      fileName: config.imageFileName || "",
      mimeType: config.imageMimeType || "image/*",
      data: { url: config.imageUrl || "", dataUrl: config.imageDataUrl || "", alt: config.alt || "" },
      emittedAt: new Date().toISOString(),
    };
  }
  if (subtype === "audio-source") {
    return {
      live: true,
      runId,
      nodeId: node.id,
      type: "audio",
      url: config.audioUrl || "",
      dataUrl: config.audioDataUrl || "",
      transcript: config.transcript || "",
      fileName: config.audioFileName || "",
      mimeType: config.audioMimeType || "audio/*",
      data: { url: config.audioUrl || "", dataUrl: config.audioDataUrl || "", transcript: config.transcript || "" },
      emittedAt: new Date().toISOString(),
    };
  }
  if (subtype === "file-source") {
    return {
      live: true,
      runId,
      nodeId: node.id,
      type: "file",
      fileName: config.fileName || "file",
      mimeType: config.mimeType || "application/octet-stream",
      dataUrl: config.fileDataUrl || "",
      data: { fileName: config.fileName || "file", mimeType: config.mimeType || "application/octet-stream", dataUrl: config.fileDataUrl || "" },
      emittedAt: new Date().toISOString(),
    };
  }
  if (subtype === "files-source") {
    const parsedFiles = Array.isArray(config.filesData) && config.filesData.length
      ? config.filesData
      : parseTestPayload(config.filesJson) || [];
    return {
      live: true,
      runId,
      nodeId: node.id,
      type: "files",
      batchLabel: config.batchLabel || "",
      files: Array.isArray(parsedFiles) ? parsedFiles : [parsedFiles],
      data: Array.isArray(parsedFiles) ? parsedFiles : [parsedFiles],
      emittedAt: new Date().toISOString(),
    };
  }
  const manualPayloadSource = nodeSubtype(node) === "manual-json"
    ? config.json || config.testPayload || config.payload || config.manualJson
    : config.testPayload || config.payload || config.manualJson || config.json;
  const configuredPayload = nodeSubtype(node) === "manual-json"
    ? parseManualJsonPayload(manualPayloadSource)
    : parseTestPayload(manualPayloadSource);
  if (!configuredPayload && isManualInputSource(node)) {
    const text = String(config.text || config.inputText || config.manualText || "").trim();
    if (text) {
      return {
        text,
        __test: true,
        runId,
        sourceNodeId: node.id,
        emittedAt: new Date().toISOString(),
      };
    }
  }
  const sample = configuredPayload || node.metadata?.sampleOutput || config.sampleOutput;
  if (sample && typeof sample === "object") {
    return {
      ...sample,
      __test: true,
      runId,
      sourceNodeId: node.id,
      emittedAt: new Date().toISOString(),
    };
  }
  const category = nodeCategory(node);
  const channel = config.emitChannel || config.outputChannel || node.outputs?.[0] || nodeChannels(node)[0] || "default";
  return {
    __test: true,
    runId,
    nodeId: node.id,
    title: node.label || node.title || node.id,
    category,
    subtype,
    channel,
    value: Math.round(Math.random() * 1000) / 10,
    status: "active",
    endpoint: config.endpoint || node.metadata?.endpoint || "",
    method: config.method || "GET",
    source: category === "sources" ? subtype : node.type || category,
    emittedAt: new Date().toISOString(),
  };
};

const executeManualInputNode = async ({ node, workspaceId, runId, graph } = {}) => {
  const payload = nodeTestPayload(node, runId);
  const channels = nodeOutgoingTestChannels(node, graph);
  const outputChannels = channels.length ? channels : ["raw"];
  for (const channel of outputChannels) {
    await emitLiveNodePayload({
      workspaceId,
      runId,
      node,
      channel,
      payload: outputPayloadForPort(node, channel, payload),
      eventType: "flow_live_manual_input",
      latencyMs: 1,
    });
  }
  await recordFlowAction({
    workspaceId,
    nodeId: node.id,
    message: `Manual input emitted: ${node.label || node.id}`,
    context: { action: "flow-map-manual-input", runId, channels: outputChannels, payloadPreview: compactPayloadPreview(payload, 220) },
  });
  return { channels: outputChannels, payload };
};

const knowledgeDocumentInputChannel = (node = {}) => {
  const config = nodeRuntimeConfig(node);
  return config.inputChannel || config.input || node.inputs?.[0] || nodeChannels(node)[0] || "document";
};

const knowledgeDocumentOutputChannel = (node = {}) => {
  const config = nodeRuntimeConfig(node);
  return config.outputChannel || config.output || node.outputs?.[0] || "knowledge.document.created";
};

const knowledgeDocumentPayloadFromConfig = (node = {}, runId = "") => {
  const config = nodeRuntimeConfig(node);
  const parsed = parseManualJsonPayload(config.json || config.testPayload || config.payload || config.manualJson) || {};
  const documentText = String(
    parsed.document || parsed.text || parsed.content || parsed.body ||
    config.document || config.text || config.content || config.body || ""
  ).trim();
  return {
    ...parsed,
    title: parsed.title || config.title || node.label || "Knowledge Document",
    document: documentText,
    text: documentText,
    mimeType: parsed.mimeType || config.mimeType || "text/plain",
    sourceType: parsed.sourceType || config.sourceType || "live-test",
    collectionId: parsed.collectionId || config.collectionId || "",
    metadata: {
      ...(parsed.metadata && typeof parsed.metadata === "object" ? parsed.metadata : {}),
      ...(config.metadata && typeof config.metadata === "object" ? config.metadata : {}),
      nodeId: node.id || "",
      liveTestRunId: runId,
    },
    __test: true,
    runId,
    emittedAt: new Date().toISOString(),
  };
};

const knowledgeDocumentsForNode = async ({ node = {}, workspaceId = "" } = {}) => {
  const knowledge = window.TrackerLensKnowledgeRuntime;
  const storeName = knowledge?.STORES?.documents || "tl_knowledge_documents";
  const records = knowledge?.listStore
    ? await knowledge.listStore(storeName).catch(() => [])
    : await readKnowledgeRuntimeRecords(storeName);
  return (records || [])
    .filter((document) => (document.workspaceId || "workspace_global") === workspaceId)
    .filter((document) => document.metadata?.nodeId === node.id || document.sourceId === `upload_${node.id}` || document.sourceId === `live_${node.id}` || document.sourceId === node.id)
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || "") - Date.parse(a.updatedAt || a.createdAt || ""));
};

const isKnowledgeDocumentReplayEnabled = (document = {}) => {
  const values = [document?.enabled, document?.metadata?.enabled].filter((value) => value !== undefined && value !== null && value !== "");
  return !values.some((value) => value === false || String(value).toLowerCase() === "false" || String(value) === "0");
};

const knowledgeDocumentReplayAllEnabled = (node = {}) => {
  const config = nodeRuntimeConfig(node);
  return config.replayAllDocuments === true ||
    config.replayAllDocuments === "true" ||
    config.emitAllDocuments === true ||
    config.emitAllDocuments === "true";
};

const knowledgeDocumentDerivedRecords = async ({ workspaceId = "", documentIds = [] } = {}) => {
  const ids = new Set((documentIds || []).filter(Boolean).map(String));
  if (!ids.size) return { chunks: [], embeddings: [], entities: [], relations: [], dictionary: [], sources: [], metrics: [] };
  const knowledge = window.TrackerLensKnowledgeRuntime;
  const stores = knowledge?.STORES || {};
  const read = async (storeName) => {
    if (!storeName) return [];
    return knowledge?.listStore
      ? await knowledge.listStore(storeName).catch(() => [])
      : await readKnowledgeRuntimeRecords(storeName);
  };
  const [chunks, embeddings, entities, relations, dictionary, sources, metrics] = await Promise.all([
    read(stores.chunks || "tl_knowledge_chunks"),
    read(stores.embeddings || "tl_knowledge_embeddings"),
    read(stores.entities || "tl_knowledge_entities"),
    read(stores.relations || "tl_knowledge_relations"),
    read(stores.dictionary || "tl_knowledge_dictionary"),
    read(stores.sources || "tl_knowledge_sources"),
    read(stores.metrics || "tl_knowledge_metrics"),
  ]);
  const byWorkspaceId = (record = {}) => (record.workspaceId || "workspace_global") === workspaceId;
  const scopedChunks = (chunks || []).filter(byWorkspaceId).filter((chunk) => ids.has(chunk.documentId));
  const chunkIds = new Set(scopedChunks.map((chunk) => chunk.id));
  const scopedEntities = (entities || [])
    .filter(byWorkspaceId)
    .filter((entity) => ids.has(entity.documentId) || chunkIds.has(entity.chunkId));
  const entityIds = new Set(scopedEntities.map((entity) => entity.id));
  const scopedEmbeddings = (embeddings || [])
    .filter(byWorkspaceId)
    .filter((embedding) => ids.has(embedding.documentId) || chunkIds.has(embedding.chunkId));
  const scopedRelations = (relations || [])
    .filter(byWorkspaceId)
    .filter((relation) =>
      ids.has(relation.documentId) ||
      chunkIds.has(relation.chunkId) ||
      entityIds.has(relation.sourceEntityId) ||
      entityIds.has(relation.targetEntityId)
    );
  const scopedDictionary = (dictionary || [])
    .filter(byWorkspaceId)
    .filter((entry) => ids.has(entry.documentId) || chunkIds.has(entry.chunkId));
  const scopedSources = (sources || [])
    .filter(byWorkspaceId)
    .filter((source) => ids.has(source.documentId));
  const scopedMetrics = (metrics || [])
    .filter(byWorkspaceId)
    .filter((metric) => ids.has(metric.value?.documentId));
  return {
    chunks: scopedChunks,
    embeddings: scopedEmbeddings,
    entities: scopedEntities,
    relations: scopedRelations,
    dictionary: scopedDictionary,
    sources: scopedSources,
    metrics: scopedMetrics,
  };
};

const deleteKnowledgeDocumentDerivedRecordsForIds = async ({ workspaceId = "", documentIds = [] } = {}) => {
  const knowledge = window.TrackerLensKnowledgeRuntime;
  if (!knowledge?.deleteRecords) return { chunks: 0, embeddings: 0, entities: 0, relations: 0, dictionary: 0, sources: 0, metrics: 0 };
  const stores = knowledge.STORES || {};
  const records = await knowledgeDocumentDerivedRecords({ workspaceId, documentIds });
  await Promise.all([
    knowledge.deleteRecords(stores.relations || "tl_knowledge_relations", records.relations.map((item) => item.id)),
    knowledge.deleteRecords(stores.entities || "tl_knowledge_entities", records.entities.map((item) => item.id)),
    knowledge.deleteRecords(stores.dictionary || "tl_knowledge_dictionary", records.dictionary.map((item) => item.id)),
    knowledge.deleteRecords(stores.embeddings || "tl_knowledge_embeddings", records.embeddings.map((item) => item.id)),
    knowledge.deleteRecords(stores.chunks || "tl_knowledge_chunks", records.chunks.map((item) => item.id)),
    knowledge.deleteRecords(stores.sources || "tl_knowledge_sources", records.sources.map((item) => item.id)),
    knowledge.deleteRecords(stores.metrics || "tl_knowledge_metrics", records.metrics.map((item) => item.id)),
  ]);
  return {
    chunks: records.chunks.length,
    embeddings: records.embeddings.length,
    entities: records.entities.length,
    relations: records.relations.length,
    dictionary: records.dictionary.length,
    sources: records.sources.length,
    metrics: records.metrics.length,
  };
};

const knowledgeDocumentsNeedingReplay = async ({ node = {}, workspaceId = "", documents = [] } = {}) => {
  if (knowledgeDocumentReplayAllEnabled(node)) return documents;
  const ids = documents.map((document) => document.id).filter(Boolean);
  const records = await knowledgeDocumentDerivedRecords({ workspaceId, documentIds: ids });
  const processedIds = new Set([
    ...records.chunks.map((item) => item.documentId),
    ...records.entities.map((item) => item.documentId),
    ...records.relations.map((item) => item.documentId),
    ...records.dictionary.map((item) => item.documentId),
  ].filter(Boolean));
  return documents.filter((document) => !processedIds.has(document.id));
};

const knowledgeReplayPayloadForDocument = ({ document = {}, node = {}, runId = "" } = {}) => ({
  document,
  documentId: document.id,
  title: document.title || node.label || "Knowledge Document",
  text: document.text,
  mimeType: document.mimeType || document.metadata?.mimeType || "text/plain",
  sourceType: "live-test-replay",
  collectionId: document.metadata?.collectionId || nodeRuntimeConfig(node).collectionId || "",
  metadata: {
    ...(document.metadata && typeof document.metadata === "object" ? document.metadata : {}),
    replayedFromDocumentId: document.id || "",
    liveTestRunId: runId,
  },
  __test: true,
  runId,
  emittedAt: new Date().toISOString(),
});

const executeKnowledgeDocumentNode = async ({ node, workspaceId, runId } = {}) => {
  const storedDocuments = (await knowledgeDocumentsForNode({ node, workspaceId })).filter((document) => document?.id && document?.text);
  const enabledDocuments = storedDocuments.filter(isKnowledgeDocumentReplayEnabled);
  const disabledDocuments = storedDocuments.filter((document) => !isKnowledgeDocumentReplayEnabled(document));
  const disabledCleanup = await deleteKnowledgeDocumentDerivedRecordsForIds({
    workspaceId,
    documentIds: disabledDocuments.map((document) => document.id),
  });
  const replayDocuments = await knowledgeDocumentsNeedingReplay({ node, workspaceId, documents: enabledDocuments });
  const hasStoredDocument = Boolean(storedDocuments.length);
  if (hasStoredDocument && !enabledDocuments.length) {
    throw new Error(`${node.label || node.id} non ha documenti abilitati da rilanciare. Abilita almeno un documento.`);
  }
  if (hasStoredDocument && !replayDocuments.length) {
    await recordFlowAction({
      workspaceId,
      nodeId: node.id,
      message: `Knowledge document replay skipped: ${node.label || node.id}`,
      context: {
        action: "flow-map-knowledge-document-live-test-skipped",
        runId,
        reason: "enabled-documents-already-processed",
        enabledDocumentIds: enabledDocuments.map((document) => document.id),
        disabledDocumentIds: disabledDocuments.map((document) => document.id),
        disabledCleanup,
      },
    });
    return { channels: [], payload: { skipped: true, reason: "enabled-documents-already-processed", count: 0 } };
  }
  const payloads = hasStoredDocument
    ? replayDocuments.map((document) => knowledgeReplayPayloadForDocument({ document, node, runId }))
    : [knowledgeDocumentPayloadFromConfig(node, runId)];
  const primaryPayload = payloads[0] || {};
  if (!String(primaryPayload.documentId || primaryPayload.text || primaryPayload.document || "").trim()) {
    throw new Error(hasStoredDocument
      ? `${node.label || node.id} non ha documenti abilitati da rilanciare. Abilita almeno un documento o inserisci document/text nel Config.`
      : `${node.label || node.id} non ha un documento da rilanciare. Usa Upload Document o inserisci document/text nel Config.`);
  }
  const channel = enabledDocuments.length ? knowledgeDocumentOutputChannel(node) : knowledgeDocumentInputChannel(node);
  const eventType = enabledDocuments.length ? "flow_live_knowledge_document_replay" : "flow_live_knowledge_document";
  const sourceNodeId = enabledDocuments.length ? node.id : `live_${node.id}`;
  const bus = workspaceEventBus(workspaceId);
  const emittedEvents = [];
  for (const [index, payload] of payloads.entries()) {
    const event = bus?.emit
      ? await bus.emit(channel, payload, {
        workspaceId,
        flowId: flowIdForWorkspace(workspaceId),
        eventType,
        sourceNodeId,
        targetNodeId: enabledDocuments.length ? "" : node.id,
        status: "ok",
        latencyMs: 1,
        meta: {
          live: true,
          runId,
          origin: "live-test",
          rootNodeId: node.id,
          replayIndex: index,
          replayCount: payloads.length,
        },
      })
      : await mergeTestEvent({
        workspaceId,
        channel,
        eventType,
        sourceNodeId,
        targetNodeId: enabledDocuments.length ? "" : node.id,
        payload,
        status: "ok",
        latencyMs: 1,
        meta: {
          live: true,
          runId,
          origin: "live-test",
          rootNodeId: node.id,
          replayIndex: index,
          replayCount: payloads.length,
        },
      });
    if (event) {
      emittedEvents.push(event);
      mergeRuntimeEvent(event);
    }
  }
  await recordFlowAction({
    workspaceId,
    nodeId: node.id,
    message: `Knowledge document live test: ${node.label || node.id}`,
    context: {
      action: "flow-map-knowledge-document-live-test",
      runId,
      channel,
      replayedDocumentIds: replayDocuments.map((document) => document.id),
      skippedProcessedDocumentIds: enabledDocuments.filter((document) => !replayDocuments.some((item) => item.id === document.id)).map((document) => document.id),
      replayAllDocuments: knowledgeDocumentReplayAllEnabled(node),
      disabledDocumentCount: Math.max(0, storedDocuments.length - enabledDocuments.length),
      disabledCleanup,
      emittedCount: emittedEvents.length,
      payloadPreview: compactPayloadPreview(primaryPayload, 220),
    },
  });
  return { channels: [channel], payload: payloads.length === 1 ? primaryPayload : { documents: payloads, count: payloads.length } };
};

const executeCustomFormNode = async ({ node, workspaceId, runId, graph } = {}) => {
  const config = nodeConfigObject(node);
  const fields = customNodeDataFields(node);
  const values = Object.fromEntries(fields.map((field) => [field.key, customConfigValue(config, field)]));
  const payload = {
    live: true,
    runId,
    nodeId: node.id,
    title: node.label || node.title || node.id,
    type: "custom-form",
    data: values,
    fields: fields.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      component: field.component,
    })),
    emittedAt: new Date().toISOString(),
  };
  const channels = nodeOutgoingTestChannels(node, graph);
  const outputChannels = channels.length ? channels : ["output"];
  for (const channel of outputChannels) {
    await emitLiveNodePayload({
      workspaceId,
      runId,
      node,
      channel,
      payload: outputPayloadForPort(node, channel, payload, { formData: values }),
      eventType: "flow_live_custom_form",
      latencyMs: 1,
    });
  }
  await recordFlowAction({
    workspaceId,
    nodeId: node.id,
    message: `Custom form emitted: ${node.label || node.id}`,
    context: {
      action: "flow-map-custom-form-input",
      runId,
      channels: outputChannels,
      fields: fields.map((field) => field.key),
      payloadPreview: compactPayloadPreview(payload, 220),
    },
  });
  return { channels: outputChannels, payload };
};

const aiDirectInputChannel = (node = {}, graph = graphModel()) => {
  const config = nodeRuntimeConfig(node);
  const incoming = (graph.dependencies || [])
    .filter((dependency) => dependency.targetNodeId === node.id)
    .map((dependency) => dependency.channel || dependency.metadata?.targetPort)
    .filter(Boolean);
  return incoming[0] || config.input || node.inputs?.[0] || nodeChannels(node)[0] || "input";
};

const executeDirectAiAgentNode = async ({ node, workspaceId, runId, graph } = {}) => {
  const channel = aiDirectInputChannel(node, graph);
  const payload = nodeTestPayload(node, runId);
  const bus = workspaceEventBus(workspaceId);
  const event = await bus?.emit?.(channel, payload, {
    workspaceId,
    flowId: flowIdForWorkspace(workspaceId),
    eventType: "flow_live_ai_direct",
    sourceNodeId: "flow-map-ai-direct-test",
    targetNodeId: node.id,
    latencyMs: 1,
    meta: {
      live: true,
      runId,
      origin: "ai-direct-test",
      targetNodeId: node.id,
      inputChannel: channel,
      flowMapDirectAiExecution: true,
    },
  });
  if (event) mergeRuntimeEvent(event);
  let result = null;
  let outputChannel = node.outputs?.[0] || node.channels?.find((item) => item !== channel) || `ai.${nodeSubtype(node) || "agent"}.output`;
  try {
    const runtime = window.TrackerLensAiAgentRuntime?.get?.(workspaceId);
    if (runtime?.execute) {
      result = await runtime.execute({
        node,
        payload,
        event: event || {
          channel,
          payload,
          meta: { runId },
          sourceNodeId: "flow-map-ai-direct-test",
          targetNodeId: node.id,
        },
      });
      const latencyMs = Number(result?.latencyMs || 0);
      const responseEvent = await bus?.emit?.(outputChannel, result, {
        workspaceId,
        flowId: flowIdForWorkspace(workspaceId),
        eventType: "ai_agent_response",
        sourceNodeId: node.id,
        latencyMs,
        meta: {
          aiAgentRuntime: node.id,
          inputEventId: event?.id || "",
          inputChannel: channel,
          runId,
          provider: result?.provider || "",
          model: result?.model || "",
          flowMapDirectAiExecution: true,
        },
      });
      if (responseEvent) mergeRuntimeEvent(responseEvent);
      await recordFlowAction({
        workspaceId,
        nodeId: node.id,
        message: `Direct AI Agent emitted ${outputChannel}: ${node.label || node.id}`,
        context: {
          action: "flow-map-ai-direct-response",
          runId,
          inputChannel: channel,
          outputChannel,
          provider: result?.provider || "",
          model: result?.model || "",
          payloadPreview: compactPayloadPreview(result, 220),
        },
      });
    }
  } catch (error) {
    await recordFlowAction({
      workspaceId,
      nodeId: node.id,
      level: "error",
      message: `Direct AI Agent error: ${error.message || error}`,
      context: { action: "flow-map-ai-direct-error", runId, inputChannel: channel, outputChannel, error: error.message || String(error) },
    });
    throw error;
  }
  await recordFlowAction({
    workspaceId,
    nodeId: node.id,
    message: `Direct AI Agent test started: ${node.label || node.id}`,
    context: { action: "flow-map-ai-direct-test", runId, inputChannel: channel, payloadPreview: compactPayloadPreview(payload, 220) },
  });
  return { channels: [channel, outputChannel].filter(Boolean), payload: result || payload };
};

const executeDirectOrchestratorAgentNode = async ({ node, workspaceId, runId, graph } = {}) => {
  const channel = aiDirectInputChannel(node, graph);
  const payload = nodeTestPayload(node, runId);
  const bus = workspaceEventBus(workspaceId);
  const event = await bus?.emit?.(channel, payload, {
    workspaceId,
    flowId: flowIdForWorkspace(workspaceId),
    eventType: "flow_live_orchestrator_direct",
    sourceNodeId: "flow-map-orchestrator-direct-test",
    targetNodeId: node.id,
    latencyMs: 1,
    meta: {
      live: true,
      runId,
      origin: "orchestrator-direct-test",
      targetNodeId: node.id,
      inputChannel: channel,
      flowMapDirectOrchestratorExecution: true,
    },
  });
  if (event) mergeRuntimeEvent(event);
  const runtime = window.TrackerLensOrchestratorAgentRuntime?.get?.(workspaceId);
  if (!runtime?.execute) return { channels: [channel], result: null };
  const result = await runtime.execute({
    node,
    payload,
    event: event || {
      channel,
      payload,
      meta: { runId },
      sourceNodeId: "flow-map-orchestrator-direct-test",
      targetNodeId: node.id,
    },
    runtime: graph,
  });
  await recordFlowAction({
    workspaceId,
    nodeId: node.id,
    message: `Direct Orchestrator executed: ${node.label || node.id}`,
    context: {
      action: "flow-map-orchestrator-direct-response",
      runId,
      inputChannel: channel,
      decision: result?.decision || "",
      missionStatus: result?.status || "",
      missionIterations: Array.isArray(result?.iterations) ? result.iterations.length : 0,
      emitted: result?.emitted || [],
      skipped: result?.skipped || [],
    },
  });
  return {
    channels: [channel, ...(result?.emitted || []).map((item) => item.channel).filter(Boolean)],
    result,
  };
};

const downstreamTestPath = (graph = {}, starterIds = []) => {
  const nodesById = new Map((graph.nodes || []).map((node) => [node.id, node]));
  const bySource = new Map();
  (graph.dependencies || []).forEach((dependency) => {
    if (!dependency.sourceNodeId || !dependency.targetNodeId) return;
    if (!bySource.has(dependency.sourceNodeId)) bySource.set(dependency.sourceNodeId, []);
    bySource.get(dependency.sourceNodeId).push(dependency);
  });

  const queue = starterIds.filter((id) => nodesById.has(id));
  const visitedNodes = new Set(queue);
  const visitedEdges = new Set();
  const edges = [];
  while (queue.length && visitedNodes.size < 500 && edges.length < 1000) {
    const sourceId = queue.shift();
    (bySource.get(sourceId) || []).forEach((dependency) => {
      if (visitedEdges.has(dependency.id)) return;
      visitedEdges.add(dependency.id);
      edges.push(dependency);
      if (!visitedNodes.has(dependency.targetNodeId)) {
        visitedNodes.add(dependency.targetNodeId);
        queue.push(dependency.targetNodeId);
      }
    });
  }
  return { nodeIds: [...visitedNodes], edgeIds: [...visitedEdges], edges };
};

const activeOutgoingDependencyIds = (graph = {}, nodeIds = []) => {
  const ids = new Set(nodeIds.filter(Boolean));
  return (graph.dependencies || [])
    .filter((dependency) => ids.has(dependency.sourceNodeId))
    .map((dependency) => dependency.id);
};

const setTestRunActiveNodes = (graph = {}, nodeIds = []) => {
  state.testRun = {
    ...state.testRun,
    activeNodeIds: nodeIds.filter(Boolean),
    activeEdgeIds: activeOutgoingDependencyIds(graph, nodeIds),
  };
  refreshLiveGraphState();
};

const clearTestRunActiveNodes = () => {
  state.testRun = {
    ...state.testRun,
    activeNodeIds: [],
    activeEdgeIds: [],
  };
  refreshLiveGraphState();
};

const mergeTestEvent = async (event = {}) => {
  const nextEvent = {
    id: event.id || `event_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    workspaceId: event.workspaceId || state.filters.workspaceId || "workspace_global",
    flowId: event.flowId || flowIdForWorkspace(event.workspaceId || state.filters.workspaceId || "workspace_global"),
    channel: event.channel || "default",
    eventType: event.eventType || "flow_test_pulse",
    sourceNodeId: event.sourceNodeId || "",
    targetNodeId: event.targetNodeId || "",
    connectionId: event.connectionId || "",
    payload: event.payload || {},
    status: event.status || "ok",
    latencyMs: Number(event.latencyMs) || 0,
    createdAt: event.createdAt || new Date().toISOString(),
    meta: {
      test: true,
      ...(event.meta || {}),
    },
  };
  mergeRuntimeEvent(nextEvent);
  const persistEvent = window.TrackerLensEventLogStore?.recordEvent
    ? window.TrackerLensEventLogStore.recordEvent({
      id: nextEvent.id,
      workspaceId: nextEvent.workspaceId,
      flowId: nextEvent.flowId,
      channel: nextEvent.channel,
      eventType: nextEvent.eventType,
      sourceNodeId: nextEvent.sourceNodeId,
      targetNodeId: nextEvent.targetNodeId,
      connectionId: nextEvent.connectionId,
      payload: nextEvent.payload,
      status: nextEvent.status,
      latencyMs: nextEvent.latencyMs,
    }).catch(() => null)
    : Promise.resolve(null);
  const persistChannel = window.TrackerLensChannelRegistry?.recordEmission
    ? window.TrackerLensChannelRegistry.recordEmission({
      workspaceId: nextEvent.workspaceId,
      channel: nextEvent.channel,
      sourceNodeId: nextEvent.sourceNodeId,
      payload: nextEvent.payload,
      emittedAt: nextEvent.createdAt,
    }).catch(() => null)
    : Promise.resolve(null);
  await Promise.all([
    persistEvent,
    persistChannel,
  ]);
  return nextEvent;
};

const emitLiveNodePayload = async ({ workspaceId, runId, node, channel, payload, eventType = "flow_live_root", status = "ok", latencyMs = 0 } = {}) => {
  const bus = workspaceEventBus(workspaceId);
  const meta = { live: true, runId, origin: "live-test", rootNodeId: node.id };
  const event = bus?.emit
    ? await bus.emit(channel || "default", payload || {}, {
      workspaceId,
      flowId: flowIdForWorkspace(workspaceId),
      eventType,
      sourceNodeId: node.id,
      status,
      latencyMs,
      meta,
    })
    : await mergeTestEvent({
      workspaceId,
      channel,
      eventType,
      sourceNodeId: node.id,
      payload,
      status,
      latencyMs,
      meta,
    });
  mergeRuntimeEvent(event);
  return event;
};

const emitLiveDependencyPulse = async ({ workspaceId, runId, graph, dependency } = {}) => {
  const source = graph.nodes.find((node) => node.id === dependency.sourceNodeId);
  const target = graph.nodes.find((node) => node.id === dependency.targetNodeId);
  return mergeTestEvent({
    workspaceId,
    channel: dependency.channel || dependencyPort(dependency, "out") || "default",
    eventType: "flow_live_pulse",
    sourceNodeId: dependency.sourceNodeId,
    targetNodeId: dependency.targetNodeId,
    connectionId: dependency.connectionId || dependency.id,
    payload: {
      live: true,
      runId,
      route: `${source?.label || dependency.sourceNodeId} -> ${target?.label || dependency.targetNodeId}`,
      channel: dependency.channel || "default",
    },
    latencyMs: 1,
    meta: { live: true, runId, origin: "live-test", dependencyId: dependency.id },
  });
};

const replayRuntimeEvent = async (event = {}) => {
  const graph = graphModel();
  const selected = selectedNode();
  const sourceNodeId = event.sourceNodeId || selected?.id || "";
  const sourceNode = graph.nodes.find((node) => node.id === sourceNodeId) || selected;
  if (!sourceNode?.id) return;

  const workspaceId = event.workspaceId || sourceNode.workspaceId || state.filters.workspaceId || "workspace_global";
  const channel = event.channel || nodeOutgoingTestChannels(sourceNode, graph)[0] || "default";
  const payload = event.originalPayload !== undefined && event.originalPayload !== null
    ? event.originalPayload
    : event.payload === undefined ? {} : event.payload;
  const runId = testRunId().replace("flow_test", "flow_replay");
  const path = downstreamTestPath(graph, [sourceNode.id]);

  state.testRun = {
    ...state.testRun,
    running: true,
    runId,
    nodeIds: path.nodeIds,
    edgeIds: path.edgeIds,
    activeNodeIds: [sourceNode.id],
    activeEdgeIds: activeOutgoingDependencyIds(graph, [sourceNode.id]),
    startedAt: new Date().toISOString(),
    completedAt: "",
    summary: "Replaying inspector event...",
    timeoutId: 0,
    abortController: null,
    liveSockets: [],
    keepOpen: false,
    cancelRequested: false,
    verification: null,
  };
  setFiltersState({ ...state.filters, runId });
  mount();

  try {
    const bus = workspaceEventBus(workspaceId);
    const meta = {
      debug: true,
      replay: true,
      runId,
      origin: "inspector-replay",
      replayEventId: event.id || "",
      rootNodeId: sourceNode.id,
    };
    const replayed = bus?.emit
      ? await bus.emit(channel, payload, {
        workspaceId,
        flowId: flowIdForWorkspace(workspaceId),
        eventType: "flow_replay",
        sourceNodeId: sourceNode.id,
        status: "ok",
        latencyMs: 0,
        meta,
      })
      : await mergeTestEvent({
        workspaceId,
        channel,
        eventType: "flow_replay",
        sourceNodeId: sourceNode.id,
        payload,
        status: "ok",
        latencyMs: 0,
        meta,
      });
    mergeRuntimeEvent(replayed);

    for (const dependency of path.edges) {
      await mergeTestEvent({
        workspaceId,
        channel: dependency.channel || dependencyPort(dependency, "out") || channel,
        eventType: "flow_replay_pulse",
        sourceNodeId: dependency.sourceNodeId,
        targetNodeId: dependency.targetNodeId,
        connectionId: dependency.connectionId || dependency.id,
        payload,
        latencyMs: 1,
        meta: {
          debug: true,
          replay: true,
          runId,
          origin: "inspector-replay",
          dependencyId: dependency.id,
          replayEventId: event.id || "",
        },
      });
    }

    await recordFlowAction({
      workspaceId,
      nodeId: sourceNode.id,
      level: "info",
      message: `Runtime event replayed: ${sourceNode.label || sourceNode.id}`,
      context: {
        action: "flow-map-event-replay",
        runId,
        channel,
        sourceNodeId: sourceNode.id,
        replayEventId: event.id || "",
        downstreamEdges: path.edgeIds.length,
        payloadPreview: compactPayloadPreview(payload, 220),
      },
    });
    state.testRun.timeoutId = window.setTimeout(() => {
      finishFlowMapTestRun({ runId, summary: `Replay completed · ${path.edgeIds.length} routes` });
      mount();
    }, 3200);
  } catch (error) {
    state.error = error?.message || "Replay evento fallito";
    finishFlowMapTestRun({ runId, summary: "Replay error", error: state.error });
    await recordFlowAction({
      workspaceId,
      nodeId: sourceNode.id,
      level: "error",
      message: `Runtime event replay failed: ${sourceNode.label || sourceNode.id}`,
      context: { action: "flow-map-event-replay-error", runId, error: error?.message || String(error) },
    });
    mount();
  }
};

const registerLiveSocket = ({ runId = "", nodeId = "", socket = null, endpoint = "" } = {}) => {
  if (!socket) return;
  state.testRun.liveSockets = [
    ...(state.testRun.liveSockets || []),
    { runId, nodeId, socket, endpoint },
  ];
};

const unregisterLiveSocket = (socket = null) => {
  state.testRun.liveSockets = (state.testRun.liveSockets || []).filter((item) => item.socket !== socket);
};

const closeLiveSockets = () => {
  (state.testRun.liveSockets || []).forEach(({ socket }) => {
    try {
      if (socket && socket.readyState <= WebSocket.OPEN) socket.close(1000, "Flow Map test stopped");
    } catch (_) {
      // Browser WebSocket implementations can throw while closing a transient socket.
    }
  });
  state.testRun.liveSockets = [];
};

const classifyFetchRuntimeError = (error = {}) => {
  const name = String(error?.name || "");
  if (name === "AbortError") return "abort";
  if (name === "TypeError") return "network-or-cors";
  return "fetch-error";
};

const fetchErrorDiagnostic = (kind = "") =>
  kind === "network-or-cors"
    ? "Browser fetch did not expose an HTTP status. Check URL, DNS, TLS, CORS policy, mixed content or blocked request in DevTools Network."
    : kind === "abort"
      ? "Request was cancelled or timed out before an HTTP response was available."
      : "Fetch failed before a readable HTTP response was available.";

const executeLiveRestNode = async ({ node, workspaceId, runId, graph, signal = null } = {}) => {
  const config = nodeRuntimeConfig(node);
  const endpoint = nodeEndpoint(node);
  if (!endpoint) throw new Error(`${node.label || node.id}: endpoint mancante`);
  const method = String(config.method || "GET").toUpperCase();
  const headers = { Accept: "application/json", ...parseObjectPayload(config.headers) };
  const requestEndpoint = endpointWithQueryParams(endpoint, parseObjectPayload(config.queryParams || config.params));
  const bodyPayload = parseTestPayload(config.requestBody || config.body || config.testPayload || config.payload);
  const init = { method, headers, ...(signal ? { signal } : {}) };
  if (method !== "GET" && bodyPayload) {
    if (!headers["Content-Type"] && !headers["content-type"]) headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(bodyPayload);
  }
  const started = performance.now();
  await recordFlowAction({
    workspaceId,
    nodeId: node.id,
    level: "info",
    message: `Live REST test connecting ${requestEndpoint}`,
    context: { action: "flow-map-live-rest-start", runId, endpoint: requestEndpoint, method },
  });
  let response;
  try {
    response = await fetch(requestEndpoint, init);
  } catch (error) {
    const errorKind = classifyFetchRuntimeError(error);
    error.runtimeRequest = {
      type: "fetch",
      errorKind,
      errorName: error?.name || "",
      diagnostic: fetchErrorDiagnostic(errorKind),
      nodeId: node.id,
      nodeLabel: node.label || node.id,
      requestUrl: requestEndpoint,
      endpoint: requestEndpoint,
      method,
      status: null,
    };
    throw error;
  }
  const text = await response.text();
  const payload = {
    live: true,
    runId,
    status: response.status,
    ok: response.ok,
    endpoint: requestEndpoint,
    method,
    data: parseResponsePayload(text),
    receivedAt: new Date().toISOString(),
  };
  const latencyMs = Math.max(1, Math.round(performance.now() - started));
  const channels = nodeOutgoingTestChannels(node, graph);
  for (const channel of (channels.length ? channels : ["raw"])) {
    await emitLiveNodePayload({ workspaceId, runId, node, channel, payload: outputPayloadForPort(node, channel, payload), latencyMs, status: response.ok ? "ok" : "error" });
  }
  await recordFlowAction({
    workspaceId,
    nodeId: node.id,
    level: response.ok ? "info" : "error",
    message: `Live REST test ${response.status} from ${node.label || node.id}`,
    context: {
      action: "flow-map-live-rest-response",
      runId,
      endpoint: requestEndpoint,
      requestUrl: requestEndpoint,
      method,
      status: response.status,
      statusText: response.statusText || "",
      errorKind: response.ok ? "" : "http",
      channels,
    },
  });
  return { channels, payload };
};

const parseRssPayload = (text = "") => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(String(text || ""), "application/xml");
  if (doc.querySelector("parsererror")) return { raw: text };
  const pick = (root, selector) => root.querySelector(selector)?.textContent?.trim() || "";
  const entries = [...doc.querySelectorAll("item, entry")].slice(0, 30).map((entry) => ({
    title: pick(entry, "title"),
    link: entry.querySelector("link")?.getAttribute?.("href") || pick(entry, "link"),
    summary: pick(entry, "description") || pick(entry, "summary") || pick(entry, "content"),
    publishedAt: pick(entry, "pubDate") || pick(entry, "published") || pick(entry, "updated"),
    id: pick(entry, "guid") || pick(entry, "id"),
  }));
  return {
    title: pick(doc, "channel > title") || pick(doc, "feed > title") || pick(doc, "title"),
    link: pick(doc, "channel > link") || doc.querySelector("feed > link")?.getAttribute?.("href") || "",
    entries,
  };
};

const executeLiveRssNode = async ({ node, workspaceId, runId, graph, signal = null } = {}) => {
  const endpoint = nodeEndpoint(node);
  if (!endpoint) throw new Error(`${node.label || node.id}: RSS URL mancante`);
  const started = performance.now();
  await recordFlowAction({
    workspaceId,
    nodeId: node.id,
    level: "info",
    message: `Live RSS test fetching ${endpoint}`,
    context: { action: "flow-map-live-rss-start", runId, endpoint },
  });
  let response;
  try {
    response = await fetch(endpoint, {
      method: "GET",
      headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    const errorKind = classifyFetchRuntimeError(error);
    error.runtimeRequest = {
      type: "fetch",
      errorKind,
      errorName: error?.name || "",
      diagnostic: fetchErrorDiagnostic(errorKind),
      nodeId: node.id,
      nodeLabel: node.label || node.id,
      requestUrl: endpoint,
      endpoint,
      method: "GET",
      status: null,
    };
    throw error;
  }
  const text = await response.text();
  const payload = {
    live: true,
    runId,
    status: response.status,
    ok: response.ok,
    endpoint,
    type: "rss",
    data: parseRssPayload(text),
    receivedAt: new Date().toISOString(),
  };
  const latencyMs = Math.max(1, Math.round(performance.now() - started));
  const channels = nodeOutgoingTestChannels(node, graph);
  const outputChannels = channels.length ? channels : ["raw"];
  for (const channel of outputChannels) {
    await emitLiveNodePayload({ workspaceId, runId, node, channel, payload: outputPayloadForPort(node, channel, payload), latencyMs, status: response.ok ? "ok" : "error" });
  }
  await recordFlowAction({
    workspaceId,
    nodeId: node.id,
    level: response.ok ? "info" : "error",
    message: `Live RSS test ${response.status} from ${node.label || node.id}`,
    context: {
      action: "flow-map-live-rss-response",
      runId,
      endpoint,
      requestUrl: endpoint,
      method: "GET",
      status: response.status,
      statusText: response.statusText || "",
      errorKind: response.ok ? "" : "http",
      channels: outputChannels,
      items: payload.data?.entries?.length || 0,
    },
  });
  return { channels: outputChannels, payload };
};

const executeLiveWebSocketNode = ({ node, workspaceId, runId, graph, signal = null }) =>
  new Promise((resolve, reject) => {
    const endpoint = nodeEndpoint(node);
    if (!endpoint) {
      reject(new Error(`${node.label || node.id}: WebSocket URL mancante`));
      return;
    }
    if (signal?.aborted) {
      reject(new DOMException("Flow Map live test cancelled", "AbortError"));
      return;
    }
    const channels = nodeOutgoingTestChannels(node, graph);
    const outputChannels = channels.length ? channels : ["raw"];
    const keepOpen = isLiveKeepOpenNode(node);
    const started = performance.now();
    let settled = false;
    let socket = null;
    let timeout = 0;
    const settle = (callback, value, closeSocket = true) => {
      if (settled) return;
      settled = true;
      if (timeout) window.clearTimeout(timeout);
      if (socket) unregisterLiveSocket(socket);
      try {
        if (closeSocket && socket && socket.readyState <= WebSocket.OPEN) socket.close();
      } catch (_) {
        // Closing a test socket can fail in edge browser states.
      }
      callback(value);
    };
    const cancelWebSocket = () => {
      recordFlowAction({
        workspaceId,
        nodeId: node.id,
        level: "warning",
        message: `Live WebSocket stopped ${node.label || node.id}`,
        context: { action: "flow-map-live-websocket-stopped", runId, endpoint, keepOpen },
      });
      settle(resolve, { channels: outputChannels, payload: null, stopped: true });
    };

    if (!keepOpen) {
      timeout = window.setTimeout(() => {
        recordFlowAction({
          workspaceId,
          nodeId: node.id,
          level: "warning",
          message: `Live WebSocket test timeout from ${node.label || node.id}`,
          context: { action: "flow-map-live-websocket-timeout", runId, endpoint },
        });
        settle(reject, new Error(`WebSocket timeout dopo ${LIVE_TEST_TIMEOUT_MS / 1000}s`));
      }, LIVE_TEST_TIMEOUT_MS);
    }

    recordFlowAction({
      workspaceId,
      nodeId: node.id,
      level: "info",
      message: `Live WebSocket test connecting ${endpoint}`,
      context: { action: "flow-map-live-websocket-start", runId, endpoint, keepOpen },
    });

    try {
      socket = new WebSocket(endpoint);
      registerLiveSocket({ runId, nodeId: node.id, socket, endpoint });
    } catch (error) {
      settle(reject, error);
      return;
    }

    signal?.addEventListener?.("abort", cancelWebSocket, { once: true });

    socket.onopen = () => {
      recordFlowAction({
        workspaceId,
        nodeId: node.id,
        level: "info",
        message: `Live WebSocket opened ${node.label || node.id}`,
        context: { action: "flow-map-live-websocket-open", runId, endpoint, keepOpen },
      });
    };
    socket.onmessage = async (message) => {
      try {
        if (signal?.aborted) {
          cancelWebSocket();
          return;
        }
        const payload = {
          live: true,
          runId,
          endpoint,
          data: parseResponsePayload(message.data),
          receivedAt: new Date().toISOString(),
        };
        const latencyMs = Math.max(1, Math.round(performance.now() - started));
        for (const channel of outputChannels) {
          await emitLiveNodePayload({ workspaceId, runId, node, channel, payload: outputPayloadForPort(node, channel, payload), latencyMs });
        }
        await recordFlowAction({
          workspaceId,
          nodeId: node.id,
          level: "info",
          message: `Live WebSocket message from ${node.label || node.id}`,
          context: { action: "flow-map-live-websocket-message", runId, endpoint, channels: outputChannels, keepOpen, payloadPreview: payload },
        });
        if (!keepOpen) settle(resolve, { channels: outputChannels, payload });
      } catch (error) {
        settle(reject, error);
      }
    };
    socket.onerror = () => {
      recordFlowAction({
        workspaceId,
        nodeId: node.id,
        level: "error",
        message: `Live WebSocket error from ${node.label || node.id}`,
        context: { action: "flow-map-live-websocket-error", runId, endpoint },
      });
      settle(reject, new Error(`Errore WebSocket ${endpoint}`));
    };
    socket.onclose = (event) => {
      unregisterLiveSocket(socket);
      if (settled) return;
      recordFlowAction({
        workspaceId,
        nodeId: node.id,
        level: state.testRun.cancelRequested ? "warning" : "info",
        message: `Live WebSocket closed ${node.label || node.id}`,
        context: { action: "flow-map-live-websocket-close", runId, endpoint, code: event.code, reason: event.reason || "", keepOpen },
      });
      if (keepOpen || state.testRun.cancelRequested) settle(resolve, { channels: outputChannels, payload: null, closed: true }, false);
    };
  });

const executeLiveNode = async ({ node, workspaceId, runId, graph, signal = null } = {}) => {
  if (isManualInputSource(node)) {
    return executeManualInputNode({ node, workspaceId, runId, graph, signal });
  }
  if (isKnowledgeDocumentStarterNode(node)) {
    return executeKnowledgeDocumentNode({ node, workspaceId, runId, graph, signal });
  }
  if (isCustomFormSourceNode(node)) {
    return executeCustomFormNode({ node, workspaceId, runId, graph, signal });
  }
  const endpoint = nodeEndpoint(node);
  const subtype = customNetworkRuntimeKind(node) || nodeSubtype(node);
  if (subtype === "rss") {
    return executeLiveRssNode({ node, workspaceId, runId, graph, signal });
  }
  if (isWebSocketEndpoint(endpoint) || subtype === "websocket") {
    return executeLiveWebSocketNode({ node, workspaceId, runId, graph, signal });
  }
  return executeLiveRestNode({ node, workspaceId, runId, graph, signal });
};

const clearTestRunTimeout = () => {
  if (!state.testRun.timeoutId) return;
  window.clearTimeout(state.testRun.timeoutId);
  state.testRun.timeoutId = 0;
};

const finishFlowMapTestRun = ({ runId = state.testRun.runId, summary = "", error = "" } = {}) => {
  if (runId && state.testRun.runId && runId !== state.testRun.runId) return false;
  clearTestRunTimeout();
  closeLiveSockets();
  state.testRun = {
    ...state.testRun,
    running: false,
    nodeIds: [],
    edgeIds: [],
    activeNodeIds: [],
    activeEdgeIds: [],
    completedAt: new Date().toISOString(),
    summary: summary || state.testRun.summary || "Test completed",
    timeoutId: 0,
    abortController: null,
    liveSockets: [],
    keepOpen: false,
    cancelRequested: false,
    verification: state.testRun.verification || null,
  };
  if (error) state.error = error;
  if (typeof scheduleRuntimeDomRefresh === "function") scheduleRuntimeDomRefresh({ preserveScroll: true });
  if (state.mounted && typeof mount === "function") {
    window.setTimeout?.(() => mount({ preserveScroll: true }), 0);
  }
  return true;
};

const wait = (ms = 0) => new Promise((resolve) => window.setTimeout(resolve, ms));

const waitForMinimumTestAnimation = async (startedAt = "") => {
  const started = Date.parse(startedAt || "");
  if (!Number.isFinite(started)) return;
  const remaining = MIN_TEST_ANIMATION_MS - (Date.now() - started);
  if (remaining > 0) await wait(remaining);
};

const readStorageRuntimeRecords = async (storeName = "tl_history") => {
  if (!window.indexedDB) return [];
  return new Promise((resolve) => {
    const request = indexedDB.open("TrackersLens");
    request.onerror = () => resolve([]);
    request.onsuccess = (event) => {
      const db = event.target.result;
      try {
        if (!db.objectStoreNames.contains(storeName)) {
          db.close();
          resolve([]);
          return;
        }
        const read = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
        read.onsuccess = () => {
          db.close();
          resolve(Array.isArray(read.result) ? read.result : []);
        };
        read.onerror = () => {
          db.close();
          resolve([]);
        };
      } catch (_) {
        db.close();
        resolve([]);
      }
    };
  });
};

const waitForStorageRuntimeRecord = async ({ storeName = "tl_history", nodeId = "", runId = "", timeoutMs = 3000 } = {}) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const records = await readStorageRuntimeRecords(storeName);
    const record = records
      .filter((item) => (!nodeId || item.nodeId === nodeId) && (!runId || item.payload?.runId === runId))
      .sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""))[0];
    if (record) return record;
    await wait(120);
  }
  return null;
};

const readKnowledgeRuntimeRecords = async (storeName = "tl_knowledge_queries") => {
  if (!window.indexedDB) return [];
  return new Promise((resolve) => {
    const request = indexedDB.open("TrackersLens");
    request.onerror = () => resolve([]);
    request.onsuccess = (event) => {
      const db = event.target.result;
      try {
        if (!db.objectStoreNames.contains(storeName)) {
          db.close();
          resolve([]);
          return;
        }
        const read = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
        read.onsuccess = () => {
          db.close();
          resolve(Array.isArray(read.result) ? read.result : []);
        };
        read.onerror = () => {
          db.close();
          resolve([]);
        };
      } catch (_) {
        db.close();
        resolve([]);
      }
    };
  });
};

const waitForKnowledgeQueryRecord = async ({ workspaceId = "", query = "", timeoutMs = 4000 } = {}) => {
  const storeName = window.TrackerLensKnowledgeRuntime?.STORES?.queries || "tl_knowledge_queries";
  const started = Date.now();
  const expected = String(query || "").trim().toLowerCase();
  while (Date.now() - started < timeoutMs) {
    const records = await readKnowledgeRuntimeRecords(storeName);
    const record = records
      .filter((item) => (!workspaceId || item.workspaceId === workspaceId) && (!expected || String(item.query || "").toLowerCase() === expected))
      .sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""))[0];
    if (record) return record;
    await wait(140);
  }
  return null;
};

const waitForKnowledgeEmbeddingRecord = async ({ workspaceId = "", title = "Knowledge Sample Profile", timeoutMs = 4000 } = {}) => {
  const knowledge = window.TrackerLensKnowledgeRuntime;
  const stores = knowledge?.STORES || {};
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const [chunks, embeddings] = await Promise.all([
      knowledge?.listStore?.(stores.chunks || "tl_knowledge_chunks").catch(() => []),
      knowledge?.listStore?.(stores.embeddings || "tl_knowledge_embeddings").catch(() => []),
    ]);
    const sampleChunkIds = new Set((chunks || [])
      .filter((item) => (!workspaceId || item.workspaceId === workspaceId) && (!title || item.metadata?.title === title))
      .map((item) => item.id));
    const record = (embeddings || [])
      .filter((item) => (!workspaceId || item.workspaceId === workspaceId) && sampleChunkIds.has(item.chunkId))
      .sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""))[0];
    if (record) return record;
    await wait(140);
  }
  return null;
};

const waitForKnowledgeAiRagJob = async ({ workspaceId = "", runId = "", agentId = "", query = "", timeoutMs = 8000 } = {}) => {
  const started = Date.now();
  const expectedQuery = String(query || "").trim().toLowerCase();
  while (Date.now() - started < timeoutMs) {
    const data = await window.TrackerLensAiRuntimeStore?.list?.().catch(() => ({ jobs: [] }));
    const job = (data?.jobs || [])
      .filter((item) =>
        (!workspaceId || item.workspaceId === workspaceId) &&
        (!runId || item.runId === runId || item.result?.runId === runId) &&
        (!agentId || item.agentId === agentId)
      )
      .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || "") - Date.parse(a.updatedAt || a.createdAt || ""))[0];
    const ragContext = job?.ragContext || job?.result?.ragContext || null;
    const hasMatchingQuery = !expectedQuery || String(ragContext?.query || "").trim().toLowerCase() === expectedQuery;
    if (job && ragContext?.context && hasMatchingQuery) return { job, ragContext };
    await wait(180);
  }
  return { job: null, ragContext: null };
};

const waitForKnowledgeAgentToolJob = async ({ workspaceId = "", runId = "", agentId = "", timeoutMs = 10000 } = {}) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const data = await window.TrackerLensAiRuntimeStore?.list?.().catch(() => ({ jobs: [] }));
    const job = (data?.jobs || [])
      .filter((item) =>
        (!workspaceId || item.workspaceId === workspaceId) &&
        (!runId || item.runId === runId || item.result?.runId === runId) &&
        (!agentId || item.agentId === agentId)
      )
      .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || "") - Date.parse(a.updatedAt || a.createdAt || ""))[0];
    const toolContext = job?.toolContext || job?.result?.toolContext || null;
    if (job && (toolContext?.observations || []).length) return { job, toolContext };
    await wait(180);
  }
  return { job: null, toolContext: null };
};

const runtimeTestProviderModelUrls = (provider = {}) => {
  const base = String(provider.endpoint || provider.baseUrl || "").trim().replace(/\/+$/g, "");
  if (!base) return [];
  const kind = String(provider.provider || provider.providerType || provider.name || provider.id || "").toLowerCase().replace(/[\s_-]+/g, "");
  const join = (root = "", path = "") => `${root.replace(/\/+$/g, "")}/${String(path || "").replace(/^\/+/g, "")}`;
  if (kind.includes("lmstudio")) {
    const root = base.replace(/\/v1$/i, "");
    return [...new Set([
      join(base, provider.modelPath || "/models"),
      join(base, "/models"),
      join(root, "/v1/models"),
      join(root, "/api/v1/models"),
      join(root, "/models"),
    ])];
  }
  if (kind.includes("ollama")) return [...new Set([join(base, provider.modelPath || "/api/tags"), join(base, "/api/tags")])];
  return [...new Set([provider.modelPath, provider.healthPath, "/models", "/api/v1/models"].filter(Boolean).map((path) => join(base, path)))];
};

const parseRuntimeTestAiModels = (payload = {}) => {
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
    .map((item) => String(item?.id || item?.name || item?.model || item || "").trim())
    .filter(Boolean))];
};

const resolveRuntimeTestAiModel = async ({ provider = {}, requested = "" } = {}) => {
  const cleanRequested = String(requested || provider.model || provider.defaultModel || "").trim();
  const urls = runtimeTestProviderModelUrls(provider);
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const models = parseRuntimeTestAiModels(await response.json());
      if (!models.length) continue;
      const exact = models.find((model) => model === cleanRequested);
      if (exact) return exact;
      const fuzzy = cleanRequested && cleanRequested !== "local-model"
        ? models.find((model) => model.toLowerCase().includes(cleanRequested.toLowerCase()) || cleanRequested.toLowerCase().includes(model.toLowerCase()))
        : "";
      if (fuzzy) return fuzzy;
      return models.find((model) => !/embed/i.test(model)) || models[0] || cleanRequested;
    } catch {
      // Try the next model endpoint.
    }
  }
  return cleanRequested || "local-model";
};

const waitForKnowledgeGraphQueryRecord = async ({ workspaceId = "", query = "", timeoutMs = 5000 } = {}) => {
  const storeName = window.TrackerLensKnowledgeRuntime?.STORES?.queries || "tl_knowledge_queries";
  const started = Date.now();
  const expected = String(query || "").trim().toLowerCase();
  while (Date.now() - started < timeoutMs) {
    const records = await readKnowledgeRuntimeRecords(storeName);
    const record = records
      .filter((item) =>
        (!workspaceId || item.workspaceId === workspaceId) &&
        item.scope?.mode === "knowledge-graph" &&
        (!expected || String(item.query || "").trim().toLowerCase() === expected)
      )
      .sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""))[0];
    if (record?.context && (record.entities?.length || record.relations?.length)) return record;
    await wait(160);
  }
  return null;
};

const waitForKnowledgeAiGraphJob = async ({ workspaceId = "", runId = "", agentId = "", query = "", timeoutMs = 8000 } = {}) => {
  const started = Date.now();
  const expectedQuery = String(query || "").trim().toLowerCase();
  while (Date.now() - started < timeoutMs) {
    const data = await window.TrackerLensAiRuntimeStore?.list?.().catch(() => ({ jobs: [] }));
    const job = (data?.jobs || [])
      .filter((item) =>
        (!workspaceId || item.workspaceId === workspaceId) &&
        (!runId || item.runId === runId || item.result?.runId === runId) &&
        (!agentId || item.agentId === agentId)
      )
      .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || "") - Date.parse(a.updatedAt || a.createdAt || ""))[0];
    const graphContext = job?.graphContext || job?.result?.graphContext || null;
    const hasMatchingQuery = !expectedQuery || String(graphContext?.query || "").trim().toLowerCase() === expectedQuery;
    if (job && graphContext?.context && hasMatchingQuery) return { job, graphContext };
    await wait(180);
  }
  return { job: null, graphContext: null };
};

const waitForKnowledgeGraphSnapshot = async ({ workspaceId = "", collectionId = "", documentId = "", minSemanticCount = 0, timeoutMs = 6000 } = {}) => {
  const knowledge = window.TrackerLensKnowledgeRuntime;
  const stores = knowledge?.STORES || {};
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const metrics = await knowledge?.listStore?.(stores.metrics || "tl_knowledge_metrics").catch(() => []);
    const snapshot = (metrics || [])
      .filter((item) => (!workspaceId || item.workspaceId === workspaceId) && item.metric === "knowledge.graph.snapshot")
      .filter((item) => !collectionId || item.value?.collectionId === collectionId)
      .filter((item) => !documentId || item.value?.documentId === documentId)
      .sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""))[0];
    if (
      snapshot?.value?.entityCount > 0 &&
      snapshot?.value?.relationCount > 0 &&
      Number(snapshot?.value?.semanticRelationCount || 0) >= Number(minSemanticCount || 0)
    ) return snapshot;
    await wait(180);
  }
  return null;
};

const waitForKnowledgeSemanticRelations = async ({ workspaceId = "", collectionId = "", documentId = "", timeoutMs = 6000 } = {}) => {
  const knowledge = window.TrackerLensKnowledgeRuntime;
  const stores = knowledge?.STORES || {};
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const relations = await knowledge?.listStore?.(stores.relations || "tl_knowledge_relations").catch(() => []);
    const semanticRelations = (relations || [])
      .filter((item) => (!workspaceId || item.workspaceId === workspaceId) && item.metadata?.semantic === true)
      .filter((item) => !collectionId || item.metadata?.collectionId === collectionId)
      .filter((item) => !documentId || item.documentId === documentId);
    if (semanticRelations.length) return semanticRelations;
    await wait(180);
  }
  return [];
};

const runtimeKindForNode = (node = {}) => {
  if (isOrchestratorAgentNode(node)) return "orchestrator";
  if (node.type === "aiAgent") return "ai";
  if (node.type === "storage") return "storage";
  if (node.type === "action") return "action";
  if (node.type === "processor") return "processor";
  return "";
};

const getPathValue = (source, path = "") => {
  const clean = String(path || "").trim();
  if (!clean) return source;
  return clean
    .replace(/^result\./, "")
    .replace(/^payload\./, "")
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean)
    .reduce((value, key) => value?.[key], source);
};

const stringifyForAssert = (value = "") => {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? {});
  } catch (_) {
    return String(value ?? "");
  }
};

const parseExpectedValue = (value = "") => {
  if (value && typeof value === "object") return value;
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    return JSON.parse(text);
  } catch (_) {
    return text;
  }
};

const objectContains = (actual, expected) => {
  if (!expected || typeof expected !== "object") return stringifyForAssert(actual).includes(String(expected || ""));
  if (!actual || typeof actual !== "object") return false;
  return Object.entries(expected).every(([key, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value)) return objectContains(actual[key], value);
    return stringifyForAssert(actual[key]) === stringifyForAssert(value);
  });
};

const evaluateAiAssertion = ({ node = {}, job = {} } = {}) => {
  const config = nodeRuntimeConfig(node);
  const expectedOutput = parseExpectedValue(config.expectedOutput);
  const assertPath = String(config.assertPath || "").trim();
  const operator = String(config.assertOperator || (expectedOutput ? "json-contains" : "contains")).trim() || "contains";
  const expected = parseExpectedValue(config.assertValue || config.expectedOutput);
  const result = job.result || {};
  const target = assertPath ? getPathValue(result, assertPath) : result.response || result.text || result;
  const actualText = stringifyForAssert(target);
  const expectedText = stringifyForAssert(expected);

  if (!expectedText && !assertPath && !config.expectedOutput) {
    return { status: "not-configured", ok: true, operator, actual: actualText, expected: "" };
  }
  if (operator === "exists") return { status: target !== undefined && target !== null && target !== "" ? "passed" : "failed", ok: target !== undefined && target !== null && target !== "", operator, actual: actualText, expected: assertPath };
  if (operator === "equals") return { status: actualText === expectedText ? "passed" : "failed", ok: actualText === expectedText, operator, actual: actualText, expected: expectedText };
  if (operator === "regex") {
    let ok = false;
    try {
      ok = new RegExp(String(expected || ""), "i").test(actualText);
    } catch (_) {
      ok = false;
    }
    return { status: ok ? "passed" : "failed", ok, operator, actual: actualText, expected: expectedText };
  }
  if (operator === "json-contains") {
    const ok = objectContains(target, expectedOutput || expected);
    return { status: ok ? "passed" : "failed", ok, operator, actual: actualText, expected: stringifyForAssert(expectedOutput || expected) };
  }
  const ok = actualText.toLowerCase().includes(expectedText.toLowerCase());
  return { status: ok ? "passed" : "failed", ok, operator, actual: actualText, expected: expectedText };
};

const runRecordMatches = (record = {}, runId = "") =>
  Boolean(runId) && (
    record.meta?.runId === runId ||
    record.context?.runId === runId ||
    record.payload?.runId === runId
  );

const loadRunRecords = async ({ workspaceId = "", runId = "" } = {}) => {
  const [events, flowLogs, aiData] = await Promise.all([
    window.TrackerLensEventLogStore?.listEvents
      ? window.TrackerLensEventLogStore.listEvents().catch(() => [])
      : Promise.resolve([]),
    window.TrackerLensEventLogStore?.listFlowLogs
      ? window.TrackerLensEventLogStore.listFlowLogs().catch(() => [])
      : Promise.resolve([]),
    window.TrackerLensAiRuntimeStore?.list
      ? window.TrackerLensAiRuntimeStore.list().catch(() => ({ jobs: [], logs: [], providers: [] }))
      : Promise.resolve({ jobs: [], logs: [], providers: [] }),
  ]);
  return {
    events: events.filter((event) => (!workspaceId || event.workspaceId === workspaceId) && runRecordMatches(event, runId)),
    flowLogs: flowLogs.filter((log) => (!workspaceId || log.workspaceId === workspaceId) && runRecordMatches(log, runId)),
    aiJobs: (aiData.jobs || []).filter((job) => (!workspaceId || job.workspaceId === workspaceId) && (job.runId === runId || job.result?.runId === runId)),
    aiLogs: (aiData.logs || []).filter((log) => (!workspaceId || log.workspaceId === workspaceId) && runRecordMatches(log, runId)),
    aiProviders: aiData.providers || [],
  };
};

const aiNodesInPath = (graph = {}, path = {}) => {
  const pathNodeIds = new Set(path.nodeIds || []);
  return (graph.nodes || []).filter((node) => pathNodeIds.has(node.id) && runtimeKindForNode(node) === "ai");
};

const waitForAiPathRecords = async ({ workspaceId = "", runId = "", graph = {}, path = {}, signal = null } = {}) => {
  const aiNodes = aiNodesInPath(graph, path);
  if (!aiNodes.length) return loadRunRecords({ workspaceId, runId });
  const aiNodeIds = new Set(aiNodes.map((node) => node.id));
  const started = Date.now();
  let records = await loadRunRecords({ workspaceId, runId });
  while (!signal?.aborted && Date.now() - started < AI_DIRECT_TEST_TIMEOUT_MS) {
    const hasAiJob = (records.aiJobs || []).some((job) => aiNodeIds.has(job.agentId));
    const hasAiEvent = (records.events || []).some((event) =>
      aiNodeIds.has(event.sourceNodeId) &&
      (String(event.eventType || "").includes("ai_agent") || String(event.channel || "").startsWith("ai."))
    );
    const hasAiLog = (records.flowLogs || []).some((log) =>
      aiNodeIds.has(log.nodeId) || aiNodeIds.has(log.context?.nodeId)
    );
    if (hasAiJob || hasAiEvent || hasAiLog) return records;
    await wait(500);
    records = await loadRunRecords({ workspaceId, runId });
  }
  return records;
};

const hasAiPathRecords = (records = {}, graph = {}, path = {}) => {
  const aiNodeIds = new Set(aiNodesInPath(graph, path).map((node) => node.id));
  if (!aiNodeIds.size) return true;
  return (
    (records.aiJobs || []).some((job) => aiNodeIds.has(job.agentId)) ||
    (records.events || []).some((event) => aiNodeIds.has(event.sourceNodeId) && String(event.eventType || "").includes("ai_agent")) ||
    (records.flowLogs || []).some((log) => aiNodeIds.has(log.nodeId) || aiNodeIds.has(log.context?.nodeId))
  );
};

const latestAiInputEvent = ({ records = {}, graph = {}, node = {} } = {}) => {
  const incomingChannels = new Set((graph.dependencies || [])
    .filter((dependency) => dependency.targetNodeId === node.id)
    .map((dependency) => dependency.channel || dependency.metadata?.targetPort)
    .filter(Boolean));
  return (records.events || [])
    .filter((event) => incomingChannels.has(event.channel))
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))[0] || null;
};

const ensureAiPathExecution = async ({ workspaceId = "", runId = "", graph = {}, path = {}, signal = null } = {}) => {
  const aiNodes = aiNodesInPath(graph, path);
  if (!aiNodes.length || signal?.aborted) return;
  await wait(900);
  let records = await loadRunRecords({ workspaceId, runId });
  if (hasAiPathRecords(records, graph, path) || signal?.aborted) return;
  const runtime = window.TrackerLensAiAgentRuntime?.get?.(workspaceId);
  const bus = workspaceEventBus(workspaceId);
  if (!runtime?.execute || !bus?.emit) return;
  for (const node of aiNodes) {
    if (signal?.aborted) return;
    const inputEvent = latestAiInputEvent({ records, graph, node });
    if (!inputEvent) continue;
    setTestRunActiveNodes(graph, [node.id]);
    const result = await runtime.execute({
      node,
      payload: inputEvent.payload || {},
      event: {
        ...inputEvent,
        meta: {
          ...(inputEvent.meta || {}),
          runId,
          flowMapAiFallbackExecution: true,
        },
      },
    });
    const outputChannel = node.outputs?.[0] || node.channels?.find((item) => item !== inputEvent.channel) || `ai.${nodeSubtype(node) || "agent"}.output`;
    const responseEvent = await bus.emit(outputChannel, result, {
      workspaceId,
      flowId: flowIdForWorkspace(workspaceId),
      eventType: "ai_agent_response",
      sourceNodeId: node.id,
      latencyMs: Number(result?.latencyMs || 0),
      meta: {
        aiAgentRuntime: node.id,
        inputEventId: inputEvent.id || "",
        inputChannel: inputEvent.channel || "",
        runId,
        provider: result?.provider || "",
        model: result?.model || "",
        flowMapAiFallbackExecution: true,
      },
    });
    if (responseEvent) mergeRuntimeEvent(responseEvent);
    await recordFlowAction({
      workspaceId,
      nodeId: node.id,
      message: `AI Agent fallback emitted ${outputChannel}: ${node.label || node.id}`,
      context: {
        action: "flow-map-ai-fallback-response",
        runId,
        inputChannel: inputEvent.channel || "",
        outputChannel,
        provider: result?.provider || "",
        model: result?.model || "",
        payloadPreview: compactPayloadPreview(result, 220),
      },
    });
    records = await loadRunRecords({ workspaceId, runId });
  }
};

const summarizeLiveVerification = ({ graph, path, starters, events = [], flowLogs = [], aiJobs = [], aiLogs = [] } = {}) => {
  const pathNodeIds = new Set([...(path?.nodeIds || []), ...(starters || []).map((node) => node.id)]);
  const nodes = (graph.nodes || []).filter((node) => pathNodeIds.has(node.id));
  const expected = {
    processor: nodes.filter((node) => runtimeKindForNode(node) === "processor").length,
    action: nodes.filter((node) => runtimeKindForNode(node) === "action").length,
    storage: nodes.filter((node) => runtimeKindForNode(node) === "storage").length,
    ai: nodes.filter((node) => runtimeKindForNode(node) === "ai").length,
  };
  const eventHits = {
    processor: events.filter((event) => String(event.eventType || "").includes("processor")).length,
    action: events.filter((event) => String(event.eventType || "").includes("action")).length,
    storage: events.filter((event) => String(event.eventType || "").includes("storage")).length,
    ai: events.filter((event) => String(event.eventType || "").includes("ai_agent") || String(event.channel || "").startsWith("ai.")).length,
  };
  const logHits = {
    processor: flowLogs.filter((log) => log.context?.runtime === "processor").length,
    action: flowLogs.filter((log) => log.context?.runtime === "action").length,
    storage: flowLogs.filter((log) => log.context?.runtime === "storage").length,
    ai: flowLogs.filter((log) => log.context?.runtime === "ai-agent").length,
  };
  const aiNodes = nodes.filter((node) => runtimeKindForNode(node) === "ai");
  const aiDetails = aiNodes.map((node) => {
    const jobs = aiJobs
      .filter((job) => job.agentId === node.id)
      .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0));
    const job = jobs[0] || null;
    const assertion = job ? evaluateAiAssertion({ node, job }) : { status: "missing", ok: false };
    const usage = job?.result?.usage || {};
    const cost = job?.result?.cost || job?.cost || {};
    return {
      nodeId: node.id,
      label: node.label || node.id,
      status: job ? (assertion.ok ? "passed" : "failed") : "missing",
      assertion,
      provider: job?.provider || job?.result?.provider || "N/D",
      model: job?.model || job?.result?.model || "N/D",
      tokens: Number(job?.tokens || usage.totalTokens || usage.total_tokens || 0),
      promptTokens: Number(usage.promptTokens || usage.prompt_tokens || 0),
      completionTokens: Number(usage.completionTokens || usage.completion_tokens || 0),
      cost: cost.estimated || 0,
      currency: cost.currency || "USD",
      prompt: job?.prompt || job?.result?.prompt || "",
      memoryContext: job?.memoryContext || job?.result?.memoryContext || "",
      raw: job?.result || null,
    };
  });
  const makeStatus = (kind) => {
    const hits = eventHits[kind] + logHits[kind];
    if (kind === "ai" && aiDetails.some((item) => item.status === "failed")) return { kind, status: "failed", expected: expected[kind], events: eventHits[kind], logs: logHits[kind] };
    if (kind === "ai" && aiDetails.some((item) => item.status === "passed")) return { kind, status: "passed", expected: expected[kind], events: eventHits[kind], logs: logHits[kind] };
    if (!expected[kind]) return { kind, status: "not-present", expected: 0, events: eventHits[kind], logs: logHits[kind] };
    return { kind, status: hits ? "passed" : "missing", expected: expected[kind], events: eventHits[kind], logs: logHits[kind] };
  };
  const checks = ["processor", "ai", "storage", "action"].map(makeStatus);
  return {
    checks,
    events: events.length,
    flowLogs: flowLogs.length,
    aiJobs: aiJobs.length,
    aiLogs: aiLogs.length,
    aiDetails,
    passed: checks.filter((check) => check.status === "passed").length,
    failed: checks.filter((check) => check.status === "failed").length + aiDetails.filter((item) => item.status === "failed").length,
    missing: checks.filter((check) => check.status === "missing").length,
    notPresent: checks.filter((check) => check.status === "not-present").length,
  };
};

const liveVerificationLabel = (check = {}) => {
  if (check.status === "passed") return `${check.kind}: ok`;
  if (check.status === "failed") return `${check.kind}: assert failed`;
  if (check.status === "missing") return `${check.kind}: no signal`;
  return `${check.kind}: absent`;
};

const liveVerificationTone = (check = {}) =>
  check.status === "passed" ? "green" : check.status === "missing" || check.status === "failed" ? "red" : "gold";

const renderAiTestDetails = (verification = state.testRun.verification) => {
  const details = verification?.aiDetails || [];
  if (!details.length) return null;
  return _.div(
    { class: "tl-flow-ai-test-panel" },
    _.h3("AI Agent Test"),
    ...details.map((detail) =>
      _.section(
        { class: `tl-flow-ai-test-card is-${detail.status}` },
        _.div(
          { class: "tl-flow-ai-test-head" },
          _.strong(detail.label),
          _.span({ class: `tl-flow-mini-chip is-${detail.status === "passed" ? "green" : detail.status === "failed" ? "red" : "gold"}` }, detail.status)
        ),
        _.div(
          { class: "tl-flow-ai-test-metrics" },
          _.span(`Provider: ${detail.provider}`),
          _.span(`Model: ${detail.model}`),
          _.span(`Tokens: ${detail.tokens} (${detail.promptTokens}/${detail.completionTokens})`),
          _.span(`Cost: ${detail.cost} ${detail.currency}`)
        ),
        _.div(
          { class: "tl-flow-ai-assert" },
          _.strong(`Assert: ${detail.assertion?.operator || "N/D"} · ${detail.assertion?.status || "N/D"}`),
          _.span(`Expected: ${compactPayloadPreview(detail.assertion?.expected || "", 180)}`),
          _.span(`Actual: ${compactPayloadPreview(detail.assertion?.actual || "", 220)}`)
        ),
        _.details(
          _.summary("Prompt finale"),
          _.pre(detail.prompt || "N/D")
        ),
        _.details(
          _.summary("Memoria usata"),
          _.pre(detail.memoryContext || "N/D")
        ),
        _.details(
          _.summary("Risposta raw"),
          _.pre(prettyRuntimeValue(detail.raw || {}))
        )
      )
    )
  );
};

const renderLiveTestVerification = () => {
  const verification = state.testRun.verification;
  if (!verification) return null;
  return _.div(
    { class: "tl-flow-run-summary" },
    _.strong("Live Test verification"),
    ...verification.checks.map((check) =>
      _.span({
        class: `tl-flow-mini-chip is-${liveVerificationTone(check)}`,
        title: `${check.expected} node target · ${check.events} events · ${check.logs} logs`,
      }, liveVerificationLabel(check))
    ),
    _.span(`${verification.events} events · ${verification.flowLogs} logs · ${verification.aiJobs || 0} ai jobs`),
    renderAiTestDetails(verification)
  );
};

const startTestRunTimeout = (runId, timeoutMs = TEST_RUN_TIMEOUT_MS) => {
  clearTestRunTimeout();
  state.testRun.timeoutId = window.setTimeout(() => {
    if (!state.testRun.running || state.testRun.runId !== runId) return;
    finishFlowMapTestRun({
      runId,
      summary: "Test timeout: runtime released",
    });
    mount({ preserveScroll: true });
  }, timeoutMs);
};

const stopFlowMapTestRun = async () => {
  if (!state.testRun.running) return;
  const runId = state.testRun.runId;
  const workspaceId = state.filters.workspaceId || "workspace_global";
  state.testRun.cancelRequested = true;
  try {
    state.testRun.abortController?.abort?.();
  } catch (_) {
    // AbortController can throw if already aborted in older browser contexts.
  }
  closeLiveSockets();
  finishFlowMapTestRun({ runId, summary: "Test stopped" });
  await recordFlowAction({
    workspaceId,
    level: "warning",
    message: "Flow Map test stopped",
    context: { action: "flow-map-test-stopped", runId, stopped: true },
  });
  mount({ preserveScroll: true });
};

const runMappingPreviewTest = async () => {
  if (state.testRun.running) return;
  if (!window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode) {
    state.error = "Mapping test non disponibile: Runtime Graph Store non pronto.";
    mount({ preserveScroll: true });
    return;
  }
  const workspaceId = state.filters.workspaceId || "workspace_global";
  const runId = testRunId().replace("flow_test", "flow_mapping");
  const now = Date.now();
  const sourceId = `mapping_test_source_${now}`;
  const previewId = `mapping_test_preview_${now}`;
  const payload = {
    symbol: "BTCUSDT",
    price: "123.45",
  };
  const mapping = {
    mode: "json-map",
    sourcePort: "raw",
    targetPort: "raw",
    channel: "raw",
    transform: JSON.stringify({ symbol: "symbol", price: "number:price" }),
    note: "Preset test Manual JSON -> Preview",
  };
  const source = {
    id: sourceId,
    workspaceId,
    type: "source",
    label: "Manual JSON Test",
    sourceRef: sourceId,
    assetId: sourceId,
    inputs: [],
    outputs: ["raw"],
    channels: ["raw"],
    status: "active",
    flowPosition: { x: 140, y: 140, width: FLOW_NODE_DEFAULT_WIDTH },
    metadata: {
      configured: true,
      draft: false,
      paletteLabel: "Manual JSON",
      paletteAction: "Source: Manual JSON",
      tone: "green",
      icon: "data_object",
      runtimeType: "source",
      subtype: "manual-json",
      category: "sources",
      settingsSchema: { json: "object" },
      config: {
        testPayload: prettyRuntimeValue(payload),
      },
    },
  };
  const preview = {
    id: previewId,
    workspaceId,
    type: "devPreview",
    label: "Preview Mapping Test",
    sourceRef: previewId,
    assetId: previewId,
    inputs: ["raw"],
    outputs: ["output"],
    channels: ["raw"],
    status: "active",
    flowPosition: { x: 520, y: 140, width: FLOW_NODE_DEFAULT_WIDTH },
    metadata: {
      configured: true,
      draft: false,
      paletteLabel: "Preview",
      paletteAction: "Mapping preview test",
      tone: "blue",
      icon: "visibility",
      runtimeType: "devPreview",
      subtype: "preview",
      category: "dev",
      settingsSchema: { mode: "raw|json" },
      config: {
        previewMode: "json",
        maxChars: 4000,
      },
    },
  };

  state.testRun = {
    running: true,
    runId,
    nodeIds: [sourceId, previewId],
    edgeIds: [],
    activeNodeIds: [sourceId],
    activeEdgeIds: [],
    startedAt: new Date().toISOString(),
    completedAt: "",
    summary: "Running mapping preview test",
    timeoutId: 0,
    abortController: null,
    liveSockets: [],
    keepOpen: false,
    cancelRequested: false,
    verification: null,
  };
  state.error = "";
  setFiltersState({ ...state.filters, runId });
  syncFilterQuery();
  mount({ preserveScroll: true });

  try {
    await window.TrackerLensRuntimeGraphStore.upsertRuntimeNode({ node: source });
    await window.TrackerLensRuntimeGraphStore.upsertRuntimeNode({ node: preview });
    await loadRuntime({ force: true, silent: true });
    const savedSource = nodeById(sourceId) || source;
    const savedPreview = nodeById(previewId) || preview;
    await createRuntimeLink(savedSource, savedPreview, {
      sourcePort: "raw",
      targetPort: "raw",
      mapping,
      configure: false,
    });
    await loadRuntime({ force: true, silent: true });
    const dependency = (state.runtime.dependencies || []).find((item) =>
      item.sourceNodeId === sourceId && item.targetNodeId === previewId);
    state.testRun = {
      ...state.testRun,
      edgeIds: dependency?.id ? [dependency.id] : [],
      activeEdgeIds: dependency?.id ? [dependency.id] : [],
    };
    await mergeTestEvent({
      workspaceId,
      channel: "raw",
      eventType: "flow_mapping_test",
      sourceNodeId: sourceId,
      targetNodeId: previewId,
      connectionId: dependency?.connectionId || dependency?.id || "",
      payload: {
        ...payload,
        __test: true,
        runId,
        sourceNodeId: sourceId,
        emittedAt: new Date().toISOString(),
      },
      latencyMs: 1,
      meta: { runId, origin: "mapping-preview-test", rootNodeId: sourceId },
    });
    const mapped = window.TrackerLensRuntimeContract?.applyConnectionMapping?.(payload, mapping);
    const ok = mapped?.payload?.symbol === "BTCUSDT" && mapped?.payload?.price === 123.45;
    finishFlowMapTestRun({
      runId,
      summary: ok ? "Mapping test completed: Preview shows mapped BTC payload" : "Mapping test completed with warnings",
      error: ok ? "" : "Mapping test output inatteso",
    });
    await recordFlowAction({
      workspaceId,
      level: ok ? "info" : "warning",
      message: ok ? "Mapping preview test completed" : "Mapping preview test completed with unexpected output",
      context: { action: "flow-map-mapping-preview-test", runId, mappedPayload: mapped?.payload || null, warnings: mapped?.warnings || [] },
    });
    setFocusState({ mode: "nodes", nodeId: previewId, nodeType: "devPreview", channel: "raw", connectionId: "" });
    centerViewportOnNode?.(savedPreview, (state.runtime.nodes || []).findIndex((node) => node.id === previewId), { select: true });
  } catch (error) {
    console.error("Flow Map mapping test error:", error);
    state.error = error?.message || "Errore mapping test Flow Map";
    finishFlowMapTestRun({ runId, summary: `Mapping test error: ${error.message || error}`, error: state.error });
    await recordFlowAction({
      workspaceId,
      level: "error",
      message: state.error,
      context: { action: "flow-map-mapping-preview-test-error", runId, error: error.message || String(error) },
    });
    mount({ preserveScroll: true });
  }
};

const runMappingStorageTest = async () => {
  if (state.testRun.running) return;
  if (!window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode) {
    state.error = "Storage mapping test non disponibile: Runtime Graph Store non pronto.";
    mount({ preserveScroll: true });
    return;
  }
  const workspaceId = state.filters.workspaceId || "workspace_global";
  const runId = testRunId().replace("flow_test", "flow_storage_mapping");
  const now = Date.now();
  const sourceId = `storage_mapping_source_${now}`;
  const storageId = `storage_mapping_target_${now}`;
  const storeName = `tl_mapping_test_${now}`;
  const payload = {
    symbol: "BTCUSDT",
    price: "123.45",
    exchange: "binance",
  };
  const mapping = {
    mode: "json-map",
    sourcePort: "raw",
    targetPort: "record",
    channel: "raw",
    transform: JSON.stringify({ symbol: "symbol", price: "number:price", venue: "exchange", runId: "runId" }),
    note: "Preset test Manual JSON -> Storage",
  };
  const source = {
    id: sourceId,
    workspaceId,
    type: "source",
    label: "Manual JSON Storage Test",
    sourceRef: sourceId,
    assetId: sourceId,
    inputs: [],
    outputs: ["raw"],
    channels: ["raw"],
    status: "active",
    flowPosition: { x: 140, y: 360, width: FLOW_NODE_DEFAULT_WIDTH },
    metadata: {
      configured: true,
      draft: false,
      paletteLabel: "Manual JSON",
      paletteAction: "Source: Manual JSON",
      tone: "green",
      icon: "data_object",
      runtimeType: "source",
      subtype: "manual-json",
      category: "sources",
      settingsSchema: { json: "object" },
      config: {
        testPayload: prettyRuntimeValue(payload),
      },
    },
  };
  const storage = {
    id: storageId,
    workspaceId,
    type: "storage",
    label: "Storage Mapping Test",
    sourceRef: storageId,
    assetId: storageId,
    inputs: ["record"],
    outputs: [],
    channels: ["raw"],
    status: "active",
    flowPosition: { x: 520, y: 360, width: FLOW_NODE_DEFAULT_WIDTH },
    metadata: {
      configured: true,
      draft: false,
      paletteLabel: "Save DB Record",
      paletteAction: "Storage mapping test",
      tone: "cyan",
      icon: "database",
      runtimeType: "storage",
      subtype: "indexeddb",
      category: "storage",
      settingsSchema: { storeName: "string", keyPath: "string", retention: "string" },
      config: {
        storeName,
        format: "json",
      },
    },
  };

  state.testRun = {
    running: true,
    runId,
    nodeIds: [sourceId, storageId],
    edgeIds: [],
    activeNodeIds: [sourceId, storageId],
    activeEdgeIds: [],
    startedAt: new Date().toISOString(),
    completedAt: "",
    summary: "Running storage mapping test",
    timeoutId: 0,
    abortController: null,
    liveSockets: [],
    keepOpen: false,
    cancelRequested: false,
    verification: null,
  };
  state.error = "";
  setFiltersState({ ...state.filters, runId });
  syncFilterQuery();
  mount({ preserveScroll: true });

  try {
    await window.TrackerLensRuntimeGraphStore.upsertRuntimeNode({ node: source });
    await window.TrackerLensRuntimeGraphStore.upsertRuntimeNode({ node: storage });
    await loadRuntime({ force: true, silent: true });
    const savedSource = nodeById(sourceId) || source;
    const savedStorage = nodeById(storageId) || storage;
    await createRuntimeLink(savedSource, savedStorage, {
      sourcePort: "raw",
      targetPort: "record",
      mapping,
      configure: false,
    });
    await loadRuntime({ force: true, silent: true });
    const dependency = (state.runtime.dependencies || []).find((item) =>
      item.sourceNodeId === sourceId && item.targetNodeId === storageId);
    state.testRun = {
      ...state.testRun,
      edgeIds: dependency?.id ? [dependency.id] : [],
      activeEdgeIds: dependency?.id ? [dependency.id] : [],
    };
    const bus = workspaceEventBus(workspaceId);
    const eventPayload = {
      ...payload,
      __test: true,
      runId,
      sourceNodeId: sourceId,
      emittedAt: new Date().toISOString(),
    };
    const emitted = bus?.emit
      ? await bus.emit("raw", eventPayload, {
        workspaceId,
        flowId: flowIdForWorkspace(workspaceId),
        eventType: "flow_storage_mapping_test",
        sourceNodeId: sourceId,
        targetNodeId: storageId,
        connectionId: dependency?.connectionId || dependency?.id || "",
        latencyMs: 1,
        meta: { test: true, runId, origin: "storage-mapping-test", rootNodeId: sourceId },
      })
      : await mergeTestEvent({
        workspaceId,
        channel: "raw",
        eventType: "flow_storage_mapping_test",
        sourceNodeId: sourceId,
        targetNodeId: storageId,
        connectionId: dependency?.connectionId || dependency?.id || "",
        payload: eventPayload,
        latencyMs: 1,
        meta: { runId, origin: "storage-mapping-test", rootNodeId: sourceId },
      });
    if (emitted) mergeRuntimeEvent(emitted);
    const record = await waitForStorageRuntimeRecord({ storeName, nodeId: storageId, runId, timeoutMs: 4000 });
    const storedPayload = record?.payload || {};
    const ok = storedPayload.symbol === "BTCUSDT" &&
      storedPayload.price === 123.45 &&
      storedPayload.venue === "binance" &&
      storedPayload.runId === runId;
    finishFlowMapTestRun({
      runId,
      summary: ok ? "Storage mapping test completed: mapped record persisted" : "Storage mapping test completed with warnings",
      error: ok ? "" : "Storage mapping test output inatteso",
    });
    await recordFlowAction({
      workspaceId,
      nodeId: storageId,
      level: ok ? "info" : "warning",
      message: ok ? "Storage mapping test completed" : "Storage mapping test completed with unexpected output",
      context: {
        action: "flow-map-storage-mapping-test",
        runId,
        storeName,
        recordId: record?.id || "",
        storedPayload,
      },
    });
    await loadRuntime({ force: true, silent: true });
    setFocusState({ mode: "nodes", nodeId: storageId, nodeType: "storage", channel: "raw", connectionId: "" });
    centerViewportOnNode?.(nodeById(storageId) || storage, (state.runtime.nodes || []).findIndex((node) => node.id === storageId), { select: true });
  } catch (error) {
    console.error("Flow Map storage mapping test error:", error);
    state.error = error?.message || "Errore storage mapping test Flow Map";
    finishFlowMapTestRun({ runId, summary: `Storage mapping test error: ${error.message || error}`, error: state.error });
    await recordFlowAction({
      workspaceId,
      level: "error",
      message: state.error,
      context: { action: "flow-map-storage-mapping-test-error", runId, error: error.message || String(error) },
    });
    mount({ preserveScroll: true });
  }
};

const runKnowledgeSampleTest = async () => {
  if (state.testRun.running) {
    const ageMs = Date.now() - Date.parse(state.testRun.startedAt || "");
    if (Number.isFinite(ageMs) && ageMs > AI_DIRECT_TEST_TIMEOUT_MS) {
      finishFlowMapTestRun({ runId: state.testRun.runId, summary: "Previous Knowledge sample test released after timeout" });
    } else {
      state.error = "Un test Flow Map è già in corso. Premi Stop o attendi la fine prima di lanciare Knowledge Test.";
      mount({ preserveScroll: true });
      return;
    }
  }
  if (!window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode || !window.TrackerLensKnowledgeRuntime?.get) {
    state.error = "Knowledge sample non disponibile: Runtime Graph Store o Knowledge Runtime non pronto.";
    await recordFlowAction({
      workspaceId: state.filters.workspaceId || "workspace_global",
      level: "error",
      message: state.error,
      context: {
        action: "flow-map-knowledge-sample-not-ready",
        hasRuntimeGraphStore: Boolean(window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode),
        hasKnowledgeRuntime: Boolean(window.TrackerLensKnowledgeRuntime?.get),
      },
    });
    mount({ preserveScroll: true });
    return;
  }
  const workspaceId = state.filters.workspaceId || "workspace_global";
  const runId = testRunId().replace("flow_test", "flow_knowledge_sample");
  const now = Date.now();
  const id = (name) => `knowledge_sample_${name}_${now}`;
  const existingDocSource = (state.runtime.nodes || [])
    .filter((node) => node.workspaceId === workspaceId)
    .find((node) =>
      String(node.id || "").startsWith("knowledge_sample_document_source_") ||
      String(node.label || "") === "Knowledge Doc Source");
  const existingQuerySource = (state.runtime.nodes || [])
    .filter((node) => node.workspaceId === workspaceId)
    .find((node) =>
      String(node.id || "").startsWith("knowledge_sample_query_source_") ||
      String(node.label || "") === "Knowledge Query Source");
  const configuredDocumentPayload = parseManualJsonPayload(
    existingDocSource?.metadata?.config?.json ||
    existingDocSource?.metadata?.config?.testPayload ||
    existingDocSource?.metadata?.config?.payload ||
    ""
  );
  const fallbackDocumentPayload = {
    title: "Knowledge Sample Profile",
    text: "Adam is a Trackers Lens sample user. Adam is 34 years old and lives in Rome. His favorite workspace is Crypto Monitor. Crypto Monitor tracks BTC price, ETH price and market alerts.",
    metadata: {
      source: "Flow Map Knowledge Test",
      category: "sample",
    },
  };
  const documentPayload = {
    ...(configuredDocumentPayload && typeof configuredDocumentPayload === "object" ? configuredDocumentPayload : fallbackDocumentPayload),
    metadata: {
      ...((configuredDocumentPayload && typeof configuredDocumentPayload.metadata === "object") ? configuredDocumentPayload.metadata : fallbackDocumentPayload.metadata),
      source: "Flow Map Knowledge Test",
      category: "sample",
    },
  };
  const documentTitle = String(documentPayload.title || "Knowledge Sample Profile");
  const collectionId = "knowledge_sample_current";
  const documentId = `knowledge_sample_document_${safeRuntimeId(workspaceId)}`;
  const configuredQueryPayload = parseManualJsonPayload(
    existingQuerySource?.metadata?.config?.json ||
    existingQuerySource?.metadata?.config?.testPayload ||
    existingQuerySource?.metadata?.config?.payload ||
    ""
  );
  const fallbackQueryText = "How old is Adam and which workspace does he use?";
  const queryPayload = {
    ...(configuredQueryPayload && typeof configuredQueryPayload === "object" ? configuredQueryPayload : {}),
    query: String(configuredQueryPayload?.query || configuredQueryPayload?.text || configuredQueryPayload?.question || fallbackQueryText),
    purpose: "knowledge-rag-sample",
  };
  const queryText = String(queryPayload.query || fallbackQueryText);
  const layout = (() => {
    const left = 140;
    const step = 340;
    const top = 140;
    const row = 300;
    return {
      docSource: { x: left, y: top },
      documentStore: { x: left + step, y: top },
      chunker: { x: left + step * 2, y: top },
      embedder: { x: left + step * 3, y: top },
      embeddingPreview: { x: left + step * 4, y: top },
      querySource: { x: left + step, y: top + row },
      rag: { x: left + step * 2.35, y: top + row },
      preview: { x: left + step * 3.65, y: top + row },
      aiDebugger: { x: left + step * 3.65, y: top + row * 1.82 },
      aiPreview: { x: left + step * 4.85, y: top + row * 1.82 },
    };
  })();
  const nodeBase = ({ name, type, label, inputs = [], outputs = [], x, y, width = FLOW_NODE_DEFAULT_WIDTH, tone, icon: iconName, subtype, category, config = {}, settingsSchema = {}, paletteLabel = label, paletteAction = "Knowledge sample" }) => ({
    id: id(name),
    workspaceId,
    type,
    label,
    sourceRef: id(name),
    assetId: id(name),
    inputs,
    outputs,
    channels: uniqueStrings([...inputs, ...outputs]),
    status: "active",
    flowPosition: { x, y, width },
    metadata: {
      configured: true,
      draft: false,
      paletteLabel,
      paletteAction,
      tone,
      icon: iconName,
      runtimeType: type,
      subtype,
      category,
      settingsSchema,
      config,
    },
  });
  const docSource = nodeBase({
    name: "document_source",
    type: "source",
    label: "Knowledge Doc Source",
    outputs: ["document"],
    ...layout.docSource,
    tone: "green",
    icon: "data_object",
    subtype: "manual-json",
    category: "sources",
    settingsSchema: { json: "object" },
    paletteLabel: "Manual JSON",
    paletteAction: "Source: Manual JSON",
    config: {
      emitChannel: "document",
      json: prettyRuntimeValue(documentPayload),
    },
  });
  const documentStore = nodeBase({
    name: "document_store",
    type: "knowledge",
    label: "Document Store Sample",
    inputs: ["document"],
    outputs: ["knowledge.document.created"],
    ...layout.documentStore,
    tone: "cyan",
    icon: "menu_book",
    subtype: "document-store",
    category: "knowledge",
    settingsSchema: { title: "string", sourceType: "manual|channel|json|markdown", language: "string", outputChannel: "string" },
    paletteLabel: "Document Store",
    config: {
      documentId,
      title: documentTitle,
      sourceType: "manual",
      language: "en",
      collectionId,
      outputChannel: "knowledge.document.created",
    },
  });
  const chunker = nodeBase({
    name: "chunker",
    type: "knowledge",
    label: "Chunk Processor Sample",
    inputs: ["knowledge.document.created"],
    outputs: ["knowledge.chunk.created"],
    ...layout.chunker,
    tone: "cyan",
    icon: "segment",
    subtype: "chunk-processor",
    category: "knowledge",
    settingsSchema: { chunkSize: "number", chunkOverlap: "number", strategy: "fixed|paragraph|markdown", outputChannel: "string" },
    paletteLabel: "Chunk Processor",
    config: {
      chunkSize: 360,
      chunkOverlap: 40,
      strategy: "fixed",
      collectionId,
      replaceExisting: true,
      outputChannel: "knowledge.chunk.created",
    },
  });
  const embedder = nodeBase({
    name: "embedder",
    type: "knowledge",
    label: "Embedding Generator Sample",
    inputs: ["knowledge.chunk.created"],
    outputs: ["knowledge.embedding.created"],
    ...layout.embedder,
    tone: "green",
    icon: "scatter_plot",
    subtype: "embedding-generator",
    category: "knowledge",
    settingsSchema: { providerProfile: "string", providerType: "string", model: "string", dimensions: "number", outputChannel: "string" },
    paletteLabel: "Embedding Generator",
    config: {
      providerProfile: "local-hash",
      providerType: "local",
      model: "tl-local-hash-v1",
      dimensions: 96,
      collectionId,
      outputChannel: "knowledge.embedding.created",
    },
  });
  const embeddingPreview = nodeBase({
    name: "embedding_preview",
    type: "devPreview",
    label: "Embedding Preview",
    inputs: ["raw"],
    outputs: ["output"],
    ...layout.embeddingPreview,
    tone: "blue",
    icon: "data_object",
    subtype: "preview",
    category: "dev",
    settingsSchema: { mode: "raw|json" },
    paletteLabel: "Preview",
    config: { previewMode: "json", maxChars: 5000 },
  });
  const querySource = nodeBase({
    name: "query_source",
    type: "source",
    label: "Knowledge Query Source",
    outputs: ["knowledge.search.query"],
    ...layout.querySource,
    tone: "green",
    icon: "help",
    subtype: "manual-json",
    category: "sources",
    settingsSchema: { json: "object" },
    paletteLabel: "Manual JSON",
    paletteAction: "Source: Manual JSON",
    config: {
      emitChannel: "knowledge.search.query",
      json: prettyRuntimeValue(queryPayload),
    },
  });
  const rag = nodeBase({
    name: "rag",
    type: "knowledge",
    label: "RAG Search Sample",
    inputs: ["knowledge.search.query", "knowledge.embedding.created"],
    outputs: ["knowledge.rag.context"],
    ...layout.rag,
    tone: "cyan",
    icon: "travel_explore",
    subtype: "rag-search",
    category: "knowledge",
    settingsSchema: { query: "string", topK: "number", similarityThreshold: "number", maxContextTokens: "number", includeMetadata: "boolean", outputChannel: "string" },
    paletteLabel: "RAG Search",
    config: {
      topK: 4,
      similarityThreshold: 0.02,
      maxContextTokens: 800,
      includeMetadata: true,
      collectionId,
      outputChannel: "knowledge.rag.context",
    },
  });
  const preview = nodeBase({
    name: "preview",
    type: "devPreview",
    label: "RAG Context Preview",
    inputs: ["raw"],
    outputs: ["output"],
    ...layout.preview,
    tone: "blue",
    icon: "visibility",
    subtype: "preview",
    category: "dev",
    settingsSchema: { mode: "raw|json" },
    paletteLabel: "Preview",
    config: { previewMode: "json", maxChars: 5000 },
  });
  const aiDebugger = nodeBase({
    name: "debugger",
    type: "aiAgent",
    label: "AI Answer Knowledge Sample",
    inputs: ["task"],
    outputs: ["diagnostic"],
    ...layout.aiDebugger,
    tone: "violet",
    icon: "bug_report",
    subtype: "debugger",
    category: "ai-agents",
    settingsSchema: { provider: "string", model: "string", expected: "string" },
    paletteLabel: "AI Debugger",
    config: {
      providerProfile: "local_lm_studio",
      providerType: "lm-studio",
      provider: "lm-studio",
      model: "local-model",
      inputDataMode: "off",
      memoryMode: "none",
      expected: "Answer the user query from RAG context",
      systemPrompt: "You answer using only the provided RAG context. If the answer is not in the context, say you do not know.",
      promptTemplate: "Question: {{payload.query}}\n\nRAG context:\n{{payload.context}}\n\nReturn a concise answer in the same language as the question.",
      output: "diagnostic",
      outputInstructions: "Return only the final answer. Do not include runtime metadata, old task history or unrelated market data.",
    },
  });
  aiDebugger.channels = ["task", "knowledge.rag.context"];
  const aiPreview = nodeBase({
    name: "ai_preview",
    type: "devPreview",
    label: "AI Answer Preview",
    inputs: ["raw"],
    outputs: ["output"],
    ...layout.aiPreview,
    tone: "blue",
    icon: "smart_toy",
    subtype: "preview",
    category: "dev",
    settingsSchema: { mode: "raw|json" },
    paletteLabel: "Preview",
    config: { previewMode: "json", maxChars: 6000 },
  });
  const nodes = [docSource, documentStore, chunker, embedder, embeddingPreview, querySource, rag, preview, aiDebugger, aiPreview];
  const links = [
    [docSource, documentStore, "document", "document"],
    [documentStore, chunker, "knowledge.document.created", "knowledge.document.created"],
    [chunker, embedder, "knowledge.chunk.created", "knowledge.chunk.created"],
    [embedder, embeddingPreview, "knowledge.embedding.created", "raw"],
    [embedder, rag, "knowledge.embedding.created", "knowledge.embedding.created"],
    [querySource, rag, "knowledge.search.query", "knowledge.search.query"],
    [rag, preview, "knowledge.rag.context", "raw"],
    [rag, aiDebugger, "knowledge.rag.context", "task"],
    [aiDebugger, aiPreview, "diagnostic", "raw"],
  ];
  const createKnowledgeSampleRuntimeLink = async ({ source, target, sourcePort, targetPort, index = 0 } = {}) => {
    const createdAt = new Date().toISOString();
    const channel = sourcePort;
    const connectionId = `knowledge_sample_conn_${now}_${index}`;
    const mapping = {
      mode: "pass-through",
      sourcePort,
      targetPort,
      channel,
      linkType: "data",
      note: "Knowledge sample auto-link",
    };
    const connection = {
      id: connectionId,
      name: `${source.label || source.id} -> ${target.label || target.id}`,
      type: `${source.type || "node"} -> ${target.type || "node"}`,
      from: source.label || source.id,
      fromKind: source.type || "node",
      to: target.label || target.id,
      targetMeta: target.sourceRef || target.assetId || target.id,
      status: "active",
      lastTest: "Mai",
      result: "Creato da Knowledge Test",
      method: "EVENT",
      frequency: channel,
      timeout: "10 secondi",
      retries: 0,
      createdAt,
      updatedAt: createdAt,
      endpoint: `flowmap://${workspaceId}/${connectionId}`,
      workspaceId,
      workspaceName: workspaceId,
      fromBoxId: source.id,
      toBoxId: target.id,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      sourceName: source.label || source.id,
      targetName: target.label || target.id,
      channel,
      mapping,
    };
    const dependency = {
      id: `dep_${workspaceId}_${connectionId}`.replace(/[^A-Za-z0-9_-]/g, "_"),
      workspaceId,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      sourceType: source.type || "node",
      targetType: target.type || "node",
      channel,
      connectionId,
      status: "active",
      metadata: {
        source: "flow-map-knowledge-sample",
        ...mapping,
      },
      createdAt,
      updatedAt: createdAt,
    };
    await window.TrackerLensConnectionsStore?.upsert?.(connection);
    await window.TrackerLensRuntimeGraphStore?.upsertDependency?.({ dependency });
    await recordFlowAction({
      workspaceId,
      connectionId,
      message: `Knowledge sample link created: ${connection.name}`,
      context: {
        action: "flow-map-knowledge-sample-link-created",
        sourceNodeId: source.id,
        targetNodeId: target.id,
        sourcePort,
        targetPort,
        channel,
      },
    });
    return dependency;
  };
  const cleanupKnowledgeSampleRecords = async () => {
    const knowledge = window.TrackerLensKnowledgeRuntime;
    if (!knowledge?.listStore || !knowledge?.deleteRecords) return { documents: 0, chunks: 0, embeddings: 0, queries: 0, sources: 0 };
    const stores = knowledge.STORES || {};
    const [documents, chunks, embeddings, queries, sources] = await Promise.all([
      knowledge.listStore(stores.documents),
      knowledge.listStore(stores.chunks),
      knowledge.listStore(stores.embeddings),
      knowledge.listStore(stores.queries),
      knowledge.listStore(stores.sources),
    ]);
    const sampleDocuments = (documents || [])
      .filter((item) => item.workspaceId === workspaceId)
      .filter((item) =>
        item.title === "Knowledge Sample Profile" ||
        item.title === documentTitle ||
        item.metadata?.collectionId === collectionId ||
        item.metadata?.source === "Flow Map Knowledge Test" ||
        String(item.text || "").includes("Adam is a Trackers Lens sample user"));
    const documentIds = new Set(sampleDocuments.map((item) => item.id));
    const sampleChunks = (chunks || [])
      .filter((item) => item.workspaceId === workspaceId)
      .filter((item) =>
        documentIds.has(item.documentId) ||
        item.metadata?.collectionId === collectionId ||
        item.metadata?.title === documentTitle ||
        item.metadata?.title === "Knowledge Sample Profile" ||
        String(item.text || "").includes("Adam is a Trackers Lens sample user") ||
        (String(item.text || "").includes("workspaceId") && String(item.text || "").includes("Knowledge Sample Profile")));
    const chunkIds = new Set(sampleChunks.map((item) => item.id));
    const sampleEmbeddings = (embeddings || [])
      .filter((item) => item.workspaceId === workspaceId)
      .filter((item) => documentIds.has(item.documentId) || chunkIds.has(item.chunkId) || item.metadata?.collectionId === collectionId);
    const sampleQueries = (queries || [])
      .filter((item) => item.workspaceId === workspaceId)
      .filter((item) => item.query === queryText || String(item.query || "").includes("Adam"));
    const sampleSources = (sources || [])
      .filter((item) => item.workspaceId === workspaceId)
      .filter((item) => documentIds.has(item.documentId));
    await Promise.all([
      knowledge.deleteRecords(stores.embeddings, sampleEmbeddings.map((item) => item.id)),
      knowledge.deleteRecords(stores.chunks, sampleChunks.map((item) => item.id)),
      knowledge.deleteRecords(stores.sources, sampleSources.map((item) => item.id)),
      knowledge.deleteRecords(stores.queries, sampleQueries.map((item) => item.id)),
      knowledge.deleteRecords(stores.documents, sampleDocuments.map((item) => item.id)),
    ]);
    return {
      documents: sampleDocuments.length,
      chunks: sampleChunks.length,
      embeddings: sampleEmbeddings.length,
      queries: sampleQueries.length,
      sources: sampleSources.length,
    };
  };

  state.testRun = {
    running: true,
    runId,
    nodeIds: nodes.map((node) => node.id),
    edgeIds: [],
    activeNodeIds: [docSource.id, documentStore.id, chunker.id, embedder.id, querySource.id, rag.id],
    activeEdgeIds: [],
    startedAt: new Date().toISOString(),
    completedAt: "",
    summary: "Running Knowledge sample test",
    timeoutId: 0,
    abortController: null,
    liveSockets: [],
    keepOpen: false,
    cancelRequested: false,
    verification: null,
  };
  state.error = "";
  startTestRunTimeout(runId, AI_DIRECT_TEST_TIMEOUT_MS);
  setFiltersState({ ...state.filters, runId });
  syncFilterQuery();
  mount({ preserveScroll: true });

  try {
    const staleSampleNodes = (state.runtime.nodes || [])
      .filter((node) => node.workspaceId === workspaceId)
      .filter((node) =>
        String(node.id || "").startsWith("knowledge_sample_") ||
        String(node.label || "").toLowerCase().includes("knowledge sample") ||
        String(node.metadata?.paletteAction || "").toLowerCase().includes("knowledge sample"));
    const staleIds = new Set(staleSampleNodes.map((node) => node.id));
    const staleConnections = (await Promise.resolve(window.TrackerLensConnectionsStore?.list?.() || []).catch(() => []))
      .filter((connection) => connection.workspaceId === workspaceId)
      .filter((connection) =>
        String(connection.id || "").startsWith("knowledge_sample_conn_") ||
        staleIds.has(connection.sourceNodeId || connection.fromBoxId) ||
        staleIds.has(connection.targetNodeId || connection.toBoxId));
    await window.TrackerLensConnectionsStore?.removeMany?.(staleConnections.map((connection) => connection.id));
    for (const node of staleSampleNodes) {
      await window.TrackerLensRuntimeGraphStore.deleteRuntimeNodeReferences?.({ nodeId: node.id, workspaceId });
    }
    const knowledgeCleanup = await cleanupKnowledgeSampleRecords();
    if (staleSampleNodes.length || staleConnections.length) await loadRuntime({ force: true, silent: true });
    for (const node of nodes) {
      await window.TrackerLensRuntimeGraphStore.upsertRuntimeNode({ node });
    }
    await loadRuntime({ force: true, silent: true });
    const edgeIds = [];
    for (const [index, link] of links.entries()) {
      const [source, target, sourcePort, targetPort] = link;
      const savedSource = nodeById(source.id) || source;
      const savedTarget = nodeById(target.id) || target;
      const dependency = await createKnowledgeSampleRuntimeLink({
        source: savedSource,
        target: savedTarget,
        sourcePort,
        targetPort,
        index,
      });
      if (!dependency?.id) {
        throw new Error(`Knowledge sample link non creato: ${source.label} (${sourcePort}) -> ${target.label} (${targetPort})`);
      }
      if (dependency?.id) edgeIds.push(dependency.id);
    }
    await loadRuntime({ force: true, silent: true });
    syncPageRuntimes(workspaceId);
    state.testRun = {
      ...state.testRun,
      edgeIds,
      activeEdgeIds: edgeIds,
    };
    const bus = workspaceEventBus(workspaceId);
    const docEvent = await bus.emit("document", {
      ...documentPayload,
      __test: true,
      runId,
      sourceNodeId: docSource.id,
      emittedAt: new Date().toISOString(),
    }, {
      workspaceId,
      flowId: flowIdForWorkspace(workspaceId),
      eventType: "flow_knowledge_sample_document",
      sourceNodeId: docSource.id,
      meta: { test: true, runId, origin: "knowledge-sample-test", rootNodeId: docSource.id },
    });
    if (docEvent) mergeRuntimeEvent(docEvent);
    const embeddingRecord = await waitForKnowledgeEmbeddingRecord({ workspaceId, title: documentTitle, timeoutMs: 5000 });
    if (!embeddingRecord?.id) {
      throw new Error("Knowledge sample embedding non creato: controlla Document Store -> Chunk Processor -> Embedding Generator");
    }
    const queryEvent = await bus.emit("knowledge.search.query", {
      ...queryPayload,
      __test: true,
      runId,
      sourceNodeId: querySource.id,
      emittedAt: new Date().toISOString(),
    }, {
      workspaceId,
      flowId: flowIdForWorkspace(workspaceId),
      eventType: "flow_knowledge_sample_query",
      sourceNodeId: querySource.id,
      meta: { test: true, runId, origin: "knowledge-sample-test", rootNodeId: querySource.id },
    });
    if (queryEvent) mergeRuntimeEvent(queryEvent);
    const queryRecord = await waitForKnowledgeQueryRecord({ workspaceId, query: queryText, timeoutMs: 5000 });
    const aiRag = await waitForKnowledgeAiRagJob({ workspaceId, runId, agentId: aiDebugger.id, query: queryText, timeoutMs: 10000 });
    const ragOk = Boolean(queryRecord?.context && queryRecord.resultCount > 0);
    const aiRagOk = Boolean(aiRag?.job && aiRag?.ragContext?.context);
    const ok = ragOk && aiRagOk;
    finishFlowMapTestRun({
      runId,
      summary: ok ? "Knowledge sample completed: RAG context generated and consumed by AI Agent" : "Knowledge sample created with warnings",
      error: ok ? "" : (ragOk ? "AI Agent non ha consumato il contesto RAG" : "Knowledge sample non ha generato risultati RAG"),
    });
    await recordFlowAction({
      workspaceId,
      nodeId: rag.id,
      level: ok ? "info" : "warning",
      message: ok ? "Knowledge sample test completed with AI RAG verification" : "Knowledge sample test completed with verification warnings",
      context: {
        action: "flow-map-knowledge-sample-test",
        runId,
        query: queryText,
        embeddingId: embeddingRecord?.id || "",
        embeddingDimensions: embeddingRecord?.dimensions || 0,
        resultCount: queryRecord?.resultCount || 0,
        contextPreview: String(queryRecord?.context || "").slice(0, 500),
        aiAgentId: aiDebugger.id,
        aiJobId: aiRag?.job?.id || "",
        aiJobStatus: aiRag?.job?.status || "",
        aiRagContext: Boolean(aiRag?.ragContext?.context),
        cleanup: knowledgeCleanup,
      },
    });
    await loadRuntime({ force: true, silent: true });
    const focusNode = aiRagOk ? aiDebugger : rag;
    setFocusState({ mode: "nodes", nodeId: focusNode.id, nodeType: focusNode.type, channel: aiRagOk ? "knowledge.rag.context" : "knowledge.rag.context", connectionId: "" });
    centerViewportOnNode?.(nodeById(focusNode.id) || focusNode, (state.runtime.nodes || []).findIndex((node) => node.id === focusNode.id), { select: true });
  } catch (error) {
    console.error("Flow Map knowledge sample test error:", error);
    state.error = error?.message || "Errore Knowledge sample Flow Map";
    finishFlowMapTestRun({ runId, summary: `Knowledge sample error: ${error.message || error}`, error: state.error });
    await recordFlowAction({
      workspaceId,
      level: "error",
      message: state.error,
      context: { action: "flow-map-knowledge-sample-test-error", runId, error: error.message || String(error) },
    });
    mount({ preserveScroll: true });
  }
};

const runKnowledgeGraphSampleTest = async () => {
  if (state.testRun.running) {
    const ageMs = Date.now() - Date.parse(state.testRun.startedAt || "");
    if (Number.isFinite(ageMs) && ageMs > TEST_RUN_TIMEOUT_MS) {
      finishFlowMapTestRun({ runId: state.testRun.runId, summary: "Previous Knowledge Graph sample test released after timeout" });
    } else {
      state.error = "Un test Flow Map è già in corso. Premi Stop o attendi la fine prima di lanciare Knowledge Graph Test.";
      mount({ preserveScroll: true });
      return;
    }
  }
  if (!window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode || !window.TrackerLensKnowledgeRuntime?.get) {
    state.error = "Knowledge Graph sample non disponibile: Runtime Graph Store o Knowledge Runtime non pronto.";
    await recordFlowAction({
      workspaceId: state.filters.workspaceId || "workspace_global",
      level: "error",
      message: state.error,
      context: {
        action: "flow-map-knowledge-graph-sample-not-ready",
        hasRuntimeGraphStore: Boolean(window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode),
        hasKnowledgeRuntime: Boolean(window.TrackerLensKnowledgeRuntime?.get),
      },
    });
    mount({ preserveScroll: true });
    return;
  }
  const workspaceId = state.filters.workspaceId || "workspace_global";
  const runId = testRunId().replace("flow_test", "flow_knowledge_graph_sample");
  const now = Date.now();
  const id = (name) => `knowledge_graph_sample_${name}_${now}`;
  const collectionId = "knowledge_graph_sample_current";
  const documentId = `knowledge_graph_sample_document_${safeRuntimeId(workspaceId)}`;
  const graphDocumentId = "";
  const documentPayload = {
    documentId,
    collectionId,
    title: "Knowledge Graph Sample Story",
    text: [
      "Juliette and Liber entered the dry forest to find a magic flower and a spring of water.",
      "A troll attacked Juliette, and Liber used a wooden stick to confront the troll.",
      "Juliette helped Liber prepare a red tea from the flower and water.",
      "Liber drank the red tea and shouted: I WANT TO SPEAK.",
      "Before the tea, Liber could not speak, and Juliette tried to help him.",
      "Liber and Juliette returned to the castle as friends with hope, courage and friendship.",
    ].join(" "),
    metadata: {
      source: "Flow Map Knowledge Graph Test",
      category: "sample",
      collectionId,
    },
  };
  const graphQueryText = "What does Liber use against the troll?";
  const graphQueryPayload = {
    query: graphQueryText,
    collectionId,
    documentId: graphDocumentId,
    depth: 2,
    topK: 12,
    maxRelations: 18,
    maxEvidence: 6,
    maxContextChars: 3200,
    includeEvidence: true,
    preferLatestDocument: true,
    purpose: "knowledge-graph-query-sample",
  };
  const layout = (() => {
    const left = 140;
    const step = 340;
    const top = 140;
    const row = 300;
    return {
      docSource: { x: left, y: top },
      documentStore: { x: left + step, y: top },
      chunker: { x: left + step * 2, y: top },
      extractor: { x: left + step * 3, y: top },
      semantic: { x: left + step * 4, y: top },
      graph: { x: left + step * 5, y: top },
      preview: { x: left + step * 6, y: top },
      querySource: { x: left + step * 2.8, y: top + row },
      graphQuery: { x: left + step * 5, y: top + row },
      reasoning: { x: left + step * 6.2, y: top + row },
      contextPreview: { x: left + step * 7.4, y: top + row },
      aiGraph: { x: left + step * 5, y: top + row * 2 },
      aiPreview: { x: left + step * 6.2, y: top + row * 2 },
    };
  })();
  const nodeBase = ({ name, type, label, inputs = [], outputs = [], x, y, width = FLOW_NODE_DEFAULT_WIDTH, tone, icon: iconName, subtype, category, config = {}, settingsSchema = {}, paletteLabel = label, paletteAction = "Knowledge Graph sample" }) => ({
    id: id(name),
    workspaceId,
    type,
    label,
    sourceRef: id(name),
    assetId: id(name),
    inputs,
    outputs,
    channels: uniqueStrings([...inputs, ...outputs]),
    status: "active",
    flowPosition: { x, y, width },
    metadata: {
      configured: true,
      draft: false,
      paletteLabel,
      paletteAction,
      tone,
      icon: iconName,
      runtimeType: type,
      subtype,
      category,
      settingsSchema,
      config,
    },
  });
  const docSource = nodeBase({
    name: "document_source",
    type: "source",
    label: "Knowledge Graph Doc Source",
    outputs: ["document"],
    ...layout.docSource,
    tone: "green",
    icon: "data_object",
    subtype: "manual-json",
    category: "sources",
    settingsSchema: { json: "object" },
    paletteLabel: "Manual JSON",
    paletteAction: "Source: Manual JSON",
    config: {
      emitChannel: "document",
      json: prettyRuntimeValue(documentPayload),
    },
  });
  const documentStore = nodeBase({
    name: "document_store",
    type: "knowledge",
    label: "Graph Document Store",
    inputs: ["document"],
    outputs: ["knowledge.document.created"],
    ...layout.documentStore,
    tone: "cyan",
    icon: "menu_book",
    subtype: "document-store",
    category: "knowledge",
    settingsSchema: { title: "string", sourceType: "manual|channel|json|markdown", language: "string", outputChannel: "string" },
    paletteLabel: "Document Store",
    config: {
      documentId,
      title: documentPayload.title,
      sourceType: "manual",
      language: "en",
      collectionId,
      outputChannel: "knowledge.document.created",
    },
  });
  const chunker = nodeBase({
    name: "chunker",
    type: "knowledge",
    label: "Graph Chunk Processor",
    inputs: ["knowledge.document.created"],
    outputs: ["knowledge.chunk.created"],
    ...layout.chunker,
    tone: "cyan",
    icon: "segment",
    subtype: "chunk-processor",
    category: "knowledge",
    settingsSchema: { chunkSize: "number", chunkOverlap: "number", strategy: "fixed|paragraph|markdown", outputChannel: "string" },
    paletteLabel: "Chunk Processor",
    config: {
      chunkSize: 520,
      chunkOverlap: 60,
      strategy: "paragraph",
      collectionId,
      replaceExisting: true,
      outputChannel: "knowledge.chunk.created",
    },
  });
  const extractor = nodeBase({
    name: "entity_extractor",
    type: "knowledge",
    label: "Graph Entity Extractor",
    inputs: ["knowledge.chunk.created"],
    outputs: ["knowledge.entity.created", "knowledge.relation.created"],
    ...layout.extractor,
    tone: "green",
    icon: "account_tree",
    subtype: "entity-extractor",
    category: "knowledge",
    settingsSchema: { extractionMode: "strict|balanced|wide", seedTerms: "string", confidenceThreshold: "number", maxEntities: "number", maxRelations: "number", collectionId: "string", outputChannel: "string" },
    paletteLabel: "Entity Extractor",
    config: {
      extractionMode: "balanced",
      seedTerms: "Juliette,Liber,troll,forest,flower,water,tea,castle,hope,courage,friendship",
      confidenceThreshold: 0.45,
      maxEntities: 80,
      maxRelations: 160,
      collectionId,
      outputChannel: "knowledge.entity.created",
    },
  });
  const semantic = nodeBase({
    name: "semantic_enricher",
    type: "knowledge",
    label: "Semantic Relation Enricher",
    inputs: ["knowledge.relation.created"],
    outputs: ["knowledge.semantic.relations", "knowledge.graph.enriched"],
    ...layout.semantic,
    tone: "cyan",
    icon: "psychology",
    subtype: "semantic-relation-enricher",
    category: "knowledge",
    settingsSchema: { enrichmentMode: "rules|ai|hybrid", maxRelations: "number", confidenceThreshold: "number", relationTypes: "string", collectionId: "string", outputChannel: "string" },
    paletteLabel: "Semantic Relation Enricher",
    config: {
      enrichmentMode: "ai",
      maxRelations: 80,
      confidenceThreshold: 0.52,
      collectionId,
      documentId: graphDocumentId,
      outputChannel: "knowledge.semantic.relations",
    },
  });
  const graph = nodeBase({
    name: "knowledge_graph",
    type: "knowledge",
    label: "Knowledge Graph Sample",
    inputs: ["knowledge.entity.created", "knowledge.relation.created", "knowledge.semantic.relations"],
    outputs: ["knowledge.graph.updated"],
    ...layout.graph,
    tone: "cyan",
    icon: "hub",
    subtype: "knowledge-graph",
    category: "knowledge",
    settingsSchema: { graphScope: "workspace|document|collection", autoClearGraph: "boolean", outputChannel: "string" },
    paletteLabel: "Knowledge Graph",
    config: {
      graphScope: "collection",
      autoClearGraph: false,
      documentId: "",
      collectionId,
      maxRelations: 160,
      outputChannel: "knowledge.graph.updated",
    },
  });
  const preview = nodeBase({
    name: "graph_preview",
    type: "devPreview",
    label: "Graph Snapshot Preview",
    inputs: ["raw"],
    outputs: ["output"],
    ...layout.preview,
    tone: "blue",
    icon: "visibility",
    subtype: "preview",
    category: "dev",
    settingsSchema: { mode: "raw|json" },
    paletteLabel: "Preview",
    config: { previewMode: "json", maxChars: 6000 },
  });
  const querySource = nodeBase({
    name: "query_source",
    type: "source",
    label: "Graph Query Source",
    outputs: ["knowledge.graph.query"],
    ...layout.querySource,
    tone: "green",
    icon: "help",
    subtype: "manual-json",
    category: "sources",
    settingsSchema: { json: "object" },
    paletteLabel: "Manual JSON",
    paletteAction: "Source: Manual JSON",
    config: {
      emitChannel: "knowledge.graph.query",
      json: prettyRuntimeValue(graphQueryPayload),
    },
  });
  const graphQuery = nodeBase({
    name: "graph_query",
    type: "knowledge",
    label: "Graph Query Sample",
    inputs: ["knowledge.graph.query", "knowledge.graph.updated"],
    outputs: ["knowledge.graph.context"],
    ...layout.graphQuery,
    tone: "cyan",
    icon: "manage_search",
    subtype: "graph-query",
    category: "knowledge",
    settingsSchema: { query: "string", depth: "number", topK: "number", maxRelations: "number", maxEvidence: "number", evidenceMode: "focused|balanced|full_ordered|debug_trace", includeAdjacentChunks: "boolean", preserveDocumentOrder: "boolean", protectedEvidence: "boolean", relationTypes: "string", includeEvidence: "boolean", graphScope: "workspace|document|collection", collectionId: "string", documentId: "string", outputChannel: "string" },
    paletteLabel: "Graph Query",
    config: {
      depth: 2,
      topK: 12,
      maxRelations: 18,
      maxEvidence: 6,
      evidenceMode: "balanced",
      includeAdjacentChunks: false,
      preserveDocumentOrder: false,
      protectedEvidence: true,
      maxContextChars: 3200,
      includeEvidence: true,
      graphScope: "collection",
      preferLatestDocument: false,
      collectionId,
      documentId: "",
      outputChannel: "knowledge.graph.context",
    },
  });
  const contextPreview = nodeBase({
    name: "graph_context_preview",
    type: "devPreview",
    label: "Graph Context Preview",
    inputs: ["raw"],
    outputs: ["output"],
    ...layout.contextPreview,
    tone: "blue",
    icon: "data_object",
    subtype: "preview",
    category: "dev",
    settingsSchema: { mode: "raw|json" },
    paletteLabel: "Preview",
    config: { previewMode: "json", maxChars: 7000 },
  });
  const reasoning = nodeBase({
    name: "reasoning_composer",
    type: "knowledge",
    label: "Knowledge Reasoning Composer",
    inputs: ["knowledge.graph.context"],
    outputs: ["knowledge.reasoning.plan", "knowledge.graph.context"],
    ...layout.reasoning,
    tone: "cyan",
    icon: "schema",
    subtype: "knowledge-reasoning-composer",
    category: "knowledge",
    settingsSchema: { compositionMode: "rules|llm|hybrid", intentMode: "auto|source|mechanism|definition|timeline|comparison|fact", providerProfile: "string", providerType: "string", model: "string", temperature: "number", maxTokens: "number", topP: "number", streaming: "boolean", responseFormat: "json|structured|text|markdown", systemPrompt: "string", promptTemplate: "string", outputInstructions: "string", maxFacts: "number", maxEvents: "number", includeBackground: "boolean", maxContextChars: "number", outputChannel: "string" },
    paletteLabel: "Knowledge Reasoning Composer",
    config: {
      compositionMode: "llm",
      intentMode: "auto",
      providerProfile: "local_lm_studio",
      providerType: "lm-studio",
      provider: "lm-studio",
      model: "local-model",
      temperature: 0.05,
      maxTokens: 900,
      maxFacts: 14,
      maxEvents: 12,
      includeBackground: false,
      maxContextChars: 4800,
      outputChannel: "knowledge.graph.context",
    },
  });
  const aiGraph = nodeBase({
    name: "graph_ai",
    type: "aiAgent",
    label: "AI Graph Answer Sample",
    inputs: ["task"],
    outputs: ["diagnostic"],
    ...layout.aiGraph,
    tone: "violet",
    icon: "psychology",
    subtype: "debugger",
    category: "ai-agents",
    settingsSchema: { provider: "string", model: "string", expected: "string" },
    paletteLabel: "AI Debugger",
    config: {
      providerProfile: "local_lm_studio",
      providerType: "lm-studio",
      provider: "lm-studio",
      model: "local-model",
      inputDataMode: "off",
      memoryMode: "none",
      emitMode: "clean",
      expected: "Answer the user query from Knowledge Graph context",
      systemPrompt: [
        "You are an evidence-grounded Knowledge Graph answer agent.",
        "",
        "Answer only from the provided Knowledge Graph context, reasoning facts and source evidence.",
        "Do not add facts, numbers, order markers, quantities, colors, names, places or causal steps unless they are explicitly present in the provided evidence.",
        "If the evidence says \"un fiore\" or \"a flower\", do not infer \"second flower\", \"another flower\" or any count not stated.",
        "Do not merge separate source details into a new label. If evidence says \"sorgente d'acqua cristallina\" and separately says it emanates \"luce magica\", do not rewrite it as \"fonte magica\" or \"sorgente magica\" unless that exact phrase appears in evidence.",
        "Prefer the structured required facts for the answer sequence, and use source excerpts only to support wording.",
        "If the provided evidence is insufficient, say exactly what evidence is missing.",
      ].join("\n"),
      promptTemplate: [
        "Question:",
        "{{payload.query}}",
        "",
        "Required facts and evidence:",
        "{{payload.reasoningPlan}}",
        "",
        "Knowledge Graph context:",
        "{{payload.context}}",
        "",
        "Answer in the same language as the question.",
        "Use natural prose.",
        "Do not mention runtime metadata, graph internals, IDs, scores or confidence.",
      ].join("\n"),
      output: "diagnostic",
      outputInstructions: [
        "Return only the final answer.",
        "",
        "Before answering, silently check every concrete detail against the provided evidence.",
        "Do not include any detail that is not explicitly supported by the context.",
        "When naming objects, places or substances, preserve the wording used by the evidence instead of inventing compressed labels.",
      ].join("\n"),
    },
  });
  aiGraph.channels = ["task", "knowledge.graph.context"];
  const aiPreview = nodeBase({
    name: "graph_ai_preview",
    type: "devPreview",
    label: "AI Graph Answer Preview",
    inputs: ["raw"],
    outputs: ["output"],
    ...layout.aiPreview,
    tone: "blue",
    icon: "smart_toy",
    subtype: "preview",
    category: "dev",
    settingsSchema: { mode: "raw|json" },
    paletteLabel: "Preview",
    config: { previewMode: "json", maxChars: 6000 },
  });
  const nodes = [docSource, documentStore, chunker, extractor, semantic, graph, preview, querySource, graphQuery, reasoning, contextPreview, aiGraph, aiPreview];
  const links = [
    [docSource, documentStore, "document", "document"],
    [documentStore, chunker, "knowledge.document.created", "knowledge.document.created"],
    [chunker, extractor, "knowledge.chunk.created", "knowledge.chunk.created"],
    [extractor, semantic, "knowledge.relation.created", "knowledge.relation.created"],
    [extractor, graph, "knowledge.relation.created", "knowledge.relation.created"],
    [semantic, graph, "knowledge.semantic.relations", "knowledge.semantic.relations"],
    [graph, preview, "knowledge.graph.updated", "raw"],
    [graph, graphQuery, "knowledge.graph.updated", "knowledge.graph.updated"],
    [querySource, graphQuery, "knowledge.graph.query", "knowledge.graph.query"],
    [graphQuery, reasoning, "knowledge.graph.context", "knowledge.graph.context"],
    [reasoning, contextPreview, "knowledge.graph.context", "raw"],
    [reasoning, aiGraph, "knowledge.graph.context", "task"],
    [aiGraph, aiPreview, "diagnostic", "raw"],
  ];
  const createKnowledgeGraphSampleRuntimeLink = async ({ source, target, sourcePort, targetPort, index = 0 } = {}) => {
    const createdAt = new Date().toISOString();
    const channel = sourcePort;
    const connectionId = `knowledge_graph_sample_conn_${now}_${index}`;
    const mapping = {
      mode: "pass-through",
      sourcePort,
      targetPort,
      channel,
      linkType: "data",
      note: "Knowledge Graph sample auto-link",
    };
    const dependency = {
      id: `dep_${workspaceId}_${connectionId}`.replace(/[^A-Za-z0-9_-]/g, "_"),
      workspaceId,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      sourceType: source.type || "node",
      targetType: target.type || "node",
      channel,
      connectionId,
      status: "active",
      metadata: { source: "flow-map-knowledge-graph-sample", ...mapping },
      createdAt,
      updatedAt: createdAt,
    };
    const connection = {
      id: connectionId,
      name: `${source.label || source.id} -> ${target.label || target.id}`,
      type: `${source.type || "node"} -> ${target.type || "node"}`,
      from: source.label || source.id,
      fromKind: source.type || "node",
      to: target.label || target.id,
      targetMeta: target.sourceRef || target.assetId || target.id,
      status: "active",
      lastTest: "Mai",
      result: "Creato da Knowledge Graph Test",
      method: "EVENT",
      frequency: channel,
      timeout: "10 secondi",
      retries: 0,
      createdAt,
      updatedAt: createdAt,
      endpoint: `flowmap://${workspaceId}/${connectionId}`,
      workspaceId,
      workspaceName: workspaceId,
      fromBoxId: source.id,
      toBoxId: target.id,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      sourceName: source.label || source.id,
      targetName: target.label || target.id,
      channel,
      mapping,
    };
    await window.TrackerLensConnectionsStore?.upsert?.(connection);
    await window.TrackerLensRuntimeGraphStore?.upsertDependency?.({ dependency });
    return dependency;
  };
  const cleanupKnowledgeGraphSampleRecords = async () => {
    const knowledge = window.TrackerLensKnowledgeRuntime;
    if (!knowledge?.listStore || !knowledge?.deleteRecords) return { documents: 0, chunks: 0, entities: 0, relations: 0, queries: 0, metrics: 0 };
    const stores = knowledge.STORES || {};
    const [documents, chunks, entities, relations, queries, metrics] = await Promise.all([
      knowledge.listStore(stores.documents),
      knowledge.listStore(stores.chunks),
      knowledge.listStore(stores.entities),
      knowledge.listStore(stores.relations),
      knowledge.listStore(stores.queries),
      knowledge.listStore(stores.metrics),
    ]);
    const sampleDocuments = (documents || [])
      .filter((item) => item.workspaceId === workspaceId)
      .filter((item) =>
        item.id === documentId ||
        item.title === documentPayload.title ||
        item.metadata?.collectionId === collectionId ||
        item.metadata?.source === "Flow Map Knowledge Graph Test");
    const documentIds = new Set(sampleDocuments.map((item) => item.id));
    const sampleChunks = (chunks || [])
      .filter((item) => item.workspaceId === workspaceId)
      .filter((item) => documentIds.has(item.documentId) || item.metadata?.collectionId === collectionId || item.metadata?.title === documentPayload.title);
    const chunkIds = new Set(sampleChunks.map((item) => item.id));
    const sampleEntities = (entities || [])
      .filter((item) => item.workspaceId === workspaceId)
      .filter((item) => documentIds.has(item.documentId) || chunkIds.has(item.chunkId) || item.metadata?.collectionId === collectionId);
    const entityIds = new Set(sampleEntities.map((item) => item.id));
    const sampleRelations = (relations || [])
      .filter((item) => item.workspaceId === workspaceId)
      .filter((item) =>
        documentIds.has(item.documentId) ||
        item.metadata?.collectionId === collectionId ||
        entityIds.has(item.sourceEntityId) ||
        entityIds.has(item.targetEntityId));
    const sampleQueries = (queries || [])
      .filter((item) => item.workspaceId === workspaceId)
      .filter((item) =>
        item.scope?.collectionId === collectionId ||
        item.scope?.documentId === documentId ||
        String(item.query || "") === graphQueryText);
    const sampleMetrics = (metrics || [])
      .filter((item) => item.workspaceId === workspaceId)
      .filter((item) => item.value?.collectionId === collectionId || item.value?.documentId === documentId);
    await Promise.all([
      knowledge.deleteRecords(stores.relations, sampleRelations.map((item) => item.id)),
      knowledge.deleteRecords(stores.entities, sampleEntities.map((item) => item.id)),
      knowledge.deleteRecords(stores.chunks, sampleChunks.map((item) => item.id)),
      knowledge.deleteRecords(stores.queries, sampleQueries.map((item) => item.id)),
      knowledge.deleteRecords(stores.metrics, sampleMetrics.map((item) => item.id)),
      knowledge.deleteRecords(stores.documents, sampleDocuments.map((item) => item.id)),
    ]);
    return {
      documents: sampleDocuments.length,
      chunks: sampleChunks.length,
      entities: sampleEntities.length,
      relations: sampleRelations.length,
      queries: sampleQueries.length,
      metrics: sampleMetrics.length,
    };
  };

  state.testRun = {
    running: true,
    runId,
    nodeIds: nodes.map((node) => node.id),
    edgeIds: [],
    activeNodeIds: nodes.map((node) => node.id),
    activeEdgeIds: [],
    startedAt: new Date().toISOString(),
    completedAt: "",
    summary: "Running Knowledge Graph sample test",
    timeoutId: 0,
    abortController: null,
    liveSockets: [],
    keepOpen: false,
    cancelRequested: false,
    verification: null,
  };
  state.error = "";
  startTestRunTimeout(runId, TEST_RUN_TIMEOUT_MS);
  setFiltersState({ ...state.filters, runId });
  syncFilterQuery();
  mount({ preserveScroll: true });

  try {
    const staleSampleNodes = (state.runtime.nodes || [])
      .filter((node) => node.workspaceId === workspaceId)
      .filter((node) =>
        String(node.id || "").startsWith("knowledge_graph_sample_") ||
        String(node.label || "").toLowerCase().includes("knowledge graph sample") ||
        String(node.metadata?.paletteAction || "").toLowerCase().includes("knowledge graph sample"));
    const staleIds = new Set(staleSampleNodes.map((node) => node.id));
    const staleConnections = (await Promise.resolve(window.TrackerLensConnectionsStore?.list?.() || []).catch(() => []))
      .filter((connection) => connection.workspaceId === workspaceId)
      .filter((connection) =>
        String(connection.id || "").startsWith("knowledge_graph_sample_conn_") ||
        staleIds.has(connection.sourceNodeId || connection.fromBoxId) ||
        staleIds.has(connection.targetNodeId || connection.toBoxId));
    const runtimeDependencyStore = runtimeStoreName("TL_RUNTIME_DEPENDENCIES", "tl_runtime_dependencies");
    const staleRuntimeDependencies = (await window.TrackerLensRuntimeGraphStore?.readAll?.(runtimeDependencyStore).catch(() => []))
      .filter((dependency) => dependency.workspaceId === workspaceId)
      .filter((dependency) =>
        String(dependency.id || "").startsWith("knowledge_graph_sample_conn_") ||
        String(dependency.metadata?.source || "") === "flow-map-knowledge-graph-sample" ||
        staleIds.has(dependency.sourceNodeId) ||
        staleIds.has(dependency.targetNodeId));
    await window.TrackerLensConnectionsStore?.removeMany?.(staleConnections.map((connection) => connection.id));
    await window.TrackerLensRuntimeGraphStore?.deleteRecords?.(runtimeDependencyStore, staleRuntimeDependencies.map((dependency) => dependency.id));
    for (const node of staleSampleNodes) {
      await window.TrackerLensRuntimeGraphStore.deleteRuntimeNodeReferences?.({ nodeId: node.id, workspaceId });
    }
    const knowledgeCleanup = await cleanupKnowledgeGraphSampleRecords();
    if (staleSampleNodes.length || staleConnections.length || staleRuntimeDependencies.length) await loadRuntime({ force: true, silent: true });
    for (const node of nodes) {
      await window.TrackerLensRuntimeGraphStore.upsertRuntimeNode({ node });
    }
    await loadRuntime({ force: true, silent: true });
    const edgeIds = [];
    for (const [index, link] of links.entries()) {
      const [source, target, sourcePort, targetPort] = link;
      const savedSource = nodeById(source.id) || source;
      const savedTarget = nodeById(target.id) || target;
      const dependency = await createKnowledgeGraphSampleRuntimeLink({ source: savedSource, target: savedTarget, sourcePort, targetPort, index });
      if (!dependency?.id) throw new Error(`Knowledge Graph sample link non creato: ${source.label} (${sourcePort}) -> ${target.label} (${targetPort})`);
      edgeIds.push(dependency.id);
    }
    await loadRuntime({ force: true, silent: true });
    syncPageRuntimes(workspaceId);
    state.testRun = {
      ...state.testRun,
      edgeIds,
      activeEdgeIds: edgeIds,
    };
    const bus = workspaceEventBus(workspaceId);
    const docEvent = await bus.emit("document", {
      ...documentPayload,
      __test: true,
      runId,
      sourceNodeId: docSource.id,
      emittedAt: new Date().toISOString(),
    }, {
      workspaceId,
      flowId: flowIdForWorkspace(workspaceId),
      eventType: "flow_knowledge_graph_sample_document",
      sourceNodeId: docSource.id,
      meta: { test: true, runId, origin: "knowledge-graph-sample-test", rootNodeId: docSource.id },
    });
    if (docEvent) mergeRuntimeEvent(docEvent);
    const snapshot = await waitForKnowledgeGraphSnapshot({ workspaceId, collectionId, timeoutMs: 8000 });
    const effectiveDocumentId = snapshot?.value?.documentId || documentId;
    const semanticBeforeQuery = await waitForKnowledgeSemanticRelations({ workspaceId, collectionId, documentId: effectiveDocumentId, timeoutMs: 8000 });
    const queryEvent = await bus.emit("knowledge.graph.query", {
      ...graphQueryPayload,
      __test: true,
      runId,
      sourceNodeId: querySource.id,
      emittedAt: new Date().toISOString(),
    }, {
      workspaceId,
      flowId: flowIdForWorkspace(workspaceId),
      eventType: "flow_knowledge_graph_sample_query",
      sourceNodeId: querySource.id,
      meta: { test: true, runId, origin: "knowledge-graph-sample-test", rootNodeId: querySource.id },
    });
    if (queryEvent) mergeRuntimeEvent(queryEvent);
    const graphContext = await waitForKnowledgeGraphQueryRecord({ workspaceId, query: graphQueryText, timeoutMs: 6000 });
    const aiGraphResult = await waitForKnowledgeAiGraphJob({ workspaceId, runId, agentId: aiGraph.id, query: graphQueryText, timeoutMs: 9000 });
    const normalizeKnowledgeLabel = (value = "") =>
      String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, " ")
        .trim();
    const weakEntityTokens = new Set(["doveva", "viene", "aveva", "siamo", "poiche", "sommo"]);
    const knowledgeStores = window.TrackerLensKnowledgeRuntime?.STORES || {};
    const [verifiedEntities, verifiedRelations] = await Promise.all([
      window.TrackerLensKnowledgeRuntime?.listStore?.(knowledgeStores.entities),
      window.TrackerLensKnowledgeRuntime?.listStore?.(knowledgeStores.relations),
    ]).catch(() => [[], []]);
    const scopedEntities = (verifiedEntities || [])
      .filter((item) => item.workspaceId === workspaceId)
      .filter((item) => item.documentId === effectiveDocumentId || item.metadata?.collectionId === collectionId);
    const weakEntities = scopedEntities
      .filter((item) => weakEntityTokens.has(normalizeKnowledgeLabel(item.label)))
      .map((item) => item.label);
    const entityById = new Map(scopedEntities.map((item) => [item.id, item]));
    const staleSourceCoOccurs = (verifiedRelations || [])
      .filter((item) => item.workspaceId === workspaceId)
      .filter((item) => item.documentId === effectiveDocumentId || item.metadata?.collectionId === collectionId)
      .filter((item) => String(item.relationType || "") === "co_occurs")
      .filter((item) => {
        const source = entityById.get(item.sourceEntityId);
        const target = entityById.get(item.targetEntityId);
        return source?.entityType === "source" && target?.entityType === "source";
      })
      .map((item) => `${item.sourceLabel || item.sourceEntityId} -> ${item.targetLabel || item.targetEntityId}`);
    const semanticRelations = (verifiedRelations || [])
      .filter((item) => item.workspaceId === workspaceId)
      .filter((item) => item.documentId === effectiveDocumentId || item.metadata?.collectionId === collectionId)
      .filter((item) => item.metadata?.semantic === true);
    const ok = Boolean(
      snapshot?.value?.entityCount > 0 &&
      snapshot?.value?.relationCount > 0 &&
      semanticRelations.length > 0 &&
      semanticBeforeQuery.length > 0 &&
      graphContext?.context &&
      aiGraphResult.graphContext?.context &&
      !weakEntities.length &&
      !staleSourceCoOccurs.length
    );
    const qualityWarnings = [
      weakEntities.length ? `Weak entities still present: ${weakEntities.slice(0, 6).join(", ")}` : "",
      staleSourceCoOccurs.length ? `Source co_occurs still present: ${staleSourceCoOccurs.slice(0, 6).join(", ")}` : "",
      !semanticRelations.length ? "No semantic relations generated" : "",
      !semanticBeforeQuery.length ? "Semantic relations were not ready before graph query" : "",
    ].filter(Boolean);
    finishFlowMapTestRun({
      runId,
      summary: ok ? "Knowledge Graph sample completed: graph context generated and consumed by AI Agent" : "Knowledge Graph sample created with warnings",
      error: ok ? "" : qualityWarnings.join(" | ") || "Knowledge Graph sample non ha generato graph context o job AI valido",
    });
    await recordFlowAction({
      workspaceId,
      nodeId: graphQuery.id,
      level: ok ? "info" : "warning",
      message: ok ? "Knowledge Graph sample test completed" : "Knowledge Graph sample test completed without valid graph context",
      context: {
        action: "flow-map-knowledge-graph-sample-test",
        runId,
        snapshotId: snapshot?.id || "",
        entityCount: snapshot?.value?.entityCount || 0,
        relationCount: snapshot?.value?.relationCount || 0,
        semanticRelationCount: snapshot?.value?.semanticRelationCount || semanticRelations.length || 0,
        semanticBeforeQuery: semanticBeforeQuery.length,
        graphQueryId: graphContext?.id || "",
        graphContextEntities: graphContext?.entities?.length || 0,
        graphContextRelations: graphContext?.relations?.length || 0,
        aiJobId: aiGraphResult.job?.id || "",
        weakEntities,
        staleSourceCoOccurs,
        semanticRelations: semanticRelations.slice(0, 12).map((relation) => ({
          source: relation.sourceLabel,
          type: relation.relationType,
          target: relation.targetLabel,
          method: relation.extraction?.method || "",
        })),
        collectionId,
        documentId: effectiveDocumentId,
        configuredDocumentId: documentId,
        cleanup: knowledgeCleanup,
      },
    });
    await loadRuntime({ force: true, silent: true });
    setFocusState({ mode: "nodes", nodeId: graphQuery.id, nodeType: "knowledge", channel: "knowledge.graph.context", connectionId: "" });
    centerViewportOnNode?.(nodeById(graphQuery.id) || graphQuery, (state.runtime.nodes || []).findIndex((node) => node.id === graphQuery.id), { select: true });
  } catch (error) {
    console.error("Flow Map Knowledge Graph sample test error:", error);
    state.error = error?.message || "Errore Knowledge Graph sample Flow Map";
    finishFlowMapTestRun({ runId, summary: `Knowledge Graph sample error: ${error.message || error}`, error: state.error });
    await recordFlowAction({
      workspaceId,
      level: "error",
      message: state.error,
      context: { action: "flow-map-knowledge-graph-sample-test-error", runId, error: error.message || String(error) },
    });
    mount({ preserveScroll: true });
  }
};

const runKnowledgeAgentToolsSampleTest = async () => {
  if (state.testRun.running) {
    const ageMs = Date.now() - Date.parse(state.testRun.startedAt || "");
    if (Number.isFinite(ageMs) && ageMs > TEST_RUN_TIMEOUT_MS) {
      finishFlowMapTestRun({ runId: state.testRun.runId, summary: "Previous Knowledge Agent Tools sample test released after timeout" });
    } else {
      state.error = "Un test Flow Map è già in corso. Premi Stop o attendi la fine prima di lanciare Agent Tools Test.";
      mount({ preserveScroll: true });
      return;
    }
  }
  if (!window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode || !window.TrackerLensKnowledgeRuntime?.get || !window.TrackerLensAiAgentRuntime?.get) {
    state.error = "Agent Tools sample non disponibile: Runtime Graph Store, Knowledge Runtime o AI Agent Runtime non pronto.";
    mount({ preserveScroll: true });
    return;
  }

  const workspaceId = state.filters.workspaceId || "workspace_global";
  const runId = testRunId().replace("flow_test", "flow_agent_tools_sample");
  const now = Date.now();
  const id = (name) => `knowledge_agent_tools_sample_${name}_${now}`;
  const aiConfigDefaults = await runtimeDefaultAiConfigForDialog()
    .then((result) => result || { providers: [], defaults: {} })
    .catch(() => ({}));
  const aiProviders = aiConfigDefaults.providers || [];
  const aiDefaults = aiConfigDefaults.defaults || {};
  const normalizedDefaultProvider = String(aiDefaults.providerProfile || aiDefaults.providerType || "").toLowerCase().replace(/[\s_-]+/g, "");
  const sampleProvider = aiProviders.find((provider) => provider.id === aiDefaults.providerProfile)
    || aiProviders.find((provider) => {
      const candidates = [provider.id, provider.name, provider.provider, provider.providerType].map((value) => String(value || "").toLowerCase().replace(/[\s_-]+/g, ""));
      return candidates.some((candidate) => candidate && (candidate === normalizedDefaultProvider || candidate.includes(normalizedDefaultProvider) || normalizedDefaultProvider.includes(candidate)));
    })
    || aiProviders.find((provider) => provider.id === "local_lm_studio")
    || aiProviders.find((provider) => String(provider.provider || provider.providerType || "").toLowerCase().includes("lm-studio"))
    || {};
  const sampleModel = await resolveRuntimeTestAiModel({ provider: sampleProvider, requested: aiDefaults.model || sampleProvider.model || sampleProvider.defaultModel || "" });
  const sampleAiConfig = {
    providerProfile: aiDefaults.providerProfile || sampleProvider.id || "local_lm_studio",
    providerType: aiDefaults.providerType || sampleProvider.providerType || sampleProvider.provider || "lm-studio",
    provider: aiDefaults.providerType || sampleProvider.providerType || sampleProvider.provider || "lm-studio",
    model: sampleModel || aiDefaults.model || "local-model",
    temperature: aiDefaults.temperature ?? 0.2,
    maxTokens: aiDefaults.maxTokens ?? 2048,
    topP: aiDefaults.topP ?? 0.9,
    responseFormat: "json",
  };
  const collectionId = "knowledge_agent_tools_sample_current";
  const documentId = `knowledge_agent_tools_document_${safeRuntimeId(workspaceId)}`;
  const questionText = "che nemico hanno trovato?";
  const documentPayload = {
    documentId,
    collectionId,
    title: "Liber ritrova la voce",
    text: [
      "Juliette e Liber attraversano una foresta secca per cercare un fiore magico e una sorgente d'acqua.",
      "Durante il viaggio incontrano un troll che attacca Juliette.",
      "Liber usa un bastone di legno per affrontare il troll e difendere Juliette.",
      "Dopo la prova, Juliette prepara un te rosso con il fiore e l'acqua.",
      "Liber beve il te rosso e riesce finalmente a parlare.",
    ].join(" "),
    metadata: { source: "Flow Map Knowledge Agent Tools Test", category: "sample", collectionId },
  };
  const questionPayload = {
    question: questionText,
    query: questionText,
    collectionId,
    documentId,
    purpose: "knowledge-agent-tools-sample",
  };
  const layout = (() => {
    const left = 140;
    const step = 330;
    const top = 140;
    return {
      docSource: { x: left, y: top },
      documentStore: { x: left + step, y: top },
      chunker: { x: left + step * 2, y: top },
      dictionary: { x: left + step * 3, y: top - 170 },
      events: { x: left + step * 3, y: top + 20 },
      entities: { x: left + step * 3, y: top + 210 },
      querySource: { x: left + step * 1.6, y: top + 430 },
      agent: { x: left + step * 3.9, y: top + 430 },
      preview: { x: left + step * 4.9, y: top + 430 },
    };
  })();
  const nodeBase = ({ name, type, label, inputs = [], outputs = [], x, y, width = FLOW_NODE_DEFAULT_WIDTH, tone, icon: iconName, subtype, category, config = {}, settingsSchema = {}, paletteLabel = label, paletteAction = "Agent Tools sample" }) => ({
    id: id(name),
    workspaceId,
    type,
    label,
    sourceRef: id(name),
    assetId: id(name),
    inputs,
    outputs,
    channels: uniqueStrings([...inputs, ...outputs]),
    status: "active",
    flowPosition: { x, y, width },
    metadata: {
      configured: true,
      draft: false,
      paletteLabel,
      paletteAction,
      tone,
      icon: iconName,
      runtimeType: type,
      subtype,
      category,
      settingsSchema,
      config,
    },
  });
  const docSource = nodeBase({
    name: "document_source",
    type: "source",
    label: "Agent Tools Doc Source",
    outputs: ["document"],
    ...layout.docSource,
    tone: "green",
    icon: "data_object",
    subtype: "manual-json",
    category: "sources",
    settingsSchema: { json: "object" },
    paletteLabel: "Manual JSON",
    paletteAction: "Source: Manual JSON",
    config: { emitChannel: "document", json: prettyRuntimeValue(documentPayload) },
  });
  const documentStore = nodeBase({
    name: "document_store",
    type: "knowledge",
    label: "Graph Document Store",
    inputs: ["document"],
    outputs: ["knowledge.document.created"],
    ...layout.documentStore,
    tone: "cyan",
    icon: "menu_book",
    subtype: "document-store",
    category: "knowledge",
    paletteLabel: "Document Store",
    config: { documentId, title: documentPayload.title, sourceType: "manual", language: "it", collectionId, outputChannel: "knowledge.document.created" },
  });
  const chunker = nodeBase({
    name: "chunker",
    type: "knowledge",
    label: "Graph Chunk Processor",
    inputs: ["knowledge.document.created"],
    outputs: ["knowledge.chunk.created"],
    ...layout.chunker,
    tone: "cyan",
    icon: "segment",
    subtype: "chunk-processor",
    category: "knowledge",
    paletteLabel: "Chunk Processor",
    config: { chunkSize: 420, chunkOverlap: 40, strategy: "paragraph", collectionId, replaceExisting: true, outputChannel: "knowledge.chunk.created" },
  });
  const dictionary = nodeBase({
    name: "dictionary",
    type: "knowledge",
    label: "Knowledge Dictionary Builder",
    inputs: ["knowledge.chunk.created"],
    outputs: ["knowledge.dictionary.updated", "knowledge.lexicon.context"],
    ...layout.dictionary,
    tone: "cyan",
    icon: "dictionary",
    subtype: "knowledge-dictionary-builder",
    category: "knowledge",
    paletteLabel: "Dictionary Builder",
    config: { ...sampleAiConfig, dictionaryMode: "hybrid", collectionId, termLimit: 80, outputChannel: "knowledge.dictionary.updated" },
  });
  const events = nodeBase({
    name: "events",
    type: "knowledge",
    label: "Knowledge Event Builder",
    inputs: ["knowledge.chunk.created"],
    outputs: ["knowledge.events.updated"],
    ...layout.events,
    tone: "cyan",
    icon: "event_note",
    subtype: "knowledge-event-builder",
    category: "knowledge",
    paletteLabel: "Event Builder",
    config: { ...sampleAiConfig, eventMode: "hybrid", collectionId, outputChannel: "knowledge.events.updated" },
  });
  const entities = nodeBase({
    name: "entities",
    type: "knowledge",
    label: "Graph Entity Extractor",
    inputs: ["knowledge.chunk.created"],
    outputs: ["knowledge.entity.created", "knowledge.relation.created"],
    ...layout.entities,
    tone: "green",
    icon: "account_tree",
    subtype: "entity-extractor",
    category: "knowledge",
    paletteLabel: "Entity Extractor",
    config: { ...sampleAiConfig, entityMode: "hybrid", extractionMode: "balanced", seedTerms: "Juliette,Liber,troll,foresta,fiore,acqua,te,bastone", collectionId, outputChannel: "knowledge.entity.created" },
  });
  const querySource = nodeBase({
    name: "query_source",
    type: "source",
    label: "Agent Question Source",
    outputs: ["task"],
    ...layout.querySource,
    tone: "green",
    icon: "help",
    subtype: "manual-json",
    category: "sources",
    paletteLabel: "Manual JSON",
    paletteAction: "Source: Manual JSON",
    config: { emitChannel: "task", json: prettyRuntimeValue(questionPayload) },
  });
  const agent = nodeBase({
    name: "agent",
    type: "aiAgent",
    label: "Agent Tool Reader",
    inputs: ["task"],
    outputs: ["diagnostic"],
    ...layout.agent,
    tone: "violet",
    icon: "psychology",
    subtype: "debugger",
    category: "ai-agents",
    paletteLabel: "AI Debugger",
    config: {
      ...sampleAiConfig,
      inputDataMode: "off",
      memoryMode: "none",
      emitMode: "clean",
      expected: "Answer by reading connected Knowledge tools only",
      systemPrompt: "Rispondi solo usando le osservazioni dei tool collegati nella catena. Se i tool non bastano, dillo chiaramente.",
      promptTemplate: "Domanda: {{payload.question}}\n\nRispondi in italiano, breve e verificabile.",
      output: "diagnostic",
      outputInstructions: "Non inventare dettagli. Non nominare metadata o ID runtime.",
    },
  });
  const preview = nodeBase({
    name: "preview",
    type: "devPreview",
    label: "Agent Answer Preview",
    inputs: ["raw"],
    outputs: ["output"],
    ...layout.preview,
    tone: "blue",
    icon: "smart_toy",
    subtype: "preview",
    category: "dev",
    paletteLabel: "Preview",
    config: { previewMode: "json", maxChars: 6000 },
  });
  const nodes = [docSource, documentStore, chunker, dictionary, events, entities, querySource, agent, preview];
  const links = [
    [docSource, documentStore, "document", "document", "data"],
    [documentStore, chunker, "knowledge.document.created", "knowledge.document.created", "data"],
    [chunker, dictionary, "knowledge.chunk.created", "knowledge.chunk.created", "data"],
    [chunker, events, "knowledge.chunk.created", "knowledge.chunk.created", "data"],
    [chunker, entities, "knowledge.chunk.created", "knowledge.chunk.created", "data"],
    [querySource, agent, "task", "task", "data"],
    [agent, documentStore, "agent_control", "agent_control", "tool-access"],
    [agent, dictionary, "agent_control", "agent_control", "tool-access"],
    [agent, events, "agent_control", "agent_control", "tool-access"],
    [agent, entities, "agent_control", "agent_control", "tool-access"],
    [agent, preview, "diagnostic", "raw", "data"],
  ];
  const createRuntimeLink = async ({ source, target, sourcePort, targetPort, linkType = "data", index = 0 } = {}) => {
    const createdAt = new Date().toISOString();
    const connectionId = `knowledge_agent_tools_sample_conn_${now}_${index}`;
    const channel = linkType === "tool-access" ? "agent.tool.access" : sourcePort;
    const mapping = { mode: "pass-through", sourcePort, targetPort, channel, linkType, note: "Knowledge Agent Tools sample auto-link" };
    const dependency = {
      id: `dep_${workspaceId}_${connectionId}`.replace(/[^A-Za-z0-9_-]/g, "_"),
      workspaceId,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      sourceType: source.type || "node",
      targetType: target.type || "node",
      channel,
      connectionId,
      status: "active",
      metadata: { source: "flow-map-knowledge-agent-tools-sample", ...mapping },
      createdAt,
      updatedAt: createdAt,
    };
    const connection = {
      id: connectionId,
      name: `${source.label || source.id} -> ${target.label || target.id}`,
      type: `${source.type || "node"} -> ${target.type || "node"}`,
      from: source.label || source.id,
      fromKind: source.type || "node",
      to: target.label || target.id,
      targetMeta: target.sourceRef || target.assetId || target.id,
      status: "active",
      lastTest: "Mai",
      result: "Creato da Agent Tools Test",
      method: "EVENT",
      frequency: channel,
      timeout: "10 secondi",
      retries: 0,
      createdAt,
      updatedAt: createdAt,
      endpoint: `flowmap://${workspaceId}/${connectionId}`,
      workspaceId,
      workspaceName: workspaceId,
      fromBoxId: source.id,
      toBoxId: target.id,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      sourceName: source.label || source.id,
      targetName: target.label || target.id,
      channel,
      mapping,
    };
    await window.TrackerLensConnectionsStore?.upsert?.(connection);
    await window.TrackerLensRuntimeGraphStore?.upsertDependency?.({ dependency });
    return dependency;
  };
  const waitForPreparedKnowledge = async () => {
    const knowledge = window.TrackerLensKnowledgeRuntime;
    const stores = knowledge?.STORES || {};
    const started = Date.now();
    while (Date.now() - started < 9000) {
      const [chunks, dictionaryRecords, eventRecords, entityRecords] = await Promise.all([
        knowledge?.listStore?.(stores.chunks || "tl_knowledge_chunks").catch(() => []),
        knowledge?.listStore?.(stores.dictionary || "tl_knowledge_dictionary").catch(() => []),
        knowledge?.listStore?.(stores.events || "tl_knowledge_events").catch(() => []),
        knowledge?.listStore?.(stores.entities || "tl_knowledge_entities").catch(() => []),
      ]);
      const scoped = (item) => item?.workspaceId === workspaceId && (item?.documentId === documentId || item?.collectionId === collectionId || item?.metadata?.collectionId === collectionId);
      const summary = {
        chunks: (chunks || []).filter(scoped).length,
        terms: (dictionaryRecords || []).filter(scoped).length,
        events: (eventRecords || []).filter(scoped).length,
        entities: (entityRecords || []).filter(scoped).length,
      };
      if (summary.chunks && summary.terms && summary.events && summary.entities) return summary;
      await wait(180);
    }
    return { chunks: 0, terms: 0, events: 0, entities: 0 };
  };

  state.testRun = {
    running: true,
    runId,
    nodeIds: nodes.map((node) => node.id),
    edgeIds: [],
    activeNodeIds: nodes.map((node) => node.id),
    activeEdgeIds: [],
    startedAt: new Date().toISOString(),
    completedAt: "",
    summary: "Running Knowledge Agent Tools sample test",
    timeoutId: 0,
    abortController: null,
    liveSockets: [],
    keepOpen: false,
    cancelRequested: false,
    verification: null,
  };
  state.error = "";
  startTestRunTimeout(runId, TEST_RUN_TIMEOUT_MS);
  setFiltersState({ ...state.filters, runId });
  syncFilterQuery();
  mount({ preserveScroll: true });

  try {
    const staleSampleNodes = (state.runtime.nodes || [])
      .filter((node) => node.workspaceId === workspaceId)
      .filter((node) =>
        String(node.id || "").startsWith("knowledge_agent_tools_sample_") ||
        String(node.metadata?.paletteAction || "").toLowerCase().includes("agent tools sample"));
    const staleIds = new Set(staleSampleNodes.map((node) => node.id));
    const staleConnections = (await Promise.resolve(window.TrackerLensConnectionsStore?.list?.() || []).catch(() => []))
      .filter((connection) => connection.workspaceId === workspaceId)
      .filter((connection) =>
        String(connection.id || "").startsWith("knowledge_agent_tools_sample_conn_") ||
        staleIds.has(connection.sourceNodeId || connection.fromBoxId) ||
        staleIds.has(connection.targetNodeId || connection.toBoxId));
    const runtimeDependencyStore = runtimeStoreName("TL_RUNTIME_DEPENDENCIES", "tl_runtime_dependencies");
    const staleRuntimeDependencies = (await window.TrackerLensRuntimeGraphStore?.readAll?.(runtimeDependencyStore).catch(() => []))
      .filter((dependency) => dependency.workspaceId === workspaceId)
      .filter((dependency) =>
        String(dependency.metadata?.source || "") === "flow-map-knowledge-agent-tools-sample" ||
        staleIds.has(dependency.sourceNodeId) ||
        staleIds.has(dependency.targetNodeId));
    await window.TrackerLensConnectionsStore?.removeMany?.(staleConnections.map((connection) => connection.id));
    await window.TrackerLensRuntimeGraphStore?.deleteRecords?.(runtimeDependencyStore, staleRuntimeDependencies.map((dependency) => dependency.id));
    for (const node of staleSampleNodes) {
      await window.TrackerLensRuntimeGraphStore.deleteRuntimeNodeReferences?.({ nodeId: node.id, workspaceId });
    }
    if (staleSampleNodes.length || staleConnections.length || staleRuntimeDependencies.length) await loadRuntime({ force: true, silent: true });
    for (const node of nodes) {
      await window.TrackerLensRuntimeGraphStore.upsertRuntimeNode({ node });
    }
    await loadRuntime({ force: true, silent: true });
    const edgeIds = [];
    for (const [index, link] of links.entries()) {
      const [source, target, sourcePort, targetPort, linkType] = link;
      const dependency = await createRuntimeLink({
        source: nodeById(source.id) || source,
        target: nodeById(target.id) || target,
        sourcePort,
        targetPort,
        linkType,
        index,
      });
      if (!dependency?.id) throw new Error(`Agent Tools sample link non creato: ${source.label} -> ${target.label}`);
      edgeIds.push(dependency.id);
    }
    await loadRuntime({ force: true, silent: true });
    syncPageRuntimes(workspaceId);
    await wait(250);
    state.testRun = { ...state.testRun, edgeIds, activeEdgeIds: edgeIds };
    const bus = workspaceEventBus(workspaceId);
    const docEvent = await bus.emit("document", { ...documentPayload, __test: true, runId, sourceNodeId: docSource.id, emittedAt: new Date().toISOString() }, {
      workspaceId,
      flowId: flowIdForWorkspace(workspaceId),
      eventType: "flow_agent_tools_sample_document",
      sourceNodeId: docSource.id,
      meta: { test: true, runId, origin: "knowledge-agent-tools-sample-test", rootNodeId: docSource.id },
    });
    if (docEvent) mergeRuntimeEvent(docEvent);
    const prepared = await waitForPreparedKnowledge();
    const taskEvent = await bus.emit("task", { ...questionPayload, __test: true, runId, sourceNodeId: querySource.id, emittedAt: new Date().toISOString() }, {
      workspaceId,
      flowId: flowIdForWorkspace(workspaceId),
      eventType: "flow_agent_tools_sample_question",
      sourceNodeId: querySource.id,
      meta: { test: true, runId, origin: "knowledge-agent-tools-sample-test", rootNodeId: querySource.id },
    });
    if (taskEvent) mergeRuntimeEvent(taskEvent);
    const toolJob = await waitForKnowledgeAgentToolJob({ workspaceId, runId, agentId: agent.id, timeoutMs: 12000 });
    const observations = toolJob.toolContext?.observations || [];
    const calledTools = observations.map((observation) => `${observation.nodeLabel || observation.nodeId}:${observation.tool || observation.toolName || ""}`);
    const ok = Boolean(prepared.chunks && prepared.terms && prepared.events && prepared.entities && observations.length >= 3);
    finishFlowMapTestRun({
      runId,
      summary: ok ? "Knowledge Agent Tools sample completed: Agent read connected node tools" : "Knowledge Agent Tools sample created with warnings",
      error: ok ? "" : "Agent Tools sample non ha preparato tutti gli store o non ha raccolto osservazioni tool sufficienti",
    });
    await recordFlowAction({
      workspaceId,
      nodeId: agent.id,
      level: ok ? "info" : "warning",
      message: ok ? "Knowledge Agent Tools sample test completed" : "Knowledge Agent Tools sample test completed with warnings",
      context: { action: "flow-map-knowledge-agent-tools-sample-test", runId, prepared, toolObservationCount: observations.length, calledTools },
    });
    await loadRuntime({ force: true, silent: true });
    setFocusState({ mode: "nodes", nodeId: agent.id, nodeType: "aiAgent", channel: "diagnostic", connectionId: "" });
    centerViewportOnNode?.(nodeById(agent.id) || agent, (state.runtime.nodes || []).findIndex((node) => node.id === agent.id), { select: true });
  } catch (error) {
    console.error("Flow Map Knowledge Agent Tools sample test error:", error);
    state.error = error?.message || "Errore Agent Tools sample Flow Map";
    finishFlowMapTestRun({ runId, summary: `Knowledge Agent Tools sample error: ${error.message || error}`, error: state.error });
    await recordFlowAction({
      workspaceId,
      level: "error",
      message: state.error,
      context: { action: "flow-map-knowledge-agent-tools-sample-test-error", runId, error: error.message || String(error) },
    });
    mount({ preserveScroll: true });
  }
};

const runFlowMapTest = async (starterNode = null) => {
  if (state.testRun.running) return;
  const graph = runtimeRuleGraph();
  const ruleGraph = graph;
  if (starterNode?.id && !isRootRuntimeNode(starterNode, ruleGraph)) {
    state.error = `${starterNode.label || starterNode.id} non parte direttamente. ${rootStartBlockedReason(starterNode, ruleGraph)}.`;
    mount({ preserveScroll: true });
    return;
  }
  if (starterNode?.id && !isTestableStarterNode(starterNode)) {
    state.error = `${starterNode.label || starterNode.id} non ha un runtime di avvio Pulse test.`;
    mount({ preserveScroll: true });
    return;
  }
  const starters = starterNode?.id
    ? [starterNode]
    : (graph.nodes || []).filter((node) => isRootTestableStarterNode(node, ruleGraph));
  if (!starters.length) {
    state.error = "Nessun root Source o Tracker testabile nel workspace corrente.";
    mount({ preserveScroll: true });
    return;
  }

  const workspaceId = state.filters.workspaceId || starters[0]?.workspaceId || "workspace_global";
  const runId = testRunId();
  const startedAt = new Date().toISOString();
  const path = downstreamTestPath(graph, starters.map((node) => node.id));
  const abortController = new AbortController();
  state.testRun = {
    running: true,
    runId,
    nodeIds: path.nodeIds,
    edgeIds: path.edgeIds,
    activeNodeIds: starters.map((node) => node.id),
    activeEdgeIds: activeOutgoingDependencyIds(graph, starters.map((node) => node.id)),
    startedAt,
    completedAt: "",
    summary: `Running test: ${starters.length} starter${starters.length === 1 ? "" : "s"}`,
    timeoutId: 0,
    abortController,
    liveSockets: [],
    keepOpen: false,
    cancelRequested: false,
    verification: null,
  };
  startTestRunTimeout(runId);
  state.error = "";
  setFiltersState({ ...state.filters, runId });
  syncFilterQuery();
  mount({ preserveScroll: true });

  try {
    const bus = workspaceEventBus(workspaceId);
    const emittedChannels = new Set();
    for (const node of starters) {
      if (abortController.signal.aborted) return;
      const payload = nodeTestPayload(node, runId);
      const channels = nodeOutgoingTestChannels(node, graph);
      const outputChannels = channels.length ? channels : ["default"];
      for (const channel of outputChannels) {
        emittedChannels.add(channel);
        const event = bus?.emit
          ? await bus.emit(channel, payload, {
            workspaceId,
            flowId: flowIdForWorkspace(workspaceId),
            eventType: "flow_test_root",
            sourceNodeId: node.id,
            latencyMs: 1,
            meta: { test: true, runId, origin: "manual-test", rootNodeId: node.id },
          })
          : await mergeTestEvent({
            workspaceId,
            channel,
            eventType: "flow_test_root",
            sourceNodeId: node.id,
            payload,
            latencyMs: 1,
            meta: { runId, origin: "manual-test", rootNodeId: node.id },
          });
        mergeRuntimeEvent(event);
      }
      await recordFlowAction({
        workspaceId,
        nodeId: node.id,
        level: "info",
        message: `Flow Map test started from ${node.label || node.id}`,
        context: { action: "flow-map-test-root", runId, test: true, rootNodeId: node.id, channels: outputChannels, payloadPreview: payload },
      });
    }

    for (const dependency of path.edges) {
      if (abortController.signal.aborted) return;
      const source = graph.nodes.find((node) => node.id === dependency.sourceNodeId);
      const target = graph.nodes.find((node) => node.id === dependency.targetNodeId);
      await mergeTestEvent({
        workspaceId,
        channel: dependency.channel || dependencyPort(dependency, "out") || "default",
        eventType: "flow_test_pulse",
        sourceNodeId: dependency.sourceNodeId,
        targetNodeId: dependency.targetNodeId,
        connectionId: dependency.connectionId || dependency.id,
        payload: {
          __test: true,
          runId,
          route: `${source?.label || dependency.sourceNodeId} -> ${target?.label || dependency.targetNodeId}`,
          channel: dependency.channel || "default",
        },
        latencyMs: 1,
        meta: { runId, origin: "manual-test", dependencyId: dependency.id },
      });
    }

    const channelSummary = emittedChannels.size ? ` · ${emittedChannels.size} channels` : "";
    const summary = `Test completed: ${path.nodeIds.length} nodes · ${path.edgeIds.length} links${channelSummary}`;
    finishFlowMapTestRun({ runId, summary });
    await recordFlowAction({
      workspaceId,
      level: "info",
      message: summary,
      context: { action: "flow-map-test-completed", runId, test: true, starters: starters.map((node) => node.id), nodes: path.nodeIds.length, edges: path.edgeIds.length, channels: [...emittedChannels] },
    });
    mount({ preserveScroll: true });
  } catch (error) {
    if (abortController.signal.aborted) return;
    console.error("Flow Map test error:", error);
    state.error = error?.message || "Errore test Flow Map";
    finishFlowMapTestRun({ runId, summary: `Test error: ${error.message || error}`, error: state.error });
    await recordFlowAction({
      workspaceId,
      level: "error",
      message: state.error,
      context: { action: "flow-map-test-error", runId, test: true, error: error.message || String(error) },
    });
    mount({ preserveScroll: true });
  }
};

const runFlowMapLiveTest = async (starterNode = null) => {
  if (state.testRun.running) return;
  const graph = runtimeRuleGraph();
  const ruleGraph = graph;
  if (starterNode?.id && !isRootRuntimeNode(starterNode, ruleGraph)) {
    state.error = `${starterNode.label || starterNode.id} non parte direttamente. ${rootStartBlockedReason(starterNode, ruleGraph)}.`;
    mount({ preserveScroll: true });
    return;
  }
  if (starterNode?.id && !isLiveTestableStarterNode(starterNode)) {
    state.error = `${starterNode.label || starterNode.id} non ha un runtime di avvio Live test configurato.`;
    mount({ preserveScroll: true });
    return;
  }
  const starters = starterNode?.id
    ? [starterNode]
    : (graph.nodes || []).filter((node) => isRootLiveTestableStarterNode(node, ruleGraph));
  if (!starters.length) {
    state.error = "Nessun root Source, Tracker o AI manuale con endpoint/payload configurato nel workspace corrente.";
    mount({ preserveScroll: true });
    return;
  }

  const workspaceId = state.filters.workspaceId || starters[0]?.workspaceId || "workspace_global";
  const runId = testRunId().replace("flow_test", "flow_live");
  const startedAt = new Date().toISOString();
  const path = downstreamTestPath(graph, starters.map((node) => node.id));
  const abortController = new AbortController();
  const keepOpen = starters.some((node) => isWebSocketEndpoint(nodeEndpoint(node)) && isLiveKeepOpenNode(node));
  const hasDirectAi = starters.some(isDirectAiTestNode);
  const hasAiInPath = aiNodesInPath(graph, path).length > 0;
  state.testRun = {
    running: true,
    runId,
    nodeIds: path.nodeIds,
    edgeIds: path.edgeIds,
    activeNodeIds: starters.map((node) => node.id),
    activeEdgeIds: activeOutgoingDependencyIds(graph, starters.map((node) => node.id)),
    startedAt,
    completedAt: "",
    summary: `${keepOpen ? "Streaming live test" : "Running live test"}: ${starters.length} starter${starters.length === 1 ? "" : "s"}`,
    timeoutId: 0,
    abortController,
    liveSockets: [],
    keepOpen,
    cancelRequested: false,
    verification: null,
  };
  if (!keepOpen) startTestRunTimeout(runId, hasDirectAi || hasAiInPath ? AI_DIRECT_TEST_TIMEOUT_MS : TEST_RUN_TIMEOUT_MS);
  state.error = "";
  setFiltersState({ ...state.filters, runId });
  syncFilterQuery();
  mount({ preserveScroll: true });

  try {
    const emittedChannels = new Set();
    for (const node of starters) {
      if (abortController.signal.aborted) return;
      setTestRunActiveNodes(graph, [node.id]);
      const result = isOrchestratorAgentNode(node)
        ? await executeDirectOrchestratorAgentNode({ node, workspaceId, runId, graph, signal: abortController.signal })
        : isDirectAiTestNode(node)
          ? await executeDirectAiAgentNode({ node, workspaceId, runId, graph, signal: abortController.signal })
        : await executeLiveNode({ node, workspaceId, runId, graph, signal: abortController.signal });
      if (abortController.signal.aborted) return;
      (result.channels || []).forEach((channel) => emittedChannels.add(channel));
    }

    const activeAiNodeIds = aiNodesInPath(graph, path).map((node) => node.id);
    if (activeAiNodeIds.length) setTestRunActiveNodes(graph, activeAiNodeIds);
    else clearTestRunActiveNodes();
    if (hasAiInPath) {
      await ensureAiPathExecution({ workspaceId, runId, graph, path, signal: abortController.signal });
    }

    const runRecords = hasAiInPath
      ? await waitForAiPathRecords({ workspaceId, runId, graph, path, signal: abortController.signal })
      : await wait(700).then(() => loadRunRecords({ workspaceId, runId }));
    if (!state.testRun.running || state.testRun.runId !== runId || abortController.signal.aborted) return;
    runRecords.events.forEach(mergeRuntimeEvent);
    runRecords.flowLogs.forEach(mergeFlowLog);
    const verification = summarizeLiveVerification({
      graph,
      path,
      starters,
      events: runRecords.events,
      flowLogs: runRecords.flowLogs,
      aiJobs: runRecords.aiJobs,
      aiLogs: runRecords.aiLogs,
    });
    state.testRun.verification = verification;
    const verificationSummary = verification.checks
      .map(liveVerificationLabel)
      .join(" · ");
    const channelSummary = emittedChannels.size ? ` · ${emittedChannels.size} channels` : "";
    const summary = `Live test completed: ${path.nodeIds.length} nodes · ${path.edgeIds.length} links${channelSummary} · ${verificationSummary}`;
    await waitForMinimumTestAnimation(startedAt);
    finishFlowMapTestRun({ runId, summary });
    await recordFlowAction({
      workspaceId,
      level: verification.missing || verification.failed ? "warning" : "info",
      message: summary,
      context: {
        action: "flow-map-live-test-completed",
        runId,
        live: true,
        starters: starters.map((node) => node.id),
        nodes: path.nodeIds.length,
        edges: path.edgeIds.length,
        channels: [...emittedChannels],
        verification,
      },
    });
    mount({ preserveScroll: true });
  } catch (error) {
    if (abortController.signal.aborted) return;
    console.error("Flow Map live test error:", error);
    state.error = error?.message || "Errore live test Flow Map";
    await waitForMinimumTestAnimation(startedAt);
    finishFlowMapTestRun({ runId, summary: `Live test error: ${error.message || error}`, error: state.error });
    await recordFlowAction({
      workspaceId,
      level: "error",
      message: state.error,
      context: {
        action: "flow-map-live-test-error",
        runId,
        live: true,
        error: error.message || String(error),
        ...(error.runtimeRequest || {}),
      },
    });
    mount({ preserveScroll: true });
  }
};

const logLevelChip = (level = "info") =>
  _.span({ class: `tl-flow-log-level is-${String(level || "info").toLowerCase()}` }, level || "info");

const prettyRuntimeValue = (value = {}) => {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch (_) {
    return String(value ?? "");
  }
};

const copyRuntimeValue = async (value = {}) => {
  const text = typeof value === "string" ? value : prettyRuntimeValue(value);
  try {
    await navigator.clipboard?.writeText?.(text);
  } catch (_) {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "readonly");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    document.execCommand("copy");
    field.remove();
  }
};

const copyRuntimeButton = (value = {}, label = "Copy") =>
  btn({
    class: "tl-flow-copy-btn",
    title: label,
    onPointerDown: stopNodeControlEvent,
    onclick: (event) => {
      event.preventDefault();
      event.stopPropagation();
      copyRuntimeValue(value);
    },
  }, icon("content_copy", "sm"));

const renderRuntimePayloadDetails = ({ title = "Payload", value = {}, meta = {} } = {}) =>
  _.details(
    { class: "tl-flow-runtime-details" },
    _.summary(
      _.span(title),
      copyRuntimeButton(value, `Copy ${title}`)
    ),
    Object.keys(meta || {}).length ? _.div(
      { class: "tl-flow-runtime-meta" },
      ...Object.entries(meta).map(([key, item]) => _.span(`${key}: ${item || "N/D"}`))
    ) : null,
    _.pre(prettyRuntimeValue(value))
  );

const eventTypeTone = (event = {}) => {
  const type = String(event.eventType || "event");
  if (event.status === "error" || type.includes("error")) return "error";
  if (type === "tracker_test" || type.includes("test") || event.meta?.test) return "test";
  if (type === "received") return "received";
  if (type === "emitted") return "emitted";
  if (type === "delivery_error") return "error";
  return "event";
};

const eventTypeLabel = (event = {}) => ({
  tracker_test: "test",
  tracker_test_error: "test error",
  flow_test_root: "test root",
  flow_test_pulse: "test pulse",
  emitted: "emit",
  received: "recv",
  delivery_error: "delivery",
  error: "error",
})[event.eventType] || event.eventType || "event";

const eventTypeChip = (event = {}) =>
  _.span({ class: `tl-flow-event-type is-${eventTypeTone(event)}` }, eventTypeLabel(event));

const formatShortDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/D";
  return date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

const liveBusLabel = () => {
  if (!state.liveBus.available) return "Bus: offline";
  if (!state.liveBus.connected) return "Bus: standby";
  if (!state.liveBus.lastAt) return "Bus: connected";
  return `Bus: ${state.liveBus.count} live · ${formatShortDate(state.liveBus.lastAt)}`;
};

const liveBusTitle = () => {
  if (!state.liveBus.available) return "TrackerLensEventBus non disponibile in questa pagina.";
  if (!state.liveBus.connected) return "Event Bus disponibile, subscription live non ancora attiva.";
  return state.liveBus.lastChannel
    ? `Ultimo evento live su ${state.liveBus.lastChannel}`
    : "Event Bus live connesso.";
};

const renderLiveBusPill = () =>
  _.span(
    {
      class: `tl-flow-live is-bus${state.liveBus.connected ? " is-connected" : ""}${state.liveBus.lastAt ? " is-receiving" : ""}${!state.liveBus.available ? " is-offline" : ""}`,
      title: liveBusTitle(),
      "data-live-bus-pill": "true",
    },
    dot(state.liveBus.connected ? "is-connected" : !state.liveBus.available ? "is-offline" : "is-standby"),
    _.span({ "data-live-bus-label": "true" }, liveBusLabel())
  );

const renderSelect = (className, value, options, onChange) => {
  const model = Array.isArray(value) ? value : null;
  return _.Select({
    class: className,
    ...(model ? { model } : { value, onChange }),
    options,
    slots: { arrow: () => icon("keyboard_arrow_down", "sm") },
  });
};

const bindFlowMenu = (trigger, menuProps, content) => {
  const menu = _.Menu(
    {
      trigger: "click",
      placement: "bottom-start",
      width: 280,
      closeOnOutside: true,
      closeOnEsc: true,
      panelClass: "tl-flow-dropdown-menu",
      ...menuProps,
    },
    content
  );
  queueMicrotask(() => menu.bind(trigger));
  return trigger;
};

const readPortableFile = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result || "{}")));
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(reader.error || new Error("Errore lettura workspace"));
    reader.readAsText(file);
  });

const cleanupWorkspaceImportTarget = async (workspaceId = "") => {
  if (!workspaceId) return;
  const runtimeStores = [
    runtimeStoreName("TL_CHANNELS", "tl_channels"),
    runtimeStoreName("TL_FLOWS", "tl_flows"),
    runtimeStoreName("TL_EVENTS", "tl_events"),
    runtimeStoreName("TL_FLOW_LOGS", "tl_flow_logs"),
    runtimeStoreName("TL_RUNTIME_NODES", "tl_runtime_nodes"),
    runtimeStoreName("TL_RUNTIME_DEPENDENCIES", "tl_runtime_dependencies"),
  ];
  await Promise.all(runtimeStores.map((storeName) => deleteWorkspaceScopedRecords(storeName, workspaceId).catch(() => [])));
  const connectionIds = (await window.TrackerLensConnectionsStore?.list?.() || [])
    .filter((connection) => connection.workspaceId === workspaceId)
    .map((connection) => connection.id);
  await window.TrackerLensConnectionsStore?.removeMany?.(connectionIds);
};

const downloadCurrentWorkspace = async () => {
  try {
    await window.TrackerLensPortableRuntime.exportFlowMapFile(currentWorkspaceId(), { includeAssets: true, includeRuntimeGraph: true });
  } catch (error) {
    state.error = error?.message || "Download Flow Map non riuscito.";
    setErrorSignal(state.error);
    mount({ preserveScroll: true });
  }
};

const exportCurrentFlowMapImage = async () => {
  try {
    await window.TrackerLensFlowMapPreview?.exportJpg?.({
      graph: {
        flowMap: { name: currentWorkspaceName() },
        nodes: state.runtime.nodes || [],
        dependencies: state.runtime.dependencies || [],
      },
      title: currentWorkspaceName(),
    });
  } catch (error) {
    state.error = error?.message || "Export JPG Flow Map non riuscito.";
    setErrorSignal(state.error);
    mount({ preserveScroll: true });
  }
};

const importWorkspaceFile = () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".tlflow,.tlworkspace,application/json,.json";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const bundle = await readPortableFile(file);
      const validation = window.TrackerLensPortableRuntime.validateBundle(bundle);
      if (!validation.ok) throw new Error(validation.errors.join(", "));
      const workspaceId = normalizeRuntimeWorkspaceId(bundle.workspace?.id || bundle.id || currentWorkspaceId());
      await cleanupWorkspaceImportTarget(workspaceId);
      const result = await window.TrackerLensPortableRuntime.importBundle(bundle, { onConflict: "overwrite", includeRuntimeGraph: true });
      setFiltersState({ ...state.filters, workspaceId: result.id || workspaceId, origin: "runtime" });
      state.viewport = loadStoredViewport(result.id || workspaceId) || defaultViewport();
      syncFilterQuery();
      await loadRuntime({ force: true });
    } catch (error) {
      state.error = error?.message || "Import workspace non riuscito.";
      setErrorSignal(state.error);
      mount({ preserveScroll: true });
    }
  };
  input.click();
};

const saveWorkspaceSettings = async ({ close, nameInput, titleInput, descriptionInput, statusInput }) => {
  try {
    const workspaceId = currentWorkspaceId();
    const pageStore = runtimeStoreName("TL_PAGES", "tl_pages");
    const flowStore = runtimeStoreName("TL_FLOWS", "tl_flows");
    const now = new Date().toISOString();
    const record = await readRuntimeRecord(pageStore, workspaceId);
    const content = record?.content && typeof record.content === "object" ? record.content : { id: workspaceId };
    const nextContent = {
      ...content,
      id: content.id || workspaceId,
      name: nameInput.value.trim() || content.name || workspaceId,
      title: titleInput.value.trim() || content.title || "",
      description: descriptionInput.value.trim(),
      status: statusInput.value || content.status || "active",
      updatedAt: now,
    };
    await writeRuntimeRecord(pageStore, { ...(record || {}), id: workspaceId, content: nextContent });

    const flow = state.runtime.flows.find((item) => item.workspaceId === workspaceId) || await readRuntimeRecord(flowStore, `flow_${workspaceId.replace(/[^A-Za-z0-9_-]/g, "_")}`);
    if (flow?.id) {
      await writeRuntimeRecord(flowStore, {
        ...flow,
        workspaceId,
        name: nextContent.name || nextContent.title || workspaceId,
        status: nextContent.status || flow.status || "active",
        updatedAt: now,
      }).catch(() => null);
    }

    close?.();
    await loadRuntime({ force: true });
  } catch (error) {
    state.error = error?.message || "Salvataggio settings workspace non riuscito.";
    setErrorSignal(state.error);
    mount({ preserveScroll: true });
  }
};

const openWorkspaceSettings = async () => {
  const workspaceId = currentWorkspaceId();
  const record = await readRuntimeRecord(runtimeStoreName("TL_PAGES", "tl_pages"), workspaceId).catch(() => null);
  const content = record?.content && typeof record.content === "object" ? record.content : {};
  const nameInput = _.input({ class: "tl-flow-menu-input", value: content.name || content.title || workspaceId, placeholder: "Workspace name" });
  const titleInput = _.input({ class: "tl-flow-menu-input", value: content.title || "", placeholder: "Display title" });
  const descriptionInput = _.textarea({ class: "tl-flow-menu-input", rows: 3, placeholder: "Description" }, content.description || "");
  const statusInput = _.select(
    { class: "tl-flow-menu-input" },
    ...["active", "draft", "paused", "archived"].map((status) => _.option({ value: status, selected: (content.status || "active") === status }, status))
  );
  const dialog = _.Dialog({
    class: "tl-flow-workspace-settings-dialog",
    panelClass: "tl-flow-edge-delete-panel",
    size: "md",
    title: "Workspace settings",
    subtitle: workspaceId,
    icon: "settings",
    closeButton: true,
    content: () => _.div(
      { class: "tl-flow-workspace-settings" },
      _.label(_.span("Name"), nameInput),
      _.label(_.span("Title"), titleInput),
      _.label(_.span("Description"), descriptionInput),
      _.label(_.span("Status"), statusInput)
    ),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: close }, "Cancel"),
      btn({ class: "st-btn-primary", onclick: () => saveWorkspaceSettings({ close, nameInput, titleInput, descriptionInput, statusInput }) }, icon("save", "sm"), "Save")
    ),
  });
  dialog.open();
};

const renderFileMenuItem = ({ iconName, label, meta = "", onclick, disabled = false }) =>
  _.button(
    { type: "button", class: "tl-flow-menu-item", disabled, onclick: disabled ? undefined : onclick },
    icon(iconName, "sm"),
    _.span(_.strong(label), meta ? _.small(meta) : null)
  );

const renderFileMenu = () =>
  bindFlowMenu(
    btn({ class: "tl-flow-menu-trigger is-file" }, icon("folder_open", "sm"), "File", icon("keyboard_arrow_down", "sm")),
    {},
    _.div(
      { class: "tl-flow-menu-content" },
      renderFileMenuItem({ iconName: "download", label: "Download", meta: ".tlflow con asset e runtime graph", onclick: downloadCurrentWorkspace }),
      renderFileMenuItem({ iconName: "image", label: "Export JPG", meta: "Immagine completa del Flow Map", onclick: exportCurrentFlowMapImage }),
      renderFileMenuItem({ iconName: "upload_file", label: "Import", meta: "Sostituisce il Flow Map importato", onclick: importWorkspaceFile }),
      _.span({ class: "tl-flow-menu-separator" }),
      renderFileMenuItem({ iconName: "settings", label: "Settings", meta: "Nome, titolo e stato workspace", onclick: openWorkspaceSettings })
    )
  );

const renderSampleTestMenu = () =>
  bindFlowMenu(
    btn({ class: "tl-flow-menu-trigger", title: "Create ready-made diagnostic sample flows" }, icon("science", "sm"), "Sample Test", icon("keyboard_arrow_down", "sm")),
    { width: 320 },
    _.div(
      { class: "tl-flow-menu-content" },
      renderFileMenuItem({
        iconName: "rule",
        label: "Mapping Test",
        meta: "Manual JSON -> Preview json-map",
        disabled: state.testRun.running,
        onclick: () => runMappingPreviewTest(),
      }),
      renderFileMenuItem({
        iconName: "database",
        label: "Storage Test",
        meta: "Manual JSON -> IndexedDB storage",
        disabled: state.testRun.running,
        onclick: () => runMappingStorageTest(),
      }),
      renderFileMenuItem({
        iconName: "menu_book",
        label: "Knowledge Test",
        meta: "Document -> chunks -> embeddings -> RAG",
        disabled: state.testRun.running,
        onclick: () => runKnowledgeSampleTest(),
      }),
      renderFileMenuItem({
        iconName: "hub",
        label: "Knowledge Graph Test",
        meta: "Document -> chunks -> entities -> graph",
        disabled: state.testRun.running,
        onclick: () => runKnowledgeGraphSampleTest(),
      }),
      renderFileMenuItem({
        iconName: "psychology",
        label: "Agent Tools Test",
        meta: "Agent reads connected Knowledge tools",
        disabled: state.testRun.running,
        onclick: () => runKnowledgeAgentToolsSampleTest(),
      })
    )
  );

const openAgentRuntimeDialog = async () => {
  if (!window.TrackerLensAgentRuntime?.inspectFlow) {
    state.error = "Agent Runtime is not available.";
    mount({ preserveScroll: true });
    return;
  }
  const workspaceId = currentWorkspaceId();
  let inspect = await window.TrackerLensAgentRuntime.inspectFlow({ workspaceId }).catch((error) => ({ error: error?.message || String(error) }));
  let run = null;
  let fixes = null;
  let fixResult = null;
  let applyingFixId = "";
  let lastFixSnapshotId = "";
  let fixHistory = [];
  let traceMode = "dry-run";
  let dialog = null;
  const refreshBody = () => {
    const host = document.querySelector("[data-agent-runtime-dialog-body]");
    if (host) host.replaceChildren(renderBody());
  };
  const metric = (label, value) => _.span(_.strong(String(value ?? 0)), _.em(label));
  const renderNodeList = (title = "", list = []) =>
    _.section(
      { class: "tl-agent-runtime-section" },
      _.h3(title),
      ...(list.length ? list.slice(0, 8).map((item) =>
        _.span(
          { class: "tl-agent-runtime-row" },
          icon(item.subtype === "orchestrator" ? "route" : item.type === "aiAgent" ? "psychology" : "radio_button_unchecked", "sm"),
          _.strong(item.label || item.id),
          _.em([item.type, item.subtype].filter(Boolean).join(" · ") || item.id)
        )
      ) : [_.p({ class: "tl-flow-muted" }, "None")])
    );
  const focusAgentRuntimeNode = (nodeId = "") => {
    const node = nodeById(nodeId) || (state.runtime.nodes || []).find((item) => item.id === nodeId);
    if (!node) return;
    setFocusState({ mode: "nodes", nodeId: node.id, nodeType: node.type || "", channel: node.channels?.[0] || node.outputs?.[0] || "", connectionId: "" });
    state.inspectorOpen = true;
    centerViewportOnNode?.(node, (state.runtime.nodes || []).findIndex((item) => item.id === node.id), { select: true });
    mount({ preserveScroll: true });
  };
  const inspectAgentRuntimeNode = async (nodeId = "") => {
    if (!nodeId) return;
    const record = await window.TrackerLensAgentRuntime.inspectNode({ workspaceId, nodeId }).catch((error) => ({ error: error?.message || String(error), nodeId }));
    openFlowRecordDialog({
      title: "Agent Runtime Node",
      subtitle: nodeId,
      iconName: "smart_toy",
      record,
    });
  };
  const findRuntimeDependency = (action = {}) =>
    (state.runtime.dependencies || []).find((dependency) =>
      dependency.id === action.dependencyId ||
      dependency.connectionId === action.connectionId
    ) || null;
  const agentRuntimePaletteItem = (label = "") =>
    (typeof nodePalette !== "undefined" ? nodePalette : [])
      .flatMap(([, items]) => items || [])
      .find((item) => String(item.label || "").toLowerCase() === String(label || "").toLowerCase()) || null;
  const flowPositionAfterNode = (node = {}) => {
    const position = node.flowPosition || node.metadata?.flowPosition || node.position || {};
    return {
      x: Number(position.x ?? node.x ?? 160) + 300,
      y: Number(position.y ?? node.y ?? 160),
    };
  };
  const captureAgentRuntimeFixSnapshot = async (label = "Agent Runtime fix") => {
    const runtime = window.TrackerLensRuntimeSnapshotStore?.load
      ? await window.TrackerLensRuntimeSnapshotStore.load({ includeConnections: true, workspaceId }).catch(() => null)
      : null;
    return window.TrackerLensTimeTravelStore?.capture
      ? window.TrackerLensTimeTravelStore.capture({
        workspaceId,
        reason: "agent-runtime-fix",
        label,
        state: runtime,
      }).catch(() => null)
      : null;
  };
  const refreshAgentRuntimeState = async (objective = "Agent Runtime trace from Flow Map UI") => {
    inspect = await window.TrackerLensAgentRuntime.inspectFlow({ workspaceId }).catch((error) => ({ error: error?.message || String(error) }));
    fixes = await window.TrackerLensAgentRuntime.suggestFixes({ workspaceId }).catch((error) => ({ fixes: [], error: error?.message || String(error) }));
    run = await window.TrackerLensAgentRuntime.runFlow({
      workspaceId,
      dryRun: traceMode !== "execute-controlled",
      mode: traceMode,
      payload: { objective },
    }).catch((error) => ({ status: "error", error: error?.message || String(error), trace: [] }));
  };
  const undoLastAgentRuntimeFix = async () => {
    if (!lastFixSnapshotId || !window.TrackerLensTimeTravelStore?.restore) return;
    applyingFixId = "undo";
    refreshBody();
    try {
      await window.TrackerLensTimeTravelStore.restore({
        snapshotId: lastFixSnapshotId,
        stores: ["channels", "flows", "runtimeNodes", "runtimeDependencies", "connections"],
      });
      await loadRuntime({ force: true });
      await refreshAgentRuntimeState("Verify Agent Runtime undo");
      fixResult = {
        status: "ok",
        message: "Last Agent Runtime fix was undone and trace refreshed.",
        fixType: "undo-fix",
      };
      fixHistory = [
        {
          type: "undo-fix",
          status: "ok",
          message: "Restored snapshot before last fix.",
          at: new Date().toISOString(),
          snapshotId: lastFixSnapshotId,
        },
        ...fixHistory,
      ].slice(0, 8);
      lastFixSnapshotId = "";
    } catch (error) {
      fixResult = {
        status: "error",
        message: error?.message || String(error),
        fixType: "undo-fix",
      };
    } finally {
      applyingFixId = "";
      refreshBody();
    }
  };
  const applyAgentRuntimeFix = async (fix = {}) => {
    const action = fix.action || {};
    if (!fix.safe || !action.kind) return;
    applyingFixId = fix.id || "";
    fixResult = null;
    refreshBody();
    const snapshot = await captureAgentRuntimeFixSnapshot(`Before Agent Runtime fix: ${fix.type || "runtime fix"}`);
    try {
      if (action.kind === "delete-link") {
        const edge = findRuntimeDependency(action);
        if (!edge) throw new Error("Dependency not found for fix.");
        await performEdgeDelete(edge);
      } else if (action.kind === "update-link-ports") {
        const edge = findRuntimeDependency(action);
        const source = nodeById(action.sourceNodeId || edge?.sourceNodeId || "");
        const target = nodeById(action.targetNodeId || edge?.targetNodeId || "");
        if (!edge || !source || !target) throw new Error("Link endpoints not found for port repair.");
        await saveRuntimeLinkMapping({
          edge,
          source,
          target,
          mapping: {
            sourcePort: action.sourcePort || "all",
            targetPort: action.targetPort || "all",
            channel: action.channel || action.sourcePort || edge.channel || "runtime",
            mode: edge.metadata?.mode || edge.mapping?.mode || "pass-through",
            linkType: action.channel === "agent_control" || action.sourcePort === "agent_control" || action.targetPort === "agent_control"
              ? "agent-control"
              : edge.metadata?.linkType || edge.mapping?.linkType || "data",
          },
        });
      } else if (action.kind === "create-link") {
        const source = nodeById(action.sourceNodeId);
        const target = nodeById(action.targetNodeId);
        if (!source || !target) throw new Error("Link endpoints not found for fix.");
        await createRuntimeLink(source, target, {
          sourcePort: action.sourcePort || "all",
          targetPort: action.targetPort || "all",
          configure: false,
          mapping: {
            sourcePort: action.sourcePort || "all",
            targetPort: action.targetPort || "all",
            channel: action.channel || action.sourcePort || "runtime",
            mode: "pass-through",
            linkType: action.channel === "agent_control" ? "agent-control" : "data",
          },
        });
      } else if (action.kind === "create-agent-bridge") {
        const source = nodeById(action.sourceNodeId);
        const paletteItem = agentRuntimePaletteItem("Agent Bridge");
        if (!source || !paletteItem || !window.TrackerLensRuntimeGraphStore?.createDraftNode) {
          throw new Error("Agent Bridge palette item or source node not available.");
        }
        const bridge = await createDraftNodeAtFlowPosition({
          item: paletteItem,
          flowPosition: flowPositionAfterNode(source),
        });
        if (!bridge?.id) throw new Error("Agent Bridge could not be created.");
        await createRuntimeLink(source, bridge, {
          sourcePort: action.sourcePort || "agent_control",
          targetPort: action.targetPort || "agent_control",
          configure: false,
          mapping: {
            sourcePort: action.sourcePort || "agent_control",
            targetPort: action.targetPort || "agent_control",
            channel: action.channel || action.sourcePort || "agent_control",
            mode: "pass-through",
            linkType: "agent-control",
          },
        });
      } else {
        throw new Error(`Unsupported fix action: ${action.kind}`);
      }
      await refreshAgentRuntimeState(`Verify applied fix: ${fix.type || "runtime fix"}`);
      lastFixSnapshotId = snapshot?.id || "";
      fixResult = {
        status: run.status === "blocked" ? "warning" : "ok",
        message: run.status === "blocked"
          ? "Fix applied, but the verification trace still has blockers."
          : "Fix applied and verification trace refreshed.",
        fixType: fix.type || "",
        snapshotId: lastFixSnapshotId,
      };
      fixHistory = [
        {
          type: fix.type || "runtime-fix",
          status: fixResult.status,
          message: fix.preview || fix.actionText || "Applied Agent Runtime fix.",
          at: new Date().toISOString(),
          snapshotId: lastFixSnapshotId,
          runId: run.runId || "",
        },
        ...fixHistory,
      ].slice(0, 8);
    } catch (error) {
      fixResult = {
        status: "error",
        message: error?.message || String(error),
        fixType: fix.type || "",
      };
    } finally {
      applyingFixId = "";
      refreshBody();
    }
  };
  const renderStepDetail = (step = {}) =>
    _.div(
      { class: "tl-agent-runtime-step-detail" },
      _.div(
        { class: "tl-agent-runtime-step-actions" },
        btn({
          class: "is-ghost",
          disabled: !step.nodeId,
          onclick: () => focusAgentRuntimeNode(step.nodeId),
        }, icon("center_focus_strong", "sm"), "Focus Node"),
        btn({
          class: "is-ghost",
          disabled: !step.nodeId,
          onclick: () => inspectAgentRuntimeNode(step.nodeId),
        }, icon("manage_search", "sm"), "Inspect Node")
      ),
      _.span(_.strong("Node"), _.em(step.nodeId || "-")),
      _.span(_.strong("Channel"), _.em(step.channel || "-")),
      _.span(_.strong("Ports"), _.em([step.sourcePort || "", step.targetPort || ""].filter(Boolean).join(" -> ") || "-")),
      _.span(_.strong("Dependency"), _.em(step.dependencyId || step.connectionId || "-")),
      _.span(_.strong("Expected IN"), _.em((step.expectedInput || []).join(", ") || "-")),
      _.span(_.strong("Expected OUT"), _.em((step.expectedOutput || []).join(", ") || "-")),
      step.lastEvent ? _.span(_.strong("Last Event"), _.em([step.lastEvent.eventType, step.lastEvent.channel, step.lastEvent.status].filter(Boolean).join(" · "))) : null,
      step.lastEvent?.payload !== undefined ? renderRuntimePayloadDetails({ title: "Last event payload", value: step.lastEvent.payload }) : null
    );
  const renderTrace = () => {
    if (!run) return null;
    const trace = run.trace || [];
    return _.details(
      { class: "tl-agent-runtime-section tl-agent-runtime-trace-section", open: true },
      _.summary(icon("timeline", "sm"), _.strong("Trace"), _.em(`${trace.length} steps`), icon("expand_more", "sm")),
      _.div(
        { class: "tl-agent-runtime-trace" },
        ...trace.map((step) =>
          _.details(
            { class: `is-${step.status || "pending"}` },
            _.summary(
              icon(step.status === "blocked" ? "error" : step.status === "completed" ? "check_circle" : "radio_button_unchecked", "sm"),
              _.strong(`${step.index}. ${step.label}`),
              _.em([step.channel, step.message].filter(Boolean).join(" · ") || step.status),
              icon("expand_more", "sm")
            ),
            renderStepDetail(step)
          )
        )
      )
    );
  };
  const renderTraceMode = () => _.section(
    { class: "tl-agent-runtime-section tl-agent-runtime-mode" },
    _.h3("Trace Mode"),
    _.div(
      { class: "tl-agent-runtime-mode-row" },
      ...[
        ["dry-run", "Dry Run", "Plan and validate only"],
        ["simulate", "Simulate", "Trace as simulated runtime"],
        ["execute-controlled", "Execute Controlled", "v1 records trace only"],
      ].map(([value, label, detail]) =>
        btn({
          class: traceMode === value ? "is-primary" : "is-ghost",
          onclick: () => {
            traceMode = value;
            refreshBody();
          },
          title: detail,
        }, icon(value === "execute-controlled" ? "lock" : value === "simulate" ? "model_training" : "rule", "sm"), label)
      )
    )
  );
  const renderFixHistory = () => !fixHistory.length ? null : _.section(
    { class: "tl-agent-runtime-section tl-agent-runtime-fix-log" },
    _.h3("Runtime Fix Log"),
    ...fixHistory.map((item) =>
      _.span(
        { class: `tl-agent-runtime-row is-${item.status || "ok"}` },
        icon(item.status === "error" ? "error" : item.type === "undo-fix" ? "undo" : "build", "sm"),
        _.strong(item.type || "fix"),
        _.em([item.message, item.at ? new Date(item.at).toLocaleTimeString() : ""].filter(Boolean).join(" · ")),
        item.snapshotId ? _.code(item.snapshotId) : icon("chevron_right", "sm")
      )
    )
  );
  const renderFixes = () => !fixes ? null : _.section(
    { class: "tl-agent-runtime-section tl-agent-runtime-fixes" },
    _.h3("Safe Fix Suggestions"),
    fixes.error ? _.div(
      { class: "tl-agent-runtime-fix-result is-error" },
      icon("error", "sm"),
      _.span(_.strong("Suggest Fixes"), _.em(fixes.error))
    ) : null,
    fixResult ? _.div(
      { class: `tl-agent-runtime-fix-result is-${fixResult.status || "ok"}` },
      icon(fixResult.status === "error" ? "error" : fixResult.status === "warning" ? "warning" : "check_circle", "sm"),
      _.span(_.strong(fixResult.fixType || "Fix"), _.em(fixResult.message || "")),
      fixResult.snapshotId ? btn({
        class: "is-ghost",
        disabled: applyingFixId === "undo",
        onclick: () => undoLastAgentRuntimeFix(),
        title: "Restore the snapshot captured before the last Agent Runtime fix",
      }, icon(applyingFixId === "undo" ? "hourglass_top" : "undo", "sm"), applyingFixId === "undo" ? "Undoing" : "Undo Fix") : null
    ) : null,
    ...(fixes.fixes?.length ? fixes.fixes.slice(0, 12).map((fix) =>
      _.article(
        { class: `tl-agent-runtime-fix is-${fix.severity || "warning"}${fix.safe ? " is-safe" : " is-manual"}` },
        _.header(
          icon(fix.severity === "error" ? "error" : fix.safe ? "construction" : "manage_search", "sm"),
          _.span(
            _.strong(fix.problem || fix.type || "Runtime fix"),
            _.em([fix.type, fix.safe ? "safe apply" : "manual review"].filter(Boolean).join(" · "))
          ),
          _.code(fix.risk || "manual")
        ),
        _.div(
          { class: "tl-agent-runtime-fix-grid" },
          _.span(_.strong("Cause"), _.em(fix.cause || fix.reason || "-")),
          _.span(_.strong("Action"), _.em(fix.actionText || "-")),
          _.span(_.strong("Preview"), _.em(fix.preview || "-"))
        ),
        _.div(
          { class: "tl-agent-runtime-fix-actions" },
          fix.nodeId ? btn({
            class: "is-ghost",
            onclick: () => focusAgentRuntimeNode(fix.nodeId),
          }, icon("center_focus_strong", "sm"), "Focus") : null,
          fix.nodeId ? btn({
            class: "is-ghost",
            onclick: () => inspectAgentRuntimeNode(fix.nodeId),
          }, icon("manage_search", "sm"), "Inspect") : null,
          btn({
            class: fix.safe ? "is-primary" : "",
            disabled: !fix.safe || applyingFixId === fix.id,
            title: fix.safe ? "Apply this safe fix, then rerun Agent Runtime trace" : "Manual review required",
            onclick: () => applyAgentRuntimeFix(fix),
          }, icon(applyingFixId === fix.id ? "hourglass_top" : fix.safe ? "build" : "lock", "sm"), applyingFixId === fix.id ? "Applying" : fix.safe ? "Apply Fix" : "Manual")
        )
      )
    ) : [_.p({ class: "tl-flow-muted" }, "No fix suggestion")])
  );
  const renderBody = () => {
    const summary = inspect.summary || {};
    return _.div(
      { class: "tl-agent-runtime-dialog-body" },
      inspect.error ? _.div({ class: "tl-flow-error" }, icon("error", "sm"), inspect.error) : null,
      _.section(
        { class: "tl-agent-runtime-overview" },
        metric("nodes", summary.nodes || 0),
        metric("links", summary.dependencies || 0),
        metric("roots", summary.roots?.length || 0),
        metric("agents", summary.agentNodes?.length || 0),
        metric("issues", inspect.issues?.length || 0),
        run ? metric("trace steps", run.trace?.length || 0) : null
      ),
      renderTraceMode(),
      _.div(
        { class: "tl-agent-runtime-grid" },
        renderNodeList("Roots", summary.roots || []),
        renderNodeList("Agent Nodes", summary.agentNodes || [])
      ),
      run ? _.section(
        { class: "tl-agent-runtime-run-summary" },
        _.h3("Last Run"),
        _.div(
          { class: "tl-agent-runtime-run-grid" },
          _.span(_.strong("Status"), _.em(run.status || "completed")),
          _.span(_.strong("Mode"), _.em(run.mode || "dry-run")),
          _.span(_.strong("Steps"), _.em(String(run.trace?.length || 0))),
          _.span(_.strong("Started"), _.em(run.startedAt ? new Date(run.startedAt).toLocaleTimeString() : "-"))
        ),
        _.div(
          { class: "tl-agent-runtime-run-actions" },
          _.code(run.runId || ""),
          copyRuntimeButton(run, "Copy run")
        )
      ) : null,
      renderTrace(),
      renderFixes(),
      renderFixHistory(),
      _.details(
        { class: "tl-agent-runtime-raw" },
        _.summary(icon("data_object", "sm"), _.strong("Raw inspect"), icon("expand_more", "sm")),
        _.pre(prettyRuntimeValue(inspect))
      )
    );
  };
  dialog = _.Dialog({
    class: "tl-agent-runtime-dialog",
    panelClass: "tl-agent-runtime-dialog-panel",
    size: "lg",
    title: "Agent Runtime",
    subtitle: "Trace-first runtime tools for Trackers Lens agentic flows.",
    icon: "smart_toy",
    closeButton: true,
    scrollable: true,
    bodyMaxHeight: "70vh",
    content: () => _.div({ "data-agent-runtime-dialog-body": "true" }, renderBody()),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({
        onclick: async () => {
          inspect = await window.TrackerLensAgentRuntime.inspectFlow({ workspaceId }).catch((error) => ({ error: error?.message || String(error) }));
          refreshBody();
        },
      }, icon("sync", "sm"), "Inspect"),
      btn({
        class: "st-btn-primary",
        onclick: async () => {
          run = await window.TrackerLensAgentRuntime.runFlow({
            workspaceId,
            dryRun: traceMode !== "execute-controlled",
            mode: traceMode,
            payload: { objective: "Agent Runtime trace from Flow Map UI" },
          }).catch((error) => ({ status: "error", error: error?.message || String(error), trace: [] }));
          refreshBody();
        },
      }, icon("play_arrow", "sm"), traceMode === "simulate" ? "Run Simulation" : traceMode === "execute-controlled" ? "Run Controlled" : "Run Trace"),
      btn({
        onclick: async () => {
          fixes = await window.TrackerLensAgentRuntime.suggestFixes({ workspaceId }).catch((error) => ({ fixes: [], error: error?.message || String(error) }));
          refreshBody();
        },
      }, icon("construction", "sm"), "Suggest Fixes"),
      btn({ onclick: close }, "Close")
    ),
  });
  dialog.open();
};

const renderHeader = () =>
  _.header(
    { class: "tl-flow-topbar" },
    window.TrackerLensSidebar.renderBrand({ className: "tl-flow-brand" }),
    _.div(
      { class: "tl-flow-title" },
      _.h1("Flow Map"),
      _.span(currentWorkspaceName())
    ),
    _.div(
      { class: "tl-flow-top-actions" },
      _.span({ class: "tl-flow-live" }, dot(), "Runtime: Active"),
      renderLiveBusPill(),
      state.lastDeletedConnection
        ? btn({ onclick: restoreLastDeletedConnection }, icon("undo", "sm"), "Undo Link")
        : null,
      state.lastDeletedNode
        ? btn({ onclick: restoreLastDeletedNode }, icon("undo", "sm"), "Undo Node")
        : null,
      state.lastChannelAction
        ? btn({ onclick: restoreLastChannelAction }, icon("undo", "sm"), "Undo Channel")
        : null,
      btn({ onclick: loadRuntime }, icon("sync", "sm"), "Refresh"),
      btn({
        class: state.testRun.running ? "is-primary is-running" : "",
        title: state.testRun.summary || "Run graph pulse test from root Sources and Trackers only; child nodes start from parent payloads",
        disabled: state.testRun.running,
        onclick: () => runFlowMapTest(),
      }, icon(state.testRun.running ? "hourglass_top" : "offline_bolt", "sm"), state.testRun.running ? "Testing" : "Pulse Test"),
      btn({
        class: state.testRun.running ? "is-primary is-running" : "",
        title: state.testRun.summary || "Run real one-shot test from root nodes only; child nodes start from parent payloads",
        disabled: state.testRun.running,
        onclick: () => runFlowMapLiveTest(),
      }, icon(state.testRun.running ? "hourglass_top" : "play_arrow", "sm"), state.testRun.running ? "Testing" : "Live Test"),
      btn({
        title: "Open Agent Runtime trace/debug tools",
        onclick: () => openAgentRuntimeDialog(),
      }, icon("smart_toy", "sm"), "Agent Run"),
      renderSampleTestMenu(),
      state.testRun.running
        ? btn({ class: "is-danger", title: state.testRun.keepOpen ? "Stop streaming live test" : "Stop current test", onclick: stopFlowMapTestRun }, icon("stop", "sm"), "Stop")
        : null,
      btn({ onclick: openDevTools }, icon("developer_board", "sm"), "DevTools"),
      btn({ class: "st-btn-primary", onclick: () => window.location.assign("connections.html") }, icon("link", "sm"), "Connections")
    )
  );

const openDevTools = () => {
  const query = new URLSearchParams();
  const focusedChannel = state.focus.channel || (state.filters.channel !== "all" ? state.filters.channel : "");
  query.set("tab", focusedChannel ? "channels" : "graph");
  const node = selectedNode();
  if (node?.id) {
    query.set("type", "node");
    query.set("id", node.id);
    query.set("nodeId", node.id);
  } else if (focusedChannel) {
    query.set("type", "channel");
    query.set("id", focusedChannel);
    query.set("channel", focusedChannel);
  }
  if (state.filters.workspaceId) query.set("workspaceId", state.filters.workspaceId);
  if (state.filters.channel !== "all") query.set("channel", state.filters.channel);
  window.location.assign(`devtools.html?${query.toString()}`);
};

const openPaletteNode = (item, contextNode = selectedNode()) => {
  const query = new URLSearchParams();
  const workspaceId = state.filters.workspaceId || contextNode?.workspaceId || "";
  const contextChannels = nodeChannels(contextNode || {});
  const channel = state.filters.channel !== "all" ? state.filters.channel : contextChannels[0] || state.focus.channel || "";
  if (workspaceId) query.set("workspaceId", workspaceId);
  if (channel) query.set("channel", channel);
  if (contextNode?.id) query.set("runtimeNodeId", contextNode.id);
  if (contextNode?.metadata?.draft) query.set("draftNodeId", contextNode.id);
  if (contextNode?.label) query.set("runtimeLabel", contextNode.label);

  const editorType = item.editorType || "";
  if (editorType) {
    if (editorType && window.TrackerLensBoxEditorDialog?.open) {
      window.TrackerLensBoxEditorDialog.open({
        type: editorType,
        id: contextNode?.sourceRef || contextNode?.assetId || "",
        template: item,
        workspaceId: workspaceId || "workspace_global",
        channel,
        draftNodeId: contextNode?.metadata?.draft ? contextNode.id : "",
        runtimeNodeId: contextNode?.id || "",
        runtimeLabel: contextNode?.label || "",
        onSave: async () => {
          await loadRuntime({ force: true, silent: true });
        },
      });
      return;
    }
    CMSwift.notify?.error?.("Editor universale non disponibile.");
    return;
  }

  if (item.url) {
    window.location.assign(`${item.url}${query.toString() ? `?${query.toString()}` : ""}`);
    return;
  }

  if (isExistingLibraryPaletteItem(item)) {
    openExistingLibraryDialog(item);
    return;
  }

  if (item.trackerSource) {
    query.set("source", item.trackerSource);
    query.set("trackerType", item.trackerSource);
    query.set("runtimeMode", item.runtimeMode || (item.trackerSource === "websocket" ? "real-time" : "interval"));
    if (window.TrackerLensBoxEditorDialog?.open) {
      window.TrackerLensBoxEditorDialog.open({
        type: "boxTracker",
        template: item,
        workspaceId: workspaceId || "workspace_global",
        channel,
        draftNodeId: contextNode?.metadata?.draft ? contextNode.id : "",
        runtimeNodeId: contextNode?.id || "",
        runtimeLabel: contextNode?.label || item.name || "",
        onSave: async () => {
          await loadRuntime({ force: true, silent: true });
        },
      });
      return;
    }
    CMSwift.notify?.error?.("Editor universale non disponibile.");
    return;
  }

  if (item.connectionType) {
    query.set("type", item.connectionType);
    window.location.assign(`connections.html?${query.toString()}`);
  }
};
