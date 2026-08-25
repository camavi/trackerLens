window.TrackerLensBoxPerformanceMonitor = (() => {
  const STORE = "tl_box_performance";
  let desktopSqliteMode = null;
  const desktopPersistence = () => window.trackers?.desktop?.persistence || null;
  const usesDesktopSqlite = async () => {
    if (desktopSqliteMode !== null) return desktopSqliteMode;
    const persistence = desktopPersistence();
    if (!persistence?.getStatus) return (desktopSqliteMode = false);
    try { desktopSqliteMode = (await persistence.getStatus())?.mode === "desktop-sqlite"; } catch (_) { desktopSqliteMode = false; }
    return desktopSqliteMode;
  };
  const ensureDb = async () => {
    const persistence = desktopPersistence();
    if (!await usesDesktopSqlite() || !persistence?.readDevelopmentRecords || !persistence.writeDevelopmentRecords) {
      throw new Error("Performance Monitor richiede SQLite nell'app desktop.");
    }
    return persistence;
  };
  const SCHEMA_VERSION = "1.0.0";
  const WINDOW_MS = 60 * 1000;
  const DEFAULT_THRESHOLDS = {
    warningErrorRate: 5,
    errorErrorRate: 20,
    warningLatencyMs: 500,
  };

  const now = () => new Date().toISOString();
  const normalizeText = (value, fallback = "") => value === null || value === undefined ? fallback : String(value).trim() || fallback;
  const safeNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const payloadSize = (payload, payloadText = "") => {
    const text = payloadText || JSON.stringify(payload || {});
    return new Blob([text]).size;
  };
  const estimateMemoryBytes = ({ eventCount = 0, lastPayloadBytes = 0, errorCount = 0 } = {}) =>
    Math.max(1024, eventCount * 360 + errorCount * 540 + lastPayloadBytes * 2);
  const thresholds = () => {
    try {
      return { ...DEFAULT_THRESHOLDS, ...(JSON.parse(localStorage.getItem("tl_perf_thresholds") || "{}") || {}) };
    } catch (_) {
      return { ...DEFAULT_THRESHOLDS };
    }
  };
  const healthStatus = ({ status = "", errorRate = 0, avgLatencyMs = 0, eventCount = 0 } = {}) => {
    const limits = thresholds();
    if (status === "error" || errorRate >= limits.errorErrorRate) return "error";
    if (errorRate >= limits.warningErrorRate || avgLatencyMs >= limits.warningLatencyMs || (!eventCount && status === "live")) return "warning";
    if (status === "stopped" || status === "paused") return status;
    return eventCount ? "healthy" : "idle";
  };

  const write = async (record) => {
    const persistence = desktopPersistence();
    if (!await usesDesktopSqlite() || !persistence?.writeDevelopmentRecords) {
      throw new Error("Performance Monitor richiede SQLite nell'app desktop.");
    }
    await persistence.writeDevelopmentRecords({ storeName: STORE, records: [record] });
    return record;
  };

  const list = async ({ workspaceId = "", boxId = "" } = {}) => {
    const persistence = desktopPersistence();
    if (!await usesDesktopSqlite() || !persistence?.readDevelopmentRecords) {
      throw new Error("Performance Monitor richiede SQLite nell'app desktop.");
    }
    return (await persistence.readDevelopmentRecords({ storeName: STORE, workspaceId }))
      .filter((record) => !boxId || record.boxId === boxId)
      .sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));
  };

  const summarizeWindow = ({ events = [], boxId = "", workspaceId = "global", stat = {}, sample = {} } = {}) => {
    const cutoff = Date.now() - WINDOW_MS;
    const scoped = events
      .filter((event) => (!workspaceId || event.workspaceId === workspaceId) && (!boxId || event.sourceNodeId === boxId || event.targetNodeId === boxId))
      .filter((event) => Date.parse(event.createdAt || event.updatedAt || 0) >= cutoff);
    const errors = scoped.filter((event) => event.status === "error" || /error/i.test(event.eventType || ""));
    const latencyValues = scoped.map((event) => safeNumber(event.latencyMs, 0)).filter((value) => value > 0);
    const totalBytes = scoped.reduce((sum, event) => sum + safeNumber(event.sizeBytes, 0), 0);
    const eventCount = safeNumber(stat.eventCount, scoped.length);
    const errorCount = safeNumber(stat.errorCount, errors.length);
    const lastPayloadBytes = safeNumber(sample.lastPayloadBytes || stat.lastPayloadBytes, 0);

    const summary = {
      schemaVersion: SCHEMA_VERSION,
      id: `perf_${workspaceId || "global"}_${boxId || "box"}`,
      workspaceId,
      boxId,
      status: normalizeText(stat.status || sample.status, eventCount ? "live" : "idle"),
      eventCount,
      errorCount,
      eventsPerSec: scoped.length / (WINDOW_MS / 1000),
      avgLatencyMs: latencyValues.length ? Math.round(latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length) : safeNumber(stat.lastLatencyMs, 0),
      lastLatencyMs: safeNumber(stat.lastLatencyMs, 0),
      errorRate: eventCount ? Math.min(100, (errorCount / eventCount) * 100) : 0,
      networkBytesPerMin: totalBytes || safeNumber(sample.networkBytesPerMin, 0),
      lastPayloadBytes,
      estimatedMemoryBytes: estimateMemoryBytes({ eventCount, errorCount, lastPayloadBytes }),
      windowMs: WINDOW_MS,
      updatedAt: now(),
    };
    return {
      ...summary,
      health: healthStatus(summary),
    };
  };

  const recordSample = async ({ workspaceId = "global", boxId = "", stat = {}, payload = {}, payloadText = "", events = [], status = "" } = {}) => {
    const lastPayloadBytes = payloadSize(payload, payloadText);
    const summary = summarizeWindow({
      workspaceId,
      boxId,
      stat: { ...stat, status: status || stat.status, lastPayloadBytes },
      sample: { lastPayloadBytes, networkBytesPerMin: lastPayloadBytes },
      events,
    });
    return write(summary);
  };

  const refreshFromEvents = async ({ workspaceId = "global", boxes = [] } = {}) => {
    const eventStore = window.TrackerLensEventLogStore;
    const events = eventStore?.listEvents ? await eventStore.listEvents() : [];
    return Promise.all((boxes || []).map((box) =>
      write(summarizeWindow({
        workspaceId,
        boxId: box.id,
        events,
        stat: {
          status: box.active === false || box.autoStart === false ? "stopped" : "idle",
          eventCount: events.filter((event) => event.sourceNodeId === box.id || event.targetNodeId === box.id).length,
          errorCount: events.filter((event) => (event.sourceNodeId === box.id || event.targetNodeId === box.id) && event.status === "error").length,
        },
      }))
    ));
  };

  return {
    SCHEMA_VERSION,
    DEFAULT_THRESHOLDS,
    STORE,
    ensureDb,
    list,
    recordSample,
    refreshFromEvents,
    healthStatus,
    summarizeWindow,
  };
})();
