# File Map

Purpose: locate implementation ownership quickly.
Read when: deciding which files to inspect.
Do not read when: file scope is already obvious.
Last updated: 2026-08-25.

## Flow Map

- `flowMap.html`: Flow Map page shell and script loading.
- `js/flowMapView.js`: main Flow Map view orchestration.
- `js/flow-map/flowMapState.js`: shared state.
- `js/flow-map/flowMapPromptChat.js`: AI Flow Chat, query tools, planner, safe command plans.
- `js/flow-map/flowMapRuntimeTests.js`: Pulse/Live Test and runtime test logging.
- `js/flow-map/flowMapCanvasInspector.js`: node/edge inspector and canvas UI.
- `js/flow-map/flowMapRuntimeNodes.js`: node rendering/model helpers.
- `js/flow-map/flowMapInteractions.js`: graph interactions.
- `js/flow-map/flowMapNodeBuilder.js`: node builder.
- `css/flowMap.css` and `css/flow-map/*.css`: Flow Map visual system.

## Runtime Core

- `core/runtime/event-bus.js`
- `core/runtime/channel-registry.js`
- `core/runtime/dependency-manager.js`
- `core/runtime/runtime-graph-store.js`
- `core/runtime/runtime-snapshot-store.js`
- `core/runtime/runtime-graph-model.js`
- `core/runtime/graph-engine.js`
- `core/runtime/runtime-worker-controller.js`
- `core/runtime/agent-runtime.js`
- `core/runtime/processor-runtime.js`
- `core/runtime/action-runtime.js`
- `core/runtime/storage-runtime.js`
- `core/runtime/ai-agent-runtime.js`
- `core/runtime/orchestrator-agent-runtime.js`

## AI Runtime

- `ai.html`
- `js/aiRuntimeCenter.js`
- `js/tl-ai-runtime-store.js`
- `js/tl-ai-agent-editor.js`
- `css/aiRuntimeCenter.css`
- `css/tl-ai-agent-editor.css`

## Endpoint Research

- `api/endpoint-research.php`: optional same-origin local helper.
- `api/ai-embedding-proxy.php`: optional same-origin local helper for localhost embedding providers that do not return browser CORS headers.
- `api/ai-chat-proxy.php`: optional same-origin local helper for localhost chat providers that do not return browser CORS headers.
- `js/flow-map/flowMapPromptChat.js`: client integration and candidate UI.

## Shared UI / App

- `CMSwift/`: UI framework.
- `js/tl-sidebar.js`, `css/tl-sidebar.css`: standard sidebar.
- `js/TlConfig.js`: store constants and app config.
- SQLite status diagnostics are read directly from the restricted TL Core preload bridge by `js/settingsView.js`.

## Electron Desktop Shell

- `package.json`: Electron scripts and development dependency.
- `electron/main.cjs`: desktop lifecycle, secure BrowserWindow, CSP, validated IPC and navigation policy.
- `electron/preload.cjs`: minimal renderer bridge; it must not expose Node.js, filesystem or unrestricted IPC.
- `core/desktop/tl-core.cjs`: Electron-independent allow-listed desktop command boundary.
- `core/desktop/desktop-persistence.cjs`: Core-owned SQLite schema and allow-listed collection operations.
- `core/runtime/node-execution-contract.js`: versioned multi-runtime manifest/request/result normalization.
- `core/runtime/runtime-manager.js`: runtime registry, JavaScript execution routing and health status.
- `core/desktop/managed-python-runtime.cjs`: managed Python POC process adapter.
- `runtimes/python/tl_python_worker.py`: standard-library JSON Lines POC worker.
- `runtimes/python/tl_python_sdk.py`: minimal capability-scoped Python node SDK.
- `core/runtime/processor-runtime.js`: owns the Flow Map `Python Test` processor bridge and its Event Bus output/error/status events.
- `test/tl-core.test.cjs`: unit tests for the desktop boundary.
- `test/electron-preload-smoke.cjs`: Electron renderer smoke test for the sandboxed preload bridge.
- `test/python-poc.test.cjs`: Python POC protocol tests.
- `docs/ai/runtime/desktop-persistence.md`: SQLite-only desktop persistence contract.
