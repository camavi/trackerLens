(() => {
  const bridge = globalThis.tlCustomNodeSandbox;
  if (!bridge?.onInitialize || !bridge?.post) return;
  const post = (message) => bridge.post(message).catch(() => {});
  bridge.onInitialize(async ({ request = {}, source = "" } = {}) => {
    try {
      const url = URL.createObjectURL(new Blob([String(source)], { type: "text/javascript" }));
      const runtime = await import(url);
      URL.revokeObjectURL(url);
      if (typeof runtime.run !== "function") throw new Error("runtime.js deve esportare run().");
      await post({ kind: "ready" });
      const emit = (port, data) => post({ kind: "emit", port: String(port || ""), data });
      const log = (message, data = {}) => post({ kind: "log", message: String(message || ""), data });
      let sequence = 0;
      const toolCall = async (tool, args = {}) => {
        if (typeof bridge.callTool !== "function") throw new Error("Custom Node tool bridge unavailable.");
        const result = await bridge.callTool({ kind: "tool.call", tool, callId: `${request.executionId || "run"}_${++sequence}`, arguments: args && typeof args === "object" ? args : {} });
        return result?.result;
      };
      const tools = Object.freeze({
        ai: Object.freeze({ complete: (args = {}) => toolCall("ai.complete", args) }),
        memory: Object.freeze({ read: (args = {}) => toolCall("memory.read", args), write: (args = {}) => toolCall("memory.write", args) }),
        runtimeGraph: Object.freeze({ read: (args = {}) => toolCall("runtimeGraph.read", args), preflight: (args = {}) => toolCall("runtimeGraph.preflight", args) })
      });
      const outputs = await runtime.run({ input: request.inputs || {}, config: request.config || {}, tools, emit, log });
      await post({ kind: "result", status: "success", outputs });
    } catch (error) {
      await post({ kind: "result", status: "failed", diagnostics: [{ code: "CUSTOM_NODE_RUNTIME_ERROR", message: error?.message || String(error) }] });
    }
  });
})();
