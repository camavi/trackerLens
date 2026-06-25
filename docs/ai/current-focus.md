# Current Focus

Purpose: active work and immediate next step.
Read when: always after `AI.md`.
Do not read when: never during development sessions.
Last updated: 2026-06-23.

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
- `libraryFlowmap.html` lists local `.tlflow` Flow Maps from IndexedDB and opens `flowMap.html?workspaceId=...`;
- Flow Map library sidebar filters by searchable categories, while sorting is in the result toolbar;
- Flow Map library `Nuovo Flow Map` opens a CMSwift creation dialog for title, description, category, color and version, then creates dedicated `tl_pages` and `tl_flows` records;
- Flow Map library cards include a confirmed delete action for the local flow, scoped runtime graph, channels, events, logs and connections;
- Flow Map library cards now use per-flow accent colors, a mini graph visual layer, metric pills and a card color picker persisted as UI metadata without changing flow `updatedAt`;
- Flow Map export from `flowMap.html` now downloads `.tlflow` bundles with embedded assets and runtime graph;
- Flow Map import accepts `.tlflow` while keeping `.tlworkspace` compatibility.
- Flow Map and asset library environments are separated: `library.html` filters out Flow Map page records, while `libraryFlowmap.html` lists only `.tlflow`/flowmap-marked records and imports legacy bundles as Flow Map when invoked there.
- Asset library cards now have a modern gradient/accent treatment, single-line left-aligned titles, UI-only color picker, no workspace Flow button and confirmed delete actions.
- Workspace editor owns Lens insertion: Flow Map no longer exposes Lens palette items, while `editorWorkspace.html` shows draggable/clickable Lens templates plus saved boxLens assets in separate collapsible left-panel sections with edit actions.
- Box editor dialog baseline: `boxEditorDialog.js` now provides a CMSwift, iframe-free universal settings dialog for creating/editing boxLens and boxTracker assets from Workspace and Flow Map surfaces, with local `tl_widgets` persistence and draft runtime promotion support.
- Workspace editor layout now keeps workspace properties in a fixed drawer opened from the title edit button, removes the right grid column and keeps the mini navigator as a right-side fixed overlay with persisted minimize/expand state.
- Flow Map composition baseline adds `Flow In`, `Flow Out` and embedded `Flow Map` palette nodes; embedded Flow Maps can be inserted only when the target Flow Map exposes at least one Flow In/Out port, and workspace boxLens linking can now use composable Flow Maps as hidden sources alongside boxTrackers.
- Flow Map boundary ports are configurable: `Flow In` and `Flow Out` nodes expose an Add/Edit port dialog with typed ports (`string`, `int`, `float`, `object`, `array`, `bool`), render as dedicated gateway cards, place Flow In ports on the right and Flow Out ports on the left, and embedded/workspace Flow Map links inherit the configured port definitions.
- New Flow Maps created from `libraryFlowmap.html` automatically start with configured `Flow In` and `Flow Out` boundary nodes, positioned on opposite sides with default `flow.in` and `flow.out` object ports.
- Embedded Flow Map insertion now lists every available Flow Map in a selection dialog; insertion happens only from the explicit `Inserisci` action, which reloads the selected graph and blocks with an alert unless at least one `Flow In` or `Flow Out` node still exists.
- Embedded Flow Map nodes expose and automatically refresh the source graph interface: internal `Flow In` definitions render as typed inputs on the left, internal `Flow Out` definitions render as typed outputs on the right, generic `all` ports remain available, and alias deletion removes only the virtual node plus its local links.
- Embedded Flow Map aliases include a `View Flow Map` action that opens a read-only CMSwift dialog with a fitted minimal graph canvas, compact name/type node cards and source-colored connection paths loaded live from the referenced Flow Map.
- Universal box editor is now the primary editor path for boxLens and boxTracker creation/editing across Workspace, Flow Map, Library and Database Explorer.
- Legacy `editorBoxLens.html`/`editorBoxTracker.html` pages and their editor CSS/JS have been removed; the universal dialog is now the only boxLens/boxTracker editor surface.
- Tracker manual test execution is centralized in `core/runtime/tracker-test-runner.js` and consumed by the universal dialog.

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

Knowledge Runtime document upload/import UX is complete and user-verified; Knowledge Graph quality and analytics is starting:

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
- AI Agent runtime now treats `knowledge.rag.context` as first-class RAG input: it normalizes query/context/sources, injects a Knowledge RAG prompt block, exposes `ragContext` to templates and persists RAG metadata in AI jobs/results/events.
- Flow Map node inspector now shows an `AI RAG Debug` panel for AI Agent nodes, reading the latest `tl_ai_jobs` record and surfacing provider/model/fallback status, RAG query metadata, copied context and top RAG sources with scores.
- Knowledge Graph Step 6 base is implemented locally: `Entity Extractor` now extracts deterministic entities from chunks/manual text, persists `tl_knowledge_entities`, creates `co_occurs` relations in `tl_knowledge_relations`, emits `knowledge.entity.created` and `knowledge.relation.created`, and `Knowledge Graph` emits a `knowledge.graph.updated` snapshot with entity/relation counts and top entities.
- First manual Knowledge Graph test produced a valid snapshot; follow-up fixes now propagate `collectionId` from Entity Extractor to graph snapshots, classify single proper nouns such as `Adam` as `proper-noun`, suppress short duplicate entities such as `LM` when `LM Studio` exists, and generate clearer relation ids from normalized labels.
- Knowledge Graph inspector base is implemented: Knowledge nodes now show a `Knowledge Graph Debug` panel that reads local entity/relation/metric stores, shows counts, latest snapshot scope, top entities, recent relations, refresh and copy actions.
- Knowledge Graph visualizer dialog base is implemented and user-verified: Knowledge Graph nodes expose `View Graph` from the node body and inspector; the dialog includes search, type filter, relation filter, layout mode, node limit, grouped legend/index, selection details and a canvas graph view colored by entity type and sized by degree.
- Document Store upload UX is implemented: Document Store/Text Knowledge/Memory nodes expose `Upload Document` and document-count `Documents` actions from the node body plus `Knowledge Document Debug` in inspector; uploads accept `.txt`, `.md`, `.json` and `.csv`, emit a runtime EventBus document payload, and the documents dialog lists uploaded files with search, chunk counts, preview, copy and refresh actions.
- Knowledge document dialog now supports CMSwift search/select controls and confirmed document deletion, removing the selected document plus derived chunks, embeddings, entities, relations, sources and graph metrics.
- Knowledge upload now uses a DOM-attached file input and FileReader progress state, with visible selected/reading/processing/complete/error progress bars on the node, inspector and documents dialog; the dialog refreshes its document list after a successful upload.
- Knowledge upload now persists the selected file directly through `TrackerLensKnowledgeRuntime.createDocument` before emitting `knowledge.document.created` downstream, so upload no longer depends on the Document Store event listener being active.
- Knowledge document panels now show a compact preview plus text length metadata; longer documents expose a CMSwift `View Full Document` dialog for the complete stored text, and empty upload-progress placeholders no longer render as `null`.
- Uploaded/replayed documents now keep their payload scope ahead of stale node config: document title, source type, mime type, collection id and document id from uploads propagate through chunks, embeddings, entities and graph snapshots so old sample scopes such as Adam/`knowledge_test` do not override the current file.
- Entity extraction now filters common function words across Spanish/Italian/English/French and normalizes accents in generated ids, reducing noisy graph entities such as `Con`, `Para`, `Sin`, `Los`, `Muchas`, `Ahora` and preserving cleaner ids like `busqueda`.
- Entity Extractor now supports `extractionMode` (`strict`, `balanced`, `wide`) and custom `stopWords`; default `strict` keeps seeds, URLs/emails/symbols/technology, multi-word entities and repeated single proper nouns, reducing narrative one-off words in user-facing graphs.
- Entity Extractor now ignores direct `knowledge.document.created` input by default and processes chunk payloads only; `allowDocumentInput` can be enabled explicitly for direct document extraction, preventing duplicate entity/relation runs when both document and chunk events are connected.
- Entity phrase cleanup now strips narrative stopword prefixes/suffixes before candidate persistence, so phrases like `Cuando Juliette`, `Pero Juliette`, `Aunque Juliette`, `Era Liber` collapse toward the meaningful entity token instead of becoming separate graph nodes.
- Flow Map and runtime worker script URLs now include a Knowledge entity-cleanup cache-buster so browser/worker caches do not keep running an older `knowledge-runtime.js` after extraction changes.
- Document Store Play now replays an existing stored document by emitting `knowledge.document.created` downstream instead of sending the text back into the Document Store input, preventing infinite duplicate document creation on every Play.
- Step 8 Document Store upload/import UX is closed as user-verified after manual testing of upload, document listing, delete, preview/full document, graph debug and canvas graph visualizer interactions.
- Step 9 Knowledge Graph quality and analytics has started: the View Graph `Info` pane now surfaces graph-level quality signals from the visible graph, including average degree, density, connected components, isolated entities, repeated relation pairs and clickable top hubs.
- Knowledge relation quality now deduplicates equivalent source/target/type relations across chunks at document scope, preserving `occurrenceCount` and `chunkIds` metadata so repeated evidence does not over-densify the visual graph.
- View Graph `Info` now reports repeated evidence from relation `occurrenceCount` and lists the strongest repeated relations, making the deduplicated graph easier to validate.
- Entity quality now canonicalizes conservative water-source aliases such as `fuente de agua mágica/cristalina` -> `fuente de agua` and `agua del río` -> `agua`, preserving original labels in entity metadata aliases and surfacing aliases in the View Graph selection pane.
- Knowledge Graph snapshots now include top-entity aliases so copied graph data can confirm which labels were canonicalized.
- Relation quality now includes deterministic narrative relation inference from local context windows, adding stronger relation types such as `helps`, `heals`, `confronts`, `uses`, `travels_to`, `transforms` and `reveals` before falling back to generic `appears_in`, `interacts_with` or `co_occurs`.
- Narrative relation inference now rejects self-edges after alias canonicalization and tightens `helps`, `reveals` and `transforms` to avoid obvious false positives such as object self-transforms or location-to-person help relations.
- Narrative relation inference now uses stricter local windows for `heals` and removes generic `camino` as a `travels_to` trigger, reducing false positives where nearby characters are not the actual healed target or where a path is only being mentioned.
- Narrative relation inference now also requires local person/object action windows for `uses`, reducing broad object-use edges caused by a person and object merely sharing the same chunk.
- Narrative relation inference now tightens `heals` again so cure mentions alone do not mark nearby advisors/observers as healed; the healed person needs local drink/speech/voice/miracle evidence.
- `heals` now requires local drink/take/voice evidence near the healed entity; generic `hablar`/miracle mentions were removed as direct triggers because they marked nearby advisors as healed.
- `heals` now requires local drink/take evidence near the healed entity; `voz`/voice was removed as a direct trigger because it also matched descriptive voice text for non-healed characters.
- `heals` now requires the full local pattern: drink/take evidence near the person, cure-object evidence near the object and a speech/voice/miracle outcome in the same context window.
- `heals` is evaluated before generic `uses` so cure scenes such as a character drinking magic tea are not swallowed by the broader object-use relation.
- `heals` now requires the healed entity to be the local subject of the drink/take verb, preventing nearby supporters such as Juliette from being marked as healed in the same scene.
- `heals` subject detection now checks the candidate person directly, allowing descriptive words between the name and drink/take verb so "Liber ... tomó/bebió" is captured without matching nearby words such as "esperanza".
- `heals` now uses a wider cure-scene context but only for candidate cure objects (`agua`/`té`), while `says` requires a proper-noun speaker plus quote to prevent quote-location false positives.
- `says` no longer falls back from any proper-noun + quote pair; quotes are linked only when the candidate speaker appears before the quote and near a speech/action cue.
- Speaker matching for `says` is capped to a tighter pre-quote window so nearby non-speakers in the same scene are not attached to the quote.

## Next Logical Step

Knowledge Graph quality and analytics.

Target behavior:

- graph analytics should make noisy extraction visible without requiring raw store inspection;
- View Graph should help identify hubs, isolated entities, duplicate/repeated pairs and overly dense relation clusters;
- Entity Extractor should continue reducing low-value narrative terms without hard-coding a single document;
- relation quality should move beyond generic `co_occurs` where deterministic local signals are strong enough;
- analytics should remain local-first and scoped by workspace/document/collection filters.

## Required Updates When Work Changes

- Update this file.
- Update `docs/ai/task-registry.md`.
- If architecture changes, update `docs/ai/decisions.md`.
