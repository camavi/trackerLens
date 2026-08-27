const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ManagedPythonRuntime } = require("../core/desktop/managed-python-runtime.cjs");

const projectRoot = path.resolve(__dirname, "..");
const pythonPath = path.join(projectRoot, "runtimes/python/envs/nlp/bin/python");
const modelPath = path.join(projectRoot, "runtimes/python/models/paraphrase-multilingual-MiniLM-L12-v2");
const rerankModelPath = path.join(projectRoot, "runtimes/python/models/mmarco-mMiniLMv2-L12-H384-v1");
const available = fs.existsSync(pythonPath) && fs.existsSync(modelPath);
const rerankAvailable = available && fs.existsSync(rerankModelPath);

test("development RAG pack ranks TL-authorized candidates through Sentence Transformers and BM25S", { skip: !available }, async (context) => {
  const runtime = new ManagedPythonRuntime({
    pythonPath,
    workerId: "managed-python-rag-dev",
    environment: { TL_NLP_MODEL_DIR: modelPath, HF_HUB_OFFLINE: "1" }
  });
  context.after(async () => runtime.stop());

  const result = await runtime.execute({
    executionId: "python_rag_hybrid",
    operation: "hybrid_search",
    inputs: {
      query: "Come Liber riesce a parlare?",
      queryVector: [1, 0, 0],
      candidates: [
        { id: "cura", text: "Liber riesce a parlare bevendo il tè della cura.", vector: [1, 0, 0] },
        { id: "altro", text: "Juliette guarda la montagna in silenzio.", vector: [0, 1, 0] }
      ],
      semanticWeight: 0.65,
      lexicalWeight: 0.35
    },
    timeoutMs: 30000
  });

  assert.equal(result.outputs.candidateCount, 2);
  assert.equal(result.outputs.ranked[0].id, "cura");
  assert.equal(result.outputs.algorithm, "sentence-transformers+bm25s/weighted-normalized");
  assert.ok(Number.isFinite(result.outputs.ranked[0].semanticScore));
  assert.ok(Number.isFinite(result.outputs.ranked[0].lexicalScore));
  assert.equal(result.provenance.node.id, "rag.hybrid_search");
  assert.deepEqual(result.provenance.node.capabilities, ["knowledge.rag.retrieve", "text.lexical_search", "text.semantic_search"]);
});

test("managed RAG reranker reorders only supplied candidates with the local CrossEncoder", { skip: !rerankAvailable }, async (context) => {
  const runtime = new ManagedPythonRuntime({
    pythonPath,
    workerId: "managed-python-rag-rerank-dev",
    environment: { TL_NLP_MODEL_DIR: modelPath, TL_RAG_RERANK_MODEL_DIR: rerankModelPath, HF_HUB_OFFLINE: "1" }
  });
  context.after(async () => runtime.stop());

  const result = await runtime.execute({
    executionId: "python_rag_rerank",
    operation: "cross_encoder_rerank",
    inputs: {
      query: "Come Liber riesce a parlare?",
      candidates: [
        { id: "cura", text: "Liber riesce a parlare bevendo il tè della cura." },
        { id: "altro", text: "Juliette guarda la montagna in silenzio." }
      ]
    },
    timeoutMs: 30000
  });

  assert.equal(result.outputs.candidateCount, 2);
  assert.equal(result.outputs.ranked[0].id, "cura");
  assert.equal(result.outputs.algorithm, "cross-encoder/local");
  assert.equal(result.outputs.model, "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1");
  assert.deepEqual(result.provenance.node.capabilities, ["text.rerank"]);
});
