const crypto = require("node:crypto");
const sandbox = require("./custom-node-sandbox-contract.cjs");

const errorWithCode = (message, code) => Object.assign(new Error(message), { code });

// Core-owned broker state. The Electron runner will be an untrusted message
// producer; this class is deliberately independent from BrowserWindow so its
// authorization behavior is unit-testable before any package is executed.
class CustomNodeSandboxBroker {
  constructor({ onEvent = null, onToolCall = null } = {}) {
    this.onEvent = typeof onEvent === "function" ? onEvent : () => {};
    this.onToolCall = typeof onToolCall === "function" ? onToolCall : null;
    this.runs = new Map();
    this.waiters = new Map();
  }

  open({ nodeId = "", packageRecord = {}, inputs = {}, config = {}, context = {}, grantedPermissions = {} } = {}) {
    const executionId = crypto.randomUUID();
    const request = sandbox.createSandboxRequest({ executionId, nodeId, packageRecord, inputs, config, context, grantedPermissions });
    const validated = sandbox.validateSandboxRequest(request, packageRecord);
    if (!validated.ok) throw errorWithCode(validated.errors.join("; "), "CUSTOM_NODE_SANDBOX_REQUEST_INVALID");
    this.runs.set(executionId, { request, packageRecord, events: [], status: "starting" });
    return request;
  }

  receive({ executionId = "", message = {} } = {}) {
    const run = this.runs.get(String(executionId || ""));
    if (!run) throw errorWithCode("Sandbox execution non trovato.", "CUSTOM_NODE_SANDBOX_EXECUTION_UNKNOWN");
    if (["completed", "failed"].includes(run.status)) throw errorWithCode("Sandbox execution già conclusa.", "CUSTOM_NODE_SANDBOX_EXECUTION_FINISHED");
    const validated = sandbox.validateSandboxMessage(message, {
      outputs: run.packageRecord.manifest?.outputs || [],
      permissions: run.request.permissions
    });
    if (!validated.ok) throw errorWithCode(validated.errors.join("; "), "CUSTOM_NODE_SANDBOX_MESSAGE_REJECTED");
    const event = { executionId, ...validated.message };
    run.events.push(event);
    if (event.kind === "ready") run.status = "running";
    if (event.kind === "result") {
      run.status = event.status === "success" ? "completed" : "failed";
      this.settle(executionId, event);
    }
    this.onEvent(event);
    return { accepted: true, status: run.status };
  }

  fail({ executionId = "", code = "CUSTOM_NODE_SANDBOX_RUNNER_FAILED", message = "Sandbox runner non disponibile." } = {}) {
    const run = this.runs.get(String(executionId || ""));
    if (!run) return false;
    run.status = "failed";
    const event = { executionId, kind: "result", status: "failed", diagnostics: [{ code, message }] };
    run.events.push(event);
    this.settle(executionId, event);
    this.onEvent(event);
    return true;
  }

  settle(executionId = "", event = {}) {
    const waiter = this.waiters.get(String(executionId || ""));
    if (!waiter) return;
    this.waiters.delete(String(executionId || ""));
    waiter.resolve({ executionId: String(executionId || ""), ...event });
  }

  wait(executionId = "") {
    const id = String(executionId || "");
    const run = this.runs.get(id);
    if (!run) return Promise.reject(errorWithCode("Sandbox execution non trovata.", "CUSTOM_NODE_SANDBOX_EXECUTION_UNKNOWN"));
    const terminal = run.events.find((event) => event.kind === "result");
    if (terminal) return Promise.resolve({ executionId: id, ...terminal });
    if (this.waiters.has(id)) return Promise.reject(errorWithCode("Sandbox execution è già in attesa.", "CUSTOM_NODE_SANDBOX_WAIT_DUPLICATE"));
    return new Promise((resolve, reject) => this.waiters.set(id, { resolve, reject }));
  }

  async callTool({ executionId = "", message = {} } = {}) {
    const accepted = this.receive({ executionId, message: { ...message, kind: "tool.call" } });
    if (!this.onToolCall) throw errorWithCode("Custom Node tool non disponibile.", "CUSTOM_NODE_TOOL_UNAVAILABLE");
    try {
      const result = await this.onToolCall({
        executionId: String(executionId || ""),
        tool: String(message.tool || ""),
        callId: String(message.callId || ""),
        arguments: message.arguments && typeof message.arguments === "object" ? message.arguments : {},
        request: this.get(executionId)?.request || {}
      });
      return { ...accepted, callId: String(message.callId || ""), result };
    } catch (error) {
      throw errorWithCode(error?.message || "Custom Node tool failed.", error?.code || "CUSTOM_NODE_TOOL_FAILED");
    }
  }

  get(executionId = "") {
    const run = this.runs.get(String(executionId || ""));
    return run ? JSON.parse(JSON.stringify({ request: run.request, events: run.events, status: run.status })) : null;
  }
}

module.exports = { CustomNodeSandboxBroker };
