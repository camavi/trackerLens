window.TrackerLensRuntimeGraphModel = (() => {
  const paletteVisuals = {
    "REST API": { tone: "green", icon: "api" },
    WebSocket: { tone: "green", icon: "settings_input_antenna" },
    "RSS Feed": { tone: "green", icon: "rss_feed" },
    Webhook: { tone: "green", icon: "webhook" },
    "YouTube API": { tone: "green", icon: "smart_display" },
    "Manual JSON": { tone: "green", icon: "data_object" },
    "Text Input": { tone: "green", icon: "notes" },
    "IndexedDB Source": { tone: "cyan", icon: "database" },
    "Box Tracker": { tone: "gold", icon: "storage" },
    "Existing Tracker": { tone: "orange", icon: "dataset_linked" },
    "Realtime Tracker": { tone: "orange", icon: "sync_alt" },
    "Polling Tracker": { tone: "gold", icon: "update" },
    "Agent Bridge": { tone: "cyan", icon: "network_node" },
    Filter: { tone: "purple", icon: "filter_alt" },
    Transform: { tone: "purple", icon: "tune" },
    Condition: { tone: "purple", icon: "alt_route" },
    Throttle: { tone: "purple", icon: "speed" },
    Debounce: { tone: "purple", icon: "timer" },
    Merge: { tone: "purple", icon: "call_merge" },
    Split: { tone: "purple", icon: "call_split" },
    Map: { tone: "purple", icon: "account_tree" },
    Reduce: { tone: "purple", icon: "functions" },
    Formatter: { tone: "purple", icon: "format_shapes" },
    Validator: { tone: "purple", icon: "fact_check" },
    Aggregator: { tone: "purple", icon: "stacked_bar_chart" },
    Cache: { tone: "purple", icon: "cached" },
    Parser: { tone: "purple", icon: "schema" },
    "Task Node": { tone: "gold", icon: "assignment" },
    "AI Analyzer": { tone: "violet", icon: "psychology" },
    "AI Sentiment": { tone: "pink", icon: "mood" },
    "AI Summarizer": { tone: "violet", icon: "summarize" },
    "AI Classifier": { tone: "pink", icon: "category" },
    "AI Predictor": { tone: "violet", icon: "online_prediction" },
    "AI Memory": { tone: "pink", icon: "memory" },
    "AI Planner": { tone: "violet", icon: "route" },
    "AI Router": { tone: "pink", icon: "alt_route" },
    "AI Debugger": { tone: "violet", icon: "bug_report" },
    "AI Decision": { tone: "pink", icon: "rule" },
    "Orchestrator Agent": { tone: "gold", icon: "hub" },
    "Box Lens": { tone: "blue", icon: "dashboard" },
    "Chart Lens": { tone: "cyan", icon: "insert_chart" },
    "Stats Lens": { tone: "blue", icon: "monitoring" },
    "Feed Lens": { tone: "cyan", icon: "dynamic_feed" },
    "Table Lens": { tone: "blue", icon: "table_chart" },
    "Video Lens": { tone: "cyan", icon: "smart_display" },
    "Terminal Lens": { tone: "blue", icon: "terminal" },
    "AI Insight Lens": { tone: "cyan", icon: "insights" },
    "Notification Lens": { tone: "blue", icon: "notifications_active" },
    Notification: { tone: "orange", icon: "notifications" },
    "Browser Notification": { tone: "orange", icon: "notifications" },
    "Webhook Call": { tone: "red", icon: "call_made" },
    "Webhook POST": { tone: "red", icon: "webhook" },
    "HTTP PUT/PATCH": { tone: "red", icon: "published_with_changes" },
    "Telegram Action": { tone: "orange", icon: "send" },
    "Telegram Message": { tone: "orange", icon: "send" },
    "WhatsApp Message": { tone: "green", icon: "chat" },
    "Discord Action": { tone: "red", icon: "forum" },
    "Discord Message": { tone: "red", icon: "forum" },
    "Slack Message": { tone: "purple", icon: "tag" },
    "Email Action": { tone: "orange", icon: "mail" },
    Email: { tone: "orange", icon: "mail" },
    "Sound Alert": { tone: "red", icon: "volume_up" },
    "Popup Alert": { tone: "orange", icon: "open_in_new" },
    "Runtime Trigger": { tone: "red", icon: "bolt" },
    IndexedDB: { tone: "cyan", icon: "database" },
    "Save DB Record": { tone: "cyan", icon: "database" },
    "Local Cache": { tone: "green", icon: "cached" },
    "Runtime Memory": { tone: "cyan", icon: "memory" },
    Snapshot: { tone: "green", icon: "camera" },
    "File Export": { tone: "cyan", icon: "file_download" },
    "Save File": { tone: "cyan", icon: "file_download" },
    "JSON Export": { tone: "green", icon: "data_object" },
    "CSV Export": { tone: "cyan", icon: "table_view" },
    "History Store": { tone: "green", icon: "history" },
    Preview: { tone: "blue", icon: "visibility" },
  };

  const nodeChannels = (node) =>
    []
      .concat(node?.channels || [])
      .concat(node?.inputs || [])
      .concat(node?.outputs || [])
      .concat((node?.metadata?.manifest?.inputs || []).map((port) => port?.name || port))
      .concat((node?.metadata?.manifest?.outputs || []).map((port) => port?.name || port))
      .filter(Boolean)
      .map(String);

  const visualForNode = (node = null) => {
    const label = node?.metadata?.paletteLabel || node?.label || "";
    return paletteVisuals[label] || {};
  };

  const toneForType = (type = "", node = null) => {
    if (node?.metadata?.tone) return node.metadata.tone;
    if (node?.tone) return node.tone;
    const visual = visualForNode(node);
    if (visual.tone) return visual.tone;
    if (type === "boxTracker") return "green";
    if (type === "boxLens") return "blue";
    if (type === "lens") return "blue";
    if (type === "aiAgent") return "violet";
    if (type === "processor") return "purple";
    if (type === "knowledge") return "cyan";
    if (type === "action") return "orange";
    if (type === "storage") return "cyan";
    if (type === "source") return "green";
    if (type === "devPreview") return "blue";
    return "cyan";
  };

  const iconForType = (type = "", node = null) => {
    if (node?.metadata?.icon) return node.metadata.icon;
    if (node?.icon) return node.icon;
    const visual = visualForNode(node);
    if (visual.icon) return visual.icon;
    if (type === "boxTracker") return "storage";
    if (type === "boxLens") return "dashboard";
    if (type === "lens") return "dashboard";
    if (type === "aiAgent") return "psychology";
    if (type === "processor") return "tune";
    if (type === "knowledge") return "menu_book";
    if (type === "action") return "bolt";
    if (type === "storage") return "database";
    if (type === "source") return "api";
    if (type === "devPreview") return "visibility";
    return "account_tree";
  };

  const flowPositions = (flows = [], workspaceId = "") => {
    const positions = new Map();
    flows
      .filter((flow) => !workspaceId || flow.workspaceId === workspaceId)
      .flatMap((flow) => Array.isArray(flow.nodes) ? flow.nodes : [])
      .forEach((node) => node.id && node.flowPosition && positions.set(node.id, node.flowPosition));
    return positions;
  };

  const build = ({ runtime = {}, filters = {} } = {}) => {
    const flows = runtime.flows || [];
    const sourceNodes = runtime.nodes || runtime.runtimeNodes || [];
    const sourceDependencies = runtime.dependencies || runtime.runtimeDependencies || [];
    const channels = runtime.channels || [];
    const workspaceId = filters.workspaceId && filters.workspaceId !== "all"
      ? filters.workspaceId
      : "";
    const channelFilter = filters.channel && filters.channel !== "all" ? filters.channel : "";
    const typeFilter = filters.type && filters.type !== "all" ? filters.type : "";
    const originFilter = filters.origin && filters.origin !== "all" ? filters.origin : "";
    const stateFilter = filters.state && filters.state !== "all" ? filters.state : "";
    const positions = flowPositions(flows, workspaceId);
    let nodes = sourceNodes
      .filter((node) => !workspaceId || node.workspaceId === workspaceId)
      .map((node) => ({ ...node, flowPosition: node.flowPosition || positions.get(node.id) }));

    if (typeFilter) nodes = nodes.filter((node) => node.type === typeFilter);
    if (originFilter === "library") nodes = nodes.filter((node) => node.metadata?.library);
    if (originFilter === "runtime") nodes = nodes.filter((node) => !node.metadata?.library);
    if (stateFilter === "configured") nodes = nodes.filter((node) => node.metadata?.configured || (!node.metadata?.draft && node.status !== "draft"));
    if (stateFilter === "draft") nodes = nodes.filter((node) => node.metadata?.draft || node.status === "draft" || String(node.id || "").startsWith("draft_"));

    const nodeIds = new Set(nodes.map((node) => node.id));
    let dependencies = sourceDependencies
      .filter((dependency) => !workspaceId || dependency.workspaceId === workspaceId)
      .filter((dependency) => nodeIds.has(dependency.sourceNodeId) && nodeIds.has(dependency.targetNodeId));

    if (channelFilter) {
      dependencies = dependencies.filter((dependency) => dependency.channel === channelFilter);
      const connected = new Set();
      dependencies.forEach((dependency) => {
        connected.add(dependency.sourceNodeId);
        connected.add(dependency.targetNodeId);
      });
      nodes = nodes.filter((node) => nodeChannels(node).includes(channelFilter) || connected.has(node.id));
    }

    const channelsByName = new Map(channels.map((channel) => [channel.name, channel]));
    return { workspaceId, nodes, dependencies, channelsByName };
  };

  const nodePosition = ({ node, index = 0, overrides = {} } = {}) => {
    if (node?.id && overrides[node.id]) return overrides[node.id];
    if (node?.flowPosition && node.flowPosition.x != null && node.flowPosition.y != null) return node.flowPosition;
    const order = { source: 0, boxTracker: 1, processor: 2, knowledge: 3, aiAgent: 4, boxLens: 5, action: 6 };
    const column = order[node?.type] ?? 2 + (index % 3);
    const yIndex = Math.floor(index / 4) + (index % 4);
    return { x: 120 + Math.min(6, column) * 320, y: 120 + yIndex * 220 };
  };

  const recentActivity = ({ graph = {}, events = [], windowMs = 60000 } = {}) => {
    const now = Date.now();
    const nodeActivity = new Map();
    const edgeActivity = new Map();

    events.forEach((event) => {
      const created = Date.parse(event.createdAt);
      if (Number.isNaN(created) || now - created > windowMs) return;
      const eventChannel = event.channel || "";
      const matchedDependencies = (graph.dependencies || []).filter((dependency) => {
        if (event.meta?.dependencyId && dependency.id === event.meta.dependencyId) return true;
        if (event.meta?.orchestratorRuntime && event.meta?.executedNodeId) {
          const orchestratorId = String(event.meta.orchestratorRuntime || "");
          const executedNodeId = String(event.meta.executedNodeId || "");
          const port = String(dependency.channel || dependency.metadata?.sourcePort || dependency.metadata?.targetPort || "").toLowerCase();
          return port === "agent_control" &&
            ((dependency.sourceNodeId === orchestratorId && dependency.targetNodeId === executedNodeId) ||
              (dependency.sourceNodeId === executedNodeId && dependency.targetNodeId === orchestratorId));
        }
        if (event.sourceNodeId && dependency.sourceNodeId === event.sourceNodeId) {
          return !eventChannel || dependency.channel === eventChannel;
        }
        if (event.targetNodeId && dependency.targetNodeId === event.targetNodeId) {
          return !eventChannel || dependency.channel === eventChannel;
        }
        return false;
      });
      const related = [
        event.sourceNodeId,
        event.targetNodeId,
        event.meta?.orchestratorRuntime,
        event.meta?.executedNodeId,
        ...matchedDependencies.flatMap((dependency) => [dependency.sourceNodeId, dependency.targetNodeId]),
      ].filter(Boolean);

      (graph.nodes || []).forEach((node) => {
        if (related.includes(node.id) || nodeChannels(node).includes(event.channel)) {
          const current = nodeActivity.get(node.id) || { count: 0, status: "ok", lastAt: event.createdAt };
          const type = String(event.eventType || "").toLowerCase();
          const orchestrating = type.startsWith("orchestrator_") && !type.includes("done") && !type.includes("result");
          const complete = type.includes("done") || type.includes("completed") || type.includes("result");
          const runtimeStatus = ["busy", "queued", "overloaded", "idle"].includes(String(event.status || "").toLowerCase())
            ? String(event.status).toLowerCase()
            : "";
          const nextStatus = event.status === "error" || event.eventType === "error" || current.status === "error"
            ? "error"
            : complete
              ? "complete"
              : orchestrating
                ? "orchestrating"
                : runtimeStatus || current.status || "ok";
          const isNewer = Date.parse(current.lastAt || 0) <= created;
          nodeActivity.set(node.id, {
            count: current.count + 1,
            status: isNewer ? nextStatus : current.status || nextStatus,
            phase: isNewer ? (event.payload?.phase || event.meta?.plannerStep || (complete ? "complete" : "")) : current.phase || "",
            eventType: isNewer ? event.eventType || "" : current.eventType || "",
            targetLabel: isNewer ? event.payload?.targetLabel || "" : current.targetLabel || "",
            lastAt: Date.parse(current.lastAt) > created ? current.lastAt : event.createdAt,
          });
        }
      });

      matchedDependencies.forEach((dependency) => {
          const current = edgeActivity.get(dependency.id) || { count: 0, status: "ok", lastAt: event.createdAt };
          edgeActivity.set(dependency.id, {
            count: current.count + 1,
            status: event.status === "error" || event.eventType === "error" || current.status === "error"
              ? "error"
              : String(event.eventType || "").startsWith("orchestrator_")
                ? "orchestrating"
                : "ok",
            lastAt: Date.parse(current.lastAt) > created ? current.lastAt : event.createdAt,
          });
      });
    });

    return { nodeActivity, edgeActivity };
  };

  const filterByActivity = ({ graph = {}, activity = {}, filter = "all" } = {}) => {
    if (filter === "all") return graph;
    const nodes = (graph.nodes || []).filter((node) => {
      const live = activity.nodeActivity?.get(node.id);
      return filter === "live" ? live && live.status !== "error" : live?.status === "error";
    });
    const nodeIds = new Set(nodes.map((node) => node.id));
    const dependencies = (graph.dependencies || []).filter((dependency) => nodeIds.has(dependency.sourceNodeId) && nodeIds.has(dependency.targetNodeId));
    return { ...graph, nodes, dependencies };
  };

  return {
    build,
    filterByActivity,
    iconForType,
    nodeChannels,
    nodePosition,
    recentActivity,
    toneForType,
  };
})();
