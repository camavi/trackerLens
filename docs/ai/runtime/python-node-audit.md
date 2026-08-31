# Python Node Audit

Purpose: classify every current Flow Map palette node for Python-runtime suitability and record the implemented managed capabilities.
Read when: selecting a Python node, evaluating a module dependency or changing a node execution runtime.
Do not read when: making a UI-only node change.
Last updated: 2026-08-31.

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
| JS or POC | 79 | Control plane, I/O, UI, persistence, Flow routing and LLM orchestration remain in TL; Python Test remains an isolated POC. |
| Managed Python implemented | 5 | Embedding Generator, Vector Memory, RAG Search, Knowledge Dictionary Builder and Knowledge Graph Builder Agent retain TL contracts while calling installed specialist capabilities. |
| Hybrid candidate | 4 | Existing Knowledge contracts can benefit from a bounded Python computation without changing Flow semantics. |
| Direct Python migration | 0 | No current node is approved to change its execution runtime directly. Future Python capabilities are additive. |

No existing node is approved to switch its whole execution runtime. Every
candidate needs its own manifest, managed dependency pack, benchmark and
regression suite before implementation. In this first-development phase, an
approved capability cutover removes obsolete implementation/fallback paths
unless retaining one protects real persisted data or the owner explicitly asks.

## Decision Criteria

A Python capability is eligible only when it has all of the following:

- a measurable advantage over the existing JS/provider path;
- a stable input/output boundary that preserves current node IDs, ports,
  channels, evidence and provenance;
- an established module that can be packaged, locked and used offline where
  applicable;
- a controlled CPU/GPU, model-download and memory profile;
- a comparison benchmark and explicit unavailable/error behavior when its
  required managed pack is not installed.

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
| Knowledge (2) | Embedding Generator, Vector Memory | Managed Python implemented | `text.embedding` uses the pinned local Sentence Transformers pack. TL keeps record writes, scope and provenance. |
| Knowledge (1) | RAG Search | Managed Python implemented | `knowledge.rag.retrieve` and `text.rerank` use the managed Hybrid/CrossEncoder pack. TL keeps scope, evidence/context construction, output and persistence. |
| Knowledge (1) | Graph Query | Hybrid candidate — later decision | Keep graph/evidence policy and query output in TL. It does not inherit RAG reranking automatically. |
| Knowledge (1) | Knowledge Graph | Future capability | Keep graph materialization in TL. Add a separate read-only graph-analytics capability only when algorithms beyond the current graph needs are justified. |
| Knowledge (1) | Knowledge Dictionary Builder | Managed Python implemented | `nlp.annotations` uses the installed revision-pinned spaCy pipelines for IT/EN/ES/FR/DE to return token, lemma, POS, dependency and NER proposals. TL retains evidence validation, ranking, scope and persistence. |
| Knowledge (1) | Entity Extractor | Hybrid candidate | It consumes scoped Dictionary/annotation-derived hints; a dedicated Entity Python capability is not currently required. TL retains dictionary constraints, deduplication, evidence checks and persistence. |
| Knowledge (1) | Knowledge Event Builder | Hybrid candidate — priority 4 | A later NLP capability may propose structured events. TL retains timeline ordering, role normalization, evidence validation and fallback rules. |
| Knowledge (1) | Semantic Relation Enricher | Hybrid candidate — priority 4 | Python may score/propose relations, but TL keeps allowed relation types, orientation, evidence and persistence. |
| Knowledge (2) | Knowledge Mechanism Cue Agent, Knowledge Reasoning Composer | JS | These are LLM orchestration and evidence-policy nodes. A model provider may be local, but the orchestration contract remains TL. |
| Knowledge (1) | Knowledge Graph Builder Agent | Managed Python implemented | TL retains LLM orchestration, scope, evidence, persistence and quality labels; the managed isolated `graph` environment runs GLiNER2 relation extraction and multilingual NLI verification. |
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
| `text.embedding` | Embedding Generator, Vector Memory | Sentence Transformers | scoped chunks, model/pack policy, vector record write and provenance | vectors, dimensions, model/version, metrics |
| `text.rerank` | RAG Search | Sentence Transformers `CrossEncoder` | retrieval candidate set, evidence scope/order, final context and provenance | scored candidate IDs and model/version |
| `nlp.annotations` | Knowledge Dictionary Builder | spaCy 3.8.14, implemented in the managed `nlp` pack with IT/EN/ES/FR/DE pipelines | chunks, allowed schema, validation, persistence and evidence rules | token/lemma/POS/dependency/entity proposals with UTF-16-compatible offsets |
| `knowledge.graph.relation_extract` / `knowledge.graph.relation_verify` | Knowledge Graph Builder Agent | GLiNER2 2.0.0 + multilingual mDeBERTa NLI, implemented in the isolated managed `graph` pack | authorized chunks, relation schema, scope, provenance, quality labels and persistence | evidence-grounded relation candidates plus entailment/neutral/contradiction verification |
| `graph.analytics` | future read-only companion to Knowledge Graph | NetworkX | graph snapshot, scope, output policy and visualization | metrics, paths, communities or ranked node IDs |
| `ml.classify` / `ml.predict` | future distinct nodes, not current AI Agents | scikit-learn or another selected managed pack | dataset scope, training policy, model storage, actions and fallback | labels/scores/predictions and metrics |

Sentence Transformers is implemented for embeddings/reranking; spaCy is
implemented for linguistic annotations; and GLiNER2 plus multilingual NLI is
implemented for managed graph relations. All use pinned managed packs and keep
TL as the contract, scope, persistence and provenance owner. NetworkX and
scikit-learn remain future candidates.

Reference material for the capability fit: [Sentence Transformers embeddings
and rerankers](https://sbert.net/docs/quickstart.html), [spaCy linguistic
features](https://spacy.io/usage/linguistic-features), [NetworkX
algorithms](https://networkx.org/documentation/stable/reference/algorithms/index.html)
and [scikit-learn text feature extraction](https://scikit-learn.org/stable/modules/feature_extraction.html).

## Remaining Optional Capability Candidates

No Python-node migration is required for the current product path. Evaluate a
new capability only when it has a measurable benefit and a bounded contract:

1. `graph.analytics` as a read-only NetworkX companion to Knowledge Graph.
2. A dedicated Entity/Event/Semantic extraction capability only if it improves
   over the current Dictionary, rule and provider paths.
3. Separate opt-in ML classification/prediction or media-analysis nodes; do not
   repurpose existing TL control-plane or Agent nodes.

## Required Follow-up Before Any Candidate Ships

- define the real `execution` and `dependencies.python` manifest fields;
- choose one managed environment/lockfile and no implicit network install;
- add an Electron Main/TL Core execution route rather than a renderer-only
  production bridge;
- add success, invalid input, timeout, cancellation, crash and JS-fallback
  tests;
- capture quality/latency/memory benchmarks and retain full provenance in the
  existing runtime evidence records.
