const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const https = require("node:https");
const path = require("node:path");

const clone = (value) => JSON.parse(JSON.stringify(value));
const errorWithCode = (message, code) => Object.assign(new Error(message), { code });
const installationErrorForUser = (error) => {
  const message = String(error?.message || error || "Python pack installation failed");
  if (/connection reset|connection aborted|connectionerror|protocolerror|localentrynotfounderror/i.test(message)) {
    return errorWithCode(
      "Il download del modello è stato interrotto dalla connessione al provider. Nessun file incompleto verrà eseguito: verifica la rete e riprova l'installazione.",
      "PYTHON_MODEL_NETWORK_INTERRUPTED"
    );
  }
  return error;
};
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
const sha256Pattern = /^[a-f0-9]{64}$/i;
const trustedArtifactHosts = new Set(["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"]);
const artifactMetadataPath = (temporaryDirectory) => path.join(temporaryDirectory, ".tl-artifact.json");
const wheelPartialPath = (temporaryDirectory) => path.join(temporaryDirectory, "artifact.whl.partial");
const wheelPath = (temporaryDirectory) => path.join(temporaryDirectory, "artifact.whl");
const artifactManifest = (model = {}) => model.artifact && typeof model.artifact === "object" ? model.artifact : null;
const isPinnedWheelArtifact = (model = {}) => artifactManifest(model)?.type === "python-wheel";
const validWheelArtifact = (model = {}) => {
  const artifact = artifactManifest(model);
  if (!artifact || artifact.type !== "python-wheel") return false;
  let url;
  try { url = new URL(String(artifact.url || "")); } catch (_) { return false; }
  return url.protocol === "https:" && trustedArtifactHosts.has(url.hostname) && sha256Pattern.test(String(artifact.sha256 || ""));
};
const wheelArtifactProgress = async ({ temporaryDirectory, artifact = {}, estimatedDownloadBytes = 0 }) => {
  const partial = await fs.stat(wheelPartialPath(temporaryDirectory)).catch(() => null);
  const completed = await fs.stat(wheelPath(temporaryDirectory)).catch(() => null);
  const downloadedBytes = Number(completed?.size || partial?.size || 0);
  const totalBytes = Number(artifact.sizeBytes || estimatedDownloadBytes || 0);
  return { downloadedBytes: totalBytes ? Math.min(downloadedBytes, totalBytes) : downloadedBytes, totalBytes };
};
const canResumeWheelArtifact = async (temporaryDirectory, model = {}) => {
  if (!validWheelArtifact(model)) return false;
  try {
    const metadata = JSON.parse(await fs.readFile(artifactMetadataPath(temporaryDirectory), "utf8"));
    return metadata.id === String(model.id || "")
      && metadata.revision === String(model.revision || "")
      && metadata.url === String(model.artifact.url || "")
      && metadata.sha256 === String(model.artifact.sha256 || "")
      && Boolean((await fs.stat(wheelPartialPath(temporaryDirectory)).catch(() => null))?.isFile());
  } catch (_) { return false; }
};
const requestPinnedArtifact = ({ url, headers = {}, redirects = 0 }) => new Promise((resolve, reject) => {
  if (redirects > 5) return reject(errorWithCode("Managed Python artifact redirected too many times.", "PYTHON_ARTIFACT_REDIRECT_INVALID"));
  let parsed;
  try { parsed = new URL(url); } catch (_) { return reject(errorWithCode("Managed Python artifact URL is invalid.", "PYTHON_ARTIFACT_URL_INVALID")); }
  if (parsed.protocol !== "https:" || !trustedArtifactHosts.has(parsed.hostname)) return reject(errorWithCode("Managed Python artifact source is not trusted.", "PYTHON_ARTIFACT_SOURCE_UNTRUSTED"));
  const request = https.get(parsed, { headers }, (response) => {
    if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
      response.resume();
      return requestPinnedArtifact({ url: new URL(response.headers.location, parsed).toString(), headers, redirects: redirects + 1 }).then(resolve, reject);
    }
    if (![200, 206].includes(response.statusCode)) {
      response.resume();
      return reject(errorWithCode(`Managed Python artifact download failed (${response.statusCode}).`, "PYTHON_ARTIFACT_DOWNLOAD_FAILED"));
    }
    resolve(response);
  });
  request.once("error", (error) => reject(Object.assign(error, { code: "PYTHON_ARTIFACT_DOWNLOAD_FAILED" })));
});
const downloadPinnedWheel = async ({ model, temporaryDirectory, onProgress = null }) => {
  if (!validWheelArtifact(model)) throw errorWithCode("Python wheel artifact is not pinned to a trusted URL and SHA-256.", "PYTHON_ARTIFACT_INVALID");
  const artifact = artifactManifest(model);
  await fs.mkdir(temporaryDirectory, { recursive: true });
  const resume = await canResumeWheelArtifact(temporaryDirectory, model);
  if (!resume && await exists(temporaryDirectory)) {
    const entries = await fs.readdir(temporaryDirectory).catch(() => []);
    if (entries.length && !await exists(wheelPath(temporaryDirectory))) throw errorWithCode("A previous partial Python artifact cannot be verified safely. Remove it from Runtime Python e Modelli before retrying.", "PYTHON_MODEL_INSTALL_INCOMPLETE");
  }
  await fs.writeFile(artifactMetadataPath(temporaryDirectory), JSON.stringify({ id: String(model.id), revision: String(model.revision || ""), url: String(artifact.url), sha256: String(artifact.sha256) }));
  const partialPath = wheelPartialPath(temporaryDirectory);
  const completedPath = wheelPath(temporaryDirectory);
  const completed = await fs.stat(completedPath).catch(() => null);
  if (!completed) {
    const partial = await fs.stat(partialPath).catch(() => null);
    const existingBytes = Number(partial?.size || 0);
    const response = await requestPinnedArtifact({ url: artifact.url, headers: existingBytes ? { Range: `bytes=${existingBytes}-` } : {} });
    const append = existingBytes > 0 && response.statusCode === 206;
    if (!append && existingBytes) await fs.rm(partialPath, { force: true });
    const output = require("node:fs").createWriteStream(partialPath, { flags: append ? "a" : "w" });
    let downloadedBytes = append ? existingBytes : 0;
    const totalBytes = Number(artifact.sizeBytes || response.headers["content-range"]?.split("/").pop() || response.headers["content-length"] || 0);
    await new Promise((resolve, reject) => {
      response.on("data", (chunk) => { downloadedBytes += chunk.length; onProgress?.({ downloadedBytes, totalBytes }); });
      response.once("error", reject);
      output.once("error", reject);
      output.once("finish", resolve);
      response.pipe(output);
    });
    await fs.rename(partialPath, completedPath);
  }
  const contents = await fs.readFile(completedPath);
  const hash = crypto.createHash("sha256").update(contents).digest("hex");
  if (hash.toLowerCase() !== String(artifact.sha256).toLowerCase()) throw errorWithCode("Downloaded Python artifact failed SHA-256 verification.", "PYTHON_ARTIFACT_INTEGRITY_FAILED");
  await fs.rm(path.join(temporaryDirectory, "content"), { recursive: true, force: true });
  const extractCode = "import pathlib,sys,zipfile; wheel,path=map(pathlib.Path,sys.argv[1:]); z=zipfile.ZipFile(wheel); infos=z.infolist(); bad=[i.filename for i in infos if pathlib.PurePosixPath(i.filename).is_absolute() or '..' in pathlib.PurePosixPath(i.filename).parts or ((i.external_attr >> 16) & 0o170000) == 0o120000]; total=sum(i.file_size for i in infos); assert not bad and total <= 2_000_000_000, 'unsafe wheel archive'; path.mkdir(parents=True,exist_ok=True); z.extractall(path)";
  await new Promise((resolve) => setImmediate(resolve));
  return { wheelPath: completedPath, extractCode };
};
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
  constructor({ packs = [], environments = [], runProcess = run, downloadWheelArtifact = downloadPinnedWheel } = {}) {
    this.packs = Array.isArray(packs) ? packs.map(clone) : [];
    this.environments = Array.isArray(environments) ? environments : [];
    this.runProcess = runProcess;
    this.downloadWheelArtifact = downloadWheelArtifact;
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
      id: String(model.id), displayName: String(model.displayName || model.id), revision: String(model.revision || ""), license: String(model.license || ""), estimatedDownloadBytes: Number(model.estimatedDownloadBytes || model.artifact?.sizeBytes || 0), artifactType: String(model.artifact?.type || "huggingface-snapshot"), source: String(model.artifact?.source || "Hugging Face"),
      installed: false, networkRequired: true, resumeAvailable: false, partialBytes: 0
    }));
    for (const model of models) {
      const managed = environment.models?.find((item) => item.id === model.id);
      model.installed = Boolean(managed?.directory && await exists(managed.directory));
      if (!model.installed && managed?.directory) {
        const temporaryDirectory = `${managed.directory}.installing`;
        model.resumeAvailable = isPinnedWheelArtifact(managed) ? await canResumeWheelArtifact(temporaryDirectory, managed) : await canResumeModelDownload(temporaryDirectory, model.revision);
        if (model.resumeAvailable) {
          model.partialBytes = (isPinnedWheelArtifact(managed)
            ? await wheelArtifactProgress({ temporaryDirectory, artifact: managed.artifact, estimatedDownloadBytes: model.estimatedDownloadBytes })
            : await modelDownloadProgress({ temporaryDirectory, revision: model.revision, downloadFiles: managed.downloadFiles || model.downloadFiles || [], estimatedDownloadBytes: model.estimatedDownloadBytes })
          ).downloadedBytes;
        }
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
        const wheelArtifact = isPinnedWheelArtifact(model);
        const resumeDownload = temporaryExists && (wheelArtifact ? await canResumeWheelArtifact(temporaryDirectory, model) : await canResumeModelDownload(temporaryDirectory, modelRevision));
        if (temporaryExists && !resumeDownload) {
          throw errorWithCode("A previous partial model download cannot be verified safely. Remove it from Runtime Python e Modelli before retrying.", "PYTHON_MODEL_INSTALL_INCOMPLETE");
        }
        await fs.mkdir(path.dirname(model.directory), { recursive: true });
        this.emitProgress({ packId: pack.id, environmentId: environment.id, phase: "downloading-model", progress: 75, message: `${resumeDownload ? "Resuming" : "Downloading"} ${model.displayName || model.id}`, modelId: model.id });
        const downloadFiles = (Array.isArray(model.downloadFiles) ? model.downloadFiles : [])
          .map(String).filter((file) => file && !file.includes("..") && !path.isAbsolute(file));
        const reportMeasuredProgress = async () => {
          const measurement = wheelArtifact
            ? await wheelArtifactProgress({ temporaryDirectory, artifact: model.artifact, estimatedDownloadBytes: modelPlan.estimatedDownloadBytes || model.estimatedDownloadBytes })
            : await modelDownloadProgress({ temporaryDirectory, revision: modelRevision, downloadFiles, estimatedDownloadBytes: modelPlan.estimatedDownloadBytes || model.estimatedDownloadBytes });
          const { downloadedBytes, totalBytes } = measurement;
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
        await reportMeasuredProgress();
        if (wheelArtifact) {
          const downloaded = await this.downloadWheelArtifact({ model, temporaryDirectory, onProgress: ({ downloadedBytes, totalBytes }) => {
            const percent = totalBytes > 0 ? Math.max(0, Math.min(100, (downloadedBytes / totalBytes) * 100)) : null;
            this.emitProgress({ packId: pack.id, environmentId: environment.id, phase: "downloading-model", progress: percent === null ? 75 : 75 + (percent * 0.18), message: `${resumeDownload ? "Resuming" : "Downloading"} ${model.displayName || model.id}`, modelId: model.id, downloadedBytes, totalBytes, modelProgress: percent });
          } });
          this.emitProgress({ packId: pack.id, environmentId: environment.id, phase: "installing-model", progress: 94, message: `Verifying ${model.displayName || model.id}`, modelId: model.id });
          await this.runProcess(environment.pythonPath, ["-c", downloaded.extractCode, downloaded.wheelPath, path.join(temporaryDirectory, "content")]);
          await fs.rm(downloaded.wheelPath, { force: true });
          await fs.rm(artifactMetadataPath(temporaryDirectory), { force: true });
        } else {
          const code = "from huggingface_hub import snapshot_download; import json,sys,time; files=json.loads(sys.argv[4]); last=None\nfor attempt in range(3):\n    try:\n        snapshot_download(repo_id=sys.argv[1],revision=sys.argv[2],local_dir=sys.argv[3],allow_patterns=files or None,max_workers=1)\n        last=None\n        break\n    except Exception as error:\n        last=error\n        if attempt == 2: raise\n        time.sleep(2 * (attempt + 1))\nif last: raise last";
          const progressTimer = setInterval(() => { void reportMeasuredProgress(); }, 750);
          try {
            await this.runProcess(environment.pythonPath, ["-c", code, model.id, modelRevision, temporaryDirectory, JSON.stringify(downloadFiles)]);
          } finally {
            clearInterval(progressTimer);
          }
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
      const userError = installationErrorForUser(error);
      this.emitProgress({ packId: pack.id, environmentId: environment.id, phase: "error", progress: 0, message: userError?.message || "Python pack installation failed" });
      throw userError;
    } finally {
      this.installing.delete(environment.id);
    }
  }
}

module.exports = { ManagedPythonPackInstaller };
