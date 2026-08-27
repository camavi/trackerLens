const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");

const clone = (value) => JSON.parse(JSON.stringify(value));
const errorWithCode = (message, code) => Object.assign(new Error(message), { code });
const exists = async (target) => fs.access(target).then(() => true).catch(() => false);
const expectedVersion = (value = "") => String(value || "").trim().replace(/^==/, "");
const directorySize = async (target) => {
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat || stat.isSymbolicLink()) return 0;
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;
  const entries = await fs.readdir(target, { withFileTypes: true }).catch(() => []);
  const sizes = await Promise.all(entries.map((entry) => directorySize(path.join(target, entry.name))));
  return sizes.reduce((total, size) => total + size, 0);
};
const resumableModelMetadataPath = (temporaryDirectory, revision) => path.join(
  temporaryDirectory,
  ".cache",
  "huggingface",
  "trees",
  `${String(revision || "")}.json`
);
const canResumeModelDownload = async (temporaryDirectory, revision) => {
  if (!String(revision || "").trim()) return false;
  return exists(resumableModelMetadataPath(temporaryDirectory, revision));
};
const safeRelativeFile = (file) => String(file || "").trim() && !String(file).includes("..") && !path.isAbsolute(String(file));
const modelDownloadProgress = async ({ temporaryDirectory, revision, downloadFiles = [], estimatedDownloadBytes = 0 }) => {
  const files = downloadFiles.map(String).filter(safeRelativeFile);
  const metadataPath = resumableModelMetadataPath(temporaryDirectory, revision);
  let remoteFiles = {};
  try { remoteFiles = JSON.parse(await fs.readFile(metadataPath, "utf8")).files || {}; } catch (_) { /* Metadata is not available before the first Hub response. */ }
  const allowed = files.length ? files : Object.keys(remoteFiles);
  const totalFromMetadata = allowed.reduce((total, file) => total + Number(remoteFiles[file]?.size || 0), 0);
  const totalBytes = totalFromMetadata || Number(estimatedDownloadBytes || 0);
  const directBytes = await Promise.all(allowed.map(async (file) => {
    const stat = await fs.stat(path.join(temporaryDirectory, file)).catch(() => null);
    return stat?.isFile() ? Math.min(Number(stat.size || 0), Number(remoteFiles[file]?.size || stat.size || 0)) : 0;
  }));
  const cacheDirectory = path.join(temporaryDirectory, ".cache", "huggingface", "download");
  const incompleteEntries = await fs.readdir(cacheDirectory, { withFileTypes: true }).catch(() => []);
  const inFlightBytes = await Promise.all(allowed.map(async (file) => {
    const lfsHash = String(remoteFiles[file]?.lfs_sha256 || "");
    if (!lfsHash) return 0;
    const matches = incompleteEntries.filter((entry) => entry.isFile() && entry.name.includes(lfsHash) && entry.name.endsWith(".incomplete"));
    const sizes = await Promise.all(matches.map(async (entry) => Number((await fs.stat(path.join(cacheDirectory, entry.name)).catch(() => null))?.size || 0)));
    return Math.min(Number(remoteFiles[file]?.size || Infinity), Math.max(0, ...sizes));
  }));
  const downloadedBytes = directBytes.reduce((total, size) => total + size, 0) + inFlightBytes.reduce((total, size) => total + size, 0);
  return { downloadedBytes: totalBytes ? Math.min(downloadedBytes, totalBytes) : downloadedBytes, totalBytes };
};

const run = (command, args, { cwd = "", env = {}, onOutput = null } = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: cwd || undefined, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { const text = String(chunk); stdout += text; onOutput?.({ stream: "stdout", text }); });
  child.stderr.on("data", (chunk) => { const text = String(chunk); stderr += text; onOutput?.({ stream: "stderr", text }); });
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
      id: String(model.id), displayName: String(model.displayName || model.id), revision: String(model.revision || ""), license: String(model.license || ""), estimatedDownloadBytes: Number(model.estimatedDownloadBytes || 0),
      installed: false, networkRequired: true, resumeAvailable: false, partialBytes: 0
    }));
    for (const model of models) {
      const managed = environment.models?.find((item) => item.id === model.id);
      model.installed = Boolean(managed?.directory && await exists(managed.directory));
      if (!model.installed && managed?.directory) {
        const temporaryDirectory = `${managed.directory}.installing`;
        model.resumeAvailable = await canResumeModelDownload(temporaryDirectory, model.revision);
        if (model.resumeAvailable) model.partialBytes = (await modelDownloadProgress({
          temporaryDirectory,
          revision: model.revision,
          downloadFiles: managed.downloadFiles || model.downloadFiles || [],
          estimatedDownloadBytes: model.estimatedDownloadBytes
        })).downloadedBytes;
      }
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
        const modelRevision = String(modelPlan.revision || model.revision || "");
        const temporaryDirectory = `${model.directory}.installing`;
        const temporaryExists = await exists(temporaryDirectory);
        const resumeDownload = temporaryExists && await canResumeModelDownload(temporaryDirectory, modelRevision);
        if (temporaryExists && !resumeDownload) {
          throw errorWithCode("A previous partial model download cannot be verified safely. Remove it from Runtime Python e Modelli before retrying.", "PYTHON_MODEL_INSTALL_INCOMPLETE");
        }
        await fs.mkdir(path.dirname(model.directory), { recursive: true });
        this.emitProgress({ packId: pack.id, environmentId: environment.id, phase: "downloading-model", progress: 75, message: `${resumeDownload ? "Resuming" : "Downloading"} ${model.displayName || model.id}`, modelId: model.id });
        const downloadFiles = (Array.isArray(model.downloadFiles) ? model.downloadFiles : [])
          .map(String).filter((file) => file && !file.includes("..") && !path.isAbsolute(file));
        const reportMeasuredProgress = async () => {
          const { downloadedBytes, totalBytes } = await modelDownloadProgress({
            temporaryDirectory,
            revision: modelRevision,
            downloadFiles,
            estimatedDownloadBytes: modelPlan.estimatedDownloadBytes || model.estimatedDownloadBytes
          });
          const percent = totalBytes > 0 ? Math.max(0, Math.min(100, (downloadedBytes / totalBytes) * 100)) : null;
          this.emitProgress({
            packId: pack.id,
            environmentId: environment.id,
            phase: "downloading-model",
            progress: percent === null ? 75 : 75 + (percent * 0.18),
            message: `${resumeDownload ? "Resuming" : "Downloading"} ${model.displayName || model.id}`,
            modelId: model.id,
            downloadedBytes,
            totalBytes,
            modelProgress: percent,
          });
        };
        const code = "from huggingface_hub import snapshot_download; import json,sys; files=json.loads(sys.argv[4]); snapshot_download(repo_id=sys.argv[1],revision=sys.argv[2],local_dir=sys.argv[3],allow_patterns=files or None)";
        await reportMeasuredProgress();
        const progressTimer = setInterval(() => { void reportMeasuredProgress(); }, 750);
        try {
          await this.runProcess(environment.pythonPath, ["-c", code, model.id, modelRevision, temporaryDirectory, JSON.stringify(downloadFiles)]);
        } finally {
          clearInterval(progressTimer);
        }
        await reportMeasuredProgress();
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
