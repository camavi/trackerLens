# Current Focus

Purpose: active work and immediate next step.
Read when: always after `AI.md`.
Do not read when: never during development sessions.
Last updated: 2026-06-12.

## Active Area

Runtime contract hardening / Flow Map schema-driven configuration and connection mapping.

## Completed Sequence

1. Step 1: runtime/DB query tools.
2. Step 2: dependency-aware commands.
3. Step 3: more realistic endpoint research.
4. Step 4: real compound commands.

## Latest Completed Work

Runtime contract base is complete:

- official Workspace/Page -> Flow -> Runtime Nodes -> Runtime Dependencies -> Connections -> Channels -> Events/Flow Logs contract documented;
- `core/runtime/runtime-contract.js` added as shared contract/schema/mapping helper;
- Flow Map runtime config now normalizes manifest `settingsSchema` before rendering config fields;
- Flow Map link creation now captures explicit connection mapping metadata;
- connection mapping is mirrored from `tl_connections.mapping` into runtime dependency metadata and shown in the edge inspector.
- Processor, AI Agent, Orchestrator Agent, Action and Storage runtimes now execute supported mapping modes before node-specific processing;
- mapping execution logs applied transforms and warnings in flow logs;
- `custom-transform` is intentionally stored but not executed until sandboxing is implemented.
- Preview nodes now display mapped payload, original payload and mapping warnings separately;
- Edge inspector mapping details now show mapping status and copy actions for transform/mapped payload;
- Existing runtime links can reopen `Connection Mapping` from Edge Inspector and persist mapping edits back to connection/dependency metadata;
- Flow Map topbar includes a `Mapping Test` diagnostic that creates Manual JSON -> Preview with a BTC `json-map` transform and emits a mapped test payload.
- Flow Map topbar includes a `Storage Test` diagnostic that creates Manual JSON -> Save DB Record, emits through EventBus and verifies the mapped record persisted to IndexedDB.
- Storage node Inspector now shows the latest persisted IndexedDB record payload with copy/refresh actions.

Step 5 base is complete:

- Flow Agent memory now stores typed, confirmed workspace facts after successful Apply;
- rename and duplicate actions write node alias memory;
- endpoint config updates write endpoint-choice memory only after validation and Apply;
- Flow Agent planning enriches runtime context with confirmed memory aliases;
- AI command normalization receives confirmed memory context;
- DevTools AI memory table exposes memory kind for inspection without flooding normal chat replies.
- DevTools AI memory table now has Pin/Unpin and Forget controls for stored memory records;
- AI memory cleanup preserves pinned short-memory records;
- AI memory dialog now surfaces text, tags and provenance parsed from memory `meta`.
- DevTools AI memory dialog and Pin/Forget controls were manually verified in the AI tab.
- Flow Agent now stores explicit user preference memory from prompts such as "ricordati che...";
- Flow Prompt Chat exposes focused memory recall diagnostics for rename/duplicate aliases.
- Step 5 preference memory was manually verified in Flow Map AI Chat.
- Flow Map Mapping Test and Storage Test were browser-verified successfully.
- Runtime error diagnosis memory now stores structured provenance: record id, node, cause, suggestion and fix hint.
- Endpoint research helper now follows OpenAPI/Swagger specs, accepts explicit spec/doc URLs from the prompt as first-class sources and returns discovery provenance to the Flow Agent UI.

Previous work:

Step 4 base is complete:

- local compound prompts are split into ordered steps;
- each step is planned against a simulated context that includes previous step effects;
- AI-normalized `{ actions: [...] }` and `{ steps: [...] }` use the same simulated context;
- compound steps carry `stepId`, `dependsOn`, `compoundIndex` and `compoundPrompt`;
- duplicated nodes get a planned runtime id so later steps can reference them;
- the safe executor reloads runtime after each mutation before validating the next step.

Example now supported:

```txt
rinomina REST API in Weather API e collega Weather API a Preview
duplica REST API come REST 2 e collega REST 2 a Preview
```

## Next Logical Step

Endpoint research hardening follow-up.

Target behavior:

- browser-test endpoint research from Flow Map AI Chat with an explicit OpenAPI/Swagger spec URL;
- consider provider-specific scoring presets only when backed by fetched documentation;
- keep Mapping/Storage diagnostics available for regression checks.

## Required Updates When Work Changes

- Update this file.
- Update `docs/ai/task-registry.md`.
- If architecture changes, update `docs/ai/decisions.md`.
