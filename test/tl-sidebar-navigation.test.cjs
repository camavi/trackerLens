const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

test("internal sidebar navigation consumes the request without legacy document navigation", () => {
  const navigations = [];
  const assigned = [];
  const storage = new Map();
  const window = {
    location: {
      href: "file:///Users/example/trackerLens/app.html",
      assign: (url) => assigned.push(url),
    },
    addEventListener: () => {},
    TrackerLensAppRouter: {
      resolve: (pathname) => pathname.endsWith("/flowMap.html") ? {} : null,
      navigate: (target) => navigations.push(target),
      status: () => ({ renderer: "shell" }),
    },
  };
  const context = vm.createContext({
    window,
    URL,
    JSON,
    Date,
    console: { info: () => {} },
    sessionStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
  });
  const source = fs.readFileSync(path.join(__dirname, "..", "js", "tl-sidebar.js"), "utf8");
  vm.runInContext(source, context, { filename: "tl-sidebar.js" });

  assert.equal(window.TrackerLensSidebar.navigate("flowMap.html?workspaceId=demo"), true);
  assert.equal(navigations.length, 1);
  assert.deepEqual(assigned, []);
});
