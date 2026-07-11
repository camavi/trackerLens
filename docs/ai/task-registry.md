# Task Registry

Purpose: compact task status overview.
Read when: changing task status or deciding next work.
Do not read when: doing a local implementation already scoped by `current-focus.md`.
Last updated: 2026-07-02.

## Active

### TASK-027: Knowledge Runtime

Status: Knowledge Dictionary Runtime foundation is the next active path after Semantic Enricher and Graph Builder validation exposed the limit of case-specific graph rules.
Priority: High.
Risk: Medium/High because it adds a first-class runtime type and new local persistence.

Current sub-steps:

- Step 1 Knowledge stores and models: base implemented with local IndexedDB stores.
- Step 2 Document Store + Chunk Processor: base runtime handlers implemented; topbar Knowledge Test sample added and user-verified.
- Step 3 Embedding Generator + cosine similarity: local deterministic vectors implemented and provider-backed embeddings wired through existing AI provider profiles with local fallback.
- Step 4 RAG Search node: base local search implemented and user-verified with clean single-result sample context.
- Step 5 AI Agent consumes RAG context: complete and user-verified. First-class `knowledge.rag.context` prompt/job/result metadata implemented; Flow Map AI RAG Debug inspector panel shows the AI job, RAG query, result count, context and sources for the Knowledge Sample AI Answer node.
- Step 6 Knowledge Graph base: local Entity Extractor persists entities/relations, emits entity/relation channels, and Knowledge Graph emits local snapshots; inspector/analytics pending.
- Step 7 Knowledge inspector and analytics: Flow Map `Knowledge Graph Debug` inspector panel and `View Graph` dialog added for local entity/relation/snapshot inspection; graph visualizer migrated to canvas and user-verified.
- Step 8 Document upload/import UX: complete and user-verified. Document Store/Text Knowledge/Memory nodes expose `Upload Document`, upload progress, document-count `Documents` dialog and `Knowledge Document Debug`; `.txt`, `.md`, `.json` and `.csv` uploads emit local EventBus document payloads, surface uploaded document/chunk metadata in inspector, support confirmed document/delete-derived-record cleanup, preserve upload/replay scope through graph snapshots, replay enabled stored documents incrementally by default, expose a `Replay all documents` override, and prune disabled documents from derived graph records on the next Play.
- Step 9 Knowledge Graph quality and analytics: complete and user-verified. View Graph surfaces quality metrics/top hubs/repeated evidence, relation persistence deduplicates equivalent source/target/type edges across chunks while preserving occurrence metadata, conservative entity alias canonicalization covers repeated water-source variants, deterministic narrative relation inference adds stronger local relation types before generic fallbacks, and manual graph exports verified corrected `heals`/`says` behavior.
- Step 10 Knowledge Graph Query: complete and user-verified. `Graph Query` node emits prompt-ready `knowledge.graph.context` from persisted entities/relations/evidence, AI Agent runtime consumes Graph Context as first-class prompt/job metadata, and AI/RAG/Graph preview events now publish a clean answer payload while full prompt/context details remain in AI debug jobs.
- Step 11 Multilingual graph quality: complete and user-verified. Runtime language profiles/detection now cover Italian, Spanish, English, French and German; documents/chunks/entities/relations persist language metadata, entity/query filters use language-aware stopword/weak-label sets while retaining previous safety filters, and German disables generic capitalized proper-noun extraction to account for noun capitalization.
- Step 12 Graph Query ranking refinement: complete and user-verified. Query results carry entity score/connections/matched metadata, relation source/target labels, direct-match flags and relation scores; evidence scans matched-entity document chunks and clips around the entity, seed scoring requires lexical matches, and definitional relation ranking demotes location-only links while boosting direct person/quote/concept neighbors.
- Step 13 Semantic Relation Enricher: base implemented and browser-verified on regenerated Knowledge Graph export. New Knowledge node enriches existing graph relations into semantic relations in the existing relation store, marks records with semantic/evidence/extraction/original metadata, supports rule fallback plus optional provider-backed AI enrichment, updates graph snapshots/query/debug/test surfaces, and makes Knowledge Graph Test require semantic relations before Graph Query. Rule fallback has been tightened after French exports exposed broad chunk-level semantic false positives, a weak `C'était` entity, and residual wrong `cannot_speak`/`healed_by`/`has_property` orientation. Latest export verifies 22 entities, 65 relations, 2 clean semantic relations, no weak entities and `documentMismatch: false`.
- Knowledge Graph Test preset: `Sample Test` can now create and run a focused graph pipeline (`Manual JSON -> Document Store -> Chunk Processor -> Entity Extractor -> Semantic Relation Enricher -> Knowledge Graph -> Preview`, plus `Graph Query -> Preview -> AI Agent`) and waits for semantic relations plus graph context consumed by an AI Agent. Knowledge Graph/Graph Query collection scope aggregates all scoped documents instead of collapsing to the latest document, and Knowledge Graph nodes expose scoped clear controls for manual graph-index reset.
- Knowledge Graph Test cleanup removes stale runtime dependencies by preset id/source before rerun, preventing duplicate overlapping edges between Entity Extractor and Knowledge Graph.
- Knowledge Graph Test connection/dependency records now use the same shape as Knowledge Test records, including `connectionId` on runtime dependencies and `channel` on connection records, so dependency repair does not create duplicate links.
- Knowledge and AI Agent runtime event delivery is now dependency-aware for linked nodes, so disconnected Graph Query/AI sample nodes no longer keep consuming stale/same-channel query or context events.
- Graph Query no longer executes a saved config query from plain `knowledge.graph.updated` index-refresh events; those updates are ignored unless the payload carries an explicit query. A visual graph-source edge is now required before Graph Query reads persisted graph data; otherwise it emits an empty graph context.
- Forced Flow Map runtime reloads now refresh the background worker immediately, so link deletion updates live runtime subscriptions without waiting for a manual page refresh.
- Event Bus BroadcastChannel delivery now ignores events from other workspaces, so multiple Flow Map tabs do not cross-trigger runtime pipelines.
- Flow Map auto-refresh now skips overlapping `loadRuntime` cycles and keeps the runtime worker idempotent when it is already running for the active workspace.
- Added Flow Map `repair=knowledge-graph` startup cleanup and UI payload caps to recover extension workspaces that contain stale Knowledge Graph sample or oversized runtime records.
- Added Flow Map `repair=hard` startup cleanup for workspace-scoped runtime graph reset when a plugin workspace contains corrupt nodes/edges.
- Added standalone `flowMapRepair.html` for plugin recovery when the Flow Map page itself crashes before startup repair can complete.
- Knowledge Graph View/Debug falls back to the latest snapshot document for the configured collection when the node's configured `documentId` is stale.
- Knowledge Graph Debug/View now shows configured/latest/effective document ids and whether it is using the latest snapshot fallback.
- Knowledge Graph Debug/View no longer reports a document mismatch for the generated Knowledge Graph sample when the node still has the synthetic sample `documentId` but the collection has a newer uploaded `kdoc_*` snapshot.
- Italian semantic verification confirmed weak-entity cleanup and latest-document fallback, then tightened semantic enrichment: `opposes`, `gives_to`, `asks_for`, `lives_in` and `seeks` now require compatible typed pairs plus localized cue direction instead of broad chunk-level keyword matches.
- Follow-up Italian semantic verification reduced noise to 3 records and exposed residual false `healed_by` on `bastone` plus false `opposes` on `Alberi Secchi -> bastone`; semantic rules now require healing-like target objects for `healed_by`, exclude weapon/tool labels, and require creature/oppositional-concept targets for `opposes`.
- Latest Italian export after `semantic-rel-5` verifies the conservative target: 21 entities, 39 relations, zero semantic false positives, no weak entities/source-source co-occurrence/biblical residue and `documentMismatch: false`.
- English technical/RAG export added a non-narrative quality pass: weak heading/pronoun entities such as `We'll`, `How`, `Who`, `You` and `Powered` are filtered, pronoun contractions are stripped during entity cleanup, and semantic `seeks` rejects weak targets to avoid false technical-document relations.
- Step 14 Knowledge Graph Builder Agent: base implemented, provider verification pending. New Knowledge node uses configured local/OpenAI-compatible providers to propose structured graph entities/relations, validates exact evidence quotes against chunks, rejects weak labels and unsupported relation types, persists accepted relations in the existing relation store with `metadata.semantic`/`metadata.graphBuilder` and `extraction.method = ai-graph-builder`, and supports technical relation types such as `uses`, `implements`, `explains`, `stores_in`, `retrieves_from`, `powered_by`, `depends_on`, `interfaces_with` and `connects_to`. Provider hardening now resolves local OpenAI-compatible models from `/v1/models`, retries context overflow and empty/invalid AI JSON as `full -> compact -> micro`, and surfaces provider/empty-proposal diagnostics in Preview fallback payloads. Technical normalization converts evidence-backed generic `helps` proposals into more precise technical relations, compresses username/password atoms into `connection credentials`, and reruns replace only prior `metadata.graphBuilder` records for the same document. Narrative Builder validation now rejects lowercase/quote-only proper-noun candidates such as false `ilenzio`, requires social/action relations to connect compatible labels present in the evidence neighborhood, maps attack-like `causes` to `opposes`, restricts `seeks` targets to non-person goal entities and only accepts `cannot_speak` with Speech/Voice-like concept targets.
- Knowledge Graph snapshot rule-enricher cleanup: semantic rule fallback now filters non-person proper nouns from social/speech relations, requires Speech/Voice-like targets for `cannot_speak`, and narrows `discovers` to immediate explicit discovery targets after a cue, addressing false `cannot_speak -> compassion`, `friend_of -> NEURON Forest` and broad discovery edges in English story exports. Latest export verifies 8 semantic relations with 4 clean Builder records; the remaining broad rule `discovers` edges were tightened under cache `graph-builder-10`.
- Follow-up English export after `graph-builder-10` verifies the broad `discovers` edges are removed and no suspicious semantic relations remain, but a weak narrative Builder `depends_on` person-to-person relation surfaced; Builder compatibility now requires technical context for technical relation types such as `depends_on`, preventing narrative character dependency edges under cache `graph-builder-11`.
- Follow-up export after `graph-builder-11` verifies `depends_on` is removed and no suspicious semantic relations remain, then exposed weak abstract Builder relations from co-listed concepts; Builder compatibility now rejects technical relation types on non-technical entities without technical context and requires explicit causal cues plus both labels in the quote for `causes`/`leads_to`, under cache `graph-builder-12`.
- Latest export after `graph-builder-12` verifies the abstract `connects_to`/`leads_to` false positives are removed: 33 entities, 94 relations, 3 semantic relations, 2 clean Builder relations and no known suspicious semantic relation.
- Technical/RAG export with a new file verifies technical relation types still pass in technical context and no suspicious narrative carryover remains; Builder normalization now maps `works for` evidence to explicit `works_for` relations and re-orients `uses` when the evidence pattern is `Using X, Y applications...`, under cache `graph-builder-13`.
- Builder preview after `graph-builder-13` verifies `works_for` normalization with exact evidence and no suspicious relations; rejected loader/splitter candidates exposed missing technical vocabulary, so Builder relation types now include `loads`, `splits`, `splits_into`, `processes` and `transforms` under cache `graph-builder-14`.
- Full Knowledge Graph export after `graph-builder-14` verifies the persisted graph stays clean and conservative: 52 entities, 79 relations, 2 semantic Builder relations, both `works_for`, with no suspicious semantic relation; loader/splitter relations remain gated by accepted target entities/evidence.
- Italian mini-story export verifies narrative Builder quality remains mostly clean and free of old false positives; `graph-builder-15` deduplicates symmetric relation pairs such as `friend_of` and rejects weak `opposes` evidence such as ignored words without a strong attack/confrontation cue.
- Follow-up mini-story rerun after `graph-builder-15` produced zero semantic relations because dedup still considered same-document Builder records that had just been deleted by `replaceExisting`; `graph-builder-16` excludes those stale pre-delete Builder records from dedup.
- Rerun after `graph-builder-16` confirms semantic relations persist again but were too generic (`contains`/`mentions`); `graph-builder-17` prioritizes high-signal narrative relations, adds Builder `encounters`, normalizes encounter-like `mentions` to `encounters`, and restricts `mentions` to source/document/technical-reference contexts.
- Rerun after `graph-builder-17` still produced only generic `contains`; `graph-builder-18` adds a narrow post-AI supplemental Builder layer for explicit friendship/bond and speech/revelation cues, with the same evidence/entity/dedup validation as AI-proposed relations.
- Rerun after `graph-builder-18` still allowed weak AI `friend_of` evidence and missed `reveals` when source/quote were split across nearby text; `graph-builder-19` requires explicit friendship/bond cues for `friend_of` and uses speaker-to-quote context for supplemental `reveals` evidence.
- Rerun after `graph-builder-19` exposed a generic over-permissive person filter, not a Liber-specific hardcode: supplemental `friend_of` paired location-like proper nouns when a chunk contained `amica`. `graph-builder-20` filters common non-person place/object proper nouns, requires pair-specific friendship evidence, and removes the first-person fallback for supplemental `reveals` speakers.
- Rerun after `graph-builder-20` verifies false location `friend_of` edges are removed but supplemental `reveals` could still choose a person mentioned after the quote; `graph-builder-21` requires supplemental quote speakers to occur before the quote with a speech/voice cue in the speaker-to-quote context.
- Step 15 Knowledge Dictionary Runtime: started. Do not delete the existing Semantic Relation Enricher or Knowledge Graph Builder Agent; reuse their local stores, evidence validation, provider/proxy integration, graph persistence, debug/export and test harness. Freeze growth of case-specific Builder micro-rules except generic safety validation. Add a scoped dictionary layer before graph construction so language terms, lemmas, aliases, type candidates, semantic hints and relation cues are learned from document evidence and can guide Entity Extractor/Graph Builder without hardcoding one book/story. Dictionary scope must default to document/flow isolation, with explicit promotion to collection/workspace/global language scopes only when requested.
- Step 15 timeline:
  1. Phase 0 document architecture pivot and freeze graph-builder rule expansion: complete.
  2. Phase 1 add local `tl_knowledge_dictionary` model/store plus document cleanup behavior: base implemented under cache `knowledge-dict-1`.
  3. Phase 2 add Knowledge Dictionary Builder node emitting `knowledge.dictionary.updated` and `knowledge.lexicon.context`: base implemented under cache `knowledge-dict-1`.
  4. Phase 3 make Entity Extractor and Graph Builder consume dictionary hints for typing, aliases and ambiguity.
  5. Phase 4 add Dictionary Debug/View/export for terms, type candidates, evidence and scope.
  6. Phase 5 add optional provider-backed enrichment with rule fallback and strict evidence quotes.
  7. Phase 6 add explicit cross-document/collection merge and promotion policy.
- Step 15 first preview follow-up: `knowledge-dict-2` fixes the initial over-broad local dictionary by filtering sentence-start/function words before proper-noun promotion, adding generic lexical typing for common location/object/role terms, stripping leading articles from lemmas and compacting the Preview payload to a sample plus full `dictionaryEntryIds` so large documents do not immediately produce UI-truncated JSON.
- Knowledge runtime routing follow-up: `knowledge-dict-3` fixes disconnected Knowledge nodes still consuming workspace-global channel events. Non-source Knowledge nodes now require a matching visual dependency or explicit `targetNodeId`, preventing an unlinked `Knowledge Graph Builder Agent` from starting local provider work when document/chunk nodes emit.
- Dictionary ranking follow-up: `knowledge-dict-5` adds `tier`, `usableAsSeed`, `seedScore`, `tierCounts` and `usableSeedCount` so later Entity Extractor/Graph Builder integration can use only `core`/`typed` dictionary entries as seeds while preserving `context` terms for lexical understanding and debug.
- User verification of `knowledge-dict-5` preview is acceptable for next integration: 30 entries are seed-eligible (`core`/`typed`) while 88 weak/contextual terms remain non-seed. Next step is to make Entity Extractor read only `usableAsSeed === true` dictionary entries as hints, not all dictionary terms.
- Step 15 Phase 3 partial under `knowledge-dict-6`: Entity Extractor now accepts dictionary events and reloads same-document chunks, using only `usableAsSeed === true` `core`/`typed` entries as `dictionary-seed` candidates. The node exposes `useDictionarySeeds`, `minDictionarySeedTier` and `maxDictionarySeeds`, and extracted records keep dictionary tier/seed score metadata.
- Step 15 routing fix under `knowledge-dict-7`: Knowledge runtime dependency matching now checks all dependency channel/port fields instead of one target-first field, allowing `Knowledge Dictionary Builder -> Entity Extractor` links to propagate `knowledge.dictionary.updated` / `knowledge.lexicon.context` events reliably from the visual graph.
- Step 15 quality follow-up under `knowledge-dict-8`: generic Dictionary gates now classify common nature/place/object terms and reject common modifier/anaphoric fragments before seed promotion. Dictionary-triggered Entity Extractor runs with conservative relation defaults and suppresses high-meaning fallback relation types unless an explicit narrative cue is present.
- Step 15 retest/follow-up under `knowledge-dict-9`: user export verifies lower graph noise after `knowledge-dict-8` and corrects prior false proper nouns, but Dictionary-triggered extraction still emitted direct `reveals`. Runtime now degrades Dictionary-triggered narrative cues to conservative base relation types, preserving candidate connectivity while leaving semantic labels to Enricher/Graph Builder.
- Step 15 Graph Query follow-up under `knowledge-dict-10`: `knowledge.graph.context` now defaults to connected graph mode, hiding isolated seed candidates from AI context unless `includeIsolated` is explicitly enabled. Relation scoring now boosts evidence-bearing relations, and the Graph Query UI/palette exposes the isolated-entity debug toggle.
- Step 15 UI migration fix under `knowledge-dict-11`: existing `graph-query` nodes with old saved `settingsSchema` now merge current runtime field definitions, exposing `Include isolated entities` without requiring node recreation.
- Step 15 Graph Query answer-context follow-up under `knowledge-dict-12`: Graph Query now detects instrument/action-style questions and multi-seed evidence chunks, then adds a small bounded expansion of relations from those high-match chunks so nearby objects/evidence can reach AI context without hardcoding one story or document.
- Step 15 Graph Query answer-context threshold under `knowledge-dict-13`: AI debug verification answered `What does Liber use against the troll?` correctly from evidence, but the first expansion marked too many chunks as high-match. Expansion now requires two matched seeds for multi-seed questions and only uses single-seed expansion when additional non-seed query evidence is present.
- Step 15 semantic action-object follow-up under `knowledge-dict-14`: `uses` is promoted into the semantic relation set. Semantic Relation Enricher now creates evidence-backed `proper-noun -> object` use relations from base pairs or strict same-chunk supplemental evidence, while Builder validation allows narrative `uses` only for explicit use/grab/take/hit action cues.
- Step 15 AI answer follow-up under `knowledge-dict-15`: Graph Query correctly produced `Liber -uses-> bastone`, but the downstream AI Agent could still answer "missing evidence" because the normalized prompt/payload dropped semantic/evidence metadata. AI Agent graph-context rendering now preserves relation evidence and marks direct semantic relations as primary answer evidence.
- Step 15 action-object precision follow-up under `knowledge-dict-16`: `uses` attribution now rejects candidate subjects when another person appears between the candidate and the action cue, reducing false subject edges, and AI graph prompts guide natural object-label translation so English answers say `a stick/staff (bastone)` rather than `a bastone`.
- Step 15 answer-language polish under `knowledge-dict-17`: AI graph prompts now require answers in the query language and suppress parenthesized translations when query/evidence language already match, keeping Italian graph answers natural such as `Liber usa un grosso bastone`.
- Step 15 answer-language rule under `knowledge-dict-18`: Graph AI answers now explicitly follow the user query language rather than the source document language, translating labels only as needed for natural output and avoiding original/source terms unless requested or necessary for disambiguation.
- Step 15 healing-semantics follow-up under `knowledge-dict-19`: Enricher now derives evidence-backed `Liber -healed_by-> acqua del fiume`-style relations in voice recovery contexts, avoids `acqua del fiume -has_property-> voce` as the primary semantic edge, and orients Builder `healed_by` proposals as patient -> healing source.
- Step 15 healing-object dedup under `knowledge-dict-20`: supplemental `healed_by` extraction now prefers the longest overlapping healing object label in a chunk, preventing duplicate relations such as `Liber -healed_by-> acqua` and `Liber -healed_by-> acqua del fiume` for the same evidence.
- Step 15 healing-chain follow-up under `knowledge-dict-21`: voice/healing Graph Query intent now prioritizes causal-chain relations, and Semantic Relation Enricher can add `healing source/object -> causes -> voice/speech` from evidence with curative source plus preparation/drinking/immersion cues, preventing oversimplified answers that ignore flower/water/cup chains.
- Step 15 healing-chain correction under `knowledge-dict-22`: causal healing mechanism evidence now requires the source/mechanism to occur before the speech/voice outcome, avoiding false use of post-recovery details. Graph Query now boosts and centers evidence snippets around preparation/drinking cues such as cup/tea/flower/water/drinking for healing questions.
- Step 15 Dictionary Debug/View/export foundation under `knowledge-dict-23`: `Knowledge Dictionary Builder` nodes now have an inspector debug panel reading `tl_knowledge_dictionary` by workspace/document/collection/language scope. The panel shows entry counts, usable seed counts, tier/type/language summaries, evidence previews and a copyable export payload so dictionary quality can be inspected before provider-backed enrichment.
- Step 15 Narrative Event layer started under `knowledge-events-1`: added document-scoped `tl_knowledge_events`, cleanup on document regeneration, a `Knowledge Event Builder` node, `knowledge.events.updated` / `knowledge.event.context` outputs, rule-based ordered event extraction with exact sentence evidence, and Graph Query / AI Agent event-context consumption for how/why answers. This is the preferred path over adding more document-specific semantic relation micro-rules.
- Step 15 Event Builder quality follow-up under `knowledge-events-2`: preview analysis showed the core cup/flower/tea/drink/speech chain was captured, but false `heals` events came from bare `cura`, subject attribution accepted names after the action, and chunk order could drift. Runtime now sorts chunks by `ordinal`/`start`, adds `seeks`, removes bare `cura` as a heal trigger, and tightens subject fallback.
- Step 15 Event Builder preview/precision follow-up under `knowledge-events-3`: preview retest showed the causal chain existed but was hidden after the first 16 events, while titles/fragments and speech-inability sentences produced false `speaks`/`heals`. Runtime now ignores short title/fragments, maps inability-to-speak to `cannot_speak`, blocks modal/future healing statements as completed events, and previews high-value causal events alongside early chronology.
- Step 15 Event Builder precision follow-up under `knowledge-events-4`: curative power/property evidence now maps to `has_property`, ambient `fills` evidence is suppressed unless material/liquid/container cues are present, and subject fallback no longer inherits subjects through articles/object pronouns such as `il/lo/la`.
- Step 15 Event Builder precision follow-up under `knowledge-events-5`: `has_property` no longer triggers on generic `ha/aveva/has/had`; it requires explicit property/power/capability cues, preventing false events from phrases such as `Ha davvero senso...`.
- Step 15 Event Builder compound-action follow-up under `knowledge-events-6`: fill-and-immerse evidence in the same sentence is now split into ordered `fills` and `immerses` events with narrowed object lists, improving causal chain answers without adding document-specific rules.
- Step 15 Event Builder AI/hybrid base under `knowledge-events-ai-1`: `extractionMode=ai|hybrid` now calls the configured chat provider through the existing proxy/provider layer, validates exact evidence quotes before persistence, deduplicates accepted events, exposes AI proposal counts/errors in Preview, and falls back to rule events on provider failure.
- Step 15 Event Builder AI validator follow-up under `knowledge-events-ai-2`: AI event proposals now pass generic compatibility gates for property and speech evidence, so unsupported `has_property` records are rejected and failed speech attempts are normalized to `cannot_speak` instead of accepted as successful `speaks`.
- Step 15 Event Builder hybrid dedup follow-up under `knowledge-events-ai-3`: hybrid mode now deduplicates AI/rule candidates by chunk, event type and evidence quote instead of object text, preventing duplicate records when the LLM and rule fallback describe the same event with different object phrasing.
- Step 15 Graph Query event-chain follow-up under `knowledge-events-ai-4`: healing/voice questions now merge mechanism events into the ordered event context, ensuring the AI receives the cup/water/flower/tea/drinking/speech chain instead of only early inability-to-speak events or isolated healing relations.
- Step 15 Graph AI wording follow-up under `knowledge-events-ai-5`: graph-context prompts now require fluent, idiomatic prose rather than literal relation-name verbalization, so transform/cause event chains should be rendered naturally in the query language.
- Step 15 Event Debug/View/export foundation under `knowledge-events-debug-1`: `Knowledge Event Builder` nodes now have an inspector debug panel reading `tl_knowledge_events` by workspace/document/collection scope. The panel shows event type counts, extraction method counts, average confidence, sequence range, timeline/evidence previews and a copyable export payload for AI/rule event QA.
- Step 15 stale runtime cleanup follow-up under `knowledge-cleanup-1`: multi-document replay exposed removed-document event leakage. Document Store now exposes cascading `Clear Memory`, Dictionary/Event Builder expose scoped `Clear Dictionary` / `Clear Events`, document deletion and workspace sample cleanup remove downstream derived stores, and Graph Query filters events to active scoped document ids while `Clear Graph` remains graph/query scoped.
- Italian graph quality filters now reject weak Italian sentence-start tokens, pronouns and numeric-only entity labels before graph persistence.
- Italian graph quality filters now also reject common capitalized narrative/speech verbs that were entering the graph as false proper nouns.
- Italian graph quality now classifies common biblical/abstract labels as `concept` and object labels such as `Arca`/`Croce` as `object`.
- Italian semantic classification is kept as re-typing only, without broad keyword promotion, to avoid inflating graph entity counts.
- Italian cleanup filters residual pronoun-like labels (`Tutti`, `Colui`) and canonicalizes numbered shadow variants such as `Ombra Due`.
- Italian cleanup filters residual connective labels such as `Poiché`.
- Italian cleanup filters residual incomplete title/adjective labels such as standalone `Sommo`.
- Italian relation quality now adds conservative context-driven relation types before generic `co_occurs`: `fulfills`, `foreshadows`, `establishes`, `teaches`, `represents` and `opposes`.
- Entity typing uses local source/book/document/work cues to classify source-like entities as `source`; source/entity pairs map to `mentions`, and source/source pairs map to `references` before generic fallback.
- Knowledge Graph cleanup follow-up is complete and user-verified: locally described book/document/work/source entities are typed as `source`, source/source pairs resolve to `references` before generic fallback and sample-test warnings catch residual weak Italian labels or source/source `co_occurs` pairs.

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
- Step 6 Flow Chat Brain phase 1: complete base read-only LLM/RAG/memory answer layer with local JSON validation, palette-only recommended nodes and UI debug surface; same-origin docs RAG fetches focused project markdown with built-in fallback; Flow creation AI planner now receives Brain context, rejects unsupported AI node labels instead of creating custom nodes, and uses port intelligence for agent/bridge/split/preview links; Brain advice exposes safe quick actions and plan refinement options that launch normal confirmable Flow Chat plans; user-approved answers/plans can now be stored as confirmed `flow-chat-approved-pattern` workspace memory and removed again from the chat via `Dimentica`; similar approved patterns are retrieved per prompt, passed to Brain/planner as `approvedPatterns`, shown as `Pattern simili` in plan cards and reusable for regeneration; `Non usare` now stores `flow-chat-rejected-pattern` negative memory, passes `rejectedPatterns` to Brain/planner and filters similar approved patterns before reuse; the `Pattern salvati` dialog also lists rejected memories with a distinct style and delete action; compact same-chat conversation context is passed into Brain/planner/replies so follow-ups can reference the previous plan and constraints such as without Split/add Condition/Flow In-Out, and plan-follow-up prompts route back to planner instead of plain text, and fallback plans adapt the previous plan with constraints such as Flow In/Out boundary plus valid parallel Preview output, replacing Task Node with Flow In for reusable boundary plans; AI planner output now runs through a bounded JSON/preflight self-repair loop before local fallback, with live activity updates plus a collapsed final Self repair log and repaired plans labeled only in the planner badge/panel; short follow-up commands such as `crealo`, `applica questo`, `procedi` and `usa questo piano` recover the latest valid plan from the same chat, rerun preflight and either apply through the existing create/undo path or reload the plan as ready; post-apply results now show an `Obiettivo raggiunto` completion card with goal, applied nodes/links, warnings and next action above the technical counts; hardening adds pattern quality scoring, `Capo lavoro` plan summaries, clearer stale-plan apply blockers, collapsed clean technical checks and a `runFlowChatHardeningTests()` helper; chat text renders a safe markdown subset for bold/code/lists; Brain/planner/replies enforce same-language answers and `mi spieghi...` routes to read-only explain; `Brain details` now collapses intent/language/provider/confidence/RAG/memory/palette diagnostics by default; `Migliora` appends a refined answer using the previous prompt plus Brain/RAG/memory while preserving the original routing intent, without deleting the original, and refined messages now show a `Revisione` badge with a jump-to-original action plus source id in Brain diagnostics; post-response controls can create a flow from an answer, save/reuse approved patterns, load templates, open Brain details and generate a more operational rewrite, with secondary actions grouped under `Altro`; the chat header includes a searchable `Pattern salvati` memory dialog with reuse/create/delete actions; creation plans now include compact `Applica con controllo` preflight with palette/port/duplicate/destructive-action validation, blocked invalid apply, undo snapshot capture and post-apply report with warnings and Undo; plan `Opzioni` are collapsed by default; open/closed chat state persists per workspace in `localStorage`; Brain answers now allow longer complete explanations and trim on sentence/list boundaries instead of hard-cutting at 1400 characters; LLM/provider failures now show user-facing warnings with setup hints while fallback continues; safe executor authority unchanged; Flow Chat v2 runtime-tool bridge adds Agent Runtime inspect/suggestFixes/recent-runs/optional dry-run trace context for diagnostics, Provider Health summaries, Agent Runtime/Runtime Contract RAG docs, stronger memory ranking with recency/frequency/workspace/stale signals, explain-only plan blocking and expanded hardening tests.
- Step 7 Trackers Lens Agent Runtime v1: started with `core/runtime/agent-runtime.js`, loaded by `flowMap.html` and documented in `docs/ai/runtime/agent-runtime.md`; exposes English-first runtime tools `inspectFlow`, `runFlow`, `inspectNode`, `readLogs`, `suggestFixes` and `listRuns`; v1 is trace-first/dry-run and does not bypass existing node runtimes, preflight or safe executor rules; Flow Map exposes an `Agent Run` topbar dialog for inspect, dry-run trace, safe fix suggestions and raw inspect export; trace steps are expandable with channel/port/dependency details, latest matching runtime event payloads, canvas focus and node inspect actions; Agent Runtime node inspect records render readable summary panels with collapsible raw JSON; safe fix suggestions now diagnose broken/duplicate links, invalid ports, isolated nodes, agent bridge gaps, preview reachability and ambiguous roots, show problem/cause/action/risk/preview, and safe link/mapping fixes can be applied from the dialog before automatic trace verification; v1.2 adds time-travel Undo Fix, Runtime Fix Log, trace mode controls and safe Agent Bridge creation from the palette for missing bridge boundaries.

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
- Embedded Flow Map read-only preview: alias body action opens a fitted graph dialog showing current source nodes by name/type, configured IN/OUT ports and their connections without editing controls; the Flow Map File menu can export the full graph preview as JPG.
- Flow Map canvas interaction refinement: natural wheel pan, Ctrl-wheel zoom with live percentage, center marker, wider cable canvas, graph-fit minimap with live draggable viewport and minimize control, Shift-drag downstream node groups and Alt/Option-click quick delete.
- Flow Map world canvas pass: newly generated nodes use world-unit coordinates instead of viewport-percent positions, the edge canvas follows the visible world viewport, and node width can be resized per node and persisted in `flowPosition.width`.
- Flow Map world canvas verification: user confirmed new Flow Map boundary nodes can be deleted, Sample Test layouts are correct and the IndexedDB reset warnings are not blocking.
- Flow Map minimap color pass: runtime minimap markers inherit each node tone color.
- Flow Map minimap shape pass: minimap markers are rectangular and scale to rendered node height after first paint, including collapsed nodes.
- Flow Map recursive delete action: node delete dialog can force-delete the selected node plus every downstream child node.
- Flow Map Preview polish: long payload headers preserve copy/clear actions, and newly created Preview nodes start clean instead of replaying older cached events.
- Flow Map Sample Test render fix: numeric flow positions normalize to CSS percent coordinates so generated nodes render in place immediately.
- Flow Map Knowledge Sample layout spacing: generated sample nodes use margin-aware columns and taller rows to avoid overlap.
- Knowledge Graph Italian quality pass: locally described source/book/document/work entities now use `mentions` for source/entity pairs and `references` for source/source pairs, residual capitalized verb/common labels such as `Doveva`/`Viene`/`Aveva`/`Siamo` are filtered, digit-heavy quote artifacts such as `112 L’` and generic all-caps word symbols are rejected, stale same-document entities are cleaned on regeneration and hidden from snapshots/inspector exports, View Graph exposes connected-only and with-isolated exports plus a clearer initial canvas/focus reset and canvas cleanup on close, and symmetric generic relations are normalized to prevent opposite-direction duplicates.
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
