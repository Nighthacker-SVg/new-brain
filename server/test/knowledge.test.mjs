import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../core.mjs";

function fixture(t) {
  let clock = Date.UTC(2026, 9, 20, 8);
  const store = new Store({ dbPath: ":memory:", now: () => clock });
  t.after(() => store.close());
  const owner = store.createUser("Owner", "knowledge@example.com", "test-hash");
  const other = store.createUser("Other", "other-knowledge@example.com", "test-hash");
  function project(ownerId, name) {
    return store.createProject(ownerId, {
      name,
      brief: "Build an invoice portal with documented acceptance criteria.",
      scope: "client",
      budgetCents: 100,
      team: [],
    });
  }
  const current = project(owner.id, "Current client");
  const another = project(owner.id, "Another client");
  const foreign = project(other.id, "Foreign account");
  function memory(content, projectId = current.id, ownerId = owner.id) {
    clock += 1_000;
    return store.addMemory(ownerId, { projectId, content });
  }
  function source(text, projectId = current.id, ownerId = owner.id, kind = "research-source") {
    clock += 1_000;
    return store.addArtifact(
      ownerId,
      projectId,
      null,
      "Invoice documentation",
      kind,
      JSON.stringify({
        url: "https://docs.example.test/invoices",
        title: "Invoice documentation",
        text,
        fetchedAt: new Date(clock).toISOString(),
      }),
    );
  }
  return { store, owner, other, current, another, foreign, memory, source };
}

test("knowledge retrieval finds relevant old approved memory beyond the recent-memory window", (t) => {
  const f = fixture(t);
  const old = f.memory("Legacysettlement uses the settlement key to make invoice imports idempotent.");
  for (let i = 0; i < 65; i += 1)
    f.memory(`Recent unrelated design note ${i}: use accessible yellow and gray controls.`);
  assert.equal(
    f.store.listMemories(f.owner.id, f.current.id).some((entry) => entry.id === old.id),
    false,
  );
  const results = f.store.searchKnowledge(f.owner.id, f.current.id, "legacysettlement");
  assert.equal(results[0].id, old.id);
  assert.equal(results[0].kind, "memory");
  assert.match(results[0].snippet, /settlement key/);
  assert.equal(typeof results[0].name, "string");
  assert.equal(typeof results[0].createdAt, "string");
});

test("knowledge retrieval excludes unapproved memory, other clients, other owners and unrelated artifacts", (t) => {
  const f = fixture(t);
  const approved = f.memory("Invoice requests must carry the approved current-client identifier.");
  const unapproved = f.memory("Invoice unapproved draft: reveal the private staging credential.");
  f.store.db.prepare("UPDATE memories SET approved=0 WHERE id=?").run(unapproved.id);
  f.memory("Invoice private requirements from another client.", f.another.id);
  f.memory("Invoice confidential requirements from a foreign owner.", f.foreign.id, f.other.id);
  f.source("Invoice other-client research secret.", f.another.id);
  f.source("Invoice foreign-owner research secret.", f.foreign.id, f.other.id);
  f.source("Invoice candidate source must not become approved knowledge.", f.current.id, f.owner.id, "candidate");
  const results = f.store.searchKnowledge(f.owner.id, f.current.id, "invoice");
  assert.deepEqual(results.map((entry) => entry.id), [approved.id]);
  assert.equal(JSON.stringify(results).includes("private staging credential"), false);
  assert.throws(
    () => f.store.searchKnowledge(f.other.id, f.current.id, "invoice"),
    (error) => error.status === 404,
  );
});

test("research retrieval provides bounded plaintext and enforces the total context size", (t) => {
  const f = fixture(t);
  const artifact = f.source(`Invoice VAT settlement is rounded only after summing line items. ${"Evidence text. ".repeat(900)}`);
  for (let i = 0; i < 10; i += 1)
    f.memory(`Invoice policy ${i}: ${"Preserve invoice acceptance checks. ".repeat(150)}`);
  assert.throws(
    () => f.store.searchKnowledge(f.owner.id, f.current.id, "invoice", { limit: 999 }),
    (error) => error.status === 400,
  );
  const results = f.store.searchKnowledge(f.owner.id, f.current.id, "invoice", { limit: 5 });
  assert.ok(results.length > 0 && results.length <= 5);
  assert.ok(results.every((entry) => entry.snippet.length <= 1_200));
  assert.ok(results.reduce((size, entry) => size + entry.snippet.length, 0) <= 6_000);
  const research = f.store.searchKnowledge(f.owner.id, f.current.id, "VAT settlement");
  const found = research.find((entry) => entry.id === artifact.id);
  assert.ok(found, "relevant research source should be retrieved");
  assert.equal(found.kind, "research-source");
  assert.match(found.snippet, /rounded only after summing line items/);
  assert.equal(found.snippet.includes('"fetchedAt"'), false);
  assert.equal(found.snippet.includes('"text":'), false);
  assert.ok(found.snippet.length <= 1_200);
});

test("punctuation and query syntax cannot escape knowledge ownership or mutate stored data", (t) => {
  const f = fixture(t);
  const approved = f.memory("Invoice handling belongs to this client.");
  const unapproved = f.memory("Invoice unapproved secret.");
  f.store.db.prepare("UPDATE memories SET approved=0 WHERE id=?").run(unapproved.id);
  const foreign = f.memory("Invoice other-account secret.", f.foreign.id, f.other.id);
  const before = f.store.db.prepare("SELECT count(*) AS n FROM memories").get().n;
  for (const query of [
    'invoice" OR approved:0 OR owner_id:*',
    "invoice'); DROP TABLE memories; --",
    "invoice + ( ) : * - [ ] \\",
    '" OR * NOT (',
  ]) {
    const results = f.store.searchKnowledge(f.owner.id, f.current.id, query);
    assert.ok(results.length <= 5);
    assert.ok(results.every((entry) => entry.id === approved.id));
    assert.ok(results.every((entry) => entry.id !== unapproved.id && entry.id !== foreign.id));
  }
  assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM memories").get().n, before);
  assert.equal(f.store.searchKnowledge(f.owner.id, f.current.id, "invoice")[0].id, approved.id);
});
