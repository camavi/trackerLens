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

const nodeMenuCollapsedGroups = () => {
  if (!state.nodeMenuCollapsedGroups) {
    try {
      state.nodeMenuCollapsedGroups = JSON.parse(localStorage.getItem("tl_flow_node_menu_collapsed_groups") || "{}") || {};
    } catch (_) {
      state.nodeMenuCollapsedGroups = {};
    }
  }
  return state.nodeMenuCollapsedGroups;
};

const isNodeMenuGroupCollapsed = (title = "") =>
  Boolean(nodeMenuCollapsedGroups()[title]);

const toggleNodeMenuGroup = (title = "") => {
  const collapsed = nodeMenuCollapsedGroups();
  const nextCollapsed = !collapsed[title];
  if (nextCollapsed) collapsed[title] = true;
  else delete collapsed[title];
  localStorage.setItem("tl_flow_node_menu_collapsed_groups", JSON.stringify(collapsed));
  return nextCollapsed;
};

const applyPaletteSearchDom = () => {
  const query = String(state.paletteSearch || "").trim().toLowerCase();
  let visibleSections = 0;
  document.querySelectorAll("[data-flow-palette-section]").forEach((section) => {
    const groupTitle = section.dataset.flowPaletteSection || "";
    const collapsed = !query && isNodeMenuGroupCollapsed(groupTitle);
    let visibleItems = 0;
    section.querySelectorAll("[data-flow-palette-item]").forEach((item) => {
      const matched = !query || String(item.dataset.flowPaletteSearch || "").includes(query);
      item.hidden = !matched;
      if (matched) visibleItems += 1;
    });
    section.hidden = visibleItems === 0;
    section.classList.toggle("is-collapsed", collapsed);
    const toggle = section.querySelector(".tl-flow-node-menu-section-toggle");
    toggle?.setAttribute?.("aria-expanded", String(!collapsed));
    const toggleIcon = toggle?.querySelector?.(".cms-icon");
    if (toggleIcon) toggleIcon.textContent = collapsed ? "chevron_right" : "expand_more";
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

const renderCanvasNodeMenu = () =>
  (() => {
    const menu = state.contextMenu;
    if (!menu || menu.type !== "canvas") return null;
    const visiblePalette = filteredNodePalette();
    const pendingSource = menu.pendingLink?.sourceId ? nodeById(menu.pendingLink.sourceId) : null;
    return (
      _.div(
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
            class: "tl-flow-context-menu tl-flow-node-menu",
            style: { "--context-x": `${menu.x}px`, "--context-y": `${menu.y}px` },
            onclick: (event) => event.stopPropagation(),
            onpointerdown: (event) => event.stopPropagation(),
          },
          _.div(
            { class: "tl-flow-node-menu-sticky" },
            _.div(
              { class: "tl-flow-context-head" },
              _.strong("Add Node"),
              _.span(pendingSource
                ? `Insert and connect from ${pendingSource.label || pendingSource.id}`
                : "Insert a runtime node on this canvas point")
            ),
            _.Input({
              class: "tl-flow-node-menu-search",
              size: "sm",
              label: "Search nodes",
              type: "text",
              value: state.paletteSearch,
              clearable: true,
              icon: "search",
              autocomplete: "off",
              onInput: (event) => setPaletteSearch(cmsInputValue(event)),
              onKeydown: (event) => event.stopPropagation(),
              onClick: (event) => event.stopPropagation(),
              onPointerDown: (event) => event.stopPropagation(),
            }),
            btn({
              class: "tl-flow-node-menu-create",
              title: "Create custom node",
              "aria-label": "Create custom node",
              onclick: () => {
                closeContextMenu();
                mount({ preserveScroll: true });
                window.setTimeout(() => openNodeBuilderDialog(), 0);
              },
            }, icon("add_box", "sm"))
          ),
        ...nodePalette.map(([title, items]) => {
          const hasVisibleItems = items.some((item) => paletteItemMatchesSearch(item, title));
          const collapsed = isNodeMenuGroupCollapsed(title) && !state.paletteSearch;
          return (
            _.section(
              { class: `tl-flow-node-menu-section${collapsed ? " is-collapsed" : ""}`, "data-flow-palette-section": title, hidden: !hasVisibleItems },
              _.button({
                type: "button",
                class: "tl-flow-node-menu-section-toggle",
                "aria-expanded": String(!collapsed),
                onclick: (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const nextCollapsed = toggleNodeMenuGroup(title);
                  const section = event.currentTarget?.closest?.(".tl-flow-node-menu-section");
                  section?.classList?.toggle?.("is-collapsed", nextCollapsed);
                  event.currentTarget?.setAttribute?.("aria-expanded", String(!nextCollapsed));
                  const toggleIcon = event.currentTarget?.querySelector?.(".cms-icon");
                  if (toggleIcon) toggleIcon.textContent = nextCollapsed ? "chevron_right" : "expand_more";
                },
              }, _.span(title), _.em(String(items.filter((item) => paletteItemMatchesSearch(item, title)).length)), icon(collapsed ? "chevron_right" : "expand_more", "sm")),
              ...items.map((item) =>
                _.button(
                  {
                    type: "button",
                    class: `tl-flow-node-menu-item is-${item.tone || "cyan"}`,
                    title: item.url || item.trackerSource || item.connectionType || item.label,
                    "data-flow-palette-item": item.label,
                    "data-flow-palette-search": paletteSearchText(item, title),
                    hidden: !paletteItemMatchesSearch(item, title),
                    onclick: async () => {
                      await createContextMenuNode(item);
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
          { class: "tl-flow-node-menu-empty", "data-flow-palette-empty": "true", hidden: visiblePalette.length > 0 },
          icon("search_off", "sm"),
          _.strong("No nodes found"),
          _.span("Try another name, type or category.")
        )
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

const dependencySourceHandleSide = (dependency = {}) =>
  dependency.metadata?.sourceHandleSide || "out";

const dependencySourceHandleCorner = (dependency = {}) =>
  dependency.metadata?.sourceHandleCorner || "";

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

const isToolAccessEdge = (dependency = {}) =>
  String(dependency.metadata?.linkType || dependency.mapping?.linkType || "") === "tool-access";

const linkTypeLabel = (value = "") => ({
  data: "Data flow",
  "tool-access": "Agent tool access",
  "optional-hint": "Optional hint",
  "rebuild-trigger": "Rebuild trigger",
  "agent-control": "Agent control",
}[String(value || "data")] || String(value || "data"));

const isAgentBridgeNode = (node = {}) =>
  nodeSubtype(node) === "agent-bridge";

const dependencyEventChannels = (dependency = {}) =>
  [
    dependency.channel,
    dependency.sourcePort,
    dependency.targetPort,
    dependency.metadata?.sourcePort,
    dependency.metadata?.targetPort,
    ...(dependency.channels || []),
  ]
    .filter(Boolean)
    .map((value) => String(value).trim())
    .filter(Boolean);

const dependencyMatchesRuntimeEventChannel = (dependency = {}, eventChannel = "") => {
  const channel = String(eventChannel || "").trim();
  if (!channel) return true;
  const candidates = dependencyEventChannels(dependency);
  return candidates.includes("all") || candidates.includes(channel);
};

const runtimeEventVisualActive = (event = {}, windowMs = EDGE_ACTIVITY_WINDOW_MS) => {
  const created = Date.parse(event.createdAt || "");
  const visualUntil = Date.parse(event.meta?.visualUntil || event.payload?.visualUntil || "");
  if (!Number.isFinite(created)) return false;
  return Date.now() - created <= windowMs || (Number.isFinite(visualUntil) && Date.now() <= visualUntil);
};

const edgeRecentEvent = (dependency = {}) =>
  filteredRuntimeEvents()
    .filter((event) => {
      if (!runtimeEventVisualActive(event)) return false;
      if (event.meta?.dependencyId && event.meta.dependencyId === dependency.id) return true;
      if (event.sourceNodeId === dependency.sourceNodeId) return dependencyMatchesRuntimeEventChannel(dependency, event.channel);
      if (event.targetNodeId === dependency.targetNodeId) return dependencyMatchesRuntimeEventChannel(dependency, event.channel);
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

const agentControlPortCorners = (side = "out") =>
  side === "in" ? ["top-left", "bottom-left"] : ["top-right", "bottom-right"];

const agentControlCornerClass = (corner = "") =>
  corner ? ` is-agent-corner-${corner}` : "";

const agentControlCornerY = (corner = "") =>
  String(corner || "").startsWith("bottom") ? "calc(100% - 14px)" : "14px";

const visualPortInstances = (node = {}, port = {}, side = "out", portIndex = 0, portCount = 1) => {
  if (!isAgentControlPort(port)) {
    return [{ port, portIndex, corner: "", style: { "--port-y": runtimeNodePortY(node, port, side, portIndex, portCount) } }];
  }
  return agentControlPortCorners(side).map((corner) => ({
    port,
    portIndex,
    corner,
    style: { "--port-y": agentControlCornerY(corner) },
  }));
};

const nodeMinHeight = (portCount = 1) =>
  Math.max(138, portCount > 8 ? portCount * 16 + 170 : portCount * 16 + 82);

const portPercentForChannel = (node = {}, channel = "", side = "out") => {
  const ports = nodePortLabels(node, side === "in" ? "in" : "out");
  const index = Math.max(0, ports.findIndex((item) => item === channel));
  const count = Math.max(1, ports.length);
  return nodePortYValue(index, count);
};

const domPortPoint = (nodeId = "", side = "out", port = "", corner = "") => {
  const host = document.querySelector(".tl-flow-canvas");
  const cornerSelector = corner ? `[data-port-corner="${escapeSelectorValue(corner)}"]` : "";
  const selector = `[data-flow-node-id="${escapeSelectorValue(nodeId)}"] .tl-flow-node-port[data-port-side="${side}"][data-port-label="${escapeSelectorValue(port || "all")}"]${cornerSelector}`;
  const element = document.querySelector(selector) ||
    document.querySelector(`[data-flow-node-id="${escapeSelectorValue(nodeId)}"] .tl-flow-node-port[data-port-side="${side}"]`);
  const hostRect = host?.getBoundingClientRect?.();
  const portRect = element?.getBoundingClientRect?.();
  if (!hostRect || !portRect) return null;
  const zoom = state.viewport.zoom || 1;
  const resolvedCorner = corner || element?.dataset?.portCorner || "";
  const anchorSide = resolvedCorner.includes("left")
    ? "left"
    : resolvedCorner.includes("right") || element.classList.contains("is-bridge-right-input")
      ? "right"
      : side === "in" ? "left" : "right";
  const anchorX = anchorSide === "left" ? portRect.left : portRect.right;
  return {
    x: (anchorX - hostRect.left - state.viewport.panX) / zoom,
    y: (portRect.top + portRect.height / 2 - hostRect.top - state.viewport.panY) / zoom,
  };
};

const edgeCanvasBounds = () => {
  const host = document.querySelector(".tl-flow-canvas");
  const rect = host?.getBoundingClientRect?.();
  if (!rect) return null;
  const zoom = Math.max(0.1, Number(state.viewport.zoom) || 1);
  const worldX = -state.viewport.panX / zoom;
  const worldY = -state.viewport.panY / zoom;
  const worldWidth = rect.width / zoom;
  const worldHeight = rect.height / zoom;
  const paddingX = worldWidth * 1.4;
  const paddingY = worldHeight * 1.4;
  const left = Math.round(worldX - paddingX);
  const top = Math.round(worldY - paddingY);
  return {
    width: Math.max(1, Math.round(worldWidth + paddingX * 2)),
    height: Math.max(1, Math.round(worldHeight + paddingY * 2)),
    left,
    top,
    offsetX: -left,
    offsetY: -top,
    rect,
  };
};

const edgePoint = (point = {}, bounds = { offsetX: 0, offsetY: 0 }) => ({
  x: point.x + bounds.offsetX,
  y: point.y + bounds.offsetY,
});

const canvasPoint = (canvas, position, side = "out", offsetY = 0, portPercent = 50) => {
  const width = flowPositionWidth(position);
  const height = nodeMinHeight(1);
  const x = flowWorldNumber(position.x) + (side === "out" ? width : 0);
  const y = flowWorldNumber(position.y) + ((portPercent / 100) * height);
  return {
    x,
    y: y + offsetY,
  };
};

const nodeCanvasPoint = ({ canvas, node, index, side = "out", port = "all", corner = "" }) =>
  (() => {
    const point = domPortPoint(node.id, side, port, corner);
    return point ? point : canvasPoint(canvas, nodePosition(node, index), side, 0, portPercentForChannel(node, port, side));
  })();

const drawBezier = (ctx, from, to, curveOffset = 0, options = {}) => {
  const delta = Math.max(70, Math.abs(to.x - from.x) * 0.42);
  const sourceControlX = options.sourceSide === "left" ? from.x - delta : from.x + delta;
  const targetControlX = options.targetSide === "right" ? to.x + delta : to.x - delta;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.bezierCurveTo(sourceControlX, from.y + curveOffset, targetControlX, to.y + curveOffset, to.x, to.y);
};

const bezierPoint = (from, to, t, curveOffset = 0, options = {}) => {
  const delta = Math.max(70, Math.abs(to.x - from.x) * 0.42);
  const p0 = from;
  const p1 = { x: options.sourceSide === "left" ? from.x - delta : from.x + delta, y: from.y + curveOffset };
  const p2 = { x: options.targetSide === "right" ? to.x + delta : to.x - delta, y: to.y + curveOffset };
  const p3 = to;
  const mt = 1 - t;
  return {
    x: (mt ** 3) * p0.x + 3 * (mt ** 2) * t * p1.x + 3 * mt * (t ** 2) * p2.x + (t ** 3) * p3.x,
    y: (mt ** 3) * p0.y + 3 * (mt ** 2) * t * p1.y + 3 * mt * (t ** 2) * p2.y + (t ** 3) * p3.y,
  };
};

const edgeBezierOptions = (dependency = {}, targetNode = {}) => ({
  sourceSide: dependencySourceHandleSide(dependency) === "in" ? "left" : "right",
  ...(isAgentBridgeNode(targetNode) && dependencyPort(dependency, "in") === "listening" ? { targetSide: "right" } : {}),
});

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
    const from = edgePoint(nodeCanvasPoint({ canvas: { width: rect.width, height: rect.height }, node: sourceNode, index: fromIndex, side: dependencySourceHandleSide(dependency), port: dependencyPort(dependency, "out"), corner: dependencySourceHandleCorner(dependency) }), bounds);
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
  }
  canvas.style.left = `${bounds.left}px`;
  canvas.style.top = `${bounds.top}px`;

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
    const from = edgePoint(nodeCanvasPoint({ canvas: { width: rect.width, height: rect.height }, node: sourceNode, index: fromIndex, side: dependencySourceHandleSide(dependency), port: dependencyPort(dependency, "out"), corner: dependencySourceHandleCorner(dependency) }), bounds);
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
    const isToolAccess = isToolAccessEdge(dependency);
    const isDimmed = state.hoverNodeId && !edgeMatchesHover(dependency);
    if (isLive) hasLiveEdge = true;
    const rgb = isError ? toneRgb("red") : isAgentControl ? toneRgb("cyan") : isToolAccess ? toneRgb("violet") : toneRgb(graphTone(sourceNode));

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
      ctx.setLineDash(dependency.metadata?.virtual ? [8, 7] : isToolAccess ? [5, 7] : isLive ? [12, 10] : []);
      ctx.lineDashOffset = isLive ? -state.edgePhase : 0;
      ctx.stroke();
    }
    ctx.setLineDash([]);

    if (isLive) {
      const particles = isAgentControl ? [0.18, 0.5, 0.82] : [0.24, 0.58, 0.9];
      particles.forEach((base, particleIndex) => {
        const t = (base + (state.edgePhase / 64)) % 1;
        const particle = bezierPoint(from, to, t, offset, bezierOptions);
        const radius = isBus ? 4.8 : 3.8;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = rgba(rgb, particleIndex === 0 ? 0.98 : 0.78);
        ctx.shadowColor = rgba(rgb, 0.78);
        ctx.shadowBlur = 14;
        ctx.fill();
      });
      ctx.shadowBlur = 0;
    }

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
      const from = edgePoint(nodeCanvasPoint({ canvas: { width: rect.width, height: rect.height }, node: sourceNode, index: sourceIndex, side: state.interaction.sourceSide || "out", port: state.interaction.sourcePort || outputPortLabel(sourceNode), corner: state.interaction.sourceCorner || "" }), bounds);
      const to = {
        x: state.interaction.point.x + bounds.offsetX,
        y: state.interaction.point.y + bounds.offsetY,
      };
      const dragBezierOptions = { sourceSide: state.interaction.sourceSide === "in" ? "left" : "right" };
      const rgb = toneRgb(graphTone(sourceNode));
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      drawBezier(ctx, from, to, 0, dragBezierOptions);
      ctx.strokeStyle = rgba(rgb, 0.28);
      ctx.lineWidth = 8;
      ctx.shadowColor = rgba(rgb, 0.42);
      ctx.shadowBlur = 18;
      ctx.stroke();
      drawBezier(ctx, from, to, 0, dragBezierOptions);
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
    const from = nodeCanvasPoint({ canvas: { width: rect.width, height: rect.height }, node: sourceNode, index: fromIndex, side: dependencySourceHandleSide(dependency), port: dependencyPort(dependency, "out"), corner: dependencySourceHandleCorner(dependency) });
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
  if (!live) return null;
  const status = String(live.status || "").toLowerCase();
  const phase = String(live.phase || "").toLowerCase();
  const isOrchestrator = nodeSubtype(node) === "orchestrator";
  if (status === "complete") {
    const completedAt = Date.parse(live.lastAt || 0);
    if (completedAt && Date.now() - completedAt > 5000) return null;
    return { tone: "complete", icon: "check_circle", label: "Task complete" };
  }
  if (status === "error") return { tone: "error", icon: "error", label: "Runtime error" };
  if (status === "overloaded") return { tone: "error", icon: "priority_high", label: "Overloaded" };
  if (status === "queued") return { tone: "waiting", icon: "pending", label: "Queued" };
  if (phase === "received") return { tone: "live", icon: "input", label: "Input received" };
  if (phase === "preparing") return { tone: "planning", icon: "tune", label: "Preparing input" };
  if (phase === "planning") return { tone: "planning", icon: "hub", label: isOrchestrator ? "Planning route" : "Planning" };
  if (phase === "thinking") return { tone: "thinking", icon: "psychology", label: live.targetLabel || "Thinking" };
  if (phase === "waiting") return { tone: "waiting", icon: isOrchestrator ? "hub" : "hourglass_top", label: live.targetLabel ? `Waiting for ${live.targetLabel}` : "Waiting" };
  if (phase === "executing" || phase === "run_node") return { tone: "executing", icon: "bolt", label: live.targetLabel ? `Running ${live.targetLabel}` : "Running node" };
  if (phase === "sending" || phase === "send_result") return { tone: "sending", icon: "send", label: live.targetLabel ? `Sending to ${live.targetLabel}` : "Sending result" };
  if (phase === "emitting") return { tone: "sending", icon: "send", label: live.targetLabel || "Emitting result" };
  if (status === "orchestrating") return { tone: "thinking", icon: "hub", label: isOrchestrator ? "Orchestrating" : "Coordinating" };
  if (status === "busy") return { tone: "executing", icon: "sync", label: "Processing" };
  return { tone: "live", icon: graphIcon(node), label: live.count > 1 ? `${live.count} live events` : "Live event" };
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

const tokenUsageForNode = (node = {}) => {
  const usage = node.metadata?.tokenUsage || {};
  const config = node.metadata?.config || {};
  return {
    totalTokens: Number(usage.totalTokens || config.tokenUsage || 0),
    totalPromptTokens: Number(usage.totalPromptTokens || 0),
    totalCompletionTokens: Number(usage.totalCompletionTokens || 0),
    lastTokens: Number(usage.lastTokens || config.lastTokens || 0),
    lastPromptTokens: Number(usage.lastPromptTokens || 0),
    lastCompletionTokens: Number(usage.lastCompletionTokens || 0),
    provider: usage.provider || config.providerProfile || config.provider || "",
    model: usage.model || config.model || "",
    updatedAt: usage.updatedAt || "",
  };
};

const nodeHasTokenAccounting = (node = {}) => {
  const subtype = nodeSubtype(node);
  const config = node.metadata?.config || {};
  const usage = node.metadata?.tokenUsage || {};
  if (usage.totalTokens || usage.lastTokens || config.tokenUsage || config.lastTokens) return true;
  if (node.type === "aiAgent" || nodeCategory(node) === "ai-agents") return true;
  return nodeCategory(node) === "knowledge" && [
    "knowledge-dictionary-builder",
    "knowledge-event-builder",
    "entity-extractor",
    "world-generator-agent",
    "semantic-relation-enricher",
    "knowledge-graph-builder-agent",
    "graph-query",
    "knowledge-reasoning-composer",
    "embedding-generator",
    "vector-memory",
  ].includes(subtype);
};

const formatTokenCount = (value = 0) => {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return "0";
  if (number >= 1000000) return `${(number / 1000000).toFixed(number >= 10000000 ? 0 : 1)}M`;
  if (number >= 1000) return `${(number / 1000).toFixed(number >= 10000 ? 0 : 1)}k`;
  return String(Math.round(number));
};

const renderNodeTokenMetrics = (node = {}) => {
  if (!nodeHasTokenAccounting(node)) return null;
  const usage = tokenUsageForNode(node);
  const detail = [
    `Total token: ${usage.totalTokens || 0}`,
    `Last token: ${usage.lastTokens || 0}`,
    usage.lastPromptTokens || usage.lastCompletionTokens ? `Prompt/completion: ${usage.lastPromptTokens || 0}/${usage.lastCompletionTokens || 0}` : "",
    usage.provider || usage.model ? `Provider: ${[usage.provider, usage.model].filter(Boolean).join(" · ")}` : "",
    usage.updatedAt ? `Updated: ${formatShortDate(usage.updatedAt)}` : "",
  ].filter(Boolean).join("\n");
  return _.span(
    { class: "tl-flow-node-token-metrics", title: detail || "Token usage" },
    _.span({ class: "tl-flow-node-token-label" }, "total token:"),
    btn({
      class: "tl-flow-token-value-btn",
      title: "Show total token details",
      onPointerDown: stopNodeControlEvent,
      onclick: (event) => {
        event.preventDefault();
        event.stopPropagation();
        requestTokenUsageDetails(node, "total");
      },
    }, formatTokenCount(usage.totalTokens)),
    _.span({ class: "tl-flow-node-token-label" }, "last token:"),
    btn({
      class: "tl-flow-token-value-btn",
      title: "Show last token details",
      onPointerDown: stopNodeControlEvent,
      onclick: (event) => {
        event.preventDefault();
        event.stopPropagation();
        requestTokenUsageDetails(node, "last");
      },
    }, formatTokenCount(usage.lastTokens)),
    btn({
      class: "tl-flow-token-clear-btn",
      "aria-label": "Clear token usage",
      title: "Clear token usage",
      onPointerDown: stopNodeControlEvent,
      onclick: (event) => {
        event.preventDefault();
        event.stopPropagation();
        requestTokenUsageClear(node);
      },
    }, icon("cleaning_services", "sm"))
  );
};

const renderNodeMetrics = (node = {}, ...labels) => {
  const metrics = labels.flat().filter((label) => label !== null && label !== undefined && label !== "");
  return _.span(
    { class: "tl-flow-node-metrics" },
    ...metrics.map((label) => _.em(String(label)))
  );
};

const renderNodeMetricRows = (node = {}, ...labels) => [
  renderNodeMetrics(node, ...labels),
  renderNodeTokenMetrics(node),
].filter(Boolean);

const configBoolEnabled = (value, fallback = true) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return String(value).toLowerCase() !== "false";
};

const aiAgentPolicyLabel = (policy = "") => ({
  connected_event: "connected",
  accepted_input: "accepted",
  manual_only: "manual",
}[String(policy || "connected_event").toLowerCase()] || String(policy || "connected_event"));

const renderAiAgentPolicySummary = (node = {}) => {
  const config = nodeRuntimeConfig(node);
  const readMemory = configBoolEnabled(config.readMemory, true);
  const saveResponses = configBoolEnabled(config.saveResponsesToMemory ?? config.saveResponses, true);
  return _.div(
    { class: "tl-flow-ai-agent-policy-summary" },
    _.span(icon("shield", "sm"), _.strong("Trigger"), aiAgentPolicyLabel(config.triggerPolicy)),
    _.span(icon("memory", "sm"), _.strong("Memory"), `read ${readMemory ? "on" : "off"} · save ${saveResponses ? "on" : "off"}`)
  );
};

const latestOutputPreviewRecordForNode = (node = {}, outputPorts = []) => {
  if (!node?.id) return null;
  const isRuntimeActivityEvent = (event = {}) =>
    event.meta?.runtimeActivityVisual ||
    String(event.eventType || "").toLowerCase().includes("_runtime_activity") ||
    String(event.eventType || "").toLowerCase().endsWith("_activity");
  const outputNames = new Set([
    ...(outputPorts || []).map((port) => port.name || port.id || port.key || port.channel),
    ...(node.outputs || []),
    ...(node.channels || []),
  ].filter(Boolean).map(String).filter((name) => name !== "all"));
  return (state.runtime.events || [])
    .filter(isPreviewPayloadEvent)
    .filter((event) => !isRuntimeActivityEvent(event))
    .filter((event) => event.sourceNodeId === node.id || event.meta?.executedNodeId === node.id || event.meta?.knowledgeRuntime === node.id || event.meta?.aiAgentRuntime === node.id)
    .sort((a, b) => {
      const createdDiff = Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0);
      if (createdDiff) return createdDiff;
      const aDirect = outputNames.has(String(a.channel || "")) ? 1 : 0;
      const bDirect = outputNames.has(String(b.channel || "")) ? 1 : 0;
      return bDirect - aDirect;
    })
    .map((event) => {
      const sourcePayload = event.originalPayload !== undefined && event.originalPayload !== null ? event.originalPayload : event.payload;
      return {
        eventId: event.id || "",
        channel: event.channel || "runtime",
        eventType: event.eventType || "event",
        sourceNodeId: event.sourceNodeId || node.id,
        payload: sourcePayload,
        rawPayload: event.payload,
        originalPayload: event.originalPayload !== undefined && event.originalPayload !== null && event.originalPayload !== event.payload ? event.payload : null,
        createdAt: event.createdAt || new Date().toISOString(),
        sizeBytes: event.sizeBytes || 0,
      };
    })[0] || null;
};

const renderNodeOutputPreviewButton = (node = {}, outputPorts = []) => {
  const record = latestOutputPreviewRecordForNode(node, outputPorts);
  return btn({
    class: `tl-flow-node-out-preview-btn${record ? "" : " is-empty"}`,
    "data-flow-node-out-preview-btn": node.id || "",
    "aria-label": `View ${node.label || node.id || "node"} OUT payload`,
    title: record
      ? `View OUT payload: ${record.channel} · ${record.eventType} · ${formatShortDate(record.createdAt)}`
      : "No OUT payload yet",
    disabled: !record,
    onPointerDown: (event) => {
      event.preventDefault();
      event.stopPropagation();
    },
    onclick: (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!record) return;
      openPreviewPayloadDialog(node, {
        record,
        previewKey: `${node.id || "node"}_out_preview`,
        title: `${node.label || "Node"} OUT payload`,
        subtitle: `${record.channel || "runtime"} · ${record.eventType || "event"} · ${formatShortDate(record.createdAt)}`,
        icon: "visibility",
      });
    },
  }, _.span({ class: "tl-flow-node-out-preview-label" }, "OUT"), icon("visibility", "sm"));
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
      const agentRuntime = typeof aiAgentRuntimeActivity === "function" ? aiAgentRuntimeActivity(node) : null;
      const runtimeStatus = ["busy", "queued", "overloaded"].includes(live?.status) ? live.status : "";
      footerInfo.textContent = perf
        ? `${performanceLabel(perf)} · ${perf.health || perf.status || "perf"}`
        : agentRuntime ? `${agentRuntime.label}${agentRuntime.stepLabel ? ` · ${agentRuntime.stepLabel}` : ""}`
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

    const outputPreviewButton = document.querySelector(`[data-flow-node-out-preview-btn="${escapeSelectorValue(node.id)}"]`);
    if (outputPreviewButton) {
      if (isPreviewNode(node)) outputPreviewButton.remove();
      else outputPreviewButton.replaceWith(renderNodeOutputPreviewButton(node, nodePorts(node, "out")));
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
    updateFlowMinimapDom();
  });
};

const canDeleteRuntimeCanvasNode = (node = null) =>
  Boolean(node && !node.metadata?.library && (
    isDraftNode(node) ||
    isInlineConfigNode(node) ||
    isEmbeddedFlowMapNode(node) ||
    isFlowBoundaryNode(node)
  ));

const renderNodeQuickActions = (node, view) => {
  if (!node?.id || node.metadata?.library) return null;
  const paused = view.runtime.status === "paused";
  const disabled = view.runtime.status === "disabled";
  const canDeleteRuntimeNode = canDeleteRuntimeCanvasNode(node);
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
      title: "Delete node. Alt/Option+click deletes immediately.",
      onclick: (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.altKey) performDraftNodeDelete(node);
        else requestDraftNodeDelete(node);
      },
    }, icon("delete", "sm")) : null
  );
};

const renderFlowPortNodeBody = (node, view) => {
  const direction = flowPortDirection(node);
  const isInputGateway = direction === "out";
  const ports = flowPortDefinitions(node);
  const sideLabel = isInputGateway ? "porte a destra" : "porte a sinistra";
  const title = isInputGateway ? "Flow Input Gateway" : "Flow Output Gateway";
  return _.div(
    { class: `tl-flow-port-node-body ${isInputGateway ? "is-flow-in" : "is-flow-out"}` },
    _.div(
      { class: "tl-flow-port-node-head" },
      _.span(
        { class: "tl-flow-port-node-kicker" },
        icon(isInputGateway ? "login" : "logout", "sm"),
        _.strong(isInputGateway ? "IN" : "OUT")
      ),
      btn({
        type: "button",
        class: "tl-flow-port-add-btn",
        title: "Add port",
        onPointerDown: stopNodeControlEvent,
        onclick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          requestFlowPortDialog(node);
        },
      }, icon("add", "sm"), "Add port")
    ),
    _.p(`${title} · ${sideLabel}`),
    _.div(
      { class: "tl-flow-port-node-list" },
      ...ports.map((port) => _.button(
        {
          type: "button",
          class: `tl-flow-port-node-row is-${port.type}`,
          title: `Modifica ${port.name}`,
          onPointerDown: stopNodeControlEvent,
          onclick: (event) => {
            event.preventDefault();
            event.stopPropagation();
            requestFlowPortDialog(node, port.name);
          },
        },
        _.span({ class: "tl-flow-port-node-name" }, port.name),
        _.em(flowPortTypeLabel(port.type)),
        icon("edit", "sm")
      ))
    ),
    ...renderNodeMetricRows(node, `${ports.length} porte`, view.runtime.status, isInputGateway ? "entry" : "exit")
  );
};

const renderKnowledgeGraphQueryScope = (node = {}) => {
  const config = nodeRuntimeConfig(node);
  const documentId = String(config.documentId || "").trim();
  const collectionId = String(config.collectionId || "").trim();
  const scope = documentId ? "document" : collectionId ? "collection" : "workspace";
  const shortValue = (value = "") => {
    const clean = String(value || "").trim();
    return clean.length > 22 ? `${clean.slice(0, 10)}...${clean.slice(-7)}` : clean || "all";
  };
  return _.div(
    { class: "tl-flow-kg-query-scope", title: `Scope: ${scope} · Collection: ${collectionId || "all"} · Document: ${documentId || "all"}` },
    _.span(icon("filter_alt", "sm"), _.strong("Scope"), _.em(scope)),
    _.span(icon("folder", "sm"), _.strong("Collection"), _.em(shortValue(collectionId))),
    _.span(icon("description", "sm"), _.strong("Document"), _.em(shortValue(documentId)))
  );
};

const AI_AGENT_RUNTIME_STATUS_LABELS = {
  idle: "Idle",
  queued: "Queued",
  working: "Working",
  planning: "Planning",
  waiting_for_tools: "Using tools",
  waiting_for_user: "Waiting for user",
  waiting_for_permission: "Waiting for permission",
  running_llm: "Calling model",
  emitting: "Emitting output",
  complete: "Complete",
  completed: "Complete",
  fallback: "Fallback",
  warning: "Warning",
  error: "Error",
  cancelled: "Cancelled",
  paused: "Paused",
};

const aiAgentRuntimeStatusLabel = (status = "") =>
  AI_AGENT_RUNTIME_STATUS_LABELS[String(status || "").toLowerCase()] || status || "Idle";

const aiAgentRuntimeStatusTone = (status = "") => {
  const value = String(status || "").toLowerCase();
  if (["complete", "completed"].includes(value)) return "complete";
  if (["error", "cancelled"].includes(value)) return "error";
  if (["waiting_for_user", "waiting_for_permission", "fallback", "paused", "warning"].includes(value)) return "warn";
  if (["working", "planning", "waiting_for_tools", "running_llm", "emitting", "queued"].includes(value)) return "online";
  return "idle";
};

const aiAgentJobTime = (job = {}) =>
  Date.parse(job.updatedAt || job.raw?.updatedAt || job.startedAt || job.raw?.createdAt || 0) || 0;

const latestAiAgentJobs = async (node = {}, limit = 8) => {
  const data = await window.TrackerLensAiRuntimeStore?.list?.().catch(() => null);
  return (data?.jobs || [])
    .filter((job) => job.agentId === node.id || job.raw?.agentId === node.id || job.raw?.runtimeNodeId === node.id)
    .sort((a, b) => aiAgentJobTime(b) - aiAgentJobTime(a))
    .slice(0, limit);
};

const aiAgentRuntimeDialogViews = new Map();

const updateAiAgentRuntimeDialogView = async (entry = {}) => {
  if (!entry.node?.id || !entry.body?.isConnected) {
    if (entry.node?.id) aiAgentRuntimeDialogViews.delete(entry.node.id);
    return;
  }
  const jobs = await latestAiAgentJobs(entry.node);
  entry.body.replaceChildren(renderAiAgentRuntimeDialogContent({ node: entry.node, jobs }));
};

const refreshOpenAiAgentRuntimeDialog = (event = {}) => {
  const nodeId = event.sourceNodeId || event.meta?.aiAgentRuntime || event.meta?.knowledgeRuntime || event.payload?.agentId || event.payload?.nodeId || "";
  if (!nodeId) return;
  const entry = aiAgentRuntimeDialogViews.get(nodeId);
  if (!entry || entry.raf) return;
  entry.raf = requestAnimationFrame(() => {
    entry.raf = 0;
    updateAiAgentRuntimeDialogView(entry);
  });
};

const aiAgentRuntimeResultSummary = (job = null) => {
  const raw = job?.raw || {};
  const result = raw.result && typeof raw.result === "object" ? raw.result : {};
  const response = result.response && typeof result.response === "object" ? result.response : null;
  const text = result.text || response?.summary || response?.answer || response?.text || response?.message || result.preview || job?.message || raw.error || "";
  if (text) return String(text).trim();
  return "";
};

const aiAgentRuntimeOutputMeta = (job = null, text = "") => {
  const raw = job?.raw || {};
  const result = raw.result && typeof raw.result === "object" ? raw.result : {};
  const usage = result.usage || raw.usage || {};
  const finishReason = result.finishReason || raw.finishReason || "";
  const chars = String(text || "").length;
  const tokens = Number(raw.tokens || job?.tokens || usage.totalTokens || usage.total_tokens || 0);
  return { chars, tokens, finishReason };
};

const openAiAgentRuntimeFullOutputDialog = ({ node = {}, text = "", meta = {} } = {}) => {
  const dialog = _.Dialog({
    class: "tl-ai-agent-runtime-output-dialog",
    panelClass: "tl-ai-agent-runtime-output-panel",
    size: "lg",
    title: "Agent Output",
    subtitle: node.label || node.id,
    icon: "article",
    closeButton: true,
    scrollable: true,
    bodyMaxHeight: "76vh",
    content: () => _.div(
      { class: "tl-ai-agent-runtime-full-output" },
      _.div(
        { class: "tl-ai-agent-runtime-output-meta" },
        _.span(icon("text_fields", "sm"), `${meta.chars || 0} chars`),
        meta.tokens ? _.span(icon("token", "sm"), `${meta.tokens} tokens`) : null,
        meta.finishReason ? _.span(icon(meta.finishReason === "length" ? "warning_amber" : "check_circle", "sm"), `finish: ${meta.finishReason}`) : null
      ),
      _.pre(text)
    ),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: () => copyRuntimeValue(text) }, icon("content_copy", "sm"), "Copy"),
      btn({ onclick: close }, "Close")
    ),
  });
  dialog.open();
};

const aiAgentRuntimePromptText = (job = null) => {
  const raw = job?.raw || {};
  const result = raw.result && typeof raw.result === "object" ? raw.result : {};
  return String(raw.prompt || result.prompt || raw.inputTrace?.prompt || result.inputTrace?.prompt || "");
};

const aiAgentRuntimeTraceData = (job = null) => {
  const raw = job?.raw || {};
  const result = raw.result && typeof raw.result === "object" ? raw.result : {};
  const trace = raw.inputTrace && typeof raw.inputTrace === "object"
    ? raw.inputTrace
    : result.inputTrace && typeof result.inputTrace === "object"
      ? result.inputTrace
      : {};
  return {
    inputEvent: trace.inputEvent || {
      channel: raw.task || result.inputChannel || "",
      runId: raw.runId || result.runId || "",
    },
    trigger: trace.trigger || {},
    objective: trace.objective || result.response?.objective || "",
    payload: trace.payload || result.payload || null,
    config: trace.config || {},
    prompt: trace.prompt || aiAgentRuntimePromptText(job),
    promptChars: trace.promptChars || aiAgentRuntimePromptText(job).length,
    memoryContext: trace.memoryContext ?? raw.memoryContext ?? result.memoryContext ?? "",
    memoryChars: trace.memoryChars ?? String(raw.memoryContext || result.memoryContext || "").length,
    inputDataContext: trace.inputDataContext ?? raw.inputDataContext ?? result.inputDataContext ?? null,
    ragContext: trace.ragContext ?? raw.ragContext ?? result.ragContext ?? null,
    graphContext: trace.graphContext ?? raw.graphContext ?? result.graphContext ?? null,
    toolContext: trace.toolContext ?? raw.toolContext ?? result.toolContext ?? null,
  };
};

const aiAgentRuntimeFullTraceData = (job = null) => {
  const raw = job?.raw || {};
  const result = raw.result && typeof raw.result === "object" ? raw.result : {};
  return {
    id: job?.id || raw.id || "",
    workspaceId: job?.workspaceId || raw.workspaceId || "",
    runId: job?.runId || raw.runId || "",
    nodeId: job?.agentId || raw.agentId || raw.runtimeNodeId || "",
    nodeLabel: job?.agent || raw.agent || "",
    task: job?.task || raw.task || "",
    status: raw.runtimeStatus || job?.status || raw.status || "",
    provider: job?.provider || raw.provider || result.provider || "",
    model: job?.model || raw.model || result.model || "",
    durationMs: job?.durationMs || raw.durationMs || 0,
    tokens: job?.tokens || raw.tokens || 0,
    currentStep: raw.currentStep || null,
    steps: Array.isArray(raw.steps) ? raw.steps : [],
    inputTrace: aiAgentRuntimeTraceData(job),
    result,
    error: raw.error || result.error || "",
    updatedAt: job?.updatedAt || raw.updatedAt || "",
    raw,
  };
};

const aiAgentRuntimeJsonText = (value = null) => {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return String(value ?? "");
  }
};

const openAiAgentRuntimePromptDialog = ({ node = {}, job = null } = {}) => {
  const prompt = aiAgentRuntimePromptText(job);
  const dialog = _.Dialog({
    class: "tl-ai-agent-runtime-prompt-dialog",
    panelClass: "tl-ai-agent-runtime-prompt-panel",
    size: "lg",
    title: "Full Prompt",
    subtitle: node.label || node.id,
    icon: "article",
    closeButton: true,
    scrollable: true,
    bodyMaxHeight: "76vh",
    content: () => _.div(
      { class: "tl-ai-agent-runtime-full-output" },
      _.div({ class: "tl-ai-agent-runtime-output-meta" }, _.span(icon("text_fields", "sm"), `${prompt.length} chars`)),
      _.pre(prompt || "No prompt recorded for this run.")
    ),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: () => copyRuntimeValue(prompt) }, icon("content_copy", "sm"), "Copy"),
      btn({ onclick: close }, "Close")
    ),
  });
  dialog.open();
};

const openAiAgentRuntimeTraceDialog = ({ node = {}, job = null } = {}) => {
  const trace = aiAgentRuntimeFullTraceData(job);
  const traceText = aiAgentRuntimeJsonText(trace);
  const dialog = _.Dialog({
    class: "tl-ai-agent-runtime-trace-dialog",
    panelClass: "tl-ai-agent-runtime-trace-panel",
    size: "lg",
    title: "Full Runtime Trace",
    subtitle: node.label || node.id,
    icon: "account_tree",
    closeButton: true,
    scrollable: true,
    bodyMaxHeight: "76vh",
    content: () => _.div(
      { class: "tl-ai-agent-runtime-full-output" },
      _.div({ class: "tl-ai-agent-runtime-output-meta" }, _.span(icon("data_object", "sm"), `${traceText.length} chars`)),
      _.pre(traceText)
    ),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: () => copyRuntimeValue(trace) }, icon("content_copy", "sm"), "Copy"),
      btn({ onclick: close }, "Close")
    ),
  });
  dialog.open();
};

const aiAgentRuntimeExecutionSummary = (job = null, steps = []) => {
  const raw = job?.raw || {};
  const result = raw.result && typeof raw.result === "object" ? raw.result : {};
  const provider = raw.provider || job?.provider || result.provider || "";
  const model = raw.model || job?.model || result.model || "";
  const duration = raw.durationMs || job?.durationMs || result.latencyMs || 0;
  const tokens = raw.tokens || job?.tokens || result.usage?.totalTokens || 0;
  if (Array.isArray(result.debug) || result.counts || result.preview) {
    const counts = result.counts || {};
    const countText = Object.entries(counts)
      .filter(([, value]) => Number.isFinite(Number(value)))
      .map(([key, value]) => `${key}=${value}`)
      .join(", ");
    return [
      `Processed ${raw.task || job?.task || "knowledge runtime event"}.`,
      provider || model ? `Provider: ${[provider, model].filter(Boolean).join(" · ")}.` : "",
      result.promptMode ? `Prompt mode: ${result.promptMode}.` : "",
      result.fallbackReason ? `Fallback: ${result.fallbackReason}.` : "",
      result.error ? `Runtime warning: ${result.error}.` : "",
      countText ? `Output counts: ${countText}.` : "",
      duration ? `Duration: ${duration}ms.` : "",
      tokens ? `Token usage: ${tokens}.` : "",
    ].filter(Boolean).join(" ");
  }
  const toolStep = steps.find((step) => step?.type === "connected_tools");
  const outputStep = [...steps].reverse().find((step) => step?.type === "emit");
  const toolCalls = toolStep?.payload?.calls?.length || 0;
  const toolObservations = toolStep?.payload?.observations?.length || 0;
  const outputChannel = outputStep?.payload?.outputChannel || result.outputChannel || "";
  const parts = [
    `Received ${raw.task || job?.task || "runtime event"}.`,
    toolCalls || toolObservations
      ? `Used ${toolCalls} connected tool call${toolCalls === 1 ? "" : "s"} and collected ${toolObservations} observation${toolObservations === 1 ? "" : "s"}.`
      : "No connected tools were required.",
    provider || model ? `Called ${[provider, model].filter(Boolean).join(" · ")}${duration ? ` in ${duration}ms` : ""}.` : "",
    tokens ? `Token usage: ${tokens}.` : "",
    outputChannel ? `Emitted output on ${outputChannel}.` : "",
  ].filter(Boolean);
  return parts.join(" ");
};

const normalizeAiAgentRuntimeSteps = (steps = []) =>
  (steps || []).reduce((list, step) => {
    const status = String(step?.status || "").toLowerCase();
    const replaceIndex = step?.type && ["complete", "completed", "warning", "error", "fallback", "skipped"].includes(status)
      ? list.map((item) => item?.type).lastIndexOf(step?.type)
      : -1;
    if (replaceIndex >= 0 && String(list[replaceIndex]?.status || "").toLowerCase() === "working") {
      list[replaceIndex] = {
        ...list[replaceIndex],
        ...step,
        id: list[replaceIndex].id || step.id,
        startedAt: list[replaceIndex].startedAt || step.startedAt,
      };
      return list;
    }
    list.push(step);
    return list;
  }, []);

const renderAiAgentRuntimeStep = (step = {}, index = 0, { open = false } = {}) => {
  const status = step.status || "complete";
  const tone = aiAgentRuntimeStatusTone(status);
  const payload = step.payload && typeof step.payload === "object" ? step.payload : null;
  return _.details(
    { class: `tl-ai-agent-runtime-step is-${tone}`, ...(open ? { open: true } : {}) },
    _.summary(
      { class: "tl-ai-agent-runtime-step-head" },
      _.span({ class: "tl-ai-agent-runtime-step-index" }, String(index + 1)),
      _.strong(step.label || step.type || "Runtime step"),
      _.span({ class: `tl-ai-agent-runtime-pill is-${tone}` }, aiAgentRuntimeStatusLabel(status)),
      icon("expand_more", "sm")
    ),
    _.div(
      { class: "tl-ai-agent-runtime-step-main" },
      step.summary ? _.p(step.summary) : null,
      step.detail ? _.small(step.detail) : null,
      payload ? _.pre({ class: "tl-ai-agent-runtime-payload" }, JSON.stringify(payload, null, 2)) : null
    )
  );
};

const renderAiAgentRuntimeOutput = ({ node = {}, job = null, text = "" } = {}) => {
  const meta = aiAgentRuntimeOutputMeta(job, text);
  return _.div(
    { class: "tl-ai-agent-runtime-output" },
    _.div(
      { class: "tl-ai-agent-runtime-output-head" },
      _.h4(node.type === "aiAgent" ? "Agent Output" : "Runtime Output"),
      _.div(
        { class: "tl-ai-agent-runtime-output-actions" },
        _.span({ class: `tl-ai-agent-runtime-pill is-${meta.finishReason === "length" ? "warn" : "complete"}` }, meta.finishReason ? `finish: ${meta.finishReason}` : "output"),
        _.span({ class: "tl-ai-agent-runtime-output-stat" }, `${meta.chars} chars`),
        meta.tokens ? _.span({ class: "tl-ai-agent-runtime-output-stat" }, `${meta.tokens} tokens`) : null,
        btn({ class: "is-ghost is-compact", title: "Copy full output", onclick: () => copyRuntimeValue(text) }, icon("content_copy", "sm"), "Copy"),
        btn({
          class: "is-ghost is-compact",
          title: "Open full output",
          onclick: () => openAiAgentRuntimeFullOutputDialog({ node, text, meta }),
        }, icon("open_in_full", "sm"), "Full Output")
      )
    ),
    meta.finishReason === "length"
      ? _.div({ class: "tl-ai-agent-runtime-output-warning" }, icon("warning_amber", "sm"), _.span("Output stopped by max tokens. Increase Max Tokens to continue longer generations."))
      : null,
    _.p(String(text || ""))
  );
};

const renderAiAgentRuntimeInputTrace = ({ node = {}, job = null } = {}) => {
  const trace = aiAgentRuntimeTraceData(job);
  const inputDataChannels = trace.inputDataContext && typeof trace.inputDataContext === "object"
    ? Object.keys(trace.inputDataContext).length
    : 0;
  const toolObservations = Array.isArray(trace.toolContext?.observations) ? trace.toolContext.observations.length : 0;
  const trigger = trace.trigger || {};
  const hasMemory = Boolean(String(trace.memoryContext || "").trim());
  const hasPrompt = Boolean(String(trace.prompt || "").trim());
  return _.div(
    { class: "tl-ai-agent-runtime-trace-card" },
    _.div(
      { class: "tl-ai-agent-runtime-output-head" },
      _.h4("Input Trace"),
      _.div(
        { class: "tl-ai-agent-runtime-output-actions" },
        btn({
          class: "is-ghost is-compact",
          title: "Open full prompt sent to the model",
          disabled: !hasPrompt,
          onclick: () => openAiAgentRuntimePromptDialog({ node, job }),
        }, icon("article", "sm"), "Full Prompt"),
        btn({
          class: "is-ghost is-compact",
          title: "Open full runtime trace with every prompt attempt, step and result",
          onclick: () => openAiAgentRuntimeTraceDialog({ node, job }),
        }, icon("account_tree", "sm"), "Full Runtime")
      )
    ),
    _.div(
      { class: "tl-ai-agent-runtime-trace-grid" },
      _.span(icon("input", "sm"), _.strong("channel"), trace.inputEvent?.channel || "unknown"),
      _.span(icon("bolt", "sm"), _.strong("trigger"), trigger.mode || "unknown"),
      _.span(icon("shield", "sm"), _.strong("policy"), trigger.triggerPolicy || trace.config?.triggerPolicy || "connected_event"),
      _.span(icon("account_tree", "sm"), _.strong("from"), trigger.sourceLabel || trigger.sourceNodeId || "unknown"),
      _.span(icon("link", "sm"), _.strong("link"), trigger.dependencyId || trigger.connectionId || trigger.dependencyChannel || "none"),
      _.span(icon("article", "sm"), _.strong("prompt"), `${trace.promptChars || 0} chars`),
      _.span(icon("memory", "sm"), _.strong("memory"), hasMemory ? `${trace.memoryChars || String(trace.memoryContext || "").length} chars` : "none"),
      _.span(icon("history", "sm"), _.strong("history"), inputDataChannels ? `${inputDataChannels} channel${inputDataChannels === 1 ? "" : "s"}` : "none"),
      _.span(icon("construction", "sm"), _.strong("tools"), toolObservations ? `${toolObservations} observation${toolObservations === 1 ? "" : "s"}` : "none"),
      trace.objective ? _.span({ class: "is-wide" }, icon("flag", "sm"), _.strong("objective"), String(trace.objective)) : null
    )
  );
};

const renderAiAgentRuntimeDialogContent = ({ node = {}, jobs = [] } = {}) => {
  const latest = jobs[0] || null;
  const raw = latest?.raw || {};
  const steps = normalizeAiAgentRuntimeSteps(Array.isArray(raw.steps) ? raw.steps : []);
  const status = raw.runtimeStatus || latest?.status || raw.status || node.runtime?.status || node.status || "idle";
  const tone = aiAgentRuntimeStatusTone(status);
  const agentOutputText = aiAgentRuntimeResultSummary(latest);
  return _.div(
    { class: "tl-ai-agent-runtime-dialog-body" },
    _.div(
      { class: "tl-ai-agent-runtime-summary" },
      _.span({ class: `tl-ai-agent-runtime-pill is-${tone}` }, aiAgentRuntimeStatusLabel(status)),
        _.span(icon("assignment", "sm"), latest?.task || raw.task || "No task yet"),
        _.span(icon("dns", "sm"), [latest?.provider || raw.provider || "", latest?.model || raw.model || ""].filter(Boolean).join(" · ") || "No provider run"),
      _.span(icon("schedule", "sm"), latest?.durationMs ? `${latest.durationMs}ms` : raw.updatedAt || latest?.updatedAt || ""),
      window.TrackerLensAiAgentEditor?.openMemoryManager ? btn({
        class: "is-ghost is-compact",
        onclick: () => window.TrackerLensAiAgentEditor.openMemoryManager({ ...node, name: node.label || node.id, nodeId: node.id, runtimeNodeId: node.id, workspaceId: node.workspaceId || raw.workspaceId || "" }),
      }, icon("memory", "sm"), "Memory") : null
    ),
    latest
      ? _.div(
        { class: "tl-ai-agent-runtime-current" },
        _.strong(["complete", "completed"].includes(String(status).toLowerCase()) ? "Run Summary" : "Current Run"),
        _.p(aiAgentRuntimeExecutionSummary(latest, steps) || raw.currentStep?.summary || "Runtime job recorded."),
        raw.error ? _.pre({ class: "tl-ai-agent-runtime-error" }, String(raw.error)) : null
      )
      : _.div(
        { class: "tl-ai-agent-runtime-empty" },
        icon("terminal", "md"),
        _.strong("No runtime jobs yet"),
        _.p("Run this Agent from a connected input event to populate the runtime timeline.")
      ),
    latest ? renderAiAgentRuntimeInputTrace({ node, job: latest }) : null,
    steps.length
      ? _.div(
        { class: "tl-ai-agent-runtime-timeline" },
        _.h4("Timeline"),
        ...steps.map((step, index) => renderAiAgentRuntimeStep(step, index, { open: index === steps.length - 1 }))
      )
      : null,
    agentOutputText
      ? renderAiAgentRuntimeOutput({ node, job: latest, text: agentOutputText })
      : null,
    jobs.length > 1
      ? _.div(
        { class: "tl-ai-agent-runtime-history" },
        _.h4("Recent Runs"),
        ...jobs.slice(1).map((job) => {
          const jobRaw = job.raw || {};
          const jobStatus = jobRaw.runtimeStatus || job.status || jobRaw.status || "";
          const jobTone = aiAgentRuntimeStatusTone(jobStatus);
          return _.div(
            { class: "tl-ai-agent-runtime-history-row" },
            _.span({ class: `tl-ai-agent-runtime-pill is-${jobTone}` }, aiAgentRuntimeStatusLabel(jobStatus)),
            _.strong(job.task || jobRaw.task || job.id),
            _.small(job.updatedAt || jobRaw.updatedAt || job.startedAt || "")
          );
        })
      )
      : null
  );
};

const openAiAgentRuntimeDialog = async (node = {}) => {
  const jobs = await latestAiAgentJobs(node);
  const body = _.div(
    { class: "tl-ai-agent-runtime-live-root" },
    renderAiAgentRuntimeDialogContent({ node, jobs })
  );
  aiAgentRuntimeDialogViews.set(node.id, { node, body, raf: 0 });
  const dialog = _.Dialog({
    class: "tl-ai-agent-runtime-view-dialog",
    panelClass: "tl-ai-agent-runtime-view-panel",
    size: "lg",
    title: node.type === "aiAgent" ? "Agent Runtime" : "Knowledge Runtime",
    subtitle: node.label || node.id,
    icon: "terminal",
    closeButton: true,
    scrollable: true,
    bodyMaxHeight: "72vh",
    content: () => body,
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({
        onclick: () => {
          updateAiAgentRuntimeDialogView(aiAgentRuntimeDialogViews.get(node.id));
        },
      }, icon("refresh", "sm"), "Refresh"),
      btn({
        onclick: () => {
          aiAgentRuntimeDialogViews.delete(node.id);
          close();
        },
      }, "Close")
    ),
  });
  dialog.open();
};

const renderKnowledgeRuntimeButton = (node = {}) =>
  btn({
    class: "tl-flow-embedded-map-view-btn",
    title: "View Knowledge LLM runtime timeline",
    onPointerDown: stopNodeControlEvent,
    onclick: (event) => {
      event.preventDefault();
      event.stopPropagation();
      openAiAgentRuntimeDialog(node);
    },
  }, icon("terminal", "sm"), "View Runtime");

const renderRuntimeNodeBody = (node, view, channelName, fieldCount) => {
  if (isAgentBridgeNode(node)) {
    return [_.div(
      { class: "tl-flow-agent-bridge-core" },
      icon("network_node", "lg")
    )];
  }
  if (node.type === "aiAgent" && !node.metadata?.library) {
    return [
      _.small({ class: "tl-flow-node-meta" }, `${view.category} · ${view.subtype} · ${channelName || "no channel"}`),
      renderAiAgentPolicySummary(node),
      _.p(view.description),
      btn({
        class: "tl-flow-embedded-map-view-btn",
        title: "View AI Agent runtime timeline",
        onPointerDown: stopNodeControlEvent,
        onclick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          openAiAgentRuntimeDialog(node);
        },
      }, icon("terminal", "sm"), "View Runtime"),
      node.metadata?.aiAgentAlias && typeof openAiAgentAliasDiagnostics === "function" ? btn({
        class: "tl-flow-embedded-map-view-btn",
        title: "Inspect alias source, local overrides and resolved policy",
        onPointerDown: stopNodeControlEvent,
        onclick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          openAiAgentAliasDiagnostics(node);
        },
      }, icon("account_tree", "sm"), "Alias Diagnostics") : null,
      _.label(
        {
          class: "tl-flow-kdoc-replay-toggle",
          title: nodeRuntimeConfig(node).freshRun === true || nodeRuntimeConfig(node).freshRun === "true"
            ? "Next normal executions ignore memory and input history"
            : "Use normal memory and input history policy",
          onPointerDown: stopNodeControlEvent,
          onclick: stopNodeControlEvent,
        },
        _.span("Fresh Run"),
        _.Toggle({
          class: "tl-flow-inline-toggle",
          checked: nodeRuntimeConfig(node).freshRun === true || nodeRuntimeConfig(node).freshRun === "true",
          color: nodeRuntimeConfig(node).freshRun === true || nodeRuntimeConfig(node).freshRun === "true" ? "success" : "secondary",
          dense: true,
          onPointerDown: stopNodeControlEvent,
          onclick: stopNodeControlEvent,
          onChange: (checked) => persistInlineRuntimeNodeConfig({ node, patch: { freshRun: Boolean(checked) } }),
        })
      ),
      window.TrackerLensAiAgentEditor?.openMemoryManager ? btn({
        class: "tl-flow-embedded-map-view-btn",
        title: "Manage AI Agent memory",
        onPointerDown: stopNodeControlEvent,
        onclick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          window.TrackerLensAiAgentEditor.openMemoryManager({ ...node, name: node.label || node.id, nodeId: node.id, runtimeNodeId: node.id, workspaceId: node.workspaceId || "" });
        },
      }, icon("memory", "sm"), "Memory") : null,
      renderInlineNodeSettings(node),
      ...renderNodeMetricRows(node, `${view.runtime.eventsPerMin}/min`, `${view.runtime.latency || 0}ms`, `${view.metrics.listeners || 0} listeners`),
    ];
  }
  if (isFlowBoundaryNode(node)) return [renderFlowPortNodeBody(node, view)];
  if (isEmbeddedFlowMapNode(node)) {
    const inputPorts = nodePorts(node, "in");
    const outputPorts = nodePorts(node, "out");
    return [
      _.div(
        { class: "tl-flow-embedded-map-interface" },
        _.span(icon("login", "sm"), _.strong("Flow In"), _.em(String(inputPorts.length))),
        _.span(icon("logout", "sm"), _.strong("Flow Out"), _.em(String(outputPorts.length)))
      ),
      btn({
        class: "tl-flow-embedded-map-view-btn",
        title: "View Flow Map",
        onPointerDown: stopNodeControlEvent,
        onclick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          openEmbeddedFlowMapPreviewDialog(node);
        },
      }, icon("visibility", "sm"), "View Flow Map"),
      _.small({ class: "tl-flow-node-meta" }, `${view.category} · v${node.metadata?.version || node.metadata?.config?.version || "0.1.0"}`),
    ];
  }
  if (isKnowledgeDocumentStoreNode(node)) {
    loadKnowledgeInspectorDocument(node);
    const documentState = state.knowledgeInspectorDocuments[node.id] || { loading: true, count: 0 };
    const documentCount = Number(documentState.count || 0);
    const replayAllDocuments = documentStoreReplayAllEnabledForNode(node);
    return [
      _.small({ class: "tl-flow-node-meta" }, `${view.category} · ${view.subtype} · ${channelName || "no channel"}`),
      _.p(view.description),
      btn({
        class: "tl-flow-embedded-map-view-btn",
        title: "Upload Document",
        onPointerDown: stopNodeControlEvent,
        onclick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          requestKnowledgeDocumentUpload(node);
        },
      }, icon("upload_file", "sm"), "Upload Document"),
      btn({
        class: "tl-flow-embedded-map-view-btn",
        title: documentState.loading ? "Loading documents" : `View ${documentCount} uploaded document${documentCount === 1 ? "" : "s"}`,
        onPointerDown: stopNodeControlEvent,
        onclick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          openKnowledgeDocumentsDialog(node);
        },
      }, icon("folder_open", "sm"), documentState.loading ? "Documents..." : `${documentCount} Document${documentCount === 1 ? "" : "s"}`),
      btn({
        class: "tl-flow-embedded-map-view-btn is-danger",
        title: "Clear derived Knowledge memory for this document scope",
        onPointerDown: stopNodeControlEvent,
        onclick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          requestKnowledgeDocumentMemoryClear(node);
        },
      }, icon("delete_sweep", "sm"), "Clear Memory"),
      _.label(
        {
          class: "tl-flow-kdoc-replay-toggle",
          title: replayAllDocuments ? "Replay all enabled documents on next Play" : "Replay only enabled documents not processed yet",
          onPointerDown: stopNodeControlEvent,
          onclick: stopNodeControlEvent,
        },
        _.span("Replay all documents"),
        _.Toggle({
          class: "tl-flow-inline-toggle",
          checked: replayAllDocuments,
          color: replayAllDocuments ? "success" : "secondary",
          dense: true,
          onPointerDown: stopNodeControlEvent,
          onclick: stopNodeControlEvent,
          onChange: (checked) => persistInlineRuntimeNodeConfig({ node, patch: { replayAllDocuments: Boolean(checked) } }),
        })
      ),
      ...knowledgeUploadProgressNodes(node),
      renderInlineNodeSettings(node),
      ...renderNodeMetricRows(node, `${view.runtime.eventsPerMin}/min`, `${view.runtime.latency || 0}ms`, `${view.metrics.listeners || 0} listeners`),
    ];
  }
  if (nodeCategory(node) === "knowledge" && nodeSubtype(node) === "knowledge-graph") {
    return [
      _.small({ class: "tl-flow-node-meta" }, `${view.category} · ${view.subtype} · ${channelName || "no channel"}`),
      _.p(view.description),
      btn({
        class: "tl-flow-embedded-map-view-btn",
        title: "View Knowledge Graph",
        onPointerDown: stopNodeControlEvent,
        onclick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          openKnowledgeGraphViewDialog(node);
        },
      }, icon("account_tree", "sm"), "View Graph"),
      btn({
        class: "tl-flow-embedded-map-view-btn is-danger",
        title: "Clear Knowledge Graph",
        onPointerDown: stopNodeControlEvent,
        onclick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          requestKnowledgeGraphClear(node);
        },
      }, icon("delete_sweep", "sm"), "Clear Graph"),
      renderInlineNodeSettings(node),
      ...renderNodeMetricRows(node, `${view.runtime.eventsPerMin}/min`, `${view.runtime.latency || 0}ms`, `${view.metrics.listeners || 0} listeners`),
    ];
  }
  if (isKnowledgeEntityExtractorNode(node)) {
    return [
      _.small({ class: "tl-flow-node-meta" }, `${view.category} · ${view.subtype} · ${channelName || "no channel"}`),
      _.p(view.description),
      renderKnowledgeRuntimeButton(node),
      btn({
        class: "tl-flow-embedded-map-view-btn is-danger",
        title: "Clear Entity Extractor graph records for this scope",
        onPointerDown: stopNodeControlEvent,
        onclick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          requestKnowledgeEntityGraphClear(node);
        },
      }, icon("delete_sweep", "sm"), "Clear Entities"),
      renderInlineNodeSettings(node),
      ...renderNodeMetricRows(node, `${view.runtime.eventsPerMin}/min`, `${view.runtime.latency || 0}ms`, `${view.metrics.listeners || 0} listeners`),
    ];
  }
  if (isKnowledgeSemanticRelationEnricherNode(node)) {
    return [
      _.small({ class: "tl-flow-node-meta" }, `${view.category} · ${view.subtype} · ${channelName || "no channel"}`),
      _.p(view.description),
      renderKnowledgeRuntimeButton(node),
      btn({
        class: "tl-flow-embedded-map-view-btn is-danger",
        title: "Clear Semantic Relation Enricher records for this scope",
        onPointerDown: stopNodeControlEvent,
        onclick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          requestKnowledgeSemanticRelationsClear(node);
        },
      }, icon("delete_sweep", "sm"), "Clear Semantic"),
      renderInlineNodeSettings(node),
      ...renderNodeMetricRows(node, `${view.runtime.eventsPerMin}/min`, `${view.runtime.latency || 0}ms`, `${view.metrics.listeners || 0} listeners`),
    ];
  }
  if (isKnowledgeGraphBuilderAgentNode(node)) {
    return [
      _.small({ class: "tl-flow-node-meta" }, `${view.category} · ${view.subtype} · ${channelName || "no channel"}`),
      _.p(view.description),
      renderKnowledgeRuntimeButton(node),
      btn({
        class: "tl-flow-embedded-map-view-btn is-danger",
        title: "Clear Graph Builder Agent records for this scope",
        onPointerDown: stopNodeControlEvent,
        onclick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          requestKnowledgeGraphBuilderClear(node);
        },
      }, icon("delete_sweep", "sm"), "Clear Builder"),
      renderInlineNodeSettings(node),
      ...renderNodeMetricRows(node, `${view.runtime.eventsPerMin}/min`, `${view.runtime.latency || 0}ms`, `${view.metrics.listeners || 0} listeners`),
    ];
  }
  if (nodeCategory(node) === "knowledge" && nodeSubtype(node) === "graph-query") {
    return [
      _.small({ class: "tl-flow-node-meta" }, `${view.category} · ${view.subtype} · ${channelName || "no channel"}`),
      _.p(view.description),
      renderKnowledgeRuntimeButton(node),
      renderKnowledgeGraphQueryScope(node),
      renderInlineNodeSettings(node),
      ...renderNodeMetricRows(node, `${view.runtime.eventsPerMin}/min`, `${view.runtime.latency || 0}ms`, `${view.metrics.listeners || 0} listeners`),
    ];
  }
  if (isKnowledgeDictionaryBuilderNode(node)) {
    return [
      _.small({ class: "tl-flow-node-meta" }, `${view.category} · ${view.subtype} · ${channelName || "no channel"}`),
      _.p(view.description),
      renderKnowledgeRuntimeButton(node),
      btn({
        class: "tl-flow-embedded-map-view-btn is-danger",
        title: "Clear Knowledge Dictionary records for this scope",
        onPointerDown: stopNodeControlEvent,
        onclick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          requestKnowledgeDictionaryClear(node);
        },
      }, icon("delete_sweep", "sm"), "Clear Dictionary"),
      renderInlineNodeSettings(node),
      ...renderNodeMetricRows(node, `${view.runtime.eventsPerMin}/min`, `${view.runtime.latency || 0}ms`, `${view.metrics.listeners || 0} listeners`),
    ];
  }
  if (isKnowledgeEventBuilderNode(node)) {
    return [
      _.small({ class: "tl-flow-node-meta" }, `${view.category} · ${view.subtype} · ${channelName || "no channel"}`),
      _.p(view.description),
      renderKnowledgeRuntimeButton(node),
      btn({
        class: "tl-flow-embedded-map-view-btn is-danger",
        title: "Clear Knowledge Event records for this scope",
        onPointerDown: stopNodeControlEvent,
        onclick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          requestKnowledgeEventsClear(node);
        },
      }, icon("delete_sweep", "sm"), "Clear Events"),
      renderInlineNodeSettings(node),
      ...renderNodeMetricRows(node, `${view.runtime.eventsPerMin}/min`, `${view.runtime.latency || 0}ms`, `${view.metrics.listeners || 0} listeners`),
    ];
  }
  return [
    _.small({ class: "tl-flow-node-meta" }, `${view.category} · ${view.subtype} · ${channelName || "no channel"}`),
    _.p(view.description),
    isKnowledgeLlmRuntimeNode(node) ? renderKnowledgeRuntimeButton(node) : null,
    renderInlineNodeSettings(node),
    ...renderNodeMetricRows(node, `${view.runtime.eventsPerMin}/min`, `${view.runtime.latency || 0}ms`, `${view.metrics.listeners || 0} listeners`),
  ];
};

const renderNodeContextMenu = () => {
  const menu = state.contextMenu;
  if (!menu || menu.type !== "node") return null;
  const node = nodeById(menu.nodeId);
  if (!node) return null;
  const view = runtimeNodeBase(node, recentActivity(graphModel()).nodeActivity?.get(node.id), nodePerformance(node));
  const disabled = view.runtime.status === "disabled";
  const paused = view.runtime.status === "paused";
  const canDelete = canDeleteRuntimeCanvasNode(node);
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
    const x = state.viewport.panX + flowWorldNumber(pos.x) * zoom;
    const y = state.viewport.panY + flowWorldNumber(pos.y) * zoom;
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
    minX: (-state.viewport.panX) / zoom,
    minY: (-state.viewport.panY) / zoom,
    maxX: (width - state.viewport.panX) / zoom,
    maxY: (height - state.viewport.panY) / zoom,
  };
};

const minimapNodeSizePercent = (node = {}, rect = { width: 1440, height: 900 }) => {
  const host = document.querySelector(".tl-flow-canvas");
  const element = node?.id
    ? document.querySelector(`[data-flow-node-id="${escapeSelectorValue(node.id)}"]`)
    : null;
  const zoom = Math.max(0.1, Number(state.viewport.zoom) || 1);
  const hostRect = host?.getBoundingClientRect?.();
  const nodeRect = element?.getBoundingClientRect?.();
  if (!node.metadata?.collapsed && hostRect?.width && hostRect?.height && nodeRect?.width && nodeRect?.height) {
    return {
      width: nodeRect.width / zoom,
      height: nodeRect.height / zoom,
    };
  }

  const portCount = Math.max(nodePorts(node, "in").length, nodePorts(node, "out").length, 1);
  return {
    width: flowNodeWidth(node),
    height: node.metadata?.collapsed ? 92 : nodeMinHeight(portCount),
  };
};

const minimapGraphFrame = (graph = {}, rect = { width: 1440, height: 900 }) => {
  const viewport = minimapViewportBounds(rect);
  const positions = (graph.nodes || []).map((node, index) => {
    const pos = nodePosition(node, index);
    const size = minimapNodeSizePercent(node, rect);
    return {
      node,
      index,
      x: flowWorldNumber(pos.x),
      y: flowWorldNumber(pos.y),
      width: size.width,
      height: size.height,
    };
  });
  const seed = positions.length
    ? positions.reduce((acc, item) => ({
      minX: Math.min(acc.minX, item.x),
      minY: Math.min(acc.minY, item.y),
      maxX: Math.max(acc.maxX, item.x + item.width),
      maxY: Math.max(acc.maxY, item.y + item.height),
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

const minimapNodeStyle = ({ node = {}, frame = {}, x = 0, y = 0 } = {}) => ({
  "--x": `${frame.mapX(x)}%`,
  "--y": `${frame.mapY(y)}%`,
  "--w": `${Math.max(1.4, frame.mapX(x + (node.__minimapWidth || 0)) - frame.mapX(x))}%`,
  "--h": `${Math.max(2.4, frame.mapY(y + (node.__minimapHeight || 0)) - frame.mapY(y))}%`,
  "--node-rgb": toneRgb(graphTone(node)).join(", "),
});

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
  frame.positions.forEach(({ node, x, y, width, height }) => {
    const element = minimap.querySelector(`[data-flow-minimap-node-id="${escapeSelectorValue(node.id)}"]`);
    if (!element) return;
    const style = minimapNodeStyle({
      node: { ...node, __minimapWidth: width, __minimapHeight: height },
      frame,
      x,
      y,
    });
    Object.entries(style).forEach(([key, value]) => element.style.setProperty(key, value));
  });
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
      ...frame.positions.map(({ node, index, x, y, width, height }) => {
        const minimapNode = { ...node, __minimapWidth: width, __minimapHeight: height };
        return _.button({
          type: "button",
          class: `tl-flow-minimap-node is-${graphTone(node)}${renderedIds.has(node.id) ? " is-visible" : ""}${state.focus.nodeId === node.id ? " is-selected" : ""}`,
          style: minimapNodeStyle({ node: minimapNode, frame, x, y }),
          "data-flow-minimap-node-id": node.id,
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
      { class: "tl-flow-canvas", onPointerDown: beginPan, onWheel: handleCanvasWheel, oncontextmenu: openCanvasContextMenu },
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
            ? nodeCanvasPoint({ canvas: { width: rect.width, height: rect.height }, node: sourceNode, index: fromIndex, side: dependencySourceHandleSide(dependency), port: dependencyPort(dependency, "out"), corner: dependencySourceHandleCorner(dependency) })
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
              class: `tl-flow-edge-label${state.focus.edgeId === dependency.id ? " is-selected" : ""}${impactClassForEdge(dependency, impact)}${dependency.metadata?.virtual ? " is-virtual" : ""}${isAllEdge(dependency) ? " is-bus" : ""}${isAgentControlEdge(dependency) ? " is-agent-control" : ""}${isToolAccessEdge(dependency) ? " is-tool-access" : ""}${recentEvent || activeTestEdge || processingEdge ? " is-live" : ""}${recentEvent?.status === "error" ? " is-error" : ""}${activeTestEdge || processingEdge ? " is-test-path" : ""}`,
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
          const outputPorts = visibleNodePorts(node, "out", fullOutputPorts, graph);
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
              class: `tl-flow-node is-${graphTone(node)} is-runtime-${view.runtime.status}${isAgentBridge ? " is-agent-bridge" : ""}${isEmbeddedFlowMapNode(node) ? " is-embedded-flow-map" : ""}${isFlowBoundaryNode(node) ? ` is-flow-port-node is-${flowPortSubtype(node) || "flow-port"}` : ""}${node.metadata?.collapsed ? " is-collapsed" : ""}${state.frontNodeId === node.id ? " is-front" : ""}${state.focus.nodeId === node.id ? " is-selected" : ""}${impactClassForNode(node, impact)}${live || processingNode ? " is-live is-event-active" : ""}${processingNode ? " is-ai-processing" : ""}${live?.status === "orchestrating" ? " is-orchestrating" : ""}${live?.status === "complete" ? " is-task-complete" : ""}${live?.status === "error" ? " is-error" : ""}${isLinkSource ? " is-link-source" : ""}${isLinkTarget ? " is-link-target" : ""}${isLinkHover ? " is-link-hover" : ""}${isInTestRun ? " is-test-path" : ""}`,
              style: { "--x": pos.x, "--y": pos.y, "--node-width": `${flowPositionWidth(pos)}px`, "--port-count": portCount, minHeight: isAgentBridge ? "58px" : `${nodeMinHeight(portCount)}px` },
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
            ...inputPorts.flatMap((port, portIndex) => visualPortInstances(node, port, "in", portIndex, inputPorts.length).map((visual) => _.span({
              class: `tl-flow-node-port is-input is-${port.type}${isAgentBridge && isAgentControlPort(port) ? " is-bridge-agent-input" : ""}${isAgentBridge && port.name === "listening" ? " is-bridge-right-input is-bridge-listening" : ""}${isAgentControlPort(port) ? ` is-agent-control-port${agentControlCornerClass(visual.corner)}` : ""}${port.name === "all" ? " is-pass" : ""}${isPortConnected(graph, node.id, "in", port.name) ? " is-connected" : ""}${live ? " is-event-active" : ""}`,
              title: portTooltip(port, "in", inputPorts),
              style: visual.style,
              "data-port-side": "in",
              "data-port-label": port.name,
              "data-port-display": portInlineLabel(port, "in", inputPorts),
              "data-port-type": port.type,
              "data-port-index": portIndex,
              "data-port-corner": visual.corner,
              onPointerEnter: (event) => {
                event.stopPropagation();
                setGraphHover(node.id, `in:${port.name}`);
              },
              onPointerLeave: () => setGraphHover(node.id, ""),
              onPointerDown: isAgentControlPort(port)
                ? (event) => beginPortLinkDrag(event, node, index, "in", port.name)
                : undefined,
            }, ...(isAgentControlPort(port) ? [icon(isAgentBridge ? "psychology" : "network_intel_node", "sm")] : [])))),
            ...outputPorts.flatMap((port, portIndex) => visualPortInstances(node, port, "out", portIndex, outputPorts.length).map((visual) => _.span({
              class: `tl-flow-node-port is-output is-${port.type}${isAgentBridge && port.name === "action" ? " is-bridge-action" : ""}${isAgentControlPort(port) ? ` is-agent-control-port${agentControlCornerClass(visual.corner)}` : ""}${port.name === "all" ? " is-pass" : ""}${isPortConnected(graph, node.id, "out", port.name) ? " is-connected" : ""}${live ? " is-event-active" : ""}`,
              title: portTooltip(port, "out", outputPorts),
              style: visual.style,
              "data-port-side": "out",
              "data-port-label": port.name,
              "data-port-display": portInlineLabel(port, "out", outputPorts),
              "data-port-type": port.type,
              "data-port-index": portIndex,
              "data-port-corner": visual.corner,
              onPointerEnter: (event) => {
                event.stopPropagation();
                setGraphHover(node.id, `out:${port.name}`);
              },
              onPointerLeave: () => setGraphHover(node.id, ""),
              onPointerDown: (event) => beginPortLinkDrag(event, node, index, "out", port.name),
            }, ...(isAgentControlPort(port) ? [icon("network_intel_node", "sm")] : [])))),
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
              ...renderRuntimeNodeBody(node, view, channelName, fieldCount)
            ),
            _.span(
              { class: "tl-flow-node-footer", "data-flow-node-footer": node.id },
              _.span(
                { class: "tl-flow-node-footer-main" },
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
                _.span({ class: "tl-flow-node-footer-ports", "data-flow-node-footer-ports": "true" }, isAgentBridge ? "1 agent · 1 in/out" : `${fullInputPorts.length} in · ${fullOutputPorts.length} out`)
              ),
              isAgentBridge || isPreviewNode(node) ? null : renderNodeOutputPreviewButton(node, fullOutputPorts)
            ),
            isAgentBridge ? null : _.span({
              class: "tl-flow-node-resize",
              title: "Resize node width",
              onPointerDown: (event) => beginNodeResize(event, node, index),
            })
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
  const persistence = window.trackers?.desktop?.persistence;
  return persistence?.readDevelopmentRecords ? persistence.readDevelopmentRecords({ storeName }).catch(() => []) : [];
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

const loadAiInspectorJob = async (node = {}, { force = false } = {}) => {
  if (!node?.id || nodeCategory(node) !== "ai-agents") return;
  const cached = state.aiInspectorJobs[node.id];
  if (!force && cached && (cached.loading || Date.now() - Number(cached.loadedAt || 0) < 2500)) return;
  state.aiInspectorJobs = {
    ...state.aiInspectorJobs,
    [node.id]: {
      ...(cached || {}),
      loading: true,
      error: "",
    },
  };
  try {
    const data = await window.TrackerLensAiRuntimeStore?.list?.().catch((error) => {
      throw error;
    });
    const workspaceId = node.workspaceId || state.filters.workspaceId || "workspace_global";
    const workspaceAliases = new Set([workspaceId, workspaceId === "workspace_global" ? "global" : "workspace_global"]);
    const jobs = (data?.jobs || []).filter((job) =>
      job.agentId === node.id &&
      workspaceAliases.has(job.workspaceId || "workspace_global")
    );
    const latest = jobs
      .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || "") - Date.parse(a.updatedAt || a.createdAt || ""))[0] || null;
    state.aiInspectorJobs = {
      ...state.aiInspectorJobs,
      [node.id]: {
        loading: false,
        job: latest,
        count: jobs.length,
        loadedAt: Date.now(),
        error: "",
      },
    };
  } catch (error) {
    state.aiInspectorJobs = {
      ...state.aiInspectorJobs,
      [node.id]: {
        loading: false,
        job: null,
        count: 0,
        loadedAt: Date.now(),
        error: error?.message || "AI jobs read failed",
      },
    };
  }
  if (selectedNode()?.id === node.id) mount({ preserveScroll: true });
};

const aiJobRagContext = (job = {}) =>
  job.ragContext || job.result?.ragContext || null;

const aiJobGraphContext = (job = {}) =>
  job.graphContext || job.result?.graphContext || null;

const renderInspectorAiRag = (node = {}) => {
  if (nodeCategory(node) !== "ai-agents") {
    return _.section({ class: "tl-flow-detail-list" }, _.p({ class: "tl-flow-muted" }, "N/D"));
  }
  loadAiInspectorJob(node);
  const stateJob = state.aiInspectorJobs[node.id] || { loading: true, job: null, count: 0 };
  const job = stateJob.job || null;
  const ragContext = aiJobRagContext(job || {});
  const graphContext = aiJobGraphContext(job || {});
  const result = job?.result || {};
  const sources = Array.isArray(ragContext?.sources) ? ragContext.sources : [];
  const evidence = Array.isArray(graphContext?.evidence) ? graphContext.evidence : [];
  return _.section(
    { class: "tl-flow-detail-list" },
    _.h3("AI Knowledge Debug"),
    ...[
      ["Jobs", stateJob.loading ? "loading..." : stateJob.count || 0],
      ["Job ID", job?.id || "N/D"],
      ["Status", job?.status || "N/D"],
      ["Provider", result.provider || job?.provider || "N/D"],
      ["Model", result.model || job?.model || "N/D"],
      ["Fallback", job?.status === "fallback" || result.provider === "fallback" ? (job?.error || result.reason || "active") : "no"],
      ["RAG query", ragContext?.query || "N/D"],
      ["RAG query ID", ragContext?.queryId || "N/D"],
      ["RAG results", ragContext ? String(ragContext.resultCount ?? sources.length) : "N/D"],
      ["Graph query", graphContext?.query || "N/D"],
      ["Graph query ID", graphContext?.queryId || "N/D"],
      ["Graph entities", graphContext ? String(graphContext.resultCount ?? graphContext.entities?.length ?? 0) : "N/D"],
      ["Graph relations", graphContext ? String(graphContext.relationCount ?? graphContext.relations?.length ?? 0) : "N/D"],
    ].map(([label, value]) => _.div(_.span(label), _.strong(String(value)))),
    stateJob.error ? _.p({ class: "tl-flow-muted" }, stateJob.error) : null,
    ragContext
      ? _.div(
        { class: "is-wide" },
        _.span("RAG context"),
        _.div(
          { class: "tl-flow-storage-record-actions" },
          copyRuntimeButton(ragContext, "Copy RAG context"),
          btn({
            class: "is-ghost is-compact",
            title: "Refresh AI job",
            onclick: () => loadAiInspectorJob(node, { force: true }),
          }, icon("sync", "sm"), "Refresh")
        ),
        _.pre({ class: "tl-flow-storage-record-preview" }, prettyRuntimeValue({
          query: ragContext.query,
          context: ragContext.context,
          scope: ragContext.scope,
        }))
      )
      : _.p({ class: "tl-flow-muted" }, stateJob.loading ? "Caricamento ultimo job AI..." : "Nessun contesto RAG trovato per l'ultimo job AI."),
    graphContext
      ? _.div(
        { class: "is-wide" },
        _.span("Graph context"),
        _.div(
          { class: "tl-flow-storage-record-actions" },
          copyRuntimeButton(graphContext, "Copy Graph context"),
          btn({
            class: "is-ghost is-compact",
            title: "Refresh AI job",
            onclick: () => loadAiInspectorJob(node, { force: true }),
          }, icon("sync", "sm"), "Refresh")
        ),
        _.pre({ class: "tl-flow-storage-record-preview" }, prettyRuntimeValue({
          query: graphContext.query,
          context: graphContext.context,
          scope: graphContext.scope,
          entities: graphContext.entities,
          relations: graphContext.relations,
        }))
      )
      : null,
    sources.length
      ? _.div(
        { class: "is-wide" },
        _.span("Sources"),
        _.div(
          { class: "tl-flow-rag-source-list" },
          ...sources.slice(0, 6).map((source) =>
            _.article(
              { class: "tl-flow-rag-source" },
              _.strong(`#${source.index || "?"} · score ${Number.isFinite(source.score) ? source.score.toFixed(3) : "N/D"}`),
              _.span(source.documentId || source.chunkId || "source"),
              _.p(source.text || "")
            )
          )
        )
      )
      : null
    ,
    evidence.length
      ? _.div(
        { class: "is-wide" },
        _.span("Graph evidence"),
        _.div(
          { class: "tl-flow-rag-source-list" },
          ...evidence.slice(0, 6).map((source, index) =>
            _.article(
              { class: "tl-flow-rag-source" },
              _.strong(`#${source.index || index + 1}`),
              _.span(source.documentId || source.chunkId || "evidence"),
              _.p(source.text || "")
            )
          )
        )
      )
      : null
  );
};

const readKnowledgeInspectorStore = async (storeName = "") => {
  if (!storeName) return [];
  const knowledgeRuntime = window.TrackerLensKnowledgeRuntime;
  return knowledgeRuntime?.listStore ? knowledgeRuntime.listStore(storeName).catch(() => []) : [];
};

const deleteKnowledgeInspectorStoreRecords = async (storeName = "", ids = []) => {
  const safeIds = [...new Set((ids || []).filter(Boolean).map(String))];
  if (!storeName || !safeIds.length) return [];
  if (window.TrackerLensKnowledgeRuntime?.deleteRecords) {
    return window.TrackerLensKnowledgeRuntime.deleteRecords(storeName, safeIds);
  }
  const persistence = window.trackers?.desktop?.persistence;
  if (!persistence?.deleteDevelopmentRecords) return [];
  try { await persistence.deleteDevelopmentRecords({ storeName, ids: safeIds }); return safeIds; } catch { return []; }
};

const putKnowledgeInspectorStoreRecord = async (storeName = "", record = {}) => {
  if (!storeName || !record?.id) return null;
  if (window.TrackerLensKnowledgeRuntime?.putRecord) {
    return window.TrackerLensKnowledgeRuntime.putRecord(storeName, record);
  }
  const persistence = window.trackers?.desktop?.persistence;
  if (!persistence?.writeDevelopmentRecords) return null;
  try { await persistence.writeDevelopmentRecords({ storeName, records: [record] }); return record; } catch { return null; }
};

const knowledgeTableName = (key = "", fallback = "") =>
  window.tlConfig?.TABLES?.[key] || fallback;

const cmsInputValue = (value) => value?.target?.value ?? value?.currentTarget?.value ?? value;

const flowMapParseJsonLoose = (text = "") => {
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
      // Try the next JSON candidate.
    }
  }
  return null;
};

const isKnowledgeDocumentStoreNode = (node = {}) =>
  nodeCategory(node) === "knowledge" && ["document-store", "text-knowledge", "workspace-memory", "conversation-memory"].includes(nodeSubtype(node));

const documentStoreReplayAllEnabledForNode = (node = {}) => {
  const config = nodeRuntimeConfig(node);
  return config.replayAllDocuments === true ||
    config.replayAllDocuments === "true" ||
    config.emitAllDocuments === true ||
    config.emitAllDocuments === "true";
};

const knowledgeClearScopeForNode = (node = {}) => {
  const config = nodeRuntimeConfig(node);
  const collectionId = String(config.collectionId || "").trim();
  const documentId = String(config.documentId || "").trim();
  const rawGraphScope = String(config.graphScope || "").toLowerCase();
  const graphScope = rawGraphScope === "document" && !documentId && collectionId
    ? "collection"
    : rawGraphScope || (documentId ? "document" : collectionId ? "collection" : "workspace");
  return {
    workspaceId: node.workspaceId || state.filters.workspaceId || "workspace_global",
    collectionId,
    documentId,
    graphScope,
  };
};

const isKnowledgeDocumentEnabled = (document = {}) => {
  const values = [document?.enabled, document?.metadata?.enabled].filter((value) => value !== undefined && value !== null && value !== "");
  return !values.some((value) => value === false || String(value).toLowerCase() === "false" || String(value) === "0");
};

const isKnowledgeDictionaryBuilderNode = (node = {}) =>
  nodeCategory(node) === "knowledge" && nodeSubtype(node) === "knowledge-dictionary-builder";

const isKnowledgeEventBuilderNode = (node = {}) =>
  nodeCategory(node) === "knowledge" && nodeSubtype(node) === "knowledge-event-builder";

const isKnowledgeEntityExtractorNode = (node = {}) =>
  nodeCategory(node) === "knowledge" && nodeSubtype(node) === "entity-extractor";

const isKnowledgeSemanticRelationEnricherNode = (node = {}) =>
  nodeCategory(node) === "knowledge" && nodeSubtype(node) === "semantic-relation-enricher";

const isKnowledgeGraphBuilderAgentNode = (node = {}) =>
  nodeCategory(node) === "knowledge" && nodeSubtype(node) === "knowledge-graph-builder-agent";

const KNOWLEDGE_LLM_RUNTIME_SUBTYPES = new Set([
  "entity-extractor",
  "knowledge-dictionary-builder",
  "knowledge-event-builder",
  "semantic-relation-enricher",
  "knowledge-graph-builder-agent",
  "world-generator-agent",
  "knowledge-mechanism-cue-agent",
  "graph-query",
  "knowledge-reasoning-composer",
]);

const isKnowledgeLlmRuntimeNode = (node = {}) =>
  nodeCategory(node) === "knowledge" && KNOWLEDGE_LLM_RUNTIME_SUBTYPES.has(nodeSubtype(node));

const knowledgeDictionaryTierRank = (tier = "") => {
  const ranks = { core: 0, typed: 1, context: 2, weak: 3 };
  return ranks[String(tier || "").toLowerCase()] ?? 9;
};

const knowledgeDictionaryTypeLabel = (entry = {}) => {
  const candidates = Array.isArray(entry.typeCandidates) ? entry.typeCandidates : [];
  const labels = candidates
    .map((candidate) => typeof candidate === "string"
      ? candidate
      : candidate?.type || candidate?.label || candidate?.entityType || "")
    .filter(Boolean);
  return labels.length ? labels.slice(0, 3).join(", ") : entry.entityType || entry.type || "term";
};

const knowledgeDictionaryEvidenceText = (entry = {}, maxLength = 180) => {
  const evidence = entry.evidence || {};
  const text = String(
    evidence.quote ||
    evidence.text ||
    entry.quote ||
    entry.context ||
    entry.metadata?.evidence ||
    entry.metadata?.explanation ||
    ""
  ).replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...` : text;
};

const knowledgeEventEvidenceText = (entry = {}, maxLength = 220) => {
  const evidence = entry.evidence || {};
  const text = String(
    evidence.quote ||
    evidence.text ||
    entry.quote ||
    entry.context ||
    entry.metadata?.explanation ||
    ""
  ).replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...` : text;
};

const knowledgeUploadMimeType = (file = {}) => {
  const name = String(file.name || "").toLowerCase();
  if (file.type) return file.type;
  if (name.endsWith(".md")) return "text/markdown";
  if (name.endsWith(".json")) return "application/json";
  if (name.endsWith(".csv")) return "text/csv";
  if (name.endsWith(".txt")) return "text/plain";
  return "text/plain";
};

const knowledgePayloadForUploadedFile = ({ file, text = "", node = {} } = {}) => {
  const config = nodeRuntimeConfig(node);
  const mimeType = knowledgeUploadMimeType(file);
  let parsed = null;
  if (mimeType.includes("json") || String(file?.name || "").toLowerCase().endsWith(".json")) {
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      parsed = null;
    }
  }
  const base = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  const documentText = String(base.document || base.text || base.content || base.body || text || "").trim();
  return {
    ...base,
    title: base.title || file?.name || node.label || "Uploaded Document",
    document: documentText,
    text: documentText,
    mimeType,
    sourceType: "upload",
    collectionId: base.collectionId || config.collectionId || "",
    metadata: {
      ...(base.metadata && typeof base.metadata === "object" ? base.metadata : {}),
      fileName: file?.name || "",
      fileSize: Number(file?.size || 0),
      mimeType,
      enabled: true,
      uploadedAt: new Date().toISOString(),
      uploadNodeId: node.id || "",
    },
  };
};

const setKnowledgeUploadProgress = (node = {}, patch = {}) => {
  if (!node?.id) return;
  state.knowledgeUploadProgress = {
    ...state.knowledgeUploadProgress,
    [node.id]: {
      ...(state.knowledgeUploadProgress[node.id] || {}),
      ...patch,
      updatedAt: Date.now(),
    },
  };
  if (state.mounted) mount({ preserveScroll: true });
};

const readKnowledgeUploadFileText = (file = null, node = {}) =>
  new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error("Nessun file selezionato"));
      return;
    }
    const reader = new FileReader();
    reader.onprogress = (event) => {
      const percent = event.lengthComputable && event.total
        ? Math.max(1, Math.min(95, Math.round((event.loaded / event.total) * 95)))
        : 35;
      setKnowledgeUploadProgress(node, {
        active: true,
        phase: "reading",
        percent,
        fileName: file.name || "",
        error: "",
      });
    };
    reader.onerror = () => reject(reader.error || new Error("Lettura file fallita"));
    reader.onload = () => {
      setKnowledgeUploadProgress(node, {
        active: true,
        phase: "processing",
        percent: 96,
        fileName: file.name || "",
        error: "",
      });
      resolve(String(reader.result || ""));
    };
    reader.readAsText(file);
  });

const emitUploadedKnowledgeDocument = async ({ node, file, text = "" } = {}) => {
  if (!node?.id || !file) return;
  const workspaceId = node.workspaceId || state.filters.workspaceId || "workspace_global";
  const inputChannel = nodePorts(node, "in")[0]?.name || node.inputs?.[0] || "document";
  const config = nodeRuntimeConfig(node);
  const outputChannel = config.outputChannel || config.output || nodePorts(node, "out")[0]?.name || node.outputs?.[0] || "knowledge.document.created";
  const runId = `knowledge_upload_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const payload = knowledgePayloadForUploadedFile({ file, text, node });
  if (!payload.document) throw new Error("Documento vuoto o formato non leggibile");
  const bus = workspaceEventBus(workspaceId);
  const knowledge = window.TrackerLensKnowledgeRuntime;
  if (!knowledge?.createDocument) throw new Error("Knowledge Runtime non disponibile per upload");
  const document = await knowledge.createDocument({
    workspaceId,
    node,
    payload,
    event: {
      channel: inputChannel,
      sourceNodeId: `upload_${node.id}`,
      eventType: "knowledge_document_upload",
      meta: { origin: "knowledge-upload", runId },
    },
    config,
  });
  if (bus?.emit) {
    await bus.emit(outputChannel, {
      document,
      documentId: document.id,
      collectionId: document.metadata?.collectionId || payload.collectionId || "",
    }, {
      workspaceId,
      flowId: flowIdForWorkspace(workspaceId),
      eventType: "knowledge_document_created",
      sourceNodeId: node.id,
      status: "ok",
      latencyMs: 1,
      meta: {
        live: true,
        runId,
        origin: "knowledge-upload",
        rootNodeId: node.id,
        uploadNodeId: node.id,
        inputChannel,
        fileName: file.name || "",
        fileSize: Number(file.size || 0),
        mimeType: payload.mimeType || "",
      },
    });
  }
  await recordFlowAction({
    workspaceId,
    nodeId: node.id,
    message: `Knowledge document uploaded: ${file.name || "document"}`,
    context: {
      action: "knowledge-document-upload",
      runId,
      inputChannel,
      outputChannel,
      emitted: Boolean(bus?.emit),
      documentId: document.id,
      fileName: file.name || "",
      fileSize: Number(file.size || 0),
      mimeType: payload.mimeType || "",
      collectionId: payload.collectionId || "",
    },
  });
  setTimeout(() => {
    loadKnowledgeInspectorDocument(node, { force: true });
    loadKnowledgeInspectorGraph(node, { force: true });
  }, 600);
  mount({ preserveScroll: true });
};

const requestKnowledgeDocumentUpload = (node = {}, { onComplete = null } = {}) => {
  if (!node?.id) return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".txt,.md,.markdown,.json,.csv,text/plain,text/markdown,application/json,text/csv";
  input.style.position = "fixed";
  input.style.left = "-9999px";
  input.style.top = "0";
  input.style.opacity = "0";
  input.tabIndex = -1;
  input.onchange = async () => {
    const file = input.files?.[0] || null;
    input.remove();
    if (!file) return;
    try {
      setKnowledgeUploadProgress(node, {
        active: true,
        phase: "selected",
        percent: 2,
        fileName: file.name || "",
        fileSize: Number(file.size || 0),
        error: "",
      });
      const text = await readKnowledgeUploadFileText(file, node);
      await emitUploadedKnowledgeDocument({ node, file, text });
      await new Promise((resolve) => window.setTimeout(resolve, 120));
      await onComplete?.();
      setKnowledgeUploadProgress(node, {
        active: false,
        phase: "complete",
        percent: 100,
        fileName: file.name || "",
        fileSize: Number(file.size || 0),
        error: "",
      });
    } catch (error) {
      state.error = error?.message || "Upload documento Knowledge fallito";
      setKnowledgeUploadProgress(node, {
        active: false,
        phase: "error",
        percent: 0,
        fileName: file?.name || "",
        fileSize: Number(file?.size || 0),
        error: state.error,
      });
      setErrorSignal?.(state.error);
      await recordFlowAction({
        workspaceId: node.workspaceId || state.filters.workspaceId || "workspace_global",
        nodeId: node.id || "",
        level: "error",
        message: state.error,
        context: { action: "knowledge-document-upload-error", fileName: file?.name || "", error: state.error },
      });
      mount({ preserveScroll: true });
    }
  };
  input.oncancel = () => {
    input.remove();
    setKnowledgeUploadProgress(node, { active: false, phase: "cancelled", percent: 0, error: "" });
  };
  document.body.appendChild(input);
  input.click();
};

const renderKnowledgeUploadProgress = (node = {}) => {
  const progress = state.knowledgeUploadProgress?.[node.id] || null;
  if (!progress || (!progress.active && !["complete", "error"].includes(progress.phase))) return null;
  const percent = Math.max(0, Math.min(100, Number(progress.percent || 0)));
  const label = progress.phase === "error"
    ? progress.error || "Upload failed"
    : progress.phase === "complete"
      ? `Uploaded ${progress.fileName || "document"}`
      : `${progress.phase || "upload"} ${progress.fileName || "document"} · ${percent}%`;
  return _.div(
    { class: `tl-kdoc-upload-progress is-${progress.phase || "idle"}` },
    _.div(
      { class: "tl-kdoc-upload-progress-head" },
      _.span(label),
      progress.fileSize ? _.strong(`${Math.max(1, Math.round(Number(progress.fileSize) / 1024))} KB`) : null
    ),
    _.span(
      { class: "tl-kdoc-upload-progress-bar", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": percent },
      _.i({ style: `--kdoc-upload-progress:${percent}%` })
    )
  );
};

const knowledgeUploadProgressNodes = (node = {}) => {
  const progress = renderKnowledgeUploadProgress(node);
  return progress ? [progress] : [];
};

const knowledgeDocumentRecordsForNode = async (node = {}) => {
  if (!node?.id || !isKnowledgeDocumentStoreNode(node)) {
    return { documents: [], chunks: [], chunksByDocument: new Map() };
  }
  const [documents, chunks] = await Promise.all([
    readKnowledgeInspectorStore(knowledgeTableName("TL_KNOWLEDGE_DOCUMENTS", "tl_knowledge_documents")),
    readKnowledgeInspectorStore(knowledgeTableName("TL_KNOWLEDGE_CHUNKS", "tl_knowledge_chunks")),
  ]);
  const workspaceId = node.workspaceId || state.filters.workspaceId || "workspace_global";
  const config = nodeRuntimeConfig(node);
  const collectionId = String(config.collectionId || "").trim();
  const records = (documents || [])
    .filter((document) => (document.workspaceId || "workspace_global") === workspaceId)
    .filter((document) => document.metadata?.nodeId === node.id || document.sourceId === `upload_${node.id}` || document.sourceId === `live_${node.id}` || document.sourceId === node.id)
    .filter((document) => !collectionId || document.metadata?.collectionId === collectionId)
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || "") - Date.parse(a.updatedAt || a.createdAt || ""));
  const documentIds = new Set(records.map((document) => document.id));
  const scopedChunks = (chunks || [])
    .filter((chunk) => (chunk.workspaceId || "workspace_global") === workspaceId)
    .filter((chunk) => documentIds.has(chunk.documentId));
  const chunksByDocument = scopedChunks.reduce((acc, chunk) => {
    const list = acc.get(chunk.documentId) || [];
    list.push(chunk);
    acc.set(chunk.documentId, list);
    return acc;
  }, new Map());
  return { documents: records, chunks: scopedChunks, chunksByDocument };
};

const deleteKnowledgeDocumentRecord = async ({ node = {}, document = null } = {}) => {
  if (!node?.id || !document?.id) return { document: 0, chunks: 0, embeddings: 0, entities: 0, relations: 0, dictionary: 0, events: 0, queries: 0, sources: 0, metrics: 0 };
  const workspaceId = node.workspaceId || state.filters.workspaceId || "workspace_global";
  const stores = {
    documents: knowledgeTableName("TL_KNOWLEDGE_DOCUMENTS", "tl_knowledge_documents"),
    chunks: knowledgeTableName("TL_KNOWLEDGE_CHUNKS", "tl_knowledge_chunks"),
    embeddings: knowledgeTableName("TL_KNOWLEDGE_EMBEDDINGS", "tl_knowledge_embeddings"),
    entities: knowledgeTableName("TL_KNOWLEDGE_ENTITIES", "tl_knowledge_entities"),
    relations: knowledgeTableName("TL_KNOWLEDGE_RELATIONS", "tl_knowledge_relations"),
    dictionary: knowledgeTableName("TL_KNOWLEDGE_DICTIONARY", "tl_knowledge_dictionary"),
    events: knowledgeTableName("TL_KNOWLEDGE_EVENTS", "tl_knowledge_events"),
    queries: knowledgeTableName("TL_KNOWLEDGE_QUERIES", "tl_knowledge_queries"),
    sources: knowledgeTableName("TL_KNOWLEDGE_SOURCES", "tl_knowledge_sources"),
    metrics: knowledgeTableName("TL_KNOWLEDGE_METRICS", "tl_knowledge_metrics"),
  };
  const [chunks, embeddings, entities, relations, dictionary, events, queries, sources, metrics] = await Promise.all([
    readKnowledgeInspectorStore(stores.chunks),
    readKnowledgeInspectorStore(stores.embeddings),
    readKnowledgeInspectorStore(stores.entities),
    readKnowledgeInspectorStore(stores.relations),
    readKnowledgeInspectorStore(stores.dictionary),
    readKnowledgeInspectorStore(stores.events),
    readKnowledgeInspectorStore(stores.queries),
    readKnowledgeInspectorStore(stores.sources),
    readKnowledgeInspectorStore(stores.metrics),
  ]);
  const documentId = document.id;
  const chunkIds = new Set((chunks || [])
    .filter((chunk) => (chunk.workspaceId || "workspace_global") === workspaceId && chunk.documentId === documentId)
    .map((chunk) => chunk.id));
  const entityIds = new Set((entities || [])
    .filter((entity) => (entity.workspaceId || "workspace_global") === workspaceId)
    .filter((entity) => entity.documentId === documentId || chunkIds.has(entity.chunkId))
    .map((entity) => entity.id));
  const staleEmbeddings = (embeddings || [])
    .filter((embedding) => (embedding.workspaceId || "workspace_global") === workspaceId)
    .filter((embedding) => embedding.documentId === documentId || chunkIds.has(embedding.chunkId));
  const staleRelations = (relations || [])
    .filter((relation) => (relation.workspaceId || "workspace_global") === workspaceId)
    .filter((relation) =>
      relation.documentId === documentId ||
      chunkIds.has(relation.chunkId) ||
      entityIds.has(relation.sourceEntityId) ||
      entityIds.has(relation.targetEntityId)
    );
  const staleDictionary = (dictionary || [])
    .filter((entry) => (entry.workspaceId || "workspace_global") === workspaceId)
    .filter((entry) => entry.documentId === documentId || chunkIds.has(entry.chunkId));
  const staleEvents = (events || [])
    .filter((entry) => (entry.workspaceId || "workspace_global") === workspaceId)
    .filter((entry) => entry.documentId === documentId || chunkIds.has(entry.chunkId));
  const staleQueries = (queries || [])
    .filter((query) => (query.workspaceId || "workspace_global") === workspaceId)
    .filter((query) =>
      query.documentId === documentId ||
      query.scope?.documentId === documentId ||
      (Array.isArray(query.scope?.documentIds) && query.scope.documentIds.includes(documentId))
    );
  const staleSources = (sources || [])
    .filter((source) => (source.workspaceId || "workspace_global") === workspaceId)
    .filter((source) => source.documentId === documentId);
  const staleMetrics = (metrics || [])
    .filter((metric) => (metric.workspaceId || "workspace_global") === workspaceId)
    .filter((metric) => metric.value?.documentId === documentId);
  await Promise.all([
    deleteKnowledgeInspectorStoreRecords(stores.relations, staleRelations.map((relation) => relation.id)),
    deleteKnowledgeInspectorStoreRecords(stores.entities, [...entityIds]),
    deleteKnowledgeInspectorStoreRecords(stores.dictionary, staleDictionary.map((entry) => entry.id)),
    deleteKnowledgeInspectorStoreRecords(stores.events, staleEvents.map((entry) => entry.id)),
    deleteKnowledgeInspectorStoreRecords(stores.queries, staleQueries.map((query) => query.id)),
    deleteKnowledgeInspectorStoreRecords(stores.embeddings, staleEmbeddings.map((embedding) => embedding.id)),
    deleteKnowledgeInspectorStoreRecords(stores.chunks, [...chunkIds]),
    deleteKnowledgeInspectorStoreRecords(stores.sources, staleSources.map((source) => source.id)),
    deleteKnowledgeInspectorStoreRecords(stores.metrics, staleMetrics.map((metric) => metric.id)),
    deleteKnowledgeInspectorStoreRecords(stores.documents, [documentId]),
  ]);
  await recordFlowAction({
    workspaceId,
    nodeId: node.id,
    message: `Knowledge document deleted: ${document.metadata?.fileName || document.title || document.id}`,
    context: {
      action: "knowledge-document-delete",
      documentId,
      chunks: chunkIds.size,
      embeddings: staleEmbeddings.length,
      entities: entityIds.size,
      relations: staleRelations.length,
      dictionary: staleDictionary.length,
      sources: staleSources.length,
      metrics: staleMetrics.length,
    },
  });
  await loadKnowledgeInspectorDocument(node, { force: true });
  await loadKnowledgeInspectorGraph(node, { force: true });
  return {
    document: 1,
    chunks: chunkIds.size,
    embeddings: staleEmbeddings.length,
    entities: entityIds.size,
    relations: staleRelations.length,
    sources: staleSources.length,
    metrics: staleMetrics.length,
  };
};

const setKnowledgeDocumentEnabled = async ({ node = {}, document = null, enabled = true } = {}) => {
  if (!node?.id || !document?.id) return null;
  const storeName = knowledgeTableName("TL_KNOWLEDGE_DOCUMENTS", "tl_knowledge_documents");
  const updated = {
    ...document,
    enabled: Boolean(enabled),
    metadata: {
      ...(document.metadata && typeof document.metadata === "object" ? document.metadata : {}),
      enabled: Boolean(enabled),
      disabledAt: enabled ? "" : new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  };
  const saved = await putKnowledgeInspectorStoreRecord(storeName, updated);
  if (!saved) throw new Error("Knowledge document update failed");
  await loadKnowledgeInspectorDocument(node, { force: true });
  await recordFlowAction({
    workspaceId: node.workspaceId || state.filters.workspaceId || "workspace_global",
    nodeId: node.id,
    message: `Knowledge document ${enabled ? "enabled" : "disabled"}: ${document.metadata?.fileName || document.title || document.id}`,
    context: {
      action: "knowledge-document-enabled-toggle",
      documentId: document.id,
      enabled: Boolean(enabled),
    },
  });
  return saved;
};

const requestKnowledgeDocumentDelete = ({ node = {}, document = null, onDeleted = null } = {}) => {
  if (!node?.id || !document?.id) return;
  const meta = document.metadata || {};
  const title = meta.fileName || document.title || document.id;
  const dialog = _.Dialog({
    class: "tl-flow-edge-delete-dialog",
    panelClass: "tl-flow-edge-delete-panel",
    size: "md",
    title: "Delete Knowledge document?",
    subtitle: title,
    icon: "delete",
    closeButton: true,
    content: () => _.div(
      { class: "tl-flow-edge-delete-body" },
      _.p("Il documento e i record derivati verranno rimossi dagli store Knowledge locali."),
      _.div(_.span("Document"), _.strong(title)),
      _.div(_.span("Document ID"), _.strong(document.id || "N/D")),
      _.div(_.span("Collection"), _.strong(meta.collectionId || "all")),
      _.div(_.span("MIME"), _.strong(document.mimeType || meta.mimeType || "N/D"))
    ),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: close }, "Cancel"),
      btn({
        class: "is-danger",
        onclick: async () => {
          await deleteKnowledgeDocumentRecord({ node, document });
          close();
          await onDeleted?.();
          mount({ preserveScroll: true });
        },
      }, icon("delete", "sm"), "Delete")
    ),
  });
  dialog.open();
};

const knowledgeDocumentPreviewText = (document = {}, limit = 1800) => {
  const text = String(document?.text || "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trimEnd()}\n\n... ${text.length - limit} more chars`;
};

const openKnowledgeDocumentFullTextDialog = (document = {}) => {
  if (!document?.id) return;
  const meta = document.metadata || {};
  const text = String(document.text || "");
  const dialog = _.Dialog({
    class: "tl-kdoc-full-dialog",
    panelClass: "tl-kdoc-full-panel",
    size: "lg",
    title: meta.fileName || document.title || "Knowledge Document",
    subtitle: `${text.length.toLocaleString()} chars · ${document.mimeType || meta.mimeType || "text/plain"}`,
    icon: "article",
    closeButton: true,
    content: () => _.div(
      { class: "tl-kdoc-full-view" },
      _.pre({ class: "tl-flow-storage-record-preview tl-kdoc-view-full-text" }, text)
    ),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      copyRuntimeButton(document, "Copy document"),
      btn({ class: "st-btn-primary", onclick: close }, "Close")
    ),
  });
  dialog.open();
};

const loadKnowledgeInspectorDocument = async (node = {}, { force = false } = {}) => {
  if (!node?.id || !isKnowledgeDocumentStoreNode(node)) return;
  const cached = state.knowledgeInspectorDocuments[node.id];
  if (!force && cached && (cached.loading || Date.now() - Number(cached.loadedAt || 0) < 2500)) return;
  state.knowledgeInspectorDocuments = {
    ...state.knowledgeInspectorDocuments,
    [node.id]: {
      ...(cached || {}),
      loading: true,
      error: "",
    },
  };
  try {
    const { documents: records, chunksByDocument } = await knowledgeDocumentRecordsForNode(node);
    const latest = records[0] || null;
    const chunkCount = latest ? (chunksByDocument.get(latest.id) || []).length : 0;
    state.knowledgeInspectorDocuments = {
      ...state.knowledgeInspectorDocuments,
      [node.id]: {
        loading: false,
        document: latest,
        documents: records,
        count: records.length,
        chunkCount,
        loadedAt: Date.now(),
        error: "",
      },
    };
  } catch (error) {
    state.knowledgeInspectorDocuments = {
      ...state.knowledgeInspectorDocuments,
      [node.id]: {
        loading: false,
        document: null,
        documents: [],
        count: 0,
        chunkCount: 0,
        loadedAt: Date.now(),
        error: error?.message || "Knowledge document read failed",
      },
    };
  }
  if (selectedNode()?.id === node.id) mount({ preserveScroll: true });
};

const knowledgeDictionaryRecordsForNode = async (node = {}) => {
  const entries = await readKnowledgeInspectorStore(knowledgeTableName("TL_KNOWLEDGE_DICTIONARY", "tl_knowledge_dictionary"));
  const workspaceId = node.workspaceId || state.filters.workspaceId || "workspace_global";
  const config = nodeRuntimeConfig(node);
  const collectionId = String(config.collectionId || "").trim();
  const documentId = String(config.documentId || "").trim();
  const language = String(config.language || "").trim().toLowerCase();
  return (entries || [])
    .filter((entry) => (entry.workspaceId || "workspace_global") === workspaceId)
    .filter((entry) => !collectionId || entry.collectionId === collectionId || entry.metadata?.collectionId === collectionId)
    .filter((entry) => !documentId || entry.documentId === documentId)
    .filter((entry) => !language || String(entry.language || "").toLowerCase() === language)
    .sort((a, b) =>
      knowledgeDictionaryTierRank(a.tier) - knowledgeDictionaryTierRank(b.tier) ||
      Number(b.usableAsSeed === true) - Number(a.usableAsSeed === true) ||
      Number(b.seedScore || 0) - Number(a.seedScore || 0) ||
      Number(b.occurrenceCount || b.metadata?.occurrenceCount || 0) - Number(a.occurrenceCount || a.metadata?.occurrenceCount || 0) ||
      Date.parse(b.updatedAt || b.createdAt || "") - Date.parse(a.updatedAt || a.createdAt || "") ||
      String(a.term || a.label || a.lemma || "").localeCompare(String(b.term || b.label || b.lemma || ""))
    );
};

const summarizeKnowledgeDictionaryEntries = (entries = []) => {
  const tierCounts = {};
  const languageCounts = {};
  const typeCounts = {};
  entries.forEach((entry) => {
    const tier = String(entry.tier || "unknown");
    const language = String(entry.language || "unknown");
    const type = knowledgeDictionaryTypeLabel(entry).split(",")[0] || "term";
    tierCounts[tier] = (tierCounts[tier] || 0) + 1;
    languageCounts[language] = (languageCounts[language] || 0) + 1;
    typeCounts[type] = (typeCounts[type] || 0) + 1;
  });
  return {
    entryCount: entries.length,
    usableSeedCount: entries.filter((entry) => entry.usableAsSeed === true).length,
    tierCounts,
    languageCounts,
    typeCounts,
  };
};

const loadKnowledgeInspectorDictionary = async (node = {}, { force = false } = {}) => {
  if (!node?.id || !isKnowledgeDictionaryBuilderNode(node)) return;
  const cached = state.knowledgeInspectorDictionaries[node.id];
  if (!force && cached && (cached.loading || Date.now() - Number(cached.loadedAt || 0) < 2500)) return;
  state.knowledgeInspectorDictionaries = {
    ...state.knowledgeInspectorDictionaries,
    [node.id]: {
      ...(cached || {}),
      loading: true,
      error: "",
    },
  };
  try {
    const entries = await knowledgeDictionaryRecordsForNode(node);
    state.knowledgeInspectorDictionaries = {
      ...state.knowledgeInspectorDictionaries,
      [node.id]: {
        loading: false,
        entries,
        summary: summarizeKnowledgeDictionaryEntries(entries),
        config: nodeRuntimeConfig(node),
        workspaceId: node.workspaceId || state.filters.workspaceId || "workspace_global",
        loadedAt: Date.now(),
        error: "",
      },
    };
  } catch (error) {
    state.knowledgeInspectorDictionaries = {
      ...state.knowledgeInspectorDictionaries,
      [node.id]: {
        loading: false,
        entries: [],
        summary: summarizeKnowledgeDictionaryEntries([]),
        config: nodeRuntimeConfig(node),
        workspaceId: node.workspaceId || state.filters.workspaceId || "workspace_global",
        loadedAt: Date.now(),
        error: error?.message || "Knowledge dictionary read failed",
      },
    };
  }
  if (selectedNode()?.id === node.id) mount({ preserveScroll: true });
};

const knowledgeEventRecordsForNode = async (node = {}) => {
  const events = await readKnowledgeInspectorStore(knowledgeTableName("TL_KNOWLEDGE_EVENTS", "tl_knowledge_events"));
  const workspaceId = node.workspaceId || state.filters.workspaceId || "workspace_global";
  const config = nodeRuntimeConfig(node);
  const collectionId = String(config.collectionId || "").trim();
  const documentId = String(config.documentId || "").trim();
  return (events || [])
    .filter((entry) => (entry.workspaceId || "workspace_global") === workspaceId)
    .filter((entry) => !collectionId || entry.collectionId === collectionId || entry.metadata?.collectionId === collectionId)
    .filter((entry) => !documentId || entry.documentId === documentId)
    .sort((a, b) =>
      Number(a.sequence || 0) - Number(b.sequence || 0) ||
      Number(a.chunkIndex || 0) - Number(b.chunkIndex || 0) ||
      Number(a.sentenceIndex || 0) - Number(b.sentenceIndex || 0) ||
      Date.parse(a.createdAt || "") - Date.parse(b.createdAt || "")
    );
};

const summarizeKnowledgeEventEntries = (events = []) => {
  const typeCounts = {};
  const methodCounts = {};
  const documentCounts = {};
  let confidenceTotal = 0;
  let confidenceCount = 0;
  events.forEach((entry) => {
    const type = String(entry.eventType || entry.action || "event");
    const method = String(entry.source?.method || entry.extraction?.method || "unknown");
    const documentId = String(entry.documentId || "unknown");
    typeCounts[type] = (typeCounts[type] || 0) + 1;
    methodCounts[method] = (methodCounts[method] || 0) + 1;
    documentCounts[documentId] = (documentCounts[documentId] || 0) + 1;
    const confidence = Number(entry.confidence);
    if (Number.isFinite(confidence)) {
      confidenceTotal += confidence;
      confidenceCount += 1;
    }
  });
  return {
    eventCount: events.length,
    typeCounts,
    methodCounts,
    documentCounts,
    averageConfidence: confidenceCount ? confidenceTotal / confidenceCount : null,
    firstSequence: events[0]?.sequence || null,
    lastSequence: events[events.length - 1]?.sequence || null,
  };
};

const loadKnowledgeInspectorEvents = async (node = {}, { force = false } = {}) => {
  if (!node?.id || !isKnowledgeEventBuilderNode(node)) return;
  const cached = state.knowledgeInspectorEvents[node.id];
  if (!force && cached && (cached.loading || Date.now() - Number(cached.loadedAt || 0) < 2500)) return;
  state.knowledgeInspectorEvents = {
    ...state.knowledgeInspectorEvents,
    [node.id]: {
      ...(cached || {}),
      loading: true,
      error: "",
    },
  };
  try {
    const events = await knowledgeEventRecordsForNode(node);
    state.knowledgeInspectorEvents = {
      ...state.knowledgeInspectorEvents,
      [node.id]: {
        loading: false,
        events,
        summary: summarizeKnowledgeEventEntries(events),
        config: nodeRuntimeConfig(node),
        workspaceId: node.workspaceId || state.filters.workspaceId || "workspace_global",
        loadedAt: Date.now(),
        error: "",
      },
    };
  } catch (error) {
    state.knowledgeInspectorEvents = {
      ...state.knowledgeInspectorEvents,
      [node.id]: {
        loading: false,
        events: [],
        summary: summarizeKnowledgeEventEntries([]),
        config: nodeRuntimeConfig(node),
        workspaceId: node.workspaceId || state.filters.workspaceId || "workspace_global",
        loadedAt: Date.now(),
        error: error?.message || "Knowledge events read failed",
      },
    };
  }
  if (selectedNode()?.id === node.id) mount({ preserveScroll: true });
};

const isStructuredKnowledgeStoreNode = (node = {}) =>
  nodeCategory(node) === "knowledge" && ["structured-knowledge-store", "world-database"].includes(nodeSubtype(node));

const structuredKnowledgeRecordsForNode = async (node = {}) => {
  const records = await readKnowledgeInspectorStore(knowledgeTableName("TL_STRUCTURED_KNOWLEDGE", "tl_structured_knowledge"));
  const workspaceId = node.workspaceId || state.filters.workspaceId || "workspace_global";
  const config = nodeRuntimeConfig(node);
  const collectionId = String(config.collectionId || "").trim();
  const schemaId = nodeSubtype(node) === "world-database" ? "worldbuilding/v1" : String(config.schemaId || "").trim();
  const worldId = String(config.worldId || "").trim();
  return (records || [])
    .filter((entry) => (entry.workspaceId || "workspace_global") === workspaceId)
    .filter((entry) => !collectionId || entry.collectionId === collectionId)
    .filter((entry) => !schemaId || entry.schemaId === schemaId)
    .filter((entry) => !worldId || entry.worldId === worldId)
    .sort((a, b) =>
      String(a.schemaId || "").localeCompare(String(b.schemaId || "")) ||
      String(a.worldId || "").localeCompare(String(b.worldId || "")) ||
      String(a.recordType || "").localeCompare(String(b.recordType || "")) ||
      String(a.label || a.id || "").localeCompare(String(b.label || b.id || ""))
    );
};

const summarizeStructuredKnowledgeRecords = (records = []) => {
  const typeCounts = {};
  const schemaCounts = {};
  const worldCounts = {};
  records.forEach((record) => {
    const type = String(record.recordType || "record");
    const schema = String(record.schemaId || "structured/v1");
    const world = String(record.worldId || "none");
    typeCounts[type] = (typeCounts[type] || 0) + 1;
    schemaCounts[schema] = (schemaCounts[schema] || 0) + 1;
    worldCounts[world] = (worldCounts[world] || 0) + 1;
  });
  return { recordCount: records.length, typeCounts, schemaCounts, worldCounts };
};

const loadStructuredKnowledgeInspector = async (node = {}, { force = false } = {}) => {
  if (!node?.id || !isStructuredKnowledgeStoreNode(node)) return;
  state.knowledgeInspectorStructured = state.knowledgeInspectorStructured || {};
  const cached = state.knowledgeInspectorStructured[node.id];
  if (!force && cached && (cached.loading || Date.now() - Number(cached.loadedAt || 0) < 2500)) return;
  state.knowledgeInspectorStructured = {
    ...state.knowledgeInspectorStructured,
    [node.id]: {
      ...(cached || {}),
      loading: true,
      error: "",
    },
  };
  try {
    const records = await structuredKnowledgeRecordsForNode(node);
    state.knowledgeInspectorStructured = {
      ...state.knowledgeInspectorStructured,
      [node.id]: {
        loading: false,
        records,
        summary: summarizeStructuredKnowledgeRecords(records),
        config: nodeRuntimeConfig(node),
        workspaceId: node.workspaceId || state.filters.workspaceId || "workspace_global",
        loadedAt: Date.now(),
        error: "",
      },
    };
  } catch (error) {
    state.knowledgeInspectorStructured = {
      ...state.knowledgeInspectorStructured,
      [node.id]: {
        loading: false,
        records: [],
        summary: summarizeStructuredKnowledgeRecords([]),
        config: nodeRuntimeConfig(node),
        workspaceId: node.workspaceId || state.filters.workspaceId || "workspace_global",
        loadedAt: Date.now(),
        error: error?.message || "Structured Knowledge read failed",
      },
    };
  }
  if (selectedNode()?.id === node.id) mount({ preserveScroll: true });
};

const openKnowledgeDocumentsDialog = async (node = {}) => {
  const data = await knowledgeDocumentRecordsForNode(node).catch((error) => {
    console.warn("Knowledge documents unavailable", error);
    return { documents: [], chunksByDocument: new Map() };
  });
  state.knowledgeInspectorDocuments = {
    ...state.knowledgeInspectorDocuments,
    [node.id]: {
      ...(state.knowledgeInspectorDocuments[node.id] || {}),
      loading: false,
      document: data.documents[0] || null,
      documents: data.documents,
      count: data.documents.length,
      chunkCount: data.documents[0] ? (data.chunksByDocument.get(data.documents[0].id) || []).length : 0,
      loadedAt: Date.now(),
      error: "",
    },
  };
  const model = {
    search: "",
    selectedId: data.documents[0]?.id || "",
  };
  const enabledDocumentCount = () => data.documents.filter(isKnowledgeDocumentEnabled).length;
  let host = null;
  const rerender = () => {
    if (!host) return;
    const query = model.search.trim().toLowerCase();
    const visible = data.documents.filter((document) => {
      if (!query) return true;
      const meta = document.metadata || {};
      return [document.id, document.title, document.sourceId, document.mimeType, meta.fileName, meta.collectionId, document.text]
        .some((value) => String(value || "").toLowerCase().includes(query));
    });
    const selected = visible.find((document) => document.id === model.selectedId) || visible[0] || data.documents[0] || null;
    if (selected) model.selectedId = selected.id;
    const selectedMeta = selected?.metadata || {};
    const selectedChunks = selected ? (data.chunksByDocument.get(selected.id) || []) : [];
    host.replaceChildren(
      _.div(
        { class: "tl-kdoc-view-toolbar" },
        _.Input({
          class: "tl-kdoc-view-search",
          size: "sm",
          label: "Search",
          type: "search",
          placeholder: "Search documents, file name, collection...",
          value: model.search,
          onInput: (event) => {
            model.search = String(cmsInputValue(event) || "");
            rerender();
          },
        }),
        btn({
          class: "is-ghost is-compact tl-kdoc-action-refresh",
          onclick: async () => {
            const refreshed = await knowledgeDocumentRecordsForNode(node);
            data.documents = refreshed.documents;
            data.chunksByDocument = refreshed.chunksByDocument;
            model.selectedId = data.documents[0]?.id || "";
            rerender();
            loadKnowledgeInspectorDocument(node, { force: true });
          },
        }, icon("sync", "sm"), "Refresh"),
        btn({
          class: "st-btn-primary is-compact",
          onclick: () => requestKnowledgeDocumentUpload(node, {
            onComplete: async () => {
              const refreshed = await knowledgeDocumentRecordsForNode(node);
              data.documents = refreshed.documents;
              data.chunksByDocument = refreshed.chunksByDocument;
              model.selectedId = data.documents[0]?.id || "";
              rerender();
            },
          }),
        }, icon("upload_file", "sm"), "Upload")
      ),
      ...knowledgeUploadProgressNodes(node),
      _.div(
        { class: "tl-kdoc-view-body" },
        _.section(
          { class: "tl-kdoc-view-list" },
          visible.length
            ? visible.map((document) => {
              const meta = document.metadata || {};
              const chunks = data.chunksByDocument.get(document.id) || [];
              const enabled = isKnowledgeDocumentEnabled(document);
              return _.button({
                type: "button",
                class: `tl-kdoc-view-item${document.id === selected?.id ? " is-selected" : ""}${enabled ? "" : " is-disabled"}`,
                onclick: () => {
                  model.selectedId = document.id;
                  rerender();
                },
              },
              _.div(
                { class: "tl-kdoc-view-item-head" },
                _.strong(meta.fileName || document.title || document.id),
                _.em({ class: `tl-kdoc-state-pill ${enabled ? "is-enabled" : "is-disabled"}` }, enabled ? "enabled" : "disabled")
              ),
              _.span(document.title || "Untitled document"),
              _.small(`${chunks.length} chunks · ${meta.collectionId || "all"} · ${document.createdAt ? formatShortDate(document.createdAt) : "N/D"}`));
            })
            : [_.div({ class: "tl-kdoc-view-empty" }, icon("folder_open", "lg"), _.strong("No documents"), _.span("Upload a text, markdown, JSON or CSV file."))]
        ),
        _.aside(
          { class: "tl-kdoc-view-detail" },
          selected
            ? [
              _.h3(selectedMeta.fileName || selected.title || "Document"),
              _.div(
                _.span("Replay"),
                _.Toggle({
                  checked: isKnowledgeDocumentEnabled(selected),
                  color: isKnowledgeDocumentEnabled(selected) ? "success" : "secondary",
                  onChange: async (checked) => {
                    try {
                      const updated = await setKnowledgeDocumentEnabled({
                        node,
                        document: selected,
                        enabled: Boolean(checked),
                      });
                      if (updated) {
                        const index = data.documents.findIndex((document) => document.id === updated.id);
                        if (index >= 0) data.documents[index] = updated;
                        model.selectedId = updated.id;
                      }
                    } catch (error) {
                      console.warn("Knowledge document toggle failed", error);
                    }
                    rerender();
                  },
                })
              ),
              _.div(_.span("Document ID"), _.strong(selected.id || "N/D")),
              _.div(_.span("Title"), _.strong(selected.title || "N/D")),
              _.div(_.span("File"), _.strong(selectedMeta.fileName || "N/D")),
              _.div(_.span("Size"), _.strong(selectedMeta.fileSize ? `${Math.round(Number(selectedMeta.fileSize) / 1024)} KB` : "N/D")),
              _.div(_.span("MIME"), _.strong(selected.mimeType || selectedMeta.mimeType || "N/D")),
              _.div(_.span("Collection"), _.strong(selectedMeta.collectionId || "all")),
              _.div(_.span("Chunks"), _.strong(String(selectedChunks.length))),
              _.div(_.span("Text length"), _.strong(`${String(selected.text || "").length.toLocaleString()} chars`)),
              _.div(
                { class: "tl-kdoc-view-detail-actions" },
                btn({
                  class: "is-ghost is-compact tl-kdoc-action-copy",
                  onclick: () => copyRuntimeValue(selected),
                }, icon("content_copy", "sm"), "Copy Document"),
                selectedChunks.length ? btn({
                  class: "is-ghost is-compact tl-kdoc-action-copy",
                  onclick: () => copyRuntimeValue(selectedChunks),
                }, icon("content_copy", "sm"), "Copy Chunks") : null,
                String(selected.text || "").length > 1800 ? btn({
                  class: "is-ghost is-compact tl-kdoc-action-view",
                  onclick: () => openKnowledgeDocumentFullTextDialog(selected),
                }, icon("article", "sm"), "View Full Document") : null,
                btn({
                  class: "is-danger is-compact tl-kdoc-action-delete",
                  onclick: () => requestKnowledgeDocumentDelete({
                    node,
                    document: selected,
                    onDeleted: async () => {
                      const refreshed = await knowledgeDocumentRecordsForNode(node);
                      data.documents = refreshed.documents;
                      data.chunksByDocument = refreshed.chunksByDocument;
                      model.selectedId = data.documents[0]?.id || "";
                      rerender();
                    },
                  }),
                }, icon("delete", "sm"), "Delete")
              ),
              _.pre({ class: "tl-flow-storage-record-preview" }, knowledgeDocumentPreviewText(selected, 1800)),
            ]
            : [_.p({ class: "tl-flow-muted" }, "No document selected.")]
        )
      )
    );
  };
  const dialog = _.Dialog({
    class: "tl-kdoc-view-dialog",
    panelClass: "tl-kdoc-view-panel",
    size: "lg",
    title: node.label || "Knowledge Documents",
    subtitle: `${data.documents.length} uploaded document${data.documents.length === 1 ? "" : "s"} · ${enabledDocumentCount()} enabled`,
    icon: "folder_open",
    closeButton: true,
    content: () => {
      host = _.div({ class: "tl-kdoc-view" });
      setTimeout(rerender, 0);
      return host;
    },
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ class: "tl-kdoc-action-copy", onclick: () => copyRuntimeValue(data.documents) }, icon("content_copy", "sm"), "Copy List"),
      btn({ class: "st-btn-primary", onclick: close }, "Close")
    ),
  });
  dialog.open();
};

const agentToolWorkspaceId = (node = {}) =>
  node.workspaceId || state.filters.workspaceId || "workspace_global";

const loadAgentToolDebug = async (node = {}, { force = false } = {}) => {
  if (!node?.id || !window.TrackerLensAgentRuntime?.inspectConnectedTools) return;
  const cached = state.agentToolDebug[node.id];
  if (!force && cached && (cached.loading || Date.now() - Number(cached.loadedAt || 0) < 2500)) return;
  state.agentToolDebug = {
    ...(state.agentToolDebug || {}),
    [node.id]: {
      ...(cached || {}),
      loading: true,
      error: "",
    },
  };
  try {
    const manifest = await window.TrackerLensAgentRuntime.inspectConnectedTools({
      workspaceId: agentToolWorkspaceId(node),
      nodeId: node.id,
    });
    state.agentToolDebug = {
      ...(state.agentToolDebug || {}),
      [node.id]: {
        ...(state.agentToolDebug[node.id] || {}),
        loading: false,
        manifest,
        loadedAt: Date.now(),
        error: "",
      },
    };
  } catch (error) {
    state.agentToolDebug = {
      ...(state.agentToolDebug || {}),
      [node.id]: {
        ...(state.agentToolDebug[node.id] || {}),
        loading: false,
        manifest: null,
        loadedAt: Date.now(),
        error: error?.message || "Agent tools unavailable",
      },
    };
  }
  if (selectedNode()?.id === node.id) mount({ preserveScroll: true });
};

const defaultAgentToolArgs = (tool = {}) => {
  const name = String(tool.name || "");
  if (["searchChunks", "defineTerm", "resolveAmbiguity", "getTimeline", "findEvents", "verifyEvent", "findEntities", "findRelations", "getGraphEvidence"].includes(name)) {
    if (name === "defineTerm" || name === "resolveAmbiguity") return { term: "" };
    if (name === "verifyEvent") return { claim: "" };
    if (name === "findEntities" || name === "findRelations" || name === "getGraphEvidence") return { query: "", limit: 8 };
    return { query: "", limit: 8 };
  }
  if (name === "getFullDocument") return { maxChars: 12000 };
  if (name === "getChunkWindow") return { chunkId: "", radius: 1 };
  if (name === "listKeyTerms") return { limit: 12 };
  return {};
};

const openAgentToolProbeDialog = ({ selected = {}, manifest = {}, tool = {} } = {}) => {
  if (!selected?.id || !manifest?.nodeId || !tool?.name) return;
  const model = {
    argsText: JSON.stringify(defaultAgentToolArgs(tool), null, 2),
    running: false,
    error: "",
  };
  let host = null;
  const setLastResult = (result = null, error = "") => {
    state.agentToolDebug = {
      ...(state.agentToolDebug || {}),
      [selected.id]: {
        ...(state.agentToolDebug?.[selected.id] || {}),
        lastToolCall: {
          selectedNodeId: selected.id,
          targetNodeId: manifest.nodeId,
          targetLabel: manifest.label || manifest.nodeId,
          relation: manifest.relation || "",
          tool: tool.name,
          args: flowMapParseJsonLoose(model.argsText) || {},
          result,
          error,
          calledAt: new Date().toISOString(),
        },
      },
    };
  };
  const rerender = () => {
    if (!host) return;
    host.replaceChildren(
      _.div(
        { class: "tl-flow-detail-list" },
        _.div({ class: "tl-flow-kg-stat-row" }, _.span("Target"), _.strong(`${manifest.label || manifest.nodeId} · ${manifest.relation || "self"}`)),
        _.div({ class: "tl-flow-kg-stat-row" }, _.span("Tool"), _.strong(tool.name)),
        _.label(
          { class: "is-wide tl-flow-field" },
          _.span("Args JSON"),
          _.textarea({
            class: "tl-flow-storage-record-preview",
            rows: 8,
            spellcheck: "false",
            value: model.argsText,
            oninput: (event) => {
              model.argsText = String(cmsInputValue(event) || "");
            },
          })
        ),
        model.error ? _.p({ class: "tl-flow-muted" }, model.error) : null
      )
    );
  };
  const dialog = _.Dialog({
    class: "tl-flow-edge-delete-dialog",
    panelClass: "tl-flow-edge-delete-panel",
    size: "lg",
    title: "Probe Agent Tool",
    subtitle: `${tool.name} -> ${manifest.label || manifest.nodeId}`,
    icon: "terminal",
    closeButton: true,
    content: () => {
      host = _.div();
      setTimeout(rerender, 0);
      return host;
    },
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: close }, "Close"),
      btn({
        class: "st-btn-primary",
        onclick: async () => {
          const args = flowMapParseJsonLoose(model.argsText);
          if (!args || typeof args !== "object" || Array.isArray(args)) {
            model.error = "Args must be a JSON object.";
            rerender();
            return;
          }
          model.running = true;
          model.error = "";
          rerender();
          try {
            const result = await window.TrackerLensAgentRuntime.callConnectedNodeTool({
              workspaceId: agentToolWorkspaceId(selected),
              nodeId: manifest.nodeId,
              tool: tool.name,
              args,
              agentNodeId: selected.id,
            });
            setLastResult(result, "");
            close();
            mount({ preserveScroll: true });
          } catch (error) {
            const message = error?.message || "Agent tool call failed";
            model.error = message;
            setLastResult(null, message);
            rerender();
            mount({ preserveScroll: true });
          } finally {
            model.running = false;
          }
        },
      }, icon(model.running ? "hourglass_top" : "play_arrow", "sm"), model.running ? "Running" : "Run Probe")
    ),
  });
  dialog.open();
};

const renderInspectorAgentTools = (node = {}) => {
  if (!window.TrackerLensAgentRuntime?.inspectConnectedTools) {
    return _.section({ class: "tl-flow-detail-list" }, _.p({ class: "tl-flow-muted" }, "Agent Runtime non disponibile."));
  }
  loadAgentToolDebug(node);
  const record = state.agentToolDebug?.[node.id] || { loading: true, manifest: null };
  const manifest = record.manifest || null;
  const manifests = manifest?.manifests || [];
  const last = record.lastToolCall || null;
  return _.section(
    { class: "tl-flow-detail-list" },
    _.h3("Agent Tools Debug"),
    ...[
      ["Status", record.loading ? "loading..." : record.error ? "error" : "ready"],
      ["Tool count", record.loading ? "loading..." : manifest?.toolCount || 0],
      ["MCP ready", manifest?.mcpReady ? "yes" : "N/D"],
      ["Scope", manifest?.scope || "N/D"],
    ].map(([label, value]) => _.div({ class: "tl-flow-kg-stat-row" }, _.span(label), _.strong(String(value)))),
    record.error ? _.p({ class: "tl-flow-muted" }, record.error) : null,
    _.div(
      { class: "is-wide" },
      _.span("Actions"),
      _.div(
        { class: "tl-flow-storage-record-actions tl-flow-kg-actions" },
        manifest ? copyRuntimeButton(manifest, "Copy tool manifest") : null,
        btn({
          class: "is-ghost is-compact",
          title: "Refresh Agent tools",
          onclick: () => loadAgentToolDebug(node, { force: true }),
        }, icon("sync", "sm"), "Refresh")
      )
    ),
    manifests.length
      ? _.div(
        { class: "is-wide" },
        _.span("Connected tool manifests"),
        _.div(
          { class: "tl-flow-rag-source-list tl-flow-kg-list" },
          ...manifests.map((item) =>
            _.article(
              { class: "tl-flow-rag-source tl-flow-kg-item" },
              _.strong(`${item.label || item.nodeId} · ${item.relation || "self"} · ${item.toolCount || 0} tools`),
              _.span(`${item.subtype || item.type || "node"} · ${item.nodeId || ""}`),
              ...(item.tools || []).slice(0, 8).map((tool) =>
                _.div(
                  { class: "tl-flow-storage-record-actions tl-flow-kg-actions" },
                  _.code(tool.mcpName || tool.name),
                  _.span(`${tool.mode || "read"}${tool.requiresEvidence ? " · evidence" : ""}`),
                  btn({
                    class: "is-ghost is-compact",
                    title: `Probe ${tool.name}`,
                    disabled: tool.mode !== "read" || !window.TrackerLensAgentRuntime?.callConnectedNodeTool,
                    onclick: () => openAgentToolProbeDialog({ selected: node, manifest: item, tool }),
                  }, icon("terminal", "sm"), "Probe")
                )
              )
            )
          )
        )
      )
      : _.p({ class: "tl-flow-muted" }, record.loading ? "Caricamento Agent tools..." : "Nessun Agent tool trovato per questo nodo/scope."),
    last
      ? _.div(
        { class: "is-wide" },
        _.span("Last probe result"),
        _.pre({ class: "tl-flow-storage-record-preview" }, JSON.stringify(last, null, 2))
      )
      : null
  );
};

const renderInspectorKnowledgeDocument = (node = {}) => {
  if (!isKnowledgeDocumentStoreNode(node)) {
    return _.section({ class: "tl-flow-detail-list" }, _.p({ class: "tl-flow-muted" }, "N/D"));
  }
  loadKnowledgeInspectorDocument(node);
  const record = state.knowledgeInspectorDocuments[node.id] || { loading: true, document: null, count: 0, chunkCount: 0 };
  const documentRecord = record.document || null;
  const meta = documentRecord?.metadata || {};
  return _.section(
      { class: "tl-flow-detail-list" },
      _.h3("Knowledge Document Debug"),
    ...knowledgeUploadProgressNodes(node),
    ...[
      ["Documents", record.loading ? "loading..." : record.count || 0],
      ["Document ID", documentRecord?.id || "N/D"],
      ["Title", documentRecord?.title || "N/D"],
      ["File name", meta.fileName || "N/D"],
      ["Size", meta.fileSize ? `${Math.round(Number(meta.fileSize) / 1024)} KB` : "N/D"],
      ["MIME", documentRecord?.mimeType || meta.mimeType || "N/D"],
      ["Collection", meta.collectionId || "all"],
      ["Chunks", record.loading ? "loading..." : record.chunkCount || 0],
      ["Text length", documentRecord?.text ? `${String(documentRecord.text).length.toLocaleString()} chars` : "N/D"],
      ["Created", documentRecord?.createdAt ? formatShortDate(documentRecord.createdAt) : "N/D"],
    ].map(([label, value]) => _.div({ class: "tl-flow-kg-stat-row" }, _.span(label), _.strong(String(value)))),
    record.error ? _.p({ class: "tl-flow-muted" }, record.error) : null,
    _.div(
      { class: "is-wide" },
      _.span("Actions"),
      _.div(
        { class: "tl-flow-storage-record-actions tl-flow-kg-actions" },
        btn({
          class: "is-ghost is-compact",
          title: "Upload Document",
          onclick: () => requestKnowledgeDocumentUpload(node),
        }, icon("upload_file", "sm"), "Upload Document"),
        btn({
          class: "is-ghost is-compact",
          title: "View uploaded documents",
          onclick: () => openKnowledgeDocumentsDialog(node),
        }, icon("folder_open", "sm"), "View Documents"),
        btn({
          class: "is-danger is-compact",
          title: "Clear derived Knowledge memory",
          onclick: () => requestKnowledgeDocumentMemoryClear(node),
        }, icon("delete_sweep", "sm"), "Clear Memory"),
        documentRecord ? copyRuntimeButton(documentRecord, "Copy document record") : null,
        btn({
          class: "is-ghost is-compact",
          title: "Refresh document",
          onclick: () => loadKnowledgeInspectorDocument(node, { force: true }),
        }, icon("sync", "sm"), "Refresh")
      )
    ),
    documentRecord?.text
      ? _.div(
        { class: "is-wide" },
        _.span("Preview"),
        _.div(
          { class: "tl-kdoc-preview-actions" },
          String(documentRecord.text || "").length > 1800 ? btn({
            class: "is-ghost is-compact",
            onclick: () => openKnowledgeDocumentFullTextDialog(documentRecord),
          }, icon("article", "sm"), "View Full Document") : null
        ),
        _.pre({ class: "tl-flow-storage-record-preview" }, knowledgeDocumentPreviewText(documentRecord, 1800))
      )
      : _.p({ class: "tl-flow-muted" }, record.loading ? "Caricamento documento Knowledge..." : "Nessun documento trovato per questo nodo.")
  );
};

const renderInspectorKnowledgeDictionary = (node = {}) => {
  if (!isKnowledgeDictionaryBuilderNode(node)) {
    return _.section({ class: "tl-flow-detail-list" }, _.p({ class: "tl-flow-muted" }, "N/D"));
  }
  loadKnowledgeInspectorDictionary(node);
  const record = state.knowledgeInspectorDictionaries[node.id] || {
    loading: true,
    entries: [],
    summary: summarizeKnowledgeDictionaryEntries([]),
    config: nodeRuntimeConfig(node),
  };
  const entries = record.entries || [];
  const summary = record.summary || summarizeKnowledgeDictionaryEntries(entries);
  const config = record.config || nodeRuntimeConfig(node);
  const countsText = (counts = {}) =>
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([key, count]) => `${key}:${count}`)
      .join(", ") || "N/D";
  const exportPayload = {
    nodeId: node.id,
    workspaceId: record.workspaceId || node.workspaceId || state.filters.workspaceId || "workspace_global",
    documentId: String(config.documentId || "").trim(),
    collectionId: String(config.collectionId || "").trim(),
    language: String(config.language || "").trim(),
    summary,
    entries,
    exportedAt: new Date().toISOString(),
  };
  return _.section(
    { class: "tl-flow-detail-list" },
    _.h3("Knowledge Dictionary Debug"),
    ...[
      ["Entries", record.loading ? "loading..." : summary.entryCount || 0],
      ["Usable seeds", record.loading ? "loading..." : summary.usableSeedCount || 0],
      ["Tier counts", record.loading ? "loading..." : countsText(summary.tierCounts)],
      ["Languages", record.loading ? "loading..." : countsText(summary.languageCounts)],
      ["Top types", record.loading ? "loading..." : countsText(summary.typeCounts)],
      ["Workspace", exportPayload.workspaceId || "workspace_global"],
      ["Document", exportPayload.documentId || "all"],
      ["Collection", exportPayload.collectionId || "all"],
      ["Language", exportPayload.language || "auto"],
    ].map(([label, value]) => _.div({ class: "tl-flow-kg-stat-row" }, _.span(label), _.strong(String(value)))),
    record.error ? _.p({ class: "tl-flow-muted" }, record.error) : null,
    _.div(
      { class: "is-wide" },
      _.span("Actions"),
      _.div(
        { class: "tl-flow-storage-record-actions tl-flow-kg-actions" },
        copyRuntimeButton(exportPayload, "Copy dictionary export"),
        btn({
          class: "is-danger is-compact",
          title: "Clear Knowledge dictionary records",
          onclick: () => requestKnowledgeDictionaryClear(node),
        }, icon("delete_sweep", "sm"), "Clear Dictionary"),
        btn({
          class: "is-ghost is-compact",
          title: "Refresh Knowledge dictionary",
          onclick: () => loadKnowledgeInspectorDictionary(node, { force: true }),
        }, icon("sync", "sm"), "Refresh")
      )
    ),
    entries.length
      ? _.div(
        { class: "is-wide" },
        _.span("Top dictionary entries"),
        _.div(
          { class: "tl-flow-rag-source-list tl-flow-kg-list" },
          ...entries.slice(0, 12).map((entry) =>
            _.article(
              { class: "tl-flow-rag-source tl-flow-kg-item" },
              _.strong(`${entry.term || entry.label || entry.lemma || entry.id} · ${entry.tier || "unknown"}${entry.usableAsSeed ? " · seed" : ""}`),
              _.span(`${knowledgeDictionaryTypeLabel(entry)} · score ${Number.isFinite(Number(entry.seedScore)) ? Number(entry.seedScore).toFixed(2) : "N/D"} · confidence ${Number.isFinite(Number(entry.confidence)) ? Number(entry.confidence).toFixed(2) : "N/D"}`),
              _.p([
                entry.lemma && entry.lemma !== entry.term ? `lemma ${entry.lemma}` : "",
                knowledgeDictionaryEvidenceText(entry),
                entry.documentId || entry.chunkId || "",
              ].filter(Boolean).join(" · "))
            )
          )
        )
      )
      : _.p({ class: "tl-flow-muted" }, record.loading ? "Caricamento Dictionary..." : "Nessun entry Dictionary trovato per questo scope.")
  );
};

const renderInspectorKnowledgeEvents = (node = {}) => {
  if (!isKnowledgeEventBuilderNode(node)) {
    return _.section({ class: "tl-flow-detail-list" }, _.p({ class: "tl-flow-muted" }, "N/D"));
  }
  loadKnowledgeInspectorEvents(node);
  const record = state.knowledgeInspectorEvents[node.id] || {
    loading: true,
    events: [],
    summary: summarizeKnowledgeEventEntries([]),
    config: nodeRuntimeConfig(node),
  };
  const events = record.events || [];
  const summary = record.summary || summarizeKnowledgeEventEntries(events);
  const config = record.config || nodeRuntimeConfig(node);
  const countsText = (counts = {}) =>
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 8)
      .map(([key, count]) => `${key}:${count}`)
      .join(", ") || "N/D";
  const exportPayload = {
    nodeId: node.id,
    workspaceId: record.workspaceId || node.workspaceId || state.filters.workspaceId || "workspace_global",
    documentId: String(config.documentId || "").trim(),
    collectionId: String(config.collectionId || "").trim(),
    extractionMode: String(config.extractionMode || "rules"),
    summary,
    events,
    exportedAt: new Date().toISOString(),
  };
  return _.section(
    { class: "tl-flow-detail-list" },
    _.h3("Knowledge Event Debug"),
    ...[
      ["Events", record.loading ? "loading..." : summary.eventCount || 0],
      ["Event types", record.loading ? "loading..." : countsText(summary.typeCounts)],
      ["Methods", record.loading ? "loading..." : countsText(summary.methodCounts)],
      ["Documents", record.loading ? "loading..." : countsText(summary.documentCounts)],
      ["Avg confidence", record.loading ? "loading..." : Number.isFinite(Number(summary.averageConfidence)) ? Number(summary.averageConfidence).toFixed(2) : "N/D"],
      ["Sequence range", record.loading ? "loading..." : summary.firstSequence && summary.lastSequence ? `${summary.firstSequence}-${summary.lastSequence}` : "N/D"],
      ["Workspace", exportPayload.workspaceId || "workspace_global"],
      ["Document", exportPayload.documentId || "all"],
      ["Collection", exportPayload.collectionId || "all"],
      ["Mode", exportPayload.extractionMode || "rules"],
    ].map(([label, value]) => _.div({ class: "tl-flow-kg-stat-row" }, _.span(label), _.strong(String(value)))),
    record.error ? _.p({ class: "tl-flow-muted" }, record.error) : null,
    _.div(
      { class: "is-wide" },
      _.span("Actions"),
      _.div(
        { class: "tl-flow-storage-record-actions tl-flow-kg-actions" },
        copyRuntimeButton(exportPayload, "Copy event export"),
        btn({
          class: "is-danger is-compact",
          title: "Clear Knowledge event records",
          onclick: () => requestKnowledgeEventsClear(node),
        }, icon("delete_sweep", "sm"), "Clear Events"),
        btn({
          class: "is-ghost is-compact",
          title: "Refresh Knowledge events",
          onclick: () => loadKnowledgeInspectorEvents(node, { force: true }),
        }, icon("sync", "sm"), "Refresh")
      )
    ),
    events.length
      ? _.div(
        { class: "is-wide" },
        _.span("Timeline preview"),
        _.div(
          { class: "tl-flow-rag-source-list tl-flow-kg-list" },
          ...events.slice(0, 16).map((entry) =>
            _.article(
              { class: "tl-flow-rag-source tl-flow-kg-item" },
              _.strong(`[${entry.sequence || "?"}] ${entry.subject || "event"} -${entry.eventType || entry.action || "event"}-> ${(entry.objects || []).join(", ") || "context"}`),
              _.span(`${entry.source?.method || entry.extraction?.method || "unknown"} · confidence ${Number.isFinite(Number(entry.confidence)) ? Number(entry.confidence).toFixed(2) : "N/D"} · chunk ${entry.chunkIndex ?? "N/D"}`),
              _.p([
                knowledgeEventEvidenceText(entry),
                entry.metadata?.explanation || "",
                entry.documentId || entry.chunkId || "",
              ].filter(Boolean).join(" · "))
            )
          )
        )
      )
      : _.p({ class: "tl-flow-muted" }, record.loading ? "Caricamento eventi Knowledge..." : "Nessun evento trovato per questo scope.")
  );
};

const renderInspectorStructuredKnowledge = (node = {}) => {
  if (!isStructuredKnowledgeStoreNode(node)) {
    return _.section({ class: "tl-flow-detail-list" }, _.p({ class: "tl-flow-muted" }, "N/D"));
  }
  loadStructuredKnowledgeInspector(node);
  const record = state.knowledgeInspectorStructured?.[node.id] || {
    loading: true,
    records: [],
    summary: summarizeStructuredKnowledgeRecords([]),
    config: nodeRuntimeConfig(node),
  };
  const records = record.records || [];
  const summary = record.summary || summarizeStructuredKnowledgeRecords(records);
  const config = record.config || nodeRuntimeConfig(node);
  const countsText = (counts = {}) =>
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([key, count]) => `${key}:${count}`)
      .join(", ") || "N/D";
  const exportPayload = {
    nodeId: node.id,
    subtype: nodeSubtype(node),
    workspaceId: record.workspaceId || node.workspaceId || state.filters.workspaceId || "workspace_global",
    collectionId: String(config.collectionId || "").trim(),
    schemaId: nodeSubtype(node) === "world-database" ? "worldbuilding/v1" : String(config.schemaId || "").trim(),
    worldId: String(config.worldId || "").trim(),
    summary,
    records,
    exportedAt: new Date().toISOString(),
  };
  return _.section(
    { class: "tl-flow-detail-list" },
    _.h3(nodeSubtype(node) === "world-database" ? "World Database Debug" : "Structured Knowledge Debug"),
    ...[
      ["Records", record.loading ? "loading..." : summary.recordCount || 0],
      ["Types", record.loading ? "loading..." : countsText(summary.typeCounts)],
      ["Schemas", record.loading ? "loading..." : countsText(summary.schemaCounts)],
      ["Worlds", record.loading ? "loading..." : countsText(summary.worldCounts)],
      ["Workspace", exportPayload.workspaceId || "workspace_global"],
      ["Collection", exportPayload.collectionId || "all"],
      ["Schema", exportPayload.schemaId || "all"],
      ["World", exportPayload.worldId || "all"],
    ].map(([label, value]) => _.div({ class: "tl-flow-kg-stat-row" }, _.span(label), _.strong(String(value)))),
    record.error ? _.p({ class: "tl-flow-muted" }, record.error) : null,
    _.div(
      { class: "is-wide" },
      _.span("Actions"),
      _.div(
        { class: "tl-flow-storage-record-actions tl-flow-kg-actions" },
        copyRuntimeButton(exportPayload, "Copy structured export"),
        btn({
          class: "is-ghost is-compact",
          title: "Refresh structured records",
          onclick: () => loadStructuredKnowledgeInspector(node, { force: true }),
        }, icon("sync", "sm"), "Refresh")
      )
    ),
    records.length
      ? _.div(
        { class: "is-wide" },
        _.span("Records preview"),
        _.div(
          { class: "tl-flow-rag-source-list tl-flow-kg-list" },
          ...records.slice(0, 20).map((item) =>
            _.article(
              { class: "tl-flow-rag-source tl-flow-kg-item" },
              _.strong(`${item.label || item.id} · ${item.recordType || "record"}`),
              _.span(`${item.schemaId || "structured/v1"} · ${item.collectionId || "collection"}${item.worldId ? ` · ${item.worldId}` : ""}`),
              _.p([item.parentId ? `parent ${item.parentId}` : "", item.id || ""].filter(Boolean).join(" · "))
            )
          )
        )
      )
      : _.p({ class: "tl-flow-muted" }, record.loading ? "Caricamento record strutturati..." : "Nessun record strutturato trovato per questo scope.")
  );
};

const loadKnowledgeInspectorGraph = async (node = {}, { force = false } = {}) => {
  if (!node?.id || nodeCategory(node) !== "knowledge") return;
  const cached = state.knowledgeInspectorGraph[node.id];
  if (!force && cached && (cached.loading || Date.now() - Number(cached.loadedAt || 0) < 2500)) return;
  state.knowledgeInspectorGraph = {
    ...state.knowledgeInspectorGraph,
    [node.id]: {
      ...(cached || {}),
      loading: true,
      error: "",
    },
  };
  try {
    const [entities, relations, metrics] = await Promise.all([
      readKnowledgeInspectorStore(knowledgeTableName("TL_KNOWLEDGE_ENTITIES", "tl_knowledge_entities")),
      readKnowledgeInspectorStore(knowledgeTableName("TL_KNOWLEDGE_RELATIONS", "tl_knowledge_relations")),
      readKnowledgeInspectorStore(knowledgeTableName("TL_KNOWLEDGE_METRICS", "tl_knowledge_metrics")),
    ]);
    const workspaceId = node.workspaceId || state.filters.workspaceId || "workspace_global";
    const config = nodeRuntimeConfig(node);
    const collectionId = String(config.collectionId || "").trim();
    const configuredDocumentId = String(config.documentId || "").trim();
    const rawConfiguredGraphScope = String(config.graphScope || "").toLowerCase();
    const configuredGraphScope = rawConfiguredGraphScope === "document" && !configuredDocumentId && collectionId
      ? "collection"
      : rawConfiguredGraphScope;
    const graphMetrics = (metrics || [])
      .filter((metric) => (metric.workspaceId || "workspace_global") === workspaceId)
      .filter((metric) => metric.metric === "knowledge.graph.snapshot")
      .filter((metric) => !collectionId || metric.value?.collectionId === collectionId)
      .sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""));
    const latestMetric = graphMetrics[0] || null;
    const metricGraphScope = String(latestMetric?.value?.graphScope || "").toLowerCase();
    const aggregateGraph = ["collection", "workspace", "all"].includes(configuredGraphScope || metricGraphScope);
    const documentsWithSnapshots = new Set(graphMetrics.map((metric) => metric.value?.documentId).filter(Boolean));
    const documentId = aggregateGraph
      ? ""
      : configuredDocumentId && documentsWithSnapshots.has(configuredDocumentId)
      ? configuredDocumentId
      : latestMetric?.value?.documentId || configuredDocumentId;
    const documentMismatch = Boolean(
      !aggregateGraph &&
      configuredDocumentId &&
      documentId &&
      configuredDocumentId !== documentId &&
      !isKnowledgeGraphSampleDocumentFallback(configuredDocumentId, documentId)
    );
    const workspaceEntities = (entities || [])
      .filter((entity) => (entity.workspaceId || "workspace_global") === workspaceId)
      .filter((entity) => !collectionId || entity.metadata?.collectionId === collectionId)
      .filter((entity) => !documentId || entity.documentId === documentId)
      .filter((entity) => !isWeakKnowledgeInspectorEntity(entity));
    const entityIds = new Set(workspaceEntities.map((entity) => entity.id));
    const workspaceRelations = (relations || [])
      .filter((relation) => (relation.workspaceId || "workspace_global") === workspaceId)
      .filter((relation) => entityIds.has(relation.sourceEntityId) && entityIds.has(relation.targetEntityId))
      .filter((relation) => !collectionId || relation.metadata?.collectionId === collectionId)
      .filter((relation) => !documentId || relation.documentId === documentId);
    const filteredGraphMetrics = graphMetrics
      .filter((metric) => !documentId || metric.value?.documentId === documentId);
    const topEntities = workspaceEntities
      .map((entity) => ({
        ...entity,
        degree: workspaceRelations.filter((relation) =>
          relation.sourceEntityId === entity.id || relation.targetEntityId === entity.id
        ).length,
      }))
      .sort((a, b) => b.degree - a.degree || String(a.label || "").localeCompare(String(b.label || "")))
      .slice(0, 10);
    state.knowledgeInspectorGraph = {
      ...state.knowledgeInspectorGraph,
      [node.id]: {
        loading: false,
        entities: workspaceEntities,
        relations: workspaceRelations,
        metrics: filteredGraphMetrics,
        topEntities,
        configuredDocumentId,
        effectiveDocumentId: documentId,
        latestSnapshotDocumentId: latestMetric?.value?.documentId || "",
        latestSnapshotDocumentIds: latestMetric?.value?.documentIds || [],
        graphScope: configuredGraphScope || metricGraphScope || (aggregateGraph ? "collection" : "document"),
        documentMismatch,
        collectionId,
        workspaceId,
        loadedAt: Date.now(),
        error: "",
      },
    };
  } catch (error) {
    state.knowledgeInspectorGraph = {
      ...state.knowledgeInspectorGraph,
      [node.id]: {
        loading: false,
        entities: [],
        relations: [],
        metrics: [],
        topEntities: [],
        loadedAt: Date.now(),
        error: error?.message || "Knowledge graph read failed",
      },
    };
  }
  if (selectedNode()?.id === node.id) mount({ preserveScroll: true });
};

const knowledgeGraphTypeColors = {
  "proper-noun": "#38bdf8",
  location: "#34d399",
  object: "#f59e0b",
  creature: "#f472b6",
  concept: "#a78bfa",
  source: "#60a5fa",
  quote: "#facc15",
  technology: "#22c55e",
  symbol: "#facc15",
  url: "#a78bfa",
  email: "#fb7185",
  term: "#94a3b8",
  entity: "#67e8f9",
};

const knowledgeGraphRelationColors = {
  appears_in: "#34d399",
  contains: "#60a5fa",
  encounters: "#f472b6",
  interacts_with: "#f59e0b",
  uses: "#f97316",
  helps: "#10b981",
  tries_to_help: "#2dd4bf",
  friend_of: "#4ade80",
  healed_by: "#14b8a6",
  cannot_speak: "#fb7185",
  has_property: "#a78bfa",
  lives_in: "#34d399",
  seeks: "#38bdf8",
  protects: "#22c55e",
  opposes: "#ef4444",
  causes: "#f97316",
  leads_to: "#f59e0b",
  is_part_of: "#c084fc",
  teaches: "#fde047",
  discovers: "#60a5fa",
  asks_for: "#f472b6",
  receives_from: "#818cf8",
  gives_to: "#fb923c",
  heals: "#14b8a6",
  confronts: "#ef4444",
  travels_to: "#38bdf8",
  transforms: "#e879f9",
  reveals: "#fde047",
  expresses: "#a78bfa",
  context_for: "#22d3ee",
  associated_with: "#facc15",
  says: "#fb7185",
  marks: "#818cf8",
  part_of: "#c084fc",
  co_occurs: "#94a3b8",
  relation: "#94a3b8",
};

const normalizeKnowledgeInspectorToken = (value = "") =>
  String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const inspectorEntityStopWords = new Set([
  "abita", "aveva", "avevano", "compiuto", "comprese", "dopo", "doveva", "dovevano", "eravamo", "eppure",
  "giorno", "mai", "mediante", "molto", "ogni", "ora", "presto", "primo", "qualcosa", "seguente",
  "semplice", "siamo", "soltanto", "sono", "stato", "uscita", "vecchio", "veniva", "venivano", "viene",
  "vengono", "via"
]);

const inspectorKnownAcronyms = new Set(["ai", "aids", "api", "cpu", "css", "db", "gpu", "hiv", "html", "json", "llm", "rag", "sql", "ui", "url"]);

const isWeakKnowledgeInspectorEntity = (entity = {}) => {
  if (entity.source === "seed") return false;
  const label = String(entity.label || "").trim();
  const normalized = normalizeKnowledgeInspectorToken(label);
  const words = normalized.split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  if (words.every((word) => inspectorEntityStopWords.has(word))) return true;
  if (/\d/.test(normalized) && !/[a-z]/i.test(normalized)) return true;
  if (entity.source === "symbol" || entity.entityType === "symbol") {
    const hasTechnicalMarker = /[\d_-]/.test(label);
    if (!hasTechnicalMarker && !inspectorKnownAcronyms.has(normalized)) return true;
  }
  if (entity.source === "quote" || entity.entityType === "quote") {
    const lexicalWords = words.filter((word) => /[a-z]/i.test(word) && word.length >= 2);
    const digitHeavy = words.some((word) => /\d/.test(word));
    if (lexicalWords.length < 2 || digitHeavy) return true;
  }
  return false;
};

const collectKnowledgeGraphData = async (node = {}) => {
  const [entities, relations, metrics] = await Promise.all([
    readKnowledgeInspectorStore(knowledgeTableName("TL_KNOWLEDGE_ENTITIES", "tl_knowledge_entities")),
    readKnowledgeInspectorStore(knowledgeTableName("TL_KNOWLEDGE_RELATIONS", "tl_knowledge_relations")),
    readKnowledgeInspectorStore(knowledgeTableName("TL_KNOWLEDGE_METRICS", "tl_knowledge_metrics")),
  ]);
  const workspaceId = node.workspaceId || state.filters.workspaceId || "workspace_global";
  const config = nodeRuntimeConfig(node);
  const collectionId = String(config.collectionId || "").trim();
  const configuredDocumentId = String(config.documentId || "").trim();
  const rawConfiguredGraphScope = String(config.graphScope || "").toLowerCase();
  const configuredGraphScope = rawConfiguredGraphScope === "document" && !configuredDocumentId && collectionId
    ? "collection"
    : rawConfiguredGraphScope;
  const allGraphMetrics = (metrics || [])
    .filter((metric) => (metric.workspaceId || "workspace_global") === workspaceId)
    .filter((metric) => metric.metric === "knowledge.graph.snapshot")
    .filter((metric) => !collectionId || metric.value?.collectionId === collectionId)
    .sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""));
  const latestMetric = allGraphMetrics[0] || null;
  const metricGraphScope = String(latestMetric?.value?.graphScope || "").toLowerCase();
  const aggregateGraph = ["collection", "workspace", "all"].includes(configuredGraphScope || metricGraphScope);
  const documentsWithSnapshots = new Set(allGraphMetrics.map((metric) => metric.value?.documentId).filter(Boolean));
  const documentId = aggregateGraph
    ? ""
    : configuredDocumentId && documentsWithSnapshots.has(configuredDocumentId)
    ? configuredDocumentId
    : latestMetric?.value?.documentId || configuredDocumentId;
  const documentMismatch = Boolean(
    !aggregateGraph &&
    configuredDocumentId &&
    documentId &&
    configuredDocumentId !== documentId &&
    !isKnowledgeGraphSampleDocumentFallback(configuredDocumentId, documentId)
  );
  const scopedEntities = (entities || [])
    .filter((entity) => (entity.workspaceId || "workspace_global") === workspaceId)
    .filter((entity) => !collectionId || entity.metadata?.collectionId === collectionId)
    .filter((entity) => !documentId || entity.documentId === documentId)
    .filter((entity) => !isWeakKnowledgeInspectorEntity(entity));
  const entityIds = new Set(scopedEntities.map((entity) => entity.id));
  const scopedRelations = (relations || [])
    .filter((relation) => (relation.workspaceId || "workspace_global") === workspaceId)
    .filter((relation) => entityIds.has(relation.sourceEntityId) && entityIds.has(relation.targetEntityId))
    .filter((relation) => !collectionId || relation.metadata?.collectionId === collectionId)
    .filter((relation) => !documentId || relation.documentId === documentId);
  const graphMetrics = allGraphMetrics
    .filter((metric) => !documentId || metric.value?.documentId === documentId);
  return {
    entities: scopedEntities,
    relations: scopedRelations,
    metrics: graphMetrics,
    collectionId,
    documentId,
    configuredDocumentId,
    latestSnapshotDocumentId: latestMetric?.value?.documentId || "",
    latestSnapshotDocumentIds: latestMetric?.value?.documentIds || [],
    graphScope: configuredGraphScope || metricGraphScope || (aggregateGraph ? "collection" : "document"),
    documentMismatch,
    workspaceId,
  };
};

const isKnowledgeGraphSampleDocumentFallback = (configuredDocumentId = "", effectiveDocumentId = "") =>
  String(configuredDocumentId || "").startsWith("knowledge_graph_sample_document_") &&
  /^kdoc_/i.test(String(effectiveDocumentId || ""));

const clearKnowledgeGraphIndexForNode = async (node = {}) => {
  if (!node?.id) return null;
  const { workspaceId, collectionId, documentId, graphScope } = knowledgeClearScopeForNode(node);
  if (window.TrackerLensKnowledgeRuntime?.clearGraphIndex) {
    return window.TrackerLensKnowledgeRuntime.clearGraphIndex({ workspaceId, collectionId, documentId, graphScope });
  }
  const stores = {
    entities: knowledgeTableName("TL_KNOWLEDGE_ENTITIES", "tl_knowledge_entities"),
    relations: knowledgeTableName("TL_KNOWLEDGE_RELATIONS", "tl_knowledge_relations"),
    metrics: knowledgeTableName("TL_KNOWLEDGE_METRICS", "tl_knowledge_metrics"),
    queries: knowledgeTableName("TL_KNOWLEDGE_QUERIES", "tl_knowledge_queries"),
  };
  const [entities, relations, metrics, queries] = await Promise.all([
    readKnowledgeInspectorStore(stores.entities),
    readKnowledgeInspectorStore(stores.relations),
    readKnowledgeInspectorStore(stores.metrics),
    readKnowledgeInspectorStore(stores.queries),
  ]);
  const scopedEntities = (entities || [])
    .filter((entity) => (entity.workspaceId || "workspace_global") === workspaceId)
    .filter((entity) => !collectionId || entity.metadata?.collectionId === collectionId)
    .filter((entity) => graphScope !== "document" || !documentId || entity.documentId === documentId);
  const entityIds = new Set(scopedEntities.map((entity) => entity.id));
  const documentIds = new Set(scopedEntities.map((entity) => entity.documentId).filter(Boolean));
  const scopedRelations = (relations || [])
    .filter((relation) => (relation.workspaceId || "workspace_global") === workspaceId)
    .filter((relation) =>
      entityIds.has(relation.sourceEntityId) ||
      entityIds.has(relation.targetEntityId) ||
      (graphScope === "document" && documentId && relation.documentId === documentId) ||
      (graphScope !== "document" && documentIds.has(relation.documentId))
    )
    .filter((relation) => !collectionId || relation.metadata?.collectionId === collectionId);
  const scopedMetrics = (metrics || [])
    .filter((metric) => (metric.workspaceId || "workspace_global") === workspaceId)
    .filter((metric) => metric.metric === "knowledge.graph.snapshot")
    .filter((metric) => !collectionId || metric.value?.collectionId === collectionId)
    .filter((metric) => graphScope !== "document" || !documentId || metric.value?.documentId === documentId);
  const scopedQueries = (queries || [])
    .filter((query) => (query.workspaceId || "workspace_global") === workspaceId)
    .filter((query) => !collectionId || query.scope?.collectionId === collectionId || query.collectionId === collectionId)
    .filter((query) => graphScope !== "document" || !documentId || query.scope?.documentId === documentId || query.documentId === documentId);
  await Promise.all([
    deleteKnowledgeInspectorStoreRecords(stores.relations, scopedRelations.map((relation) => relation.id)),
    deleteKnowledgeInspectorStoreRecords(stores.entities, scopedEntities.map((entity) => entity.id)),
    deleteKnowledgeInspectorStoreRecords(stores.metrics, scopedMetrics.map((metric) => metric.id)),
    deleteKnowledgeInspectorStoreRecords(stores.queries, scopedQueries.map((query) => query.id)),
  ]);
  return {
    entities: scopedEntities.length,
    relations: scopedRelations.length,
    snapshots: scopedMetrics.length,
    queries: scopedQueries.length,
    documentIds: [...documentIds],
    graphScope,
    collectionId,
    documentId: graphScope === "document" ? documentId : "",
  };
};

const clearKnowledgeDictionaryForNode = async (node = {}) => {
  if (!node?.id) return null;
  const { workspaceId, collectionId, documentId, graphScope } = knowledgeClearScopeForNode(node);
  const stores = {
    dictionary: knowledgeTableName("TL_KNOWLEDGE_DICTIONARY", "tl_knowledge_dictionary"),
    queries: knowledgeTableName("TL_KNOWLEDGE_QUERIES", "tl_knowledge_queries"),
  };
  const [dictionary, queries] = await Promise.all([
    readKnowledgeInspectorStore(stores.dictionary),
    readKnowledgeInspectorStore(stores.queries),
  ]);
  const scopedDictionary = (dictionary || [])
    .filter((entry) => (entry.workspaceId || "workspace_global") === workspaceId)
    .filter((entry) => !collectionId || entry.collectionId === collectionId || entry.metadata?.collectionId === collectionId)
    .filter((entry) => graphScope !== "document" || !documentId || entry.documentId === documentId);
  const scopedQueries = (queries || [])
    .filter((query) => (query.workspaceId || "workspace_global") === workspaceId)
    .filter((query) => !collectionId || query.scope?.collectionId === collectionId || query.collectionId === collectionId)
    .filter((query) => graphScope !== "document" || !documentId || query.scope?.documentId === documentId || query.documentId === documentId);
  await Promise.all([
    deleteKnowledgeInspectorStoreRecords(stores.dictionary, scopedDictionary.map((entry) => entry.id)),
    deleteKnowledgeInspectorStoreRecords(stores.queries, scopedQueries.map((query) => query.id)),
  ]);
  return { dictionary: scopedDictionary.length, queries: scopedQueries.length, graphScope, collectionId, documentId: graphScope === "document" ? documentId : "" };
};

const clearKnowledgeEventsForNode = async (node = {}) => {
  if (!node?.id) return null;
  const { workspaceId, collectionId, documentId, graphScope } = knowledgeClearScopeForNode(node);
  const stores = {
    events: knowledgeTableName("TL_KNOWLEDGE_EVENTS", "tl_knowledge_events"),
    queries: knowledgeTableName("TL_KNOWLEDGE_QUERIES", "tl_knowledge_queries"),
  };
  const [events, queries] = await Promise.all([
    readKnowledgeInspectorStore(stores.events),
    readKnowledgeInspectorStore(stores.queries),
  ]);
  const scopedEvents = (events || [])
    .filter((entry) => (entry.workspaceId || "workspace_global") === workspaceId)
    .filter((entry) => !collectionId || entry.collectionId === collectionId || entry.metadata?.collectionId === collectionId)
    .filter((entry) => graphScope !== "document" || !documentId || entry.documentId === documentId);
  const scopedQueries = (queries || [])
    .filter((query) => (query.workspaceId || "workspace_global") === workspaceId)
    .filter((query) => !collectionId || query.scope?.collectionId === collectionId || query.collectionId === collectionId)
    .filter((query) => graphScope !== "document" || !documentId || query.scope?.documentId === documentId || query.documentId === documentId);
  await Promise.all([
    deleteKnowledgeInspectorStoreRecords(stores.events, scopedEvents.map((entry) => entry.id)),
    deleteKnowledgeInspectorStoreRecords(stores.queries, scopedQueries.map((query) => query.id)),
  ]);
  return { events: scopedEvents.length, queries: scopedQueries.length, graphScope, collectionId, documentId: graphScope === "document" ? documentId : "" };
};

const clearKnowledgeEntityGraphForNode = async (node = {}) => {
  if (!node?.id) return null;
  const { workspaceId, collectionId, documentId, graphScope } = knowledgeClearScopeForNode(node);
  const stores = {
    entities: knowledgeTableName("TL_KNOWLEDGE_ENTITIES", "tl_knowledge_entities"),
    relations: knowledgeTableName("TL_KNOWLEDGE_RELATIONS", "tl_knowledge_relations"),
    metrics: knowledgeTableName("TL_KNOWLEDGE_METRICS", "tl_knowledge_metrics"),
    queries: knowledgeTableName("TL_KNOWLEDGE_QUERIES", "tl_knowledge_queries"),
  };
  const [entities, relations, metrics, queries] = await Promise.all([
    readKnowledgeInspectorStore(stores.entities),
    readKnowledgeInspectorStore(stores.relations),
    readKnowledgeInspectorStore(stores.metrics),
    readKnowledgeInspectorStore(stores.queries),
  ]);
  const scopedEntities = (entities || [])
    .filter((entity) => (entity.workspaceId || "workspace_global") === workspaceId)
    .filter((entity) => entity.metadata?.nodeId === node.id)
    .filter((entity) => !collectionId || entity.metadata?.collectionId === collectionId)
    .filter((entity) => graphScope !== "document" || !documentId || entity.documentId === documentId);
  const entityIds = new Set(scopedEntities.map((entity) => entity.id));
  const scopedRelations = (relations || [])
    .filter((relation) => (relation.workspaceId || "workspace_global") === workspaceId)
    .filter((relation) =>
      relation.metadata?.nodeId === node.id ||
      entityIds.has(relation.sourceEntityId) ||
      entityIds.has(relation.targetEntityId)
    )
    .filter((relation) => !collectionId || relation.metadata?.collectionId === collectionId)
    .filter((relation) => graphScope !== "document" || !documentId || relation.documentId === documentId);
  const scopedMetrics = (metrics || [])
    .filter((metric) => (metric.workspaceId || "workspace_global") === workspaceId)
    .filter((metric) => metric.metric === "knowledge.graph.snapshot")
    .filter((metric) => !collectionId || metric.value?.collectionId === collectionId)
    .filter((metric) => graphScope !== "document" || !documentId || metric.value?.documentId === documentId);
  const scopedQueries = (queries || [])
    .filter((query) => (query.workspaceId || "workspace_global") === workspaceId)
    .filter((query) => !collectionId || query.scope?.collectionId === collectionId || query.collectionId === collectionId)
    .filter((query) => graphScope !== "document" || !documentId || query.scope?.documentId === documentId || query.documentId === documentId);
  await Promise.all([
    deleteKnowledgeInspectorStoreRecords(stores.relations, scopedRelations.map((relation) => relation.id)),
    deleteKnowledgeInspectorStoreRecords(stores.entities, scopedEntities.map((entity) => entity.id)),
    deleteKnowledgeInspectorStoreRecords(stores.metrics, scopedMetrics.map((metric) => metric.id)),
    deleteKnowledgeInspectorStoreRecords(stores.queries, scopedQueries.map((query) => query.id)),
  ]);
  return { entities: scopedEntities.length, relations: scopedRelations.length, snapshots: scopedMetrics.length, queries: scopedQueries.length, graphScope, collectionId, documentId: graphScope === "document" ? documentId : "" };
};

const clearKnowledgeSemanticRelationsForNode = async (node = {}) => {
  if (!node?.id) return null;
  const { workspaceId, collectionId, documentId, graphScope } = knowledgeClearScopeForNode(node);
  const stores = {
    relations: knowledgeTableName("TL_KNOWLEDGE_RELATIONS", "tl_knowledge_relations"),
    metrics: knowledgeTableName("TL_KNOWLEDGE_METRICS", "tl_knowledge_metrics"),
    queries: knowledgeTableName("TL_KNOWLEDGE_QUERIES", "tl_knowledge_queries"),
  };
  const [relations, metrics, queries] = await Promise.all([
    readKnowledgeInspectorStore(stores.relations),
    readKnowledgeInspectorStore(stores.metrics),
    readKnowledgeInspectorStore(stores.queries),
  ]);
  const scopedRelations = (relations || [])
    .filter((relation) => (relation.workspaceId || "workspace_global") === workspaceId)
    .filter((relation) => relation.metadata?.semantic)
    .filter((relation) => !relation.metadata?.graphBuilder)
    .filter((relation) => relation.metadata?.nodeId === node.id)
    .filter((relation) => !collectionId || relation.metadata?.collectionId === collectionId)
    .filter((relation) => graphScope !== "document" || !documentId || relation.documentId === documentId);
  const scopedMetrics = (metrics || [])
    .filter((metric) => (metric.workspaceId || "workspace_global") === workspaceId)
    .filter((metric) => metric.metric === "knowledge.graph.snapshot")
    .filter((metric) => !collectionId || metric.value?.collectionId === collectionId)
    .filter((metric) => graphScope !== "document" || !documentId || metric.value?.documentId === documentId);
  const scopedQueries = (queries || [])
    .filter((query) => (query.workspaceId || "workspace_global") === workspaceId)
    .filter((query) => !collectionId || query.scope?.collectionId === collectionId || query.collectionId === collectionId)
    .filter((query) => graphScope !== "document" || !documentId || query.scope?.documentId === documentId || query.documentId === documentId);
  await Promise.all([
    deleteKnowledgeInspectorStoreRecords(stores.relations, scopedRelations.map((relation) => relation.id)),
    deleteKnowledgeInspectorStoreRecords(stores.metrics, scopedMetrics.map((metric) => metric.id)),
    deleteKnowledgeInspectorStoreRecords(stores.queries, scopedQueries.map((query) => query.id)),
  ]);
  return { relations: scopedRelations.length, snapshots: scopedMetrics.length, queries: scopedQueries.length, graphScope, collectionId, documentId: graphScope === "document" ? documentId : "" };
};

const clearKnowledgeGraphBuilderForNode = async (node = {}) => {
  if (!node?.id) return null;
  const { workspaceId, collectionId, documentId, graphScope } = knowledgeClearScopeForNode(node);
  const stores = {
    entities: knowledgeTableName("TL_KNOWLEDGE_ENTITIES", "tl_knowledge_entities"),
    relations: knowledgeTableName("TL_KNOWLEDGE_RELATIONS", "tl_knowledge_relations"),
    metrics: knowledgeTableName("TL_KNOWLEDGE_METRICS", "tl_knowledge_metrics"),
    queries: knowledgeTableName("TL_KNOWLEDGE_QUERIES", "tl_knowledge_queries"),
  };
  const [entities, relations, metrics, queries] = await Promise.all([
    readKnowledgeInspectorStore(stores.entities),
    readKnowledgeInspectorStore(stores.relations),
    readKnowledgeInspectorStore(stores.metrics),
    readKnowledgeInspectorStore(stores.queries),
  ]);
  const scopedEntities = (entities || [])
    .filter((entity) => (entity.workspaceId || "workspace_global") === workspaceId)
    .filter((entity) => entity.metadata?.graphBuilder)
    .filter((entity) => entity.metadata?.nodeId === node.id)
    .filter((entity) => !collectionId || entity.metadata?.collectionId === collectionId)
    .filter((entity) => graphScope !== "document" || !documentId || entity.documentId === documentId);
  const builderEntityIds = new Set(scopedEntities.map((entity) => entity.id));
  const scopedRelations = (relations || [])
    .filter((relation) => (relation.workspaceId || "workspace_global") === workspaceId)
    .filter((relation) => relation.metadata?.graphBuilder)
    .filter((relation) =>
      relation.metadata?.nodeId === node.id ||
      builderEntityIds.has(relation.sourceEntityId) ||
      builderEntityIds.has(relation.targetEntityId)
    )
    .filter((relation) => !collectionId || relation.metadata?.collectionId === collectionId)
    .filter((relation) => graphScope !== "document" || !documentId || relation.documentId === documentId);
  const scopedMetrics = (metrics || [])
    .filter((metric) => (metric.workspaceId || "workspace_global") === workspaceId)
    .filter((metric) => metric.metric === "knowledge.graph.snapshot")
    .filter((metric) => !collectionId || metric.value?.collectionId === collectionId)
    .filter((metric) => graphScope !== "document" || !documentId || metric.value?.documentId === documentId);
  const scopedQueries = (queries || [])
    .filter((query) => (query.workspaceId || "workspace_global") === workspaceId)
    .filter((query) => !collectionId || query.scope?.collectionId === collectionId || query.collectionId === collectionId)
    .filter((query) => graphScope !== "document" || !documentId || query.scope?.documentId === documentId || query.documentId === documentId);
  await Promise.all([
    deleteKnowledgeInspectorStoreRecords(stores.relations, scopedRelations.map((relation) => relation.id)),
    deleteKnowledgeInspectorStoreRecords(stores.entities, scopedEntities.map((entity) => entity.id)),
    deleteKnowledgeInspectorStoreRecords(stores.metrics, scopedMetrics.map((metric) => metric.id)),
    deleteKnowledgeInspectorStoreRecords(stores.queries, scopedQueries.map((query) => query.id)),
  ]);
  return { entities: scopedEntities.length, relations: scopedRelations.length, snapshots: scopedMetrics.length, queries: scopedQueries.length, graphScope, collectionId, documentId: graphScope === "document" ? documentId : "" };
};

const clearKnowledgeDocumentMemoryForNode = async (node = {}) => {
  if (!node?.id || !isKnowledgeDocumentStoreNode(node)) return null;
  const { workspaceId, collectionId, documentId, graphScope } = knowledgeClearScopeForNode(node);
  const stores = {
    documents: knowledgeTableName("TL_KNOWLEDGE_DOCUMENTS", "tl_knowledge_documents"),
    chunks: knowledgeTableName("TL_KNOWLEDGE_CHUNKS", "tl_knowledge_chunks"),
    embeddings: knowledgeTableName("TL_KNOWLEDGE_EMBEDDINGS", "tl_knowledge_embeddings"),
    entities: knowledgeTableName("TL_KNOWLEDGE_ENTITIES", "tl_knowledge_entities"),
    relations: knowledgeTableName("TL_KNOWLEDGE_RELATIONS", "tl_knowledge_relations"),
    dictionary: knowledgeTableName("TL_KNOWLEDGE_DICTIONARY", "tl_knowledge_dictionary"),
    events: knowledgeTableName("TL_KNOWLEDGE_EVENTS", "tl_knowledge_events"),
    sources: knowledgeTableName("TL_KNOWLEDGE_SOURCES", "tl_knowledge_sources"),
    metrics: knowledgeTableName("TL_KNOWLEDGE_METRICS", "tl_knowledge_metrics"),
    queries: knowledgeTableName("TL_KNOWLEDGE_QUERIES", "tl_knowledge_queries"),
  };
  const [documents, chunks, embeddings, entities, relations, dictionary, events, sources, metrics, queries] = await Promise.all([
    readKnowledgeInspectorStore(stores.documents),
    readKnowledgeInspectorStore(stores.chunks),
    readKnowledgeInspectorStore(stores.embeddings),
    readKnowledgeInspectorStore(stores.entities),
    readKnowledgeInspectorStore(stores.relations),
    readKnowledgeInspectorStore(stores.dictionary),
    readKnowledgeInspectorStore(stores.events),
    readKnowledgeInspectorStore(stores.sources),
    readKnowledgeInspectorStore(stores.metrics),
    readKnowledgeInspectorStore(stores.queries),
  ]);
  const scopedDocuments = (documents || [])
    .filter((item) => (item.workspaceId || "workspace_global") === workspaceId)
    .filter((item) => !collectionId || item.collectionId === collectionId || item.metadata?.collectionId === collectionId)
    .filter((item) => graphScope !== "document" || !documentId || item.id === documentId);
  const documentIds = new Set(scopedDocuments.map((item) => item.id).filter(Boolean));
  if (documentId) documentIds.add(documentId);
  const scopedChunks = (chunks || [])
    .filter((item) => (item.workspaceId || "workspace_global") === workspaceId)
    .filter((item) => !documentIds.size || documentIds.has(item.documentId))
    .filter((item) => !collectionId || item.metadata?.collectionId === collectionId);
  const chunkIds = new Set(scopedChunks.map((item) => item.id).filter(Boolean));
  const scopedEntities = (entities || [])
    .filter((item) => (item.workspaceId || "workspace_global") === workspaceId)
    .filter((item) => documentIds.has(item.documentId) || chunkIds.has(item.chunkId))
    .filter((item) => !collectionId || item.metadata?.collectionId === collectionId);
  const entityIds = new Set(scopedEntities.map((item) => item.id).filter(Boolean));
  const scopedRelations = (relations || [])
    .filter((item) => (item.workspaceId || "workspace_global") === workspaceId)
    .filter((item) =>
      documentIds.has(item.documentId) ||
      chunkIds.has(item.chunkId) ||
      entityIds.has(item.sourceEntityId) ||
      entityIds.has(item.targetEntityId)
    )
    .filter((item) => !collectionId || item.metadata?.collectionId === collectionId);
  const scopedEmbeddings = (embeddings || [])
    .filter((item) => (item.workspaceId || "workspace_global") === workspaceId)
    .filter((item) => documentIds.has(item.documentId) || chunkIds.has(item.chunkId));
  const scopedDictionary = (dictionary || [])
    .filter((item) => (item.workspaceId || "workspace_global") === workspaceId)
    .filter((item) => documentIds.has(item.documentId) || chunkIds.has(item.chunkId))
    .filter((item) => !collectionId || item.collectionId === collectionId || item.metadata?.collectionId === collectionId);
  const scopedEvents = (events || [])
    .filter((item) => (item.workspaceId || "workspace_global") === workspaceId)
    .filter((item) => documentIds.has(item.documentId) || chunkIds.has(item.chunkId))
    .filter((item) => !collectionId || item.collectionId === collectionId || item.metadata?.collectionId === collectionId);
  const scopedSources = (sources || [])
    .filter((item) => (item.workspaceId || "workspace_global") === workspaceId)
    .filter((item) => documentIds.has(item.documentId));
  const scopedMetrics = (metrics || [])
    .filter((item) => (item.workspaceId || "workspace_global") === workspaceId)
    .filter((item) => graphScope === "document"
      ? documentIds.has(item.value?.documentId)
      : collectionId
        ? item.value?.collectionId === collectionId
        : true);
  const scopedQueries = (queries || [])
    .filter((item) => (item.workspaceId || "workspace_global") === workspaceId)
    .filter((item) => graphScope === "document"
      ? (
        documentIds.has(item.documentId) ||
        documentIds.has(item.scope?.documentId) ||
        (Array.isArray(item.scope?.documentIds) && item.scope.documentIds.some((id) => documentIds.has(id)))
      )
      : collectionId
        ? item.scope?.collectionId === collectionId || item.collectionId === collectionId
        : true);
  await Promise.all([
    deleteKnowledgeInspectorStoreRecords(stores.relations, scopedRelations.map((item) => item.id)),
    deleteKnowledgeInspectorStoreRecords(stores.entities, scopedEntities.map((item) => item.id)),
    deleteKnowledgeInspectorStoreRecords(stores.dictionary, scopedDictionary.map((item) => item.id)),
    deleteKnowledgeInspectorStoreRecords(stores.events, scopedEvents.map((item) => item.id)),
    deleteKnowledgeInspectorStoreRecords(stores.embeddings, scopedEmbeddings.map((item) => item.id)),
    deleteKnowledgeInspectorStoreRecords(stores.chunks, scopedChunks.map((item) => item.id)),
    deleteKnowledgeInspectorStoreRecords(stores.sources, scopedSources.map((item) => item.id)),
    deleteKnowledgeInspectorStoreRecords(stores.metrics, scopedMetrics.map((item) => item.id)),
    deleteKnowledgeInspectorStoreRecords(stores.queries, scopedQueries.map((item) => item.id)),
  ]);
  return {
    documentsPreserved: scopedDocuments.length,
    chunks: scopedChunks.length,
    embeddings: scopedEmbeddings.length,
    entities: scopedEntities.length,
    relations: scopedRelations.length,
    dictionary: scopedDictionary.length,
    events: scopedEvents.length,
    sources: scopedSources.length,
    metrics: scopedMetrics.length,
    queries: scopedQueries.length,
    documentIds: [...documentIds],
    graphScope,
    collectionId,
    documentId: graphScope === "document" ? documentId : "",
  };
};

const clearCascadeTargetsForNode = (node = {}) => {
  if (!node?.id) return [];
  if (typeof downstreamNodeTree === "function") {
    const tree = downstreamNodeTree(node);
    if (tree.nodes?.length) return tree.nodes;
  }
  return [node];
};

const clearTokenUsageForNodes = async (nodes = []) => {
  const targets = [...new Map((nodes || []).filter((node) => node?.id).map((node) => [node.id, node])).values()];
  if (!targets.length) return [];
  const clearedAt = new Date().toISOString();
  const clearedNodes = targets.map((node) => ({
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
        provider: node.metadata?.tokenUsage?.provider || "",
        model: node.metadata?.tokenUsage?.model || node.metadata?.config?.model || "",
        clearedAt,
        updatedAt: clearedAt,
      },
      config: {
        ...(node.metadata?.config || {}),
        tokenUsage: 0,
        lastTokens: 0,
      },
    },
    updatedAt: clearedAt,
  }));
  await Promise.all(clearedNodes.map((node) => window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode?.({ node })));
  const byId = new Map(clearedNodes.map((node) => [node.id, node]));
  setRuntimeState({
    ...state.runtime,
    nodes: (state.runtime.nodes || []).map((node) => byId.get(node.id) || node),
  });
  const ids = clearedNodes.map((node) => node.id);
  const workspaceId = state.filters.workspaceId || clearedNodes[0]?.workspaceId || "workspace_global";
  window.TrackerLensAiAgentRuntime?.get?.(workspaceId)?.clearTokenUsageForNodes?.(ids);
  window.TrackerLensOrchestratorAgentRuntime?.get?.(workspaceId)?.clearTokenUsageForNodes?.(ids);
  window.TrackerLensKnowledgeRuntime?.get?.(workspaceId)?.clearTokenUsageForNodes?.(ids);
  return clearedNodes;
};

const requestTokenUsageDetails = (node = {}, scope = "total") => {
  if (!node?.id) return;
  const usage = tokenUsageForNode(node);
  const totalInput = usage.totalPromptTokens || 0;
  const totalOutput = usage.totalCompletionTokens || 0;
  const knownTotal = totalInput + totalOutput;
  const unclassifiedTotal = Math.max(0, Number(usage.totalTokens || 0) - knownTotal);
  const rows = scope === "last"
    ? [
      ["Input token", usage.lastPromptTokens || 0],
      ["Output token", usage.lastCompletionTokens || 0],
      ["Last run token", usage.lastTokens || 0],
    ]
    : [
      ["Input token since clear", totalInput],
      ["Output token since clear", totalOutput],
      unclassifiedTotal ? ["Old/unclassified token", unclassifiedTotal] : null,
      ["Total token since clear", usage.totalTokens || 0],
      ["Last run token", usage.lastTokens || 0],
    ].filter(Boolean);
  const dialog = _.Dialog({
    class: "tl-flow-edge-delete-dialog",
    panelClass: "tl-flow-edge-delete-panel",
    size: "md",
    title: scope === "last" ? "Last token usage" : "Total token usage",
    subtitle: node.label || node.id,
    icon: "generating_tokens",
    closeButton: true,
    content: () => _.div(
      { class: "tl-flow-edge-delete-body" },
      ...rows.map(([label, value]) => _.div(_.span(label), _.strong(String(value || 0)))),
      _.div(_.span("Provider"), _.strong(usage.provider || "unknown")),
      _.div(_.span("Model"), _.strong(usage.model || "unknown")),
      usage.updatedAt ? _.div(_.span("Updated"), _.strong(formatShortDate(usage.updatedAt))) : null
    ),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: close }, "Close")
    ),
  });
  dialog.open();
};

const requestTokenUsageClear = (node = {}) => {
  if (!node?.id) return;
  const cascadeTargets = clearCascadeTargetsForNode(node).filter(nodeHasTokenAccounting);
  const childCount = Math.max(0, cascadeTargets.filter((target) => target.id !== node.id).length);
  const performClear = async ({ close, cascade = false } = {}) => {
    const targets = cascade ? cascadeTargets : [node];
    const cleared = await clearTokenUsageForNodes(targets);
    await recordFlowAction({
      workspaceId: node.workspaceId || state.filters.workspaceId || "workspace_global",
      nodeId: node.id,
      message: `Token usage cleared: ${node.label || node.id}`,
      context: {
        action: "runtime-node-token-usage-clear",
        scope: cascade ? "node-and-children" : "node-only",
        clearedNodeIds: cleared.map((target) => target.id),
      },
    });
    close?.();
    mount({ preserveScroll: true });
  };
  const usage = tokenUsageForNode(node);
  const dialog = _.Dialog({
    class: "tl-flow-edge-delete-dialog",
    panelClass: "tl-flow-edge-delete-panel",
    size: "md",
    title: "Clear token usage?",
    subtitle: node.label || node.id,
    icon: "cleaning_services",
    closeButton: true,
    content: () => _.div(
      { class: "tl-flow-edge-delete-body" },
      _.p("Scegli se pulire solo la contabilita token di questo nodo o anche quella dei figli collegati."),
      _.div(_.span("Total token"), _.strong(String(usage.totalTokens || 0))),
      _.div(_.span("Last token"), _.strong(String(usage.lastTokens || 0))),
      _.div(_.span("Children"), _.strong(String(childCount)))
    ),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: close }, "Cancel"),
      childCount ? btn({
        onclick: () => performClear({ close, cascade: false }),
      }, icon("cleaning_services", "sm"), "Solo Node") : null,
      btn({
        class: "is-danger",
        onclick: () => performClear({ close, cascade: Boolean(childCount) }),
      }, icon(childCount ? "account_tree" : "cleaning_services", "sm"), childCount ? "Node + figli" : "Clear Token")
    ),
  });
  dialog.open();
};

const invalidateClearUiStateForNodes = (nodes = []) => {
  const targets = [...new Map((nodes || []).filter((node) => node?.id).map((node) => [node.id, node])).values()];
  if (!targets.length) return;
  markPreviewNodesClean(targets, { remount: false });
  const ids = new Set(targets.map((node) => node.id));
  [
    "storageInspectorRecords",
    "aiInspectorJobs",
    "knowledgeInspectorGraph",
    "knowledgeInspectorDocuments",
    "knowledgeInspectorDictionaries",
    "knowledgeInspectorEvents",
    "knowledgeInspectorStructured",
    "agentToolDebug",
  ].forEach((key) => {
    state[key] = { ...(state[key] || {}) };
    ids.forEach((id) => delete state[key][id]);
  });
};

const clearKnowledgeCascadeForNode = async (rootNode = {}) => {
  const targets = clearCascadeTargetsForNode(rootNode);
  invalidateClearUiStateForNodes(targets);
  const descendants = targets.filter((node) => node.id !== rootNode.id);
  const cleared = [];
  for (const child of descendants) {
    let result = null;
    let action = "";
    if (isKnowledgeDocumentStoreNode(child)) {
      action = "knowledge-document-clear-memory";
      result = await clearKnowledgeDocumentMemoryForNode(child);
    } else if (nodeCategory(child) === "knowledge" && nodeSubtype(child) === "knowledge-graph") {
      action = "knowledge-graph-clear-index";
      result = await clearKnowledgeGraphIndexForNode(child);
    } else if (isKnowledgeDictionaryBuilderNode(child)) {
      action = "knowledge-dictionary-clear";
      result = await clearKnowledgeDictionaryForNode(child);
    } else if (isKnowledgeEventBuilderNode(child)) {
      action = "knowledge-events-clear";
      result = await clearKnowledgeEventsForNode(child);
    } else if (isKnowledgeEntityExtractorNode(child)) {
      action = "knowledge-entity-graph-clear";
      result = await clearKnowledgeEntityGraphForNode(child);
    } else if (isKnowledgeSemanticRelationEnricherNode(child)) {
      action = "knowledge-semantic-relations-clear";
      result = await clearKnowledgeSemanticRelationsForNode(child);
    } else if (isKnowledgeGraphBuilderAgentNode(child)) {
      action = "knowledge-graph-builder-clear";
      result = await clearKnowledgeGraphBuilderForNode(child);
    }
    if (action) {
      cleared.push({
        nodeId: child.id,
        label: child.label || child.id,
        subtype: nodeSubtype(child),
        action,
        result: result || {},
      });
    }
  }
  return {
    cascadeNodes: Math.max(0, targets.length - 1),
    cascadeClears: cleared,
    cascadeNodeIds: descendants.map((node) => node.id),
  };
};

const emptyClearCascadeResult = () => ({
  cascadeNodes: 0,
  cascadeClears: [],
  cascadeNodeIds: [],
});

const requestKnowledgeGraphClear = (node = {}) => {
  if (!node?.id) return;
  const { workspaceId, collectionId, documentId, graphScope } = knowledgeClearScopeForNode(node);
  const cascadeTargets = clearCascadeTargetsForNode(node);
  const childCount = Math.max(0, cascadeTargets.length - 1);
  const performClear = async ({ close, cascade = false } = {}) => {
    const result = await clearKnowledgeGraphIndexForNode(node);
    const cascadeResult = cascade ? await clearKnowledgeCascadeForNode(node) : (invalidateClearUiStateForNodes([node]), emptyClearCascadeResult());
    await recordFlowAction({
      workspaceId,
      nodeId: node.id,
      message: `Knowledge graph index cleared: ${node.label || node.id}`,
      context: { action: "knowledge-graph-clear-index", scope: cascade ? "node-and-children" : "node-only", ...(result || {}), ...cascadeResult },
    });
    close?.();
    await loadKnowledgeInspectorGraph(node, { force: true });
    mount({ preserveScroll: true });
  };
  const dialog = _.Dialog({
    class: "tl-flow-edge-delete-dialog",
    panelClass: "tl-flow-edge-delete-panel",
    size: "md",
    title: "Clear Knowledge graph index?",
    subtitle: node.label || node.id,
    icon: "delete_sweep",
    closeButton: true,
    content: () => _.div(
      { class: "tl-flow-edge-delete-body" },
      _.p("Verranno rimossi entità, relazioni e snapshot del grafo per questo scope. Documenti, chunk, dictionary, eventi ed embedding restano intatti."),
      childCount ? _.p(`Il Clear verra propagato anche a ${childCount} nodi figli collegati.`) : null,
      _.div(_.span("Scope"), _.strong(graphScope || "document")),
      _.div(_.span("Collection"), _.strong(collectionId || "all")),
      _.div(_.span("Document"), _.strong(graphScope === "document" ? documentId || "all" : "all"))
    ),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: close }, "Cancel"),
      childCount ? btn({
        onclick: () => performClear({ close, cascade: false }),
      }, icon("delete_sweep", "sm"), "Solo Node") : null,
      btn({
        class: "is-danger",
        onclick: () => performClear({ close, cascade: Boolean(childCount) }),
      }, icon(childCount ? "account_tree" : "delete_sweep", "sm"), childCount ? "Node + figli" : "Clear Graph")
    ),
  });
  dialog.open();
};

const requestKnowledgeStoreClear = (node = {}, options = {}) => {
  if (!node?.id) return;
  const { workspaceId, collectionId, documentId, graphScope } = knowledgeClearScopeForNode(node);
  const cascadeTargets = clearCascadeTargetsForNode(node);
  const childCount = Math.max(0, cascadeTargets.length - 1);
  const title = options.title || "Clear Knowledge store?";
  const actionLabel = options.actionLabel || "Clear";
  const action = options.action || "knowledge-store-clear";
  const message = options.message || `Knowledge store cleared: ${node.label || node.id}`;
  const clearFn = options.clearFn;
  if (typeof clearFn !== "function") return;
  const performClear = async ({ close, cascade = false } = {}) => {
    const result = await clearFn(node);
    const cascadeResult = cascade ? await clearKnowledgeCascadeForNode(node) : (invalidateClearUiStateForNodes([node]), emptyClearCascadeResult());
    await recordFlowAction({
      workspaceId,
      nodeId: node.id,
      message,
      context: { action, scope: cascade ? "node-and-children" : "node-only", ...(result || {}), ...cascadeResult },
    });
    close?.();
    if (isKnowledgeDocumentStoreNode(node)) await loadKnowledgeInspectorDocument(node, { force: true });
    if (isKnowledgeDictionaryBuilderNode(node)) await loadKnowledgeInspectorDictionary(node, { force: true });
    if (isKnowledgeEventBuilderNode(node)) await loadKnowledgeInspectorEvents(node, { force: true });
    if (nodeCategory(node) === "knowledge") await loadKnowledgeInspectorGraph(node, { force: true });
    mount({ preserveScroll: true });
  };
  const dialog = _.Dialog({
    class: "tl-flow-edge-delete-dialog",
    panelClass: "tl-flow-edge-delete-panel",
    size: "md",
    title,
    subtitle: node.label || node.id,
    icon: options.icon || "delete_sweep",
    closeButton: true,
    content: () => _.div(
      { class: "tl-flow-edge-delete-body" },
      _.p(options.description || "Verranno rimossi i record Knowledge derivati per questo scope."),
      childCount ? _.p(`Il Clear verra propagato anche a ${childCount} nodi figli collegati.`) : null,
      _.div(_.span("Scope"), _.strong(graphScope || "workspace")),
      _.div(_.span("Collection"), _.strong(collectionId || "all")),
      _.div(_.span("Document"), _.strong(graphScope === "document" ? documentId || "all" : "all"))
    ),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: close }, "Cancel"),
      childCount ? btn({
        onclick: () => performClear({ close, cascade: false }),
      }, icon(options.icon || "delete_sweep", "sm"), "Solo Node") : null,
      btn({
        class: "is-danger",
        onclick: () => performClear({ close, cascade: Boolean(childCount) }),
      }, icon(childCount ? "account_tree" : options.icon || "delete_sweep", "sm"), childCount ? "Node + figli" : actionLabel)
    ),
  });
  dialog.open();
};

const requestKnowledgeDocumentMemoryClear = (node = {}) =>
  requestKnowledgeStoreClear(node, {
    title: "Clear document Knowledge memory?",
    actionLabel: "Clear Memory",
    action: "knowledge-document-clear-memory",
    message: `Knowledge document memory cleared: ${node.label || node.id}`,
    description: "Verranno rimossi chunk, embedding, entità, relazioni, dictionary, eventi, query e snapshot derivati. I documenti caricati restano salvati e potranno rigenerare tutto con Play.",
    clearFn: clearKnowledgeDocumentMemoryForNode,
  });

const requestKnowledgeDictionaryClear = (node = {}) =>
  requestKnowledgeStoreClear(node, {
    title: "Clear Knowledge dictionary?",
    actionLabel: "Clear Dictionary",
    action: "knowledge-dictionary-clear",
    message: `Knowledge dictionary cleared: ${node.label || node.id}`,
    description: "Verranno rimossi i termini Dictionary e le query derivate per questo scope. Documenti, chunk, eventi e grafo restano intatti.",
    clearFn: clearKnowledgeDictionaryForNode,
  });

const requestKnowledgeEventsClear = (node = {}) =>
  requestKnowledgeStoreClear(node, {
    title: "Clear Knowledge events?",
    actionLabel: "Clear Events",
    action: "knowledge-events-clear",
    message: `Knowledge events cleared: ${node.label || node.id}`,
    description: "Verranno rimossi gli eventi narrativi e le query derivate per questo scope. Documenti, chunk, dictionary e grafo restano intatti.",
    clearFn: clearKnowledgeEventsForNode,
  });

const requestKnowledgeEntityGraphClear = (node = {}) =>
  requestKnowledgeStoreClear(node, {
    title: "Clear Entity Extractor graph records?",
    actionLabel: "Clear Entities",
    action: "knowledge-entity-graph-clear",
    message: `Entity Extractor graph records cleared: ${node.label || node.id}`,
    description: "Verranno rimossi entità create da questo Entity Extractor, relazioni collegate, query e snapshot del grafo per questo scope. Documenti, chunk, dictionary, eventi ed embedding restano intatti.",
    clearFn: clearKnowledgeEntityGraphForNode,
  });

const requestKnowledgeSemanticRelationsClear = (node = {}) =>
  requestKnowledgeStoreClear(node, {
    title: "Clear semantic relations?",
    actionLabel: "Clear Semantic",
    action: "knowledge-semantic-relations-clear",
    message: `Semantic relations cleared: ${node.label || node.id}`,
    description: "Verranno rimosse solo le relazioni semantiche create da questo Semantic Relation Enricher per questo scope. Le relazioni del Graph Builder Agent restano intatte.",
    clearFn: clearKnowledgeSemanticRelationsForNode,
  });

const requestKnowledgeGraphBuilderClear = (node = {}) =>
  requestKnowledgeStoreClear(node, {
    title: "Clear Graph Builder records?",
    actionLabel: "Clear Builder",
    action: "knowledge-graph-builder-clear",
    message: `Graph Builder records cleared: ${node.label || node.id}`,
    description: "Verranno rimossi solo entità e relazioni create dal Knowledge Graph Builder Agent per questo scope. Il grafo base dell'Entity Extractor resta intatto.",
    clearFn: clearKnowledgeGraphBuilderForNode,
  });

const knowledgeGraphExportData = (graphData = {}, { includeIsolated = false } = {}) => {
  const relations = graphData.relations || [];
  const connectedIds = new Set();
  relations.forEach((relation) => {
    if (relation.sourceEntityId) connectedIds.add(relation.sourceEntityId);
    if (relation.targetEntityId) connectedIds.add(relation.targetEntityId);
  });
  const entities = includeIsolated
    ? (graphData.entities || [])
    : (graphData.entities || []).filter((entity) => connectedIds.has(entity.id));
  const entityIds = new Set(entities.map((entity) => entity.id));
  return {
    ...graphData,
    exportMode: includeIsolated ? "with-isolated" : "connected",
    includeIsolatedEntities: Boolean(includeIsolated),
    entities,
    relations: relations.filter((relation) => entityIds.has(relation.sourceEntityId) && entityIds.has(relation.targetEntityId)),
  };
};

const knowledgeGraphNodeDegree = (entities = [], relations = []) => {
  const degree = new Map(entities.map((entity) => [entity.id, 0]));
  relations.forEach((relation) => {
    degree.set(relation.sourceEntityId, (degree.get(relation.sourceEntityId) || 0) + 1);
    degree.set(relation.targetEntityId, (degree.get(relation.targetEntityId) || 0) + 1);
  });
  return degree;
};

const visibleKnowledgeGraph = ({ entities = [], relations = [], search = "", type = "all", relationType = "all", limit = 80 } = {}) => {
  const query = String(search || "").trim().toLowerCase();
  const scopedRelations = relations.filter((relation) => relationType === "all" || (relation.relationType || "relation") === relationType);
  const degree = knowledgeGraphNodeDegree(entities, scopedRelations);
  const filtered = entities
    .filter((entity) => type === "all" || (entity.entityType || "entity") === type)
    .filter((entity) => !query || [entity.label, entity.entityType, entity.documentId, entity.chunkId].some((value) =>
      String(value || "").toLowerCase().includes(query)
    ))
    .sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0) || String(a.label || "").localeCompare(String(b.label || "")))
    .slice(0, Math.max(8, Math.min(200, Number(limit) || 80)));
  const ids = new Set(filtered.map((entity) => entity.id));
  return {
    entities: filtered,
    relations: scopedRelations.filter((relation) => ids.has(relation.sourceEntityId) && ids.has(relation.targetEntityId)),
    degree,
  };
};

const graphPositionForEntity = ({ entity, index, count, degree = 0, typeIndex = 0, typeCount = 1, mode = "force", width = 920, height = 560 } = {}) => {
  if (mode === "groups") {
    const columns = Math.max(1, Math.ceil(Math.sqrt(typeCount)));
    const col = typeIndex % columns;
    const row = Math.floor(typeIndex / columns);
    const cellW = width / columns;
    const cellH = height / Math.max(1, Math.ceil(typeCount / columns));
    const localAngle = (index / Math.max(1, count)) * Math.PI * 2;
    const radius = Math.min(cellW, cellH) * 0.28;
    return {
      x: col * cellW + cellW / 2 + Math.cos(localAngle) * radius,
      y: row * cellH + cellH / 2 + Math.sin(localAngle) * radius,
    };
  }
  const angle = (index / Math.max(1, count)) * Math.PI * 2;
  const ring = 0.32 + (index % 4) * 0.085;
  const pull = Math.max(0, Math.min(0.12, degree * 0.01));
  return {
    x: width / 2 + Math.cos(angle) * width * (ring - pull),
    y: height / 2 + Math.sin(angle) * height * (ring - pull),
  };
};

const knowledgeGraphNodeRadiusForDegree = (entityDegree = 0) => Math.max(18, Math.min(42, 18 + (Number(entityDegree) || 0) * 2.4));

const relaxKnowledgeGraphPositions = ({ entities = [], positions = new Map(), degree = new Map(), fixedIds = new Set(), width = 920, height = 560 } = {}) => {
  const nodes = entities.map((entity, index) => {
    const point = positions.get(entity.id) || { x: width / 2, y: height / 2 };
    const radius = knowledgeGraphNodeRadiusForDegree(degree.get(entity.id) || 0);
    return {
      id: entity.id,
      index,
      x: Number(point.x) || width / 2,
      y: Number(point.y) || height / 2,
      radius,
      fixed: fixedIds.has(entity.id),
    };
  });
  const padding = 22;
  const iterations = Math.min(140, Math.max(48, nodes.length * 2.4));
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distance = Math.sqrt(dx * dx + dy * dy);
        if (!distance) {
          const angle = ((a.index + b.index + 1) / Math.max(1, nodes.length)) * Math.PI * 2;
          dx = Math.cos(angle) * 0.01;
          dy = Math.sin(angle) * 0.01;
          distance = 0.01;
        }
        const minDistance = a.radius + b.radius + padding;
        if (distance >= minDistance) continue;
        if (a.fixed && b.fixed) continue;
        const push = (minDistance - distance) / distance;
        const moveX = dx * push * 0.5;
        const moveY = dy * push * 0.5;
        if (a.fixed) {
          b.x += moveX * 2;
          b.y += moveY * 2;
        } else if (b.fixed) {
          a.x -= moveX * 2;
          a.y -= moveY * 2;
        } else {
          a.x -= moveX;
          a.y -= moveY;
          b.x += moveX;
          b.y += moveY;
        }
      }
    }
    nodes.forEach((node) => {
      node.x = Math.max(node.radius + padding, Math.min(width - node.radius - padding, node.x));
      node.y = Math.max(node.radius + padding, Math.min(height - node.radius - padding, node.y));
    });
  }
  nodes.forEach((node) => {
    positions.set(node.id, { x: node.x, y: node.y });
  });
  return positions;
};

const buildKnowledgeGraphLayout = ({ entities = [], relations = [], degree = new Map(), mode = "force", selectedId = "", manualPositions = {}, width = 920, height = 560 } = {}) => {
  const byType = new Map();
  entities.forEach((entity) => {
    const type = entity.entityType || "entity";
    byType.set(type, [...(byType.get(type) || []), entity]);
  });
  const typeKeys = [...byType.keys()].sort();
  const positions = new Map();
  typeKeys.forEach((type, typeIndex) => {
    const group = byType.get(type) || [];
    group.forEach((entity, index) => {
      positions.set(entity.id, graphPositionForEntity({
        entity,
        index,
        count: group.length,
        degree: degree.get(entity.id) || 0,
        typeIndex,
        typeCount: typeKeys.length,
        mode,
        width,
        height,
      }));
    });
  });
  const fixedIds = new Set();
  const selectedRelations = new Set();
  const connectedEntityIds = new Set(selectedId ? [selectedId] : []);
  if (selectedId) {
    relations.forEach((relation) => {
      if (relation.sourceEntityId === selectedId || relation.targetEntityId === selectedId) {
        selectedRelations.add(relation.id);
        connectedEntityIds.add(relation.sourceEntityId);
        connectedEntityIds.add(relation.targetEntityId);
      }
    });
  }
  entities.forEach((entity) => {
    const manual = manualPositions?.[entity.id];
    if (manual && Number.isFinite(Number(manual.x)) && Number.isFinite(Number(manual.y))) {
      fixedIds.add(entity.id);
      positions.set(entity.id, {
        x: Math.max(0, Math.min(width, Number(manual.x))),
        y: Math.max(0, Math.min(height, Number(manual.y))),
      });
    }
  });
  const selectedAnchor = positions.get(selectedId);
  if (selectedAnchor && connectedEntityIds.size > 1) {
    connectedEntityIds.forEach((entityId) => {
      if (entityId === selectedId || fixedIds.has(entityId)) return;
      const point = positions.get(entityId);
      if (!point) return;
      positions.set(entityId, {
        x: selectedAnchor.x + (point.x - selectedAnchor.x) * 0.84,
        y: selectedAnchor.y + (point.y - selectedAnchor.y) * 0.84,
      });
    });
  }
  relaxKnowledgeGraphPositions({ entities, positions, degree, fixedIds, width, height });
  return { positions, selectedRelations, connectedEntityIds };
};

const parseKnowledgeGraphTranslate = (value = "") => {
  const match = String(value || "").match(/translate\(([-\d.]+)[,\s]+([-\d.]+)\)/);
  return match ? { x: Number(match[1]) || 0, y: Number(match[2]) || 0 } : { x: 0, y: 0 };
};

const animateKnowledgeGraphSettle = ({ host, entities = [], relations = [], positions = new Map(), duration = 680, onDone = null } = {}) => {
  const svg = host?.querySelector?.(".tl-kg-view-svg");
  if (!svg) return false;
  const nodeFrames = entities.map((entity) => {
    const element = svg.querySelector(`[data-entity-id="${escapeSelectorValue(entity.id)}"]`);
    const target = positions.get(entity.id);
    if (!element || !target) return null;
    return {
      id: entity.id,
      element,
      from: parseKnowledgeGraphTranslate(element.getAttribute("transform")),
      to: target,
    };
  }).filter(Boolean);
  const lineFrames = relations.map((relation) => {
    const line = svg.querySelector(`[data-relation-id="${escapeSelectorValue(relation.id)}"]`);
    return line ? { relation, line } : null;
  }).filter(Boolean);
  if (!nodeFrames.length) return false;
  const latest = new Map(nodeFrames.map((frame) => [frame.id, { ...frame.from }]));
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const startedAt = performance.now();
  svg.classList.add("is-settling");
  const tick = (now) => {
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = ease(progress);
    nodeFrames.forEach((frame) => {
      const x = frame.from.x + (frame.to.x - frame.from.x) * eased;
      const y = frame.from.y + (frame.to.y - frame.from.y) * eased;
      latest.set(frame.id, { x, y });
      frame.element.setAttribute("transform", `translate(${x} ${y})`);
    });
    lineFrames.forEach(({ relation, line }) => {
      const source = latest.get(relation.sourceEntityId);
      const target = latest.get(relation.targetEntityId);
      if (!source || !target) return;
      line.setAttribute("x1", String(source.x));
      line.setAttribute("y1", String(source.y));
      line.setAttribute("x2", String(target.x));
      line.setAttribute("y2", String(target.y));
    });
    if (progress < 1) {
      requestAnimationFrame(tick);
      return;
    }
    svg.classList.remove("is-settling");
    onDone?.();
  };
  requestAnimationFrame(tick);
  return true;
};

const applyKnowledgeGraphFocusClasses = ({ host, selectedId = "", relations = [] } = {}) => {
  const svg = host?.querySelector?.(".tl-kg-view-svg");
  if (!svg || !selectedId) return;
  const connectedIds = new Set([selectedId]);
  const connectedRelationIds = new Set();
  relations.forEach((relation) => {
    if (relation.sourceEntityId === selectedId || relation.targetEntityId === selectedId) {
      connectedRelationIds.add(relation.id);
      connectedIds.add(relation.sourceEntityId);
      connectedIds.add(relation.targetEntityId);
    }
  });
  svg.querySelectorAll(".tl-kg-view-node").forEach((node) => {
    const entityId = node.getAttribute("data-entity-id") || "";
    const isSelected = entityId === selectedId;
    const isConnected = connectedIds.has(entityId);
    node.classList.toggle("is-selected", isSelected);
    node.classList.toggle("is-connected", isConnected && !isSelected);
    node.classList.toggle("is-floating", isConnected);
    node.classList.toggle("is-muted", !isConnected);
  });
  svg.querySelectorAll(".tl-kg-view-links line").forEach((line) => {
    const relationId = line.getAttribute("data-relation-id") || "";
    const isConnected = connectedRelationIds.has(relationId);
    line.classList.toggle("is-connected", isConnected);
    line.classList.toggle("is-muted", !isConnected);
  });
};

const renderKnowledgeGraphSvg = ({ entities = [], relations = [], degree = new Map(), mode = "force", selectedId = "", zoom = 1, panX = 0, panY = 0, manualPositions = {}, onSelect = null, onMoveNode = null } = {}) => {
  const width = 920;
  const height = 560;
  const { positions, selectedRelations, connectedEntityIds } = buildKnowledgeGraphLayout({
    entities,
    relations,
    degree,
    mode,
    selectedId,
    manualPositions,
    width,
    height,
  });
  const selectedPosition = positions.get(selectedId);
  const safeZoom = Math.max(0.75, Math.min(2.2, Number(zoom) || 1));
  const viewWidth = width / safeZoom;
  const viewHeight = height / safeZoom;
  const viewCenterX = (selectedPosition?.x || width / 2) + Number(panX || 0);
  const viewCenterY = (selectedPosition?.y || height / 2) + Number(panY || 0);
  const viewX = Math.max(0, Math.min(width - viewWidth, viewCenterX - viewWidth / 2));
  const viewY = Math.max(0, Math.min(height - viewHeight, viewCenterY - viewHeight / 2));
  const svgPointFromEvent = (event) => {
    const svg = event.currentTarget?.ownerSVGElement || event.currentTarget?.closest?.("svg");
    const rect = svg?.getBoundingClientRect?.();
    const viewBox = String(svg?.getAttribute?.("viewBox") || `0 0 ${width} ${height}`).split(/\s+/).map(Number);
    const [boxX = 0, boxY = 0, boxW = width, boxH = height] = viewBox;
    if (!rect?.width || !rect?.height) return { x: width / 2, y: height / 2 };
    return {
      x: Math.max(0, Math.min(width, boxX + ((event.clientX - rect.left) / rect.width) * boxW)),
      y: Math.max(0, Math.min(height, boxY + ((event.clientY - rect.top) / rect.height) * boxH)),
    };
  };
  return _.svg(
    { class: "tl-kg-view-svg", viewBox: `${viewX} ${viewY} ${viewWidth} ${viewHeight}`, role: "img", "aria-label": "Knowledge graph view" },
    _.g(
      { class: "tl-kg-view-links" },
      ...relations.map((relation) => {
        const source = positions.get(relation.sourceEntityId);
        const target = positions.get(relation.targetEntityId);
        if (!source || !target) return null;
        const isConnected = selectedRelations.has(relation.id);
        return _.line({
          x1: source.x,
          y1: source.y,
          x2: target.x,
          y2: target.y,
          class: selectedId ? (isConnected ? "is-connected" : "is-muted") : "",
          "data-relation-id": relation.id,
          "data-source-id": relation.sourceEntityId,
          "data-target-id": relation.targetEntityId,
          "data-relation-type": relation.relationType || "relation",
          style: `--kg-relation-color:${knowledgeGraphRelationColors[relation.relationType] || knowledgeGraphRelationColors.relation}`,
        });
      })
    ),
    _.g(
      { class: "tl-kg-view-nodes" },
      ...entities.map((entity) => {
        const point = positions.get(entity.id) || { x: width / 2, y: height / 2 };
        const entityDegree = degree.get(entity.id) || 0;
        const radius = knowledgeGraphNodeRadiusForDegree(entityDegree);
        const color = knowledgeGraphTypeColors[entity.entityType] || knowledgeGraphTypeColors.entity;
        const isSelected = entity.id === selectedId;
        const isConnectedNode = selectedId && connectedEntityIds.has(entity.id) && !isSelected;
        const isMuted = selectedId && !connectedEntityIds.has(entity.id);
        const floatSeed = Math.abs(String(entity.id || entity.label || "").split("").reduce((sum, char) => sum + char.charCodeAt(0), 0));
        const floatX = 4 + (floatSeed % 5);
        const floatY = 5 + ((floatSeed * 3) % 6);
        const floatRotate = 0.16 + ((floatSeed % 5) * 0.045);
        const floatDurationX = 3000 + ((floatSeed * 37) % 650);
        const floatDurationY = 3200 + ((floatSeed * 53) % 700);
        const floatDurationR = 3400 + ((floatSeed * 29) % 600);
        const floatDelay = isSelected ? 0 : (floatSeed % 9) * 55;
        const floatDelayY = isSelected ? 40 : ((floatSeed * 5) % 11) * 45;
        const floatDirection = floatSeed % 2 ? 1 : -1;
        let dragState = null;
        return _.g(
          {
            class: `tl-kg-view-node${isSelected ? " is-selected" : ""}${isConnectedNode ? " is-connected" : ""}${selectedId && connectedEntityIds.has(entity.id) ? " is-floating" : ""}${isMuted ? " is-muted" : ""}`,
            transform: `translate(${point.x} ${point.y})`,
            style: `--kg-float-x:${floatX}px;--kg-float-y:${floatY}px;--kg-float-rotate:${floatRotate}deg;--kg-float-duration-x:${floatDurationX}ms;--kg-float-duration-y:${floatDurationY}ms;--kg-float-duration-r:${floatDurationR}ms;--kg-float-delay:${floatDelay}ms;--kg-float-delay-y:${floatDelayY}ms;--kg-float-direction:${floatDirection};`,
            "data-entity-id": entity.id,
            tabindex: 0,
            role: "button",
            onpointerdown: (event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.stopPropagation();
              const start = svgPointFromEvent(event);
              dragState = {
                pointerId: event.pointerId,
                startX: start.x,
                startY: start.y,
                nodeX: point.x,
                nodeY: point.y,
                moved: false,
              };
              event.currentTarget?.setPointerCapture?.(event.pointerId);
              event.currentTarget?.classList?.add("is-dragging");
            },
            onpointermove: (event) => {
              if (!dragState || dragState.pointerId !== event.pointerId) return;
              event.preventDefault();
              event.stopPropagation();
              const next = svgPointFromEvent(event);
              const dx = next.x - dragState.startX;
              const dy = next.y - dragState.startY;
              dragState.moved = dragState.moved || Math.abs(dx) + Math.abs(dy) > 3;
              const minX = radius + 22;
              const minY = radius + 22;
              const x = Math.max(minX, Math.min(width - minX, dragState.nodeX + dx));
              const y = Math.max(minY, Math.min(height - minY, dragState.nodeY + dy));
              event.currentTarget?.setAttribute?.("transform", `translate(${x} ${y})`);
              const svg = event.currentTarget?.ownerSVGElement;
              const escapedEntityId = globalThis.CSS?.escape
                ? globalThis.CSS.escape(String(entity.id))
                : String(entity.id).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
              svg?.querySelectorAll?.(`[data-source-id="${escapedEntityId}"]`).forEach((line) => {
                line.setAttribute("x1", String(x));
                line.setAttribute("y1", String(y));
              });
              svg?.querySelectorAll?.(`[data-target-id="${escapedEntityId}"]`).forEach((line) => {
                line.setAttribute("x2", String(x));
                line.setAttribute("y2", String(y));
              });
              onMoveNode?.(entity, { x, y }, { preview: true });
            },
            onpointerup: (event) => {
              if (!dragState || dragState.pointerId !== event.pointerId) return;
              event.preventDefault();
              event.stopPropagation();
              const next = svgPointFromEvent(event);
              const minX = radius + 22;
              const minY = radius + 22;
              const x = Math.max(minX, Math.min(width - minX, dragState.nodeX + next.x - dragState.startX));
              const y = Math.max(minY, Math.min(height - minY, dragState.nodeY + next.y - dragState.startY));
              const moved = dragState.moved;
              dragState = null;
              event.currentTarget?.releasePointerCapture?.(event.pointerId);
              event.currentTarget?.classList?.remove("is-dragging");
              if (moved) {
                onMoveNode?.(entity, { x, y }, { preview: false });
              } else {
                onSelect?.(entity);
              }
            },
            onpointercancel: (event) => {
              if (!dragState || dragState.pointerId !== event.pointerId) return;
              dragState = null;
              event.currentTarget?.releasePointerCapture?.(event.pointerId);
              event.currentTarget?.classList?.remove("is-dragging");
            },
            onclick: (event) => {
              event.stopPropagation();
            },
            onkeydown: (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                onSelect?.(entity);
              }
            },
          },
          _.g(
            { class: "tl-kg-view-node-body" },
            _.g(
              { class: "tl-kg-view-node-float-x" },
              _.g(
                { class: "tl-kg-view-node-float-y" },
                _.g(
                  { class: "tl-kg-view-node-float-r" },
                  _.circle({ r: radius, fill: color }),
                  _.text({ y: -2, "text-anchor": "middle" }, String(entity.label || entity.id).slice(0, 18)),
                  _.text({ y: 12, "text-anchor": "middle", class: "tl-kg-view-node-type" }, entity.entityType || "entity")
                )
              )
            )
          )
        );
      })
    )
  );
};

const renderKnowledgeGraphCanvas = ({ entities = [], relations = [], degree = new Map(), mode = "force", selectedId = "", zoom = 1, panX = 0, panY = 0, manualPositions = {}, onSelect = null, onMoveNode = null, onViewportChange = null } = {}) => {
  const width = 920;
  const height = 560;
  const canvas = _.canvas({
    class: "tl-kg-view-canvas-bitmap",
    role: "img",
    "aria-label": "Knowledge graph canvas view",
  });
  const local = {
    zoom: Math.max(0.75, Math.min(2.2, Number(zoom) || 1)),
    panX: Number(panX) || 0,
    panY: Number(panY) || 0,
    selectedId,
    manualPositions: { ...(manualPositions || {}) },
    drag: null,
    pan: null,
    animationStart: performance.now(),
    smoothPositions: new Map(),
    raf: 0,
    framePending: false,
    disposed: false,
  };
  const seedFor = (entity) => Math.abs(String(entity?.id || entity?.label || "").split("").reduce((sum, char) => sum + char.charCodeAt(0), 0));
  const colorFor = (value, fallback = "#67e8f9") => value || fallback;
  const layout = () => buildKnowledgeGraphLayout({
    entities,
    relations,
    degree,
    mode,
    selectedId: local.selectedId,
    manualPositions: local.manualPositions,
    width,
    height,
  });
  const viewState = (positions) => {
    const selectedPosition = positions.get(local.selectedId);
    const safeZoom = Math.max(0.75, Math.min(2.2, Number(local.zoom) || 1));
    const viewWidth = width / safeZoom;
    const viewHeight = height / safeZoom;
    const viewCenterX = (selectedPosition?.x || width / 2) + Number(local.panX || 0);
    const viewCenterY = (selectedPosition?.y || height / 2) + Number(local.panY || 0);
    return {
      x: Math.max(0, Math.min(width - viewWidth, viewCenterX - viewWidth / 2)),
      y: Math.max(0, Math.min(height - viewHeight, viewCenterY - viewHeight / 2)),
      w: viewWidth,
      h: viewHeight,
      zoom: safeZoom,
    };
  };
  const canvasSize = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cssWidth = Math.max(1, rect.width || canvas.clientWidth || 1);
    const cssHeight = Math.max(1, rect.height || canvas.clientHeight || 1);
    const pixelWidth = Math.round(cssWidth * dpr);
    const pixelHeight = Math.round(cssHeight * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    return { cssWidth, cssHeight, dpr };
  };
  const graphToScreen = (point, view, size) => ({
    x: ((point.x - view.x) / view.w) * size.cssWidth,
    y: ((point.y - view.y) / view.h) * size.cssHeight,
  });
  const canvasEllipsisText = (ctx, text = "", maxWidth = 0) => {
    const value = String(text || "").trim();
    if (!value || maxWidth <= 0) return "";
    if (ctx.measureText(value).width <= maxWidth) return value;
    const suffix = "...";
    let left = 0;
    let right = value.length;
    while (left < right) {
      const mid = Math.ceil((left + right) / 2);
      const candidate = `${value.slice(0, mid).trimEnd()}${suffix}`;
      if (ctx.measureText(candidate).width <= maxWidth) {
        left = mid;
      } else {
        right = mid - 1;
      }
    }
    return left > 0 ? `${value.slice(0, left).trimEnd()}${suffix}` : suffix;
  };
  const canvasLabelLines = (ctx, text = "", maxWidth = 0, maxLines = 1) => {
    const value = String(text || "").replace(/\s+/g, " ").trim();
    if (!value || maxLines <= 1) return [canvasEllipsisText(ctx, value, maxWidth)].filter(Boolean);
    const words = value.split(" ");
    let firstLine = "";
    let splitIndex = 0;
    for (let index = 0; index < words.length; index += 1) {
      const word = words[index];
      const next = firstLine ? `${firstLine} ${word}` : word;
      if (ctx.measureText(next).width > maxWidth) break;
      firstLine = next;
      splitIndex = index + 1;
    }
    if (!firstLine) {
      return [canvasEllipsisText(ctx, value, maxWidth)];
    }
    const rest = words.slice(splitIndex).join(" ");
    if (!rest) return [firstLine];
    if (maxLines === 2) return [firstLine, canvasEllipsisText(ctx, rest, maxWidth)].filter(Boolean);
    const lines = [firstLine];
    let current = "";
    const remainingWords = words.slice(splitIndex);
    for (const word of remainingWords) {
      const next = current ? `${current} ${word}` : word;
      if (ctx.measureText(next).width <= maxWidth) {
        current = next;
        continue;
      }
      if (current) lines.push(current);
      current = word;
      if (lines.length >= maxLines - 1) break;
    }
    if (lines.length < maxLines) lines.push(canvasEllipsisText(ctx, current, maxWidth));
    return lines.slice(0, maxLines).filter(Boolean);
  };
  const screenToGraph = (event, view, size) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(width, view.x + ((event.clientX - rect.left) / size.cssWidth) * view.w)),
      y: Math.max(0, Math.min(height, view.y + ((event.clientY - rect.top) / size.cssHeight) * view.h)),
    };
  };
  const connectedFor = () => {
    const relationIds = new Set();
    const entityIds = new Set(local.selectedId ? [local.selectedId] : []);
    if (local.selectedId) {
      relations.forEach((relation) => {
        if (relation.sourceEntityId === local.selectedId || relation.targetEntityId === local.selectedId) {
          relationIds.add(relation.id);
          entityIds.add(relation.sourceEntityId);
          entityIds.add(relation.targetEntityId);
        }
      });
    }
    return { relationIds, entityIds };
  };
  const scheduleDraw = () => {
    if (local.disposed) return;
    if (local.framePending) return;
    local.framePending = true;
    local.raf = requestAnimationFrame(draw);
  };
  const draw = () => {
    if (local.disposed) return;
    local.framePending = false;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const size = canvasSize();
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    ctx.clearRect(0, 0, size.cssWidth, size.cssHeight);
    const { positions, selectedRelations, connectedEntityIds } = layout();
    let hasMotion = false;
    entities.forEach((entity) => {
      const target = positions.get(entity.id);
      if (!target) return;
      const current = local.smoothPositions.get(entity.id);
      if (!current) {
        local.smoothPositions.set(entity.id, { ...target, vx: 0, vy: 0 });
        return;
      }
      const isDragged = local.drag?.entity?.id === entity.id;
      if (isDragged) {
        current.x = target.x;
        current.y = target.y;
        current.vx = 0;
        current.vy = 0;
        return;
      }
      const dx = target.x - current.x;
      const dy = target.y - current.y;
      const stiffness = local.drag ? 0.01 : 0.018;
      const damping = local.drag ? 0.88 : 0.9;
      const seed = seedFor(entity);
      const curve = local.drag ? 0.006 : 0.003;
      current.vx = ((Number(current.vx) || 0) + dx * stiffness + Math.sin(performance.now() / 1100 + seed) * curve) * damping;
      current.vy = ((Number(current.vy) || 0) + dy * stiffness + Math.cos(performance.now() / 1250 + seed * 0.37) * curve) * damping;
      current.x += current.vx;
      current.y += current.vy;
      const speed = Math.abs(current.vx) + Math.abs(current.vy);
      if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01 && speed < 0.008) {
        current.x = target.x;
        current.y = target.y;
        current.vx = 0;
        current.vy = 0;
      } else {
        hasMotion = true;
      }
    });
    const view = viewState(positions);
    const focused = connectedFor();
    const elapsed = performance.now() - local.animationStart;
    const floatDuration = 4000;
    const floatProgress = Math.max(0, Math.min(1, elapsed / floatDuration));
    const floatFade = 1 - (floatProgress * floatProgress * (3 - 2 * floatProgress));
    const floatActive = floatFade > 0.004;
    const displayPositions = new Map();
    entities.forEach((entity) => {
      const point = local.smoothPositions.get(entity.id) || positions.get(entity.id) || { x: width / 2, y: height / 2 };
      const isFloating = floatActive && local.selectedId && entity.id !== local.selectedId && focused.entityIds.has(entity.id);
      if (!isFloating) {
        displayPositions.set(entity.id, point);
        return;
      }
      const seed = seedFor(entity);
      const t = elapsed / 1000;
      const direction = seed % 2 ? 1 : -1;
      const ampX = (2.8 + (seed % 4)) * floatFade;
      const ampY = (3.2 + ((seed * 3) % 4)) * floatFade;
      displayPositions.set(entity.id, {
        x: point.x + Math.sin(t * 2.1 + seed) * ampX * direction,
        y: point.y + Math.sin(t * 1.7 + seed * 0.37) * ampY,
      });
    });
    relations.forEach((relation) => {
      const source = displayPositions.get(relation.sourceEntityId);
      const target = displayPositions.get(relation.targetEntityId);
      if (!source || !target) return;
      const a = graphToScreen(source, view, size);
      const b = graphToScreen(target, view, size);
      const isConnected = local.selectedId ? selectedRelations.has(relation.id) : false;
      ctx.save();
      ctx.globalAlpha = local.selectedId ? (isConnected ? 0.86 : 0.18) : 0.42;
      ctx.strokeStyle = colorFor(knowledgeGraphRelationColors[relation.relationType], "rgba(148, 163, 184, 0.34)");
      ctx.lineWidth = isConnected ? 2.4 : 1.2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();
    });
    entities.forEach((entity) => {
      const point = displayPositions.get(entity.id) || positions.get(entity.id);
      if (!point) return;
      const screen = graphToScreen(point, view, size);
      const entityDegree = degree.get(entity.id) || 0;
      const radius = knowledgeGraphNodeRadiusForDegree(entityDegree) * (size.cssWidth / view.w);
      const isSelected = entity.id === local.selectedId;
      const isConnected = local.selectedId && connectedEntityIds.has(entity.id);
      const muted = local.selectedId && !isConnected;
      ctx.save();
      ctx.globalAlpha = muted ? 0.52 : 1;
      ctx.fillStyle = colorFor(knowledgeGraphTypeColors[entity.entityType], knowledgeGraphTypeColors.entity);
      ctx.strokeStyle = isSelected ? "#f8fafc" : "rgba(226, 232, 240, 0.9)";
      ctx.lineWidth = isSelected ? 3 : isConnected ? 2.4 : 1.5;
      ctx.shadowColor = isSelected ? "rgba(34, 211, 238, 0.5)" : "rgba(0, 0, 0, 0.28)";
      ctx.shadowBlur = isSelected ? 14 : 10;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#0f172a";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const textMaxWidth = Math.max(16, radius * 1.58);
      const allowTwoLines = radius >= 30 || isSelected;
      ctx.font = `${isSelected ? "800 10px" : "800 9px"} system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;
      const labelLines = canvasLabelLines(ctx, entity.label || entity.id, textMaxWidth, allowTwoLines ? 2 : 1);
      const labelStartY = screen.y - (labelLines.length > 1 ? 7 : 3);
      labelLines.forEach((line, index) => {
        ctx.fillText(line, screen.x, labelStartY + index * 9);
      });
      ctx.font = "700 7px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.globalAlpha = muted ? 0.42 : 0.72;
      ctx.fillText(canvasEllipsisText(ctx, entity.entityType || "entity", textMaxWidth), screen.x, screen.y + (labelLines.length > 1 ? 14 : 11));
      ctx.restore();
    });
    if (!local.disposed && ((floatActive && local.selectedId) || local.drag || hasMotion)) {
      scheduleDraw();
    }
  };
  const hitTest = (event) => {
    const size = canvasSize();
    const { positions } = layout();
    const view = viewState(positions);
    const graph = screenToGraph(event, view, size);
    const sorted = [...entities].sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0));
    for (const entity of sorted) {
      const point = positions.get(entity.id);
      if (!point) continue;
      const radius = knowledgeGraphNodeRadiusForDegree(degree.get(entity.id) || 0) + 5;
      const dx = graph.x - point.x;
      const dy = graph.y - point.y;
      if (Math.sqrt(dx * dx + dy * dy) <= radius) return { entity, point, graph, view, size };
    }
    return { entity: null, point: null, graph, view, size };
  };
  canvas.onwheel = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const { positions } = layout();
    const view = viewState(positions);
    if (event.ctrlKey || event.metaKey) {
      const direction = event.deltaY > 0 ? -1 : 1;
      local.zoom = Math.max(0.75, Math.min(2.2, Number((local.zoom + direction * 0.05).toFixed(2))));
    } else {
      local.panX += (Number(event.deltaX || 0) * 1.8) / view.zoom;
      local.panY += (Number(event.deltaY || 0) * 1.8) / view.zoom;
    }
    onViewportChange?.({ zoom: local.zoom, panX: local.panX, panY: local.panY });
    scheduleDraw();
  };
  canvas.onpointerdown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const hit = hitTest(event);
    canvas.setPointerCapture?.(event.pointerId);
    if (hit.entity) {
      local.drag = {
        pointerId: event.pointerId,
        entity: hit.entity,
        start: hit.graph,
        node: hit.point,
        moved: false,
      };
      return;
    }
    local.pan = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPanX: local.panX,
      startPanY: local.panY,
      view: hit.view,
      size: hit.size,
      moved: false,
    };
    canvas.parentElement?.classList.add("is-panning");
  };
  canvas.onpointermove = (event) => {
    if (local.drag?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      const { positions } = layout();
      const view = viewState(positions);
      const size = canvasSize();
      const graph = screenToGraph(event, view, size);
      const entity = local.drag.entity;
      const radius = knowledgeGraphNodeRadiusForDegree(degree.get(entity.id) || 0) + 22;
      const x = Math.max(radius, Math.min(width - radius, local.drag.node.x + graph.x - local.drag.start.x));
      const y = Math.max(radius, Math.min(height - radius, local.drag.node.y + graph.y - local.drag.start.y));
      local.drag.moved = local.drag.moved || Math.abs(graph.x - local.drag.start.x) + Math.abs(graph.y - local.drag.start.y) > 3;
      local.manualPositions[entity.id] = { x, y };
      onMoveNode?.(entity, { x, y }, { preview: true });
      scheduleDraw();
      return;
    }
    if (local.pan?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      const dx = event.clientX - local.pan.startX;
      const dy = event.clientY - local.pan.startY;
      local.pan.moved = local.pan.moved || Math.abs(dx) + Math.abs(dy) > 4;
      local.panX = local.pan.startPanX - (dx * local.pan.view.w) / local.pan.size.cssWidth;
      local.panY = local.pan.startPanY - (dy * local.pan.view.h) / local.pan.size.cssHeight;
      onViewportChange?.({ zoom: local.zoom, panX: local.panX, panY: local.panY });
      scheduleDraw();
    }
  };
  canvas.onpointerup = (event) => {
    if (local.drag?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      const drag = local.drag;
      local.drag = null;
      canvas.releasePointerCapture?.(event.pointerId);
      if (drag.moved) {
        const point = local.manualPositions[drag.entity.id] || drag.node;
        local.manualPositions[drag.entity.id] = point;
        local.selectedId = drag.entity.id;
        local.animationStart = performance.now();
        onMoveNode?.(drag.entity, point, { preview: false });
      } else {
        local.manualPositions[drag.entity.id] = drag.node;
        local.selectedId = drag.entity.id;
        local.animationStart = performance.now();
        onSelect?.(drag.entity, { point: drag.node });
      }
      scheduleDraw();
      return;
    }
    if (local.pan?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      const pan = local.pan;
      local.pan = null;
      canvas.parentElement?.classList.remove("is-panning");
      canvas.releasePointerCapture?.(event.pointerId);
      if (!pan.moved && local.selectedId) {
        local.selectedId = "";
        local.animationStart = performance.now();
        onSelect?.(null, { background: true });
        scheduleDraw();
      }
    }
  };
  canvas.onpointercancel = (event) => {
    local.drag = null;
    local.pan = null;
    canvas.parentElement?.classList.remove("is-panning");
    canvas.releasePointerCapture?.(event.pointerId);
  };
  canvas.__tlKnowledgeGraphDestroy = () => {
    local.disposed = true;
    local.framePending = false;
    if (local.raf) cancelAnimationFrame(local.raf);
    local.raf = 0;
    local.drag = null;
    local.pan = null;
    canvas.onwheel = null;
    canvas.onpointerdown = null;
    canvas.onpointermove = null;
    canvas.onpointerup = null;
    canvas.onpointercancel = null;
  };
  setTimeout(scheduleDraw, 0);
  return canvas;
};

const destroyKnowledgeGraphCanvases = (root = null) => {
  root?.querySelectorAll?.(".tl-kg-view-canvas-bitmap")?.forEach((canvas) => {
    canvas.__tlKnowledgeGraphDestroy?.();
  });
};

const openKnowledgeGraphViewDialog = async (node = {}) => {
  const graphData = await collectKnowledgeGraphData(node).catch((error) => {
    console.warn("Knowledge Graph data unavailable", error);
    return { entities: [], relations: [], metrics: [], collectionId: "", documentId: "" };
  });
  const model = {
    search: "",
    type: "all",
    relationType: "all",
    mode: "force",
    limit: 80,
    zoom: 0.85,
    panX: 0,
    panY: 0,
    manualPositions: {},
    focusPosition: null,
    drag: null,
    suppressNextNodeClick: false,
    selected: null,
    sideTab: "info",
  };
  const types = ["all", ...new Set((graphData.entities || []).map((entity) => entity.entityType || "entity"))].sort((a, b) =>
    a === "all" ? -1 : b === "all" ? 1 : a.localeCompare(b)
  );
  const relationTypes = ["all", ...new Set((graphData.relations || []).map((relation) => relation.relationType || "relation"))].sort((a, b) =>
    a === "all" ? -1 : b === "all" ? 1 : a.localeCompare(b)
  );
  let host = null;
  let searchFocus = null;
  const restoreSearchFocus = () => {
    if (!host || !searchFocus) return;
    const nextFocus = searchFocus;
    searchFocus = null;
    queueMicrotask(() => {
      const searchInput = host.querySelector(".tl-kg-view-search input, input.tl-kg-view-search, input[type='search']");
      if (!searchInput) return;
      searchInput.focus({ preventScroll: true });
      if (typeof searchInput.setSelectionRange === "function") {
        const cursor = Math.max(0, Math.min(nextFocus.cursor, String(searchInput.value || "").length));
        searchInput.setSelectionRange(cursor, cursor);
      }
    });
  };
  const rerender = () => {
    if (!host) return;
    const visible = visibleKnowledgeGraph({
      entities: graphData.entities,
      relations: graphData.relations,
      search: model.search,
      type: model.type,
      relationType: model.relationType,
      limit: model.limit,
    });
    if (model.selected && !visible.entities.some((entity) => entity.id === model.selected.id)) model.selected = null;
    const selected = model.selected || null;
    model.selected = selected;
    const typeCounts = visible.entities.reduce((acc, entity) => {
      const type = entity.entityType || "entity";
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});
    const relationTypeCounts = visible.relations.reduce((acc, relation) => {
      const type = relation.relationType || "relation";
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});
    const analytics = (() => {
      const ids = new Set(visible.entities.map((entity) => entity.id));
      const adjacency = new Map(visible.entities.map((entity) => [entity.id, new Set()]));
      const localDegree = new Map(visible.entities.map((entity) => [entity.id, 0]));
      const pairCounts = new Map();
      const repeatedEvidence = [];
      visible.relations.forEach((relation) => {
        if (!ids.has(relation.sourceEntityId) || !ids.has(relation.targetEntityId)) return;
        adjacency.get(relation.sourceEntityId)?.add(relation.targetEntityId);
        adjacency.get(relation.targetEntityId)?.add(relation.sourceEntityId);
        localDegree.set(relation.sourceEntityId, (localDegree.get(relation.sourceEntityId) || 0) + 1);
        localDegree.set(relation.targetEntityId, (localDegree.get(relation.targetEntityId) || 0) + 1);
        const pairKey = [relation.sourceEntityId, relation.targetEntityId].sort().join("::");
        pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1);
        const occurrenceCount = Math.max(1, Number(relation.metadata?.occurrenceCount || 1));
        if (occurrenceCount > 1) repeatedEvidence.push({ relation, occurrenceCount });
      });
      const seen = new Set();
      let components = 0;
      let isolated = 0;
      visible.entities.forEach((entity) => {
        if (seen.has(entity.id)) return;
        components += 1;
        const stack = [entity.id];
        let size = 0;
        seen.add(entity.id);
        while (stack.length) {
          const current = stack.pop();
          size += 1;
          adjacency.get(current)?.forEach((next) => {
            if (seen.has(next)) return;
            seen.add(next);
            stack.push(next);
          });
        }
        if (size === 1 && !(localDegree.get(entity.id) || 0)) isolated += 1;
      });
      const entityCount = visible.entities.length;
      const relationCount = visible.relations.length;
      const possiblePairs = entityCount > 1 ? (entityCount * (entityCount - 1)) / 2 : 0;
      return {
        avgDegree: entityCount ? (relationCount * 2) / entityCount : 0,
        density: possiblePairs ? relationCount / possiblePairs : 0,
        components,
        isolated,
        repeatedPairs: [...pairCounts.values()].filter((count) => count > 1).length,
        repeatedEvidenceCount: repeatedEvidence.length,
        repeatedEvidence: repeatedEvidence
          .sort((a, b) => b.occurrenceCount - a.occurrenceCount || String(a.relation.sourceLabel || "").localeCompare(String(b.relation.sourceLabel || "")))
          .slice(0, 6),
        topEntities: visible.entities
          .map((entity) => ({ entity, degree: localDegree.get(entity.id) || 0 }))
          .sort((a, b) => b.degree - a.degree || String(a.entity.label || "").localeCompare(String(b.entity.label || "")))
          .slice(0, 6),
      };
    })();
    const renderSelectionContent = (entity) => entity
      ? [
        _.div(
          { class: "tl-kg-view-selection-title" },
          _.strong(entity.label || entity.id),
          _.span(entity.entityType || "entity")
        ),
        _.div(_.span("Connections"), _.strong(String(visible.degree.get(entity.id) || 0))),
        _.div(_.span("Confidence"), _.strong(Number.isFinite(Number(entity.confidence)) ? Number(entity.confidence).toFixed(2) : "N/D")),
        ...(Array.isArray(entity.metadata?.aliases) && entity.metadata.aliases.length
          ? [_.div(_.span("Aliases"), _.strong(entity.metadata.aliases.slice(0, 4).join(", ")))]
          : []),
        _.div(_.span("Document"), _.strong(entity.documentId || "N/D")),
        _.div(_.span("Chunk"), _.strong(entity.chunkId || "N/D")),
        _.div(_.span("Entity ID"), _.strong(entity.id || "N/D")),
        copyRuntimeButton(entity, "Copy entity"),
      ]
      : [_.p({ class: "tl-flow-muted" }, "No entity selected.")];
    const updateSelectionPane = (entity) => {
      const selection = host.querySelector(".tl-kg-view-selection");
      if (!selection) return;
      selection.replaceChildren(...renderSelectionContent(entity));
    };
    const focusGraphEntity = (entity, { resetPan = false, point = null } = {}) => {
      if (!entity) return;
      const currentNode = host.querySelector(`.tl-kg-view-node[data-entity-id="${escapeSelectorValue(entity.id)}"]`);
      const currentPoint = parseKnowledgeGraphTranslate(currentNode?.getAttribute("transform") || "");
      if (point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y))) {
        model.focusPosition = { id: entity.id, point };
      } else if (currentNode && Number.isFinite(currentPoint.x) && Number.isFinite(currentPoint.y)) {
        model.focusPosition = { id: entity.id, point: currentPoint };
      }
      model.selected = entity;
      updateSelectionPane(entity);
      if (resetPan) {
        model.panX = 0;
        model.panY = 0;
      }
      model.sideTab = "selection";
      const focusManualPositions = model.focusPosition?.id === entity.id
        ? { ...model.manualPositions, [entity.id]: model.focusPosition.point }
        : model.manualPositions;
      const nextLayout = buildKnowledgeGraphLayout({
        entities: visible.entities,
        relations: visible.relations,
        degree: visible.degree,
        mode: model.mode,
        selectedId: entity.id,
        manualPositions: focusManualPositions,
      });
      applyKnowledgeGraphFocusClasses({
        host,
        selectedId: entity.id,
        relations: visible.relations,
      });
      if (host.querySelector(".tl-kg-view-canvas-bitmap")) {
        return;
      }
      const settled = animateKnowledgeGraphSettle({
        host,
        entities: visible.entities,
        relations: visible.relations,
        positions: nextLayout.positions,
        duration: 720,
        onDone: rerender,
      });
      if (!settled) rerender();
    };
    destroyKnowledgeGraphCanvases(host);
    host.replaceChildren(
      _.div(
        { class: "tl-kg-view-toolbar" },
        _.Input({
          class: "tl-kg-view-search",
          size: "sm",
          label: "Search",
          type: "search",
          placeholder: "Search entities, type, document...",
          value: model.search,
          onInput: (event) => {
            const target = event?.target;
            searchFocus = {
              cursor: Number.isFinite(Number(target?.selectionStart)) ? Number(target.selectionStart) : String(cmsInputValue(event) || "").length,
            };
            model.search = String(cmsInputValue(event) || "");
            rerender();
          },
        }),
        _.Select({
          size: "sm",
          label: "Type",
          value: model.type,
          options: types.map((type) => ({ value: type, label: type === "all" ? "All types" : type })),
          slots: { arrow: () => icon("keyboard_arrow_down", "sm") },
          onChange: (value) => {
            model.type = String(cmsInputValue(value) || "all");
            rerender();
          },
        }),
        _.Select({
          size: "sm",
          label: "Relation",
          value: model.relationType,
          options: relationTypes.map((type) => ({ value: type, label: type === "all" ? "All relations" : type })),
          slots: { arrow: () => icon("keyboard_arrow_down", "sm") },
          onChange: (value) => {
            model.relationType = String(cmsInputValue(value) || "all");
            rerender();
          },
        }),
        _.Select({
          size: "sm",
          label: "Layout",
          value: model.mode,
          options: [{ value: "force", label: "Force" }, { value: "groups", label: "Groups" }],
          slots: { arrow: () => icon("keyboard_arrow_down", "sm") },
          onChange: (value) => {
            model.mode = String(cmsInputValue(value) || "force");
            rerender();
          },
        }),
        _.Select({
          size: "sm",
          label: "Limit",
          value: String(model.limit),
          options: [40, 80, 120, 200].map((limit) => ({ value: String(limit), label: `${limit} nodes` })),
          slots: { arrow: () => icon("keyboard_arrow_down", "sm") },
          onChange: (value) => {
            model.limit = Number(cmsInputValue(value)) || 80;
            rerender();
          },
        })
      ),
      _.div(
        { class: "tl-kg-view-body" },
        _.div(
          {
            class: `tl-kg-view-canvas${model.drag ? " is-panning" : ""}`,
            onwheel: (event) => {
              event.preventDefault();
              event.stopPropagation();
              if (event.ctrlKey || event.metaKey) {
                const direction = event.deltaY > 0 ? -1 : 1;
                model.zoom = Math.max(0.75, Math.min(2.2, Number((model.zoom + direction * 0.2).toFixed(2))));
              } else {
                const scale = Math.max(0.75, Number(model.zoom) || 1);
                model.panX += (Number(event.deltaX || 0) * 1.8) / scale;
                model.panY += (Number(event.deltaY || 0) * 1.8) / scale;
              }
              rerender();
            },
            onpointerdown: (event) => {
              if (event.button !== 0 || event.target?.closest?.(".tl-kg-view-canvas-tools")) return;
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget?.setPointerCapture?.(event.pointerId);
              model.drag = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                startPanX: model.panX,
                startPanY: model.panY,
                startViewBox: String(event.currentTarget?.querySelector?.(".tl-kg-view-svg")?.getAttribute("viewBox") || "0 0 920 560").split(/\s+/).map(Number),
                canvasWidth: Math.max(1, Number(event.currentTarget?.clientWidth) || 1),
                canvasHeight: Math.max(1, Number(event.currentTarget?.clientHeight) || 1),
                moved: false,
              };
              event.currentTarget?.classList?.add("is-panning");
            },
            onpointermove: (event) => {
              if (!model.drag || model.drag.pointerId !== event.pointerId) return;
              event.preventDefault();
              event.stopPropagation();
              const dx = event.clientX - model.drag.startX;
              const dy = event.clientY - model.drag.startY;
              model.drag.moved = model.drag.moved || Math.abs(dx) + Math.abs(dy) > 4;
              const [startX = 0, startY = 0, viewWidth = 920, viewHeight = 560] = model.drag.startViewBox || [];
              const deltaX = (dx * viewWidth) / model.drag.canvasWidth;
              const deltaY = (dy * viewHeight) / model.drag.canvasHeight;
              const nextViewX = Math.max(0, Math.min(920 - viewWidth, startX - deltaX));
              const nextViewY = Math.max(0, Math.min(560 - viewHeight, startY - deltaY));
              model.panX = model.drag.startPanX - deltaX;
              model.panY = model.drag.startPanY - deltaY;
              event.currentTarget?.querySelector?.(".tl-kg-view-svg")?.setAttribute("viewBox", `${nextViewX} ${nextViewY} ${viewWidth} ${viewHeight}`);
            },
            onpointerup: (event) => {
              if (!model.drag || model.drag.pointerId !== event.pointerId) return;
              event.preventDefault();
              event.stopPropagation();
              model.suppressNextNodeClick = Boolean(model.drag.moved);
              model.drag = null;
              event.currentTarget?.releasePointerCapture?.(event.pointerId);
              event.currentTarget?.classList?.remove("is-panning");
            },
            onpointercancel: (event) => {
              if (!model.drag || model.drag.pointerId !== event.pointerId) return;
              model.drag = null;
              event.currentTarget?.releasePointerCapture?.(event.pointerId);
              event.currentTarget?.classList?.remove("is-panning");
            },
          },
          _.div(
            { class: "tl-kg-view-canvas-tools" },
            _.button({
              type: "button",
              title: "Zoom out",
              "aria-label": "Zoom out",
              onclick: (event) => {
                event.stopPropagation();
                model.zoom = Math.max(0.75, Number((model.zoom - 0.1).toFixed(2)));
                rerender();
              },
            }, icon("zoom_out", "sm")),
            _.button({
              type: "button",
              title: "Fit graph",
              "aria-label": "Fit graph",
              onclick: (event) => {
                event.stopPropagation();
                model.zoom = 1;
                model.panX = 0;
                model.panY = 0;
                rerender();
              },
            }, icon("center_focus_strong", "sm")),
            _.button({
              type: "button",
              title: "Zoom in",
              "aria-label": "Zoom in",
              onclick: (event) => {
                event.stopPropagation();
                model.zoom = Math.min(2.2, Number((model.zoom + 0.1).toFixed(2)));
                rerender();
              },
            }, icon("zoom_in", "sm")),
            _.span({ class: "tl-kg-view-zoom-label" }, `${Math.round(model.zoom * 100)}%`)
          ),
          visible.entities.length
            ? renderKnowledgeGraphCanvas({
              entities: visible.entities,
              relations: visible.relations,
              degree: visible.degree,
              mode: model.mode,
              selectedId: selected?.id || "",
              zoom: model.zoom,
              panX: model.panX,
              panY: model.panY,
              manualPositions: selected?.id && model.focusPosition?.id === selected.id
                ? { ...model.manualPositions, [selected.id]: model.focusPosition.point }
                : model.manualPositions,
              onViewportChange: (viewport) => {
                model.zoom = viewport.zoom;
                model.panX = viewport.panX;
                model.panY = viewport.panY;
                host.querySelector(".tl-kg-view-zoom-label")?.replaceChildren(`${Math.round(model.zoom * 100)}%`);
              },
              onSelect: (entity, context = {}) => {
                if (model.suppressNextNodeClick) {
                  model.suppressNextNodeClick = false;
                  return;
                }
                if (!entity && context?.background) {
                  model.selected = null;
                  model.focusPosition = null;
                  model.sideTab = "info";
                  rerender();
                  return;
                }
                focusGraphEntity(entity, { point: context.point });
              },
              onMoveNode: (entity, point, options = {}) => {
                model.manualPositions[entity.id] = point;
                model.focusPosition = { id: entity.id, point };
                if (options.preview) return;
                focusGraphEntity(entity);
              },
            })
            : _.div({ class: "tl-kg-view-empty" }, icon("account_tree", "lg"), _.strong("No entities"), _.span("Try changing filters or run Entity Extractor."))
        ),
        _.aside(
          { class: "tl-kg-view-side" },
          _.div(
            { class: "tl-kg-view-side-tabs" },
            ["selection", "info"].map((tab) =>
              _.button({
                type: "button",
                class: model.sideTab === tab ? "is-active" : "",
                onclick: (event) => {
                  event.stopPropagation();
                  model.sideTab = tab;
                  rerender();
                },
              }, tab === "selection" ? "Selection" : "Info")
            )
          ),
          model.sideTab === "selection"
            ? _.div(
              { class: "tl-kg-view-side-pane" },
              _.section(
                _.h3("Selection"),
                selected
                  ? _.div(
                    { class: "tl-kg-view-selection" },
                    ...renderSelectionContent(selected)
                  )
                  : _.p({ class: "tl-flow-muted" }, "No entity selected.")
              )
            )
            : _.div(
              { class: "tl-kg-view-side-pane" },
              _.section(
                _.h3("Index"),
                _.div(_.span("Entities"), _.strong(String(visible.entities.length))),
                _.div(_.span("Relations"), _.strong(String(visible.relations.length))),
                _.div(_.span("Semantic relations"), _.strong(String(visible.relations.filter((relation) => relation.metadata?.semantic).length))),
                _.div(_.span("Avg degree"), _.strong(analytics.avgDegree.toFixed(2))),
                _.div(_.span("Density"), _.strong(analytics.density.toFixed(3))),
                _.div(_.span("Components"), _.strong(String(analytics.components))),
                _.div(_.span("Isolated"), _.strong(String(analytics.isolated))),
                _.div(_.span("Repeated evidence"), _.strong(String(analytics.repeatedEvidenceCount))),
                _.div(_.span("Collection"), _.strong(graphData.collectionId || "all")),
                _.div(_.span("Configured document"), _.strong(graphData.configuredDocumentId || "all")),
                _.div(_.span("Latest snapshot document"), _.strong(graphData.latestSnapshotDocumentId || "N/D")),
                _.div(_.span("Viewing document"), _.strong(graphData.documentId || "all")),
                _.div(_.span("Document status"), _.strong(graphData.graphScope && graphData.graphScope !== "document"
                  ? graphData.graphScope
                  : graphData.configuredDocumentId && graphData.documentId && graphData.configuredDocumentId !== graphData.documentId
                    ? "using latest snapshot"
                    : "configured"))
              ),
              analytics.repeatedEvidence.length
                ? _.section(
                  _.h3("Repeated evidence"),
                  ...analytics.repeatedEvidence.map(({ relation, occurrenceCount }) =>
                    _.div(
                      { class: "tl-kg-view-evidence" },
                      _.span(`${relation.sourceLabel || "source"} -> ${relation.targetLabel || "target"}`),
                      _.strong(`${occurrenceCount}x`)
                    )
                  )
                )
                : null,
              _.section(
                _.h3("Top hubs"),
                ...analytics.topEntities.map(({ entity, degree: entityDegree }) =>
                  _.button({
                    type: "button",
                    class: "tl-kg-view-group is-hub",
                    onclick: (event) => {
                      event.stopPropagation();
                      focusGraphEntity(entity, { resetPan: false });
                    },
                  }, _.i({ style: `--kg-color:${knowledgeGraphTypeColors[entity.entityType] || knowledgeGraphTypeColors.entity}` }), _.span(entity.label || entity.id), _.strong(String(entityDegree)))
                )
              ),
              _.section(
                _.h3("Groups"),
                ...Object.entries(typeCounts).map(([type, count]) =>
                  _.button({
                    type: "button",
                    class: "tl-kg-view-group",
                    onclick: (event) => {
                      event.stopPropagation();
                      model.type = type;
                      rerender();
                    },
                  }, _.i({ style: `--kg-color:${knowledgeGraphTypeColors[type] || knowledgeGraphTypeColors.entity}` }), _.span(type), _.strong(String(count)))
                )
              ),
              _.section(
                _.h3("Relations"),
                ...Object.entries(relationTypeCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([type, count]) =>
                  _.button({
                    type: "button",
                    class: "tl-kg-view-group is-relation",
                    onclick: (event) => {
                      event.stopPropagation();
                      model.relationType = type;
                      rerender();
                    },
                  }, _.i({ style: `--kg-color:${knowledgeGraphRelationColors[type] || knowledgeGraphRelationColors.relation}` }), _.span(type), _.strong(String(count)))
                )
              )
            )
        )
      )
    );
    restoreSearchFocus();
  };
  const dialog = _.Dialog({
    class: "tl-kg-view-dialog",
    panelClass: "tl-kg-view-panel",
    size: "xl",
    title: node.label || "Knowledge Graph",
    subtitle: `${graphData.entities.length} entities · ${graphData.relations.length} relations`,
    icon: "account_tree",
    closeButton: true,
    closeOnOutside: false,
    onClose: () => {
      destroyKnowledgeGraphCanvases(host);
      host = null;
    },
    content: () => {
      host = _.div({
        class: "tl-kg-view",
        onclick: (event) => event.stopPropagation(),
        onpointerdown: (event) => event.stopPropagation(),
      });
      setTimeout(rerender, 0);
      return host;
    },
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: () => copyRuntimeValue(knowledgeGraphExportData(graphData, { includeIsolated: false })) }, icon("account_tree", "sm"), "Copy Graph"),
      btn({ onclick: () => copyRuntimeValue(knowledgeGraphExportData(graphData, { includeIsolated: true })) }, icon("content_copy", "sm"), "Copy With Isolated"),
      btn({ class: "st-btn-primary", onclick: close }, "Close")
    ),
  });
  dialog.open();
};

const renderInspectorKnowledgeGraph = (node = {}) => {
  if (nodeCategory(node) !== "knowledge") {
    return _.section({ class: "tl-flow-detail-list" }, _.p({ class: "tl-flow-muted" }, "N/D"));
  }
  loadKnowledgeInspectorGraph(node);
  const graph = state.knowledgeInspectorGraph[node.id] || { loading: true, entities: [], relations: [], metrics: [], topEntities: [] };
  const latestMetric = graph.metrics?.[0] || null;
  const config = nodeRuntimeConfig(node);
  const configuredDocumentId = graph.configuredDocumentId || String(config.documentId || "").trim();
  const effectiveDocumentId = graph.effectiveDocumentId || latestMetric?.value?.documentId || configuredDocumentId || "";
  const latestSnapshotDocumentId = graph.latestSnapshotDocumentId || latestMetric?.value?.documentId || "";
  const graphScope = graph.graphScope || latestMetric?.value?.graphScope || config.graphScope || "document";
  const documentMismatch = graphScope === "document" && Boolean(
    graph.documentMismatch ||
    (
      configuredDocumentId &&
      effectiveDocumentId &&
      configuredDocumentId !== effectiveDocumentId &&
      !isKnowledgeGraphSampleDocumentFallback(configuredDocumentId, effectiveDocumentId)
    )
  );
  const snapshot = {
    entityCount: graph.entities?.length || 0,
    relationCount: graph.relations?.length || 0,
    semanticRelationCount: graph.relations?.filter((relation) => relation.metadata?.semantic).length || 0,
    topEntities: graph.topEntities || [],
    latestMetric: latestMetric?.value || null,
    configuredDocumentId,
    effectiveDocumentId,
    latestSnapshotDocumentId,
    graphScope,
    documentMismatch,
  };
  return _.section(
    { class: "tl-flow-detail-list" },
    _.h3("Knowledge Graph Debug"),
    ...[
      ["Entities", graph.loading ? "loading..." : graph.entities?.length || 0],
      ["Relations", graph.loading ? "loading..." : graph.relations?.length || 0],
      ["Semantic relations", graph.loading ? "loading..." : graph.relations?.filter((relation) => relation.metadata?.semantic).length || 0],
      ["Snapshots", graph.loading ? "loading..." : graph.metrics?.length || 0],
      ["Latest snapshot", latestMetric?.createdAt ? formatShortDate(latestMetric.createdAt) : "N/D"],
      ["Collection", latestMetric?.value?.collectionId || config.collectionId || "all"],
      ["Configured document", configuredDocumentId || "all"],
      ["Latest snapshot document", latestSnapshotDocumentId || "N/D"],
      ["Viewing document", effectiveDocumentId || "all"],
      ["Document status", graphScope !== "document" ? graphScope : documentMismatch ? "using latest snapshot" : "configured"],
    ].map(([label, value]) => _.div({ class: "tl-flow-kg-stat-row" }, _.span(label), _.strong(String(value)))),
    graph.error ? _.p({ class: "tl-flow-muted" }, graph.error) : null,
    _.div(
      { class: "is-wide" },
      _.span("Actions"),
      _.div(
        { class: "tl-flow-storage-record-actions tl-flow-kg-actions" },
        copyRuntimeButton(snapshot, "Copy graph snapshot"),
        btn({
          class: "is-ghost is-compact",
          title: "View Knowledge Graph",
          onclick: () => openKnowledgeGraphViewDialog(node),
        }, icon("account_tree", "sm"), "View Graph"),
        btn({
          class: "is-ghost is-compact",
          title: "Refresh Knowledge graph",
          onclick: () => loadKnowledgeInspectorGraph(node, { force: true }),
        }, icon("sync", "sm"), "Refresh"),
        btn({
          class: "is-danger is-compact",
          title: "Clear Knowledge graph index",
          onclick: () => requestKnowledgeGraphClear(node),
        }, icon("delete_sweep", "sm"), "Clear Graph")
      )
    ),
    graph.topEntities?.length
      ? _.div(
        { class: "is-wide" },
        _.span("Top entities"),
        _.div(
          { class: "tl-flow-rag-source-list tl-flow-kg-list" },
          ...graph.topEntities.map((entity) =>
            _.article(
              { class: "tl-flow-rag-source tl-flow-kg-item" },
              _.strong(`${entity.label || entity.id} · degree ${entity.degree || 0}`),
              _.span(`${entity.entityType || "entity"} · confidence ${Number.isFinite(Number(entity.confidence)) ? Number(entity.confidence).toFixed(2) : "N/D"}`),
              _.p(entity.documentId || entity.chunkId || "")
            )
          )
        )
      )
      : _.p({ class: "tl-flow-muted" }, graph.loading ? "Caricamento grafo Knowledge..." : "Nessuna entità trovata per questo scope."),
    graph.relations?.length
      ? _.div(
        { class: "is-wide" },
        _.span("Recent relations"),
        _.div(
          { class: "tl-flow-rag-source-list tl-flow-kg-list" },
          ...graph.relations.slice(0, 8).map((relation) =>
            _.article(
              { class: "tl-flow-rag-source tl-flow-kg-item" },
              _.strong(`${relation.sourceLabel || relation.sourceEntityId} -> ${relation.targetLabel || relation.targetEntityId}`),
              _.span(`${relation.relationType || "relation"} · confidence ${Number.isFinite(Number(relation.confidence)) ? Number(relation.confidence).toFixed(2) : "N/D"}${relation.metadata?.semantic ? ` · ${relation.extraction?.method || "semantic"}` : ""}`),
              _.p([
                relation.metadata?.originalRelationType ? `original ${relation.metadata.originalRelationType}` : "",
                relation.metadata?.explanation || relation.evidence?.quote || relation.documentId || relation.chunkId || "",
              ].filter(Boolean).join(" · "))
            )
          )
        )
      )
      : null
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
              copyRuntimeButton(event.originalPayload ?? event.payload ?? {}, "Copy payload")
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
  const linkType = edge.metadata?.linkType || edge.mapping?.linkType || "data";
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
          ["Link role", linkTypeLabel(linkType)],
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
          ["Link role", linkTypeLabel(linkType)],
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
            mappedLastEvent ? copyRuntimeButton(mappedLastEvent.originalPayload ?? mappedLastEvent.payload, "Copy mapped payload") : null
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
  const canDeleteRuntimeNode = canDeleteRuntimeCanvasNode(node);
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
    { id: "agent-tools-debug", title: "Agent Tools", content: renderInspectorAgentTools(node) },
    ...(node.type === "storage" || nodeCategory(node) === "storage"
      ? [{ id: "storage-record", title: "Last Stored Record", content: renderInspectorStorageRecord(node) }]
      : []),
    ...(nodeCategory(node) === "ai-agents"
      ? [{ id: "ai-knowledge-debug", title: "AI Knowledge Debug", content: renderInspectorAiRag(node) }]
      : []),
    ...(isKnowledgeDictionaryBuilderNode(node)
      ? [{ id: "knowledge-dictionary-debug", title: "Knowledge Dictionary Debug", content: renderInspectorKnowledgeDictionary(node) }]
      : []),
    ...(isKnowledgeEventBuilderNode(node)
      ? [{ id: "knowledge-event-debug", title: "Knowledge Event Debug", content: renderInspectorKnowledgeEvents(node) }]
      : []),
    ...(isStructuredKnowledgeStoreNode(node)
      ? [{ id: "structured-knowledge-debug", title: nodeSubtype(node) === "world-database" ? "World Database Debug" : "Structured Knowledge Debug", content: renderInspectorStructuredKnowledge(node) }]
      : []),
    ...(nodeCategory(node) === "knowledge"
      ? [{ id: "knowledge-graph-debug", title: "Knowledge Graph Debug", content: renderInspectorKnowledgeGraph(node) }]
      : []),
    ...(isKnowledgeDocumentStoreNode(node)
      ? [{ id: "knowledge-document-debug", title: "Knowledge Document Debug", content: renderInspectorKnowledgeDocument(node) }]
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
        inspectorActionButton({ label: draft ? "Configure Draft" : "Open Config", iconName: draft ? "edit" : "open_in_new", className: "st-btn-primary", onclick: () => configureNode(node) }),
        inspectorActionButton({ label: "Duplicate", iconName: "content_copy", onclick: () => duplicateRuntimeNode(node) }),
        inspectorActionButton({ label: paused || disabled ? "Resume" : "Pause", iconName: paused || disabled ? "play_arrow" : "pause", onclick: () => (paused || disabled ? resumeNodeRuntime(node) : pauseNodeRuntime(node)) }),
        inspectorActionButton({ label: disabled ? "Enable" : "Disable", iconName: disabled ? "power_settings_new" : "block", onclick: () => (disabled ? resumeNodeRuntime(node) : disableNodeRuntime(node)) }),
        inspectorActionButton({ label: node.metadata?.collapsed ? "Expand" : "Collapse", iconName: node.metadata?.collapsed ? "unfold_more" : "unfold_less", onclick: () => toggleNodeCollapse(node) }),
        isLinkTarget
          ? inspectorActionButton({ label: "Link Here", iconName: "add_link", onclick: () => createLinkToNode(node) })
          : inspectorActionButton({ label: linkingSource?.id === node.id ? "Linking..." : "Start Link", iconName: "hub", onclick: () => startLinkFromNode(node), disabled: Boolean(linkingSource && linkingSource.id === node.id) }),
        linkingSource ? inspectorActionButton({ label: "Cancel Link", iconName: "link_off", onclick: cancelLinkMode }) : null,
        canDeleteRuntimeNode ? inspectorActionButton({ label: isEmbeddedFlowMapNode(node) ? "Delete Alias" : draft ? "Delete Draft" : "Delete Node", iconName: "delete", className: "is-danger", onclick: () => requestDraftNodeDelete(node) }) : null
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

const renderAgentRuntimeNodeRecord = (record = {}) => {
  const node = record.node || {};
  const dependencies = record.dependencies || [];
  const events = record.recentEvents || [];
  const impact = record.impact || {};
  const ports = node.ports || {};
  const metric = (label = "", value = "") => _.span(_.strong(String(value ?? 0)), _.em(label));
  return _.div(
    { class: "tl-flow-record-summary" },
    _.section(
      { class: "tl-flow-record-hero" },
      icon(node.type === "aiAgent" ? "psychology" : "account_tree", "sm"),
      _.span(
        _.strong(node.label || record.nodeId || "Runtime Node"),
        _.em([node.type, node.subtype, node.status].filter(Boolean).join(" · ") || node.id || "")
      )
    ),
    _.section(
      { class: "tl-flow-record-metrics" },
      metric("inputs", ports.inputs?.length || 0),
      metric("outputs", ports.outputs?.length || 0),
      metric("dependencies", dependencies.length),
      metric("recent events", events.length)
    ),
    _.section(
      { class: "tl-flow-record-grid" },
      _.div(
        _.h3("Inputs"),
        ...((ports.inputs || []).length ? ports.inputs.map((item) => _.code(item)) : [_.p("None")])
      ),
      _.div(
        _.h3("Outputs"),
        ...((ports.outputs || []).length ? ports.outputs.map((item) => _.code(item)) : [_.p("None")])
      )
    ),
    _.details(
      { class: "tl-flow-record-section" },
      _.summary(icon("add_link", "sm"), _.strong("Dependencies"), _.em(`${dependencies.length}`), icon("expand_more", "sm")),
      dependencies.length ? _.div(
        { class: "tl-flow-record-list" },
        ...dependencies.slice(0, 12).map((dependency) =>
          _.span(
            icon("link", "sm"),
            _.strong(`${dependency.sourceNodeId || "source"} -> ${dependency.targetNodeId || "target"}`),
            _.em([dependency.channel, dependency.status].filter(Boolean).join(" · ") || dependency.id || "")
          )
        )
      ) : _.p("No dependencies")
    ),
    _.details(
      { class: "tl-flow-record-section" },
      _.summary(icon("bolt", "sm"), _.strong("Recent Events"), _.em(`${events.length}`), icon("expand_more", "sm")),
      events.length ? _.div(
        { class: "tl-flow-record-list" },
        ...events.slice(0, 12).map((event) =>
          _.span(
            icon(event.status === "error" ? "error" : "bolt", "sm"),
            _.strong(event.eventType || event.channel || "event"),
            _.em([event.channel, event.status, event.createdAt ? new Date(event.createdAt).toLocaleTimeString() : ""].filter(Boolean).join(" · "))
          )
        )
      ) : _.p("No recent events")
    ),
    _.details(
      { class: "tl-flow-record-section" },
      _.summary(icon("account_tree", "sm"), _.strong("Impact"), _.em(impact.risk || "runtime"), icon("expand_more", "sm")),
      _.pre({ class: "tl-flow-record-json is-compact" }, JSON.stringify(impact || {}, null, 2))
    ),
    _.details(
      { class: "tl-flow-record-section" },
      _.summary(icon("data_object", "sm"), _.strong("Raw JSON"), copyRuntimeButton(record, "Copy raw JSON"), icon("expand_more", "sm")),
      _.pre({ class: "tl-flow-record-json" }, JSON.stringify(record || {}, null, 2))
    )
  );
};

const openFlowRecordDialog = ({ title = "Runtime record", subtitle = "", iconName = "data_object", record = {} } = {}) => {
  const dialog = _.Dialog({
    class: "tl-flow-record-dialog",
    panelClass: "tl-flow-record-dialog-panel",
    size: "lg",
    title,
    subtitle,
    icon: iconName,
    closeButton: true,
    content: () => record?.version === "agent-runtime-v1" && record?.node
      ? renderAgentRuntimeNodeRecord(record)
      : _.pre({ class: "tl-flow-record-json" }, JSON.stringify(record || {}, null, 2)),
    actions: ({ close }) => btn({ class: "st-btn-primary", onclick: close }, "Close"),
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
      ["Version", state.runtimeWorker.version || "N/D"],
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
        btn({
          class: "tl-flow-error-close",
          dense: true,
          title: "Chiudi errore",
          "aria-label": "Chiudi errore",
          onClick: (event) => {
            event.preventDefault();
            event.stopPropagation();
            clearFlowMapError({ remount: true });
          },
        }, icon("close", "sm"))
      ) : null,
      _.div(
        { class: "tl-flow-grid" },
        _.div({ class: "tl-flow-center" }, renderCanvas()),
        renderStatusBar()
      ),
      renderPromptChatTrigger(),
      state.inspectorOpen ? _.div({ class: "tl-flow-inspector-overlay" }, renderInspector()) : null,
      renderNodeContextMenu(),
      renderCanvasNodeMenu()
    )
  );
