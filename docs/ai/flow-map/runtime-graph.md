# Runtime Graph

Purpose: Flow Map runtime graph behavior.
Read when: changing graph load/save, nodes, dependencies or runtime scope.
Do not read when: only changing chat text/UI.
Last updated: 2026-06-11.

## Stores

- `tl_runtime_nodes`
- `tl_runtime_dependencies`
- `tl_flows`
- `tl_connections`
- `tl_channels`
- `tl_events`
- `tl_flow_logs`

## Rules

- Runtime graph is workspace-scoped.
- Nodes are materialized runtime instances.
- Dependencies represent runtime graph edges.
- Channels are shared runtime contracts, not just labels.
- Flow Map should reload runtime after structural mutations.
- The canonical chain is `Workspace/Page -> Flow -> Runtime Nodes -> Runtime Dependencies -> Connections -> Channels -> Events/Flow Logs`.
- `tl_pages` is the workspace/page store; there is no active `tl_workspaces` store.
- Connection mapping is stored on `tl_connections.mapping` and mirrored into dependency `metadata`.

## Helpers

- `TrackerLensRuntimeGraphStore`
- `TrackerLensChannelRegistry`
- `TrackerLensRuntimeSnapshotStore`
- `TrackerLensGraphEngine`
- `TrackerLensEventLogStore`
- `TrackerLensRuntimeContract`

## Knowledge Graph Query Evidence

`Graph Query` builds `knowledge.graph.context` from persisted graph data, event chains and source chunks. Its evidence behavior is configurable on the node so answer quality can be tuned without changing runtime code.

- `Evidence mode` defaults to `balanced`.
- `focused` keeps the lowest-cost ranked evidence path.
- `balanced` keeps ranked evidence and enables protected mechanism evidence for process/healing/cause questions.
- `full_ordered` passes all scoped chunks in document order. Use it for QA or maximum recall; it can increase prompt size and downstream token cost.
- `debug_trace` uses balanced retrieval and makes the retrieval/debug intent explicit. Graph Query emits `debug.evidenceTrace` for QA.
- `Max evidence chunks` caps ranked/protected evidence except in `full_ordered`, where scoped chunks are intentionally preserved.
- `Include adjacent chunks` can add neighboring chunks around protected mechanism evidence when there is room in the evidence window.
- `Preserve document order` sorts selected evidence by document order before emission. `full_ordered` always preserves document order.
- `Protected evidence` keeps setup/operation/outcome chunks for mechanism-style questions from being dropped only because their lexical score is lower than the final-scene chunk.

The evidence trace lists selected/excluded chunks with score, reasons, query-token matches, seed-label matches, event-chain matches and protected classification. This is the primary QA surface when a relevant chunk exists in the document but does not reach the answer node.
