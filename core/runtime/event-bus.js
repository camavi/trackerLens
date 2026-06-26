window.TrackerLensEventBus = (() => {
  const buses = new Map();
  const BROADCAST_NAME = "trackers-lens-event-bus";

  const nowIso = () => new Date().toISOString();

  const eventId = () => {
    if (window.crypto?.randomUUID) return `tlevent_${crypto.randomUUID()}`;
    return `tlevent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  };

  const clonePayload = (payload) => {
    if (payload === null || payload === undefined) return payload;
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

  const payloadTextOf = (payload, fallback = "") => {
    if (fallback) return String(fallback);
    try {
      return JSON.stringify(payload || {});
    } catch {
      return String(payload || "");
    }
  };

  const safeChannel = (value = "default") =>
    String(value || "default").trim() || "default";

  class TLEventBus {
    constructor({ workspaceId = "global", eventStore = null, channelRegistry = null } = {}) {
      this.workspaceId = workspaceId || "global";
      this.eventStore = eventStore;
      this.channelRegistry = channelRegistry;
      this.channels = new Map();
      this.lastValues = new Map();
      this.logs = [];
      this.maxLogs = 300;
      this.instanceId = eventId();
      this.broadcast = this.createBroadcastChannel();
    }

    createBroadcastChannel() {
      if (typeof BroadcastChannel === "undefined") return null;
      try {
        const channel = new BroadcastChannel(BROADCAST_NAME);
        channel.onmessage = (message) => this.receiveBroadcast(message?.data);
        return channel;
      } catch (error) {
        console.warn("Event Bus: BroadcastChannel non disponibile", error);
        return null;
      }
    }

    configure({ workspaceId, eventStore, channelRegistry } = {}) {
      if (workspaceId) this.workspaceId = workspaceId;
      if (eventStore !== undefined) this.eventStore = eventStore;
      if (channelRegistry !== undefined) this.channelRegistry = channelRegistry;
      return this;
    }

    on(channel = "default", callback, options = {}) {
      if (typeof callback !== "function") return () => {};
      const name = safeChannel(channel);
      if (!this.channels.has(name)) this.channels.set(name, new Set());
      const subscription = {
        callback,
        id: options.id || `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        sourceNodeId: options.sourceNodeId || "",
        targetNodeId: options.targetNodeId || "",
        connectionId: options.connectionId || "",
        metadata: options.metadata || {},
      };
      this.channels.get(name).add(subscription);
      return () => this.off(name, subscription);
    }

    off(channel = "default", subscription) {
      const listeners = this.channels.get(safeChannel(channel));
      if (!listeners) return false;
      return listeners.delete(subscription);
    }

    listeners(channel = "default") {
      return Array.from(this.channels.get(safeChannel(channel)) || []);
    }

    getLast(channel = "default") {
      return this.lastValues.get(safeChannel(channel)) || null;
    }

    localLogs() {
      return [...this.logs];
    }

    remember(event) {
      this.lastValues.set(event.channel, event);
      this.logs.unshift(event);
      this.logs = this.logs.slice(0, this.maxLogs);
    }

    async recordEvent(event, payloadText = "") {
      if (!this.eventStore?.recordEvent) return null;
      try {
        return await this.eventStore.recordEvent({
          id: event.id,
          workspaceId: event.workspaceId,
          flowId: event.flowId || "",
          channel: event.channel,
          eventType: event.eventType,
          sourceNodeId: event.sourceNodeId || "",
          targetNodeId: event.targetNodeId || "",
          connectionId: event.connectionId || "",
          payload: event.payload,
          payloadText,
          status: event.status,
          latencyMs: event.latencyMs,
        });
      } catch (error) {
        console.warn("Event Bus: evento non persistito", error);
        return null;
      }
    }

    async updateChannel(event) {
      if (!this.channelRegistry?.recordEmission) return null;
      try {
        return await this.channelRegistry.recordEmission({
          workspaceId: event.workspaceId,
          channel: event.channel,
          sourceNodeId: event.sourceNodeId,
          payload: event.payload,
          emittedAt: event.createdAt,
        });
      } catch (error) {
        console.warn("Event Bus: channel lastValue non aggiornato", error);
        return null;
      }
    }

    deliver(event) {
      const listeners = this.listeners(event.channel).concat(this.listeners("*"));
      listeners.forEach((subscription) => {
        try {
          subscription.callback(event.payload, {
            ...event,
            subscription,
          });
        } catch (error) {
          console.error("[TLEventBus] listener error", error);
          this.recordEvent({
            ...event,
            id: eventId(),
            eventType: "delivery_error",
            targetNodeId: subscription.targetNodeId || event.targetNodeId || "",
            connectionId: subscription.connectionId || event.connectionId || "",
            payload: { error: error.message || String(error) },
            status: "error",
            createdAt: nowIso(),
          });
        }
      });

      return event;
    }

    receiveBroadcast(message = {}) {
      if (message.type !== "tl-runtime-event" || message.originId === this.instanceId || !message.event) return;
      const event = message.event;
      if ((event.workspaceId || "global") !== (this.workspaceId || "global")) return;
      this.remember(event);
      this.deliver(event);
    }

    broadcastEvent(event) {
      if (!this.broadcast) return;
      try {
        this.broadcast.postMessage({
          type: "tl-runtime-event",
          originId: this.instanceId,
          event,
        });
      } catch (error) {
        console.warn("Event Bus: evento non inviato via BroadcastChannel", error);
      }
    }

    async emit(channel = "default", payload = {}, meta = {}) {
      const name = safeChannel(channel);
      const payloadSnapshot = clonePayload(payload);
      const payloadText = payloadTextOf(payloadSnapshot, meta.payloadText);
      const event = {
        id: eventId(),
        workspaceId: meta.workspaceId || this.workspaceId || "global",
        flowId: meta.flowId || "",
        channel: name,
        eventType: meta.eventType || "emitted",
        sourceNodeId: meta.sourceNodeId || "",
        targetNodeId: meta.targetNodeId || "",
        connectionId: meta.connectionId || "",
        payload: payloadSnapshot,
        status: meta.status || "ok",
        latencyMs: Number(meta.latencyMs) || 0,
        sizeBytes: new Blob([payloadText]).size,
        createdAt: nowIso(),
        meta: { ...(meta.meta || {}) },
      };

      this.remember(event);

      await Promise.all([
        this.recordEvent(event, payloadText),
        this.updateChannel(event),
      ]);

      this.deliver(event);
      this.broadcastEvent(event);
      return event;
    }
  }

  const create = (options = {}) => new TLEventBus(options);

  const get = (workspaceId = "global", options = {}) => {
    const key = workspaceId || "global";
    if (!buses.has(key)) buses.set(key, create({ ...options, workspaceId: key }));
    return buses.get(key).configure({ ...options, workspaceId: key });
  };

  return {
    create,
    get,
  };
})();
