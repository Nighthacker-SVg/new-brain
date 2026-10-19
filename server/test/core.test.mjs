import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../core.mjs";
import { createServer } from "../api.mjs";
import { ProviderRegistry } from "../providers.mjs";

function user(store, email = "owner@example.com") {
  return store.createUser("Owner", email, "not-a-real-password-hash");
}
function project(store, owner, budget = 200) {
  return store.createProject(owner, {
    name: "Real project",
    brief: "Build and test a useful customer portal.",
    scope: "client",
    budgetCents: budget,
    team: [],
    acceptanceCriteria: "Executable tests pass.",
  });
}
function memoryStore() {
  return new Store({ dbPath: ":memory:" });
}

test("persistent accounts seed waiting personas and no invented output", () => {
  const dir = mkdtempSync(join(tmpdir(), "attendx-store-"));
  let store;
  try {
    store = new Store({ dbPath: join(dir, "workspace.db") });
    const owner = user(store);
    let state = store.state(owner.id);
    assert.equal(state.agents.length, 7);
    assert(state.agents.every((a) => a.status === "waiting"));
    assert.equal(state.projects.length, 1);
    assert.equal(state.artifacts.length, 0);
    assert.equal(state.tasks.length, 0);
    assert.equal(state.metrics.reservedCents, 0);
    store.close();
    store = new Store({ dbPath: join(dir, "workspace.db") });
    state = store.state(owner.id);
    assert.equal(state.agents.length, 7);
    assert.equal(state.projects[0].name, "Company operations");
    assert(!JSON.stringify(state).includes("password_hash"));
  } finally {
    store?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cross-tenant project, memory, artifact, review and queue IDs fail closed", () => {
  const store = memoryStore();
  try {
    const a = user(store),
      b = user(store, "other@example.com"),
      p = project(store, a.id);
    const agent = store.state(a.id).agents[0];
    const artifact = store.addArtifact(
      a.id,
      p.id,
      agent.id,
      "evidence.json",
      "tests",
      '{"passed":false}',
    );
    const review = store.addReview(
      a.id,
      p.id,
      agent.id,
      "release",
      "Review",
      "Actual evidence",
      { artifactId: artifact.id },
    );
    for (const action of [
      () => store.getProject(b.id, p.id),
      () => store.getAgent(b.id, agent.id),
      () => store.getArtifact(b.id, artifact.id),
      () => store.decideReview(b.id, review.id, "approved"),
      () => store.enqueue(b.id, "chat", p.id, agent.id),
      () =>
        store.addMemory(b.id, {
          projectId: store.state(b.id).projects[0].id,
          content: "Borrow private evidence",
          sourceArtifactId: artifact.id,
        }),
    ])
      assert.throws(action, (e) => e.status === 404);
    assert.equal(store.state(b.id).artifacts.length, 0);
    assert.equal(store.state(b.id).reviews.length, 0);
  } finally {
    store.close();
  }
});

test("budget reservations are atomic, bounded and explicitly charged to expiring specialists", () => {
  let now = Date.now();
  const store = new Store({ dbPath: ":memory:", now: () => now });
  try {
    const owner = user(store),
      p = project(store, owner.id, 100);
    const specialist = store.hire(owner.id, {
      projectId: p.id,
      template: "engineer",
      name: "Ada",
      reason: "Additional specialist implementation work",
      budgetCents: 25,
      expiresHours: 1,
    });
    store.reserveBudget(owner.id, p.id, 25, specialist.id);
    assert.throws(
      () => store.reserveBudget(owner.id, p.id, 1, specialist.id),
      /Agent budget exhausted/,
    );
    assert.equal(store.getProject(owner.id, p.id).spentCents, 25);
    store.reserveBudget(owner.id, p.id, 75);
    assert.throws(
      () => store.reserveBudget(owner.id, p.id, 1),
      /budget exhausted/,
    );
    assert.equal(store.getProject(owner.id, p.id).spentCents, 100);
    now += 3600001;
    assert.throws(() => store.getAgent(owner.id, specialist.id), /expired/);
  } finally {
    store.close();
  }
});

test("hiring enforces template, owner limit and project-specific authority", () => {
  const store = memoryStore();
  try {
    const owner = user(store),
      p = project(store, owner.id, 1000),
      other = project(store, owner.id);
    const input = {
      projectId: p.id,
      template: "engineer",
      name: "Ada",
      reason: "Additional implementation workload",
      budgetCents: 25,
      expiresHours: 1,
    };
    assert.throws(
      () => store.hire(owner.id, { ...input, template: "administrator" }),
      /allowlisted/,
    );
    assert.throws(
      () => store.hire(owner.id, { ...input, budgetCents: 1001 }),
      /budget/,
    );
    const specialist = store.hire(owner.id, input);
    assert.throws(
      () => store.enqueue(owner.id, "chat", other.id, specialist.id),
      /restricted/,
    );
    for (let i = 0; i < 4; i++)
      store.hire(owner.id, { ...input, name: `Specialist ${i}` });
    assert.throws(() => store.hire(owner.id, input), /Maximum 12/);
  } finally {
    store.close();
  }
});

test("owner approval gates plan, release and evaluated skill promotion with rollback", () => {
  const store = memoryStore();
  try {
    const owner = user(store),
      p = project(store, owner.id),
      agent = store.state(owner.id).agents[0];
    const planReview = store.addReview(
      owner.id,
      p.id,
      agent.id,
      "plan",
      "Plan",
      "Needs approval",
    );
    assert.throws(
      () => store.decideReview(owner.id, planReview.id, "approved"),
      /No recorded plan/,
    );
    store.updateProject(owner.id, p.id, { plan: '{"summary":"Build portal"}' });
    store.decideReview(owner.id, planReview.id, "approved");
    assert.equal(store.getProject(owner.id, p.id).planApproved, true);
    assert.throws(
      () => store.decideReview(owner.id, planReview.id, "approved"),
      /already decided/,
    );
    const bad = store.createImprovementEvaluation(
      owner.id,
      p.id,
      agent.id,
      "Candidate instructions requiring evidence.",
      { eligible: false, baselineScore: 2, candidateScore: 1, total: 2 },
    );
    assert.throws(
      () => store.decideReview(owner.id, bad.review.id, "approved"),
      /non-regressing/,
    );
    assert.throws(
      () => store.rollbackSkill(owner.id, bad.skill.id),
      /previously approved/,
    );
    const good = store.createImprovementEvaluation(
      owner.id,
      p.id,
      agent.id,
      "Better instructions requiring complete evidence.",
      { eligible: true, baselineScore: 1, candidateScore: 2, total: 2 },
    );
    store.decideReview(owner.id, good.review.id, "approved");
    assert.equal(store.getSkill(owner.id, good.skill.id).status, "active");
    const next = store.createImprovementEvaluation(
      owner.id,
      p.id,
      agent.id,
      "Another evaluated instruction version.",
      { eligible: true, baselineScore: 2, candidateScore: 2, total: 2 },
    );
    store.decideReview(owner.id, next.review.id, "approved");
    assert.equal(store.getSkill(owner.id, good.skill.id).status, "archived");
    store.rollbackSkill(owner.id, good.skill.id);
    assert.equal(store.getSkill(owner.id, good.skill.id).status, "active");
    assert.equal(store.getSkill(owner.id, next.skill.id).status, "archived");
  } finally {
    store.close();
  }
});

test("durable jobs lease once, recover interruptions, and skip paused projects", () => {
  let now = Date.now();
  const store = new Store({ dbPath: ":memory:", now: () => now });
  try {
    const owner = user(store),
      p = project(store, owner.id),
      agent = store.state(owner.id).agents[0];
    const queued = store.enqueue(owner.id, "plan", p.id, agent.id, {
      bounded: true,
    });
    const first = store.claimJob();
    assert.equal(first.id, queued.id);
    assert.deepEqual(first.payload, { bounded: true });
    assert.equal(first.attempts, 1);
    assert.equal(store.claimJob(), undefined);
    now += 120001;
    const recovered = store.claimJob();
    assert.equal(recovered.id, queued.id);
    assert.equal(recovered.attempts, 2);
    store.updateJob(queued.id, {
      status: "completed",
      result: { verified: true },
    });
    assert.deepEqual(store.getJob(queued.id).result, { verified: true });
    store.enqueue(owner.id, "verify", p.id, agent.id);
    store.updateProject(owner.id, p.id, { status: "paused" });
    assert.equal(store.claimJob(), undefined);
  } finally {
    store.close();
  }
});

async function apiFixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "attendx-api-")),
    store = memoryStore(),
    registry = new ProviderRegistry(store, {
      masterKeyPath: join(dir, "master.key"),
    });
  const server = createServer({ store, registry });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await server.shutdown();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  async function call(
    path,
    { method = "GET", data, cookie, csrf, headers = {} } = {},
  ) {
    const response = await fetch(origin + path, {
      method,
      headers: {
        ...(method !== "GET"
          ? { "Content-Type": "application/json", Origin: origin }
          : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        ...headers,
      },
      ...(method !== "GET" ? { body: JSON.stringify(data || {}) } : {}),
    });
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
      headers: response.headers,
    };
  }
  async function register(email) {
    const result = await call("/api/auth/register", {
      method: "POST",
      data: { name: "Owner", email, password: "long-password-1234" },
      headers: { "X-Requested-With": "Attendx" },
    });
    assert.equal(result.status, 201);
    return {
      cookie: result.cookie,
      csrf: result.data.csrfToken,
      user: result.data.user,
    };
  }
  return { store, registry, server, origin, call, register };
}

test("HTTP auth rejects cross-origin and CSRF requests; session cookies and logout work", async (t) => {
  const { call, register } = await apiFixture(t);
  assert.equal((await call("/api/session")).data.user, null);
  assert.equal((await call("/api/state")).status, 401);
  assert.equal(
    (
      await call("/api/auth/register", {
        method: "POST",
        data: {},
        headers: {
          Origin: "https://evil.example",
          "X-Requested-With": "Attendx",
        },
      })
    ).status,
    403,
  );
  const auth = await register("http@example.com");
  assert.match(
    (await call("/api/session", { cookie: auth.cookie })).data.user.email,
    /http@example.com/,
  );
  const request = {
    name: "Portal",
    brief: "Build the actual customer portal.",
    scope: "client",
    budgetCents: 200,
    team: (await call("/api/state", auth)).data.agents
      .filter((a) => a.template === "manager")
      .map((a) => a.id),
  };
  assert.equal(
    (
      await call("/api/projects", {
        method: "POST",
        cookie: auth.cookie,
        data: request,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/api/projects", {
        method: "POST",
        ...auth,
        data: request,
        headers: { Origin: "null" },
      })
    ).status,
    403,
  );
  const projectResult = await call("/api/projects", {
    method: "POST",
    ...auth,
    data: request,
  });
  assert.equal(projectResult.status, 201);
  assert.equal(
    (
      await call(`/api/projects/${projectResult.data.project.id}/run`, {
        method: "POST",
        ...auth,
      })
    ).status,
    409,
  );
  const plan = await call(
    `/api/projects/${projectResult.data.project.id}/plan`,
    { method: "POST", ...auth },
  );
  assert.equal(plan.status, 202);
  assert.equal(
    (await call("/api/auth/logout", { method: "POST", ...auth })).status,
    200,
  );
  assert.equal((await call("/api/state", { cookie: auth.cookie })).status, 401);
});

test("HTTP owner isolation includes provider secrets and unsafe artifact downloads", async (t) => {
  const { call, register, store } = await apiFixture(t),
    a = await register("first@example.com"),
    b = await register("second@example.com");
  const p = project(store, a.user.id),
    agent = store.state(a.user.id).agents[0],
    artifact = store.addArtifact(
      a.user.id,
      p.id,
      agent.id,
      "untrusted.html",
      "preview",
      "<script>window.pwned=true</script>",
      "text/html",
    );
  assert.equal((await call(`/api/artifacts/${artifact.id}`, b)).status, 404);
  const own = await call(`/api/artifacts/${artifact.id}`, a);
  assert.equal(own.data.artifact.content, "<script>window.pwned=true</script>");
  const created = await call("/api/providers", {
    method: "POST",
    ...a,
    data: {
      label: "Main",
      type: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-example",
      apiKey: "secret-test-value-1234",
      roles: [],
      priority: 10,
      enabled: true,
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.provider.last4, "1234");
  assert(!JSON.stringify(created.data).includes("secret-test-value"));
  assert.equal((await call("/api/providers", b)).data.providers.length, 0);
  assert.equal(
    (
      await call(`/api/providers/${created.data.provider.id}`, {
        method: "PATCH",
        ...b,
        data: { enabled: false },
      })
    ).status,
    404,
  );
  const state = await call("/api/state", a);
  assert(!JSON.stringify(state.data).includes("secret-test-value"));
  assert(!JSON.stringify(state.data).includes("password_hash"));
});
