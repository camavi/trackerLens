# Channels And Events

Purpose: channel/event architecture.
Read when: changing channel registry, event bus, event logs or Flow Map routing.
Do not read when: unrelated UI work.
Last updated: 2026-06-11.

## Channel Model

Channels are named runtime contracts between producers and consumers.

Producers:

- sources
- trackers
- processors
- AI agents
- actions/storage when they emit output

Consumers:

- processors
- knowledge runtime nodes
- AI agents
- lens
- actions
- storage
- preview/dev nodes

Knowledge channels:

- `knowledge.document.created`
- `knowledge.chunk.created`
- `knowledge.embedding.created`
- `knowledge.search.query`
- `knowledge.search.results`
- `knowledge.entity.created`
- `knowledge.relation.created`
- `knowledge.rag.context`

## Main Modules

- `core/runtime/channel-registry.js`
- `core/runtime/event-bus.js`
- `core/runtime/event-log-store.js`

## Rules

- Register channels for runtime nodes.
- Record emissions when runtime publishes data.
- Keep channel rename/delete dependency-aware.
- Do not silently fallback when a requested port/channel is missing.
