# Managed Python POC

Purpose: describe the isolated development proof of concept for the managed Python runtime.
Read when: changing the Python worker protocol, managed process lifecycle, Python POC bridge or Phase 5 tests.
Do not read when: implementing production Python nodes, SDK packages or app-data migration.
Last updated: 2026-08-25.

## Current Direction

The next Python-runtime work follows `docs/ai/python_migration_guide.md`:
production Python nodes should wrap established Python modules through thin TL
adapters, rather than reimplement specialist algorithms. A future node
manifest must declare its Python module/pack requirements, pinned versions or
lockfile and managed install policy. TL Runtime Manager—not the renderer,
worker or node adapter—will resolve, install with explicit consent when
needed, and record the approved environment. This POC deliberately has no
external dependencies and does not implement that production dependency path.

## Scope

`runtimes/python/tl_python_worker.py` is a persistent stdio JSON Lines worker using only the Python standard library. `core/desktop/managed-python-runtime.cjs` owns spawn, request correlation, timeout, cancellation, worker health and stop/restart.

The normal POC capability is `text_transform`: trim and uppercase `inputs.text`. The Flow Map `Python Test` node also exposes development-only `delay`, `raise` and `crash` operations solely to validate cancellation, error handling and recovery. It has no DB, filesystem, network, memory, knowledge or model access.

## Opt-in

The worker is disabled by default. Run Electron POC mode with:

```sh
npm run desktop:python-poc
```

This sets `TL_ENABLE_PYTHON_POC=1`. The renderer only reaches it through the restricted `window.trackers.runtime.pythonPoc` bridge. The Python executor and `Python Test` palette item are absent in normal desktop/browser mode.

## Flow Map Path

`Text Input -> Python Test -> Preview` is the first cross-runtime Flow path. The node declares `execution.runtime=python`, invokes the managed worker through TL Core and emits:

- `output`: transformed result plus execution metadata;
- `error`: normalized error/cancellation payload;
- `status`: running, completed, cancelled, error or restarted worker state.

Its inline node controls expose `Cancel` for the active request and `Restart` for the managed worker. Existing JavaScript processors and their routing remain unchanged.

Because the secure Python bridge is intentionally renderer-only, a workspace containing this node runs the existing page runtimes instead of the background Worker. This is scoped to the POC node and prevents the Worker from attempting to access Electron APIs.

## Verified Behavior

- one worker handles multiple requests without respawning;
- success, invalid input, deliberate exception, lifecycle event/progress, cancellation and timeout are covered by `npm run test:python-poc`;
- concurrent work is correlated by execution ID; an intentional worker crash rejects in-flight work as `WORKER_CRASHED`, then restart is verified;
- JavaScript runtime remains separate and default.

This POC uses the developer system `python3`; shipping a managed interpreter, external Python packages, additional production nodes and packaging are later phases. The minimal built-in SDK and capability registry are documented in `python-node-sdk.md`.
