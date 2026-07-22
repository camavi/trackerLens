# Connected Node Tool Protocol

Purpose: define how Agent/LLM nodes discover and query connected runtime nodes as tools.
Read when: changing AI Agent, Orchestrator Agent, Knowledge nodes, node capabilities, runtime tools or answer planning.
Do not read when: only changing visual node styling.
Last updated: 2026-07-22.

## Direction

Trackers Lens agents should not depend on a fixed Knowledge pipeline that pre-decides the final answer context.

The Agent owns planning. Connected nodes expose tools. The Agent asks the connected tools for the evidence it needs, verifies the answer from returned evidence, and only then responds or emits actions.

This preserves the work already done in Document Store, Dictionary, Event Builder, Graph Query, Reasoning Composer and previews, but changes their role:

- old role: pipeline stages that decide what the LLM must see;
- new role: interrogable tools that can provide source text, definitions, timelines, graph facts, memories or verification evidence on demand.

## Non-Goals

- Do not replace existing node runtimes.
- Do not delete Knowledge Graph, Dictionary, Event Builder or Reasoning Composer.
- Do not add story-specific filters as the primary answer-quality path.
- Do not let Agents mutate runtime graph state without the existing safe executor/preflight path.
- Do not let connected tools invent facts. Tool results must carry evidence, status and limitations.

## Agent Loop

An Agent node that receives a user question or task should run this loop:

1. Inspect connected nodes and their declared tools.
2. Build a small plan with the minimum tool calls needed.
3. Query tools in steps, observing results before deciding the next call.
4. Ask for broader source evidence when a narrow graph/dictionary/event result is empty, contradictory or low confidence.
5. Verify the draft answer against source-bearing tool results.
6. Respond with the answer, or emit an action only through validated runtime channels.

For answer tasks, source text is the highest-authority evidence. Graph, dictionary and event tools help locate, explain and verify source text; they do not replace it.

## Tool Declaration

Every runtime node can expose an optional `agentTools` declaration in node config, manifest metadata or a runtime capability adapter.

Canonical shape:

```json
{
  "visible": true,
  "tools": [
    {
      "name": "searchChunks",
      "label": "Search Chunks",
      "mode": "read",
      "purpose": "Find source text passages related to a question.",
      "inputs": { "query": "string", "limit": "number" },
      "outputs": { "items": "array", "evidence": "array" },
      "cost": { "tokens": "medium", "latency": "low" },
      "requiresEvidence": true
    }
  ]
}
```

Rules:

- Tool names are English and stable.
- `mode` is `read`, `plan`, `verify` or `mutate`.
- `mutate` tools are only declarations; execution must go through safe executor/preflight.
- Read tools should return evidence, confidence and limitations.
- Tools must be scoped to connected nodes unless the Agent has an explicit workspace-level permission.

## MCP Compatibility

The Connected Node Tool Protocol should be MCP-ready from the beginning, but Trackers Lens must not depend on MCP internally.

Trackers Lens is the local runtime owner. MCP is an adapter boundary that can expose TL node tools to external agents or let TL Agents call external MCP tools through a controlled connector.

Mapping:

- TL `agentTools.tools[]` maps to MCP `tools/list`.
- TL `callConnectedNodeTool` maps to MCP `tools/call`.
- TL source documents, graph snapshots, event timelines and dictionary exports can map to MCP `resources/list` and `resources/read`.
- TL prompts/templates for Agent planning can later map to MCP prompt resources, but final execution authority remains in TL runtime.

MCP naming should be deterministic:

```txt
tl.node.{nodeId}.{toolName}
tl.workspace.{workspaceId}.{toolName}
```

Example:

```json
{
  "name": "tl.node.kdoc_store_1.searchChunks",
  "description": "Search source chunks from the connected Document Store node.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string" },
      "limit": { "type": "number" }
    },
    "required": ["query"]
  }
}
```

Rules:

- MCP-exposed read tools must preserve the same `Tool Result Contract`.
- MCP-exposed mutate tools must return a proposed action/preflight result, not directly mutate TL graph state.
- External MCP tools called by TL must be represented as normal connected tool observations with provider/source metadata and limitations.
- Tool calls must be workspace-scoped and should include `nodeId`, `workspaceId`, `runId` and `agentId` for audit.
- Never expose hidden credentials, provider keys, local file paths or unconfirmed destructive actions through MCP tool descriptions or results.

## Access Topology

Agent tool access is graph-scoped, not workspace-global by default.

Rules:

- An Agent can call tools only on nodes that are in the same connected runtime chain/component.
- A directly linked node is preferred in UI/debug, but multi-hop reachable nodes are valid when the chain connects them.
- Disconnected workspace nodes are invisible to `callConnectedNodeTool` unless an explicit workspace-level permission is added later.
- Disabled dependencies do not grant tool reachability.
- `tool-access` links are access relationships only. They must not subscribe the target node to runtime payload channels, trigger normal processing or replace data-flow links.
- Normal `data` links still own event delivery and builder execution, such as `Document Store -> Chunk Processor -> Dictionary/Event/Entity`.

This lets users simplify layouts. A flow can prepare stores with a short data path, then connect an Agent to the useful tool surface instead of forcing every answer through a long fixed context pipeline.

## MCP Integration Path

MCP Phase A: internal shape alignment.

- Keep `agentTools` close to MCP tool descriptors: stable name, description/purpose, input schema, output contract.
- Keep result envelopes serializable and source-attributed.

MCP Phase B: local MCP server adapter.

- Add a local adapter that lists connected TL node tools for a selected workspace.
- Implement read-only `tools/call` for Document, Dictionary, Event and Graph tools first.
- Expose source documents/timelines/graph exports as resources only when the workspace grants access.

MCP Phase C: external MCP client node.

- Add a TL node type or connector profile that imports tools from an external MCP server.
- External results enter the Agent loop as observations and remain subject to TL verification/safety rules.

MCP Phase D: mutating action bridge.

- Expose only preflighted action proposals over MCP.
- Actual TL mutation must still route through safe executor, user confirmation policy and time-travel snapshot rules.

## First Tool Set

Document-like nodes:

- `getDocumentInfo`: document ids, title, language, chunk count and scope.
- `getFullDocument`: complete source text when size allows or when explicitly requested.
- `searchChunks`: ranked passages by query.
- `getChunkWindow`: source chunks around a chunk id or ordinal.

Dictionary nodes:

- `defineTerm`: meaning, aliases and type candidates for a term in document context.
- `resolveAmbiguity`: possible meanings for an ambiguous word/name.
- `listKeyTerms`: high-value document terms usable for planning.

Event nodes:

- `getTimeline`: ordered events for a query, entity or document.
- `findEvents`: event search by participants, event type or text.
- `verifyEvent`: whether a proposed event is supported by evidence.

Graph/Reasoning nodes:

- `findRelations`: graph relations for query/entity pairs.
- `findEntities`: entity search with aliases/types.
- `getGraphEvidence`: source evidence behind graph facts.
- `composeEvidencePlan`: optional evidence organization, never a final-answer constraint.

Memory nodes:

- `searchMemory`: workspace/user memories relevant to the task.
- `writeMemoryCandidate`: propose memory, requiring user/system confirmation before persistence.

Preview/debug nodes:

- `showObservation`: display tool calls and evidence for QA.
- `showAnswerTrace`: display plan, tool calls, verification result and final answer.

## Tool Result Contract

All tool results should use this envelope:

```json
{
  "ok": true,
  "tool": "searchChunks",
  "nodeId": "node_123",
  "status": "ready",
  "answer": "",
  "items": [],
  "evidence": [
    {
      "sourceType": "document_chunk",
      "documentId": "kdoc_...",
      "chunkId": "kchunk_...",
      "ordinal": 12,
      "text": "Exact source excerpt..."
    }
  ],
  "confidence": 0.82,
  "limitations": [],
  "usage": {}
}
```

Rules:

- `answer` is optional and should be treated as a tool observation, not final output.
- `evidence.text` must be source text or an exact persisted evidence quote when available.
- `limitations` must say when results are partial, empty, truncated or based on derived graph facts only.
- Empty results are useful observations. They should not force the Agent to answer “missing” until broader source tools have been tried.

## Planning Policy

For document QA:

1. Start with `searchChunks` or `getTimeline` if connected.
2. Use `defineTerm` when the question contains ambiguous, misspelled or domain-specific words.
3. Use `findRelations` only after source/document tools or when the question asks explicitly about relations.
4. If graph/event results are empty or narrow, call `getFullDocument` or `getChunkWindow`.
5. Final answer must cite or internally verify against source-bearing evidence.

For automation:

1. Inspect connected action/storage/processor tools.
2. Build a plan.
3. Validate mutating steps through existing safe executor/preflight.
4. Execute only after confirmation when required by node policy.

## Runtime Integration Path

Phase 1: capability manifest only. Base implemented.

- Extend current `nodeCapability` with read-tool declarations.
- Add Agent Runtime inspection for connected tool manifests.
- Keep tool declarations compatible with MCP input schemas and stable tool names.
- No behavior change to existing Knowledge pipelines.
- Current implementation exposes default MCP-ready read manifests for Document, Dictionary, Event, Graph/RAG and Preview-style nodes. `inspectConnectedTools` is read-only and does not execute tools.

Phase 2: read-only tool executor. Document, Dictionary, Event and Graph base implemented.

- Implement a central `callConnectedNodeTool` runtime function.
- Add adapters for Document Store, Dictionary Builder, Event Builder and Graph Query.
- Return observations through a trace channel.
- Current implementation exposes `callConnectedNodeTool` in Agent Runtime and executes read-only document-like tools: `getDocumentInfo`, `getFullDocument`, `searchChunks` and `getChunkWindow`.
- Dictionary tools now execute `defineTerm`, `resolveAmbiguity` and `listKeyTerms` against scoped persisted dictionary records.
- Event tools now execute `getTimeline`, `findEvents` and `verifyEvent` against scoped persisted event records.
- Graph tools now execute `findEntities`, `findRelations` and `getGraphEvidence` against scoped entities, relations and source chunks.

Phase 3: Agent planner uses tools. Orchestrator and AI Agent base implemented.

- Orchestrator/AI Agent prompts receive connected tool manifests.
- Planner returns `call_tool` steps, not only `run_node`.
- Agent can ask follow-up tool calls before answering.
- Current Orchestrator planner prompt supports `call_tool`; planned tool calls execute through `AgentRuntime.callConnectedNodeTool`, emit `agent.tool.observation`, update `lastResult`, and are fed back to the planner as observations. Multi-tool follow-up is allowed with a bounded tool-call limit.
- AI Agent direct-answer base now collects deterministic connected tool observations before building the final LLM prompt. It can query connected Document/Dictionary/Event/Graph tools, inject source-bearing observations into the prompt, emit `agent.tool.observation`, and persist tool context on the AI job/result.

Phase 4: verification trace.

- Agent output includes an internal verification record with source-bearing evidence ids.
- Preview/debug nodes can show the plan, tool calls, evidence and limitations.
- Inspector debug base implemented: selected nodes expose an `Agent Tools` panel that lists connected MCP-ready manifests, can run read-only probe calls through `callConnectedNodeTool`, and shows the latest tool result envelope for QA.

Phase 5: MCP adapter.

- Expose selected connected node tools through a local MCP server adapter.
- Import external MCP tools as connected observations through a controlled MCP client node/connector.

## Open Questions

- Maximum context policy for `getFullDocument`.
- Whether tool traces persist in `tl_events`, `tl_flow_logs` or a dedicated run record.
- How much of this should run in the worker versus page context for local provider/browser APIs.
- Which UI control exposes Agent tool traces without overwhelming normal users.
