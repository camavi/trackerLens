const assert = require("node:assert/strict");
const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");

const projectRoot = path.resolve(__dirname, "..");
const preloadPath = path.join(projectRoot, "electron", "preload.cjs");
const flowMapPage = path.join(projectRoot, "flowMap.html");
const settingsPage = path.join(projectRoot, "settings.html");
const databasePage = path.join(projectRoot, "database.html");

ipcMain.handle("trackers-core:request", (_event, command) => {
  if (command === "desktop.persistence.getStatus") {
    return { owner: "tl-core", mode: "desktop-sqlite", sqlite: { exists: true } };
  }
  if (command === "desktop.persistence.listDevelopmentStores") {
    return [{ name: "tl_pages", recordCount: 1 }];
  }
  if (command === "desktop.persistence.readDevelopmentRecords") {
    return [{ id: "page-smoke", name: "Smoke workspace" }];
  }
  throw new Error(`Unexpected smoke-test command: ${command}`);
});

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  try {
    await window.loadFile(flowMapPage);
    await window.loadFile(settingsPage);
    await window.loadFile(databasePage);
    const bridge = await window.webContents.executeJavaScript(`
      Promise.all([
        window.trackers?.desktop?.persistence?.getStatus?.(),
        window.trackersDesktop?.getPersistenceStatus?.(),
        window.trackers?.desktop?.persistence?.listDevelopmentStores?.(),
        window.trackers?.desktop?.persistence?.readDevelopmentRecords?.({ storeName: "tl_pages" })
      ])
    `);
    assert.equal(bridge[0]?.mode, "desktop-sqlite");
    assert.equal(bridge[1]?.owner, "tl-core");
    assert.deepEqual(bridge[2], [{ name: "tl_pages", recordCount: 1 }]);
    assert.deepEqual(bridge[3], [{ id: "page-smoke", name: "Smoke workspace" }]);
    process.stdout.write("Electron preload smoke test passed.\n");
  } finally {
    window.destroy();
    app.quit();
  }
}).catch((error) => {
  console.error(error);
  app.quit();
  process.exitCode = 1;
});
