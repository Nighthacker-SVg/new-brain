import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../api.mjs";
import { Store } from "../core.mjs";
import { request } from "node:http";

function send(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, options, (res) => {
      const chunks = [];
      res.on("data", (part) => chunks.push(part));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, json: () => JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    req.on("error", reject);
    req.end(options.body);
  });
}

test("an exact HTTPS Cloud Shell origin works while other hosts and origins fail", async () => {
  const origin = "https://8080-cloud-shell-example.cloudshell.dev";
  const store = new Store({ dbPath: ":memory:" });
  const server = createServer({ store, origin });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const headers = { Host: new URL(origin).host, Origin: origin, "Content-Type": "application/json", "X-Requested-With": "Attendx" };
  try {
    const registered = await send(`${endpoint}/api/auth/register`, {
      method: "POST", headers,
      body: JSON.stringify({ name: "Cloud owner", email: "cloud-owner@example.invalid", password: "cloud-owner-password-1234" }),
    });
    assert.equal(registered.status, 201);
    const cookie = registered.headers["set-cookie"][0];
    assert.match(cookie, /; Secure(?:;|$)/);
    assert.match(cookie, /HttpOnly/);
    const session = await registered.json();
    assert.ok(session.csrfToken);
    const state = await send(`${endpoint}/api/state`, { headers: { ...headers, Cookie: cookie.split(";")[0] } });
    assert.equal(state.status, 200);
    assert.equal((await state.json()).agents.length, 7);
    const forbiddenOrigin = await send(`${endpoint}/api/auth/login`, {
      method: "POST", headers: { ...headers, Origin: "https://another.cloudshell.dev" }, body: "{}",
    });
    assert.equal(forbiddenOrigin.status, 403);
    const forbiddenHost = await send(`${endpoint}/api/health`, { headers: { Host: "another.cloudshell.dev" } });
    assert.equal(forbiddenHost.status, 403);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    store.close();
  }
});
