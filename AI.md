# Trackers Lens AI Entry Point

Purpose: minimal entrypoint for AI agents working on Trackers Lens.
Read when: always, before touching code.
Do not read when: never; this file is intentionally short.
Last updated: 2026-08-27.

## Read Order

1. Read this file.
2. Read `docs/ai/current-focus.md`.
3. For substantial tasks, read `docs/ai/project-state.md`.
4. Read `docs/ai/file-map.md` when deciding which implementation files to inspect.
5. Read only the module file that matches the work area.
6. Read `docs/ai/task-registry.md` only when changing task status.
7. Read archive files only when history is explicitly needed.

## Module Map

- Project state: `docs/ai/project-state.md`
- Documentation router: `docs/ai/index.md`
- Current active work: `docs/ai/current-focus.md`
- Architecture rules: `docs/ai/architecture.md`
- File ownership map: `docs/ai/file-map.md`
- CMSwift usage: `docs/ai/cmswift-guidelines.md`
- Tasks: `docs/ai/task-registry.md`
- Decisions: `docs/ai/decisions.md`
- Flow Map overview: `docs/ai/flow-map/overview.md`
- Flow Chat agent: `docs/ai/flow-map/prompt-chat.md`
- Safe executor: `docs/ai/flow-map/safe-executor.md`
- Endpoint research: `docs/ai/flow-map/endpoint-research.md`
- Runtime graph: `docs/ai/flow-map/runtime-graph.md`
- Runtime stores/channels/dependencies: `docs/ai/runtime/`
- Runtime contract: `docs/ai/runtime/contract.md`
- Electron/TL Core boundary: `docs/ai/runtime/desktop-core.md`
- Desktop SQLite persistence: `docs/ai/runtime/desktop-persistence.md`
- Multi-runtime node contract: `docs/ai/runtime/node-execution-contract.md`
- Runtime Manager: `docs/ai/runtime/runtime-manager.md`
- Managed Python POC: `docs/ai/runtime/python-poc.md`
- Python Node SDK and capabilities: `docs/ai/runtime/python-node-sdk.md`
- Python node suitability audit: `docs/ai/runtime/python-node-audit.md`
- Python migration direction: `docs/ai/python_migration_guide.md`
- Managed Python packs, installation and Runtime Python e Modelli: `docs/ai/runtime/python-node-sdk.md`, plus `docs/ai/current-focus.md`
- Python Hybrid RAG and CrossEncoder reranking: `docs/ai/current-focus.md` and `docs/ai/task-registry.md`
- Agent runtime: `docs/ai/runtime/agent-runtime.md`
- Connected node tools: `docs/ai/runtime/connected-node-tools.md`
- AI memory runtime: `docs/ai/runtime/ai-memory.md`
- Custom node packages: `docs/ai/runtime/custom-node-packages.md`
- Knowledge runtime: `core/runtime/knowledge-runtime.js`, plus `docs/ai/current-focus.md` and `docs/ai/task-registry.md`
- API/backend integration: `docs/ai/api-backend.md`
- Archive summaries: `docs/ai/archive/`

## Non-Negotiable Rules

- Trackers Lens is a local AI Runtime Operating Environment, not a dashboard builder.
- Use existing runtime modules in `core/runtime/` before adding new systems.
- Use CMSwift for app UI: dialogs, toolbar, panels, forms, tables, tabs, inspectors and controls.
- Keep canvas, node cards, graph links and live visual layers custom only where runtime interaction requires it.
- Do not invent endpoint URLs or domain-specific data. Endpoint discovery must be attributed and confirmed.
- Mutating Flow Agent commands must go through the registered tool layer and safe executor.
- Destructive operations must be dependency-aware and must preserve user data unless explicitly confirmed.
- Do not hardcode Trackers Lens limits that hide, truncate, cap or partially save runtime data, prompts, tokens, chunks, debug traces, previews or exports. User-configured limits are allowed; internal safeguards must be opt-in/configurable and must never override explicit user settings or prevent full inspection.
- Update `docs/ai/current-focus.md` and `docs/ai/task-registry.md` when task state changes.

## Legacy Markdown Policy

The old large markdown files were replaced by `docs/ai/*` to reduce token load.
Do not recreate large monolithic project memory files.
