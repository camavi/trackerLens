# Architecture Rules

Purpose: high-level engineering constraints.
Read when: planning or implementing non-trivial changes.
Do not read when: only updating docs or copy.
Last updated: 2026-06-11.

## Runtime Model

Trackers Lens should be implemented as:

```txt
Sources -> Trackers -> Channels -> Processors -> AI Agents -> Lens -> Actions/Storage
```

Flow Map is the visual/runtime graph for this model.

The official persistence contract is:

```txt
Workspace/Page -> Flow -> Runtime Nodes -> Runtime Dependencies -> Connections -> Channels -> Events/Flow Logs
```

`tl_pages` is the current workspace/page store; do not add `tl_workspaces` unless the architecture is explicitly migrated.

## Persistence

Use IndexedDB and existing stores/helpers.
Prefer `core/runtime/` modules for runtime behavior.
Do not add parallel stores unless the existing model cannot represent the data.
Use `core/runtime/runtime-contract.js` for shared runtime contract/schema normalization.

## Safety

Before deleting, renaming or changing runtime objects, inspect dependencies:

- channels
- connections
- subscribers
- runtime nodes
- runtime dependencies
- workspace references
- events/logs
- AI agents/actions/processors/storage

Destructive operations must either be blocked, explicitly confirmed, or routed through force/delete cleanup helpers.

## UI Framework

Use CMSwift for application UI:

- dialogs
- toolbar
- tables
- inspectors
- forms
- tabs
- controls
- buttons
- cards/panels

Custom DOM/CSS is acceptable for graph canvas, node rendering, connection overlays, live pulses and highly specific runtime visuals.

## AI Agent Rules

- Do not invent endpoints, credentials, provider settings or domain-specific placeholders.
- AI-normalized commands are suggestions only; local validation decides what can be applied.
- Apply must revalidate every mutation immediately before writing.
- Time Travel snapshots should be captured before mutating runtime graph state.
