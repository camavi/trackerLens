const TL_CORE_CONTRACT_VERSION = "tl-core/v1";

const DEFAULT_FEATURE_FLAGS = Object.freeze({
  electronDesktop: true,
  multiRuntime: false,
  pythonRuntime: false,
  pythonNlpDev: false,
  pythonNodes: false
});

const clone = (value) => JSON.parse(JSON.stringify(value));

const isSafeExternalUrl = (value) => {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:";
  } catch (_) {
    return false;
  }
};

const createTlCore = ({ appVersion = "0.0.0", platform = "unknown", mode = "production", featureFlags = {}, adapters = {} } = {}) => {
  const openExternal = typeof adapters.openExternal === "function" ? adapters.openExternal : null;
  const pythonPoc = adapters.pythonPoc || null;
  const pythonNlp = adapters.pythonNlp || null;
  const pythonPacks = adapters.pythonPacks || null;
  const pythonRuntimeCatalog = adapters.pythonRuntimeCatalog || null;
  const pythonPackInstaller = adapters.pythonPackInstaller || null;
  const persistence = adapters.persistence || null;
  const flags = { ...DEFAULT_FEATURE_FLAGS, ...featureFlags };

  const getDesktopStatus = () => ({
    contractVersion: TL_CORE_CONTRACT_VERSION,
    appVersion: String(appVersion),
    platform: String(platform),
    mode: String(mode),
    featureFlags: clone(flags)
  });

  const getRuntimeStatus = () => ({
    contractVersion: TL_CORE_CONTRACT_VERSION,
    owner: "renderer-js-worker",
    persistence: persistence?.getStatus?.().mode || "desktop-sqlite",
    runtimeManager: "javascript-registered",
    multiRuntime: false
  });

  const request = async (command, payload = {}) => {
    switch (command) {
      case "desktop.getStatus":
        return getDesktopStatus();
      case "runtime.getStatus":
        return getRuntimeStatus();
      case "desktop.openExternal": {
        const url = String(payload?.url || "");
        if (!isSafeExternalUrl(url)) throw new Error("External URL is not allowed.");
        if (!openExternal) throw new Error("Desktop external navigation is unavailable.");
        await openExternal(url);
        return { opened: true };
      }
      case "desktop.persistence.getStatus":
        if (!persistence?.getStatus) throw errorWithCode("Desktop persistence is unavailable", "PERSISTENCE_UNAVAILABLE");
        return persistence.getStatus();
      case "desktop.persistence.planImport":
        if (!persistence?.planImport) throw errorWithCode("Desktop persistence is unavailable", "PERSISTENCE_UNAVAILABLE");
        return persistence.planImport(payload?.bundle || {});
      case "desktop.persistence.planBackupManifest":
        if (!persistence?.planBackupManifest) throw errorWithCode("Desktop persistence is unavailable", "PERSISTENCE_UNAVAILABLE");
        return persistence.planBackupManifest(payload?.catalog || {});
      case "desktop.persistence.importDevelopmentFirstCohort":
        if (!persistence?.importDevelopmentBundle) throw errorWithCode("Desktop persistence is unavailable", "PERSISTENCE_UNAVAILABLE");
        return persistence.importDevelopmentBundle(payload?.bundle || {});
      case "desktop.persistence.verifyDevelopmentFirstCohort":
        if (!persistence?.verifyDevelopmentBundle) throw errorWithCode("Desktop persistence is unavailable", "PERSISTENCE_UNAVAILABLE");
        return persistence.verifyDevelopmentBundle(payload?.bundle || {});
      case "desktop.persistence.readDevelopmentRecords":
        if (!persistence?.readDevelopmentRecords) throw errorWithCode("Desktop persistence is unavailable", "PERSISTENCE_UNAVAILABLE");
        return persistence.readDevelopmentRecords(payload);
      case "desktop.persistence.listDevelopmentStores":
        if (!persistence?.listDevelopmentStores) throw errorWithCode("Desktop persistence is unavailable", "PERSISTENCE_UNAVAILABLE");
        return persistence.listDevelopmentStores();
      case "desktop.persistence.writeDevelopmentRecords":
        if (!persistence?.writeDevelopmentRecords) throw errorWithCode("Desktop persistence is unavailable", "PERSISTENCE_UNAVAILABLE");
        return persistence.writeDevelopmentRecords(payload);
      case "desktop.persistence.deleteDevelopmentRecords":
        if (!persistence?.deleteDevelopmentRecords) throw errorWithCode("Desktop persistence is unavailable", "PERSISTENCE_UNAVAILABLE");
        return persistence.deleteDevelopmentRecords(payload);
      case "desktop.persistence.setDevelopmentRuntimeActive":
        if (!persistence?.setDevelopmentRuntimeActive) throw errorWithCode("Desktop persistence is unavailable", "PERSISTENCE_UNAVAILABLE");
        return persistence.setDevelopmentRuntimeActive({ active: Boolean(payload?.active) });
      case "runtime.pythonPoc.status":
        if (!flags.pythonRuntime || !pythonPoc?.status) throw errorWithCode("Python POC is disabled", "PYTHON_POC_DISABLED");
        return pythonPoc.status();
      case "runtime.pythonPoc.start":
        if (!flags.pythonRuntime || !pythonPoc?.start) throw errorWithCode("Python POC is disabled", "PYTHON_POC_DISABLED");
        return pythonPoc.start();
      case "runtime.pythonPoc.run":
        if (!flags.pythonRuntime || !pythonPoc?.execute) throw errorWithCode("Python POC is disabled", "PYTHON_POC_DISABLED");
        return pythonPoc.execute(payload);
      case "runtime.pythonPoc.cancel":
        if (!flags.pythonRuntime || !pythonPoc?.cancel) throw errorWithCode("Python POC is disabled", "PYTHON_POC_DISABLED");
        pythonPoc.cancel(String(payload.executionId || ""));
        return { cancelled: true };
      case "runtime.pythonPoc.restart":
        if (!flags.pythonRuntime || !pythonPoc?.restart) throw errorWithCode("Python POC is disabled", "PYTHON_POC_DISABLED");
        return pythonPoc.restart();
      case "runtime.pythonNlp.status":
        if (!flags.pythonNlpDev || !pythonNlp?.status) throw errorWithCode("Python NLP development pack is disabled", "PYTHON_NLP_DISABLED");
        return pythonNlp.status();
      case "runtime.pythonNlp.start":
        if (!flags.pythonNlpDev || !pythonNlp?.start) throw errorWithCode("Python NLP development pack is disabled", "PYTHON_NLP_DISABLED");
        return pythonNlp.start();
      case "runtime.pythonNlp.run":
        if (!flags.pythonNlpDev || !pythonNlp?.execute) throw errorWithCode("Python NLP development pack is disabled", "PYTHON_NLP_DISABLED");
        return pythonNlp.execute(payload);
      case "runtime.pythonNlp.cancel":
        if (!flags.pythonNlpDev || !pythonNlp?.cancel) throw errorWithCode("Python NLP development pack is disabled", "PYTHON_NLP_DISABLED");
        pythonNlp.cancel(String(payload.executionId || ""));
        return { cancelled: true };
      case "runtime.pythonNlp.restart":
        if (!flags.pythonNlpDev || !pythonNlp?.restart) throw errorWithCode("Python NLP development pack is disabled", "PYTHON_NLP_DISABLED");
        return pythonNlp.restart();
      case "runtime.pythonPacks.resolve":
        if (!pythonPacks?.resolve) throw errorWithCode("Python package resolution is unavailable", "PYTHON_PACKS_UNAVAILABLE");
        return pythonPacks.resolve(payload?.execution || {});
      case "runtime.pythonRuntime.getCatalog":
        if (!pythonRuntimeCatalog?.getCatalog) throw errorWithCode("Python runtime catalog is unavailable", "PYTHON_RUNTIME_CATALOG_UNAVAILABLE");
        return pythonRuntimeCatalog.getCatalog();
      case "runtime.pythonRuntime.getInstallPlan":
        if (!pythonPackInstaller?.getInstallPlan) throw errorWithCode("Python pack installer is unavailable", "PYTHON_PACK_INSTALLER_UNAVAILABLE");
        return pythonPackInstaller.getInstallPlan({ packId: String(payload?.packId || "") });
      case "runtime.pythonRuntime.installPack":
        if (!pythonPackInstaller?.install) throw errorWithCode("Python pack installer is unavailable", "PYTHON_PACK_INSTALLER_UNAVAILABLE");
        if (!payload?.confirmed) throw errorWithCode("Python pack installation requires confirmation", "PYTHON_PACK_CONFIRMATION_REQUIRED");
        return pythonPackInstaller.install({ packId: String(payload?.packId || ""), confirmed: true });
      case "runtime.pythonRuntime.removeModel":
        if (!pythonRuntimeCatalog?.removeModel) throw errorWithCode("Python runtime catalog is unavailable", "PYTHON_RUNTIME_CATALOG_UNAVAILABLE");
        if (!payload?.confirmed) throw errorWithCode("Python model removal requires confirmation", "PYTHON_MODEL_CONFIRMATION_REQUIRED");
        return pythonRuntimeCatalog.removeModel({ modelId: String(payload?.modelId || ""), confirmed: true });
      default:
        throw new Error(`Unsupported TL Core command: ${String(command || "")}`);
    }
  };

  return Object.freeze({
    contractVersion: TL_CORE_CONTRACT_VERSION,
    getDesktopStatus,
    getRuntimeStatus,
    request
  });
};

function errorWithCode(message, code) { return Object.assign(new Error(message), { code }); }

module.exports = { TL_CORE_CONTRACT_VERSION, createTlCore };
