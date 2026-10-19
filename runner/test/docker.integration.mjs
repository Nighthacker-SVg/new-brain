import test from "node:test";
import assert from "node:assert/strict";
import { executeRun, validateRun } from "../server.mjs";

test("real Node execution verifies non-root, no network, no host sockets/keys and read-only root", async () => {
  const content =
    "import{test}from'node:test';import assert from'node:assert/strict';import{existsSync,writeFileSync}from'node:fs';import{networkInterfaces}from'node:os';test('isolation',()=>{assert.equal(process.getuid(),10001);for(const p of ['/var/run/docker.sock','/control/runner-key','/data/master.key'])assert.equal(existsSync(p),false);assert.deepEqual(Object.keys(networkInterfaces()),['lo']);assert.throws(()=>writeFileSync('/root-write','no'));});";
  const result = await executeRun(
    validateRun({
      runId: "integration-isolation",
      runtime: "node",
      testCommand: "node-test",
      files: [{ path: "isolation.test.mjs", content }],
      timeoutSeconds: 15,
    }),
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.testCount, 1);
});
test("real empty and failing Node tests cannot become successful verification", async () => {
  for (const [name, content, count] of [
    ["empty", "export const unused=1;", 0],
    [
      "failure",
      "import{test}from'node:test';import assert from'node:assert/strict';test('incorrect sum',()=>assert.equal(2+3,6));",
      1,
    ],
  ]) {
    const result = await executeRun(
      validateRun({
        runId: "integration-" + name,
        runtime: "node",
        testCommand: "node-test",
        files: [{ path: "case.test.mjs", content }],
        timeoutSeconds: 15,
      }),
    );
    assert.equal(result.ok, false);
    assert.equal(result.testCount, count);
    assert.notEqual(result.exitCode, 0);
  }
});
test("real Python unittest runs in the same bounded isolated policy", async () => {
  const result = await executeRun(
    validateRun({
      runId: "integration-python",
      runtime: "python",
      testCommand: "python-unittest",
      files: [
        {
          path: "test_invoice.py",
          content:
            "import unittest,os\nclass Invoice(unittest.TestCase):\n def test_total(self): self.assertEqual(2+3,5)\n def test_identity(self): self.assertEqual(os.getuid(),10001)\n",
        },
      ],
      timeoutSeconds: 15,
    }),
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.testCount, 2);
});
