const text = (value, fallback = "") => String(value ?? "").trim() || fallback;
const clone = (value, fallback = {}) => {
  try { return structuredClone(value ?? fallback); } catch (_) {
    try { return JSON.parse(JSON.stringify(value ?? fallback)); } catch (_) { return fallback; }
  }
};

const versionParts = (value = "") => String(value || "").trim().replace(/^v/i, "").split(/[.+-]/)[0]
  .split(".").map((part) => Number.parseInt(part, 10)).map((part) => Number.isFinite(part) ? part : 0);
const compareVersions = (left = "", right = "") => {
  const a = versionParts(left); const b = versionParts(right); const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if ((a[index] || 0) > (b[index] || 0)) return 1;
    if ((a[index] || 0) < (b[index] || 0)) return -1;
  }
  return 0;
};

const satisfiesVersion = (version = "", constraint = "") => {
  const value = text(version); const wanted = text(constraint);
  if (!wanted) return Boolean(value);
  if (!value) return false;
  return wanted.split(",").map((item) => item.trim()).filter(Boolean).every((item) => {
    const match = item.match(/^(==|>=|<=|>|<)?\s*(.+)$/);
    if (!match) return false;
    const operator = match[1] || "=="; const target = match[2]; const comparison = compareVersions(value, target);
    return operator === "==" ? comparison === 0 : operator === ">=" ? comparison >= 0 : operator === "<=" ? comparison <= 0 : operator === ">" ? comparison > 0 : comparison < 0;
  });
};

const normalizeRequirement = (value = {}) => ({
  name: text(value?.name || value?.package || value?.module).toLowerCase(),
  version: text(value?.version || value?.constraint),
});

const normalizePack = (source = {}) => {
  const packages = (Array.isArray(source.packages) ? source.packages : [])
    .map(normalizeRequirement).filter((item) => item.name);
  const trustLevel = text(source.trustLevel, "blocked").toLowerCase();
  return {
    id: text(source.id),
    version: text(source.version),
    environment: text(source.environment),
    lockfile: text(source.lockfile),
    status: text(source.status, "unavailable").toLowerCase(),
    trustLevel,
    packages,
    trusted: ["built-in", "verified"].includes(trustLevel),
  };
};

class PythonPackResolver {
  constructor({ packs = [] } = {}) { this.packs = (Array.isArray(packs) ? packs : []).map(normalizePack); }

  list() { return this.packs.map(({ packages, ...pack }) => ({ ...clone(pack), packages: clone(packages, []) })); }
  setStatus(packId, status) {
    const pack = this.packs.find((item) => item.id === String(packId || ""));
    if (pack) pack.status = text(status, "unavailable").toLowerCase();
  }

  resolve(execution = {}) {
    const python = execution?.dependencies?.python;
    if (!python || typeof python !== "object") return { status: "not-required", code: "PYTHON_PACK_NOT_REQUIRED" };
    const requirement = {
      packId: text(python.packId || python.pack),
      environment: text(python.environment),
      requirements: (Array.isArray(python.requirements) ? python.requirements : []).map(normalizeRequirement).filter((item) => item.name),
      lockfile: text(python.lockfile),
      installPolicy: text(python.installPolicy, "managed-required").toLowerCase(),
    };
    if (!requirement.environment || !requirement.requirements.length) return { status: "invalid", code: "PYTHON_PACK_REQUIREMENT_INVALID", requirement };
    const candidates = this.packs.filter((pack) =>
      pack.environment === requirement.environment && (!requirement.packId || pack.id === requirement.packId)
    );
    const trusted = candidates.filter((pack) => pack.trusted);
    const matching = trusted.find((pack) =>
      pack.status === "ready" &&
      (!requirement.lockfile || pack.lockfile === requirement.lockfile) &&
      requirement.requirements.every((wanted) => pack.packages.some((available) => available.name === wanted.name && satisfiesVersion(available.version, wanted.version))) &&
      (requirement.installPolicy !== "bundled" || pack.trustLevel === "built-in")
    );
    if (matching) return {
      status: "ready",
      code: "PYTHON_PACK_READY",
      pack: { id: matching.id, version: matching.version, environment: matching.environment, lockfile: matching.lockfile, trustLevel: matching.trustLevel, packages: clone(matching.packages, []) },
      requirement,
    };
    const installCandidate = trusted.find((pack) =>
      (!requirement.lockfile || pack.lockfile === requirement.lockfile) &&
      requirement.requirements.every((wanted) => pack.packages.some((available) => available.name === wanted.name && satisfiesVersion(available.version, wanted.version))) &&
      (requirement.installPolicy !== "bundled" || pack.trustLevel === "built-in")
    );
    const untrusted = candidates.some((pack) => !pack.trusted);
    return {
      status: untrusted ? "blocked" : "unavailable",
      code: untrusted ? "PYTHON_PACK_UNTRUSTED" : "PYTHON_PACK_MISSING",
      requirement,
      installPlan: {
        environment: requirement.environment,
        requirements: clone(requirement.requirements, []),
        lockfile: requirement.lockfile,
        installPolicy: requirement.installPolicy,
        requiresUserConsent: requirement.installPolicy !== "bundled",
        supported: Boolean(installCandidate),
        packId: installCandidate?.id || "",
        packVersion: installCandidate?.version || "",
        trustLevel: installCandidate?.trustLevel || "",
      },
    };
  }
}

module.exports = { PythonPackResolver, compareVersions, satisfiesVersion };
