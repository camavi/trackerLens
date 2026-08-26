const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ManagedPythonRuntime } = require("../core/desktop/managed-python-runtime.cjs");

const projectRoot = path.resolve(__dirname, "..");
const fixtures = [
  require("./fixtures/rag-narrative-evaluation.json"),
  require("./fixtures/rag-technical-evaluation.json"),
];
const pythonPath = path.join(projectRoot, "runtimes/python/envs/nlp/bin/python");
const modelPath = path.join(projectRoot, "runtimes/python/models/paraphrase-multilingual-MiniLM-L12-v2");
const available = fs.existsSync(pythonPath) && fs.existsSync(modelPath);

const embed = async (runtime, text, executionId) => {
  const result = await runtime.execute({ executionId, operation: "text_embedding", inputs: { text }, timeoutMs: 30000 });
  return result.outputs.vector;
};

const cosine = (left = [], right = []) => {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < length; index += 1) {
    dot += Number(left[index] || 0) * Number(right[index] || 0);
    leftNorm += Number(left[index] || 0) ** 2;
    rightNorm += Number(right[index] || 0) ** 2;
  }
  const divisor = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  return divisor ? dot / divisor : 0;
};

const firstEvidenceRank = (rankedIds = [], expectedIds = []) => {
  const index = rankedIds.findIndex((id) => expectedIds.includes(id));
  return index === -1 ? 0 : index + 1;
};

const summarize = (rows, key) => ({
  top3Coverage: rows.filter((row) => row[key] > 0 && row[key] <= 3).length,
  meanReciprocalRank: Number((rows.reduce((sum, row) => sum + (row[key] ? 1 / row[key] : 0), 0) / rows.length).toFixed(4)),
});

test("records a neutral Hybrid versus Legacy evidence-ranking comparison", { skip: !available }, async (context) => {
  const runtime = new ManagedPythonRuntime({
    pythonPath,
    workerId: "managed-python-rag-hybrid-comparison",
    environment: { TL_NLP_MODEL_DIR: modelPath, HF_HUB_OFFLINE: "1" },
  });
  context.after(async () => runtime.stop());

  const rows = [];
  for (const fixture of fixtures) {
    const candidates = [];
    for (const chunk of fixture.chunks) {
      candidates.push({ ...chunk, vector: await embed(runtime, chunk.text, `comparison_${fixture.id}_${chunk.id}`) });
    }
    for (const [index, entry] of fixture.queries.entries()) {
      const queryVector = await embed(runtime, entry.query, `comparison_${fixture.id}_query_${index}`);
      const legacyIds = [...candidates]
        .sort((left, right) => cosine(queryVector, right.vector) - cosine(queryVector, left.vector))
        .map((item) => item.id);
      const hybrid = await runtime.execute({
        executionId: `comparison_${fixture.id}_retrieval_${index}`,
        operation: "hybrid_search",
        inputs: { query: entry.query, queryVector, candidates, semanticWeight: 0.65, lexicalWeight: 0.35 },
        timeoutMs: 30000,
      });
      const hybridIds = hybrid.outputs.ranked.map((item) => item.id);
      rows.push({
        fixture: fixture.id,
        query: entry.query,
        legacyRank: firstEvidenceRank(legacyIds, entry.expectedEvidenceIds),
        hybridRank: firstEvidenceRank(hybridIds, entry.expectedEvidenceIds),
      });
    }
  }

  const report = { cases: rows.length, legacy: summarize(rows, "legacyRank"), hybrid: summarize(rows, "hybridRank"), rows };
  context.diagnostic(JSON.stringify(report));
  assert.equal(report.cases, fixtures.reduce((total, fixture) => total + fixture.queries.length, 0));
  assert.equal(report.hybrid.top3Coverage, report.cases, "Hybrid must keep supporting evidence in Top 3 for every current evaluation case");
});
