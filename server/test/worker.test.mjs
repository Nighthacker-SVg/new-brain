import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../core.mjs";
import { startWorker } from "../worker.mjs";

async function fixture(t, options = {}) {
  const store = new Store({ dbPath: ":memory:" });
  const owner = store.createUser("Owner", "worker@example.com", "test-hash");
  const agents = store.state(owner.id).agents;
  const agent = agents.find((a) => a.template === "engineer");
  const project = store.createProject(owner.id, {
    name: "Invoice calculation",
    brief: "Build an invoice total calculator with real executable checks.",
    scope: "client",
    budgetCents: 1000,
    acceptanceCriteria: "Two plus three is five.",
    team: agents.map((a) => a.id),
  });
  const worker = startWorker(store, { pollMs: 25, ...options });
  t.after(async () => {
    await worker.stop();
    store.close();
  });
  async function done(job) {
    worker.wake();
    const until = Date.now() + 5000;
    while (Date.now() < until) {
      const state = store.getJob(job.id);
      if (
        ["completed", "failed", "blocked", "paused", "cancelled"].includes(
          state.status,
        )
      )
        return state;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("Worker did not finish bounded test task.");
  }
  return { store, owner, agent, project, worker, done };
}
const plan = {
  summary: "Implement and test a calculator.",
  questions: [],
  tasks: [{ title: "Implement calculator", agentName: "Theo" }],
  acceptanceCriteria: ["Two plus three is five."],
};
const candidate = {
  summary: "Calculator implementation.",
  runtime: "node",
  testCommand: "node-test",
  files: [
    { path: "invoice.mjs", content: "export const total=(a,b)=>a+b;" },
    {
      path: "invoice.test.mjs",
      content:
        "import{test}from'node:test';import assert from'node:assert/strict';import{total}from'./invoice.mjs';test('invoice total',()=>assert.equal(total(2,3),5));",
    },
  ],
};

test("missing model connection blocks real work without charging or generating fake artifacts", async (t) => {
  const f = await fixture(t, { provider: { configured: false }, runner: {} });
  const result = await f.done(
    f.store.enqueue(f.owner.id, "plan", f.project.id, f.agent.id),
  );
  assert.equal(result.status, "blocked");
  assert.match(result.error, /No AI provider/);
  assert.equal(f.store.getProject(f.owner.id, f.project.id).spentCents, 0);
  assert.equal(f.store.state(f.owner.id).artifacts.length, 0);
});
test("plan approval leads to candidate files, actual runner evidence and a gated release review", async (t) => {
  const calls = [];
  const f = await fixture(t, {
    provider: {
      complete: async (request) => {
        calls.push(request);
        return { text: JSON.stringify(calls.length === 1 ? plan : candidate) };
      },
    },
    runner: {
      run: async (input) => {
        assert.equal(input.testCommand, "node-test");
        assert.equal(input.files.length, 2);
        return {
          ok: true,
          exitCode: 0,
          testCount: 1,
          stdout: "invoice total passed",
          stderr: "",
          durationMs: 3,
        };
      },
    },
  });
  assert.equal(
    (
      await f.done(
        f.store.enqueue(f.owner.id, "plan", f.project.id, f.agent.id),
      )
    ).status,
    "completed",
  );
  const review = f.store
    .state(f.owner.id)
    .reviews.find((r) => r.kind === "plan");
  f.store.decideReview(f.owner.id, review.id, "approved");
  const build = await f.done(
    f.store.enqueue(f.owner.id, "build", f.project.id, f.agent.id),
  );
  assert.equal(build.status, "completed");
  assert.equal(build.result.passed, true);
  const state = f.store.state(f.owner.id),
    release = state.reviews.find((r) => r.kind === "release");
  assert(release);
  f.store.decideReview(f.owner.id, release.id, "approved");
  assert.equal(f.store.getProject(f.owner.id, f.project.id).status, "reviewed");
  assert.equal(f.store.getProject(f.owner.id, f.project.id).spentCents, 50);
  assert(state.artifacts.some((a) => a.kind === "diff"));
  assert(state.artifacts.some((a) => a.kind === "test-report"));
});
test("zero tests and failed tests never create a passing release review", async (t) => {
  const f = await fixture(t, {
    provider: { complete: async () => ({ text: JSON.stringify(candidate) }) },
    runner: {
      run: async () => ({
        ok: true,
        exitCode: 0,
        testCount: 0,
        stdout: "",
        stderr: "",
        durationMs: 1,
      }),
    },
  });
  f.store.updateProject(f.owner.id, f.project.id, {
    plan: JSON.stringify(plan),
    planApproved: true,
  });
  const result = await f.done(
    f.store.enqueue(f.owner.id, "build", f.project.id, f.agent.id),
  );
  assert.equal(result.status, "completed");
  assert.equal(result.result.passed, false);
  assert.equal(
    f.store.getProject(f.owner.id, f.project.id).status,
    "needs_tests",
  );
  assert.equal(
    f.store.state(f.owner.id).reviews.filter((r) => r.kind === "release")
      .length,
    0,
  );
});
test("late model responses after cancellation cannot create artifacts or complete the task", async (t) => {
  let release, started;
  const ready = new Promise((r) => (started = r));
  const f = await fixture(t, {
    provider: {
      complete: async () => {
        started();
        return new Promise((r) => (release = r));
      },
    },
    runner: { cancel: async () => {} },
  });
  const job = f.store.enqueue(f.owner.id, "plan", f.project.id, f.agent.id);
  f.worker.wake();
  await ready;
  f.store.updateProject(f.owner.id, f.project.id, { status: "cancelled" });
  f.worker.cancel(f.project.id);
  release({ text: JSON.stringify(plan) });
  const result = await f.done(job);
  assert.equal(result.status, "cancelled");
  assert.equal(f.store.state(f.owner.id).artifacts.length, 0);
});
test("project memory and promoted instructions never cross client project boundaries", async (t) => {
  let observed;
  const f = await fixture(t, {
    provider: {
      complete: async (request) => {
        observed = request.system;
        return { text: "Current project only." };
      },
    },
    runner: {},
  });
  const other = f.store.createProject(f.owner.id, {
    name: "Other client",
    brief: "Private requirements for a separate client.",
    scope: "client",
    budgetCents: 1000,
    team: [],
    acceptanceCriteria: "",
  });
  f.store.addMemory(f.owner.id, {
    projectId: other.id,
    content: "OTHER_CLIENT_SECRET_MARKER",
  });
  const evaluated = f.store.createImprovementEvaluation(
    f.owner.id,
    other.id,
    f.agent.id,
    "OTHER_CLIENT_SKILL_MARKER",
    { eligible: true, baselineScore: 2, candidateScore: 2, total: 2 },
  );
  f.store.decideReview(f.owner.id, evaluated.review.id, "approved");
  f.store.addMessage(
    f.owner.id,
    f.project.id,
    f.agent.id,
    "user",
    "What is our current scope?",
  );
  assert.equal(
    (
      await f.done(
        f.store.enqueue(f.owner.id, "chat", f.project.id, f.agent.id),
      )
    ).status,
    "completed",
  );
  assert(!observed.includes("OTHER_CLIENT_SECRET_MARKER"));
  assert(!observed.includes("OTHER_CLIENT_SKILL_MARKER"));
});

test("one bounded repair uses failed evidence and preserves the original executable tests", async (t) => {
  let calls = 0,
    runs = 0;
  const f = await fixture(t, {
    provider: {
      complete: async () => ({
        text: JSON.stringify(
          ++calls === 1
            ? candidate
            : {
                summary: "Repair calculator implementation.",
                files: [
                  {
                    path: "invoice.mjs",
                    content: "export const total=(a,b)=>Number(a)+Number(b);",
                  },
                ],
              },
        ),
      }),
    },
    runner: {
      run: async (input) => {
        runs++;
        assert.equal(
          input.files.find((f) => f.path === "invoice.test.mjs").content,
          candidate.files[1].content,
        );
        return {
          ok: runs === 2,
          exitCode: runs === 2 ? 0 : 1,
          testCount: 1,
          stdout: runs === 2 ? "pass" : "actual failure",
          stderr: "",
          durationMs: 1,
        };
      },
    },
  });
  f.store.updateProject(f.owner.id, f.project.id, {
    plan: JSON.stringify(plan),
    planApproved: true,
  });
  const result = await f.done(
    f.store.enqueue(f.owner.id, "build", f.project.id, f.agent.id),
  );
  assert.equal(result.status, "completed");
  assert.equal(result.result.repairAttempted, true);
  assert.equal(result.result.passed, true);
  assert.equal(calls, 2);
  assert.equal(runs, 2);
  assert.equal(f.store.getProject(f.owner.id, f.project.id).spentCents, 50);
});
test("automatic repair cannot edit a failing test to manufacture a passing result", async (t) => {
  let calls = 0,
    runs = 0;
  const f = await fixture(t, {
    provider: {
      complete: async () => ({
        text: JSON.stringify(
          ++calls === 1
            ? candidate
            : {
                summary: "Weaken test",
                files: [
                  {
                    path: "invoice.test.mjs",
                    content:
                      "import{test}from'node:test';test('always passes',()=>{});",
                  },
                ],
              },
        ),
      }),
    },
    runner: {
      run: async () => {
        runs++;
        return {
          ok: false,
          exitCode: 1,
          testCount: 1,
          stdout: "failed",
          stderr: "",
          durationMs: 1,
        };
      },
    },
  });
  f.store.updateProject(f.owner.id, f.project.id, {
    plan: JSON.stringify(plan),
    planApproved: true,
  });
  const result = await f.done(
    f.store.enqueue(f.owner.id, "build", f.project.id, f.agent.id),
  );
  assert.equal(result.status, "failed");
  assert.match(result.error, /tests cannot be changed/);
  assert.equal(runs, 1);
  assert.equal(
    f.store.state(f.owner.id).reviews.filter((r) => r.kind === "release")
      .length,
    0,
  );
});
