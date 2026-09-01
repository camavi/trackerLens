const { app, BrowserWindow, dialog, ipcMain, nativeImage, shell, session } = require("electron");
const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createTlCore } = require("../core/desktop/tl-core.cjs");
const { ManagedPythonRuntime } = require("../core/desktop/managed-python-runtime.cjs");
const { PythonRuntimeCatalog } = require("../core/desktop/python-runtime-catalog.cjs");
const { ManagedPythonPackInstaller } = require("../core/desktop/managed-python-pack-installer.cjs");
const { CustomNodePackageManager } = require("../core/desktop/custom-node-package-manager.cjs");
const { CustomNodeSandboxBroker } = require("../core/desktop/custom-node-sandbox-broker.cjs");
const { CustomNodeElectronRunner } = require("../core/desktop/custom-node-electron-runner.cjs");
const { CustomNodeToolDispatcher } = require("../core/desktop/custom-node-tool-dispatcher.cjs");
const { DesktopPersistence } = require("../core/desktop/desktop-persistence.cjs");
const { PythonPackResolver } = require("../core/runtime/python-pack-resolver.cjs");
const nlpPackManifest = require("../runtimes/python/packs/nlp/pack.json");
const ragPackManifest = require("../runtimes/python/packs/rag/pack.json");
const annotationsPackManifest = require("../runtimes/python/packs/annotations/pack.json");
const graphRelationsPackManifest = require("../runtimes/python/packs/graph-relations/pack.json");

const projectRoot = path.resolve(__dirname, "..");
const preloadPath = path.join(__dirname, "preload.cjs");
const entryPoint = path.join(projectRoot, "flowMap.html");
const websiteLogoIconPath = path.join(projectRoot, "icons", "logo128.png");
const isDevelopment = process.env.NODE_ENV !== "production";
const allowDevTools = process.env.TL_ELECTRON_DEVTOOLS === "1";
const pythonPocEnabled = process.env.TL_ENABLE_PYTHON_POC === "1";
const customNodeSandboxEnabled = process.env.TL_ENABLE_CUSTOM_NODE_SANDBOX === "1";
const pythonNlpPythonPath = path.join(projectRoot, "runtimes/python/envs/nlp/bin/python");
const pythonNlpModelPath = path.join(projectRoot, "runtimes/python/models/paraphrase-multilingual-MiniLM-L12-v2");
const pythonRagRerankModelPath = path.join(projectRoot, "runtimes/python/models/mmarco-mMiniLMv2-L12-H384-v1");
const pythonGraphRelationsModelPath = path.join(projectRoot, "runtimes/python/models/gliner2.5-multi-v1");
const pythonGraphNliModelPath = path.join(projectRoot, "runtimes/python/models/mdeberta-v3-base-mnli-xnli");
const pythonAnnotationModelPaths = new Map(annotationsPackManifest.models.map((model) => [model.id, path.join(projectRoot, "runtimes/python/models/spacy", model.id)]));
const pythonNlpEnvironmentPath = path.join(projectRoot, "runtimes/python/envs/nlp");
const pythonGraphEnvironmentPath = path.join(projectRoot, "runtimes/python/envs/graph");
const pythonGraphPythonPath = path.join(pythonGraphEnvironmentPath, "bin/python");
const pythonGraphProtobufPath = path.join(pythonGraphEnvironmentPath, "lib/python3.11/site-packages/google/protobuf");
const pythonNlpBootstrap = process.env.TL_PYTHON_BOOTSTRAP || "python3.11";
const pythonNlpEnabled = () => fs.existsSync(pythonNlpPythonPath) && fs.existsSync(pythonNlpModelPath);
const pythonRagEnabled = () => pythonNlpEnabled() && fs.existsSync(pythonRagRerankModelPath);
const pythonAnnotationsEnabled = () => fs.existsSync(pythonNlpPythonPath) && annotationsPackManifest.models.every((model) => fs.existsSync(pythonAnnotationModelPaths.get(model.id)));
const pythonGraphRelationsEnabled = () => fs.existsSync(pythonGraphPythonPath)
  && fs.existsSync(pythonGraphRelationsModelPath)
  && fs.existsSync(pythonGraphNliModelPath)
  && fs.existsSync(pythonGraphProtobufPath);
const annotationLanguageByModelId = { en_core_web_sm: "en", it_core_news_sm: "it", es_core_news_sm: "es", fr_core_news_sm: "fr", de_core_news_sm: "de" };
const annotationWorkerModels = () => pythonAnnotationsEnabled() ? annotationsPackManifest.models.map((model) => ({
  id: model.id,
  language: annotationLanguageByModelId[model.id],
  package: model.artifact.package,
  revision: model.revision,
  directory: path.join(pythonAnnotationModelPaths.get(model.id), "content")
})) : [];
const pythonPackStatus = (manifest) => {
  if (manifest.id === ragPackManifest.id) return pythonRagEnabled() ? "ready" : "unavailable";
  if (manifest.id === annotationsPackManifest.id) return pythonAnnotationsEnabled() ? "ready" : "unavailable";
  if (manifest.id === graphRelationsPackManifest.id) return pythonGraphRelationsEnabled() ? "ready" : "unavailable";
  return pythonNlpEnabled() ? "ready" : "unavailable";
};
let tlCore = null;
let pythonPoc = null;
let pythonNlp = null;
let pythonGraphRelations = null;
let persistence = null;
let customNodePackageManager = null;
let customNodeSandboxRunner = null;
const pendingCustomNodeImports = new Map();
const createPythonNlpRuntime = () => {
  if (!fs.existsSync(pythonNlpPythonPath)) return null;
  if (!pythonNlp) pythonNlp = new ManagedPythonRuntime({
    pythonPath: pythonNlpPythonPath,
    workerId: "managed-python-nlp",
    environment: {
      TL_NLP_MODEL_DIR: pythonNlpModelPath,
      TL_NLP_MODEL_ID: "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
      TL_NLP_MODEL_REVISION: "b8ef00830037f9868450f778081ea683e900fe39",
      TL_RAG_RERANK_MODEL_DIR: pythonRagRerankModelPath,
      TL_RAG_RERANK_MODEL_ID: "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1",
      TL_RAG_RERANK_MODEL_REVISION: "1427fd652930e4ba29e8149678df786c240d8825",
      TL_NLP_ANNOTATION_MODELS: JSON.stringify(annotationWorkerModels()),
      HF_HUB_OFFLINE: "1",
      HF_HOME: path.join(projectRoot, "runtimes/python/.cache")
    }
  });
  return pythonNlp;
};
const createPythonGraphRelationsRuntime = () => {
  if (!fs.existsSync(pythonGraphPythonPath)) return null;
  if (!pythonGraphRelations) pythonGraphRelations = new ManagedPythonRuntime({
    pythonPath: pythonGraphPythonPath,
    workerId: "managed-python-graph-relations",
    environment: {
      TL_GRAPH_RELATIONS_MODEL_DIR: pythonGraphRelationsModelPath,
      TL_GRAPH_RELATIONS_MODEL_ID: "fastino/gliner2.5-multi-v1",
      TL_GRAPH_RELATIONS_MODEL_REVISION: "aaecfe45db1d828c963717054ccb868e8ad1f1d5",
      TL_GRAPH_NLI_MODEL_DIR: pythonGraphNliModelPath,
      TL_GRAPH_NLI_MODEL_ID: "MoritzLaurer/mDeBERTa-v3-base-mnli-xnli",
      TL_GRAPH_NLI_MODEL_REVISION: "8adb042d524ecd5c26d3e3ba0e3fbcf7e2d0864c",
      HF_HUB_OFFLINE: "1",
      HF_HOME: path.join(projectRoot, "runtimes/python/.cache")
    }
  });
  return pythonGraphRelations;
};
const pythonNlpAdapter = {
  status: () => ({
    ...(createPythonNlpRuntime()?.status() || { runtime: "python", workerId: "managed-python-nlp", status: "unavailable", reason: "NLP pack is not installed" }),
    graphRelations: createPythonGraphRelationsRuntime()?.status() || { runtime: "python", workerId: "managed-python-graph-relations", status: "unavailable", reason: "Graph relations pack is not installed" }
  }),
  start: () => createPythonNlpRuntime()?.start() || Promise.reject(Object.assign(new Error("Python NLP pack is not installed"), { code: "PYTHON_NLP_DISABLED" })),
  execute: (payload) => new Set(["gliner2_relations", "nli_verify_relations"]).has(String(payload?.operation || ""))
    ? createPythonGraphRelationsRuntime()?.execute(payload) || Promise.reject(Object.assign(new Error("Python GLiNER2 graph relations pack is not installed"), { code: "PYTHON_GRAPH_RELATIONS_DISABLED" }))
    : createPythonNlpRuntime()?.execute(payload) || Promise.reject(Object.assign(new Error("Python NLP pack is not installed"), { code: "PYTHON_NLP_DISABLED" })),
  cancel: (executionId) => { createPythonNlpRuntime()?.cancel(executionId); createPythonGraphRelationsRuntime()?.cancel(executionId); },
  restart: () => createPythonNlpRuntime()?.restart() || Promise.reject(Object.assign(new Error("Python NLP pack is not installed"), { code: "PYTHON_NLP_DISABLED" }))
};
const pythonPacks = new PythonPackResolver({
  packs: [nlpPackManifest, ragPackManifest, annotationsPackManifest, graphRelationsPackManifest].map((manifest) => ({
    ...manifest,
    packages: manifest.requirements.map((requirement) => ({ ...requirement, version: String(requirement.version || "").replace(/^==/, "") })),
    status: pythonPackStatus(manifest)
  }))
});
const nlpEnvironment = {
  id: "nlp",
  interpreter: "Python 3.11",
  interpreterPath: pythonNlpPythonPath,
  pythonPath: pythonNlpPythonPath,
  directory: pythonNlpEnvironmentPath,
  bootstrapPython: pythonNlpBootstrap,
  requested: () => true,
  enabled: pythonNlpEnabled,
  runtimeStatus: () => pythonNlpAdapter.status(),
  stopRuntime: () => pythonNlp?.stop?.(),
  onInstalled: async () => {
    pythonPacks.setStatus(nlpPackManifest.id, pythonNlpEnabled() ? "ready" : "unavailable");
    pythonPacks.setStatus(ragPackManifest.id, pythonRagEnabled() ? "ready" : "unavailable");
    pythonPacks.setStatus(annotationsPackManifest.id, pythonAnnotationsEnabled() ? "ready" : "unavailable");
    if (pythonNlp) pythonNlp.environment.TL_NLP_ANNOTATION_MODELS = JSON.stringify(annotationWorkerModels());
    await createPythonNlpRuntime()?.restart();
  },
  onModelRemoved: async () => {
    pythonPacks.setStatus(nlpPackManifest.id, pythonNlpEnabled() ? "ready" : "unavailable");
    pythonPacks.setStatus(ragPackManifest.id, pythonRagEnabled() ? "ready" : "unavailable");
    pythonPacks.setStatus(annotationsPackManifest.id, pythonAnnotationsEnabled() ? "ready" : "unavailable");
    if (pythonNlp) {
      pythonNlp.environment.TL_NLP_ANNOTATION_MODELS = JSON.stringify(annotationWorkerModels());
      await pythonNlp.restart();
    }
  },
  models: [
    { ...nlpPackManifest.models[0], displayName: "Multilingual MiniLM L12 v2", directory: pythonNlpModelPath },
    { ...ragPackManifest.models.find((model) => model.id === "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1"), directory: pythonRagRerankModelPath },
    ...annotationsPackManifest.models.map((model) => ({ ...model, directory: pythonAnnotationModelPaths.get(model.id) }))
  ]
};
const graphEnvironment = {
  id: "graph",
  interpreter: "Python 3.11",
  interpreterPath: pythonGraphPythonPath,
  pythonPath: pythonGraphPythonPath,
  directory: pythonGraphEnvironmentPath,
  bootstrapPython: pythonNlpBootstrap,
  requested: () => true,
  enabled: pythonGraphRelationsEnabled,
  runtimeStatus: () => createPythonGraphRelationsRuntime()?.status() || { status: "stopped" },
  stopRuntime: () => pythonGraphRelations?.stop?.(),
  onInstalled: async () => {
    pythonPacks.setStatus(graphRelationsPackManifest.id, pythonGraphRelationsEnabled() ? "ready" : "unavailable");
    await createPythonGraphRelationsRuntime()?.restart();
  },
  onModelRemoved: async () => {
    pythonPacks.setStatus(graphRelationsPackManifest.id, pythonGraphRelationsEnabled() ? "ready" : "unavailable");
    await pythonGraphRelations?.restart();
  },
  models: [
    { ...graphRelationsPackManifest.models[0], directory: pythonGraphRelationsModelPath },
    { ...graphRelationsPackManifest.models[1], directory: pythonGraphNliModelPath }
  ]
};
const pythonRuntimeCatalog = new PythonRuntimeCatalog({
  packs: [nlpPackManifest, ragPackManifest, annotationsPackManifest, graphRelationsPackManifest],
  environments: [nlpEnvironment, graphEnvironment]
});
const pythonPackInstaller = new ManagedPythonPackInstaller({
  packs: [nlpPackManifest, ragPackManifest, annotationsPackManifest, graphRelationsPackManifest].map((pack) => ({ ...pack, lockfilePath: path.join(projectRoot, pack.lockfile) })),
  environments: [nlpEnvironment, graphEnvironment]
});
pythonPackInstaller.subscribe((progress) => {
  BrowserWindow.getAllWindows().forEach((window) => window.webContents.send("trackers-core:python-install-progress", progress));
});

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https: http: wss: ws:",
  "worker-src 'self' blob:",
  "frame-src 'self'",
  "form-action 'self'"
].join("; ");

const customNodeSandboxContentSecurityPolicy = [
  "default-src 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "script-src 'self' blob:",
  "style-src 'self'",
  "img-src data: blob:",
  "connect-src 'none'",
  "worker-src 'none'",
  "frame-src 'none'",
  "form-action 'none'"
].join("; ");

const isSafeExternalUrl = (value) => {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:";
  } catch (_) {
    return false;
  }
};

const isAllowedLocalNavigation = (value) => {
  try {
    const url = new URL(value);
    if (url.protocol !== "file:") return false;
    const target = path.resolve(decodeURIComponent(url.pathname));
    return target === projectRoot || target.startsWith(`${projectRoot}${path.sep}`);
  } catch (_) {
    return false;
  }
};

const configureSessionSecurity = () => {
  const legacySpriteUrl = pathToFileURL(path.join(projectRoot, "cmswift-fe", "img", "svg", "tabler-icons-sprite.svg")).toString();
  session.defaultSession.webRequest.onBeforeRequest({ urls: ["file:///cmswift-fe/img/svg/tabler-icons-sprite.svg*"] }, (details, callback) => {
    callback({ redirectURL: legacySpriteUrl + (new URL(details.url).hash || "") });
  });
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [contentSecurityPolicy]
      }
    });
  });
};

// Each untrusted package receives a disposable, dedicated Electron partition.
// The trusted runner page needs only its local scripts and Blob module source;
// every network protocol and every browser permission is denied at the session.
const configureCustomNodeSandboxSession = (partition = "") => {
  const sandboxSession = session.fromPartition(String(partition));
  sandboxSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  sandboxSession.setPermissionCheckHandler(() => false);
  sandboxSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] }, (_details, callback) => callback({ cancel: true }));
  sandboxSession.webRequest.onHeadersReceived((details, callback) => callback({
    responseHeaders: {
      ...details.responseHeaders,
      "Content-Security-Policy": [customNodeSandboxContentSecurityPolicy]
    }
  }));
};

const createWindow = () => {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    title: "Trackers Lens",
    icon: websiteLogoIconPath,
    webPreferences: {
      preload: preloadPath,
      additionalArguments: [
        ...(pythonPocEnabled ? ["--tl-python-poc=1"] : []),
        "--tl-python-nlp=1"
      ],
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });

  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedLocalNavigation(url)) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.on("before-input-event", (event, input) => {
    if (!allowDevTools && input.type === "keyDown" && input.key === "F12") event.preventDefault();
  });
  window.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {});

  if (allowDevTools) window.webContents.openDevTools({ mode: "detach" });
  window.loadFile(entryPoint);
  return window;
};

ipcMain.handle("trackers-core:request", (_event, command, payload) =>
  tlCore.request(String(command || ""), payload && typeof payload === "object" ? payload : {})
);

ipcMain.handle("trackers-custom-node-sandbox:message", (event, message) => {
  if (!customNodeSandboxRunner) {
    throw Object.assign(new Error("Il runner sandbox dei Custom Node non è abilitato."), { code: "CUSTOM_NODE_SANDBOX_DISABLED" });
  }
  return customNodeSandboxRunner.receive({
    senderId: event.sender.id,
    message: message && typeof message === "object" ? message : {}
  });
});

ipcMain.handle("trackers-custom-node-sandbox:tool", (event, message) => {
  if (!customNodeSandboxRunner) throw Object.assign(new Error("Il runner sandbox dei Custom Node non è abilitato."), { code: "CUSTOM_NODE_SANDBOX_DISABLED" });
  return customNodeSandboxRunner.callTool({ senderId: event.sender.id, message: message && typeof message === "object" ? message : {} });
});

app.whenReady().then(() => {
  persistence = new DesktopPersistence({ databasePath: path.join(app.getPath("userData"), "trackers-lens.sqlite") });
  customNodePackageManager = new CustomNodePackageManager({
    packagesDirectory: path.join(app.getPath("userData"), "custom-node-packages"),
    persistence
  });
  if (customNodeSandboxEnabled) {
    const toolDispatcher = new CustomNodeToolDispatcher({ persistence });
    const broker = new CustomNodeSandboxBroker({ onToolCall: (call) => toolDispatcher.dispatch(call) });
    customNodeSandboxRunner = new CustomNodeElectronRunner({
      BrowserWindow,
      broker,
      runnerPage: path.join(__dirname, "custom-node-sandbox-runner.html"),
      runnerPreload: path.join(__dirname, "custom-node-sandbox-preload.cjs"),
      configureSession: configureCustomNodeSandboxSession
    });
  }
  // Deliberately Main-only for now. Flow Map/Runtime Manager wiring will call
  // this coordinator only after it can provide an authorized node execution.
  // No renderer command returns archive source or starts arbitrary packages.
  const launchCustomNodeSandbox = async ({ packageId = "", version = "", archiveSha256 = "", nodeId = "", inputs = {}, config = {}, context = {}, timeoutMs: requestedTimeoutMs = 30000 } = {}) => {
    if (!customNodeSandboxRunner) throw Object.assign(new Error("Il runner sandbox dei Custom Node non è abilitato."), { code: "CUSTOM_NODE_SANDBOX_DISABLED" });
    const runtime = await customNodePackageManager.loadSandboxRuntime({ packageId, version, archiveSha256 });
    const request = customNodeSandboxRunner.broker.open({
      nodeId,
      packageRecord: runtime.packageRecord,
      inputs,
      config,
      context,
      grantedPermissions: runtime.packageRecord.grantedPermissions
    });
    try {
      const launched = await customNodeSandboxRunner.launch({ request, source: runtime.source });
      const timeoutMs = Math.max(1000, Math.min(600000, Number(requestedTimeoutMs || 30000)));
      const timeout = setTimeout(() => {
        customNodeSandboxRunner.broker.fail({
          executionId: request.executionId,
          code: "CUSTOM_NODE_SANDBOX_TIMEOUT",
          message: `Custom Node sandbox timeout dopo ${timeoutMs}ms.`
        });
        customNodeSandboxRunner.close(request.executionId);
      }, timeoutMs);
      try {
        const terminal = await customNodeSandboxRunner.broker.wait(request.executionId);
        const trace = customNodeSandboxRunner.broker.get(request.executionId);
        return {
          executionId: launched.executionId,
          status: terminal.status,
          outputs: terminal.outputs && typeof terminal.outputs === "object" ? terminal.outputs : {},
          diagnostics: Array.isArray(terminal.diagnostics) ? terminal.diagnostics : [],
          events: (trace?.events || []).filter((event) => ["emit", "log"].includes(event.kind))
        };
      } finally {
        clearTimeout(timeout);
        customNodeSandboxRunner.close(request.executionId);
      }
    } catch (error) {
      customNodeSandboxRunner.broker.fail({
        executionId: request.executionId,
        code: "CUSTOM_NODE_SANDBOX_LAUNCH_FAILED",
        message: error?.message || String(error)
      });
      throw error;
    }
  };
  const selectCustomNodeArchive = async () => {
    const result = await dialog.showOpenDialog({
      title: "Importa Custom Node",
      properties: ["openFile"],
      filters: [{ name: "Trackers Lens Custom Node", extensions: ["zip"] }]
    });
    const archivePath = result.canceled ? "" : String(result.filePaths?.[0] || "");
    return archivePath;
  };
  const customNodePackages = {
    inspect: async () => {
      const archivePath = await selectCustomNodeArchive();
      if (!archivePath) return { cancelled: true };
      const inspection = await customNodePackageManager.inspectFile(archivePath);
      const importId = crypto.randomUUID();
      pendingCustomNodeImports.set(importId, archivePath);
      return { ...inspection, importId };
    },
    install: async ({ importId = "" } = {}) => {
      const archivePath = pendingCustomNodeImports.get(String(importId || ""));
      if (!archivePath) throw Object.assign(new Error("La revisione del pacchetto è scaduta. Seleziona di nuovo l'archivio."), { code: "CUSTOM_NODE_IMPORT_REVIEW_EXPIRED" });
      pendingCustomNodeImports.delete(String(importId));
      return customNodePackageManager.installFile(archivePath);
    },
    list: () => customNodePackageManager.listInstalled(),
    grantPermissions: (payload = {}) => customNodePackageManager.grantPermissions(payload),
    activateSandboxRuntime: (payload = {}) => customNodePackageManager.activateSandboxRuntime(payload),
    runSandbox: (payload = {}) => launchCustomNodeSandbox(payload)
  };
  if (process.platform === "darwin") app.dock.setIcon(nativeImage.createFromPath(websiteLogoIconPath));
  tlCore = createTlCore({
    appVersion: app.getVersion(),
    platform: process.platform,
    mode: isDevelopment ? "development" : "production",
    featureFlags: { multiRuntime: pythonPocEnabled || pythonNlpEnabled(), pythonRuntime: pythonPocEnabled, pythonNlpDev: true, customNodeSandbox: customNodeSandboxEnabled },
    adapters: {
      openExternal: (url) => shell.openExternal(url),
      pythonPoc: pythonPocEnabled ? (pythonPoc = new ManagedPythonRuntime()) : null,
      pythonNlp: pythonNlpAdapter,
      pythonPacks,
      pythonRuntimeCatalog,
      pythonPackInstaller,
      customNodePackages,
      customNodeSandbox: customNodePackages,
      persistence
    }
  });
  persistence.initialize();
  configureSessionSecurity();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => { void pythonPoc?.stop?.(); void pythonNlp?.stop?.(); void pythonGraphRelations?.stop?.(); });
