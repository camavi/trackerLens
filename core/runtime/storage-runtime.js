window.TrackerLensStorageRuntime = (() => {
  const instances = new Map();
  const DEFAULT_STORE = "tl_history";

  const nowIso = () => new Date().toISOString();

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

  const unique = (values = []) =>
    [...new Set(values.filter(Boolean).map(String))];

  const isToolAccessDependency = (dependency = {}) =>
    String(dependency.metadata?.linkType || dependency.mapping?.linkType || "") === "tool-access";

  const nodeSubtype = (node = {}) =>
    String(node.metadata?.subtype || node.metadata?.manifest?.subtype || node.metadata?.storageType || node.type || "").toLowerCase();

  const nodeConfig = (node = {}) =>
    node.metadata?.config && typeof node.metadata.config === "object" && !Array.isArray(node.metadata.config)
      ? node.metadata.config
      : {};

  const nodeStatus = (node = {}) =>
    String(node.runtime?.status || node.metadata?.runtimeStatus || node.status || "idle").toLowerCase();

  const isRunnableStorage = (node = {}) =>
    (node.type === "storage" || node.metadata?.category === "storage") &&
    !node.metadata?.library &&
    !node.metadata?.draft &&
    !["paused", "disabled", "error", "disconnected"].includes(nodeStatus(node));

  const storageInputs = (node = {}, dependencies = []) => {
    const incoming = dependencies
      .filter((dependency) => dependency.targetNodeId === node.id && !isToolAccessDependency(dependency))
      .map((dependency) => dependency.channel || dependency.metadata?.targetPort)
      .filter(Boolean);
    return unique([...(node.inputs || []), ...(node.channels || []), ...incoming]);
  };

  const safeStoreName = (value = "") => {
    const cleaned = String(value || DEFAULT_STORE).trim().replace(/[^A-Za-z0-9_-]/g, "_");
    if (!cleaned || cleaned === DEFAULT_STORE) return DEFAULT_STORE;
    return cleaned.startsWith("tl_storage_") ? cleaned : `tl_storage_${cleaned.replace(/^tl_/, "")}`;
  };
  let desktopSqliteMode = null;
  const desktopPersistence = () => window.trackers?.desktop?.persistence || null;
  const usesDesktopSqlite = async () => {
    if (desktopSqliteMode !== null) return desktopSqliteMode;
    const persistence = desktopPersistence();
    if (!persistence?.getStatus) return (desktopSqliteMode = false);
    try { desktopSqliteMode = (await persistence.getStatus())?.mode === "desktop-sqlite"; } catch (_) { desktopSqliteMode = false; }
    return desktopSqliteMode;
  };

  const writeRecord = async ({ storeName = DEFAULT_STORE, record = {} } = {}) => {
    const name = safeStoreName(storeName);
    const persistence = desktopPersistence();
    if (!await usesDesktopSqlite() || !persistence?.writeDevelopmentRecords) {
      throw new Error("Storage Runtime richiede SQLite nell'app desktop.");
    }
    await persistence.writeDevelopmentRecords({ storeName: name, records: [record] });
    return record;
  };

  const serializePayload = (payload, format = "json") => {
    if (format === "csv") {
      const value = Array.isArray(payload) ? payload : [payload];
      const rows = value.filter((item) => item && typeof item === "object" && !Array.isArray(item));
      if (!rows.length) return String(payload ?? "");
      const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
      return [
        keys.join(","),
        ...rows.map((row) => keys.map((key) => JSON.stringify(row[key] ?? "")).join(",")),
      ].join("\n");
    }
    if (typeof payload === "string") return payload;
    try {
      return JSON.stringify(payload ?? {}, null, 2);
    } catch {
      return String(payload ?? "");
    }
  };

  class StorageRuntime {
    constructor({ workspaceId = "workspace_global" } = {}) {
      this.workspaceId = workspaceId;
      this.unsubscribers = [];
      this.signature = "";
      this.bus = null;
      this.memory = new Map();
      this.runtime = { nodes: [], dependencies: [] };
      this.execution = window.TrackerLensNodeExecutionController?.get?.(this.workspaceId) || null;
    }

    stop() {
      this.unsubscribers.forEach((unsubscribe) => unsubscribe?.());
      this.unsubscribers = [];
      this.signature = "";
    }

    async log({ node, level = "info", message = "", context = {} } = {}) {
      try {
        await window.TrackerLensEventLogStore?.recordFlowLog?.({
          workspaceId: this.workspaceId,
          nodeId: node?.id || "",
          level,
          message,
          context: {
            runtime: "storage",
            subtype: nodeSubtype(node),
            ...context,
          },
        });
      } catch (error) {
        console.warn("Storage runtime log non persistito", error);
      }
    }

    buildSignature(runtime = {}) {
      const storageNodes = (runtime.nodes || [])
        .filter(isRunnableStorage)
        .map((node) => ({
          id: node.id,
          status: nodeStatus(node),
          subtype: nodeSubtype(node),
          inputs: storageInputs(node, runtime.dependencies || []),
          config: nodeConfig(node),
          incomingMappings: (runtime.dependencies || [])
            .filter((dependency) => dependency.targetNodeId === node.id)
            .map((dependency) => ({ id: dependency.id, channel: dependency.channel, metadata: dependency.metadata || {} })),
        }));
      return JSON.stringify(storageNodes);
    }

    start({ runtime = {}, workspaceId = this.workspaceId } = {}) {
      this.workspaceId = workspaceId || this.workspaceId || "workspace_global";
      this.runtime = runtime || { nodes: [], dependencies: [] };
      this.execution = window.TrackerLensNodeExecutionController?.get?.(this.workspaceId) || this.execution;
      const nextSignature = this.buildSignature(runtime);
      if (nextSignature === this.signature && this.bus) return this;
      this.stop();
      this.signature = nextSignature;
      this.bus = window.TrackerLensEventBus?.get?.(this.workspaceId, {
        eventStore: window.TrackerLensEventLogStore,
        channelRegistry: window.TrackerLensChannelRegistry,
      });
      if (!this.bus) return this;

      (runtime.nodes || []).filter(isRunnableStorage).forEach((node) => {
        storageInputs(node, runtime.dependencies || []).forEach((channel) => {
          const unsubscribe = this.bus.on(channel, (payload, event) => {
            this.handleEvent({ node, payload, event });
          }, {
            id: `storage_${node.id}_${channel}`,
            targetNodeId: node.id,
            metadata: { runtime: "storage", subtype: nodeSubtype(node) },
          });
          this.unsubscribers.push(unsubscribe);
        });
      });
      return this;
    }

    async applyIncomingMapping({ node, payload, event } = {}) {
      const dependency = window.TrackerLensRuntimeContract?.incomingDependencyForEvent?.({
        runtime: this.runtime,
        node,
        event,
      });
      const mapping = dependency?.metadata || null;
      if (!mapping || !window.TrackerLensRuntimeContract?.applyConnectionMapping) {
        return { payload, event, dependency, mappingResult: null };
      }
      const result = window.TrackerLensRuntimeContract.applyConnectionMapping(payload, mapping);
      if (result.changed || result.warnings.length) {
        await this.log({
          node,
          level: result.warnings.length ? "warning" : "info",
          message: result.warnings.length ? `Connection mapping warning: ${node.label || node.id}` : `Connection mapping applied: ${node.label || node.id}`,
          context: {
            action: "connection-mapping-applied",
            dependencyId: dependency.id || "",
            inputChannel: event?.channel || "",
            mode: result.mapping.mode,
            payloadPath: result.mapping.payloadPath,
            transformed: result.changed,
            warnings: result.warnings,
          },
        });
      }
      return {
        payload: result.payload,
        event: {
          ...event,
          meta: {
            ...(event?.meta || {}),
            mappedPayload: result.changed,
            mappingMode: result.mapping.mode,
            mappingDependencyId: dependency.id || "",
          },
        },
        dependency,
        mappingResult: result,
      };
    }

    async persist({ node, payload, event }) {
      const config = nodeConfig(node);
      const subtype = nodeSubtype(node);
      const storeName = safeStoreName(config.storeName || config.bucket || DEFAULT_STORE);
      const format = String(config.format || (subtype.includes("csv") ? "csv" : "json")).toLowerCase();
      const createdAt = nowIso();
      const record = {
        id: `storage_${node.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        workspaceId: this.workspaceId,
        nodeId: node.id,
        nodeLabel: node.label || node.id,
        channel: event.channel || "",
        inputEventId: event.id || "",
        storageSubtype: subtype,
        format,
        payload: clonePayload(payload),
        serialized: subtype.includes("export") || format !== "json" ? serializePayload(payload, format) : "",
        event: {
          id: event.id || "",
          eventType: event.eventType || "",
          sourceNodeId: event.sourceNodeId || "",
          createdAt: event.createdAt || "",
        },
        createdAt,
      };
      if (subtype === "runtime-memory") {
        this.memory.set(node.id, record);
      }
      return writeRecord({ storeName, record });
    }

    async handleEvent({ node, payload, event }) {
      if (!node?.id || event?.sourceNodeId === node.id || event?.meta?.storageRuntime === node.id) return;
      const runner = () => this.performEvent({ node, payload, event });
      if (!this.execution?.enqueue) return runner();
      return this.execution.enqueue({
        node,
        bus: this.bus,
        task: runner,
        context: {
          runtime: "storage",
          inputEventId: event?.id || "",
          inputChannel: event?.channel || "",
          runId: event?.meta?.runId || payload?.runId || "",
        },
      });
    }

    async performEvent({ node, payload, event }) {
      const startedAt = performance.now();
      try {
        const mapped = await this.applyIncomingMapping({ node, payload, event });
        payload = mapped.payload;
        event = mapped.event;
        const record = await this.persist({ node, payload, event });
        const latencyMs = Math.round(performance.now() - startedAt);
        await this.bus?.emit?.("storage.saved", {
          nodeId: node.id,
          storeName: nodeConfig(node).storeName || DEFAULT_STORE,
          recordId: record.id,
          inputChannel: event.channel || "",
        }, {
          workspaceId: this.workspaceId,
          eventType: "storage_persisted",
          sourceNodeId: node.id,
          latencyMs,
          meta: {
            storageRuntime: node.id,
            inputEventId: event.id || "",
            inputChannel: event.channel || "",
          },
        });
        await this.log({
          node,
          message: `Storage persisted event: ${node.label || node.id}`,
          context: {
            inputChannel: event.channel,
            inputEventId: event.id,
            recordId: record.id,
            storeName: nodeConfig(node).storeName || DEFAULT_STORE,
            latencyMs,
          },
        });
      } catch (error) {
        await this.bus?.emit?.("storage.error", {
          error: error.message || String(error),
          nodeId: node.id,
          payload,
        }, {
          workspaceId: this.workspaceId,
          eventType: "storage_error",
          sourceNodeId: node.id,
          status: "error",
          meta: { storageRuntime: node.id, inputEventId: event.id || "" },
        });
        await this.log({
          node,
          level: "error",
          message: `Storage error: ${error.message || error}`,
          context: { inputChannel: event.channel, inputEventId: event.id, error: error.message || String(error) },
        });
      }
    }
  }

  const get = (workspaceId = "workspace_global") => {
    const key = workspaceId || "workspace_global";
    if (!instances.has(key)) instances.set(key, new StorageRuntime({ workspaceId: key }));
    return instances.get(key);
  };

  return {
    get,
    StorageRuntime,
  };
})();
