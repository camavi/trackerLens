window.TrackerLensAppRouter = (() => {
  const routes = new Map();
  let active = null;
  let outlet = null;
  let started = false;
  const normalizePath = (value = window.location.pathname) => {
    const path = String(value || "/").replace(/\\/g, "/");
    // Electron file:// URLs expose an absolute filesystem pathname, while
    // the application route contract is intentionally entry-point based.
    if (/\.html$/i.test(path)) {
      return `/${path.split("/").pop()}`;
    }
    return path.startsWith("/") ? path : `/${path}`;
  };

  const currentLocation = () => ({
    path: normalizePath(),
    query: new URLSearchParams(window.location.search),
    hash: window.location.hash || "",
  });

  const resolve = (path = normalizePath()) => routes.get(normalizePath(path)) || null;

  const disposeActive = async () => {
    if (!active) return;
    const previous = active;
    active = null;
    await previous.view.dispose?.({ outlet, location: previous.location });
  };

  const render = async () => {
    if (!outlet) throw new Error("TrackerLensAppRouter requires an outlet before rendering.");
    const location = currentLocation();
    const view = resolve(location.path);
    if (!view) throw new Error(`No Trackers Lens route is registered for ${location.path}.`);

    await disposeActive();
    try {
      await view.mount({ outlet, location });
      active = { view, location };
    } catch (error) {
      throw error;
    }
  };

  const register = (path, view) => {
    if (!view || typeof view.mount !== "function") throw new TypeError("A route view must provide mount(context).");
    routes.set(normalizePath(path), view);
    return api;
  };

  const navigate = async (target, { replace = false } = {}) => {
    const url = new URL(target, window.location.href);
    if (url.origin !== window.location.origin) {
      window.location.assign(url.toString());
      return;
    }
    window.history[replace ? "replaceState" : "pushState"]({}, "", `${url.pathname}${url.search}${url.hash}`);
    await render();
  };

  const start = async (nextOutlet) => {
    if (started) return;
    if (!(nextOutlet instanceof Element)) throw new TypeError("TrackerLensAppRouter.start requires an Element outlet.");
    outlet = nextOutlet;
    started = true;
    window.addEventListener("popstate", () => {
      void render();
    });
    await render();
  };

  const status = () => ({
    renderer: "shell",
    started,
    activePath: active?.location?.path || "",
    currentPath: normalizePath(),
    registeredRoutes: Array.from(routes.keys()),
  });

  const api = { register, navigate, start, render, resolve, currentLocation, status };
  return api;
})();
