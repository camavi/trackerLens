const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");

const clone = (value) => JSON.parse(JSON.stringify(value));
const errorWithCode = (message, code) => Object.assign(new Error(message), { code });
const exists = async (target) => fs.access(target).then(() => true).catch(() => false);
const expectedVersion = (value = "") => String(value || "").trim().replace(/^==/, "");

const run = (command, args, { cwd = "", env = {} } = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: cwd || undefined, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  child.once("error", reject);
  child.once("exit", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(Object.assign(new Error(stderr.trim() || `Python command failed (${code})`), { code: "PYTHON_INSTALL_COMMAND_FAILED", exitCode: code })));
});

class ManagedPythonPackInstaller {
  constructor({ packs = [], environments = [], runProcess = run } = {}) {
    this.packs = Array.isArray(packs) ? packs.map(clone) : [];
    this.environments = Array.isArray(environments) ? environments : [];
    this.runProcess = runProcess;
    this.installing = new Set();
    this.progressListeners = new Set();
  }

  pack(packId) { return this.packs.find((pack) => pack.id === String(packId || "")) || null; }
  environment(environmentId) { return this.environments.find((environment) => environment.id === environmentId) || null; }
  subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }
  emitProgress(event = {}) {
    const payload = { schemaVersion: "tl-python-install-progress/v1", at: new Date().toISOString(), ...event };
    this.progressListeners.forEach((listener) => listener(clone(payload)));
  }

  async getInstallPlan({ packId } = {}) {
    const pack = this.pack(packId);
    if (!pack) throw errorWithCode("Python pack is not managed by Trackers Lens.", "PYTHON_PACK_UNKNOWN");
    if (!['built-in', 'verified'].includes(String(pack.trustLevel || "").toLowerCase())) throw errorWithCode("Python pack is not trusted for installation.", "PYTHON_PACK_UNTRUSTED");
    const environment = this.environment(pack.environment);
    if (!environment) throw errorWithCode("Python environment is not managed by Trackers Lens.", "PYTHON_ENVIRONMENT_UNKNOWN");
    const environmentExists = await exists(environment.pythonPath);
    const models = (pack.models || []).map((model) => ({
      id: String(model.id), displayName: String(model.displayName || model.id), revision: String(model.revision || ""), license: String(model.license || "Unknown"),
      installed: false, networkRequired: true
    }));
    for (const model of models) {
      const managed = environment.models?.find((item) => item.id === model.id);
      model.installed = Boolean(managed?.directory && await exists(managed.directory));
    }
    return {
      schemaVersion: "tl-python-install-plan/v1",
      pack: { id: String(pack.id), version: String(pack.version || ""), trustLevel: String(pack.trustLevel), installPolicy: String(pack.installPolicy || "managed-optional") },
      environment: { id: String(environment.id), interpreter: String(environment.interpreter || "Python"), action: environmentExists ? "reuse" : "create" },
      requirements: (pack.requirements || []).map((item) => ({ name: String(item.name), version: String(item.version || "").replace(/^==/, "") })),
      models,
      network: { required: true, reasons: ["Download pinned Python packages from configured package indexes", ...models.filter((model) => !model.installed).map((model) => `Download model ${model.id} at declared revision`)] },
      integrity: { lockfile: String(pack.lockfile || ""), versionPinned: true, hashesPresent: false },
      requiresUserConsent: true
    };
  }

  async install({ packId, confirmed = false } = {}) {
    if (!confirmed) throw errorWithCode("Python pack installation requires confirmation.", "PYTHON_PACK_CONFIRMATION_REQUIRED");
    const plan = await this.getInstallPlan({ packId });
    if (this.installing.has(plan.environment.id)) throw errorWithCode("A Python environment installation is already running.", "PYTHON_INSTALL_IN_PROGRESS");
    const pack = this.pack(packId);
    const environment = this.environment(pack.environment);
    this.installing.add(environment.id);
    try {
      this.emitProgress({ packId: pack.id, environmentId: environment.id, phase: "preparing", progress: 5, message: "Preparing managed Python environment" });
      await environment.stopRuntime?.();
      if (!await exists(environment.pythonPath)) {
        this.emitProgress({ packId: pack.id, environmentId: environment.id, phase: "creating-environment", progress: 15, message: "Creating managed Python environment" });
        await this.runProcess(environment.bootstrapPython, ["-m", "venv", environment.directory]);
      }
      this.emitProgress({ packId: pack.id, environmentId: environment.id, phase: "installing-requirements", progress: 35, message: "Installing locked Python dependencies" });
      await this.runProcess(environment.pythonPath, ["-m", "pip", "install", "--disable-pip-version-check", "--no-input", "--requirement", pack.lockfilePath]);
      this.emitProgress({ packId: pack.id, environmentId: environment.id, phase: "verifying-requirements", progress: 65, message: "Verifying installed package versions" });
      const verificationCode = "import importlib.metadata as m, json, sys; print(json.dumps({name: m.version(name) for name in sys.argv[1:]}))";
      const verification = await this.runProcess(environment.pythonPath, ["-c", verificationCode, ...(pack.requirements || []).map((item) => item.name)]);
      let installedVersions = {};
      try { installedVersions = JSON.parse(verification.stdout.trim()); } catch (_) { throw errorWithCode("Python package verification returned invalid data.", "PYTHON_PACK_VERIFICATION_FAILED"); }
      const mismatched = (pack.requirements || []).filter((item) => expectedVersion(installedVersions[item.name]) !== expectedVersion(item.version));
      if (mismatched.length) throw errorWithCode(`Python package verification failed: ${mismatched.map((item) => item.name).join(", ")}`, "PYTHON_PACK_VERIFICATION_FAILED");
      const downloadedModels = [];
      for (const modelPlan of plan.models.filter((model) => !model.installed)) {
        const model = environment.models.find((item) => item.id === modelPlan.id);
        if (!model?.directory) throw errorWithCode("Python model target is not managed by Trackers Lens.", "PYTHON_MODEL_UNKNOWN");
        const temporaryDirectory = `${model.directory}.installing`;
        if (await exists(temporaryDirectory)) throw errorWithCode("A previous model installation needs attention before retrying.", "PYTHON_MODEL_INSTALL_INCOMPLETE");
        await fs.mkdir(path.dirname(model.directory), { recursive: true });
        this.emitProgress({ packId: pack.id, environmentId: environment.id, phase: "downloading-model", progress: 75, message: `Downloading ${model.displayName || model.id}`, modelId: model.id });
        const code = "from huggingface_hub import snapshot_download; import sys; snapshot_download(repo_id=sys.argv[1], revision=sys.argv[2], local_dir=sys.argv[3])";
        await this.runProcess(environment.pythonPath, ["-c", code, model.id, model.revision, temporaryDirectory]);
        await fs.rename(temporaryDirectory, model.directory);
        downloadedModels.push(model.id);
      }
      this.emitProgress({ packId: pack.id, environmentId: environment.id, phase: "starting-runtime", progress: 95, message: "Starting managed Python runtime" });
      await environment.onInstalled?.();
      const result = { status: "installed", packId: pack.id, environmentId: environment.id, requirements: plan.requirements, verifiedRequirements: Object.entries(installedVersions).map(([name, version]) => ({ name, version })), downloadedModels, restartRequired: false };
      this.emitProgress({ packId: pack.id, environmentId: environment.id, phase: "complete", progress: 100, message: "Python pack installed and ready" });
      return result;
    } catch (error) {
      this.emitProgress({ packId: pack.id, environmentId: environment.id, phase: "error", progress: 0, message: error?.message || "Python pack installation failed" });
      throw error;
    } finally {
      this.installing.delete(environment.id);
    }
  }
}

module.exports = { ManagedPythonPackInstaller };
