# AI Documentation Index

Purpose: routing table for AI-readable documentation.
Read when: unsure which file contains needed context.
Do not read when: the target module is already known from `AI.md`.
Last updated: 2026-06-11.

## Core Files

- `project-state.md`: current product and implementation reality.
- `current-focus.md`: active task, next step, recent changes.
- `architecture.md`: rules that should shape implementation decisions.
- `file-map.md`: which files own which behavior.
- `task-registry.md`: task status overview.
- `decisions.md`: architectural decisions that should not be re-litigated.
- `cmswift-guidelines.md`: local CMSwift rules.

## Flow Map Files

- `flow-map/overview.md`: Flow Map role and runtime graph model.
- `flow-map/prompt-chat.md`: AI Flow Chat, planner, query tools and memory.
- `flow-map/safe-executor.md`: mutating commands, snapshots and validation.
- `flow-map/endpoint-research.md`: endpoint discovery and verification.
- `flow-map/runtime-graph.md`: runtime node/dependency graph behavior.

## Runtime Files

- `runtime/stores.md`: IndexedDB stores and ownership.
- `runtime/channels.md`: channel registry and event bus.
- `runtime/dependencies.md`: dependency safety model.
- `runtime/connected-node-tools.md`: Agent/LLM protocol for discovering and querying connected node tools.
- `runtime/ai-memory.md`: workspace/global/short AI memory.

## Archive

- `archive/summary-2026-05.md`: compact historical summary.
- `archive/summary-2026-06.md`: compact recent summary.

Archive is optional. Do not read it unless history is needed.
