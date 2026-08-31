((root, factory) => {
  const contract = root?.TrackerLensNodeExecutionContract || (typeof module === "object" && module.exports ? require("./node-execution-contract.js") : null);
  const api = factory(contract);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TrackerLensRuntimeManager = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (executionContract) => {
  const MANAGER_VERSION = "tl-runtime-manager/v1";
  const now = () => new Date().toISOString();
  const text = (value, fallback = "") => String(value ?? "").trim() || fallback;
  const clone = (value, fallback = {}) => {
    try {
      return structuredClone(value ?? fallback);
    } catch (_) {
      try {
        return JSON.parse(JSON.stringify(value ?? fallback));
      } catch (_) {
        return fallback;
      }
    }
  };

  class RuntimeManager {
    constructor({ contract = executionContract } = {}) {
      if (!contract) throw new Error("Node execution contract is required");
      this.contract = contract;
      this.executors = new Map();
      this.registerExecutor({
        runtime: "javascript",
        workerId: "renderer-js-worker",
        capabilities: ["flow-execution", "event-bus", "node-controller"],
        executeLegacy: async ({ task }) => task(),
        status: "ready"
      });
      if (globalThis.trackers?.runtime?.pythonNlp?.run) {
        this.registerExecutor({
          runtime: "python",
          workerId: "managed-python-nlp-dev",
          capabilities: ["text.embedding"],
          executeLegacy: async ({ task }) => task(),
          status: "ready"
        });
      } else if (globalThis.trackers?.runtime?.pythonPoc?.run) {
        this.registerExecutor({
          runtime: "python",
          workerId: "managed-python-poc",
          capabilities: ["text.transform", "poc.lifecycle"],
          executeLegacy: async ({ task }) => task(),
          status: "ready"
        });
      }
    }

    registerExecutor({ runtime = "", workerId = "", capabilities = [], executeLegacy = null, status = "ready" } = {}) {
      const normalizedRuntime = this.contract.normalizeExecution({ runtime }).runtime;
      if (!this.contract.RUNTIMES.includes(normalizedRuntime)) throw new Error(`Unsupported runtime: ${normalizedRuntime}`);
      if (typeof executeLegacy !== "function") throw new Error(`Executor ${normalizedRuntime} must provide executeLegacy`);
      const existing = this.executors.get(normalizedRuntime);
      this.executors.set(normalizedRuntime, {
        runtime: normalizedRuntime,
        workerId: text(workerId, `${normalizedRuntime}-worker`),
        capabilities: [...new Set((capabilities || []).filter(Boolean).map(String))],
        executeLegacy,
        status: status === "ready" ? "ready" : "unavailable",
        startedAt: existing?.startedAt || now(),
        heartbeatAt: now(),
        activeJobs: existing?.activeJobs || 0,
        completedJobs: existing?.completedJobs || 0,
        failedJobs: existing?.failedJobs || 0,
        restartCount: existing?.restartCount || 0,
        lastError: ""
      });
      return this.getExecutor(normalizedRuntime);
    }

    getExecutor(runtime = "") {
      const executor = this.executors.get(this.contract.normalizeExecution({ runtime }).runtime);
      if (!executor) return null;
      const { executeLegacy, ...status } = executor;
      return clone(status);
    }

    listExecutors() {
      return [...this.executors.keys()].map((runtime) => this.getExecutor(runtime));
    }

    getStatus() {
      return {
        version: MANAGER_VERSION,
        availableRuntimes: [...this.executors.values()].filter((executor) => executor.status === "ready").map((executor) => executor.runtime),
        executors: this.listExecutors()
      };
    }

    resolveCapability(capability = "") {
      const requested = text(capability).toLowerCase();
      if (!requested) return { ok: false, code: "CAPABILITY_REQUIRED", reason: "Capability is required" };
      const executor = [...this.executors.values()].find((item) =>
        item.status === "ready" && item.capabilities.map((value) => value.toLowerCase()).includes(requested)
      );
      if (!executor) return { ok: false, code: "CAPABILITY_UNAVAILABLE", capability: requested, reason: `Capability unavailable: ${requested}` };
      return { ok: true, capability: requested, runtime: executor.runtime, executor: this.getExecutor(executor.runtime) };
    }

    resolve(execution = {}) {
      const normalized = this.contract.normalizeExecution(execution);
      const executor = this.executors.get(normalized.runtime);
      if (!executor || executor.status !== "ready") {
        return { ok: false, code: "RUNTIME_UNAVAILABLE", runtime: normalized.runtime, reason: `Runtime unavailable: ${normalized.runtime}` };
      }
      return { ok: true, runtime: normalized.runtime, executor };
    }

    async runLegacyTask({ node = {}, task, context = {} } = {}) {
      if (typeof task !== "function") throw new Error("Invalid node execution task");
      if (node.metadata?.runtimeBlocked || node.metadata?.customPackage?.runtimeExecution === "blocked") {
        const error = new Error("Custom Node package runtime is blocked until its sandbox is available.");
        error.code = "CUSTOM_NODE_RUNTIME_BLOCKED";
        throw error;
      }
      const manifest = node.metadata?.manifest || {};
      const execution = manifest.execution || node.execution || {};
      const resolved = this.resolve(execution);
      if (!resolved.ok) {
        const error = new Error(resolved.reason);
        error.code = resolved.code;
        throw error;
      }
      const executor = resolved.executor;
      executor.activeJobs += 1;
      executor.heartbeatAt = now();
      try {
        const result = await executor.executeLegacy({ node, task, context, execution: this.contract.normalizeExecution(execution) });
        executor.completedJobs += 1;
        return result;
      } catch (error) {
        executor.failedJobs += 1;
        executor.lastError = error?.message || String(error);
        throw error;
      } finally {
        executor.activeJobs = Math.max(0, executor.activeJobs - 1);
        executor.heartbeatAt = now();
      }
    }
  }

  let defaultManager = null;
  const getDefault = () => {
    if (!defaultManager) defaultManager = new RuntimeManager();
    return defaultManager;
  };

  return { MANAGER_VERSION, RuntimeManager, getDefault };
});
