# Task Registry

Purpose: compact task status overview.
Read when: changing task status or deciding next work.
Do not read when: doing a local implementation already scoped by `current-focus.md`.
Last updated: 2026-06-12.

## Active

### TASK-025: Runtime Contract And Schema Config

Status: Complete base, mapped Preview/Storage diagnostics browser-verified.
Priority: High.
Risk: Medium/High because it defines Workspace/Page persistence boundaries and connection mapping.

Current sub-steps:

- Official runtime contract documentation: complete.
- Shared runtime contract helper: complete.
- Flow Map schema normalization for config forms: complete base.
- Connection mapping metadata capture/editing: complete base.
- Runtime execution of supported mapping modes: complete base.
- UI/runtime regression tests for mapped flows: Preview and Storage diagnostics complete and browser-verified.
- Storage Inspector latest persisted record: complete base.

Main files:

- `core/runtime/runtime-contract.js`
- `flowMap.html`
- `js/flow-map/flowMapRuntimeNodes.js`
- `js/flow-map/flowMapRuntimeTests.js`
- `js/flow-map/flowMapState.js`
- `js/flow-map/flowMapCanvasInspector.js`
- `core/runtime/runtime-graph-store.js`
- `docs/ai/runtime/contract.md`

### TASK-024: Flow Map Prompt Chat Node Creator

Status: Complete, Step 5 workspace memory closed.
Priority: High.
Risk: Medium/High because it touches planner, runtime graph and command execution.

Current sub-steps:

- Step 1 runtime/DB query tools: complete.
- Step 2 dependency-aware commands: complete.
- Step 3 endpoint research more realistic: complete base.
- Step 4 compound commands: complete base.
- Step 5 workspace memory: complete, preference capture and alias recall diagnostics included.

Main files:

- `flowMap.html`
- `js/flow-map/flowMapPromptChat.js`
- `js/flow-map/flowMapCanvasInspector.js`
- `js/flow-map/flowMapRuntimeTests.js`
- `core/runtime/action-runtime.js`
- `api/endpoint-research.php`
- `css/flow-map/prompt-chat.css`

## Completed Major Runtime Tasks

- Runtime graph foundation.
- Event bus and channel registry.
- Sandbox isolation.
- Workspace export/import format base.
- Box versioning.
- Dependency system.
- AI memory base.
- Local AI provider base.
- Marketplace trust scanner base.
- Box performance monitor base.
- Offline-first base.
- Internal package system.
- DevTools runtime.
- Time Travel data.
- AI Runtime Agent architecture editor.

## Planned / Future

- Step 5 follow-up: runtime error diagnosis provenance hardening.
- Endpoint research hardening with OpenAPI/provider-specific parsing.
- Background/service-worker persistence when pages are closed.
- Cloud sync, if explicitly prioritized.
- Workspace templates and AI-generated workspaces after runtime core is stable.
