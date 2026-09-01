const { contextBridge, ipcRenderer } = require("electron");

// This is the only API exposed to untrusted package code. Main binds each
// message to the owning sandbox webContents and Core validates it again.
contextBridge.exposeInMainWorld("tlCustomNodeSandbox", Object.freeze({
  post: (message = {}) => ipcRenderer.invoke("trackers-custom-node-sandbox:message", message && typeof message === "object" ? message : {}),
  callTool: (message = {}) => ipcRenderer.invoke("trackers-custom-node-sandbox:tool", message && typeof message === "object" ? message : {}),
  onInitialize: (listener) => {
    if (typeof listener !== "function") return () => {};
    const handler = (_event, payload) => listener(payload && typeof payload === "object" ? payload : {});
    ipcRenderer.on("trackers-custom-node-sandbox:initialize", handler);
    return () => ipcRenderer.removeListener("trackers-custom-node-sandbox:initialize", handler);
  }
}));
