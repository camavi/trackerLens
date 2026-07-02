# Current Focus

Purpose: active work and immediate next step.
Read when: always after `AI.md`.
Do not read when: never during development sessions.
Last updated: 2026-06-30.

## Active Area

Knowledge Dictionary Runtime foundation.

## Completed Sequence

1. Step 1: runtime/DB query tools.
2. Step 2: dependency-aware commands.
3. Step 3: more realistic endpoint research.
4. Step 4: real compound commands.

## Latest Completed Work

Knowledge Graph multilingual quality baseline is complete:

- Knowledge runtime now has language profiles for Italian, Spanish, English, French and German with language-specific stop words and weak sentence-start tokens.
- Documents and chunks now persist detected/preferred language metadata, so graph extraction/query can carry language scope across the pipeline.
- Entity extraction, graph snapshots and Graph Query now use language-aware stopword/weak-label filtering while keeping the previous legacy stopword set as a conservative safety net.
- User-verified multilingual graph exports for Italian, Spanish, English, French and German after language-specific cleanup passes.

Knowledge Graph Query ranking refinement is complete:

- Graph Query now enriches returned entities with `score`, `connections` and `matched` metadata.
- Graph Query now enriches returned relations with labels, direct-match flags and relation scores for cleaner AI/Preview payloads.
- Definitional queries such as "chi e X?" prioritize direct relations around the matched entity before generic `co_occurs` neighbors.
- Graph Query evidence now scans document chunks containing the matched entity and clips snippets around that entity, so definitional answers get local evidence instead of only relation-neighborhood text.
- Graph Query seed scoring now requires an actual lexical match before adding confidence, preventing unrelated high-confidence entities from becoming query seeds.
- Definitional Graph Query relation ranking now demotes location-only relations and boosts direct person, quote and concept neighbors.
- User-verified `chi e Liber?` / `chi è Liber?` now ranks `Liber` as the only query seed, returns focused direct relations and supplies definitional evidence first.
- Knowledge Graph cleanup follow-up is complete and user-verified: entities described by local source/book/document/work cues are typed as `source`, `source -> source` pairs become `references` before generic relation fallback, and the Knowledge Graph sample test fails with explicit warnings if weak Italian labels such as `Doveva`/`Viene` or source/source `co_occurs` pairs remain after cleanup.

Semantic Relation Enricher base is implemented and browser-verified on the Knowledge Graph export:

- Flow Map palette now includes `Semantic Relation Enricher` as a Knowledge node with relation/graph/chunk inputs and semantic/enriched/context outputs.
- Knowledge runtime enriches base relations into semantic relations stored in `tl_knowledge_relations` with `metadata.semantic`, `metadata.originalRelationType`, `evidence`, `extraction` and explanation metadata.
- Rule fallback covers initial semantic types including `friend_of`, `helps`, `tries_to_help`, `healed_by`, `cannot_speak`, `has_property`, `lives_in`, `seeks`, `protects`, `opposes`, `causes`, `leads_to`, `is_part_of`, `teaches`, `discovers`, `asks_for`, `receives_from` and `gives_to`.
- Rule fallback was tightened after a French graph export showed broad chunk-level false positives: friendship now requires both person entities near a friendship cue, healing/property cues are localized around object/concept targets, and French apostrophe starts such as `C'était` are filtered as weak entities.
- A follow-up French export reduced semantic relations from 22 noisy records to 6, with weak entities removed; remaining false positives around `cannot_speak`, `healed_by` and `has_property` were addressed by requiring the patient before the semantic cue and by skipping property relations for location/object pairs.
- Knowledge Graph Test no longer pins downstream Semantic/Graph/Graph Query nodes to the fixed sample `documentId`; those nodes use collection/latest-document scope so uploaded `kdoc_*` documents do not show as `documentMismatch`.
- Latest French export now shows 22 entities, 65 relations, 2 clean semantic relations (`friend_of`, `healed_by`), no weak entities, no known bad semantic orientation and `documentMismatch: false`; View Graph/Debug treats the sample's synthetic configured document id as a valid latest-snapshot fallback instead of reporting a mismatch.
- Italian export verified entity cleanup and document fallback (`documentMismatch: false`) but exposed over-broad semantic enrichment for `opposes`, `gives_to`, `asks_for`, `lives_in` and `seeks`; semantic rules are now stricter about typed source/target pairs and cue position, and base narrative `opposes` no longer fires on generic concept/location pairs.
- Follow-up Italian export reduced semantic noise to 3 records but still produced false `healed_by` relations with `bastone` and false `opposes` between `Alberi Secchi` and `bastone`; `healed_by` now requires healing-like object labels and excludes weapon/tool labels, while semantic `opposes` now requires a creature antagonist or explicit oppositional concept.
- Latest Italian export after `semantic-rel-5` shows 21 entities, 39 relations, `semanticRelationCount: 0`, no weak entities, no source/source `co_occurs`, no biblical residue, no known bad semantic relations and `documentMismatch: false`; semantic enrichment now prefers no relation over false positives for this story.
- English technical/RAG export exposed weak heading/pronoun entities such as `We'll`, `How`, `Who`, `You` and `Powered`, which also created false `seeks`/`helps`; English weak filters now cover these heading/pronoun tokens, contraction cleanup removes pronoun contractions, and semantic `seeks` ignores weak targets.
- Optional AI enrichment can use existing local/OpenAI-compatible provider profiles through the same localhost chat proxy path, but rule fallback remains the stable path.
- Knowledge Graph snapshots now carry `semanticRelationCount`; Graph Query ranks semantic relations higher and includes method/original/evidence hints in graph context.
- Knowledge Graph Test now inserts `Semantic Relation Enricher` between Entity Extractor and Knowledge Graph and fails if semantic relations are not ready before Graph Query.
- View Graph/Knowledge Graph Debug now surface semantic relation counts, semantic relation colors and relation method/original/evidence details.

Knowledge Graph Builder Agent base is implemented and pending provider verification:

- Flow Map palette now includes `Knowledge Graph Builder Agent` as a Knowledge node with chunk/entity/relation/graph inputs and `knowledge.graph.proposed`, `knowledge.semantic.relations`, `knowledge.graph.enriched` and `knowledge.graph.context` outputs.
- The runtime calls the existing local/OpenAI-compatible AI provider layer through the same chat proxy path and requires strict JSON proposals with entities, relations, aliases and rejected candidates.
- Builder proposals are validated before persistence: accepted entities and relations require exact evidence quotes from selected chunks, allowed relation types are schema-limited, weak labels are rejected, confidence thresholds are enforced and duplicate semantic relation keys are skipped.
- Accepted builder relations are stored in `tl_knowledge_relations` with `metadata.semantic`, `metadata.graphBuilder`, `extraction.method = ai-graph-builder`, provider/model metadata and evidence, so Knowledge Graph, Graph Query and Debug can consume them without a parallel store.
- Technical relation types such as `uses`, `implements`, `explains`, `stores_in`, `retrieves_from`, `powered_by` and `depends_on` are supported for non-narrative documentation while still requiring evidence.
- Provider hardening after LM Studio returned a bare `HTTP 400`: OpenAI-compatible local models are now resolved from `/v1/models`, 400 responses retry once with a compact single-chunk prompt, and fallback payloads include the provider response body so the Preview exposes the real cause instead of only the status code.
- Post-LLM technical normalization is now active for the Builder: generic `helps` proposals can be converted to technical relations such as `interfaces_with`, `connects_to` or `uses` when evidence supports it, username/password atoms are compressed into `connection credentials`, and reruns replace only prior `metadata.graphBuilder` records for the same document so stale AI graph output does not pollute new previews.
- Italian narrative Builder verification exposed a false `ilenzio` proper-noun target for `Juliette -helps-> ilenzio`; Builder validation now rejects lowercase/quote-only proper-noun candidates and requires narrative relations such as `helps`/`friend_of` to connect compatible entity types whose labels are present in the evidence neighborhood.
- Local small-context provider verification exposed LM Studio `Context size has been exceeded`; the Builder now retries AI graph extraction as `full -> compact -> micro`, with `micro` sending one short chunk and no existing candidates, and exposes `promptMode` in Preview/extraction metadata.
- English pure Builder preview now succeeds with LM Studio/Gemma in `promptMode: full`, accepting clean `Juliette -friend_of-> Liber` and `Juliette -seeks-> Cure` relations while rejecting weak candidates; `cannot_speak` validation now allows a `Speech`/`Voice` concept target when the evidence contains a speech-inability cue such as "could not speak".
- A follow-up Builder preview showed `status: ready` with zero raw entities/relations after an empty AI proposal; AI calls now retry empty/invalid JSON responses through the same `full -> compact -> micro` ladder and report `empty-ai-proposal`/`invalid-ai-json` as fallback diagnostics if all attempts remain empty.
- Latest English Builder preview produced a richer graph but exposed residual narrative typing issues: physical attacks were proposed as `causes`, `seeks` targeted `Liber` instead of the cure, and `cannot_speak` targeted `NEURON Forest`; Builder normalization now maps attack-like `causes` to `opposes`, restricts `seeks` targets to non-person goal entities, and requires `cannot_speak` targets to be Speech/Voice-like concepts.
- Knowledge Graph snapshot export showed no `metadata.graphBuilder` records but exposed rule-enricher noise: `cannot_speak -> compassion`, `friend_of -> NEURON Forest` and broad `discovers` relations. Rule enrichment now filters non-person proper nouns from social/speech relations, requires Speech/Voice-like targets for `cannot_speak`, and narrows `discovers` to explicit allowed targets after a discovery cue.
- Latest English Knowledge Graph export after cleanup shows `semanticRelationCount: 8` and `graphBuilderRelationCount: 4`; previous false `cannot_speak -> compassion` and `friend_of -> NEURON Forest` are gone, while Builder relations are clean (`has_property`, `helps`, `opposes`). The remaining broad rule-based `discovers` edges are now further constrained to immediate discovery targets, generic `creature` labels are rejected as discovery targets, and the Flow Map/worker cache is bumped to `graph-builder-10`.
- Follow-up English export with the refreshed runtime confirms broad rule-based `discovers` edges are gone (`semanticRelationCount: 2`, no suspicious semantic relations). It exposed a weak narrative Builder relation, `Juliette -depends_on-> Liber`; Builder validation now treats technical relation types such as `depends_on` as technical-only unless evidence/labels contain technical context, so person-to-person narrative dependency edges are rejected under cache `graph-builder-11`.
- Follow-up export after `graph-builder-11` verifies `depends_on` is gone and `suspiciousCount: 0`, but the Builder accepted weak abstract relations from one quote: `discipline -connects_to-> determination` and `determination -leads_to-> courage`. Builder validation now requires technical context for all technical relation types on non-technical entities, and requires explicit causal cue plus both labels inside the quote for `causes`/`leads_to`, under cache `graph-builder-12`.
- Latest export after `graph-builder-12` verifies the abstract `connects_to`/`leads_to` false positives are gone: 33 entities, 94 relations, 3 semantic relations, 2 Builder relations (`Juliette -has_property-> determination`, `troll -opposes-> Juliette`) plus the rule `Juliette -friend_of-> Liber`, with no known suspicious semantic relation.
- Technical/RAG export with a different file verifies technical relation types are no longer over-blocked: 53 entities, 82 relations and 5 Builder semantic relations with no suspicious narrative carryover. It exposed two precision improvements now handled under cache `graph-builder-13`: `has_property` with `works for` evidence normalizes to `works_for`, and `uses` is re-oriented when the quote says `Using X, Y applications...` so `Y -uses-> X`.
- Builder preview after `graph-builder-13` verifies `works_for` normalization directly: `Michael -works_for-> prismaticAI` and `Sarah -works_for-> prismaticAI` are accepted with exact evidence and no suspicious relations. The same preview exposed rejected technical loader/splitter relations due to missing vocabulary, so Builder relation types now include conservative technical verbs `loads`, `splits`, `splits_into`, `processes` and `transforms` under cache `graph-builder-14`.
- Full Knowledge Graph export after `graph-builder-14` verifies the persisted graph remains conservative and clean: 52 entities, 79 relations, 2 semantic Builder relations, both `works_for`, and no suspicious semantic relation. Loader/splitter semantic relations are not present in this export because accepted target entities such as `documents`/`text data` were not in the graph, so the new technical vocabulary is available but still evidence/entity-gated.
- Italian mini-story export verifies narrative Builder quality remains mostly clean after the technical vocabulary work: 21 entities, 44 relations and 5 Builder semantic relations with no old false positives. It exposed two precision fixes now handled under cache `graph-builder-15`: symmetric relations such as `friend_of` are deduplicated by unordered pair, and `opposes` rejects weak dismissal evidence such as "ignored her words" unless there is a strong attack/confrontation cue.
- Follow-up mini-story export after `graph-builder-15` produced zero semantic relations, revealing a rerun dedup bug rather than a quality target: `replaceExisting` deleted previous Builder records, but the dedup key set was still built from the pre-delete `relationsAll` snapshot and skipped newly proposed relations as already existing. `graph-builder-16` excludes stale same-document `metadata.graphBuilder` records from dedup when replacement is enabled.
- Rerun after `graph-builder-16` confirms the replace/dedup bug is fixed, but output became too generic: 3 Builder semantic relations (`contains`, `mentions`) with no false positives but missing high-signal narrative relations. `graph-builder-17` updates the Builder prompt to prefer explicit narrative semantics over generic `mentions`/`contains`, adds `encounters` to Builder relation types, normalizes encounter-like `mentions` to `encounters`, and restricts `mentions` to source/document/technical-reference contexts.
- Rerun after `graph-builder-17` still produced only generic `contains` relations. `graph-builder-18` adds a narrow post-AI supplemental rule layer inside the Builder: after entity acceptance and before relation validation, explicit friendship/bond cues can add `friend_of`, and explicit speech/revelation cues around a quote entity can add `reveals`; these supplemental relations still pass the same evidence quote, entity and dedup validation as AI-proposed Builder relations.
- Rerun after `graph-builder-18` produced `encounters` and a weak AI `friend_of` based only on travel together. `graph-builder-19` tightens `friend_of` compatibility to require an explicit friendship/bond cue and improves supplemental `reveals` evidence selection by using the context between speaker and quote when one sentence does not contain both labels.
- Rerun after `graph-builder-19` showed the user's overfit concern clearly: the supplemental friendship fallback was generic, not hardcoded to Liber, but it treated location-like proper nouns such as forests/trees/castles as people and paired every person-like entity in a chunk when it saw `amica`. `graph-builder-20` makes the fix category-based: non-person proper nouns now include common location/object labels in Italian/English, supplemental `friend_of` requires a direct evidence sentence/context for the specific pair, and supplemental `reveals` no longer falls back to the first person in a chunk as speaker.
- Rerun after `graph-builder-20` verifies the false location `friend_of` edges are gone, but supplemental `reveals` still chose a speaker mentioned after the quote. `graph-builder-21` makes speech attribution directional: supplemental quote speakers must appear before the quote and the speaker-to-quote context must contain a speech/voice cue.

Knowledge Dictionary direction is now the next architecture path:

- Do not delete the Semantic Relation Enricher or Knowledge Graph Builder Agent work. Keep it as a validated graph producer, provider/proxy integration, evidence validator, graph persistence layer and debug/test harness.
- Freeze growth of case-specific graph-builder micro-rules. Future lexical/type precision should move into a general Knowledge Dictionary layer instead of adding story-, book- or prompt-specific exceptions to relation validation.
- Reuse existing stores and surfaces where possible: documents, chunks, language profiles, entities, relations, snapshots, graph context, AI provider profiles, Preview, View Graph and Knowledge Graph Debug.
- New target pipeline: `Document -> Language Profile -> Knowledge Dictionary -> Entity/Concept Typing -> AI/Rule Graph Builder -> Validator -> Knowledge Graph -> Graph Query/AI`.
- Dictionary scope must be isolated by default: document-level entries first, with optional collection/workspace/global language promotion only when explicitly requested. Different Flow Maps and Knowledge Graphs must not share learned terms unless they are intentionally linked by workspace/collection policy.
- Proposed Dictionary record shape should cover `workspaceId`, `flowId`, `collectionId`, `documentId`, `language`, `term`, `lemma`, `aliases`, `typeCandidates`, `semanticHints`, `relationCues`, `confidence`, `evidence`, `source`, `createdAt` and `updatedAt`.
- Timeline:
  1. Phase 0: document the architecture pivot and freeze graph-builder rule expansion except generic safety validation.
  2. Phase 1: add local Dictionary store/model and cleanup behavior tied to document deletion.
  3. Phase 2: add a Knowledge Dictionary Builder node that emits `knowledge.dictionary.updated` and `knowledge.lexicon.context`.
  4. Phase 3: make Entity Extractor and Graph Builder consume dictionary hints for typing, aliases and ambiguity resolution.
  5. Phase 4: add Dictionary Debug/View/export so accepted/rejected lexical knowledge is inspectable.
  6. Phase 5: add optional provider-backed dictionary enrichment with rule fallback and strict evidence validation.
  7. Phase 6: add explicit cross-document/collection merge policy for promoted dictionary knowledge.
- Phase 1/2 base is now implemented under cache `knowledge-dict-1`: `tl_knowledge_dictionary` is part of the Knowledge store set, document regeneration/deletion cleans document-scoped dictionary entries, the palette exposes `Knowledge Dictionary Builder`, and the runtime emits both persisted dictionary records plus `knowledge.dictionary.updated` / `knowledge.lexicon.context`. The first implementation is local/rule-based and evidence-linked; Entity Extractor and Graph Builder do not consume the dictionary yet.
- First Italian preview verified persistence and scoping (`language: it`, `scope: document`) but exposed over-broad dictionary extraction: sentence-start/function words such as `Certo`, `Nonostante`, `Tuttavia`, `Accesero` and `Corsero` were accepted as high-confidence `proper-noun` entries, and the Preview payload was too large/truncated. `knowledge-dict-2` tightens function-word/sentence-start filtering, adds generic lexical typing for common location/object/role terms, strips leading articles from lemmas, and emits a compact preview sample plus full `dictionaryEntryIds` while keeping complete records in `tl_knowledge_dictionary`.
- Runtime routing bug fixed under `knowledge-dict-3`: non-source Knowledge nodes without incoming visual dependencies no longer consume global channel events by default. This prevents disconnected nodes such as `Knowledge Graph Builder Agent` from starting local AI work when `Graph Document Store` or `Chunk Processor` emits on `knowledge.document.created` / `knowledge.chunk.created`; only source-like document/memory nodes keep unlinked event intake, while other nodes require a matching dependency or explicit `targetNodeId`.
- Follow-up Dictionary preview is cleaner but still showed weak low-value Italian tokens (`sempre`, `solo`, `avrebbe`, greetings/quote starts such as `Buongiorno`/`Ciao`, and verb-like terms such as `parlava`). `knowledge-dict-4` filters these generic function/greeting/verb/adjective tokens, prevents weak multi-word labels when any component is weak, adds concept typing for `voce`/`cura`/`silenzio`-style terms, and caps `dictionaryEntryIds` in Preview with a truncation flag so the full store can remain complete without flooding Preview.
- Dictionary ranking added under `knowledge-dict-5`: each entry now carries `tier` (`core`, `typed`, `context`, `weak`), `usableAsSeed`, and `seedScore`. Preview includes `tierCounts` and `usableSeedCount`, and the context lines show whether each term is seed-eligible. This keeps the Dictionary useful as lexical context while preventing generic terms from becoming graph/entity seeds in the next integration step.
- User-provided `knowledge-dict-5` preview verifies the tier split is usable: `Juliette`, `Liber`, `Scoraggiamento` and `NEURON` are `core`; `Montagna`, `foresta`, `fiore`, `anziano`, `luogo`, `acqua`, `castello` and `caverna` are `typed`; generic terms such as `parlare`/`viaggio` remain `context`; weak terms such as `amico`, `cammino`, `cuore`, `destra` and `notte` are not seed-eligible. Current output shows `tierCounts: core=9, typed=21, context=2, weak=88` and `usableSeedCount: 30`, which is a good gate for the next Entity Extractor integration.
- Entity Extractor dictionary integration is implemented under `knowledge-dict-6`: the palette now accepts `knowledge.dictionary.updated` / `knowledge.lexicon.context`, the runtime reloads same-document chunks on dictionary events, and only `usableAsSeed === true` entries at `core`/`typed` tier are injected as `dictionary-seed` candidates. Extracted entities preserve `metadata.dictionary` with tier/seed score, while `context` and `weak` dictionary terms remain non-seed lexical/debug material.
- Dictionary-to-Entity routing follow-up fixed under `knowledge-dict-7`: dependency event matching now considers all saved dependency channel fields (`channel`, source/target ports and metadata aliases) while ignoring wildcard `all`, so a visual link from `Knowledge Dictionary Builder` to `Entity Extractor` can pass `knowledge.dictionary.updated` or `knowledge.lexicon.context` even when the canvas stores the visible port as source/target metadata.
- Dictionary quality pass implemented under `knowledge-dict-8`: the Dictionary/Extractor now uses generic lexical gates for common nature/place/object terms, common modifiers and anaphoric fragments, preventing capitalized common words from becoming `core/proper-noun` seeds. Entity extraction triggered by Dictionary context now runs in a more conservative relation mode with lower default relation fan-out and only emits base relations that have a safe structural type or explicit narrative cue, leaving strong semantic relations to the Semantic Enricher / Graph Builder.
- User retest after `knowledge-dict-8` shows the intended direction: graph export dropped from 39 entities / 115 relations to 34 entities / 57 relations, `Alberi` / `Alberi Secchi` are now `typed/location` instead of `core/proper-noun`, and anaphoric `L'altra` is gone. Remaining issue: Dictionary-triggered Entity Extractor still emitted `reveals` relations directly from narrative cues. `knowledge-dict-9` now ignores high-meaning narrative relation labels during Dictionary-driven extraction and emits only conservative base relation types for those pairs, so semantic labels must come from Semantic Enricher / Graph Builder.
- Graph Query / AI context connected-mode implemented under `knowledge-dict-10`: graph context now defaults to connected entities only when relations are available, reports connected/isolated candidate counts, and exposes `includeIsolated` as an explicit debug option. Relation ranking now gives an extra boost to relations with evidence/quotes/explanations, so semantic evidence-bearing relations are prioritized in `knowledge.graph.context` before weaker base edges.
- Graph Query config UI migration fixed under `knowledge-dict-11`: existing Knowledge nodes with an older saved `settingsSchema` no longer bypass current runtime field definitions, so existing `graph-query` nodes show the new `Include isolated entities` toggle without recreating the node.
- Graph Query answer-evidence expansion added under `knowledge-dict-12`: when a query matches multiple graph seeds or asks an instrument/action question, relations from high-match chunks receive a bounded context expansion so answer-critical nearby objects/evidence can enter `knowledge.graph.context` without adding document-specific graph rules.
- Graph Query answer-evidence expansion tightened under `knowledge-dict-13`: real AI debug output answered the instrument question correctly but showed `answerExpansionChunkCount` was too broad, so high-match chunks now require at least two matched seeds when the query has multiple graph seeds, falling back to single-seed expansion only for genuinely single-seed questions with additional query-token evidence.
- Semantic action-object extraction added under `knowledge-dict-14`: `uses` is now a first-class semantic relation for evidence-backed person/object action contexts. The Semantic Relation Enricher can derive `person -uses-> object` from existing base pairs or from strict same-chunk supplemental evidence, and the Graph Builder validator now accepts narrative `uses` only when explicit action cues support it.
- AI Agent graph-context consumption fixed under `knowledge-dict-15`: the clean AI payload and prompt block now preserve semantic/direct/method/original/evidence metadata for Graph Query relations and explicitly instruct the model to answer from direct semantic evidence instead of reporting missing evidence when the relation and quote are present.
- `knowledge-dict-16` tightens action-object subject attribution and answer wording: supplemental `uses` skips a candidate person when another person appears between that candidate and the action cue, preventing false edges such as `Juliette -uses-> bastone`, and AI graph prompts now ask for natural translation of source-language object labels such as `bastone` when answering in English.
- `knowledge-dict-17` tightens AI graph answer language: Graph AI answers should use the same language as the user query and avoid parenthesized translations when the query and evidence are already in the same language; translations are reserved for cross-language answers or explicit translation requests.
- `knowledge-dict-18` makes query-language answering the stable Graph AI rule: the AI Agent must answer in the language of the user query, not the source document language, translating graph labels only as needed for a natural answer and avoiding parenthesized original terms unless explicitly requested or required for disambiguation.
- `knowledge-dict-19` improves healing semantics: Semantic Relation Enricher now adds strict evidence-backed `person -healed_by-> healing object` supplemental relations for speech/healing contexts, suppresses false `object -has_property-> voce` relations in healing/voice contexts, and Graph Builder accepted `healed_by` proposals are oriented as patient -> healer before persistence.
- `knowledge-dict-20` deduplicates overlapping healing objects during supplemental healing extraction, preferring the more specific label such as `acqua del fiume` over the shorter contained label `acqua` for the same chunk/evidence.
- `knowledge-dict-21` treats healing/voice questions as causal-chain queries: Graph Query boosts `causes`/`has_property` evidence in recovery questions, and Semantic Relation Enricher can derive `healing source/object -> causes -> voice/speech` when evidence mentions a curative source plus preparation/drinking/immersion cues. This keeps answers from collapsing a flower/water/cup healing chain into only `person -healed_by-> water`.
- `knowledge-dict-22` tightens healing-chain quality: causal `healing source/object -> causes -> voice/speech` evidence now requires the mechanism to appear before the outcome, preventing post-recovery objects such as a second flower from becoming the cause. Graph Query also boosts and snippets preparation/drinking chunks for healing questions, so evidence with cup/tea/flower/water/drinking can reach the AI even when the chunk does not repeat the final `voice` concept.
- `knowledge-dict-23` adds the first Dictionary Debug/View/export foundation: `Knowledge Dictionary Builder` nodes now expose an inspector panel backed by `tl_knowledge_dictionary`, filtered by workspace/document/collection/language, with tier counts, usable seed counts, type summaries, evidence previews and a copyable export payload. This makes accepted lexical knowledge inspectable before adding provider-backed dictionary enrichment.
- `knowledge-events-1` starts the Narrative Event layer so the system can answer ordered "how/why" questions without growing document-specific relation micro-rules. The Knowledge store now includes `tl_knowledge_events`, document regeneration cleans document-scoped events, the palette exposes `Knowledge Event Builder`, and the runtime emits `knowledge.events.updated` plus `knowledge.event.context`. The first extractor is conservative/rule-based with exact sentence evidence and sequence order; Graph Query and AI Agent now include ordered events in graph context, preferring event chains for how/why answers.
- `knowledge-events-2` tightens the first Event Builder preview: chunk ordering now uses `ordinal`/`start` instead of only `index`, bare `cura` no longer creates false `heals` events, `seeks` covers cure-search evidence, and subject attribution only accepts named subjects before the action cue with guarded fallback for pronouns/elliptic verbs.
- `knowledge-events-3` improves Event Builder signal quality after preview testing: speech state now uses `cannot_speak` instead of false `speaks`, title/fragments are ignored, modal/future healing statements such as "could/will be healed" no longer become completed `heals` events, and the Event Builder preview selects high-value causal events so cup/flower/tea/drink/speech chains are visible instead of hidden after the first chronological records.
- `knowledge-events-4` further tightens event precision: curative property statements now become `has_property` instead of completed `heals`, ambient filling such as a castle filled with music/laughter/hope is ignored as a material `fills` event, and subject fallback no longer treats articles/object pronouns such as `il/lo/la` as subject references.
- `knowledge-events-5` narrows `has_property` event triggers so generic auxiliary phrases such as "ha senso" no longer create property events; properties now require semantic property/power/capability cues such as `possiede`, `potere`, `proprietà` or `capacità`.
- `knowledge-events-6` separates compound material-action sentences into ordered event records when a sentence clearly contains both fill and immerse actions, so evidence such as "fill a cup with water and immerse the flower" becomes `fills` plus `immerses` instead of one mixed-object event.
- `knowledge-events-ai-1` wires the Knowledge Event Builder `extractionMode` to the existing local/OpenAI-compatible provider layer. `ai` and `hybrid` modes now request strict JSON events from the LLM, accept only schema-valid events with quotes found in source chunks, deduplicate against rule candidates, and fall back to rule events if the provider fails.
- `knowledge-events-ai-2` adds generic AI-event compatibility validation: `has_property` proposals require explicit property/power/ability evidence, failed speech/silence evidence is normalized from `speaks` to `cannot_speak`, and the Event Builder prompt now tells the provider to preserve source-language labels and separate successful speech from failed attempts.
- `knowledge-events-ai-3` tightens hybrid event deduplication so AI and rule candidates with the same chunk, event type and evidence quote collapse into one ordered event, reducing duplicate `cannot_speak`, `fills`, `immerses`, `transforms` and `drinks` records while preserving rule-only coverage.
- `knowledge-events-ai-4` makes Graph Query event retrieval chain-aware for healing/voice questions: preparation and mechanism events such as `finds`, `fills`, `immerses`, `transforms`, `takes`, `drinks`, `has_property` and final speech are explicitly merged into the structured event payload instead of losing to early `cannot_speak` matches.
- `knowledge-events-ai-5` polishes Graph AI answer wording: the AI Agent prompt now tells models to write idiomatic prose instead of literal graph-relation wording, especially for transforms/causes chains, reducing awkward phrases such as "causando alla soluzione" when the graph evidence itself is correct.
- `knowledge-events-debug-1` adds Event Debug/View/export parity with Dictionary Debug: `Knowledge Event Builder` nodes now expose an inspector panel backed by `tl_knowledge_events`, filtered by workspace/document/collection scope, with event type counts, extraction method counts, confidence summary, sequence range, timeline preview, evidence snippets and a copyable export payload.

Knowledge Graph Query baseline is complete:

- `Graph Query` is a first-class Knowledge node that reads persisted entities/relations and emits `knowledge.graph.context`.
- Graph context includes matched entities, neighboring relations, scoped evidence chunks and a compact prompt-ready context block.
- AI Agent runtime recognizes `knowledge.graph.context` and injects it into prompts/job metadata like RAG context.
- `Knowledge Graph Test` includes `Graph Query -> Preview -> AI Agent`, so agents can consume graph information, not just visualize snapshots.
- Graph Query now supports `preferLatestDocument` so sample flows keep working when the user replaces the uploaded document inside the same collection.
- AI Agent graph/RAG responses now emit a clean preview payload (`question`, `answer`, compact relations/entities/evidence or sources) while the AI debug job keeps the full prompt and raw context for inspection.
- Knowledge runtime now routes events by actual incoming dependencies when a node has visual links, preventing disconnected Graph Query/source nodes from continuing to consume same-channel events.
- AI Agent runtime now applies the same dependency-aware event routing, so linked agents do not consume unlinked Graph/RAG context events from the same global channel.
- Graph Query now treats `knowledge.graph.updated` as an index-refresh signal only; it no longer falls back to a saved `config.query` on graph updates without an explicit query payload.
- Graph Query requires a visual `knowledge.graph.updated` graph-source edge before it reads persisted graph data; without that edge it emits an empty graph context instead of querying the workspace store. Graph updates still do not trigger a query by themselves.
- Flow Map forced runtime reload now explicitly refreshes the background runtime worker, so deleting a link updates live Knowledge/AI subscriptions without requiring a browser refresh.

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

Knowledge Runtime document upload/import UX, Knowledge Graph quality/analytics and AI Agent RAG verification are complete and user-verified:

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
- Step 9 Knowledge Graph quality and analytics is complete: the View Graph `Info` pane surfaces graph-level quality signals from the visible graph, including average degree, density, connected components, isolated entities, repeated relation pairs and clickable top hubs.
- Knowledge relation quality now deduplicates equivalent source/target/type relations across chunks at document scope, preserving `occurrenceCount` and `chunkIds` metadata so repeated evidence does not over-densify the visual graph.
- View Graph `Info` now reports repeated evidence from relation `occurrenceCount` and lists the strongest repeated relations, making the deduplicated graph easier to validate.
- Entity quality now canonicalizes conservative water-source aliases such as `fuente de agua mágica/cristalina` -> `fuente de agua` and `agua del río` -> `agua`, preserving original labels in entity metadata aliases and surfacing aliases in the View Graph selection pane.
- Knowledge Graph snapshots now include top-entity aliases so copied graph data can confirm which labels were canonicalized.
- Relation quality now includes deterministic narrative relation inference from local context windows, adding stronger relation types such as `helps`, `heals`, `confronts`, `uses`, `travels_to`, `transforms` and `reveals` before falling back to generic `appears_in`, `interacts_with` or `co_occurs`.
- Narrative relation inference now rejects self-edges after alias canonicalization and tightens `helps`, `reveals` and `transforms` to avoid obvious false positives such as object self-transforms or location-to-person help relations.
- Italian Knowledge Graph quality now filters common Italian pronouns, determiners, question words and numeric-only labels before entity persistence, reducing noisy nodes such as `Egli`, `Chi`, `Suo`, `Sua`, `Cosa`, `Chiedilo` and numeric fragments across any Italian document.
- Italian Knowledge Graph quality now also rejects common capitalized narrative/speech verbs before they become proper-noun entities, reducing nodes such as `Andiamo`, `Venne`, `Aiuto` and stripping prefixes such as `Sussurrò Ombra Due`.
- Italian semantic classification now maps common biblical/abstract Italian labels such as `Vita`, `Morte`, `Giustizia`, `Scrittura`, `Luce`, `Ombra` and `Parola` to `concept`, and object labels such as `Arca`/`Croce` to `object`, instead of treating them as proper nouns.
- Italian semantic classification no longer promotes all biblical concept/object terms through broad keyword extraction; it only re-types candidates already found by existing extraction, avoiding the entity count spike seen in the Italian graph export.
- Italian graph cleanup now filters residual pronoun-like labels such as `Tutti`/`Colui`, classifies `assoluzione` as a concept and canonicalizes numbered shadow variants such as `Ombra Due` back to `ombra`.
- Italian cleanup now filters residual connective labels such as `Poiché` that can appear as capitalized sentence starters in relation exports.
- Italian cleanup now filters residual incomplete title/adjective labels such as standalone `Sommo`.
- Italian relation quality now adds conservative context-driven relation types before `co_occurs`: `fulfills`, `foreshadows`, `establishes`, `teaches`, `represents` and `opposes`, using explicit local textual cues such as `adempie`, `prefigura`, `alleanza`, `insegna`, `rappresenta`, `sacrificio`, `peccato` and `morte`.
- Entity typing now uses local source/book/document/work cues to classify source-like entities as `source`; source/entity pairs map to `mentions`, reducing generic book/person `co_occurs`.
- Source/source pairs now map to `references`, reducing another class of generic `co_occurs` edges without hard-coding domain-specific source names.
- Italian cleanup now filters residual capitalized verb labels such as `Doveva`, `Viene`, `Vengono`, `Veniva` and `Venivano` before they become graph entities.
- Knowledge relation quality now normalizes symmetric edge orientation for generic relations such as `co_occurs`, preventing duplicate opposite-direction pairs such as `Abrahamo -> Dio` and `Dio -> Abrahamo`.
- Italian cleanup now filters residual helper/connector labels such as `Aveva` and strips sentence-start prefixes such as `Così/Cosí` before candidate labels are persisted.
- Italian cleanup now filters additional capitalized sentence-start/common-word labels such as `Eravamo`, `Siamo`, `Sono`, `Dopo`, `Qualcosa`, `Semplice`, `Vecchio`, `Via`, `Uscita`, `Ogni` and `Presto`.
- Quote extraction now rejects digit-heavy fragments and page/chapter artifacts such as `112 L’`, requiring at least two lexical words before a quote entity can enter the graph.
- Symbol extraction now rejects generic all-caps Italian words such as `ABITA`, `COMPIUTO`, `MEDIANTE` and `SANGUE`; only technical/acronym-like tokens such as `HIV`, `AIDS`, `API`, `RAG` or tokens with digit/separator markers are kept as symbols.
- Entity extraction cleanup now falls back to the document id found on input chunks when `payload.documentId` is absent, so stale entities from the same document are removed on regeneration instead of lingering in graph exports.
- Knowledge Graph snapshots now apply the same weak-entity and stopword filters as extraction, so stale low-quality entities already stored in IndexedDB are not counted or rendered even before a full extractor rerun.
- Knowledge Graph inspector/View Graph now applies the same UI-side weak-entity filter before rendering or `Copy Data`, so raw IndexedDB entities such as stale all-caps symbols do not leak back into graph exports.
- View Graph export now has two explicit actions: `Copy Graph` exports only connected entities/relations, while `Copy With Isolated` includes filtered isolated entities for full audit exports.
- View Graph canvas now opens zoomed out at 85% with no default selected node, keeps non-focused nodes more readable when a node is selected and clears focus by clicking the canvas background.
- View Graph canvas now disposes pending animation frames and pointer handlers before rerender/close, preventing repeated dialog opens from leaving active canvas work behind.
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
- Step 9 Knowledge Graph quality and analytics is closed after user verification with the Liber story export: `heals` resolves to `té de color rojo -> Liber`, `says` resolves only to `Liber -> QUIERO HABLAR`, and graph exports no longer include the earlier quote/location or nearby-supporter false positives.
- Step 5 AI Agent RAG verification is closed after user verification in the `AI RAG Debug` inspector: the Knowledge Sample AI Answer job shows a populated `RAG query`, non-empty `RAG context`, result metadata and scoped Knowledge Sample context.
- Sample Test now includes `Knowledge Graph Test`, a focused preset that creates `Manual JSON -> Document Store -> Chunk Processor -> Entity Extractor -> Knowledge Graph -> Preview`, emits a sample narrative document and waits for a valid `knowledge.graph.snapshot`; the graph node is triggered by the relation-created channel to avoid duplicate visual links/snapshots.
- Knowledge Graph Test cleanup now also removes stale runtime dependencies by preset id/source before recreating the graph pipeline, preventing overlapping duplicate edges on a single port after reruns.
- Knowledge Graph Test link records now match the existing Knowledge Test pattern: runtime dependencies use a `dep_*` id, carry `connectionId`, source/target types and the connection record stores `channel` plus endpoint/node refs so dependency repair does not create duplicate visual links.
- Event Bus broadcast delivery is now scoped by `workspaceId`, preventing two open Flow Map tabs from consuming each other's Knowledge Graph Test events through the shared BroadcastChannel.
- Flow Map refresh now guards against overlapping `loadRuntime` calls and avoids restarting an already-running runtime worker for the same workspace, reducing renderer pressure from the 15s auto-refresh loop.
- Flow Map startup supports `repair=knowledge-graph`, which removes stale Knowledge Graph sample nodes/edges/events/logs and oversized runtime records for the selected workspace before the first render; runtime event/log payloads are also capped for UI rendering.
- Flow Map startup also supports `repair=hard`, a workspace-scoped runtime graph reset for plugin workspaces with corrupt node/edge records that crash after first render.
- Added standalone `flowMapRepair.html`, a minimal IndexedDB repair page that does not load Flow Map and can delete all records referencing a corrupted workspace, including pages/widgets/runtime/knowledge stores.
- Knowledge Graph View now falls back to the latest snapshot document in the node collection when the node config still points to an older/sample `documentId`, so uploaded-document graphs are visible without manually editing node config.
- Knowledge Graph Debug/View now surfaces `Configured document`, `Latest snapshot document`, `Viewing document`, and a document status flag so stale config vs latest snapshot mismatches are visible.
- Flow Map canvas now uses world-unit node coordinates instead of viewport-percent placement for newly generated nodes, with viewport-aware edge canvas drawing and per-node width persisted in `flowPosition.width` via a node resize handle.
- Flow Map world-canvas follow-up is user-verified: new Flow Maps render/delete `Flow In` and `Flow Out`, Sample Test presets no longer overlap, and IndexedDB version-change warnings after DB reset were confirmed non-blocking in the tested flow.

## Next Logical Step

Knowledge Dictionary Runtime foundation.

Target behavior:

- add a scoped lexical layer before graph construction, not a new hardcoded relation-rule list;
- keep existing graph-builder work as reusable infrastructure and validation, not disposable code;
- dictionary entries should update when documents are regenerated and be removed with document cleanup; base behavior is implemented in `knowledge-dict-1`;
- Flow Maps and Knowledge Graphs should remain isolated unless the user explicitly links or promotes dictionary knowledge;
- debug panels should make dictionary terms, type candidates, aliases, evidence and promotion scope inspectable without raw IndexedDB access.

## Required Updates When Work Changes

- Update this file.
- Update `docs/ai/task-registry.md`.
- If architecture changes, update `docs/ai/decisions.md`.
