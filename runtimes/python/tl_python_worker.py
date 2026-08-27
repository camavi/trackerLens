#!/usr/bin/env python3
"""Trackers Lens Python POC worker. Protocol: newline-delimited JSON on stdin/stdout."""
import json
import importlib
import os
import sys
import threading
import time
from tl_python_sdk import NodeContext, capabilities, execute as execute_node, node, node_definition

PROTOCOL_VERSION = "tl-python-worker/v1"
write_lock = threading.Lock()
active = {}

def send(payload):
    with write_lock:
        sys.stdout.write(json.dumps(payload, separators=(",", ":")) + "\n")
        sys.stdout.flush()

@node("poc.text_transform", capabilities=["text.transform"])
def text_transform(_ctx, inputs):
    value = inputs.get("text")
    if not isinstance(value, str):
        raise ValueError("inputs.text must be a string")
    return {"text": value.strip().upper(), "length": len(value)}

@node("poc.delay", capabilities=["runtime.test.delay"])
def delay(ctx, inputs):
    seconds = float(inputs.get("seconds", 0))
    if seconds < 0 or seconds > 30:
        raise ValueError("seconds must be between 0 and 30")
    ticks = max(1, int(seconds * 20))
    for index in range(ticks):
        if ctx._cancel_event.wait(seconds / ticks):
            return {"cancelled": True}
        ctx.progress(((index + 1) / ticks) * 100)
    return {"seconds": seconds, "completed": True}

@node("poc.raise", capabilities=["runtime.test.exception"])
def raise_exception(_ctx, _inputs):
    raise RuntimeError("Requested Python POC exception")

@node("poc.crash", capabilities=["runtime.test.crash"])
def crash(_ctx, _inputs):
    os._exit(99)

NLP_MODEL_DIR = os.environ.get("TL_NLP_MODEL_DIR", "").strip()
NLP_MODEL_ID = os.environ.get("TL_NLP_MODEL_ID", "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2").strip()
NLP_MODEL_REVISION = os.environ.get("TL_NLP_MODEL_REVISION", "").strip()
RAG_RERANK_MODEL_DIR = os.environ.get("TL_RAG_RERANK_MODEL_DIR", "").strip()
RAG_RERANK_MODEL_ID = os.environ.get("TL_RAG_RERANK_MODEL_ID", "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1").strip()
RAG_RERANK_MODEL_REVISION = os.environ.get("TL_RAG_RERANK_MODEL_REVISION", "").strip()
try:
    ANNOTATION_MODELS = json.loads(os.environ.get("TL_NLP_ANNOTATION_MODELS", "[]"))
except json.JSONDecodeError:
    ANNOTATION_MODELS = []
if not isinstance(ANNOTATION_MODELS, list):
    ANNOTATION_MODELS = []
annotation_models = {
    str(item.get("language", "")).strip().lower(): item
    for item in ANNOTATION_MODELS
    if isinstance(item, dict) and str(item.get("language", "")).strip()
}
nlp_model = None
rag_rerank_model = None
annotation_pipelines = {}

if NLP_MODEL_DIR:
    @node("nlp.text_embedding", capabilities=["text.embedding"])
    def text_embedding(_ctx, inputs):
        global nlp_model
        value = inputs.get("text")
        if not isinstance(value, str):
            raise ValueError("inputs.text must be a string")
        if nlp_model is None:
            from sentence_transformers import SentenceTransformer
            nlp_model = SentenceTransformer(NLP_MODEL_DIR, local_files_only=True)
        vector = nlp_model.encode(value, convert_to_numpy=True, normalize_embeddings=True).tolist()
        return {"vector": [float(item) for item in vector], "dimensions": len(vector), "model": NLP_MODEL_ID, "revision": NLP_MODEL_REVISION}

    @node("rag.hybrid_search", capabilities=["knowledge.rag.retrieve", "text.semantic_search", "text.lexical_search"])
    def hybrid_search(_ctx, inputs):
        """Rank TL-authorized candidates with maintained NLP retrieval modules.

        Storage, scope and result persistence remain in TL.  This capability only
        receives a query vector and candidate records that TL has already approved.
        """
        import bm25s
        import numpy as np
        from sentence_transformers import util

        query_vector = inputs.get("queryVector")
        candidates = inputs.get("candidates")
        if not isinstance(query_vector, list) or not query_vector:
            raise ValueError("inputs.queryVector must be a non-empty numeric array")
        if not isinstance(candidates, list):
            raise ValueError("inputs.candidates must be an array")

        normalized = []
        for item in candidates:
            if not isinstance(item, dict):
                continue
            candidate_id = str(item.get("id", "")).strip()
            text = str(item.get("text", "")).strip()
            vector = item.get("vector")
            if not candidate_id or not text or not isinstance(vector, list):
                continue
            normalized.append({"id": candidate_id, "text": text, "vector": vector})
        if not normalized:
            return {"ranked": [], "candidateCount": 0, "algorithm": "sentence-transformers+bm25s/weighted-normalized"}

        query = np.asarray(query_vector, dtype=np.float32)
        corpus = np.asarray([item["vector"] for item in normalized], dtype=np.float32)
        if query.ndim != 1 or corpus.ndim != 2 or corpus.shape[1] != query.shape[0]:
            raise ValueError("queryVector and candidate vectors must have matching dimensions")

        # sentence-transformers owns the semantic retrieval; bm25s owns lexical retrieval.
        semantic_hits = util.semantic_search(query[None, :], corpus, top_k=len(normalized), score_function=util.dot_score)[0]
        semantic_scores = np.zeros(len(normalized), dtype=np.float32)
        for hit in semantic_hits:
            semantic_scores[int(hit["corpus_id"])] = float(hit["score"])

        texts = [item["text"] for item in normalized]
        corpus_tokens = bm25s.tokenize(texts, stopwords="italian", show_progress=False)
        retriever = bm25s.BM25()
        retriever.index(corpus_tokens, show_progress=False)
        query_tokens = bm25s.tokenize([str(inputs.get("query", ""))], stopwords="italian", show_progress=False)
        lexical_ids, lexical_values = retriever.retrieve(query_tokens, k=len(normalized), show_progress=False)
        lexical_scores = np.zeros(len(normalized), dtype=np.float32)
        for index, score in zip(lexical_ids[0], lexical_values[0]):
            lexical_scores[int(index)] = float(score)

        semantic_normalized = np.clip((semantic_scores + 1.0) / 2.0, 0.0, 1.0)
        lexical_max = float(np.max(lexical_scores)) if lexical_scores.size else 0.0
        lexical_normalized = lexical_scores / lexical_max if lexical_max > 0 else lexical_scores
        semantic_weight = max(0.0, float(inputs.get("semanticWeight", 0.65)))
        lexical_weight = max(0.0, float(inputs.get("lexicalWeight", 0.35)))
        weight_total = semantic_weight + lexical_weight
        if weight_total <= 0:
            raise ValueError("At least one retrieval weight must be greater than zero")
        fused_scores = ((semantic_normalized * semantic_weight) + (lexical_normalized * lexical_weight)) / weight_total
        order = np.argsort(-fused_scores, kind="stable")
        return {
            "ranked": [{
                "id": normalized[int(index)]["id"],
                "score": float(fused_scores[int(index)]),
                "semanticScore": float(semantic_scores[int(index)]),
                "lexicalScore": float(lexical_scores[int(index)]),
            } for index in order],
            "candidateCount": len(normalized),
            "algorithm": "sentence-transformers+bm25s/weighted-normalized",
            "weights": {"semantic": semantic_weight / weight_total, "lexical": lexical_weight / weight_total},
        }

if RAG_RERANK_MODEL_DIR and os.path.isdir(RAG_RERANK_MODEL_DIR):
    @node("rag.cross_encoder_rerank", capabilities=["text.rerank"])
    def cross_encoder_rerank(_ctx, inputs):
        """Re-rank only TL-authorized RAG candidates with a local CrossEncoder."""
        global rag_rerank_model
        query = str(inputs.get("query", "")).strip()
        candidates = inputs.get("candidates")
        if not query:
            raise ValueError("inputs.query must be a non-empty string")
        if not isinstance(candidates, list):
            raise ValueError("inputs.candidates must be an array")
        normalized = []
        for item in candidates:
            if not isinstance(item, dict):
                continue
            candidate_id = str(item.get("id", "")).strip()
            text = str(item.get("text", "")).strip()
            if candidate_id and text:
                normalized.append({"id": candidate_id, "text": text})
        if not normalized:
            return {"ranked": [], "candidateCount": 0, "algorithm": "cross-encoder/local"}
        if rag_rerank_model is None:
            from sentence_transformers import CrossEncoder
            rag_rerank_model = CrossEncoder(RAG_RERANK_MODEL_DIR, local_files_only=True)
        scores = rag_rerank_model.predict([(query, item["text"]) for item in normalized], show_progress_bar=False)
        ordered = sorted(range(len(normalized)), key=lambda index: (-float(scores[index]), index))
        return {
            "ranked": [{"id": normalized[index]["id"], "score": float(scores[index])} for index in ordered],
            "candidateCount": len(normalized),
            "algorithm": "cross-encoder/local",
            "model": RAG_RERANK_MODEL_ID,
            "revision": RAG_RERANK_MODEL_REVISION,
        }

if annotation_models:
    @node("nlp.annotations", capabilities=["nlp.annotations"])
    def annotations(ctx, inputs):
        """Return spaCy linguistic proposals for TL-authorized chunks only."""
        language = str(inputs.get("language", "")).strip().lower()
        chunks = inputs.get("chunks")
        if language not in annotation_models:
            raise ValueError("inputs.language must name an installed annotation pipeline")
        if not isinstance(chunks, list):
            raise ValueError("inputs.chunks must be an array")
        model = annotation_models[language]
        pipeline_directory = str(model.get("directory", "")).strip()
        package_name = str(model.get("package", "")).strip()
        if not pipeline_directory or not package_name or not os.path.isdir(pipeline_directory):
            raise ValueError("Requested annotation pipeline is not installed locally")
        pipeline = annotation_pipelines.get(language)
        if pipeline is None:
            if pipeline_directory not in sys.path:
                sys.path.insert(0, pipeline_directory)
            package = importlib.import_module(package_name)
            pipeline = package.load()
            annotation_pipelines[language] = pipeline

        annotated = []
        total = len(chunks)
        for index, chunk in enumerate(chunks):
            if ctx.cancelled:
                return {"cancelled": True}
            if not isinstance(chunk, dict):
                raise ValueError("Each inputs.chunks item must be an object")
            chunk_id = str(chunk.get("id", "")).strip()
            text = chunk.get("text")
            if not chunk_id or not isinstance(text, str):
                raise ValueError("Each chunk requires a string id and text")
            document = pipeline(text)
            annotated.append({
                "id": chunk_id,
                "sentences": [{"start": sentence.start_char, "end": sentence.end_char} for sentence in document.sents],
                "tokens": [{
                    "text": token.text,
                    "lemma": token.lemma_,
                    "pos": token.pos_,
                    "tag": token.tag_,
                    "morph": str(token.morph),
                    "dependency": token.dep_,
                    "head": token.head.i,
                    "start": token.idx,
                    "end": token.idx + len(token.text),
                } for token in document],
                "entities": [{
                    "text": entity.text,
                    "label": entity.label_,
                    "start": entity.start_char,
                    "end": entity.end_char,
                } for entity in document.ents],
            })
            if total:
                ctx.progress(((index + 1) / total) * 100, processed=index + 1, total=total)
        return {
            "language": language,
            "pipeline": {"id": str(model.get("id", package_name)), "version": str(model.get("revision", ""))},
            "chunks": annotated,
        }

OPERATION_IDS = {
    "text_transform": "poc.text_transform",
    "delay": "poc.delay",
    "raise": "poc.raise",
    "crash": "poc.crash",
    "text_embedding": "nlp.text_embedding",
    "hybrid_search": "rag.hybrid_search",
    "cross_encoder_rerank": "rag.cross_encoder_rerank",
    "annotations": "nlp.annotations",
}

def execute(message):
    execution_id = message.get("executionId", "")
    cancel_event = active[execution_id]
    inputs = message.get("inputs") or {}
    try:
        send({"type": "event", "executionId": execution_id, "kind": "started"})
        operation = str(message.get("operation", "text_transform"))
        node_id = OPERATION_IDS.get(operation, operation)
        ctx = NodeContext(
            execution_id=execution_id,
            context=message.get("context") or {},
            _cancel_event=cancel_event,
            _emit=lambda kind, **payload: send({"type": "event", "executionId": execution_id, "kind": kind, **payload}),
        )
        outputs = execute_node(node_id, ctx, inputs)
        if ctx.cancelled or outputs.pop("cancelled", False):
            send({"type": "result", "executionId": execution_id, "status": "cancelled", "outputs": {}, "diagnostics": [{"code": "EXECUTION_CANCELLED"}]})
            return
        ctx.log("Python POC task completed", nodeId=node_id)
        send({"type": "result", "executionId": execution_id, "status": "success", "outputs": outputs, "diagnostics": [], "provenance": {"runtime": "python", "protocolVersion": PROTOCOL_VERSION, "node": node_definition(node_id)}})
    except Exception as error:
        send({"type": "result", "executionId": execution_id, "status": "failed", "outputs": {}, "diagnostics": [{"code": "NODE_EXCEPTION", "message": str(error)}]})
    finally:
        active.pop(execution_id, None)

def main():
    send({"type": "ready", "protocolVersion": PROTOCOL_VERSION, "capabilities": capabilities()})
    for raw in sys.stdin:
        try:
            message = json.loads(raw)
            message_type = message.get("type")
            if message_type == "execute":
                execution_id = message.get("executionId", "")
                if not execution_id or execution_id in active:
                    send({"type": "result", "executionId": execution_id, "status": "failed", "diagnostics": [{"code": "INVALID_INPUT", "message": "executionId is required and must be unique"}]})
                    continue
                active[execution_id] = threading.Event()
                threading.Thread(target=execute, args=(message,), daemon=True).start()
            elif message_type == "cancel":
                event = active.get(message.get("executionId", ""))
                if event: event.set()
            elif message_type == "shutdown":
                for event in active.values(): event.set()
                send({"type": "shutdown"})
                return
        except Exception as error:
            send({"type": "protocol_error", "message": str(error)})

if __name__ == "__main__": main()
