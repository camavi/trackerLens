# Runtime Stores

Purpose: IndexedDB store overview.
Read when: changing persistence or store access.
Do not read when: working only on UI styling.
Last updated: 2026-06-11.

## Core Stores

- `tl_widgets`: boxLens/boxTracker assets.
- `tl_pages`: workspaces/pages.
- `tl_connections`: persisted connections.
- `tl_settings`: global/local settings.

## Runtime Stores

- `tl_runtime_nodes`
- `tl_runtime_dependencies`
- `tl_channels`
- `tl_flows`
- `tl_events`
- `tl_flow_logs`
- `tl_box_performance`
- `tl_time_travel_snapshots`

## AI Stores

- `tl_ai_providers`
- `tl_ai_agents`
- `tl_ai_runtime`
- `tl_ai_jobs`
- `tl_ai_logs`
- `tl_ai_memory`
- `tl_ai_prompts`
- `tl_ai_metrics`

## Knowledge Stores

- `tl_knowledge_documents`: workspace-scoped local documents and text sources.
- `tl_knowledge_chunks`: chunk records derived from documents.
- `tl_knowledge_embeddings`: local embedding vectors for chunks.
- `tl_knowledge_entities`: extracted entities with provenance.
- `tl_knowledge_relations`: graph relations between entities, starting with local `co_occurs` relations.
- `tl_knowledge_queries`: RAG/search query history and results.
- `tl_knowledge_sources`: document source records.
- `tl_knowledge_metrics`: Knowledge runtime metrics, including local graph snapshot counters.

## Rule

Use existing store constants in `js/TlConfig.js`.
Create stores additively through existing runtime helpers.
