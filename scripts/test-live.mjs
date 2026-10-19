import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { statSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const project = `attendx-check-${randomBytes(5).toString("hex")}`;
const listener = createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
let group = 0;
try {
  group = statSync("/var/run/docker.sock").gid;
} catch {}
const env = {
  ...process.env,
  COMPOSE_FILE: join(root, "compose.yaml"),
  BUILDX_CONFIG: process.env.BUILDX_CONFIG || join(tmpdir(), "attendx-buildx"),
  ATTENDX_PORT: String(port),
  ATTENDX_DOCKER_GID: String(group),
  ATTENDX_MODEL: "",
  ATTENDX_MODEL_API_KEY: "",
  ATTENDX_MODEL_BASE_URL: "https://api.openai.com/v1",
  ATTENDX_MODEL_LOCAL: "false",
  ATTENDX_PUBLIC_ORIGIN: "",
  ATTENDX_BASE_URL: `http://127.0.0.1:${port}`,
  ATTENDX_LIVE_TESTS: "1",
};
function run(command, args, required = true) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit" });
  if (required && (result.error || result.status !== 0))
    throw new Error(`${command} failed (${result.status ?? "unavailable"}).`);
  return result.status ?? 1;
}
let fixture = false;
try {
  run("docker", ["info", "--format", "{{.ServerVersion}}"]);
  run("docker", ["build", "-t", `${project}-model:local`, "tests/fixtures"]);
  run("docker", ["compose", "-p", project, "up", "--no-build", "-d", "--wait"]);
  run("docker", [
    "run",
    "-d",
    "--name",
    `${project}-model`,
    "--network",
    `${project}_default`,
    "--network-alias",
    "ollama",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--memory",
    "128m",
    "--pids-limit",
    "32",
    `${project}-model:local`,
  ]);
  fixture = true;
  process.exitCode = run(
    process.execPath,
    ["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)],
    false,
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  // This random project and fixture are created exclusively by this test run.
  if (fixture) run("docker", ["rm", "-f", `${project}-model`], false);
  run(
    "docker",
    ["compose", "-p", project, "down", "--volumes", "--remove-orphans"],
    false,
  );
  run("docker", ["image", "rm", `${project}-model:local`], false);
}
