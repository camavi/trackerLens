window.TrackerLensRuntimeWorker = (() => {
  const WORKER_VERSION = "world-character-mode-enforce-1";
  let worker = null;
  let port = null;
  let connected = false;
  let restartSeq = 0;
  let lastStatus = {
    available: false,
    connected: false,
    mode: "none",
    workspaces: [],
    error: "",
  };
  const listeners = new Set();

  const notify = () => {
    listeners.forEach((listener) => {
      try {
        listener({ ...lastStatus });
      } catch (error) {
        console.warn("Runtime worker listener error", error);
      }
    });
  };

  const updateStatus = (patch = {}) => {
    lastStatus = { ...lastStatus, ...patch, connected };
    notify();
  };

  const handleMessage = (message = {}) => {
    if (message.type === "runtime-worker:status") {
      updateStatus({
        available: true,
        status: message.status || "ready",
        version: message.version || lastStatus.version || "",
        workspaces: message.workspaces || lastStatus.workspaces || [],
        workspaceId: message.workspaceId || lastStatus.workspaceId || "",
        nodes: message.nodes ?? lastStatus.nodes,
        dependencies: message.dependencies ?? lastStatus.dependencies,
        error: "",
      });
      return;
    }
    if (message.type === "runtime-worker:error") {
      updateStatus({
        available: true,
        status: "error",
        workspaceId: message.workspaceId || lastStatus.workspaceId || "",
        error: message.error || "Runtime worker error",
      });
    }
  };

  const workerUrl = () => `core/runtime/runtime-worker.js?v=${WORKER_VERSION}&r=${restartSeq}`;

  const disconnect = () => {
    try {
      port?.postMessage?.({ type: "runtime-worker:shutdown" });
    } catch (_) {}
    try {
      port?.close?.();
    } catch (_) {}
    try {
      worker?.terminate?.();
    } catch (_) {}
    worker = null;
    port = null;
    connected = false;
  };

  const connect = (options = {}) => {
    if (options.restart) {
      restartSeq += 1;
      disconnect();
    }
    if (port) return true;
    try {
      if ("SharedWorker" in window) {
        worker = new SharedWorker(workerUrl());
        port = worker.port;
        lastStatus.mode = "shared-worker";
        port.onmessage = (event) => handleMessage(event.data || {});
        port.start?.();
      } else if ("Worker" in window) {
        worker = new Worker(workerUrl());
        port = worker;
        lastStatus.mode = "worker";
        port.onmessage = (event) => handleMessage(event.data || {});
      } else {
        updateStatus({ available: false, connected: false, mode: "none", error: "Worker API non disponibile" });
        return false;
      }
      connected = true;
      updateStatus({ available: true, connected: true, error: "" });
      return true;
    } catch (error) {
      connected = false;
      updateStatus({ available: false, connected: false, mode: "error", error: error?.message || String(error) });
      return false;
    }
  };

  const post = (message = {}) => {
    if (!connect() || !port?.postMessage) return false;
    port.postMessage(message);
    return true;
  };

  const start = ({ workspaceId = "workspace_global", refreshMs = 5000 } = {}) =>
    post({ type: "runtime-worker:start", workspaceId, refreshMs });

  const refresh = (workspaceId = "workspace_global") =>
    post({ type: "runtime-worker:refresh", workspaceId });

  const restart = ({ workspaceId = "workspace_global", refreshMs = 5000 } = {}) => {
    if (!connect({ restart: true }) || !port?.postMessage) return false;
    port.postMessage({ type: "runtime-worker:start", workspaceId, refreshMs });
    return true;
  };

  const stop = (workspaceId = "workspace_global") =>
    post({ type: "runtime-worker:stop", workspaceId });

  const status = () => {
    post({ type: "runtime-worker:status" });
    return { ...lastStatus };
  };

  const subscribe = (listener) => {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    listener({ ...lastStatus });
    return () => listeners.delete(listener);
  };

  return {
    connect,
    start,
    refresh,
    restart,
    stop,
    status,
    subscribe,
  };
})();
