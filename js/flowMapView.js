// Flow Map bootstrap and mount lifecycle.
// Extracted from js/flowMapView.js; loaded in order by flowMap.html.
const scrollPanels = [".tl-flow-inspector", ".tl-flow-status-popover", ".tl-flow-palette"];

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
  const root = document.getElementById("tl-flow-map-root");
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

window.TrackerLensRuntimeWorker?.subscribe?.((status = {}) => {
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
});

mount();
runFlowMapStartupRepair().then((repairResult) => {
  if (repairResult?.skipInitialLoad) {
    mount();
    return;
  }
  loadRuntime();
});
connectLiveEventBus();
window.setInterval(() => {
  if (isFlowMapRecoveryMode()) return;
  if (state.loading || state.runtimeLoadInFlight) return;
  if (state.interaction || isFlowMapNodeEditorActive() || Date.now() - state.lastInteractionAt < 750) {
    state.pendingRuntimeRefresh = true;
    return;
  }
  loadRuntime({ silent: true });
}, 15000);
document.addEventListener("focusout", (event) => {
  if (!isFlowMapEditableElement(event.target) || !state.pendingRuntimeRefresh) return;
  window.setTimeout(() => {
    if (state.pendingRuntimeRefresh && !state.interaction && !isFlowMapNodeEditorActive()) {
      state.pendingRuntimeRefresh = false;
      loadRuntime({ silent: true });
    }
  }, 150);
});
window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const target = event.target;
  if (target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
  if (state.activeStatusPanel) {
    state.activeStatusPanel = "";
    mount({ preserveScroll: true });
    return;
  }
  if (state.inspectorOpen) closeInspector();
});
window.addEventListener("resize", () => {
  if (isFlowMapRecoveryMode()) return;
  requestAnimationFrame(renderFlowEdges);
});
