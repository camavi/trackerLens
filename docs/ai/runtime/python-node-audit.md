# Python Node Audit

Purpose: classify every current Flow Map palette node for Python-runtime suitability before implementing a production Python capability.
Read when: selecting a Python node, evaluating a module dependency or changing a node execution runtime.
Do not read when: making a UI-only node change.
Last updated: 2026-08-25.

## Scope and Result

Audit source: `js/flow-map/flowMapNodeBuilder.js` palette, 88 nodes total.

This is a capability audit, not a migration order. A node remains a TL node with
stable ports, channels, persistence and safe-executor behavior. `JS` means the
current implementation remains the runtime owner. `Hybrid` means TL keeps the
node contract and calls a managed Python capability only for the specialist
calculation. `Future` means add a new optional capability, rather than
silently changing the existing node.

| Decision | Nodes | Reason |
| --- | --- | --- |
| JS or POC | 80 | Control plane, I/O, UI, persistence, Flow routing and LLM orchestration remain in TL; Python Test remains an isolated POC. |
| Hybrid candidate | 8 | Existing Knowledge contracts can benefit from a bounded Python computation without changing Flow semantics. |
| Direct Python migration | 0 | No current node is approved to change its execution runtime directly. Future Python capabilities are additive. |

No existing node is approved to switch execution runtime in this audit. Every
candidate needs its own manifest, managed dependency pack, benchmark, fallback
and regression suite before implementation.

## Decision Criteria

A Python capability is eligible only when it has all of the following:

- a measurable advantage over the existing JS/provider path;
- a stable input/output boundary that preserves current node IDs, ports,
  channels, evidence and provenance;
- an established module that can be packaged, locked and used offline where
  applicable;
- a controlled CPU/GPU, model-download and memory profile;
- a JS/provider fallback and a comparison benchmark.

Python never owns SQLite, workspace scope, event routing, mutation authority,
network permission or package installation. Those remain TL Core and Runtime
Manager responsibilities.

## Full Palette Classification

| Palette group | Nodes | Decision | Notes |
| --- | --- | --- | --- |
| Sources (11) | REST API, WebSocket, RSS Feed, Webhook, YouTube API, Manual JSON, Text Input, Image Source, Audio Source, File Source, Files Batch | JS | Acquisition and browser/desktop permissions stay in TL. Add separate future analysis nodes for image, audio or files; do not move sources. |
| Trackers (4) | Box Tracker, Existing Tracker, Realtime Tracker, Polling Tracker | JS | Channel lifecycle, polling and real-time transport are TL control-plane work. |
| Flow Maps (3) | Flow In, Flow Out, Flow Map | JS | Flow boundaries and invocation must stay language-neutral and TL-owned. |
| Processors (15) | Agent Bridge, Filter, Transform, Condition, Throttle, Debounce, Merge, Split, Map, Reduce, Formatter, Validator, Aggregator, Cache, Parser | JS | Deterministic flow control is lower-latency in the existing runtime and must not acquire an environment dependency. Specialized parsers can be added later as new nodes. |
| Processors (1) | Python Test | POC only | Keep feature-gated. It proves transport, cancellation and recovery; it is not a production capability. |
| Knowledge (7) | Document Store, Text Knowledge, Chunk Processor, Structured Knowledge Store, World Database, Workspace Memory, Conversation Memory | JS | These nodes own normalized TL records and SQLite-backed persistence. Python may receive read-only scoped inputs, never these responsibilities. |
| Knowledge (1) | World Graph View | JS | Renderer visualization stays custom UI code. |
| Knowledge (1) | World Generator Agent | JS | LLM configuration, jobs and policy remain in the existing agent/provider runtime. |
| Knowledge (2) | Embedding Generator, Vector Memory | Hybrid candidate — priority 1 | Create one managed `text.embedding` capability used by both nodes. Keep record writes/provenance in TL; replace only vector generation. Candidate family: Sentence Transformers or a provider-backed fallback. |
| Knowledge (1) | RAG Search | Hybrid candidate — priority 2 | Preserve TL retrieval scope, evidence selection and output. Add an optional `text.rerank` stage after candidate retrieval, not a wholesale move of RAG to Python. |
| Knowledge (1) | Graph Query | Hybrid candidate — priority 2 | Keep graph/evidence policy and query output in TL. It may request the same optional rerank capability for candidate evidence. |
| Knowledge (1) | Knowledge Graph | Future capability | Keep graph materialization in TL. Add a separate read-only graph-analytics capability only when algorithms beyond the current graph needs are justified. |
| Knowledge (1) | Knowledge Dictionary Builder | Hybrid candidate — priority 3 | Existing rules/LLM behavior remains. A Python linguistic-preprocessing capability may propose lemmas, POS or terms, subject to current evidence validation. |
| Knowledge (1) | Entity Extractor | Hybrid candidate — priority 3 | A managed NLP capability may propose entities/relations. TL must retain dictionary constraints, deduplication, evidence checks and persistence. |
| Knowledge (1) | Knowledge Event Builder | Hybrid candidate — priority 4 | A later NLP capability may propose structured events. TL retains timeline ordering, role normalization, evidence validation and fallback rules. |
| Knowledge (1) | Semantic Relation Enricher | Hybrid candidate — priority 4 | Python may score/propose relations, but TL keeps allowed relation types, orientation, evidence and persistence. |
| Knowledge (3) | Knowledge Mechanism Cue Agent, Knowledge Reasoning Composer, Knowledge Graph Builder Agent | JS | These are LLM orchestration and evidence-policy nodes. A model provider may be local, but the orchestration contract remains TL. |
| AI Agents (13) | Existing Agents, Task Node, Orchestrator Agent, AI Analyzer, AI Sentiment, AI Summarizer, AI Classifier, AI Predictor, AI Memory, AI Planner, AI Router, AI Debugger, AI Decision | JS | Agents, jobs, tools, memory and safe execution remain TL. Classical Python NLP/ML classifiers or predictors may be added as distinct opt-in capability nodes; do not silently change AI-agent semantics. |
| Actions (11) | Telegram Message, WhatsApp Message, Email, Webhook POST, HTTP PUT/PATCH, Browser Notification, Discord Message, Slack Message, Sound Alert, Popup Alert, Runtime Trigger | JS | Side effects and confirmations remain behind TL safe-executor and platform permissions. |
| Storage (8) | Save SQLite Record, Save File, Local Cache, Runtime Memory, Snapshot, JSON Export, CSV Export, History Store | JS | Persistence, export and user-data ownership remain TL Core responsibilities. |
| Dev (1) | Preview | JS | Renderer inspection must remain direct and complete. |

The table lists all 88 palette nodes. Future capabilities named in notes are
new optional nodes or internal services, not a hidden migration of a listed
node.

## Candidate Capability Map

| Capability | First consumers | Existing module family to evaluate | TL owns | Python returns |
| --- | --- | --- | --- | --- |
| `text.embedding` | Embedding Generator, Vector Memory | Sentence Transformers | scoped chunks, model/pack policy, vector record write, fallback | vectors, dimensions, model/version, metrics |
| `text.rerank` | RAG Search, Graph Query | Sentence Transformers `CrossEncoder` | retrieval candidate set, evidence scope/order, final context and fallback | scored candidate IDs and model/version |
| `nlp.annotations` | Dictionary Builder, Entity Extractor, Event Builder, Semantic Relation Enricher | spaCy, only after language/model QA | chunks, allowed schema, validation, persistence and evidence rules | token/lemma/POS/dependency/entity proposals with offsets |
| `graph.analytics` | future read-only companion to Knowledge Graph | NetworkX | graph snapshot, scope, output policy and visualization | metrics, paths, communities or ranked node IDs |
| `ml.classify` / `ml.predict` | future distinct nodes, not current AI Agents | scikit-learn or another selected managed pack | dataset scope, training policy, model storage, actions and fallback | labels/scores/predictions and metrics |

The module families are candidates, not approved dependencies or selected
models. The audit uses their documented capability fit: Sentence Transformers
supports embeddings and CrossEncoder reranking; spaCy exposes linguistic
annotations, NER and dependency parsing; NetworkX provides graph algorithms;
scikit-learn provides text feature extraction and classical ML. Final package,
version, license and benchmark are separate approval gates.

Reference material for the capability fit: [Sentence Transformers embeddings
and rerankers](https://sbert.net/docs/quickstart.html), [spaCy linguistic
features](https://spacy.io/usage/linguistic-features), [NetworkX
algorithms](https://networkx.org/documentation/stable/reference/algorithms/index.html)
and [scikit-learn text feature extraction](https://scikit-learn.org/stable/modules/feature_extraction.html).

## Recommended First Implementation

Start with `text.embedding`, not a broad Knowledge migration:

1. Preserve the existing `Embedding Generator` and `Vector Memory` ports and
   SQLite record shape.
2. Add an opt-in managed Python pack and a thin adapter that returns vectors
   plus model/version/latency provenance.
3. Keep the current local-hash/provider path as an explicit fallback.
4. Compare retrieval quality, latency, memory and failure recovery on a
   representative multi-language corpus.
5. Only after that, add `text.rerank` to RAG Search/Graph Query as an optional
   second-stage capability.

This order gives measurable value while leaving the high-regression extraction
and graph-answering paths untouched.

## Required Follow-up Before Any Candidate Ships

- define the real `execution` and `dependencies.python` manifest fields;
- choose one managed environment/lockfile and no implicit network install;
- add an Electron Main/TL Core execution route rather than a renderer-only
  production bridge;
- add success, invalid input, timeout, cancellation, crash and JS-fallback
  tests;
- capture quality/latency/memory benchmarks and retain full provenance in the
  existing runtime evidence records.
