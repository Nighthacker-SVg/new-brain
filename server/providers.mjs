import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname } from "node:path";

const DEFAULT_HOSTS = [
  "api.openai.com",
  "api.anthropic.com",
  "openrouter.ai",
  "api.groq.com",
  "api.deepseek.com",
  "generativelanguage.googleapis.com",
  "host.docker.internal",
  "ollama",
];
const LOCAL_HOSTS = new Set(["host.docker.internal", "ollama"]);
function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.statusCode = status;
  throw error;
}
function hosts(extra) {
  const additions =
    extra ?? (process.env.ATTENDX_PROVIDER_HOSTS || "").split(",");
  return new Set(
    [
      ...DEFAULT_HOSTS,
      ...(typeof additions === "string" ? additions.split(",") : additions),
    ]
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function validateProviderUrl(value, allowedHosts) {
  if (
    typeof value !== "string" ||
    value.length > 500 ||
    /[\s\\%]/.test(value) ||
    /\/\.{1,2}(?:\/|$)/.test(value)
  )
    fail("Enter a valid provider base URL.");
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("Enter a valid provider base URL.");
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !hosts(allowedHosts).has(url.hostname.toLowerCase())
  )
    fail(
      "Provider host is not allowed. Custom hosts require ATTENDX_PROVIDER_HOSTS on the server.",
    );
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))
  )
    fail("Providers require HTTPS, except the configured local Ollama hosts.");
  if (
    (url.port && !LOCAL_HOSTS.has(url.hostname) && url.port !== "443") ||
    !/^\/[a-zA-Z0-9/_.-]*$/.test(url.pathname) ||
    url.pathname.includes("..") ||
    url.pathname.includes("//")
  )
    fail("Unsupported provider URL path or port.");
  return url.href.replace(/\/+$/, "");
}

export class ProviderRegistry {
  constructor(store, options = {}) {
    this.store = store;
    this.allowedHosts = options.allowedHosts;
    const file =
      options.masterKeyPath ||
      process.env.ATTENDX_MASTER_KEY_PATH ||
      "/data/master.key";
    mkdirSync(dirname(file), { recursive: true });
    try {
      writeFileSync(file, randomBytes(32), { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    this.masterKey = readFileSync(file);
    if (this.masterKey.length !== 32)
      throw new Error(
        "Invalid provider encryption key. Restore the original server master key.",
      );
    chmodSync(file, 0o600);
    store.db.exec(`CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), label TEXT NOT NULL,
      type TEXT NOT NULL, base_url TEXT NOT NULL, model TEXT NOT NULL, secret TEXT NOT NULL,
      last4 TEXT NOT NULL, roles_json TEXT NOT NULL, priority INTEGER NOT NULL,
      enabled INTEGER NOT NULL, local INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ); CREATE INDEX IF NOT EXISTS providers_owner ON providers(owner_id);`);
  }
  seal(value, ownerId, id) {
    if (!value) return "";
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.masterKey, iv);
    cipher.setAAD(Buffer.from(`${ownerId}:${id}`));
    const encrypted = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), encrypted]
      .map((part) => part.toString("base64"))
      .join(".");
  }
  open(row) {
    if (!row.secret) return "";
    try {
      const [iv, tag, value] = row.secret
        .split(".")
        .map((part) => Buffer.from(part, "base64"));
      const cipher = createDecipheriv("aes-256-gcm", this.masterKey, iv);
      cipher.setAAD(Buffer.from(`${row.owner_id}:${row.id}`));
      cipher.setAuthTag(tag);
      return Buffer.concat([cipher.update(value), cipher.final()]).toString(
        "utf8",
      );
    } catch {
      fail(
        "Provider credential cannot be decrypted. Restore the original server master key or replace this credential.",
        503,
      );
    }
  }
  metadata(row) {
    return {
      id: row.id,
      label: row.label,
      type: row.type,
      baseUrl: row.base_url,
      model: row.model,
      keyPresent: Boolean(row.secret),
      last4: row.last4,
      roles: JSON.parse(row.roles_json),
      priority: row.priority,
      enabled: Boolean(row.enabled),
      local: Boolean(row.local),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
  list(ownerId) {
    return this.store.db
      .prepare("SELECT * FROM providers WHERE owner_id=? ORDER BY priority,id")
      .all(ownerId)
      .map((row) => this.metadata(row));
  }
  save(ownerId, input, id) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      fail("Invalid provider settings.");
    const allowed = new Set([
      "label",
      "type",
      "baseUrl",
      "model",
      "apiKey",
      "roles",
      "priority",
      "enabled",
      "local",
    ]);
    if (Object.keys(input).some((key) => !allowed.has(key)))
      fail("Unknown provider setting.");
    if (!this.store.db.prepare("SELECT id FROM users WHERE id=?").get(ownerId))
      fail("Account not found.", 404);
    const old = id
      ? this.store.db
          .prepare("SELECT * FROM providers WHERE owner_id=? AND id=?")
          .get(ownerId, id)
      : null;
    if (id && !old) fail("Provider not found.", 404);
    if (!id && this.list(ownerId).length >= 16)
      fail("At most 16 providers may be configured.");
    const previous = old ? this.metadata(old) : {};
    const value = { ...previous, ...input };
    if (
      typeof value.label !== "string" ||
      !value.label.trim() ||
      value.label.length > 80
    )
      fail("Provider name must contain 1–80 characters.");
    if (!["openai", "anthropic"].includes(value.type))
      fail("Choose an OpenAI-compatible or Anthropic provider.");
    const baseUrl = validateProviderUrl(value.baseUrl, this.allowedHosts);
    if (
      typeof value.model !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/@+\-]{0,159}$/.test(value.model)
    )
      fail("Enter a valid model identifier of up to 160 characters.");
    const local = value.local === true;
    if (local && !LOCAL_HOSTS.has(new URL(baseUrl).hostname))
      fail("Keyless local mode is limited to the local Ollama hosts.");
    if (local && value.type !== "openai")
      fail("Local keyless providers must use the OpenAI-compatible protocol.");
    if (value.enabled !== undefined && typeof value.enabled !== "boolean")
      fail("Enabled must be true or false.");
    if (value.local !== undefined && typeof value.local !== "boolean")
      fail("Local must be true or false.");
    const priority = value.priority ?? 10;
    if (!Number.isInteger(priority) || priority < 0 || priority > 100)
      fail("Priority must be an integer from 0 to 100.");
    const roles = value.roles ?? [];
    if (
      !Array.isArray(roles) ||
      roles.length > 16 ||
      roles.some(
        (role) => typeof role !== "string" || !role.trim() || role.length > 80,
      )
    )
      fail("Choose valid role names.");
    const destinationChanged =
      old &&
      (new URL(old.base_url).origin !== new URL(baseUrl).origin ||
        old.type !== value.type);
    if (
      destinationChanged &&
      !local &&
      !(typeof input.apiKey === "string" && input.apiKey.trim())
    )
      fail(
        "Enter a new API key when changing the provider destination or protocol. Saved credentials are never transferred.",
      );
    let apiKey = old && !destinationChanged && !local ? this.open(old) : "";
    if (input.apiKey !== undefined) {
      if (
        typeof input.apiKey !== "string" ||
        input.apiKey.length > 4096 ||
        (input.apiKey && !/^[\x21-\x7e]+$/.test(input.apiKey))
      )
        fail("Invalid API key.");
      if (input.apiKey.trim()) apiKey = input.apiKey.trim();
    }
    if (!local && apiKey.length < 8)
      fail("An API key is required for this provider.");
    const providerId = id || `provider_${randomBytes(12).toString("hex")}`;
    const at = new Date().toISOString();
    const secret = this.seal(apiKey, ownerId, providerId);
    this.store.db
      .prepare(
        `INSERT INTO providers(id,owner_id,label,type,base_url,model,secret,last4,roles_json,priority,enabled,local,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,type=excluded.type,base_url=excluded.base_url,
      model=excluded.model,secret=excluded.secret,last4=excluded.last4,roles_json=excluded.roles_json,priority=excluded.priority,
      enabled=excluded.enabled,local=excluded.local,updated_at=excluded.updated_at`,
      )
      .run(
        providerId,
        ownerId,
        value.label.trim(),
        value.type,
        baseUrl,
        value.model.trim(),
        secret,
        apiKey ? apiKey.slice(-4) : "",
        JSON.stringify([...new Set(roles.map((role) => role.trim()))]),
        priority,
        value.enabled === false ? 0 : 1,
        local ? 1 : 0,
        old?.created_at || at,
        at,
      );
    this.store.emit?.(
      ownerId,
      null,
      null,
      id ? "Updated AI provider settings" : "Added an AI provider",
      { providerId, label: value.label.trim() },
    );
    return this.metadata(
      this.store.db
        .prepare("SELECT * FROM providers WHERE owner_id=? AND id=?")
        .get(ownerId, providerId),
    );
  }
  remove(ownerId, id) {
    const result = this.store.db
      .prepare("DELETE FROM providers WHERE owner_id=? AND id=?")
      .run(ownerId, id);
    if (!result.changes) fail("Provider not found.", 404);
    this.store.emit?.(ownerId, null, null, "Removed an AI provider", {
      providerId: id,
    });
    return { ok: true };
  }
  candidates(ownerId, role = "") {
    const name = String(role).toLowerCase().trim();
    return this.store.db
      .prepare(
        "SELECT * FROM providers WHERE owner_id=? AND enabled=1 ORDER BY priority,id",
      )
      .all(ownerId)
      .filter((row) => {
        const roles = JSON.parse(row.roles_json).map((value) =>
          value.toLowerCase().trim(),
        );
        return (
          (row.secret || row.local) &&
          (!roles.length || roles.includes("*") || roles.includes(name))
        );
      })
      .map((row) => ({ ...this.metadata(row), apiKey: this.open(row) }));
  }
}
