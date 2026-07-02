(() => {
  const params = new URLSearchParams(window.location.search);
  const workspaceId = String(params.get("workspaceId") || "workspace_global").trim() || "workspace_global";
  const mode = String(params.get("mode") || "hard").trim().toLowerCase();
  const dbName = ((typeof tlConfig !== "undefined" ? tlConfig : window.tlConfig) || {}).DB_NAME || "TrackersLens";
  const tables = ((typeof tlConfig !== "undefined" ? tlConfig : window.tlConfig) || {}).TABLES || {};
  const output = document.getElementById("output");
  const scanButton = document.getElementById("scan");
  const button = document.getElementById("repair");
  const confirmInput = document.getElementById("confirm");
  const workspaceLabel = document.getElementById("workspace");
  const modeLabel = document.getElementById("mode");
  const warning = document.getElementById("warning");
  const openFlow = document.getElementById("open-flow");
  let lastScan = null;

  const storeNames = [
    tables.TL_PAGES || "tl_pages",
    tables.TL_WIDGETS || "tl_widgets",
    tables.TL_FLOWS || "tl_flows",
    tables.TL_RUNTIME_NODES || "tl_runtime_nodes",
    tables.TL_RUNTIME_DEPENDENCIES || "tl_runtime_dependencies",
    tables.TL_CONNECTIONS || "tl_connections",
    tables.TL_CHANNELS || "tl_channels",
    tables.TL_EVENTS || "tl_events",
    tables.TL_FLOW_LOGS || "tl_flow_logs",
    tables.TL_BOX_PERFORMANCE || "tl_box_performance",
    tables.TL_TIME_TRAVEL_SNAPSHOTS || "tl_time_travel_snapshots",
    tables.TL_FLOW_PROMPT_CHATS || "tl_flow_prompt_chats",
    tables.TL_KNOWLEDGE_DOCUMENTS || "tl_knowledge_documents",
    tables.TL_KNOWLEDGE_CHUNKS || "tl_knowledge_chunks",
    tables.TL_KNOWLEDGE_EMBEDDINGS || "tl_knowledge_embeddings",
    tables.TL_KNOWLEDGE_ENTITIES || "tl_knowledge_entities",
    tables.TL_KNOWLEDGE_RELATIONS || "tl_knowledge_relations",
    tables.TL_KNOWLEDGE_DICTIONARY || "tl_knowledge_dictionary",
    tables.TL_KNOWLEDGE_QUERIES || "tl_knowledge_queries",
    tables.TL_KNOWLEDGE_SOURCES || "tl_knowledge_sources",
    tables.TL_KNOWLEDGE_METRICS || "tl_knowledge_metrics",
  ].filter(Boolean);

  const allFlowMapStoreNames = [
    ...storeNames,
    tables.TL_OFFLINE_QUEUE || "tl_offline_queue",
    tables.TL_OFFLINE_CACHE || "tl_offline_cache",
  ].filter(Boolean);

  const isGlobalFlowMapMode = () => ["flowmap-global", "global", "runtime-global"].includes(mode);
  const isWipeDbMode = () => ["wipe-db", "delete-db", "nuclear"].includes(mode);

  const write = (value) => {
    output.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  };

  const openDb = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName);
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error || new Error(`Cannot open ${dbName}`));
    request.onblocked = () => reject(new Error("IndexedDB is blocked by another tab. Close other Trackers Lens tabs and retry."));
  });

  const valueMatchesWorkspace = (value) => {
    if (!value) return false;
    if (String(value) === workspaceId) return true;
    return false;
  };

  const recordMatchesWorkspace = (record = {}) => {
    if (!record || typeof record !== "object") return false;
    if (valueMatchesWorkspace(record.id)) return true;
    if (valueMatchesWorkspace(record.workspaceId)) return true;
    if (valueMatchesWorkspace(record.workspaceName)) return true;
    if (valueMatchesWorkspace(record.flowId)) return true;
    if (valueMatchesWorkspace(record.pageId)) return true;
    if (valueMatchesWorkspace(record.content?.id)) return true;
    if (valueMatchesWorkspace(record.content?.workspaceId)) return true;
    if (valueMatchesWorkspace(record.value?.workspaceId)) return true;
    if (valueMatchesWorkspace(record.meta?.workspaceId)) return true;
    if (valueMatchesWorkspace(record.context?.workspaceId)) return true;
    if (mode === "deep") {
      try {
        return JSON.stringify(record).includes(workspaceId);
      } catch (_) {
        return false;
      }
    }
    return false;
  };

  const readMatchingFromStore = (db, storeName, predicate = recordMatchesWorkspace) => new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(storeName)) {
      resolve({ store: storeName, skipped: true, records: [] });
      return;
    }
    const transaction = db.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName);
    const read = store.getAll();
    read.onsuccess = () => {
      const records = Array.from(read.result || []);
      resolve({ store: storeName, records: records.filter(predicate) });
    };
    read.onerror = (event) => reject(event.target.error || new Error(`Cannot read ${storeName}`));
  });

  const countStore = (db, storeName) => new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(storeName)) {
      resolve({ store: storeName, skipped: true, records: [] });
      return;
    }
    const transaction = db.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName);
    const read = store.getAll();
    read.onsuccess = () => resolve({ store: storeName, records: Array.from(read.result || []) });
    read.onerror = (event) => reject(event.target.error || new Error(`Cannot read ${storeName}`));
  });

  const wipeDatabase = () => new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName);
    request.onsuccess = () => resolve({ dbName, deleted: true });
    request.onerror = (event) => reject(event.target.error || new Error(`Cannot delete ${dbName}`));
    request.onblocked = () => reject(new Error("IndexedDB delete is blocked. Close every Trackers Lens tab and retry."));
  });

  const clearLocalStorage = () => {
    const deleted = [];
    try {
      Object.keys(localStorage || {}).forEach((key) => {
        const shouldDelete = isGlobalFlowMapMode()
          ? key.startsWith("tl_flow_") || key.includes("flow")
          : key.includes(workspaceId);
        if (!shouldDelete) return;
        localStorage.removeItem(key);
        deleted.push(key);
      });
    } catch (_) {
      // Ignore storage restrictions.
    }
    return deleted;
  };

  const scan = async () => {
    scanButton.disabled = true;
    button.disabled = true;
    write(`Scanning ${workspaceId} (${mode})...`);
    if (isWipeDbMode()) {
      lastScan = {
        workspaceId,
        mode,
        token: `DELETE ${dbName}`,
        stores: [],
        deletedTotal: "database",
        warning: `This will delete the entire ${dbName} IndexedDB database.`,
      };
      write(lastScan);
      confirmInput.placeholder = lastScan.token;
      button.disabled = false;
      scanButton.disabled = false;
      return lastScan;
    }
    const db = await openDb();
    try {
      const targetStores = isGlobalFlowMapMode() ? allFlowMapStoreNames : storeNames;
      const stores = [];
      for (const storeName of targetStores) {
        stores.push(isGlobalFlowMapMode()
          ? await countStore(db, storeName)
          : await readMatchingFromStore(db, storeName));
      }
      const localStorageKeys = Object.keys(localStorage || {}).filter((key) =>
        isGlobalFlowMapMode() ? key.startsWith("tl_flow_") || key.includes("flow") : key.includes(workspaceId));
      lastScan = {
        workspaceId,
        mode,
        token: isGlobalFlowMapMode() ? "DELETE FLOWMAP GLOBAL" : `DELETE ${workspaceId}`,
        stores: stores.map((item) => ({
          store: item.store,
          skipped: Boolean(item.skipped),
          count: item.records?.length || 0,
          ids: (item.records || []).map((record) => record.id).filter(Boolean).slice(0, 80),
          deleteIds: (item.records || []).map((record) => record.id).filter(Boolean),
        })),
        localStorageKeys,
        deletedTotal: stores.reduce((sum, item) => sum + (item.records?.length || 0), 0) + localStorageKeys.length,
        scannedAt: new Date().toISOString(),
      };
      write(lastScan);
      confirmInput.placeholder = lastScan.token;
      button.disabled = false;
      return lastScan;
    } finally {
      db.close();
      scanButton.disabled = false;
    }
  };

  const downloadBackup = (payload = {}) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `trackers-lens-repair-backup-${workspaceId}-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const deleteRecordsFromStore = (db, storeName, ids = [], clear = false) => new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(storeName)) {
      resolve({ store: storeName, skipped: true, deleted: 0 });
      return;
    }
    const transaction = db.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    const summary = { store: storeName, deleted: clear ? "all" : ids.length, cleared: clear };
    if (clear) store.clear();
    else ids.forEach((id) => store.delete(id));
    transaction.oncomplete = () => resolve(summary);
    transaction.onerror = (event) => reject(event.target.error || new Error(`Cannot delete from ${storeName}`));
  });

  const repair = async () => {
    if (!lastScan) {
      await scan();
      return null;
    }
    if (String(confirmInput.value || "").trim() !== lastScan.token) {
      write({ error: "Confirmation token does not match.", required: lastScan.token });
      return null;
    }
    button.disabled = true;
    scanButton.disabled = true;
    write(`Deleting ${workspaceId} (${mode})...`);
    if (isWipeDbMode()) {
      const result = await wipeDatabase();
      write({ mode, ...result, repairedAt: new Date().toISOString() });
      button.disabled = false;
      return result;
    }
    const db = await openDb();
    try {
      const backupStores = [];
      const deleteResults = [];
      for (const item of lastScan.stores || []) {
        const ids = item.deleteIds || item.ids || [];
        const records = isGlobalFlowMapMode()
          ? (await countStore(db, item.store)).records
          : (await readMatchingFromStore(db, item.store)).records;
        backupStores.push({ store: item.store, records });
        deleteResults.push(await deleteRecordsFromStore(db, item.store, ids, isGlobalFlowMapMode()));
      }
      downloadBackup({ workspaceId, mode, stores: backupStores, localStorageKeys: lastScan.localStorageKeys, createdAt: new Date().toISOString() });
      const localStorageKeys = clearLocalStorage();
      const result = {
        workspaceId,
        mode,
        stores: deleteResults,
        localStorageKeys,
        deletedTotal: lastScan.deletedTotal,
        repairedAt: new Date().toISOString(),
      };
      write(result);
      return result;
    } finally {
      db.close();
      button.disabled = false;
    }
  };

  workspaceLabel.textContent = workspaceId;
  modeLabel.textContent = mode;
  warning.style.display = isGlobalFlowMapMode() || isWipeDbMode() ? "block" : "none";
  openFlow.href = `flowMap.html?workspaceId=${encodeURIComponent(workspaceId)}`;
  scanButton.addEventListener("click", () => scan().catch((error) => write(`Scan failed: ${error.message || error}`)));
  button.addEventListener("click", () => repair().catch((error) => write(`Repair failed: ${error.message || error}`)));
  if (params.get("auto") === "1") scan().catch((error) => write(`Scan failed: ${error.message || error}`));
})();
