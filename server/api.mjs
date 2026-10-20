import http from "node:http";
import {
  scrypt as scryptCallback,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import {
  mkdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
  chmodSync,
} from "node:fs";
import { dirname } from "node:path";
import { Store, HttpError, assert } from "./core.mjs";
import { sourceZip } from "./archive.mjs";
import { runtimePolicy, isLocalProvider } from "./runtime-policy.mjs";
import { providerAvailable } from "./provider.mjs";

const scrypt = promisify(scryptCallback);
const publicUser = ({ id, name, email }) => ({ id, name, email });
const equal = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
export async function passwordHash(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64);
  return `${salt}:${hash.toString("hex")}`;
}
async function verifyPassword(password, hash) {
  const [salt, expected] = (
    hash || "00000000000000000000000000000000:" + "0".repeat(128)
  ).split(":");
  const actual = await scrypt(password, salt, 64);
  const stored = Buffer.from(expected, "hex");
  return stored.length === actual.length && timingSafeEqual(actual, stored);
}
function json(res, status, value, headers = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(body);
}
async function body(req) {
  assert(
    (req.headers["content-type"] || "").split(";")[0] === "application/json",
    415,
    "Content-Type must be application/json",
  );
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 128 * 1024) throw new HttpError(413, "Request too large");
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    assert(
      value && typeof value === "object" && !Array.isArray(value),
      400,
      "JSON object required",
    );
    return value;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Invalid JSON");
  }
}
function cookieValue(req) {
  const found = (req.headers.cookie || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("attendx_session="));
  return found?.slice("attendx_session=".length);
}
function sessionCookie(token, secure, clear = false) {
  return `attendx_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : 86400}${secure ? "; Secure" : ""}`;
}

export function createServer(options = {}) {
  const env = options.env ?? process.env;
  const policy = runtimePolicy(env);
  const store =
    options.store ||
    new Store({
      dbPath:
        options.dbPath || process.env.ATTENDX_DB_PATH || "/data/attendx.db",
    });
  const ownsStore = !options.store,
    registry = options.registry,
    authAttempts = new Map(),
    sockets = new Set();
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    try {
      const url = new URL(req.url, "http://api.internal"),
        path = url.pathname,
        method = req.method;
      const requestHost = new URL("http://" + req.headers.host).hostname;
      const publicHost =
        options.origin || process.env.ATTENDX_PUBLIC_ORIGIN
          ? new URL(options.origin || process.env.ATTENDX_PUBLIC_ORIGIN)
              .hostname
          : null;
      assert(
        [
          "localhost",
          "127.0.0.1",
          "[::1]",
          "terminal.local",
          publicHost,
        ].includes(requestHost),
        403,
        "Request host is not allowed",
      );
      if (method === "GET" && path === "/api/health")
        return json(res, 200, {
          ok: true,
          service: "attendx-api",
          storage: "sqlite",
          worker: !!server.worker,
        });
      const sessionId = cookieValue(req);
      const session =
        sessionId && /^[a-f0-9]{64}$/.test(sessionId)
          ? store.db
              .prepare(
                "SELECT s.*,u.name,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>?",
              )
              .get(sessionId, store.now())
          : undefined;
      const user = session
        ? { id: session.user_id, name: session.name, email: session.email }
        : null;
      if (method === "GET" && path === "/api/session")
        return json(
          res,
          200,
          user ? { user, csrfToken: session.csrf } : { user: null },
        );
      const mutation = ["POST", "PATCH", "DELETE", "PUT"].includes(method);
      if (mutation) {
        const host = req.headers.host;
        assert(
          typeof host === "string" && !/[\s/\\]/.test(host),
          400,
          "Invalid request host",
        );
        let origin;
        try {
          origin = new URL(req.headers.origin);
        } catch {}
        const configured = options.origin || process.env.ATTENDX_PUBLIC_ORIGIN;
        const valid = configured
          ? origin?.origin === new URL(configured).origin
          : origin &&
            ["http:", "https:"].includes(origin.protocol) &&
            origin.host === host;
        assert(valid, 403, "Same-origin request required");
      }
      if (
        method === "POST" &&
        ["/api/auth/register", "/api/auth/login"].includes(path)
      ) {
        assert(
          req.headers["x-requested-with"] === "Attendx",
          403,
          "Attendx request header required",
        );
        const ip = req.socket.remoteAddress || "local",
          now = Date.now();
        const bucket = authAttempts.get(ip) || {
          count: 0,
          until: now + 15 * 60000,
        };
        if (bucket.until < now) {
          bucket.count = 0;
          bucket.until = now + 15 * 60000;
        }
        assert(
          bucket.count < 15,
          429,
          "Too many authentication attempts; try again in 15 minutes",
        );
        bucket.count++;
        authAttempts.set(ip, bucket);
        if (authAttempts.size > 2000)
          for (const [k, b] of authAttempts)
            if (b.until < now) authAttempts.delete(k);
        const input = await body(req);
        assert(
          typeof input.email === "string" &&
            input.email.length <= 254 &&
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email),
          400,
          "Valid email required",
        );
        assert(
          typeof input.password === "string" &&
            input.password.length >= 12 &&
            input.password.length <= 1024,
          400,
          "Password must be 12–1024 characters",
        );
        const email = input.email.trim().toLowerCase();
        let account;
        if (path.endsWith("/register")) {
          assert(
            typeof input.name === "string" &&
              input.name.trim().length >= 2 &&
              input.name.length <= 80,
            400,
            "Name must be 2–80 characters",
          );
          assert(
            !store.db.prepare("SELECT id FROM users WHERE email=?").get(email),
            409,
            "Account already exists",
          );
          const hash = await passwordHash(input.password);
          try {
            account = store.createUser(input.name.trim(), email, hash);
          } catch (error) {
            if (
              error.code === "ERR_SQLITE_ERROR" &&
              String(error.message).includes("UNIQUE")
            )
              throw new HttpError(409, "Account already exists");
            throw error;
          }
        } else {
          const found = store.db
            .prepare("SELECT * FROM users WHERE email=?")
            .get(email);
          const valid = await verifyPassword(
            input.password,
            found?.password_hash,
          );
          assert(found && valid, 401, "Incorrect email or password");
          account = publicUser(found);
        }
        store.db
          .prepare("DELETE FROM sessions WHERE expires_at<=?")
          .run(store.now());
        const token = randomBytes(32).toString("hex"),
          csrf = randomBytes(32).toString("hex");
        store.db
          .prepare("INSERT INTO sessions VALUES(?,?,?,?)")
          .run(
            token,
            account.id,
            csrf,
            new Date(store.clock() + 86400000).toISOString(),
          );
        authAttempts.delete(ip);
        return json(
          res,
          path.endsWith("/register") ? 201 : 200,
          { user: account, csrfToken: csrf },
          {
            "Set-Cookie": sessionCookie(
              token,
              req.headers.origin.startsWith("https:"),
            ),
          },
        );
      }
      assert(user, 401, "Sign in to continue");
      if (mutation)
        assert(
          equal(req.headers["x-csrf-token"], session.csrf),
          403,
          "Invalid CSRF token",
        );
      if (method === "POST" && path === "/api/auth/logout") {
        store.db.prepare("DELETE FROM sessions WHERE id=?").run(sessionId);
        return json(
          res,
          200,
          { ok: true },
          {
            "Set-Cookie": sessionCookie(
              "",
              req.headers.origin?.startsWith("https:"),
              true,
            ),
          },
        );
      }
      if (method === "GET" && path === "/api/state") {
        const snapshot = store.state(user.id);
        return json(res, 200, {
          user,
          ...snapshot,
          runtimePolicy: policy,
          capabilities: {
            ...snapshot.capabilities,
            billing: policy.localOnly
              ? "local model compute; no external AI API charge"
              : snapshot.capabilities.billing,
            modelConfigured: registry
              ? registry
                  .list(user.id)
                  .some(
                    (provider) =>
                      provider.enabled &&
                      (!policy.localOnly || isLocalProvider(provider)) &&
                      (provider.keyPresent || provider.local),
                  ) ||
                (providerAvailable(undefined, { env }) &&
                  store.db
                    .prepare(
                      "SELECT id FROM users ORDER BY created_at,rowid LIMIT 1",
                    )
                    .get()?.id === user.id)
              : providerAvailable(undefined, { env }) &&
                store.db
                  .prepare(
                    "SELECT id FROM users ORDER BY created_at,rowid LIMIT 1",
                  )
                  .get()?.id === user.id,
            runnerConfigured: !!(
              options.runnerUrl || process.env.ATTENDX_RUNNER_URL
            ),
          },
        });
      }
      if (method === "GET" && path === "/api/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.write(": connected\n\n");
        const change = ({ id }) =>
          res.write(`event: change\ndata: ${JSON.stringify({ id })}\n\n`);
        store.events.on(user.id, change);
        sockets.add(res);
        const timer = setInterval(() => {
          const active = store.db
            .prepare("SELECT expires_at FROM sessions WHERE id=?")
            .get(sessionId);
          if (!active || active.expires_at <= store.now()) res.end();
          else res.write(": keepalive\n\n");
        }, 15000);
        timer.unref();
        const close = () => {
          clearInterval(timer);
          store.events.off(user.id, change);
          sockets.delete(res);
        };
        req.on("close", close);
        res.on("close", close);
        return;
      }
      if (path === "/api/providers" && method === "GET") {
        assert(registry, 503, "Provider settings are unavailable");
        return json(res, 200, { providers: registry.list(user.id) });
      }
      if (path === "/api/providers" && method === "POST") {
        assert(registry, 503, "Provider settings are unavailable");
        const input = await body(req);
        assert(
          !policy.localOnly || isLocalProvider(input),
          403,
          "This server permits local AI models only",
        );
        const provider = await registry.save(user.id, input);
        store.emit(user.id, null, null, "AI provider configuration added", {
          providerId: provider.id,
        });
        server.worker?.wake();
        return json(res, 201, { provider });
      }
      const providerMatch = path.match(
        /^\/api\/providers\/([^/]+)(?:\/(test))?$/,
      );
      if (providerMatch) {
        assert(registry, 503, "Provider settings are unavailable");
        const id = providerMatch[1];
        if (method === "PATCH" && !providerMatch[2]) {
          const input = await body(req);
          if (policy.localOnly) {
            const previous = registry.list(user.id).find((item) => item.id === id);
            assert(previous, 404, "Provider not found");
            assert(
              isLocalProvider({ ...previous, ...input }),
              403,
              "This server permits local AI models only",
            );
          }
          const provider = await registry.save(user.id, input, id);
          store.emit(user.id, null, null, "AI provider configuration updated", {
            providerId: id,
          });
          server.worker?.wake();
          return json(res, 200, { provider });
        }
        if (method === "DELETE" && !providerMatch[2]) {
          registry.remove(user.id, id);
          store.emit(user.id, null, null, "AI provider configuration removed", {
            providerId: id,
          });
          return json(res, 200, { ok: true });
        }
        if (method === "POST" && providerMatch[2])
          throw new HttpError(
            501,
            "Connection tests are not available; configure a provider and submit a bounded project plan",
          );
      }
      if (method === "POST" && path === "/api/projects") {
        const project = store.createProject(user.id, await body(req));
        return json(res, 201, { project });
      }
      const knowledgeMatch = path.match(/^\/api\/projects\/([^/]+)\/knowledge$/);
      if (method === "GET" && knowledgeMatch) {
        const project = store.getProject(user.id, knowledgeMatch[1]);
        const query = url.searchParams.get("q") || "";
        assert(query.length <= 1000, 400, "Knowledge search is limited to 1000 characters");
        return json(res, 200, { items: store.searchKnowledge(user.id, project.id, query, { limit: 5 }) });
      }
      const researchMatch = path.match(/^\/api\/projects\/([^/]+)\/research$/);
      if (method === "POST" && researchMatch) {
        const project = store.getProject(user.id, researchMatch[1]);
        assert(!["paused", "cancelled"].includes(project.status), 409, "Project is stopped");
        const input = await body(req);
        assert(typeof input.query === "string" && input.query.trim().length >= 10 && input.query.length <= 1000,
          400, "Research question must be 10–1000 characters");
        const urls = input.urls ?? [];
        assert(Array.isArray(urls) && urls.length <= 3, 400, "Research accepts at most three source URLs");
        for (const value of urls) {
          let parsed;
          try { parsed = typeof value === "string" && value.length <= 1000 ? new URL(value) : null; } catch {}
          assert(parsed && parsed.protocol === "https:" && !parsed.username && !parsed.password && (!parsed.port || parsed.port === "443"),
            400, "Research sources must be HTTPS URLs without credentials");
        }
        assert(!store.db.prepare("SELECT id FROM jobs WHERE owner_id=? AND project_id=? AND kind='research' AND status IN ('queued','running')").get(user.id, project.id),
          409, "Research is already queued or running for this project");
        const assigned = store.db.prepare("SELECT id FROM agents WHERE owner_id=? AND project_id=? AND status!='paused' AND (expires_at IS NULL OR expires_at>?) ORDER BY CASE WHEN template='researcher' THEN 0 ELSE 1 END LIMIT 1").get(user.id, project.id, store.now());
        assert(assigned, 409, "Assign an available agent to this project before research");
        const job = store.enqueue(user.id, "research", project.id, assigned.id, { query: input.query.trim(), urls });
        server.worker?.wake();
        return json(res, 202, { jobId: job.id });
      }
      const projectMatch = path.match(
        /^\/api\/projects\/([^/]+)\/(plan|run|pause|resume|cancel|verify)$/,
      );
      if (method === "POST" && projectMatch) {
        const project = store.getProject(user.id, projectMatch[1]),
          action = projectMatch[2];
        await body(req);
        if (action === "pause" || action === "cancel") {
          const status = action === "pause" ? "paused" : "cancelled";
          store.updateProject(user.id, project.id, { status });
          store.db
            .prepare(
              "UPDATE jobs SET status=?,error=? WHERE owner_id=? AND project_id=? AND status IN ('queued','blocked','paused')",
            )
            .run(status, `Project ${status}`, user.id, project.id);
          await server.worker?.cancel(project.id);
          store.emit(user.id, null, project.id, `Project ${status}`);
          return json(res, 200, {
            project: store.getProject(user.id, project.id),
          });
        }
        if (action === "resume") {
          assert(
            project.status !== "cancelled",
            409,
            "Cancelled project cannot resume",
          );
          store.updateProject(user.id, project.id, {
            status: project.planApproved ? "ready" : "draft",
          });
          store.db
            .prepare(
              "UPDATE jobs SET status='queued',error=NULL WHERE owner_id=? AND project_id=? AND status IN ('paused','blocked')",
            )
            .run(user.id, project.id);
          server.worker?.wake();
          store.emit(user.id, null, project.id, "Project resumed");
          return json(res, 200, {
            project: store.getProject(user.id, project.id),
          });
        }
        assert(
          !["paused", "cancelled"].includes(project.status),
          409,
          "Project is stopped",
        );
        if (action === "run")
          assert(
            project.planApproved,
            409,
            "Owner-approved plan required before execution",
          );
        assert(
          !store.db
            .prepare(
              "SELECT id FROM jobs WHERE owner_id=? AND project_id=? AND kind=? AND status IN ('queued','running')",
            )
            .get(user.id, project.id, action === "run" ? "build" : action),
          409,
          "This project action is already queued or running",
        );
        const assigned =
          store.db
            .prepare(
              "SELECT id FROM agents WHERE owner_id=? AND project_id=? AND template=? AND status!='paused' AND (expires_at IS NULL OR expires_at>?) LIMIT 1",
            )
            .get(
              user.id,
              project.id,
              action === "plan"
                ? "manager"
                : action === "verify"
                  ? "quality"
                  : "engineer",
              store.now(),
            ) ||
          store.db
            .prepare(
              "SELECT id FROM agents WHERE owner_id=? AND project_id=? AND status!='paused' AND (expires_at IS NULL OR expires_at>?) LIMIT 1",
            )
            .get(user.id, project.id, store.now());
        assert(assigned, 409, "No available agent");
        if (action === "plan") {
          store.updateProject(user.id, project.id, {
            planApproved: false,
            status: "planning",
            stage: "Intake",
          });
          store.db
            .prepare(
              "UPDATE reviews SET status='superseded' WHERE owner_id=? AND project_id=? AND kind IN ('plan','release') AND status='pending'",
            )
            .run(user.id, project.id);
        }
        const job = store.enqueue(
          user.id,
          action === "run" ? "build" : action,
          project.id,
          assigned.id,
        );
        server.worker?.wake();
        return json(res, 202, { jobId: job.id });
      }
      if (method === "POST" && path === "/api/agents/hire") {
        const agent = store.hire(user.id, await body(req));
        return json(res, 201, { agent });
      }
      const agentMatch = path.match(
        /^\/api\/agents\/([^/]+)\/(chat|pause|resume)$/,
      );
      if (method === "POST" && agentMatch) {
        const agent = store.getAgent(user.id, agentMatch[1]),
          action = agentMatch[2],
          input = await body(req);
        if (action !== "chat") {
          store.updateAgent(user.id, agent.id, {
            status: action === "pause" ? "paused" : "waiting",
            activityLabel:
              action === "pause" ? "Paused by owner" : "Ready for assignment",
          });
          if (action === "resume") {
            store.db
              .prepare(
                "UPDATE jobs SET status='queued',error=NULL WHERE owner_id=? AND agent_id=? AND status='paused'",
              )
              .run(user.id, agent.id);
            server.worker?.wake();
          }
          store.emit(
            user.id,
            agent.id,
            agent.projectId,
            `Agent ${action === "pause" ? "paused" : "resumed"}`,
          );
          return json(res, 200, { agent: store.getAgent(user.id, agent.id) });
        }
        const project = store.getProject(user.id, input.projectId);
        assert(
          typeof input.message === "string" &&
            input.message.trim().length >= 1 &&
            input.message.length <= 20000,
          400,
          "Message must be 1–20000 characters",
        );
        assert(agent.status !== "paused", 409, "Agent is paused");
        assert(
          !["paused", "cancelled"].includes(project.status),
          409,
          "Project is stopped",
        );
        const job = store.transaction(() => {
          store.addMessage(
            user.id,
            project.id,
            agent.id,
            "user",
            input.message.trim(),
          );
          return store.enqueue(user.id, "chat", project.id, agent.id, {
            message: input.message.trim(),
          });
        });
        server.worker?.wake();
        return json(res, 202, { jobId: job.id });
      }
      const reviewMatch = path.match(/^\/api\/reviews\/([^/]+)\/decision$/);
      if (method === "POST" && reviewMatch) {
        const { decision } = await body(req);
        const review = store.decideReview(user.id, reviewMatch[1], decision);
        server.worker?.wake();
        return json(res, 200, { review });
      }
      if (method === "POST" && path === "/api/memories")
        return json(res, 201, {
          memory: store.addMemory(user.id, await body(req)),
        });
      if (method === "POST" && path === "/api/improvements") {
        const input = await body(req),
          project = store.getProject(user.id, input.projectId),
          agent = store.getAgent(user.id, input.agentId);
        assert(
          typeof input.instructions === "string" &&
            input.instructions.trim().length >= 20 &&
            input.instructions.length <= 12000,
          400,
          "Candidate instructions must be 20–12000 characters",
        );
        assert(
          Array.isArray(input.fixtures) &&
            input.fixtures.length >= 2 &&
            input.fixtures.length <= 6,
          400,
          "Provide 2–6 evaluation fixtures",
        );
        for (const f of input.fixtures)
          assert(
            f &&
              typeof f.input === "string" &&
              f.input.length >= 1 &&
              f.input.length <= 4000 &&
              typeof f.expectedIncludes === "string" &&
              f.expectedIncludes.length >= 1 &&
              f.expectedIncludes.length <= 1000,
            400,
            "Fixtures need bounded input and expectedIncludes text",
          );
        const job = store.enqueue(user.id, "improve", project.id, agent.id, {
          instructions: input.instructions,
          fixtures: input.fixtures,
        });
        server.worker?.wake();
        return json(res, 202, { jobId: job.id });
      }
      const skillMatch = path.match(/^\/api\/skills\/([^/]+)\/rollback$/);
      if (method === "POST" && skillMatch) {
        await body(req);
        return json(res, 200, {
          skill: store.rollbackSkill(user.id, skillMatch[1]),
        });
      }
      if (method === "POST" && path === "/api/schedules")
        return json(res, 201, {
          schedule: store.createSchedule(user.id, await body(req)),
        });
      const scheduleMatch = path.match(/^\/api\/schedules\/([^/]+)\/toggle$/);
      if (method === "POST" && scheduleMatch) {
        await body(req);
        return json(res, 200, {
          schedule: store.toggleSchedule(user.id, scheduleMatch[1]),
        });
      }
      const artifactMatch = path.match(
        /^\/api\/artifacts\/([^/]+)(?:\/(download|bundle))?$/,
      );
      if (method === "GET" && artifactMatch) {
        const artifact = store.getArtifact(user.id, artifactMatch[1]);
        if (!artifactMatch[2]) return json(res, 200, { artifact });
        if (artifactMatch[2] === "bundle") {
          assert(
            artifact.kind === "candidate",
            400,
            "Only candidate source files can be bundled",
          );
          let candidate;
          try {
            candidate = JSON.parse(artifact.content);
          } catch {}
          assert(candidate?.files, 400, "Candidate source is unavailable");
          const zip = sourceZip(candidate.files);
          res.writeHead(200, {
            "Content-Type": "application/zip",
            "Content-Disposition": 'attachment; filename="attendx-source.zip"',
            "Content-Length": zip.length,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          });
          res.end(zip);
          return;
        }
        const filename =
          artifact.name.replace(/[^\w. -]/g, "_").slice(0, 120) ||
          "artifact.txt";
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Security-Policy": "sandbox; default-src 'none'",
          "Cache-Control": "no-store",
        });
        res.end(artifact.content);
        return;
      }
      throw new HttpError(404, "Not found");
    } catch (error) {
      const status = error.status || error.statusCode || 500;
      if (!res.headersSent)
        json(res, status, {
          error:
            status < 500
              ? error.message
              : "Request failed; check server operation and retry",
        });
      else res.end();
    }
  });
  server.store = store;
  server.worker = options.worker;
  server.shutdown = async () => {
    for (const res of sockets) res.end();
    await server.worker?.stop();
    await new Promise((resolve) => server.close(resolve));
    if (ownsStore) store.close();
  };
  return server;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { ProviderRegistry } = await import("./providers.mjs");
  const { startWorker } = await import("./worker.mjs");
  const store = new Store({
    dbPath: process.env.ATTENDX_DB_PATH || "/data/attendx.db",
  });
  const keyPath = process.env.ATTENDX_RUNNER_KEY_PATH || "/control/runner-key";
  mkdirSync(dirname(keyPath), { recursive: true, mode: 0o750 });
  if (!existsSync(keyPath)) {
    try {
      writeFileSync(keyPath, randomBytes(32).toString("hex"), {
        mode: 0o640,
        flag: "wx",
      });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  chmodSync(keyPath, 0o640);
  const registry = new ProviderRegistry(store, {
    masterKeyPath: process.env.ATTENDX_MASTER_KEY_PATH || "/data/master.key",
  });
  const server = createServer({ store, registry });
  server.worker = startWorker(store, {
    registry,
    runnerUrl: process.env.ATTENDX_RUNNER_URL || "http://runner:9100",
    runnerKey: readFileSync(keyPath, "utf8").trim(),
  });
  server.listen(Number(process.env.PORT || 9000), "0.0.0.0", () =>
    console.log("Attendx API listening on port " + (process.env.PORT || 9000)),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, async () => {
      await server.shutdown();
      store.close();
      process.exit(0);
    });
}
