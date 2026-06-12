# AI Memory

Purpose: AI memory model and next step target.
Read when: implementing Step 5 or memory retrieval.
Do not read when: unrelated Flow Map work.
Last updated: 2026-06-12.

## Store

- `tl_ai_memory`

## Scopes

- `short`
- `workspace`
- `global`

## Existing API Direction

Use `TrackerLensAiRuntimeStore` for:

- remembering events/decisions
- listing memory
- building memory context
- cleanup/forget operations
- pinning memory records that must survive short-memory cleanup

## Step 5 Target

Base implemented 2026-06-11:

- successful Flow Agent Apply writes a generic apply outcome;
- confirmed rename/duplicate actions write `node-alias` facts;
- confirmed endpoint config updates write `endpoint-choice` facts;
- Flow Agent planning enriches runtime node search with confirmed aliases;
- AI command normalization receives confirmed memory context;
- DevTools exposes memory `kind` in the AI Runtime table.
- DevTools exposes Pin/Unpin and Forget controls for stored memory records;
- pinned memory is ranked ahead of normal memory and short-memory cleanup does not delete it;
- DevTools memory dialog surfaces text, tags and provenance from JSON `meta`.
- Flow Agent stores explicit user preference memory from "ricordati/remember" style prompts;
- Flow Prompt Chat exposes focused memory recall diagnostics for rename/duplicate aliases.
- Step 5 preference memory was manually verified in Flow Map AI Chat.
- Runtime error diagnosis memory stores structured provenance: record id, node, cause, suggestion and fix hint.

Remaining hardening:

Memory should store confirmed facts:

- no active blocker; keep avoiding noisy transient logs unless summarized

Memory should not store:

- unverified guesses
- failed endpoint suggestions as truth
- noisy transient logs unless summarized
