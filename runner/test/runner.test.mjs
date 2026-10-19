import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { once } from "node:events";
import {
  createRunnerServer,
  validateRun,
  buildDockerArgs,
  executeRun,
  containerName,
  JOB_IMAGES,
  LIMITS,
} from "../server.mjs";

const valid = (patch = {}) => ({
  runId: "job_example",
  runtime: "node",
  testCommand: "node-test",
  files: [
    {
      path: "sum.test.mjs",
      content: "import {test} from 'node:test'; test('ok',()=>{});",
    },
  ],
  ...patch,
});
const KEY = "x".repeat(64);

test("sandbox flags are fixed, pinned and have no host mounts or credentials", () => {
  const args = buildDockerArgs(validateRun(valid()));
  for (const required of [
    "--rm",
    "--network=none",
    "--user=10001:10001",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges:true",
    "--memory=256m",
    "--memory-swap=256m",
    "--cpus=1",
    "--pids-limit=64",
    "--ipc=none",
  ])
    assert.ok(args.includes(required), required);
  assert.ok(args.includes(JOB_IMAGES.node));
  assert.match(JOB_IMAGES.node, /@sha256:[a-f0-9]{64}$/);
  assert.match(JOB_IMAGES.python, /@sha256:[a-f0-9]{64}$/);
  assert.equal(args.filter((arg) => arg === "--tmpfs").length, 2);
  assert.equal(
    args.filter((arg) =>
      /^(?:-v|--volume|--mount|--privileged|--pid|--device|--env-file)(?:=|$)/.test(
        arg,
      ),
    ).length,
    0,
  );
  assert.equal(
    args.some((arg) => arg.includes("/var/run/docker.sock")),
    false,
  );
  assert.equal(
    args.some((arg) => arg.includes(KEY)),
    false,
  );
  assert.match(containerName("job_example"), /^attendx-run-[a-f0-9]{32}$/);
  assert.equal(containerName("job_example"), containerName("job_example"));
});

test("reject traversal, absolute, control-character, duplicate, symlink and directory/file collisions", () => {
  for (const path of [
    "/etc/passwd",
    "../escape",
    "a/../../escape",
    "./file",
    "a//b",
    "a/../b",
    "a\\b",
    "C:/a",
    "a\0b",
    "a\nb",
    "a/.git/config",
    ".git/config",
    "a/./b",
    "a/",
  ])
    assert.throws(
      () => validateRun(valid({ files: [{ path, content: "" }] })),
      path,
    );
  assert.throws(() =>
    validateRun(
      valid({
        files: [
          { path: "x", content: "" },
          { path: "x", content: "" },
        ],
      }),
    ),
  );
  assert.throws(() =>
    validateRun(
      valid({
        files: [
          { path: "x", content: "" },
          { path: "x/y", content: "" },
        ],
      }),
    ),
  );
  assert.throws(() =>
    validateRun(
      valid({ files: [{ path: "x", content: "", target: "/etc/passwd" }] }),
    ),
  );
  assert.throws(() =>
    validateRun(
      valid({ files: [{ path: "x", content: "", type: "symlink" }] }),
    ),
  );
  assert.throws(() =>
    validateRun(valid({ files: [{ path: "x", content: "\0" }] })),
  );
});

test("reject arbitrary images, commands, flags, runtimes and resource escalations", () => {
  for (const patch of [
    { image: "alpine" },
    { command: "sh" },
    { mounts: ["/"] },
    { env: { KEY } },
    { runtime: "shell" },
    { testCommand: "npm test" },
    { runtime: "python" },
    { timeoutSeconds: 0 },
    { timeoutSeconds: 121 },
    { timeoutSeconds: 1.5 },
    { runId: "--privileged" },
    { runId: "bad/name" },
  ])
    assert.throws(() => validateRun(valid(patch)), JSON.stringify(patch));
  assert.doesNotThrow(() =>
    validateRun(valid({ runtime: "python", testCommand: "python-unittest" })),
  );
  assert.doesNotThrow(() =>
    validateRun(valid({ testCommand: "static-check" })),
  );
});

test("enforce per-file, aggregate and count bounds", () => {
  assert.throws(() => validateRun(valid({ files: [] })));
  assert.throws(() =>
    validateRun(
      valid({
        files: Array.from({ length: 65 }, (_, i) => ({
          path: `${i}.js`,
          content: "",
        })),
      }),
    ),
  );
  assert.throws(() =>
    validateRun(
      valid({
        files: [
          { path: "large.js", content: "x".repeat(LIMITS.fileBytes + 1) },
        ],
      }),
    ),
  );
  assert.throws(() =>
    validateRun(
      valid({
        files: Array.from({ length: 5 }, (_, i) => ({
          path: `${i}.js`,
          content: "x".repeat(LIMITS.fileBytes),
        })),
      }),
    ),
  );
});

async function serve(t, executor) {
  const server = createRunnerServer({
    key: KEY,
    executor,
    healthCheck: () => true,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.shutdown());
  return `http://127.0.0.1:${server.address().port}`;
}
function request(base, endpoint, body, auth = KEY) {
  return fetch(base + endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth}`,
    },
    body: JSON.stringify(body),
  });
}

test("HTTP requires the control key and JSON; errors do not execute jobs", async (t) => {
  let called = 0;
  const base = await serve(t, async () => {
    called++;
    return { ok: true };
  });
  assert.equal((await fetch(base + "/health")).status, 200);
  assert.equal((await request(base, "/run", valid(), "bad")).status, 401);
  assert.equal(
    (await request(base, "/run", valid({ command: "sh" }))).status,
    400,
  );
  assert.equal(
    (
      await fetch(base + "/run", {
        method: "POST",
        headers: { Authorization: `Bearer ${KEY}` },
        body: "{}",
      })
    ).status,
    415,
  );
  assert.equal(
    (await request(base, "/cancel", { runId: "bad/../name" })).status,
    400,
  );
  assert.equal(called, 0);
});

test("active runs are bounded and targeted cancellation aborts exactly that job", async (t) => {
  const waiting = new Map();
  const base = await serve(
    t,
    (run, { signal }) =>
      new Promise((resolve) => {
        waiting.set(run.runId, true);
        signal.addEventListener(
          "abort",
          () => {
            waiting.delete(run.runId);
            resolve({ ok: false, cancelled: true, testCount: 0 });
          },
          { once: true },
        );
      }),
  );
  const first = request(base, "/run", valid({ runId: "first" }));
  const second = request(base, "/run", valid({ runId: "second" }));
  while (waiting.size < 2)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(
    (await request(base, "/run", valid({ runId: "first" }))).status,
    409,
  );
  assert.equal(
    (await request(base, "/run", valid({ runId: "third" }))).status,
    503,
  );
  assert.deepEqual(
    await (await request(base, "/cancel", { runId: "first" })).json(),
    { ok: true, cancelled: true },
  );
  assert.equal((await (await first).json()).cancelled, true);
  assert.equal(waiting.has("second"), true);
  await request(base, "/cancel", { runId: "second" });
  await second;
  assert.deepEqual(
    await (await request(base, "/cancel", { runId: "absent" })).json(),
    { ok: true, cancelled: false },
  );
});

function childStub() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    queueMicrotask(() => child.emit("close", 137));
    return true;
  };
  return child;
}

test("broker rejects zero tests and invalid reports even if Docker exits successfully", async () => {
  for (const stdout of [
    "not JSON",
    JSON.stringify({ ok: true, testCount: 0, stdout: "", stderr: "" }),
  ]) {
    const result = await executeRun(validateRun(valid()), {
      spawnImpl: () => {
        const child = childStub();
        queueMicrotask(() => {
          child.stdout.write(stdout);
          child.emit("close", 0);
        });
        return child;
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 1);
    assert.equal(result.testCount, 0);
  }
});

test("broker distinguishes static-only checks from executable tests", async () => {
  const result = await executeRun(
    validateRun(valid({ testCommand: "static-check" })),
    {
      spawnImpl: () => {
        const child = childStub();
        queueMicrotask(() => {
          child.stdout.write(
            JSON.stringify({
              ok: true,
              testCount: 0,
              stdout: "Static checks only.",
              stderr: "",
            }),
          );
          child.emit("close", 0);
        });
        return child;
      },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.testCount, 0);
  assert.equal(result.verification, "static-only");
});

test("cancellation removes only the request-owned container and returns cancelled", async () => {
  const controller = new AbortController();
  const calls = [];
  const resultPromise = executeRun(validateRun(valid()), {
    signal: controller.signal,
    spawnImpl: (command, args) => {
      calls.push({ command, args });
      const child = childStub();
      if (args[0] === "rm") queueMicrotask(() => child.emit("close", 0));
      return child;
    },
  });
  controller.abort();
  const result = await resultPromise;
  assert.equal(result.ok, false);
  assert.equal(result.cancelled, true);
  assert.equal(result.exitCode, 130);
  assert.ok(
    calls.some(
      (call) => call.args.join(" ") === `rm -f ${containerName("job_example")}`,
    ),
  );
  assert.equal(
    calls.some((call) => call.args.includes("prune")),
    false,
  );
});
