import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderRegistry, validateProviderUrl } from "../providers.mjs";

function setup(t) {
  const folder = mkdtempSync(join(tmpdir(), "attendx-provider-"));
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES('alice'),('bob');",
  );
  const registry = new ProviderRegistry(
    { db },
    { masterKeyPath: join(folder, "master.key") },
  );
  t.after(() => {
    db.close();
    rmSync(folder, { recursive: true, force: true });
  });
  return { registry, db, folder };
}
const settings = {
  label: "Engineering",
  type: "openai",
  baseUrl: "https://api.openai.com/v1",
  model: "test-model",
  apiKey: "sk-unit-test-do-not-use",
  roles: ["Software engineer"],
  priority: 2,
  enabled: true,
};

test("provider credentials are encrypted, scoped, and never present in public metadata", (t) => {
  const { registry, db, folder } = setup(t);
  const saved = registry.save("alice", settings);
  assert.equal(saved.keyPresent, true);
  assert.equal(saved.last4, "-use");
  assert.equal(saved.apiKey, undefined);
  const row = db.prepare("SELECT * FROM providers").get();
  assert.equal(JSON.stringify(row).includes(settings.apiKey), false);
  assert.equal(readFileSync(join(folder, "master.key")).length, 32);
  assert.equal(
    registry.candidates("alice", "Software engineer")[0].apiKey,
    settings.apiKey,
  );
  assert.deepEqual(registry.list("bob"), []);
  assert.deepEqual(registry.candidates("alice", "Security reviewer"), []);
  assert.throws(
    () => registry.save("bob", { label: "stolen" }, saved.id),
    /not found/,
  );
  assert.throws(() => registry.remove("bob", saved.id), /not found/);
});
test("blank edit preserves secret, priority routes candidates, disabled entries are not called", (t) => {
  const { registry } = setup(t);
  const first = registry.save("alice", { ...settings, roles: [] });
  registry.save("alice", {
    ...settings,
    label: "Fallback",
    priority: 9,
    roles: [],
  });
  registry.save("alice", { apiKey: "", label: "Renamed" }, first.id);
  assert.equal(registry.candidates("alice", "chat")[0].label, "Renamed");
  assert.equal(registry.candidates("alice", "chat")[0].apiKey, settings.apiKey);
  registry.save("alice", { enabled: false }, first.id);
  assert.equal(registry.candidates("alice", "chat").length, 1);
});
test("provider endpoint validation rejects secret-bearing redirects and arbitrary internal destinations", () => {
  for (const value of [
    "http://api.openai.com/v1",
    "https://api.openai.com.evil.test/v1",
    "https://user:secret@api.openai.com/v1",
    "https://api.openai.com/v1?redirect=evil",
    "http://169.254.169.254/latest",
    "http://localhost:9000",
    "https://api.openai.com:8443/v1",
    "https://api.openai.com/v1/%2e%2e/admin",
  ])
    assert.throws(() => validateProviderUrl(value));
  assert.equal(
    validateProviderUrl("http://host.docker.internal:11434/v1/"),
    "http://host.docker.internal:11434/v1",
  );
  assert.equal(
    validateProviderUrl("https://custom.example/v1", ["custom.example"]),
    "https://custom.example/v1",
  );
});
test("only explicitly local hosts support keyless operation", (t) => {
  const { registry } = setup(t);
  assert.throws(
    () => registry.save("alice", { ...settings, apiKey: "", local: true }),
    /local mode/,
  );
  registry.save("alice", {
    ...settings,
    baseUrl: "http://host.docker.internal:11434/v1",
    apiKey: "",
    local: true,
    roles: [],
  });
  assert.equal(registry.candidates("alice")[0].local, true);
  assert.equal(registry.candidates("alice")[0].apiKey, "");
});

test("changing provider destinations never forwards the previous saved credential", (t) => {
  const { registry } = setup(t);
  const saved = registry.save("alice", { ...settings, roles: [] });
  assert.throws(
    () =>
      registry.save(
        "alice",
        { baseUrl: "https://api.groq.com/openai/v1", apiKey: "" },
        saved.id,
      ),
    /new API key/,
  );
  assert.throws(
    () => registry.save("alice", { type: "anthropic" }, saved.id),
    /new API key/,
  );
  registry.save(
    "alice",
    { baseUrl: "https://api.groq.com/openai/v1", apiKey: "groq-new-test-key" },
    saved.id,
  );
  assert.equal(registry.candidates("alice")[0].apiKey, "groq-new-test-key");
  registry.save(
    "alice",
    { baseUrl: "http://host.docker.internal:11434/v1", local: true },
    saved.id,
  );
  assert.equal(registry.candidates("alice")[0].apiKey, "");
});
