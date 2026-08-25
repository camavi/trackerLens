# Runtime Manager

Purpose: describe execution-runtime registration, routing and health ownership.
Read when: changing execution routing, runtime workers, health, capabilities, cancellation, timeout or crash recovery.
Do not read when: changing only node UI or persisted Flow data.
Last updated: 2026-08-25.

## Phase 4 Base

Implementation: `core/runtime/runtime-manager.js`.

The Manager registers one executor in this phase:

- `javascript` — worker id `renderer-js-worker`, with Flow execution, Event Bus and node-controller capabilities.

`TrackerLensNodeExecutionController` delegates existing node tasks to the Manager. The JavaScript executor invokes the same task callback as before, preserving existing runtime behavior and result payloads.

## Routing and Health

- Runtime selection comes from `manifest.execution`.
- Missing/legacy execution metadata resolves to JavaScript.
- The Manager exposes executor status, worker id, capabilities, start/heartbeat timestamps, active/completed/failed jobs, restart count and last error.
- Explicit `python` nodes fail with `RUNTIME_UNAVAILABLE`; Python is not registered or started.
- `resolveCapability(capability)` resolves a ready runtime by declared capability rather than by language. `text.transform` resolves to Python only while Electron POC mode is active.

In Electron POC mode only, the Manager also registers the `python` executor when the restricted preload bridge is present. It delegates the Python Test node task to TL Core; process supervision and transport remain Main-owned. Browser/normal desktop mode still has JavaScript only.
