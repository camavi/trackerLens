const fs = require("node:fs/promises");

const clone = (value) => JSON.parse(JSON.stringify(value));

const pathExists = async (target) => {
  try {
    await fs.access(target);
    return true;
  } catch (_) {
    return false;
  }
};

const directorySize = async (target) => {
  let stat;
  try {
    stat = await fs.lstat(target);
  } catch (_) {
    return 0;
  }
  if (stat.isSymbolicLink()) return 0;
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;

  const entries = await fs.readdir(target, { withFileTypes: true }).catch(() => []);
  const sizes = await Promise.all(entries.map((entry) => directorySize(`${target}/${entry.name}`)));
  return sizes.reduce((total, size) => total + size, 0);
};

class PythonRuntimeCatalog {
  constructor({ packs = [], environments = [] } = {}) {
    this.packs = Array.isArray(packs) ? packs.map(clone) : [];
    this.environments = Array.isArray(environments) ? environments : [];
  }

  environmentForModel(modelId) {
    return this.environments.find((environment) =>
      Array.isArray(environment.models) && environment.models.some((model) => model.id === modelId)
    ) || null;
  }

  async getCatalog() {
    const environmentStates = await Promise.all(this.environments.map(async (environment) => ({
      id: String(environment.id || "python"),
      interpreter: String(environment.interpreter || "Python"),
      requested: Boolean(environment.requested?.()),
      enabled: Boolean(environment.enabled?.()),
      interpreterInstalled: await pathExists(environment.interpreterPath),
      runtime: clone(environment.runtimeStatus?.() || { status: "stopped" })
    })));
    const models = [];
    for (const environment of this.environments) {
      for (const model of environment.models || []) {
        const installed = await pathExists(model.directory);
        models.push({
          id: String(model.id),
          environmentId: String(environment.id || "python"),
          displayName: String(model.displayName || model.id),
          revision: String(model.revision || ""),
          dimensions: Number(model.dimensions || 0),
          languages: Number(model.languages || 0),
          license: String(model.license || "Unknown"),
          localOnlyAfterInstall: Boolean(model.localOnlyAfterInstall),
          packIds: this.packs.filter((pack) => (pack.models || []).some((item) => item.id === model.id)).map((pack) => pack.id),
          state: installed ? "installed" : "missing",
          sizeBytes: installed ? await directorySize(model.directory) : 0
        });
      }
    }
    const environmentsById = new Map(environmentStates.map((environment) => [environment.id, environment]));
    const packs = this.packs.map((pack) => {
      const environment = environmentsById.get(String(pack.environment || ""));
      const packModels = models.filter((model) => model.packIds.includes(pack.id));
      const state = !environment?.interpreterInstalled || packModels.some((model) => model.state !== "installed")
        ? "unavailable"
        : environment.enabled ? "active" : "installed";
      return {
        id: String(pack.id || "python-pack"),
        version: String(pack.version || ""),
        environmentId: String(pack.environment || ""),
        state,
        trustLevel: String(pack.trustLevel || "unknown"),
        installPolicy: String(pack.installPolicy || "managed-optional"),
        python: String(pack.python || ""),
        interpreter: String(pack.developmentInterpreter || environment?.interpreter || "Python"),
        requirements: (pack.requirements || pack.packages || []).map((item) => ({
          name: String(item.name || ""),
          version: String(item.version || "").replace(/^==/, "")
        })),
        capabilities: Array.isArray(pack.capabilities) ? pack.capabilities.map(String) : [],
        dataAccess: String(pack.dataAccess || "TL-authorized inputs only"),
        modelIds: packModels.map((model) => model.id)
      };
    });
    return { schemaVersion: "tl-python-runtime-catalog/v1", environments: environmentStates, packs, models };
  }

  async removeModel({ modelId, confirmed = false } = {}) {
    const environment = this.environmentForModel(String(modelId || ""));
    const model = environment?.models?.find((item) => item.id === modelId);
    if (!model) throw Object.assign(new Error("Python model is not managed by Trackers Lens."), { code: "PYTHON_MODEL_UNKNOWN" });
    if (!confirmed) throw Object.assign(new Error("Python model removal requires confirmation."), { code: "PYTHON_MODEL_CONFIRMATION_REQUIRED" });
    if (!await pathExists(model.directory)) throw Object.assign(new Error("Python model is not installed."), { code: "PYTHON_MODEL_MISSING" });
    await environment.stopRuntime?.();
    await fs.rm(model.directory, { recursive: true, force: false, maxRetries: 3 });
    return { removed: true, modelId: String(model.id), environmentId: String(environment.id || "python") };
  }
}

module.exports = { PythonRuntimeCatalog };
