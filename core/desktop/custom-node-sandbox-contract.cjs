const SANDBOX_CONTRACT_VERSION = "tl-custom-node-sandbox/v1";

const text = (value, fallback = "") => String(value ?? "").trim() || fallback;
const clone = (value, fallback = {}) => {
  try { return structuredClone(value ?? fallback); }
  catch (_) {
    try { return JSON.parse(JSON.stringify(value ?? fallback)); }
    catch (_) { return fallback; }
  }
};

const normalizePermissions = (value = {}) => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const runtimeGraph = text(source.runtimeGraph, "none");
  return {
    network: Boolean(source.network),
    filesystem: Boolean(source.filesystem),
    aiProvider: Boolean(source.aiProvider),
    memory: Boolean(source.memory),
    runtimeGraph: ["none", "read", "write"].includes(runtimeGraph) ? runtimeGraph : "none"
  };
};

const intersectPermissions = (declared = {}, granted = {}) => {
  const requested = normalizePermissions(declared);
  const approved = normalizePermissions(granted);
  const graphLevels = ["none", "read", "write"];
  return {
    network: requested.network && approved.network,
    filesystem: requested.filesystem && approved.filesystem,
    aiProvider: requested.aiProvider && approved.aiProvider,
    memory: requested.memory && approved.memory,
    runtimeGraph: graphLevels[Math.min(graphLevels.indexOf(requested.runtimeGraph), graphLevels.indexOf(approved.runtimeGraph))]
  };
};

const permissionForTool = (tool = "") => {
  const name = text(tool).toLowerCase();
  if (name === "ai.complete") return ["aiProvider", true];
  if (["memory.read", "memory.write"].includes(name)) return ["memory", true];
  if (name === "runtimegraph.read") return ["runtimeGraph", "read"];
  if (name === "runtimegraph.preflight") return ["runtimeGraph", "write"];
  return null;
};

const isToolAllowed = (tool = "", permissions = {}) => {
  const required = permissionForTool(tool);
  if (!required) return false;
  const [permission, level] = required;
  const resolved = normalizePermissions(permissions);
  if (permission !== "runtimeGraph") return resolved[permission] === level;
  return ["none", "read", "write"].indexOf(resolved.runtimeGraph) >= ["none", "read", "write"].indexOf(level);
};

const createSandboxRequest = ({ executionId = "", nodeId = "", packageRecord = {}, inputs = {}, config = {}, context = {}, grantedPermissions = {} } = {}) => {
  const manifest = packageRecord.manifest || {};
  const packageId = text(packageRecord.packageId || manifest.id);
  const version = text(packageRecord.version || manifest.version);
  const archiveSha256 = text(packageRecord.archive?.sha256);
  const permissions = intersectPermissions(packageRecord.permissions || manifest.permissions, grantedPermissions);
  return {
    contractVersion: SANDBOX_CONTRACT_VERSION,
    executionId: text(executionId),
    nodeId: text(nodeId),
    package: { packageId, version, archiveSha256 },
    permissions,
    inputs: clone(inputs),
    config: clone(config),
    context: clone(context)
  };
};

const validateSandboxRequest = (request = {}, packageRecord = {}) => {
  const errors = [];
  if (text(request.contractVersion) !== SANDBOX_CONTRACT_VERSION) errors.push("Unsupported sandbox contract version");
  if (!text(request.executionId)) errors.push("executionId is required");
  if (!text(request.nodeId)) errors.push("nodeId is required");
  if (!text(request.package?.packageId) || !text(request.package?.version) || !text(request.package?.archiveSha256)) errors.push("Complete package reference is required");
  if (text(packageRecord.runtimeExecution, "blocked") !== "sandboxed") errors.push("Package runtime is not enabled for the sandbox");
  if (text(request.package?.packageId) !== text(packageRecord.packageId)) errors.push("Package id does not match catalog record");
  if (text(request.package?.version) !== text(packageRecord.version)) errors.push("Package version does not match catalog record");
  if (text(request.package?.archiveSha256) !== text(packageRecord.archive?.sha256)) errors.push("Package archive hash does not match catalog record");
  return { ok: errors.length === 0, errors, request: clone(request) };
};

const validateSandboxMessage = (message = {}, { outputs = [], permissions = {} } = {}) => {
  const kind = text(message.kind).toLowerCase();
  const errors = [];
  if (!["ready", "emit", "log", "tool.call", "result"].includes(kind)) errors.push("Unsupported sandbox message kind");
  if (kind === "emit" && !new Set((outputs || []).map(String)).has(text(message.port))) errors.push("Output port is not declared by the package");
  if (kind === "tool.call" && !isToolAllowed(message.tool, permissions)) errors.push("Tool is not declared or granted");
  if (kind === "tool.call" && !text(message.callId)) errors.push("Tool callId is required");
  if (kind === "tool.call" && message.arguments !== undefined && (!message.arguments || typeof message.arguments !== "object" || Array.isArray(message.arguments))) errors.push("Tool arguments must be an object");
  if (kind === "log" && !text(message.message)) errors.push("Log message is required");
  if (kind === "result" && !["success", "failed"].includes(text(message.status).toLowerCase())) errors.push("Sandbox result status is invalid");
  return { ok: errors.length === 0, errors, message: clone(message) };
};

module.exports = {
  SANDBOX_CONTRACT_VERSION,
  normalizePermissions,
  intersectPermissions,
  permissionForTool,
  isToolAllowed,
  createSandboxRequest,
  validateSandboxRequest,
  validateSandboxMessage
};
