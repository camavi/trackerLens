# Decisions

Purpose: important decisions that should guide future work.
Read when: a change might conflict with architecture or product direction.
Do not read when: making narrow UI/code fixes.
Last updated: 2026-08-25.

## Product

- Trackers Lens is a local AI Runtime Operating Environment.
- Runtime graph and event flow matter more than dashboard layout.
- Flow Map is the primary runtime graph surface.

## Runtime

- Runtime objects are workspace-scoped unless explicitly global.
- Global Library assets are not automatically Flow Map nodes.
- Runtime graph nodes/dependencies live in runtime stores.
- Channels are first-class runtime objects.
- The official contract is `Workspace/Page -> Flow -> Runtime Nodes -> Runtime Dependencies -> Connections -> Channels -> Events/Flow Logs`.
- `tl_pages` remains the workspace/page store; do not introduce `tl_workspaces` without an explicit migration.
- Schema-driven Flow Map config should use `TrackerLensRuntimeContract` instead of a parallel form system.
- Electron is the desktop shell. Its main process owns lifecycle and validated OS/IPC integration; it must not absorb TL runtime, memory, knowledge or storage logic.
- Electron renderers remain sandboxed and context-isolated with Node integration disabled. Preload exposes only narrowly scoped, validated APIs.
- TL Core is Electron-independent. Electron Main adapts OS actions into its allow-listed command contract; Renderer code cannot call arbitrary IPC or receive persistence/runtime handles.
- Node runtime is explicit through `tl-node-execution/v1`. Legacy manifests use JavaScript by default; an unavailable declared runtime is a visible execution failure, never an implicit JavaScript fallback.
- Runtime Manager wraps the existing JavaScript controller instead of duplicating it. Only a registered runtime may execute; unavailable future runtimes fail before the existing task callback runs.
- Python POC execution is Main-process owned, opt-in and standard-library-only. The renderer receives narrow TL Core commands, never process/DB handles; POC success does not authorize migration of existing nodes.
- The first Python Flow node is a development-only `Python Test` processor. It owns no persistence, shares the existing Event Bus and has explicit output, error and status channels; the node is absent unless Electron POC mode is enabled.
- SQLite is the sole Electron desktop persistence target and current product authority, owned by TL Core. IndexedDB is disposable development/browser-compatibility residue, never a desktop fallback or rollback path. Python/renderer/package runtimes receive neither a database handle nor raw SQL.

## Knowledge Answer Ownership

- This is a hard boundary: TL cleans, organizes, ranks and grounds evidence, but TL must not semantically narrow the final answer.
- Knowledge nodes may improve chunk quality, deduplicate evidence, preserve document order, expose source spans, validate quotes and remove mechanically broken fragments.
- Intent-aware retrieval/scoring may classify generic needs such as source, mechanism or danger/challenge to rank evidence better, but this classification is only for evidence selection and diagnostics.
- LLM-first Knowledge modes may propose retrieval terms, dictionary entries, events, entities or relations, but TL must validate local evidence before persisting or forwarding them.
- Knowledge nodes must not force response brevity, decide final wording, replace provider output, or hide semantically relevant evidence just because a local rule thinks it is less important.
- The downstream LLM owns answer wording, level of detail, tone and selection of supplied details according to the user's prompt.
- If a Knowledge cleanup rule starts deciding which meaning is allowed in the answer, treat it as a guardrail regression and remove or make it explicitly user-configurable.

## Safety

- Mutations must use the Flow Agent tool registry and safe executor.
- Apply must revalidate each step against current runtime state.
- Time Travel snapshots should be captured before runtime writes.
- High-impact deletes require explicit confirmation.
- Custom Node packages may include JavaScript, assets, files and schemas, but TL must not claim arbitrary JS is 100% safe. Official Marketplace nodes require verification/signing and may be marked `verified`; local/external installs must be visibly marked unverified/local-dev with explicit warnings and permission gates.

## Endpoint Research

- The assistant must not invent endpoints.
- Research candidates must include source/verification context.
- Discovered endpoints are not written automatically.
- User must click/select a candidate or provide explicit URL before Apply.

## Documentation

- `AI.md` is the only mandatory markdown entrypoint.
- Do not recreate large monolithic files like the old `INFO_AI.md`.
- Prefer small module-specific markdown files with `Purpose`, `Read when`, `Do not read when`.
