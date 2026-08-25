((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TrackerLensNodeExecutionContract = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const CONTRACT_VERSION = "tl-node-execution/v1";
  const RUNTIMES = new Set(["javascript", "python"]);
  const RESULT_STATUSES = new Set(["success", "failed", "cancelled", "timeout"]);
  const EVENT_KINDS = new Set(["started", "progress", "partial", "log", "warning", "completed", "failed", "cancelled"]);

  const text = (value, fallback = "") => String(value ?? "").trim() || fallback;
  const unique = (values = []) => [...new Set((Array.isArray(values) ? values : []).filter(Boolean).map(String))];
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

  const normalizeRuntime = (value, fallback = "javascript") => {
    const runtime = text(value, fallback).toLowerCase();
    if (["javascript", "js", "node", "nodejs"].includes(runtime)) return "javascript";
    return runtime;
  };

  const normalizeExecution = (source = {}, { legacy = false } = {}) => {
    const value = typeof source === "string" ? { runtime: source } : source && typeof source === "object" ? source : {};
    const runtime = normalizeRuntime(value.runtime || value.engine || value.language);
    return {
      contractVersion: CONTRACT_VERSION,
      runtime,
      entry: text(value.entry || value.main),
      capabilities: unique(value.capabilities),
      dependencies: value.dependencies && typeof value.dependencies === "object" && !Array.isArray(value.dependencies) ? clone(value.dependencies) : {},
      timeoutMs: Number.isFinite(Number(value.timeoutMs)) && Number(value.timeoutMs) > 0 ? Number(value.timeoutMs) : null,
      cancellable: value.cancellable !== false,
      legacy: Boolean(legacy || value.legacy)
    };
  };

  const resolveRuntime = (execution = {}, availableRuntimes = ["javascript"]) => {
    const normalized = normalizeExecution(execution);
    const available = new Set((availableRuntimes || []).map((runtime) => normalizeRuntime(runtime)));
    const supported = RUNTIMES.has(normalized.runtime);
    return {
      runtime: normalized.runtime,
      available: supported && available.has(normalized.runtime),
      reason: !supported
        ? `Unsupported runtime: ${normalized.runtime}`
        : available.has(normalized.runtime)
          ? ""
          : `Runtime unavailable: ${normalized.runtime}`
    };
  };

  const normalizeContext = (context = {}) => ({
    workspaceId: text(context.workspaceId),
    flowId: text(context.flowId),
    jobId: text(context.jobId),
    sourceNodeId: text(context.sourceNodeId),
    traceId: text(context.traceId)
  });

  const createExecutionRequest = ({ executionId = "", nodeId = "", execution = {}, inputs = {}, context = {}, permissions = [], provenance = {} } = {}) => ({
    contractVersion: CONTRACT_VERSION,
    executionId: text(executionId),
    nodeId: text(nodeId),
    runtime: normalizeExecution(execution).runtime,
    inputs: clone(inputs),
    context: normalizeContext(context),
    control: {
      timeoutMs: normalizeExecution(execution).timeoutMs,
      cancellable: normalizeExecution(execution).cancellable
    },
    permissions: unique(permissions),
    provenance: clone(provenance)
  });

  const validateExecutionRequest = (request = {}, availableRuntimes = ["javascript"]) => {
    const errors = [];
    if (text(request.contractVersion) !== CONTRACT_VERSION) errors.push("Unsupported execution contract version");
    if (!text(request.executionId)) errors.push("executionId is required");
    if (!text(request.nodeId)) errors.push("nodeId is required");
    const runtime = resolveRuntime({ runtime: request.runtime }, availableRuntimes);
    if (!runtime.available) errors.push(runtime.reason);
    return { ok: errors.length === 0, errors, request: clone(request), runtime };
  };

  const normalizeExecutionEvent = (event = {}) => {
    const kind = text(event.kind || event.type, "log").toLowerCase();
    return {
      kind: EVENT_KINDS.has(kind) ? kind : "log",
      at: text(event.at, new Date().toISOString()),
      message: text(event.message),
      progress: Number.isFinite(Number(event.progress)) ? Number(event.progress) : null,
      data: clone(event.data)
    };
  };

  const normalizeExecutionResult = (result = {}, { executionId = "" } = {}) => {
    const status = text(result.status, "failed").toLowerCase();
    return {
      contractVersion: CONTRACT_VERSION,
      executionId: text(result.executionId, executionId),
      status: RESULT_STATUSES.has(status) ? status : "failed",
      outputs: clone(result.outputs),
      metrics: {
        latencyMs: Number.isFinite(Number(result.metrics?.latencyMs)) ? Number(result.metrics.latencyMs) : null,
        ...clone(result.metrics)
      },
      diagnostics: Array.isArray(result.diagnostics) ? clone(result.diagnostics, []) : [],
      events: Array.isArray(result.events) ? result.events.map(normalizeExecutionEvent) : [],
      provenance: clone(result.provenance)
    };
  };

  return {
    CONTRACT_VERSION,
    RUNTIMES: [...RUNTIMES],
    RESULT_STATUSES: [...RESULT_STATUSES],
    EVENT_KINDS: [...EVENT_KINDS],
    normalizeExecution,
    resolveRuntime,
    createExecutionRequest,
    validateExecutionRequest,
    normalizeExecutionEvent,
    normalizeExecutionResult
  };
});
