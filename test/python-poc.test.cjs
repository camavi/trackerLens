const test = require("node:test");
const assert = require("node:assert/strict");
const { ManagedPythonRuntime } = require("../core/desktop/managed-python-runtime.cjs");

const runtime = new ManagedPythonRuntime();
test.after(async () => runtime.stop());

test("Python POC transforms text through a persistent worker", async () => {
  const result = await runtime.execute({ executionId: "python_success", inputs: { text: "  trackers lens  " } });
  assert.deepEqual(result.outputs, { text: "TRACKERS LENS", length: 17 });
  assert.deepEqual(result.provenance.node, { id: "poc.text_transform", capabilities: ["text.transform"] });
  assert.ok(result.events.some((event) => event.kind === "started"));
  assert.ok(runtime.status().capabilities.includes("text.transform"));
  assert.equal(runtime.status().activeJobs, 0);
});

test("Python POC reports invalid input and supports cancellation", async () => {
  await assert.rejects(runtime.execute({ executionId: "python_invalid", inputs: { text: 7 } }), (error) => error.code === "NODE_EXCEPTION");
  await assert.rejects(runtime.execute({ executionId: "python_exception", operation: "raise" }), (error) => error.code === "NODE_EXCEPTION");
  const pending = runtime.execute({ executionId: "python_cancel", operation: "delay", inputs: { seconds: 1 } });
  setTimeout(() => runtime.cancel("python_cancel"), 30);
  await assert.rejects(pending, (error) => error.code === "EXECUTION_CANCELLED");
});

test("Python POC handles timeouts, concurrent jobs, and a worker restart", async () => {
  await assert.rejects(
    runtime.execute({ executionId: "python_timeout", operation: "delay", inputs: { seconds: 1 }, timeoutMs: 20 }),
    (error) => error.code === "EXECUTION_TIMEOUT"
  );
  await new Promise((resolve) => setTimeout(resolve, 80));
  const [first, second] = await Promise.all([
    runtime.execute({ executionId: "python_parallel_one", operation: "delay", inputs: { seconds: 0.05 } }),
    runtime.execute({ executionId: "python_parallel_two", inputs: { text: "parallel" } })
  ]);
  assert.equal(first.outputs.completed, true);
  assert.equal(second.outputs.text, "PARALLEL");

  await assert.rejects(runtime.execute({ executionId: "python_crash", operation: "crash" }), (error) => error.code === "WORKER_CRASHED");
  await runtime.restart();
  const restarted = await runtime.execute({ executionId: "python_after_restart", inputs: { text: "ready" } });
  assert.equal(restarted.outputs.text, "READY");
  assert.equal(runtime.status().restartCount, 1);
});
