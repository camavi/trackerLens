# Task Registry

Purpose: compact task status overview.
Read when: changing task status or deciding next work.
Do not read when: doing a local implementation already scoped by `current-focus.md`.
Last updated: 2026-06-11.

## Active

### TASK-024: Flow Map Prompt Chat Node Creator

Status: Complete, still active as the hardening surface.
Priority: High.
Risk: Medium/High because it touches planner, runtime graph and command execution.

Current sub-steps:

- Step 1 runtime/DB query tools: complete.
- Step 2 dependency-aware commands: complete.
- Step 3 endpoint research more realistic: complete base.
- Step 4 compound commands: complete base.
- Step 5 workspace memory: complete base.

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

- Step 5 hardening: forget/pin memory controls, explicit preference capture and alias recall tests.
- Endpoint research hardening with OpenAPI/provider-specific parsing.
- Background/service-worker persistence when pages are closed.
- Cloud sync, if explicitly prioritized.
- Workspace templates and AI-generated workspaces after runtime core is stable.
