const assert = require("node:assert/strict");
const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");
const { CustomNodeSandboxBroker } = require("../core/desktop/custom-node-sandbox-broker.cjs");
const { CustomNodeElectronRunner } = require("../core/desktop/custom-node-electron-runner.cjs");

const projectRoot = path.resolve(__dirname, "..");

const fail = (error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
  app.quit();
};

app.whenReady().then(async () => {
  const broker = new CustomNodeSandboxBroker();
  const runner = new CustomNodeElectronRunner({
    BrowserWindow,
    broker,
    runnerPage: path.join(projectRoot, "electron", "custom-node-sandbox-runner.html"),
    runnerPreload: path.join(projectRoot, "electron", "custom-node-sandbox-preload.cjs"),
    configureSession: (partition) => {
      const sandboxSession = require("electron").session.fromPartition(partition);
      sandboxSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      sandboxSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] }, (_details, callback) => callback({ cancel: true }));
    }
  });
  ipcMain.handle("trackers-custom-node-sandbox:message", (event, message) => runner.receive({ senderId: event.sender.id, message }));
  const packageRecord = {
    packageId: "custom.sandbox-fixture",
    version: "1.0.0",
    archive: { sha256: "e".repeat(64) },
    manifest: { outputs: ["output"], permissions: {}, runtime: { mode: "sandboxed" } },
    permissions: {},
    runtimeExecution: "sandboxed"
  };
  const request = broker.open({ nodeId: "fixture_node", packageRecord, inputs: { input: { value: 7 } } });
  try {
    await runner.launch({
      request,
      source: "export async function run({ input, emit, log }) { await log('fixture started', { safe: true }); await emit('output', { value: input.input.value + 1 }); return { done: true }; }"
    });
    const terminal = await Promise.race([
      broker.wait(request.executionId),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Custom Node sandbox fixture timed out")), 10000))
    ]);
    const trace = broker.get(request.executionId);
    assert.equal(terminal.status, "success");
    assert.deepEqual(trace.events.filter((event) => event.kind === "emit").map((event) => event.data), [{ value: 8 }]);
    assert.equal(trace.events.some((event) => event.kind === "log" && event.message === "fixture started"), true);
    console.log("Custom Node Electron sandbox test passed.");
  } finally {
    runner.close(request.executionId);
    await app.quit();
  }
}).catch(fail);
