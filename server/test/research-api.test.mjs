import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../core.mjs";
import { createServer } from "../api.mjs";

async function fixture(fn) {
  const store = new Store({ dbPath: ":memory:" });
  const server = createServer({ store });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function account(email) {
    const response = await fetch(`${origin}/api/auth/register`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json", "X-Requested-With": "Attendx" },
      body: JSON.stringify({ name: "Research owner", email, password: "research-password-1234" }),
    });
    assert.equal(response.status, 201);
    const session = await response.json();
    return { ...session, cookie: response.headers.get("set-cookie").split(";")[0] };
  }
  async function request(session, path, body) {
    return fetch(`${origin}/api${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Cookie: session.cookie, Origin: origin, "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  try { await fn({ store, account, request }); }
  finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    store.close();
  }
}

test("knowledge HTTP search preserves account and project boundaries", async () => fixture(async ({ store, account, request }) => {
  const a = await account("search-owner@example.invalid");
  const b = await account("search-other@example.invalid");
  const project = store.state(a.user.id).projects[0];
  store.addMemory(a.user.id, { projectId: project.id, content: "Invoice totals are stored as integer cents." });
  const response = await request(a, `/projects/${project.id}/knowledge?q=invoice`);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.items.length, 1);
  assert.match(result.items[0].snippet, /integer cents/);
  assert.equal((await request(b, `/projects/${project.id}/knowledge?q=invoice`)).status, 404);
  assert.equal((await request(a, `/projects/${project.id}/knowledge?q=${"x".repeat(1001)}`)).status, 400);
}));

test("research HTTP actions are scoped, validated and queued once for a real assigned agent", async () => fixture(async ({ store, account, request }) => {
  const a = await account("research-owner@example.invalid");
  const b = await account("research-other@example.invalid");
  const project = store.state(a.user.id).projects[0];
  const body = { query: "Find official Node.js invoice testing guidance", urls: ["https://nodejs.org/api/test.html"] };
  assert.equal((await request(b, `/projects/${project.id}/research`, body)).status, 404);
  assert.equal((await request(a, `/projects/${project.id}/research`, { ...body, query: "tiny" })).status, 400);
  assert.equal((await request(a, `/projects/${project.id}/research`, { ...body, urls: ["http://nodejs.org/api/test.html"] })).status, 400);
  assert.equal((await request(a, `/projects/${project.id}/research`, { ...body, urls: Array(4).fill(body.urls[0]) })).status, 400);
  const response = await request(a, `/projects/${project.id}/research`, body);
  assert.equal(response.status, 202);
  const { jobId } = await response.json();
  const job = store.getJob(jobId);
  assert.equal(job.kind, "research");
  assert.equal(job.ownerId, a.user.id);
  assert.equal(store.getAgent(a.user.id, job.agentId).template, "researcher");
  assert.deepEqual(job.payload, body);
  assert.equal((await request(a, `/projects/${project.id}/research`, body)).status, 409);
}));
