const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ManagedPythonRuntime } = require("../core/desktop/managed-python-runtime.cjs");

const projectRoot = path.resolve(__dirname, "..");
const pythonPath = path.join(projectRoot, "runtimes/python/envs/nlp/bin/python");
const modelPath = path.join(projectRoot, "runtimes/python/models/paraphrase-multilingual-MiniLM-L12-v2");
const available = fs.existsSync(pythonPath) && fs.existsSync(modelPath);

test("development NLP pack serves a local offline 384-dimension embedding", { skip: !available }, async (context) => {
  const runtime = new ManagedPythonRuntime({
    pythonPath,
    workerId: "managed-python-nlp-dev",
    environment: {
      TL_NLP_MODEL_DIR: modelPath,
      TL_NLP_MODEL_ID: "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
      TL_NLP_MODEL_REVISION: "b8ef00830037f9868450f778081ea683e900fe39",
      HF_HUB_OFFLINE: "1",
      HF_HOME: path.join(projectRoot, "runtimes/python/.cache")
    }
  });
  context.after(async () => runtime.stop());

  const result = await runtime.execute({
    executionId: "python_nlp_embedding",
    operation: "text_embedding",
    inputs: { text: "Trackers Lens usa un modello locale." },
    timeoutMs: 30000
  });
  assert.equal(result.outputs.dimensions, 384);
  assert.equal(result.outputs.vector.length, 384);
  assert.equal(result.outputs.model, "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2");
  assert.deepEqual(result.provenance.node, { id: "nlp.text_embedding", capabilities: ["text.embedding"] });
  assert.ok(runtime.status().capabilities.includes("text.embedding"));
  assert.equal(runtime.status().workerId, "managed-python-nlp-dev");
});
