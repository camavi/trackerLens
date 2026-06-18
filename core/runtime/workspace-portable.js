window.TrackerLensPortableRuntime = (() => {
  const DB_NAME = "TrackersLens";
  const WIDGET_STORE = "tl_widgets";
  const PAGE_STORE = "tl_pages";
  const RUNTIME_STORES = {
    channels: "tl_channels",
    nodes: "tl_runtime_nodes",
    dependencies: "tl_runtime_dependencies",
    flows: "tl_flows",
  };
  const FORMAT_VERSION = "1.0.0";

  const now = () => new Date().toISOString();
  const normalizeText = (value, fallback = "") => value === null || value === undefined ? fallback : String(value).trim() || fallback;
  const contentOf = (record) => record?.content && typeof record.content === "object" ? record.content : record || {};
  const clone = (value) => JSON.parse(JSON.stringify(value ?? null));
  const normalizeBox = (box) => window.TrackerLensBoxVersioning?.normalizeBox ? window.TrackerLensBoxVersioning.normalizeBox(box) : box;
  const safeName = (value = "trackers-lens") =>
    normalizeText(value, "trackers-lens").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-|-$/g, "") || "trackers-lens";

  const createStores = (db) => {
    if (!db.objectStoreNames.contains(WIDGET_STORE)) {
      db.createObjectStore(WIDGET_STORE, { keyPath: "id" }).createIndex("content", "content", { unique: false });
    }
    if (!db.objectStoreNames.contains(PAGE_STORE)) {
      db.createObjectStore(PAGE_STORE, { keyPath: "id" }).createIndex("content", "content", { unique: false });
    }
    Object.values(RUNTIME_STORES).forEach((storeName) => {
      if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName, { keyPath: "id" });
    });
  };

  const openDb = (version = undefined) =>
    new Promise((resolve, reject) => {
      const request = version ? indexedDB.open(DB_NAME, version) : indexedDB.open(DB_NAME);
      request.onupgradeneeded = (event) => createStores(event.target.result);
      request.onsuccess = (event) => resolve(event.target.result);
      request.onerror = (event) => reject(event.target.error || new Error("Errore apertura IndexedDB portable runtime"));
    });

  const ensureDb = async () => {
    const db = await openDb();
    const required = [WIDGET_STORE, PAGE_STORE, ...Object.values(RUNTIME_STORES)];
    if (required.every((storeName) => db.objectStoreNames.contains(storeName))) return db;
    const version = db.version + 1;
    db.close();
    return openDb(version);
  };

  const read = async (storeName, id) => {
    const db = await ensureDb();
    try {
      if (!db.objectStoreNames.contains(storeName)) return null;
      return await new Promise((resolve, reject) => {
        const request = db.transaction(storeName, "readonly").objectStore(storeName).get(id);
        request.onsuccess = (event) => resolve(event.target.result || null);
        request.onerror = (event) => reject(event.target.error || new Error(`Errore lettura ${storeName}`));
      });
    } finally {
      db.close();
    }
  };

  const readAll = async (storeName) => {
    const db = await ensureDb();
    try {
      if (!db.objectStoreNames.contains(storeName)) return [];
      return await new Promise((resolve, reject) => {
        const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
        request.onsuccess = (event) => resolve(Array.from(event.target.result || []));
        request.onerror = (event) => reject(event.target.error || new Error(`Errore lettura ${storeName}`));
      });
    } finally {
      db.close();
    }
  };

  const write = async (storeName, record) => {
    const db = await ensureDb();
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction(storeName, "readwrite").objectStore(storeName).put(record);
        request.onsuccess = () => resolve(record);
        request.onerror = (event) => reject(event.target.error || new Error(`Errore scrittura ${storeName}`));
      });
    } finally {
      db.close();
    }
  };

  const writeMany = async (storeName, records = []) => Promise.all((records || []).filter((record) => record?.id).map((record) => write(storeName, record)));

  const workspaceAssetIds = (workspace = {}) =>
    [...new Set((workspace.boxes || []).flatMap((box) => [box.assetId, box.sourceId]).filter(Boolean).map(String))];

  const packageMeta = (kind, name, id) => ({
    format: kind === "flowmap" ? "tlflow" : kind === "workspace" ? "tlworkspace" : "tlbox",
    formatVersion: FORMAT_VERSION,
    exportedAt: now(),
    app: {
      name: "Trackers Lens",
      origin: window.location.origin,
    },
    id,
    name,
  });

  const exportBox = async (id) => {
    const record = await read(WIDGET_STORE, id);
    if (!record) throw new Error(`Box non trovato: ${id}`);
    const content = contentOf(record);
    return {
      ...packageMeta("box", content.name || content.title || id, id),
      kind: "box",
      box: clone(normalizeBox(content)),
      versioning: clone(normalizeBox(content).versioning || null),
    };
  };

  const runtimeGraphForWorkspace = async (workspaceId) => {
    const [channels, nodes, dependencies, flows] = await Promise.all([
      readAll(RUNTIME_STORES.channels),
      readAll(RUNTIME_STORES.nodes),
      readAll(RUNTIME_STORES.dependencies),
      readAll(RUNTIME_STORES.flows),
    ]);
    const matches = (record = {}) => (record.workspaceId || "global") === workspaceId;
    return {
      channels: channels.filter(matches).map(clone),
      nodes: nodes.filter(matches).map(clone),
      dependencies: dependencies.filter(matches).map(clone),
      flows: flows.filter(matches).map(clone),
    };
  };

  const exportWorkspace = async (id, { includeAssets = true, includeRuntimeGraph = true } = {}) => {
    const record = await read(PAGE_STORE, id);
    if (!record) throw new Error(`Workspace non trovato: ${id}`);
    const workspace = contentOf(record);
    const assets = includeAssets
      ? (await Promise.all(workspaceAssetIds(workspace).map((assetId) => read(WIDGET_STORE, assetId))))
        .filter(Boolean)
        .map((asset) => clone(normalizeBox(contentOf(asset))))
      : [];
    const runtimeGraph = includeRuntimeGraph ? await runtimeGraphForWorkspace(id) : null;
    return {
      ...packageMeta("workspace", workspace.name || workspace.title || id, id),
      kind: "workspace",
      workspace: clone(workspace),
      assets,
      runtime: {
        assetMode: includeAssets ? "embedded" : "references",
        graphMode: includeRuntimeGraph ? "embedded" : "none",
        graph: runtimeGraph,
      },
    };
  };

  const downloadJson = (bundle, filename = "") => {
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename || `${safeName(bundle.name || bundle.id)}.${bundle.format || "json"}`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const exportBoxFile = async (id) => {
    const bundle = await exportBox(id);
    downloadJson(bundle, `${safeName(bundle.name || id)}.tlbox`);
    return bundle;
  };

  const exportWorkspaceFile = async (id, options = {}) => {
    const bundle = await exportWorkspace(id, options);
    downloadJson(bundle, `${safeName(bundle.name || id)}.tlworkspace`);
    return bundle;
  };

  const exportFlowMapFile = async (id, options = {}) => {
    const bundle = {
      ...await exportWorkspace(id, { includeAssets: true, includeRuntimeGraph: true, ...options }),
      ...packageMeta("flowmap", "", id),
    };
    bundle.kind = "workspace";
    bundle.name = bundle.workspace?.name || bundle.workspace?.title || id;
    downloadJson(bundle, `${safeName(bundle.name || id)}.tlflow`);
    return bundle;
  };

  const validateBundle = (bundle = {}) => {
    const errors = [];
    const warnings = [];
    if (!bundle || typeof bundle !== "object") errors.push("Bundle non valido");
    if (!["tlworkspace", "tlflow", "tlbox"].includes(bundle.format)) warnings.push("format non riconosciuto o legacy");
    if (bundle.kind !== "workspace" && bundle.kind !== "box" && bundle.format !== "tlworkspace" && bundle.format !== "tlflow" && bundle.format !== "tlbox") {
      errors.push("kind/formato non supportato");
    }
    if ((bundle.kind === "box" || bundle.format === "tlbox") && !bundle.box) errors.push("box mancante");
    if ((bundle.kind === "workspace" || bundle.format === "tlworkspace" || bundle.format === "tlflow") && !bundle.workspace) errors.push("workspace mancante");
    const boxes = bundle.kind === "workspace" || bundle.format === "tlworkspace" || bundle.format === "tlflow" ? bundle.assets || [] : [bundle.box].filter(Boolean);
    boxes.forEach((box) => {
      const validation = window.TrackerLensBoxVersioning?.validateBox ? window.TrackerLensBoxVersioning.validateBox(box) : { ok: true, warnings: [] };
      if (!validation.ok) errors.push(...validation.errors.map((error) => `${box?.id || "box"}: ${error}`));
      warnings.push(...(validation.warnings || []).map((warning) => `${box?.id || "box"}: ${warning}`));
    });
    return {
      ok: errors.length === 0,
      errors,
      warnings,
      format: bundle?.format || "",
      kind: bundle?.kind || "",
      id: bundle?.id || bundle?.box?.id || bundle?.workspace?.id || "",
    };
  };

  const existingIdFor = async (storeName, id, onConflict = "overwrite") => {
    if (onConflict !== "duplicate") return id;
    const existing = await read(storeName, id);
    return existing ? `${id}_import_${Date.now()}` : id;
  };

  const importBundle = async (bundle = {}, { onConflict = "overwrite", includeRuntimeGraph = true } = {}) => {
    const validation = validateBundle(bundle);
    if (!validation.ok) throw new Error(validation.errors.join(", "));
    if (!bundle || typeof bundle !== "object") throw new Error("Bundle portable non valido");
    if (bundle.kind === "box" || bundle.format === "tlbox") {
      const box = bundle.box || {};
      const requestedId = normalizeText(box.id || bundle.id, `box_${Date.now()}`);
      const id = await existingIdFor(WIDGET_STORE, requestedId, onConflict);
      if (onConflict === "skip" && await read(WIDGET_STORE, requestedId)) return { kind: "box", id: requestedId, skipped: true };
      await write(WIDGET_STORE, { id, content: normalizeBox({ ...box, id, updatedAt: now() }) });
      return { kind: "box", id };
    }
    if (bundle.kind === "workspace" || bundle.format === "tlworkspace" || bundle.format === "tlflow") {
      const workspace = bundle.workspace || {};
      const requestedId = normalizeText(workspace.id || bundle.id, `workspace_${Date.now()}`);
      const id = await existingIdFor(PAGE_STORE, requestedId, onConflict);
      if (onConflict === "skip" && await read(PAGE_STORE, requestedId)) return { kind: "workspace", id: requestedId, skipped: true };
      await Promise.all((bundle.assets || []).map((asset) => {
        const assetId = normalizeText(asset.id, "");
        return assetId ? write(WIDGET_STORE, { id: assetId, content: normalizeBox({ ...asset, updatedAt: now() }) }) : null;
      }).filter(Boolean));
      await write(PAGE_STORE, { id, content: { ...workspace, id, updatedAt: now() } });
      const graph = bundle.runtime?.graph;
      if (includeRuntimeGraph && graph) {
        await Promise.all([
          writeMany(RUNTIME_STORES.channels, graph.channels || []),
          writeMany(RUNTIME_STORES.nodes, graph.nodes || []),
          writeMany(RUNTIME_STORES.dependencies, graph.dependencies || []),
          writeMany(RUNTIME_STORES.flows, graph.flows || []),
        ]);
      }
      return { kind: "workspace", id };
    }
    throw new Error(`Formato portable non supportato: ${bundle.format || bundle.kind || "unknown"}`);
  };

  const readFileBundle = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(JSON.parse(String(reader.result || "{}")));
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(reader.error || new Error("Errore lettura file"));
      reader.readAsText(file);
    });

  const importFile = async (file, options = {}) => importBundle(await readFileBundle(file), options);

  return {
    FORMAT_VERSION,
    exportBox,
    exportBoxFile,
    exportWorkspace,
    exportWorkspaceFile,
    exportFlowMapFile,
    importBundle,
    importFile,
    validateBundle,
  };
})();
