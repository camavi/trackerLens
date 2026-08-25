window.TrackerLensRuntimeManifest = (() => {
  const CONTRACT_VERSION = "1.0.0";
  const RUNTIME_VERSION = "0.1.0";
  const EXECUTION_CONTRACT_VERSION = "tl-node-execution/v1";
  const NODE_TYPES = new Set(["source", "boxTracker", "processor", "knowledge", "aiAgent", "boxLens", "lens", "action", "storage", "devPreview"]);
  const PORT_TYPES = new Set(["any", "object", "event", "string", "number", "boolean", "array", "record", "state", "agent-control"]);

  const text = (value, fallback = "") =>
    String(value ?? "").trim() || fallback;

  const unique = (values = []) =>
    [...new Set(values.filter(Boolean).map(String))];

  const executionContract = () => window.TrackerLensNodeExecutionContract || null;

  const normalizeExecution = (manifest = {}) => {
    const legacyRuntime = typeof manifest.runtime === "string" ? manifest.runtime : manifest.runtime?.execution;
    const source = manifest.execution || legacyRuntime || {};
    return executionContract()?.normalizeExecution
      ? executionContract().normalizeExecution(source, { legacy: !manifest.execution && !legacyRuntime })
      : {
        contractVersion: EXECUTION_CONTRACT_VERSION,
        runtime: "javascript",
        entry: "",
        capabilities: [],
        dependencies: {},
        timeoutMs: null,
        cancellable: true,
        legacy: true,
      };
  };

  const normalizePort = (port = {}, fallbackType = "any") => {
    const source = port && typeof port === "object" ? port : { name: port };
    const name = text(source.name || source.key || source.channel || source.id, "default");
    const type = text(source.type || source.valueType, fallbackType);
    return {
      name,
      type: PORT_TYPES.has(type) ? type : fallbackType,
      schema: source.schema || source.payloadSchema || null,
      required: Boolean(source.required),
      description: text(source.description),
    };
  };

  const defaultPort = (side = "in", manifest = {}) => {
    const type = text(manifest.type || manifest.nodeType, "processor");
    const category = text(manifest.category || manifest.runtimeCategory || type, type);
    const subtype = text(manifest.subtype || manifest.mode || manifest.kind, type);
    if (side === "in") {
      if (category === "sources" && ["rest", "rss", "youtube", "websocket"].includes(subtype)) {
        return normalizePort({ name: "url", type: "string", required: true, description: "Endpoint URL" }, "string");
      }
      if (category === "sources") {
        return normalizePort({ name: "config", type: "record", description: "Source configuration input" }, "record");
      }
      return normalizePort({ name: "input", type: category === "lens" ? "any" : "object", description: "Default runtime input" }, category === "lens" ? "any" : "object");
    }
    if (category === "sources") {
      return normalizePort({ name: "raw", type: "object", description: "Default source payload output" }, "object");
    }
    return normalizePort({ name: "output", type: "object", description: "Default runtime output" }, "object");
  };

  const normalizePorts = (ports, side = "in", manifest = {}) => {
    const fallbackType = side === "in" && (manifest.category === "lens" || manifest.type === "lens" || manifest.type === "boxLens") ? "any" : "object";
    const normalized = Array.isArray(ports)
      ? ports.filter(Boolean).map((port) => normalizePort(port, fallbackType))
      : [];
    return normalized.length ? normalized : [defaultPort(side, manifest)];
  };

  const normalizeManifest = (manifest = {}) => {
    const type = text(manifest.type || manifest.nodeType, "processor");
    const category = text(manifest.category || manifest.runtimeCategory || type, type);
    const subtype = text(manifest.subtype || manifest.mode || manifest.kind, type);
    return {
      contractVersion: CONTRACT_VERSION,
      version: text(manifest.version, "1.0.0"),
      runtimeVersion: text(manifest.runtimeVersion, RUNTIME_VERSION),
      type,
      subtype,
      category,
      inputs: normalizePorts(manifest.inputs, "in", { ...manifest, type, category, subtype }),
      outputs: normalizePorts(manifest.outputs, "out", { ...manifest, type, category, subtype }),
      permissions: unique(manifest.permissions || []),
      settingsSchema: manifest.settingsSchema && typeof manifest.settingsSchema === "object" ? manifest.settingsSchema : {},
      runtime: manifest.runtime && typeof manifest.runtime === "object" ? manifest.runtime : {},
      execution: normalizeExecution(manifest),
      compatibility: manifest.compatibility && typeof manifest.compatibility === "object" ? manifest.compatibility : {},
      metadata: {
        ...(manifest.metadata || {}),
        runtimeType: type,
        subtype,
        category,
      },
      ...(manifest.render ? { render: manifest.render } : {}),
      ...(manifest.execute ? { execute: manifest.execute } : {}),
      ...(manifest.persist ? { persist: manifest.persist } : {}),
    };
  };

  const validateManifest = (manifest = {}) => {
    const normalized = normalizeManifest(manifest);
    const errors = [];
    const warnings = [];
    if (!NODE_TYPES.has(normalized.type)) errors.push(`Unsupported runtime type: ${normalized.type}`);
    if (!normalized.subtype) errors.push("Manifest subtype is required");
    if (!normalized.version) errors.push("Manifest version is required");
    if (!normalized.runtimeVersion) errors.push("Manifest runtimeVersion is required");
    const availableRuntimes = window.TrackerLensRuntimeManager?.getDefault?.().getStatus?.().availableRuntimes || ["javascript"];
    const resolution = executionContract()?.resolveRuntime?.(normalized.execution, availableRuntimes);
    if (resolution && !resolution.available) errors.push(resolution.reason);
    if (!normalized.inputs.length) errors.push(`${normalized.type} has no input ports`);
    if (!normalized.outputs.length) errors.push(`${normalized.type} has no output ports`);
    normalized.inputs.concat(normalized.outputs).forEach((port) => {
      if (!port.name) errors.push("Port name is required");
      if (!PORT_TYPES.has(port.type)) errors.push(`Unsupported port type: ${port.name}:${port.type}`);
    });
    return {
      ok: !errors.length,
      errors,
      warnings,
      manifest: normalized,
    };
  };

  return {
    CONTRACT_VERSION,
    RUNTIME_VERSION,
    EXECUTION_CONTRACT_VERSION,
    NODE_TYPES: [...NODE_TYPES],
    PORT_TYPES: [...PORT_TYPES],
    normalizePort,
    defaultPort,
    normalizeManifest,
    validateManifest,
    normalizeExecution,
    createExecutionRequest: (options = {}) => executionContract()?.createExecutionRequest?.({
      ...options,
      execution: options.execution || options.manifest?.execution || {},
      permissions: options.permissions || options.manifest?.permissions || [],
    }) || null,
    normalizeExecutionResult: (result = {}, options = {}) => executionContract()?.normalizeExecutionResult?.(result, options) || null,
  };
})();
