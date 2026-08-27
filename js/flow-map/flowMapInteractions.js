// Flow Map pointer interactions, selection, channel tools and dependency reports.
// Extracted from js/flowMapView.js; loaded in order by flowMap.html.
const beginPan = (event) => {
  if (event.button !== 0 || event.ctrlKey) return;
  if (event.target.closest?.(".tl-flow-node, .tl-flow-panel, .tl-flow-controls, .tl-flow-filterbar, .tl-flow-minimap")) return;
  const edge = edgeAtPointer(event);
  if (edge) {
    event.preventDefault();
    event.stopPropagation();
    selectEdge(edge);
    return;
  }
  event.preventDefault();
  state.interaction = {
    type: "pan",
    startX: event.clientX,
    startY: event.clientY,
    panX: state.viewport.panX,
    panY: state.viewport.panY,
    moved: false,
  };
  document.addEventListener("pointermove", handlePointerMove);
  document.addEventListener("pointerup", endInteraction, { once: true });
  document.addEventListener("pointercancel", endInteraction, { once: true });
};

const clampFlowNumber = (value, min = FLOW_CANVAS_POSITION_MIN, max = FLOW_CANVAS_POSITION_MAX) =>
  Math.max(min, Math.min(max, Number(value) || 0));

const flowPositionNumber = (position = {}, axis = "x") =>
  clampFlowNumber(parseFloat(position?.[axis]));

const flowPositionWidth = (position = {}) =>
  flowNodeWidth(position);

const wheelPixelDelta = (event) => {
  const multiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE
    ? 16
    : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
      ? Math.max(1, event.currentTarget?.clientHeight || window.innerHeight || 800)
      : 1;
  return {
    x: event.deltaX * multiplier,
    y: event.deltaY * multiplier,
  };
};

const updateCanvasViewportDom = () => {
  const layer = document.querySelector(".tl-flow-layer");
  if (layer) layer.style.transform = `translate(${state.viewport.panX}px, ${state.viewport.panY}px) scale(${state.viewport.zoom})`;
  const zoomLabel = document.querySelector("[data-flow-zoom-label]");
  if (zoomLabel) zoomLabel.textContent = `${Math.round(state.viewport.zoom * 100)}%`;
  renderFlowEdges();
  if (typeof updateFlowMinimapDom === "function") updateFlowMinimapDom();
};

const zoomCanvasAtPoint = (event, deltaY = 0) => {
  const canvas = event.currentTarget?.closest?.(".tl-flow-canvas") || event.currentTarget;
  const rect = canvas?.getBoundingClientRect?.();
  if (!rect?.width || !rect?.height) return;
  const currentZoom = Math.max(0.45, Math.min(2.2, Number(state.viewport.zoom) || 1));
  const zoomFactor = Math.exp(-deltaY * 0.0015);
  const nextZoom = Math.max(0.45, Math.min(2.2, Math.round(currentZoom * zoomFactor * 100) / 100));
  if (nextZoom === currentZoom) return;
  const pointX = event.clientX - rect.left;
  const pointY = event.clientY - rect.top;
  const worldX = (pointX - state.viewport.panX) / currentZoom;
  const worldY = (pointY - state.viewport.panY) / currentZoom;
  state.viewport.zoom = nextZoom;
  state.viewport.panX = Math.round(pointX - worldX * nextZoom);
  state.viewport.panY = Math.round(pointY - worldY * nextZoom);
};

const handleCanvasWheel = (event) => {
  if (event.target.closest?.(".tl-flow-panel, .tl-flow-controls, .tl-flow-filterbar, .tl-flow-minimap, input, textarea, select, [contenteditable='true']")) return;
  event.preventDefault();
  event.stopPropagation();
  const delta = wheelPixelDelta(event);
  if (event.ctrlKey) {
    zoomCanvasAtPoint(event, delta.y || delta.x);
  } else {
    const horizontal = event.shiftKey && Math.abs(delta.x) < Math.abs(delta.y) ? delta.y : delta.x;
    const vertical = event.shiftKey && Math.abs(delta.x) < Math.abs(delta.y) ? 0 : delta.y;
    state.viewport.panX -= horizontal;
    state.viewport.panY -= vertical;
  }
  saveViewport();
  updateCanvasViewportDom();
};

const createDraftNodeAtFlowPosition = async ({ item, flowPosition }) => {
  if (isExistingFlowMapPaletteItem(item)) {
    openExistingFlowMapDialog({
      flowPosition,
    });
    state.paletteDragItem = null;
    return null;
  }
  if (isExistingLibraryPaletteItem(item) && !item.url) {
    openExistingLibraryDialog(item, { flowPosition });
    state.paletteDragItem = null;
    return null;
  }
  const workspaceId = await ensureRuntimeWorkspaceScope();
  const node = await window.TrackerLensRuntimeGraphStore?.createDraftNode?.({
    workspaceId,
    type: item.nodeType || "node",
    label: item.label,
    inputs: item.inputs || item.manifest?.inputs || [],
    outputs: item.outputs || item.manifest?.outputs || [],
    flowPosition,
    channels: [channelForDraft()].filter(Boolean),
    metadata: {
      paletteLabel: item.label,
      paletteAction: item.url || item.trackerSource || item.connectionType || "",
      tone: item.tone || "",
      icon: item.icon || "",
      runtimeType: item.manifest?.type || item.nodeType || "node",
      subtype: item.subtype || item.manifest?.subtype || "",
      category: item.category || item.manifest?.category || "",
      manifest: item.manifest || null,
      permissions: item.permissions || item.manifest?.permissions || [],
      settingsSchema: item.settingsSchema || item.manifest?.settingsSchema || {},
      runtimeMetadata: item.runtime || item.manifest?.runtime || {},
    },
  });

  state.paletteDragItem = null;
  if (node?.id) {
    if (isPreviewNode(node)) markPreviewNodeClean(node);
    setFocusState({
      mode: "dependencies",
      nodeId: node.id,
      nodeType: node.type,
      channel: node.channels?.[0] || "",
      connectionId: "",
    });
  }
  await loadRuntime();
  await promptMissingManagedPythonPack(node, item);
  return node || null;
};

const flowPythonInstallProgressText = (progress = {}) => {
  const downloaded = Number(progress.downloadedBytes || 0);
  const total = Number(progress.totalBytes || 0);
  const format = (bytes) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
  if (progress.phase === "downloading-model" && total > 0) return `${format(downloaded)} di ${format(total)} · ${Math.round(Number(progress.modelProgress || 0))}% del modello`;
  return `${Math.round(Number(progress.progress || 0))}% · ${progress.phase || "preparing"}`;
};
const flowPythonVisibleInstallProgress = (progress = {}) => progress.phase === "downloading-model" && Number.isFinite(Number(progress.modelProgress))
  ? Number(progress.modelProgress)
  : Number(progress.progress || 0);

const openFlowPythonPackInstallDialog = async (packId = "", onComplete = null) => {
  const runtime = window.trackers?.runtime?.pythonRuntime;
  const plan = await runtime?.getInstallPlan?.({ packId });
  if (!plan) throw new Error("Piano di installazione Python non disponibile");
  const progressId = `tl-flow-python-install-${String(packId).replace(/[^a-z0-9_-]/gi, "-")}`;
  let unsubscribe = () => {};
  const syncProgress = (progress = {}) => {
    if (progress.packId !== packId) return;
    const root = document.getElementById(progressId);
    if (!root) return;
    root.hidden = false;
    root.classList.toggle("is-error", progress.phase === "error");
    const message = root.querySelector("[data-flow-install-message]");
    const fill = root.querySelector("[data-flow-install-fill]");
    const detail = root.querySelector("[data-flow-install-detail]");
    if (message) message.textContent = progress.message || "Operazione in corso";
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, flowPythonVisibleInstallProgress(progress)))}%`;
    if (detail) detail.textContent = flowPythonInstallProgressText(progress);
  };
  const dialog = _.Dialog({
    class: "tl-flow-python-pack-dialog",
    panelClass: "tl-flow-python-pack-panel",
    size: "lg",
    title: "Installare il pack Python?",
    subtitle: `${plan.pack.id} · v${plan.pack.version}`,
    icon: "download",
    closeButton: true,
    content: () => _.div(
      { class: "tl-flow-python-pack-copy" },
      _.p("TL installerà solo il lockfile e i modelli dichiarati da questo pack. Il Nodo non riceve accesso a pip, shell o filesystem."),
      _.div(_.span("Ambiente"), _.strong(`${plan.environment.id} · ${plan.environment.action === "create" ? "verrà creato" : "verrà riutilizzato"}`)),
      _.div(_.span("Dipendenze"), _.code(plan.requirements.map((item) => `${item.name} ${item.version}`).join(", "))),
      _.div(_.span("Modelli"), _.code(plan.models.map((model) => `${model.id}@${model.revision}`).join(", ") || "nessuno")),
      _.div(_.span("Rete"), _.strong(plan.network.required ? "Richiesta: pacchetti/modelli saranno scaricati" : "Non richiesta")),
      _.section({ id: progressId, class: "tl-flow-python-install-progress", hidden: true },
        _.div(_.strong("Installazione in corso"), _.span({ "data-flow-install-message": "" })),
        _.div({ class: "tl-flow-python-install-progress-bar", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100 }, _.i({ "data-flow-install-fill": "", style: "width:0%" })),
        _.small({ "data-flow-install-detail": "" })
      )
    ),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ id: `${progressId}-close`, onclick: () => { unsubscribe(); close(); } }, "Annulla"),
      btn({ id: `${progressId}-start`, class: "st-btn-primary", onclick: async (event) => {
        const startButton = event.currentTarget;
        const closeButton = document.getElementById(`${progressId}-close`);
        startButton.disabled = true;
        if (closeButton) closeButton.disabled = true;
        unsubscribe = runtime.onInstallProgress?.(syncProgress) || (() => {});
        syncProgress({ packId, phase: "preparing", progress: 0, message: "Preparazione installazione" });
        try {
          await runtime.installPack({ packId, confirmed: true });
          syncProgress({ packId, phase: "complete", progress: 100, message: "Installazione completata e verificata" });
          if (closeButton) { closeButton.disabled = false; closeButton.textContent = "Chiudi"; }
          await onComplete?.();
        } catch (error) {
          syncProgress({ packId, phase: "error", progress: 0, message: error?.message || "Installazione Python non riuscita" });
          if (closeButton) { closeButton.disabled = false; closeButton.textContent = "Chiudi"; }
        }
      } }, icon("download", "sm"), "Installa pack")
    )
  });
  dialog.open();
};

const promptMissingManagedPythonPack = async (node = {}, item = {}) => {
  const execution = node.metadata?.manifest?.execution || node.execution || item.manifest?.execution || null;
  const python = execution?.dependencies?.python;
  const subtype = String(node.metadata?.subtype || node.metadata?.manifest?.subtype || "").toLowerCase();
  const requiredByDefault = Boolean(python?.requiredByDefault || execution?.runtime === "python" || subtype === "rag-search");
  if (!python || !requiredByDefault || !window.trackers?.runtime?.pythonPacks?.resolve) return;
  const resolution = await window.trackers.runtime.pythonPacks.resolve(execution).catch(() => null);
  if (resolution?.status === "ready" || !resolution?.installPlan?.packId) return;
  const packId = resolution.installPlan.packId;
  const requirements = (python.requirements || []).map((item) => `${item.name} ${item.version}`).join(", ");
  const dialog = _.Dialog({
    class: "tl-flow-python-pack-dialog",
    panelClass: "tl-flow-python-pack-panel",
    size: "md",
    title: "Questo Nodo richiede Python",
    subtitle: node.label || node.id,
    icon: "memory",
    closeButton: true,
    content: () => _.div(
      { class: "tl-flow-python-pack-copy" },
      _.p(`Il pack ${packId} non è installato. Questo Nodo non potrà essere eseguito finché il requisito non sarà disponibile.`),
      _.div(_.span("Ambiente"), _.strong(python.environment)),
      _.div(_.span("Moduli bloccati"), _.code(requirements || "N/D")),
      _.p("Puoi installarlo ora: TL mostrerà il piano completo, l’uso della rete e il modello dichiarato prima della conferma finale.")
    ),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: close }, "Non ora"),
      btn({ class: "st-btn-primary", onclick: async () => {
        close();
        try {
          await openFlowPythonPackInstallDialog(packId, async () => {
            await loadRuntime();
            if (typeof renderFlowCanvas === "function") renderFlowCanvas();
          });
        } catch (error) {
          window.alert(error?.message || "Piano di installazione Python non disponibile");
        }
      } }, icon("download", "sm"), "Installa")
    )
  });
  dialog.open();
};

const isExistingLibraryPaletteItem = (item = {}) =>
  item.subtype === "existing" && ["boxTracker", "boxLens", "aiAgent"].includes(item.nodeType);

const isExistingAiAgentPaletteItem = (item = {}) =>
  item.subtype === "existing" && item.nodeType === "aiAgent";

const isExistingFlowMapPaletteItem = (item = {}) =>
  item.subtype === "existing" && item.nodeType === "flowMap";

const libraryAssetKindForPalette = (item = {}) =>
  item.nodeType === "boxLens" ? "boxLens" : "boxTracker";

const defaultAssetFlowPosition = () => {
  const offset = Math.min(900, (state.runtime.nodes || []).length * 42);
  return {
    x: flowCoordinate(160 + offset),
    y: flowCoordinate(140 + offset),
    width: FLOW_NODE_DEFAULT_WIDTH,
  };
};

const listExistingLibraryAssets = async (kind = "boxTracker") => {
  try {
    const assets = await window.TrackerLensLocalLibrary?.listWidgetAssets?.();
    if (Array.isArray(assets)) return assets.filter((asset) => asset.type === kind);
  } catch (error) {
    console.warn("Errore lettura Local Library per Flow Map", error);
  }
  return (state.libraryItems || []).filter((asset) => asset.type === kind);
};

const listExistingAiAgents = async () => {
  try {
    const data = await window.TrackerLensAiRuntimeStore?.list?.();
    const agents = Array.isArray(data?.agents) ? data.agents : [];
    return agents.filter((agent) =>
      agent?.id &&
      !String(agent.id).startsWith("widget_agent_") &&
      !String(agent.id).startsWith("connection_agent_") &&
      !String(agent.id).startsWith("workspace_agent_")
    );
  } catch (error) {
    console.warn("Errore lettura AI Agents per Flow Map", error);
  }
  return [];
};

const flowMapStoreName = (key, fallback) => (typeof tlConfig !== "undefined" ? tlConfig.TABLES?.[key] : null) || fallback;

const readFlowMapLocalStore = async (storeName) => {
  const persistence = window.trackers?.desktop?.persistence;
  if (!persistence?.readDevelopmentRecords) throw new Error("Flow Map richiede SQLite nell'app desktop.");
  return persistence.readDevelopmentRecords({ storeName });
};

const flowMapContentOf = (record) => record?.content && typeof record.content === "object" ? record.content : record || {};
const isFlowMapPageRecord = (record = {}) => {
  const content = flowMapContentOf(record);
  return content.type === "flowmap" || content.kind === "flowmap" || content.format === "tlflow" || record?.format === "tlflow";
};

const isFlowPortNode = (node = {}, subtype = "") => {
  const value = String(node.metadata?.subtype || node.subtype || "").toLowerCase();
  const label = String(node.metadata?.paletteLabel || node.label || "").toLowerCase();
  return value === subtype || label === (subtype === "flow-in" ? "flow in" : "flow out");
};

const normalizeComposableFlowPort = (port = {}, fallbackName = "flow.port") => {
  if (typeof port === "string") return { name: port || fallbackName, type: "object" };
  return {
    name: String(port.name || port.key || port.channel || port.id || fallbackName),
    type: String(port.type || port.valueType || "object"),
    schema: port.schema || port.payloadSchema || null,
    required: Boolean(port.required),
  };
};

const composableFlowPortsForNode = (node = {}, subtype = "") => {
  const direction = subtype === "flow-out" ? "inputs" : "outputs";
  const fallback = subtype === "flow-out" ? "flow.out" : "flow.in";
  const stored = Array.isArray(node.metadata?.flowPorts) ? node.metadata.flowPorts : [];
  const source = stored.length ? stored : Array.isArray(node[direction]) ? node[direction] : [];
  const ports = source
    .map((port) => normalizeComposableFlowPort(port, fallback))
    .filter((port) => port.name && port.name !== "all" && port.name !== "agent_control");
  return ports.length ? ports : [{ name: fallback, type: "object" }];
};

const uniqueComposableFlowPorts = (nodes = [], subtype = "") => {
  const unique = new Map();
  nodes
    .filter((node) => isFlowPortNode(node, subtype))
    .flatMap((node) => composableFlowPortsForNode(node, subtype))
    .forEach((port) => {
      if (!unique.has(port.name)) unique.set(port.name, port);
    });
  return [...unique.values()];
};

const listAvailableFlowMaps = async () => {
  const pageStore = flowMapStoreName("TL_PAGES", "tl_pages");
  const nodeStore = flowMapStoreName("TL_RUNTIME_NODES", "tl_runtime_nodes");
  const [pages, nodes] = await Promise.all([
    readFlowMapLocalStore(pageStore),
    readFlowMapLocalStore(nodeStore),
  ]);
  const currentWorkspaceId = state.filters.workspaceId || "";
  return pages
    .filter(isFlowMapPageRecord)
    .map((record) => {
      const content = flowMapContentOf(record);
      const id = String(content.id || record.id || "").trim();
      const scopedNodes = nodes.filter((node) => node.workspaceId === id);
      const inputPorts = uniqueComposableFlowPorts(scopedNodes, "flow-in");
      const outputPorts = uniqueComposableFlowPorts(scopedNodes, "flow-out");
      const hasInput = inputPorts.length > 0;
      const hasOutput = outputPorts.length > 0;
      return {
        id,
        name: content.name || content.title || id,
        category: content.category || "global",
        description: content.description || `${scopedNodes.length} nodi runtime`,
        version: content.version || "0.1.0",
        hasInput,
        hasOutput,
        inputPorts,
        outputPorts,
        portCount: inputPorts.length + outputPorts.length,
      };
    })
    .filter((item) => item.id && item.id !== currentWorkspaceId);
};

const refreshAvailableFlowMap = async (flowMapId = "") => {
  const flowMaps = await listAvailableFlowMaps();
  return flowMaps.find((flowMap) => flowMap.id === flowMapId) || null;
};

const embeddedFlowMapAliasSignature = (node = {}) => JSON.stringify({
  label: node.label || "",
  inputs: node.inputs || [],
  outputs: node.outputs || [],
  channels: node.channels || [],
  version: node.metadata?.version || "",
  hasInput: Boolean(node.metadata?.hasInput),
  hasOutput: Boolean(node.metadata?.hasOutput),
});

const syncEmbeddedFlowMapAliases = async (nodes = []) => {
  const aliases = nodes.filter(isEmbeddedFlowMapNode);
  if (!aliases.length) return nodes;
  const availableFlowMaps = await listAvailableFlowMaps().catch((error) => {
    console.warn("Errore sincronizzazione alias Flow Map", error);
    return [];
  });
  const flowMapsById = new Map(availableFlowMaps.map((flowMap) => [flowMap.id, flowMap]));
  const updates = [];
  const nextNodes = nodes.map((node) => {
    if (!isEmbeddedFlowMapNode(node)) return node;
    const flowMapId = node.metadata?.flowMapId || node.sourceRef || node.assetId || "";
    const flowMap = flowMapsById.get(flowMapId);
    if (!flowMap) return node;
    const inputs = flowMap.hasInput ? flowMap.inputPorts || [] : [];
    const outputs = flowMap.hasOutput ? flowMap.outputPorts || [] : [];
    const inputNames = inputs.map((port) => port.name || port).filter(Boolean);
    const outputNames = outputs.map((port) => port.name || port).filter(Boolean);
    const nextNode = {
      ...node,
      label: flowMap.name || node.label,
      inputs,
      outputs,
      channels: [...new Set([...inputNames, ...outputNames])],
      metadata: {
        ...(node.metadata || {}),
        flowMapId,
        flowMapName: flowMap.name || "",
        version: flowMap.version || "0.1.0",
        hasInput: Boolean(flowMap.hasInput),
        hasOutput: Boolean(flowMap.hasOutput),
        inputPorts: inputs,
        outputPorts: outputs,
        manifest: {
          ...(node.metadata?.manifest || {}),
          inputs,
          outputs,
        },
      },
    };
    if (embeddedFlowMapAliasSignature(nextNode) !== embeddedFlowMapAliasSignature(node)) updates.push(nextNode);
    return nextNode;
  });
  if (updates.length) {
    await Promise.all(updates.map(async (node) => {
      await window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode?.({ node });
      await window.TrackerLensChannelRegistry?.upsertChannelsForRuntimeNode?.({ node });
    }));
  }
  return nextNodes;
};

const flowMapPreviewToneRgb = (tone = "") => ({
  green: "34, 197, 94",
  cyan: "34, 211, 238",
  blue: "56, 189, 248",
  gold: "250, 204, 21",
  orange: "251, 146, 60",
  purple: "168, 85, 247",
  violet: "139, 92, 246",
  pink: "236, 72, 153",
  red: "248, 113, 113",
  teal: "45, 212, 191",
}[String(tone || "").toLowerCase()] || "56, 189, 248");

const flowMapPreviewNodeType = (node = {}) => {
  const subtype = String(node.metadata?.subtype || node.subtype || "").trim();
  return [node.type || "node", subtype && subtype !== node.type ? subtype : ""].filter(Boolean).join(" · ");
};

const flowMapPreviewNormalizePort = (port = {}, fallbackName = "port") => {
  if (typeof port === "string") return { name: port || fallbackName, type: "object" };
  return {
    name: String(port.name || port.key || port.channel || port.id || fallbackName),
    type: String(port.type || port.valueType || "object"),
    required: Boolean(port.required),
  };
};

const flowMapPreviewIsEmbeddedNode = (node = {}) =>
  node?.type === "flowMap" && Boolean(node?.metadata?.embeddedFlowMap || node?.metadata?.flowMapId);

const flowMapPreviewPortsForNode = (node = {}, side = "out") => {
  if (!node?.id) return [];
  if (isFlowPortNode(node, "flow-in")) return side === "out" ? composableFlowPortsForNode(node, "flow-in") : [];
  if (isFlowPortNode(node, "flow-out")) return side === "in" ? composableFlowPortsForNode(node, "flow-out") : [];
  if (flowMapPreviewIsEmbeddedNode(node)) {
    const metadataPorts = side === "in" ? node.metadata?.inputPorts : node.metadata?.outputPorts;
    const declaredPorts = side === "in" ? node.inputs : node.outputs;
    const source = Array.isArray(metadataPorts) && metadataPorts.length ? metadataPorts : declaredPorts || [];
    const unique = new Map();
    source
      .filter(Boolean)
      .map((port, index) => flowMapPreviewNormalizePort(port, `${side}.${index + 1}`))
      .forEach((port) => {
        if (!port.name || port.name === "all" || port.name === "agent_control" || unique.has(port.name)) return;
        unique.set(port.name, port);
      });
    return [...unique.values()];
  }
  const source = side === "in" ? node.inputs : node.outputs;
  return (Array.isArray(source) ? source : [])
    .filter(Boolean)
    .map((port, index) => flowMapPreviewNormalizePort(port, `${side}.${index + 1}`))
    .filter((port) => port.name && port.name !== "all" && port.name !== "agent_control");
};

const flowMapPreviewNodePorts = (node = {}) => ({
  in: flowMapPreviewPortsForNode(node, "in"),
  out: flowMapPreviewPortsForNode(node, "out"),
});

const flowMapPreviewNodeHeight = (node = {}) => {
  const ports = flowMapPreviewNodePorts(node);
  const rows = Math.min(5, Math.max(ports.in.length, ports.out.length));
  return rows ? 92 + rows * 20 : 72;
};

const flowMapPreviewTextWidthEstimate = (value = "", size = 9) =>
  String(value || "").length * size * 0.62;

const flowMapPreviewNodeWidth = (node = {}) => {
  const value = typeof flowNodeWidth === "function" ? flowNodeWidth(node) : Number(node.flowPosition?.width || 218);
  const width = Number.isFinite(value) ? value : 218;
  const ports = flowMapPreviewNodePorts(node);
  const longestInput = Math.max(0, ...ports.in.map((port) => String(port.name || "").length));
  const longestOutput = Math.max(0, ...ports.out.map((port) => String(port.name || "").length));
  const portWidth = longestInput && longestOutput
    ? flowMapPreviewTextWidthEstimate("x".repeat(longestInput + longestOutput), 9) + 108
    : flowMapPreviewTextWidthEstimate("x".repeat(Math.max(longestInput, longestOutput)), 9) + 88;
  const labelWidth = flowMapPreviewTextWidthEstimate(node.label || node.id, 13) + 82;
  const typeWidth = flowMapPreviewTextWidthEstimate(flowMapPreviewNodeType(node), 10) + 82;
  return Math.min(1040, Math.max(240, width + 96, portWidth, labelWidth, typeWidth));
};

const loadEmbeddedFlowMapPreview = async (flowMapId = "") => {
  const nodeStore = flowMapStoreName("TL_RUNTIME_NODES", "tl_runtime_nodes");
  const dependencyStore = flowMapStoreName("TL_RUNTIME_DEPENDENCIES", "tl_runtime_dependencies");
  const [flowMap, allNodes, allDependencies] = await Promise.all([
    refreshAvailableFlowMap(flowMapId),
    readFlowMapLocalStore(nodeStore),
    readFlowMapLocalStore(dependencyStore),
  ]);
  if (!flowMap) return null;
  const nodes = allNodes.filter((node) => node.workspaceId === flowMapId);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const dependencies = allDependencies.filter((dependency) =>
    (dependency.workspaceId === flowMapId || (nodeIds.has(dependency.sourceNodeId) && nodeIds.has(dependency.targetNodeId))) &&
    nodeIds.has(dependency.sourceNodeId) &&
    nodeIds.has(dependency.targetNodeId));
  return { flowMap, nodes, dependencies };
};

const layoutEmbeddedFlowMapPreview = (nodes = [], { compact = false } = {}) => {
  const minWidth = 1000;
  const minHeight = 560;
  const maxWidth = 2600;
  const maxHeight = 1800;
  const paddingX = 88;
  const paddingY = 72;
  const nodeScale = compact ? 0.56 : 1;
  const gapX = compact ? 38 : 88;
  const gapY = compact ? 24 : 36;
  const raw = nodes.map((node, index) => {
    const rawX = Number.parseFloat(node.flowPosition?.x);
    const rawY = Number.parseFloat(node.flowPosition?.y);
    const width = flowMapPreviewNodeWidth(node) * nodeScale;
    const height = flowMapPreviewNodeHeight(node) * nodeScale;
    return {
      node,
      width,
      height,
      rawX: Number.isFinite(rawX) ? rawX : (index % 5) * 22,
      rawY: Number.isFinite(rawY) ? rawY : Math.floor(index / 5) * 24,
    };
  });
  const xValues = raw.map((item) => item.rawX);
  const yValues = raw.map((item) => item.rawY);
  const looksPercentBased = raw.length > 1 &&
    xValues.every((value) => value >= -5 && value <= 105) &&
    yValues.every((value) => value >= -5 && value <= 105);
  const coordinateScale = looksPercentBased ? 12 : 1;
  const scaled = raw.map((item) => ({
    ...item,
    scaledX: item.rawX * coordinateScale,
    scaledY: item.rawY * coordinateScale,
  }));
  const minX = Math.min(...scaled.map((item) => item.scaledX));
  const minY = Math.min(...scaled.map((item) => item.scaledY));
  const graphWidth = Math.max(...scaled.map((item) => item.scaledX + item.width)) - minX;
  const graphHeight = Math.max(...scaled.map((item) => item.scaledY + item.height)) - minY;
  const shrink = Math.min(1, (maxWidth - paddingX * 2) / Math.max(1, graphWidth), (maxHeight - paddingY * 2) / Math.max(1, graphHeight));
  const placed = scaled.map((item) => ({
    ...item,
    x: paddingX + (item.scaledX - minX) * shrink,
    y: paddingY + (item.scaledY - minY) * shrink,
    width: item.width * shrink,
    height: item.height,
    nodeScale: nodeScale * shrink,
  }));
  placed
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .forEach((item, index, list) => {
      for (let guard = 0; guard < 8; guard += 1) {
        const collision = list.slice(0, index).find((other) =>
          item.x < other.x + other.width + gapX &&
          item.x + item.width + gapX > other.x &&
          item.y < other.y + other.height + gapY &&
          item.y + item.height + gapY > other.y
        );
        if (!collision) break;
        item.x = collision.x + collision.width + gapX;
      }
    });
  const width = Math.ceil(Math.max(minWidth, Math.max(...placed.map((item) => item.x + item.width)) + paddingX));
  const height = Math.ceil(Math.max(minHeight, Math.max(...placed.map((item) => item.y + item.height)) + paddingY));
  return {
    width,
    height,
    nodes: placed,
  };
};

const flowMapPreviewDependencyPort = (dependency = {}, side = "out") =>
  side === "in"
    ? dependency.metadata?.targetPort || dependency.targetPort || dependency.channel || ""
    : dependency.metadata?.sourcePort || dependency.sourcePort || dependency.channel || "";

const flowMapPreviewPortAnchorY = (layoutNode = {}, side = "out", portName = "") => {
  const ports = flowMapPreviewPortsForNode(layoutNode.node, side);
  if (!ports.length || !portName || portName === "all") return layoutNode.y + layoutNode.height / 2;
  const index = ports.findIndex((port) => port.name === portName);
  if (index < 0) return layoutNode.y + layoutNode.height / 2;
  const visibleCount = Math.min(5, ports.length);
  const scale = Number.isFinite(Number(layoutNode.nodeScale)) ? Number(layoutNode.nodeScale) : 1;
  return layoutNode.y + (78 + Math.min(index, visibleCount - 1) * 20) * scale;
};

const setFlowMapPreviewZoom = (root, nextZoom = 1) => {
  const zoom = Math.max(0.45, Math.min(1.8, Number(nextZoom) || 1));
  const previousZoom = Number(root?.dataset.previewZoom || 1) || 1;
  const shell = root?.querySelector?.(".tl-flow-map-preview-zoom-shell");
  const canvas = root?.querySelector?.(".tl-flow-map-preview-canvas");
  const viewport = root?.querySelector?.(".tl-flow-map-preview-viewport");
  if (!shell || !canvas) return zoom;
  const width = Number.parseFloat(canvas.dataset.baseWidth || canvas.style.width || "1000") || 1000;
  const height = Number.parseFloat(canvas.dataset.baseHeight || canvas.style.height || "560") || 560;
  const centerX = viewport ? (viewport.scrollLeft + viewport.clientWidth / 2) / previousZoom : width / 2;
  const centerY = viewport ? (viewport.scrollTop + viewport.clientHeight / 2) / previousZoom : height / 2;
  shell.style.setProperty("--preview-zoom", String(zoom));
  shell.style.width = `${Math.ceil(width * zoom)}px`;
  shell.style.height = `${Math.ceil(height * zoom)}px`;
  if (viewport) {
    viewport.scrollLeft = Math.max(0, centerX * zoom - viewport.clientWidth / 2);
    viewport.scrollTop = Math.max(0, centerY * zoom - viewport.clientHeight / 2);
  }
  const label = root.querySelector("[data-flow-map-preview-zoom-label]");
  if (label) label.textContent = `${Math.round(zoom * 100)}%`;
  return zoom;
};

const renderEmbeddedFlowMapPreview = ({ nodes = [], dependencies = [] } = {}) => {
  if (!nodes.length) {
    return _.div(
      { class: "tl-flow-map-preview-empty" },
      icon("account_tree", "lg"),
      _.strong("Flow Map vuoto"),
      _.span("Non ci sono nodi da visualizzare.")
    );
  }
  const layout = layoutEmbeddedFlowMapPreview(nodes, { compact: true });
  const byId = new Map(layout.nodes.map((item) => [item.node.id, item]));
  const edges = dependencies.map((dependency) => {
    const source = byId.get(dependency.sourceNodeId);
    const target = byId.get(dependency.targetNodeId);
    if (!source || !target) return null;
    const x1 = source.x + source.width;
    const y1 = flowMapPreviewPortAnchorY(source, "out", flowMapPreviewDependencyPort(dependency, "out"));
    const x2 = target.x;
    const y2 = flowMapPreviewPortAnchorY(target, "in", flowMapPreviewDependencyPort(dependency, "in"));
    const bend = Math.max(44, Math.abs(x2 - x1) * 0.46);
    return { dependency, source, x1, y1, x2, y2, path: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}` };
  }).filter(Boolean);
  return _.div(
    { class: "tl-flow-map-preview-root" },
    _.div(
      { class: "tl-flow-map-preview-tools" },
      _.button({
        type: "button",
        class: "is-dense",
        dense: true,
        title: "Zoom out",
        "aria-label": "Zoom out",
        onclick: (event) => {
          const root = event.currentTarget.closest(".tl-flow-map-preview-root");
          const current = Number(root?.dataset.previewZoom || 1);
          root.dataset.previewZoom = String(setFlowMapPreviewZoom(root, current - 0.15));
        },
      }, icon("zoom_out", "md")),
      _.button({
        type: "button",
        class: "is-dense",
        dense: true,
        title: "Fit",
        "aria-label": "Fit",
        onclick: (event) => {
          const root = event.currentTarget.closest(".tl-flow-map-preview-root");
          const viewport = root?.querySelector?.(".tl-flow-map-preview-viewport");
          const canvas = root?.querySelector?.(".tl-flow-map-preview-canvas");
          const baseWidth = Number.parseFloat(canvas?.dataset.baseWidth || "0") || 1;
          const baseHeight = Number.parseFloat(canvas?.dataset.baseHeight || "0") || 1;
          const fit = Math.min(1, (viewport?.clientWidth || baseWidth) / baseWidth, (viewport?.clientHeight || baseHeight) / baseHeight);
          root.dataset.previewZoom = String(setFlowMapPreviewZoom(root, Math.max(0.45, fit)));
        },
      }, icon("center_focus_strong", "md")),
      _.button({
        type: "button",
        class: "is-dense",
        dense: true,
        title: "Zoom in",
        "aria-label": "Zoom in",
        onclick: (event) => {
          const root = event.currentTarget.closest(".tl-flow-map-preview-root");
          const current = Number(root?.dataset.previewZoom || 1);
          root.dataset.previewZoom = String(setFlowMapPreviewZoom(root, current + 0.15));
        },
      }, icon("zoom_in", "md")),
      _.span({ "data-flow-map-preview-zoom-label": "true" }, "100%")
    ),
    _.div(
      { class: "tl-flow-map-preview-viewport" },
      _.div(
        { class: "tl-flow-map-preview-zoom-shell", style: { width: `${layout.width}px`, height: `${layout.height}px` } },
        _.div(
          {
            class: "tl-flow-map-preview-canvas is-compact",
            "data-base-width": String(layout.width),
            "data-base-height": String(layout.height),
            style: { width: `${layout.width}px`, height: `${layout.height}px` },
          },
          _.svg(
            { class: "tl-flow-map-preview-edges", viewBox: `0 0 ${layout.width} ${layout.height}`, preserveAspectRatio: "none", "aria-hidden": "true" },
            ...edges.flatMap((edge) => [
              _.path({ d: edge.path, style: { "--preview-rgb": flowMapPreviewToneRgb(edge.source.node.metadata?.tone) } }),
              _.circle({ cx: edge.x2, cy: edge.y2, r: 3.5, style: { "--preview-rgb": flowMapPreviewToneRgb(edge.source.node.metadata?.tone) } }),
            ])
          ),
          _.div(
            { class: "tl-flow-map-preview-nodes" },
            ...layout.nodes.map(({ node, x, y, width, height }) => {
              const ports = flowMapPreviewNodePorts(node);
              const hasPorts = ports.in.length || ports.out.length;
              const renderPorts = (items, side) => _.div(
                { class: `tl-flow-map-preview-ports is-${side}` },
                ...items.slice(0, 5).map((port) => _.span(
                  { title: `${side === "in" ? "IN" : "OUT"} · ${port.name}` },
                  _.i(),
                  _.strong(port.name)
                )),
                items.length > 5 ? _.span({ class: "is-more" }, _.i(), _.strong(`+${items.length - 5} more`)) : null
              );
              return _.div(
                {
                  class: `tl-flow-map-preview-node${hasPorts ? " has-ports" : ""}`,
                  title: `${node.label || node.id} · ${flowMapPreviewNodeType(node)}`,
                  style: {
                    left: `${x}px`,
                    top: `${y}px`,
                    width: `${width}px`,
                    height: `${height}px`,
                    "--preview-rgb": flowMapPreviewToneRgb(node.metadata?.tone),
                  },
                },
                _.div(
                  { class: "tl-flow-map-preview-node-head" },
                  _.span({ class: "tl-flow-map-preview-node-icon" }, icon(node.metadata?.icon || "extension", "sm")),
                  _.span(
                    { class: "tl-flow-map-preview-node-copy" },
                    _.strong(node.label || node.id),
                    _.em(flowMapPreviewNodeType(node))
                  )
                ),
                hasPorts ? _.div(
                  { class: "tl-flow-map-preview-node-io" },
                  renderPorts(ports.in, "in"),
                  renderPorts(ports.out, "out")
                ) : null
              );
            })
          )
        )
      ),
    )
  );
};

const flowMapExportSafeName = (value = "flow-map") =>
  String(value || "flow-map").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "flow-map";

const drawFlowMapPreviewRoundRect = (context, x, y, width, height, radius = 8) => {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
};

const drawFlowMapPreviewText = (context, text = "", x = 0, y = 0, maxWidth = 100) => {
  const value = String(text || "");
  if (context.measureText(value).width <= maxWidth) {
    context.fillText(value, x, y);
    return;
  }
  let clipped = value;
  while (clipped.length > 1 && context.measureText(`${clipped}...`).width > maxWidth) clipped = clipped.slice(0, -1);
  context.fillText(`${clipped}...`, x, y);
};

const drawFlowMapPreviewGraphToCanvas = ({ canvas, graph = {}, title = "", scale = 2 } = {}) => {
  const nodes = graph.nodes || [];
  const dependencies = graph.dependencies || [];
  const layout = layoutEmbeddedFlowMapPreview(nodes);
  const headerHeight = 74;
  const width = layout.width;
  const height = layout.height + headerHeight;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext("2d");
  context.save();
  context.scale(scale, scale);
  context.fillStyle = "#071018";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#101722";
  context.fillRect(0, 0, width, headerHeight);
  context.fillStyle = "#f8fafc";
  context.font = "700 24px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  drawFlowMapPreviewText(context, title || graph.flowMap?.name || "Flow Map", 32, 32, width - 64);
  context.fillStyle = "rgba(203, 213, 225, 0.76)";
  context.font = "500 13px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  context.fillText(`${nodes.length} nodi · ${dependencies.length} collegamenti`, 32, 55);

  context.save();
  context.translate(0, headerHeight);
  context.fillStyle = "#030a10";
  context.fillRect(0, 0, layout.width, layout.height);
  context.fillStyle = "rgba(112, 205, 255, 0.105)";
  for (let x = 0; x <= layout.width; x += 16) {
    for (let y = 0; y <= layout.height; y += 16) {
      context.beginPath();
      context.arc(x, y, 1, 0, Math.PI * 2);
      context.fill();
    }
  }

  const byId = new Map(layout.nodes.map((item) => [item.node.id, item]));
  dependencies.forEach((dependency) => {
    const source = byId.get(dependency.sourceNodeId);
    const target = byId.get(dependency.targetNodeId);
    if (!source || !target) return;
    const rgb = flowMapPreviewToneRgb(source.node.metadata?.tone);
    const x1 = source.x + source.width;
    const y1 = flowMapPreviewPortAnchorY(source, "out", flowMapPreviewDependencyPort(dependency, "out"));
    const x2 = target.x;
    const y2 = flowMapPreviewPortAnchorY(target, "in", flowMapPreviewDependencyPort(dependency, "in"));
    const bend = Math.max(44, Math.abs(x2 - x1) * 0.46);
    context.strokeStyle = `rgb(${rgb})`;
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(x1, y1);
    context.bezierCurveTo(x1 + bend, y1, x2 - bend, y2, x2, y2);
    context.stroke();
    context.fillStyle = `rgb(${rgb})`;
    context.beginPath();
    context.arc(x2, y2, 4, 0, Math.PI * 2);
    context.fill();
  });

  layout.nodes.forEach(({ node, x, y, width: nodeWidth, height: nodeHeight }) => {
    const rgb = flowMapPreviewToneRgb(node.metadata?.tone);
    const ports = flowMapPreviewNodePorts(node);
    context.fillStyle = "#07111a";
    context.strokeStyle = `rgba(${rgb}, 0.82)`;
    context.lineWidth = 2;
    drawFlowMapPreviewRoundRect(context, x, y, nodeWidth, nodeHeight, 8);
    context.fill();
    context.stroke();
    context.fillStyle = `rgb(${rgb})`;
    context.fillRect(x, y + 8, 4, nodeHeight - 16);
    context.fillStyle = "#f8fafc";
    context.font = "700 13px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    drawFlowMapPreviewText(context, node.label || node.id, x + 14, y + 24, nodeWidth - 24);
    context.fillStyle = "rgba(203, 213, 225, 0.78)";
    context.font = "500 10px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    drawFlowMapPreviewText(context, flowMapPreviewNodeType(node), x + 14, y + 40, nodeWidth - 24);
    const drawPortRows = (items, side) => {
      items.slice(0, 5).forEach((port, index) => {
        const rowY = y + 73 + index * 20;
        const nameWidth = Math.max(40, Math.min(142, nodeWidth * 0.38));
        const dotX = side === "in" ? x + 13 : x + nodeWidth - 13;
        context.fillStyle = side === "in" ? "rgba(34, 197, 94, 0.9)" : "rgba(34, 211, 238, 0.9)";
        context.beginPath();
        context.arc(dotX, rowY - 4, 3, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "rgba(241, 245, 249, 0.9)";
        context.font = "600 9px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
        context.textAlign = side === "in" ? "left" : "right";
        drawFlowMapPreviewText(context, port.name, side === "in" ? dotX + 10 : dotX - 10, rowY, nameWidth);
        context.textAlign = "left";
      });
    };
    drawPortRows(ports.in, "in");
    drawPortRows(ports.out, "out");
  });
  context.restore();
  context.restore();
};

const exportFlowMapGraphAsJpg = async ({ graph = null, filename = "", title = "" } = {}) => {
  const fallbackTitle = typeof currentWorkspaceName === "function" ? currentWorkspaceName() : "Flow Map";
  const sourceGraph = graph || {
    flowMap: { name: fallbackTitle },
    nodes: state.runtime.nodes || [],
    dependencies: state.runtime.dependencies || [],
  };
  if (!sourceGraph.nodes?.length) {
    window.alert("Non ci sono nodi da esportare.");
    return;
  }
  const canvas = document.createElement("canvas");
  const exportTitle = title || sourceGraph.flowMap?.name || fallbackTitle;
  drawFlowMapPreviewGraphToCanvas({ canvas, graph: sourceGraph, title: exportTitle, scale: 2 });
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) throw new Error("Export JPG non riuscito.");
  const anchor = document.createElement("a");
  const url = URL.createObjectURL(blob);
  anchor.href = url;
  anchor.download = filename || `${flowMapExportSafeName(exportTitle || "flow-map")}.jpg`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

window.TrackerLensFlowMapPreview = {
  render: renderEmbeddedFlowMapPreview,
  exportJpg: exportFlowMapGraphAsJpg,
};

const openEmbeddedFlowMapPreviewDialog = async (aliasNode = {}) => {
  const flowMapId = aliasNode.metadata?.flowMapId || aliasNode.sourceRef || aliasNode.assetId || "";
  const graph = await loadEmbeddedFlowMapPreview(flowMapId).catch((error) => {
    console.warn("Errore preview Flow Map", error);
    return null;
  });
  if (!graph) {
    window.alert("Il Flow Map collegato non è più disponibile.");
    return;
  }
  const dialog = _.Dialog({
    class: "tl-flow-map-preview-dialog",
    panelClass: "tl-flow-map-preview-panel",
    size: "xl",
    title: graph.flowMap.name || aliasNode.label || "Flow Map",
    subtitle: `${graph.nodes.length} nodi · ${graph.dependencies.length} collegamenti · sola lettura`,
    icon: "account_tree",
    closeButton: true,
    content: () => renderEmbeddedFlowMapPreview(graph),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ class: "st-btn-primary", onclick: close }, "Chiudi")
    ),
  });
  dialog.open();
  requestAnimationFrame(() => {
    const root = document.querySelector(".tl-flow-map-preview-dialog .tl-flow-map-preview-root");
    const viewport = root?.querySelector?.(".tl-flow-map-preview-viewport");
    const canvas = root?.querySelector?.(".tl-flow-map-preview-canvas");
    const baseWidth = Number.parseFloat(canvas?.dataset.baseWidth || "0") || 1;
    const baseHeight = Number.parseFloat(canvas?.dataset.baseHeight || "0") || 1;
    const fit = Math.min(1, (viewport?.clientWidth || baseWidth) / baseWidth, (viewport?.clientHeight || baseHeight) / baseHeight);
    if (root) root.dataset.previewZoom = String(setFlowMapPreviewZoom(root, Math.max(0.45, fit)));
  });
};

const AI_AGENT_ALIAS_OVERRIDE_KEYS = [
  "name",
  "title",
  "description",
  "icon",
  "color",
  "category",
  "tags",
  "version",
  "status",
  "runtime",
  "provider",
  "channels",
  "promptConfig",
  "memory",
  "permissions",
  "debug",
  "metrics",
];

const isAiAliasPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const aiAliasClone = (value) => {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
};

const aiAliasValuesEqual = (a, b) => {
  try {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  } catch {
    return a === b;
  }
};

const aiAliasPickOverrideFields = (record = {}) =>
  Object.fromEntries(AI_AGENT_ALIAS_OVERRIDE_KEYS
    .filter((key) => record[key] !== undefined)
    .map((key) => [key, aiAliasClone(record[key])]));

const aiAliasDeepDiff = (nextValue, baseValue) => {
  if (aiAliasValuesEqual(nextValue, baseValue)) return undefined;
  if (isAiAliasPlainObject(nextValue) && isAiAliasPlainObject(baseValue)) {
    const diff = {};
    Object.keys(nextValue).forEach((key) => {
      const child = aiAliasDeepDiff(nextValue[key], baseValue[key]);
      if (child !== undefined) diff[key] = child;
    });
    return Object.keys(diff).length ? diff : undefined;
  }
  return aiAliasClone(nextValue);
};

const aiAliasOverridesFromPayload = (payload = {}, source = {}) => {
  const payloadComparable = aiAliasPickOverrideFields(payload);
  const sourceComparable = aiAliasPickOverrideFields(source);
  const diff = aiAliasDeepDiff(payloadComparable, sourceComparable);
  return diff && isAiAliasPlainObject(diff) ? diff : {};
};

const mergeAiAgentAliasOverrides = (source = {}, overrides = {}) => {
  const merge = (base, local) => {
    if (local === undefined) return aiAliasClone(base);
    if (isAiAliasPlainObject(base) && isAiAliasPlainObject(local)) {
      const result = { ...aiAliasClone(base) };
      Object.keys(local).forEach((key) => {
        result[key] = merge(base[key], local[key]);
      });
      return result;
    }
    return aiAliasClone(local);
  };
  return merge(source || {}, overrides || {});
};

const aiAgentAliasOverrides = (node = {}) =>
  isAiAliasPlainObject(node.metadata?.aliasOverrides)
    ? node.metadata.aliasOverrides
    : isAiAliasPlainObject(node.metadata?.config?.aliasOverrides)
      ? node.metadata.config.aliasOverrides
      : {};

const resolveAiAgentAliasNodes = async (nodes = []) => {
  const aliasNodes = nodes.filter((node) => node.type === "aiAgent" && node.metadata?.aiAgentAlias);
  if (!aliasNodes.length) return nodes;
  try {
    const data = await window.TrackerLensAiRuntimeStore?.list?.();
    const agentsById = new Map((data?.agents || []).map((agent) => [agent.id, agent]));
    return nodes.map((node) => {
      if (node.type !== "aiAgent" || !node.metadata?.aiAgentAlias) return node;
      const sourceId = node.metadata?.aliasSourceAgentId || node.metadata?.config?.aliasSourceAgentId || "";
      const agent = agentsById.get(sourceId);
      if (!agent) return node;
      const resolvedAgent = mergeAiAgentAliasOverrides(agent, aiAgentAliasOverrides(node));
      const { agentType, inputChannels, outputChannel } = aiAgentChannelsForRecord(resolvedAgent);
      const agentRuntime = resolvedAgent.runtime || {};
      const permissionFlags = normalizeAiAgentPermissionFlags(resolvedAgent.permissions);
      const permissions = normalizeAssetPermissions(permissionFlags);
      return {
        ...node,
        label: resolvedAgent.name || node.label,
        status: resolvedAgent.status || node.status || "active",
        inputs: inputChannels.slice(0, 1),
        outputs: [outputChannel].filter(Boolean),
        channels: [...new Set([...inputChannels.slice(0, 1), outputChannel].filter(Boolean))],
        runtime: {
          ...(node.runtime || {}),
          status: resolvedAgent.status || node.runtime?.status || "active",
          active: resolvedAgent.status !== "paused" && resolvedAgent.status !== "disabled",
        },
        metadata: {
          ...(node.metadata || {}),
          icon: resolvedAgent.icon || node.metadata?.icon || "psychology",
          subtype: agentType,
          agentRole: agentType,
          aliasSourceScope: agent.scope || node.metadata?.aliasSourceScope || "template",
          templateId: agent.scope === "runtime" ? agent.templateId || sourceId : sourceId,
          runtimeStatus: resolvedAgent.status || node.metadata?.runtimeStatus || "active",
          manifest: nodeManifest({
            type: "aiAgent",
            subtype: agentType,
            category: "ai-agents",
            inputs: inputChannels.slice(0, 1),
            outputs: [outputChannel].filter(Boolean),
            permissions,
            runtime: resolvedAgent.runtime || {},
          }),
          permissions,
          config: {
            ...(node.metadata?.config || {}),
            ...aiAgentPayloadConfig(resolvedAgent),
            aliasSourceAgentId: sourceId,
            aliasSourceScope: agent.scope || node.metadata?.aliasSourceScope || "template",
            templateId: agent.scope === "runtime" ? agent.templateId || sourceId : sourceId,
            agentType,
            executionMode: agentRuntime.executionMode || "on_event",
            output: outputChannel,
            inputChannels: inputChannels.join(", "),
          },
          runtimeMetadata: agentRuntime,
        },
      };
    });
  } catch (error) {
    console.warn("Alias AI Agent non sincronizzati in Flow Map", error);
    return nodes;
  }
};

const safeRuntimeId = (value = "") =>
  String(value || "asset").replace(/[^A-Za-z0-9_-]/g, "_");

const assetRuntimeChannels = (asset = {}, kind = "boxTracker") => {
  const focused = state.filters.channel !== "all" ? state.filters.channel : state.focus.channel || "";
  const channel = kind === "boxLens"
    ? focused || asset.outputChannel || "default"
    : asset.outputChannel || focused || "default";
  return [channel].filter(Boolean);
};

const normalizeAssetPermissions = (permissions) => {
  if (Array.isArray(permissions)) return permissions;
  if (permissions && typeof permissions === "object") return Object.keys(permissions).filter((key) => permissions[key]);
  return [];
};

const materializeLibraryAssetNode = async ({ asset, kind = "boxTracker", flowPosition = null, close = null } = {}) => {
  if (!asset?.id) return;
  const workspaceId = await ensureRuntimeWorkspaceScope();
  const now = new Date().toISOString();
  const channels = assetRuntimeChannels(asset, kind);
  const permissions = normalizeAssetPermissions(asset.permissions);
  const node = {
    id: `${kind}_${safeRuntimeId(asset.id)}_${Date.now()}`,
    workspaceId,
    type: kind,
    label: asset.name || (kind === "boxTracker" ? "Box Tracker" : "Box Lens"),
    sourceRef: asset.sourceId || asset.id,
    assetId: asset.id,
    inputs: kind === "boxLens" ? channels : ["raw"],
    outputs: kind === "boxTracker" ? channels : [],
    channels,
    status: "active",
    position: { x: 1, y: 1 },
    flowPosition: flowPosition || defaultAssetFlowPosition(),
    metadata: {
      configured: true,
      draft: false,
      libraryAsset: true,
      paletteLabel: kind === "boxTracker" ? "Existing Tracker" : "Existing Lens",
      tone: kind === "boxTracker" ? "orange" : "blue",
      icon: asset.icon || (kind === "boxTracker" ? "inventory_2" : "dashboard"),
      runtimeType: kind === "boxLens" ? "lens" : "boxTracker",
      subtype: "existing",
      category: kind === "boxLens" ? "lens" : "trackers",
      assetName: asset.name || "",
      assetVersion: asset.version || "",
      sampleOutput: asset.sampleOutput && typeof asset.sampleOutput === "object" ? asset.sampleOutput : {},
      outputChannel: asset.outputChannel || channels[0] || "default",
      config: {
        source: asset.source || "",
        trackerType: asset.trackerType || "",
        runtimeMode: asset.runtimeMode || "",
        endpoint: asset.endpoint || "",
        method: asset.method || "",
        displayPath: kind === "boxLens" ? "payload.value" : "",
      },
      manifest: {
        type: kind === "boxLens" ? "lens" : "boxTracker",
        subtype: "existing",
        category: kind === "boxLens" ? "lens" : "trackers",
        inputs: kind === "boxLens" ? channels : ["raw"],
        outputs: kind === "boxTracker" ? channels : [],
        permissions,
        runtime: asset.runtime || {},
      },
      permissions,
      runtimeMetadata: asset.runtime || {},
    },
    createdAt: now,
    updatedAt: now,
  };

  await window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode?.({ node });
  if (window.TrackerLensChannelRegistry?.upsertChannelsForRuntimeNode) {
    await window.TrackerLensChannelRegistry.upsertChannelsForRuntimeNode({ node });
  }
  await recordFlowAction({
    workspaceId,
    nodeId: node.id,
    message: `Library asset inserted in Flow Map: ${node.label}`,
    context: {
      action: "library-asset-inserted",
      assetId: asset.id,
      nodeType: kind,
      channels,
    },
  });
  close?.();
  setFocusState({
    mode: "dependencies",
    nodeId: node.id,
    edgeId: "",
    nodeType: node.type,
    channel: channels[0] || "",
    connectionId: "",
  });
  await loadRuntime({ force: true });
};

const materializeFlowMapNode = async ({ flowMap, flowPosition = null, close = null } = {}) => {
  if (!flowMap?.id) return false;
  const currentFlowMap = await refreshAvailableFlowMap(flowMap.id).catch((error) => {
    console.warn("Errore verifica Flow Map selezionato", error);
    return null;
  });
  if (!currentFlowMap) {
    window.alert("Il Flow Map selezionato non è più disponibile.");
    return false;
  }
  if (!currentFlowMap.hasInput && !currentFlowMap.hasOutput) {
    window.alert("Non è possibile inserire un Flow Map che non contiene almeno un nodo Flow In o Flow Out.");
    return false;
  }
  flowMap = currentFlowMap;
  const workspaceId = await ensureRuntimeWorkspaceScope();
  const now = new Date().toISOString();
  const inputs = flowMap.hasInput ? (flowMap.inputPorts?.length ? flowMap.inputPorts : [{ name: "flow.in", type: "object" }]) : [];
  const outputs = flowMap.hasOutput ? (flowMap.outputPorts?.length ? flowMap.outputPorts : [{ name: "flow.out", type: "object" }]) : [];
  const inputNames = inputs.map((port) => port.name || port).filter(Boolean);
  const outputNames = outputs.map((port) => port.name || port).filter(Boolean);
  const node = {
    id: `flowmap_${safeRuntimeId(flowMap.id)}_${Date.now()}`,
    workspaceId,
    type: "flowMap",
    label: flowMap.name || "Flow Map",
    sourceRef: flowMap.id,
    assetId: flowMap.id,
    inputs,
    outputs,
    channels: [...new Set([...inputNames, ...outputNames])],
    status: "active",
    position: { x: 1, y: 1 },
    flowPosition: flowPosition || defaultAssetFlowPosition(),
    metadata: {
      configured: true,
      draft: false,
      embeddedFlowMap: true,
      paletteLabel: "Flow Map",
      tone: "blue",
      icon: "account_tree",
      runtimeType: "flowMap",
      subtype: "existing",
      category: "flow-maps",
      flowMapId: flowMap.id,
      flowMapName: flowMap.name || "",
      version: flowMap.version || "0.1.0",
      hasInput: Boolean(flowMap.hasInput),
      hasOutput: Boolean(flowMap.hasOutput),
      inputPorts: inputs,
      outputPorts: outputs,
      config: {
        flowMapId: flowMap.id,
        inputPort: inputNames[0] || "",
        outputPort: outputNames[0] || "",
      },
      manifest: {
        type: "flowMap",
        subtype: "existing",
        category: "flow-maps",
        inputs,
        outputs,
        permissions: ["flow.invoke"],
      },
      permissions: ["flow.invoke"],
    },
    createdAt: now,
    updatedAt: now,
  };

  await window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode?.({ node });
  if (window.TrackerLensChannelRegistry?.upsertChannelsForRuntimeNode) {
    await window.TrackerLensChannelRegistry.upsertChannelsForRuntimeNode({ node });
  }
  await recordFlowAction({
    workspaceId,
    nodeId: node.id,
    message: `Embedded Flow Map inserted: ${node.label}`,
    context: {
      action: "flowmap-inserted",
      flowMapId: flowMap.id,
      hasInput: flowMap.hasInput,
      hasOutput: flowMap.hasOutput,
    },
  });
  close?.();
  setFocusState({
    mode: "dependencies",
    nodeId: node.id,
    edgeId: "",
    nodeType: node.type,
    channel: inputs[0] || outputs[0] || "",
    connectionId: "",
  });
  await loadRuntime({ force: true });
  return true;
};

const normalizeAiAgentPermissionFlags = (permissions = {}) => Array.isArray(permissions)
  ? Object.fromEntries(permissions.map((key) => [key, true]))
  : permissions && typeof permissions === "object"
    ? permissions
    : {};

const aiAgentChannelsForRecord = (agent = {}) => {
  const agentType = agent.runtime?.agentType || "analyzer";
  const inputChannels = Array.isArray(agent.channels?.inputs) && agent.channels.inputs.length
    ? agent.channels.inputs
    : ["task"];
  const normalizedInputs = inputChannels.map((channel) =>
    String(channel || "").trim().toLowerCase() === "input" ? "task" : channel);
  const outputChannel = agent.channels?.outputChannel || agent.channels?.outputs?.[0] || `ai.${agentType}.output`;
  return { agentType, inputChannels: normalizedInputs, outputChannel };
};

const materializeAiAgentNode = async ({ agent, flowPosition = null, close = null, mode = "alias" } = {}) => {
  if (!agent?.id) return;
  const workspaceId = await ensureRuntimeWorkspaceScope();
  const now = new Date().toISOString();
  const { agentType, inputChannels, outputChannel } = aiAgentChannelsForRecord(agent);
  const isAlias = mode !== "duplicate";
  const runtimeAgentId = isAlias ? "" : `runtime_agent_${safeRuntimeId(workspaceId)}_${safeRuntimeId(agent.id)}_${Date.now()}`;
  const permissionFlags = normalizeAiAgentPermissionFlags(agent.permissions);
  const permissions = normalizeAssetPermissions(permissionFlags);
  const runtimeAgent = !isAlias ? {
    ...(agent.raw && typeof agent.raw === "object" ? agent.raw : {}),
    ...agent,
    id: runtimeAgentId,
    scope: "runtime",
    kind: "runtime",
    workspaceId,
    templateId: agent.scope === "runtime" ? agent.templateId || agent.id : agent.id,
    status: agent.status || "active",
    permissions: permissionFlags,
  } : null;
  const node = {
    id: `aiAgent_${safeRuntimeId(agent.id)}_${Date.now()}`,
    workspaceId,
    type: "aiAgent",
    label: agent.name || "AI Agent",
    sourceRef: agent.id,
    assetId: agent.id,
    inputs: inputChannels.slice(0, 1),
    outputs: [outputChannel].filter(Boolean),
    channels: [...new Set([...inputChannels.slice(0, 1), outputChannel].filter(Boolean))],
    status: agent.status || "active",
    position: { x: 1, y: 1 },
    flowPosition: flowPosition || defaultAssetFlowPosition(),
    runtime: {
      status: agent.status || "active",
      active: agent.status !== "paused" && agent.status !== "disabled",
    },
    metadata: {
      configured: true,
      draft: false,
      savedAiAgent: true,
      aiAgentAlias: isAlias,
      aliasOverrides: {},
      aliasSourceAgentId: isAlias ? agent.id : "",
      aliasSourceScope: isAlias ? agent.scope || "template" : "",
      detachedFromAgentId: "",
      paletteLabel: isAlias ? "Existing Agent Alias" : "Existing Agent Copy",
      tone: "gold",
      icon: agent.icon || "psychology",
      runtimeType: "aiAgent",
      subtype: agentType,
      category: "ai-agents",
      agentRole: agentType,
      runtimeAgentId: runtimeAgentId || "",
      templateId: isAlias ? agent.id : runtimeAgent.templateId || "",
      config: isAlias
        ? {
          aliasSourceAgentId: agent.id,
          aliasSourceScope: agent.scope || "template",
          aliasOverrides: {},
          templateId: agent.id,
          linked: "alias",
          agentType,
          executionMode: agent.runtime?.executionMode || "on_event",
          output: outputChannel,
          inputChannels: inputChannels.join(", "),
        }
        : {
          ...aiAgentPayloadConfig(runtimeAgent),
          runtimeAgentId,
          templateId: runtimeAgent.templateId || "",
        },
      manifest: nodeManifest({
        type: "aiAgent",
        subtype: agentType,
        category: "ai-agents",
        inputs: inputChannels.slice(0, 1),
        outputs: [outputChannel].filter(Boolean),
        permissions,
        runtime: agent.runtime || {},
      }),
      permissions,
      runtimeMetadata: agent.runtime || {},
    },
    createdAt: now,
    updatedAt: now,
  };

  if (runtimeAgent) {
    await window.TrackerLensAiRuntimeStore?.upsertRuntimeAgent?.({
      ...runtimeAgent,
      runtimeNodeId: node.id,
    });
  }
  await window.TrackerLensRuntimeGraphStore?.upsertRuntimeNode?.({ node });
  if (window.TrackerLensChannelRegistry?.upsertChannelsForRuntimeNode) {
    await window.TrackerLensChannelRegistry.upsertChannelsForRuntimeNode({ node });
  }
  await recordFlowAction({
    workspaceId,
    nodeId: node.id,
    message: `AI agent ${isAlias ? "alias" : "copy"} inserted in Flow Map: ${node.label}`,
    context: {
      action: isAlias ? "ai-agent-alias-inserted" : "ai-agent-copy-inserted",
      agentId: agent.id,
      runtimeAgentId: runtimeAgentId || "",
      nodeType: "aiAgent",
      channels: node.channels,
    },
  });
  close?.();
  setFocusState({
    mode: "dependencies",
    nodeId: node.id,
    edgeId: "",
    nodeType: node.type,
    channel: outputChannel || inputChannels[0] || "",
    connectionId: "",
  });
  await loadRuntime({ force: true });
};

const openExistingAiAgentsDialog = async (options = {}) => {
  const agents = await listExistingAiAgents();
  let dialog = null;
  dialog = _.Dialog({
    class: "tl-flow-library-dialog",
    panelClass: "tl-flow-edge-delete-panel",
    size: "lg",
    title: "Existing Agents",
    subtitle: "Scegli un AI Agent salvato da inserire nel runtime graph.",
    icon: "psychology",
    closeButton: true,
    content: () => _.div(
      { class: "tl-flow-library-picker" },
      agents.length
        ? _.div(
          { class: "tl-flow-library-list" },
          ...agents.map((agent) => {
            const agentType = agent.runtime?.agentType || agent.scope || "agent";
            const output = agent.channels?.outputChannel || agent.channels?.outputs?.[0] || `ai.${agentType}.output`;
            return _.div(
              {
                class: "tl-flow-library-asset",
              },
              _.span({ class: "tl-flow-library-asset-icon" }, icon(agent.icon || "psychology", "sm")),
              _.span(
                { class: "tl-flow-library-asset-main" },
                _.strong(agent.name || agent.id),
                _.em(`${agent.scope === "runtime" ? "Runtime Instance" : "Library Template"} · ${agentType} · ${output}`),
                _.small(agent.description || "Agente AI runtime salvato.")
              ),
              _.span(
                { class: "tl-flow-library-asset-actions" },
                btn({
                  class: "tl-flow-library-asset-action",
                  onclick: () => materializeAiAgentNode({
                    agent,
                    flowPosition: options.flowPosition || defaultAssetFlowPosition(),
                    close: () => dialog?.close?.(),
                    mode: "alias",
                  }),
                }, icon("link", "sm"), "Insert Alias"),
                btn({
                  class: "tl-flow-library-duplicate",
                  onclick: (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    materializeAiAgentNode({
                      agent,
                      flowPosition: options.flowPosition || defaultAssetFlowPosition(),
                      close: () => dialog?.close?.(),
                      mode: "duplicate",
                    });
                  },
                }, icon("content_copy", "sm"), "Duplicate")
              )
            );
          })
        )
        : _.div(
          { class: "tl-flow-library-empty" },
          icon("psychology", "md"),
          _.strong("Nessun AI Agent salvato."),
          _.span("Crea e salva un agent da AI Runtime Center, poi torna nella Flow Map.")
        )
    ),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: close }, "Close"),
      btn({ class: "st-btn-primary", onclick: () => window.location.assign("ai.html") }, icon("add", "sm"), "AI Runtime Center")
    ),
  });
  dialog.open();
};

const openExistingFlowMapDialog = async (options = {}) => {
  const flowMaps = await listAvailableFlowMaps().catch((error) => {
    console.warn("Errore lettura Flow Map disponibili", error);
    return [];
  });
  let selectedFlowMapId = "";
  let isInserting = false;
  let dialog = null;
  dialog = _.Dialog({
    class: "tl-flow-library-dialog",
    panelClass: "tl-flow-edge-delete-panel",
    size: "lg",
    title: "Flow Map",
    subtitle: "Seleziona un Flow Map, poi conferma con Inserisci.",
    icon: "account_tree",
    closeButton: true,
    content: () => _.div(
      { class: "tl-flow-library-picker" },
      flowMaps.length
        ? _.div(
          { class: "tl-flow-library-list" },
          ...flowMaps.map((flowMap) => _.button(
            {
              type: "button",
              class: `tl-flow-library-asset tl-flow-map-choice${flowMap.hasInput || flowMap.hasOutput ? "" : " is-incompatible"}`,
              "aria-pressed": "false",
              onclick: (event) => {
                selectedFlowMapId = flowMap.id;
                const choice = event.currentTarget;
                choice.closest(".tl-flow-library-list")?.querySelectorAll(".tl-flow-map-choice").forEach((item) => {
                  const selected = item === choice;
                  item.classList.toggle("is-selected", selected);
                  item.setAttribute("aria-pressed", String(selected));
                });
              },
            },
            _.span({ class: "tl-flow-library-asset-icon" }, icon("account_tree", "sm")),
            _.span(
              { class: "tl-flow-library-asset-main" },
              _.strong(flowMap.name || flowMap.id),
              _.em(`${flowMap.category || "global"} · ${flowMap.hasInput || flowMap.hasOutput ? `${flowMap.hasInput ? "IN" : ""}${flowMap.hasInput && flowMap.hasOutput ? " / " : ""}${flowMap.hasOutput ? "OUT" : ""}` : "Nessun IN / OUT"} · v${flowMap.version || "0.1.0"}`),
              _.small(flowMap.description || "Flow Map locale componibile.")
            ),
            _.span(
              { class: "tl-flow-library-asset-action" },
              icon(flowMap.hasInput || flowMap.hasOutput ? "check_circle" : "warning", "sm"),
              flowMap.hasInput || flowMap.hasOutput ? "Seleziona" : "Non compatibile"
            )
          ))
        )
        : _.div(
          { class: "tl-flow-library-empty" },
          icon("account_tree", "md"),
          _.strong("Nessun Flow Map disponibile."),
          _.span("Crea un Flow Map nella Library Flow Map, poi torna qui.")
        )
    ),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: close }, "Chiudi"),
      btn({ onclick: () => window.location.assign("libraryFlowmap.html") }, icon("account_tree", "sm"), "Library Flow Map"),
      btn({
        class: "st-btn-primary",
        onclick: async () => {
          if (isInserting) return;
          if (!selectedFlowMapId) {
            window.alert("Seleziona prima un Flow Map da inserire.");
            return;
          }
          const selectedFlowMap = flowMaps.find((flowMap) => flowMap.id === selectedFlowMapId);
          if (!selectedFlowMap) {
            window.alert("Il Flow Map selezionato non è più disponibile.");
            return;
          }
          isInserting = true;
          try {
            await materializeFlowMapNode({
              flowMap: selectedFlowMap,
              flowPosition: options.flowPosition || defaultAssetFlowPosition(),
              close: () => dialog?.close?.(),
            });
          } finally {
            isInserting = false;
          }
        },
      }, icon("add_circle", "sm"), "Inserisci")
    ),
  });
  dialog.open();
};

const openExistingLibraryDialog = async (item, options = {}) => {
  if (isExistingAiAgentPaletteItem(item)) {
    openExistingAiAgentsDialog(options);
    return;
  }
  const kind = libraryAssetKindForPalette(item);
  const assets = await listExistingLibraryAssets(kind);
  const title = kind === "boxTracker" ? "Existing Trackers" : "Existing Lens";
  const subtitle = kind === "boxTracker"
    ? "Scegli un boxTracker salvato da inserire nel runtime graph."
    : "Scegli un boxLens salvato da inserire nel runtime graph.";
  const emptyText = kind === "boxTracker"
    ? "Nessun boxTracker salvato nella Local Library."
    : "Nessun boxLens salvato nella Local Library.";
  let dialog = null;
  dialog = _.Dialog({
    class: "tl-flow-library-dialog",
    panelClass: "tl-flow-edge-delete-panel",
    size: "lg",
    title,
    subtitle,
    icon: kind === "boxTracker" ? "inventory_2" : "dashboard",
    closeButton: true,
    content: () => _.div(
      { class: "tl-flow-library-picker" },
      assets.length
        ? _.div(
          { class: "tl-flow-library-list" },
          ...assets.map((asset) => _.button(
            {
              type: "button",
              class: "tl-flow-library-asset",
              onclick: () => materializeLibraryAssetNode({
                asset,
                kind,
                flowPosition: options.flowPosition || defaultAssetFlowPosition(),
                close: () => dialog?.close?.(),
              }),
            },
            _.span({ class: "tl-flow-library-asset-icon" }, icon(asset.icon || (kind === "boxTracker" ? "storage" : "dashboard"), "sm")),
            _.span(
              { class: "tl-flow-library-asset-main" },
              _.strong(asset.name || asset.id),
              _.em(`${asset.category || kind} · ${asset.outputChannel || "default"} · v${asset.version || "0.1.0"}`),
              _.small(asset.description || "Nessuna descrizione disponibile.")
            ),
            _.span({ class: "tl-flow-library-asset-action" }, icon("add_circle", "sm"), "Insert")
          ))
        )
        : _.div(
          { class: "tl-flow-library-empty" },
          icon(kind === "boxTracker" ? "inventory_2" : "dashboard", "md"),
          _.strong(emptyText),
          _.span("Crea e salva un asset dalla Library o dagli editor dedicati, poi torna nella Flow Map.")
        )
    ),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: close }, "Close"),
      btn({
        class: "st-btn-primary",
        onclick: () => {
          if (window.TrackerLensBoxEditorDialog?.open) {
            window.TrackerLensBoxEditorDialog.open({
              type: kind === "boxTracker" ? "boxTracker" : "boxLens",
              workspaceId: state.filters.workspaceId || "workspace_global",
              channel: state.filters.channel !== "all" ? state.filters.channel : state.focus.channel || "",
              onSave: async () => {
                await loadRuntime({ force: true, silent: true });
              },
            });
            return;
          }
          CMSwift.notify?.error?.("Editor universale non disponibile.");
        },
      }, icon("add", "sm"), kind === "boxTracker" ? "New Tracker" : "New Lens")
    ),
  });
  dialog.open();
};

const beginNodeDrag = (event, node, index) => {
  if (event.button !== 0 || event.ctrlKey) return;
  if (event.target.closest?.("button, input, textarea, select, a, [contenteditable='true'], .tl-flow-context-menu")) return;
  event.preventDefault();
  event.stopPropagation();
  bringNodeToFront(node.id);
  const canvas = event.currentTarget.closest(".tl-flow-canvas");
  const current = nodePosition(node, index);
  const pointer = pointerPercent(event, canvas);
  const groupNodes = event.shiftKey ? descendantDragNodes(node) : [node];
  const groupPositions = Object.fromEntries(groupNodes.map((item) => {
    const itemIndex = state.runtime.nodes.findIndex((runtimeNode) => runtimeNode.id === item.id);
    const position = nodePosition(item, itemIndex);
    return [item.id, {
      node: item,
      x: flowPositionNumber(position, "x"),
      y: flowPositionNumber(position, "y"),
      width: flowPositionWidth(position),
    }];
  }));
  state.interaction = {
    type: "node",
    nodeId: node.id,
    workspaceId: node.workspaceId || "",
    canvas,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
    offset: { x: pointer.x - parseFloat(current.x), y: pointer.y - parseFloat(current.y) },
    startPosition: {
      x: flowPositionNumber(current, "x"),
      y: flowPositionNumber(current, "y"),
      width: flowPositionWidth(current),
    },
    groupPositions,
  };
  document.addEventListener("pointermove", handlePointerMove);
  document.addEventListener("pointerup", endInteraction, { once: true });
  document.addEventListener("pointercancel", endInteraction, { once: true });
};

const descendantDragNodes = (node = {}) => {
  if (!node?.id) return [];
  const nodesById = new Map((state.runtime.nodes || []).map((item) => [item.id, item]));
  const outgoingBySource = new Map();
  (state.runtime.dependencies || []).forEach((dependency) => {
    if (!dependency.sourceNodeId || !dependency.targetNodeId || dependency.sourceNodeId === dependency.targetNodeId) return;
    if (!outgoingBySource.has(dependency.sourceNodeId)) outgoingBySource.set(dependency.sourceNodeId, []);
    outgoingBySource.get(dependency.sourceNodeId).push(dependency.targetNodeId);
  });
  const result = [];
  const visited = new Set();
  const queue = [node.id];
  while (queue.length) {
    const nodeId = queue.shift();
    if (!nodeId || visited.has(nodeId)) continue;
    visited.add(nodeId);
    const item = nodesById.get(nodeId);
    if (item) result.push(item);
    (outgoingBySource.get(nodeId) || []).forEach((childId) => {
      if (!visited.has(childId)) queue.push(childId);
    });
  }
  return result.length ? result : [node];
};

const beginNodeResize = (event, node, index) => {
  event.preventDefault();
  event.stopPropagation();
  bringNodeToFront(node.id);
  const position = nodePosition(node, index);
  state.interaction = {
    type: "node-resize",
    nodeId: node.id,
    workspaceId: node.workspaceId || "",
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
    startWidth: flowPositionWidth(position),
    position: {
      x: flowPositionNumber(position, "x"),
      y: flowPositionNumber(position, "y"),
    },
  };
  document.addEventListener("pointermove", handlePointerMove);
  document.addEventListener("pointerup", endInteraction, { once: true });
  document.addEventListener("pointercancel", endInteraction, { once: true });
};

const beginPortLinkDrag = (event, node, index, side = "out", port = "all") => {
  const isAgentControlHandle = String(port || "") === "agent_control" || String(event.currentTarget?.dataset?.portType || "") === "agent-control";
  if ((side !== "out" && !isAgentControlHandle) || event.button !== 0) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const canvas = event.currentTarget.closest(".tl-flow-canvas");
  const sourceCorner = event.currentTarget?.dataset?.portCorner || "";
  state.linkingSourceId = node.id;
  state.linkingPort = port || "all";
  state.interaction = {
    type: "link",
    sourceId: node.id,
    sourceIndex: index,
    sourcePort: port || "all",
    sourceSide: side,
    sourceCorner,
    canvas,
    point: pointerPercent(event, canvas),
  };
  document.body.classList.add("is-flow-link-dragging");
  setNodeLinkClass(node.id, "is-link-source", true);
  updatePortCompatibilityHints(node, state.linkingPort || "all");
  document.addEventListener("pointermove", handlePointerMove);
  document.addEventListener("pointerup", endInteraction, { once: true });
  document.addEventListener("pointercancel", endInteraction, { once: true });
  renderFlowEdges();
};

const setNodeLinkClass = (nodeId, className, enabled) => {
  const element = document.querySelector(`[data-flow-node-id="${escapeSelectorValue(nodeId)}"]`);
  element?.classList?.toggle?.(className, Boolean(enabled));
};

const clearPortCompatibilityHints = () => {
  document.querySelectorAll(".tl-flow-node-port.is-port-compatible, .tl-flow-node-port.is-port-blocked").forEach((port) => {
    port.classList.remove("is-port-compatible", "is-port-blocked");
  });
};

const updatePortCompatibilityHints = (source = null, sourcePortName = "all") => {
  clearPortCompatibilityHints();
  if (!source?.id) return;
  state.runtime.nodes
    .filter((target) => target.id !== source.id)
    .forEach((target) => {
      nodePorts(target, "in").forEach((targetPort) => {
        const validation = connectionValidation(source, target, sourcePortName, targetPort.name);
        const selector = `.tl-flow-node[data-flow-node-id="${escapeSelectorValue(target.id)}"] .tl-flow-node-port.is-input[data-port-label="${escapeSelectorValue(targetPort.name)}"]`;
        document.querySelectorAll(selector).forEach((element) => {
          element.classList.add(validation.ok ? "is-port-compatible" : "is-port-blocked");
        });
      });
    });
};

const clearLinkDomState = () => {
  document.body.classList.remove("is-flow-link-dragging");
  document.querySelectorAll(".tl-flow-node.is-link-source, .tl-flow-node.is-link-hover, .tl-flow-node.is-link-target").forEach((node) => {
    node.classList.remove("is-link-source", "is-link-hover", "is-link-target", "is-link-invalid");
  });
  document.querySelectorAll(".tl-flow-node-port.is-port-hover, .tl-flow-node-port.is-port-invalid").forEach((port) => port.classList.remove("is-port-hover", "is-port-invalid"));
  clearPortCompatibilityHints();
  state.linkHoverTargetId = "";
  state.linkHoverPort = "";
  state.linkValidation = null;
};

const canConnectNodes = (source, target, sourcePort = "", targetPort = "") => {
  return connectionValidation(source, target, sourcePort || "all", targetPort || "all").ok;
};

const bestCompatibleTargetPortForLink = (source, target, sourcePortName = "all") => {
  if (!source?.id || !target?.id) return "all";
  const sourcePort = sourcePortName || "all";
  const targetPorts = nodePorts(target, "in");
  if (!targetPorts.length) return "all";
  const targetChannel = channelForPortConnection(source, target, sourcePort, "");
  const preferred = targetPorts.find((port) => port.name === targetChannel);
  if (preferred && connectionValidation(source, target, sourcePort, preferred.name).ok) return preferred.name;
  const allPort = targetPorts.find((port) => port.name === "all");
  if (allPort && connectionValidation(source, target, sourcePort, allPort.name).ok) return allPort.name;
  const compatible = targetPorts.find((port) => connectionValidation(source, target, sourcePort, port.name).ok);
  return compatible?.name || preferred?.name || allPort?.name || targetPorts[0]?.name || "all";
};

const compatiblePortTargets = (source, sourcePortName = "all") =>
  state.runtime.nodes
    .filter((target) => target.id !== source?.id)
    .flatMap((target) => nodePorts(target, "in").map((targetPort) => ({
      node: target,
      port: targetPort,
      validation: connectionValidation(source, target, sourcePortName, targetPort.name),
    })))
    .filter((item) => item.validation.ok)
    .slice(0, 8);

const compatiblePortSources = (target, targetPortName = "all") =>
  state.runtime.nodes
    .filter((source) => source.id !== target?.id)
    .flatMap((source) => nodePorts(source, "out").map((sourcePort) => ({
      node: source,
      port: sourcePort,
      validation: connectionValidation(source, target, sourcePort.name, targetPortName),
    })))
    .filter((item) => item.validation.ok)
    .slice(0, 8);

const nearestInputPortElement = (targetElement, event) => {
  const explicit = targetElement?.closest?.(".tl-flow-node-port.is-input");
  if (explicit) return explicit;
  const node = targetElement?.closest?.(".tl-flow-node");
  if (!node) return null;
  let best = { element: null, distance: Infinity };
  node.querySelectorAll(".tl-flow-node-port.is-input").forEach((port) => {
    const rect = port.getBoundingClientRect();
    const distance = Math.hypot(event.clientX - (rect.left + rect.width / 2), event.clientY - (rect.top + rect.height / 2));
    if (distance < best.distance) best = { element: port, distance };
  });
  return best.element;
};

const nodeElementAtPoint = (event, sourceId = "") => {
  const elements = typeof document.elementsFromPoint === "function"
    ? document.elementsFromPoint(event.clientX, event.clientY)
    : [document.elementFromPoint(event.clientX, event.clientY)].filter(Boolean);
  const direct = elements
    .map((element) => element?.closest?.(".tl-flow-node"))
    .find((element) => element?.dataset?.flowNodeId && element.dataset.flowNodeId !== sourceId);
  if (direct) return direct;

  return Array.from(document.querySelectorAll(".tl-flow-node"))
    .filter((element) => element.dataset.flowNodeId !== sourceId)
    .find((element) => {
      const rect = element.getBoundingClientRect();
      return event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
    }) || null;
};

const updateLinkHoverTarget = (interaction, event) => {
  const source = nodeById(interaction.sourceId);
  const targetElement = document.elementFromPoint(event.clientX, event.clientY);
  const targetNodeElement = targetElement?.closest?.(".tl-flow-node") || nodeElementAtPoint(event, interaction.sourceId);
  const targetNodeId = targetNodeElement?.dataset?.flowNodeId || "";
  const target = targetNodeId ? nodeById(targetNodeId) : null;
  if (!source?.id || !target?.id) {
    if (state.linkHoverTargetId) setNodeLinkClass(state.linkHoverTargetId, "is-link-hover", false);
    document.querySelectorAll(".tl-flow-node.is-link-invalid").forEach((node) => node.classList.remove("is-link-invalid"));
    document.querySelectorAll(".tl-flow-node-port.is-port-hover, .tl-flow-node-port.is-port-invalid").forEach((port) => port.classList.remove("is-port-hover", "is-port-invalid"));
    state.linkHoverTargetId = "";
    state.linkHoverPort = "";
    state.linkValidation = null;
    return;
  }
  const targetPortElement = nearestInputPortElement(targetElement, event) || nearestInputPortElement(targetNodeElement, event);
  const explicitTargetPort = targetPortElement?.dataset?.portLabel || "";
  const targetChannel = channelForPortConnection(source, target, interaction.sourcePort, explicitTargetPort);
  const targetPort = explicitTargetPort || bestTargetPortForChannel(target, targetChannel);
  const validation = connectionValidation(source, target, interaction.sourcePort, targetPort);
  const nextTargetId = target?.id || "";
  if (state.linkHoverTargetId === nextTargetId && state.linkHoverPort === targetPort && state.linkValidation?.reason === validation.reason) return;
  if (state.linkHoverTargetId) setNodeLinkClass(state.linkHoverTargetId, "is-link-hover", false);
  document.querySelectorAll(".tl-flow-node.is-link-invalid").forEach((node) => node.classList.remove("is-link-invalid"));
  document.querySelectorAll(".tl-flow-node-port.is-port-hover, .tl-flow-node-port.is-port-invalid").forEach((port) => port.classList.remove("is-port-hover", "is-port-invalid"));
  state.linkHoverTargetId = nextTargetId;
  state.linkHoverPort = nextTargetId ? targetPort : "";
  state.linkValidation = nextTargetId ? validation : null;
  if (nextTargetId) {
    setNodeLinkClass(nextTargetId, validation.ok ? "is-link-hover" : "is-link-invalid", true);
    const portSelector = `.tl-flow-node[data-flow-node-id="${escapeSelectorValue(nextTargetId)}"] .tl-flow-node-port.is-input[data-port-label="${escapeSelectorValue(targetPort)}"]`;
    document.querySelectorAll(portSelector).forEach((portElement) => {
      portElement.classList.add(validation.ok ? "is-port-hover" : "is-port-invalid");
    });
  }
};

const completePortLinkDrag = async (interaction, event) => {
  const source = nodeById(interaction.sourceId);
  updateLinkHoverTarget(interaction, event);
  const target = state.linkHoverTargetId ? nodeById(state.linkHoverTargetId) : null;
  const targetPort = state.linkHoverPort || "all";
  state.linkingSourceId = "";
  state.linkingPort = "";
  clearLinkDomState();
  if (source && !target) {
    openCanvasNodeMenuAtPointer({
      event,
      canvas: interaction.canvas,
      pendingLink: {
        sourceId: source.id,
        sourcePort: interaction.sourcePort || "all",
      },
    });
    return;
  }
  if (!source || !target || !canConnectNodes(source, target, interaction.sourcePort, targetPort)) {
    const validation = source && target ? connectionValidation(source, target, interaction.sourcePort, targetPort) : null;
    state.error = !source
      ? "Link non creato: nodo sorgente non trovato."
      : !target
        ? "Link non creato: rilascia il collegamento sopra un nodo target."
        : connectionValidationMessage(validation, source, target);
    if (source && target && validation) {
      await recordFlowAction({
        workspaceId: connectionWorkspaceId(source, target),
        nodeId: target.id,
        level: "warning",
        message: state.error,
        context: {
          action: "flow-map-link-blocked",
          sourceNodeId: source.id,
          targetNodeId: target.id,
          sourcePort: interaction.sourcePort || "all",
          targetPort,
          reason: validation.reason || "",
          hint: validation.hint || "",
          sourcePortType: validation.sourcePort?.type || "",
          targetPortType: validation.targetPort?.type || "",
        },
      });
      state.activeStatusPanel = "logs";
    }
    mount();
    return;
  }
  await createRuntimeLink(source, target, {
    sourcePort: interaction.sourcePort || "all",
    targetPort,
    sourceHandleSide: interaction.sourceSide || "out",
    sourceHandleCorner: interaction.sourceCorner || "",
  });
};

const handlePointerMove = (event) => {
  const interaction = state.interaction;
  if (!interaction) return;

  if (interaction.type === "pan") {
    const dx = Math.abs(event.clientX - interaction.startX);
    const dy = Math.abs(event.clientY - interaction.startY);
    if (!interaction.moved && dx < 4 && dy < 4) return;
    interaction.moved = true;
    state.viewport.panX = interaction.panX + event.clientX - interaction.startX;
    state.viewport.panY = interaction.panY + event.clientY - interaction.startY;
    updateCanvasViewportDom();
    return;
  }

  if (interaction.type === "node") {
    const dx = Math.abs(event.clientX - interaction.startX);
    const dy = Math.abs(event.clientY - interaction.startY);
    if (!interaction.moved && dx < 4 && dy < 4) return;
    interaction.moved = true;
    const point = pointerPercent(event, interaction.canvas);
    const nextX = clampFlowNumber(point.x - interaction.offset.x);
    const nextY = clampFlowNumber(point.y - interaction.offset.y);
    const deltaX = nextX - interaction.startPosition.x;
    const deltaY = nextY - interaction.startPosition.y;
    Object.entries(interaction.groupPositions || {}).forEach(([nodeId, start]) => {
      state.nodePositions[nodeId] = {
        x: flowCoordinate(start.x + deltaX),
        y: flowCoordinate(start.y + deltaY),
        width: start.width,
      };
      const node = document.querySelector(`[data-flow-node-id="${escapeSelectorValue(nodeId)}"]`);
      if (node) {
        node.style.setProperty("--x", state.nodePositions[nodeId].x);
        node.style.setProperty("--y", state.nodePositions[nodeId].y);
        node.style.setProperty("--node-width", `${state.nodePositions[nodeId].width}px`);
      }
    });
    renderFlowEdges();
    return;
  }

  if (interaction.type === "node-resize") {
    const dx = Math.abs(event.clientX - interaction.startX);
    if (!interaction.moved && dx < 3) return;
    interaction.moved = true;
    const nextWidth = Math.max(FLOW_NODE_MIN_WIDTH, Math.min(FLOW_NODE_MAX_WIDTH, interaction.startWidth + (event.clientX - interaction.startX) / Math.max(0.1, state.viewport.zoom || 1)));
    state.nodePositions[interaction.nodeId] = {
      x: flowCoordinate(interaction.position.x),
      y: flowCoordinate(interaction.position.y),
      width: Math.round(nextWidth),
    };
    const node = document.querySelector(`[data-flow-node-id="${escapeSelectorValue(interaction.nodeId)}"]`);
    if (node) node.style.setProperty("--node-width", `${Math.round(nextWidth)}px`);
    renderFlowEdges();
    return;
  }

  if (interaction.type === "link") {
    interaction.point = pointerPercent(event, interaction.canvas);
    updateLinkHoverTarget(interaction, event);
    renderFlowEdges();
    return;
  }

  if (interaction.type === "minimap") {
    const dx = Math.abs(event.clientX - interaction.startX);
    const dy = Math.abs(event.clientY - interaction.startY);
    if (!interaction.moved && dx < 2 && dy < 2) return;
    interaction.moved = true;
    const deltaX = ((event.clientX - interaction.startX) / Math.max(1, interaction.bounds.width)) * 100;
    const deltaY = ((event.clientY - interaction.startY) / Math.max(1, interaction.bounds.height)) * 100;
    const nextX = Math.max(0, Math.min(100 - interaction.viewportW, interaction.viewportX + deltaX));
    const nextY = Math.max(0, Math.min(100 - interaction.viewportH, interaction.viewportY + deltaY));
    const viewport = document.querySelector(".tl-flow-minimap-viewport");
    if (viewport) {
      viewport.style.setProperty("--x", `${nextX}%`);
      viewport.style.setProperty("--y", `${nextY}%`);
    }
    if (typeof minimapCenterViewportAtPercent === "function") {
      minimapCenterViewportAtPercent(nextX + interaction.viewportW / 2, nextY + interaction.viewportH / 2, { remount: false });
    }
  }
};

const persistNodePosition = (interaction) => {
  const position = state.nodePositions[interaction.nodeId];
  if (!position || !interaction.workspaceId || !window.TrackerLensRuntimeGraphStore?.updateFlowNodePosition) return;
  window.TrackerLensRuntimeGraphStore.updateFlowNodePosition({
    workspaceId: interaction.workspaceId,
    nodeId: interaction.nodeId,
    position,
  }).catch((error) => console.warn("Salvataggio posizione Flow Map non riuscito", error));
};

const persistNodePositions = (interaction) => {
  const grouped = Object.entries(interaction.groupPositions || {});
  if (grouped.length <= 1) {
    persistNodePosition(interaction);
    return;
  }
  if (!window.TrackerLensRuntimeGraphStore?.updateFlowNodePosition) return;
  Promise.all(grouped.map(([nodeId, start]) => {
    const position = state.nodePositions[nodeId];
    const workspaceId = start.node?.workspaceId || interaction.workspaceId || "";
    if (!position || !workspaceId) return null;
    return window.TrackerLensRuntimeGraphStore.updateFlowNodePosition({
      workspaceId,
      nodeId,
      position,
    });
  })).catch((error) => console.warn("Salvataggio posizioni Flow Map non riuscito", error));
};

const flushPendingRuntimeRefresh = () => {
  if (!state.pendingRuntimeRefresh || state.interaction) return;
  state.pendingRuntimeRefresh = false;
  window.setTimeout(() => {
    if (!state.interaction) loadRuntime({ silent: true });
    else state.pendingRuntimeRefresh = true;
  }, 250);
};

const endInteraction = (event) => {
  const interaction = state.interaction;
  document.removeEventListener("pointermove", handlePointerMove);
  document.removeEventListener("pointercancel", endInteraction);
  state.interaction = null;
  state.lastInteractionAt = Date.now();
  if (interaction?.type === "link") {
    if (event?.type === "pointercancel") {
      state.linkingSourceId = "";
      clearLinkDomState();
      mount();
      flushPendingRuntimeRefresh();
      return;
    }
    completePortLinkDrag(interaction, event);
    flushPendingRuntimeRefresh();
    return;
  }
  if (interaction?.type === "minimap") {
    saveViewport();
    flushPendingRuntimeRefresh();
    return;
  }
  if (interaction?.type === "node" && !interaction.moved) {
    const node = state.runtime.nodes.find((item) => item.id === interaction.nodeId);
    if (node) selectNode(node);
    else mount();
    flushPendingRuntimeRefresh();
    return;
  }
  if (interaction?.type === "node") persistNodePositions(interaction);
  if (interaction?.type === "node-resize") {
    if (interaction.moved) persistNodePosition(interaction);
    flushPendingRuntimeRefresh();
    return;
  }
  if (interaction?.type === "pan") {
    if (!interaction.moved && state.inspectorOpen) {
      closeInspector();
      flushPendingRuntimeRefresh();
      return;
    }
    if (!interaction.moved) {
      flushPendingRuntimeRefresh();
      return;
    }
    saveViewport();
    renderFlowEdges();
    flushPendingRuntimeRefresh();
    return;
  }
  mount();
  flushPendingRuntimeRefresh();
};

const setFilter = (key, value) => {
  setFiltersState({ ...state.filters, [key]: value });
  if (key === "workspaceId") state.viewport = loadStoredViewport(value) || defaultViewport();
  syncFilterQuery();
  if (key === "workspaceId") loadRuntime({ force: true });
  else mount();
};

const syncFilterQuery = () => {
  const query = new URLSearchParams(window.location.search);
  Object.entries(state.filters).forEach(([key, value]) => {
    if (!value || value === "all") query.delete(key);
    else query.set(key, value);
  });
  const next = `${window.location.pathname}${query.toString() ? `?${query.toString()}` : ""}${window.location.hash}`;
  window.history.replaceState({}, "", next);
};

const focusLogLevel = (level = "all") => {
  setFiltersState({ ...state.filters, logLevel: level });
  state.activeStatusPanel = level === "warning" || level === "error" ? level : "logs";
  syncFilterQuery();
  mount();
};

const toggleStatusPanel = (panel = "") => {
  state.activeStatusPanel = state.activeStatusPanel === panel ? "" : panel;
  mount({ preserveScroll: true });
};

const hasActiveFilters = () =>
  Object.entries(state.filters).some(([key, value]) => key !== "workspaceId" && value && value !== "all");

const resetFilters = () => {
  const workspaceId = state.filters.workspaceId || "workspace_global";
  setFiltersState(Object.fromEntries(Object.keys(state.filters).map((key) => [key, key === "workspaceId" ? workspaceId : "all"])));
  syncFilterQuery();
  mount();
};

const setZoom = (delta) => {
  const current = state.viewport.zoom;
  state.viewport.zoom = Math.max(0.45, Math.min(2.2, Math.round((current + delta) * 100) / 100));
  saveViewport();
  mount();
};

const resetViewport = () => {
  state.viewport = defaultViewport();
  saveViewport();
  mount();
};

const fitVisibleGraph = () => {
  const host = document.querySelector(".tl-flow-canvas");
  const rect = host?.getBoundingClientRect?.();
  const baseGraph = graphModel();
  const activity = recentActivity(baseGraph);
  const graph = filterByActivity(baseGraph, activity);
  if (!rect?.width || !rect?.height || !graph.nodes.length) {
    resetViewport();
    return;
  }

  const bounds = graph.nodes.reduce((acc, node, index) => {
    const position = nodePosition(node, index);
    const x = flowWorldNumber(position.x);
    const y = flowWorldNumber(position.y);
    const width = flowPositionWidth(position);
    const height = nodeMinHeight(Math.max(nodePorts(node, "in").length, nodePorts(node, "out").length));
    return {
      minX: Math.min(acc.minX, x),
      minY: Math.min(acc.minY, y),
      maxX: Math.max(acc.maxX, x + width),
      maxY: Math.max(acc.maxY, y + height),
    };
  }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });

  const graphWidth = Math.max(1, bounds.maxX - bounds.minX);
  const graphHeight = Math.max(1, bounds.maxY - bounds.minY);
  const padding = 64;
  const zoom = Math.max(0.45, Math.min(1.8, Math.min(
    (rect.width - padding * 2) / graphWidth,
    (rect.height - padding * 2) / graphHeight
  )));

  state.viewport = {
    zoom: Math.round(zoom * 100) / 100,
    panX: Math.round((rect.width - graphWidth * zoom) / 2 - bounds.minX * zoom),
    panY: Math.round((rect.height - graphHeight * zoom) / 2 - bounds.minY * zoom),
  };
  saveViewport();
  mount();
};

const setViewportCenterOnPercent = ({ x = 0, y = 0, zoom = state.viewport.zoom, remount = true } = {}) => {
  const host = document.querySelector(".tl-flow-canvas");
  const rect = host?.getBoundingClientRect?.();
  if (!rect?.width || !rect?.height) return;
  const nextZoom = Math.max(0.45, Math.min(2.2, Number(zoom) || state.viewport.zoom || 1));
  const graphX = flowWorldNumber(x);
  const graphY = flowWorldNumber(y);
  state.viewport = {
    zoom: Math.round(nextZoom * 100) / 100,
    panX: Math.round((rect.width / 2) - graphX * nextZoom),
    panY: Math.round((rect.height / 2) - graphY * nextZoom),
  };
  saveViewport();
  if (remount) mount({ preserveScroll: true });
  else updateCanvasViewportDom();
};

const centerViewportOnPercent = (options = {}) =>
  setViewportCenterOnPercent({ ...options, remount: true });

const centerViewportOnNode = (node = {}, index = 0, { select = false, zoom = Math.max(0.82, state.viewport.zoom || 1) } = {}) => {
  const position = nodePosition(node, index);
  if (select && node?.id) {
    setFocusState({
      mode: "nodes",
      nodeId: node.id,
      nodeType: node.type || "",
      channel: node.channels?.[0] || "",
      connectionId: "",
    });
    bringNodeToFront(node.id);
  }
  centerViewportOnPercent({
    x: flowWorldNumber(position.x) + flowPositionWidth(position) / 2,
    y: flowWorldNumber(position.y) + nodeMinHeight(Math.max(nodePorts(node, "in").length, nodePorts(node, "out").length)) / 2,
    zoom,
  });
};

const selectNode = (node) => {
  closeContextMenu();
  bringNodeToFront(node.id);
  setFocusState({
    mode: "dependencies",
    nodeId: node.id,
    edgeId: "",
    nodeType: node.type || "node",
    channel: nodeChannels(node)[0] || "",
    connectionId: "",
  });
  state.inspectorOpen = true;
  mount();
};

const selectEdge = (edge) => {
  closeContextMenu();
  setFocusState({
    mode: "edge",
    nodeId: "",
    edgeId: edge.id,
    nodeType: "",
    channel: edge.channel || "",
    connectionId: edge.connectionId || "",
  });
  state.inspectorOpen = true;
  mount();
};

const setGraphHover = (nodeId = "", portKey = "") => {
  if (state.hoverNodeId === nodeId && state.hoverPortKey === portKey) return;
  state.hoverNodeId = nodeId;
  state.hoverPortKey = portKey;
  renderFlowEdges();
};

const clearSelection = () => {
  closeContextMenu();
  setFocusState({ mode: "", nodeId: "", edgeId: "", nodeType: "", channel: "", connectionId: "" });
  mount();
};

const closeInspector = () => {
  closeContextMenu();
  setFocusState({ mode: "", nodeId: "", edgeId: "", nodeType: "", channel: "", connectionId: "" });
  state.inspectorOpen = false;
  mount({ preserveScroll: true });
};

const closeContextMenu = () => {
  if (!state.contextMenu) return;
  state.contextMenu = null;
};

const cancelNodePointerInteractionForContextMenu = () => {
  if (state.interaction?.type !== "node") return;
  document.removeEventListener("pointermove", handlePointerMove);
  document.removeEventListener("pointerup", endInteraction);
  document.removeEventListener("pointercancel", endInteraction);
  state.interaction = null;
};

const openCanvasNodeMenuAtPointer = ({ event, canvas, pendingLink = null } = {}) => {
  if (!event || !canvas) return;
  const point = pointerPercent(event, canvas);
  state.contextMenu = {
    type: "canvas",
    x: Math.max(12, Math.min(event.clientX, window.innerWidth - 360)),
    y: Math.max(12, Math.min(event.clientY, window.innerHeight - 560)),
    flowPosition: {
      x: flowCoordinate(point.x),
      y: flowCoordinate(point.y),
      width: FLOW_NODE_DEFAULT_WIDTH,
    },
    pendingLink: pendingLink?.sourceId
      ? {
        sourceId: pendingLink.sourceId,
        sourcePort: pendingLink.sourcePort || "all",
      }
      : null,
  };
  mount({ preserveScroll: true });
};

const openCanvasContextMenu = (event) => {
  if (event.target.closest?.(".tl-flow-node, .tl-flow-panel, .tl-flow-controls, .tl-flow-filterbar, .tl-flow-minimap, .tl-flow-context-menu")) return;
  const canvas = event.currentTarget?.closest?.(".tl-flow-canvas") || event.currentTarget;
  if (!canvas) return;
  event.preventDefault();
  event.stopPropagation();
  openCanvasNodeMenuAtPointer({ event, canvas });
};

const openNodeContextMenu = (event, node) => {
  if (!node?.id) return;
  event.preventDefault();
  event.stopPropagation();
  cancelNodePointerInteractionForContextMenu();
  state.contextMenu = {
    type: "node",
    nodeId: node.id,
    x: Math.min(event.clientX, window.innerWidth - 244),
    y: Math.min(event.clientY, window.innerHeight - 320),
  };
  setFocusState({
    mode: "dependencies",
    nodeId: node.id,
    edgeId: "",
    nodeType: node.type || "node",
    channel: nodeChannels(node)[0] || "",
    connectionId: "",
  });
  mount({ preserveScroll: true });
};

const createContextMenuNode = async (item) => {
  const menu = state.contextMenu;
  if (!item || menu?.type !== "canvas") return;
  const flowPosition = menu.flowPosition || { x: "0px", y: "0px", width: FLOW_NODE_DEFAULT_WIDTH };
  const pendingLink = menu.pendingLink?.sourceId
    ? {
      sourceId: menu.pendingLink.sourceId,
      sourcePort: menu.pendingLink.sourcePort || "all",
    }
    : null;
  closeContextMenu();
  mount({ preserveScroll: true });
  const createdNode = await createDraftNodeAtFlowPosition({ item, flowPosition });
  if (!pendingLink || !createdNode?.id) return;
  const source = nodeById(pendingLink.sourceId);
  const target = nodeById(createdNode.id) || createdNode;
  if (!source?.id || !target?.id) {
    state.error = "Nodo creato, ma collegamento non creato: nodo sorgente o target non trovato.";
    setErrorSignal?.(state.error);
    mount({ preserveScroll: true });
    return;
  }
  const targetPort = bestCompatibleTargetPortForLink(source, target, pendingLink.sourcePort);
  await createRuntimeLink(source, target, {
    sourcePort: pendingLink.sourcePort || "all",
    targetPort,
  });
};

const runNodeContextAction = async (action, node) => {
  if (!node?.id) return;
  closeContextMenu();
  mount({ preserveScroll: true });
  const view = runtimeNodeBase(node, recentActivity(graphModel()).nodeActivity?.get(node.id), nodePerformance(node));
  const disabled = view.runtime.status === "disabled";
  const paused = view.runtime.status === "paused";
  if (action === "edit") configureNode(node);
  else if (action === "rename") requestNodeRename(node);
  else if (action === "duplicate") await duplicateRuntimeNode(node);
  else if (action === "pause") await (paused || disabled ? resumeNodeRuntime(node) : pauseNodeRuntime(node));
  else if (action === "disable") await (disabled ? resumeNodeRuntime(node) : disableNodeRuntime(node));
  else if (action === "collapse") await toggleNodeCollapse(node);
  else if (action === "logs") {
    setFocusState({
      mode: "dependencies",
      nodeId: node.id,
      edgeId: "",
      nodeType: node.type || "node",
      channel: nodeChannels(node)[0] || "",
      connectionId: "",
    });
    const prefs = readInspectorPanelPrefs("node");
    writeInspectorPanelPrefs("node", { ...prefs, collapsed: { ...(prefs.collapsed || {}), logs: false } });
    state.inspectorOpen = true;
    mount({ preserveScroll: true });
  } else if (action === "delete") {
    requestDraftNodeDelete(node);
  }
};

const selectedNode = () =>
  !state.focus.nodeId || state.focus.edgeId ? null :
    state.runtime.nodes.find((node) => [node.id, node.sourceRef, node.assetId].filter(Boolean).map(String).includes(state.focus.nodeId)) ||
    null;

const selectedEdge = () =>
  !state.focus.edgeId ? null :
    state.runtime.dependencies.find((dependency) => dependency.id === state.focus.edgeId) ||
    null;

const graphEngineApi = () => window.TrackerLensGraphEngine;

const currentVisibleGraph = () => state.edgeRender.graph || graphModel();

const selectedImpact = (graph = currentVisibleGraph()) => {
  const edge = selectedEdge();
  const node = selectedNode();
  if (!edge && !node) return null;
  return graphEngineApi()?.impactAnalysis?.({
    graph,
    runtime: {
      ...state.runtime,
      runtimeDependencies: graph.dependencies || state.runtime.dependencies || [],
    },
    nodeId: node?.id || "",
    connectionId: edge?.connectionId || edge?.id || "",
  }) || null;
};

const impactNodeIds = (impact = selectedImpact()) => ({
  upstream: new Set((impact?.upstream || []).map((item) => item.node?.id).filter(Boolean)),
  downstream: new Set((impact?.downstream || []).map((item) => item.node?.id).filter(Boolean)),
  direct: new Set((impact?.directDependencies || []).flatMap((dependency) => [dependency.sourceNodeId, dependency.targetNodeId]).filter(Boolean)),
});

const impactClassForNode = (node, impact = selectedImpact()) => {
  if (!impact || !node?.id || (!selectedNode() && !selectedEdge())) return "";
  const ids = impactNodeIds(impact);
  if (selectedNode()?.id === node.id || selectedEdge()?.sourceNodeId === node.id || selectedEdge()?.targetNodeId === node.id) return " is-impact-focus";
  if (ids.upstream.has(node.id)) return " is-impact-upstream";
  if (ids.downstream.has(node.id)) return " is-impact-downstream";
  if (ids.direct.has(node.id)) return " is-impact-direct";
  return " is-impact-dimmed";
};

const impactClassForEdge = (dependency, impact = selectedImpact()) => {
  if (!impact || !dependency?.id || (!selectedNode() && !selectedEdge())) return "";
  const direct = (impact.directDependencies || []).some((item) => item.id === dependency.id || item.connectionId === dependency.connectionId);
  if (selectedEdge()?.id === dependency.id) return " is-impact-focus";
  if (direct) return " is-impact-direct";
  const upstream = (impact.upstream || []).some((item) => item.dependency?.id === dependency.id);
  if (upstream) return " is-impact-upstream";
  const downstream = (impact.downstream || []).some((item) => item.dependency?.id === dependency.id);
  if (downstream) return " is-impact-downstream";
  return " is-impact-dimmed";
};

const nodeById = (id = "") =>
  state.runtime.nodes.find((node) => node.id === id || node.sourceRef === id || node.assetId === id) || null;

const selectedDependencies = (node = selectedNode()) => {
  if (!node) return [];
  return state.runtime.dependencies.filter((dependency) => dependency.sourceNodeId === node.id || dependency.targetNodeId === node.id);
};

const dependencySummary = (node, dependencies = []) => ({
  incoming: dependencies.filter((dependency) => dependency.targetNodeId === node?.id).length,
  outgoing: dependencies.filter((dependency) => dependency.sourceNodeId === node?.id).length,
});

const dependencyRow = (node, dependency) => {
  const outgoing = dependency.sourceNodeId === node?.id;
  const peer = outgoing ? nodeById(dependency.targetNodeId) : nodeById(dependency.sourceNodeId);
  return {
    direction: outgoing ? "out" : "in",
    peer: peer?.label || (outgoing ? dependency.targetNodeId : dependency.sourceNodeId) || "runtime",
    channel: dependency.channel || "runtime",
  };
};

const selectedEvents = (node = selectedNode()) => {
  if (!node) return [];
  const channels = new Set(nodeChannels(node));
  return filteredRuntimeEvents()
    .filter((event) => event.sourceNodeId === node.id || event.targetNodeId === node.id || channels.has(event.channel))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 8);
};

const selectedFlowLogs = (node = selectedNode()) => {
  if (!node) return [];
  return (state.runtime.flowLogs || [])
    .filter((log) => recordMatchesRunFilter(log))
    .filter((log) =>
      log.nodeId === node.id ||
      log.context?.sourceNodeId === node.id ||
      log.context?.targetNodeId === node.id)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 8);
};

const nodeSandboxReport = (node = {}) => {
  if (!node?.id) return { status: "unknown", errors: 0, logs: 0, last: null };
  const persisted = node.metadata?.sandbox || {};
  const sandboxEvents = (state.runtime.events || [])
    .filter((event) =>
      event.eventType === "sandbox_error" &&
      (event.sourceNodeId === node.id || event.targetNodeId === node.id));
  const sandboxLogs = (state.runtime.flowLogs || [])
    .filter((log) =>
      log.context?.action === "sandbox-runtime" &&
      (log.nodeId === node.id || log.context?.boxId === node.id));
  const errors = sandboxEvents.length + sandboxLogs.filter((log) => (log.level || "info") === "error").length;
  const last = [...sandboxEvents, ...sandboxLogs]
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))[0] || null;
  const status = errors ? "error" : persisted.status || (sandboxLogs.length || sandboxEvents.length ? "logged" : node.type === "boxLens" ? "policy" : "n/a");
  return {
    status,
    errors,
    logs: sandboxLogs.length,
    events: sandboxEvents.length,
    last,
    persisted,
  };
};

const selectedEdgeFlowLogs = (edge = selectedEdge()) => {
  if (!edge) return [];
  return (state.runtime.flowLogs || [])
    .filter((log) => recordMatchesRunFilter(log))
    .filter((log) =>
      log.connectionId === edge.connectionId ||
      log.context?.connectionId === edge.connectionId ||
      log.context?.sourceNodeId === edge.sourceNodeId ||
      log.context?.targetNodeId === edge.targetNodeId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 8);
};

const selectedChannelRecords = (node = selectedNode()) => {
  if (!node) return [];
  const channels = new Set(nodeChannels(node));
  return state.runtime.channels.filter((channel) =>
    channels.has(channel.name) ||
    channel.producerNodeId === node.id ||
    channel.producerBoxId === node.id ||
    (Array.isArray(channel.subscribers) && channel.subscribers.includes(node.id)));
};

const connectionChannel = (connection = {}) =>
  normalizePortChannel(connection.channel || connection.frequency || connection.mapping?.channel || "default");

const channelDependencyReport = (channel = {}, fallbackName = "") => {
  const name = normalizePortChannel(channel.name || fallbackName || "default");
  const workspaceId = channel.workspaceId || state.filters.workspaceId || "global";
  const workspaceMatches = (record = {}) =>
    workspaceId === "all" || state.filters.workspaceId === "all" || (record.workspaceId || workspaceId || "global") === workspaceId;
  const nodes = state.runtime.nodes.filter((node) => {
    const channels = new Set(nodeChannels(node).map(normalizePortChannel));
    const inputs = new Set((node.inputs || []).map(normalizePortChannel));
    const outputs = new Set((node.outputs || []).map(normalizePortChannel));
    return workspaceMatches(node) && (
      channels.has(name) ||
      inputs.has(name) ||
      outputs.has(name) ||
      node.id === channel.producerNodeId ||
      node.id === channel.producerBoxId ||
      (Array.isArray(channel.subscribers) && channel.subscribers.includes(node.id))
    );
  });
  const producers = nodes.filter((node) =>
    node.id === channel.producerNodeId ||
    node.id === channel.producerBoxId ||
    (node.outputs || []).map(normalizePortChannel).includes(name));
  const subscribers = nodes.filter((node) =>
    (Array.isArray(channel.subscribers) && channel.subscribers.includes(node.id)) ||
    (node.inputs || []).map(normalizePortChannel).includes(name));
  const dependencies = state.runtime.dependencies.filter((dependency) =>
    workspaceMatches(dependency) && normalizePortChannel(dependency.channel || "default") === name);
  const connections = state.connections.filter((connection) =>
    workspaceMatches(connection) && connectionChannel(connection) === name);
  const events = state.runtime.events.filter((event) =>
    (workspaceId === "all" || !event.workspaceId || event.workspaceId === workspaceId) &&
    normalizePortChannel(event.channel || "default") === name)
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  const lastAt = channel.lastEmittedAt || events[0]?.createdAt || "";
  const ageMs = lastAt ? Date.now() - Date.parse(lastAt) : Infinity;
  const hasError = events.some((event) => event.status === "error" || String(event.eventType || "").includes("error"));
  const status = hasError ? "error" : !lastAt ? "idle" : ageMs > 120000 ? "stale" : "live";
  return {
    name,
    workspaceId,
    producers,
    subscribers,
    nodes,
    dependencies,
    connections,
    events,
    health: {
      live: status === "live",
      status,
      ageMs: Number.isFinite(ageMs) ? ageMs : null,
      lastEmittedAt: lastAt,
      recentEvents: events.length,
      errors: events.filter((event) => event.status === "error" || String(event.eventType || "").includes("error")).length,
      totalLinks: dependencies.length + connections.length,
    },
  };
};

const channelRecordFor = (channelName = "", workspaceId = "") => {
  const name = normalizePortChannel(channelName || "default");
  return state.runtime.channels.find((channel) =>
    normalizePortChannel(channel.name || channel.id || "default") === name &&
    (!workspaceId || workspaceId === "all" || (channel.workspaceId || "global") === workspaceId)) || {
    id: name,
    name,
    workspaceId: workspaceId || state.filters.workspaceId || "global",
    subscribers: [],
  };
};

const selectChannel = (channelName = "", workspaceId = "") => {
  const channel = normalizePortChannel(channelName || "default");
  state.focus.channel = channel;
  setFocusSignal(state.focus);
  setFiltersState({
    ...state.filters,
    ...(workspaceId ? { workspaceId } : {}),
    channel,
  });
  state.activeStatusPanel = "channels";
  mount();
};

const channelReportStat = (label, value) =>
  _.div(_.span(label), _.strong(String(value)));

const formatDuration = (ms) => {
  if (!Number.isFinite(ms) || ms < 0) return "N/D";
  if (ms < 60000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 3600000)}h`;
};

const renderChannelReportBlocks = (channel, report) =>
  _.div(
    { class: "tl-flow-channel-inspector-report" },
    _.section(
      _.h3("General"),
      channelReportStat("Channel", report.name),
      channelReportStat("Workspace", channel.workspaceId || report.workspaceId || "global"),
      channelReportStat("Status", channel.status || "N/D"),
      channelReportStat("Type", channel.type || "unknown"),
      channelReportStat("Health", report.health.status),
      channelReportStat("Age", formatDuration(report.health.ageMs)),
      channelReportStat("Last emit", report.health.lastEmittedAt ? formatShortDate(report.health.lastEmittedAt) : "N/D")
    ),
    _.section(
      _.h3("Dependencies"),
      channelReportStat("Producers", report.producers.length),
      channelReportStat("Subscribers", report.subscribers.length),
      channelReportStat("Runtime deps", report.dependencies.length),
      channelReportStat("Connections", report.connections.length),
      channelReportStat("Events", report.events.length),
      channelReportStat("Errors", report.health.errors)
    ),
    _.section(
      _.h3("Producer Nodes"),
      ...(report.producers.length ? report.producers.slice(0, 6).map((node) =>
        _.div(_.span(node.label || node.id), _.strong(node.type || "node"))
      ) : [_.p({ class: "tl-flow-muted" }, "Nessun producer.")])
    ),
    _.section(
      _.h3("Subscriber Nodes"),
      ...(report.subscribers.length ? report.subscribers.slice(0, 6).map((node) =>
        _.div(_.span(node.label || node.id), _.strong(node.type || "node"))
      ) : [_.p({ class: "tl-flow-muted" }, "Nessun subscriber.")])
    ),
    _.section(
      _.h3("Last Value"),
      _.code({ class: "tl-flow-channel-inspector-value" }, channelLastValuePreview(channel))
    )
  );

const openChannelInspector = (channelName = "", workspaceId = "") => {
  const channel = channelRecordFor(channelName, workspaceId);
  const report = channelDependencyReport(channel, channelName);
  const dialog = _.Dialog({
    class: "tl-flow-channel-dialog",
    panelClass: "tl-flow-channel-panel",
    size: "lg",
    title: "Channel Inspector",
    subtitle: `${report.name} · ${channel.workspaceId || report.workspaceId || "global"}`,
    icon: "hub",
    closeButton: true,
    content: () => renderChannelReportBlocks(channel, report),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: () => { selectChannel(report.name, channel.workspaceId); close(); } }, icon("filter_alt", "sm"), "Filter"),
      btn({ onclick: () => requestChannelRename(channel, close) }, icon("edit", "sm"), "Rename"),
      btn({ class: "is-danger", onclick: () => requestChannelDelete(channel, close) }, icon("delete", "sm"), "Delete"),
      btn({ onclick: close }, "Close")
    ),
  });
  dialog.open();
};

const channelValidationCounts = (report = {}) => report.counts || {
  producers: report.producers?.length || 0,
  subscribers: report.subscribers?.length || 0,
  dependencies: report.dependencies?.length || 0,
  connections: report.connections?.length || 0,
  pageReferences: report.pageReferences?.length || 0,
};

const renderChannelValidationBody = ({ title = "", message = "", validation = null, channel = {}, target = "" } = {}) => {
  const report = validation?.report || channelDependencyReport(channel);
  const counts = channelValidationCounts(report);
  return _.div(
    { class: "tl-flow-edge-delete-body" },
    message ? _.p(message) : null,
    title ? _.div(_.span("Action"), _.strong(title)) : null,
    _.div(_.span("Channel"), _.strong(report.channel || report.name || channel.name || "default")),
    target ? _.div(_.span("Target"), _.strong(target)) : null,
    validation?.errors?.length ? _.div(_.span("Validation"), _.strong(validation.errors.join(", "))) : null,
    _.div(
      { class: "tl-flow-delete-dependencies" },
      _.h3("Dependency report"),
      _.div(_.span("Producers"), _.strong(String(counts.producers))),
      _.div(_.span("Subscribers"), _.strong(String(counts.subscribers))),
      _.div(_.span("Runtime deps"), _.strong(String(counts.dependencies))),
      _.div(_.span("Connections"), _.strong(String(counts.connections))),
      _.div(_.span("Workspace refs"), _.strong(String(counts.pageReferences || 0)))
    )
  );
};

const performChannelRename = async ({ channel, target = "", form = null, close = null, closeParent = null, force = false } = {}) => {
  const to = target || readConfigField(form, "channelName", "");
  const workspaceId = channel.workspaceId || state.filters.workspaceId || "global";
  const from = channel.name || channel.id || state.focus.channel || "default";
  try {
    const validation = await window.TrackerLensChannelRegistry?.canRenameChannel?.({ workspaceId, from, to });
    if (!force && validation && !validation.ok) {
      requestChannelRenameWarning({ channel, target: to, validation, closeParent });
      return;
    }
    const result = await window.TrackerLensChannelRegistry?.renameChannel?.({ workspaceId, from, to, force });
    state.lastChannelAction = {
      type: "rename",
      label: `${from} -> ${normalizePortChannel(to)}`,
      workspaceId,
      snapshot: result?.snapshot || null,
      createdAt: new Date().toISOString(),
    };
    await recordFlowAction({
      workspaceId,
      level: force ? "warning" : "info",
      message: `Channel renamed: ${from} -> ${to}`,
      context: {
        action: "channel-renamed",
        from,
        to,
        force: Boolean(force),
        updated: result?.updated || {},
      },
    });
    setFiltersState({ ...state.filters, channel: normalizePortChannel(to) });
    setFocusState({ ...state.focus, channel: normalizePortChannel(to) });
    close?.();
    closeParent?.();
    await loadRuntime();
  } catch (error) {
    console.error("Errore rename channel:", error);
    state.error = error?.message || "Errore rename channel";
    mount();
  }
};

const requestChannelRenameWarning = ({ channel, target, validation, closeParent = null } = {}) => {
  const conflict = Boolean(validation?.conflict);
  const dialog = _.Dialog({
    class: "tl-flow-channel-dialog",
    panelClass: "tl-flow-edge-delete-panel",
    size: "md",
    title: conflict ? "Rename bloccato" : "Channel con dipendenze",
    subtitle: channel.name || channel.id,
    icon: conflict ? "block" : "warning_amber",
    closeButton: true,
    content: () => renderChannelValidationBody({
      title: conflict ? "Rename non disponibile" : "Force Rename",
      message: conflict
        ? "Esiste gia un channel con questo nome nel workspace."
        : "Questo channel ha dipendenze attive. Il rename aggiornera registry, nodi, dependencies, connections e workspace references.",
      validation,
      channel,
      target,
    }),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: close }, "Cancel"),
      conflict ? null : btn({
        class: "is-danger",
        onclick: () => performChannelRename({ channel, target, close, closeParent, force: true }),
      }, icon("warning_amber", "sm"), "Force Rename")
    ),
  });
  dialog.open();
};

const requestChannelRename = (channel, closeParent = null) => {
  const formId = `tl-flow-channel-rename-${String(channel.id || channel.name || "default").replace(/[^A-Za-z0-9_-]/g, "_")}`;
  let formRef = null;
  const current = channel.name || channel.id || "default";
  const dialog = _.Dialog({
    class: "tl-flow-channel-dialog",
    panelClass: "tl-flow-config-panel",
    size: "md",
    title: "Rename Channel",
    subtitle: current,
    icon: "edit",
    closeButton: true,
    content: () => _.form(
      {
        id: formId,
        class: "tl-flow-config-form",
        onsubmit: (event) => {
          event.preventDefault();
          performChannelRename({ channel, form: formRef || event.currentTarget, close: () => dialog.close(), closeParent });
        },
      },
      _.p("Il nome viene normalizzato in lowercase dot notation prima della validazione."),
      _.label(
        { class: "tl-flow-config-field" },
        _.span("New channel name"),
        _.input({ name: "channelName", value: current, autocomplete: "off", placeholder: "sensor.value" })
      )
    ),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: close }, "Cancel"),
      btn({ class: "st-btn-primary", onclick: () => performChannelRename({ channel, form: formRef || document.getElementById(formId), close, closeParent }) }, icon("save", "sm"), "Validate Rename")
    ),
  });
  dialog.open();
  formRef = document.getElementById(formId);
};

const performChannelDelete = async ({ channel, close = null, closeParent = null, force = false } = {}) => {
  const workspaceId = channel.workspaceId || state.filters.workspaceId || "global";
  const name = channel.name || channel.id || state.focus.channel || "default";
  try {
    const result = await window.TrackerLensChannelRegistry?.deleteChannel?.({ workspaceId, channel: name, force });
    state.lastChannelAction = {
      type: "delete",
      label: name,
      workspaceId,
      snapshot: result?.snapshot || null,
      createdAt: new Date().toISOString(),
    };
    await recordFlowAction({
      workspaceId,
      level: force ? "warning" : "info",
      message: `Channel deleted: ${name}`,
      context: {
        action: "channel-deleted",
        channel: name,
        force: Boolean(force),
        deleted: result?.deleted || {},
      },
    });
    if (state.filters.channel === normalizePortChannel(name)) setFiltersState({ ...state.filters, channel: "all" });
    if (state.focus.channel === normalizePortChannel(name)) setFocusState({ ...state.focus, channel: "" });
    close?.();
    closeParent?.();
    await loadRuntime();
  } catch (error) {
    console.error("Errore delete channel:", error);
    state.error = error?.message || "Errore delete channel";
    mount();
  }
};

const requestChannelDelete = async (channel, closeParent = null) => {
  const workspaceId = channel.workspaceId || state.filters.workspaceId || "global";
  const name = channel.name || channel.id || state.focus.channel || "default";
  let validation = null;
  try {
    validation = await window.TrackerLensChannelRegistry?.canDeleteChannel?.({ workspaceId, channel: name });
  } catch (error) {
    console.error("Errore validazione delete channel:", error);
  }
  const blocked = validation && !validation.ok;
  const dialog = _.Dialog({
    class: "tl-flow-channel-dialog",
    panelClass: "tl-flow-edge-delete-panel",
    size: "md",
    title: blocked ? "Delete channel bloccato" : "Delete channel",
    subtitle: name,
    icon: blocked ? "warning_amber" : "delete",
    closeButton: true,
    content: () => renderChannelValidationBody({
      title: blocked ? "Force Delete richiesto" : "Delete sicuro",
      message: blocked
        ? "Questo channel ha riferimenti attivi. Force Delete rimuovera channel, dependencies, connections e riferimenti nei nodi/workspace."
        : "Nessuna dipendenza attiva trovata per questo channel.",
      validation,
      channel,
    }),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: close }, "Cancel"),
      btn({
        class: blocked ? "is-danger" : "st-btn-primary",
        onclick: () => performChannelDelete({ channel, close, closeParent, force: blocked }),
      }, icon(blocked ? "delete_forever" : "delete", "sm"), blocked ? "Force Delete" : "Delete")
    ),
  });
  dialog.open();
};

const restoreLastChannelAction = async () => {
  const action = state.lastChannelAction;
  if (!action?.snapshot || !window.TrackerLensChannelRegistry?.restoreChannelSnapshot) return;
  try {
    await window.TrackerLensChannelRegistry.restoreChannelSnapshot(action.snapshot);
    await recordFlowAction({
      workspaceId: action.workspaceId || "global",
      level: "warning",
      message: `Channel action undone: ${action.label || action.type}`,
      context: {
        action: "channel-action-undone",
        channelAction: action.type,
        label: action.label || "",
      },
    });
    state.lastChannelAction = null;
    await loadRuntime();
  } catch (error) {
    console.error("Errore undo channel:", error);
    state.error = error?.message || "Errore undo channel";
    mount();
  }
};

const channelRoleForNode = (channel = {}, node = {}) => {
  const roles = [];
  if (channel.producerNodeId === node.id || channel.producerBoxId === node.id) roles.push("producer");
  if (Array.isArray(channel.subscribers) && channel.subscribers.includes(node.id)) roles.push("subscriber");
  return roles.length ? roles.join(" + ") : "mapped";
};

const compactPayloadPreview = (payload, max = 160) => {
  if (payload === null || payload === undefined) return "N/D";
  try {
    const text = typeof payload === "string" ? payload : JSON.stringify(payload);
    return text.length > max ? `${text.slice(0, max)}...` : text;
  } catch {
    return String(payload);
  }
};

const runtimeEventRawPreview = (event = {}) => {
  if (event.payloadPreview) return compactPayloadPreview(event.payloadPreview, 260);
  return compactPayloadPreview(event.payload || {}, 260);
};

const channelLastValuePreview = (channel = {}) =>
  compactPayloadPreview(channel.lastValue, 160);

const recentChannelRecords = (limit = 8) =>
  state.runtime.channels
    .slice()
    .sort((a, b) => Date.parse(b.lastEmittedAt || b.updatedAt || b.createdAt || 0) - Date.parse(a.lastEmittedAt || a.updatedAt || a.createdAt || 0))
    .slice(0, limit);

const flowIdForWorkspace = (workspaceId = "") =>
  state.runtime.flows.find((flow) => flow.workspaceId === workspaceId)?.id || "";

const recordFlowAction = async ({ workspaceId = "global", nodeId = "", connectionId = "", level = "info", message = "", context = {} } = {}) => {
  if (!window.TrackerLensEventLogStore?.recordFlowLog) return null;
  try {
    const log = await window.TrackerLensEventLogStore.recordFlowLog({
      workspaceId,
      flowId: flowIdForWorkspace(workspaceId),
      nodeId,
      connectionId,
      level,
      message,
      context: {
        source: "flow-map",
        ...context,
      },
    });
    mergeFlowLog(log);
    return log;
  } catch (error) {
    console.warn("Flow Map runtime log non registrato:", error);
    return null;
  }
};
