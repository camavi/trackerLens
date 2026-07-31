window.TrackerLensActionRuntime = (() => {
  const instances = new Map();

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
    String(node.metadata?.subtype || node.metadata?.manifest?.subtype || node.metadata?.actionType || node.type || "").toLowerCase();

  const nodeConfig = (node = {}) =>
    node.metadata?.config && typeof node.metadata.config === "object" && !Array.isArray(node.metadata.config)
      ? node.metadata.config
      : {};

  const nodeStatus = (node = {}) =>
    String(node.runtime?.status || node.metadata?.runtimeStatus || node.status || "idle").toLowerCase();

  const isRunnableAction = (node = {}) =>
    (node.type === "action" || node.metadata?.category === "actions") &&
    !node.metadata?.library &&
    !node.metadata?.draft &&
    !["paused", "disabled", "error", "disconnected"].includes(nodeStatus(node));

  const actionInputs = (node = {}, dependencies = []) => {
    const incoming = dependencies
      .filter((dependency) => dependency.targetNodeId === node.id && !isToolAccessDependency(dependency))
      .map((dependency) => dependency.channel || dependency.metadata?.targetPort)
      .filter(Boolean);
    return unique([...(node.inputs || []), ...incoming]);
  };

  const getPath = (source, path = "") => {
    const clean = String(path || "").trim();
    if (!clean) return "";
    const normalized = clean
      .replace(/^payload\./, "")
      .replace(/^event\./, "event.")
      .replace(/^node\./, "node.")
      .replace(/^config\./, "config.");
    return normalized
      .replace(/\[(\d+)\]/g, ".$1")
      .split(".")
      .filter(Boolean)
      .reduce((value, key) => value?.[key], source);
  };

  const templateValue = (token = "", context = {}) => {
    const key = String(token || "").trim();
    if (key === "payload") return context.payload;
    if (key === "event") return context.event;
    if (key === "node") return context.node;
    if (key === "config") return context.config;
    if (key.startsWith("payload.")) return getPath(context.payload, key);
    if (key.startsWith("event.")) return getPath({ event: context.event }, key);
    if (key.startsWith("node.")) return getPath({ node: context.node }, key);
    if (key.startsWith("config.")) return getPath({ config: context.config }, key);
    return getPath(context.payload, key);
  };

  const renderTemplate = (template = "", context = {}) =>
    String(template || "").replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, token) => {
      const value = templateValue(token, context);
      if (value === undefined || value === null) return "";
      if (typeof value === "object") return JSON.stringify(value);
      return String(value);
    });

  const actionPayload = ({ node, payload, event, config }) => {
    const context = { node, payload, event, config };
    const template = String(config.template || "").trim();
    if (!template) {
      return {
        text: `${node.label || node.id} received ${event.channel || "event"}`,
        payload: clonePayload(payload),
        event: {
          id: event.id || "",
          channel: event.channel || "",
          eventType: event.eventType || "",
          createdAt: event.createdAt || "",
        },
      };
    }
    const rendered = renderTemplate(template, context);
    try {
      return JSON.parse(rendered);
    } catch {
      return { text: rendered, payload: clonePayload(payload) };
    }
  };

  const smartTelegramPayload = ({ node, payload = {}, event = {} } = {}) => {
    const source = payload?.payload && payload.text ? payload.payload : payload;
    const symbol = source?.symbol || source?.data?.s || "";
    const price = source?.price ?? source?.data?.c ?? "";
    const changePercent = source?.changePercent ?? source?.data?.P ?? "";
    const receivedAt = source?.receivedAt || source?.emittedAt || source?.createdAt || "";
    if (symbol || price !== "") {
      return {
        text: [
          `${symbol || "BTC"} ${price !== "" ? `${price} USDT` : ""}`.trim(),
          changePercent !== "" ? `Change: ${changePercent}%` : "",
          source?.source ? `Source: ${source.source}` : "",
          receivedAt ? `At: ${receivedAt}` : "",
        ].filter(Boolean).join("\n"),
        payload: clonePayload(source),
      };
    }
    return {
      text: payload?.text || payload?.message || `${node.label || node.id} received ${event.channel || "event"}`,
      payload: clonePayload(payload),
    };
  };

  const shouldUseFetch = (target = "") => /^https?:\/\//i.test(String(target || "").trim());

  const parseHeaders = (value = "") => {
    if (!value || typeof value === "object") return value && !Array.isArray(value) ? value : {};
    try {
      const parsed = JSON.parse(String(value));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  };

  const classifyFetchRuntimeError = (error = {}) => {
    const name = String(error?.name || "");
    if (name === "AbortError") return "abort";
    if (name === "TypeError") return "network-or-cors";
    return "fetch-error";
  };

  const fetchErrorDiagnostic = (kind = "") =>
    kind === "network-or-cors"
      ? "Browser fetch did not expose an HTTP status. Check URL, DNS, TLS, CORS policy, mixed content or blocked request in DevTools Network."
      : kind === "abort"
        ? "Request was cancelled or timed out before an HTTP response was available."
        : "Fetch failed before a readable HTTP response was available.";

  const fetchJson = async ({ target, body, method = "POST", headers = {} }) => {
    let response;
    try {
      response = await fetch(target, {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    } catch (error) {
      const errorKind = classifyFetchRuntimeError(error);
      error.runtimeRequest = {
        type: "fetch",
        errorKind,
        errorName: error?.name || "",
        diagnostic: fetchErrorDiagnostic(errorKind),
        requestUrl: target,
        endpoint: target,
        method,
        status: null,
      };
      throw error;
    }
    const text = await response.text().catch(() => "");
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}${text ? `: ${text}` : ""}`);
      error.runtimeRequest = {
        type: "fetch",
        errorKind: "http",
        requestUrl: target,
        endpoint: target,
        method,
        status: response.status,
        statusText: response.statusText || "",
      };
      throw error;
    }
    return { status: response.status, ok: true, endpoint: target, method, body: text };
  };

  const telegramTarget = (config = {}) => {
    const target = String(config.target || "").trim();
    if (shouldUseFetch(target)) return target;
    const botToken = String(config.botToken || "").trim();
    return botToken ? `https://api.telegram.org/bot${botToken}/sendMessage` : "";
  };

  const telegramBody = (body = {}, config = {}) => ({
    chat_id: config.chatId || body.chat_id || body.chatId || "",
    text: body.text || body.message || JSON.stringify(body.payload || body),
    parse_mode: config.parseMode || body.parse_mode || undefined,
  });

  const whatsappBody = (body = {}, config = {}) => {
    if (body.messaging_product || body.to || body.type) return body;
    return {
      messaging_product: "whatsapp",
      to: config.to || body.recipient || "",
      type: "text",
      text: { body: body.text || body.message || JSON.stringify(body.payload || body) },
    };
  };

  const textWebhookBody = (body = {}) => {
    if (body.text || body.content || body.blocks || body.attachments) return body;
    return { text: body.message || JSON.stringify(body.payload || body) };
  };

  const runBrowserNotification = async ({ title, body }) => {
    if (typeof Notification === "undefined") return { skipped: true, reason: "Notification API non disponibile" };
    if (Notification.permission === "default") {
      await Notification.requestPermission();
    }
    if (Notification.permission !== "granted") return { skipped: true, reason: `Notification permission ${Notification.permission}` };
    new Notification(title, { body });
    return { ok: true };
  };

  class ActionRuntime {
    constructor({ workspaceId = "workspace_global" } = {}) {
      this.workspaceId = workspaceId;
      this.unsubscribers = [];
      this.signature = "";
      this.bus = null;
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
            runtime: "action",
            subtype: nodeSubtype(node),
            ...context,
          },
        });
      } catch (error) {
        console.warn("Action runtime log non persistito", error);
      }
    }

    buildSignature(runtime = {}) {
      const actions = (runtime.nodes || [])
        .filter(isRunnableAction)
        .map((node) => ({
          id: node.id,
          status: nodeStatus(node),
          subtype: nodeSubtype(node),
          inputs: actionInputs(node, runtime.dependencies || []),
          config: nodeConfig(node),
          incomingMappings: (runtime.dependencies || [])
            .filter((dependency) => dependency.targetNodeId === node.id)
            .map((dependency) => ({ id: dependency.id, channel: dependency.channel, metadata: dependency.metadata || {} })),
        }));
      return JSON.stringify(actions);
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

      (runtime.nodes || []).filter(isRunnableAction).forEach((node) => {
        actionInputs(node, runtime.dependencies || []).forEach((channel) => {
          const unsubscribe = this.bus.on(channel, (payload, event) => {
            this.handleEvent({ node, payload, event });
          }, {
            id: `action_${node.id}_${channel}`,
            targetNodeId: node.id,
            metadata: { runtime: "action", subtype: nodeSubtype(node) },
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

    async execute({ node, payload, event }) {
      const subtype = nodeSubtype(node);
      const config = nodeConfig(node);
      const body = actionPayload({ node, payload, event, config });
      const target = String(config.target || "").trim();

      if (subtype === "telegram") {
        const target = telegramTarget(config);
        if (!shouldUseFetch(target)) return { skipped: true, reason: "Telegram botToken/target mancante", target };
        const telegramPayload = String(config.template || "").trim() ? body : smartTelegramPayload({ node, payload, event });
        return fetchJson({ target, body: telegramBody(telegramPayload, config), headers: parseHeaders(config.headers) });
      }

      if (subtype === "whatsapp") {
        if (!shouldUseFetch(target)) return { skipped: true, reason: "WhatsApp API/provider URL mancante", target };
        const headers = parseHeaders(config.headers);
        if (config.accessToken && !headers.Authorization) {
          headers.Authorization = String(config.accessToken).trim().startsWith("Bearer ")
            ? String(config.accessToken).trim()
            : `Bearer ${config.accessToken}`;
        }
        return fetchJson({ target, body: whatsappBody(body, config), headers });
      }

      if (["webhook-call", "webhook-post", "discord", "slack", "email"].includes(subtype)) {
        if (!shouldUseFetch(target)) return { skipped: true, reason: "Target HTTP mancante", target };
        return fetchJson({ target, body: ["discord", "slack"].includes(subtype) ? textWebhookBody(body) : body, headers: parseHeaders(config.headers) });
      }

      if (subtype === "http-write") {
        if (!shouldUseFetch(target)) return { skipped: true, reason: "Target HTTP mancante", target };
        const method = ["PUT", "PATCH", "POST"].includes(String(config.method || "").toUpperCase())
          ? String(config.method).toUpperCase()
          : "PUT";
        return fetchJson({ target, body, method, headers: parseHeaders(config.headers) });
      }

      if (subtype === "notification") {
        return runBrowserNotification({
          title: node.label || "Trackers Lens",
          body: body.text || JSON.stringify(body.payload || body),
        });
      }

      if (subtype === "sound-alert") {
        if (!config.soundUrl) return { skipped: true, reason: "Sound URL mancante" };
        const audio = new Audio(config.soundUrl);
        await audio.play();
        return { ok: true };
      }

      if (subtype === "popup-alert") {
        window.dispatchEvent(new CustomEvent("tl-runtime-popup-alert", {
          detail: { workspaceId: this.workspaceId, nodeId: node.id, body, event },
        }));
        return { ok: true };
      }

      if (subtype === "runtime-trigger") {
        const channel = config.targetChannel || config.output || node.outputs?.[0] || "trigger";
        await this.bus.emit(channel, body, {
          workspaceId: this.workspaceId,
          eventType: "action_trigger",
          sourceNodeId: node.id,
          meta: {
            actionRuntime: node.id,
            inputEventId: event.id || "",
            inputChannel: event.channel || "",
          },
        });
        return { ok: true, emittedChannel: channel };
      }

      return { ok: true, simulated: true, body };
    }

    async testNode({ node, payload = null } = {}) {
      if (!this.bus) {
        this.bus = window.TrackerLensEventBus?.get?.(this.workspaceId, {
          eventStore: window.TrackerLensEventLogStore,
          channelRegistry: window.TrackerLensChannelRegistry,
        });
      }
      const testPayload = payload || {
        text: `Trackers Lens test message from ${node?.label || "Telegram Message"}`,
        payload: {
          source: "Trackers Lens",
          test: true,
          sentAt: new Date().toISOString(),
        },
      };
      const event = {
        id: `action_test_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        channel: "manual.test",
        eventType: "action_manual_test",
        createdAt: new Date().toISOString(),
      };
      return this.performEvent({ node, payload: testPayload, event });
    }

    async handleEvent({ node, payload, event }) {
      if (!node?.id || event?.sourceNodeId === node.id || event?.meta?.actionRuntime === node.id) return;
      const runner = () => this.performEvent({ node, payload, event });
      if (!this.execution?.enqueue) return runner();
      return this.execution.enqueue({
        node,
        bus: this.bus,
        task: runner,
        context: {
          runtime: "action",
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
        const result = await this.execute({ node, payload, event });
        const latencyMs = Math.round(performance.now() - startedAt);
        await this.bus?.emit?.(`action.${nodeSubtype(node) || "executed"}`, {
          nodeId: node.id,
          result,
          inputChannel: event.channel || "",
        }, {
          workspaceId: this.workspaceId,
          eventType: "action_executed",
          sourceNodeId: node.id,
          latencyMs,
          meta: {
            actionRuntime: node.id,
            inputEventId: event.id || "",
            inputChannel: event.channel || "",
          },
        });
        await this.log({
          node,
          message: `Action executed: ${node.label || node.id}`,
          context: { inputChannel: event.channel, inputEventId: event.id, result, latencyMs },
        });
        return { ok: true, result, latencyMs };
      } catch (error) {
        await this.bus?.emit?.("action.error", {
          error: error.message || String(error),
          nodeId: node.id,
          payload,
        }, {
          workspaceId: this.workspaceId,
          eventType: "action_error",
          sourceNodeId: node.id,
          status: "error",
          meta: { actionRuntime: node.id, inputEventId: event.id || "" },
        });
        await this.log({
          node,
          level: "error",
          message: `Action error: ${error.message || error}`,
          context: {
            inputChannel: event.channel,
            inputEventId: event.id,
            error: error.message || String(error),
            ...(error.runtimeRequest || {}),
          },
        });
        return { ok: false, error: error.message || String(error) };
      }
    }
  }

  const get = (workspaceId = "workspace_global") => {
    const key = workspaceId || "workspace_global";
    if (!instances.has(key)) instances.set(key, new ActionRuntime({ workspaceId: key }));
    return instances.get(key);
  };

  return {
    get,
  };
})();
