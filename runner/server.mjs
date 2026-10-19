import http from "node:http";
import { readFile } from "node:fs/promises";
import { createHash, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import nodeHarness from "./harness-node.mjs";
import pythonHarness from "./harness-python.mjs";

// The digest, executable, arguments and sandbox policy are server-owned. An
// agent supplies candidate text files, never an image, shell command or mount.
export const JOB_IMAGES = Object.freeze({
  node: "node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f",
  python:
    "python:3.12-alpine@sha256:1b668429b3511ab407d8e00648891631b0b1a4d7e15e3ca70f38ab5b91ad4ab4",
});
export const LIMITS = Object.freeze({
  files: 64,
  fileBytes: 256 * 1024,
  totalBytes: 1024 * 1024,
  bodyBytes: 1536 * 1024,
  outputBytes: 128 * 1024,
  concurrent: 2,
  timeoutSeconds: 120,
});
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const SAFE_PATH = /^[A-Za-z0-9_.\/-]{1,240}$/;

export class RequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export function validateRun(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new RequestError("Expected a JSON object.");
  if (
    Object.keys(input).some(
      (key) =>
        ![
          "runId",
          "files",
          "runtime",
          "testCommand",
          "timeoutSeconds",
        ].includes(key),
    )
  )
    throw new RequestError(
      "Unsupported execution option. Images, commands, environment and Docker flags cannot be supplied.",
    );
  if (!SAFE_RUN_ID.test(input.runId || ""))
    throw new RequestError("Invalid runId.");
  if (!["node", "python"].includes(input.runtime))
    throw new RequestError("Runtime must be node or python.");
  if (
    !["node-test", "python-unittest", "static-check"].includes(
      input.testCommand,
    ) ||
    (input.testCommand === "node-test" && input.runtime !== "node") ||
    (input.testCommand === "python-unittest" && input.runtime !== "python")
  )
    throw new RequestError("Unsupported runtime and test command combination.");
  const timeoutSeconds = input.timeoutSeconds ?? 30;
  if (
    !Number.isInteger(timeoutSeconds) ||
    timeoutSeconds < 1 ||
    timeoutSeconds > LIMITS.timeoutSeconds
  )
    throw new RequestError("timeoutSeconds must be an integer from 1 to 120.");
  if (
    !Array.isArray(input.files) ||
    !input.files.length ||
    input.files.length > LIMITS.files
  )
    throw new RequestError("Supply between 1 and 64 text files.");
  const paths = new Set();
  let bytes = 0;
  const files = input.files.map((file) => {
    if (
      !file ||
      typeof file !== "object" ||
      Array.isArray(file) ||
      Object.keys(file).some((key) => !["path", "content"].includes(key))
    )
      throw new RequestError(
        "Files must contain only path and content; links and file modes are unsupported.",
      );
    const name = file.path;
    if (
      typeof name !== "string" ||
      !SAFE_PATH.test(name) ||
      name.startsWith("/") ||
      name
        .split("/")
        .some(
          (part) => !part || part === "." || part === ".." || part === ".git",
        )
    )
      throw new RequestError(
        "File paths must be safe relative paths without traversal, hidden Git directories, or links.",
      );
    if (paths.has(name)) throw new RequestError("Duplicate file path.");
    if (typeof file.content !== "string" || file.content.includes("\0"))
      throw new RequestError("Only UTF-8 text file content is supported.");
    const size = Buffer.byteLength(file.content);
    if (size > LIMITS.fileBytes)
      throw new RequestError("A file exceeds 256 KiB.");
    bytes += size;
    paths.add(name);
    return { path: name, content: file.content };
  });
  if (bytes > LIMITS.totalBytes)
    throw new RequestError("Candidate files exceed 1 MiB.");
  for (const name of paths) {
    const parts = name.split("/");
    for (let i = 1; i < parts.length; i++) {
      if (paths.has(parts.slice(0, i).join("/")))
        throw new RequestError("A path cannot be both a file and a directory.");
    }
  }
  return {
    runId: input.runId,
    runtime: input.runtime,
    testCommand: input.testCommand,
    timeoutSeconds,
    files,
  };
}

export function containerName(runId) {
  return `attendx-run-${createHash("sha256").update(runId).digest("hex").slice(0, 32)}`;
}
export function buildDockerArgs(run) {
  const interpreter = run.runtime === "node" ? "node" : "python";
  const harness = run.runtime === "node" ? nodeHarness : pythonHarness;
  return [
    "run",
    "--rm",
    "--pull=missing",
    "--name",
    containerName(run.runId),
    "--label",
    "attendx.managed=runner",
    "--network=none",
    "--user=10001:10001",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges:true",
    "--memory=256m",
    "--memory-swap=256m",
    "--cpus=1",
    "--pids-limit=64",
    "--ulimit=nofile=128:128",
    "--ulimit=core=0:0",
    "--ipc=none",
    "--tmpfs",
    "/work:rw,noexec,nosuid,nodev,size=64m,uid=10001,gid=10001,mode=0700",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,nodev,size=16m,uid=10001,gid=10001,mode=0700",
    "--workdir=/work",
    "--env=HOME=/work",
    "--env=TMPDIR=/tmp",
    "--env=PYTHONDONTWRITEBYTECODE=1",
    "--env=PYTHONUNBUFFERED=1",
    "--entrypoint",
    interpreter,
    "-i",
    JOB_IMAGES[run.runtime],
    ...(run.runtime === "node" ? ["-e", harness] : ["-I", "-c", harness]),
  ];
}

function dockerOptions() {
  // Do not forward API credentials, proxy variables, or arbitrary Docker host
  // configuration to the Docker client or the generated job environment.
  return {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
      HOME: "/tmp",
      DOCKER_HOST: "unix:///var/run/docker.sock",
    },
  };
}
function limitedText(text, limit = LIMITS.outputBytes) {
  return Buffer.from(String(text || ""))
    .subarray(0, limit)
    .toString("utf8");
}
async function removeContainer(name, spawnImpl) {
  return new Promise((resolve) => {
    const process = spawnImpl("docker", ["rm", "-f", name], dockerOptions());
    const timer = setTimeout(() => {
      process.kill("SIGKILL");
      resolve();
    }, 5000);
    process.on("error", () => {
      clearTimeout(timer);
      resolve();
    });
    process.on("close", () => {
      clearTimeout(timer);
      resolve();
    });
    process.stdout?.resume();
    process.stderr?.resume();
    process.stdin?.end();
  });
}

export function executeRun(run, { spawnImpl = spawn, signal } = {}) {
  const start = Date.now();
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl("docker", buildDockerArgs(run), dockerOptions());
    } catch {
      resolve({
        ok: false,
        exitCode: 125,
        stdout: "",
        stderr: "Could not start the isolated execution service.",
        durationMs: Date.now() - start,
        testCount: 0,
      });
      return;
    }
    let stdout = "",
      stderr = "",
      total = 0,
      timedOut = false,
      cancelled = false;
    let outputExceeded = false,
      settled = false,
      forced = false;
    const name = containerName(run.runId);
    const forceStop = async (reason) => {
      if (forced || settled) return;
      forced = true;
      timedOut = reason === "timeout";
      cancelled = reason === "cancel";
      outputExceeded = reason === "output";
      // Removing the exact request-owned container kills descendants too. Never
      // use docker prune or a broad container-name/label cleanup operation.
      await removeContainer(name, spawnImpl);
      child.kill("SIGKILL");
    };
    const timer = setTimeout(() => {
      void forceStop("timeout");
    }, run.timeoutSeconds * 1000);
    const abort = () => {
      void forceStop("cancel");
    };
    signal?.addEventListener("abort", abort, { once: true });
    const capture = (target) => (chunk) => {
      const remaining = Math.max(0, LIMITS.outputBytes - total);
      const data = Buffer.from(chunk);
      total += data.length;
      if (target === "stdout")
        stdout += data.subarray(0, remaining).toString("utf8");
      else stderr += data.subarray(0, remaining).toString("utf8");
      if (total > LIMITS.outputBytes) void forceStop("output");
    };
    child.stdout.on("data", capture("stdout"));
    child.stderr.on("data", capture("stderr"));
    child.stdin.on("error", () => {});
    child.on("error", () => complete(125));
    child.on("close", (code) => complete(Number.isInteger(code) ? code : 137));
    async function complete(code) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      // A failed Docker client can leave a just-created container behind. This
      // targeted removal is idempotent and also handles the cancellation race.
      if (forced || code === 125) await removeContainer(name, spawnImpl);
      const common = { durationMs: Date.now() - start, cancelled, timedOut };
      if (timedOut || cancelled || outputExceeded) {
        resolve({
          ...common,
          ok: false,
          exitCode: cancelled ? 130 : timedOut ? 124 : 1,
          stdout: "",
          stderr: cancelled
            ? "Execution cancelled."
            : timedOut
              ? "Execution time limit exceeded."
              : "Execution output limit exceeded.",
          testCount: 0,
        });
        return;
      }
      let report;
      try {
        report = JSON.parse(stdout);
      } catch {
        /* Runtime failure or untrusted direct output is not a successful test report. */
      }
      if (
        !report ||
        typeof report.ok !== "boolean" ||
        !Number.isSafeInteger(report.testCount) ||
        report.testCount < 0 ||
        typeof report.stdout !== "string" ||
        typeof report.stderr !== "string"
      ) {
        resolve({
          ...common,
          ok: false,
          exitCode: code || 1,
          stdout: limitedText(stdout),
          stderr: limitedText(
            stderr || "Sandbox did not return a valid test report.",
          ),
          testCount: 0,
        });
        return;
      }
      const staticOnly = run.testCommand === "static-check";
      const ok =
        code === 0 && report.ok && (staticOnly || report.testCount > 0);
      resolve({
        ...common,
        ok,
        exitCode: ok ? 0 : code || 1,
        stdout: limitedText(report.stdout),
        stderr: limitedText(
          report.stderr ||
            (!ok && !staticOnly && !report.testCount
              ? "Zero executed tests."
              : ""),
        ),
        testCount: report.testCount,
        verification: staticOnly ? "static-only" : "tests",
      });
    }
    child.stdin.end(
      JSON.stringify({ files: run.files, testCommand: run.testCommand }),
    );
    if (signal?.aborted) abort();
  });
}

async function readJson(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers["content-type"] || ""))
    throw new RequestError("Content-Type must be application/json.", 415);
  const announced = Number(request.headers["content-length"]);
  if (Number.isFinite(announced) && announced > LIMITS.bodyBytes)
    throw new RequestError("Request body is too large.", 413);
  let bytes = 0;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > LIMITS.bodyBytes)
      throw new RequestError("Request body is too large.", 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RequestError("Invalid JSON.");
  }
}
function send(response, status, body) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

export function createRunnerServer({
  keyPath = "/control/runner-key",
  key,
  executor = executeRun,
  healthCheck,
  spawnImpl = spawn,
} = {}) {
  const active = new Map();
  async function controlKey() {
    const value = key ?? (await readFile(keyPath, "utf8")).trim();
    if (
      typeof value !== "string" ||
      value.length < 32 ||
      value.length > 256 ||
      /\s/.test(value)
    )
      throw new Error("Runner control key unavailable.");
    return value;
  }
  async function authorize(request) {
    const expected = Buffer.from(`Bearer ${await controlKey()}`);
    const actual = Buffer.from(request.headers.authorization || "");
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }
  let healthCache;
  async function ready() {
    await controlKey();
    if (healthCheck) return healthCheck();
    if (healthCache && Date.now() - healthCache.at < 5000)
      return healthCache.ok;
    const ok = await new Promise((resolve) => {
      const child = spawnImpl(
        "docker",
        ["info", "--format", "{{.ServerVersion}}"],
        dockerOptions(),
      );
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve(false);
      }, 3000);
      child.stdout?.resume();
      child.stderr?.resume();
      child.stdin?.end();
      child.on("error", () => {
        clearTimeout(timer);
        resolve(false);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve(code === 0);
      });
    });
    healthCache = { at: Date.now(), ok };
    return ok;
  }
  const server = http.createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/health") {
        const ok = await ready().catch(() => false);
        send(response, ok ? 200 : 503, {
          ok,
          active: active.size,
          isolation: "docker",
        });
        return;
      }
      if (
        !["/run", "/cancel"].includes(request.url) ||
        request.method !== "POST"
      ) {
        send(response, 404, { error: "Not found." });
        return;
      }
      if (!(await authorize(request).catch(() => false))) {
        send(response, 401, { error: "Unauthorized." });
        return;
      }
      const input = await readJson(request);
      if (request.url === "/cancel") {
        if (
          !input ||
          !SAFE_RUN_ID.test(input.runId || "") ||
          Object.keys(input).some((key) => key !== "runId")
        )
          throw new RequestError("Invalid cancellation request.");
        const controller = active.get(input.runId);
        controller?.abort();
        send(response, 200, { ok: true, cancelled: Boolean(controller) });
        return;
      }
      const run = validateRun(input);
      if (active.has(run.runId))
        throw new RequestError("This run is already active.", 409);
      if (active.size >= LIMITS.concurrent)
        throw new RequestError(
          "The execution service is busy. Retry this job later.",
          503,
        );
      const controller = new AbortController();
      active.set(run.runId, controller);
      const disconnect = () => {
        if (!response.writableEnded) controller.abort();
      };
      response.once("close", disconnect);
      try {
        const result = await executor(run, {
          signal: controller.signal,
          spawnImpl,
        });
        send(response, 200, result);
      } finally {
        response.off("close", disconnect);
        active.delete(run.runId);
      }
    } catch (error) {
      send(response, error instanceof RequestError ? error.status : 503, {
        error:
          error instanceof RequestError
            ? error.message
            : "The isolated execution service is unavailable.",
      });
    }
  });
  server.requestTimeout = 150000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxConnections = 32;
  server.shutdown = async () => {
    for (const controller of active.values()) controller.abort();
    await new Promise((resolve) => server.close(resolve));
  };
  return server;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const server = createRunnerServer();
  server.listen(9100, "0.0.0.0", () =>
    console.log("Attendx private execution broker listening on 9100."),
  );
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    void server.shutdown().finally(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
