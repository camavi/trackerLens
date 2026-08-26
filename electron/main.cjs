const { app, BrowserWindow, ipcMain, shell, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createTlCore } = require("../core/desktop/tl-core.cjs");
const { ManagedPythonRuntime } = require("../core/desktop/managed-python-runtime.cjs");
const { DesktopPersistence } = require("../core/desktop/desktop-persistence.cjs");
const { PythonPackResolver } = require("../core/runtime/python-pack-resolver.cjs");
const nlpPackManifest = require("../runtimes/python/packs/nlp/pack.json");
const ragPackManifest = require("../runtimes/python/packs/rag/pack.json");

const projectRoot = path.resolve(__dirname, "..");
const preloadPath = path.join(__dirname, "preload.cjs");
const entryPoint = path.join(projectRoot, "flowMap.html");
const isDevelopment = process.env.NODE_ENV !== "production";
const allowDevTools = process.env.TL_ELECTRON_DEVTOOLS === "1";
const pythonPocEnabled = process.env.TL_ENABLE_PYTHON_POC === "1";
const pythonNlpRequested = process.env.TL_ENABLE_PYTHON_NLP_DEV === "1";
const pythonNlpPythonPath = path.join(projectRoot, "runtimes/python/envs/nlp/bin/python");
const pythonNlpModelPath = path.join(projectRoot, "runtimes/python/models/paraphrase-multilingual-MiniLM-L12-v2");
const pythonNlpEnabled = pythonNlpRequested && fs.existsSync(pythonNlpPythonPath) && fs.existsSync(pythonNlpModelPath);
let tlCore = null;
let pythonPoc = null;
let pythonNlp = null;
let persistence = null;
const pythonPacks = new PythonPackResolver({
  packs: [nlpPackManifest, ragPackManifest].map((manifest) => ({
    ...manifest,
    packages: manifest.requirements.map((requirement) => ({ ...requirement, version: String(requirement.version || "").replace(/^==/, "") })),
    status: pythonNlpEnabled ? "ready" : "unavailable"
  }))
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
        ...(pythonNlpEnabled ? ["--tl-python-nlp-dev=1"] : [])
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
    featureFlags: { multiRuntime: pythonPocEnabled || pythonNlpEnabled, pythonRuntime: pythonPocEnabled, pythonNlpDev: pythonNlpEnabled },
    adapters: {
      openExternal: (url) => shell.openExternal(url),
      pythonPoc: pythonPocEnabled ? (pythonPoc = new ManagedPythonRuntime()) : null,
      pythonNlp: pythonNlpEnabled ? (pythonNlp = new ManagedPythonRuntime({
        pythonPath: pythonNlpPythonPath,
        workerId: "managed-python-nlp-dev",
        environment: {
          TL_NLP_MODEL_DIR: pythonNlpModelPath,
          TL_NLP_MODEL_ID: "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
          TL_NLP_MODEL_REVISION: "b8ef00830037f9868450f778081ea683e900fe39",
          HF_HUB_OFFLINE: "1",
          HF_HOME: path.join(projectRoot, "runtimes/python/.cache")
        }
      })) : null,
      pythonPacks,
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
