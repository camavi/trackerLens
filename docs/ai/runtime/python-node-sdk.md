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

The execution-contract base now normalizes `environment`, `requirements`,
`lockfile` and `installPolicy` (`bundled`, `managed-required` or
`managed-optional`). `core/runtime/python-pack-resolver.cjs` now resolves
those declarations against a Core-owned, trusted pack catalog and returns only
`ready`, `unavailable`, `blocked` or a consent-requiring install plan. A
separate Core-owned installer may execute only the exact trusted pack selected
by that plan; it never accepts packages, paths, URLs or commands from a node
or renderer.

`tl_python_worker.py` registers the POC handlers by default. When—and only when—the Core-managed NLP development environment supplies `TL_NLP_MODEL_DIR`, it additionally registers `nlp.text_embedding`; the model is loaded from that local directory with `local_files_only=True`.

## Development NLP Pack

`runtimes/python/packs/nlp/` is the first development-only pack definition.
It pins `sentence-transformers==5.5.0` through `requirements.in` and the full
`requirements.lock`, and fixes the multilingual local model
`sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` to its declared
revision. The development environment needs Python 3.10–3.12; it has been
validated locally with Python 3.11 and an offline 384-dimension embedding
smoke test.

The venv and downloaded model are ignored by Git. Electron exposes the
Core-managed NLP bridge when the managed environment is available. Embedding
Generator and Vector Memory may explicitly select
`embeddingRuntime: "python-local"`; this uses the offline `text.embedding`
adapter. Without that selection the existing provider/local-hash behavior
remains available. A selected Python-local adapter that is missing or fails
returns an explicit pack-unavailable error; it does not silently change
algorithms. There is no implicit install
or download: a missing pack is presented as a trusted installation plan in the
dedicated Runtime Python page and requires user confirmation. Electron
registers this manifest in the Core-owned pack catalog as `ready` only when
its local artifacts are available.

## Runtime and Model Transparency

The dedicated desktop **Runtime Python e Modelli** page exposes a Core-owned
catalog. It reports managed pack IDs/versions, pinned requirements, environment
status and model metadata (revision, dimensions, languages, license and exact
local size). The renderer never receives a Python environment path, a model
directory path, a filesystem handle or a shell command.

The only destructive catalog operation accepts an allow-listed opaque model ID.
It requires explicit confirmation, stops the managed environment and then Core
removes that exact registered model directory. Pack/environment installation is
not an implicit side effect of opening the runtime page or running a node; the
implemented transactional installer shows its exact trusted plan and obtains user consent first. A Node
that declares an unresolved pack displays the requirement in its configuration
and routes the user to this page; it never starts installation itself.

When a new Node has a Python requirement that is active by default, TL shows a
CMS install prompt immediately after creation. Choosing **Non ora** preserves
the node, but its Python execution fails explicitly with a pack-unavailable
diagnostic. The Core installer publishes phase events (prepare, environment
creation, dependency install, verification, model download and runtime start)
through the narrow preload bridge so the Runtime Python page can show actual
lifecycle progress.

## Phase 7: Capabilities

Nodes declare capabilities in their `execution` manifest. `RuntimeManager.resolveCapability(capability)` resolves a ready registered runtime without callers selecting a language. The Python Test node declares `text.transform`; its implementation happens to be Python, but Flow contracts remain capability-oriented.

Capability registration is feature-gated with the Electron Python POC bridge. Browser and normal desktop mode resolve `text.transform` as unavailable rather than falling back to JavaScript.
