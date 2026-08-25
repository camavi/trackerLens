# Runtime Collections

Purpose: SQLite collection overview and ownership.
Read when: changing persistence or collection access.
Do not read when: working only on UI styling.
Last updated: 2026-06-11.

## Core Collections

- `tl_widgets`: boxLens/boxTracker assets.
- `tl_pages`: workspaces/pages.
- `tl_connections`: persisted connections.
- `tl_settings`: global/local settings.

## Runtime Collections

- `tl_runtime_nodes`
- `tl_runtime_dependencies`
- `tl_channels`
- `tl_flows`
- `tl_events`
- `tl_flow_logs`
- `tl_box_performance`
- `tl_time_travel_snapshots`

## AI Collections

- `tl_ai_providers`
- `tl_ai_agents`
- `tl_ai_runtime`
- `tl_ai_jobs`
- `tl_ai_logs`
- `tl_ai_memory`
- `tl_ai_prompts`
- `tl_ai_metrics`

## Knowledge Collections

- `tl_knowledge_documents`: workspace-scoped local documents and text sources.
- `tl_knowledge_chunks`: chunk records derived from documents.
- `tl_knowledge_embeddings`: local embedding vectors for chunks.
- `tl_knowledge_entities`: extracted entities with provenance.
- `tl_knowledge_relations`: graph relations between entities, starting with local `co_occurs` relations.
- `tl_knowledge_queries`: RAG/search query history and results.
- `tl_knowledge_sources`: document source records.
- `tl_knowledge_metrics`: Knowledge runtime metrics, including local graph snapshot counters.

## Rule

## Rule

- SQLite is owned exclusively by `core/desktop/desktop-persistence.cjs` through TL Core.
- Renderer, workers, Python and packages use only the restricted preload/Core repository APIs; never raw SQL, a file path or a database handle.
- Use existing collection constants in `js/TlConfig.js` and the relevant `core/runtime/` module.
- Add a collection only by extending the Core allow-list and schema deliberately; do not create browser-side persistence.
