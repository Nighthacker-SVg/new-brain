import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../core.mjs";
import { startWorker } from "../worker.mjs";
import { createServer } from "../api.mjs";

const localEnv = {
  ATTENDX_LOCAL_ONLY: "true",
  ATTENDX_WORKER_CONCURRENCY: "1",
  ATTENDX_LOCAL_MAX_CALLS_PER_PROJECT: "2",
};

function ownerAndProject(store, email = "local@example.com") {
  const owner = store.createUser("Local owner", email, "test-hash");
  const state = store.state(owner.id);
  return { owner, project: state.projects[0], agent: state.agents[0] };
}

async function finish(store, worker, jobs) {
  worker.wake();
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    const states = jobs.map((job) => store.getJob(job.id));
    if (states.every((job) => ["completed", "failed", "blocked"].includes(job.status)))
      return states;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Local-mode worker did not finish its bounded checks");
}

test("local compute admission survives restarts, has a hard quota, and cannot mutate another owner", () => {
  const dir = mkdtempSync(join(tmpdir(), "attendx-local-quota-"));
  const dbPath = join(dir, "workspace.db");
  let store = new Store({ dbPath });
  try {
    const { owner, project, agent } = ownerAndProject(store);
    const other = ownerAndProject(store, "other-local@example.com");
    assert.throws(
      () => store.reserveLocalCall(other.owner.id, project.id, 2, other.agent.id),
      (error) => error.status === 404,
    );
    store.reserveLocalCall(owner.id, project.id, 2, agent.id);
    assert.equal(store.getProject(owner.id, project.id).localCalls, 1);
    assert.equal(store.getProject(owner.id, project.id).spentCents, 0);
    store.close();
    store = new Store({ dbPath });
    const secondConnection = new Store({ dbPath });
    try {
      secondConnection.reserveLocalCall(owner.id, project.id, 2, agent.id);
      assert.throws(
        () => store.reserveLocalCall(owner.id, project.id, 2, agent.id),
        (error) => error.code === "local_call_limit",
      );
      assert.equal(store.getProject(owner.id, project.id).localCalls, 2);
      assert.equal(store.getProject(owner.id, project.id).spentCents, 0);
      assert.equal(store.state(other.owner.id).metrics.localCalls, 0);
      store.updateAgent(owner.id, agent.id, { status: "paused" });
      assert.throws(
        () => store.reserveLocalCall(owner.id, project.id, 20, agent.id),
        /Agent is paused/,
      );
      assert.equal(store.getProject(owner.id, project.id).localCalls, 2);
    } finally {
      secondConnection.close();
    }
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("local worker serializes calls, records zero external cost, and blocks attempts after its quota", async (t) => {
  const store = new Store({ dbPath: ":memory:" });
  const { owner, project, agent } = ownerAndProject(store);
  let calls = 0;
  let running = 0;
  let peak = 0;
  const worker = startWorker(store, {
    env: localEnv,
    pollMs: 25,
    provider: {
      configured: true,
      defaultLocal: true,
      complete: async () => {
        calls++;
        running++;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 30));
        running--;
        return { text: "I am your local project manager." };
      },
    },
    runner: {},
  });
  t.after(async () => { await worker.stop(); store.close(); });
  const jobs = Array.from({ length: 3 }, () =>
    store.enqueue(owner.id, "chat", project.id, agent.id, { message: "Introduce yourself" }),
  );
  const states = await finish(store, worker, jobs);
  assert.equal(states.filter((job) => job.status === "completed").length, 2);
  const blocked = states.find((job) => job.status === "blocked");
  assert.equal(blocked.result.blockedReason, "local_call_limit");
  assert.equal(calls, 2);
  assert.equal(peak, 1);
  assert.equal(store.getProject(owner.id, project.id).localCalls, 2);
  assert.equal(store.getProject(owner.id, project.id).spentCents, 0);
  const responses = store.state(owner.id).events.filter((event) => event.label === "Model response received");
  assert.equal(responses.length, 2);
  assert(responses.every((event) => event.detail.reservedCents === 0 && event.detail.externalCostCents === 0));
});

test("failed local model calls consume the durable quota and never charge a dollar reservation", async (t) => {
  const store = new Store({ dbPath: ":memory:" });
  const { owner, project, agent } = ownerAndProject(store);
  let calls = 0;
  const worker = startWorker(store, {
    env: { ...localEnv, ATTENDX_LOCAL_MAX_CALLS_PER_PROJECT: "1" },
    pollMs: 25,
    provider: {
      configured: true,
      defaultLocal: true,
      complete: async () => { calls++; throw new Error("Local inference is temporarily unavailable"); },
    },
    runner: {},
  });
  t.after(async () => { await worker.stop(); store.close(); });
  const states = await finish(store, worker, Array.from({ length: 2 }, () =>
    store.enqueue(owner.id, "chat", project.id, agent.id, { message: "Hello" }),
  ));
  assert.equal(states.filter((job) => job.status === "failed").length, 1);
  assert.equal(states.filter((job) => job.status === "blocked").length, 1);
  assert.equal(calls, 1);
  assert.equal(store.getProject(owner.id, project.id).localCalls, 1);
  assert.equal(store.getProject(owner.id, project.id).spentCents, 0);
});

test("local-only worker refuses a nonlocal injected fallback before calling it or reserving budget", async (t) => {
  const store = new Store({ dbPath: ":memory:" });
  const { owner, project, agent } = ownerAndProject(store);
  let calls = 0;
  const worker = startWorker(store, {
    env: localEnv,
    pollMs: 25,
    provider: { configured: true, defaultLocal: false, complete: async () => { calls++; return { text: "remote" }; } },
    runner: {},
  });
  t.after(async () => { await worker.stop(); store.close(); });
  const [state] = await finish(store, worker, [store.enqueue(owner.id, "chat", project.id, agent.id)]);
  assert.equal(state.status, "blocked");
  assert.equal(state.result.blockedReason, "local_only");
  assert.equal(calls, 0);
  assert.equal(store.getProject(owner.id, project.id).localCalls, 0);
  assert.equal(store.getProject(owner.id, project.id).spentCents, 0);
});

test("a local provider in mixed mode still uses zero-cost compute quota under concurrent work", async (t) => {
  const store = new Store({ dbPath: ":memory:" });
  const { owner, project, agent } = ownerAndProject(store);
  let calls = 0;
  const worker = startWorker(store, {
    env: { ATTENDX_WORKER_CONCURRENCY: "2", ATTENDX_LOCAL_MAX_CALLS_PER_PROJECT: "1" },
    pollMs: 25,
    registry: {
      candidates: () => [{
        label: "Local Ollama",
        type: "openai",
        local: true,
        model: "local-model",
        baseUrl: "http://ollama:11434/v1",
      }],
    },
    provider: {
      configured: false,
      complete: async () => {
        calls++;
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { text: "This reply used local compute." };
      },
    },
    runner: {},
  });
  t.after(async () => { await worker.stop(); store.close(); });
  const states = await finish(store, worker, Array.from({ length: 2 }, () =>
    store.enqueue(owner.id, "chat", project.id, agent.id, { message: "Hello" }),
  ));
  assert.equal(states.filter((job) => job.status === "completed").length, 1);
  assert.equal(states.filter((job) => job.status === "blocked").length, 1);
  assert.equal(calls, 1);
  assert.equal(store.getProject(owner.id, project.id).localCalls, 1);
  assert.equal(store.getProject(owner.id, project.id).spentCents, 0);
});

test("authenticated state reports local limits and does not advertise a prohibited remote environment model", async (t) => {
  const store = new Store({ dbPath: ":memory:" });
  const server = createServer({
    store,
    env: {
      ...localEnv,
      ATTENDX_MODEL: "remote-model",
      ATTENDX_MODEL_BASE_URL: "https://api.openai.com/v1",
      ATTENDX_MODEL_API_KEY: "test-only-not-a-real-api-key",
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await server.shutdown(); store.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const registration = await fetch(`${origin}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": origin, "X-Requested-With": "Attendx" },
    body: JSON.stringify({ name: "Local owner", email: "state-local@example.com", password: "long-test-password-123" }),
  });
  assert.equal(registration.status, 201);
  const response = await fetch(`${origin}/api/state`, {
    headers: { cookie: registration.headers.get("set-cookie").split(";")[0] },
  });
  assert.equal(response.status, 200);
  const state = await response.json();
  assert.equal(state.runtimePolicy.localOnly, true);
  assert.equal(state.runtimePolicy.workerConcurrency, 1);
  assert.equal(state.runtimePolicy.localCallLimit, 2);
  assert.equal(state.capabilities.modelConfigured, false);
  assert.equal(state.projects[0].localCalls, 0);
});
