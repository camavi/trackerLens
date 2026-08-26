const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ManagedPythonRuntime } = require("../core/desktop/managed-python-runtime.cjs");

const projectRoot = path.resolve(__dirname, "..");
const fixture = require("./fixtures/rag-narrative-evaluation.json");
const pythonPath = path.join(projectRoot, "runtimes/python/envs/nlp/bin/python");
const modelPath = path.join(projectRoot, "runtimes/python/models/paraphrase-multilingual-MiniLM-L12-v2");
const available = fs.existsSync(pythonPath) && fs.existsSync(modelPath);

const embed = async (runtime, text, executionId) => {
  const result = await runtime.execute({
    executionId,
    operation: "text_embedding",
    inputs: { text },
    timeoutMs: 30000,
  });
  return result.outputs.vector;
};

test("generic Italian narrative evaluation keeps supporting evidence in hybrid RAG results", { skip: !available }, async (context) => {
  const runtime = new ManagedPythonRuntime({
    pythonPath,
    workerId: "managed-python-rag-narrative-evaluation",
    environment: {
      TL_NLP_MODEL_DIR: modelPath,
      HF_HUB_OFFLINE: "1",
    },
  });
  context.after(async () => runtime.stop());

  const candidates = [];
  for (const chunk of fixture.chunks) {
    candidates.push({ ...chunk, vector: await embed(runtime, chunk.text, `narrative_chunk_${chunk.id}`) });
  }

  const evaluation = [];
  for (const [index, entry] of fixture.queries.entries()) {
    const queryVector = await embed(runtime, entry.query, `narrative_query_${index}`);
    const result = await runtime.execute({
      executionId: `narrative_retrieval_${index}`,
      operation: "hybrid_search",
      inputs: {
        query: entry.query,
        queryVector,
        candidates,
        semanticWeight: 0.65,
        lexicalWeight: 0.35,
      },
      timeoutMs: 30000,
    });
    const rankedIds = result.outputs.ranked.map((item) => item.id);
    const firstEvidenceRank = rankedIds.findIndex((id) => entry.expectedEvidenceIds.includes(id));
    evaluation.push({ query: entry.query, rankedIds, firstEvidenceRank });
    assert.notEqual(firstEvidenceRank, -1, `No supporting evidence returned for: ${entry.query}`);
    assert.ok(firstEvidenceRank < 3, `Supporting evidence must be in Top 3 for: ${entry.query}`);
  }

  assert.equal(evaluation.length, fixture.queries.length);
});
