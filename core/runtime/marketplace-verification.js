window.TrackerLensMarketplaceVerification = (() => {
  const TRUST_STORE = "tl_marketplace_trust";
  const TRUST_SCHEMA_VERSION = "1.0.0";
  const VERIFIED_CREATORS = new Set(["trackers-lens", "trackerlens", "local"]);

  const now = () => new Date().toISOString();
  const clone = (value) => JSON.parse(JSON.stringify(value ?? null));
  const normalizeText = (value, fallback = "") => value === null || value === undefined ? fallback : String(value).trim() || fallback;
  const assetTypeOf = (asset = {}) => normalizeText(asset.type || asset.kind || asset.boxType, "boxLens");
  const assetIdOf = (asset = {}) => normalizeText(asset.id || asset.sourceId, `asset_${Date.now()}`);
  const contentOf = (record = {}) => record?.content && typeof record.content === "object" ? record.content : record || {};

  const stablePayload = (asset = {}) => {
    const content = contentOf(asset);
    const code = content.code && typeof content.code === "object" ? content.code : asset.code || {};
    return {
      id: assetIdOf(content),
      type: assetTypeOf(content),
      name: normalizeText(content.name || content.title),
      version: normalizeText(content.version, "0.1.0"),
      runtimeVersion: normalizeText(content.runtimeVersion || content.versioning?.runtimeVersion),
      permissions: content.permissions || content.runtime?.permissions || null,
      limits: content.limits || content.runtime?.limits || null,
      code,
      runtime: content.runtime || null,
      boxes: Array.isArray(content.boxes) ? content.boxes : [],
      connections: Array.isArray(content.connections) ? content.connections : [],
      dependencies: content.dependencies || content.versioning?.compatibility?.dependencies || [],
    };
  };

  const simpleHash = async (value) => {
    const text = JSON.stringify(value);
    if (window.crypto?.subtle && window.TextEncoder) {
      const bytes = new TextEncoder().encode(text);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    }

    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
      hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
    }
    return `fallback-${Math.abs(hash).toString(16)}`;
  };

  const persistence = () => window.trackers?.desktop?.persistence || null;
  const ensureDb = async () => {
    const bridge = persistence();
    if (!bridge?.getStatus || !bridge?.readDevelopmentRecords || !bridge?.writeDevelopmentRecords) throw new Error("Marketplace Verification richiede SQLite nell'app desktop.");
    if ((await bridge.getStatus())?.mode !== "desktop-sqlite") throw new Error("Marketplace Verification richiede SQLite nell'app desktop.");
    return bridge;
  };

  const readAllReports = async () => {
    return (await ensureDb()).readDevelopmentRecords({ storeName: TRUST_STORE });
  };

  const writeReport = async (report) => {
    await (await ensureDb()).writeDevelopmentRecords({ storeName: TRUST_STORE, records: [report] });
    return report;
  };

  const creatorProfile = (asset = {}) => {
    const content = contentOf(asset);
    const source = content.creator && typeof content.creator === "object" ? content.creator : {};
    const name = normalizeText(source.name || content.author, "Locale");
    const id = normalizeText(source.id || name, "local").toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
    const verified = Boolean(source.verified || VERIFIED_CREATORS.has(id));
    return {
      id,
      name,
      verified,
      source: verified ? "local-trusted" : "self-declared",
    };
  };

  const permissionList = (policy = {}) =>
    Object.entries(policy.permissions || {})
      .filter(([, allowed]) => allowed)
      .map(([name]) => name);

  const inspectRuntime = (asset = {}) => {
    const content = contentOf(asset);
    if (assetTypeOf(content) === "workspace") {
      return {
        safe: true,
        permissions: [],
        violations: [],
        limits: {},
        notes: ["workspace bundle: verifica asset embedded separata"],
      };
    }

    const code = content.code && typeof content.code === "object" ? content.code : asset.code || {};
    const validation = window.TrackerLensSandboxPolicy?.validateBox
      ? window.TrackerLensSandboxPolicy.validateBox({ box: content, code })
      : { ok: true, violations: [], policy: { permissions: {}, limits: {} } };
    return {
      safe: validation.ok,
      permissions: permissionList(validation.policy || {}),
      violations: validation.violations || [],
      limits: clone(validation.policy?.limits || {}),
      notes: [],
    };
  };

  const signatureReport = async (asset = {}, digest = "") => {
    const content = contentOf(asset);
    const signature = content.marketplace?.signature || content.trust?.signature || {};
    const declaredDigest = normalizeText(signature.digest || signature.sha256);
    const signed = Boolean(declaredDigest);
    return {
      algorithm: normalizeText(signature.algorithm, "sha256"),
      signed,
      digest,
      declaredDigest,
      valid: signed && declaredDigest === digest,
      signer: normalizeText(signature.signer || signature.creatorId),
    };
  };

  const classify = ({ creator, runtime, signature }) => {
    if (runtime.violations.length) return { status: "blocked", trustLevel: "unsafe", score: 10 };
    if (creator.verified && signature.valid) return { status: "verified", trustLevel: "verified", score: 100 };
    if (creator.verified && runtime.safe) return { status: "trusted", trustLevel: "trusted-local", score: 82 };
    if (signature.signed && !signature.valid) return { status: "review_required", trustLevel: "signature-mismatch", score: 35 };
    return { status: "review_required", trustLevel: "unverified", score: 55 };
  };

  const scanAsset = async (asset = {}, options = {}) => {
    const content = contentOf(asset);
    const assetId = assetIdOf(content);
    const assetType = assetTypeOf(content);
    const digest = await simpleHash(stablePayload(content));
    const creator = creatorProfile(content);
    const runtime = inspectRuntime(content);
    const signature = await signatureReport(content, digest);
    const classification = classify({ creator, runtime, signature });
    const report = {
      id: `${assetType}:${assetId}`,
      schemaVersion: TRUST_SCHEMA_VERSION,
      assetId,
      assetType,
      assetName: normalizeText(content.name || content.title, assetId),
      version: normalizeText(content.version, "0.1.0"),
      creator,
      signature,
      runtime,
      review: {
        status: classification.status === "verified" ? "approved" : classification.status === "blocked" ? "blocked" : "pending",
        reviewedAt: classification.status === "verified" ? now() : "",
        reviewer: classification.status === "verified" ? "local-policy" : "",
      },
      ...classification,
      updatedAt: now(),
    };
    return options.persist === false ? report : writeReport(report);
  };

  const scanAssets = async (assets = [], options = {}) => Promise.all((assets || []).map((asset) => scanAsset(asset, options)));

  const reportsByAssetId = async () => {
    const reports = await readAllReports();
    return reports.reduce((map, report) => {
      map.set(report.assetId, report);
      return map;
    }, new Map());
  };

  const enrichAssets = async (assets = []) => {
    const reports = await reportsByAssetId();
    return (assets || []).map((asset) => ({ ...asset, trust: reports.get(asset.id) || asset.trust || null }));
  };

  return {
    TRUST_STORE,
    TRUST_SCHEMA_VERSION,
    scanAsset,
    scanAssets,
    readAllReports,
    reportsByAssetId,
    enrichAssets,
  };
})();
