# Flow Map Prompt Chat

Purpose: AI Flow Chat behavior and implementation notes.
Read when: changing `js/flow-map/flowMapPromptChat.js`.
Do not read when: unrelated Flow Map visual-only work.
Last updated: 2026-06-11.

## Responsibilities

- Persist workspace-scoped chat history in `tl_flow_prompt_chats`.
- Answer read-only runtime questions from structured context.
- Build Flow Map creation plans from user prompts.
- Build safe mutation plans for command-style requests.
- Use AI provider only as planner/normalizer, never as final authority.

## Planner Levels

- Read-only query tools inspect nodes, edges, channels, runtime logs, settings, AI runtime and memory.
- Mutation planner creates `flow-agent-plan/v1`.
- Safe executor applies only registered ready mutating tools.
- Compound commands are planned step-by-step on simulated context.

## Current Capabilities

- inventory/questions about nodes/channels/links/runtime/config/memory
- Agent Runtime tool context: `inspectFlow`, `suggestFixes`, recent runs and optional dry-run trace can be passed into Brain answers for diagnostics/fix/trace prompts.
- provider health summaries are included in runtime query context so Flow Chat can explain missing model/endpoint/provider problems without relying on console errors.
- Brain RAG includes Agent Runtime and Runtime Contract docs in addition to Flow Chat/Safe Executor/Runtime Graph docs.
- Flow Chat memory ranking considers pattern structure, recency, use frequency, workspace fit and stale penalties.
- explain-only prompts are explicitly blocked from becoming creation plans.
- connect/disconnect
- rename
- config/channel updates
- delete node with dependency confirmation
- duplicate node
- move node
- broken-link cleanup
- endpoint research and explicit endpoint apply
- runtime error assistant and conservative prepare-fix
- compound command chains

## Important Constraints

- Do not write endpoint candidates automatically.
- Do not apply blocked or stale actions.
- Do not bypass `flowPromptValidateAgentAction`.
- Do not bypass Time Travel snapshot capture for Apply.
