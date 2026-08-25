const { spawn } = require("node:child_process");
const path = require("node:path");
const readline = require("node:readline");

const PROTOCOL_VERSION = "tl-python-worker/v1";
const errorWithCode = (message, code) => Object.assign(new Error(message), { code });

class ManagedPythonRuntime {
  constructor({ pythonPath = process.env.TL_PYTHON_EXECUTABLE || "python3", workerPath = path.resolve(__dirname, "../../runtimes/python/tl_python_worker.py") } = {}) {
    this.pythonPath = pythonPath;
    this.workerPath = workerPath;
    this.process = null;
    this.pending = new Map();
    this.startedAt = "";
    this.heartbeatAt = "";
    this.restartCount = 0;
    this.lastError = "";
    this.capabilities = [];
  }

  status() {
    return { runtime: "python", workerId: "managed-python-poc", status: this.process ? "ready" : "stopped", startedAt: this.startedAt, heartbeatAt: this.heartbeatAt, activeJobs: this.pending.size, restartCount: this.restartCount, lastError: this.lastError, capabilities: [...this.capabilities], protocolVersion: PROTOCOL_VERSION };
  }

  start() {
    if (this.process) return Promise.resolve(this.status());
    return new Promise((resolve, reject) => {
      const child = spawn(this.pythonPath, ["-u", this.workerPath], { stdio: ["pipe", "pipe", "pipe"] });
      this.process = child;
      const fail = (error) => {
        if (this.process === child) this.process = null;
        this.lastError = error.message;
        reject(error);
      };
      child.once("error", fail);
      child.stderr.on("data", (chunk) => { this.lastError = String(chunk).trim() || this.lastError; });
      readline.createInterface({ input: child.stdout }).on("line", (line) => this._onMessage(line, resolve));
      child.once("exit", (code) => this._onExit(code, child));
    });
  }

  _onMessage(line, readyResolve) {
    let message; try { message = JSON.parse(line); } catch (_) { return; }
    this.heartbeatAt = new Date().toISOString();
    if (message.type === "ready") {
      if (message.protocolVersion !== PROTOCOL_VERSION) {
        this.lastError = "Python protocol mismatch";
        return readyResolve?.(Promise.reject(errorWithCode(this.lastError, "PROTOCOL_ERROR")));
      }
      this.startedAt = this.heartbeatAt; this.capabilities = message.capabilities || []; readyResolve?.(this.status()); return;
    }
    const pending = this.pending.get(message.executionId);
    if (!pending) return;
    if (message.type === "event") { pending.events.push(message); return; }
    if (message.type === "result") {
      clearTimeout(pending.timeout); this.pending.delete(message.executionId);
      message.status === "success" ? pending.resolve({ ...message, events: pending.events }) : pending.reject(Object.assign(errorWithCode(message.diagnostics?.[0]?.message || message.status, message.diagnostics?.[0]?.code || "NODE_EXCEPTION"), { result: { ...message, events: pending.events } }));
    }
  }

  _onExit(code, child) {
    if (child && this.process !== child) return;
    const error = errorWithCode(`Python worker exited (${code})`, "WORKER_CRASHED"); this.lastError = error.message; this.process = null;
    for (const pending of this.pending.values()) { clearTimeout(pending.timeout); pending.reject(error); } this.pending.clear();
  }

  async execute({ executionId, operation = "text_transform", inputs = {}, context = {}, timeoutMs = 5000 } = {}) {
    await this.start();
    if (!executionId) throw errorWithCode("executionId is required", "INVALID_INPUT");
    if (this.pending.has(executionId)) throw errorWithCode("executionId is already active", "INVALID_INPUT");
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.cancel(executionId); reject(errorWithCode("Python execution timeout", "EXECUTION_TIMEOUT")); this.pending.delete(executionId); }, timeoutMs);
      this.pending.set(executionId, { resolve, reject, timeout, events: [] });
      this.process.stdin.write(JSON.stringify({ type: "execute", executionId, operation, inputs, context }) + "\n");
    });
  }

  cancel(executionId) { if (this.process && this.pending.has(executionId)) this.process.stdin.write(JSON.stringify({ type: "cancel", executionId }) + "\n"); }
  async restart() { await this.stop(); this.restartCount += 1; return this.start(); }
  async stop() {
    if (!this.process) return;
    const child = this.process;
    child.stdin.write('{"type":"shutdown"}\n');
    await new Promise((resolve) => {
      const fallback = setTimeout(() => { if (!child.killed) child.kill(); }, 250);
      child.once("exit", () => { clearTimeout(fallback); resolve(); });
    });
  }
}
module.exports = { PROTOCOL_VERSION, ManagedPythonRuntime };
