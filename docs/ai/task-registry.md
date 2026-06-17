# Task Registry

Purpose: compact task status overview.
Read when: changing task status or deciding next work.
Do not read when: doing a local implementation already scoped by `current-focus.md`.
Last updated: 2026-06-16.

## Active

### TASK-027: Knowledge Runtime

Status: Step 4 local Knowledge/RAG baseline implemented; Step 5 AI Agent RAG consumption next.
Priority: High.
Risk: Medium/High because it adds a first-class runtime type and new local persistence.

Current sub-steps:

- Step 1 Knowledge stores and models: base implemented with local IndexedDB stores.
- Step 2 Document Store + Chunk Processor: base runtime handlers implemented; topbar Knowledge Test sample added and user-verified.
- Step 3 Embedding Generator + cosine similarity: local deterministic vectors implemented and provider-backed embeddings wired through existing AI provider profiles with local fallback.
- Step 4 RAG Search node: base local search implemented and user-verified with clean single-result sample context.
- Step 5 AI Agent consumes RAG context: next after runtime verification.
- Step 6 Knowledge Graph base: palette/store placeholders present, extraction/graph execution pending.
- Step 7 Knowledge inspector and analytics: pending.

Main files:

- `core/runtime/knowledge-runtime.js`
- `js/TlConfig.js`
- `flowMap.html`
- `core/runtime/runtime-worker.js`
- `core/runtime/runtime-manifest.js`
- `core/runtime/runtime-graph-store.js`
- `core/runtime/runtime-graph-model.js`
- `js/flow-map/flowMapState.js`
- `js/flow-map/flowMapNodeBuilder.js`
- `js/flow-map/flowMapRuntimeNodes.js`
- `js/flow-map/flowMapRuntimeTests.js`
- `docs/ai/runtime/stores.md`
- `docs/ai/runtime/channels.md`

### TASK-026: API Backend Integration

Status: Step 4 profile dashboard integration complete and user-verified against authenticated backend dashboard endpoints.
Priority: High.
Risk: Medium because it crosses the frontend extension/runtime and Laravel API boundary.

Current sub-steps:

- Step 1 baseline API contract and health check: complete.
- Step 2 frontend API client contract: complete.
- Step 3 auth integration: complete, local CSRF/register/current-user/logout flow verified.
- Step 4 dashboard integration: complete on Profile view; summary/activity/system-status use backend after auth with local fallback.
- Step 5 persistent runtime/workspace API design: next unless Knowledge Run is prioritized first.

Main files:

- `/Users/cmalleux/Sites/trackersLens-api/routes/api.php`
- `/Users/cmalleux/Sites/trackersLens-api/docs/api-contract.md`
- `/Users/cmalleux/Sites/trackersLens-api/docs/laravel-backend-plan.md`
- `/Users/cmalleux/Sites/trackersLens-api/tests/Feature/AuthApiTest.php`
- `/Users/cmalleux/Sites/trackersLens-api/tests/Feature/DashboardApiTest.php`
- `js/tl-api-client.js`
- `js/TlConfig.js`
- `profile.html`
- `js/profileView.js`
- `js/popup.js`
- `docs/ai/api-backend.md`

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
- Step 3 endpoint research more realistic: complete base, OpenAPI provenance, explicit spec URL seed, Flow Chat research routing, spec-as-endpoint rejection, browser OpenAPI JSON fallback and AI fallback warning included.
- Step 4 compound commands: complete base.
- Step 5 workspace memory: complete, preference capture, alias recall diagnostics and runtime error provenance included.

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

- Endpoint research hardening follow-up: browser-test explicit OpenAPI discovery from Flow Map AI Chat after routing fix and add provider scoring only from fetched documentation.
- Background/service-worker persistence when pages are closed.
- Cloud sync, if explicitly prioritized.
- Workspace templates and AI-generated workspaces after runtime core is stable.
