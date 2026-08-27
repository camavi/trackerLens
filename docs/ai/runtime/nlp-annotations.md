# Managed NLP Annotations

Purpose: define the first spaCy-backed Python capability without moving
Knowledge ownership away from Trackers Lens.
Read when: implementing `nlp.annotations`, selecting a spaCy pipeline, or
changing Dictionary/Entity linguistic enrichment.
Do not read when: working on RAG, embedding, ordinary AI prompts or UI-only
changes.
Last updated: 2026-08-27.

## Decision

`nlp.annotations` is the next managed Python capability. The selected module
family is [spaCy](https://spacy.io/usage/linguistic-features/): its trained
pipelines provide tokenization, sentence boundaries, lemmas, POS/morphology,
dependencies and named-entity spans. spaCy publishes compatible, versioned
pipeline packages for English, Italian, Spanish, French and German; a blank
language instance is tokenizer-only and is not sufficient for this capability.

The first consumer is **Knowledge Dictionary Builder**. Entity Extractor,
Knowledge Event Builder and Semantic Relation Enricher may reuse the same
capability later, but are not part of its first cutover.

## Ownership Boundary

TL sends only authorized chunk data:

```json
{
  "language": "it",
  "chunks": [{ "id": "kchunk_*", "text": "…" }]
}
```

Python returns analysis proposals only:

```json
{
  "language": "it",
  "pipeline": { "id": "it_core_news_sm", "version": "…" },
  "chunks": [{
    "id": "kchunk_*",
    "sentences": [{ "start": 0, "end": 24 }],
    "tokens": [{ "text": "Liber", "lemma": "Liber", "pos": "PROPN", "start": 0, "end": 5 }],
    "entities": [{ "text": "Liber", "label": "PER", "start": 0, "end": 5 }]
  }]
}
```

Offsets are Unicode code-point indexes in the supplied JavaScript string and
must be explicitly converted/validated at the bridge boundary before TL uses
them for evidence. Python never receives a database handle, filesystem access,
network access, node configuration outside this capability, or permission to
write a dictionary record.

TL keeps language policy, chunk selection, evidence-quote checks, aliases,
type/rank/tier decisions, events, scope and all SQLite persistence. spaCy
output is provenance-bearing input to those policies, not a replacement for
them.

Dictionary mode is transparent:

- `hybrid` (**default**) sends only spaCy/TL candidate proposals and their
  source evidence to the configured LLM. The LLM may accept or reject a
  supplied proposal, but cannot introduce a new term; TL accepts only the
  returned terms that still map to a local proposal and an exact source quote.
  An unavailable/invalid LLM verification fails the Hybrid execution
  explicitly—TL does not silently save an unverified spaCy dictionary;
- `python-spacy` uses local spaCy proposals plus fixed TL evidence
  validation and ranking policy; it makes no LLM call and ignores user custom
  rules;
- `rules` uses the same spaCy proposals, then applies the user’s declarative
  stop-word/block/type rules in TL;
- `llm` uses the configured model for source-validated term selection while
  the managed spaCy pack remains the required linguistic foundation;

Custom Rules never alter spaCy’s tokenizer, model or annotations. They are
post-processing policy owned and executed by TL only.

## Managed Pack and Models

The built-in pack is `trackerslens.nlp.annotations` in the Core-owned `nlp`
environment. It pins `spaCy==3.8.14` and five compatible `3.8.0` CPU small
pipelines (`en_core_web_sm`, `it_core_news_sm`, `es_core_news_sm`,
`fr_core_news_sm`, `de_core_news_sm`). A spaCy pipeline is a managed model
artifact, even though its official distribution is a versioned wheel rather
than a Hugging Face snapshot. Each wheel has a pinned official release URL,
size, license and SHA-256 in the trusted manifest.

Installation requirements:

- only the exact trusted pack lockfile may reference a pipeline wheel;
- the plan names the pipeline, version, license, source and estimated size;
- no node, renderer or worker may call `spacy download`, pip, shell or a URL;
- Core installs/validates each requested artifact after consent and reports
  progress where the provider exposes it;
- Runtime Python e Modelli lists each installed pipeline and can remove it only
  through the existing Core-owned confirmed model removal lifecycle;
- a missing requested pipeline causes an explicit pack/model-unavailable error.

The first development target is one CPU small pipeline for each currently
supported document language (`it`, `en`, `es`, `fr`, `de`). They are five
explicit, pinned artifacts of the annotations pack, installed together after
the normal consent flow. This keeps the default `auto` language setting
reliable on the first execution: TL resolves the document language through its
existing detection before execution, then selects the matching already-managed
pipeline; Python never guesses a language or downloads a pipeline itself.

## First Cutover

1. Extend the managed model-artifact contract so an official pinned spaCy wheel
   can be installed and inventoried safely alongside Hugging Face snapshots.
   **Complete.**
2. Define the trusted annotations pack and all five CPU pipelines with their
   exact version/license/integrity metadata. **Complete.**
3. Add the restricted worker operation and contract tests for valid annotations,
   language mismatch, missing pipeline, invalid offsets and cancellation.
   **Worker operation complete; remaining cases are regression tests.**
4. Wire Dictionary Builder to consume validated annotations and retire only the
   superseded local linguistic heuristic paths. Existing LLM/evidence policy is
   not moved to Python. **Base wiring complete:** the node requires the managed
   annotations pack; TL converts Python code-point offsets to JavaScript UTF-16
   offsets and rejects every invalid span before candidate selection. Python
   NER/NOUN/PROPN proposals replace the previous regex scan; TL policy and
   LLM/evidence logic remain local.
5. Add multilingual quality/latency/memory fixtures before enabling the next
   consumer.

## Verification

- unit tests: manifest/lockfile policy and Core rejects untrusted artifact
  sources;
- worker tests: local installed Italian pipeline returns stable annotated spans
  for supplied text only;
- runtime test: Dictionary records retain exact evidence and include Python
  pipeline provenance;
- regression fixtures: Italian, English, Spanish, French and German;
- manual UI test: inserting the Dictionary node with a missing requested
  pipeline offers the standard trusted install plan and shows progress without
  leaving Flow Map.

## References

- [spaCy linguistic features](https://spacy.io/usage/linguistic-features/)
- [spaCy models and languages](https://spacy.io/usage/models)
- [official spaCy model releases](https://github.com/explosion/spacy-models)
