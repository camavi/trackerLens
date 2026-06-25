# Task Registry

Purpose: compact task status overview.
Read when: changing task status or deciding next work.
Do not read when: doing a local implementation already scoped by `current-focus.md`.
Last updated: 2026-06-23.

## Active

### TASK-027: Knowledge Runtime

Status: Step 8 Document Store upload UX implemented; browser verification pending.
Priority: High.
Risk: Medium/High because it adds a first-class runtime type and new local persistence.

Current sub-steps:

- Step 1 Knowledge stores and models: base implemented with local IndexedDB stores.
- Step 2 Document Store + Chunk Processor: base runtime handlers implemented; topbar Knowledge Test sample added and user-verified.
- Step 3 Embedding Generator + cosine similarity: local deterministic vectors implemented and provider-backed embeddings wired through existing AI provider profiles with local fallback.
- Step 4 RAG Search node: base local search implemented and user-verified with clean single-result sample context.
- Step 5 AI Agent consumes RAG context: first-class `knowledge.rag.context` prompt/job/result metadata implemented; Flow Map AI RAG Debug inspector panel added; browser verification pending.
- Step 6 Knowledge Graph base: local Entity Extractor persists entities/relations, emits entity/relation channels, and Knowledge Graph emits local snapshots; inspector/analytics pending.
- Step 7 Knowledge inspector and analytics: Flow Map `Knowledge Graph Debug` inspector panel and `View Graph` dialog added for local entity/relation/snapshot inspection; broader analytics pending.
- Step 8 Document upload/import UX: Document Store/Text Knowledge/Memory nodes expose `Upload Document`, upload progress, document-count `Documents` dialog and `Knowledge Document Debug`; `.txt`, `.md`, `.json` and `.csv` uploads emit local EventBus document payloads, surface uploaded document/chunk metadata in inspector, support confirmed document/delete-derived-record cleanup, and preserve upload/replay scope through graph snapshots; browser verification pending.

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

- Flow Map library split baseline: sidebar Flow Map route opens `libraryFlowmap.html`; local Flow Maps can be created from a CMSwift metadata dialog, listed/opened/imported/exported/deleted after confirmation; sidebar categories are searchable and sorting lives in the result toolbar; cards have per-flow configurable UI accent colors and a richer runtime-graph visual treatment; Flow Map download format is `.tlflow`, Flow Map page records are filtered out of `library.html`, and legacy imports from `libraryFlowmap.html` are marked as Flow Map.
- Asset library card polish: `library.html` cards use modern gradient/accent styling, single-line titles, UI-only color metadata, no workspace Flow action and confirmed local delete.
- Workspace Lens ownership pass: Lens templates and saved boxLens insertion now live in separate collapsible sections in `editorWorkspace.html`; Flow Map palette and local planner no longer create Lens nodes.
- Universal box editor dialog: Workspace, Flow Map, Library and Database Explorer create/edit boxLens and boxTracker through a shared CMSwift dialog (`js/boxEditorDialog.js`) without iframe navigation; legacy box editor pages/CSS/JS were removed, and tracker test execution is shared through `core/runtime/tracker-test-runner.js`.
- Workspace editor space pass: right properties column is now a fixed drawer opened from workspace edit, and the mini navigator is a right-side fixed canvas overlay with persisted minimize/expand state.
- Flow Map composition baseline: `Flow In`, `Flow Out` and embedded `Flow Map` nodes are available; embedded Flow Maps require at least one Flow In/Out port and boxLens workspace links can target composable Flow Maps as hidden sources.
- Flow Map boundary port editor: `Flow In`/`Flow Out` nodes now manage typed custom ports through an Add/Edit dialog, render with gateway-specific cards and feed configured port definitions into embedded Flow Map nodes and workspace boxLens links.
- Flow Map default boundary bootstrap: creating a Flow Map from the library now persists active `Flow In` and `Flow Out` runtime nodes with default typed ports and initial canvas positions.
- Flow Map embed validation: the Flow Map node picker lists all available Flow Maps, requires an explicit selection and `Inserisci` confirmation, then revalidates the selected graph and rejects maps without any `Flow In` or `Flow Out` node.
- Embedded Flow Map alias sync: source `Flow In` ports map to left-side inputs and source `Flow Out` ports map to right-side outputs; names, types, title and version refresh from the source while generic `all` ports remain available, and deleting the alias never deletes its source Flow Map.
- Embedded Flow Map read-only preview: alias body action opens a minimal fitted graph dialog showing current source nodes by name/type and their connections without full node bodies or editing controls.
- Flow Map canvas interaction refinement: natural wheel pan, Ctrl-wheel zoom with live percentage, center marker, wider cable canvas, graph-fit minimap with live draggable viewport and minimize control, Shift-drag downstream node groups and Alt/Option-click quick delete.
- Flow Map minimap color pass: runtime minimap markers inherit each node tone color.
- Flow Map minimap shape pass: minimap markers are rectangular and scale to rendered node height after first paint, including collapsed nodes.
- Flow Map recursive delete action: node delete dialog can force-delete the selected node plus every downstream child node.
- Flow Map Preview polish: long payload headers preserve copy/clear actions, and newly created Preview nodes start clean instead of replaying older cached events.
- Flow Map Sample Test render fix: numeric flow positions normalize to CSS percent coordinates so generated nodes render in place immediately.
- Flow Map Knowledge Sample layout spacing: generated sample nodes use margin-aware columns and taller rows to avoid overlap.
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
