window.TrackerLensTrackerTestRunner = (() => {
  const parseHeadersText = (value = "") => {
    const text = String(value || "").trim();
    if (!text) return {};
    if (text.startsWith("{")) {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Headers JSON non valido.");
      return parsed;
    }
    return text.split(/\r?\n/).reduce((headers, line) => {
      const separator = line.indexOf(":");
      if (separator <= 0) return headers;
      const key = line.slice(0, separator).trim();
      const headerValue = line.slice(separator + 1).trim();
      if (key) headers[key] = headerValue;
      return headers;
    }, {});
  };

  const parseBodyText = (value = "") => {
    const text = String(value || "").trim();
    if (!text) return undefined;
    if (text.startsWith("{") || text.startsWith("[")) return JSON.parse(text);
    return text;
  };

  const buildUrlWithQuery = (endpoint, query = "") => {
    const text = String(query || "").trim();
    if (!text) return endpoint;
    if (text.startsWith("?") || text.includes("=")) {
      const separator = String(endpoint || "").includes("?") ? "&" : "?";
      return `${endpoint}${separator}${text.replace(/^\?/, "")}`;
    }
    return endpoint;
  };

  const parseFeedPayload = (xmlText) => {
    const parser = new DOMParser();
    const xml = parser.parseFromString(String(xmlText || ""), "application/xml");
    if (xml.querySelector("parsererror")) throw new Error("Feed RSS/Atom non valido.");
    const items = [...xml.querySelectorAll("item, entry")].slice(0, 10).map((node) => ({
      title: node.querySelector("title")?.textContent?.trim() || "",
      link: node.querySelector("link")?.getAttribute("href") || node.querySelector("link")?.textContent?.trim() || "",
      publishedAt: node.querySelector("pubDate, published, updated")?.textContent?.trim() || "",
      summary: node.querySelector("description, summary, content")?.textContent?.trim() || "",
    }));
    return {
      title: xml.querySelector("channel > title, feed > title")?.textContent?.trim() || "",
      items,
    };
  };

  const parseResponsePayload = async (response, source) => {
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 180) || response.statusText}`);
    if (source === "rss" || contentType.includes("xml") || contentType.includes("rss") || contentType.includes("atom")) return parseFeedPayload(text);
    if (contentType.includes("json")) return JSON.parse(text);
    try {
      return JSON.parse(text);
    } catch (_) {
      return { text };
    }
  };

  const parseWebSocketMessage = (data) => {
    if (typeof data !== "string") return { data: String(data) };
    try {
      return JSON.parse(data);
    } catch (_) {
      return { text: data };
    }
  };

  const getPathValue = (payload, path) =>
    String(path || "").split(".").reduce((value, key) => {
      if (value && Object.prototype.hasOwnProperty.call(value, key)) return value[key];
      return undefined;
    }, payload);

  const setPathValue = (payload, path, value) => {
    const keys = String(path || "").split(".").filter(Boolean);
    if (!keys.length) return;
    const lastKey = keys.pop();
    const target = keys.reduce((node, key) => {
      if (!node[key] || typeof node[key] !== "object") node[key] = {};
      return node[key];
    }, payload);
    target[lastKey] = value;
  };

  const applyTransformRules = (payload, transformText = "", started = performance.now(), tracker = {}) => {
    const mapped = payload && typeof payload === "object" && !Array.isArray(payload) ? { ...payload } : { value: payload };
    String(transformText || "").split(/\r?\n/).forEach((line) => {
      const match = line.match(/^\s*([^#][^>-]*?)\s*(?:->|=>)\s*([A-Za-z0-9_.-]+)\s*$/);
      if (!match) return;
      const value = getPathValue(payload, match[1].trim());
      if (value !== undefined) setPathValue(mapped, match[2].trim(), value);
    });
    return {
      ...mapped,
      _trackerTest: {
        receivedAt: new Date().toISOString(),
        latencyMs: Math.max(1, Math.round(performance.now() - started)),
        source: tracker.source || tracker.trackerType || "manual",
        endpoint: tracker.endpoint || "",
      },
    };
  };

  const executeTrackerTest = async (tracker = {}, { sampleOutput = {}, started = performance.now() } = {}) => {
    const source = tracker.source || tracker.trackerType || "manual";
    if (!tracker.endpoint && !["manual", "script"].includes(source)) throw new Error("URL / Sorgente mancante.");
    if (source === "manual") {
      const queryPayload = parseBodyText(tracker.query || "");
      return applyTransformRules(queryPayload === undefined ? sampleOutput : queryPayload, tracker.transformText, started, tracker);
    }
    if (source === "script") throw new Error("Runner script non implementato in questa pagina.");
    if (source === "mcp") throw new Error("Runner MCP non implementato in questa pagina.");
    if (source === "websocket") {
      return new Promise((resolve, reject) => {
        const timeoutMs = Math.max(1, Number(tracker.timeout) || 10) * 1000;
        const socket = new WebSocket(tracker.endpoint);
        const timer = setTimeout(() => {
          socket.close();
          reject(new Error("Timeout WebSocket: nessun messaggio ricevuto."));
        }, timeoutMs);
        socket.onopen = () => {
          const query = String(tracker.query || "").trim();
          if (query) socket.send(query);
        };
        socket.onmessage = (event) => {
          clearTimeout(timer);
          const payload = applyTransformRules(parseWebSocketMessage(event.data), tracker.transformText, started, tracker);
          socket.close();
          resolve(payload);
        };
        socket.onerror = () => {
          clearTimeout(timer);
          reject(new Error("Errore connessione WebSocket."));
        };
      });
    }

    const controller = new AbortController();
    const timeoutMs = Math.max(1, Number(tracker.timeout) || 10) * 1000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const method = String(tracker.method || "GET").toUpperCase();
    const headers = parseHeadersText(tracker.headersText);
    const bodyValue = method === "GET" || method === "HEAD" ? undefined : parseBodyText(tracker.query || "");
    if (bodyValue && typeof bodyValue === "object" && !headers["Content-Type"] && !headers["content-type"]) headers["Content-Type"] = "application/json";
    try {
      const response = await fetch(buildUrlWithQuery(tracker.endpoint, method === "GET" ? tracker.query || "" : ""), {
        method,
        headers,
        signal: controller.signal,
        body: bodyValue && typeof bodyValue === "object" ? JSON.stringify(bodyValue) : bodyValue,
      });
      return applyTransformRules(await parseResponsePayload(response, source), tracker.transformText, started, tracker);
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    parseHeadersText,
    parseBodyText,
    buildUrlWithQuery,
    parseFeedPayload,
    parseResponsePayload,
    parseWebSocketMessage,
    applyTransformRules,
    executeTrackerTest,
  };
})();
