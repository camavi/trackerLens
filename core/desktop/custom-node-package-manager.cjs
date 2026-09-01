const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { intersectPermissions, normalizePermissions: normalizeSandboxPermissions } = require("./custom-node-sandbox-contract.cjs");

const PACKAGE_FORMAT = "tl-node-package/v1";
const ZIP_EXTENSION = ".tl-node.zip";
const STORE_NAME = "tl_packages";
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const MAX_RUNTIME_SOURCE_BYTES = 2 * 1024 * 1024;

const errorWithCode = (message, code) => Object.assign(new Error(message), { code });
const clone = (value) => JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const text = (value) => String(value || "").trim();
const safePackageSegment = (value) => text(value).replace(/[^a-zA-Z0-9._-]+/g, "_");

const isSafeArchivePath = (value) => {
  const entry = String(value || "").replace(/\\/g, "/");
  const normalized = entry.endsWith("/") ? entry.slice(0, -1) : entry;
  return Boolean(entry)
    && Boolean(normalized)
    && !normalized.startsWith("/")
    && !/^[A-Za-z]:\//.test(normalized)
    && !normalized.includes("\0")
    && normalized.split("/").every((part) => part && part !== "." && part !== "..");
};

const findEndOfCentralDirectory = (archive) => {
  const minimumSize = 22;
  if (!Buffer.isBuffer(archive) || archive.length < minimumSize) throw errorWithCode("Archivio ZIP non valido o incompleto.", "CUSTOM_NODE_ZIP_INVALID");
  const start = Math.max(0, archive.length - minimumSize - 0xffff);
  for (let offset = archive.length - minimumSize; offset >= start; offset -= 1) {
    if (archive.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) return offset;
  }
  throw errorWithCode("Archivio ZIP privo della directory centrale.", "CUSTOM_NODE_ZIP_INVALID");
};

const listZipEntries = (archive) => {
  const eocdOffset = findEndOfCentralDirectory(archive);
  const diskNumber = archive.readUInt16LE(eocdOffset + 4);
  const centralDisk = archive.readUInt16LE(eocdOffset + 6);
  const entryCount = archive.readUInt16LE(eocdOffset + 10);
  const centralSize = archive.readUInt32LE(eocdOffset + 12);
  const centralOffset = archive.readUInt32LE(eocdOffset + 16);
  if (diskNumber !== 0 || centralDisk !== 0) throw errorWithCode("Gli archivi ZIP multi-volume non sono supportati.", "CUSTOM_NODE_ZIP_MULTIVOLUME");
  if (centralOffset + centralSize > archive.length) throw errorWithCode("Directory centrale ZIP fuori dai limiti dell'archivio.", "CUSTOM_NODE_ZIP_INVALID");

  const entries = [];
  const names = new Set();
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > archive.length || archive.readUInt32LE(offset) !== ZIP_CENTRAL_SIGNATURE) {
      throw errorWithCode("Record ZIP centrale non valido.", "CUSTOM_NODE_ZIP_INVALID");
    }
    const flags = archive.readUInt16LE(offset + 8);
    const compressionMethod = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const recordEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (recordEnd > archive.length) throw errorWithCode("Nome file ZIP fuori dai limiti dell'archivio.", "CUSTOM_NODE_ZIP_INVALID");
    if (flags & 0x1) throw errorWithCode("Gli archivi ZIP cifrati non sono supportati.", "CUSTOM_NODE_ZIP_ENCRYPTED");
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (!isSafeArchivePath(name)) throw errorWithCode(`Percorso archivio non sicuro: ${name || "(vuoto)"}`, "CUSTOM_NODE_ZIP_PATH_UNSAFE");
    if (names.has(name)) throw errorWithCode(`File duplicato nell'archivio: ${name}`, "CUSTOM_NODE_ZIP_DUPLICATE_ENTRY");
    names.add(name);
    entries.push(Object.freeze({ name, flags, compressionMethod, compressedSize, uncompressedSize, localOffset }));
    offset = recordEnd;
  }
  return entries;
};

const readZipEntry = (archive, entry) => {
  const offset = Number(entry?.localOffset);
  if (!Number.isInteger(offset) || offset < 0 || offset + 30 > archive.length || archive.readUInt32LE(offset) !== ZIP_LOCAL_SIGNATURE) {
    throw errorWithCode(`Record locale ZIP non valido: ${entry?.name || "sconosciuto"}`, "CUSTOM_NODE_ZIP_INVALID");
  }
  const nameLength = archive.readUInt16LE(offset + 26);
  const extraLength = archive.readUInt16LE(offset + 28);
  const contentStart = offset + 30 + nameLength + extraLength;
  const contentEnd = contentStart + Number(entry.compressedSize || 0);
  if (contentEnd > archive.length) throw errorWithCode(`Contenuto ZIP fuori dai limiti: ${entry.name}`, "CUSTOM_NODE_ZIP_INVALID");
  const compressed = archive.subarray(contentStart, contentEnd);
  let content;
  if (entry.compressionMethod === 0) content = Buffer.from(compressed);
  else if (entry.compressionMethod === 8) content = zlib.inflateRawSync(compressed);
  else throw errorWithCode(`Compressione ZIP non supportata per ${entry.name}.`, "CUSTOM_NODE_ZIP_COMPRESSION_UNSUPPORTED");
  if (content.length !== Number(entry.uncompressedSize || 0)) throw errorWithCode(`Dimensione ZIP non coerente per ${entry.name}.`, "CUSTOM_NODE_ZIP_INVALID");
  return content;
};

const normalizePorts = (value, label) => {
  if (!Array.isArray(value) || value.some((port) => !text(port))) throw errorWithCode(`${label} deve essere un array di porte non vuote.`, "CUSTOM_NODE_MANIFEST_INVALID");
  return [...new Set(value.map((port) => text(port)))];
};

const normalizePermissions = (value = {}) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw errorWithCode("permissions deve essere un oggetto.", "CUSTOM_NODE_MANIFEST_INVALID");
  const runtimeGraph = text(value.runtimeGraph || "none");
  if (!["none", "read", "write"].includes(runtimeGraph)) throw errorWithCode("permissions.runtimeGraph deve essere none, read o write.", "CUSTOM_NODE_MANIFEST_INVALID");
  return Object.freeze({
    network: Boolean(value.network),
    filesystem: Boolean(value.filesystem),
    aiProvider: Boolean(value.aiProvider),
    memory: Boolean(value.memory),
    runtimeGraph
  });
};

const normalizeManifest = (rawManifest = {}, entries = []) => {
  if (!rawManifest || typeof rawManifest !== "object" || Array.isArray(rawManifest)) throw errorWithCode("node.json deve contenere un oggetto JSON.", "CUSTOM_NODE_MANIFEST_INVALID");
  const id = text(rawManifest.id);
  const version = text(rawManifest.version);
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) throw errorWithCode("node.json id non valido.", "CUSTOM_NODE_MANIFEST_INVALID");
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) throw errorWithCode("node.json version deve essere semver.", "CUSTOM_NODE_MANIFEST_INVALID");
  const names = new Set(entries.map((entry) => entry.name));
  const runtime = rawManifest.runtime && typeof rawManifest.runtime === "object" ? rawManifest.runtime : {};
  const runtimeEntry = text(runtime.entry);
  if (runtimeEntry && !names.has(runtimeEntry)) throw errorWithCode(`runtime.entry non presente nell'archivio: ${runtimeEntry}`, "CUSTOM_NODE_MANIFEST_INVALID");
  const ui = rawManifest.ui && typeof rawManifest.ui === "object" ? rawManifest.ui : {};
  const uiSchema = text(ui.schema);
  if (uiSchema && !names.has(uiSchema)) throw errorWithCode(`ui.schema non presente nell'archivio: ${uiSchema}`, "CUSTOM_NODE_MANIFEST_INVALID");
  return Object.freeze({
    packageFormat: PACKAGE_FORMAT,
    id,
    name: text(rawManifest.name),
    version,
    publisher: text(rawManifest.publisher),
    category: text(rawManifest.category),
    subtype: text(rawManifest.subtype),
    icon: text(rawManifest.icon),
    inputs: normalizePorts(rawManifest.inputs || [], "inputs"),
    outputs: normalizePorts(rawManifest.outputs || [], "outputs"),
    permissions: normalizePermissions(rawManifest.permissions || {}),
    runtime: Object.freeze({ entry: runtimeEntry, mode: text(runtime.mode, "blocked") }),
    ui: Object.freeze({ schema: uiSchema })
  });
};

// An import-time review aid, not a security sandbox or a safety verdict.
// Runtime source is never evaluated here; the future sandbox must enforce
// permissions independently of these transparent findings.
const analyzeRuntimeSource = ({ archive, entries, manifest }) => {
  const entryName = text(manifest?.runtime?.entry);
  if (!entryName) return Object.freeze({ status: "not-applicable", entry: "", findings: [] });
  const entry = entries.find((item) => item.name === entryName);
  if (!entry) return Object.freeze({ status: "unavailable", entry: entryName, findings: [] });
  const source = readZipEntry(archive, entry).toString("utf8");
  const declared = manifest.permissions || {};
  const rules = [
    { code: "DYNAMIC_CODE", severity: "high", pattern: /\beval\s*\(|\bnew\s+Function\s*\(/, message: "Codice dinamico (eval/Function) rilevato." },
    { code: "NODE_PROCESS", severity: "high", pattern: /\bprocess\b|\bchild_process\b|\bnode:child_process\b/, message: "Accesso al processo o a child_process rilevato." },
    { code: "NODE_MODULE_LOAD", severity: "high", pattern: /\brequire\s*\(|\bimport\s*\(/, message: "Caricamento di moduli dinamico rilevato." },
    { code: "NETWORK", severity: "medium", pattern: /\bfetch\s*\(|\bWebSocket\b|\bXMLHttpRequest\b/, permission: "network", message: "Uso diretto della rete rilevato." },
    { code: "FILESYSTEM", severity: "medium", pattern: /\bnode:fs\b|\brequire\s*\(\s*["']fs["']|\bfs\./, permission: "filesystem", message: "Uso diretto del filesystem rilevato." },
    { code: "BROWSER_STORAGE", severity: "medium", pattern: /\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b/, permission: "memory", message: "Storage del browser rilevato." }
  ];
  const findings = rules.filter((rule) => rule.pattern.test(source)).map((rule) => Object.freeze({
    code: rule.code,
    severity: rule.severity,
    message: rule.message,
    permission: rule.permission || "",
    permissionDeclared: rule.permission ? Boolean(declared[rule.permission]) : null
  }));
  return Object.freeze({ status: "reviewed", entry: entryName, findings });
};

const inspectArchive = (archive) => {
  const entries = listZipEntries(archive);
  const manifestEntry = entries.find((entry) => entry.name === "node.json");
  if (!manifestEntry) throw errorWithCode("L'archivio .tl-node.zip deve contenere node.json nella radice.", "CUSTOM_NODE_MANIFEST_MISSING");
  let rawManifest;
  try {
    rawManifest = JSON.parse(readZipEntry(archive, manifestEntry).toString("utf8"));
  } catch (error) {
    if (error?.code) throw error;
    throw errorWithCode("node.json non contiene JSON valido.", "CUSTOM_NODE_MANIFEST_INVALID");
  }
  const manifest = normalizeManifest(rawManifest, entries);
  const staticAnalysis = analyzeRuntimeSource({ archive, entries, manifest });
  return Object.freeze({
    packageFormat: PACKAGE_FORMAT,
    archiveSha256: sha256(archive),
    manifest,
    files: entries.map((entry) => Object.freeze({ name: entry.name, compressedSize: entry.compressedSize, size: entry.uncompressedSize })),
    staticAnalysis,
    runtimeExecution: "blocked"
  });
};

class CustomNodePackageManager {
  constructor({ packagesDirectory = "", persistence = null } = {}) {
    if (!text(packagesDirectory)) throw new Error("Custom Node Package Manager richiede packagesDirectory.");
    this.packagesDirectory = path.resolve(packagesDirectory);
    this.persistence = persistence;
  }

  async inspectFile(archivePath = "") {
    const source = path.resolve(String(archivePath || ""));
    if (!source.toLowerCase().endsWith(ZIP_EXTENSION)) throw errorWithCode("Seleziona un archivio .tl-node.zip.", "CUSTOM_NODE_ARCHIVE_EXTENSION_INVALID");
    const archive = await fs.promises.readFile(source);
    return inspectArchive(archive);
  }

  async installFile(archivePath = "") {
    const source = path.resolve(String(archivePath || ""));
    const inspection = await this.inspectFile(source);
    const packageDirectory = path.join(this.packagesDirectory, safePackageSegment(inspection.manifest.id), safePackageSegment(inspection.manifest.version));
    const artifactId = `archive_${inspection.archiveSha256}`;
    const destination = path.join(packageDirectory, `${artifactId}${ZIP_EXTENSION}`);
    await fs.promises.mkdir(packageDirectory, { recursive: true });
    if (!fs.existsSync(destination)) await fs.promises.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
    const copiedHash = sha256(await fs.promises.readFile(destination));
    if (copiedHash !== inspection.archiveSha256) throw errorWithCode("Hash dell'archivio importato non coerente.", "CUSTOM_NODE_ARCHIVE_HASH_MISMATCH");

    const record = {
      id: `custom_node_${safePackageSegment(inspection.manifest.id)}_${safePackageSegment(inspection.manifest.version)}_${inspection.archiveSha256.slice(0, 12)}`,
      packageKind: "custom-node",
      packageFormat: PACKAGE_FORMAT,
      packageId: inspection.manifest.id,
      name: inspection.manifest.name,
      version: inspection.manifest.version,
      publisher: inspection.manifest.publisher,
      category: inspection.manifest.category,
      subtype: inspection.manifest.subtype,
      manifest: clone(inspection.manifest),
      archive: { id: artifactId, format: ZIP_EXTENSION, sha256: inspection.archiveSha256, fileCount: inspection.files.length },
      files: inspection.files.map(clone),
      staticAnalysis: clone(inspection.staticAnalysis),
      trustLevel: "local-dev",
      permissions: clone(inspection.manifest.permissions),
      grantedPermissions: normalizeSandboxPermissions(),
      permissionConsent: { status: "not-granted", grantedAt: "" },
      installState: "manifest-only",
      runtimeExecution: "blocked",
      installedAt: now(),
      updatedAt: now()
    };
    if (!this.persistence?.writeDevelopmentRecords) throw errorWithCode("Catalogo SQLite dei pacchetti non disponibile.", "CUSTOM_NODE_PACKAGE_CATALOG_UNAVAILABLE");
    await this.persistence.writeDevelopmentRecords({ storeName: STORE_NAME, records: [record] });
    return Object.freeze(this.publicRecord(record));
  }

  async listInstalled() {
    if (!this.persistence?.readDevelopmentRecords) throw errorWithCode("Catalogo SQLite dei pacchetti non disponibile.", "CUSTOM_NODE_PACKAGE_CATALOG_UNAVAILABLE");
    const records = await this.persistence.readDevelopmentRecords({ storeName: STORE_NAME });
    return records.filter((record) => record?.packageKind === "custom-node").map((record) => this.publicRecord(record));
  }

  async grantPermissions({ packageId = "", version = "", archiveSha256 = "", permissions = {}, confirmed = false } = {}) {
    if (!confirmed) throw errorWithCode("La concessione dei permessi richiede una conferma esplicita.", "CUSTOM_NODE_PERMISSION_CONFIRMATION_REQUIRED");
    if (!this.persistence?.readDevelopmentRecords || !this.persistence?.writeDevelopmentRecords) {
      throw errorWithCode("Catalogo SQLite dei pacchetti non disponibile.", "CUSTOM_NODE_PACKAGE_CATALOG_UNAVAILABLE");
    }
    const records = await this.persistence.readDevelopmentRecords({ storeName: STORE_NAME });
    const matches = records.filter((record) => record?.packageKind === "custom-node"
      && text(record.packageId) === text(packageId)
      && text(record.version) === text(version)
      && text(record.archive?.sha256) === text(archiveSha256));
    if (matches.length !== 1) throw errorWithCode("Riferimento pacchetto non valido o non univoco.", "CUSTOM_NODE_PACKAGE_REFERENCE_INVALID");
    const record = matches[0];
    const nextRecord = {
      ...record,
      grantedPermissions: intersectPermissions(record.permissions || record.manifest?.permissions, permissions),
      permissionConsent: { status: "granted", grantedAt: now() },
      updatedAt: now()
    };
    await this.persistence.writeDevelopmentRecords({ storeName: STORE_NAME, records: [nextRecord] });
    return Object.freeze(this.publicRecord(nextRecord));
  }

  async activateSandboxRuntime({ packageId = "", version = "", archiveSha256 = "", confirmed = false } = {}) {
    if (!confirmed) throw errorWithCode("L'attivazione sandbox richiede una conferma esplicita.", "CUSTOM_NODE_SANDBOX_ACTIVATION_CONFIRMATION_REQUIRED");
    if (!this.persistence?.readDevelopmentRecords || !this.persistence?.writeDevelopmentRecords) throw errorWithCode("Catalogo SQLite dei pacchetti non disponibile.", "CUSTOM_NODE_PACKAGE_CATALOG_UNAVAILABLE");
    const records = await this.persistence.readDevelopmentRecords({ storeName: STORE_NAME });
    const matches = records.filter((record) => record?.packageKind === "custom-node"
      && text(record.packageId) === text(packageId)
      && text(record.version) === text(version)
      && text(record.archive?.sha256) === text(archiveSha256));
    if (matches.length !== 1) throw errorWithCode("Riferimento pacchetto non valido o non univoco.", "CUSTOM_NODE_PACKAGE_REFERENCE_INVALID");
    const record = matches[0];
    if (record.permissionConsent?.status !== "granted") throw errorWithCode("Registra prima il consenso ai permessi dichiarati.", "CUSTOM_NODE_PERMISSION_CONSENT_REQUIRED");
    if (text(record.manifest?.runtime?.mode) !== "sandboxed") throw errorWithCode("Il manifest non dichiara un runtime sandboxed.", "CUSTOM_NODE_RUNTIME_MODE_UNSUPPORTED");
    const nextRecord = { ...record, installState: "sandbox-ready", runtimeExecution: "sandboxed", activatedAt: now(), updatedAt: now() };
    await this.persistence.writeDevelopmentRecords({ storeName: STORE_NAME, records: [nextRecord] });
    return Object.freeze(this.publicRecord(nextRecord));
  }

  async loadRuntimeSource({ packageId = "", version = "", archiveSha256 = "" } = {}) {
    if (!this.persistence?.readDevelopmentRecords) throw errorWithCode("Catalogo SQLite dei pacchetti non disponibile.", "CUSTOM_NODE_PACKAGE_CATALOG_UNAVAILABLE");
    const records = await this.persistence.readDevelopmentRecords({ storeName: STORE_NAME });
    const record = records.find((item) => item?.packageKind === "custom-node"
      && text(item.packageId) === text(packageId)
      && text(item.version) === text(version)
      && text(item.archive?.sha256) === text(archiveSha256));
    if (!record) throw errorWithCode("Riferimento pacchetto non valido.", "CUSTOM_NODE_PACKAGE_REFERENCE_INVALID");
    const archivePath = path.join(this.packagesDirectory, safePackageSegment(record.packageId), safePackageSegment(record.version), `${text(record.archive?.id)}${ZIP_EXTENSION}`);
    const archive = await fs.promises.readFile(archivePath);
    if (sha256(archive) !== text(record.archive?.sha256)) throw errorWithCode("Hash archivio non coerente.", "CUSTOM_NODE_ARCHIVE_HASH_MISMATCH");
    const inspected = inspectArchive(archive);
    const entry = listZipEntries(archive).find((item) => item.name === inspected.manifest.runtime.entry);
    if (!entry) throw errorWithCode("Entry runtime non disponibile.", "CUSTOM_NODE_RUNTIME_ENTRY_MISSING");
    return { record: this.publicRecord(record), source: readZipEntry(archive, entry).toString("utf8") };
  }

  // This method is intentionally Core-only: it returns the verified source to
  // the Main-owned sandbox coordinator, never through the renderer bridge.
  async loadSandboxRuntime({ packageId = "", version = "", archiveSha256 = "" } = {}) {
    if (!this.persistence?.readDevelopmentRecords) throw errorWithCode("Catalogo SQLite dei pacchetti non disponibile.", "CUSTOM_NODE_PACKAGE_CATALOG_UNAVAILABLE");
    const records = await this.persistence.readDevelopmentRecords({ storeName: STORE_NAME });
    const matches = records.filter((item) => item?.packageKind === "custom-node"
      && text(item.packageId) === text(packageId)
      && text(item.version) === text(version)
      && text(item.archive?.sha256) === text(archiveSha256));
    if (matches.length !== 1) throw errorWithCode("Riferimento pacchetto non valido o non univoco.", "CUSTOM_NODE_PACKAGE_REFERENCE_INVALID");
    const record = matches[0];
    if (text(record.runtimeExecution, "blocked") !== "sandboxed") {
      throw errorWithCode("Il runtime del pacchetto non è abilitato per la sandbox.", "CUSTOM_NODE_RUNTIME_BLOCKED");
    }
    const archivePath = path.join(this.packagesDirectory, safePackageSegment(record.packageId), safePackageSegment(record.version), `${text(record.archive?.id)}${ZIP_EXTENSION}`);
    const archive = await fs.promises.readFile(archivePath);
    if (sha256(archive) !== text(record.archive?.sha256)) throw errorWithCode("Hash archivio non coerente.", "CUSTOM_NODE_ARCHIVE_HASH_MISMATCH");
    const inspected = inspectArchive(archive);
    if (inspected.archiveSha256 !== text(record.archive?.sha256)
      || inspected.manifest.id !== text(record.packageId)
      || inspected.manifest.version !== text(record.version)
      || inspected.manifest.runtime.mode !== "sandboxed") {
      throw errorWithCode("Manifest del pacchetto non coerente con il catalogo sandbox.", "CUSTOM_NODE_RUNTIME_MANIFEST_MISMATCH");
    }
    const entry = listZipEntries(archive).find((item) => item.name === inspected.manifest.runtime.entry);
    if (!entry) throw errorWithCode("Entry runtime non disponibile.", "CUSTOM_NODE_RUNTIME_ENTRY_MISSING");
    if (entry.uncompressedSize > MAX_RUNTIME_SOURCE_BYTES) throw errorWithCode("runtime.js supera la dimensione massima consentita.", "CUSTOM_NODE_RUNTIME_SOURCE_TOO_LARGE");
    const source = readZipEntry(archive, entry);
    if (source.length > MAX_RUNTIME_SOURCE_BYTES) throw errorWithCode("runtime.js supera la dimensione massima consentita.", "CUSTOM_NODE_RUNTIME_SOURCE_TOO_LARGE");
    return Object.freeze({
      packageRecord: {
        ...record,
        manifest: clone(inspected.manifest),
        permissions: clone(record.permissions || inspected.manifest.permissions),
        grantedPermissions: normalizeSandboxPermissions(record.grantedPermissions),
        archive: clone(record.archive)
      },
      source: source.toString("utf8")
    });
  }

  publicRecord(record = {}) {
    return {
      id: text(record.id),
      packageKind: "custom-node",
      packageFormat: PACKAGE_FORMAT,
      packageId: text(record.packageId),
      name: text(record.name),
      version: text(record.version),
      publisher: text(record.publisher),
      category: text(record.category),
      subtype: text(record.subtype),
      manifest: clone(record.manifest || {}),
      archive: clone(record.archive || {}),
      files: Array.isArray(record.files) ? record.files.map(clone) : [],
      staticAnalysis: clone(record.staticAnalysis || { status: "not-reviewed", entry: "", findings: [] }),
      trustLevel: text(record.trustLevel, "local-dev"),
      permissions: clone(record.permissions || {}),
      grantedPermissions: normalizeSandboxPermissions(record.grantedPermissions),
      permissionConsent: clone(record.permissionConsent || { status: "not-granted", grantedAt: "" }),
      installState: text(record.installState, "manifest-only"),
      runtimeExecution: text(record.runtimeExecution, "blocked") === "sandboxed" ? "sandboxed" : "blocked",
      installedAt: text(record.installedAt),
      updatedAt: text(record.updatedAt)
    };
  }
}

module.exports = { PACKAGE_FORMAT, ZIP_EXTENSION, STORE_NAME, MAX_RUNTIME_SOURCE_BYTES, CustomNodePackageManager, analyzeRuntimeSource, inspectArchive, listZipEntries, normalizeManifest };
