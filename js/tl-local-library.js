window.TrackerLensLocalLibrary = (() => {
  const DB_NAME = "TrackersLens";
  const WIDGET_STORE = "tl_widgets";
  const PAGE_STORE = "tl_pages";
  let desktopSqliteMode = null;
  const desktopPersistence = () => window.trackers?.desktop?.persistence || null;
  const usesDesktopSqlite = async () => {
    if (desktopSqliteMode !== null) return desktopSqliteMode;
    const persistence = desktopPersistence();
    if (!persistence?.getStatus) return (desktopSqliteMode = false);
    try { desktopSqliteMode = (await persistence.getStatus())?.mode === "desktop-sqlite"; } catch (_) { desktopSqliteMode = false; }
    return desktopSqliteMode;
  };

  const normalizeText = (value, fallback = "") => {
    if (value === null || value === undefined) return fallback;
    return String(value).trim() || fallback;
  };

  const normalizeType = (content) => {
    const raw = normalizeText(content.type || content.kind || content.boxType, "boxLens");
    return raw === "boxTracker" ? "boxTracker" : "boxLens";
  };

  const normalizeColor = (content = {}, fallback = "#9b5cf5") => {
    const ui = content.ui && typeof content.ui === "object" ? content.ui : {};
    const value = normalizeText(ui.color || content.color, fallback);
    return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  };

  const normalizeVersionedContent = (content) =>
    window.TrackerLensBoxVersioning?.normalizeBox ? window.TrackerLensBoxVersioning.normalizeBox(content) : content;

  const isFlowMapContent = (record = {}) => {
    const content = record?.content && typeof record.content === "object" ? record.content : record || {};
    return content.type === "flowmap" || content.kind === "flowmap" || content.format === "tlflow" || record?.format === "tlflow";
  };

  const openDb = () =>
    new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("IndexedDB non disponibile"));
        return;
      }

      const request = indexedDB.open(DB_NAME);
      request.onsuccess = (event) => {
        const db = event.target.result;
        db.onversionchange = () => {
          db.close();
          console.warn("IndexedDB libreria chiuso per consentire aggiornamento da un'altra scheda.");
        };
        resolve(db);
      };
      request.onerror = (event) => reject(event.target.error || new Error("Errore apertura IndexedDB"));
    });

  const readAll = async (storeName) => {
    if (await usesDesktopSqlite()) return desktopPersistence().readDevelopmentRecords({ storeName });
    const db = await openDb();

    try {
      if (!db.objectStoreNames.contains(storeName)) return [];

      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, "readonly");
        const store = transaction.objectStore(storeName);
        const request = store.getAll();

        request.onsuccess = (event) => resolve(Array.from(event.target.result || []));
        request.onerror = (event) => reject(event.target.error || new Error(`Errore lettura ${storeName}`));
      });
    } finally {
      db.close();
    }
  };

  const normalizeWidgetAsset = (record, index) => {
    const content = normalizeVersionedContent(record?.content && typeof record.content === "object" ? record.content : record || {});
    const type = normalizeType(content);
    const name = normalizeText(content.name || content.title, type === "boxTracker" ? "Box Tracker" : "Box Lens");

    return {
      id: normalizeText(record?.id || content.id, `widget_${index}`),
      sourceId: normalizeText(record?.id || content.id, `widget_${index}`),
      name,
      type,
      category: normalizeText(content.category, type === "boxTracker" ? "Dati" : "Custom"),
      description: normalizeText(content.description, "Nessuna descrizione disponibile."),
      author: normalizeText(content.author, "Locale"),
      icon: normalizeText(content.icon, type === "boxTracker" ? "cloud_queue" : "dashboard"),
      color: normalizeColor(content, type === "boxTracker" ? "#35c979" : "#9b5cf5"),
      version: normalizeText(content.version, "0.1.0"),
      runtimeVersion: normalizeText(content.runtimeVersion || content.versioning?.runtimeVersion, ">=0.1.0"),
      versioning: content.versioning && typeof content.versioning === "object" ? { ...content.versioning } : null,
      creator: content.creator && typeof content.creator === "object" ? { ...content.creator } : null,
      marketplace: content.marketplace && typeof content.marketplace === "object" ? { ...content.marketplace } : null,
      permissions: content.permissions || content.runtime?.permissions || null,
      limits: content.limits || content.runtime?.limits || null,
      trust: content.trust && typeof content.trust === "object" ? { ...content.trust } : null,
      code: content.code && typeof content.code === "object" ? { ...content.code } : {},
      runtime: content.runtime && typeof content.runtime === "object" ? { ...content.runtime } : {},
      dependencies: Array.isArray(content.dependencies) ? [...content.dependencies] : [],
      sampleOutput: content.sampleOutput && typeof content.sampleOutput === "object" ? { ...content.sampleOutput } : null,
      outputChannel: normalizeText(content.outputChannel || content.runtime?.output, "default"),
      trackerType: normalizeText(content.trackerType || content.runtime?.source, type === "boxTracker" ? "manual" : ""),
      runtimeMode: normalizeText(content.runtimeMode || content.runtime?.mode, type === "boxTracker" ? "manual" : ""),
      source: normalizeText(content.source || content.runtime?.source, type === "boxTracker" ? "manual" : ""),
      endpoint: normalizeText(content.endpoint || content.runtime?.endpoint),
      method: normalizeText(content.method || content.runtime?.method, "GET"),
      query: normalizeText(content.query),
      headersText: normalizeText(content.headersText),
      transformText: normalizeText(content.transformText),
      timeout: Number(content.timeout || content.runtime?.timeout) || 10,
      reconnect: content.reconnect ?? content.runtime?.reconnect ?? true,
      reconnectInterval: Number(content.reconnectInterval || content.runtime?.reconnectInterval) || 5,
      intervalMs: Number(content.intervalMs || content.runtime?.intervalMs) || 0,
      active: content.active !== false,
      autoStart: content.autoStart !== false,
      updatedAt: normalizeText(content.updatedAt || content.createdAt || record?.updatedAt || record?.createdAt),
      width: Number(content.width) || (type === "boxTracker" ? 5 : 10),
      height: Number(content.height) || (type === "boxTracker" ? 3 : 6),
      searchText: [
        name,
        content.description,
        content.category,
        type,
        content.author,
      ].map((value) => normalizeText(value).toLowerCase()).join(" "),
    };
  };

  const listWidgetAssets = async () => {
    const records = await readAll(WIDGET_STORE);
    return records.map(normalizeWidgetAsset);
  };

  const normalizeWorkspace = (record, index) => {
    const content = record?.content && typeof record.content === "object" ? record.content : record || {};
    const boxes = Array.isArray(content.boxes) ? content.boxes : [];
    const connections = Array.isArray(content.connections) ? content.connections : [];
    const name = normalizeText(content.name || content.title, "Workspace");
    const category = normalizeText(content.category, "Workspace");
    const description = normalizeText(
      content.description,
      `${boxes.length} box · ${connections.length} collegamenti · ${content.columns || 48} colonne`
    );

    return {
      id: normalizeText(record?.id || content.id, `workspace_${index}`),
      name,
      type: "workspace",
      category,
      description,
      author: normalizeText(content.author, "Locale"),
      icon: "dashboard_customize",
      color: normalizeColor(content, "#38bdf8"),
      version: normalizeText(content.version, "0.1.0"),
      creator: content.creator && typeof content.creator === "object" ? { ...content.creator } : null,
      marketplace: content.marketplace && typeof content.marketplace === "object" ? { ...content.marketplace } : null,
      trust: content.trust && typeof content.trust === "object" ? { ...content.trust } : null,
      boxes: boxes.map((box) => ({ ...box })),
      connections: connections.map((connection) => ({ ...connection })),
      updatedAt: normalizeText(content.updatedAt || content.savedAt || content.createdAt || record?.updatedAt || record?.createdAt),
      searchText: [
        name,
        description,
        category,
        "workspace",
        content.author,
      ].map((value) => normalizeText(value).toLowerCase()).join(" "),
    };
  };

  const listLibraryItems = async () => {
    const [widgetRecords, pageRecords] = await Promise.all([
      readAll(WIDGET_STORE),
      readAll(PAGE_STORE),
    ]);

    return [
      ...pageRecords.filter((record) => !isFlowMapContent(record)).map(normalizeWorkspace),
      ...widgetRecords.map(normalizeWidgetAsset),
    ];
  };

  const inspect = async () => {
    if (await usesDesktopSqlite()) {
      const [widgets, pages] = await Promise.all([readAll(WIDGET_STORE), readAll(PAGE_STORE)]);
      return { name: "trackers-lens.sqlite", version: "tl-desktop-persistence/v1", stores: [WIDGET_STORE, PAGE_STORE], counts: { [WIDGET_STORE]: widgets.length, [PAGE_STORE]: pages.length }, origin: "tl-core", href: window.location.href };
    }
    const db = await openDb();

    try {
      const stores = Array.from(db.objectStoreNames || []);
      const counts = {};

      await Promise.all(stores.map((storeName) =>
        new Promise((resolve) => {
          const transaction = db.transaction(storeName, "readonly");
          const store = transaction.objectStore(storeName);
          const request = store.count();
          request.onsuccess = (event) => {
            counts[storeName] = event.target.result || 0;
            resolve();
          };
          request.onerror = () => {
            counts[storeName] = "errore";
            resolve();
          };
        })
      ));

      return {
        name: db.name,
        version: db.version,
        stores,
        counts,
        origin: window.location.origin,
        href: window.location.href,
      };
    } finally {
      db.close();
    }
  };

  return {
    inspect,
    listLibraryItems,
    listWidgetAssets,
    normalizeWidgetAsset,
    normalizeWorkspace,
    isFlowMapContent,
  };
})();
