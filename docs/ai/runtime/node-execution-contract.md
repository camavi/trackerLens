# Node Execution Contract

Purpose: describe the versioned, multi-runtime-capable node execution envelope.
Read when: changing node manifests, execution routing, runtime selection, progress, cancellation, metrics or Python-node integration.
Do not read when: changing only node visuals or existing JS runtime behavior.
Last updated: 2026-08-25.

## Phase 3 Contract

Implementation: `core/runtime/node-execution-contract.js`.

Contract version: `tl-node-execution/v1`.

`execution` is a new manifest field, distinct from the legacy `runtime` metadata used by the current UI. It includes:

- `runtime`: `javascript` or `python`;
- `entry`, `capabilities`, `dependencies` and permissions supplied by the manifest;
- timeout/cancellation metadata;
- a versioned request with execution, node, workspace, flow and job identity;
- a normalized result with outputs, metrics, diagnostics, lifecycle events and provenance.

## Managed Python Dependencies

`execution.dependencies.python` is normalized as a declarative requirement:

```json
{
  "environment": "nlp",
  "requirements": [
    { "name": "sentence-transformers", "version": "==selected-version" }
  ],
  "lockfile": "python/nlp.lock",
  "installPolicy": "managed-optional"
}
```

Supported install policies are `bundled`, `managed-required` and
`managed-optional`. The contract only carries requirements; neither a node nor
the renderer/worker can install packages from it. Runtime Manager must resolve
the requirement in an approved environment, with explicit user consent for a
non-bundled install, before a Python capability is made available.

## Compatibility and Routing

- A manifest without `execution` normalizes to legacy `javascript` execution.
- Existing node IDs, ports, flow payloads and stored records remain unchanged.
- JavaScript is the only available runtime outside Electron POC mode.
- An explicit `python` manifest is represented but rejected as `Runtime unavailable: python` unless the feature-gated Electron POC bridge registers that runtime; it never silently runs through JavaScript.
- The Runtime Manager will become the routing owner in the next phase. This contract does not execute nodes itself.
