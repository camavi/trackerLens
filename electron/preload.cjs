const { contextBridge, ipcRenderer } = require("electron");

const request = (command, payload = {}) => ipcRenderer.invoke("trackers-core:request", command, payload);
const pythonPocEnabled = process.argv.includes("--tl-python-poc=1");
const pythonNlpEnabled = process.argv.includes("--tl-python-nlp=1");

const trackers = Object.freeze({
  desktop: Object.freeze({
    getStatus: () => request("desktop.getStatus"),
    openExternal: (url) => request("desktop.openExternal", { url: String(url || "") }),
    persistence: Object.freeze({
      getStatus: () => request("desktop.persistence.getStatus"),
      planImport: (bundle = {}) => request("desktop.persistence.planImport", { bundle }),
      planBackupManifest: (catalog = {}) => request("desktop.persistence.planBackupManifest", { catalog }),
      importDevelopmentFirstCohort: (bundle = {}) => request("desktop.persistence.importDevelopmentFirstCohort", { bundle }),
      verifyDevelopmentFirstCohort: (bundle = {}) => request("desktop.persistence.verifyDevelopmentFirstCohort", { bundle }),
      listDevelopmentStores: () => request("desktop.persistence.listDevelopmentStores"),
      readDevelopmentRecords: ({ storeName, workspaceId = "" } = {}) => request("desktop.persistence.readDevelopmentRecords", { storeName: String(storeName || ""), workspaceId: String(workspaceId || "") }),
      writeDevelopmentRecords: ({ storeName, records = [] } = {}) => request("desktop.persistence.writeDevelopmentRecords", { storeName: String(storeName || ""), records }),
      deleteDevelopmentRecords: ({ storeName, ids = [] } = {}) => request("desktop.persistence.deleteDevelopmentRecords", { storeName: String(storeName || ""), ids }),
      setDevelopmentRuntimeActive: (active) => request("desktop.persistence.setDevelopmentRuntimeActive", { active: Boolean(active) })
    }),
    customNodePackages: Object.freeze({
      inspect: () => request("desktop.customNodePackages.inspect"),
      install: ({ importId } = {}) => request("desktop.customNodePackages.install", { importId: String(importId || "") }),
      list: () => request("desktop.customNodePackages.list"),
      grantPermissions: ({ packageId, version, archiveSha256, permissions = {}, confirmed = false } = {}) => request("desktop.customNodePackages.grantPermissions", {
        packageId: String(packageId || ""), version: String(version || ""), archiveSha256: String(archiveSha256 || ""), permissions, confirmed: Boolean(confirmed)
      }),
      activateSandboxRuntime: ({ packageId, version, archiveSha256, confirmed = false } = {}) => request("desktop.customNodePackages.activateSandboxRuntime", {
        packageId: String(packageId || ""), version: String(version || ""), archiveSha256: String(archiveSha256 || ""), confirmed: Boolean(confirmed)
      })
    })
  }),
  runtime: Object.freeze({
    getStatus: () => request("runtime.getStatus"),
    customNodeSandbox: Object.freeze({
      run: ({ packageId, version, archiveSha256, nodeId, inputs = {}, config = {}, context = {}, timeoutMs } = {}) => request("runtime.customNodeSandbox.run", {
        packageId: String(packageId || ""),
        version: String(version || ""),
        archiveSha256: String(archiveSha256 || ""),
        nodeId: String(nodeId || ""),
        inputs: inputs && typeof inputs === "object" ? inputs : {},
        config: config && typeof config === "object" ? config : {},
        context: context && typeof context === "object" ? context : {},
        timeoutMs: Number(timeoutMs || 0)
      })
    }),
    pythonRuntime: Object.freeze({
      getCatalog: () => request("runtime.pythonRuntime.getCatalog"),
      getInstallPlan: ({ packId } = {}) => request("runtime.pythonRuntime.getInstallPlan", { packId: String(packId || "") }),
      installPack: ({ packId, confirmed = false } = {}) => request("runtime.pythonRuntime.installPack", { packId: String(packId || ""), confirmed: Boolean(confirmed) }),
      onInstallProgress: (listener) => {
        if (typeof listener !== "function") return () => {};
        const handler = (_event, progress) => listener(progress && typeof progress === "object" ? progress : {});
        ipcRenderer.on("trackers-core:python-install-progress", handler);
        return () => ipcRenderer.removeListener("trackers-core:python-install-progress", handler);
      },
      removeModel: ({ modelId, confirmed = false } = {}) => request("runtime.pythonRuntime.removeModel", { modelId: String(modelId || ""), confirmed: Boolean(confirmed) })
    }),
    pythonPacks: Object.freeze({
      resolve: (execution = {}) => request("runtime.pythonPacks.resolve", { execution })
    }),
    ...(pythonPocEnabled ? { pythonPoc: Object.freeze({
      getStatus: () => request("runtime.pythonPoc.status"),
      start: () => request("runtime.pythonPoc.start"),
      run: (payload = {}) => request("runtime.pythonPoc.run", payload),
      cancel: (executionId) => request("runtime.pythonPoc.cancel", { executionId: String(executionId || "") }),
      restart: () => request("runtime.pythonPoc.restart")
    }) } : {}),
    ...(pythonNlpEnabled ? { pythonNlp: Object.freeze({
      getStatus: () => request("runtime.pythonNlp.status"),
      start: () => request("runtime.pythonNlp.start"),
      run: (payload = {}) => request("runtime.pythonNlp.run", payload),
      cancel: (executionId) => request("runtime.pythonNlp.cancel", { executionId: String(executionId || "") }),
      restart: () => request("runtime.pythonNlp.restart")
    }) } : {})
  })
});

contextBridge.exposeInMainWorld("trackers", trackers);
contextBridge.exposeInMainWorld("trackersDesktop", Object.freeze({
  getRuntimeInfo: trackers.desktop.getStatus,
  openExternal: trackers.desktop.openExternal,
  getPersistenceStatus: trackers.desktop.persistence.getStatus,
  planPersistenceImport: trackers.desktop.persistence.planImport,
  planPersistenceBackupManifest: trackers.desktop.persistence.planBackupManifest,
  importDevelopmentFirstCohort: trackers.desktop.persistence.importDevelopmentFirstCohort,
  verifyDevelopmentFirstCohort: trackers.desktop.persistence.verifyDevelopmentFirstCohort,
  listDevelopmentStores: trackers.desktop.persistence.listDevelopmentStores,
  readDevelopmentRecords: trackers.desktop.persistence.readDevelopmentRecords,
  writeDevelopmentRecords: trackers.desktop.persistence.writeDevelopmentRecords,
  deleteDevelopmentRecords: trackers.desktop.persistence.deleteDevelopmentRecords,
  setDevelopmentRuntimeActive: trackers.desktop.persistence.setDevelopmentRuntimeActive
}));
