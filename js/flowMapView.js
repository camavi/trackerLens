// Flow Map bootstrap and mount lifecycle.
// Extracted from js/flowMapView.js; loaded in order by flowMap.html.
const scrollPanels = [".tl-flow-inspector", ".tl-flow-status-popover", ".tl-flow-palette"];
let flowMapRoot = null;
let flowMapRefreshTimer = null;
let flowMapPromptRestoreTimer = null;
let flowMapRuntimeWorkerUnsubscribe = null;
let flowMapLifecycleActive = false;
let flowMapLifecycleRunId = 0;
let flowMapEmbedded = false;

const capturePanelScroll = () =>
  Object.fromEntries(scrollPanels.map((selector) => [selector, document.querySelector(selector)?.scrollTop || 0]));

const restorePanelScroll = (positions = {}) => {
  scrollPanels.forEach((selector) => {
    const panel = document.querySelector(selector);
    if (!panel) return;
    panel.scrollTop = Math.min(positions[selector] || 0, panel.scrollHeight - panel.clientHeight);
  });
};

const refreshPortUiDom = () => {
  const scrollPositions = capturePanelScroll();
  syncReactiveState();
  replaceRenderedNode(".tl-flow-center", _.div({ class: "tl-flow-center" }, renderCanvas()));
  if (state.inspectorOpen) {
    replaceRenderedNode(".tl-flow-inspector-overlay", _.div({ class: "tl-flow-inspector-overlay" }, renderInspector()));
  }
  restorePanelScroll(scrollPositions);
  if (isFlowMapRecoveryMode()) return;
  requestAnimationFrame(() => {
    renderFlowEdges();
    updateFlowMinimapDom?.();
    requestAnimationFrame(() => {
      renderFlowEdges();
      updateFlowMinimapDom?.();
    });
  });
};

const mount = (options = {}) => {
  const root = flowMapRoot || document.getElementById("tl-flow-map-root");
  if (!root) return;
  const scrollPositions = options.preserveScroll ? capturePanelScroll() : null;
  syncReactiveState();
  root.replaceChildren(renderShell());
  state.mounted = true;
  if (scrollPositions) restorePanelScroll(scrollPositions);
  if (isFlowMapRecoveryMode()) return;
  requestAnimationFrame(() => {
    renderFlowEdges();
    updateFlowMinimapDom?.();
    requestAnimationFrame(() => {
      renderFlowEdges();
      updateFlowMinimapDom?.();
    });
  });
};

const onFlowMapRuntimeWorkerStatus = (status = {}) => {
  const active = (status.workspaces || []).find((workspace) => workspace.workspaceId === (state.filters.workspaceId || "workspace_global"));
  state.runtimeWorker = {
    available: Boolean(status.available),
    connected: Boolean(status.connected),
    mode: status.mode || "none",
    status: active?.status || status.status || "idle",
    version: status.version || "",
    error: active?.error || status.error || "",
    workspaceId: active?.workspaceId || status.workspaceId || state.filters.workspaceId || "",
    nodes: active?.nodes || status.nodes || 0,
    dependencies: active?.dependencies || status.dependencies || 0,
    lastRefreshAt: active?.lastRefreshAt || "",
  };
  if (state.mounted) refreshLiveBusDom();
};

const onFlowMapCustomPackagesUpdated = () => {
  if (state.mounted) mount({ preserveScroll: true });
};

const onFlowMapFocusOut = (event) => {
  if (!isFlowMapEditableElement(event.target) || !state.pendingRuntimeRefresh) return;
  window.setTimeout(() => {
    if (state.pendingRuntimeRefresh && !state.interaction && !isFlowMapNodeEditorActive()) {
      state.pendingRuntimeRefresh = false;
      loadRuntime({ silent: true });
    }
  }, 150);
};

const onFlowMapKeyDown = (event) => {
  if (event.key !== "Escape") return;
  const target = event.target;
  if (target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
  if (state.activeStatusPanel) {
    state.activeStatusPanel = "";
    mount({ preserveScroll: true });
    return;
  }
  if (state.inspectorOpen) closeInspector();
};

const onFlowMapResize = () => {
  if (isFlowMapRecoveryMode()) return;
  requestAnimationFrame(renderFlowEdges);
};

const refreshFlowMapRuntime = () => {
  if (isFlowMapRecoveryMode()) return;
  if (state.loading || state.runtimeLoadInFlight) return;
  if (state.interaction || isFlowMapNodeEditorActive() || Date.now() - state.lastInteractionAt < 750) {
    state.pendingRuntimeRefresh = true;
    return;
  }
  loadRuntime({ silent: true });
};

const getFlowMapLifecycleStatus = () => ({
  renderer: flowMapEmbedded ? "shell" : "legacy",
  active: flowMapLifecycleActive,
  mounted: Boolean(state.mounted),
  rootConnected: Boolean(flowMapRoot?.isConnected),
  workspaceId: state.filters.workspaceId || "",
  polling: Boolean(flowMapRefreshTimer),
  runtimeWorkerSubscribed: Boolean(flowMapRuntimeWorkerUnsubscribe),
  liveBusConnected: Boolean(state.liveBus?.connected),
  liveTestRunning: Boolean(state.testRun?.running),
  interaction: state.interaction?.type || "",
});

const startFlowMapLifecycle = ({ root = null } = {}) => {
  if (flowMapLifecycleActive) {
    return;
  }
  flowMapLifecycleActive = true;
  const lifecycleRunId = ++flowMapLifecycleRunId;
  flowMapRoot = root || document.getElementById("tl-flow-map-root");
  flowMapRuntimeWorkerUnsubscribe = window.TrackerLensRuntimeWorker?.subscribe?.(onFlowMapRuntimeWorkerStatus) || null;
  mount();
  runFlowMapStartupRepair().then((repairResult) => {
    if (!flowMapLifecycleActive || lifecycleRunId !== flowMapLifecycleRunId) return;
    if (repairResult?.skipInitialLoad) {
      mount();
      return;
    }
    loadRuntime();
  });
  connectLiveEventBus();
  window.addEventListener("trackers-custom-node-packages-updated", onFlowMapCustomPackagesUpdated);
  window.addEventListener("trackers-custom-node-packages-updated", onFlowMapCustomPackageReconcile);
  window.addEventListener("trackers:python-poc-status", onFlowMapPythonPocStatus);
  window.addEventListener("trackers:runtime-error", onFlowMapRuntimeError);
  window.TrackerLensCustomNodePackages?.refreshInstalled?.();
  flowMapRefreshTimer = window.setInterval(refreshFlowMapRuntime, 15000);
  flowMapPromptRestoreTimer = window.setTimeout(() => {
    if (flowMapLifecycleActive) flowPromptRestoreOpenState?.();
  }, 250);
  document.addEventListener("focusout", onFlowMapFocusOut);
  window.addEventListener("keydown", onFlowMapKeyDown);
  window.addEventListener("resize", onFlowMapResize);
};

const stopFlowMapLifecycle = ({ clearRoot = true } = {}) => {
  if (!flowMapLifecycleActive) return;
  flowMapLifecycleActive = false;
  flowMapLifecycleRunId += 1;
  if (flowMapRefreshTimer) window.clearInterval(flowMapRefreshTimer);
  flowMapRefreshTimer = null;
  if (flowMapPromptRestoreTimer) window.clearTimeout(flowMapPromptRestoreTimer);
  flowMapPromptRestoreTimer = null;
  flowMapRuntimeWorkerUnsubscribe?.();
  flowMapRuntimeWorkerUnsubscribe = null;
  state.liveBusUnsubscribe?.();
  state.liveBusUnsubscribe = null;
  state.liveBus.connected = false;
  window.removeEventListener("trackers-custom-node-packages-updated", onFlowMapCustomPackagesUpdated);
  window.removeEventListener("trackers-custom-node-packages-updated", onFlowMapCustomPackageReconcile);
  window.removeEventListener("trackers:python-poc-status", onFlowMapPythonPocStatus);
  window.removeEventListener("trackers:runtime-error", onFlowMapRuntimeError);
  document.removeEventListener("focusout", onFlowMapFocusOut);
  window.removeEventListener("keydown", onFlowMapKeyDown);
  window.removeEventListener("resize", onFlowMapResize);
  destroyKnowledgeGraphCanvases?.(flowMapRoot);
  state.mounted = false;
  if (clearRoot) flowMapRoot?.replaceChildren();
  flowMapRoot = null;
};

window.TrackerLensFlowMapLifecycle = {
  start: startFlowMapLifecycle,
  stop: stopFlowMapLifecycle,
  status: getFlowMapLifecycleStatus,
};
window.TrackerLensViews = window.TrackerLensViews || {};
window.TrackerLensViews.flowMap = {
  async mount({ outlet }) {
    flowMapEmbedded = true;
    window.TrackerLensAppShell?.setActive?.("flow");
    startFlowMapLifecycle({ root: outlet });
  },
  dispose() {
    stopFlowMapLifecycle({ clearRoot: true });
    flowMapEmbedded = false;
  },
};

if (!window.TrackerLensAppRouter) startFlowMapLifecycle();
