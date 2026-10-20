import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { EventEmitter } from "node:events";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const assert = (condition, status, message) => {
  if (!condition) throw new HttpError(status, message);
};
const snake = (value) => value.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const camel = (value) => value.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const jsonFields = new Set([
  "position_json",
  "permissions_json",
  "payload_json",
  "result_json",
  "evidence_json",
  "detail_json",
  "evaluation_json",
]);
export function record(row) {
  if (!row) return undefined;
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      camel(key.replace(/_json$/, "")),
      jsonFields.has(key)
        ? JSON.parse(value || "null")
        : ["plan_approved", "approved", "enabled"].includes(key)
          ? Boolean(value)
          : value,
    ]),
  );
}
const templates = {
  manager: [
    "Project lead",
    "Coordinate evidence-based delivery. Ask for missing requirements and never claim work without artifacts.",
  ],
  engineer: [
    "Software engineer",
    "Implement maintainable software and executable checks within the authorized project.",
  ],
  quality: [
    "Quality engineer",
    "Verify actual outputs and distinguish failures, untested behavior and passing checks.",
  ],
  security: [
    "Security reviewer",
    "Review isolation, permissions and data handling; request review when authority is insufficient.",
  ],
  designer: [
    "Product designer",
    "Produce accessible, useful interfaces grounded in project requirements.",
  ],
  researcher: [
    "Research specialist",
    "Separate source evidence from inference and report uncertainty.",
  ],
  data: [
    "Data engineer",
    "Build clear data contracts and validate correctness within project scope.",
  ],
};
export const AGENT_TEMPLATES = Object.entries(templates).map(
  ([id, [role]]) => ({ id, role }),
);

export class Store {
  constructor({ dbPath = "/data/attendx.db", now = () => Date.now() } = {}) {
    this.clock = now;
    this.events = new EventEmitter();
    this.events.setMaxListeners(1000);
    this.txDepth = 0;
    if (dbPath !== ":memory:")
      mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(dbPath);
    if (dbPath !== ":memory:") chmodSync(dbPath, 0o600);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,brief TEXT NOT NULL,scope TEXT NOT NULL,stage TEXT NOT NULL DEFAULT 'Intake',status TEXT NOT NULL DEFAULT 'draft',acceptance_criteria TEXT NOT NULL DEFAULT '',repo_url TEXT,budget_cents INTEGER NOT NULL,spent_cents INTEGER NOT NULL DEFAULT 0,plan TEXT,plan_approved INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agents(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,role TEXT NOT NULL,template TEXT NOT NULL,persona TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'waiting',project_id TEXT REFERENCES projects(id),task TEXT NOT NULL DEFAULT '',activity_label TEXT NOT NULL DEFAULT 'Ready for assignment',stage TEXT NOT NULL DEFAULT 'Intake',avatar TEXT NOT NULL,position_json TEXT NOT NULL,permissions_json TEXT NOT NULL,budget_cents INTEGER NOT NULL,expires_at TEXT,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,project_id TEXT NOT NULL REFERENCES projects(id),agent_id TEXT REFERENCES agents(id),status TEXT NOT NULL DEFAULT 'queued',payload_json TEXT NOT NULL,result_json TEXT,error TEXT,attempts INTEGER NOT NULL DEFAULT 0,lease_until TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,project_id TEXT NOT NULL,agent_id TEXT NOT NULL,role TEXT NOT NULL,content TEXT NOT NULL,evidence_json TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS artifacts(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,project_id TEXT NOT NULL,agent_id TEXT,name TEXT NOT NULL,kind TEXT NOT NULL,content TEXT NOT NULL,mime TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,project_id TEXT NOT NULL,agent_id TEXT,kind TEXT NOT NULL,title TEXT NOT NULL,details TEXT NOT NULL,payload_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,agent_id TEXT,project_id TEXT,label TEXT NOT NULL,detail_json TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memories(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,project_id TEXT NOT NULL,content TEXT NOT NULL,source_artifact_id TEXT,approved INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS skills(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,agent_id TEXT NOT NULL,version INTEGER NOT NULL,instructions TEXT NOT NULL,status TEXT NOT NULL,evaluation_json TEXT NOT NULL,created_at TEXT NOT NULL,project_id TEXT);
      CREATE TABLE IF NOT EXISTS schedules(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,project_id TEXT NOT NULL,interval_minutes INTEGER NOT NULL,next_run TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_charges(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,project_id TEXT NOT NULL,agent_id TEXT NOT NULL,cents INTEGER NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS local_model_usage(project_id TEXT PRIMARY KEY REFERENCES projects(id),owner_id TEXT NOT NULL REFERENCES users(id),calls INTEGER NOT NULL DEFAULT 0 CHECK(calls>=0),updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS jobs_claim ON jobs(status,created_at); CREATE INDEX IF NOT EXISTS events_owner ON events(owner_id,created_at);
      CREATE INDEX IF NOT EXISTS projects_owner ON projects(owner_id); CREATE INDEX IF NOT EXISTS artifacts_owner ON artifacts(owner_id,project_id);
      CREATE INDEX IF NOT EXISTS local_model_usage_owner ON local_model_usage(owner_id,project_id);
      CREATE INDEX IF NOT EXISTS memories_knowledge_scope ON memories(owner_id,project_id,approved,created_at);
      CREATE INDEX IF NOT EXISTS artifacts_knowledge_scope ON artifacts(owner_id,project_id,kind,created_at);`);
    if (
      !this.db
        .prepare("PRAGMA table_info(skills)")
        .all()
        .some((column) => column.name === "project_id")
    )
      this.db.exec("ALTER TABLE skills ADD COLUMN project_id TEXT");
  }
  close() {
    this.events.removeAllListeners();
    this.db.close();
  }
  now() {
    return new Date(this.clock()).toISOString();
  }
  id(prefix) {
    return `${prefix}_${randomUUID()}`;
  }
  transaction(fn) {
    if (this.txDepth) return fn();
    this.db.exec("BEGIN IMMEDIATE");
    this.txDepth++;
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.txDepth--;
    }
  }
  emit(ownerId, agentId, projectId, label, detail = {}) {
    const id = this.id("event");
    this.db
      .prepare("INSERT INTO events VALUES(?,?,?,?,?,?,?)")
      .run(
        id,
        ownerId,
        agentId || null,
        projectId || null,
        label,
        JSON.stringify(detail),
        this.now(),
      );
    // Delivery occurs after the synchronous caller's transaction has committed.
    queueMicrotask(() => this.events.emit(ownerId, { id }));
    return id;
  }
  scoped(table, ownerId, id) {
    const row = this.db
      .prepare(`SELECT * FROM ${table} WHERE id=? AND owner_id=?`)
      .get(id, ownerId);
    assert(row, 404, "Not found");
    return record(row);
  }
  getProject(ownerId, id) {
    const project = this.scoped("projects", ownerId, id);
    return {
      ...project,
      localCalls: this.db.prepare(
        "SELECT calls FROM local_model_usage WHERE owner_id=? AND project_id=?",
      ).get(ownerId, id)?.calls || 0,
    };
  }
  getAgent(ownerId, id) {
    const agent = this.scoped("agents", ownerId, id);
    if (agent.expiresAt && agent.expiresAt <= this.now())
      throw new HttpError(409, "Agent authority expired");
    return agent;
  }
  getArtifact(ownerId, id) {
    return this.scoped("artifacts", ownerId, id);
  }
  getReview(ownerId, id) {
    return this.scoped("reviews", ownerId, id);
  }
  getSkill(ownerId, id) {
    return this.scoped("skills", ownerId, id);
  }
  update(table, ownerId, id, patch, allowed) {
    this.scoped(table, ownerId, id);
    const fields = Object.entries(patch).filter(([key]) =>
      allowed.includes(key),
    );
    if (fields.length)
      this.db
        .prepare(
          `UPDATE ${table} SET ${fields.map(([k]) => `${snake(k)}=?`).join(",")} WHERE id=? AND owner_id=?`,
        )
        .run(
          ...fields.map(([, v]) => (typeof v === "boolean" ? +v : v)),
          id,
          ownerId,
        );
    return table === "projects"
      ? this.getProject(ownerId, id)
      : this.scoped(table, ownerId, id);
  }
  updateProject(ownerId, id, patch) {
    return this.update(
      "projects",
      ownerId,
      id,
      { ...patch, updatedAt: this.now() },
      [
        "name",
        "brief",
        "stage",
        "status",
        "acceptanceCriteria",
        "plan",
        "planApproved",
        "updatedAt",
      ],
    );
  }
  updateAgent(ownerId, id, patch) {
    if (patch.projectId) this.getProject(ownerId, patch.projectId);
    return this.update("agents", ownerId, id, patch, [
      "status",
      "projectId",
      "task",
      "activityLabel",
      "stage",
    ]);
  }
  createUser(name, email, passwordHash) {
    return this.transaction(() => {
      const id = this.id("user");
      this.db
        .prepare("INSERT INTO users VALUES(?,?,?,?,?)")
        .run(id, name, email, passwordHash, this.now());
      const project = this.createProject(id, {
        name: "Company operations",
        brief:
          "Your empty operations workspace. Assign a project to begin real work.",
        scope: "product",
        budgetCents: 2500,
        acceptanceCriteria: "",
        team: [],
      });
      const names = ["Maya", "Theo", "Leo", "Sera", "Nia", "Iris", "Ravi"];
      Object.entries(templates).forEach(
        ([template, [role, persona]], index) => {
          this.db
            .prepare(
              "INSERT INTO agents VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            )
            .run(
              this.id("agent"),
              id,
              names[index],
              role,
              template,
              persona,
              "waiting",
              project.id,
              "",
              "Ready for assignment",
              "Intake",
              `${names[index].toLowerCase()}.png`,
              JSON.stringify({
                x: [0.18, 0.44, 0.18, 0.44, 0.8, 0.8, 0.8][index],
                y: [0.22, 0.3, 0.46, 0.55, 0.29, 0.42, 0.61][index],
              }),
              JSON.stringify(["project:read", "artifact:propose"]),
              2500,
              null,
              this.now(),
            );
        },
      );
      this.emit(
        id,
        null,
        project.id,
        "Account created; agents are waiting for real work",
      );
      return { id, name, email };
    });
  }
  createProject(ownerId, input) {
    assert(
      typeof input.name === "string" &&
        input.name.trim().length >= 2 &&
        input.name.length <= 120,
      400,
      "Project name must be 2–120 characters",
    );
    assert(
      typeof input.brief === "string" &&
        input.brief.trim().length >= 8 &&
        input.brief.length <= 20000,
      400,
      "Project brief must be 8–20000 characters",
    );
    assert(
      ["client", "product"].includes(input.scope),
      400,
      "Invalid project scope",
    );
    assert(
      Number.isInteger(input.budgetCents) &&
        input.budgetCents >= 25 &&
        input.budgetCents <= 1000000,
      400,
      "Budget must be 25–1000000 cents",
    );
    const team = input.team || [];
    assert(
      Array.isArray(team) && team.length <= 12,
      400,
      "Invalid project team",
    );
    for (const agentId of team) this.getAgent(ownerId, agentId);
    if (input.repoUrl) {
      let url;
      try {
        url = new URL(input.repoUrl);
      } catch {}
      assert(
        url &&
          url.protocol === "https:" &&
          url.hostname === "github.com" &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash &&
          /^\/[\w.-]+\/[\w.-]+(?:\.git)?\/?$/.test(url.pathname),
        400,
        "Repository must be a public HTTPS github.com owner/repository URL",
      );
    }
    assert(
      !input.acceptanceCriteria ||
        (typeof input.acceptanceCriteria === "string" &&
          input.acceptanceCriteria.length <= 10000),
      400,
      "Invalid acceptance criteria",
    );
    return this.transaction(() => {
      const id = this.id("project");
      const now = this.now();
      this.db
        .prepare(
          "INSERT INTO projects(id,owner_id,name,brief,scope,stage,status,acceptance_criteria,repo_url,budget_cents,spent_cents,plan,plan_approved,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          ownerId,
          input.name.trim(),
          input.brief.trim(),
          input.scope,
          "Intake",
          "draft",
          input.acceptanceCriteria || "",
          input.repoUrl || null,
          input.budgetCents,
          0,
          null,
          0,
          now,
          now,
        );
      for (const agentId of team)
        this.updateAgent(ownerId, agentId, {
          projectId: id,
          status: "waiting",
          task: "Awaiting project plan",
        });
      this.emit(ownerId, null, id, "Project created", { name: input.name });
      return this.getProject(ownerId, id);
    });
  }
  enqueue(ownerId, kind, projectId, agentId, payload = {}) {
    this.getProject(ownerId, projectId);
    if (agentId) {
      const agent = this.getAgent(ownerId, agentId);
      assert(
        !agent.expiresAt || agent.projectId === projectId,
        403,
        "Specialist authority is restricted to its assigned project",
      );
    }
    assert(
      ["plan", "build", "chat", "verify", "improve", "research"].includes(kind),
      400,
      "Unsupported job kind",
    );
    assert(
      this.db
        .prepare(
          "SELECT count(*) AS n FROM jobs WHERE owner_id=? AND status IN ('queued','running')",
        )
        .get(ownerId).n < 30,
      429,
      "Too many queued tasks",
    );
    const id = this.id("job");
    const now = this.now();
    this.db
      .prepare("INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(
        id,
        ownerId,
        kind,
        projectId,
        agentId || null,
        "queued",
        JSON.stringify(payload),
        null,
        null,
        0,
        null,
        now,
        now,
      );
    this.emit(ownerId, agentId, projectId, `${kind} task queued`, {
      jobId: id,
    });
    return this.getJob(id);
  }
  getJob(id) {
    return record(this.db.prepare("SELECT * FROM jobs WHERE id=?").get(id));
  }
  claimJob() {
    return this.transaction(() => {
      this.db
        .prepare(
          "UPDATE jobs SET status='queued',lease_until=NULL,error='Interrupted task recovered after lease expiry' WHERE status='running' AND lease_until < ? AND attempts < 3",
        )
        .run(this.now());
      this.db
        .prepare(
          "UPDATE jobs SET status='failed',error='Maximum recovery attempts reached' WHERE status='running' AND lease_until < ? AND attempts >= 3",
        )
        .run(this.now());
      const row = this.db
        .prepare(
          "SELECT j.* FROM jobs j JOIN projects p ON p.id=j.project_id LEFT JOIN agents a ON a.id=j.agent_id WHERE j.status='queued' AND p.status NOT IN ('paused','cancelled') AND (j.agent_id IS NULL OR (a.status!='paused' AND (a.expires_at IS NULL OR a.expires_at > ?))) ORDER BY j.created_at LIMIT 1",
        )
        .get(this.now());
      if (!row) return undefined;
      this.db
        .prepare(
          "UPDATE jobs SET status='running',attempts=attempts+1,lease_until=?,updated_at=? WHERE id=?",
        )
        .run(new Date(this.clock() + 120000).toISOString(), this.now(), row.id);
      return this.getJob(row.id);
    });
  }
  updateJob(id, patch) {
    const old = this.getJob(id);
    assert(old, 404, "Task not found");
    const fields = Object.entries(patch).filter(([key]) =>
      ["status", "error", "result", "leaseUntil", "attempts"].includes(key),
    );
    if (fields.length)
      this.db
        .prepare(
          `UPDATE jobs SET ${fields.map(([key]) => `${key === "result" ? "result_json" : snake(key)}=?`).join(",")},updated_at=? WHERE id=?`,
        )
        .run(
          ...fields.map(([key, value]) =>
            key === "result" ? JSON.stringify(value) : value,
          ),
          this.now(),
          id,
        );
    this.emit(old.ownerId, old.agentId, old.projectId, "Task state updated", {
      jobId: id,
      status: patch.status || old.status,
    });
    return this.getJob(id);
  }
  addMessage(ownerId, projectId, agentId, role, content, evidenceIds = []) {
    this.getProject(ownerId, projectId);
    this.getAgent(ownerId, agentId);
    assert(
      ["user", "assistant", "system"].includes(role),
      400,
      "Invalid message role",
    );
    assert(
      typeof content === "string" && content.length <= 100000,
      400,
      "Invalid message",
    );
    for (const id of evidenceIds) {
      const artifact = this.getArtifact(ownerId, id);
      assert(artifact.projectId === projectId, 404, "Evidence not found");
    }
    const id = this.id("message");
    this.db
      .prepare("INSERT INTO messages VALUES(?,?,?,?,?,?,?,?)")
      .run(
        id,
        ownerId,
        projectId,
        agentId,
        role,
        content,
        JSON.stringify(evidenceIds),
        this.now(),
      );
    this.emit(ownerId, agentId, projectId, "Conversation updated", {
      messageId: id,
    });
    return record(this.db.prepare("SELECT * FROM messages WHERE id=?").get(id));
  }
  addArtifact(
    ownerId,
    projectId,
    agentId,
    name,
    kind,
    content,
    mime = "application/json",
  ) {
    this.getProject(ownerId, projectId);
    if (agentId) this.getAgent(ownerId, agentId);
    assert(
      typeof content === "string" &&
        Buffer.byteLength(content) <= 8 * 1024 * 1024,
      400,
      "Artifact too large",
    );
    const id = this.id("artifact");
    this.db
      .prepare("INSERT INTO artifacts VALUES(?,?,?,?,?,?,?,?,?)")
      .run(
        id,
        ownerId,
        projectId,
        agentId || null,
        name,
        kind,
        content,
        mime,
        this.now(),
      );
    this.emit(ownerId, agentId, projectId, "Artifact recorded", {
      artifactId: id,
      name,
      kind,
    });
    return this.getArtifact(ownerId, id);
  }
  listArtifacts(ownerId, projectId) {
    this.getProject(ownerId, projectId);
    return this.db
      .prepare(
        "SELECT * FROM artifacts WHERE owner_id=? AND project_id=? ORDER BY created_at DESC LIMIT 100",
      )
      .all(ownerId, projectId)
      .map(record);
  }
  addReview(ownerId, projectId, agentId, kind, title, details, payload = {}) {
    this.getProject(ownerId, projectId);
    if (agentId) this.getAgent(ownerId, agentId);
    assert(
      ["plan", "release", "hire", "improvement"].includes(kind),
      400,
      "Unsupported review kind",
    );
    const id = this.id("review");
    this.db
      .prepare("INSERT INTO reviews VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(
        id,
        ownerId,
        projectId,
        agentId || null,
        kind,
        title,
        details,
        JSON.stringify(payload),
        "pending",
        this.now(),
      );
    this.emit(ownerId, agentId, projectId, "Owner review requested", {
      reviewId: id,
      kind,
    });
    return this.getReview(ownerId, id);
  }
  reserveBudget(ownerId, projectId, cents, agentId) {
    assert(
      Number.isInteger(cents) && cents > 0,
      400,
      "Reservation must be positive integer cents",
    );
    return this.transaction(() => {
      const p = this.getProject(ownerId, projectId);
      assert(
        !["paused", "cancelled"].includes(p.status),
        409,
        "Project is stopped",
      );
      assert(
        p.spentCents + cents <= p.budgetCents,
        409,
        "Project budget exhausted; reservation refused",
      );
      if (agentId) {
        const agent = this.getAgent(ownerId, agentId);
        assert(agent.status !== "paused", 409, "Agent is paused");
        assert(
          !agent.expiresAt || agent.projectId === projectId,
          403,
          "Specialist authority is restricted to its assigned project",
        );
        const spent = this.db
          .prepare(
            "SELECT coalesce(sum(cents),0) AS n FROM agent_charges WHERE owner_id=? AND agent_id=?",
          )
          .get(ownerId, agentId).n;
        assert(
          !agent.expiresAt || spent + cents <= agent.budgetCents,
          409,
          "Agent budget exhausted",
        );
        this.db
          .prepare("INSERT INTO agent_charges VALUES(?,?,?,?,?,?)")
          .run(
            this.id("charge"),
            ownerId,
            projectId,
            agentId,
            cents,
            this.now(),
          );
      }
      this.db
        .prepare(
          "UPDATE projects SET spent_cents=spent_cents+?,updated_at=? WHERE id=? AND owner_id=?",
        )
        .run(cents, this.now(), projectId, ownerId);
      this.emit(
        ownerId,
        agentId || null,
        projectId,
        "Model-call budget reserved",
        { cents, billing: "conservative estimate, not provider invoice" },
      );
      return this.getProject(ownerId, projectId);
    });
  }
  reserveLocalCall(ownerId, projectId, limit, agentId) {
    assert(
      Number.isSafeInteger(limit) && limit >= 1 && limit <= 100000,
      400,
      "Local model-call limit must be an integer from 1 to 100000",
    );
    return this.transaction(() => {
      const project = this.getProject(ownerId, projectId);
      assert(
        !["paused", "cancelled"].includes(project.status),
        409,
        "Project is stopped",
      );
      if (agentId) {
        const agent = this.getAgent(ownerId, agentId);
        assert(agent.status !== "paused", 409, "Agent is paused");
        assert(
          !agent.expiresAt || agent.projectId === projectId,
          403,
          "Specialist authority is restricted to its assigned project",
        );
      }
      const admitted = this.db
        .prepare(
          "INSERT INTO local_model_usage(project_id,owner_id,calls,updated_at) VALUES(?,?,1,?) ON CONFLICT(project_id) DO UPDATE SET calls=local_model_usage.calls+1,updated_at=excluded.updated_at WHERE local_model_usage.owner_id=excluded.owner_id AND local_model_usage.calls<?",
        )
        .run(projectId, ownerId, this.now(), limit);
      if (admitted.changes !== 1) {
        const error = new HttpError(
          409,
          "Local model-call limit exhausted; create a scoped follow-up project or ask the administrator to review its compute limit",
        );
        error.code = "local_call_limit";
        throw error;
      }
      const updated = this.getProject(ownerId, projectId);
      this.db.prepare("UPDATE projects SET updated_at=? WHERE owner_id=? AND id=?")
        .run(this.now(), ownerId, projectId);
      this.emit(ownerId, agentId || null, projectId, "Local model call admitted", {
        localCalls: updated.localCalls,
        localCallLimit: limit,
        externalCostCents: 0,
        billing: "local model compute; no external AI API charge",
      });
      return updated;
    });
  }
  hire(ownerId, input) {
    return this.transaction(() => {
      const p = this.getProject(ownerId, input.projectId);
      assert(
        Object.hasOwn(templates, input.template),
        400,
        "Unknown allowlisted role template",
      );
      assert(
        this.db
          .prepare("SELECT count(*) AS n FROM agents WHERE owner_id=?")
          .get(ownerId).n < 12,
        409,
        "Maximum 12 agents per owner",
      );
      assert(
        typeof input.name === "string" &&
          input.name.trim().length >= 2 &&
          input.name.length <= 60,
        400,
        "Agent name must be 2–60 characters",
      );
      assert(
        typeof input.reason === "string" &&
          input.reason.trim().length >= 8 &&
          input.reason.length <= 2000,
        400,
        "Explain the hiring need",
      );
      assert(
        Number.isInteger(input.budgetCents) &&
          input.budgetCents >= 25 &&
          input.budgetCents <= p.budgetCents - p.spentCents,
        400,
        "Agent budget exceeds remaining project budget",
      );
      assert(
        Number.isInteger(input.expiresHours) &&
          input.expiresHours >= 1 &&
          input.expiresHours <= 168,
        400,
        "Agent expiry must be 1–168 hours",
      );
      const [role, persona] = templates[input.template],
        id = this.id("agent");
      this.db
        .prepare("INSERT INTO agents VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(
          id,
          ownerId,
          input.name.trim(),
          role,
          input.template,
          persona,
          "waiting",
          p.id,
          input.reason,
          "Scoped specialist hired",
          "Intake",
          "theo.png",
          JSON.stringify({ x: 0.54, y: 0.7 }),
          JSON.stringify(["project:read", "artifact:propose"]),
          input.budgetCents,
          new Date(this.clock() + input.expiresHours * 3600000).toISOString(),
          this.now(),
        );
      this.emit(ownerId, id, p.id, "Scoped specialist hired", {
        template: input.template,
        budgetCents: input.budgetCents,
        expiresHours: input.expiresHours,
      });
      return this.getAgent(ownerId, id);
    });
  }
  decideReview(ownerId, id, decision) {
    assert(
      ["approved", "declined"].includes(decision),
      400,
      "Invalid review decision",
    );
    return this.transaction(() => {
      const review = this.getReview(ownerId, id),
        project = this.getProject(ownerId, review.projectId);
      assert(review.status === "pending", 409, "Review already decided");
      if (decision === "approved") {
        if (review.kind === "plan") {
          assert(project.plan, 409, "No recorded plan to approve");
          assert(
            !["cancelled", "paused"].includes(project.status),
            409,
            "Project is stopped",
          );
          this.updateProject(ownerId, project.id, {
            planApproved: true,
            status: "ready",
          });
        } else if (review.kind === "hire")
          this.hire(ownerId, { ...review.payload, projectId: project.id });
        else if (review.kind === "release") {
          assert(
            project.status === "awaiting_review",
            409,
            "Project must be awaiting release review",
          );
          const reportArtifact = this.getArtifact(
            ownerId,
            review.payload.testReportId,
          );
          assert(
            reportArtifact.projectId === project.id &&
              reportArtifact.kind === "test-report",
            409,
            "Actual test evidence required",
          );
          let report;
          try {
            report = JSON.parse(reportArtifact.content);
          } catch {}
          assert(
            report?.ok === true &&
              report.exitCode === 0 &&
              report.testCount > 0 &&
              report.candidateArtifactId === review.payload.artifactId,
            409,
            "Passing executable evidence must match this candidate",
          );
          const artifact = this.getArtifact(ownerId, review.payload.artifactId);
          assert(
            artifact.projectId === project.id,
            404,
            "Release artifact not found",
          );
          assert(project.planApproved, 409, "Approved plan required");
          this.updateProject(ownerId, project.id, {
            status: "reviewed",
            stage: "Release",
          });
        } else if (review.kind === "improvement") {
          const skill = this.getSkill(ownerId, review.payload.skillId);
          assert(skill.agentId === review.agentId, 404, "Skill not found");
          const e = skill.evaluation || {};
          assert(
            skill.status === "candidate" &&
              e.eligible === true &&
              Number.isFinite(e.candidateScore) &&
              Number.isFinite(e.baselineScore) &&
              e.candidateScore >= e.baselineScore &&
              (e.total || e.fixtureCount) >= 2,
            409,
            "Recorded non-regressing evaluation required",
          );
          this.db
            .prepare(
              "UPDATE skills SET status='archived' WHERE owner_id=? AND agent_id=? AND project_id IS ? AND status='active'",
            )
            .run(ownerId, skill.agentId, skill.projectId);
          this.db
            .prepare(
              "UPDATE skills SET status='active' WHERE id=? AND owner_id=?",
            )
            .run(skill.id, ownerId);
        }
      }
      this.db
        .prepare("UPDATE reviews SET status=? WHERE id=? AND owner_id=?")
        .run(decision, id, ownerId);
      this.emit(
        ownerId,
        review.agentId,
        review.projectId,
        "Review decision recorded",
        { reviewId: id, kind: review.kind, decision },
      );
      return this.getReview(ownerId, id);
    });
  }
  addMemory(ownerId, input) {
    this.getProject(ownerId, input.projectId);
    assert(
      typeof input.content === "string" &&
        input.content.trim().length >= 3 &&
        input.content.length <= 20000,
      400,
      "Memory must be 3–20000 characters",
    );
    if (input.sourceArtifactId)
      assert(
        this.getArtifact(ownerId, input.sourceArtifactId).projectId ===
          input.projectId,
        404,
        "Source artifact not found",
      );
    const id = this.id("memory");
    this.db
      .prepare("INSERT INTO memories VALUES(?,?,?,?,?,?,?)")
      .run(
        id,
        ownerId,
        input.projectId,
        input.content.trim(),
        input.sourceArtifactId || null,
        1,
        this.now(),
      );
    this.emit(
      ownerId,
      null,
      input.projectId,
      "Owner-approved project memory saved",
      { memoryId: id },
    );
    return this.scoped("memories", ownerId, id);
  }
  listMemories(ownerId, projectId) {
    this.getProject(ownerId, projectId);
    return this.db
      .prepare(
        "SELECT * FROM memories WHERE owner_id=? AND project_id=? AND approved=1 ORDER BY created_at DESC LIMIT 40",
      )
      .all(ownerId, projectId)
      .map(record);
  }
  searchKnowledge(ownerId, projectId, query, { limit = 5 } = {}) {
    this.getProject(ownerId, projectId);
    assert(
      typeof query === "string" && query.length <= 12000,
      400,
      "Knowledge query must be text up to 12000 characters",
    );
    assert(
      Number.isSafeInteger(limit) && limit >= 1 && limit <= 5,
      400,
      "Knowledge result limit must be an integer from 1 to 5",
    );
    const ignored = new Set([
      "the", "and", "for", "with", "this", "that", "from", "your", "you",
      "are", "was", "will", "can", "have", "has", "into", "about", "please",
      "project", "build", "create", "implement", "how", "what", "them", "their",
    ]);
    const terms = [...new Set(
      (query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [])
        .filter((word) => word.length >= 2 && word.length <= 64 && !ignored.has(word)),
    )].slice(0, 12);
    // Scope indexes narrow the corpus first. Rank the entire approved project
    // corpus in SQLite instead of taking the latest memories before searching.
    // This deliberately uses lexical matching, without another model/service.
    const score = terms.map(() =>
      "(CASE WHEN instr(lower(content),?)>0 THEN 1 ELSE 0 END + CASE WHEN instr(lower(name),?)>0 THEN 2 ELSE 0 END)",
    ).join("+");
    let rows = [];
    if (terms.length) {
      rows = this.db.prepare(`
        WITH knowledge AS (
          SELECT id,'memory' AS kind,'Owner-approved memory' AS name,content,created_at
          FROM memories WHERE owner_id=? AND project_id=? AND approved=1
          UNION ALL
          SELECT id,'research-source' AS kind,name,
            CASE WHEN json_valid(content) THEN
              CASE WHEN json_type(content,'$.text')='text'
                THEN substr(json_extract(content,'$.text'),1,24000) ELSE '' END
              ELSE '' END AS content,
            created_at FROM artifacts
          WHERE owner_id=? AND project_id=? AND kind='research-source'
        ), ranked AS (SELECT *,${score} AS relevance FROM knowledge)
        SELECT id,kind,name,content,created_at FROM ranked WHERE relevance>0
        ORDER BY relevance DESC,created_at DESC,id LIMIT ?
      `).all(ownerId, projectId, ownerId, projectId,
        ...terms.flatMap((term) => [term, term]), limit);
    }
    if (!rows.length) {
      rows = this.db.prepare(
        "SELECT id,'memory' AS kind,'Owner-approved memory' AS name,content,created_at FROM memories WHERE owner_id=? AND project_id=? AND approved=1 ORDER BY created_at DESC,id LIMIT ?",
      ).all(ownerId, projectId, Math.min(limit, 3));
    }
    return rows.map((row) => {
      const content = String(row.content || "");
      const lower = content.toLowerCase();
      const first = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0);
      const start = Math.max(0, (first.length ? Math.min(...first) : 0) - 180);
      const text = content.slice(start, start + 1196);
      return {
        id: row.id,
        kind: row.kind,
        name: String(row.name || "Project source").slice(0, 120),
        snippet: `${start ? "… " : ""}${text}${content.length > start + text.length ? " …" : ""}`,
        createdAt: row.created_at,
      };
    });
  }
  addSkill(
    ownerId,
    agentId,
    version,
    instructions,
    status,
    evaluation = {},
    projectId = null,
  ) {
    this.getAgent(ownerId, agentId);
    if (projectId) this.getProject(ownerId, projectId);
    const id = this.id("skill");
    this.db
      .prepare(
        "INSERT INTO skills(id,owner_id,agent_id,version,instructions,status,evaluation_json,created_at,project_id) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        ownerId,
        agentId,
        version,
        instructions,
        status,
        JSON.stringify(evaluation),
        this.now(),
        projectId,
      );
    return this.getSkill(ownerId, id);
  }
  createImprovementEvaluation(
    ownerId,
    projectId,
    agentId,
    instructions,
    evaluation,
  ) {
    this.getProject(ownerId, projectId);
    this.getAgent(ownerId, agentId);
    return this.transaction(() => {
      const version = this.db
        .prepare(
          "SELECT coalesce(max(version),0)+1 AS n FROM skills WHERE owner_id=? AND agent_id=?",
        )
        .get(ownerId, agentId).n;
      const skill = this.addSkill(
        ownerId,
        agentId,
        version,
        instructions,
        "candidate",
        evaluation,
        projectId,
      );
      const review = this.addReview(
        ownerId,
        projectId,
        agentId,
        "improvement",
        "Review evaluated agent instructions",
        "Fixtures cover only their stated behavior. Owner approval is required before promotion.",
        { skillId: skill.id },
      );
      return { skill, review };
    });
  }
  rollbackSkill(ownerId, id) {
    return this.transaction(() => {
      const skill = this.getSkill(ownerId, id);
      assert(
        ["archived", "active"].includes(skill.status),
        409,
        "Rollback requires a previously approved skill version",
      );
      this.db
        .prepare(
          "UPDATE skills SET status='archived' WHERE owner_id=? AND agent_id=? AND project_id IS ? AND status='active'",
        )
        .run(ownerId, skill.agentId, skill.projectId);
      this.db
        .prepare("UPDATE skills SET status='active' WHERE owner_id=? AND id=?")
        .run(ownerId, id);
      this.emit(
        ownerId,
        skill.agentId,
        null,
        "Approved skill version restored",
        { skillId: id },
      );
      return this.getSkill(ownerId, id);
    });
  }
  createSchedule(ownerId, input) {
    this.getProject(ownerId, input.projectId);
    assert(
      Number.isInteger(input.intervalMinutes) &&
        input.intervalMinutes >= 15 &&
        input.intervalMinutes <= 43200,
      400,
      "Schedule interval must be 15–43200 minutes",
    );
    assert(
      this.db
        .prepare("SELECT count(*) AS n FROM schedules WHERE owner_id=?")
        .get(ownerId).n < 6,
      409,
      "Maximum six schedules",
    );
    const id = this.id("schedule");
    this.db
      .prepare("INSERT INTO schedules VALUES(?,?,?,?,?,?,?)")
      .run(
        id,
        ownerId,
        input.projectId,
        input.intervalMinutes,
        new Date(this.clock() + input.intervalMinutes * 60000).toISOString(),
        1,
        this.now(),
      );
    this.emit(
      ownerId,
      null,
      input.projectId,
      "Periodic verification scheduled",
      { scheduleId: id },
    );
    return this.scoped("schedules", ownerId, id);
  }
  toggleSchedule(ownerId, id) {
    const s = this.scoped("schedules", ownerId, id);
    this.db
      .prepare(
        "UPDATE schedules SET enabled=?,next_run=? WHERE id=? AND owner_id=?",
      )
      .run(
        +!s.enabled,
        new Date(this.clock() + s.intervalMinutes * 60000).toISOString(),
        id,
        ownerId,
      );
    this.emit(ownerId, null, s.projectId, "Verification schedule updated", {
      scheduleId: id,
      enabled: !s.enabled,
    });
    return this.scoped("schedules", ownerId, id);
  }
  state(ownerId) {
    const list = (table, limit = 150) =>
      this.db
        .prepare(
          `SELECT * FROM ${table} WHERE owner_id=? ORDER BY created_at DESC LIMIT ?`,
        )
        .all(ownerId, limit)
        .map(record);
    const usage = new Map(this.db.prepare(
      "SELECT project_id,calls FROM local_model_usage WHERE owner_id=?",
    ).all(ownerId).map((row) => [row.project_id, row.calls]));
    const projects = list("projects").map((p) => ({
        ...p,
        description: p.brief,
        localCalls: usage.get(p.id) || 0,
      })),
      agents = list("agents").map((a) => ({
        ...a,
        status: a.expiresAt && a.expiresAt <= this.now() ? "expired" : a.status,
        artifact: { label: "Open recorded artifacts", kind: "document" },
      }));
    return {
      agents,
      projects,
      reviews: list("reviews"),
      events: list("events", 200).map((e) => ({ ...e, time: e.createdAt })),
      tasks: list("jobs"),
      messages: list("messages", 300),
      artifacts: list("artifacts").map(({ content, ...a }) => ({
        ...a,
        size: Buffer.byteLength(content),
      })),
      memories: list("memories"),
      skills: list("skills"),
      schedules: list("schedules"),
      capabilities: {
        agentTemplates: AGENT_TEMPLATES,
        execution: "isolated-runner",
        repositoryAccess: "public-read-only",
        selfModification: "reviewed-candidate-only",
        billing: "conservative model-call reservations, not provider invoices",
      },
      metrics: {
        reservedCents: projects.reduce((n, p) => n + p.spentCents, 0),
        localCalls: projects.reduce((n, p) => n + p.localCalls, 0),
        activeTasks: this.db
          .prepare(
            "SELECT count(*) AS n FROM jobs WHERE owner_id=? AND status='running'",
          )
          .get(ownerId).n,
      },
    };
  }
}
