# Python Node SDK

Purpose: document the minimal safe SDK and capability routing introduced after the Python Test POC.
Read when: adding a built-in Python node, declaring Python capabilities or changing Python execution context.
Do not read when: migrating persistence, adding external Python packages or changing ordinary JavaScript nodes.
Last updated: 2026-08-25.

## Phase 6: Minimal SDK

`runtimes/python/tl_python_sdk.py` provides:

- `@node(id, capabilities=...)` for explicit handler registration;
- `NodeContext.execution_id` and read-only TL execution context;
- `ctx.log(...)`, `ctx.progress(...)` and `ctx.cancelled`;
- normalized dictionary outputs.

The SDK deliberately provides no database, filesystem, network, subprocess, memory or knowledge APIs. Any future TL capability must be introduced through a permissioned TL Core contract first.

## Module and Dependency Direction

Built-in Python nodes should be thin adapters over established Python modules,
not new implementations of existing specialist algorithms. The node manifest
must declare its capability plus Python module/pack requirements, exact
version constraints or a lockfile, environment class and managed install
policy. The SDK must never install dependencies itself.

Runtime Manager resolves those requirements only in an approved managed
environment. If a requirement is absent, TL presents an explicit trusted-pack
install or fallback/unavailable outcome; it never performs an implicit network
install. Execution diagnostics must retain the resolved module, version,
environment and provenance.

`tl_python_worker.py` registers only the POC handlers. `text.transform` is the only normal capability; delay/exception/crash handlers are development diagnostics.

## Phase 7: Capabilities

Nodes declare capabilities in their `execution` manifest. `RuntimeManager.resolveCapability(capability)` resolves a ready registered runtime without callers selecting a language. The Python Test node declares `text.transform`; its implementation happens to be Python, but Flow contracts remain capability-oriented.

Capability registration is feature-gated with the Electron Python POC bridge. Browser and normal desktop mode resolve `text.transform` as unavailable rather than falling back to JavaScript.
