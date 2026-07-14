# Codex Task — Harden Knowledge Graph, Event Extraction and Graph-RAG Globally

## Context

You are working on **Trackers Lens**, a local-first AI Runtime Operating Environment.

Before touching code, follow the project read order exactly:

1. Read `AI.md`.
2. Read `docs/ai/current-focus.md`.
3. For this substantial task, read `docs/ai/project-state.md`.
4. Read `docs/ai/file-map.md` before choosing implementation files.
5. Read only the module documentation relevant to:
   - knowledge runtime;
   - event extraction;
   - entity extraction;
   - semantic relation enrichment;
   - graph query;
   - Graph-RAG answer generation;
   - runtime channels and contracts.
6. Read `docs/ai/task-registry.md` only if task status must change.
7. Do not read archive files unless current documentation explicitly requires history.

Respect all non-negotiable rules in `AI.md`.

Do not invent modules, endpoints, contracts, channels or file paths. Inspect the repository and reuse existing runtime components in `core/runtime/` before adding anything new.

---

# Main objective

Improve the current Knowledge Graph + Event Builder + Graph-RAG pipeline so that it works robustly across **arbitrary texts**, not only the current test story.

The fix must be global and reusable for:

- narrative texts;
- technical documentation;
- scientific papers;
- legal texts;
- biographies;
- news;
- manuals;
- conversations;
- mixed structured and unstructured documents;
- multiple languages where the current pipeline already claims support.

Do not hard-code names, words, relations or patterns from the current test document.

The current pipeline is approximately:

```text
Knowledge Dictionary Builder
→ Graph Entity Extractor
→ Semantic Relation Enricher
→ Knowledge Event Builder
→ Knowledge Graph Builder
→ Knowledge Graph Runtime
→ Graph Query
→ AI Graph Answer
→ Preview
```

Preserve this architecture unless repository evidence shows a more accurate current flow.

---

# Current observed problems

The following defects were observed during a real test and must be treated as examples of general classes of bugs.

## 1. Missing or unresolved subjects

Example class:

```json
{
  "type": "cannot_speak",
  "subject": ""
}
```

The evidence clearly contains an identifiable subject, but the event is stored without it.

Required behavior:

- infer the explicit or implicit subject when supported by nearby text;
- keep the subject unresolved when evidence is genuinely insufficient;
- never invent a subject;
- expose uncertainty and provenance.

Preferred output shape, adapted to existing contracts:

```json
{
  "subject": "Liber",
  "subjectResolution": {
    "method": "explicit|coreference|context-window|unresolved",
    "confidence": 0.94,
    "evidenceSpan": "...",
    "sourceMention": "lui"
  }
}
```

Do not introduce this exact schema blindly. First inspect existing contracts and extend them compatibly.

---

## 2. Broken pronoun and coreference resolution

Current generic pronouns may remain as entities or participants:

```json
{
  "subject": "they",
  "participants": ["they"]
}
```

This later causes answer generation errors such as replacing known actors with vague phrases like “and the others”.

Required behavior:

- resolve pronouns and omitted subjects to canonical entities when evidence supports it;
- support singular and plural references;
- support subject continuity across adjacent sentences;
- support aliases and mentions from the knowledge dictionary;
- preserve unresolved pronouns when confidence is too low;
- never create a canonical entity named `they`, `he`, `she`, `it`, `lui`, `lei`, `essi`, etc., unless the source explicitly uses that as a proper name.

For plural references, support multiple resolved participants:

```json
{
  "subject": ["Juliette", "Liber"],
  "sourceMention": "they",
  "confidence": 0.91
}
```

Adapt to the current event contract rather than forcing a new incompatible type.

---

## 3. Incorrect semantic roles

Example class:

Text meaning:

```text
Juliette took Liber by the hand and brought him home.
```

Incorrect extraction:

```json
{
  "type": "takes",
  "subject": "Juliette",
  "objects": ["casa"]
}
```

Required behavior:

- distinguish agent, patient, object, destination, source, instrument, location and beneficiary;
- avoid assigning a location as the direct object of an unrelated verb;
- split compound clauses into separate normalized events when necessary;
- retain the original evidence span.

A better semantic representation might be:

```text
Juliette — takes_by_hand → Liber
Juliette — brings_to → Liber, casa
```

Do not copy these exact relation names unless they fit the existing ontology and normalization rules.

---

## 4. Literal versus figurative language

Example class:

```text
Liber found courage.
```

This must not be treated identically to:

```text
Liber found a flower.
```

Required behavior:

- distinguish physical acquisition/discovery from idiomatic or state-change expressions;
- normalize figurative constructions when confidence is sufficient;
- preserve the literal source phrase;
- avoid losing meaning through aggressive rewriting.

Possible normalized concepts:

```text
gains_courage
becomes_courageous
state_change
```

Use existing ontology names where available.

---

## 5. Overly generic entities

Terms such as these may become noisy global entities:

```text
place
thing
person
home
voice
kingdom
area
object
```

Required behavior:

Classify extracted mentions into at least the conceptual equivalents of:

- canonical entity;
- entity mention;
- generic reference;
- concept;
- attribute;
- state;
- value;
- temporal expression;
- location mention;
- event participant.

Generic references must not automatically become high-value global graph nodes.

Add or improve filters based on:

- specificity;
- document frequency;
- capitalization where relevant;
- syntactic role;
- alias resolution;
- ontology type;
- confidence;
- connected evidence;
- cross-chunk recurrence.

Do not remove useful concepts merely because they are common nouns.

---

## 6. Incorrect or oversimplified causality

Current relation example:

```json
{
  "source": "Liber",
  "type": "healed_by",
  "target": "river water"
}
```

The actual causal chain may be multi-step:

```text
ingredient A
+ ingredient B
→ preparation
→ subject consumes preparation
→ state changes
```

Required behavior:

- avoid collapsing a multi-step process into a single unsupported causal edge;
- distinguish direct cause, contributing factor, preparation ingredient, instrument, medium, result and later generalization;
- build event-to-event causal chains where supported;
- preserve the difference between:
  - what directly happened to a subject;
  - what characters later claimed generally;
  - what the narrator established as fact;
  - what is only inferred by the model.

Suggested conceptual pattern:

```text
event: ingredient_added
event: substance_transforms
event: subject_consumes
event: subject_state_changes
causes(event A, event B)
precedes(event A, event B)
```

Use current graph/event contracts and extend them compatibly.

---

## 7. Weak distinction between fact, claim, belief and inference

The graph should not treat all statements as equally factual.

Required behavior:

Track provenance categories such as:

- directly stated fact;
- narrator statement;
- character claim;
- hypothesis;
- instruction;
- prediction;
- negation;
- uncertainty;
- model inference;
- rule inference.

For example:

```text
“The old man said the drink would cure him”
```

is initially a claim or prediction, while:

```text
“He drank it and then spoke”
```

is an observed event sequence.

The graph must preserve this distinction.

---

## 8. Negation and modality

The pipeline must correctly handle:

```text
does not speak
could speak
might speak
must drink
failed to speak
tried to speak
started speaking
stopped speaking
```

Required behavior:

- preserve polarity;
- preserve modality;
- preserve tense/aspect when relevant;
- do not convert a negated event into a positive fact;
- do not treat attempts as successful outcomes;
- do not treat plans or instructions as completed events.

---

## 9. Event sequencing gaps and unstable ordering

Observed event sequences may skip values or combine events inconsistently.

Required behavior:

- define clearly whether sequence is:
  - global document order;
  - chunk-local order;
  - paragraph-local order;
  - inferred causal order;
- preserve original textual order separately from inferred causal order;
- use stable deterministic ordering;
- support multiple events from one sentence;
- do not renumber unpredictably between runs unless source content changes.

Prefer fields conceptually equivalent to:

```json
{
  "textOrder": 19,
  "causalOrder": 6,
  "chunkOrder": 3
}
```

Only introduce fields after checking existing schemas.

---

## 10. Answer generation can generalize beyond evidence

The final answer may contain a vague or invented participant even when the graph contains the correct actors.

Required behavior:

- make Graph-RAG answer generation evidence-bound;
- prioritize direct events and evidence spans;
- avoid replacing resolved entities with vague plural expressions;
- include only claims supported by retrieved graph data or source chunks;
- expose unsupported answer fragments during debug mode;
- make the answer concise for simple factual questions.

---

# Required implementation strategy

## Phase 1 — Inspect and map the current system

Before editing:

1. Identify the exact files implementing:
   - dictionary building;
   - entity extraction;
   - relation enrichment;
   - event extraction;
   - coreference handling;
   - graph building;
   - graph querying;
   - answer context assembly;
   - AI answer generation;
   - preview/debug payloads.
2. Identify runtime channels and payload contracts.
3. Identify existing tests and fixtures.
4. Identify whether rules, AI prompts or hybrid logic are used in each stage.
5. Write a concise implementation plan before modifying code.

Do not make speculative large refactors before mapping current ownership.

---

## Phase 2 — Add a shared normalization layer

Prefer one reusable normalization layer over unrelated fixes in individual nodes.

The layer should handle, where compatible with current architecture:

- canonical entity resolution;
- alias resolution;
- pronoun/coreference resolution;
- generic mention classification;
- semantic role normalization;
- event normalization;
- relation normalization;
- negation/modality;
- provenance;
- confidence;
- deterministic IDs;
- source spans.

Do not duplicate the same logic in Graph Entity Extractor, Event Builder and Semantic Relation Enricher.

If a shared layer already exists, extend it instead of adding another system.

---

## Phase 3 — Improve event extraction

Event extraction should produce structures conceptually equivalent to:

```json
{
  "type": "drinks",
  "subject": "canonical_entity_id",
  "objects": ["canonical_entity_id"],
  "roles": {
    "agent": ["..."],
    "patient": ["..."],
    "instrument": [],
    "source": [],
    "destination": [],
    "location": []
  },
  "polarity": "positive",
  "modality": "asserted",
  "tense": "past",
  "aspect": "completed",
  "confidence": 0.98,
  "resolutionConfidence": 0.93,
  "provenance": {
    "documentId": "...",
    "chunkId": "...",
    "sentenceIndex": 12,
    "startOffset": 120,
    "endOffset": 165,
    "evidence": "..."
  }
}
```

This is a target capability, not a mandatory schema. Preserve backward compatibility.

---

## Phase 4 — Improve relation generation

Relations should be derived only when supported by:

- direct text;
- normalized events;
- explicit rule;
- AI inference with confidence and provenance.

Every semantic relation should retain:

- method;
- original relation or source event;
- evidence;
- confidence;
- direct versus inferred;
- provenance;
- polarity;
- temporal validity if applicable.

Avoid converting weak co-occurrence into strong causality.

---

## Phase 5 — Improve Graph Query and Graph-RAG context assembly

For a question such as:

```text
How did subject X recover capability Y?
```

the query should prefer:

1. the subject entity;
2. the target state/capability;
3. state-change events;
4. causal predecessors;
5. directly connected participants;
6. evidence chunks;
7. only then broader graph expansion.

Support query intent categories such as:

- who;
- what;
- where;
- when;
- why;
- how;
- causal chain;
- comparison;
- timeline;
- definition;
- procedure.

Do not implement a test-specific intent.

Context assembly should avoid sending the entire noisy neighborhood when a compact causal chain is sufficient.

---

## Phase 6 — Add answer traceability

Extend debug/preview output so each answer claim can be traced to evidence.

Desired capability:

```json
{
  "answer": "...",
  "claims": [
    {
      "text": "The subject drank the prepared substance.",
      "supported": true,
      "eventIds": ["..."],
      "relationIds": ["..."],
      "chunkIds": ["..."],
      "confidence": 0.97
    }
  ],
  "unsupportedClaims": [],
  "unresolvedReferences": [],
  "coverage": 0.96
}
```

Again, adapt this to current contracts.

The normal user-facing answer can remain simple. The detailed trace belongs in debug/inspect mode.

---

# Global test suite requirements

Add deterministic automated tests. Do not rely only on one story or one LLM output.

Use small fixtures covering at least the following categories.

## A. Explicit subject

```text
Maria opened the door.
```

Expected: subject `Maria`, action `opened`, object `door`.

## B. Pronoun resolution

```text
Maria entered the room. She opened the window.
```

Expected: `She` resolves to `Maria`.

## C. Plural pronoun resolution

```text
Maria met Luca. They entered the room.
```

Expected: `They` resolves to both entities when confidence is sufficient.

## D. Ambiguous pronoun

```text
Maria spoke to Anna while she was leaving.
```

Expected: preserve ambiguity or lower confidence; do not invent certainty.

## E. Implicit subject in a pro-drop language

Italian example:

```text
Maria prese il libro. Poi uscì dalla stanza.
```

Expected: the omitted subject of `uscì` resolves to `Maria`.

## F. Compound clause and semantic roles

```text
Maria took Luca by the hand and brought him home.
```

Expected:
- patient is `Luca`;
- destination is `home`;
- no incorrect direct object assignment.

## G. Figurative phrase

```text
Luca found courage and faced the problem.
```

Expected: distinguish state change from physical discovery.

## H. Physical discovery

```text
Luca found a key under the table.
```

Expected: actual discovery event.

## I. Negation

```text
Luca did not open the door.
```

Expected: negative polarity; no positive `opened` fact.

## J. Attempt versus success

```text
Luca tried to open the door, but failed.
```

Expected: attempted event, unsuccessful outcome.

## K. Modality

```text
Luca may open the door tomorrow.
```

Expected: possibility, future time; not a completed event.

## L. Claim versus observed fact

```text
Anna said the medicine would work. Luca took it and later recovered.
```

Expected:
- claim/prediction separated from observed recovery;
- causal inference marked appropriately.

## M. Multi-step causality

```text
The powder was mixed with water. Luca drank the solution. His fever decreased.
```

Expected:
- preparation event;
- consumption event;
- state-change event;
- causal chain only if supported or explicitly marked as inferred.

## N. Generic mentions

```text
A person entered a place and picked up an object.
```

Expected:
- generic mentions remain generic;
- avoid polluting canonical global entity space.

## O. Alias resolution

```text
Dr. Maria Rossi entered. Later, Dr. Rossi spoke.
```

Expected: both mentions resolve to the same canonical entity.

## P. Cross-chunk continuity

Split a short narrative across two chunks where the second begins with a pronoun.

Expected: resolution uses safe bounded context without leaking unrelated documents.

## Q. Technical text

```text
The worker reads messages from channel A and writes normalized events to channel B.
```

Expected: correct agent, source and destination roles.

## R. Scientific text

```text
Treatment A was associated with lower inflammation, but causality was not established.
```

Expected:
- association is not converted into causation;
- uncertainty preserved.

## S. Legal text

```text
The tenant must notify the landlord before making structural changes.
```

Expected:
- obligation modality;
- actor and recipient roles;
- not marked as completed action.

## T. Conflicting statements

```text
Report 1 states the server failed. Report 2 states the server remained operational.
```

Expected:
- preserve both claims with source provenance;
- do not silently merge into one fact.

---

# Regression test using the current sample

Keep the current document only as one regression fixture, not as the basis of the implementation.

For the question:

```text
Come recupera la voce Liber?
```

The answer must be grounded in the source and should identify the correct participants and causal sequence.

Minimum expected meaning:

```text
Liber recupera la voce bevendo tutto il tè preparato immergendo il fiore arancione nell’acqua della sorgente.
```

The system must not say:

```text
Juliette e gli altri
```

when the evidence identifies Juliette and Liber.

The graph should avoid reducing the entire mechanism to an unsupported single edge such as:

```text
Liber healed_by river water
```

unless that edge is explicitly marked as a later generalized statement and not the direct treatment event.

---

# Backward compatibility

Do not break existing flows or nodes.

Requirements:

- preserve existing channel names unless a migration is unavoidable;
- preserve current payload fields;
- add new fields in a backward-compatible way;
- provide adapters or defaults for old stored graph data;
- ensure old workspace memories can still be inspected;
- avoid invalidating saved patterns and templates;
- document any migration clearly.

---

# Performance constraints

The current local test used a large prompt for a simple answer.

Improve context selection so simple questions can use a compact evidence package.

Add or preserve metrics for:

- input token count;
- output token count;
- latency;
- number of entities retrieved;
- number of relations retrieved;
- number of events retrieved;
- number of chunks expanded;
- unsupported claims;
- unresolved references;
- context compression ratio.

Do not optimize by removing necessary provenance.

---

# Observability requirements

Because Trackers Lens is an inspectable runtime, each stage should expose enough data to debug errors.

At minimum, debug payloads should make it possible to answer:

- Which node created this entity?
- Which node resolved this alias?
- Which rule or model created this relation?
- Which evidence span created this event?
- Why was this pronoun resolved to this entity?
- Why was this relation considered causal?
- Which graph items were sent to the LLM?
- Which answer sentence came from which evidence?
- Where was confidence reduced?
- Which items remained unresolved?

Use existing DevTools and runtime event patterns.

---

# Safety and quality rules

- Do not invent facts when resolution is uncertain.
- Prefer unresolved state over false certainty.
- Preserve source evidence.
- Preserve document and chunk boundaries.
- Do not merge entities across unrelated documents without explicit scope rules.
- Do not use a large LLM call where deterministic logic is sufficient.
- Do not use deterministic rules where language ambiguity genuinely requires model assistance.
- Keep hybrid behavior explainable.
- Make outputs stable enough for regression testing.
- Avoid language-specific hard-coding where a reusable abstraction is possible.
- Where language-specific handling is necessary, isolate it behind a clear strategy interface.

---

# Expected deliverables

1. A concise summary of the current implementation and root causes.
2. A file-by-file implementation plan.
3. Code changes.
4. Automated tests for the global cases above.
5. Regression test for the current sample.
6. Debug/trace improvements.
7. Performance comparison before and after.
8. Documentation updates only where required by project rules.
9. A final report containing:
   - files changed;
   - contracts changed;
   - tests added;
   - known limitations;
   - migration notes;
   - measured improvements;
   - remaining risks.

---

# Definition of done

The task is complete only when:

- explicit subjects are extracted correctly;
- safe pronoun/coreference resolution works for singular, plural and omitted subjects;
- ambiguous references remain ambiguous;
- semantic roles are not confused;
- figurative and literal uses are distinguished where feasible;
- generic mentions do not pollute the graph;
- negation, modality and attempts are preserved;
- claims, observations and inferences remain distinct;
- multi-step causal chains can be represented;
- Graph-RAG retrieves compact, relevant evidence;
- answers are evidence-bound;
- debug mode traces answer claims back to events, relations and chunks;
- existing flows continue to work;
- automated tests pass;
- no test-specific hard-coding exists.

Start by inspecting the repository and returning the implementation plan before making broad architectural changes.
