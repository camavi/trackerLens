window.TrackerLensRuntimeGraphStore = (() => {
  const config = () => (typeof tlConfig !== "undefined" ? tlConfig : window.tlConfig) || {};
  const tableName = (key, fallback) => config()?.TABLES?.[key] || fallback;

  const STORES = {
    flows: tableName("TL_FLOWS", "tl_flows"),
    runtimeNodes: tableName("TL_RUNTIME_NODES", "tl_runtime_nodes"),
    runtimeDependencies: tableName("TL_RUNTIME_DEPENDENCIES", "tl_runtime_dependencies"),
    widgets: tableName("TL_WIDGETS", "tl_widgets"),
  };
  const FIRST_COHORT_STORES = new Set([
    tableName("TL_PAGES", "tl_pages"),
    STORES.widgets,
    tableName("TL_CONNECTIONS", "tl_connections"),
    tableName("TL_SETTINGS", "tl_settings"),
    STORES.flows,
    STORES.runtimeNodes,
    STORES.runtimeDependencies,
    tableName("TL_CHANNELS", "tl_channels"),
  ]);
  let desktopSqliteMode = null;

  // Runtime objects can temporarily contain renderer-only references. Every record
  // crossing the Electron IPC boundary must be structured-clone safe.
  const bridgeSafeValue = (value) => {
    const seen = new WeakSet();
    try {
      return JSON.parse(JSON.stringify(value, (_key, candidate) => {
        if (typeof candidate === "function" || typeof candidate === "symbol") return undefined;
        if (typeof candidate === "bigint") return String(candidate);
        if (candidate && typeof candidate === "object") {
          if (seen.has(candidate)) return undefined;
          seen.add(candidate);
        }
        return candidate;
      }));
    } catch (_) {
      return null;
    }
  };

  const desktopPersistence = () => window.trackers?.desktop?.persistence || null;
  const usesDesktopSqlite = async () => {
    if (desktopSqliteMode !== null) return desktopSqliteMode;
    const persistence = desktopPersistence();
    if (!persistence?.getStatus) throw new Error("Runtime Graph richiede SQLite nell'app desktop.");
    try {
      desktopSqliteMode = (await persistence.getStatus())?.mode === "desktop-sqlite";
    } catch (error) { throw error; }
    if (!desktopSqliteMode) throw new Error("Runtime Graph richiede SQLite nell'app desktop.");
    return desktopSqliteMode;
  };

  const ensureStores = async () => {
    await usesDesktopSqlite();
    return desktopPersistence();
  };

  const putRecords = async (storeName, records = []) => {
    if (!records.length) return [];
    if (!FIRST_COHORT_STORES.has(storeName)) throw new Error(`Repository SQLite non supportato: ${storeName}`);
    const safeRecords = records.map(bridgeSafeValue).filter((record) => record?.id);
    if (!safeRecords.length) throw new Error(`Record runtime non serializzabile: ${storeName}`);
    await (await ensureStores()).writeDevelopmentRecords({ storeName, records: safeRecords });
    return safeRecords;
  };

  const readAll = async (storeName) => {
    if (!FIRST_COHORT_STORES.has(storeName)) throw new Error(`Repository SQLite non supportato: ${storeName}`);
    return (await ensureStores()).readDevelopmentRecords({ storeName });
  };

  const deleteRecords = async (storeName, ids = []) => {
    const uniqueIds = [...new Set(ids.filter(Boolean).map(String))];
    if (!uniqueIds.length) return [];
    if (!FIRST_COHORT_STORES.has(storeName)) throw new Error(`Repository SQLite non supportato: ${storeName}`);
    await (await ensureStores()).deleteDevelopmentRecords({ storeName, ids: uniqueIds });
    return uniqueIds;
  };

  const normalizeChannel = (box) =>
    (box.channels?.[0] || box.outputChannel || box.runtime?.output || "default").toString();

  const safeId = (value) => String(value || "").replace(/[^A-Za-z0-9_-]/g, "_");

  const flowIdForWorkspace = (workspaceId) => `flow_${safeId(workspaceId || "workspace_global")}`;

  const nodeFromBox = (box, workspaceId) => ({
    id: box.id,
    workspaceId,
    type: box.type || "box",
    label: box.name || box.id,
    sourceRef: box.sourceId || box.assetId || box.id,
    assetId: box.assetId || box.sourceId || "",
    inputs: box.type === "boxLens" ? [normalizeChannel(box)] : [],
    outputs: box.type === "boxTracker" ? [normalizeChannel(box)] : [],
    channels: Array.isArray(box.channels) ? [...box.channels] : [normalizeChannel(box)],
    status: box.hidden ? "hidden" : "active",
    position: { x: box.x || 1, y: box.y || 1 },
    metadata: {
      hidden: Boolean(box.hidden),
      width: box.width || 1,
      height: box.height || 1,
      zIndex: box.zIndex || 1,
      sampleOutput: box.sampleOutput && typeof box.sampleOutput === "object" ? box.sampleOutput : {},
    },
    createdAt: box.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const dependencyFromConnection = (connection, workspaceId, boxesById) => {
    const from = boxesById.get(connection.fromBoxId) || {};
    const to = boxesById.get(connection.toBoxId) || {};
    return {
      id: `dep_${workspaceId}_${connection.id}`.replace(/[^A-Za-z0-9_-]/g, "_"),
      workspaceId,
      sourceNodeId: connection.fromBoxId,
      targetNodeId: connection.toBoxId,
      sourceType: from.type || "box",
      targetType: to.type || "box",
      channel: connection.channel || normalizeChannel(from),
      connectionId: connection.id,
      status: "active",
      metadata: {
        ...(connection.mapping || {}),
        sourcePort: connection.mapping?.sourcePort || "all",
        targetPort: connection.mapping?.targetPort || "all",
      },
      createdAt: connection.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  };

  const syncWorkspaceGraph = async ({ workspace = {}, boxes = [], connections = [] }) => {
    const workspaceId = workspace.id || "workspace_global";
    const now = new Date().toISOString();
    const [existingNodes, existingDependencies, existingFlows, widgetRecords] = await Promise.all([
      readAll(STORES.runtimeNodes),
      readAll(STORES.runtimeDependencies),
      readAll(STORES.flows),
      readAll(STORES.widgets),
    ]);
    const widgetById = new Map();
    widgetRecords.forEach((record) => {
      const content = record?.content && typeof record.content === "object" ? record.content : record || {};
      [record?.id, content.id, content.sourceId, content.assetId].filter(Boolean).forEach((id) => {
        widgetById.set(String(id), content);
      });
    });
    const enrichBox = (box = {}) => {
      const widget = widgetById.get(String(box.assetId || box.sourceId || box.id)) || {};
      return {
        ...widget,
        ...box,
        sampleOutput: box.sampleOutput || widget.sampleOutput || {},
        outputChannel: box.outputChannel || widget.outputChannel || widget.runtime?.output,
      };
    };
    const existingNodeById = new Map(existingNodes.filter((node) => node.workspaceId === workspaceId).map((node) => [node.id, node]));
    const existingFlow = existingFlows.find((flow) => flow.id === flowIdForWorkspace(workspaceId));
    const existingFlowNodeById = new Map((existingFlow?.nodes || []).map((node) => [node.id, node]));
    const enrichedBoxes = boxes.map(enrichBox);
    const boxesById = new Map(enrichedBoxes.map((box) => [box.id, box]));
    const nodes = enrichedBoxes.map((box) => {
      const next = nodeFromBox(box, workspaceId);
      const previous = existingNodeById.get(next.id);
      const previousFlowNode = existingFlowNodeById.get(next.id);
      return {
        ...next,
        flowPosition: previous?.flowPosition || previousFlowNode?.flowPosition || next.flowPosition,
        createdAt: previous?.createdAt || next.createdAt,
      };
    });
    const dependencies = connections.map((connection) => dependencyFromConnection(connection, workspaceId, boxesById));
    const nodeIds = new Set(nodes.map((node) => node.id));
    const dependencyIds = new Set(dependencies.map((dependency) => dependency.id));
    const staleNodeIds = existingNodes
      .filter((node) => node.workspaceId === workspaceId && !nodeIds.has(node.id))
      .map((node) => node.id);
    const staleDependencyIds = existingDependencies
      .filter((dependency) => dependency.workspaceId === workspaceId && !dependencyIds.has(dependency.id))
      .map((dependency) => dependency.id);
    const flow = {
      id: flowIdForWorkspace(workspaceId),
      workspaceId,
      name: workspace.name || workspace.title || "Workspace Flow",
      status: "active",
      nodes: nodes.map((node) => ({
        id: node.id,
        type: node.type,
        label: node.label,
        position: node.position,
        flowPosition: node.flowPosition,
        boxId: node.sourceRef,
      })),
      connections: connections.map((connection) => connection.id),
      createdAt: workspace.createdAt || now,
      updatedAt: now,
    };

    await Promise.all([
      deleteRecords(STORES.runtimeNodes, staleNodeIds),
      deleteRecords(STORES.runtimeDependencies, staleDependencyIds),
      putRecords(STORES.runtimeNodes, nodes),
      putRecords(STORES.runtimeDependencies, dependencies),
      putRecords(STORES.flows, [flow]),
    ]);

    return { flow, nodes, dependencies, cleanup: { staleNodeIds, staleDependencyIds } };
  };

  const updateFlowNodePosition = async ({ workspaceId = "", nodeId = "", position = null }) => {
    if (!workspaceId || !nodeId || !position) return null;
    const [flows, nodes] = await Promise.all([readAll(STORES.flows), readAll(STORES.runtimeNodes)]);
    const timestamp = new Date().toISOString();
    const flowId = flowIdForWorkspace(workspaceId);
    const flow = flows.find((item) => item.id === flowId);
    const node = nodes.find((item) => item.id === nodeId);
    const updatedFlow = flow && {
      ...flow,
      nodes: (Array.isArray(flow.nodes) ? flow.nodes : []).map((item) => item.id === nodeId ? { ...item, flowPosition: position } : item),
      updatedAt: timestamp,
    };
    const updatedNode = node && { ...node, flowPosition: position, updatedAt: timestamp };
    await Promise.all([
      updatedFlow ? putRecords(STORES.flows, [updatedFlow]) : Promise.resolve(),
      updatedNode ? putRecords(STORES.runtimeNodes, [updatedNode]) : Promise.resolve(),
    ]);
    return updatedFlow || updatedNode || null;
  };

  const createDraftNode = async ({
    workspaceId = "workspace_global",
    type = "node",
    label = "Draft Node",
    flowPosition = null,
    channels = [],
    inputs = null,
    outputs = null,
    metadata = {},
  } = {}) => {
    const now = new Date().toISOString();
    const id = `draft_${safeId(type)}_${Date.now()}`;
    const node = {
      id,
      workspaceId,
      type,
      label,
      sourceRef: id,
      assetId: "",
      inputs: Array.isArray(inputs) ? inputs : type === "boxLens" || type === "lens" || type === "processor" || type === "knowledge" || type === "aiAgent" || type === "action" || type === "storage" ? channels : [],
      outputs: Array.isArray(outputs) ? outputs : type === "boxTracker" || type === "source" || type === "processor" || type === "knowledge" || type === "aiAgent" ? channels : [],
      channels,
      status: "draft",
      position: { x: 1, y: 1 },
      flowPosition,
      metadata: {
        ...metadata,
        draft: true,
      },
      createdAt: now,
      updatedAt: now,
    };

    const flows = await readAll(STORES.flows);
      const flowId = flowIdForWorkspace(workspaceId);
      const existing = flows.find((item) => item.id === flowId) || {
        id: flowId, workspaceId, name: "Draft Runtime Flow", status: "draft", nodes: [], connections: [], createdAt: now,
      };
      await Promise.all([
        putRecords(STORES.runtimeNodes, [node]),
        putRecords(STORES.flows, [{
          ...existing,
          nodes: [...(Array.isArray(existing.nodes) ? existing.nodes : []), { id: node.id, type: node.type, label: node.label, position: node.position, flowPosition: node.flowPosition, boxId: node.sourceRef }],
          updatedAt: now,
        }]),
      ]);
    return node;
  };

  const deleteRuntimeNodeReferences = async ({ nodeId = "", workspaceId = "" } = {}) => {
    if (!nodeId) return { nodeIds: [], dependencyIds: [], flowIds: [] };
    const [dependencies, flows] = await Promise.all([readAll(STORES.runtimeDependencies), readAll(STORES.flows)]);
    const staleDependencies = dependencies.filter((dependency) => dependency.sourceNodeId === nodeId || dependency.targetNodeId === nodeId || dependency.sourceRef === nodeId || dependency.targetRef === nodeId);
    const changedFlows = flows.filter((flow) => (!workspaceId || flow.workspaceId === workspaceId) && (flow.nodes || []).some((node) => node.id === nodeId || node.boxId === nodeId))
      .map((flow) => ({ ...flow, nodes: (flow.nodes || []).filter((node) => node.id !== nodeId && node.boxId !== nodeId), updatedAt: new Date().toISOString() }));
    await Promise.all([
      deleteRecords(STORES.runtimeNodes, [nodeId]),
      deleteRecords(STORES.runtimeDependencies, staleDependencies.map((item) => item.id)),
      putRecords(STORES.flows, changedFlows),
    ]);
    return { nodeIds: [nodeId], dependencyIds: staleDependencies.map((item) => item.id), flowIds: changedFlows.map((item) => item.id) };
  };

  const promoteDraftNode = async ({ draftNodeId = "", workspaceId = "", node = {} } = {}) => {
    if (!draftNodeId || !node?.id) return null;
    const now = new Date().toISOString();
    const targetWorkspaceId = workspaceId || node.workspaceId || "workspace_global";

    const [nodes, dependencies, flows] = await Promise.all([
      readAll(STORES.runtimeNodes), readAll(STORES.runtimeDependencies), readAll(STORES.flows),
    ]);
    const draft = nodes.find((item) => item.id === draftNodeId) || {};
    const promoted = { ...draft, ...node, id: node.id, workspaceId: targetWorkspaceId, sourceRef: node.sourceRef || node.assetId || node.id, assetId: node.assetId || node.sourceRef || node.id, status: node.status || "active", flowPosition: node.flowPosition || draft.flowPosition, metadata: { ...(draft.metadata || {}), ...(node.metadata || {}), draft: false, promotedFrom: draftNodeId }, createdAt: draft.createdAt || now, updatedAt: now };
    const updatedDependencies = dependencies.filter((dependency) => dependency.sourceNodeId === draftNodeId || dependency.targetNodeId === draftNodeId).map((dependency) => ({ ...dependency, sourceNodeId: dependency.sourceNodeId === draftNodeId ? node.id : dependency.sourceNodeId, targetNodeId: dependency.targetNodeId === draftNodeId ? node.id : dependency.targetNodeId, workspaceId: dependency.workspaceId || targetWorkspaceId, updatedAt: now }));
    const updatedFlows = flows.filter((flow) => !workspaceId || flow.workspaceId === targetWorkspaceId).map((flow) => {
      let changed = false;
      const nextNodes = (flow.nodes || []).map((flowNode) => {
        if (flowNode.id !== draftNodeId && flowNode.boxId !== draftNodeId) return flowNode;
        changed = true;
        return { ...flowNode, id: node.id, boxId: node.sourceRef || node.assetId || node.id, type: node.type || flowNode.type, label: node.label || flowNode.label, flowPosition: node.flowPosition || flowNode.flowPosition };
      });
      return changed ? { ...flow, workspaceId: flow.workspaceId || targetWorkspaceId, nodes: nextNodes, status: flow.status === "draft" ? "active" : flow.status, updatedAt: now } : null;
    }).filter(Boolean);
    await Promise.all([
      deleteRecords(STORES.runtimeNodes, [draftNodeId]),
      putRecords(STORES.runtimeNodes, [promoted]),
      putRecords(STORES.runtimeDependencies, updatedDependencies),
      putRecords(STORES.flows, updatedFlows),
    ]);
    return promoted;
  };

  const cleanupConnectionReferences = async ({ connectionId = "" } = {}) => {
    if (!connectionId) return { dependencyIds: [], flowIds: [] };
    const [dependencies, flows] = await Promise.all([readAll(STORES.runtimeDependencies), readAll(STORES.flows)]);
    const staleDependencies = dependencies.filter((dependency) => dependency.connectionId === connectionId);
    const changedFlows = flows.filter((flow) => (flow.connections || []).includes(connectionId))
      .map((flow) => ({ ...flow, connections: (flow.connections || []).filter((id) => id !== connectionId), updatedAt: new Date().toISOString() }));
    await Promise.all([
      deleteRecords(STORES.runtimeDependencies, staleDependencies.map((item) => item.id)),
      putRecords(STORES.flows, changedFlows),
    ]);
    return { dependencyIds: staleDependencies.map((item) => item.id), flowIds: changedFlows.map((item) => item.id) };
  };

  const upsertDependency = async ({ dependency = {} } = {}) => {
    if (!dependency?.id || !dependency.sourceNodeId || !dependency.targetNodeId) return null;
    const now = new Date().toISOString();
    const record = {
      status: "active",
      channel: "runtime",
      createdAt: dependency.createdAt || now,
      ...dependency,
      updatedAt: now,
    };

    const flows = await readAll(STORES.flows);
    const workspaceId = record.workspaceId || "workspace_global";
    const flowId = flowIdForWorkspace(workspaceId);
    const existing = flows.find((item) => item.id === flowId) || { id: flowId, workspaceId, name: "Runtime Flow", status: "active", nodes: [], connections: [], createdAt: now };
    const connections = Array.isArray(existing.connections) ? existing.connections : [];
    await Promise.all([
      putRecords(STORES.runtimeDependencies, [record]),
      putRecords(STORES.flows, [{ ...existing, connections: record.connectionId && !connections.includes(record.connectionId) ? [...connections, record.connectionId] : connections, updatedAt: now }]),
    ]);
    return record;
  };

  const upsertRuntimeNode = async ({ node = {} } = {}) => {
    if (!node?.id) return null;
    const now = new Date().toISOString();
    const workspaceId = node.workspaceId || "workspace_global";
    const record = {
      type: "node",
      label: node.id,
      sourceRef: node.sourceRef || node.id,
      assetId: node.assetId || "",
      inputs: Array.isArray(node.inputs) ? node.inputs : [],
      outputs: Array.isArray(node.outputs) ? node.outputs : [],
      channels: Array.isArray(node.channels) ? node.channels : [],
      status: "active",
      metadata: {},
      ...node,
      workspaceId,
      updatedAt: now,
    };

    const [nodes, flows] = await Promise.all([readAll(STORES.runtimeNodes), readAll(STORES.flows)]);
    const previous = nodes.find((item) => item.id === record.id) || {};
    const saved = { ...previous, ...record, metadata: { ...(previous.metadata || {}), ...(record.metadata || {}) }, createdAt: previous.createdAt || record.createdAt || now, updatedAt: now };
    const flowId = flowIdForWorkspace(workspaceId);
    const existing = flows.find((item) => item.id === flowId) || { id: flowId, workspaceId, name: "Runtime Flow", status: "active", nodes: [], connections: [], createdAt: now };
    const nodesInFlow = Array.isArray(existing.nodes) ? existing.nodes : [];
    const index = nodesInFlow.findIndex((item) => item.id === record.id || item.boxId === record.id);
    const flowNode = { ...(index >= 0 ? nodesInFlow[index] : {}), id: record.id, type: record.type, label: record.label, position: record.position, flowPosition: record.flowPosition, boxId: record.sourceRef || record.assetId || record.id };
    const nextNodes = index >= 0 ? nodesInFlow.map((item, itemIndex) => itemIndex === index ? flowNode : item) : [...nodesInFlow, flowNode];
    await Promise.all([
      putRecords(STORES.runtimeNodes, [saved]),
      putRecords(STORES.flows, [{ ...existing, workspaceId, nodes: nextNodes, status: existing.status === "draft" ? "active" : existing.status || "active", updatedAt: now }]),
    ]);
    return saved;
  };

  return {
    STORES,
    cleanupConnectionReferences,
    createDraftNode,
    deleteRuntimeNodeReferences,
    ensureStores,
    putRecords,
    promoteDraftNode,
    deleteRecords,
    readAll,
    syncWorkspaceGraph,
    upsertDependency,
    upsertRuntimeNode,
    updateFlowNodePosition,
    usesDesktopSqlite,
  };
})();
