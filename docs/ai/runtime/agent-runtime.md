# Agent Runtime

Purpose: runtime control layer for Trackers Lens agentic flows.
Read when: changing flow run/debug, runtime tools, traces, safe fix suggestions or Codex-like agent behavior.
Do not read when: working only on Flow Chat wording or visual styling.
Last updated: 2026-07-10.

## Direction

Trackers Lens does not embed Codex directly. The product builds its own local-first Agent Runtime:

- LLM/Brain can plan.
- Runtime tools inspect and execute controlled actions.
- Safe executor/preflight validates mutations.
- Runtime traces show what happened.
- Fix suggestions remain explicit and reversible.

Internal APIs, tool names and runtime schema use English. UI labels can be localized later through a dedicated i18n layer.

## v1 Surface

Implementation: `core/runtime/agent-runtime.js`.

Global: `window.TrackerLensAgentRuntime`.

Flow Map UI: the topbar `Agent Run` button opens a diagnostic dialog for inspect, dry-run trace, safe fix suggestions and raw inspect export. Trace steps are expandable and show node id, channel, ports, dependency id, expected IN/OUT and the latest matching runtime event payload when available. Each trace step can focus the node on the canvas or open an Agent Runtime node inspect record. Node inspect records render a readable summary first and keep full raw JSON in a collapsible debug section. Safe fix suggestions now expose problem, cause, action, risk and preview; safe actions can be applied through existing Flow Map link/mapping paths and automatically refresh inspect, suggestions and trace verification. Apply Fix captures a time-travel snapshot first, exposes Undo Fix, and records a compact Runtime Fix Log. Agent Bridge gaps can be repaired by creating the palette Agent Bridge node and connecting `agent_control -> agent_control`.

Tools:

- `inspectFlow`: summarize graph, roots, leaves, agent nodes and validation issues.
- `runFlow`: create a safe trace-first execution record for a flow; v1 supports `dry-run`, `simulate` and `execute-controlled` modes, with controlled execution still recorded as non-mutating trace-only until worker execution adapters are connected.
- `inspectNode`: inspect node ports, dependencies, recent events and impact.
- `readLogs`: read recent events and flow logs by workspace, node or run.
- `suggestFixes`: propose safe fixes for validation issues, invalid ports, duplicate/broken links, isolated nodes, agent bridge gaps, preview reachability and ambiguous roots.
- `listRuns`: list in-memory Agent Runtime traces.

## Constraints

- v1 does not bypass existing runtimes.
- v1 does not mutate graph state directly from the core runtime.
- Real writes must continue through existing Flow Map node/link/mapping/delete paths and their validation/preflight rules.
- Runtime events are emitted on `agent.runtime.run.completed` for trace visibility.
- Browser UI/debug panels can consume v1 before deeper worker execution is added.
