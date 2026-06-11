# Current Focus

Purpose: active work and immediate next step.
Read when: always after `AI.md`.
Do not read when: never during development sessions.
Last updated: 2026-06-11.

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

Step 5 base is complete:

- Flow Agent memory now stores typed, confirmed workspace facts after successful Apply;
- rename and duplicate actions write node alias memory;
- endpoint config updates write endpoint-choice memory only after validation and Apply;
- Flow Agent planning enriches runtime context with confirmed memory aliases;
- AI command normalization receives confirmed memory context;
- DevTools AI memory table exposes memory kind for inspection without flooding normal chat replies.

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

Runtime contract hardening: browser-verify the new `Mapping Test`, add mapped Storage flow coverage, then return to Step 5 memory controls and stronger retrieval.

Target behavior:

- add explicit forget/pin controls for workspace memory;
- add preference memory from explicit user "remember" style prompts;
- surface memory provenance in Dev inspector detail;
- add focused runtime tests for alias recall after rename/duplicate.

## Required Updates When Work Changes

- Update this file.
- Update `docs/ai/task-registry.md`.
- If architecture changes, update `docs/ai/decisions.md`.
