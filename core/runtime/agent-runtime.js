// Trackers Lens Agent Runtime v1: tool registry, flow run planning, traces and safe fix suggestions.
window.TrackerLensAgentRuntime = (() => {
  const VERSION = "agent-runtime-v1";
  const RUN_LIMIT = 250;
  const runs = new Map();

  const nowIso = () => new Date().toISOString();
  const runtimeId = (prefix = "agent_run") =>
    `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const normalizeWorkspaceId = (workspaceId = "") =>
    String(workspaceId || (typeof currentWorkspaceId === "function" ? currentWorkspaceId() : "") || "workspace_global");

  const normalizeChannel = (value = "") => String(value || "runtime").trim() || "runtime";

  const nodeLabel = (node = {}) => node.label || node.name || node.metadata?.paletteLabel || node.id || "Node";

  const nodeKind = (node = {}) =>
    String(node.metadata?.subtype || node.metadata?.manifest?.subtype || node.subtype || node.type || "").toLowerCase();

  const nodePorts = (node = {}) => ({
    inputs: Array.isArray(node.inputs) ? node.inputs : node.metadata?.manifest?.inputs || [],
    outputs: Array.isArray(node.outputs) ? node.outputs : node.metadata?.manifest?.outputs || [],
  });

  const nodeConfig = (node = {}) =>
    node.metadata?.config && typeof node.metadata.config === "object" && !Array.isArray(node.metadata.config)
      ? node.metadata.config
      : {};

  const nodeCategory = (node = {}) =>
    String(node.metadata?.category || node.metadata?.manifest?.category || node.type || "").toLowerCase();

  const parseJsonLoose = (text = "") => {
    if (!text || typeof text !== "string") return null;
    const clean = text.trim();
    const candidates = [
      clean,
      clean.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim(),
      clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1),
    ].filter(Boolean);
    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate);
      } catch {
        // Try the next candidate.
      }
    }
    return null;
  };

  const parseToolDeclarationValue = (value = null) => {
    if (!value) return null;
    if (typeof value === "object") return value;
    return parseJsonLoose(value);
  };

  const toolInputSchema = (properties = {}, required = []) => ({
    type: "object",
    properties,
    required,
  });

  const readTool = ({ name = "", label = "", purpose = "", inputSchema = {}, outputs = {}, requiresEvidence = false } = {}) => ({
    name,
    label: label || name,
    mode: "read",
    purpose,
    inputSchema,
    outputs,
    cost: { tokens: "low", latency: "low" },
    requiresEvidence: Boolean(requiresEvidence),
  });

  const defaultAgentToolsForNode = (node = {}) => {
    const subtype = nodeKind(node);
    const category = nodeCategory(node);
    if (["document-store", "text-knowledge", "workspace-memory", "conversation-memory"].includes(subtype)) {
      return [
        readTool({ name: "getDocumentInfo", label: "Get Document Info", purpose: "Return document ids, title, language, collection and chunk availability for this node scope.", inputSchema: toolInputSchema({ documentId: { type: "string" } }), outputs: { documents: "array", scope: "object" } }),
        readTool({ name: "getFullDocument", label: "Get Full Document", purpose: "Return full source text when allowed by size and node scope.", inputSchema: toolInputSchema({ documentId: { type: "string" }, maxChars: { type: "number" } }), outputs: { text: "string", evidence: "array" }, requiresEvidence: true }),
        readTool({ name: "searchChunks", label: "Search Chunks", purpose: "Find source text passages related to a query.", inputSchema: toolInputSchema({ query: { type: "string" }, limit: { type: "number" } }, ["query"]), outputs: { items: "array", evidence: "array" }, requiresEvidence: true }),
        readTool({ name: "getChunkWindow", label: "Get Chunk Window", purpose: "Return source chunks around a chunk id or ordinal.", inputSchema: toolInputSchema({ chunkId: { type: "string" }, ordinal: { type: "number" }, radius: { type: "number" } }), outputs: { chunks: "array", evidence: "array" }, requiresEvidence: true }),
      ];
    }
    if (["knowledge-dictionary-builder", "dictionary-builder"].includes(subtype)) {
      return [
        readTool({ name: "defineTerm", label: "Define Term", purpose: "Explain a term, aliases and type candidates in document context.", inputSchema: toolInputSchema({ term: { type: "string" }, documentId: { type: "string" } }, ["term"]), outputs: { entries: "array", evidence: "array" }, requiresEvidence: true }),
        readTool({ name: "resolveAmbiguity", label: "Resolve Ambiguity", purpose: "Return possible meanings for an ambiguous word or name.", inputSchema: toolInputSchema({ term: { type: "string" }, query: { type: "string" } }, ["term"]), outputs: { candidates: "array", evidence: "array" }, requiresEvidence: true }),
        readTool({ name: "listKeyTerms", label: "List Key Terms", purpose: "Return high-value dictionary terms usable for planning and retrieval.", inputSchema: toolInputSchema({ limit: { type: "number" }, tier: { type: "string" } }), outputs: { terms: "array", scope: "object" } }),
      ];
    }
    if (["knowledge-event-builder", "event-builder"].includes(subtype)) {
      return [
        readTool({ name: "getTimeline", label: "Get Timeline", purpose: "Return ordered events related to a query, participant or document.", inputSchema: toolInputSchema({ query: { type: "string" }, participant: { type: "string" }, limit: { type: "number" } }), outputs: { events: "array", evidence: "array" }, requiresEvidence: true }),
        readTool({ name: "findEvents", label: "Find Events", purpose: "Search persisted events by participant, event type or text.", inputSchema: toolInputSchema({ query: { type: "string" }, eventType: { type: "string" }, participant: { type: "string" } }), outputs: { events: "array", evidence: "array" }, requiresEvidence: true }),
        readTool({ name: "verifyEvent", label: "Verify Event", purpose: "Check whether a proposed event is supported by persisted evidence.", inputSchema: toolInputSchema({ claim: { type: "string" }, eventType: { type: "string" } }, ["claim"]), outputs: { supported: "boolean", evidence: "array", limitations: "array" }, requiresEvidence: true }),
      ];
    }
    if (["graph-query", "knowledge-graph", "knowledge-reasoning-composer", "semantic-relation-enricher", "knowledge-graph-builder-agent", "entity-extractor"].includes(subtype)) {
      return [
        readTool({ name: "findEntities", label: "Find Entities", purpose: "Search graph entities by query, aliases and type.", inputSchema: toolInputSchema({ query: { type: "string" }, entityType: { type: "string" }, limit: { type: "number" } }, ["query"]), outputs: { entities: "array", evidence: "array" } }),
        readTool({ name: "findRelations", label: "Find Relations", purpose: "Find graph relations for query/entity pairs.", inputSchema: toolInputSchema({ query: { type: "string" }, source: { type: "string" }, target: { type: "string" }, relationType: { type: "string" } }), outputs: { relations: "array", evidence: "array" }, requiresEvidence: true }),
        readTool({ name: "getGraphEvidence", label: "Get Graph Evidence", purpose: "Return source evidence behind graph facts.", inputSchema: toolInputSchema({ query: { type: "string" }, relationId: { type: "string" }, entityId: { type: "string" } }), outputs: { evidence: "array", limitations: "array" }, requiresEvidence: true }),
      ];
    }
    if (["rag-search", "embedding-generator", "vector-memory"].includes(subtype)) {
      return [
        readTool({ name: "searchChunks", label: "Search Chunks", purpose: "Retrieve semantically related chunks from the connected knowledge index.", inputSchema: toolInputSchema({ query: { type: "string" }, limit: { type: "number" } }, ["query"]), outputs: { items: "array", evidence: "array" }, requiresEvidence: true }),
      ];
    }
    if (category === "dev" || node.type === "devPreview") {
      return [
        readTool({ name: "showObservation", label: "Show Observation", purpose: "Display tool observations and evidence for QA.", inputSchema: toolInputSchema({ runId: { type: "string" }, observation: { type: "object" } }), outputs: { displayed: "boolean" } }),
        readTool({ name: "showAnswerTrace", label: "Show Answer Trace", purpose: "Display Agent plan, tool calls, verification result and final answer.", inputSchema: toolInputSchema({ runId: { type: "string" }, trace: { type: "object" } }), outputs: { displayed: "boolean" } }),
      ];
    }
    return [];
  };

  const normalizeAgentTool = (tool = {}, node = {}) => {
    const name = String(tool.name || tool.id || "").trim();
    if (!name) return null;
    const mode = String(tool.mode || "read").toLowerCase().trim();
    return {
      name,
      label: String(tool.label || name).trim(),
      mode: ["read", "plan", "verify", "mutate"].includes(mode) ? mode : "read",
      purpose: String(tool.purpose || tool.description || "").trim(),
      inputSchema: tool.inputSchema || tool.inputs || {},
      outputs: tool.outputs || tool.outputSchema || {},
      cost: tool.cost || { tokens: "low", latency: "low" },
      requiresEvidence: Boolean(tool.requiresEvidence),
      mcpName: `tl.node.${node.id || "node"}.${name}`,
    };
  };

  const nodeAgentTools = (node = {}) => {
    const config = nodeConfig(node);
    const declared = parseToolDeclarationValue(config.agentTools || node.metadata?.agentTools || node.metadata?.manifest?.agentTools);
    const declaredTools = Array.isArray(declared?.tools)
      ? declared.tools
      : Array.isArray(declared)
        ? declared
        : [];
    const source = declaredTools.length ? declaredTools : defaultAgentToolsForNode(node);
    return source.map((tool) => normalizeAgentTool(tool, node)).filter(Boolean).slice(0, 24);
  };

  const portName = (port = "") =>
    typeof port === "object" ? String(port.name || port.key || port.channel || port.id || "") : String(port || "");

  const portNames = (ports = []) => (Array.isArray(ports) ? ports : []).map(portName).filter(Boolean);

  const hasPort = (node = {}, side = "out", name = "") => {
    const normalized = String(name || "").trim();
    if (!normalized || normalized === "all") return true;
    const ports = nodePorts(node);
    return portNames(side === "in" ? ports.inputs : ports.outputs).includes(normalized);
  };

  const firstPort = (node = {}, side = "out", preferences = []) => {
    const ports = portNames(side === "in" ? nodePorts(node).inputs : nodePorts(node).outputs);
    return preferences.find((name) => ports.includes(name)) || ports[0] || "all";
  };

  const fixId = (parts = []) => `fix_${parts.filter(Boolean).join("_")}`.replace(/[^A-Za-z0-9_-]/g, "_");

  const nodeBySubtype = (nodes = [], subtypes = []) => {
    const wanted = new Set(subtypes.map((item) => String(item || "").toLowerCase()));
    return nodes.find((node) => wanted.has(nodeKind(node))) || null;
  };

  const nodeByLabel = (nodes = [], labels = []) => {
    const wanted = labels.map((item) => String(item || "").toLowerCase());
    return nodes.find((node) => wanted.some((label) => String(nodeLabel(node)).toLowerCase().includes(label))) || null;
  };

  const actionPreview = (action = {}) => {
    if (!action?.kind) return "No automatic change. Inspect the flow and decide manually.";
    if (action.kind === "delete-link") return `Delete invalid link ${action.dependencyId || action.connectionId || ""}.`;
    if (action.kind === "update-link-ports") return `Update link ports to ${action.sourcePort || "all"} -> ${action.targetPort || "all"}.`;
    if (action.kind === "create-link") return `Create link ${action.sourceLabel || action.sourceNodeId} -> ${action.targetLabel || action.targetNodeId} using ${action.sourcePort || "all"} -> ${action.targetPort || "all"}.`;
    if (action.kind === "create-agent-bridge") return `Create Agent Bridge after ${action.sourceLabel || action.sourceNodeId} and connect ${action.sourcePort || "agent_control"} -> agent_control.`;
    return "Apply safe runtime change.";
  };

  const makeFix = ({
    type = "inspect-runtime-issue",
    severity = "warning",
    problem = "",
    cause = "",
    actionText = "",
    risk = "low",
    safe = false,
    action = null,
    nodeId = "",
    dependencyId = "",
    connectionId = "",
    reason = "",
  } = {}) => ({
    id: fixId([type, nodeId, dependencyId, connectionId, action?.kind, action?.sourceNodeId, action?.targetNodeId, action?.sourcePort, action?.targetPort]),
    type,
    severity,
    nodeId,
    dependencyId,
    connectionId,
    problem: problem || reason || "Runtime issue detected.",
    cause: cause || reason || "The runtime graph validation reported an issue.",
    actionText: actionText || (action ? actionPreview(action) : "Inspect the item and correct it manually."),
    risk,
    safe: Boolean(safe && action?.kind),
    action,
    preview: actionPreview(action),
    reason: reason || problem || "",
  });

  const dedupeFixes = (fixes = []) => {
    const seen = new Set();
    return fixes.filter((fix) => {
      if (!fix?.id || seen.has(fix.id)) return false;
      seen.add(fix.id);
      return true;
    });
  };

  const buildSnapshot = async (workspaceId = "") => {
    const effectiveWorkspaceId = normalizeWorkspaceId(workspaceId);
    if (!window.TrackerLensGraphEngine?.buildGraph) {
      throw new Error("TrackerLensGraphEngine is not available.");
    }
    return window.TrackerLensGraphEngine.buildGraph({
      filters: {
        workspaceId: effectiveWorkspaceId,
        channel: "all",
        type: "all",
        origin: "all",
        state: "all",
        activity: "all",
        eventType: "all",
        logLevel: "all",
        runId: "all",
      },
      includeConnections: true,
    });
  };

  const graphNodes = (snapshot = {}) => snapshot.graph?.nodes || snapshot.runtime?.runtimeNodes || [];
  const graphDependencies = (snapshot = {}) => snapshot.graph?.dependencies || snapshot.runtime?.runtimeDependencies || [];

  const incomingFor = (dependencies = [], nodeId = "") =>
    dependencies.filter((dependency) => dependency.targetNodeId === nodeId);

  const outgoingFor = (dependencies = [], nodeId = "") =>
    dependencies.filter((dependency) => dependency.sourceNodeId === nodeId);

  const isControlDependency = (dependency = {}) =>
    ["agent_control", "agent-control"].includes(normalizeChannel(dependency.channel || dependency.metadata?.sourcePort || dependency.metadata?.targetPort).toLowerCase());

  const rootNodes = (nodes = [], dependencies = []) =>
    nodes.filter((node) => !incomingFor(dependencies, node.id).filter((dependency) => !isControlDependency(dependency)).length);

  const leafNodes = (nodes = [], dependencies = []) =>
    nodes.filter((node) => !outgoingFor(dependencies, node.id).filter((dependency) => !isControlDependency(dependency)).length);

  const matchingEventForStep = (events = [], step = {}) =>
    events.find((event) =>
      (step.nodeId && (event.sourceNodeId === step.nodeId || event.targetNodeId === step.nodeId)) ||
      (step.channel && normalizeChannel(event.channel) === normalizeChannel(step.channel))
    ) || null;

  const knowledgeStores = () => window.TrackerLensKnowledgeRuntime?.STORES || {
    documents: window.tlConfig?.TABLES?.TL_KNOWLEDGE_DOCUMENTS || "tl_knowledge_documents",
    chunks: window.tlConfig?.TABLES?.TL_KNOWLEDGE_CHUNKS || "tl_knowledge_chunks",
    dictionary: "tl_knowledge_dictionary",
    events: "tl_knowledge_events",
    entities: "tl_knowledge_entities",
    relations: "tl_knowledge_relations",
  };

  const readKnowledgeStore = async (name = "") => {
    if (window.TrackerLensKnowledgeRuntime?.listStore) {
      return window.TrackerLensKnowledgeRuntime.listStore(name).catch(() => []);
    }
    return [];
  };

  const compactText = (value = "", max = 1200) => {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text || text.length <= max) return text;
    return `${text.slice(0, Math.max(0, max)).trim()}...`;
  };

  const uniqueStrings = (values = []) =>
    [...new Set(values.filter(Boolean).map(String))];

  const normalizeSearchText = (value = "") =>
    String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9à-ÿ]+/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

  const queryTokens = (query = "") => {
    const stop = new Set(["the", "and", "that", "this", "with", "from", "come", "cosa", "che", "chi", "per", "con", "del", "della", "una", "uno", "que", "por", "para", "avec", "pour"]);
    return [...new Set(normalizeSearchText(query).split(/\s+/).filter((token) => token.length >= 2 && !stop.has(token)))].slice(0, 32);
  };

  const expandedQueryTokens = (query = "") => {
    const tokens = queryTokens(query);
    return tokens.slice(0, 48);
  };

  const scopedDocumentRecords = async ({ workspaceId = "", node = {}, args = {} } = {}) => {
    const stores = knowledgeStores();
    const config = nodeConfig(node);
    const argDocumentId = /^kdoc_/i.test(String(args.documentId || "")) ? String(args.documentId || "") : "";
    const configDocumentId = /^kdoc_/i.test(String(config.documentId || "")) ? String(config.documentId || "") : "";
    const collectionId = String(args.collectionId || config.collectionId || "").trim();
    const nodeSourceIds = new Set([node.id, `upload_${node.id}`, `live_${node.id}`].filter(Boolean));
    const allDocuments = (await readKnowledgeStore(stores.documents))
      .filter((document) => (document.workspaceId || "workspace_global") === workspaceId)
      .filter((document) => !argDocumentId || document.id === argDocumentId)
      .filter((document) => !configDocumentId || document.id === configDocumentId)
      .filter((document) => !collectionId || document.metadata?.collectionId === collectionId)
      .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
    const documents = allDocuments
      .filter((document) =>
        nodeSourceIds.has(document.sourceId) ||
        document.metadata?.nodeId === node.id ||
        configDocumentId === document.id ||
        (collectionId && document.metadata?.collectionId === collectionId)
      );
    return documents.length ? documents : allDocuments;
  };

  const scopedChunkRecords = async ({ workspaceId = "", node = {}, args = {}, documents = [] } = {}) => {
    const stores = knowledgeStores();
    const config = nodeConfig(node);
    const documentIds = new Set(documents.map((document) => document.id).filter(Boolean));
    const chunks = (await readKnowledgeStore(stores.chunks))
      .filter((chunk) => (chunk.workspaceId || "workspace_global") === workspaceId)
      .filter((chunk) => !args.documentId || chunk.documentId === args.documentId)
      .filter((chunk) => !args.chunkId || chunk.id === args.chunkId)
      .filter((chunk) => !config.collectionId || chunk.metadata?.collectionId === config.collectionId)
      .filter((chunk) => documentIds.has(chunk.documentId) || chunk.sourceId === node.id || chunk.metadata?.nodeId === node.id)
      .sort((a, b) =>
        String(a.documentId || "").localeCompare(String(b.documentId || "")) ||
        Number(a.ordinal ?? a.index ?? 0) - Number(b.ordinal ?? b.index ?? 0));
    return chunks;
  };

  const evidenceFromChunk = (chunk = {}, text = "") => ({
    sourceType: "document_chunk",
    documentId: chunk.documentId || "",
    chunkId: chunk.id || "",
    ordinal: Number.isFinite(Number(chunk.ordinal ?? chunk.index)) ? Number(chunk.ordinal ?? chunk.index) : null,
    text: text || chunk.text || "",
  });

  const evidenceText = (value = null) => {
    if (!value) return "";
    if (typeof value === "string") return compactText(value, 1200);
    return compactText(value.quote || value.text || value.excerpt || value.sentence || "", 1200);
  };

  const entryMatchesNodeScope = ({ entry = {}, node = {}, config = {}, documentIds = null } = {}) => {
    const collectionId = entry.collectionId || entry.metadata?.collectionId || "";
    const entryNodeId = entry.nodeId || entry.source?.nodeId || entry.metadata?.nodeId || "";
    if (config.documentId && entry.documentId !== config.documentId) return false;
    if (config.collectionId && collectionId !== config.collectionId) return false;
    if (documentIds?.size && entry.documentId && documentIds.has(entry.documentId)) return true;
    return entryNodeId === node.id ||
      entry.sourceId === node.id ||
      Boolean(config.documentId && entry.documentId === config.documentId) ||
      Boolean(config.collectionId && collectionId === config.collectionId) ||
      (!entryNodeId && !config.documentId && !config.collectionId);
  };

  const scopedKnowledgeRecords = async ({ workspaceId = "", node = {}, args = {}, store = "" } = {}) => {
    const stores = knowledgeStores();
    const config = nodeConfig(node);
    const documents = await scopedDocumentRecords({ workspaceId, node, args });
    const documentIds = new Set(documents.map((document) => document.id).filter(Boolean));
    return (await readKnowledgeStore(stores[store] || store))
      .filter((entry) => (entry.workspaceId || "workspace_global") === workspaceId)
      .filter((entry) => !args.documentId || entry.documentId === args.documentId)
      .filter((entry) => entryMatchesNodeScope({ entry, node, config, documentIds }));
  };

  const overlapScore = (text = "", tokens = []) => {
    if (!tokens.length) return 0;
    const normalized = normalizeSearchText(text);
    return tokens.reduce((score, token) => score + (normalized.includes(token) ? 1 : 0), 0);
  };

  const evidenceFromDictionaryEntry = (entry = {}) => {
    const pack = Array.isArray(entry.evidencePack) ? entry.evidencePack : [];
    if (pack.length) {
      return pack
        .map((item) => ({
          sourceType: "dictionary_entry",
          documentId: entry.documentId || "",
          chunkId: item.chunkId || entry.chunkId || "",
          ordinal: item.ordinal ?? null,
          term: entry.term || "",
          quote: item.quote || "",
          text: item.text || item.quote || "",
          start: item.start ?? null,
          end: item.end ?? null,
        }))
        .sort((left, right) =>
          Number(left.ordinal ?? 0) - Number(right.ordinal ?? 0) ||
          Number(left.start ?? 0) - Number(right.start ?? 0));
    }
    return [{
      sourceType: "dictionary_entry",
      documentId: entry.documentId || "",
      chunkId: entry.chunkId || "",
      ordinal: null,
      term: entry.term || "",
      text: evidenceText(entry.evidence) || entry.term || "",
    }];
  };

  const evidenceFromEvent = (event = {}) => ({
    sourceType: "knowledge_event",
    documentId: event.documentId || "",
    chunkId: event.chunkId || "",
    ordinal: Number.isFinite(Number(event.sequence)) ? Number(event.sequence) : null,
    eventId: event.id || "",
    text: evidenceText(event.evidence) || [
      event.subject,
      event.eventType,
      ...(Array.isArray(event.objects) ? event.objects : []),
    ].filter(Boolean).join(" "),
  });

  const evidenceFromRelation = (relation = {}, chunk = null) => ({
    sourceType: "knowledge_relation",
    documentId: relation.documentId || chunk?.documentId || "",
    chunkId: relation.chunkId || chunk?.id || "",
    ordinal: Number.isFinite(Number(chunk?.ordinal ?? chunk?.index)) ? Number(chunk?.ordinal ?? chunk?.index) : null,
    relationId: relation.id || "",
    text: evidenceText(relation.metadata?.ai?.evidence) || compactText(chunk?.text || [
      relation.sourceLabel,
      relation.relationType,
      relation.targetLabel,
    ].filter(Boolean).join(" "), 1200),
  });

  const toolEnvelope = ({ ok = true, tool = "", node = {}, status = "ready", answer = "", items = [], evidence = [], confidence = 0, limitations = [], usage = {}, debug = {} } = {}) => ({
    ok,
    tool,
    nodeId: node.id || "",
    status,
    answer,
    items,
    evidence,
    confidence: Math.max(0, Math.min(1, Number(confidence || 0))),
    limitations,
    usage,
    debug,
  });

  const runDocumentTool = async ({ workspaceId = "", node = {}, tool = "", args = {} } = {}) => {
    const documents = await scopedDocumentRecords({ workspaceId, node, args });
    const chunks = await scopedChunkRecords({ workspaceId, node, args, documents });
    const scopeDebug = {
      documentCount: documents.length,
      chunkCount: chunks.length,
      documentIds: documents.map((document) => document.id || "").filter(Boolean).slice(0, 12),
      chunkIds: chunks.map((chunk) => chunk.id || "").filter(Boolean).slice(0, 12),
      collectionIds: uniqueStrings(documents.map((document) => document.metadata?.collectionId || "").filter(Boolean)).slice(0, 8),
      argsDocumentId: args.documentId || "",
      argsCollectionId: args.collectionId || "",
      configDocumentId: nodeConfig(node).documentId || "",
      configCollectionId: nodeConfig(node).collectionId || "",
    };
    if (tool === "getDocumentInfo") {
      const chunkCountByDocument = chunks.reduce((map, chunk) => map.set(chunk.documentId, (map.get(chunk.documentId) || 0) + 1), new Map());
      return toolEnvelope({
        tool,
        node,
        items: documents.map((document) => ({
          id: document.id || "",
          title: document.title || "",
          language: document.language || document.metadata?.language || "",
          sourceType: document.sourceType || "",
          collectionId: document.metadata?.collectionId || "",
          status: document.status || "",
          chunkCount: chunkCountByDocument.get(document.id) || 0,
          createdAt: document.createdAt || "",
          updatedAt: document.updatedAt || "",
        })),
        confidence: documents.length ? 0.95 : 0,
        limitations: documents.length ? [] : ["No scoped documents found for this connected node."],
        debug: scopeDebug,
      });
    }
    if (tool === "getFullDocument") {
      const maxChars = Math.max(1000, Math.min(120000, Number(args.maxChars || 24000)));
      const document = documents.find((item) => !args.documentId || item.id === args.documentId) || documents[documents.length - 1] || null;
      if (!document) {
        return toolEnvelope({ ok: false, tool, node, status: "empty", limitations: ["No scoped document found."], confidence: 0, debug: scopeDebug });
      }
      const documentChunks = chunks
        .filter((chunk) => chunk.documentId === document.id)
        .sort((a, b) => Number(a.ordinal ?? a.index ?? 0) - Number(b.ordinal ?? b.index ?? 0));
      const chunkText = documentChunks.map((chunk) => String(chunk.text || "").trim()).filter(Boolean).join("\n\n");
      const storedText = String(document.text || "");
      const text = chunkText.length > storedText.length ? chunkText : storedText;
      const sourceMode = chunkText.length > storedText.length ? "chunks" : "document";
      const clipped = text.length > maxChars ? `${text.slice(0, maxChars).trim()}...` : text;
      return toolEnvelope({
        tool,
        node,
        answer: clipped,
        items: [{ documentId: document.id, title: document.title || "", text: clipped }],
        evidence: [{ sourceType: "document", documentId: document.id || "", chunkId: "", ordinal: null, text: clipped }],
        confidence: text ? 0.95 : 0.2,
        limitations: text.length > maxChars ? [`Document truncated to ${maxChars} characters.`] : [],
        debug: {
          ...scopeDebug,
          selectedDocumentId: document.id || "",
          sourceMode,
          selectedChunkCount: documentChunks.length,
          selectedChunkIds: documentChunks.map((chunk) => chunk.id || "").filter(Boolean).slice(0, 24),
          selectedOrdinals: documentChunks.map((chunk) => chunk.ordinal ?? chunk.index ?? null).filter((value) => value !== null).slice(0, 24),
          storedDocumentChars: storedText.length,
          reconstructedChunkChars: chunkText.length,
          fullDocumentChars: text.length,
          returnedChars: clipped.length,
          truncated: text.length > maxChars,
          maxChars,
        },
      });
    }
    if (tool === "searchChunks") {
      const tokens = expandedQueryTokens(args.query || "");
      if (!tokens.length) {
        return toolEnvelope({ ok: false, tool, node, status: "invalid", limitations: ["Missing query tokens."], confidence: 0, debug: scopeDebug });
      }
      const limit = Math.max(1, Math.min(24, Number(args.limit || 6)));
      const candidates = chunks.length
        ? chunks
        : documents.map((document, index) => ({ id: `document_${document.id}`, documentId: document.id, ordinal: index, text: document.text || "", metadata: { title: document.title || "" } }));
      const ranked = candidates
        .map((chunk) => {
          const normalized = normalizeSearchText(chunk.text || "");
          const matches = tokens.filter((token) => normalized.includes(token));
          const exactScore = matches.reduce((score, token) => score + (new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(normalized) ? 2 : 1), 0);
          return { chunk, matches, score: exactScore };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || Number(a.chunk.ordinal ?? 0) - Number(b.chunk.ordinal ?? 0))
        .slice(0, limit);
      const evidence = ranked.map((item) => evidenceFromChunk(item.chunk, compactText(item.chunk.text || "", Math.max(400, Math.min(2400, Number(args.maxChars || 900))))));
      return toolEnvelope({
        tool,
        node,
        items: ranked.map((item) => ({
          chunkId: item.chunk.id || "",
          documentId: item.chunk.documentId || "",
          ordinal: item.chunk.ordinal ?? item.chunk.index ?? null,
          score: item.score,
          matches: item.matches,
          text: compactText(item.chunk.text || "", Math.max(400, Math.min(2400, Number(args.maxChars || 900)))),
        })),
        evidence,
        confidence: ranked.length ? Math.min(0.95, 0.45 + ranked[0].score * 0.08) : 0,
        limitations: ranked.length ? [] : ["No matching chunks found. Agent should try getFullDocument or a broader query if the answer requires source evidence."],
        debug: {
          ...scopeDebug,
          queryTokens: tokens,
          candidateCount: candidates.length,
          selectedChunkCount: ranked.length,
          selectedChunkIds: ranked.map((item) => item.chunk.id || "").filter(Boolean).slice(0, 24),
          selectedOrdinals: ranked.map((item) => item.chunk.ordinal ?? item.chunk.index ?? null).filter((value) => value !== null).slice(0, 24),
          selectedDocumentIds: uniqueStrings(ranked.map((item) => item.chunk.documentId || "").filter(Boolean)).slice(0, 12),
          maxChars: Math.max(400, Math.min(2400, Number(args.maxChars || 900))),
        },
      });
    }
    if (tool === "getChunkWindow") {
      const radius = Math.max(0, Math.min(8, Number(args.radius ?? 1)));
      const target = args.chunkId
        ? chunks.find((chunk) => chunk.id === args.chunkId)
        : chunks.find((chunk) => Number(chunk.ordinal ?? chunk.index ?? -1) === Number(args.ordinal));
      if (!target) {
        return toolEnvelope({ ok: false, tool, node, status: "empty", limitations: ["Target chunk not found in node scope."], confidence: 0, debug: scopeDebug });
      }
      const targetOrdinal = Number(target.ordinal ?? target.index ?? 0);
      const windowChunks = chunks
        .filter((chunk) => chunk.documentId === target.documentId)
        .filter((chunk) => Math.abs(Number(chunk.ordinal ?? chunk.index ?? 0) - targetOrdinal) <= radius)
        .sort((a, b) => Number(a.ordinal ?? a.index ?? 0) - Number(b.ordinal ?? b.index ?? 0));
      return toolEnvelope({
        tool,
        node,
        items: windowChunks.map((chunk) => ({
          chunkId: chunk.id || "",
          documentId: chunk.documentId || "",
          ordinal: chunk.ordinal ?? chunk.index ?? null,
          text: chunk.text || "",
        })),
        evidence: windowChunks.map((chunk) => evidenceFromChunk(chunk)),
        confidence: windowChunks.length ? 0.95 : 0,
        debug: {
          ...scopeDebug,
          selectedChunkCount: windowChunks.length,
          selectedChunkIds: windowChunks.map((chunk) => chunk.id || "").filter(Boolean).slice(0, 24),
          selectedOrdinals: windowChunks.map((chunk) => chunk.ordinal ?? chunk.index ?? null).filter((value) => value !== null).slice(0, 24),
          selectedDocumentIds: uniqueStrings(windowChunks.map((chunk) => chunk.documentId || "").filter(Boolean)).slice(0, 12),
        },
      });
    }
    return toolEnvelope({ ok: false, tool, node, status: "unsupported", limitations: [`Unsupported document tool: ${tool}`], confidence: 0 });
  };

  const runDictionaryTool = async ({ workspaceId = "", node = {}, tool = "", args = {} } = {}) => {
    const entries = await scopedKnowledgeRecords({ workspaceId, node, args, store: "dictionary" });
    const limit = Math.max(1, Math.min(80, Number(args.limit || 12)));
    const term = String(args.term || args.query || "").trim();
    const tokens = expandedQueryTokens(term);
    const ranked = entries
      .map((entry) => {
        const aliases = Array.isArray(entry.aliases) ? entry.aliases : [];
        const typeText = Array.isArray(entry.typeCandidates) ? entry.typeCandidates.map((item) => item?.type || "").join(" ") : "";
        const haystack = [entry.term, entry.lemma, entry.normalized, aliases.join(" "), typeText, evidenceText(entry.evidence)].join(" ");
        const exact = term && normalizeSearchText(entry.term || entry.lemma || "") === normalizeSearchText(term) ? 8 : 0;
        const aliasExact = term && aliases.some((alias) => normalizeSearchText(alias) === normalizeSearchText(term)) ? 6 : 0;
        const score = exact + aliasExact + overlapScore(haystack, tokens) + Number(entry.seedScore || 0) + Number(entry.confidence || 0);
        return { entry, score };
      })
      .filter((item) => tool === "listKeyTerms" || item.score > 0)
      .sort((a, b) =>
        b.score - a.score ||
        Number(b.entry.usableAsSeed || 0) - Number(a.entry.usableAsSeed || 0) ||
        Number(b.entry.seedScore || 0) - Number(a.entry.seedScore || 0) ||
        String(a.entry.term || "").localeCompare(String(b.entry.term || "")));
    if (tool === "defineTerm" || tool === "resolveAmbiguity") {
      if (!tokens.length) {
        return toolEnvelope({ ok: false, tool, node, status: "invalid", limitations: ["Missing term."], confidence: 0 });
      }
      const selected = ranked.slice(0, limit);
      const items = selected.map(({ entry, score }) => ({
        id: entry.id || "",
        term: entry.term || "",
        lemma: entry.lemma || "",
        aliases: entry.aliases || [],
        typeCandidates: entry.typeCandidates || [],
        tier: entry.tier || "",
        usableAsSeed: Boolean(entry.usableAsSeed),
        seedScore: entry.seedScore || 0,
        semanticHints: entry.semanticHints || [],
        relationCues: entry.relationCues || [],
        confidence: entry.confidence || 0,
        evidence: evidenceText(entry.evidence),
        evidencePack: (entry.evidencePack || []).slice(0, 8),
        evidenceCount: Array.isArray(entry.evidencePack) ? entry.evidencePack.length : 0,
        score,
      }));
      const evidence = selected
        .flatMap(({ entry }) => evidenceFromDictionaryEntry(entry))
        .filter((item) => item.text)
        .sort((left, right) =>
          Number(left.ordinal ?? 0) - Number(right.ordinal ?? 0) ||
          Number(left.start ?? 0) - Number(right.start ?? 0));
      return toolEnvelope({
        tool,
        node,
        answer: items.length ? `${items[0].term || term}: ${items[0].typeCandidates?.[0]?.type || items[0].tier || "term"}` : "",
        items,
        evidence,
        confidence: items.length ? Math.min(0.95, 0.45 + selected[0].score * 0.06) : 0,
        limitations: items.length ? [] : ["No dictionary entry matched the requested term."],
      });
    }
    if (tool === "listKeyTerms") {
      const tier = String(args.tier || "").toLowerCase().trim();
      const filtered = ranked
        .filter(({ entry }) => !tier || String(entry.tier || "").toLowerCase() === tier)
        .slice(0, limit);
      return toolEnvelope({
        tool,
        node,
        items: filtered.map(({ entry, score }) => ({
          id: entry.id || "",
          term: entry.term || "",
          lemma: entry.lemma || "",
          type: entry.typeCandidates?.[0]?.type || "",
          tier: entry.tier || "",
          usableAsSeed: Boolean(entry.usableAsSeed),
          seedScore: entry.seedScore || 0,
          confidence: entry.confidence || 0,
          score,
        })),
        confidence: filtered.length ? 0.9 : 0,
        limitations: filtered.length ? [] : ["No dictionary terms found in this node scope."],
      });
    }
    return toolEnvelope({ ok: false, tool, node, status: "unsupported", limitations: [`Unsupported dictionary tool: ${tool}`], confidence: 0 });
  };

  const eventSearchText = (event = {}) => [
    event.subject,
    event.eventType,
    ...(Array.isArray(event.objects) ? event.objects : []),
    ...(Array.isArray(event.participants) ? event.participants : []),
    evidenceText(event.evidence),
    event.metadata?.explanation || "",
  ].filter(Boolean).join(" ");

  const rankEvents = (events = [], args = {}) => {
    const query = String(args.query || args.claim || "").trim();
    const tokens = expandedQueryTokens(query);
    const participant = normalizeSearchText(args.participant || "");
    const eventType = normalizeSearchText(args.eventType || "");
    return events
      .map((event) => {
        const text = eventSearchText(event);
        const normalized = normalizeSearchText(text);
        const participantHit = participant && normalized.includes(participant) ? 4 : 0;
        const typeHit = eventType && normalizeSearchText(event.eventType || "").includes(eventType) ? 3 : 0;
        const score = overlapScore(text, tokens) + participantHit + typeHit + Number(event.confidence || 0);
        return { event, score };
      })
      .filter((item) => {
        if (participant && !normalizeSearchText(eventSearchText(item.event)).includes(participant)) return false;
        if (eventType && !normalizeSearchText(item.event.eventType || "").includes(eventType)) return false;
        return !tokens.length || item.score > Number(item.event.confidence || 0);
      })
      .sort((a, b) =>
        b.score - a.score ||
        Number(a.event.sequence ?? 0) - Number(b.event.sequence ?? 0));
  };

  const runEventTool = async ({ workspaceId = "", node = {}, tool = "", args = {} } = {}) => {
    const events = (await scopedKnowledgeRecords({ workspaceId, node, args, store: "events" }))
      .sort((a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0));
    const limit = Math.max(1, Math.min(80, Number(args.limit || 18)));
    if (tool === "getTimeline" || tool === "findEvents") {
      const hasFilter = Boolean(String(args.query || args.participant || args.eventType || "").trim());
      const ranked = hasFilter ? rankEvents(events, args) : events.map((event) => ({ event, score: Number(event.confidence || 0) }));
      const selected = (ranked.length || tool === "findEvents" ? ranked : events.map((event) => ({ event, score: Number(event.confidence || 0) })))
        .slice(0, limit)
        .sort((a, b) => Number(a.event.sequence ?? 0) - Number(b.event.sequence ?? 0));
      return toolEnvelope({
        tool,
        node,
        items: selected.map(({ event, score }) => ({
          id: event.id || "",
          sequence: event.sequence ?? null,
          eventType: event.eventType || "",
          subject: event.subject || "",
          objects: event.objects || [],
          participants: event.participants || [],
          roles: event.roles || {},
          polarity: event.polarity || "",
          modality: event.modality || "",
          confidence: event.confidence || 0,
          evidence: evidenceText(event.evidence),
          score,
        })),
        evidence: selected.map(({ event }) => evidenceFromEvent(event)).filter((item) => item.text),
        confidence: selected.length ? Math.min(0.95, 0.45 + Number(selected[0].score || 0) * 0.08) : 0,
        limitations: selected.length ? [] : ["No persisted events matched the request in this node scope."],
      });
    }
    if (tool === "verifyEvent") {
      const claim = String(args.claim || "").trim();
      if (!claim) {
        return toolEnvelope({ ok: false, tool, node, status: "invalid", limitations: ["Missing claim."], confidence: 0 });
      }
      const ranked = rankEvents(events, args).slice(0, limit);
      const bestScore = Number(ranked[0]?.score || 0);
      const supported = bestScore >= Math.max(2, Math.min(5, queryTokens(claim).length));
      return toolEnvelope({
        tool,
        node,
        answer: supported ? "supported" : "not_verified",
        items: ranked.map(({ event, score }) => ({
          id: event.id || "",
          sequence: event.sequence ?? null,
          eventType: event.eventType || "",
          subject: event.subject || "",
          objects: event.objects || [],
          participants: event.participants || [],
          confidence: event.confidence || 0,
          evidence: evidenceText(event.evidence),
          score,
        })),
        evidence: ranked.map(({ event }) => evidenceFromEvent(event)).filter((item) => item.text),
        confidence: supported ? Math.min(0.95, 0.5 + bestScore * 0.07) : Math.min(0.4, bestScore * 0.08),
        limitations: supported ? [] : ["The claim was not strongly verified by persisted event evidence. Agent should ask source text tools before finalizing."],
        usage: { supported },
      });
    }
    return toolEnvelope({ ok: false, tool, node, status: "unsupported", limitations: [`Unsupported event tool: ${tool}`], confidence: 0 });
  };

  const relationSearchText = (relation = {}, source = null, target = null) => [
    relation.sourceLabel,
    relation.relationType,
    relation.targetLabel,
    source?.label,
    target?.label,
    source?.entityType,
    target?.entityType,
    evidenceText(relation.metadata?.ai?.evidence),
    relation.metadata?.ai?.explanation || "",
  ].filter(Boolean).join(" ");

  const runGraphTool = async ({ workspaceId = "", node = {}, tool = "", args = {} } = {}) => {
    const stores = knowledgeStores();
    const [entities, relations, workspaceChunks] = await Promise.all([
      scopedKnowledgeRecords({ workspaceId, node, args, store: "entities" }),
      scopedKnowledgeRecords({ workspaceId, node, args, store: "relations" }),
      readKnowledgeStore(stores.chunks),
    ]);
    const relationChunkIds = new Set(relations.map((relation) => relation.chunkId).filter(Boolean));
    const entityChunkIds = new Set(entities.map((entity) => entity.chunkId).filter(Boolean));
    const chunks = workspaceChunks
      .filter((chunk) => (chunk.workspaceId || "workspace_global") === workspaceId)
      .filter((chunk) => !args.documentId || chunk.documentId === args.documentId)
      .filter((chunk) => relationChunkIds.has(chunk.id) || entityChunkIds.has(chunk.id));
    const entityById = new Map(entities.map((entity) => [entity.id, entity]));
    const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    const limit = Math.max(1, Math.min(80, Number(args.limit || 18)));
    if (tool === "findEntities") {
      const tokens = expandedQueryTokens(args.query || "");
      const entityType = normalizeSearchText(args.entityType || "");
      if (!tokens.length && !entityType) {
        return toolEnvelope({ ok: false, tool, node, status: "invalid", limitations: ["Missing entity query or entityType."], confidence: 0 });
      }
      const ranked = entities
        .map((entity) => {
          const aliases = Array.isArray(entity.metadata?.aliases) ? entity.metadata.aliases : [];
          const text = [entity.label, entity.normalized, entity.entityType, aliases.join(" "), evidenceText(entity.metadata?.ai?.evidence)].join(" ");
          const typeHit = entityType && normalizeSearchText(entity.entityType || "").includes(entityType) ? 3 : 0;
          const exact = tokens.some((token) => normalizeSearchText(entity.label || "") === token) ? 5 : 0;
          const score = exact + typeHit + overlapScore(text, tokens) + Number(entity.confidence || 0);
          return { entity, score };
        })
        .filter((item) => item.score > Number(item.entity.confidence || 0))
        .sort((a, b) => b.score - a.score || String(a.entity.label || "").localeCompare(String(b.entity.label || "")))
        .slice(0, limit);
      return toolEnvelope({
        tool,
        node,
        items: ranked.map(({ entity, score }) => ({
          id: entity.id || "",
          label: entity.label || "",
          entityType: entity.entityType || "",
          aliases: entity.metadata?.aliases || [],
          documentId: entity.documentId || "",
          chunkId: entity.chunkId || "",
          confidence: entity.confidence || 0,
          score,
        })),
        evidence: ranked.map(({ entity }) => {
          const chunk = chunkById.get(entity.chunkId || "");
          return evidenceFromChunk(chunk || entity, evidenceText(entity.metadata?.ai?.evidence) || compactText(chunk?.text || entity.label || "", 900));
        }).filter((item) => item.text),
        confidence: ranked.length ? Math.min(0.95, 0.45 + Number(ranked[0].score || 0) * 0.07) : 0,
        limitations: ranked.length ? [] : ["No graph entities matched the request in this node scope."],
      });
    }
    if (tool === "findRelations") {
      const tokens = expandedQueryTokens(args.query || [args.source, args.target].filter(Boolean).join(" "));
      const sourceNeedle = normalizeSearchText(args.source || "");
      const targetNeedle = normalizeSearchText(args.target || "");
      const relationType = normalizeSearchText(args.relationType || "");
      const ranked = relations
        .map((relation) => {
          const source = entityById.get(relation.sourceEntityId || "");
          const target = entityById.get(relation.targetEntityId || "");
          const text = relationSearchText(relation, source, target);
          const normalized = normalizeSearchText(text);
          const sourceHit = sourceNeedle && normalizeSearchText([relation.sourceLabel, source?.label].filter(Boolean).join(" ")).includes(sourceNeedle) ? 4 : 0;
          const targetHit = targetNeedle && normalizeSearchText([relation.targetLabel, target?.label].filter(Boolean).join(" ")).includes(targetNeedle) ? 4 : 0;
          const typeHit = relationType && normalizeSearchText(relation.relationType || "").includes(relationType) ? 3 : 0;
          const score = overlapScore(normalized, tokens) + sourceHit + targetHit + typeHit + Number(relation.confidence || 0);
          return { relation, source, target, score };
        })
        .filter((item) => {
          if (sourceNeedle && !normalizeSearchText([item.relation.sourceLabel, item.source?.label].filter(Boolean).join(" ")).includes(sourceNeedle)) return false;
          if (targetNeedle && !normalizeSearchText([item.relation.targetLabel, item.target?.label].filter(Boolean).join(" ")).includes(targetNeedle)) return false;
          if (relationType && !normalizeSearchText(item.relation.relationType || "").includes(relationType)) return false;
          return tokens.length || sourceNeedle || targetNeedle || relationType ? item.score > Number(item.relation.confidence || 0) : true;
        })
        .sort((a, b) => b.score - a.score || String(a.relation.relationType || "").localeCompare(String(b.relation.relationType || "")))
        .slice(0, limit);
      return toolEnvelope({
        tool,
        node,
        items: ranked.map(({ relation, source, target, score }) => ({
          id: relation.id || "",
          relationType: relation.relationType || "",
          sourceEntityId: relation.sourceEntityId || "",
          targetEntityId: relation.targetEntityId || "",
          sourceLabel: relation.sourceLabel || source?.label || "",
          targetLabel: relation.targetLabel || target?.label || "",
          documentId: relation.documentId || "",
          chunkId: relation.chunkId || "",
          confidence: relation.confidence || 0,
          score,
        })),
        evidence: ranked.map(({ relation }) => evidenceFromRelation(relation, chunkById.get(relation.chunkId || ""))).filter((item) => item.text),
        confidence: ranked.length ? Math.min(0.95, 0.45 + Number(ranked[0].score || 0) * 0.07) : 0,
        limitations: ranked.length ? [] : ["No graph relations matched the request in this node scope."],
      });
    }
    if (tool === "getGraphEvidence") {
      const tokens = expandedQueryTokens(args.query || "");
      const selectedRelations = relations
        .map((relation) => ({
          relation,
          score: overlapScore(relationSearchText(relation, entityById.get(relation.sourceEntityId || ""), entityById.get(relation.targetEntityId || "")), tokens) + Number(relation.confidence || 0),
        }))
        .filter(({ relation }) => !args.relationId || relation.id === args.relationId)
        .filter(({ relation, score }) => {
          if (args.entityId && relation.sourceEntityId !== args.entityId && relation.targetEntityId !== args.entityId) return false;
          return !tokens.length || score > Number(relation.confidence || 0);
        })
        .sort((left, right) => right.score - left.score || String(left.relation.id || "").localeCompare(String(right.relation.id || "")))
        .map(({ relation }) => relation)
        .slice(0, limit);
      const selectedEntities = entities
        .map((entity) => ({
          entity,
          score: overlapScore([entity.label, entity.entityType, evidenceText(entity.metadata?.ai?.evidence)].join(" "), tokens) + Number(entity.confidence || 0),
        }))
        .filter(({ entity }) => !args.entityId || entity.id === args.entityId)
        .filter(({ entity, score }) => !tokens.length || score > Number(entity.confidence || 0))
        .sort((left, right) => right.score - left.score || String(left.entity.label || "").localeCompare(String(right.entity.label || "")))
        .map(({ entity }) => entity)
        .slice(0, Math.max(0, limit - selectedRelations.length));
      const relationEvidence = selectedRelations.map((relation) => evidenceFromRelation(relation, chunkById.get(relation.chunkId || ""))).filter((item) => item.text);
      const entityEvidence = selectedEntities.map((entity) => {
        const chunk = chunkById.get(entity.chunkId || "");
        return evidenceFromChunk(chunk || entity, evidenceText(entity.metadata?.ai?.evidence) || compactText(chunk?.text || entity.label || "", 900));
      }).filter((item) => item.text);
      const evidence = [...relationEvidence, ...entityEvidence].slice(0, limit);
      return toolEnvelope({
        tool,
        node,
        items: [
          ...selectedRelations.map((relation) => ({ id: relation.id || "", type: "relation", relationType: relation.relationType || "", sourceLabel: relation.sourceLabel || "", targetLabel: relation.targetLabel || "" })),
          ...selectedEntities.map((entity) => ({ id: entity.id || "", type: "entity", label: entity.label || "", entityType: entity.entityType || "" })),
        ].slice(0, limit),
        evidence,
        confidence: evidence.length ? 0.85 : 0,
        limitations: evidence.length ? ["Graph evidence is derived; source document chunks remain the highest authority for final answers."] : ["No graph evidence matched the request in this node scope."],
      });
    }
    return toolEnvelope({ ok: false, tool, node, status: "unsupported", limitations: [`Unsupported graph tool: ${tool}`], confidence: 0 });
  };

  const createTraceStep = ({ node = {}, dependency = null, index = 0, status = "pending", message = "", events = [] } = {}) => {
    const ports = nodePorts(node);
    const channel = dependency ? normalizeChannel(dependency.channel || dependency.metadata?.sourcePort || "runtime") : "";
    const step = {
      id: runtimeId("agent_step"),
      index,
      nodeId: node.id || "",
      label: nodeLabel(node),
      type: node.type || "",
      subtype: nodeKind(node),
      status,
      channel,
      sourceNodeId: dependency?.sourceNodeId || "",
      targetNodeId: dependency?.targetNodeId || "",
      dependencyId: dependency?.id || "",
      connectionId: dependency?.connectionId || "",
      sourcePort: dependency?.metadata?.sourcePort || dependency?.sourcePort || channel || "",
      targetPort: dependency?.metadata?.targetPort || dependency?.targetPort || "",
      expectedInput: ports.inputs?.length ? ports.inputs : dependency?.metadata?.targetPort ? [dependency.metadata.targetPort] : [],
      expectedOutput: ports.outputs?.length ? ports.outputs : dependency?.metadata?.sourcePort ? [dependency.metadata.sourcePort] : [],
      message,
      startedAt: "",
      finishedAt: "",
      latencyMs: 0,
      lastEvent: null,
    };
    const lastEvent = matchingEventForStep(events, step);
    if (lastEvent) {
      step.lastEvent = {
        id: lastEvent.id || "",
        channel: lastEvent.channel || "",
        eventType: lastEvent.eventType || "",
        status: lastEvent.status || "",
        createdAt: lastEvent.createdAt || "",
        payload: lastEvent.payload,
      };
    }
    return step;
  };

  const orderedPlan = ({ nodes = [], dependencies = [], events = [], startNodeId = "" } = {}) => {
    const lookup = new Map(nodes.map((node) => [node.id, node]));
    const roots = startNodeId
      ? nodes.filter((node) => node.id === startNodeId)
      : rootNodes(nodes, dependencies);
    const visited = new Set();
    const steps = [];
    const queue = roots.map((node) => ({ node, dependency: null }));

    while (queue.length) {
      const current = queue.shift();
      if (!current.node?.id || visited.has(current.node.id)) continue;
      visited.add(current.node.id);
      steps.push(createTraceStep({
        node: current.node,
        dependency: current.dependency,
        events,
        index: steps.length + 1,
        status: "pending",
        message: "Ready for runtime execution.",
      }));
      outgoingFor(dependencies, current.node.id)
        .filter((dependency) => !isControlDependency(dependency))
        .forEach((dependency) => {
          const target = lookup.get(dependency.targetNodeId);
          if (target && !visited.has(target.id)) queue.push({ node: target, dependency });
        });
    }

    return {
      roots: roots.map((node) => node.id),
      steps,
      skippedNodeIds: nodes.map((node) => node.id).filter((id) => !visited.has(id)),
    };
  };

  const summarizeFlow = (snapshot = {}) => {
    const nodes = graphNodes(snapshot);
    const dependencies = graphDependencies(snapshot);
    const roots = rootNodes(nodes, dependencies);
    const leaves = leafNodes(nodes, dependencies);
    const agentNodes = nodes.filter((node) => node.type === "aiAgent" || node.metadata?.category === "ai-agents");
    return {
      workspaceId: snapshot.filters?.workspaceId || "",
      nodes: nodes.length,
      dependencies: dependencies.length,
      roots: roots.map((node) => ({ id: node.id, label: nodeLabel(node), type: node.type || "", subtype: nodeKind(node) })),
      leaves: leaves.map((node) => ({ id: node.id, label: nodeLabel(node), type: node.type || "", subtype: nodeKind(node) })),
      agentNodes: agentNodes.map((node) => ({ id: node.id, label: nodeLabel(node), type: node.type || "", subtype: nodeKind(node) })),
      validation: snapshot.validation || null,
      stats: snapshot.stats || {},
    };
  };

  const inspectFlow = async ({ workspaceId = "" } = {}) => {
    const snapshot = await buildSnapshot(workspaceId);
    return {
      version: VERSION,
      inspectedAt: nowIso(),
      summary: summarizeFlow(snapshot),
      issues: snapshot.validation?.issues || [],
    };
  };

  const inspectNode = async ({ workspaceId = "", nodeId = "" } = {}) => {
    if (!nodeId) throw new Error("nodeId is required.");
    const effectiveWorkspaceId = normalizeWorkspaceId(workspaceId);
    const inspected = await window.TrackerLensGraphEngine.inspectNode(nodeId, {
      workspaceId: effectiveWorkspaceId,
      channel: "all",
      type: "all",
      origin: "all",
      state: "all",
      activity: "all",
      eventType: "all",
      logLevel: "all",
      runId: "all",
    });
    return {
      version: VERSION,
      inspectedAt: nowIso(),
      node: inspected.node ? {
        id: inspected.node.id,
        label: nodeLabel(inspected.node),
        type: inspected.node.type || "",
        subtype: nodeKind(inspected.node),
        ports: nodePorts(inspected.node),
        agentTools: nodeAgentTools(inspected.node),
        status: inspected.node.status || inspected.node.runtime?.status || inspected.node.metadata?.runtimeStatus || "idle",
      } : null,
      dependencies: inspected.dependencies || [],
      connectedTools: inspected.node ? await inspectConnectedTools({ workspaceId: effectiveWorkspaceId, nodeId }) : null,
      recentEvents: (inspected.events || []).slice(0, 10),
      impact: inspected.impact || null,
    };
  };

  const toolManifestForNode = (node = {}, relation = "workspace") => {
    const tools = nodeAgentTools(node);
    return {
      nodeId: node.id || "",
      label: nodeLabel(node),
      type: node.type || "",
      category: nodeCategory(node),
      subtype: nodeKind(node),
      relation,
      toolCount: tools.length,
      tools,
    };
  };

  const dependencyLinkType = (dependency = {}) =>
    String(dependency.metadata?.linkType || dependency.mapping?.linkType || dependency.linkType || "data").toLowerCase();

  const isToolAccessDependency = (dependency = {}) =>
    dependencyLinkType(dependency) === "tool-access" ||
    ["agent_tools", "agent.tools", "agent-tools"].includes(String(dependency.channel || "").toLowerCase()) ||
    ["agent_tools", "agent.tools", "agent-tools"].includes(String(dependency.metadata?.sourcePort || "").toLowerCase()) ||
    ["agent_tools", "agent.tools", "agent-tools"].includes(String(dependency.metadata?.targetPort || "").toLowerCase());

  const connectedNodeIds = ({ dependencies = [], nodeId = "" } = {}) => {
    const relatedIds = new Set();
    if (!nodeId) return relatedIds;
    const active = dependencies.filter((dependency) => dependency.status !== "disabled");
    const directToolAccess = active.filter((dependency) =>
      isToolAccessDependency(dependency) &&
      (dependency.sourceNodeId === nodeId || dependency.targetNodeId === nodeId)
    );
    const direct = (directToolAccess.length ? directToolAccess : active.filter((dependency) =>
      dependency.sourceNodeId === nodeId || dependency.targetNodeId === nodeId
    ));
    relatedIds.add(nodeId);
    direct.forEach((dependency) => {
      const source = dependency.sourceNodeId || "";
      const target = dependency.targetNodeId || "";
      const next = source === nodeId ? target : source;
      if (next) relatedIds.add(next);
    });
    return relatedIds;
  };

  const inspectConnectedTools = async ({ workspaceId = "", nodeId = "", includeWorkspace = false, runtime = null } = {}) => {
    const effectiveWorkspaceId = normalizeWorkspaceId(workspaceId);
    const snapshot = runtime
      ? { runtime, graph: { nodes: runtime.nodes || runtime.runtimeNodes || [], dependencies: runtime.dependencies || runtime.runtimeDependencies || [] } }
      : await buildSnapshot(effectiveWorkspaceId);
    const nodes = runtime ? (runtime.nodes || runtime.runtimeNodes || []) : graphNodes(snapshot);
    const dependencies = runtime ? (runtime.dependencies || runtime.runtimeDependencies || []) : graphDependencies(snapshot);
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const relatedIds = nodeId ? connectedNodeIds({ dependencies, nodeId }) : new Set();
    if (!nodeId && includeWorkspace) {
      nodes.forEach((node) => relatedIds.add(node.id));
    }
    const manifests = [...relatedIds]
      .map((id) => nodesById.get(id))
      .filter(Boolean)
      .map((node) => {
        const relation = node.id === nodeId
          ? "self"
          : dependencies.some((dependency) => dependency.sourceNodeId === nodeId && dependency.targetNodeId === node.id)
            ? "outgoing"
            : dependencies.some((dependency) => dependency.targetNodeId === nodeId && dependency.sourceNodeId === node.id)
              ? "incoming"
              : nodeId && relatedIds.has(node.id)
                ? "reachable"
                : "workspace";
        return toolManifestForNode(node, relation);
      })
      .filter((manifest) => manifest.toolCount > 0);
    return {
      version: VERSION,
      inspectedAt: nowIso(),
      workspaceId: effectiveWorkspaceId,
      nodeId,
      scope: nodeId ? "connected" : includeWorkspace ? "workspace" : "empty",
      manifests,
      toolCount: manifests.reduce((count, manifest) => count + manifest.toolCount, 0),
      mcpReady: true,
    };
  };

  const parseMcpToolName = (name = "") => {
    const match = String(name || "").match(/^tl\.node\.([^.]+)\.([A-Za-z0-9_-]+)$/);
    return match ? { nodeId: match[1], tool: match[2] } : { nodeId: "", tool: String(name || "").trim() };
  };

  const nodeSupportsTool = (node = {}, toolName = "") =>
    nodeAgentTools(node).find((tool) => tool.name === toolName || tool.mcpName === toolName) || null;

  const targetAllowedForAgent = ({ dependencies = [], agentNodeId = "", targetNodeId = "" } = {}) => {
    if (!agentNodeId || agentNodeId === targetNodeId) return true;
    return connectedNodeIds({ dependencies, nodeId: agentNodeId }).has(targetNodeId);
  };

  const callConnectedNodeTool = async ({ workspaceId = "", nodeId = "", tool = "", toolName = "", args = {}, agentNodeId = "", runtime = null } = {}) => {
    const parsed = parseMcpToolName(tool || toolName);
    const targetNodeId = nodeId || parsed.nodeId;
    const targetTool = parsed.tool;
    const effectiveWorkspaceId = normalizeWorkspaceId(workspaceId);
    if (!targetNodeId) throw new Error("nodeId is required for connected node tool calls.");
    if (!targetTool) throw new Error("tool is required for connected node tool calls.");
    const snapshot = runtime
      ? { runtime, graph: { nodes: runtime.nodes || runtime.runtimeNodes || [], dependencies: runtime.dependencies || runtime.runtimeDependencies || [] } }
      : await buildSnapshot(effectiveWorkspaceId);
    const nodes = runtime ? (runtime.nodes || runtime.runtimeNodes || []) : graphNodes(snapshot);
    const dependencies = runtime ? (runtime.dependencies || runtime.runtimeDependencies || []) : graphDependencies(snapshot);
    const target = nodes.find((node) => node.id === targetNodeId);
    if (!target) throw new Error(`Connected tool target node not found: ${targetNodeId}`);
    if (!targetAllowedForAgent({ dependencies, agentNodeId, targetNodeId })) {
      return toolEnvelope({
        ok: false,
        tool: targetTool,
        node: target,
        status: "blocked",
        limitations: ["Target node is not connected to the requesting Agent node."],
      });
    }
    const manifestTool = nodeSupportsTool(target, targetTool);
    if (!manifestTool) {
      return toolEnvelope({
        ok: false,
        tool: targetTool,
        node: target,
        status: "unsupported",
        limitations: ["Tool is not declared by the target node manifest."],
      });
    }
    if (manifestTool.mode !== "read") {
      return toolEnvelope({
        ok: false,
        tool: targetTool,
        node: target,
        status: "blocked",
        limitations: ["Only read tools are executable in Phase 2. Mutating tools must use safe executor/preflight."],
      });
    }
    const subtype = nodeKind(target);
    if (["document-store", "text-knowledge", "workspace-memory", "conversation-memory"].includes(subtype)) {
      return runDocumentTool({ workspaceId: effectiveWorkspaceId, node: target, tool: targetTool, args: args || {} });
    }
      if (["knowledge-dictionary-builder", "dictionary-builder"].includes(subtype)) {
      return runDictionaryTool({ workspaceId: effectiveWorkspaceId, node: target, tool: targetTool, args: args || {} });
    }
      if (["knowledge-event-builder", "event-builder"].includes(subtype)) {
      return runEventTool({ workspaceId: effectiveWorkspaceId, node: target, tool: targetTool, args: args || {} });
    }
    if (["graph-query", "knowledge-graph", "knowledge-reasoning-composer", "semantic-relation-enricher", "knowledge-graph-builder-agent", "entity-extractor"].includes(subtype)) {
      return runGraphTool({ workspaceId: effectiveWorkspaceId, node: target, tool: targetTool, args: args || {} });
    }
    if (["rag-search", "embedding-generator", "vector-memory"].includes(subtype) && targetTool === "searchChunks") {
      return runDocumentTool({ workspaceId: effectiveWorkspaceId, node: target, tool: targetTool, args: args || {} });
    }
    return toolEnvelope({
      ok: false,
      tool: targetTool,
      node: target,
      status: "unsupported",
      limitations: ["No Phase 2 read executor is available for this node subtype yet."],
    });
  };

  const readLogs = async ({ workspaceId = "", nodeId = "", runId = "", limit = 30 } = {}) => {
    const snapshot = await buildSnapshot(workspaceId);
    const events = snapshot.runtime?.events || [];
    const flowLogs = snapshot.runtime?.flowLogs || [];
    const filteredEvents = events
      .filter((event) => !nodeId || event.sourceNodeId === nodeId || event.targetNodeId === nodeId)
      .filter((event) => !runId || event.runId === runId || event.payload?.runId === runId || event.meta?.runId === runId)
      .slice(0, limit);
    const filteredLogs = flowLogs
      .filter((log) => !nodeId || log.nodeId === nodeId || log.sourceNodeId === nodeId || log.targetNodeId === nodeId)
      .filter((log) => !runId || log.runId === runId || log.context?.runId === runId)
      .slice(0, limit);
    return {
      version: VERSION,
      readAt: nowIso(),
      events: filteredEvents,
      flowLogs: filteredLogs,
    };
  };

  const suggestFixes = async ({ workspaceId = "", nodeId = "" } = {}) => {
    const snapshot = await buildSnapshot(workspaceId);
    const nodes = graphNodes(snapshot);
    const dependencies = graphDependencies(snapshot);
    const lookup = new Map(nodes.map((node) => [node.id, node]));
    const issues = [...(snapshot.validation?.issues || [])];
    const fixes = [];
    if (nodeId && !nodes.some((node) => node.id === nodeId)) {
      issues.push({ level: "error", type: "node", nodeId, message: "node not found" });
    }

    issues.slice(0, 24).forEach((issue) => {
      const dependency = dependencies.find((item) => item.id === issue.id || item.connectionId === issue.id) || null;
      const source = lookup.get(issue.sourceNodeId || dependency?.sourceNodeId || "");
      const target = lookup.get(issue.targetNodeId || dependency?.targetNodeId || "");
      const lowerMessage = String(issue.message || "").toLowerCase();
      const sourcePort = dependency?.metadata?.sourcePort || dependency?.sourcePort || dependency?.channel || "all";
      const targetPort = dependency?.metadata?.targetPort || dependency?.targetPort || "all";

      if (lowerMessage.includes("duplicate") && dependency) {
        fixes.push(makeFix({
          type: "remove-duplicate-link",
          severity: "warning",
          dependencyId: dependency.id || issue.id || "",
          connectionId: dependency.connectionId || "",
          problem: "Duplicate runtime link.",
          cause: "Two links point to the same source, target and channel. Runtime traversal can produce duplicated work.",
          actionText: "Remove this duplicated dependency and keep the first valid route.",
          risk: "low",
          safe: true,
          action: { kind: "delete-link", dependencyId: dependency.id || "", connectionId: dependency.connectionId || "" },
          reason: issue.message || "",
        }));
        return;
      }

      if ((lowerMessage.includes("missing source") || lowerMessage.includes("missing target")) && dependency) {
        fixes.push(makeFix({
          type: "remove-broken-link",
          severity: "error",
          dependencyId: dependency.id || issue.id || "",
          connectionId: dependency.connectionId || "",
          problem: lowerMessage.includes("missing source") ? "Link source node is missing." : "Link target node is missing.",
          cause: "The dependency references a node that is no longer present in this workspace.",
          actionText: "Delete the broken dependency so the runtime graph can validate again.",
          risk: "low",
          safe: true,
          action: { kind: "delete-link", dependencyId: dependency.id || "", connectionId: dependency.connectionId || "" },
          reason: issue.message || "",
        }));
        return;
      }

      if (dependency && source && target && (!hasPort(source, "out", sourcePort) || !hasPort(target, "in", targetPort))) {
        const nextSourcePort = firstPort(source, "out", [dependency.channel, "action", "task", "output", "raw"]);
        const nextTargetPort = firstPort(target, "in", [dependency.channel, "agent_control", "task", "input", "raw"]);
        fixes.push(makeFix({
          type: "repair-link-ports",
          severity: "error",
          nodeId: target.id,
          dependencyId: dependency.id || issue.id || "",
          connectionId: dependency.connectionId || "",
          problem: "Link port mapping is invalid.",
          cause: `The current ports ${sourcePort} -> ${targetPort} are not declared on the connected nodes.`,
          actionText: `Retarget the dependency to valid ports ${nextSourcePort} -> ${nextTargetPort}.`,
          risk: "medium",
          safe: Boolean(nextSourcePort && nextTargetPort),
          action: {
            kind: "update-link-ports",
            dependencyId: dependency.id || "",
            connectionId: dependency.connectionId || "",
            sourceNodeId: source.id,
            targetNodeId: target.id,
            sourceLabel: nodeLabel(source),
            targetLabel: nodeLabel(target),
            sourcePort: nextSourcePort,
            targetPort: nextTargetPort,
            channel: nextSourcePort === "all" ? (dependency.channel || "runtime") : nextSourcePort,
          },
          reason: issue.message || "",
        }));
        return;
      }

      fixes.push(makeFix({
        type: issue.type === "dependency" ? "inspect-runtime-link" : "inspect-runtime-issue",
        severity: issue.level || "warning",
        nodeId: issue.sourceNodeId || issue.targetNodeId || issue.nodeId || "",
        dependencyId: issue.id || "",
        problem: issue.message || "Runtime validation issue.",
        cause: "The graph engine detected a condition that needs review.",
        actionText: "Open the node or link inspector and correct the graph manually.",
        risk: "manual",
        safe: false,
        reason: issue.message || "",
      }));
    });

    dependencies.forEach((dependency) => {
      const source = lookup.get(dependency.sourceNodeId || "");
      const target = lookup.get(dependency.targetNodeId || "");
      if (!source || !target) return;
      const sourcePort = dependency.metadata?.sourcePort || dependency.sourcePort || dependency.channel || "all";
      const targetPort = dependency.metadata?.targetPort || dependency.targetPort || "all";
      const sourcePortOk = hasPort(source, "out", sourcePort);
      const targetPortOk = hasPort(target, "in", targetPort);
      if (sourcePortOk && targetPortOk) return;
      const nextSourcePort = firstPort(source, "out", [dependency.channel, "agent_control", "action", "task", "output", "raw"]);
      const nextTargetPort = firstPort(target, "in", [dependency.channel, "agent_control", "task", "input", "raw"]);
      fixes.push(makeFix({
        type: "repair-link-ports",
        severity: "error",
        nodeId: target.id,
        dependencyId: dependency.id || "",
        connectionId: dependency.connectionId || "",
        problem: "Link port mapping is invalid.",
        cause: `The dependency points to ${sourcePort} -> ${targetPort}, but at least one port is not declared on the connected nodes.`,
        actionText: `Retarget the dependency to valid ports ${nextSourcePort} -> ${nextTargetPort}.`,
        risk: "medium",
        safe: Boolean(nextSourcePort && nextTargetPort),
        action: {
          kind: "update-link-ports",
          dependencyId: dependency.id || "",
          connectionId: dependency.connectionId || "",
          sourceNodeId: source.id,
          targetNodeId: target.id,
          sourceLabel: nodeLabel(source),
          targetLabel: nodeLabel(target),
          sourcePort: nextSourcePort,
          targetPort: nextTargetPort,
          channel: nextSourcePort === "all" ? (dependency.channel || "runtime") : nextSourcePort,
        },
        reason: "Invalid dependency port mapping.",
      }));
    });

    nodes
      .filter((node) => (!incomingFor(dependencies, node.id).length && !outgoingFor(dependencies, node.id).length))
      .filter((node) => !nodeId || node.id === nodeId)
      .slice(0, 8)
      .forEach((node) => {
        fixes.push(makeFix({
          type: "inspect-isolated-node",
          severity: "warning",
          nodeId: node.id,
          problem: `Isolated node: ${nodeLabel(node)}.`,
          cause: "The node has no incoming or outgoing runtime dependencies.",
          actionText: "Focus the node and connect it intentionally, or delete it if it is not part of the flow.",
          risk: "manual",
          safe: false,
          action: { kind: "focus-node", nodeId: node.id },
          reason: "Node has no runtime dependencies.",
        }));
      });

    const agentNodes = nodes.filter((node) => node.type === "aiAgent" || node.metadata?.category === "ai-agents");
    const bridge = nodeBySubtype(nodes, ["agent-bridge"]) || nodeByLabel(nodes, ["agent bridge"]);
    agentNodes
      .filter((node) => nodeKind(node) !== "agent-bridge")
      .filter((node) => !nodeId || node.id === nodeId)
      .forEach((agent) => {
        const hasBridgeLink = bridge && dependencies.some((dependency) =>
          dependency.sourceNodeId === agent.id && dependency.targetNodeId === bridge.id
        );
        if (!bridge) {
          const sourcePort = firstPort(agent, "out", ["agent_control", "action", "output"]);
          fixes.push(makeFix({
            type: "agent-needs-bridge",
            severity: "warning",
            nodeId: agent.id,
            problem: `Agent node is not separated by Agent Bridge: ${nodeLabel(agent)}.`,
            cause: "Agentic flows should separate decision/control output from executable action flow.",
            actionText: "Insert an Agent Bridge from the palette and connect agent_control -> agent_control.",
            risk: "medium",
            safe: true,
            action: {
              kind: "create-agent-bridge",
              sourceNodeId: agent.id,
              sourceLabel: nodeLabel(agent),
              sourcePort,
              targetPort: "agent_control",
              channel: sourcePort === "agent_control" ? "agent_control" : sourcePort,
            },
            reason: "No Agent Bridge node exists in this workspace.",
          }));
        } else if (!hasBridgeLink) {
          const sourcePort = firstPort(agent, "out", ["agent_control", "action", "output"]);
          const targetPort = firstPort(bridge, "in", ["agent_control", "input"]);
          fixes.push(makeFix({
            type: "connect-agent-bridge",
            severity: "warning",
            nodeId: agent.id,
            problem: `Agent node is not connected to Agent Bridge: ${nodeLabel(agent)}.`,
            cause: "The runtime cannot clearly separate agent control from downstream actions.",
            actionText: `Create a control link from ${nodeLabel(agent)} to ${nodeLabel(bridge)}.`,
            risk: "low",
            safe: true,
            action: {
              kind: "create-link",
              sourceNodeId: agent.id,
              targetNodeId: bridge.id,
              sourceLabel: nodeLabel(agent),
              targetLabel: nodeLabel(bridge),
              sourcePort,
              targetPort,
              channel: sourcePort === "agent_control" ? "agent_control" : sourcePort,
            },
            reason: "Missing Agent Bridge control link.",
          }));
        }
      });

    const preview = nodes.find((node) => node.type === "devPreview" || nodeKind(node) === "preview" || String(nodeLabel(node)).toLowerCase().includes("preview"));
    if (preview && !incomingFor(dependencies, preview.id).length) {
      const leaves = leafNodes(nodes, dependencies).filter((node) => node.id !== preview.id && node.type !== "source");
      if (leaves.length === 1) {
        const sourcePort = firstPort(leaves[0], "out", ["raw", "output", "action"]);
        const targetPort = firstPort(preview, "in", ["raw", "input"]);
        fixes.push(makeFix({
          type: "connect-preview",
          severity: "warning",
          nodeId: preview.id,
          problem: "Preview node is not receiving runtime output.",
          cause: "The flow has one clear terminal node but no dependency into Preview.",
          actionText: `Connect ${nodeLabel(leaves[0])} to Preview for final inspection.`,
          risk: "low",
          safe: true,
          action: {
            kind: "create-link",
            sourceNodeId: leaves[0].id,
            targetNodeId: preview.id,
            sourceLabel: nodeLabel(leaves[0]),
            targetLabel: nodeLabel(preview),
            sourcePort,
            targetPort,
            channel: sourcePort === "all" ? "runtime" : sourcePort,
          },
          reason: "Preview has no incoming dependency.",
        }));
      } else {
        fixes.push(makeFix({
          type: "preview-unreachable",
          severity: "warning",
          nodeId: preview.id,
          problem: "Preview node is not receiving runtime output.",
          cause: "There is not a single safe terminal node to connect automatically.",
          actionText: "Choose the correct final node and connect it to Preview.",
          risk: "manual",
          safe: false,
          reason: "Preview has no incoming dependency.",
        }));
      }
    }

    const roots = rootNodes(nodes, dependencies).filter((node) => node.type !== "devPreview");
    if (!nodeId && roots.length > 1) {
      fixes.push(makeFix({
        type: "multiple-runtime-roots",
        severity: "info",
        problem: "Multiple runtime roots detected.",
        cause: `${roots.length} nodes can start independently, so trace order may not express one objective.`,
        actionText: "Add a single Flow In, Trigger, Task Node or Orchestrator root when the flow should behave as one pipeline.",
        risk: "manual",
        safe: false,
        reason: "Runtime graph has multiple roots.",
      }));
    }

    return {
      version: VERSION,
      suggestedAt: nowIso(),
      fixes: dedupeFixes(fixes).slice(0, 20),
      issueCount: issues.length,
    };
  };

  const storeRun = (run = {}) => {
    runs.set(run.runId, run);
    while (runs.size > RUN_LIMIT) {
      const first = runs.keys().next().value;
      runs.delete(first);
    }
    return run;
  };

  const emitRunEvent = async (workspaceId = "", channel = "", payload = {}, meta = {}) => {
    const bus = window.TrackerLensEventBus?.get?.(workspaceId);
    if (!bus?.emit) return null;
    return bus.emit(channel, payload, {
      workspaceId,
      eventType: meta.eventType || channel.replace(/\W+/g, "_"),
      status: meta.status || "ok",
      sourceNodeId: meta.sourceNodeId || "",
      meta: { agentRuntime: VERSION, ...(meta.meta || {}) },
    }).catch(() => null);
  };

  const runFlow = async ({ workspaceId = "", startNodeId = "", payload = {}, dryRun = true, mode = "" } = {}) => {
    const effectiveWorkspaceId = normalizeWorkspaceId(workspaceId);
    const requestedMode = String(mode || (dryRun ? "dry-run" : "trace-only")).trim() || "dry-run";
    const safeMode = ["dry-run", "simulate", "execute-controlled", "trace-only"].includes(requestedMode)
      ? requestedMode
      : "dry-run";
    const snapshot = await buildSnapshot(effectiveWorkspaceId);
    const nodes = graphNodes(snapshot);
    const dependencies = graphDependencies(snapshot);
    const events = snapshot.runtime?.events || [];
    const plan = orderedPlan({ nodes, dependencies, events, startNodeId });
    const run = {
      version: VERSION,
      runId: runtimeId("agent_run"),
      workspaceId: effectiveWorkspaceId,
      mode: safeMode,
      execution: safeMode === "execute-controlled" ? "not-executed-v1-trace-only" : "trace-only",
      status: snapshot.validation?.ok === false ? "blocked" : "completed",
      objective: payload?.objective || payload?.task || "Trackers Lens agent runtime run",
      input: payload,
      summary: {
        plannedSteps: plan.steps.length,
        skippedNodes: plan.skippedNodeIds.length,
        validationOk: snapshot.validation?.ok !== false,
      },
      trace: plan.steps.map((step) => ({
        ...step,
        status: snapshot.validation?.ok === false ? "blocked" : "completed",
        startedAt: nowIso(),
        finishedAt: nowIso(),
        message: safeMode === "simulate"
          ? "Simulation trace completed; no graph state was mutated."
          : safeMode === "execute-controlled"
            ? "Controlled execution requested; v1 recorded a trace only and did not execute node adapters."
            : safeMode === "trace-only"
              ? "Trace recorded; node execution adapters remain delegated to runtime worker."
              : "Dry-run trace completed.",
      })),
      validation: snapshot.validation,
      startedAt: nowIso(),
      finishedAt: nowIso(),
    };
    storeRun(run);
    await emitRunEvent(effectiveWorkspaceId, "agent.runtime.run.completed", {
      runId: run.runId,
      status: run.status,
      summary: run.summary,
    }, {
      eventType: "agent_runtime_run_completed",
      status: run.status === "blocked" ? "blocked" : "ok",
      sourceNodeId: startNodeId,
    });
    return run;
  };

  const listRuns = () => Array.from(runs.values()).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));

  const getRun = (runId = "") => runs.get(runId) || null;

  const tools = {
    inspectFlow: {
      name: "inspectFlow",
      description: "Inspect the current runtime graph, roots, leaves, agent nodes and validation issues.",
      mutates: false,
      run: inspectFlow,
    },
    runFlow: {
      name: "runFlow",
      description: "Create a safe execution trace for the runtime graph. v1 is dry-run/trace-first.",
      mutates: false,
      run: runFlow,
    },
    inspectNode: {
      name: "inspectNode",
      description: "Inspect a runtime node, its dependencies, events and impact.",
      mutates: false,
      run: inspectNode,
    },
    inspectConnectedTools: {
      name: "inspectConnectedTools",
      description: "Inspect MCP-ready read-tool manifests exposed by a node and its connected runtime neighbors.",
      mutates: false,
      run: inspectConnectedTools,
    },
    callConnectedNodeTool: {
      name: "callConnectedNodeTool",
      description: "Execute a Phase 2 read-only connected node tool for Document, Dictionary, Event and Graph-style nodes.",
      mutates: false,
      run: callConnectedNodeTool,
    },
    readLogs: {
      name: "readLogs",
      description: "Read recent runtime events and flow logs for a workspace, node or run.",
      mutates: false,
      run: readLogs,
    },
    suggestFixes: {
      name: "suggestFixes",
      description: "Return safe fix suggestions for validation issues, invalid ports, broken links and agentic flow structure.",
      mutates: false,
      run: suggestFixes,
    },
    listRuns: {
      name: "listRuns",
      description: "List recent Agent Runtime traces kept in memory.",
      mutates: false,
      run: async () => ({ version: VERSION, runs: listRuns() }),
    },
  };

  const callTool = async (name = "", args = {}) => {
    const tool = tools[name];
    if (!tool) throw new Error(`Unknown Agent Runtime tool: ${name}`);
    return tool.run(args || {});
  };

  return {
    VERSION,
    tools,
    callTool,
    inspectFlow,
    inspectNode,
    inspectConnectedTools,
    callConnectedNodeTool,
    readLogs,
    runFlow,
    suggestFixes,
    listRuns,
    getRun,
  };
})();
