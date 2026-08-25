window.TrackerLensNodeExecutionController = (() => {
  const controllers = new Map();

  const nodeConfig = (node = {}) =>
    node.metadata?.config && typeof node.metadata.config === "object" && !Array.isArray(node.metadata.config)
      ? node.metadata.config
      : {};

  const executionConfig = (node = {}) => {
    const config = nodeConfig(node);
    const runtimeExecution = node.runtime?.execution || node.metadata?.runtimeMetadata?.execution || {};
    const source = { ...runtimeExecution, ...config };
    const subtype = String(node.metadata?.subtype || node.metadata?.manifest?.subtype || node.metadata?.agentRole || node.type || "").toLowerCase();
    const isOrchestrator = subtype === "orchestrator";
    const isAiAgent = node.type === "aiAgent" || node.metadata?.category === "ai-agents";
    const maxConcurrentTasks = Math.max(1, Math.min(20, Number(source.maxConcurrentTasks || source.parallelJobs || 1)));
    const defaultTimeoutMs = isOrchestrator || isAiAgent ? 120000 : 30000;
    const requestedTimeoutMs = Number(source.timeoutMs || defaultTimeoutMs);
    const timeoutMs = (isOrchestrator || isAiAgent) && requestedTimeoutMs <= 30000 ? 120000 : requestedTimeoutMs;
    return {
      mode: maxConcurrentTasks > 1 ? "parallel" : "single",
      maxConcurrentTasks,
      queueLimit: Math.max(0, Math.min(1000, Number(source.queueLimit ?? 10))),
      timeoutMs: Math.max(1000, Math.min(600000, timeoutMs)),
      dropPolicy: ["queue", "reject", "latest"].includes(String(source.dropPolicy || "").toLowerCase())
        ? String(source.dropPolicy).toLowerCase()
        : "queue",
    };
  };

  const timeoutPromise = (ms, nodeId = "") =>
    new Promise((_, reject) => {
      window.setTimeout?.(() => reject(new Error(`Node execution timeout${nodeId ? `: ${nodeId}` : ""}`)), ms);
      if (typeof window.setTimeout !== "function") {
        setTimeout(() => reject(new Error(`Node execution timeout${nodeId ? `: ${nodeId}` : ""}`)), ms);
      }
    });

  class NodeExecutionController {
    constructor({ workspaceId = "workspace_global" } = {}) {
      this.workspaceId = workspaceId;
      this.state = new Map();
    }

    nodeState(nodeId = "") {
      const id = nodeId || "node";
      if (!this.state.has(id)) this.state.set(id, { active: 0, queued: [] });
      return this.state.get(id);
    }

    snapshot(nodeId = "") {
      const state = this.nodeState(nodeId);
      return {
        active: state.active,
        queued: state.queued.length,
      };
    }

    async emitState({ node, bus, status = "idle", eventType = "", context = {} } = {}) {
      if (!bus?.emit || !node?.id) return null;
      const state = this.snapshot(node.id);
      return bus.emit(`node.${status}`, {
        nodeId: node.id,
        label: node.label || node.id,
        status,
        activeTasks: state.active,
        queuedTasks: state.queued,
        ...context,
      }, {
        workspaceId: this.workspaceId,
        eventType: eventType || `node_${status}`,
        sourceNodeId: node.id,
        status,
        meta: {
          executionController: true,
          nodeId: node.id,
          activeTasks: state.active,
          queuedTasks: state.queued,
          ...context,
        },
      });
    }

    runNow({ node, bus, task, config, resolve, reject, context }) {
      const state = this.nodeState(node.id);
      state.active += 1;
      this.emitState({ node, bus, status: "busy", eventType: "node_busy", context });
      const startedAt = performance?.now?.() || Date.now();
      Promise.race([
        Promise.resolve().then(() => window.TrackerLensRuntimeManager?.getDefault?.().runLegacyTask({ node, task, context }) || task()),
        timeoutPromise(config.timeoutMs, node.id),
      ])
        .then((result) => resolve(result))
        .catch((error) => reject(error))
        .finally(() => {
          state.active = Math.max(0, state.active - 1);
          const latencyMs = Math.round((performance?.now?.() || Date.now()) - startedAt);
          if (state.queued.length) {
            const next = state.queued.shift();
            this.emitState({ node, bus, status: "queued", eventType: "node_dequeued", context: { ...context, latencyMs } });
            this.runNow({ ...next, config: executionConfig(next.node) });
            return;
          }
          this.emitState({ node, bus, status: "idle", eventType: "node_idle", context: { ...context, latencyMs } });
        });
    }

    enqueue({ node, bus, task, context = {} } = {}) {
      if (!node?.id || typeof task !== "function") return Promise.reject(new Error("Invalid node execution task"));
      const config = executionConfig(node);
      const state = this.nodeState(node.id);
      if (state.active < config.maxConcurrentTasks) {
        return new Promise((resolve, reject) => this.runNow({ node, bus, task, config, resolve, reject, context }));
      }

      if (config.dropPolicy === "reject" || config.queueLimit === 0) {
        this.emitState({ node, bus, status: "overloaded", eventType: "node_overloaded", context: { ...context, reason: "rejected" } });
        return Promise.reject(new Error(`Node overloaded: ${node.label || node.id}`));
      }

      if (state.queued.length >= config.queueLimit) {
      if (config.dropPolicy === "latest") {
          const keep = Math.max(0, config.queueLimit - 1);
          state.queued = keep ? state.queued.slice(-keep) : [];
        } else {
          this.emitState({ node, bus, status: "overloaded", eventType: "node_overloaded", context: { ...context, reason: "queue-limit" } });
          return Promise.reject(new Error(`Node queue full: ${node.label || node.id}`));
        }
      }

      return new Promise((resolve, reject) => {
        state.queued.push({ node, bus, task, resolve, reject, context });
        this.emitState({ node, bus, status: "queued", eventType: "node_queued", context });
      });
    }
  }

  const get = (workspaceId = "workspace_global") => {
    const key = workspaceId || "workspace_global";
    if (!controllers.has(key)) controllers.set(key, new NodeExecutionController({ workspaceId: key }));
    return controllers.get(key);
  };

  return {
    executionConfig,
    get,
    NodeExecutionController,
  };
})();
