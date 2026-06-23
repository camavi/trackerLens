window.TrackerLensBoxEditorDialog = (() => {
  const WIDGET_STORE = () => tlConfig.TABLES.TL_WIDGETS;
  const STORES = () => [
    { name: tlConfig.TABLES.TL_WIDGETS, columns: [{ name: "content" }] },
    { name: tlConfig.TABLES.TL_PAGES, columns: [{ name: "content" }] },
  ];

  const icon = (name, size = "md") => _.Icon({ name, size });
  const btn = (props, ...children) => _.Btn({ type: "button", ...props }, ...children);
  const notify = (type, message) => {
    if (CMSwift.notify?.[type]) CMSwift.notify[type](message);
  };

  const boxVersioning = () => window.TrackerLensBoxVersioning;
  const normalizeBox = (box) => boxVersioning()?.normalizeBox
    ? boxVersioning().normalizeBox(box)
    : {
      ...box,
      version: box.version || "0.1.0",
      runtimeVersion: box.runtimeVersion || ">=0.1.0",
    };

  const createStoreIndexes = (store, columns = []) => {
    columns.forEach((column) => {
      if (!store.indexNames.contains(column.name)) {
        store.createIndex(column.name, column?.keyPath ?? column.name, column?.options ?? { unique: false });
      }
    });
  };

  const createMissingStores = (dbInstance) => {
    STORES().forEach((table) => {
      if (!dbInstance.objectStoreNames.contains(table.name)) {
        createStoreIndexes(dbInstance.createObjectStore(table.name, { keyPath: "id" }), table.columns);
      }
    });
  };

  const bindVersionChange = (dbInstance) => {
    dbInstance.onversionchange = () => {
      dbInstance.close();
      console.warn("IndexedDB box editor dialog chiuso per consentire aggiornamento da un'altra scheda.");
    };
    return dbInstance;
  };

  const openDb = () =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open(tlConfig.DB_NAME);
      let blockedTimer = null;
      const clearBlockedTimer = () => {
        if (blockedTimer) clearTimeout(blockedTimer);
      };

      request.onupgradeneeded = (event) => createMissingStores(event.target.result);
      request.onsuccess = (event) => {
        clearBlockedTimer();
        const openedDb = bindVersionChange(event.target.result);
        const hasStores = STORES().every((table) => openedDb.objectStoreNames.contains(table.name));
        if (hasStores) {
          resolve(openedDb);
          return;
        }

        const nextVersion = openedDb.version + 1;
        openedDb.close();
        const upgradeRequest = indexedDB.open(tlConfig.DB_NAME, nextVersion);
        let upgradeBlockedTimer = null;
        const clearUpgradeBlockedTimer = () => {
          if (upgradeBlockedTimer) clearTimeout(upgradeBlockedTimer);
        };
        upgradeRequest.onupgradeneeded = (upgradeEvent) => createMissingStores(upgradeEvent.target.result);
        upgradeRequest.onsuccess = (upgradeEvent) => {
          clearUpgradeBlockedTimer();
          resolve(bindVersionChange(upgradeEvent.target.result));
        };
        upgradeRequest.onerror = (upgradeEvent) => {
          clearUpgradeBlockedTimer();
          reject(upgradeEvent.target.error || new Error("Errore aggiornamento IndexedDB"));
        };
        upgradeRequest.onblocked = () => {
          upgradeBlockedTimer = setTimeout(() => reject(new Error("IndexedDB bloccato da un'altra scheda.")), 8000);
        };
      };
      request.onerror = (event) => {
        clearBlockedTimer();
        reject(event.target.error || new Error("Errore apertura IndexedDB"));
      };
      request.onblocked = () => {
        blockedTimer = setTimeout(() => reject(new Error("IndexedDB bloccato da un'altra scheda.")), 8000);
      };
    });

  const getWidgetRecord = async (id) => {
    if (!id) return null;
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(WIDGET_STORE(), "readonly");
        const store = transaction.objectStore(WIDGET_STORE());
        const request = store.get(id);
        request.onsuccess = (event) => resolve(event.target.result || null);
        request.onerror = (event) => reject(event.target.error || new Error("Errore lettura box"));
      });
    } finally {
      db.close();
    }
  };

  const putWidgetRecord = async (payload) => {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(WIDGET_STORE(), "readwrite");
        const store = transaction.objectStore(WIDGET_STORE());
        const request = store.put(payload);
        request.onsuccess = () => resolve(payload);
        request.onerror = (event) => reject(event.target.error || new Error("Errore salvataggio box"));
      });
    } finally {
      db.close();
    }
  };

  const normalizeText = (value, fallback = "") => {
    if (value === null || value === undefined) return fallback;
    return String(value).trim() || fallback;
  };

  const safeJsonStringify = (value, fallback = {}) => {
    try {
      return JSON.stringify(value ?? fallback, null, 2);
    } catch (_) {
      return JSON.stringify(fallback, null, 2);
    }
  };

  const parseJsonField = (value, label, fallback = {}) => {
    const text = String(value || "").trim();
    if (!text) return fallback;
    try {
      return JSON.parse(text);
    } catch (_) {
      throw new Error(`${label} non contiene JSON valido.`);
    }
  };

  const makeId = (type) => `${type === "boxTracker" ? "tracker" : "lens"}_${Date.now()}`;

  const defaultLensCode = (box) => ({
    manifest: JSON.stringify(boxVersioning()?.buildManifest
      ? boxVersioning().buildManifest({ ...box, type: "boxLens" }, { defaultSize: { width: box.width, height: box.height } })
      : {
        name: box.name,
        type: "boxLens",
        version: box.version,
        runtimeVersion: box.runtimeVersion,
        category: box.category,
        channels: box.channels?.map((channel) => channel.id) || ["default"],
        defaultSize: { width: box.width, height: box.height },
      }, null, 2),
    css: "",
    html: `<div class="widget-container">
  <strong>${box.name || "Box Lens"}</strong>
</div>`,
    js: `export default function boxLens(boxLen, context) {
  return { status: "ready", context };
}`,
    preview: "<!-- Anteprima generata dal boxLens -->",
    public: JSON.stringify({ visibility: box.visibility || "private", publish: box.visibility === "public" }, null, 2),
  });

  const scopeCssSelectors = (selectors, scopeSelector) =>
    selectors
      .split(",")
      .map((selector) => selector.trim())
      .filter(Boolean)
      .map((selector) => {
        if (selector.includes(scopeSelector)) return selector;
        if (/^(from|to|\d+(?:\.\d+)?%)$/i.test(selector)) return selector;
        if (/^(html|body|:root)\b/i.test(selector)) return scopeSelector;
        return `${scopeSelector} ${selector}`;
      })
      .join(", ");

  const scopeBoxLensCss = (css, scopeSelector) =>
    String(css || "").replace(/(^|[{}])\s*([^@{}][^{}]*)\{/g, (match, boundary, selectors) => {
      const scopedSelectors = scopeCssSelectors(selectors, scopeSelector);
      return `${boundary}${scopedSelectors}{`;
    });

  const previewData = () => ({
    c: "63,245.67",
    P: "+1,234.56 (2.00%)",
    price: "63,245.67",
    btcPrice: "63,245.67",
    change24h: "+1,234.56 (2.00%)",
    title: "BTC / USDT",
    source: "Binance",
  });

  const interpolateTemplate = (html, values) =>
    String(html || "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
      const value = key.split(".").reduce((acc, part) => acc?.[part], values);
      return value == null ? "" : String(value);
    });

  const sanitizePreviewFragment = (html) => {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    doc.querySelectorAll("script, iframe, object, embed, link, meta").forEach((node) => node.remove());
    doc.body.querySelectorAll("*").forEach((node) => {
      [...node.attributes].forEach((attr) => {
        const name = attr.name.toLowerCase();
        const value = String(attr.value || "").trim().toLowerCase();
        if (name.startsWith("on") || value.startsWith("javascript:")) node.removeAttribute(attr.name);
      });
    });
    const fragment = document.createDocumentFragment();
    [...doc.body.childNodes].forEach((node) => fragment.appendChild(document.importNode(node, true)));
    return fragment;
  };

  const previewErrorNode = (message = "Preview error") =>
    _.div({ class: "tl-box-dialog-preview-error" }, message);

  const valueByPath = (data, path) =>
    String(path || "").split(".").reduce((value, part) => value?.[part], data);

  const applyPreviewBindings = (runtime, data = {}) => {
    if (!runtime) return;
    const setText = (selector, value) => {
      if (value == null) return;
      runtime.querySelectorAll(selector).forEach((element) => {
        element.textContent = String(value);
      });
    };

    runtime.querySelectorAll("[data-tl-bind], [data-bind]").forEach((element) => {
      const path = element.getAttribute("data-tl-bind") || element.getAttribute("data-bind");
      const value = valueByPath(data, path);
      if (value != null) element.textContent = String(value);
    });
    setText(".value", data.c ?? data.price ?? data.btcPrice);
    setText(".change", data.P ?? data.change24h);
    setText(".title", data.title);
    setText(".source", data.source);
  };

  const dialogPreviewPolicy = ({ box, code }) => {
    if (!window.TrackerLensSandboxPolicy?.validateBox) return { ok: true, policy: null, violations: [] };
    return window.TrackerLensSandboxPolicy.validateBox({
      box,
      code: {
        manifest: code.manifest,
        css: code.css,
        html: code.html,
        js: code.js,
      },
    });
  };

  const buildPreviewController = (js = "") => {
    const source = String(js || "").trim();
    if (!source) return null;
    try {
      if (/export\s+default\s+function\b/.test(source)) {
        const body = source.replace(/export\s+default\s+function(?:\s+[$A-Z_a-z][$\w]*)?\s*\(/, "return function(");
        return Function(body)();
      }
      if (/export\s+default\s+/.test(source)) {
        return Function(source.replace(/export\s+default\s+/, "return "))();
      }
      if (/function\s+boxLens\s*\(/.test(source)) {
        return Function(`${source}\nreturn typeof boxLens === "function" ? boxLens : null;`)();
      }
    } catch (error) {
      if (/unsafe-eval|content security policy|evaluating a string/i.test(error.message || "")) {
        return null;
      }
      throw new Error(`JS preview non eseguibile: ${error.message}`);
    }
    return null;
  };

  const normalizePreviewResult = (result) => {
    const normalized = result && typeof result === "object" ? result : {};
    const listener = typeof normalized.listener === "function"
      ? { default: normalized.listener }
      : normalized.listener && typeof normalized.listener === "object" ? normalized.listener : {};
    return {
      ...normalized,
      status: normalized.status || "ready",
      listener,
    };
  };

  const executeLocalPreviewController = ({ runtime, box, code, data }) => {
    const controller = buildPreviewController(code.js);
    if (typeof controller !== "function") {
      applyPreviewBindings(runtime, data);
      return;
    }

    const context = {
      mode: "preview",
      box,
      data,
      channel: box.channels?.[0]?.id || "default",
      emit: () => {},
      updateData: (nextData = {}) => applyPreviewBindings(runtime, { ...data, ...nextData }),
      fetch: () => Promise.reject(new Error("Network non disponibile nella preview locale")),
    };
    const result = normalizePreviewResult(controller(runtime, context));
    const listeners = result.listener || {};
    const channelNames = [
      "default",
      "*",
      context.channel,
      ...(box.channels || []).map((channel) => channel.id || channel).filter(Boolean),
    ];
    [...new Set(channelNames)].forEach((channel) => {
      try {
        listeners[channel]?.(data, { channel, mode: "preview", box });
      } catch (error) {
        throw new Error(`Listener ${channel}: ${error.message}`);
      }
    });
    applyPreviewBindings(runtime, data);
  };

  const mountLensDialogPreview = ({ previewId, box, code, device = "desktop" }) => {
    const canvas = document.getElementById(`${previewId}-canvas`);
    const runtime = document.getElementById(`${previewId}-runtime`);
    const style = document.getElementById(`${previewId}-style`);
    if (!canvas || !runtime || !style) return;

    const scopeSelector = `[data-box-dialog-preview="${previewId}"]`;
    const width = Math.max(1, Number(box.width) || 10);
    const height = Math.max(1, Number(box.height) || 6);
    canvas.style.setProperty("--tl-dialog-preview-width", `${width * 20}px`);
    canvas.style.setProperty("--tl-dialog-preview-height", `${height * 20}px`);
    canvas.dataset.device = device;
    style.textContent = `${scopeSelector}{box-sizing:border-box;padding:12px;} ${scopeSelector} *{box-sizing:border-box;}${scopeBoxLensCss(code.css || "", scopeSelector)}`;
    const data = previewData();
    const validation = dialogPreviewPolicy({ box, code });
    if (validation?.ok === false) {
      runtime.replaceChildren(previewErrorNode(`Sandbox blocked: ${validation.violations.join(", ")}`));
      return;
    }

    runtime.replaceChildren(sanitizePreviewFragment(interpolateTemplate(code.html || "", data)));
    try {
      executeLocalPreviewController({ runtime, box, code, data });
    } catch (error) {
      runtime.replaceChildren(previewErrorNode(error.message || "Errore preview JS"));
    }
  };

  const defaultBox = ({ type, template = {}, id = "", runtimeLabel = "", channel = "" }) => {
    const data = type === "boxTracker" ? window.TrackerLensBoxTrackerData?.tracker : window.TrackerLensBoxLensData?.box;
    const base = data && typeof data === "object" ? data : {};
    if (type === "boxTracker") {
      return {
        ...base,
        ...template,
        id: id || template.sourceId || template.id || makeId(type),
        name: runtimeLabel || template.name || base.name || "Box Tracker",
        type: "boxTracker",
        version: template.version || base.version || "0.1.0",
        runtimeVersion: template.runtimeVersion || base.runtimeVersion || ">=0.1.0",
        category: template.category || base.category || "Dati",
        description: template.description || base.description || "",
        icon: template.icon || base.icon || "cloud_queue",
        color: template.color || base.color || "#35c979",
        trackerType: template.trackerType || template.source || base.trackerType || "manual",
        runtimeMode: template.runtimeMode || base.runtimeMode || "manual",
        source: template.source || template.trackerType || base.source || "manual",
        outputChannel: channel || template.outputChannel || template.runtime?.output || base.outputChannel || "default",
        method: template.method || template.runtime?.method || base.method || "GET",
        endpoint: template.endpoint || template.runtime?.endpoint || base.endpoint || "",
        timeout: Number(template.timeout || template.runtime?.timeout || base.timeout) || 10,
        reconnect: template.reconnect ?? template.runtime?.reconnect ?? base.reconnect ?? true,
        reconnectInterval: Number(template.reconnectInterval || template.runtime?.reconnectInterval || base.reconnectInterval) || 5,
        intervalMs: Number(template.intervalMs || template.runtime?.intervalMs || base.intervalMs) || 0,
        active: template.active ?? base.active ?? true,
        autoStart: template.autoStart ?? base.autoStart ?? true,
        visibility: template.visibility || base.visibility || "private",
      };
    }

    return {
      ...base,
      ...template,
      id: id || template.sourceId || template.id || makeId(type),
      name: runtimeLabel || template.name || base.name || "Box Lens",
      type: "boxLens",
      version: template.version || base.version || "0.1.0",
      runtimeVersion: template.runtimeVersion || base.runtimeVersion || ">=0.1.0",
      category: template.category || base.category || "Custom",
      description: template.description || base.description || "",
      icon: template.icon || base.icon || "dashboard",
      color: template.color || base.color || "#9b5cf5",
      boxType: template.boxType || "empty",
      width: Number(template.width || base.width) || 10,
      height: Number(template.height || base.height) || 6,
      visibility: template.visibility || base.visibility || "private",
      status: template.status ?? base.status ?? true,
      channels: Array.isArray(template.channels) && template.channels.length
        ? template.channels
        : [{ id: channel || "default", label: channel || "Default" }],
    };
  };

  const normalizeRecordContent = (record, type, fallback) => {
    const content = record?.content && typeof record.content === "object" ? record.content : {};
    return normalizeBox({
      ...fallback,
      ...content,
      id: record?.id || content.id || fallback.id,
      type,
      channels: type === "boxLens" && Array.isArray(content.channels) && content.channels.length ? content.channels : fallback.channels,
    });
  };

  const formRow = (label, control, hint = "") =>
    _.label(
      { class: "tl-box-dialog-field" },
      _.span({ class: "tl-box-dialog-label" }, label),
      control,
      hint ? _.small(hint) : null
    );

  const input = (attrs = {}) => _.input({ class: "tl-box-dialog-input", ...attrs });
  const textarea = (attrs = {}, value = "") => _.textarea({ class: "tl-box-dialog-input", ...attrs }, value);
  const select = (attrs = {}, options = []) =>
    _.select(
      { class: "tl-box-dialog-input", ...attrs },
      ...options.map((option) => _.option({ value: option.value, selected: String(option.value) === String(attrs.value) }, option.label))
    );

  const lensTypeOptions = () => {
    const list = window.TrackerLensBoxLensData?.boxTypes;
    return Array.isArray(list) && list.length ? list.map((item) => ({ value: item.id, label: item.title })) : [{ value: "empty", label: "Vuoto" }];
  };

  const trackerTypeOptions = () => {
    const list = window.TrackerLensBoxTrackerData?.trackerTypes;
    return Array.isArray(list) && list.length ? list.map((item) => ({ value: item.id, label: item.title })) : [
      { value: "manual", label: "Manuale" },
      { value: "api", label: "REST API" },
      { value: "websocket", label: "WebSocket" },
      { value: "rss", label: "RSS" },
    ];
  };

  const buildPayload = ({ type, values, existingContent = {} }) => {
    if (type === "boxTracker") {
      const {
        sampleOutputJson,
        autoStartValue,
        activeValue,
        reconnectValue,
        ...trackerValues
      } = values;
      const sampleOutput = values.sampleOutputJson !== undefined
        ? parseJsonField(values.sampleOutputJson, "Sample output", existingContent.sampleOutput || {})
        : existingContent.sampleOutput;
      const content = normalizeBox({
        ...existingContent,
        ...trackerValues,
        type: "boxTracker",
        sampleOutput,
        query: trackerValues.query ?? existingContent.query,
        headersText: trackerValues.headersText ?? existingContent.headersText,
        transformText: trackerValues.transformText ?? existingContent.transformText,
        runtime: {
          ...(existingContent.runtime || {}),
          mode: trackerValues.runtimeMode,
          source: trackerValues.source || trackerValues.trackerType,
          output: trackerValues.outputChannel,
          endpoint: trackerValues.endpoint,
          method: trackerValues.method,
          timeout: Number(trackerValues.timeout) || 10,
          reconnect: Boolean(trackerValues.reconnect),
          reconnectInterval: Number(trackerValues.reconnectInterval) || 5,
          intervalMs: Number(trackerValues.intervalMs) || 0,
        },
        updatedAt: new Date().toISOString(),
      });
      return { id: values.id, content };
    }

    const {
      codeManifest,
      codeCss,
      codeHtml,
      codeJs,
      codePreview,
      codePublic,
      ...boxValues
    } = values;
    const channels = normalizeText(values.channel, "default").split(",").map((item) => {
      const id = item.trim();
      return id ? { id, label: id } : null;
    }).filter(Boolean);
    const box = normalizeBox({
      ...existingContent,
      ...boxValues,
      type: "boxLens",
      width: Number(boxValues.width) || 10,
      height: Number(boxValues.height) || 6,
      channels: channels.length ? channels : [{ id: "default", label: "Default" }],
      updatedAt: new Date().toISOString(),
    });
    return {
      id: values.id,
      content: {
        ...box,
        code: {
          ...(existingContent.code && typeof existingContent.code === "object" ? existingContent.code : defaultLensCode(box)),
          ...(codeManifest !== undefined ? { manifest: codeManifest } : {}),
          ...(codeCss !== undefined ? { css: codeCss } : {}),
          ...(codeHtml !== undefined ? { html: codeHtml } : {}),
          ...(codeJs !== undefined ? { js: codeJs } : {}),
          ...(codePreview !== undefined ? { preview: codePreview } : {}),
          ...(codePublic !== undefined ? { public: codePublic } : {}),
        },
      },
    };
  };

  const syncDraftRuntimeNode = async ({ type, payload, options }) => {
    if (!options.draftNodeId || !window.TrackerLensRuntimeGraphStore?.promoteDraftNode) return null;
    const workspaceId = options.workspaceId || "workspace_global";
    if (type === "boxTracker") {
      const channel = payload.content.outputChannel || payload.content.runtime?.output || "default";
      return window.TrackerLensRuntimeGraphStore.promoteDraftNode({
        draftNodeId: options.draftNodeId,
        workspaceId,
        node: {
          id: payload.id,
          workspaceId,
          type: "boxTracker",
          label: payload.content.name || payload.id,
          sourceRef: payload.id,
          assetId: payload.id,
          inputs: [],
          outputs: [channel].filter(Boolean),
          channels: [channel].filter(Boolean),
          status: payload.content.active !== false ? "active" : "inactive",
          metadata: {
            paletteLabel: options.runtimeLabel || "",
            trackerType: payload.content.trackerType,
            runtimeMode: payload.content.runtimeMode,
            source: payload.content.source,
            sampleOutput: payload.content.sampleOutput || {},
          },
        },
      });
    }

    const channels = (payload.content.channels || []).map((channel) => channel.id || channel).filter(Boolean);
    return window.TrackerLensRuntimeGraphStore.promoteDraftNode({
      draftNodeId: options.draftNodeId,
      workspaceId,
      node: {
        id: payload.id,
        workspaceId,
        type: "boxLens",
        label: payload.content.name || payload.id,
        sourceRef: payload.id,
        assetId: payload.id,
        inputs: channels,
        outputs: [],
        channels,
        status: payload.content.status !== false ? "active" : "inactive",
        metadata: {
          paletteLabel: options.runtimeLabel || "",
          boxType: payload.content.boxType,
          visibility: payload.content.visibility,
        },
      },
    });
  };

  const open = async (options = {}) => {
    const type = options.type === "boxTracker" ? "boxTracker" : "boxLens";
    const id = options.id || options.sourceId || "";
    const state = {
      loading: Boolean(id),
      saving: false,
      advanced: Boolean(options.advanced),
      lensCodeTab: "html",
      trackerTab: "Manifest",
      trackerPreviewView: "json",
      trackerTestStatus: "In attesa",
      trackerTestLatency: "—",
      trackerLastRun: "—",
      trackerTestRunning: false,
      previewDevice: "desktop",
      previewId: `box-dialog-preview-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      draftCode: null,
      trackerDraft: null,
      record: null,
      box: defaultBox({ type, template: options.template || {}, id, runtimeLabel: options.runtimeLabel || "", channel: options.channel || "" }),
      notice: id ? "Caricamento..." : "",
    };
    let dialog = null;
    let codeMirror = null;

    const currentContent = () => state.record?.content && typeof state.record.content === "object" ? state.record.content : {};
    const currentLensCode = () => {
      const content = currentContent();
      if (state.draftCode) return state.draftCode;
      const code = content.code && typeof content.code === "object" ? { ...defaultLensCode(state.box), ...content.code } : defaultLensCode(state.box);
      state.draftCode = {
        manifest: code.manifest || code.Manifest || "",
        html: code.html || code.HTML || "",
        css: code.css || code.CSS || "",
        js: code.js || code.JS || "",
        preview: code.preview || code.Preview || "",
        public: code.public || code.Public || "",
      };
      return state.draftCode;
    };
    const sampleTrackerJson = () => window.TrackerLensBoxTrackerData?.sampleJson || {};
    const trackerTabs = () => {
      const tabs = window.TrackerLensBoxTrackerData?.tabs;
      return Array.isArray(tabs) && tabs.length ? tabs : ["Manifest", "Endpoint", "Parametri", "Headers", "Trasformazione", "Output", "Test", "Avanzate"];
    };
    const currentTrackerDraft = () => {
      if (state.trackerDraft) return state.trackerDraft;
      const box = state.box || {};
      state.trackerDraft = {
        id: box.id || makeId("boxTracker"),
        name: box.name || "Box Tracker",
        category: box.category || "Dati",
        version: box.version || "0.1.0",
        runtimeVersion: box.runtimeVersion || ">=0.1.0",
        icon: box.icon || "cloud_queue",
        color: box.color || "#35c979",
        description: box.description || "",
        trackerType: box.trackerType || box.source || "manual",
        runtimeMode: box.runtimeMode || "manual",
        source: box.source || box.trackerType || "manual",
        outputChannel: box.outputChannel || "default",
        method: box.method || "GET",
        timeout: String(box.timeout || 10),
        endpoint: box.endpoint || "",
        reconnectInterval: String(box.reconnectInterval || 5),
        intervalMs: String(box.intervalMs || 0),
        visibility: box.visibility || "private",
        autoStartValue: box.autoStart === false ? "false" : "true",
        activeValue: box.active === false ? "false" : "true",
        reconnectValue: box.reconnect === false ? "false" : "true",
        query: box.query || "",
        headersText: box.headersText || "",
        transformText: box.transformText || "",
        sampleOutputJson: safeJsonStringify(box.sampleOutput || sampleTrackerJson(), {}),
        logLevel: box.logLevel || "Info",
        note: box.note || "",
      };
      return state.trackerDraft;
    };
    const updateTrackerDraft = (patch) => {
      if (type !== "boxTracker") return;
      state.trackerDraft = { ...currentTrackerDraft(), ...patch };
      state.box = { ...state.box, ...patch };
    };
    const readControlValue = (event) => event?.currentTarget?.value ?? event?.target?.value ?? "";
    const setTrackerTab = (tab) => {
      state.trackerTab = tab;
      rerender({ persist: false });
    };
    const setTrackerPreviewView = (view) => {
      state.trackerPreviewView = view;
      rerender({ persist: false });
    };

    const activeCodeTab = () => {
      const tabs = [
        { id: "manifest", label: "Manifest", name: "codeManifest", key: "manifest", language: "json", file: "manifest.json" },
        { id: "css", label: "CSS", name: "codeCss", key: "css", language: "css", file: "styles.css" },
        { id: "html", label: "HTML", name: "codeHtml", key: "html", language: "html", file: "template.html" },
        { id: "js", label: "JS", name: "codeJs", key: "js", language: "javascript", file: "controller.js" },
        { id: "preview", label: "Preview", name: "codePreview", key: "preview", language: "html", file: "preview.html" },
        { id: "public", label: "Public", name: "codePublic", key: "public", language: "json", file: "public.json" },
      ];
      return tabs.find((tab) => tab.id === state.lensCodeTab) || tabs[2];
    };

    const destroyCodeMirror = () => {
      if (codeMirror?.destroy) codeMirror.destroy();
      codeMirror = null;
    };

    const persistActiveCodeEditor = () => {
      if (type !== "boxLens" || !state.advanced) return;
      const active = activeCodeTab();
      if (codeMirror?.getValue) {
        updateDraftCode(active.key, codeMirror.getValue(), { refreshPreview: false });
        return;
      }
      const textareaNode = document.getElementById(`${state.previewId}-fallback-code`);
      if (textareaNode) updateDraftCode(active.key, textareaNode.value, { refreshPreview: false });
    };

    const codeMirrorLanguage = (tab) => {
      if (tab.id === "manifest" || tab.id === "public") return "javascript";
      if (tab.id === "js") return "javascript";
      return tab.id;
    };

    const mountCodeMirror = () => {
      if (type !== "boxLens" || !state.advanced) return;
      const active = activeCodeTab();
      const host = document.getElementById(`${state.previewId}-cm-host`);
      if (!host) return;
      destroyCodeMirror();
      host.replaceChildren();
      if (!window.TLCodeMirror?.createEditor) return;
      codeMirror = window.TLCodeMirror.createEditor({
        parent: host,
        doc: currentLensCode()[active.key] || "",
        language: codeMirrorLanguage(active),
        onChange: (value) => updateDraftCode(activeCodeTab().key, value),
      });
    };

    const updateActiveCodeTabDom = () => {
      const active = activeCodeTab();
      document.querySelectorAll(`[data-box-code-tab="${state.previewId}"]`).forEach((button) => {
        button.classList.toggle("is-active", button.dataset.tabId === active.id);
      });
      const status = document.getElementById(`${state.previewId}-editor-status`);
      if (status) status.textContent = `${active.label} (${active.file})`;
    };

    const updatePreviewDeviceDom = () => {
      document.querySelectorAll(`[data-box-preview-device="${state.previewId}"]`).forEach((button) => {
        button.classList.toggle("is-active", button.dataset.deviceId === state.previewDevice);
      });
    };

    const setAdvanced = (value) => {
      persistActiveCodeEditor();
      state.advanced = Boolean(value);
      rerender({ persist: false });
    };

    const setLensCodeTab = (tab) => {
      persistActiveCodeEditor();
      state.lensCodeTab = tab;
      if (codeMirror?.setValue && codeMirror?.setLanguage) {
        const active = activeCodeTab();
        codeMirror.setLanguage(codeMirrorLanguage(active));
        codeMirror.setValue(currentLensCode()[active.key] || "");
        updateActiveCodeTabDom();
        return;
      }
      rerender({ persist: false });
    };

    const setPreviewDevice = (device) => {
      state.previewDevice = device;
      updatePreviewDeviceDom();
      mountLensDialogPreview({ previewId: state.previewId, box: state.box, code: currentLensCode(), device: state.previewDevice });
    };

    const updateDraftCode = (key, value, options = {}) => {
      const code = currentLensCode();
      code[key] = value;
      if (options.refreshPreview === false) return;
      if (key === "html" || key === "css") {
        queueMicrotask(() => mountLensDialogPreview({ previewId: state.previewId, box: state.box, code, device: state.previewDevice }));
      }
    };

    const renderLensAdvanced = () => {
      const code = currentLensCode();
      const tabs = [
        { id: "manifest", label: "Manifest", name: "codeManifest", key: "manifest", value: code.manifest || "", file: "manifest.json" },
        { id: "css", label: "CSS", name: "codeCss", key: "css", value: code.css || "", file: "styles.css" },
        { id: "html", label: "HTML", name: "codeHtml", key: "html", value: code.html || "", file: "template.html" },
        { id: "js", label: "JS", name: "codeJs", key: "js", value: code.js || "", file: "controller.js" },
        { id: "preview", label: "Preview", name: "codePreview", key: "preview", value: code.preview || "", file: "preview.html" },
        { id: "public", label: "Public", name: "codePublic", key: "public", value: code.public || "", file: "public.json" },
      ];
      const active = tabs.find((tab) => tab.id === state.lensCodeTab) || tabs[1];
      queueMicrotask(() => mountLensDialogPreview({ previewId: state.previewId, box: state.box, code, device: state.previewDevice }));
      queueMicrotask(mountCodeMirror);
      return _.section(
        { class: "tl-box-dialog-advanced tl-box-dialog-lens-advanced" },
        _.section(
          { class: "tl-box-dialog-code-panel" },
          _.div(
            { class: "tl-box-dialog-tabs" },
            ...tabs.map((tab) => btn({
              class: tab.id === active.id ? "is-active" : "",
              "data-box-code-tab": state.previewId,
              "data-tab-id": tab.id,
              onclick: () => setLensCodeTab(tab.id),
            }, tab.label))
          ),
          _.div(
            { class: "tl-box-dialog-code-body" },
            ...(window.TLCodeMirror?.createEditor
                ? [
                  _.div({ id: `${state.previewId}-cm-host`, class: "tl-box-dialog-cm-host tl-cm6-host" }),
                  ...tabs.map((tab) => input({ type: "hidden", name: tab.name, value: code[tab.key] || "" })),
                ]
                : tabs.map((tab) => textarea({
                  id: tab.id === active.id ? `${state.previewId}-fallback-code` : "",
                  class: `tl-box-dialog-input tl-box-dialog-code${tab.id === active.id ? " is-active" : ""}`,
                  name: tab.name,
                  rows: 18,
                  spellcheck: "false",
                  oninput: (event) => updateDraftCode(tab.key, event.currentTarget.value),
                }, tab.value)))
          ),
          _.div(
            { class: "tl-box-dialog-editor-status" },
            _.span({ id: `${state.previewId}-editor-status` }, `${active.label} (${active.file})`),
            icon("settings", "sm")
          )
        ),
        _.section(
          { class: "tl-box-dialog-live-panel" },
          _.div(
            { class: "tl-box-dialog-live-head" },
            _.div({ class: "tl-box-dialog-live-title" }, "Anteprima Live", _.span({ class: "tl-box-dialog-live-dot" })),
            _.div(
              { class: "tl-box-dialog-device-icons" },
              ...["desktop", "tablet", "mobile"].map((device) => btn({
                class: state.previewDevice === device ? "is-active" : "",
                "data-box-preview-device": state.previewId,
                "data-device-id": device,
                "aria-label": device,
                onclick: () => setPreviewDevice(device),
              }, icon(device === "desktop" ? "desktop_windows" : device === "tablet" ? "tablet_mac" : "phone_iphone", "sm"))),
              btn({ "aria-label": "Espandi" }, icon("fullscreen", "sm"))
            )
          ),
          _.div(
            {
              id: `${state.previewId}-canvas`,
              class: "tl-box-dialog-preview-canvas",
              "data-box-dialog-preview": state.previewId,
            },
            _.div({ class: "tl-box-dialog-preview-size" }, `${state.box.width || 10} x ${state.box.height || 6} celle`),
            _.style({ id: `${state.previewId}-style` }),
            _.div({ id: `${state.previewId}-runtime`, class: "tl-box-dialog-preview-runtime" })
          )
        )
      );
    };

    const trackerStateClass = () => {
      if (state.trackerTestStatus === "Errore") return "is-error";
      if (state.trackerTestStatus === "In esecuzione") return "is-running";
      if (state.trackerTestStatus === "Connesso") return "is-ok";
      return "";
    };
    const trackerValueInput = (key, attrs = {}) => input({
      ...attrs,
      value: currentTrackerDraft()[key] ?? "",
      oninput: (event) => updateTrackerDraft({ [key]: readControlValue(event) }),
    });
    const trackerValueTextarea = (key, attrs = {}) => textarea({
      ...attrs,
      oninput: (event) => updateTrackerDraft({ [key]: readControlValue(event) }),
    }, currentTrackerDraft()[key] ?? "");
    const trackerValueSelect = (key, options, attrs = {}) => select({
      ...attrs,
      value: currentTrackerDraft()[key] ?? "",
      onchange: (event) => updateTrackerDraft({ [key]: readControlValue(event) }),
    }, options);
    const trackerHiddenFields = () => Object.entries(currentTrackerDraft()).map(([name, value]) => input({
      type: "hidden",
      name,
      value: String(value ?? ""),
    }));
    const trackerSamplePayload = () => {
      try {
        return parseJsonField(currentTrackerDraft().sampleOutputJson, "Sample output", {});
      } catch (_) {
        return { error: "Sample output JSON non valido" };
      }
    };
    const emitTrackerTestEvent = async ({ payload = {}, latency = 0, status = "ok", error = "" } = {}) => {
      if (!window.TrackerLensEventBus?.get) return null;
      const bus = window.TrackerLensEventBus.get(options.workspaceId || "workspace_global", {
        eventStore: window.TrackerLensEventLogStore,
        channelRegistry: window.TrackerLensChannelRegistry,
      });
      if (!bus?.emit) return null;
      const draft = currentTrackerDraft();
      return bus.emit(draft.outputChannel || "default", status === "error" ? { error } : payload, {
        workspaceId: options.workspaceId || "workspace_global",
        eventType: status === "error" ? "tracker_test_error" : "tracker_test",
        sourceNodeId: options.draftNodeId || draft.id,
        status,
        latencyMs: Number(latency) || payload?._trackerTest?.latencyMs || 0,
        meta: {
          source: "box-editor-dialog",
          trackerId: draft.id,
          trackerName: draft.name,
          draftNodeId: options.draftNodeId || "",
        },
      });
    };
    const runTrackerTest = async () => {
      if (state.trackerTestRunning) return;
      const started = performance.now();
      state.trackerTestRunning = true;
      state.trackerTestStatus = "In esecuzione";
      state.trackerTestLatency = "—";
      state.notice = "Esecuzione test tracker...";
      rerender({ persist: false });
      try {
        const draft = currentTrackerDraft();
        const sampleOutput = parseJsonField(draft.sampleOutputJson, "Sample output", {});
        if (!window.TrackerLensTrackerTestRunner?.executeTrackerTest) throw new Error("Tracker test runner non disponibile.");
        const payload = await window.TrackerLensTrackerTestRunner.executeTrackerTest(draft, { sampleOutput, started });
        const latency = Math.max(1, Math.round(performance.now() - started));
        updateTrackerDraft({ sampleOutputJson: safeJsonStringify(payload, {}) });
        state.trackerTestStatus = "Connesso";
        state.trackerTestLatency = `${latency} ms`;
        state.trackerLastRun = new Date().toLocaleTimeString();
        state.notice = "Test manuale eseguito";
        await emitTrackerTestEvent({ payload, latency, status: "ok" });
        notify("success", state.notice);
      } catch (error) {
        console.error(error);
        const latency = Math.max(1, Math.round(performance.now() - started));
        state.trackerTestStatus = "Errore";
        state.trackerTestLatency = "—";
        state.trackerLastRun = new Date().toLocaleTimeString();
        state.notice = error.message || "Test manuale non riuscito.";
        await emitTrackerTestEvent({ latency, status: "error", error: state.notice });
        notify("error", state.notice);
      } finally {
        state.trackerTestRunning = false;
        rerender({ persist: false });
      }
    };
    const renderTrackerTabPanel = () => {
      const draft = currentTrackerDraft();
      if (state.trackerTab === "Endpoint") {
        return _.section(
          { class: "tl-box-dialog-tracker-panel" },
          _.h3("Endpoint"),
          _.div(
            { class: "tl-box-dialog-grid" },
            formRow("Metodo", trackerValueSelect("method", ["GET", "POST", "PUT", "PATCH", "DELETE"].map((value) => ({ value, label: value })))),
            formRow("Tipo sorgente", select({
              class: "tl-box-dialog-input",
              value: draft.source || draft.trackerType,
              onchange: (event) => updateTrackerDraft({ source: readControlValue(event), trackerType: readControlValue(event) }),
            }, trackerTypeOptions()))
          ),
          formRow("URL / Sorgente", trackerValueInput("endpoint", { placeholder: "https://... o wss://..." }))
        );
      }
      if (state.trackerTab === "Parametri") {
        return _.section(
          { class: "tl-box-dialog-tracker-panel" },
          _.h3("Parametri"),
          _.p({ class: "tl-box-dialog-muted" }, "Per REST GET diventano query string. Per POST/PUT/PATCH diventano body. Per WebSocket vengono inviati all'apertura."),
          formRow("Query / subscription", trackerValueTextarea("query", { rows: 8, spellcheck: "false" }))
        );
      }
      if (state.trackerTab === "Headers") {
        return _.section(
          { class: "tl-box-dialog-tracker-panel" },
          _.h3("Headers"),
          _.p({ class: "tl-box-dialog-muted" }, "Accetta JSON oppure righe key:value."),
          formRow("Headers", trackerValueTextarea("headersText", { rows: 10, placeholder: "Authorization: Bearer ...", spellcheck: "false" }))
        );
      }
      if (state.trackerTab === "Trasformazione") {
        return _.section(
          { class: "tl-box-dialog-tracker-panel" },
          _.h3("Trasformazione"),
          _.p({ class: "tl-box-dialog-muted" }, "Regole di mapping per normalizzare l'output prima di inviarlo ai boxLens."),
          formRow("Mapping / note trasformazione", trackerValueTextarea("transformText", { rows: 10, placeholder: "c -> price\nP -> change24h", spellcheck: "false" }))
        );
      }
      if (state.trackerTab === "Output") {
        return _.section(
          { class: "tl-box-dialog-tracker-panel" },
          _.h3("Output"),
          formRow("Canale output", trackerValueInput("outputChannel")),
          formRow("Sample JSON", trackerValueTextarea("sampleOutputJson", { class: "tl-box-dialog-input tl-box-dialog-mono", rows: 12, spellcheck: "false" }))
        );
      }
      if (state.trackerTab === "Test") {
        return _.section(
          { class: "tl-box-dialog-tracker-panel" },
          _.h3("Test"),
          _.div({ class: "tl-box-dialog-test-row" }, _.span("Stato test"), _.span({ class: `tl-box-dialog-state-pill ${trackerStateClass()}` }, state.trackerTestStatus)),
          _.div({ class: "tl-box-dialog-test-row" }, _.span("Latenza"), _.strong(state.trackerTestLatency)),
          _.div({ class: "tl-box-dialog-test-row" }, _.span("Ultima esecuzione"), _.strong(state.trackerLastRun)),
          btn({ class: "is-primary", onclick: runTrackerTest, disabled: state.trackerTestRunning }, icon("play_arrow", "sm"), state.trackerTestRunning ? "Test in corso" : "Esegui test manuale")
        );
      }
      if (state.trackerTab === "Avanzate") {
        return _.section(
          { class: "tl-box-dialog-tracker-panel" },
          _.h3("Avanzate"),
          _.div(
            { class: "tl-box-dialog-grid" },
            formRow("Versione", trackerValueInput("version")),
            formRow("Runtime", trackerValueInput("runtimeVersion")),
            formRow("Livello log", trackerValueSelect("logLevel", ["Debug", "Info", "Warn", "Error"].map((value) => ({ value, label: value })))),
            formRow("Visibilità", trackerValueSelect("visibility", [
              { value: "private", label: "Private" },
              { value: "public", label: "Public" },
            ]))
          ),
          formRow("Note", trackerValueTextarea("note", { rows: 5 }))
        );
      }
      return _.section(
        { class: "tl-box-dialog-tracker-panel" },
        _.h3("Manifest"),
        _.div(
          { class: "tl-box-dialog-grid" },
          formRow("Nome", trackerValueInput("name", { required: true })),
          formRow("Categoria", trackerValueInput("category")),
          formRow("Icona", trackerValueInput("icon")),
          formRow("Colore", trackerValueInput("color", { type: "color" })),
          formRow("Runtime mode", trackerValueSelect("runtimeMode", [
            { value: "manual", label: "Manuale" },
            { value: "real-time", label: "Real-time" },
            { value: "interval", label: "Intervallo" },
          ])),
          formRow("Timeout richiesta (s)", trackerValueInput("timeout", { type: "number", min: "1" })),
          formRow("Riconnessione", trackerValueSelect("reconnectValue", [
            { value: "true", label: "Attiva" },
            { value: "false", label: "Disattiva" },
          ])),
          formRow("Intervallo riconnessione (s)", trackerValueInput("reconnectInterval", { type: "number", min: "0" })),
          formRow("Intervallo mock runtime (ms)", trackerValueInput("intervalMs", { type: "number", min: "0" })),
          formRow("Auto start", trackerValueSelect("autoStartValue", [
            { value: "true", label: "Attivo" },
            { value: "false", label: "Disattivo" },
          ])),
          formRow("Stato iniziale", trackerValueSelect("activeValue", [
            { value: "true", label: "Attivo" },
            { value: "false", label: "Disattivo" },
          ]))
        ),
        formRow("Descrizione", trackerValueTextarea("description", { rows: 4 }))
      );
    };
    const renderTrackerPreview = () => {
      const sample = trackerSamplePayload();
      return _.section(
        { class: "tl-box-dialog-tracker-preview" },
        _.div(
          { class: "tl-box-dialog-live-head" },
          _.div({ class: "tl-box-dialog-live-title" }, "Anteprima / Test", _.span({ class: "tl-box-dialog-live-dot" })),
          _.div(
            { class: "tl-box-dialog-device-icons" },
            btn({ class: state.trackerPreviewView === "summary" ? "is-active" : "", "aria-label": "Summary", onclick: () => setTrackerPreviewView("summary") }, icon("article", "sm")),
            btn({ class: state.trackerPreviewView === "json" ? "is-active" : "", "aria-label": "JSON", onclick: () => setTrackerPreviewView("json") }, icon("code", "sm")),
            btn({ "aria-label": "Esegui test", onclick: runTrackerTest, disabled: state.trackerTestRunning }, icon("play_arrow", "sm"))
          )
        ),
        _.div(
          { class: "tl-box-dialog-test-card" },
          _.div({ class: "tl-box-dialog-test-row" }, _.span("Stato"), _.span({ class: `tl-box-dialog-state-pill ${trackerStateClass()}` }, state.trackerTestStatus)),
          _.div({ class: "tl-box-dialog-test-row" }, _.span("Ultimo messaggio ricevuto"), _.strong(state.trackerLastRun)),
          state.trackerPreviewView === "summary"
            ? _.div(
              { class: "tl-box-dialog-summary-preview" },
              _.div({ class: "tl-box-dialog-test-row" }, _.span("Canale"), _.strong(currentTrackerDraft().outputChannel || "default")),
              _.div({ class: "tl-box-dialog-test-row" }, _.span("Prezzo"), _.strong(sample.c || sample.price || "—")),
              _.div({ class: "tl-box-dialog-test-row" }, _.span("Cambio"), _.strong(sample.P || sample.change24h || "—"))
            )
            : _.pre({ class: "tl-box-dialog-json-preview" }, safeJsonStringify(sample, {}))
        ),
        _.div(
          { class: "tl-box-dialog-preview-foot" },
          btn({ class: "is-primary", onclick: runTrackerTest, disabled: state.trackerTestRunning }, icon("play_arrow", "sm"), state.trackerTestRunning ? "Test in corso" : "Esegui test manuale"),
          _.span("Risposta: ", _.strong({ class: `tl-box-dialog-state-pill ${trackerStateClass()}` }, state.trackerTestLatency))
        )
      );
    };
    const renderTrackerAdvanced = () =>
      _.section(
        { class: "tl-box-dialog-advanced tl-box-dialog-tracker-advanced" },
        ...trackerHiddenFields(),
        _.section(
          { class: "tl-box-dialog-code-panel" },
          _.div(
            { class: "tl-box-dialog-tabs" },
            ...trackerTabs().map((tab) => btn({
              class: tab === state.trackerTab ? "is-active" : "",
              onclick: () => setTrackerTab(tab),
            }, tab))
          ),
          renderTrackerTabPanel()
        ),
        renderTrackerPreview()
      );

    const renderBody = () => {
      if (state.loading) return _.div({ class: "tl-box-dialog-state" }, "Caricamento box...");
      const box = state.box;
      const isTracker = type === "boxTracker";
      const hiddenLensSettings = () => [
        input({ type: "hidden", name: "name", value: box.name || "" }),
        input({ type: "hidden", name: "category", value: box.category || "" }),
        input({ type: "hidden", name: "version", value: box.version || "0.1.0" }),
        input({ type: "hidden", name: "runtimeVersion", value: box.runtimeVersion || ">=0.1.0" }),
        input({ type: "hidden", name: "icon", value: box.icon || "dashboard" }),
        input({ type: "hidden", name: "color", value: box.color || "#9b5cf5" }),
        input({ type: "hidden", name: "description", value: box.description || "" }),
        input({ type: "hidden", name: "boxType", value: box.boxType || "empty" }),
        input({ type: "hidden", name: "channel", value: (box.channels || []).map((channel) => channel.id || channel).join(", ") || "default" }),
        input({ type: "hidden", name: "width", value: String(box.width || 10) }),
        input({ type: "hidden", name: "height", value: String(box.height || 6) }),
      ];
      return _.form(
        {
          class: "tl-box-dialog-form",
          onsubmit: (event) => {
            event.preventDefault();
            save(event.currentTarget);
          },
        },
        input({ type: "hidden", name: "id", value: box.id }),
        state.advanced && !isTracker ? hiddenLensSettings() : null,
        state.advanced ? null : _.div(
            { class: "tl-box-dialog-grid" },
            formRow("Nome", input({ name: "name", value: box.name || "", required: true })),
            formRow("Categoria", input({ name: "category", value: box.category || "" })),
            formRow("Versione", input({ name: "version", value: box.version || "0.1.0" })),
            formRow("Runtime", input({ name: "runtimeVersion", value: box.runtimeVersion || ">=0.1.0" })),
            formRow("Icona", input({ name: "icon", value: box.icon || (isTracker ? "cloud_queue" : "dashboard") })),
            formRow("Colore", input({ name: "color", type: "color", value: box.color || (isTracker ? "#35c979" : "#9b5cf5") }))
          ),
        state.advanced ? null : formRow("Descrizione", textarea({ name: "description", rows: 3 }, box.description || "")),
        state.advanced ? null : isTracker
          ? _.div(
            { class: "tl-box-dialog-grid" },
            formRow("Tipo tracker", select({ name: "trackerType", value: box.trackerType || "manual" }, trackerTypeOptions())),
            formRow("Runtime mode", select({ name: "runtimeMode", value: box.runtimeMode || "manual" }, [
              { value: "manual", label: "Manuale" },
              { value: "real-time", label: "Real-time" },
              { value: "interval", label: "Intervallo" },
            ])),
            formRow("Source", input({ name: "source", value: box.source || box.trackerType || "manual" })),
            formRow("Output channel", input({ name: "outputChannel", value: box.outputChannel || "default" })),
            formRow("Metodo", select({ name: "method", value: box.method || "GET" }, ["GET", "POST", "PUT", "PATCH", "DELETE"].map((value) => ({ value, label: value })))),
            formRow("Timeout", input({ name: "timeout", type: "number", min: "1", value: String(box.timeout || 10) }))
          )
          : _.div(
            { class: "tl-box-dialog-grid" },
            formRow("Tipo Lens", select({ name: "boxType", value: box.boxType || "empty" }, lensTypeOptions())),
            formRow("Canali", input({ name: "channel", value: (box.channels || []).map((channel) => channel.id || channel).join(", ") || "default" }), "Separali con virgola."),
            formRow("Larghezza", input({ name: "width", type: "number", min: "1", value: String(box.width || 10) })),
            formRow("Altezza", input({ name: "height", type: "number", min: "1", value: String(box.height || 6) }))
          ),
        state.advanced ? null : isTracker ? formRow("Endpoint", input({ name: "endpoint", value: box.endpoint || "", placeholder: "https://..." })) : null,
        state.advanced ? (isTracker ? renderTrackerAdvanced() : renderLensAdvanced()) : null,
        state.notice ? _.div({ class: "tl-box-dialog-notice" }, state.notice) : null
      );
    };

    const readValues = (form) => {
      const data = new FormData(form);
      const values = Object.fromEntries(data.entries());
      if (type === "boxTracker") {
        values.reconnect = values.reconnectValue !== undefined ? values.reconnectValue !== "false" : state.box.reconnect !== false;
        values.active = values.activeValue !== undefined ? values.activeValue !== "false" : state.box.active !== false;
        values.autoStart = values.autoStartValue !== undefined ? values.autoStartValue !== "false" : state.box.autoStart !== false;
        values.intervalMs = values.intervalMs ?? state.box.intervalMs ?? 0;
        values.reconnectInterval = values.reconnectInterval ?? state.box.reconnectInterval ?? 5;
        values.visibility = values.visibility || state.box.visibility || "private";
      } else {
        values.visibility = state.box.visibility || "private";
        values.status = state.box.status !== false;
      }
      return values;
    };

    const rerender = (options = {}) => {
      if (options.persist !== false) persistActiveCodeEditor();
      destroyCodeMirror();
      dialog?.close?.();
      dialog = makeDialog();
      dialog.open();
    };

    const save = async (form) => {
      if (state.saving) return;
      persistActiveCodeEditor();
      state.saving = true;
      state.notice = "Salvataggio...";
      if (type === "boxLens" && state.advanced && state.draftCode) {
        Object.entries({
          codeManifest: state.draftCode.manifest,
          codeCss: state.draftCode.css,
          codeHtml: state.draftCode.html,
          codeJs: state.draftCode.js,
          codePreview: state.draftCode.preview,
          codePublic: state.draftCode.public,
        }).forEach(([name, value]) => {
          let field = form.querySelector(`[name="${name}"]`);
          if (!field) {
            field = document.createElement("input");
            field.type = "hidden";
            field.name = name;
            form.appendChild(field);
          }
          field.value = value || "";
        });
      }
      const values = readValues(form);
      const existingContent = state.record?.content && typeof state.record.content === "object" ? state.record.content : {};
      try {
        const payload = buildPayload({ type, values, existingContent });
        await putWidgetRecord(payload);
        if (type === "boxTracker" && window.TrackerLensChannelRegistry?.upsertChannelForTracker) {
          await window.TrackerLensChannelRegistry.upsertChannelForTracker({
            tracker: { ...payload.content, id: payload.id },
            workspaceId: options.workspaceId || "workspace_global",
          });
        }
        await syncDraftRuntimeNode({ type, payload, options });
        state.record = payload;
        state.box = normalizeRecordContent(payload, type, state.box);
        state.notice = "Salvato localmente";
        notify("success", type === "boxTracker" ? "boxTracker salvato" : "boxLens salvato");
        await options.onSave?.({ type, id: payload.id, payload, box: state.box, dialog });
        dialog?.close?.();
      } catch (error) {
        console.error(error);
        state.notice = error.message || "Impossibile salvare il box.";
        notify("error", state.notice);
        state.saving = false;
        rerender();
      }
    };

    const makeDialog = () => _.Dialog({
      class: `tl-box-editor-dialog ${state.advanced ? "is-advanced" : ""} ${type === "boxTracker" ? "is-tracker" : "is-lens"} cms-dialog-xl sticky-head sticky-actions scrollable`,
      panelClass: "tl-box-editor-dialog-panel",
      icon: type === "boxTracker" ? "cloud_queue" : "dashboard",
      title: id ? (type === "boxTracker" ? "Modifica boxTracker" : "Modifica boxLens") : (type === "boxTracker" ? "Crea boxTracker" : "Crea boxLens"),
      subtitle: state.advanced ? "Editor avanzato universale, senza iframe." : "Settings universali richiamabili da workspace, Flow Map e libreria.",
      content: renderBody,
      actions: ({ close }) => [
        btn({ onclick: close }, icon("close", "sm"), "Annulla"),
        btn({
          onclick: () => setAdvanced(!state.advanced),
          disabled: state.loading || state.saving,
        }, icon(state.advanced ? "tune" : "code", "sm"), state.advanced ? "Settings" : "Avanzato"),
        btn({
          class: "is-primary",
          disabled: state.loading || state.saving,
          onclick: () => {
            const form = document.querySelector(".tl-box-editor-dialog .tl-box-dialog-form");
            if (form?.requestSubmit) form.requestSubmit();
          },
        }, icon("save", "sm"), state.saving ? "Salvataggio..." : "Salva"),
      ],
    });

    dialog = makeDialog();
    dialog.open();
    queueMicrotask(mountCodeMirror);

    if (id) {
      try {
          state.record = await getWidgetRecord(id);
        if (state.record) {
          state.box = normalizeRecordContent(state.record, type, state.box);
          state.draftCode = null;
          state.trackerDraft = null;
          state.notice = "";
        } else {
          state.notice = "Box non trovato. Puoi salvarlo come nuovo.";
        }
      } catch (error) {
        console.error(error);
        state.notice = error.message || "Impossibile leggere il box.";
      } finally {
        state.loading = false;
        rerender();
      }
    }

    return dialog;
  };

  return { open };
})();
