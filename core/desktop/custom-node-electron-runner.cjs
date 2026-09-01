const path = require("node:path");

// Electron adapter only: package source is supplied by a future Core-owned
// archive reader and never by the renderer. The runner page/preload are trusted
// TL assets; package JavaScript runs only in their isolated main world.
class CustomNodeElectronRunner {
  constructor({ BrowserWindow, broker, runnerPage, runnerPreload, configureSession = () => {} } = {}) {
    if (!BrowserWindow || !broker || !runnerPage || !runnerPreload) throw new Error("Custom Node Electron runner requires BrowserWindow, broker and trusted runner assets.");
    this.BrowserWindow = BrowserWindow;
    this.broker = broker;
    this.runnerPage = path.resolve(runnerPage);
    this.runnerPreload = path.resolve(runnerPreload);
    this.configureSession = configureSession;
    this.windows = new Map();
  }

  async launch({ request, source = "" } = {}) {
    if (!request?.executionId || !String(source)) throw new Error("Sandbox request and runtime source are required.");
    const partition = `trackers-custom-node-${request.executionId}`;
    this.configureSession(partition);
    const window = new this.BrowserWindow({
      show: false,
      webPreferences: {
        preload: this.runnerPreload,
        partition,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true
      }
    });
    this.windows.set(request.executionId, window);
    window.on("closed", () => {
      this.windows.delete(request.executionId);
      const run = this.broker.get(request.executionId);
      if (run && !["completed", "failed"].includes(run.status)) {
        this.broker.fail({
          executionId: request.executionId,
          code: "CUSTOM_NODE_SANDBOX_WINDOW_CLOSED",
          message: "La finestra sandbox del Custom Node è stata chiusa prima del risultato."
        });
      }
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.webContents.on("will-attach-webview", (event) => event.preventDefault());
    await window.loadFile(this.runnerPage);
    window.webContents.send("trackers-custom-node-sandbox:initialize", { request, source: String(source) });
    return { executionId: request.executionId, senderId: window.webContents.id };
  }

  receive({ senderId = 0, message = {} } = {}) {
    const matching = [...this.windows.entries()].find(([, window]) => !window.isDestroyed() && window.webContents.id === Number(senderId));
    if (!matching) throw Object.assign(new Error("Sandbox sender non autorizzato."), { code: "CUSTOM_NODE_SANDBOX_SENDER_INVALID" });
    const [executionId] = matching;
    return this.broker.receive({ executionId, message });
  }

  callTool({ senderId = 0, message = {} } = {}) {
    const matching = [...this.windows.entries()].find(([, window]) => !window.isDestroyed() && window.webContents.id === Number(senderId));
    if (!matching) throw Object.assign(new Error("Sandbox sender non autorizzato."), { code: "CUSTOM_NODE_SANDBOX_SENDER_INVALID" });
    const [executionId] = matching;
    return this.broker.callTool({ executionId, message });
  }

  close(executionId = "") {
    const window = this.windows.get(String(executionId));
    if (window && !window.isDestroyed()) window.destroy();
  }
}

module.exports = { CustomNodeElectronRunner };
