// Flow Map canvas rendering, inspector, status panels and edge drawing.
// Extracted from js/flowMapView.js; loaded in order by flowMap.html.
const createLinkToNode = async (target) => {
  const source = nodeById(state.linkingSourceId);
  if (!source) {
    state.error = "Link non creato: avvia il collegamento da una porta output o da Start Link.";
    mount();
    return;
  }
  await createRuntimeLink(source, target, { sourcePort: state.linkingPort || "all", targetPort: "all" });
};

const performEdgeDelete = async (edge, closeDialog = null) => {
  if (!edge?.id && !edge?.connectionId) return;
  const deletedConnection = edge.connectionId
    ? state.connections.find((connection) => connection.id === edge.connectionId) || null
    : null;

  if (edge.connectionId) {
    await window.TrackerLensConnectionsStore?.remove?.(edge.connectionId);
    await window.TrackerLensConnectionsStore?.removeWorkspaceContentConnection?.(edge.connectionId, {
      workspaceId: edge.workspaceId || deletedConnection?.workspaceId || "",
    });
    await window.TrackerLensRuntimeGraphStore?.cleanupConnectionReferences?.({ connectionId: edge.connectionId });
    if (window.TrackerLensEventLogStore?.cleanupConnectionReferences) {
      await window.TrackerLensEventLogStore.cleanupConnectionReferences({ connectionId: edge.connectionId });
    }
  }
  if (edge.id && window.TrackerLensRuntimeGraphStore?.deleteRecords) {
    await window.TrackerLensRuntimeGraphStore.deleteRecords(
      window.TrackerLensRuntimeGraphStore.STORES.runtimeDependencies,
      [edge.id]
    );
  }
  await recordFlowAction({
    workspaceId: edge.workspaceId || deletedConnection?.workspaceId || "global",
    connectionId: edge.connectionId || "",
    level: "warning",
    message: `Runtime link deleted: ${edge.channel || edge.connectionId || edge.id}`,
    context: {
      action: "runtime-link-deleted",
      dependencyId: edge.id || "",
      sourceNodeId: edge.sourceNodeId || "",
      targetNodeId: edge.targetNodeId || "",
      channel: edge.channel || "",
    },
  });
  state.lastDeletedConnection = deletedConnection;
  state.optimisticDependencies = (state.optimisticDependencies || []).filter((dependency) =>
    dependency.id !== edge.id && dependency.connectionId !== edge.connectionId
  );
  state.connections = (state.connections || []).filter((connection) => connection.id !== edge.connectionId);
  setRuntimeState({
    ...state.runtime,
    dependencies: (state.runtime.dependencies || []).filter((dependency) =>
      dependency.id !== edge.id && dependency.connectionId !== edge.connectionId
    ),
  });
  closeDialog?.();
  setFocusState({ mode: "", nodeId: "", edgeId: "", nodeType: "", channel: "", connectionId: "" });
  mount({ preserveScroll: true });
  await loadRuntime({ force: true });
};

const restoreLastDeletedConnection = async () => {
  if (!state.lastDeletedConnection || !window.TrackerLensConnectionsStore?.upsert) return;
  const record = state.lastDeletedConnection.raw || state.lastDeletedConnection;
  await window.TrackerLensConnectionsStore.upsert(record);
  state.lastDeletedConnection = null;
  await loadRuntime();
};

const graphValidation = () =>
  graphEngineApi()?.validateGraph?.(currentVisibleGraph(), {
    ...state.runtime,
    runtimeDependencies: currentVisibleGraph().dependencies || state.runtime.dependencies || [],
  }) || state.graphEngine?.validation || { issues: [], errors: [], warnings: [], ok: true };

const repairGraphIssues = async () => {
  const validation = graphValidation();
  const issues = validation.issues || [];
  if (!issues.length) return;

  const dependencyIds = new Set();
  const connectionIds = new Set();
  issues.forEach((issue) => {
    if (issue.type === "dependency" && issue.id) dependencyIds.add(issue.id);
    if (issue.type === "connection" && issue.id) connectionIds.add(issue.id);
  });

  if (dependencyIds.size && window.TrackerLensRuntimeGraphStore?.deleteRecords) {
    await window.TrackerLensRuntimeGraphStore.deleteRecords(
      window.TrackerLensRuntimeGraphStore.STORES.runtimeDependencies,
      [...dependencyIds]
    );
  }

  if (connectionIds.size) {
    await window.TrackerLensConnectionsStore?.removeMany?.([...connectionIds]);
    await Promise.all([...connectionIds].map((connectionId) =>
      Promise.all([
        window.TrackerLensRuntimeGraphStore?.cleanupConnectionReferences?.({ connectionId }),
        window.TrackerLensEventLogStore?.cleanupConnectionReferences?.({ connectionId }),
        window.TrackerLensConnectionsStore?.removeWorkspaceContentConnection?.(connectionId),
      ])
    ));
  }

  await recordFlowAction({
    workspaceId: state.filters.workspaceId || "workspace_global",
    level: "warning",
    message: `Graph repair cleanup: ${issues.length} issue`,
    context: {
      action: "graph-repair-cleanup",
      dependencyIds: [...dependencyIds],
      connectionIds: [...connectionIds],
    },
  });
  await loadRuntime({ force: true });
};

const requestEdgeDelete = (edge) => {
  if (!edge?.id && !edge?.connectionId) return;
  const source = nodeById(edge.sourceNodeId);
  const target = nodeById(edge.targetNodeId);
  const dialog = _.Dialog({
    class: "tl-flow-edge-delete-dialog",
    panelClass: "tl-flow-edge-delete-panel",
    size: "md",
    title: "Eliminare questo collegamento?",
    subtitle: edge.channel || edge.connectionId,
    icon: "link_off",
    closeButton: true,
    content: () => _.div(
      { class: "tl-flow-edge-delete-body" },
      _.p("Il collegamento persistito verra rimosso e verranno puliti i riferimenti runtime collegati."),
      _.div(_.span("Source"), _.strong(source?.label || edge.sourceNodeId || "N/D")),
      _.div(_.span("Target"), _.strong(target?.label || edge.targetNodeId || "N/D")),
      _.div(_.span("Channel"), _.strong(edge.channel || "runtime")),
      _.div(_.span("Connection"), _.strong(edge.connectionId || "N/D")),
      _.div(_.span("Dependency"), _.strong(edge.id || "N/D"))
    ),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: close }, "Cancel"),
      btn({ class: "is-danger", onclick: () => performEdgeDelete(edge, close) }, icon("link_off", "sm"), "Delete Link")
    ),
  });
  dialog.open();
};

const paletteSearchText = (item = {}, group = "") =>
  [
    group,
    item.label,
    item.nodeType,
    item.type,
    item.subtype,
    item.category,
    item.connectionType,
    item.trackerSource,
    item.runtimeMode,
    item.url,
    ...(item.permissions || []),
    item.manifest?.type,
    item.manifest?.subtype,
    item.manifest?.category,
  ].filter(Boolean).join(" ").toLowerCase();

const filteredNodePalette = () => {
  const query = String(state.paletteSearch || "").trim().toLowerCase();
  if (!query) return nodePalette;
  return nodePalette
    .map(([title, items]) => [title, items.filter((item) => paletteSearchText(item, title).includes(query))])
    .filter(([, items]) => items.length);
};

const paletteItemMatchesSearch = (item = {}, group = "", query = String(state.paletteSearch || "").trim().toLowerCase()) =>
  !query || paletteSearchText(item, group).includes(query);

const applyPaletteSearchDom = () => {
  const query = String(state.paletteSearch || "").trim().toLowerCase();
  let visibleSections = 0;
  document.querySelectorAll("[data-flow-palette-section]").forEach((section) => {
    let visibleItems = 0;
    section.querySelectorAll("[data-flow-palette-item]").forEach((item) => {
      const matched = !query || String(item.dataset.flowPaletteSearch || "").includes(query);
      item.hidden = !matched;
      if (matched) visibleItems += 1;
    });
    section.hidden = visibleItems === 0;
    if (visibleItems) visibleSections += 1;
  });
  const empty = document.querySelector("[data-flow-palette-empty]");
  if (empty) empty.hidden = visibleSections > 0;
  const clear = document.querySelector("[data-flow-palette-search-clear]");
  if (clear) clear.hidden = !query;
};

const setPaletteSearch = (value = "") => {
  state.paletteSearch = value;
  applyPaletteSearchDom();
};

const renderPalette = () =>
  (() => {
    const visiblePalette = filteredNodePalette();
    return (
      _.aside(
        { class: "tl-flow-palette" },
        btn({
          class: "tl-flow-create-node-btn",
          onclick: () => openNodeBuilderDialog(),
        }, icon("add_box", "sm"), "Create Node"),
        _.div({ class: "tl-flow-panel-title" }, _.strong("Add Node"), btn({ "aria-label": "Collapse" }, icon("keyboard_arrow_up", "sm"))),
        _.label(
          { class: "tl-flow-palette-search" },
          icon("search", "sm"),
          _.input({
            type: "search",
            value: state.paletteSearch,
            placeholder: "Search nodes",
            "aria-label": "Search nodes",
            autocomplete: "off",
            oninput: (event) => setPaletteSearch(event.currentTarget.value),
            onkeydown: (event) => event.stopPropagation(),
            onclick: (event) => event.stopPropagation(),
            onPointerDown: (event) => event.stopPropagation(),
          }),
          btn({
            class: "tl-flow-palette-search-clear",
            "data-flow-palette-search-clear": "true",
            "aria-label": "Clear node search",
            title: "Clear search",
            hidden: !state.paletteSearch,
            onclick: (event) => {
              event.preventDefault();
              event.stopPropagation();
              setPaletteSearch("");
              const input = document.querySelector(".tl-flow-palette-search input");
              if (input) input.value = "";
              input?.focus?.();
            },
          }, icon("close", "sm"))
        ),
        ...nodePalette.map(([title, items]) => {
          const hasVisibleItems = items.some((item) => paletteItemMatchesSearch(item, title));
          return (
            _.section(
              { "data-flow-palette-section": title, hidden: !hasVisibleItems },
              _.h3(title),
              ...items.map((item) =>
                _.button(
                  {
                    type: "button",
                    class: `tl-flow-palette-item is-draggable is-${item.tone || "cyan"}`,
                    title: item.url || item.trackerSource || item.connectionType || item.label,
                    "data-flow-palette-item": item.label,
                    "data-flow-palette-search": paletteSearchText(item, title),
                    hidden: !paletteItemMatchesSearch(item, title),
                    onPointerDown: (event) => beginPalettePointer(event, item),
                    onclick: () => {
                      if (state.suppressPaletteClick) return;
                      openPaletteNode(item);
                    },
                  },
                  icon(item.icon, "sm"),
                  _.span(item.label)
                )
              )
            )
          );
        }),
        _.div(
          { class: "tl-flow-palette-empty", "data-flow-palette-empty": "true", hidden: visiblePalette.length > 0 },
          icon("search_off", "sm"),
          _.strong("No nodes found"),
          _.span("Try another name, type or category.")
        )
      )
    );
  })();

const renderPromptChatTrigger = () =>
  btn({
    class: "tl-flow-prompt-chat-btn",
    title: "AI Flow Chat",
    "aria-label": "Open AI Flow Chat",
    onclick: () => openFlowPromptChatDialog(),
  }, icon("auto_awesome", "sm"), "AI Chat");

const renderFilterbar = () =>
  _.div(
    { class: "tl-flow-filterbar" },
    renderFileMenu(),
    renderSelect("tl-flow-select", filterModel("channel"), channelOptions()),
    renderSelect("tl-flow-select is-small", filterModel("type"), typeOptions()),
    renderSelect("tl-flow-select is-small", filterModel("origin"), [
      { value: "all", label: "Runtime origins" },
      { value: "runtime", label: "Runtime" },
    ]),
    renderSelect("tl-flow-select is-small", filterModel("state"), [
      { value: "all", label: "All states" },
      { value: "configured", label: "Configured" },
      { value: "draft", label: "Draft" },
    ]),
    renderSelect("tl-flow-select is-small", filterModel("activity"), [
      { value: "all", label: "All activity" },
      { value: "live", label: "Live only" },
      { value: "errors", label: "Errors only" },
    ]),
    renderSelect("tl-flow-select is-small", filterModel("eventType"), eventTypeOptions()),
    hasActiveFilters() ? btn({ class: "is-ghost is-filter-reset", onclick: resetFilters }, icon("filter_alt_off", "sm"), "Reset") : null
  );

const renderControls = () =>
  _.div(
    { class: `tl-flow-controls${state.debugMode ? " is-debug" : ""}` },
    btn({ "aria-label": "Select" }, icon("near_me", "sm")),
    btn({ "aria-label": "Fit view", onclick: fitVisibleGraph }, icon("fit_screen", "sm")),
    btn({
      "aria-label": state.debugMode ? "Disable debug mode" : "Enable debug mode",
      title: state.debugMode ? "Disable debug mode" : "Enable debug mode",
      class: state.debugMode ? "is-active" : "",
      onclick: () => {
        state.debugMode = !state.debugMode;
        localStorage.setItem("tl_flow_debug_mode", String(state.debugMode));
        mount({ preserveScroll: true });
      },
    }, icon("bug_report", "sm")),
    btn({ "aria-label": "Zoom out", onclick: () => setZoom(-0.1) }, icon("remove", "sm")),
    _.span({ "data-flow-zoom-label": "true" }, `${Math.round(state.viewport.zoom * 100)}%`),
    btn({ "aria-label": "Zoom in", onclick: () => setZoom(0.1) }, icon("add", "sm")),
    btn({ "aria-label": "Reset view", onclick: resetViewport }, icon("grid_view", "sm"))
  );

const edgePortOffset = (dependency, dependencies = []) => {
  const siblings = dependencies.filter((item) =>
    item.sourceNodeId === dependency.sourceNodeId ||
    item.targetNodeId === dependency.targetNodeId);
  if (siblings.length <= 1) return 0;
  const index = siblings.findIndex((item) => item.id === dependency.id);
  const centered = index - ((siblings.length - 1) / 2);
  return Math.max(-18, Math.min(18, centered * 9));
};

const dependencyPort = (dependency = {}, side = "out") =>
  side === "in" ? dependency.metadata?.targetPort || dependency.targetPort || dependency.channel : dependency.metadata?.sourcePort || dependency.sourcePort || dependency.channel;

const dependencySourcePort = (dependency = {}) =>
  dependency.metadata?.sourcePort || dependency.sourcePort || "all";

const edgeDisplayLabel = (dependency = {}) => {
  const sourcePort = dependencySourcePort(dependency);
  return sourcePort && sourcePort !== "all" ? sourcePort : dependency.channel || "all";
};

const isAllEdge = (dependency = {}) =>
  dependencySourcePort(dependency) === "all";

const isAgentControlEdge = (dependency = {}) =>
  dependency.metadata?.linkType === AGENT_CONTROL_PORT_TYPE ||
  dependencyPort(dependency, "out") === AGENT_CONTROL_PORT_NAME ||
  dependencyPort(dependency, "in") === AGENT_CONTROL_PORT_NAME;

const isAgentBridgeNode = (node = {}) =>
  nodeSubtype(node) === "agent-bridge";

const edgeRecentEvent = (dependency = {}) =>
  filteredRuntimeEvents()
    .filter((event) => {
      const created = Date.parse(event.createdAt || "");
      if (!Number.isFinite(created) || Date.now() - created > EDGE_ACTIVITY_WINDOW_MS) return false;
      if (event.meta?.dependencyId && event.meta.dependencyId === dependency.id) return true;
      if (event.sourceNodeId === dependency.sourceNodeId) return !event.channel || event.channel === dependency.channel;
      if (event.targetNodeId === dependency.targetNodeId) return !event.channel || event.channel === dependency.channel;
      return false;
    })
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] || null;

const edgeDebugTitle = (dependency = {}) => {
  const event = edgeRecentEvent(dependency);
  const parts = [
    edgeDisplayLabel(dependency),
    dependency.channel || "runtime",
    event?.eventType ? `${event.eventType} ${formatShortDate(event.createdAt)}` : "",
    event?.payloadPreview || "",
  ].filter(Boolean);
  return parts.join(" · ");
};

const edgeMatchesHover = (dependency = {}) => {
  if (!state.hoverNodeId) return true;
  const nodeMatch = dependency.sourceNodeId === state.hoverNodeId || dependency.targetNodeId === state.hoverNodeId;
  if (!nodeMatch) return false;
  if (!state.hoverPortKey) return true;
  const [side, portName] = state.hoverPortKey.split(":");
  return side === "out"
    ? dependency.sourceNodeId === state.hoverNodeId && dependencyPort(dependency, "out") === portName
    : dependency.targetNodeId === state.hoverNodeId && dependencyPort(dependency, "in") === portName;
};

const isPortConnected = (graph, nodeId = "", side = "out", portName = "") =>
  Boolean(graph?.dependencies?.some((dependency) =>
    side === "in"
      ? dependency.targetNodeId === nodeId && dependencyPort(dependency, "in") === portName
      : dependency.sourceNodeId === nodeId && dependencyPort(dependency, "out") === portName
  ));

const connectedPortNames = (graph, nodeId = "", side = "out") => {
  const names = new Set();
  (graph?.dependencies || []).forEach((dependency) => {
    if (side === "in" && dependency.targetNodeId === nodeId) names.add(dependencyPort(dependency, "in"));
    if (side === "out" && dependency.sourceNodeId === nodeId) names.add(dependencyPort(dependency, "out"));
  });
  return names;
};

const portUiSide = (side = "in") => side === "out" ? "out" : "in";

const portUiForNode = (node = {}, side = "in") => {
  const ui = node.metadata?.portUi || {};
  const section = ui[portUiSide(side)] || {};
  return {
    order: Array.isArray(section.order) ? section.order.filter(Boolean).map(String) : [],
    hidden: Array.isArray(section.hidden) ? section.hidden.filter(Boolean).map(String) : [],
  };
};

const orderedNodePorts = (node = {}, side = "in", ports = nodePorts(node, side)) => {
  const ui = portUiForNode(node, side);
  const order = new Map(ui.order.map((name, index) => [name, index]));
  return [...ports].sort((a, b) => {
    const aIndex = order.has(a.name) ? order.get(a.name) : Number.MAX_SAFE_INTEGER;
    const bIndex = order.has(b.name) ? order.get(b.name) : Number.MAX_SAFE_INTEGER;
    if (aIndex !== bIndex) return aIndex - bIndex;
    return ports.findIndex((port) => port.name === a.name) - ports.findIndex((port) => port.name === b.name);
  });
};

const visibleNodePorts = (node = {}, side = "out", ports = [], graph = {}) => {
  const ordered = orderedNodePorts(node, side, ports);
  const connected = connectedPortNames(graph, node.id, side);
  const hidden = new Set(portUiForNode(node, side).hidden);
  const eligible = ordered.filter((port) => isAgentControlPort(port) || connected.has(port.name) || !hidden.has(port.name));
  if (!node?.metadata?.collapsed || eligible.length <= 8) return eligible;
  const visible = eligible.filter((port) => isAgentControlPort(port) || port.name === "all" || connected.has(port.name));
  if (visible.length > 1) return visible;
  return eligible.slice(0, Math.min(3, eligible.length));
};

const nodePortYValue = (portIndex = 0, portCount = 1) => {
  if (portCount <= 1) return 50;
  if (portCount === 2) return portIndex === 0 ? 38 : 58;
  if (portCount === 3) return 28 + (portIndex * 21);
  if (portIndex === 0) return 24;
  const itemIndex = portIndex - 1;
  const itemCount = Math.max(1, portCount - 2);
  const start = portCount <= 8 ? 38 : 34;
  const span = portCount <= 8 ? 46 : 58;
  return start + ((itemIndex / itemCount) * span);
};

const nodePortY = (portIndex = 0, portCount = 1) => {
  if (portCount > 8) return `${portIndex === 0 ? 84 : 126 + ((portIndex - 1) * 16)}px`;
  return `${nodePortYValue(portIndex, portCount)}%`;
};

const bridgeNodePortY = (side = "out", portIndex = 0, portCount = 1) => {
  if (side === "in") return "50%";
  if (portCount === 2) return portIndex === 0 ? "20%" : "80%";
  return nodePortY(portIndex, portCount);
};

const bridgePortY = (port = {}, side = "out", portIndex = 0, portCount = 1) => {
  if (side === "in" && isAgentControlPort(port)) return "50%";
  if (side === "in" && port.name === "listening") return "80%";
  if (side === "out" && port.name === "action") return "20%";
  return bridgeNodePortY(side, portIndex, portCount);
};

const runtimeNodePortY = (node = {}, port = {}, side = "out", portIndex = 0, portCount = 1) => {
  if (isAgentBridgeNode(node)) return bridgePortY(port, side, portIndex, portCount);
  if (isAgentControlPort(port)) return "25px";
  return nodePortY(portIndex, portCount);
};

const nodeMinHeight = (portCount = 1) =>
  Math.max(138, portCount > 8 ? portCount * 16 + 170 : portCount * 16 + 82);

const portPercentForChannel = (node = {}, channel = "", side = "out") => {
  const ports = nodePortLabels(node, side === "in" ? "in" : "out");
  const index = Math.max(0, ports.findIndex((item) => item === channel));
  const count = Math.max(1, ports.length);
  return nodePortYValue(index, count);
};

const domPortPoint = (nodeId = "", side = "out", port = "") => {
  const host = document.querySelector(".tl-flow-canvas");
  const selector = `[data-flow-node-id="${escapeSelectorValue(nodeId)}"] .tl-flow-node-port[data-port-side="${side}"][data-port-label="${escapeSelectorValue(port || "all")}"]`;
  const element = document.querySelector(selector) ||
    document.querySelector(`[data-flow-node-id="${escapeSelectorValue(nodeId)}"] .tl-flow-node-port[data-port-side="${side}"]`);
  const hostRect = host?.getBoundingClientRect?.();
  const portRect = element?.getBoundingClientRect?.();
  if (!hostRect || !portRect) return null;
  const zoom = state.viewport.zoom || 1;
  return {
    x: (portRect.left + portRect.width / 2 - hostRect.left - state.viewport.panX) / zoom,
    y: (portRect.top + portRect.height / 2 - hostRect.top - state.viewport.panY) / zoom,
  };
};

const edgeCanvasBounds = () => {
  const host = document.querySelector(".tl-flow-canvas");
  const rect = host?.getBoundingClientRect?.();
  if (!rect) return null;
  const paddingX = rect.width * 2.1;
  const paddingY = rect.height * 2.1;
  return {
    width: Math.max(1, Math.round(rect.width + paddingX * 2)),
    height: Math.max(1, Math.round(rect.height + paddingY * 2)),
    offsetX: Math.round(paddingX),
    offsetY: Math.round(paddingY),
    rect,
  };
};

const edgePoint = (point = {}, bounds = { offsetX: 0, offsetY: 0 }) => ({
  x: point.x + bounds.offsetX,
  y: point.y + bounds.offsetY,
});

const canvasPoint = (canvas, position, side = "out", offsetY = 0, portPercent = 50) => {
  const x = parseFloat(position.x) + (side === "out" ? 16.5 : 0);
  const y = parseFloat(position.y) + ((portPercent / 100) * 9.6);
  return {
    x: (x / 100) * canvas.width,
    y: (y / 100) * canvas.height + offsetY,
  };
};

const nodeCanvasPoint = ({ canvas, node, index, side = "out", port = "all" }) =>
  (() => {
    const point = domPortPoint(node.id, side, port);
    return point ? point : canvasPoint(canvas, nodePosition(node, index), side, 0, portPercentForChannel(node, port, side));
  })();

const drawBezier = (ctx, from, to, curveOffset = 0, options = {}) => {
  const delta = Math.max(70, Math.abs(to.x - from.x) * 0.42);
  const targetControlX = options.targetSide === "right" ? to.x + delta : to.x - delta;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.bezierCurveTo(from.x + delta, from.y + curveOffset, targetControlX, to.y + curveOffset, to.x, to.y);
};

const bezierPoint = (from, to, t, curveOffset = 0, options = {}) => {
  const delta = Math.max(70, Math.abs(to.x - from.x) * 0.42);
  const p0 = from;
  const p1 = { x: from.x + delta, y: from.y + curveOffset };
  const p2 = { x: options.targetSide === "right" ? to.x + delta : to.x - delta, y: to.y + curveOffset };
  const p3 = to;
  const mt = 1 - t;
  return {
    x: (mt ** 3) * p0.x + 3 * (mt ** 2) * t * p1.x + 3 * mt * (t ** 2) * p2.x + (t ** 3) * p3.x,
    y: (mt ** 3) * p0.y + 3 * (mt ** 2) * t * p1.y + 3 * mt * (t ** 2) * p2.y + (t ** 3) * p3.y,
  };
};

const edgeBezierOptions = (dependency = {}, targetNode = {}) =>
  isAgentBridgeNode(targetNode) && dependencyPort(dependency, "in") === "listening"
    ? { targetSide: "right" }
    : {};

const distanceToSegment = (point, a, b) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (!lengthSq) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
};

const edgeCanvasPointFromEvent = (event) => {
  const host = document.querySelector(".tl-flow-canvas");
  if (!host) return null;
  const rect = host.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left - state.viewport.panX) / state.viewport.zoom + (edgeCanvasBounds()?.offsetX || 0),
    y: (event.clientY - rect.top - state.viewport.panY) / state.viewport.zoom + (edgeCanvasBounds()?.offsetY || 0),
  };
};

const edgeAtPointer = (event) => {
  const point = edgeCanvasPointFromEvent(event);
  if (!point) return null;
  const graph = state.edgeRender.graph || { nodes: [], dependencies: [] };
  let best = { dependency: null, distance: Infinity };

  graph.dependencies.forEach((dependency) => {
    const fromIndex = graph.nodes.findIndex((node) => node.id === dependency.sourceNodeId);
    const toIndex = graph.nodes.findIndex((node) => node.id === dependency.targetNodeId);
    if (fromIndex < 0 || toIndex < 0) return;
    const sourceNode = graph.nodes[fromIndex];
    const targetNode = graph.nodes[toIndex];
    const host = document.querySelector(".tl-flow-canvas");
    const rect = host?.getBoundingClientRect();
    const bounds = edgeCanvasBounds();
    if (!rect || !bounds) return;
    const offset = edgePortOffset(dependency, graph.dependencies);
    const from = edgePoint(nodeCanvasPoint({ canvas: { width: rect.width, height: rect.height }, node: sourceNode, index: fromIndex, side: "out", port: dependencyPort(dependency, "out") }), bounds);
    const to = edgePoint(nodeCanvasPoint({ canvas: { width: rect.width, height: rect.height }, node: targetNode, index: toIndex, side: "in", port: dependencyPort(dependency, "in") }), bounds);
    const bezierOptions = edgeBezierOptions(dependency, targetNode);
    let previous = from;
    for (let step = 1; step <= 24; step += 1) {
      const current = bezierPoint(from, to, step / 24, offset, bezierOptions);
      const distance = distanceToSegment(point, previous, current);
      if (distance < best.distance) best = { dependency, distance };
      previous = current;
    }
  });

  return best.distance <= 10 ? best.dependency : null;
};

const animateFlowEdges = () => {
  state.edgeAnimation = 0;
  state.edgePhase = (state.edgePhase + 0.9) % 64;
  drawFlowEdges();
};

const drawFlowEdges = () => {
  const canvas = document.querySelector(".tl-flow-edge-canvas");
  const host = document.querySelector(".tl-flow-canvas");
  if (!canvas || !host) return;

  const bounds = edgeCanvasBounds();
  const rect = bounds?.rect;
  if (!bounds || !rect) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
  const width = bounds.width;
  const height = bounds.height;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.left = `${-bounds.offsetX}px`;
    canvas.style.top = `${-bounds.offsetY}px`;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const graph = state.edgeRender.graph || { nodes: [], dependencies: [] };
  const activity = state.edgeRender.activity || { edgeActivity: new Map() };
  const processingEdgeIds = new Set(activeProcessingEdgeIds(graph));
  let hasLiveEdge = false;
  graph.dependencies.forEach((dependency) => {
    const fromIndex = graph.nodes.findIndex((node) => node.id === dependency.sourceNodeId);
    const toIndex = graph.nodes.findIndex((node) => node.id === dependency.targetNodeId);
    if (fromIndex < 0 || toIndex < 0) return;

    const sourceNode = graph.nodes[fromIndex];
    const targetNode = graph.nodes[toIndex];
    const offset = edgePortOffset(dependency, graph.dependencies);
    const from = edgePoint(nodeCanvasPoint({ canvas: { width: rect.width, height: rect.height }, node: sourceNode, index: fromIndex, side: "out", port: dependencyPort(dependency, "out") }), bounds);
    const to = edgePoint(nodeCanvasPoint({ canvas: { width: rect.width, height: rect.height }, node: targetNode, index: toIndex, side: "in", port: dependencyPort(dependency, "in") }), bounds);
    const bezierOptions = edgeBezierOptions(dependency, targetNode);
    const edge = activity.edgeActivity?.get?.(dependency.id);
    const isActiveTestEdge = state.testRun.running && (state.testRun.activeEdgeIds || []).includes(dependency.id);
    const isProcessingEdge = processingEdgeIds.has(dependency.id);
    const isError = edge?.status === "error";
    const isLive = Boolean(edge) || isActiveTestEdge || isProcessingEdge;
    const isSelected = state.focus.edgeId === dependency.id;
    const isBus = isAllEdge(dependency);
    const isAgentControl = isAgentControlEdge(dependency);
    const isDimmed = state.hoverNodeId && !edgeMatchesHover(dependency);
    if (isLive) hasLiveEdge = true;
    const rgb = isError ? toneRgb("red") : isAgentControl ? toneRgb("cyan") : toneRgb(graphTone(sourceNode));

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    drawBezier(ctx, from, to, offset, bezierOptions);
    ctx.globalAlpha = isDimmed ? 0.18 : 1;
    ctx.strokeStyle = rgba(rgb, isSelected ? 0.42 : isLive ? 0.3 : 0.2);
    ctx.lineWidth = isSelected ? 12 : isLive ? (isBus ? 10 : 8) : (isBus ? 8 : 6);
    ctx.shadowColor = rgba(rgb, isSelected ? 0.68 : isLive ? 0.5 : 0.26);
    ctx.shadowBlur = isSelected ? 20 : isLive ? 16 : 10;
    ctx.stroke();

    if (isAgentControl) {
      [-3.4, 3.4].forEach((parallelOffset) => {
        drawBezier(ctx, { x: from.x, y: from.y + parallelOffset }, { x: to.x, y: to.y + parallelOffset }, offset, bezierOptions);
        ctx.strokeStyle = rgba(rgb, isError ? 0.96 : 0.9);
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.shadowBlur = 0;
        ctx.setLineDash(isLive ? [12, 10] : []);
        ctx.lineDashOffset = isLive ? -state.edgePhase : 0;
        ctx.stroke();
      });
    } else {
      drawBezier(ctx, from, to, offset, bezierOptions);
      ctx.strokeStyle = rgba(rgb, isError ? 0.96 : 0.86);
      ctx.lineWidth = isSelected ? 4 : isBus ? 3 : 2;
      ctx.shadowBlur = 0;
      ctx.setLineDash(dependency.metadata?.virtual ? [8, 7] : isLive ? [12, 10] : []);
      ctx.lineDashOffset = isLive ? -state.edgePhase : 0;
      ctx.stroke();
    }
    ctx.setLineDash([]);

    ctx.fillStyle = rgba(rgb, 1);
    ctx.strokeStyle = "rgba(3, 9, 14, 0.95)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(from.x, from.y, isBus ? 5.8 : 4.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(to.x, to.y, 4.2, 0, Math.PI * 2);
    ctx.fillStyle = rgba(rgb, 0.86);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  });

  if (state.interaction?.type === "link") {
    const sourceIndex = graph.nodes.findIndex((node) => node.id === state.interaction.sourceId);
    const sourceNode = graph.nodes[sourceIndex];
    if (sourceNode && state.interaction.point) {
      const from = edgePoint(nodeCanvasPoint({ canvas: { width: rect.width, height: rect.height }, node: sourceNode, index: sourceIndex, side: "out", port: state.interaction.sourcePort || outputPortLabel(sourceNode) }), bounds);
      const to = {
        x: (state.interaction.point.x / 100) * rect.width + bounds.offsetX,
        y: (state.interaction.point.y / 100) * rect.height + bounds.offsetY,
      };
      const rgb = toneRgb(graphTone(sourceNode));
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      drawBezier(ctx, from, to);
      ctx.strokeStyle = rgba(rgb, 0.28);
      ctx.lineWidth = 8;
      ctx.shadowColor = rgba(rgb, 0.42);
      ctx.shadowBlur = 18;
      ctx.stroke();
      drawBezier(ctx, from, to);
      ctx.strokeStyle = rgba(rgb, 0.92);
      ctx.lineWidth = 2;
      ctx.shadowBlur = 0;
      ctx.setLineDash([10, 8]);
      ctx.lineDashOffset = -state.edgePhase;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = rgba(rgb, 1);
      ctx.strokeStyle = "rgba(3, 9, 14, 0.95)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(from.x, from.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(to.x, to.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      hasLiveEdge = true;
    }
  }

  if (hasLiveEdge && !state.edgeAnimation) {
    state.edgeAnimation = requestAnimationFrame(animateFlowEdges);
  } else if (!hasLiveEdge && state.edgeAnimation) {
    cancelAnimationFrame(state.edgeAnimation);
    state.edgeAnimation = 0;
  }
};

const positionEdgeLabels = () => {
  const host = document.querySelector(".tl-flow-canvas");
  const rect = host?.getBoundingClientRect?.();
  const bounds = edgeCanvasBounds();
  const graph = state.edgeRender.graph || { nodes: [], dependencies: [] };
  if (!rect || !bounds) return;

  graph.dependencies.forEach((dependency) => {
    const label = document.querySelector(`.tl-flow-edge-label[data-edge-id="${escapeSelectorValue(dependency.id)}"]`);
    if (!label) return;
    const fromIndex = graph.nodes.findIndex((node) => node.id === dependency.sourceNodeId);
    const toIndex = graph.nodes.findIndex((node) => node.id === dependency.targetNodeId);
    if (fromIndex < 0 || toIndex < 0) return;
    const sourceNode = graph.nodes[fromIndex];
    const targetNode = graph.nodes[toIndex];
    const offset = edgePortOffset(dependency, graph.dependencies);
    const from = nodeCanvasPoint({ canvas: { width: rect.width, height: rect.height }, node: sourceNode, index: fromIndex, side: "out", port: dependencyPort(dependency, "out") });
    const to = nodeCanvasPoint({ canvas: { width: rect.width, height: rect.height }, node: targetNode, index: toIndex, side: "in", port: dependencyPort(dependency, "in") });
    const midpoint = bezierPoint(from, to, 0.52, offset, edgeBezierOptions(dependency, targetNode));
    label.style.setProperty("--x", `${midpoint.x}px`);
    label.style.setProperty("--y", `${midpoint.y}px`);
    label.classList.toggle("is-related", Boolean(state.hoverNodeId && edgeMatchesHover(dependency)));
    label.classList.toggle("is-dimmed", Boolean(state.hoverNodeId && !edgeMatchesHover(dependency)));
  });
};

const renderFlowEdges = () => {
  drawFlowEdges();
  positionEdgeLabels();
};

const nodeRuntimeBanner = (node = {}, live = null) => {
  if (!live || nodeCategory(node) !== "ai-agents") return null;
  const status = String(live.status || "").toLowerCase();
  const phase = String(live.phase || "").toLowerCase();
  const isOrchestrator = nodeSubtype(node) === "orchestrator";
  if (status === "complete") {
    const completedAt = Date.parse(live.lastAt || 0);
    if (completedAt && Date.now() - completedAt > 5000) return null;
    return { tone: "complete", icon: "check_circle", label: "Task complete" };
  }
  if (status !== "orchestrating" && status !== "busy") return null;
  if (phase === "planning") return { tone: "planning", icon: "hub", label: isOrchestrator ? "Planning route" : "Planning" };
  if (phase === "waiting") return { tone: "waiting", icon: isOrchestrator ? "hub" : "psychology", label: live.targetLabel ? `Waiting for ${live.targetLabel}` : "Waiting for AI" };
  if (phase === "executing" || phase === "run_node") return { tone: "executing", icon: "bolt", label: live.targetLabel ? `Running ${live.targetLabel}` : "Running node" };
  if (phase === "sending" || phase === "send_result") return { tone: "sending", icon: "send", label: live.targetLabel ? `Sending to ${live.targetLabel}` : "Sending result" };
  return { tone: "thinking", icon: isOrchestrator ? "hub" : "psychology", label: isOrchestrator ? "Orchestrating" : "Thinking" };
};

const renderNodeRuntimeBanner = (node = {}, live = null) => {
  const banner = nodeRuntimeBanner(node, live);
  return _.div(
    {
      class: `tl-flow-node-runtime-banner${banner ? ` is-visible is-${banner.tone}` : ""}`,
      "data-flow-node-runtime-banner": node.id,
      hidden: !banner,
    },
    banner ? icon(banner.icon, "sm") : null,
    banner ? _.strong(banner.label) : null,
    banner ? _.span({ class: "tl-flow-node-runtime-loader", "aria-hidden": "true" }) : null
  );
};

const replaceRenderedNode = (selector, nextNode, { preserveScroll = false } = {}) => {
  const current = document.querySelector(selector);
  if (!current || !nextNode) return false;
  const scrollTop = preserveScroll ? current.scrollTop : 0;
  current.replaceWith(nextNode);
  if (preserveScroll) {
    const replacement = document.querySelector(selector);
    if (replacement) replacement.scrollTop = Math.min(scrollTop, replacement.scrollHeight - replacement.clientHeight);
  }
  return true;
};

const refreshNodeRuntimeDom = (graph, activity) => {
  const processingNodeIds = new Set(activeAiProcessingNodeIds());
  const ruleGraph = runtimeRuleGraph();
  (graph.nodes || []).forEach((node) => {
    const live = activity.nodeActivity?.get(node.id);
    const badges = document.querySelector(`[data-flow-node-badges="${escapeSelectorValue(node.id)}"]`);
    if (badges) {
      badges.replaceChildren(...nodeBadges(node, live).map((badge) => _.span({ class: `tl-flow-node-badge is-${badge.tone}` }, badge.label)));
    }

    const footerInfo = document.querySelector(`[data-flow-node-footer="${escapeSelectorValue(node.id)}"] [data-flow-node-footer-info]`);
    if (footerInfo) {
      const fieldCount = sampleOutputFields(node).length;
      const perf = nodePerformance(node);
      const runtimeStatus = ["busy", "queued", "overloaded"].includes(live?.status) ? live.status : "";
      footerInfo.textContent = perf
        ? `${performanceLabel(perf)} · ${perf.health || perf.status || "perf"}`
        : runtimeStatus ? `${runtimeStatus} · ${live.count} events`
          : live ? `${live.count} events · ${formatShortDate(live.lastAt)}` : fieldCount ? `${fieldCount} outputs` : node.metadata?.library ? "library" : node.status || "idle";
    }

    const runtimeBanner = document.querySelector(`[data-flow-node-runtime-banner="${escapeSelectorValue(node.id)}"]`);
    if (runtimeBanner) {
      const banner = nodeRuntimeBanner(node, live);
      runtimeBanner.hidden = !banner;
      runtimeBanner.className = `tl-flow-node-runtime-banner${banner ? ` is-visible is-${banner.tone}` : ""}`;
      runtimeBanner.replaceChildren(
        banner ? icon(banner.icon, "sm") : null,
        banner ? _.strong(banner.label) : null,
        banner ? _.span({ class: "tl-flow-node-runtime-loader", "aria-hidden": "true" }) : null
      );
    }

    if (isPreviewNode(node)) {
      replaceRenderedNode(`[data-flow-preview-panel="${escapeSelectorValue(node.id)}"]`, renderPreviewNodePanel(node), { preserveScroll: true });
    }

    const testButton = document.querySelector(`[data-flow-node-test-btn="${escapeSelectorValue(node.id)}"]`);
    if (testButton) {
      const busy = processingNodeIds.has(node.id) || (state.testRun.running && (state.testRun.activeNodeIds || []).includes(node.id));
      const rootBlocked = isLiveTestableStarterNode(node) && !isRootRuntimeNode(node, ruleGraph);
      testButton.dataset.rootBlocked = rootBlocked ? "true" : "false";
      testButton.title = rootBlocked
        ? rootStartBlockedReason(node, ruleGraph)
        : "Run real one-shot live test from this root node through connected children";
      testButton.classList.toggle("is-running", busy);
      testButton.disabled = rootBlocked || state.testRun.running || processingNodeIds.has(node.id);
      testButton.replaceChildren(icon(busy ? "hourglass_top" : "play_arrow", "sm"));
    }
  });
};

const refreshInspectorRuntimeDom = () => {
  const status = document.querySelector("[data-flow-inspector-status]");
  if (!status) return;

  const edge = selectedEdge();
  if (edge) {
    status.replaceChildren(dot(), edge.status || "active");
    return;
  }

  const node = selectedNode();
  if (!node) return;
  status.replaceChildren(dot(), isDraftNode(node) ? "draft" : node.status || "active");
};

const refreshStatusBarDom = ({ preserveScroll = false } = {}) => {
  statusItems().forEach((item) => {
    const button = document.querySelector(`[data-status-item="${escapeSelectorValue(item.id)}"]`);
    if (!button) return;
    button.title = item.title;
    button.className = `tl-flow-statusbar-btn${item.tone ? ` is-${item.tone}` : ""}${state.activeStatusPanel === item.id ? " is-active" : ""}`;
    const label = button.querySelector("[data-status-label]");
    if (label) label.textContent = item.label;
  });

  const updated = document.querySelector("[data-flow-status-updated]");
  if (updated) {
    updated.textContent = state.liveBus.lastAt ? `Live ${formatShortDate(state.liveBus.lastAt)}` : `Updated ${formatShortDate(state.updatedAt)}`;
  }

  if (state.activeStatusPanel) {
    replaceRenderedNode(".tl-flow-status-popover", renderStatusPopover(), { preserveScroll });
  }
};

const refreshRuntimeDom = ({ preserveScroll = false } = {}) => {
  syncReactiveState();
  const baseGraph = graphModel();
  const activity = recentActivity(baseGraph);
  const graph = filterByActivity(baseGraph, activity);
  state.edgeRender = { graph, activity };

  refreshLiveBusDom();
  updateLiveClasses(graph, activity);
  refreshNodeRuntimeDom(graph, activity);
  refreshInspectorRuntimeDom();
  refreshStatusBarDom({ preserveScroll });
  requestAnimationFrame(() => {
    refreshLiveBusDom();
    renderFlowEdges();
  });
};

const renderNodeQuickActions = (node, view) => {
  if (!node?.id || node.metadata?.library) return null;
  const paused = view.runtime.status === "paused";
  const disabled = view.runtime.status === "disabled";
  const canDeleteRuntimeNode = isDraftNode(node) || isInlineConfigNode(node);
  return _.span(
    { class: "tl-flow-node-quick-actions", onPointerDown: stopNodeControlEvent, onclick: stopNodeControlEvent },
    btn({
      "aria-label": paused || disabled ? "Resume runtime" : "Pause runtime",
      title: paused || disabled ? "Resume runtime" : "Pause runtime",
      onclick: (event) => {
        event.preventDefault();
        event.stopPropagation();
        paused || disabled ? resumeNodeRuntime(node) : pauseNodeRuntime(node);
      },
    }, icon(paused || disabled ? "play_arrow" : "pause", "sm")),
    btn({
      "aria-label": node.metadata?.collapsed ? "Expand node" : "Collapse node",
      title: node.metadata?.collapsed ? "Expand node" : "Collapse node",
      onclick: (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleNodeCollapse(node);
      },
    }, icon(node.metadata?.collapsed ? "unfold_more" : "unfold_less", "sm")),
    btn({
      "aria-label": "Duplicate node",
      title: "Duplicate node",
      onclick: (event) => {
        event.preventDefault();
        event.stopPropagation();
        duplicateRuntimeNode(node);
      },
    }, icon("content_copy", "sm")),
    btn({
      "aria-label": "Rename node",
      title: "Rename node",
      onclick: (event) => {
        event.preventDefault();
        event.stopPropagation();
        requestNodeRename(node);
      },
    }, icon("drive_file_rename_outline", "sm")),
    btn({
      "aria-label": disabled ? "Enable runtime" : "Disable runtime",
      title: disabled ? "Enable runtime" : "Disable runtime",
      onclick: (event) => {
        event.preventDefault();
        event.stopPropagation();
        disabled ? resumeNodeRuntime(node) : disableNodeRuntime(node);
      },
    }, icon(disabled ? "power_settings_new" : "block", "sm")),
    canDeleteRuntimeNode ? btn({
      class: "is-danger",
      "aria-label": "Delete node",
      title: "Delete node. Ctrl+click deletes immediately.",
      onclick: (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.ctrlKey) performDraftNodeDelete(node);
        else requestDraftNodeDelete(node);
      },
    }, icon("delete", "sm")) : null
  );
};

const renderNodeContextMenu = () => {
  const menu = state.contextMenu;
  if (!menu || menu.type !== "node") return null;
  const node = nodeById(menu.nodeId);
  if (!node) return null;
  const view = runtimeNodeBase(node, recentActivity(graphModel()).nodeActivity?.get(node.id), nodePerformance(node));
  const disabled = view.runtime.status === "disabled";
  const paused = view.runtime.status === "paused";
  const canDelete = isDraftNode(node) || (isInlineConfigNode(node) && !node.metadata?.library);
  const item = (action, iconName, label, options = {}) => _.button(
    {
      type: "button",
      class: `tl-flow-context-item${options.danger ? " is-danger" : ""}`,
      disabled: Boolean(options.disabled),
      onclick: () => runNodeContextAction(action, node),
    },
    icon(iconName, "sm"),
    _.span(label)
  );
  return _.div(
    {
      class: "tl-flow-context-backdrop",
      onclick: () => {
        closeContextMenu();
        mount({ preserveScroll: true });
      },
      oncontextmenu: (event) => {
        event.preventDefault();
        closeContextMenu();
        mount({ preserveScroll: true });
      },
    },
    _.div(
      {
        class: "tl-flow-context-menu",
        style: { "--context-x": `${menu.x}px`, "--context-y": `${menu.y}px` },
        onclick: (event) => event.stopPropagation(),
      },
      _.div(
        { class: "tl-flow-context-head" },
        _.strong(node.label || node.id),
        _.span(`${view.category} · ${view.runtime.status}`)
      ),
      item("edit", node.type === "boxTracker" || node.type === "boxLens" ? "open_in_new" : "settings", "Edit"),
      item("rename", "drive_file_rename_outline", "Rename"),
      item("duplicate", "content_copy", "Duplicate"),
      item("pause", paused || disabled ? "play_arrow" : "pause", paused || disabled ? "Resume Runtime" : "Pause Runtime"),
      item("disable", disabled ? "power_settings_new" : "block", disabled ? "Enable Runtime" : "Disable Runtime"),
      item("collapse", node.metadata?.collapsed ? "unfold_more" : "unfold_less", node.metadata?.collapsed ? "Expand Node" : "Collapse Node"),
      item("logs", "subject", "View Logs"),
      _.span({ class: "tl-flow-context-separator" }),
      item("delete", "delete", isDraftNode(node) ? "Delete Draft" : "Delete Node", { danger: true, disabled: !canDelete })
    )
  );
};

const isLargeGraphModel = (graph = {}) =>
  (graph.nodes || []).length > 80 || (graph.dependencies || []).length > 160;

const lazyVisibleNodes = (graph = {}, activity = {}) => {
  const nodes = graph.nodes || [];
  if (!isLargeGraphModel(graph)) return nodes;
  const width = window.innerWidth || 1440;
  const height = window.innerHeight || 900;
  const zoom = Math.max(0.1, Number(state.viewport.zoom) || 1);
  const selected = new Set([
    state.focus.nodeId,
    ...(state.testRun.activeNodeIds || []),
    ...Array.from(activity.nodeActivity?.keys?.() || []),
  ].filter(Boolean));
  const visible = nodes.filter((node, index) => {
    if (selected.has(node.id)) return true;
    const pos = nodePosition(node, index);
    const x = state.viewport.panX + (pos.x / 100) * 2600 * zoom;
    const y = state.viewport.panY + (pos.y / 100) * 1800 * zoom;
    return x > -360 && x < width + 360 && y > -260 && y < height + 320;
  });
  return visible.length ? visible.slice(0, 180) : nodes.slice(0, 100);
};

const lazyVisibleGraph = (graph = {}, activity = {}) => {
  if (!isLargeGraphModel(graph)) return { ...graph, renderedNodes: graph.nodes || [], renderedDependencies: graph.dependencies || [], hiddenNodes: 0, hiddenDependencies: 0 };
  const renderedNodes = lazyVisibleNodes(graph, activity);
  const ids = new Set(renderedNodes.map((node) => node.id));
  const renderedDependencies = (graph.dependencies || []).filter((dependency) => ids.has(dependency.sourceNodeId) && ids.has(dependency.targetNodeId));
  return {
    ...graph,
    renderedNodes,
    renderedDependencies,
    hiddenNodes: Math.max(0, (graph.nodes || []).length - renderedNodes.length),
    hiddenDependencies: Math.max(0, (graph.dependencies || []).length - renderedDependencies.length),
  };
};

const minimapViewportBounds = (rect = { width: 1440, height: 900 }) => {
  const zoom = Math.max(0.1, Number(state.viewport.zoom) || 1);
  const width = Math.max(1, rect.width || 1440);
  const height = Math.max(1, rect.height || 900);
  return {
    minX: ((-state.viewport.panX) / zoom / width) * 100,
    minY: ((-state.viewport.panY) / zoom / height) * 100,
    maxX: ((width - state.viewport.panX) / zoom / width) * 100,
    maxY: ((height - state.viewport.panY) / zoom / height) * 100,
  };
};

const minimapGraphFrame = (graph = {}, rect = { width: 1440, height: 900 }) => {
  const viewport = minimapViewportBounds(rect);
  const positions = (graph.nodes || []).map((node, index) => {
    const pos = nodePosition(node, index);
    return {
      node,
      index,
      x: Number(parseFloat(pos.x)) || 0,
      y: Number(parseFloat(pos.y)) || 0,
    };
  });
  const seed = positions.length
    ? positions.reduce((acc, item) => ({
      minX: Math.min(acc.minX, item.x),
      minY: Math.min(acc.minY, item.y),
      maxX: Math.max(acc.maxX, item.x),
      maxY: Math.max(acc.maxY, item.y),
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity })
    : { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const viewportSpanX = Math.max(1, viewport.maxX - viewport.minX);
  const viewportSpanY = Math.max(1, viewport.maxY - viewport.minY);
  const graphSpanX = Math.max(1, seed.maxX - seed.minX);
  const graphSpanY = Math.max(1, seed.maxY - seed.minY);
  const padX = Math.max(viewportSpanX / 2, Math.min(8, graphSpanX * 0.08));
  const padY = Math.max(viewportSpanY / 2, Math.min(8, graphSpanY * 0.08));
  const bounds = {
    minX: seed.minX - padX,
    minY: seed.minY - padY,
    maxX: seed.maxX + padX,
    maxY: seed.maxY + padY,
  };
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);
  const mapX = (x) => Math.max(0, Math.min(100, ((x - bounds.minX) / spanX) * 100));
  const mapY = (y) => Math.max(0, Math.min(100, ((y - bounds.minY) / spanY) * 100));
  const unmapX = (x) => bounds.minX + (Math.max(0, Math.min(100, x)) / 100) * spanX;
  const unmapY = (y) => bounds.minY + (Math.max(0, Math.min(100, y)) / 100) * spanY;
  return { viewport, positions, mapX, mapY, unmapX, unmapY };
};

const minimapViewportStyle = (frame) => {
  const viewportX = frame.mapX(frame.viewport.minX);
  const viewportY = frame.mapY(frame.viewport.minY);
  return {
    x: viewportX,
    y: viewportY,
    w: Math.max(4, frame.mapX(frame.viewport.maxX) - viewportX),
    h: Math.max(4, frame.mapY(frame.viewport.maxY) - viewportY),
  };
};

const setMinimapViewportElementStyle = (element, viewport) => {
  if (!element || !viewport) return;
  element.style.setProperty("--x", `${viewport.x}%`);
  element.style.setProperty("--y", `${viewport.y}%`);
  element.style.setProperty("--w", `${viewport.w}%`);
  element.style.setProperty("--h", `${viewport.h}%`);
};

const updateFlowMinimapDom = () => {
  const minimap = document.querySelector(".tl-flow-minimap-canvas");
  const viewportElement = document.querySelector(".tl-flow-minimap-viewport");
  const host = document.querySelector(".tl-flow-canvas");
  if (!minimap || !viewportElement || !host || !(state.edgeRender.graph?.nodes || []).length) return;
  const frame = minimapGraphFrame(state.edgeRender.graph, host.getBoundingClientRect());
  setMinimapViewportElementStyle(viewportElement, minimapViewportStyle(frame));
};

const minimapCenterViewportAtPercent = (minimapPercentX = 50, minimapPercentY = 50, options = {}) => {
  const host = document.querySelector(".tl-flow-canvas");
  if (!host || !(state.edgeRender.graph?.nodes || []).length) return;
  const frame = minimapGraphFrame(state.edgeRender.graph, host.getBoundingClientRect());
  const center = options.remount === false && typeof setViewportCenterOnPercent === "function"
    ? setViewportCenterOnPercent
    : centerViewportOnPercent;
  center?.({
    x: frame.unmapX(minimapPercentX),
    y: frame.unmapY(minimapPercentY),
    zoom: state.viewport.zoom,
    remount: options.remount,
  });
};

const beginMinimapViewportDrag = (event) => {
  const canvas = event.currentTarget?.closest?.(".tl-flow-minimap-canvas");
  const viewport = event.currentTarget;
  const bounds = canvas?.getBoundingClientRect?.();
  if (!bounds?.width || !bounds?.height) return;
  event.preventDefault();
  event.stopPropagation();
  state.interaction = {
    type: "minimap",
    canvas,
    bounds,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
    viewportX: parseFloat(viewport.style.getPropertyValue("--x")) || 0,
    viewportY: parseFloat(viewport.style.getPropertyValue("--y")) || 0,
    viewportW: parseFloat(viewport.style.getPropertyValue("--w")) || 0,
    viewportH: parseFloat(viewport.style.getPropertyValue("--h")) || 0,
  };
  document.addEventListener("pointermove", handlePointerMove);
  document.addEventListener("pointerup", endInteraction, { once: true });
  document.addEventListener("pointercancel", endInteraction, { once: true });
};

const toggleFlowMinimap = () => {
  state.minimapCollapsed = !state.minimapCollapsed;
  try {
    localStorage.setItem("tl_flow_minimap_collapsed", String(state.minimapCollapsed));
  } catch (_) {
    // localStorage may be unavailable in restricted extension contexts.
  }
  mount({ preserveScroll: true });
};

const renderFlowMinimap = (graph = {}, renderGraph = {}) => {
  if (!(graph.nodes || []).length) return null;
  const renderedIds = new Set((renderGraph.renderedNodes || []).map((node) => node.id));
  const host = document.querySelector(".tl-flow-canvas");
  const rect = host?.getBoundingClientRect?.();
  const frame = minimapGraphFrame(graph, rect || { width: 1440, height: 900 });
  const viewport = minimapViewportStyle(frame);
  return _.div(
    {
      class: `tl-flow-minimap${state.minimapCollapsed ? " is-collapsed" : ""}`,
      title: "Runtime Minimap: click to jump on the canvas",
      onpointerdown: (event) => event.stopPropagation(),
    },
    _.div({ class: "tl-flow-minimap-head" },
      _.strong("Runtime Minimap"),
      _.span(`${(graph.nodes || []).length} nodes`),
      btn({
        class: "tl-flow-minimap-toggle",
        "aria-label": state.minimapCollapsed ? "Expand minimap" : "Minimize minimap",
        title: state.minimapCollapsed ? "Expand minimap" : "Minimize minimap",
        onclick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          toggleFlowMinimap();
        },
      }, icon(state.minimapCollapsed ? "unfold_more" : "remove", "sm"))
    ),
    state.minimapCollapsed ? null : _.div(
      {
        class: "tl-flow-minimap-canvas",
        role: "button",
        tabindex: 0,
        onclick: (event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          minimapCenterViewportAtPercent(
            ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 100,
            ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * 100
          );
        },
        onkeydown: (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            centerViewportOnPercent?.({ x: frame.unmapX(50), y: frame.unmapY(50) });
          }
        },
      },
      ...frame.positions.map(({ node, index, x, y }) => {
        return _.button({
          type: "button",
          class: `tl-flow-minimap-node is-${graphTone(node)}${renderedIds.has(node.id) ? " is-visible" : ""}${state.focus.nodeId === node.id ? " is-selected" : ""}`,
          style: { "--x": `${frame.mapX(x)}%`, "--y": `${frame.mapY(y)}%` },
          title: node.label || node.id,
          "aria-label": `Center ${node.label || node.id}`,
          onclick: (event) => {
            event.preventDefault();
            event.stopPropagation();
            centerViewportOnNode?.(node, index, { select: true });
          },
        });
      }),
      _.span({
        class: "tl-flow-minimap-viewport",
        onpointerdown: beginMinimapViewportDrag,
        onclick: (event) => {
          event.preventDefault();
          event.stopPropagation();
        },
        style: {
          "--x": `${viewport.x}%`,
          "--y": `${viewport.y}%`,
          "--w": `${viewport.w}%`,
          "--h": `${viewport.h}%`,
        },
      })
    )
  );
};

const renderCanvas = () => {
  const baseGraph = graphModel();
  const activity = recentActivity(baseGraph);
  const graph = filterByActivity(baseGraph, activity);
  const ruleGraph = runtimeRuleGraph();
  const renderGraph = lazyVisibleGraph(graph, activity);
  state.edgeRender = { graph, activity };
  const impact = selectedImpact(graph);
  const validation = graphValidation();
  const largeGraph = isLargeGraphModel(graph);

  return _.section(
    { class: `tl-flow-workbench${state.debugMode ? " is-debug-mode" : ""}${largeGraph ? " is-large-graph" : ""}` },
    renderFilterbar(),
    (validation.issues || []).length ? _.div(
      { class: "tl-flow-graph-health" },
      icon(validation.ok ? "verified" : "report", "sm"),
      _.span(validation.ok ? "Graph validation OK" : `${validation.errors?.length || 0} errori · ${validation.warnings?.length || 0} warning`),
      btn({ class: "is-compact", onclick: repairGraphIssues }, icon("auto_fix_high", "sm"), "Repair")
    ) : null,
    renderControls(),
    _.div(
      { class: "tl-flow-canvas", onPointerDown: beginPan, onWheel: handleCanvasWheel, onDragOver: handleCanvasDragOver, onDrop: handleCanvasDrop },
      !graph.nodes.length ? _.div({ class: "tl-flow-empty" }, "Nessun nodo corrisponde ai filtri runtime.") : null,
      _.div(
        {
          class: "tl-flow-layer",
          style: { transform: `translate(${state.viewport.panX}px, ${state.viewport.panY}px) scale(${state.viewport.zoom})` },
        },
        _.span({ class: "tl-flow-canvas-center-marker", "aria-hidden": "true", title: "Canvas center" }),
        _.canvas({ class: "tl-flow-edge-canvas", "aria-hidden": "true" }),
        ...renderGraph.renderedDependencies.map((dependency) => {
          const fromIndex = graph.nodes.findIndex((node) => node.id === dependency.sourceNodeId);
          const toIndex = graph.nodes.findIndex((node) => node.id === dependency.targetNodeId);
          if (fromIndex < 0 || toIndex < 0 || !dependency.channel) return null;
          const sourceNode = graph.nodes[fromIndex];
          const targetNode = graph.nodes[toIndex];
          const offset = edgePortOffset(dependency, graph.dependencies);
          const host = document.querySelector(".tl-flow-canvas");
          const rect = host?.getBoundingClientRect?.();
          const from = rect
            ? nodeCanvasPoint({ canvas: { width: rect.width, height: rect.height }, node: sourceNode, index: fromIndex, side: "out", port: dependencyPort(dependency, "out") })
            : canvasPoint({ width: 100, height: 100 }, nodePosition(sourceNode, fromIndex), "out", 0, portPercentForChannel(sourceNode, dependencyPort(dependency, "out"), "out"));
          const to = rect
            ? nodeCanvasPoint({ canvas: { width: rect.width, height: rect.height }, node: targetNode, index: toIndex, side: "in", port: dependencyPort(dependency, "in") })
            : canvasPoint({ width: 100, height: 100 }, nodePosition(targetNode, toIndex), "in", 0, portPercentForChannel(targetNode, dependencyPort(dependency, "in"), "in"));
          const midpoint = bezierPoint(from, to, 0.52, rect ? offset : offset * 0.12, edgeBezierOptions(dependency, targetNode));
          const recentEvent = edgeRecentEvent(dependency);
          const activeTestEdge = state.testRun.running && (state.testRun.activeEdgeIds || []).includes(dependency.id);
          const processingEdge = activeProcessingEdgeIds(graph).includes(dependency.id);
          return _.div(
            {
              role: "button",
              tabindex: 0,
              class: `tl-flow-edge-label${state.focus.edgeId === dependency.id ? " is-selected" : ""}${impactClassForEdge(dependency, impact)}${dependency.metadata?.virtual ? " is-virtual" : ""}${isAllEdge(dependency) ? " is-bus" : ""}${isAgentControlEdge(dependency) ? " is-agent-control" : ""}${recentEvent || activeTestEdge || processingEdge ? " is-live" : ""}${recentEvent?.status === "error" ? " is-error" : ""}${activeTestEdge || processingEdge ? " is-test-path" : ""}`,
              "data-edge-id": dependency.id,
              title: edgeDebugTitle(dependency),
              style: { "--x": rect ? `${midpoint.x}px` : `${midpoint.x}%`, "--y": rect ? `${midpoint.y}px` : `${midpoint.y}%` },
              onclick: (event) => {
                event.stopPropagation();
                selectEdge(dependency);
              },
              onkeydown: (event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                event.stopPropagation();
                selectEdge(dependency);
              },
            },
            _.span({ class: "tl-flow-edge-label-text" }, edgeDisplayLabel(dependency)),
            _.button({
              type: "button",
              class: "tl-flow-edge-label-delete",
              title: "Delete link",
              "aria-label": `Delete link ${edgeDisplayLabel(dependency)}`,
              onpointerdown: (event) => {
                event.preventDefault();
                event.stopPropagation();
              },
              onmousedown: (event) => {
                event.preventDefault();
                event.stopPropagation();
              },
              onclick: (event) => {
                event.preventDefault();
                event.stopPropagation();
                requestEdgeDelete(dependency);
              },
            }, icon("delete", "sm"))
          );
        }).filter(Boolean),
        ...renderGraph.renderedNodes.map((node) => {
          const index = graph.nodes.findIndex((item) => item.id === node.id);
          const pos = nodePosition(node, index);
          const channelName = nodeChannels(node)[0] || "";
          const fullInputPorts = nodePorts(node, "in");
          const fullOutputPorts = nodePorts(node, "out");
          const inputPorts = visibleNodePorts(node, "in", fullInputPorts, graph);
          const outputPorts = visibleNodePorts(node, "out", fullOutputPorts, graph)
            .filter((port) => !isAgentControlPort(port) || nodeCategory(node) === "ai-agents");
          const portCount = Math.max(inputPorts.length, outputPorts.length);
          const fieldCount = sampleOutputFields(node).length;
          const live = activity.nodeActivity.get(node.id);
          const processingNode = activeAiProcessingNodeIds().includes(node.id);
          const perf = nodePerformance(node);
          const view = runtimeNodeBase(node, live, perf);
          const footerInfo = perf
            ? `${performanceLabel(perf)} · ${perf.health || perf.status || "perf"}`
            : live ? `${view.runtime.eventsPerMin} events · ${formatShortDate(live.lastAt)}` : fieldCount ? `${fieldCount} outputs` : node.metadata?.library ? "library" : view.runtime.status;
          const isLinkSource = state.linkingSourceId === node.id;
          const linkSource = nodeById(state.linkingSourceId);
          const isLinkTarget = Boolean(linkSource && canConnectNodes(linkSource, node));
          const isLinkHover = state.linkHoverTargetId === node.id;
          const isInTestRun = state.testRun.running && (state.testRun.activeNodeIds || []).includes(node.id);
          const canRunNodeTest = isRootLiveTestableStarterNode(node, ruleGraph);
          const blockedChildTest = isLiveTestableStarterNode(node) && !isRootRuntimeNode(node, ruleGraph);
          const testButtonTitle = canRunNodeTest
            ? "Run real one-shot live test from this root node through connected children"
            : rootStartBlockedReason(node, ruleGraph);
          const isAgentBridge = isAgentBridgeNode(node);
          return _.div(
            {
              role: "button",
              tabindex: 0,
              class: `tl-flow-node is-${graphTone(node)} is-runtime-${view.runtime.status}${isAgentBridge ? " is-agent-bridge" : ""}${node.metadata?.collapsed ? " is-collapsed" : ""}${state.frontNodeId === node.id ? " is-front" : ""}${state.focus.nodeId === node.id ? " is-selected" : ""}${impactClassForNode(node, impact)}${live || processingNode ? " is-live is-event-active" : ""}${processingNode ? " is-ai-processing" : ""}${live?.status === "orchestrating" ? " is-orchestrating" : ""}${live?.status === "complete" ? " is-task-complete" : ""}${live?.status === "error" ? " is-error" : ""}${isLinkSource ? " is-link-source" : ""}${isLinkTarget ? " is-link-target" : ""}${isLinkHover ? " is-link-hover" : ""}${isInTestRun ? " is-test-path" : ""}`,
              style: { "--x": pos.x, "--y": pos.y, "--port-count": portCount, minHeight: isAgentBridge ? "58px" : `${nodeMinHeight(portCount)}px` },
              "data-flow-node-id": node.id,
              "data-input-port-count": fullInputPorts.length,
              "data-output-port-count": fullOutputPorts.length,
              "data-runtime-status": view.runtime.status,
              "data-runtime-category": view.category,
              onPointerDown: (event) => beginNodeDrag(event, node, index),
              onPointerEnter: () => setGraphHover(node.id, ""),
              onPointerLeave: () => setGraphHover("", ""),
              oncontextmenu: (event) => openNodeContextMenu(event, node),
              onclick: () => selectNode(node),
              onkeydown: (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  selectNode(node);
                }
              },
            },
            renderNodeRuntimeBanner(node, live),
            ...inputPorts.map((port, portIndex) => _.span({
              class: `tl-flow-node-port is-input is-${port.type}${isAgentBridge && isAgentControlPort(port) ? " is-bridge-agent-input" : ""}${isAgentBridge && port.name === "listening" ? " is-bridge-right-input is-bridge-listening" : ""}${isAgentControlPort(port) ? " is-agent-control-port" : ""}${port.name === "all" ? " is-pass" : ""}${isPortConnected(graph, node.id, "in", port.name) ? " is-connected" : ""}${live ? " is-event-active" : ""}`,
              title: portTooltip(port, "in", inputPorts),
              style: { "--port-y": runtimeNodePortY(node, port, "in", portIndex, inputPorts.length) },
              "data-port-side": "in",
              "data-port-label": port.name,
              "data-port-display": portInlineLabel(port, "in", inputPorts),
              "data-port-type": port.type,
              "data-port-index": portIndex,
              onPointerEnter: (event) => {
                event.stopPropagation();
                setGraphHover(node.id, `in:${port.name}`);
              },
              onPointerLeave: () => setGraphHover(node.id, ""),
            }, ...(isAgentControlPort(port) ? [icon(isAgentBridge ? "psychology" : "network_intel_node", "sm")] : []))),
            ...outputPorts.map((port, portIndex) => _.span({
              class: `tl-flow-node-port is-output is-${port.type}${isAgentBridge && port.name === "action" ? " is-bridge-action" : ""}${isAgentControlPort(port) ? " is-agent-control-port" : ""}${port.name === "all" ? " is-pass" : ""}${isPortConnected(graph, node.id, "out", port.name) ? " is-connected" : ""}${live ? " is-event-active" : ""}`,
              title: portTooltip(port, "out", outputPorts),
              style: { "--port-y": runtimeNodePortY(node, port, "out", portIndex, outputPorts.length) },
              "data-port-side": "out",
              "data-port-label": port.name,
              "data-port-display": portInlineLabel(port, "out", outputPorts),
              "data-port-type": port.type,
              "data-port-index": portIndex,
              onPointerEnter: (event) => {
                event.stopPropagation();
                setGraphHover(node.id, `out:${port.name}`);
              },
              onPointerLeave: () => setGraphHover(node.id, ""),
              onPointerDown: (event) => beginPortLinkDrag(event, node, index, "out", port.name),
            }, ...(isAgentControlPort(port) ? [icon("network_intel_node", "sm")] : []))),
            _.span(
              { class: "tl-flow-node-title" },
              icon(graphIcon(node), "sm"),
              _.strong(view.title),
              btn({
                class: "tl-flow-node-settings",
                "aria-label": `Configure ${view.title}`,
                title: node.type === "boxTracker" ? "Open Box Tracker editor" : node.type === "boxLens" ? "Open Box Lens editor" : "Configure node",
                onPointerDown: (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                },
                onclick: (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  configureNode(node);
                },
              }, icon(node.type === "boxTracker" || node.type === "boxLens" ? "open_in_new" : "settings", "sm")),
              _.span({ class: `tl-flow-runtime-dot is-${view.runtime.status}`, title: `Runtime: ${view.runtime.status}` })
            ),
            _.span(
              { class: "tl-flow-node-badges", "data-flow-node-badges": node.id },
              ...nodeBadges(node, live).map((badge) => _.span({ class: `tl-flow-node-badge is-${badge.tone}` }, badge.label))
            ),
            isAgentBridge ? null : renderNodeQuickActions(node, view),
            node.metadata?.collapsed ? null : _.div(
              { class: "tl-flow-node-body" },
              ...(isAgentBridge
                ? [_.div(
                  { class: "tl-flow-agent-bridge-core" },
                  icon("network_node", "lg")
                )]
                : [
                  _.small({ class: "tl-flow-node-meta" }, `${view.category} · ${view.subtype} · ${channelName || "no channel"}`),
                  _.p(view.description),
                  renderInlineNodeSettings(node),
                  _.span(
                    { class: "tl-flow-node-metrics" },
                    _.em(`${view.runtime.eventsPerMin}/min`),
                    _.em(`${view.runtime.latency || 0}ms`),
                    _.em(`${view.metrics.listeners || 0} listeners`)
                  ),
                ])
            ),
            _.span(
              { class: "tl-flow-node-footer", "data-flow-node-footer": node.id },
              _.em({ "data-flow-node-footer-info": "true" }, footerInfo),
              canRunNodeTest || blockedChildTest ? btn({
                class: "tl-flow-node-test-btn",
                "data-flow-node-test-btn": node.id,
                "data-root-blocked": blockedChildTest ? "true" : "false",
                "aria-label": canRunNodeTest ? `Run live test from ${view.title}` : `${view.title} starts from parent`,
                title: testButtonTitle,
                disabled: blockedChildTest || state.testRun.running || processingNode,
                onPointerDown: (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                },
                onclick: (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (blockedChildTest) return;
                  runFlowMapLiveTest(node);
                },
              }, icon((state.testRun.running && isInTestRun) || processingNode ? "hourglass_top" : "play_arrow", "sm")) : null,
              _.span({ "data-flow-node-footer-ports": "true" }, isAgentBridge ? "1 agent · 1 in/out" : `${fullInputPorts.length} in · ${fullOutputPorts.length} out`)
            )
          );
        })
      ),
      renderFlowMinimap(graph, renderGraph)
    )
  );
};

const renderInspectorDetails = (node, channels, dependencies) => {
  const summary = dependencySummary(node, dependencies);
  const sandbox = nodeSandboxReport(node);
  return _.div(
    _.section(
      { class: "tl-flow-detail-list" },
      _.h3("General"),
      ...[
        ["ID", node.id],
        ["Workspace", node.workspaceId || "N/D"],
        ["Source ref", node.sourceRef || "N/D"],
        ["Asset", node.assetId || "N/D"],
        ["Origin", node.metadata?.library ? "Local Library" : "Runtime Graph"],
        ["Updated", formatShortDate(node.updatedAt)],
      ].map(([label, value]) => _.div(_.span(label), _.strong(value)))
    ),
    isInlineConfigNode(node) ? _.section(
      { class: "tl-flow-detail-list" },
      _.h3("Runtime Config"),
      ...[
        ["Configured", node.metadata?.configured ? "yes" : "no"],
        ["Mode", node.metadata?.mode || node.metadata?.processorType || node.metadata?.actionType || node.metadata?.agentRole || "N/D"],
        ["Subtype", nodeSubtype(node)],
        ["Runtime state", node.metadata?.runtimeStatus || node.runtime?.status || node.status || "idle"],
        ["Draft", node.metadata?.draft ? "yes" : "no"],
        ["Config", configStringValue(node) || "N/D"],
      ].map(([label, value]) => _.div(
        { class: label === "Config" ? "is-wide" : "" },
        _.span(label),
        _.strong(value)
      ))
    ) : null,
    isPreviewNode(node) ? _.section(
      { class: "tl-flow-detail-list" },
      _.h3("Preview Payload"),
      renderPreviewNodePanel(node)
    ) : null,
    _.section(
      { class: "tl-flow-detail-list" },
      _.h3("Sandbox"),
      ...[
        ["Status", sandbox.status],
        ["Errors", sandbox.errors],
        ["Events", sandbox.events || 0],
        ["Logs", sandbox.logs || 0],
        ["Last", sandbox.last?.createdAt ? formatShortDate(sandbox.last.createdAt) : "N/D"],
      ].map(([label, value]) => _.div(_.span(label), _.strong(String(value))))
    ),
    _.section(
      { class: "tl-flow-detail-list" },
      _.h3("Channels"),
      ...(channels.length ? channels.map((channel) => _.div(_.span(channel), _.strong("mapped"))) : [_.p({ class: "tl-flow-muted" }, "Nessun channel.")])
    ),
    _.section(
      { class: "tl-flow-detail-list" },
      _.h3(`Runtime Dependencies (${dependencies.length})`),
      _.div(
        { class: "tl-flow-dependency-summary" },
        _.span(`in ${summary.incoming}`),
        _.span(`out ${summary.outgoing}`)
      ),
      ...(dependencies.length ? dependencies.slice(0, 8).map((dependency) => {
        const row = dependencyRow(node, dependency);
        return _.div(
          { class: "tl-flow-dependency-row" },
          _.span(_.em(row.direction), row.peer),
          _.strong(row.channel)
        );
      }) : [_.p({ class: "tl-flow-muted" }, "Nessuna dependency.")])
    )
  );
};

const renderInspectorOutputs = (node, channels, channelRecords) => {
  const outputs = node.outputs?.length ? node.outputs : channels;
  const inputs = node.inputs || [];
  return _.div(
    _.section(
      { class: "tl-flow-detail-list" },
      _.h3("Outputs"),
      ...(outputs.length ? outputs.map((output) => _.div(_.span(output), _.strong(node.type === "boxTracker" ? "producer" : "output"))) : [_.p({ class: "tl-flow-muted" }, "Nessun output dichiarato.")])
    ),
    _.section(
      { class: "tl-flow-detail-list" },
      _.h3("Inputs"),
      ...(inputs.length ? inputs.map((input) => _.div(_.span(input), _.strong("input"))) : [_.p({ class: "tl-flow-muted" }, "Nessun input dichiarato.")])
    ),
    _.section(
      { class: "tl-flow-detail-list" },
      _.h3("Channel Registry"),
      ...(channelRecords.length ? channelRecords.map((channel) => {
        const report = channelDependencyReport(channel);
        return _.button(
          {
            type: "button",
            class: "tl-flow-channel-row",
            onclick: () => openChannelInspector(channel.name || channel.id, channel.workspaceId),
          },
          _.span(channel.name || channel.id),
          _.strong(
            _.span({ class: "tl-flow-channel-role" }, channelRoleForNode(channel, node)),
            _.span({ class: "tl-flow-channel-count" }, `${report.subscribers.length} subs`),
            _.span({ class: "tl-flow-channel-count" }, `${report.dependencies.length} deps`)
          )
        );
      }) : [_.p({ class: "tl-flow-muted" }, "Nessun record channel registrato.")])
    ),
    _.section(
      { class: "tl-flow-detail-list" },
      _.h3("Channel Dependencies"),
      ...(channelRecords.length ? channelRecords.map((channel) => {
        const report = channelDependencyReport(channel);
        return _.div(
          { class: "tl-flow-channel-health-row" },
          _.span(channel.name || channel.id),
          _.strong(
            _.span(`${report.producers.length} prod`),
            _.span(`${report.subscribers.length} sub`),
            _.span(`${report.dependencies.length + report.connections.length} links`),
            _.span(report.health.status)
          )
        );
      }) : [_.p({ class: "tl-flow-muted" }, "Nessun report channel disponibile.")])
    ),
    _.section(
      { class: "tl-flow-detail-list" },
      _.h3("Last Value"),
      ...(channelRecords.length ? channelRecords.map((channel) => _.div(
        { class: "tl-flow-channel-value-row" },
        _.span(channel.name || channel.id),
        _.strong(
          _.span({ class: "tl-flow-channel-value" }, channelLastValuePreview(channel)),
          _.span({ class: "tl-flow-channel-time" }, channel.lastEmittedAt ? formatShortDate(channel.lastEmittedAt) : "N/D")
        )
      )) : [_.p({ class: "tl-flow-muted" }, "Nessun last value disponibile.")])
    )
  );
};

const clearInspectorPortDragMarks = () => {
  document.querySelectorAll(".tl-flow-port-manager-row.is-dragging, .tl-flow-port-manager-row.is-drop-before, .tl-flow-port-manager-row.is-drop-after")
    .forEach((element) => element.classList.remove("is-dragging", "is-drop-before", "is-drop-after"));
};

const inspectorPortRowFromPoint = (event, drag = state.inspectorPortDrag) =>
  document.elementsFromPoint(event.clientX, event.clientY)
    .find((element) =>
      element?.dataset?.flowPortRowNode === drag?.nodeId &&
      element.dataset.flowPortRowSide === drag?.side &&
      element.dataset.flowPortRowName
    );

const handleInspectorPortDragMove = (event) => {
  const drag = state.inspectorPortDrag;
  if (!drag) return;
  const dx = Math.abs(event.clientX - drag.startX);
  const dy = Math.abs(event.clientY - drag.startY);
  if (!drag.moved && Math.max(dx, dy) < 4) return;
  if (!drag.moved) {
    drag.moved = true;
    document.body.classList.add("is-flow-inspector-port-dragging");
  }

  event.preventDefault();
  clearInspectorPortDragMarks();
  document.querySelector(`[data-flow-port-row-node="${escapeSelectorValue(drag.nodeId)}"][data-flow-port-row-side="${drag.side}"][data-flow-port-row-name="${escapeSelectorValue(drag.portName)}"]`)?.classList.add("is-dragging");

  const target = inspectorPortRowFromPoint(event, drag);
  const targetName = target?.dataset?.flowPortRowName || "";
  if (!target || targetName === drag.portName) {
    drag.targetName = "";
    drag.placement = "";
    return;
  }

  const rect = target.getBoundingClientRect();
  drag.targetName = targetName;
  drag.placement = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  target.classList.add(drag.placement === "before" ? "is-drop-before" : "is-drop-after");

  const inspector = document.querySelector(".tl-flow-inspector-overlay .tl-flow-inspector");
  if (inspector) {
    const inspectorRect = inspector.getBoundingClientRect();
    if (event.clientY < inspectorRect.top + 36) inspector.scrollTop -= 10;
    else if (event.clientY > inspectorRect.bottom - 36) inspector.scrollTop += 10;
  }
};

const endInspectorPortDrag = () => {
  const drag = state.inspectorPortDrag;
  document.removeEventListener("pointermove", handleInspectorPortDragMove);
  document.removeEventListener("pointerup", endInspectorPortDrag);
  document.removeEventListener("pointercancel", cancelInspectorPortDrag);
  document.body.classList.remove("is-flow-inspector-port-dragging");
  clearInspectorPortDragMarks();
  state.inspectorPortDrag = null;
  if (!drag?.moved || !drag.targetName || drag.targetName === drag.portName) return;

  const node = nodeById(drag.nodeId);
  if (!node) return;
  const nextOrder = drag.portNames.filter((name) => name !== drag.portName);
  const targetIndex = nextOrder.indexOf(drag.targetName);
  if (targetIndex < 0) return;
  nextOrder.splice(drag.placement === "before" ? targetIndex : targetIndex + 1, 0, drag.portName);
  const current = node.metadata?.portUi || {};
  const currentSide = portUiForNode(node, drag.side);
  persistNodeUiPatch({
    node,
    metadata: {
      portUi: {
        ...current,
        [drag.side]: {
          ...currentSide,
          order: nextOrder,
        },
      },
    },
    message: `Runtime node ${drag.side === "out" ? "output" : "input"} ports reordered: ${node.label || node.id}`,
    action: "runtime-node-port-ui-reorder",
  });
};

const cancelInspectorPortDrag = () => {
  document.removeEventListener("pointermove", handleInspectorPortDragMove);
  document.removeEventListener("pointerup", endInspectorPortDrag);
  document.removeEventListener("pointercancel", cancelInspectorPortDrag);
  document.body.classList.remove("is-flow-inspector-port-dragging");
  clearInspectorPortDragMarks();
  state.inspectorPortDrag = null;
};

const beginInspectorPortDrag = (event, node, side = "in", ports = [], port = {}) => {
  if (event.button !== 0 || !node?.id || !port?.name) return;
  event.preventDefault();
  event.stopPropagation();
  state.inspectorPortDrag = {
    nodeId: node.id,
    side,
    portName: port.name,
    portNames: ports.map((item) => item.name),
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
    targetName: "",
    placement: "",
  };
  document.addEventListener("pointermove", handleInspectorPortDragMove);
  document.addEventListener("pointerup", endInspectorPortDrag);
  document.addEventListener("pointercancel", cancelInspectorPortDrag);
};

const renderInspectorPorts = (node, side = "in") => {
  const normalizedSide = side === "out" ? "out" : "in";
  const graph = graphModel();
  const ports = orderedNodePorts(node, normalizedSide, nodePorts(node, normalizedSide));
  const connected = connectedPortNames(graph, node.id, normalizedSide);
  const hidden = new Set(portUiForNode(node, normalizedSide).hidden);
  const hideablePorts = ports.filter((port) => !isAgentControlPort(port) && !connected.has(port.name) && !hidden.has(port.name));
  const updatePortUi = (patch = {}) => {
    const current = node.metadata?.portUi || {};
    const currentSide = portUiForNode(node, normalizedSide);
    return persistNodeUiPatch({
      node,
      metadata: {
        portUi: {
          ...current,
          [normalizedSide]: {
            ...currentSide,
            ...patch,
          },
        },
      },
      message: `Runtime node ${normalizedSide === "out" ? "output" : "input"} ports UI updated: ${node.label || node.id}`,
      action: "runtime-node-port-ui",
    });
  };
  const togglePortVisibility = (port) => {
    if (isAgentControlPort(port) || connected.has(port.name)) return;
    const nextHidden = hidden.has(port.name)
      ? [...hidden].filter((name) => name !== port.name)
      : [...hidden, port.name];
    updatePortUi({ hidden: nextHidden });
  };
  const hideAll = () => {
    if (!hideablePorts.length) return;
    updatePortUi({ hidden: [...new Set([...hidden, ...hideablePorts.map((port) => port.name)])] });
  };
  return _.section(
    { class: "tl-flow-detail-list tl-flow-port-manager" },
    _.div(
      { class: "tl-flow-port-manager-head" },
      _.h3(normalizedSide === "out" ? "Outputs" : "Inputs"),
      btn({
        class: "tl-flow-port-hide-all",
        disabled: !hideablePorts.length,
        title: hideablePorts.length ? "Hide all unlinked ports on node" : "No unlinked visible ports to hide",
        onclick: hideAll,
      }, "Hide all")
    ),
    ...(ports.length ? ports.map((port) => {
      const isConnected = connected.has(port.name);
      const isControlPort = isAgentControlPort(port);
      const isHidden = hidden.has(port.name) && !isConnected && !isControlPort;
      const visibilityTitle = isControlPort
        ? "Agent Control port always visible"
        : isConnected
        ? "Porta collegata, non può essere nascosta"
        : isHidden
          ? "Show port on node"
          : "Hide port on node";
      const stateIcon = isControlPort ? "network_intel_node" : isConnected ? "link" : isHidden ? "visibility_off" : "visibility";
      return _.div(
        {
          class: `tl-flow-port-manager-row${isConnected ? " is-linked" : ""}${isHidden ? " is-hidden" : ""}`,
          "data-flow-port-row-node": node.id,
          "data-flow-port-row-side": normalizedSide,
          "data-flow-port-row-name": port.name,
        },
        _.span(
          { class: "tl-flow-port-manager-copy" },
          _.strong(port.name || "port"),
          _.small(`${port.type || "any"}${port.required ? " · required" : ""}`)
        ),
        _.span(
          { class: "tl-flow-port-manager-actions" },
          btn({
            class: `tl-flow-port-icon${isConnected ? " is-linked" : ""}${isHidden ? " is-hidden" : ""}`,
            disabled: isConnected || isControlPort,
            "aria-label": visibilityTitle,
            title: visibilityTitle,
            onclick: () => togglePortVisibility(port),
          }, icon(stateIcon, "sm")),
          _.span({
            class: "tl-flow-port-drag",
            title: "Drag to reorder",
            onPointerDown: (event) => beginInspectorPortDrag(event, node, normalizedSide, ports, port),
          }, icon("drag_indicator", "sm"))
        )
      );
    }) : [_.p({ class: "tl-flow-muted" }, normalizedSide === "out" ? "Nessun output dichiarato." : "Nessun input dichiarato.")])
  );
};

const renderInspectorCompatibility = (node) => {
  const outputMatches = nodePorts(node, "out").flatMap((port) =>
    compatiblePortTargets(node, port.name).slice(0, 3).map((item) => ({
      direction: "OUT",
      port: port.name,
      peer: item.node.label || item.node.id,
      peerPort: item.port.name,
      channel: item.validation.channel || "runtime",
    })));
  const inputMatches = nodePorts(node, "in").flatMap((port) =>
    compatiblePortSources(node, port.name).slice(0, 3).map((item) => ({
      direction: "IN",
      port: port.name,
      peer: item.node.label || item.node.id,
      peerPort: item.port.name,
      channel: item.validation.channel || "runtime",
    })));
  const matches = [...outputMatches, ...inputMatches].slice(0, 12);
  return _.section(
    { class: "tl-flow-detail-list tl-flow-compat-list" },
    _.h3("Port Compatibility"),
    ...(matches.length ? matches.map((match) => _.div(
      _.span(`${match.direction} ${match.port} -> ${match.peerPort}`),
      _.strong(`${match.peer} · ${match.channel}`)
    )) : [_.p({ class: "tl-flow-muted" }, "Nessuna compatibilita disponibile con i nodi visibili.")]
    )
  );
};

const renderInspectorRuntime = (node, events = []) => {
  const live = recentActivity(graphModel()).nodeActivity?.get(node.id);
  const perf = nodePerformance(node);
  const view = runtimeNodeBase(node, live, perf);
  return _.section(
    { class: "tl-flow-detail-list" },
    _.h3("Runtime"),
    ...[
      ["Status", view.runtime.status],
      ["Active", view.runtime.active ? "yes" : "no"],
      ["Events/min", view.runtime.eventsPerMin],
      ["Latency", `${view.runtime.latency || 0}ms`],
      ["Last event", view.runtime.lastEventAt ? formatShortDate(view.runtime.lastEventAt) : "N/D"],
      ["Recent events", events.length],
      ["Category", view.category],
      ["Subtype", view.subtype],
    ].map(([label, value]) => _.div(_.span(label), _.strong(String(value))))
  );
};

const storageInspectorStoreName = (node = {}) => {
  const config = nodeRuntimeConfig(node);
  const raw = String(config.storeName || config.bucket || "tl_history").trim();
  return raw.replace(/[^A-Za-z0-9_-]/g, "_") || "tl_history";
};

const readStorageInspectorRecords = async (storeName = "tl_history") => {
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

const loadStorageInspectorRecord = async (node = {}, { force = false } = {}) => {
  if (!node?.id || (node.type !== "storage" && nodeCategory(node) !== "storage")) return;
  const storeName = storageInspectorStoreName(node);
  const cached = state.storageInspectorRecords[node.id];
  if (!force && cached?.storeName === storeName && (cached.loading || Date.now() - Number(cached.loadedAt || 0) < 2500)) return;
  state.storageInspectorRecords = {
    ...state.storageInspectorRecords,
    [node.id]: {
      ...(cached || {}),
      storeName,
      loading: true,
      error: "",
    },
  };
  try {
    const records = await readStorageInspectorRecords(storeName);
    const latest = records
      .filter((record) => record.nodeId === node.id)
      .sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""))[0] || null;
    state.storageInspectorRecords = {
      ...state.storageInspectorRecords,
      [node.id]: {
        storeName,
        loading: false,
        record: latest,
        count: records.filter((record) => record.nodeId === node.id).length,
        loadedAt: Date.now(),
        error: "",
      },
    };
  } catch (error) {
    state.storageInspectorRecords = {
      ...state.storageInspectorRecords,
      [node.id]: {
        storeName,
        loading: false,
        record: null,
        count: 0,
        loadedAt: Date.now(),
        error: error?.message || "Storage read failed",
      },
    };
  }
  if (selectedNode()?.id === node.id) mount({ preserveScroll: true });
};

const renderInspectorStorageRecord = (node = {}) => {
  if (node.type !== "storage" && nodeCategory(node) !== "storage") {
    return _.section({ class: "tl-flow-detail-list" }, _.p({ class: "tl-flow-muted" }, "N/D"));
  }
  loadStorageInspectorRecord(node);
  const storeName = storageInspectorStoreName(node);
  const stateRecord = state.storageInspectorRecords[node.id] || { storeName, loading: true, record: null, count: 0 };
  const record = stateRecord.record || null;
  const payload = record?.payload || null;
  return _.section(
    { class: "tl-flow-detail-list" },
    _.h3("Last Stored Record"),
    ...[
      ["Store", storeName],
      ["Records", stateRecord.loading ? "loading..." : stateRecord.count || 0],
      ["Record ID", record?.id || "N/D"],
      ["Created", record?.createdAt ? formatShortDate(record.createdAt) : "N/D"],
      ["Input event", record?.inputEventId || "N/D"],
      ["Format", record?.format || "N/D"],
    ].map(([label, value]) => _.div(_.span(label), _.strong(String(value)))),
    stateRecord.error ? _.p({ class: "tl-flow-muted" }, stateRecord.error) : null,
    payload
      ? _.div(
        { class: "is-wide" },
        _.span("Payload"),
        _.div(
          { class: "tl-flow-storage-record-actions" },
          copyRuntimeButton(payload, "Copy stored payload"),
          btn({
            class: "is-ghost is-compact",
            title: "Refresh stored record",
            onclick: () => loadStorageInspectorRecord(node, { force: true }),
          }, icon("sync", "sm"), "Refresh")
        ),
        _.pre({ class: "tl-flow-storage-record-preview" }, prettyRuntimeValue(payload))
      )
      : _.p({ class: "tl-flow-muted" }, stateRecord.loading ? "Caricamento ultimo record salvato..." : "Nessun record salvato trovato per questo nodo.")
  );
};

const renderInspectorMetrics = (node, dependencies, events, channelRecords, flowLogs = []) => {
  const live = recentActivity(graphModel()).nodeActivity?.get(node.id);
  const perf = nodePerformance(node);
  const view = runtimeNodeBase(node, live, perf);
  const outgoing = dependencies.filter((dependency) => dependency.sourceNodeId === node.id).length;
  const incoming = dependencies.filter((dependency) => dependency.targetNodeId === node.id).length;
  return _.section(
    { class: "tl-flow-detail-list" },
    _.h3("Metrics"),
    ...[
      ["Incoming edges", incoming],
      ["Outgoing edges", outgoing],
      ["Channels", channelRecords.length || view.channels.length],
      ["Listeners", view.metrics.listeners || 0],
      ["Recent events", events.length],
      ["Flow logs", flowLogs.length],
      ["Events/min", view.metrics.eventsPerMin || 0],
      ["Latency", `${view.metrics.latency || 0}ms`],
    ].map(([label, value]) => _.div(_.span(label), _.strong(String(value))))
  );
};

const renderInspectorPermissions = (node) => {
  const view = runtimeNodeBase(node);
  const schema = node.metadata?.settingsSchema || node.metadata?.manifest?.settingsSchema || {};
  const manifest = node.metadata?.manifest || {};
  const portSummary = (ports = []) =>
    ports.map((port) => {
      const normalized = normalizePortDef(port);
      return `${normalized.name}:${normalized.type || "any"}`;
    }).join(", ");
  return _.div(
    _.section(
      { class: "tl-flow-detail-list" },
      _.h3("Permissions"),
      ...(view.permissions.length ? view.permissions.map((permission) => _.div(_.span(permission), _.strong("allowed"))) : [_.p({ class: "tl-flow-muted" }, "Nessun permesso dichiarato.")])
    ),
    _.section(
      { class: "tl-flow-detail-list" },
      _.h3("Settings Schema"),
      ...(Object.keys(schema).length ? Object.entries(schema).map(([key, value]) => _.div(_.span(key), _.strong(String(value)))) : [_.p({ class: "tl-flow-muted" }, "Nessuno schema impostazioni dichiarato.")])
    ),
    _.section(
      { class: "tl-flow-detail-list" },
      _.h3("Runtime Manifest"),
      ...(Object.keys(manifest).length ? [
        ["Type", manifest.type || node.type || "runtime"],
        ["Subtype", manifest.subtype || nodeSubtype(node)],
        ["Inputs", portSummary(manifest.inputs || node.inputs || []) || "none"],
        ["Outputs", portSummary(manifest.outputs || node.outputs || []) || "none"],
        ["Permissions", (manifest.permissions || view.permissions || []).join(", ") || "none"],
      ].map(([label, value]) => _.div(_.span(label), _.strong(String(value)))) : [_.p({ class: "tl-flow-muted" }, "Nessun manifest runtime dichiarato.")])
    )
  );
};

const renderInspectorLogs = (events = [], flowLogs = []) =>
  _.div(
    state.filters.runId !== "all" ? _.section(
      { class: "tl-flow-detail-list" },
      _.div(
        { class: "tl-flow-log-filter-row" },
        _.span("Run filter"),
        _.strong(state.filters.runId),
        btn({ class: "is-ghost is-compact", onclick: () => setFilter("runId", "all") }, "Clear")
      )
    ) : null,
    _.section(
      { class: "tl-flow-detail-list tl-flow-runtime-log-list" },
      _.h3("Runtime Events"),
      ...(events.length ? events.map((event) =>
        _.article(
          { class: `tl-flow-runtime-log-card is-${event.status === "error" ? "error" : "event"}` },
          _.div(
            { class: "tl-flow-runtime-log-head" },
            _.span(eventTypeChip(event), _.em(event.channel || "default")),
            _.strong(`${event.status || "ok"} · ${formatShortDate(event.createdAt)}`),
            _.div(
              { class: "tl-flow-runtime-log-actions" },
              btn({
                class: "is-ghost is-compact tl-flow-replay-btn",
                title: "Replay this payload through downstream routes",
                onclick: () => replayRuntimeEvent(event),
              }, icon("replay", "sm"), "Replay"),
              copyRuntimeButton(event.payload || {}, "Copy payload")
            )
          ),
          _.div(
            { class: "tl-flow-runtime-log-meta" },
            _.span(`source: ${event.sourceLabel || event.sourceNodeId || "runtime"}`),
            _.span(`target: ${event.targetNodeId || "N/D"}`),
            _.span(`run: ${runtimeRecordRunId(event) || "N/D"}`),
            _.span(`${event.sizeBytes || 0} B`)
          ),
          _.div(
            { class: "tl-flow-runtime-raw-preview" },
            _.span("Raw preview"),
            _.code(runtimeEventRawPreview(event))
          ),
          renderRuntimePayloadDetails({
            title: "Payload",
            value: event.payload || {},
            meta: {
              event: event.eventType || "event",
              channel: event.channel || "default",
            },
          })
        )
      ) : [_.p({ class: "tl-flow-muted" }, "Nessun evento recente.")])
    ),
    _.section(
      { class: "tl-flow-detail-list tl-flow-runtime-log-list" },
      _.h3("Flow Logs"),
      ...(flowLogs.length ? flowLogs.map((log) =>
        _.article(
          { class: `tl-flow-runtime-log-card is-${log.level || "info"}` },
          _.div(
            { class: "tl-flow-runtime-log-head" },
            _.span(logLevelChip(log.level || "info"), _.em(log.context?.action || "runtime")),
            _.strong(formatShortDate(log.createdAt)),
            copyRuntimeButton(log.context || {}, "Copy context")
          ),
          _.p(log.message || log.context?.action || "runtime log"),
          _.div(
            { class: "tl-flow-runtime-log-meta" },
            _.span(`node: ${log.nodeId || log.context?.sourceNodeId || "runtime"}`),
            _.span(`connection: ${log.connectionId || log.context?.connectionId || "N/D"}`),
            _.span(`run: ${runtimeRecordRunId(log) || "N/D"}`)
          ),
          renderRuntimePayloadDetails({
            title: "Context",
            value: log.context || {},
            meta: {
              level: log.level || "info",
              workspace: log.workspaceId || "global",
            },
          })
        )
      ) : [_.p({ class: "tl-flow-muted" }, "Nessun flow log recente.")])
    )
  );

const renderInspectorStats = (node, dependencies, events, channelRecords, flowLogs = []) => {
  const outgoing = dependencies.filter((dependency) => dependency.sourceNodeId === node.id).length;
  const incoming = dependencies.filter((dependency) => dependency.targetNodeId === node.id).length;
  const errorEvents = events.filter((event) => event.status === "error" || event.eventType === "error").length;
  const sandbox = nodeSandboxReport(node);
  return _.section(
    { class: "tl-flow-detail-list" },
    _.h3("Stats"),
    ...[
      ["Incoming edges", incoming],
      ["Outgoing edges", outgoing],
      ["Channels", channelRecords.length || nodeChannels(node).length],
      ["Recent events", events.length],
      ["Flow logs", flowLogs.length],
      ["Errors", errorEvents],
      ["Sandbox", sandbox.status],
      ["Sandbox errors", sandbox.errors],
      ["Status", node.status || "active"],
      ["Configured", node.metadata?.configured ? "yes" : isDraftNode(node) ? "draft" : "N/D"],
    ].map(([label, value]) => _.div(_.span(label), _.strong(String(value))))
  );
};

const renderImpactSummary = (impact = selectedImpact()) => {
  if (!impact) return null;
  return _.section(
    { class: "tl-flow-detail-list tl-flow-impact-summary" },
    _.h3("Impact Analysis"),
    ...[
      ["Upstream", String(impact.upstream?.length || 0)],
      ["Downstream", String(impact.downstream?.length || 0)],
      ["Direct links", String(impact.directDependencies?.length || 0)],
      ["Events", String(impact.directEvents?.length || 0)],
      ["Channels", (impact.channels || []).join(", ") || "N/D"],
      ["Risk", impact.risk || "N/D"],
    ].map(([label, value]) => _.div(_.span(label), _.strong(value)))
  );
};

const inspectorPanelPrefsKey = (kind = "node") => `tl_flow_inspector_panels:${kind}`;

const readInspectorPanelPrefs = (kind = "node") => {
  try {
    const value = JSON.parse(localStorage.getItem(inspectorPanelPrefsKey(kind)) || "{}");
    return {
      order: Array.isArray(value.order) ? value.order : [],
      collapsed: value.collapsed && typeof value.collapsed === "object" ? value.collapsed : {},
    };
  } catch (_) {
    return { order: [], collapsed: {} };
  }
};

const writeInspectorPanelPrefs = (kind = "node", prefs = {}) => {
  try {
    localStorage.setItem(inspectorPanelPrefsKey(kind), JSON.stringify({
      order: Array.isArray(prefs.order) ? prefs.order : [],
      collapsed: prefs.collapsed && typeof prefs.collapsed === "object" ? prefs.collapsed : {},
    }));
  } catch (_) {
    // localStorage may be unavailable in restricted extension contexts.
  }
};

const orderedInspectorPanels = (kind = "node", panels = []) => {
  const prefs = readInspectorPanelPrefs(kind);
  const byId = new Map(panels.map((panel) => [panel.id, panel]));
  const ordered = prefs.order.map((id) => byId.get(id)).filter(Boolean);
  const missing = panels.filter((panel) => !prefs.order.includes(panel.id));
  return [...ordered, ...missing];
};

const toggleInspectorPanel = (kind = "node", panelId = "") => {
  const prefs = readInspectorPanelPrefs(kind);
  writeInspectorPanelPrefs(kind, {
    ...prefs,
    collapsed: { ...(prefs.collapsed || {}), [panelId]: !prefs.collapsed?.[panelId] },
  });
  mount({ preserveScroll: true });
};

const writeInspectorPanelOrder = (kind = "node", order = []) => {
  const prefs = readInspectorPanelPrefs(kind);
  writeInspectorPanelPrefs(kind, { ...prefs, order });
};

const clearInspectorPanelDragMarks = () => {
  document.querySelectorAll(".tl-flow-inspector-card.is-dragging, .tl-flow-inspector-card.is-drop-before, .tl-flow-inspector-card.is-drop-after")
    .forEach((element) => {
      element.classList.remove("is-dragging", "is-drop-before", "is-drop-after");
    });
};

const inspectorPanelCardFromPoint = (event, kind = "node") =>
  document.elementsFromPoint(event.clientX, event.clientY)
    .find((element) => element?.dataset?.inspectorKind === kind && element.dataset.inspectorPanelId);

const handleInspectorPanelDragMove = (event) => {
  const drag = state.inspectorPanelDrag;
  if (!drag) return;
  const dx = Math.abs(event.clientX - drag.startX);
  const dy = Math.abs(event.clientY - drag.startY);

  if (!drag.moved && Math.max(dx, dy) < 4) return;
  if (!drag.moved) {
    drag.moved = true;
    document.body.classList.add("is-flow-inspector-card-dragging");
    document.querySelector(`[data-inspector-kind="${drag.kind}"][data-inspector-panel-id="${drag.panelId}"]`)?.classList.add("is-dragging");
  }

  event.preventDefault();
  clearInspectorPanelDragMarks();
  document.querySelector(`[data-inspector-kind="${drag.kind}"][data-inspector-panel-id="${drag.panelId}"]`)?.classList.add("is-dragging");

  const target = inspectorPanelCardFromPoint(event, drag.kind);
  const targetId = target?.dataset?.inspectorPanelId || "";
  if (!target || targetId === drag.panelId) {
    drag.targetId = "";
    drag.placement = "";
    return;
  }

  const rect = target.getBoundingClientRect();
  drag.targetId = targetId;
  drag.placement = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  target.classList.add(drag.placement === "before" ? "is-drop-before" : "is-drop-after");

  const inspector = document.querySelector(".tl-flow-inspector-overlay .tl-flow-inspector");
  if (inspector) {
    const inspectorRect = inspector.getBoundingClientRect();
    if (event.clientY < inspectorRect.top + 36) inspector.scrollTop -= 10;
    else if (event.clientY > inspectorRect.bottom - 36) inspector.scrollTop += 10;
  }
};

const endInspectorPanelDrag = () => {
  const drag = state.inspectorPanelDrag;
  document.removeEventListener("pointermove", handleInspectorPanelDragMove);
  document.removeEventListener("pointerup", endInspectorPanelDrag);
  document.removeEventListener("pointercancel", cancelInspectorPanelDrag);
  document.body.classList.remove("is-flow-inspector-card-dragging");
  clearInspectorPanelDragMarks();
  state.inspectorPanelDrag = null;
  if (!drag) return;

  if (!drag.moved) {
    toggleInspectorPanel(drag.kind, drag.panelId);
    return;
  }

  if (!drag.targetId || drag.targetId === drag.panelId) return;
  const next = drag.panelIds.filter((id) => id !== drag.panelId);
  const targetIndex = next.indexOf(drag.targetId);
  if (targetIndex < 0) return;
  next.splice(drag.placement === "before" ? targetIndex : targetIndex + 1, 0, drag.panelId);
  writeInspectorPanelOrder(drag.kind, next);
  mount({ preserveScroll: true });
};

const cancelInspectorPanelDrag = () => {
  document.removeEventListener("pointermove", handleInspectorPanelDragMove);
  document.removeEventListener("pointerup", endInspectorPanelDrag);
  document.removeEventListener("pointercancel", cancelInspectorPanelDrag);
  document.body.classList.remove("is-flow-inspector-card-dragging");
  clearInspectorPanelDragMarks();
  state.inspectorPanelDrag = null;
};

const beginInspectorPanelDrag = (event, kind = "node", panels = [], panelId = "") => {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  state.inspectorPanelDrag = {
    kind,
    panelId,
    panelIds: orderedInspectorPanels(kind, panels).map((panel) => panel.id),
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
    targetId: "",
    placement: "",
  };
  document.addEventListener("pointermove", handleInspectorPanelDragMove);
  document.addEventListener("pointerup", endInspectorPanelDrag);
  document.addEventListener("pointercancel", cancelInspectorPanelDrag);
};

const renderInspectorSectionCard = (kind = "node", panels = [], panel = {}) => {
  const prefs = readInspectorPanelPrefs(kind);
  const collapsed = Boolean(prefs.collapsed?.[panel.id]);
  return _.section(
    {
      class: `tl-flow-inspector-card${collapsed ? " is-collapsed" : ""}`,
      "data-inspector-kind": kind,
      "data-inspector-panel-id": panel.id,
    },
    _.div(
      {
        class: "tl-flow-inspector-card-head",
        role: "button",
        tabindex: "0",
        title: "Drag to reorder. Click to collapse.",
        onPointerDown: (event) => beginInspectorPanelDrag(event, kind, panels, panel.id),
        onkeydown: (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          toggleInspectorPanel(kind, panel.id);
        },
      },
      _.span(
        { class: "tl-flow-inspector-card-toggle" },
        icon(collapsed ? "chevron_right" : "keyboard_arrow_down", "sm"),
        _.span(panel.title)
      ),
      _.span({ class: "tl-flow-inspector-card-grip", "aria-hidden": "true" }, icon("drag_indicator", "sm"))
    ),
    collapsed ? null : _.div({ class: "tl-flow-inspector-card-body" }, panel.content)
  );
};

const renderInspectorPanelStack = (kind = "node", panels = []) => {
  const ordered = orderedInspectorPanels(kind, panels);
  return _.div(
    { class: "tl-flow-inspector-stack" },
    ...ordered.map((panel) => renderInspectorSectionCard(kind, ordered, panel))
  );
};

const inspectorActionButton = ({ label = "", iconName = "", className = "", ...props } = {}) =>
  _.Tooltip ? _.Tooltip(btn(
    {
      ...props,
      class: ["tl-flow-inspector-action", className, props.class].filter(Boolean).join(" "),
      title: label,
      "aria-label": label,
    },
    icon(iconName, "sm")
  ), label) : btn(
    {
      ...props,
      class: ["tl-flow-inspector-action", className, props.class].filter(Boolean).join(" "),
      title: label,
      "aria-label": label,
    },
    icon(iconName, "sm")
  );

const inspectorSourceChip = (linkingSource = {}) => {
  const label = `Source: ${linkingSource.label || linkingSource.id}`;
  const chip = _.span(
    {
      class: "tl-flow-link-source-chip",
      title: label,
      "aria-label": label,
      role: "img",
      tabindex: "0",
    },
    icon("hub", "sm")
  );
  return _.Tooltip ? _.Tooltip(chip, label) : chip;
};

const renderInspectorTitleHero = ({ tone = "cyan", iconName = "hub", title = "", subtitle = "", status = "active", renameAction = null, closeLabel = "Close Inspector" } = {}) =>
  _.div(
    { class: "tl-flow-panel-title is-hero" },
    _.div(
      { class: "tl-flow-node-hero tl-flow-inspector-title-hero" },
      _.span({ class: `tl-flow-node-icon is-${tone}` }, icon(iconName, "md")),
      _.div(
        { class: "tl-flow-inspector-title-copy" },
        _.div(
          { class: "tl-flow-inspector-title-line" },
          _.h2(title || "Inspector"),
          renameAction ? inspectorActionButton({ label: "Rename", iconName: "drive_file_rename_outline", className: "is-title-action", onclick: renameAction }) : null
        ),
        _.p(
          subtitle || "Runtime Graph",
          _.span({ class: "tl-flow-status", "data-flow-inspector-status": "true" }, dot(), status || "active")
        )
      )
    ),
    btn({ "aria-label": closeLabel, title: `${closeLabel} (Esc)`, onclick: closeInspector }, icon("close", "sm"))
  );

const renderEdgeInspector = (edge) => {
  const source = nodeById(edge.sourceNodeId);
  const target = nodeById(edge.targetNodeId);
  const flowLogs = selectedEdgeFlowLogs(edge);
  const events = filteredRuntimeEvents()
    .filter((event) =>
      event.channel === edge.channel ||
      event.sourceNodeId === edge.sourceNodeId ||
      event.targetNodeId === edge.targetNodeId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 5);
  const sourcePort = edge.metadata?.sourcePort || edge.sourcePort || "all";
  const targetPort = edge.metadata?.targetPort || edge.targetPort || "all";
  const sourcePortDef = portByName(source, "out", sourcePort);
  const targetPortDef = portByName(target, "in", targetPort);
  const typeCompatible = portsAreCompatible(sourcePortDef, targetPortDef, target || {});
  const mappingMode = edge.metadata?.mode || edge.mapping?.mode || "pass-through";
  const mappingPath = edge.metadata?.payloadPath || edge.mapping?.payloadPath || "";
  const mappingTransform = edge.metadata?.transform || edge.mapping?.transform || "";
  const mappingNote = edge.metadata?.note || edge.mapping?.note || "";
  const lastEvent = events[0];
  const mapping = {
    ...(edge.mapping || {}),
    ...(edge.metadata || {}),
    mode: mappingMode,
    payloadPath: mappingPath,
    transform: mappingTransform,
    note: mappingNote,
  };
  let mappedLastEvent = null;
  if (lastEvent?.payload !== undefined && window.TrackerLensRuntimeContract?.applyConnectionMapping) {
    try {
      mappedLastEvent = window.TrackerLensRuntimeContract.applyConnectionMapping(lastEvent.payload, mapping);
    } catch (error) {
      mappedLastEvent = {
        payload: lastEvent.payload,
        changed: false,
        warnings: [error?.message || "mapping failed"],
      };
    }
  }
  const mappingStatus = mappedLastEvent?.warnings?.length
    ? "warning"
    : mappedLastEvent?.changed
      ? "applied"
      : mappingMode === "pass-through"
        ? "pass-through"
        : "configured";
  const panels = [
    {
      id: "connection",
      title: "Connection",
      content: _.section(
        { class: "tl-flow-detail-list" },
        ...[
          ["ID", edge.id],
          ["Source", source?.label || edge.sourceNodeId || "N/D"],
          ["Target", target?.label || edge.targetNodeId || "N/D"],
          ["Channel", edge.channel || "runtime"],
          ["Source port", `${sourcePort} · ${sourcePortDef.type || "any"}`],
          ["Target port", `${targetPort} · ${targetPortDef.type || "any"}`],
          ["Type check", typeCompatible ? "compatible" : `${sourcePortDef.type || "any"} -> ${targetPortDef.type || "any"}`],
          ["Origin", edge.metadata?.source || (edge.connectionId ? "tl_connections" : "tl_runtime_dependencies")],
          ["Connection", edge.connectionId || "N/D"],
        ].map(([label, value]) => _.div(_.span(label), _.strong(value)))
      ),
    },
    {
      id: "mapping",
      title: "Mapping",
      content: _.section(
        { class: "tl-flow-detail-list" },
        ...[
          ["Route", `${source?.label || edge.sourceNodeId || "source"}:${sourcePort} -> ${target?.label || edge.targetNodeId || "target"}:${targetPort}`],
          ["Mode", mappingMode],
          ["Status", mappingStatus],
          ["Payload", sourcePort === "all" ? "full payload" : `field ${sourcePort}`],
          ["Payload path", mappingPath || "N/D"],
          ["Transform", mappingTransform || "N/D"],
          ["Note", mappingNote || "N/D"],
          ["Last value", lastEvent?.payloadPreview || edge.metadata?.lastPayloadPreview || "N/D"],
        ].map(([label, value]) => _.div(_.span(label), _.strong(value))),
        _.div(
          { class: "tl-flow-mapping-actions" },
          _.span("Actions"),
          _.strong(
            mappingTransform ? copyRuntimeButton(mappingTransform, "Copy transform") : null,
            mappedLastEvent ? copyRuntimeButton(mappedLastEvent.payload, "Copy mapped payload") : null
          )
        )
      ),
    },
    { id: "impact", title: "Impact Analysis", content: renderImpactSummary(selectedImpact()) },
    {
      id: "events",
      title: "Recent Events",
      content: _.section(
        { class: "tl-flow-detail-list" },
        ...(events.length ? events.map((event) =>
          _.div(
            _.span(eventTypeChip(event), ` ${event.channel || "default"}`),
            _.strong(`${event.status || "ok"} · ${formatShortDate(event.createdAt)}`)
          )
        ) : [_.p({ class: "tl-flow-muted" }, "Nessun evento recente per questo collegamento.")])
      ),
    },
    {
      id: "logs",
      title: "Flow Logs",
      content: _.section(
        { class: "tl-flow-detail-list" },
        ...(flowLogs.length ? flowLogs.map((log) =>
          _.div(
            _.span(log.message || log.context?.action || "runtime log"),
            _.strong(`${log.level || "info"} · ${formatShortDate(log.createdAt)}`)
          )
        ) : [_.p({ class: "tl-flow-muted" }, "Nessun flow log recente per questo collegamento.")])
      ),
    },
  ];

  return _.aside(
    { class: "tl-flow-inspector" },
    renderInspectorTitleHero({
      tone: graphTone(source || edge.sourceType || "cyan"),
      iconName: "route",
      title: edgeDisplayLabel(edge),
      subtitle: edge.metadata?.source || edge.connectionId || "runtime dependency",
      status: edge.status || "active",
    }),
    _.section(
      { class: "tl-flow-inspector-card is-controls" },
      _.div(
        { class: "tl-flow-node-actions is-edge-actions" },
        inspectorActionButton({ label: "Source", iconName: "input", onclick: () => viewEdgeNode(source), disabled: !source }),
        inspectorActionButton({ label: "Target", iconName: "output", onclick: () => viewEdgeNode(target), disabled: !target }),
        inspectorActionButton({
          label: "Edit Mapping",
          iconName: "route",
          onclick: () => requestRuntimeLinkMappingDialog({
            source,
            target,
            validation: { sourcePort: sourcePortDef, targetPort: targetPortDef },
            sourcePort,
            targetPort,
            channel: edge.channel || mapping.channel || "runtime",
            edge,
            initialMapping: mapping,
          }),
          disabled: !source || !target || !edge.id,
        }),
        edge.connectionId
          ? inspectorActionButton({ label: "Delete Link", iconName: "link_off", className: "is-danger", onclick: () => requestEdgeDelete(edge) })
          : inspectorActionButton({ label: "Read Only", iconName: "lock", disabled: true })
      )
    ),
    renderInspectorPanelStack("edge", panels)
  );
};

const renderInspector = () => {
  const edge = selectedEdge();
  if (edge) return renderEdgeInspector(edge);

  const node = selectedNode();
  const dependencies = selectedDependencies(node);
  const events = selectedEvents(node);
  const flowLogs = selectedFlowLogs(node);
  const channels = node ? nodeChannels(node) : [];
  const channelRecords = selectedChannelRecords(node);
  const draft = isDraftNode(node || {});
  const canDeleteRuntimeNode = draft || (node && isInlineConfigNode(node) && !node.metadata?.library);
  const linkingSource = nodeById(state.linkingSourceId);
  const isLinkTarget = Boolean(node && linkingSource && linkingSource.id !== node.id);
  const view = node ? runtimeNodeBase(node, recentActivity(graphModel()).nodeActivity?.get(node.id), nodePerformance(node)) : null;
  const paused = view?.runtime.status === "paused";
  const disabled = view?.runtime.status === "disabled";
  const panels = node ? [
    { id: "details", title: "General", content: renderInspectorDetails(node, channels, dependencies) },
    { id: "inputs", title: "Inputs", content: renderInspectorPorts(node, "in") },
    {
      id: "outputs",
      title: "Outputs",
      content: _.div(
        renderInspectorPorts(node, "out"),
        renderInspectorOutputs(node, channels, channelRecords)
      ),
    },
    { id: "runtime", title: "Runtime", content: renderInspectorRuntime(node, events) },
    ...(node.type === "storage" || nodeCategory(node) === "storage"
      ? [{ id: "storage-record", title: "Last Stored Record", content: renderInspectorStorageRecord(node) }]
      : []),
    { id: "logs", title: "Logs", content: renderInspectorLogs(events, flowLogs) },
    { id: "metrics", title: "Metrics", content: renderInspectorMetrics(node, dependencies, events, channelRecords, flowLogs) },
    { id: "permissions", title: "Permissions", content: renderInspectorPermissions(node) },
    { id: "compatibility", title: "Compatibility", content: renderInspectorCompatibility(node) },
  ] : [];

  return _.aside(
    { class: "tl-flow-inspector" },
    node ? renderInspectorTitleHero({
      tone: graphTone(node),
      iconName: graphIcon(node),
      title: node.label || node.id,
      subtitle: node.type || "Runtime Node",
      status: draft ? "draft" : node.status || "active",
      renameAction: () => requestNodeRename(node),
    }) : _.div({ class: "tl-flow-panel-title" }, _.strong("Inspector"), btn({ "aria-label": "Close Inspector", title: "Close Inspector (Esc)", onclick: closeInspector }, icon("close", "sm"))),
    node ? _.section(
      { class: "tl-flow-inspector-card is-controls" },
      _.div(
        { class: "tl-flow-node-actions" },
        linkingSource ? inspectorSourceChip(linkingSource) : null,
        inspectorActionButton({ label: draft ? "Configure Draft" : "Open Config", iconName: draft ? "edit" : "open_in_new", className: "is-primary", onclick: () => configureNode(node) }),
        inspectorActionButton({ label: "Duplicate", iconName: "content_copy", onclick: () => duplicateRuntimeNode(node) }),
        inspectorActionButton({ label: paused || disabled ? "Resume" : "Pause", iconName: paused || disabled ? "play_arrow" : "pause", onclick: () => (paused || disabled ? resumeNodeRuntime(node) : pauseNodeRuntime(node)) }),
        inspectorActionButton({ label: disabled ? "Enable" : "Disable", iconName: disabled ? "power_settings_new" : "block", onclick: () => (disabled ? resumeNodeRuntime(node) : disableNodeRuntime(node)) }),
        inspectorActionButton({ label: node.metadata?.collapsed ? "Expand" : "Collapse", iconName: node.metadata?.collapsed ? "unfold_more" : "unfold_less", onclick: () => toggleNodeCollapse(node) }),
        isLinkTarget
          ? inspectorActionButton({ label: "Link Here", iconName: "add_link", onclick: () => createLinkToNode(node) })
          : inspectorActionButton({ label: linkingSource?.id === node.id ? "Linking..." : "Start Link", iconName: "hub", onclick: () => startLinkFromNode(node), disabled: Boolean(linkingSource && linkingSource.id === node.id) }),
        linkingSource ? inspectorActionButton({ label: "Cancel Link", iconName: "link_off", onclick: cancelLinkMode }) : null,
        canDeleteRuntimeNode ? inspectorActionButton({ label: draft ? "Delete Draft" : "Delete Node", iconName: "delete", className: "is-danger", onclick: () => requestDraftNodeDelete(node) }) : null
      )
    ) : _.p({ class: "tl-flow-muted" }, "Nessun nodo selezionato."),
    node ? renderInspectorPanelStack("node", panels) : null
  );
};

const renderEvents = () => {
  const events = filteredRuntimeEvents()
    .slice()
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 7);
  const logLevel = state.filters.logLevel || "all";
  const flowLogs = (state.runtime.flowLogs || [])
    .slice()
    .filter((log) => logLevel === "all" || (log.level || "info") === logLevel)
    .filter((log) => recordMatchesRunFilter(log))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 5);

  return _.section(
    { class: "tl-flow-events" },
    _.div(
      { class: "tl-flow-events-head" },
      _.h2("Event Inspector"),
      renderSelect("tl-flow-select is-tiny", state.filters.eventType || "all", eventTypeOptions(), (value) => setFilter("eventType", value)),
      state.filters.eventType !== "all" ? btn({ class: "is-ghost is-compact", onclick: () => setFilter("eventType", "all") }, "Clear") : null,
      state.filters.runId !== "all" ? btn({ class: "is-ghost is-compact", title: state.filters.runId, onclick: () => setFilter("runId", "all") }, "Clear run") : null,
      _.span(`${events.length} live`)
    ),
    renderLiveTestVerification(),
    _.table(
      _.thead(_.tr(_.th("Time"), _.th("Channel"), _.th("Event"), _.th("Source"), _.th("Payload"), _.th("Size"))),
      _.tbody(
        ...(events.length ? events.map((event) =>
          _.tr(
            _.td(formatShortDate(event.createdAt)),
            _.td(event.channel || "default"),
            _.td(eventTypeChip(event)),
            _.td(event.sourceLabel || event.sourceNodeId || "runtime"),
            _.td(event.payloadPreview || "{...}"),
            _.td(`${event.sizeBytes || 0} B`)
          )
        ) : [_.tr(_.td({ colspan: 6 }, "Nessun evento runtime registrato."))])
      )
    ),
    _.div(
      { class: "tl-flow-events-head is-secondary" },
      _.h2("Flow Logs"),
      renderSelect("tl-flow-select is-tiny", logLevel, [
        { value: "all", label: "All logs" },
        { value: "info", label: "Info" },
        { value: "warning", label: "Warning" },
        { value: "error", label: "Error" },
      ], (value) => setFilter("logLevel", value)),
      logLevel !== "all" ? btn({ class: "is-ghost is-compact", onclick: () => setFilter("logLevel", "all") }, "Clear") : null,
      _.span(`${flowLogs.length} recent`)
    ),
    _.table(
      _.thead(_.tr(_.th("Time"), _.th("Level"), _.th("Message"), _.th("Node"), _.th("Connection"))),
      _.tbody(
        ...(flowLogs.length ? flowLogs.map((log) =>
          _.tr(
            _.td(formatShortDate(log.createdAt)),
            _.td(logLevelChip(log.level || "info")),
            _.td(log.message || log.context?.action || "runtime log"),
            _.td(log.nodeId || log.context?.sourceNodeId || "runtime"),
            _.td(log.connectionId || log.context?.connectionId || "N/D")
          )
        ) : [_.tr(_.td({ colspan: 5 }, "Nessun flow log runtime registrato."))])
      )
    )
  );
};

const renderOverview = () => {
  const stats = runtimeOverviewStats();
  return _.section(
    { class: "tl-flow-overview" },
    _.h2("Runtime Overview"),
    _.div(_.span("Nodes"), _.strong(String(state.runtime.nodes.length))),
    _.div(_.span("Connections"), _.strong(String(state.runtime.dependencies.length))),
    _.div(_.span("Channels"), _.strong(String(state.runtime.channels.length))),
    _.div(_.span("Events"), _.strong(String(state.runtime.events.length))),
    _.div(_.span("Flow logs"), _.strong(String(state.runtime.flowLogs?.length || 0))),
    _.div({ class: "tl-flow-overview-split" },
      _.span("Log health"),
      _.strong(
        _.button({ type: "button", class: "tl-flow-mini-chip is-gold is-clickable", onclick: () => focusLogLevel("warning") }, `${stats.warningLogs} warn`),
        _.button({ type: "button", class: "tl-flow-mini-chip is-red is-clickable", onclick: () => focusLogLevel("error") }, `${stats.errorLogs} err`)
      )
    ),
    _.div({ class: "tl-flow-overview-split" },
      _.span("Runtime"),
      _.strong(_.span({ class: "tl-flow-mini-chip is-violet" }, String(stats.runtime)), _.span({ class: "tl-flow-mini-chip is-gold" }, `${stats.draft} draft`))
    ),
    _.div({ class: "tl-flow-overview-split" },
      _.span("Configured"),
      _.strong(_.span({ class: "tl-flow-mini-chip is-green" }, String(stats.configured)), _.span({ class: "tl-flow-mini-chip is-blue" }, "workspace scoped"))
    ),
    _.div({ class: "tl-flow-port-legend" },
      _.span({ class: "is-int" }, "number"),
      _.span({ class: "is-string" }, "string"),
      _.span({ class: "is-object" }, "object"),
      _.span({ class: "is-bool" }, "bool")
    ),
    _.small(`Updated ${formatShortDate(state.updatedAt)}`)
  );
};

const recentEvents = (limit = 8) =>
  filteredRuntimeEvents()
    .slice()
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, limit);

const recentFlowLogs = (level = "all", limit = 8) =>
  (state.runtime.flowLogs || [])
    .slice()
    .filter((log) => level === "all" || (log.level || "info") === level)
    .filter((log) => recordMatchesRunFilter(log))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, limit);

const openFlowRecordDialog = ({ title = "Runtime record", subtitle = "", iconName = "data_object", record = {} } = {}) => {
  const dialog = _.Dialog({
    class: "tl-flow-record-dialog",
    panelClass: "tl-flow-record-dialog-panel",
    size: "lg",
    title,
    subtitle,
    icon: iconName,
    closeButton: true,
    content: () => _.pre({ class: "tl-flow-record-json" }, JSON.stringify(record || {}, null, 2)),
    actions: ({ close }) => btn({ class: "is-primary", onclick: close }, "Close"),
  });
  dialog.open();
};

const channelTimeline = (limit = 32) => {
  const rows = [
    ...(state.runtime.events || []).filter(recordMatchesRunFilter).map((event) => ({
      id: event.id,
      createdAt: event.createdAt,
      channel: event.channel || "default",
      type: event.eventType || "event",
      nodeId: event.sourceNodeId || event.targetNodeId || "runtime",
      status: event.status || "ok",
      detail: event.payloadPreview || compactPayloadPreview(event.payload, 120),
    })),
    ...(state.runtime.flowLogs || []).filter(recordMatchesRunFilter).map((log) => ({
      id: log.id,
      createdAt: log.createdAt,
      channel: log.context?.inputChannel || log.context?.outputChannel || log.context?.channel || "runtime",
      type: log.context?.runtime || log.context?.action || "flow-log",
      nodeId: log.nodeId || log.context?.sourceNodeId || "runtime",
      status: log.level || "info",
      detail: log.message || log.context?.action || "runtime log",
    })),
  ].filter((row) => {
    if (state.filters.channel !== "all" && row.channel !== state.filters.channel) return false;
    return true;
  });
  return rows
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .slice(-limit);
};

const statusItems = () => {
  const stats = runtimeOverviewStats();
  const filteredEventCount = filteredRuntimeEvents().length;
  const eventLabel = state.filters.eventType === "all"
    ? `${state.runtime.events.length} events`
    : `${filteredEventCount}/${state.runtime.events.length} events`;
  return [
    { id: "runtime", icon: "account_tree", label: `${state.runtime.nodes.length} nodes`, title: "Runtime" },
    { id: "edges", icon: "route", label: `${state.runtime.dependencies.length} edges`, title: "Edges" },
    { id: "channels", icon: "hub", label: `${state.runtime.channels.length} channels`, title: "Channels" },
    { id: "bus", icon: "settings_input_antenna", label: state.liveBus.connected ? `${state.liveBus.count} live bus` : "bus offline", title: "Live Bus", tone: state.liveBus.connected ? "green" : "gold" },
    { id: "worker", icon: "memory", label: state.runtimeWorker.connected ? `worker ${state.runtimeWorker.status}` : "worker off", title: "Runtime Worker", tone: state.runtimeWorker.connected ? "green" : "gold" },
    { id: "timeline", icon: "timeline", label: `${channelTimeline(100).length} timeline`, title: "Channel Timeline" },
    { id: "events", icon: "bolt", label: eventLabel, title: "Events" },
    { id: "logs", icon: "subject", label: `${state.runtime.flowLogs?.length || 0} logs`, title: "Flow logs" },
    { id: "warning", icon: "warning", label: `${stats.warningLogs} warning`, title: "Warnings", tone: "gold" },
    { id: "error", icon: "error", label: `${stats.errorLogs} error`, title: "Errors", tone: "red" },
  ];
};

const renderStatusChannelsPanel = () => {
  const channels = recentChannelRecords();
  return _.table(
    _.thead(_.tr(_.th("Channel"), _.th("Workspace"), _.th("Health"), _.th("Deps"), _.th("Last"), _.th("Value"))),
    _.tbody(
      ...(channels.length ? channels.map((channel) => {
        const report = channelDependencyReport(channel);
        return (
          _.tr(
            _.td(
              _.button(
                {
                  type: "button",
                  class: "tl-flow-channel-link",
                  onclick: () => openChannelInspector(channel.name || channel.id, channel.workspaceId),
                },
                channel.name || channel.id || "default"
              )
            ),
            _.td(channel.workspaceId || "global"),
            _.td(report.health.status),
            _.td(`${report.producers.length}/${report.subscribers.length}/${report.dependencies.length}`),
            _.td(channel.lastEmittedAt ? formatShortDate(channel.lastEmittedAt) : "N/D"),
            _.td(_.code({ class: "tl-flow-channel-value-code" }, channelLastValuePreview(channel)))
          )
        );
      }) : [_.tr(_.td({ colspan: 6 }, "Nessun channel runtime registrato."))])
    )
  );
};

const renderStatusEdgesPanel = () => {
  const graph = state.edgeRender.graph || currentVisibleGraph();
  const edges = graph.dependencies || state.runtime.dependencies || [];
  return _.table(
    _.thead(_.tr(_.th("Source"), _.th("Target"), _.th("Channel"), _.th("Origin"), _.th("Status"))),
    _.tbody(
      ...(edges.length ? edges.slice(0, 12).map((edge) => {
        const source = nodeById(edge.sourceNodeId);
        const target = nodeById(edge.targetNodeId);
        return _.tr(
          _.td(source?.label || edge.sourceNodeId || "N/D"),
          _.td(target?.label || edge.targetNodeId || "N/D"),
          _.td(edge.channel || "runtime"),
          _.td(edge.metadata?.source || (edge.connectionId ? "tl_connections" : "tl_runtime_dependencies")),
          _.td(
            _.button({
              type: "button",
              class: "tl-flow-channel-link",
              onclick: () => selectEdge(edge),
            }, edge.status || "active")
          )
        );
      }) : [_.tr(_.td({ colspan: 5 }, "Nessun edge o collegamento runtime registrato."))])
    )
  );
};

const renderStatusBusPanel = () =>
  _.div(
    { class: "tl-flow-status-grid" },
    ...[
      ["Available", state.liveBus.available ? "yes" : "no"],
      ["Connected", state.liveBus.connected ? "yes" : "no"],
      ["Live events", state.liveBus.count],
      ["Last channel", state.liveBus.lastChannel || "N/D"],
      ["Last event", state.liveBus.lastAt ? formatShortDate(state.liveBus.lastAt) : "N/D"],
      ["Transport", typeof BroadcastChannel === "undefined" ? "local only" : "BroadcastChannel"],
    ].map(([label, value]) => _.div(_.span(label), _.strong(String(value))))
  );

const renderStatusWorkerPanel = () =>
  _.div(
    { class: "tl-flow-status-grid" },
    ...[
      ["Available", state.runtimeWorker.available ? "yes" : "no"],
      ["Connected", state.runtimeWorker.connected ? "yes" : "no"],
      ["Mode", state.runtimeWorker.mode || "none"],
      ["Status", state.runtimeWorker.status || "idle"],
      ["Workspace", state.runtimeWorker.workspaceId || state.filters.workspaceId || "workspace_global"],
      ["Worker nodes", state.runtimeWorker.nodes || 0],
      ["Worker edges", state.runtimeWorker.dependencies || 0],
      ["Last refresh", state.runtimeWorker.lastRefreshAt ? formatShortDate(state.runtimeWorker.lastRefreshAt) : "N/D"],
      ["Error", state.runtimeWorker.error || "none"],
    ].map(([label, value]) => _.div(_.span(label), _.strong(String(value))))
  );

const renderStatusTimelinePanel = () => {
  const rows = channelTimeline(28);
  return _.div(
    { class: "tl-flow-timeline" },
    ...(rows.length ? rows.map((row) =>
      _.div(
        { class: `tl-flow-timeline-row is-${String(row.status || "ok").toLowerCase()}` },
        _.span({ class: "tl-flow-timeline-time" }, formatShortDate(row.createdAt)),
        _.span({ class: "tl-flow-timeline-dot" }),
        _.div(
          _.strong(`${row.channel} · ${row.type}`),
          _.span(`${row.nodeId} · ${row.detail || "N/D"}`)
        )
      )
    ) : [_.p({ class: "tl-flow-muted" }, "Nessun evento o flow log per la timeline corrente.")])
  );
};

const renderStatusRuntimePanel = () => {
  const stats = runtimeOverviewStats();
  const rows = [
    ["Nodes", state.runtime.nodes.length],
    ["Connections", state.runtime.dependencies.length],
    ["Channels", state.runtime.channels.length],
    ["Events", state.runtime.events.length],
    ["Flow logs", state.runtime.flowLogs?.length || 0],
    ["Runtime", stats.runtime],
    ["Draft", stats.draft],
    ["Configured", stats.configured],
    ["Scope", state.filters.workspaceId || "workspace_global"],
  ];
  return _.div(
    { class: "tl-flow-status-grid" },
    ...rows.map(([label, value]) => _.div(_.span(label), _.strong(String(value))))
  );
};

const renderStatusEventsPanel = () => {
  const events = recentEvents();
  return _.table(
    _.thead(_.tr(_.th("Time"), _.th("Channel"), _.th("Event"), _.th("Source"), _.th("Size"))),
    _.tbody(
      ...(events.length ? events.map((event) =>
        _.tr(
          _.td(formatShortDate(event.createdAt)),
          _.td(event.channel || "default"),
          _.td(eventTypeChip(event)),
          _.td(event.sourceLabel || event.sourceNodeId || "runtime"),
          _.td(`${event.sizeBytes || 0} B`)
        )
      ) : [_.tr(_.td({ colspan: 5 }, "Nessun evento runtime registrato."))])
    )
  );
};

const renderStatusLogsPanel = (level = "all") => {
  const logs = recentFlowLogs(level);
  return _.table(
    _.thead(_.tr(_.th("Time"), _.th("Level"), _.th("Message"), _.th("Node"), _.th("Connection"), _.th(""))),
    _.tbody(
      ...(logs.length ? logs.map((log) =>
        _.tr(
          _.td(formatShortDate(log.createdAt)),
          _.td(logLevelChip(log.level || "info")),
          _.td(log.message || log.context?.action || "runtime log"),
          _.td(log.nodeId || log.context?.sourceNodeId || "runtime"),
          _.td(log.connectionId || log.context?.connectionId || "N/D"),
          _.td(btn({
            class: "is-compact",
            title: "Open log detail",
            onclick: () => openFlowRecordDialog({
              title: log.message || "Flow log",
              subtitle: formatShortDate(log.createdAt),
              iconName: (log.level || "info") === "error" ? "error" : "receipt_long",
              record: log,
            }),
          }, icon("data_object", "sm")))
        )
      ) : [_.tr(_.td({ colspan: 6 }, level === "all" ? "Nessun flow log runtime registrato." : `Nessun log ${level}.`))])
    )
  );
};

const renderStatusPopover = () => {
  const active = statusItems().find((item) => item.id === state.activeStatusPanel);
  if (!active) return null;
  const level = active.id === "warning" || active.id === "error" ? active.id : "all";
  const runId = state.filters.runId || "all";
  return _.div(
    { class: "tl-flow-status-popover" },
    _.div(
      { class: "tl-flow-status-popover-head" },
      _.h2(active.title),
      runId !== "all"
        ? btn({ class: "is-ghost is-compact", title: runId, onclick: () => setFilter("runId", "all") }, icon("filter_alt_off", "sm"), "Run")
        : null,
      _.button({ type: "button", "aria-label": "Close", onclick: () => toggleStatusPanel(active.id) }, icon("close", "sm"))
    ),
    active.id === "runtime" ? renderStatusRuntimePanel()
      : active.id === "edges" ? renderStatusEdgesPanel()
        : active.id === "channels" ? renderStatusChannelsPanel()
          : active.id === "bus" ? renderStatusBusPanel()
            : active.id === "worker" ? renderStatusWorkerPanel()
              : active.id === "timeline" ? renderStatusTimelinePanel()
                : active.id === "events" ? renderStatusEventsPanel()
                  : renderStatusLogsPanel(level)
  );
};

const renderStatusBar = () =>
  _.div(
    { class: "tl-flow-statusbar" },
    renderStatusPopover(),
    _.div(
      { class: "tl-flow-statusbar-items" },
      ...statusItems().map((item) =>
        _.button(
          {
            type: "button",
            class: `tl-flow-statusbar-btn${item.tone ? ` is-${item.tone}` : ""}${state.activeStatusPanel === item.id ? " is-active" : ""}`,
            title: item.title,
            "data-status-item": item.id,
            onclick: () => toggleStatusPanel(item.id),
          },
          icon(item.icon, "sm"),
          _.span({ "data-status-label": item.id }, item.label)
        )
      )
    ),
    _.span({ class: "tl-flow-statusbar-updated", "data-flow-status-updated": "true" }, state.liveBus.lastAt ? `Live ${formatShortDate(state.liveBus.lastAt)}` : `Updated ${formatShortDate(state.updatedAt)}`)
  );

const renderShell = () =>
  _.div(
    { class: "tl-flow-shell" },
    renderHeader(),
    window.TrackerLensSidebar.render({ activeId: "flow" }),
    _.div(
      { class: "tl-flow-main" },
      state.error ? _.div(
        { class: "tl-flow-error", role: "alert" },
        _.span({ class: "tl-flow-error-message" }, state.error),
        _.button(
          {
            type: "button",
            class: "tl-flow-error-close",
            title: "Chiudi errore",
            "aria-label": "Chiudi errore",
            onclick: () => clearFlowMapError({ remount: true }),
          },
          icon("close", "sm")
        )
      ) : null,
      _.div(
        { class: "tl-flow-grid" },
        renderPalette(),
        _.div({ class: "tl-flow-center" }, renderCanvas()),
        renderStatusBar()
      ),
      renderPromptChatTrigger(),
      state.inspectorOpen ? _.div({ class: "tl-flow-inspector-overlay" }, renderInspector()) : null,
      renderNodeContextMenu()
    )
  );
