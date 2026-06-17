window.TrackerLensRuntimeGraphStore = (() => {
  const DB_NAME = "TrackersLens";
  const config = () => (typeof tlConfig !== "undefined" ? tlConfig : window.tlConfig) || {};
  const tableName = (key, fallback) => config()?.TABLES?.[key] || fallback;

  const STORES = {
    flows: tableName("TL_FLOWS", "tl_flows"),
    runtimeNodes: tableName("TL_RUNTIME_NODES", "tl_runtime_nodes"),
    runtimeDependencies: tableName("TL_RUNTIME_DEPENDENCIES", "tl_runtime_dependencies"),
    widgets: tableName("TL_WIDGETS", "tl_widgets"),
  };

  const STORE_DEFINITIONS = [
    { name: STORES.flows, columns: [{ name: "workspaceId" }, { name: "status" }, { name: "updatedAt" }] },
    { name: STORES.runtimeNodes, columns: [{ name: "workspaceId" }, { name: "type" }, { name: "sourceRef" }, { name: "updatedAt" }] },
    { name: STORES.runtimeDependencies, columns: [{ name: "workspaceId" }, { name: "sourceNodeId" }, { name: "targetNodeId" }, { name: "updatedAt" }] },
  ];

  const createIndexes = (store, columns = []) => {
    columns.forEach((column) => {
      if (!store.indexNames.contains(column.name)) {
        store.createIndex(column.name, column?.keyPath ?? column.name, column?.options ?? { unique: false });
      }
    });
  };

  const createMissingStores = (db) => {
    STORE_DEFINITIONS.forEach((definition) => {
      if (db.objectStoreNames.contains(definition.name)) return;
      createIndexes(db.createObjectStore(definition.name, { keyPath: "id" }), definition.columns);
    });
  };

  const bindVersionChange = (db) => {
    db.onversionchange = () => {
      db.close();
      console.warn("IndexedDB runtime graph chiuso per consentire aggiornamento da un'altra scheda.");
    };
    return db;
  };

  const openDb = (version = undefined) =>
    new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("IndexedDB non disponibile"));
        return;
      }

      const request = version ? indexedDB.open(DB_NAME, version) : indexedDB.open(DB_NAME);
      request.onupgradeneeded = (event) => createMissingStores(event.target.result);
      request.onsuccess = (event) => resolve(bindVersionChange(event.target.result));
      request.onerror = (event) => reject(event.target.error || new Error("Errore apertura IndexedDB runtime graph"));
      request.onblocked = () => reject(new Error("IndexedDB bloccato da un'altra scheda."));
    });

  const ensureStores = async () => {
    if (window.TrackerLensDependencyManager?.ensureRuntimeStores) {
      await window.TrackerLensDependencyManager.ensureRuntimeStores().then((db) => db?.close?.());
    }

    const db = await openDb();
    const hasAllStores = STORE_DEFINITIONS.every((definition) => db.objectStoreNames.contains(definition.name));
    if (hasAllStores) return db;

    const nextVersion = db.version + 1;
    db.close();
    return openDb(nextVersion);
  };

  const putRecords = async (storeName, records = []) => {
    if (!records.length) return [];
    const db = await ensureStores();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, "readwrite");
        const store = transaction.objectStore(storeName);
        records.forEach((record) => store.put(record));
        transaction.oncomplete = () => resolve(records);
        transaction.onerror = (event) => reject(event.target.error || new Error(`Errore salvataggio ${storeName}`));
      });
    } finally {
      db.close();
    }
  };

  const readAll = async (storeName) => {
    const db = await ensureStores();
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
        request.onsuccess = (event) => resolve(Array.from(event.target.result || []));
        request.onerror = (event) => reject(event.target.error || new Error(`Errore lettura ${storeName}`));
      });
    } finally {
      db.close();
    }
  };

  const deleteRecords = async (storeName, ids = []) => {
    const uniqueIds = [...new Set(ids.filter(Boolean).map(String))];
    if (!uniqueIds.length) return [];
    const db = await ensureStores();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, "readwrite");
        const store = transaction.objectStore(storeName);
        uniqueIds.forEach((id) => store.delete(id));
        transaction.oncomplete = () => resolve(uniqueIds);
        transaction.onerror = (event) => reject(event.target.error || new Error(`Errore cleanup ${storeName}`));
      });
    } finally {
      db.close();
    }
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
    const db = await ensureStores();
    const now = new Date().toISOString();

    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.flows, STORES.runtimeNodes], "readwrite");
        const flowStore = transaction.objectStore(STORES.flows);
        const nodeStore = transaction.objectStore(STORES.runtimeNodes);
        const flowRequest = flowStore.get(flowIdForWorkspace(workspaceId));
        const nodeRequest = nodeStore.get(nodeId);
        let result = null;

        flowRequest.onsuccess = () => {
          const flow = flowRequest.result;
          if (!flow) return;
          const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
          const index = nodes.findIndex((node) => node.id === nodeId);
          if (index >= 0) {
            nodes[index] = { ...nodes[index], flowPosition: position };
          } else {
            nodes.push({ id: nodeId, flowPosition: position });
          }
          result = { ...flow, nodes, updatedAt: now };
          flowStore.put(result);
        };

        nodeRequest.onsuccess = () => {
          const node = nodeRequest.result;
          if (!node) return;
          nodeStore.put({ ...node, flowPosition: position, updatedAt: now });
        };

        transaction.oncomplete = () => resolve(result);
        transaction.onerror = (event) => reject(event.target.error || new Error("Errore aggiornamento posizione nodo flow"));
      });
    } finally {
      db.close();
    }
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
    const db = await ensureStores();
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

    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.runtimeNodes, STORES.flows], "readwrite");
        const nodeStore = transaction.objectStore(STORES.runtimeNodes);
        const flowStore = transaction.objectStore(STORES.flows);
        const flowRequest = flowStore.get(flowIdForWorkspace(workspaceId));

        nodeStore.put(node);
        flowRequest.onsuccess = () => {
          const existing = flowRequest.result || {
            id: flowIdForWorkspace(workspaceId),
            workspaceId,
            name: "Draft Runtime Flow",
            status: "draft",
            nodes: [],
            connections: [],
            createdAt: now,
          };
          const nodes = Array.isArray(existing.nodes) ? existing.nodes : [];
          nodes.push({
            id: node.id,
            type: node.type,
            label: node.label,
            position: node.position,
            flowPosition: node.flowPosition,
            boxId: node.sourceRef,
          });
          flowStore.put({ ...existing, nodes, updatedAt: now });
        };

        transaction.oncomplete = () => resolve(node);
        transaction.onerror = (event) => reject(event.target.error || new Error("Errore creazione draft runtime node"));
      });
    } finally {
      db.close();
    }
  };

  const deleteRuntimeNodeReferences = async ({ nodeId = "", workspaceId = "" } = {}) => {
    if (!nodeId) return { nodeIds: [], dependencyIds: [], flowIds: [] };
    const db = await ensureStores();
    const now = new Date().toISOString();

    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.runtimeNodes, STORES.runtimeDependencies, STORES.flows], "readwrite");
        const nodeStore = transaction.objectStore(STORES.runtimeNodes);
        const dependencyStore = transaction.objectStore(STORES.runtimeDependencies);
        const flowStore = transaction.objectStore(STORES.flows);
        const dependencyRead = dependencyStore.getAll();
        const flowRead = flowStore.getAll();
        const result = { nodeIds: [nodeId], dependencyIds: [], flowIds: [] };

        nodeStore.delete(nodeId);

        dependencyRead.onsuccess = (event) => {
          Array.from(event.target.result || [])
            .filter((dependency) =>
              dependency.sourceNodeId === nodeId ||
              dependency.targetNodeId === nodeId ||
              dependency.sourceRef === nodeId ||
              dependency.targetRef === nodeId)
            .forEach((dependency) => {
              result.dependencyIds.push(dependency.id);
              dependencyStore.delete(dependency.id);
            });
        };

        flowRead.onsuccess = (event) => {
          Array.from(event.target.result || [])
            .filter((flow) => !workspaceId || flow.workspaceId === workspaceId)
            .forEach((flow) => {
              const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
              const nextNodes = nodes.filter((node) => node.id !== nodeId && node.boxId !== nodeId);
              if (nextNodes.length === nodes.length) return;
              result.flowIds.push(flow.id);
              flowStore.put({ ...flow, nodes: nextNodes, updatedAt: now });
            });
        };

        transaction.oncomplete = () => resolve(result);
        transaction.onerror = (event) => reject(event.target.error || new Error("Errore cleanup runtime node"));
      });
    } finally {
      db.close();
    }
  };

  const promoteDraftNode = async ({ draftNodeId = "", workspaceId = "", node = {} } = {}) => {
    if (!draftNodeId || !node?.id) return null;
    const db = await ensureStores();
    const now = new Date().toISOString();
    const targetWorkspaceId = workspaceId || node.workspaceId || "workspace_global";

    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.runtimeNodes, STORES.runtimeDependencies, STORES.flows], "readwrite");
        const nodeStore = transaction.objectStore(STORES.runtimeNodes);
        const dependencyStore = transaction.objectStore(STORES.runtimeDependencies);
        const flowStore = transaction.objectStore(STORES.flows);
        const draftRead = nodeStore.get(draftNodeId);
        const dependencyRead = dependencyStore.getAll();
        const flowRead = flowStore.getAll();
        let promoted = null;

        draftRead.onsuccess = (event) => {
          const draft = event.target.result || {};
          promoted = {
            ...draft,
            ...node,
            id: node.id,
            workspaceId: targetWorkspaceId,
            sourceRef: node.sourceRef || node.assetId || node.id,
            assetId: node.assetId || node.sourceRef || node.id,
            status: node.status || "active",
            flowPosition: node.flowPosition || draft.flowPosition,
            metadata: {
              ...(draft.metadata || {}),
              ...(node.metadata || {}),
              draft: false,
              promotedFrom: draftNodeId,
            },
            createdAt: draft.createdAt || now,
            updatedAt: now,
          };
          nodeStore.delete(draftNodeId);
          nodeStore.put(promoted);
        };

        dependencyRead.onsuccess = (event) => {
          Array.from(event.target.result || [])
            .filter((dependency) => dependency.sourceNodeId === draftNodeId || dependency.targetNodeId === draftNodeId)
            .forEach((dependency) => {
              dependencyStore.put({
                ...dependency,
                sourceNodeId: dependency.sourceNodeId === draftNodeId ? node.id : dependency.sourceNodeId,
                targetNodeId: dependency.targetNodeId === draftNodeId ? node.id : dependency.targetNodeId,
                workspaceId: dependency.workspaceId || targetWorkspaceId,
                updatedAt: now,
              });
            });
        };

        flowRead.onsuccess = (event) => {
          Array.from(event.target.result || [])
            .filter((flow) => !workspaceId || flow.workspaceId === targetWorkspaceId)
            .forEach((flow) => {
              const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
              let changed = false;
              const nextNodes = nodes.map((flowNode) => {
                if (flowNode.id !== draftNodeId && flowNode.boxId !== draftNodeId) return flowNode;
                changed = true;
                return {
                  ...flowNode,
                  id: node.id,
                  boxId: node.sourceRef || node.assetId || node.id,
                  type: node.type || flowNode.type,
                  label: node.label || flowNode.label,
                  flowPosition: node.flowPosition || flowNode.flowPosition,
                };
              });
              if (changed) {
                flowStore.put({
                  ...flow,
                  workspaceId: flow.workspaceId || targetWorkspaceId,
                  nodes: nextNodes,
                  status: flow.status === "draft" ? "active" : flow.status,
                  updatedAt: now,
                });
              }
            });
        };

        transaction.oncomplete = () => resolve(promoted);
        transaction.onerror = (event) => reject(event.target.error || new Error("Errore promozione draft runtime node"));
      });
    } finally {
      db.close();
    }
  };

  const cleanupConnectionReferences = async ({ connectionId = "" } = {}) => {
    if (!connectionId) return { dependencyIds: [], flowIds: [] };
    const db = await ensureStores();
    const now = new Date().toISOString();

    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.runtimeDependencies, STORES.flows], "readwrite");
        const dependencyStore = transaction.objectStore(STORES.runtimeDependencies);
        const flowStore = transaction.objectStore(STORES.flows);
        const dependencyRead = dependencyStore.getAll();
        const flowRead = flowStore.getAll();
        const result = { dependencyIds: [], flowIds: [] };

        dependencyRead.onsuccess = (event) => {
          Array.from(event.target.result || [])
            .filter((dependency) => dependency.connectionId === connectionId)
            .forEach((dependency) => {
              result.dependencyIds.push(dependency.id);
              dependencyStore.delete(dependency.id);
            });
        };

        flowRead.onsuccess = (event) => {
          Array.from(event.target.result || []).forEach((flow) => {
            const connections = Array.isArray(flow.connections) ? flow.connections : [];
            if (!connections.includes(connectionId)) return;
            result.flowIds.push(flow.id);
            flowStore.put({
              ...flow,
              connections: connections.filter((id) => id !== connectionId),
              updatedAt: now,
            });
          });
        };

        transaction.oncomplete = () => resolve(result);
        transaction.onerror = (event) => reject(event.target.error || new Error("Errore cleanup connection runtime"));
      });
    } finally {
      db.close();
    }
  };

  const upsertDependency = async ({ dependency = {} } = {}) => {
    if (!dependency?.id || !dependency.sourceNodeId || !dependency.targetNodeId) return null;
    const db = await ensureStores();
    const now = new Date().toISOString();
    const record = {
      status: "active",
      channel: "runtime",
      createdAt: dependency.createdAt || now,
      ...dependency,
      updatedAt: now,
    };

    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.runtimeDependencies, STORES.flows], "readwrite");
        const dependencyStore = transaction.objectStore(STORES.runtimeDependencies);
        const flowStore = transaction.objectStore(STORES.flows);
        const flowRequest = flowStore.get(flowIdForWorkspace(record.workspaceId || "workspace_global"));

        dependencyStore.put(record);
        flowRequest.onsuccess = () => {
          const existing = flowRequest.result || {
            id: flowIdForWorkspace(record.workspaceId || "workspace_global"),
            workspaceId: record.workspaceId || "workspace_global",
            name: "Runtime Flow",
            status: "active",
            nodes: [],
            connections: [],
            createdAt: now,
          };
          const connections = Array.isArray(existing.connections) ? existing.connections : [];
          const nextConnections = record.connectionId && !connections.includes(record.connectionId)
            ? [...connections, record.connectionId]
            : connections;
          flowStore.put({
            ...existing,
            connections: nextConnections,
            updatedAt: now,
          });
        };

        transaction.oncomplete = () => resolve(record);
        transaction.onerror = (event) => reject(event.target.error || new Error("Errore salvataggio runtime dependency"));
      });
    } finally {
      db.close();
    }
  };

  const upsertRuntimeNode = async ({ node = {} } = {}) => {
    if (!node?.id) return null;
    const db = await ensureStores();
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

    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.runtimeNodes, STORES.flows], "readwrite");
        const nodeStore = transaction.objectStore(STORES.runtimeNodes);
        const flowStore = transaction.objectStore(STORES.flows);
        const existingNodeRequest = nodeStore.get(record.id);
        const flowRequest = flowStore.get(flowIdForWorkspace(workspaceId));
        let saved = record;

        existingNodeRequest.onsuccess = () => {
          const previous = existingNodeRequest.result || {};
          saved = {
            ...previous,
            ...record,
            metadata: {
              ...(previous.metadata || {}),
              ...(record.metadata || {}),
            },
            createdAt: previous.createdAt || record.createdAt || now,
            updatedAt: now,
          };
          nodeStore.put(saved);
        };

        flowRequest.onsuccess = () => {
          const existing = flowRequest.result || {
            id: flowIdForWorkspace(workspaceId),
            workspaceId,
            name: "Runtime Flow",
            status: "active",
            nodes: [],
            connections: [],
            createdAt: now,
          };
          const nodes = Array.isArray(existing.nodes) ? existing.nodes : [];
          const index = nodes.findIndex((flowNode) => flowNode.id === record.id || flowNode.boxId === record.id);
          const flowNode = {
            ...(index >= 0 ? nodes[index] : {}),
            id: record.id,
            type: record.type,
            label: record.label,
            position: record.position,
            flowPosition: record.flowPosition,
            boxId: record.sourceRef || record.assetId || record.id,
          };
          const nextNodes = index >= 0 ? nodes.map((item, itemIndex) => itemIndex === index ? flowNode : item) : [...nodes, flowNode];
          flowStore.put({
            ...existing,
            workspaceId,
            nodes: nextNodes,
            status: existing.status === "draft" ? "active" : existing.status || "active",
            updatedAt: now,
          });
        };

        transaction.oncomplete = () => resolve(saved);
        transaction.onerror = (event) => reject(event.target.error || new Error("Errore salvataggio runtime node"));
      });
    } finally {
      db.close();
    }
  };

  return {
    STORES,
    cleanupConnectionReferences,
    createDraftNode,
    deleteRuntimeNodeReferences,
    ensureStores,
    promoteDraftNode,
    deleteRecords,
    readAll,
    syncWorkspaceGraph,
    upsertDependency,
    upsertRuntimeNode,
    updateFlowNodePosition,
  };
})();
