# Current Focus

Purpose: active work and immediate next step.
Read when: always after `AI.md`.
Do not read when: never during development sessions.
Last updated: 2026-06-18.

## Active Area

Knowledge Runtime local-first baseline.

## Completed Sequence

1. Step 1: runtime/DB query tools.
2. Step 2: dependency-aware commands.
3. Step 3: more realistic endpoint research.
4. Step 4: real compound commands.

## Latest Completed Work

Flow Map library separation baseline is complete:

- global sidebar `Flow Map` now opens `libraryFlowmap.html` instead of a single workspace flow;
- `libraryFlowmap.html` lists local Flow Maps/workspace runtime graphs from IndexedDB and opens `flowMap.html?workspaceId=...`;
- Flow Map library sidebar filters by searchable categories, while sorting is in the result toolbar;
- Flow Map library cards include a confirmed delete action for the local flow, scoped runtime graph, channels, events, logs and connections;
- Flow Map library cards now use per-flow accent colors, a mini graph visual layer, metric pills and a card color picker persisted as UI metadata without changing flow `updatedAt`;
- Flow Map export from `flowMap.html` now downloads `.tlflow` bundles with embedded assets and runtime graph;
- Flow Map import accepts `.tlflow` while keeping `.tlworkspace` compatibility.

Flow Map canvas interaction refinement is complete:

- canvas wheel now pans naturally vertically and horizontally, with Shift-wheel as horizontal fallback for wheel mice;
- Ctrl-wheel zooms around the pointer and persists the viewport;
- Ctrl-wheel updates the canvas topbar zoom percentage without waiting for a remount;
- Shift-drag on a runtime node moves that node plus all downstream child nodes while preserving relative distances;
- Alt/Option-click on the node delete quick action deletes immediately without opening the confirmation dialog.
- The node delete dialog includes `Force Delete All Children` when downstream nodes exist, deleting the node plus every recursive child node.
- The Flow Map canvas now shows a red center marker at graph center and the edge canvas draw area is wider to avoid clipping long cables.
- Runtime Minimap now fits graph bounds instead of zoom perspective, shows the visible viewport in graph coordinates, updates live during canvas pan/zoom, supports dragging the viewport box and can be minimized with persisted state.
- Runtime Minimap node markers now inherit each node tone color for clearer graph orientation.
- Runtime Minimap node markers now use rectangular 2px-radius shapes sized from each node's rendered height after first paint, including collapsed nodes.
- Preview node payload header now keeps action buttons visible with long channel names, and newly created Preview nodes ignore cached events older than their creation/clear timestamp.
- Sample Test nodes now normalize numeric flow positions into CSS percent values before rendering, preventing stacked nodes until the first drag repaint.
- Knowledge Sample Test now uses a wider margin-aware layout with larger row spacing so generated nodes do not overlap the rows below.

Runtime contract base is complete:

- official Workspace/Page -> Flow -> Runtime Nodes -> Runtime Dependencies -> Connections -> Channels -> Events/Flow Logs contract documented;
- `core/runtime/runtime-contract.js` added as shared contract/schema/mapping helper;
- Flow Map runtime config now normalizes manifest `settingsSchema` before rendering config fields;
- Flow Map link creation now captures explicit connection mapping metadata;
- connection mapping is mirrored from `tl_connections.mapping` into runtime dependency metadata and shown in the edge inspector.
- Processor, AI Agent, Orchestrator Agent, Action and Storage runtimes now execute supported mapping modes before node-specific processing;
- mapping execution logs applied transforms and warnings in flow logs;
- `custom-transform` is intentionally stored but not executed until sandboxing is implemented.
- Preview nodes now display mapped payload, original payload and mapping warnings separately;
- Edge inspector mapping details now show mapping status and copy actions for transform/mapped payload;
- Existing runtime links can reopen `Connection Mapping` from Edge Inspector and persist mapping edits back to connection/dependency metadata;
- Flow Map topbar includes a `Mapping Test` diagnostic that creates Manual JSON -> Preview with a BTC `json-map` transform and emits a mapped test payload.
- Flow Map topbar includes a `Storage Test` diagnostic that creates Manual JSON -> Save DB Record, emits through EventBus and verifies the mapped record persisted to IndexedDB.
- Storage node Inspector now shows the latest persisted IndexedDB record payload with copy/refresh actions.

Step 5 base is complete:

- Flow Agent memory now stores typed, confirmed workspace facts after successful Apply;
- rename and duplicate actions write node alias memory;
- endpoint config updates write endpoint-choice memory only after validation and Apply;
- Flow Agent planning enriches runtime context with confirmed memory aliases;
- AI command normalization receives confirmed memory context;
- DevTools AI memory table exposes memory kind for inspection without flooding normal chat replies.
- DevTools AI memory table now has Pin/Unpin and Forget controls for stored memory records;
- AI memory cleanup preserves pinned short-memory records;
- AI memory dialog now surfaces text, tags and provenance parsed from memory `meta`.
- DevTools AI memory dialog and Pin/Forget controls were manually verified in the AI tab.
- Flow Agent now stores explicit user preference memory from prompts such as "ricordati che...";
- Flow Prompt Chat exposes focused memory recall diagnostics for rename/duplicate aliases.
- Step 5 preference memory was manually verified in Flow Map AI Chat.
- Flow Map Mapping Test and Storage Test were browser-verified successfully.
- Runtime error diagnosis memory now stores structured provenance: record id, node, cause, suggestion and fix hint.
- Endpoint research helper now follows OpenAPI/Swagger specs, accepts explicit spec/doc URLs from the prompt as first-class sources and returns discovery provenance to the Flow Agent UI.
- Flow Chat routes prompts such as "cerca endpoint da https://...openapi.json per ..." to non-mutating endpoint research instead of blocked config updates.
- Flow Chat rejects OpenAPI/Swagger/docs/schema URLs as selectable runtime endpoint candidates; those URLs are allowed only as research sources.
- Flow Chat can parse an explicit public OpenAPI JSON source directly in the browser when the same-origin endpoint research helper is unavailable.
- Endpoint candidate cards show `researchSource`; AI fallback candidates are explicitly warned in the UI.

Previous work:

Step 4 base is complete:

- local compound prompts are split into ordered steps;
- each step is planned against a simulated context that includes previous step effects;
- AI-normalized `{ actions: [...] }` and `{ steps: [...] }` use the same simulated context;
- compound steps carry `stepId`, `dependsOn`, `compoundIndex` and `compoundPrompt`;
- duplicated nodes get a planned runtime id so later steps can reference them;
- the safe executor reloads runtime after each mutation before validating the next step.

Example now supported:

```txt
rinomina REST API in Weather API e collega Weather API a Preview
duplica REST API come REST 2 e collega REST 2 a Preview
```

API/backend Step 3 auth integration is complete and locally verified:

- `profile.html` now loads `js/tl-api-client.js`;
- Profile view reads current user from `TrackerLensApi.client.user()` on load;
- Profile view login calls `TrackerLensApi.client.login()` and then refreshes current user;
- Profile view registration calls `TrackerLensApi.client.register()` and uses the returned authenticated user payload;
- Profile view logout calls `TrackerLensApi.client.logout()` and clears the local session state;
- login/logout requests continue to use the existing API client CSRF/cookie flow;
- `TrackerLensApi` now refreshes CSRF after login/register and retries mutating requests once after a `419`;
- backend `.env` is configured for local SQLite and local Sanctum stateful domains;
- dashboard mock data was intentionally left unchanged.

Verification notes:

- Backend `GET /sanctum/csrf-cookie` returns `204` with CSRF/session cookies on `127.0.0.1:8000`.
- Local auth HTTP flow verified: CSRF `204`, register `201`, current user `200`, logout `204`, current user after logout `401`.
- Backend `php artisan test` passes: 9 tests, 49 assertions.
- `node --check js/profileView.js` passes.
- `node --check js/popup.js` passes.
- `node --check js/tl-api-client.js` passes.
- `profile.html` and `js/tl-api-client.js` are served successfully from `http://127.0.0.1:5173`.
- In-app Browser `iab` was unavailable in this session, so visual verification could not be completed there.

API/backend Step 4 dashboard integration is complete on the local Profile view:

- `profile.html` remains the account/API dashboard surface for this step;
- legacy `dashboard.js`/`options.html` dashboard-builder code was intentionally left untouched;
- Profile stats now use `TrackerLensApi.client.dashboard.summary()` after authenticated current-user load;
- Profile recent activity now uses `TrackerLensApi.client.dashboard.activity()`;
- Profile system status now uses `TrackerLensApi.client.dashboard.systemStatus()`;
- profile fallback data remains visible when the user is not authenticated or the backend is unavailable.

Verification notes:

- `node --check js/profileView.js` passes.
- Local authenticated dashboard HTTP flow verified against `127.0.0.1:8000`: register `201`, summary `200`, activity `200`, system-status `200`, logout `204`.

Knowledge Runtime Step 1 base is in progress:

- Knowledge requirements audited after API/backend Step 4 was verified by the user;
- existing AI memory, runtime storage and provider registry were audited before adding new stores;
- Knowledge remains local-first, workspace-scoped and IndexedDB-based;
- `tl_knowledge_documents`, chunks, embeddings, entities, relations, queries, sources and metrics store constants were added;
- `core/runtime/knowledge-runtime.js` adds local stores, document creation, chunking, local deterministic vectors, cosine RAG search and EventBus integration;
- Flow Map now loads/syncs `TrackerLensKnowledgeRuntime` in page and worker contexts;
- Flow Map accepts `knowledge` as a first-class runtime type and exposes Knowledge palette nodes.
- Flow Map topbar now includes a `Sample Test` menu with Mapping Test, Storage Test and Knowledge Test; Knowledge Test creates a complete local sample graph: document source -> Document Store -> Chunk Processor -> Embedding Generator plus query source -> RAG Search -> Preview/AI Debugger, then emits sample document/query payloads.
- Flow Map Runtime Minimap is now always visible when nodes exist, supports click-to-jump and auto-centers on sample test result nodes after Mapping/Storage/Knowledge samples are created.
- Knowledge Test now cleans generated sample Knowledge records before rerun, and RAG Search deduplicates identical chunk text before building context.
- Knowledge chunking now reads `payload.document` from Document Store events and RAG Search filters serialized runtime/document envelopes from retrieval results.
- Knowledge Test now includes an `Embedding Preview`, explicit document/query emit channels and a hard check that a `tl_knowledge_embeddings` record is created before running RAG.
- Embedding Generator now resolves configured AI provider profiles for real embeddings (`ollama`, LM Studio/OpenAI-compatible) while keeping local hash embeddings as the offline fallback; RAG query vectors are generated with the same provider/model as the stored embeddings.
- Runtime node config save now parses JSON entered in the generic `Runtime Config` textarea and flattens accidental nested `config` JSON strings instead of persisting `metadata.config.config`.
- Knowledge node config dialogs now use Knowledge schema fields directly and no longer prepend the generic `Runtime Config` textarea.
- Knowledge Test now shows Embedding Generator -> RAG Search as an index-ready link; RAG Search ignores embedding events without a query and still runs retrieval only from `knowledge.search.query`.
- RAG Search now scopes retrieval to connected `knowledge.embedding.created` source nodes when present, using embedding `metadata.nodeId`; without an embedding link it falls back to workspace-scoped search.
- Local provider embeddings now use `api/ai-embedding-proxy.php` for localhost LM Studio/Ollama endpoints when served through PHP, avoiding browser CORS preflight failures while keeping remote providers direct.
- Knowledge Test now preserves edited `Knowledge Doc Source` and `Knowledge Query Source` JSON payloads on rerun instead of always emitting the Adam sample payload; manual-json Pulse payloads prefer `config.json` over stale `testPayload`.
- Knowledge sample indexing now uses a stable document id plus `collectionId=knowledge_sample_current`; chunking replaces old chunks/embeddings for that document so edited sample text does not mix with previous Adam sample chunks.
- AI Agent runtime now uses `api/ai-chat-proxy.php` for localhost LM Studio/Ollama chat endpoints when served through PHP, avoiding browser CORS preflight failures.
- Knowledge Test now connects RAG Context -> AI Answer node -> AI Answer Preview, with a prompt that answers from `payload.query` and `payload.context`.
- Knowledge sample AI Answer now disables automatic input history and memory context (`inputDataMode=off`, `memoryMode=none`) so unrelated workspace events such as old BTC tasks are not injected into the RAG answer prompt.
- Test run completion now forces canvas/topbar refresh and Knowledge runtime propagates `runId` to downstream events, preventing node play buttons from staying disabled after Knowledge/AI child execution completes.

## Next Logical Step

Knowledge Runtime Step 5: connect RAG context into AI Agent execution and expose provider/fallback metadata in inspector/debug panels.

Target behavior:

- `Knowledge Test` creates the full sample graph without manual wiring;
- manual/channel text becomes a workspace-scoped Knowledge document;
- chunks and local embeddings persist in IndexedDB;
- provider-backed embeddings persist when an AI provider profile is configured, with local fallback metadata when unavailable;
- RAG Search emits `knowledge.rag.context` for Preview and AI Agents;
- deleting nodes must not delete stored knowledge without explicit confirmation.

## Required Updates When Work Changes

- Update this file.
- Update `docs/ai/task-registry.md`.
- If architecture changes, update `docs/ai/decisions.md`.
