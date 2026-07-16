# Runtime Contract

Purpose: official Workspace/Page to runtime graph contract.
Read when: changing workspace scope, Flow Map loading, node config, connections, channels, events or runtime persistence.
Do not read when: working only on visual styling.
Last updated: 2026-06-11.

## Contract Chain

Trackers Lens uses this canonical runtime chain:

```txt
Workspace/Page -> Flow -> Runtime Nodes -> Runtime Dependencies -> Connections -> Channels -> Events/Flow Logs
```

`tl_pages` is the workspace/page store. There is no separate `tl_workspaces` store in the current architecture.

## Stores

- Workspace/Page: `tl_pages`
- Flow: `tl_flows`
- Runtime Nodes: `tl_runtime_nodes`
- Runtime Dependencies: `tl_runtime_dependencies`
- Connections: `tl_connections`
- Channels: `tl_channels`
- Events: `tl_events`
- Flow Logs: `tl_flow_logs`

## Ownership Rules

- A Flow belongs to one workspace/page via `workspaceId`.
- Runtime Nodes are materialized instances in a workspace, not global library assets.
- Runtime Dependencies represent graph edges inside the runtime graph.
- Connections are persisted user/runtime links and may be mirrored into runtime dependencies.
- Channels are named runtime contracts and carry last emission metadata.
- Events/Flow Logs are runtime observations, not configuration.

## Schema/Form Rules

- Node configuration fields come from `settingsSchema` first, then node-specific runtime fields.
- Use `TrackerLensRuntimeContract.normalizeSettingsSchema` before rendering schema-driven config fields.
- Hardcoded form fields are allowed only for behavior-specific controls such as Telegram helpers or file upload.
- Do not create a parallel form builder for Flow Map runtime config.
- Knowledge `Graph Query` evidence controls (`evidenceMode`, `maxEvidence`, `includeAdjacentChunks`, `preserveDocumentOrder`, `protectedEvidence`) are normal node config fields. Keep them in the shared schema/custom-field path so existing Graph Query nodes can surface new retrieval controls without recreating the node.

## Payload Editor Rules

- Runtime nodes can store editable payload rows in `metadata.config.payloadItems`.
- Each item uses `{ key, label, value, type, options, enabled, visible }`.
- Supported first-pass item types are `string`, `int`, `float`, `boolean`, `note`, `select` and `json`; `select` options are stored as comma/newline-separated text.
- `enabled` controls whether the item is applied to runtime payload/config.
- `visible` controls whether the item is rendered on the node card.
- Manual JSON nodes rebuild `metadata.config.json` from enabled payload items on save.
- Graph Query and Task nodes can use payload items to override the same-named config fields while still keeping the normal config form as the complete source of truth.

## Connection Mapping Rules

- Persist mapping on `tl_connections.mapping`.
- Mirror mapping on runtime dependency `metadata`.
- Required mapping fields: `sourcePort`, `targetPort`, `channel`, `mode`, `payloadPath`, `transform`, `note`, `linkType`.
- Runtime links must keep port validation before persistence.
- Runtime adapters execute supported mapping modes before node-specific processing.

Supported execution modes:

- `pass-through`: forwards payload unchanged, or `payloadPath` if provided.
- `path`: forwards only the value at `payloadPath`.
- `json-map`: maps fields from a JSON object such as `{ "price": "number:data.c" }`.
- `template`: renders `{{path.to.value}}` tokens and parses JSON output when possible.
- `custom-transform`: stored but not executed until sandboxed.

Runtime adapters currently applying mapping:

- Processor runtime
- AI Agent runtime
- Orchestrator Agent runtime
- Action runtime
- Storage runtime

Mapping execution writes flow logs when a mapping changes payload or produces warnings.

## Runtime Helper

The code helper is `core/runtime/runtime-contract.js`.
