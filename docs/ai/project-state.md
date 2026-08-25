# Project State

Purpose: short factual state of Trackers Lens.
Read when: starting any substantial task.
Do not read when: only making a tiny typo/style edit with clear scope.
Last updated: 2026-08-25.

## Product Identity

Trackers Lens is a local-first AI Runtime Operating Environment for data, channels, automation and AI agents.
It is not a simple dashboard builder.

The core product direction is:

- workspace-scoped runtime graph
- event bus and channel registry
- safe dependency-aware mutation
- Flow Map as the primary graph surface
- local AI first through Ollama and LM Studio/OpenAI-compatible APIs
- SQLite as desktop local runtime persistence, owned by TL Core
- CMSwift as the app UI framework

## Main Pages

- `library.html`: local asset/workspace library.
- `editorWorkspace.html`: workspace/grid editor.
- `workspace.html`: runtime viewer.
- `flowMap.html`: runtime graph and AI Flow Chat.
- `connections.html`: persisted links and runtime connection inspection.
- `database.html`: legacy browser data explorer; not a desktop persistence authority.
- `analytics.html`: runtime/system analytics.
- `ai.html`: AI Runtime Center.
- `settings.html`: settings/control panel.
- boxLens/boxTracker editing is handled by the shared universal dialog loaded into Workspace, Flow Map, Library and Database Explorer.

## Implementation Reality

- Runtime graph stores and helpers exist in `core/runtime/`.
- Flow Map is workspace-scoped and does not blindly merge global library assets.
- Processor, Action, Storage and AI Agent runtimes exist and are orchestrated by a runtime worker/controller when Flow Map/workspace is open.
- Event logs, channel registry, dependency manager, time travel, package system, offline queue/cache and AI memory exist as usable foundations.
- Some background persistence still depends on an open page; service worker/extension hardening remains future work.
- Electron desktop starts TL Core-owned SQLite in the app-data directory before loading Flow Map.
- `core/desktop/tl-core.cjs` owns the allow-listed desktop persistence boundary; renderer code has no database handle or SQL capability.
- The runtime manifest now carries a backward-compatible `execution` envelope via `tl-node-execution/v1`. JavaScript is the sole available execution runtime; Python is represented only as an unavailable future capability.
- Runtime Manager base is active for Flow Map node execution. It registers JavaScript only and delegates to the existing node-controller task path, preserving current Worker/Event Bus behavior.
- A managed Python development POC exists behind `TL_ENABLE_PYTHON_POC=1`. It is a persistent, isolated standard-library worker used only for protocol validation, not a production Python node runtime.
- Electron POC mode adds one feature-gated `Python Test` processor. It uses the managed worker through TL Core and has no direct persistence access.
- SQLite is the desktop authority. Flow Map Graph Store and snapshot first-cohort operations are routed through TL Core; remaining direct IndexedDB calls are implementation debt to remove, not a fallback.

## Current Risk Areas

- Flow Map Prompt Chat is powerful and high-regression.
- Runtime mutation commands must be validated immediately before writing.
- Endpoint research must not invent URLs or auto-write discovered endpoints.
- Large markdown files should not be recreated; use this indexed docs system.
