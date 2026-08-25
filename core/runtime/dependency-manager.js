window.TrackerLensDependencyManager = (() => {
  const tableName = (key, fallback) => {
    const config = typeof tlConfig !== "undefined" ? tlConfig : window.tlConfig;
    return config?.TABLES?.[key] || fallback;
  };

  const STORES = {
    widgets: tableName("TL_WIDGETS", "tl_widgets"),
    pages: tableName("TL_PAGES", "tl_pages"),
    connections: tableName("TL_CONNECTIONS", "tl_connections"),
    channels: tableName("TL_CHANNELS", "tl_channels"),
    flows: tableName("TL_FLOWS", "tl_flows"),
    events: tableName("TL_EVENTS", "tl_events"),
    flowLogs: tableName("TL_FLOW_LOGS", "tl_flow_logs"),
    agents: tableName("TL_AGENTS", "tl_agents"),
    runtimeNodes: tableName("TL_RUNTIME_NODES", "tl_runtime_nodes"),
    runtimeDependencies: tableName("TL_RUNTIME_DEPENDENCIES", "tl_runtime_dependencies"),
  };

  const contentOf = (record) =>
    record?.content && typeof record.content === "object" ? record.content : record || {};

  const normalizeText = (value, fallback = "") => {
    if (value === null || value === undefined) return fallback;
    return String(value).trim() || fallback;
  };

  const ensureRuntimeStores = async () => {
    const bridge = window.trackers?.desktop?.persistence;
    if (!bridge?.getStatus || !bridge?.readDevelopmentRecords || !bridge?.writeDevelopmentRecords || !bridge?.deleteDevelopmentRecords) throw new Error("Dependency Manager richiede SQLite nell'app desktop.");
    if ((await bridge.getStatus())?.mode !== "desktop-sqlite") throw new Error("Dependency Manager richiede SQLite nell'app desktop.");
    return bridge;
  };

  const readAll = async (storeName) => {
    return (await ensureRuntimeStores()).readDevelopmentRecords({ storeName });
  };

  const deleteRecords = async (storeName, ids = []) => {
    if (!ids.length) return [];
    await (await ensureRuntimeStores()).deleteDevelopmentRecords({ storeName, ids });
    return ids;
  };

  const putRecords = async (storeName, records = []) => {
    if (!records.length) return [];
    await (await ensureRuntimeStores()).writeDevelopmentRecords({ storeName, records });
    return records;
  };

  const stringIncludesAny = (value, candidates) => {
    const text = typeof value === "string" ? value : JSON.stringify(value || {});
    return candidates.some((candidate) => candidate && text.includes(candidate));
  };

  const channelOf = (record) => normalizeText(record.channel || record.name || record.frequency || record.outputChannel);

  const uniqueStrings = (values = []) => [...new Set(values.filter(Boolean).map(String))];

  const nodeTypeGroup = (type = "") => {
    const value = normalizeText(type, "boxTracker");
    if (value === "boxTracker" || value === "boxLens") return "widget";
    if (value === "channel") return "channel";
    if (value === "connection") return "connection";
    if (value === "workspace") return "workspace";
    if (value === "agent" || value === "aiAgent") return "agent";
    return value;
  };

  const buildTrackerReferenceSet = ({ id, record, workspaces }) => {
    const content = contentOf(record);
    const ids = new Set([id, record?.id, content.id, content.sourceId, content.assetId].filter(Boolean).map(String));

    workspaces.forEach((workspace) => {
      workspace.boxes
        .filter((box) =>
          [box.id, box.assetId, box.sourceId].filter(Boolean).some((value) => ids.has(String(value)))
        )
        .forEach((box) => {
          [box.id, box.assetId, box.sourceId].filter(Boolean).forEach((value) => ids.add(String(value)));
        });
    });

    return ids;
  };

  const buildEntityReferenceSet = ({ id, type, record, workspaces, connections = [], channels = [], runtimeNodes = [], runtimeDependencies = [] }) => {
    const group = nodeTypeGroup(type);
    const content = contentOf(record);
    const ids = new Set(uniqueStrings([id, record?.id, content.id, content.sourceId, content.assetId, content.nodeId, content.connectionId]));
    const channelNames = new Set(uniqueStrings([
      content.name,
      content.channel,
      content.outputChannel,
      content.runtime?.output,
      content.frequency,
      group === "channel" ? id : "",
    ]));

    if (group === "workspace") {
      (content.boxes || []).forEach((box) => {
        uniqueStrings([box.id, box.assetId, box.sourceId]).forEach((value) => ids.add(value));
        (Array.isArray(box.channels) ? box.channels : []).forEach((channel) => channelNames.add(String(channel)));
        if (box.outputChannel) channelNames.add(String(box.outputChannel));
      });
      (content.connections || []).forEach((connection) => {
        uniqueStrings([connection.id, connection.fromBoxId, connection.toBoxId, connection.fromNodeId, connection.toNodeId]).forEach((value) => ids.add(value));
        const channel = channelOf(connection);
        if (channel) channelNames.add(channel);
      });
    }

    if (group === "connection") {
      uniqueStrings([
        content.fromBoxId,
        content.toBoxId,
        content.fromNodeId,
        content.toNodeId,
        content.sourceNodeId,
        content.targetNodeId,
        content.from,
        content.to,
      ]).forEach((value) => ids.add(value));
      const channel = channelOf(content);
      if (channel) channelNames.add(channel);
    }

    workspaces.forEach((workspace) => {
      const workspaceHit = group === "workspace" && workspace.id === String(id);
      workspace.boxes
        .filter((box) =>
          workspaceHit ||
          [box.id, box.assetId, box.sourceId].filter(Boolean).some((value) => ids.has(String(value)))
        )
        .forEach((box) => {
          uniqueStrings([box.id, box.assetId, box.sourceId]).forEach((value) => ids.add(value));
          (Array.isArray(box.channels) ? box.channels : []).forEach((channel) => channelNames.add(String(channel)));
          if (box.outputChannel) channelNames.add(String(box.outputChannel));
        });
      workspace.connections
        .filter((connection) => workspaceHit || connectionReferences(connection, ids, channelNames))
        .forEach((connection) => {
          uniqueStrings([connection.id, connection.fromBoxId, connection.toBoxId, connection.fromNodeId, connection.toNodeId]).forEach((value) => ids.add(value));
          const channel = channelOf(connection);
          if (channel) channelNames.add(channel);
        });
    });

    connections.forEach((connection) => {
      const content = contentOf(connection);
      if (connectionReferences(content, ids, channelNames)) {
        uniqueStrings([connection.id, content.id, content.fromBoxId, content.toBoxId, content.fromNodeId, content.toNodeId]).forEach((value) => ids.add(value));
        const channel = channelOf(content);
        if (channel) channelNames.add(channel);
      }
    });
    channels.forEach((channel) => {
      const content = contentOf(channel);
      if (channelReferences(content, ids, channelNames)) {
        uniqueStrings([channel.id, content.id, content.name, content.channel]).forEach((value) => ids.add(value));
        uniqueStrings([content.name, content.channel]).forEach((value) => channelNames.add(value));
      }
    });
    runtimeNodes.forEach((node) => {
      if (stringIncludesAny(node, [...ids, ...channelNames])) {
        uniqueStrings([node.id, node.sourceRef, node.assetId]).forEach((value) => ids.add(value));
        (node.channels || []).forEach((channel) => channelNames.add(String(channel)));
      }
    });
    runtimeDependencies.forEach((dependency) => {
      if (stringIncludesAny(dependency, [...ids, ...channelNames])) {
        uniqueStrings([dependency.id, dependency.sourceNodeId, dependency.targetNodeId, dependency.connectionId]).forEach((value) => ids.add(value));
        if (dependency.channel) channelNames.add(String(dependency.channel));
      }
    });

    return { ids, channelNames };
  };

  const normalizeWorkspace = (record, index = 0) => {
    const content = contentOf(record);
    return {
      id: normalizeText(record?.id || content.id, `workspace_${index}`),
      name: normalizeText(content.name || content.title, `Workspace ${index + 1}`),
      boxes: Array.isArray(content.boxes) ? content.boxes : [],
      connections: Array.isArray(content.connections) ? content.connections : [],
      raw: record,
      content,
    };
  };

  const connectionReferences = (connection, ids, channelNames) => {
    const directFields = [
      connection.fromBoxId,
      connection.toBoxId,
      connection.fromNodeId,
      connection.toNodeId,
      connection.sourceNodeId,
      connection.targetNodeId,
      connection.from,
      connection.to,
      connection.targetMeta,
    ].filter(Boolean).map(String);

    if (directFields.some((value) => ids.has(value))) return true;
    if (channelNames.has(channelOf(connection))) return true;
    return stringIncludesAny(connection.mapping || {}, [...ids]);
  };

  const channelReferences = (channel, ids, channelNames) => {
    const directFields = [
      channel.id,
      channel.name,
      channel.producerNodeId,
      channel.sourceNodeId,
      channel.sourceBoxId,
      channel.boxId,
      channel.producerOutput,
    ].filter(Boolean).map(String);

    if (directFields.some((value) => ids.has(value) || channelNames.has(value))) return true;
    if (Array.isArray(channel.subscribers) && channel.subscribers.some((subscriber) => ids.has(String(subscriber)))) return true;
    return stringIncludesAny(channel, [...ids]);
  };

  const flowReferences = (flow, ids, channelNames) => {
    const content = contentOf(flow);
    const nodes = Array.isArray(content.nodes) ? content.nodes : Array.isArray(flow.nodes) ? flow.nodes : [];
    const connections = Array.isArray(content.connections) ? content.connections : Array.isArray(flow.connections) ? flow.connections : [];
    const nodeMatch = nodes.some((node) =>
      [node.id, node.boxId, node.sourceRef, node.assetId, node.sourceId].filter(Boolean).some((value) => ids.has(String(value)))
    );
    const connectionMatch = connections.some((connection) => connectionReferences(connection, ids, channelNames));
    return nodeMatch || connectionMatch || stringIncludesAny(content, [...ids]);
  };

  const agentReferences = (agent, ids, channelNames) => {
    const content = contentOf(agent);
    const channels = []
      .concat(content.channels || [])
      .concat(content.inputChannels || [])
      .concat(content.outputChannels || []);
    if (channels.some((channel) => channelNames.has(String(channel)))) return true;
    return stringIncludesAny(content, [...ids, ...channelNames]);
  };

  const inspectTracker = async (id) => {
    await ensureRuntimeStores();

    const [widgets, pages, connections, channels, flows, agents, runtimeNodes, runtimeDependencies] = await Promise.all([
      readAll(STORES.widgets),
      readAll(STORES.pages),
      readAll(STORES.connections),
      readAll(STORES.channels),
      readAll(STORES.flows),
      readAll(STORES.agents),
      readAll(STORES.runtimeNodes),
      readAll(STORES.runtimeDependencies),
    ]);

    const trackerRecord = widgets.find((record) => {
      const content = contentOf(record);
      return [record?.id, content.id, content.sourceId, content.assetId].filter(Boolean).map(String).includes(String(id));
    });
    const tracker = contentOf(trackerRecord);
    const channelNames = new Set([tracker.outputChannel, tracker.channel, tracker.runtime?.output].filter(Boolean).map(String));
    const workspaces = pages.map(normalizeWorkspace);
    const ids = buildTrackerReferenceSet({ id: String(id), record: trackerRecord, workspaces });

    const workspaceMatches = workspaces
      .map((workspace) => {
        const boxes = workspace.boxes.filter((box) =>
          [box.id, box.assetId, box.sourceId].filter(Boolean).some((value) => ids.has(String(value)))
        );
        const localConnections = workspace.connections.filter((connection) => connectionReferences(connection, ids, channelNames));
        return boxes.length || localConnections.length
          ? { id: workspace.id, name: workspace.name, boxes, connections: localConnections, raw: workspace.raw }
          : null;
      })
      .filter(Boolean);

    workspaceMatches.forEach((workspace) => {
      workspace.connections.forEach((connection) => {
        const channel = channelOf(connection);
        if (channel) channelNames.add(channel);
      });
      workspace.boxes.forEach((box) => {
        (Array.isArray(box.channels) ? box.channels : []).forEach((channel) => channelNames.add(String(channel)));
      });
    });

    const connectionMatches = connections.filter((connection) => connectionReferences(contentOf(connection), ids, channelNames));
    connectionMatches.forEach((connection) => {
      const channel = channelOf(contentOf(connection));
      if (channel) channelNames.add(channel);
    });

    const channelMatches = channels.filter((channel) => channelReferences(contentOf(channel), ids, channelNames));
    channelMatches.forEach((channel) => {
      const content = contentOf(channel);
      if (content.name) channelNames.add(String(content.name));
      if (content.channel) channelNames.add(String(content.channel));
    });

    const flowMatches = flows.filter((flow) => flowReferences(flow, ids, channelNames));
    const agentMatches = agents.filter((agent) => agentReferences(agent, ids, channelNames));
    const runtimeNodeMatches = runtimeNodes.filter((node) => stringIncludesAny(node, [...ids, ...channelNames]));
    const dependencyMatches = runtimeDependencies.filter((dependency) => stringIncludesAny(dependency, [...ids, ...channelNames]));

    const report = {
      id: String(id),
      recordId: trackerRecord?.id || String(id),
      type: "boxTracker",
      label: normalizeText(tracker.name || tracker.title, String(id)),
      channels: channelMatches,
      channelNames: [...channelNames].filter(Boolean),
      connections: connectionMatches,
      flows: flowMatches,
      workspaces: workspaceMatches,
      agents: agentMatches,
      actions: [],
      runtimeNodes: runtimeNodeMatches,
      dependencies: dependencyMatches,
    };

    report.total =
      report.channels.length +
      report.connections.length +
      report.flows.length +
      report.workspaces.length +
      report.agents.length +
      report.actions.length +
      report.runtimeNodes.length +
      report.dependencies.length;
    report.hasDependencies = report.total > 0;
    return report;
  };

  const inspectNode = async ({ id, type = "boxTracker" }) => {
    if (!id) throw new Error("ID nodo mancante");
    if (type === "boxTracker") return inspectTracker(id);
    await ensureRuntimeStores();

    const [widgets, pages, connections, channels, flows, agents, runtimeNodes, runtimeDependencies] = await Promise.all([
      readAll(STORES.widgets),
      readAll(STORES.pages),
      readAll(STORES.connections),
      readAll(STORES.channels),
      readAll(STORES.flows),
      readAll(STORES.agents),
      readAll(STORES.runtimeNodes),
      readAll(STORES.runtimeDependencies),
    ]);
    const workspaces = pages.map(normalizeWorkspace);
    const group = nodeTypeGroup(type);
    const storesByGroup = {
      widget: widgets,
      channel: channels,
      connection: connections,
      workspace: pages,
      agent: agents,
    };
    const candidates = storesByGroup[group] || runtimeNodes;
    const record = candidates.find((candidate) => {
      const content = contentOf(candidate);
      return uniqueStrings([candidate?.id, content.id, content.name, content.sourceId, content.assetId, content.nodeId, content.connectionId]).includes(String(id));
    }) || null;
    const { ids, channelNames } = buildEntityReferenceSet({
      id: String(id),
      type,
      record,
      workspaces,
      connections,
      channels,
      runtimeNodes,
      runtimeDependencies,
    });

    const workspaceMatches = workspaces
      .map((workspace) => {
        const isWorkspace = group === "workspace" && workspace.id === String(id);
        const boxes = workspace.boxes.filter((box) =>
          isWorkspace || [box.id, box.assetId, box.sourceId].filter(Boolean).some((value) => ids.has(String(value)))
        );
        const localConnections = workspace.connections.filter((connection) => isWorkspace || connectionReferences(connection, ids, channelNames));
        return isWorkspace || boxes.length || localConnections.length
          ? { id: workspace.id, name: workspace.name, boxes, connections: localConnections, raw: workspace.raw }
          : null;
      })
      .filter(Boolean);
    const connectionMatches = connections.filter((connection) => connectionReferences(contentOf(connection), ids, channelNames));
    const channelMatches = channels.filter((channel) => channelReferences(contentOf(channel), ids, channelNames));
    const flowMatches = flows.filter((flow) => flowReferences(flow, ids, channelNames));
    const agentMatches = agents.filter((agent) => agentReferences(agent, ids, channelNames));
    const runtimeNodeMatches = runtimeNodes.filter((node) => stringIncludesAny(node, [...ids, ...channelNames]));
    const dependencyMatches = runtimeDependencies.filter((dependency) => stringIncludesAny(dependency, [...ids, ...channelNames]));
    const content = contentOf(record);
    const report = {
      id: String(id),
      recordId: record?.id || String(id),
      type,
      label: normalizeText(content.name || content.title || content.label, String(id)),
      channels: channelMatches,
      channelNames: [...channelNames].filter(Boolean),
      connections: connectionMatches,
      flows: flowMatches,
      workspaces: workspaceMatches,
      agents: agentMatches,
      actions: [],
      runtimeNodes: runtimeNodeMatches,
      dependencies: dependencyMatches,
    };
    report.total =
      report.channels.length +
      report.connections.length +
      report.flows.length +
      report.workspaces.length +
      report.agents.length +
      report.actions.length +
      report.runtimeNodes.length +
      report.dependencies.length;
    report.hasDependencies = report.total > 0;
    return report;
  };

  const removeReferencesFromWorkspaces = async (report) => {
    if (!report.workspaces.length) return [];
    const updatedPages = report.workspaces.map((workspace) => {
      const raw = workspace.raw;
      const content = { ...contentOf(raw) };
      const boxIds = new Set(workspace.boxes.map((box) => box.id));
      const connectionIds = new Set(workspace.connections.map((connection) => connection.id));
      content.boxes = (content.boxes || []).filter((box) => !boxIds.has(box.id));
      content.connections = (content.connections || []).filter(
        (connection) =>
          !connectionIds.has(connection.id) &&
          !boxIds.has(connection.fromBoxId) &&
          !boxIds.has(connection.toBoxId)
      );
      content.updatedAt = new Date().toISOString();
      return { ...raw, content };
    });
    return putRecords(STORES.pages, updatedPages);
  };

  const removeTrackerReferencesFromWorkspaces = removeReferencesFromWorkspaces;

  const forceDeleteNode = async ({ id, type = "boxTracker", report = null }) => {
    const dependencyReport = report || await inspectNode({ id, type });
    const group = nodeTypeGroup(type);
    const widgetDeleteIds = group === "widget" ? [id, dependencyReport.recordId] : [];
    const channelDeleteIds = group === "channel"
      ? [id, dependencyReport.recordId, ...dependencyReport.channels.map((channel) => channel.id)]
      : dependencyReport.channels.map((channel) => channel.id);
    const connectionDeleteIds = group === "connection"
      ? [id, dependencyReport.recordId, ...dependencyReport.connections.map((connection) => connection.id)]
      : dependencyReport.connections.map((connection) => connection.id);
    const workspaceDeleteIds = group === "workspace" ? [id, dependencyReport.recordId] : [];
    const agentDeleteIds = group === "agent" ? [id, dependencyReport.recordId] : [];

    await Promise.all([
      deleteRecords(STORES.widgets, uniqueStrings(widgetDeleteIds)),
      deleteRecords(STORES.connections, uniqueStrings(connectionDeleteIds)),
      deleteRecords(STORES.channels, uniqueStrings(channelDeleteIds)),
      deleteRecords(STORES.pages, uniqueStrings(workspaceDeleteIds)),
      deleteRecords(STORES.agents, uniqueStrings(agentDeleteIds)),
      deleteRecords(STORES.runtimeNodes, dependencyReport.runtimeNodes.map((node) => node.id).filter(Boolean)),
      deleteRecords(STORES.runtimeDependencies, dependencyReport.dependencies.map((dependency) => dependency.id).filter(Boolean)),
      removeReferencesFromWorkspaces(dependencyReport),
    ]);

    return dependencyReport;
  };

  const canDeleteNode = async ({ id, type = "boxTracker" }) => {
    const report = await inspectNode({ id, type });
    return {
      ok: !report.hasDependencies,
      requiresForce: report.hasDependencies,
      report,
    };
  };

  return {
    STORES,
    canDeleteNode,
    ensureRuntimeStores,
    forceDeleteNode,
    inspectNode,
  };
})();
