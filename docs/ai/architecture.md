# Architecture Rules

Purpose: high-level engineering constraints.
Read when: planning or implementing non-trivial changes.
Do not read when: only updating docs or copy.
Last updated: 2026-08-25.

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

Electron desktop persistence is SQLite-only and Core-owned. Renderer, workers, Python and packages use narrow repository APIs; they never receive SQLite handles, paths or SQL.
Prefer `core/runtime/` modules for runtime behavior.
Do not add parallel stores unless the existing model cannot represent the data.
Use `core/runtime/runtime-contract.js` for shared runtime contract/schema normalization.

## Electron Desktop Shell

- Electron is a desktop host for the existing renderer, not a replacement runtime or a second frontend.
- Keep renderer access restricted: context isolation and sandboxing stay enabled, Node integration stays disabled, and desktop APIs are exposed only through a validated preload bridge.
- Electron main owns windows, lifecycle, validated IPC and OS integration. Runtime, knowledge, memory and storage ownership stay in Trackers Lens modules.
- The initial desktop shell loads `flowMap.html`; Python runtime integration remains a separate later phase.
- `core/desktop/tl-core.cjs` is the Electron-independent boundary for desktop commands. Main adapts OS calls into it; preload exposes only its named, validated API surface.
- Nodes represent TL capabilities, not language classes. Their `execution` contract selects a runtime explicitly; legacy manifests default to JavaScript and unavailable runtimes must reject rather than silently reroute.
- Runtime Manager owns runtime registration, routing and health metadata. The Phase 4 JavaScript executor delegates to the existing node-controller path; Python registration, process lifecycle and transport are later work.
- The Phase 5 Python POC runs only in Electron Main through a restricted TL Core adapter. Renderer code never receives a child-process handle, Python stays feature-flagged and it has no direct persistence access. Its single Flow Map `Python Test` processor uses the existing Event Bus and emits separate output, error and status channels.
- Desktop SQLite is the only desktop persistence mode. It never exposes raw database handles/SQL to renderer, workers, Python or packages.
- Custom Nodes are portable `.tl-node.zip` artifacts imported only by Electron Main/TL Core. Core stores the immutable archive in app data and records its package catalog/provenance in SQLite; Flow Maps retain package references/configuration only. Renderer, workers and packages never receive archive paths or filesystem handles, and imported runtime code remains blocked until the sandboxed-runtime phase.

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
