# File Map

Purpose: locate implementation ownership quickly.
Read when: deciding which files to inspect.
Do not read when: file scope is already obvious.
Last updated: 2026-06-11.

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
