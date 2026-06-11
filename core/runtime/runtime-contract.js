window.TrackerLensRuntimeContract = (() => {
  const CONTRACT_VERSION = "2026-06-runtime-contract/v1";
  const WORKSPACE_STORE = "tl_pages";
  const FLOW_STORE = "tl_flows";
  const NODE_STORE = "tl_runtime_nodes";
  const DEPENDENCY_STORE = "tl_runtime_dependencies";
  const CONNECTION_STORE = "tl_connections";
  const CHANNEL_STORE = "tl_channels";
  const EVENT_STORE = "tl_events";
  const FLOW_LOG_STORE = "tl_flow_logs";

  const RUNTIME_CHAIN = [
    "Workspace/Page",
    "Flow",
    "Runtime Node",
    "Runtime Dependency",
    "Connection",
    "Channel",
    "Event/Flow Log",
  ];

  const text = (value, fallback = "") =>
    String(value ?? "").trim() || fallback;

  const unique = (values = []) =>
    [...new Set(values.filter(Boolean).map(String))];

  const normalizeOptions = (options = []) => {
    if (Array.isArray(options)) {
      return options.map((option) => {
        if (option && typeof option === "object") {
          const value = text(option.value || option.label);
          return value ? { value, label: text(option.label, value) } : null;
        }
        const value = text(option);
        return value ? { value, label: value } : null;
      }).filter(Boolean);
    }
    return text(options)
      .split("|")
      .map((option) => text(option))
      .filter(Boolean)
      .map((value) => ({ value, label: value }));
  };

  const normalizeField = (key = "", source = {}) => {
    const scalarType = typeof source === "string" ? source : "";
    const definition = source && typeof source === "object" && !Array.isArray(source) ? source : {};
    const type = text(definition.type || definition.kind || scalarType || "string", "string");
    const options = normalizeOptions(definition.options || (type.includes("|") ? type : []));
    return {
      key: text(definition.key || definition.name || key, key),
      label: text(definition.label || definition.title || key, key),
      type: options.length && !definition.type ? "select" : type,
      options: options.length ? options.map((option) => option.value) : [],
      required: Boolean(definition.required),
      defaultValue: definition.defaultValue ?? definition.default ?? "",
      placeholder: text(definition.placeholder || definition.description),
      description: text(definition.description),
      source: definition.source || "schema",
    };
  };

  const normalizeSettingsSchema = (schema = {}) => {
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) return [];
    return Object.entries(schema)
      .map(([key, definition]) => normalizeField(key, definition))
      .filter((field) => field.key);
  };

  const schemaKeys = (schema = {}) =>
    normalizeSettingsSchema(schema).map((field) => field.key);

  const normalizeConnectionMapping = ({
    sourcePort = "all",
    targetPort = "all",
    channel = "",
    mode = "pass-through",
    payloadPath = "",
    transform = "",
    note = "",
    linkType = "data",
  } = {}) => ({
    sourcePort: text(sourcePort, "all"),
    targetPort: text(targetPort, "all"),
    channel: text(channel),
    mode: text(mode, "pass-through"),
    payloadPath: text(payloadPath),
    transform: text(transform),
    note: text(note),
    linkType: text(linkType, "data"),
  });

  const clonePayload = (payload) => {
    try {
      if (typeof structuredClone === "function") return structuredClone(payload);
    } catch {
      // JSON fallback below.
    }
    try {
      return JSON.parse(JSON.stringify(payload));
    } catch {
      return payload;
    }
  };

  const valueAtPath = (source, path = "") => {
    const clean = text(path)
      .replace(/^\$\.?/, "")
      .replace(/^payload\./, "")
      .replace(/^\./, "");
    if (!clean || clean === "payload") return source;
    return clean
      .replace(/\[(\d+)\]/g, ".$1")
      .split(".")
      .filter(Boolean)
      .reduce((value, key) => value?.[key], source);
  };

  const coerceMappedValue = (value, type = "") => {
    const normalized = text(type).toLowerCase();
    if (normalized === "number" || normalized === "float") {
      const next = Number(value);
      return Number.isNaN(next) ? null : next;
    }
    if (normalized === "integer" || normalized === "int") {
      const next = Number.parseInt(value, 10);
      return Number.isNaN(next) ? null : next;
    }
    if (normalized === "boolean" || normalized === "bool") {
      if (typeof value === "boolean") return value;
      return ["true", "1", "yes", "on"].includes(String(value ?? "").toLowerCase());
    }
    if (normalized === "string" || normalized === "text") return value === undefined || value === null ? "" : String(value);
    return value;
  };

  const mapExpressionValue = (payload, expression = "", current = {}) => {
    const raw = text(expression);
    if (!raw) return null;
    if (raw === "payload") return clonePayload(payload);
    if (raw === "runtime") return "Trackers Lens";
    if (raw === "receivedAt") return new Date().toISOString();
    if (raw === "runtime_signal") return current.signal || "runtime";
    if (raw === "runtime_alert_message") return current.message || "";
    const [maybeType, ...pathParts] = raw.split(":");
    if (pathParts.length) {
      return coerceMappedValue(valueAtPath(payload, pathParts.join(":")), maybeType);
    }
    return valueAtPath(payload, raw);
  };

  const parseJsonMap = (transform = "") => {
    if (!transform || typeof transform === "object") return transform && !Array.isArray(transform) ? transform : null;
    try {
      const parsed = JSON.parse(String(transform));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  const renderTemplate = (template = "", payload = {}) =>
    String(template || "").replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, token) => {
      const value = valueAtPath(payload, token);
      if (value === undefined || value === null) return "";
      return typeof value === "object" ? JSON.stringify(value) : String(value);
    });

  const mappingChangesPayload = (original, mapped) => {
    try {
      return JSON.stringify(original) !== JSON.stringify(mapped);
    } catch {
      return original !== mapped;
    }
  };

  const applyConnectionMapping = (payload, mapping = {}) => {
    const normalized = normalizeConnectionMapping(mapping);
    const mode = normalized.mode || "pass-through";
    const source = normalized.payloadPath ? valueAtPath(payload, normalized.payloadPath) : payload;
    let mapped = source;
    const warnings = [];
    if (mode === "pass-through") {
      mapped = source;
    } else if (mode === "path") {
      mapped = source;
    } else if (mode === "json-map") {
      const map = parseJsonMap(normalized.transform);
      if (!map) {
        warnings.push("json-map transform is not valid JSON object");
        mapped = source;
      } else {
        mapped = Object.entries(map).reduce((result, [key, expression]) => {
          result[key] = mapExpressionValue(source, expression, result);
          return result;
        }, {});
      }
    } else if (mode === "template") {
      mapped = renderTemplate(normalized.transform, source);
      try {
        mapped = JSON.parse(mapped);
      } catch {
        // Text templates are valid runtime payloads.
      }
    } else if (mode === "custom-transform") {
      warnings.push("custom-transform execution is disabled until sandboxed");
      mapped = source;
    } else {
      warnings.push(`unknown mapping mode: ${mode}`);
      mapped = source;
    }
    return {
      ok: !warnings.length,
      payload: clonePayload(mapped),
      originalPayload: payload,
      mapping: normalized,
      changed: mappingChangesPayload(payload, mapped),
      warnings,
    };
  };

  const incomingDependencyForEvent = ({ runtime = {}, node = {}, event = {} } = {}) => {
    const dependencies = runtime.dependencies || [];
    return dependencies.find((dependency) =>
      dependency.targetNodeId === node.id &&
      (!event.channel || dependency.channel === event.channel || dependency.metadata?.targetPort === event.channel) &&
      (!event.sourceNodeId || !dependency.sourceNodeId || dependency.sourceNodeId === event.sourceNodeId)) ||
      dependencies.find((dependency) =>
        dependency.targetNodeId === node.id &&
        (!event.channel || dependency.channel === event.channel || dependency.metadata?.targetPort === event.channel)) ||
      null;
  };

  const stores = () => ({
    workspace: WORKSPACE_STORE,
    flow: FLOW_STORE,
    runtimeNodes: NODE_STORE,
    runtimeDependencies: DEPENDENCY_STORE,
    connections: CONNECTION_STORE,
    channels: CHANNEL_STORE,
    events: EVENT_STORE,
    flowLogs: FLOW_LOG_STORE,
  });

  return {
    CONTRACT_VERSION,
    RUNTIME_CHAIN,
    stores,
    normalizeField,
    normalizeSettingsSchema,
    normalizeConnectionMapping,
    applyConnectionMapping,
    incomingDependencyForEvent,
    valueAtPath,
    schemaKeys,
    unique,
  };
})();
