(function () {
  const trimSlash = (value = "") => String(value || "").replace(/\/+$/g, "");
  const joinUrl = (base = "", path = "") => {
    const cleanBase = trimSlash(base);
    const cleanPath = String(path || "").startsWith("/") ? String(path || "") : `/${path || ""}`;
    return `${cleanBase}${cleanPath}`;
  };
  const readCookie = (name = "") => {
    const prefix = `${encodeURIComponent(name)}=`;
    return (document.cookie || "")
      .split(";")
      .map((item) => item.trim())
      .find((item) => item.startsWith(prefix))
      ?.slice(prefix.length) || "";
  };
  const defaultBaseUrl = () => {
    const config = typeof tlConfig !== "undefined" ? tlConfig : {};
    if (/^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname || "")) {
      return trimSlash(config.API_LOCAL_URL || "http://127.0.0.1:8000");
    }
    return trimSlash(config.API_BASE_URL || config.SERVER_URL?.replace(/\/v1\/?$/i, "") || "https://api.trackerslens.com");
  };
  const normalizeApiError = async (response = null, fallback = "API request failed") => {
    const status = response?.status || 0;
    const payload = response ? await response.clone().json().catch(() => null) : null;
    const message = payload?.message || payload?.error || fallback;
    const error = new Error(message);
    error.status = status;
    error.payload = payload;
    error.errors = payload?.errors || null;
    return error;
  };
  const createClient = ({ baseUrl = defaultBaseUrl() } = {}) => {
    let csrfReady = false;
    const client = {
      get baseUrl() {
        return baseUrl;
      },
      setBaseUrl(nextBaseUrl = "") {
        baseUrl = trimSlash(nextBaseUrl || defaultBaseUrl());
        csrfReady = false;
        return baseUrl;
      },
      async csrf() {
        const response = await fetch(joinUrl(baseUrl, "/sanctum/csrf-cookie"), {
          method: "GET",
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (!response.ok && response.status !== 204) {
          throw await normalizeApiError(response, "CSRF initialization failed");
        }
        csrfReady = true;
        return true;
      },
      async request(path, options = {}) {
        const method = String(options.method || "GET").toUpperCase();
        const hasBody = options.body !== undefined && options.body !== null;
        const needsCsrf = options.csrf !== false && !["GET", "HEAD", "OPTIONS"].includes(method);
        if (needsCsrf && !csrfReady) await client.csrf();
        const xsrfToken = decodeURIComponent(readCookie("XSRF-TOKEN") || "");
        const response = await fetch(joinUrl(baseUrl, path), {
          ...options,
          method,
          credentials: "include",
          headers: {
            Accept: "application/json",
            ...(hasBody ? { "Content-Type": "application/json" } : {}),
            ...(xsrfToken ? { "X-XSRF-TOKEN": xsrfToken } : {}),
            ...(options.headers || {}),
          },
          body: hasBody && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body,
        });
        if (response.status === 419 && needsCsrf && options.retryOnCsrf !== false) {
          csrfReady = false;
          await client.csrf();
          return client.request(path, { ...options, retryOnCsrf: false });
        }
        if (response.status === 204) return null;
        if (!response.ok) throw await normalizeApiError(response);
        const contentType = response.headers.get("content-type") || "";
        return contentType.includes("application/json") ? response.json() : response.text();
      },
      register(payload = {}) {
        return client.request("/api/register", { method: "POST", body: payload }).finally(() => {
          csrfReady = false;
        });
      },
      login(payload = {}) {
        return client.request("/api/login", { method: "POST", body: payload }).finally(() => {
          csrfReady = false;
        });
      },
      logout() {
        return client.request("/api/logout", { method: "POST" });
      },
      user() {
        return client.request("/api/user");
      },
      dashboard: {
        summary: () => client.request("/api/dashboard/summary"),
        activity: () => client.request("/api/dashboard/activity"),
        systemStatus: () => client.request("/api/dashboard/system-status"),
      },
    };
    return client;
  };

  window.TrackerLensApi = {
    createClient,
    client: createClient(),
    normalizeApiError,
  };
}());
