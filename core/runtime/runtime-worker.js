self.window = self;

const RUNTIME_WORKER_VERSION = "0.1.245-dictionary-llm-pure-1";
const ports = new Set();
const workspaces = new Map();

const post = (message = {}) => {
  if (!ports.size && typeof self.postMessage === "function") {
    try {
      self.postMessage({ version: RUNTIME_WORKER_VERSION, ...message });
      return;
    } catch (_) {}
  }
  ports.forEach((port) => {
    try {
      port.postMessage({ version: RUNTIME_WORKER_VERSION, ...message });
    } catch (_) {
      ports.delete(port);
    }
  });
};

self.TrackerLensKnowledgeDebug = () => {};

const loadRuntimeScripts = () => {
  if (self.TrackerLensEventBus) return;
  importScripts(
    "../../js/TlConfig.js",
    "../../js/tl-ai-runtime-store.js",
    "dependency-manager.js",
    "channel-registry.js",
    "event-log-store.js",
    "event-bus.js?v=kg-20260703-flow-agent-clean-1",
    "runtime-graph-store.js",
    "runtime-snapshot-store.js",
    "node-execution-controller.js",
    "processor-runtime.js?v=agent-tool-links-1",
    "action-runtime.js?v=agent-tool-links-1",
    "storage-runtime.js?v=agent-tool-links-1",
    "knowledge-runtime.js?v=dictionary-llm-pure-1",
    "agent-runtime.js?v=dictionary-evidence-pack-1",
    "ai-agent-runtime.js?v=agent-llm-planner-1",
    "orchestrator-agent-runtime.js?v=agent-tool-links-1"
  );
};

const runtimeFromSnapshot = (snapshot = {}) => ({
  channels: snapshot.channels || [],
  flows: snapshot.flows || [],
  events: snapshot.events || [],
  flowLogs: snapshot.flowLogs || [],
  nodes: snapshot.runtimeNodes || snapshot.nodes || [],
  dependencies: snapshot.runtimeDependencies || snapshot.dependencies || [],
});

const startRuntimeInstances = ({ workspaceId, runtime }) => {
  self.TrackerLensProcessorRuntime?.get?.(workspaceId)?.start({ workspaceId, runtime });
  self.TrackerLensActionRuntime?.get?.(workspaceId)?.start({ workspaceId, runtime });
  self.TrackerLensStorageRuntime?.get?.(workspaceId)?.start({ workspaceId, runtime });
  self.TrackerLensKnowledgeRuntime?.get?.(workspaceId)?.start({ workspaceId, runtime });
  self.TrackerLensAiAgentRuntime?.get?.(workspaceId)?.start({ workspaceId, runtime });
  self.TrackerLensOrchestratorAgentRuntime?.get?.(workspaceId)?.start({ workspaceId, runtime });
};

const stopRuntimeInstances = (workspaceId) => {
  self.TrackerLensProcessorRuntime?.get?.(workspaceId)?.stop?.();
  self.TrackerLensActionRuntime?.get?.(workspaceId)?.stop?.();
  self.TrackerLensStorageRuntime?.get?.(workspaceId)?.stop?.();
  self.TrackerLensKnowledgeRuntime?.get?.(workspaceId)?.stop?.();
  self.TrackerLensAiAgentRuntime?.get?.(workspaceId)?.stop?.();
  self.TrackerLensOrchestratorAgentRuntime?.get?.(workspaceId)?.stop?.();
};

const refreshWorkspace = async (workspaceId) => {
  loadRuntimeScripts();
  const snapshot = await self.TrackerLensRuntimeSnapshotStore.load({ includeConnections: true, workspaceId });
  const runtime = runtimeFromSnapshot(snapshot);
  startRuntimeInstances({ workspaceId, runtime });
  const state = workspaces.get(workspaceId) || {};
  workspaces.set(workspaceId, {
    ...state,
    workspaceId,
    runtime,
    lastStartedAt: state.lastStartedAt || new Date().toISOString(),
    lastRefreshAt: new Date().toISOString(),
    status: "running",
  });
  post({
    type: "runtime-worker:status",
    workspaceId,
    status: "running",
    nodes: runtime.nodes.length,
    dependencies: runtime.dependencies.length,
  });
};

const startWorkspace = async ({ workspaceId = "workspace_global", refreshMs = 5000 } = {}) => {
  const id = workspaceId || "workspace_global";
  const current = workspaces.get(id);
  if (current?.timer) clearInterval(current.timer);
  workspaces.set(id, {
    ...(current || {}),
    workspaceId: id,
    status: "starting",
    lastStartedAt: new Date().toISOString(),
  });
  await refreshWorkspace(id);
  const timer = setInterval(() => {
    refreshWorkspace(id).catch((error) => {
      workspaces.set(id, {
        ...(workspaces.get(id) || {}),
        status: "error",
        error: error?.message || String(error),
        lastErrorAt: new Date().toISOString(),
      });
      post({ type: "runtime-worker:error", workspaceId: id, error: error?.message || String(error) });
    });
  }, Math.max(2000, Number(refreshMs) || 5000));
  workspaces.set(id, { ...(workspaces.get(id) || {}), timer });
};

const stopWorkspace = (workspaceId = "workspace_global") => {
  const id = workspaceId || "workspace_global";
  const current = workspaces.get(id);
  if (current?.timer) clearInterval(current.timer);
  stopRuntimeInstances(id);
  workspaces.delete(id);
  post({ type: "runtime-worker:status", workspaceId: id, status: "stopped" });
};

const status = () => ({
  type: "runtime-worker:status",
  version: RUNTIME_WORKER_VERSION,
  status: "ready",
  workspaces: Array.from(workspaces.values()).map((workspace) => ({
    workspaceId: workspace.workspaceId,
    status: workspace.status,
    nodes: workspace.runtime?.nodes?.length || 0,
    dependencies: workspace.runtime?.dependencies?.length || 0,
    lastStartedAt: workspace.lastStartedAt || "",
    lastRefreshAt: workspace.lastRefreshAt || "",
    lastErrorAt: workspace.lastErrorAt || "",
    error: workspace.error || "",
  })),
});

const handleMessage = async (message = {}, port = null) => {
  try {
    if (message.type === "runtime-worker:start") {
      await startWorkspace(message);
      port?.postMessage?.(status());
      return;
    }
    if (message.type === "runtime-worker:refresh") {
      await refreshWorkspace(message.workspaceId || "workspace_global");
      port?.postMessage?.(status());
      return;
    }
    if (message.type === "runtime-worker:stop") {
      stopWorkspace(message.workspaceId || "workspace_global");
      port?.postMessage?.(status());
      return;
    }
    if (message.type === "runtime-worker:shutdown") {
      Array.from(workspaces.keys()).forEach(stopWorkspace);
      ports.clear();
      self.close?.();
      return;
    }
    if (message.type === "runtime-worker:status") {
      port?.postMessage?.(status());
    }
  } catch (error) {
    const payload = { type: "runtime-worker:error", workspaceId: message.workspaceId || "", error: error?.message || String(error) };
    port?.postMessage?.(payload);
    post(payload);
  }
};

self.onconnect = (event) => {
  const port = event.ports[0];
  ports.add(port);
  port.onmessage = (message) => handleMessage(message.data || {}, port);
  port.start?.();
  port.postMessage(status());
};

self.onmessage = (message) => {
  handleMessage(message.data || {}, self);
};
