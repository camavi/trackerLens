# Project State

Purpose: short factual state of Trackers Lens.
Read when: starting any substantial task.
Do not read when: only making a tiny typo/style edit with clear scope.
Last updated: 2026-06-11.

## Product Identity

Trackers Lens is a local-first AI Runtime Operating Environment for data, channels, automation and AI agents.
It is not a simple dashboard builder.

The core product direction is:

- workspace-scoped runtime graph
- event bus and channel registry
- safe dependency-aware mutation
- Flow Map as the primary graph surface
- local AI first through Ollama and LM Studio/OpenAI-compatible APIs
- IndexedDB as local runtime persistence
- CMSwift as the app UI framework

## Main Pages

- `library.html`: local asset/workspace library.
- `editorWorkspace.html`: workspace/grid editor.
- `workspace.html`: runtime viewer.
- `flowMap.html`: runtime graph and AI Flow Chat.
- `connections.html`: persisted links and runtime connection inspection.
- `database.html`: IndexedDB explorer.
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

## Current Risk Areas

- Flow Map Prompt Chat is powerful and high-regression.
- Runtime mutation commands must be validated immediately before writing.
- Endpoint research must not invent URLs or auto-write discovered endpoints.
- Large markdown files should not be recreated; use this indexed docs system.
