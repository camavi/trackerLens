const { app, BrowserWindow, ipcMain, shell, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createTlCore } = require("../core/desktop/tl-core.cjs");
const { ManagedPythonRuntime } = require("../core/desktop/managed-python-runtime.cjs");
const { PythonRuntimeCatalog } = require("../core/desktop/python-runtime-catalog.cjs");
const { ManagedPythonPackInstaller } = require("../core/desktop/managed-python-pack-installer.cjs");
const { DesktopPersistence } = require("../core/desktop/desktop-persistence.cjs");
const { PythonPackResolver } = require("../core/runtime/python-pack-resolver.cjs");
const nlpPackManifest = require("../runtimes/python/packs/nlp/pack.json");
const ragPackManifest = require("../runtimes/python/packs/rag/pack.json");
const annotationsPackManifest = require("../runtimes/python/packs/annotations/pack.json");

const projectRoot = path.resolve(__dirname, "..");
const preloadPath = path.join(__dirname, "preload.cjs");
const entryPoint = path.join(projectRoot, "flowMap.html");
const isDevelopment = process.env.NODE_ENV !== "production";
const allowDevTools = process.env.TL_ELECTRON_DEVTOOLS === "1";
const pythonPocEnabled = process.env.TL_ENABLE_PYTHON_POC === "1";
const pythonNlpPythonPath = path.join(projectRoot, "runtimes/python/envs/nlp/bin/python");
const pythonNlpModelPath = path.join(projectRoot, "runtimes/python/models/paraphrase-multilingual-MiniLM-L12-v2");
const pythonRagRerankModelPath = path.join(projectRoot, "runtimes/python/models/mmarco-mMiniLMv2-L12-H384-v1");
const pythonAnnotationModelPaths = new Map(annotationsPackManifest.models.map((model) => [model.id, path.join(projectRoot, "runtimes/python/models/spacy", model.id)]));
const pythonNlpEnvironmentPath = path.join(projectRoot, "runtimes/python/envs/nlp");
const pythonNlpBootstrap = process.env.TL_PYTHON_BOOTSTRAP || "python3.11";
const pythonNlpEnabled = () => fs.existsSync(pythonNlpPythonPath) && fs.existsSync(pythonNlpModelPath);
const pythonRagEnabled = () => pythonNlpEnabled() && fs.existsSync(pythonRagRerankModelPath);
const pythonAnnotationsEnabled = () => fs.existsSync(pythonNlpPythonPath) && annotationsPackManifest.models.every((model) => fs.existsSync(pythonAnnotationModelPaths.get(model.id)));
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
  return pythonNlpEnabled() ? "ready" : "unavailable";
};
let tlCore = null;
let pythonPoc = null;
let pythonNlp = null;
let persistence = null;
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
const pythonNlpAdapter = {
  status: () => createPythonNlpRuntime()?.status() || { runtime: "python", workerId: "managed-python-nlp", status: "unavailable", reason: "NLP pack is not installed" },
  start: () => createPythonNlpRuntime()?.start() || Promise.reject(Object.assign(new Error("Python NLP pack is not installed"), { code: "PYTHON_NLP_DISABLED" })),
  execute: (payload) => createPythonNlpRuntime()?.execute(payload) || Promise.reject(Object.assign(new Error("Python NLP pack is not installed"), { code: "PYTHON_NLP_DISABLED" })),
  cancel: (executionId) => createPythonNlpRuntime()?.cancel(executionId),
  restart: () => createPythonNlpRuntime()?.restart() || Promise.reject(Object.assign(new Error("Python NLP pack is not installed"), { code: "PYTHON_NLP_DISABLED" }))
};
const pythonPacks = new PythonPackResolver({
  packs: [nlpPackManifest, ragPackManifest, annotationsPackManifest].map((manifest) => ({
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
const pythonRuntimeCatalog = new PythonRuntimeCatalog({
  packs: [nlpPackManifest, ragPackManifest, annotationsPackManifest],
  environments: [nlpEnvironment]
});
const pythonPackInstaller = new ManagedPythonPackInstaller({
  packs: [nlpPackManifest, ragPackManifest, annotationsPackManifest].map((pack) => ({ ...pack, lockfilePath: path.join(projectRoot, pack.lockfile) })),
  environments: [nlpEnvironment]
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

const createWindow = () => {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    title: "Trackers Lens",
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

app.whenReady().then(() => {
  tlCore = createTlCore({
    appVersion: app.getVersion(),
    platform: process.platform,
    mode: isDevelopment ? "development" : "production",
    featureFlags: { multiRuntime: pythonPocEnabled || pythonNlpEnabled(), pythonRuntime: pythonPocEnabled, pythonNlpDev: true },
    adapters: {
      openExternal: (url) => shell.openExternal(url),
      pythonPoc: pythonPocEnabled ? (pythonPoc = new ManagedPythonRuntime()) : null,
      pythonNlp: pythonNlpAdapter,
      pythonPacks,
      pythonRuntimeCatalog,
      pythonPackInstaller,
      persistence: (persistence = new DesktopPersistence({ databasePath: path.join(app.getPath("userData"), "trackers-lens.sqlite") }))
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

app.on("before-quit", () => { void pythonPoc?.stop?.(); void pythonNlp?.stop?.(); });
