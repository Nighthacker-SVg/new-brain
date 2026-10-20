import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowClockwise,
  ArrowRight,
  ArrowSquareOut,
  Brain,
  ChatCircleText,
  Check,
  CheckCircle,
  Clock,
  Code,
  Database,
  DownloadSimple,
  FileText,
  FolderSimple,
  Gear,
  HouseLine,
  Lightning,
  List,
  LockKey,
  MagnifyingGlass,
  Pause,
  Play,
  Plus,
  Pulse,
  ShieldCheck,
  SignOut,
  Sparkle,
  SquaresFour,
  Stop,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import { api, ApiError, mutate, setCsrfToken } from "./live-api";
import type {
  LiveAgent,
  LiveArtifact,
  LiveKnowledgeItem,
  LiveProject,
  LiveProvider,
  LiveState,
  LiveUser,
} from "./live-types";
import "./live.css";
import { OfficeMotion } from "./OfficeMotion";
import LiveInsights from "./LiveInsights";

const asset = (name = "maya.png") =>
  `${import.meta.env.BASE_URL}assets/${["office.png", "maya.png", "theo.png", "leo.png", "sera.png", "nia.png", "iris.png", "ravi.png"].includes(name) ? name : "maya.png"}`;
const money = (cents = 0) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
const date = (value?: string) =>
  value ? new Date(value).toLocaleString() : "—";
const pretty = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value, null, 2);
const human = (value?: string) => (value || "waiting").replaceAll("_", " ");
const nav = [
  { name: "Office", Icon: HouseLine },
  { name: "Projects", Icon: FolderSimple },
  { name: "Agents", Icon: UsersThree },
  { name: "Activity", Icon: Pulse },
  { name: "Reviews", Icon: ShieldCheck },
  { name: "Settings", Icon: Gear },
] as const;
type View = (typeof nav)[number]["name"];
type Action = (
  path: string,
  body?: unknown,
  method?: string,
) => Promise<unknown>;
type WorkspaceTab =
  | "Overview"
  | "Chat"
  | "Research"
  | "Evidence"
  | "Memory"
  | "Improve"
  | "Monitoring";

function Status({ value }: { value?: string }) {
  return (
    <span className={`lx-status lx-status-${value || "waiting"}`}>
      <i />
      {human(value)}
    </span>
  );
}
function Avatar({
  agent,
  large = false,
}: {
  agent: LiveAgent;
  large?: boolean;
}) {
  return (
    <img
      loading="lazy"
      decoding="async"
      className={`lx-avatar ${large ? "lx-avatar-large" : ""}`}
      src={asset(agent.avatar)}
      alt=""
    />
  );
}
function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="lx-empty">
      <SquaresFour size={30} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Submit({
  children,
  onAction,
  busy = false,
}: {
  children: ReactNode;
  onAction: () => void;
  busy?: boolean;
}) {
  return (
    <button
      className="lx-button lx-primary"
      type="submit"
      disabled={busy}
      onClick={(event) => {
        event.preventDefault();
        if (event.currentTarget.form?.reportValidity()) onAction();
      }}
    >
      {busy ? <span className="motion-spinner" /> : null}
      {children}
    </button>
  );
}
function Form({
  children,
  onAction,
  className = "",
}: {
  children: ReactNode;
  onAction: () => void;
  className?: string;
}) {
  return (
    <form
      className={className}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onAction();
      }}
    >
      {children}
    </form>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const id = useId(),
    ref = useRef<HTMLDivElement>(null),
    close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const old = document.activeElement as HTMLElement | null,
      bg = document.querySelector<HTMLElement>(".lx-app"),
      wasInert = bg?.inert;
    if (bg) bg.inert = true;
    const otherDialogs = Array.from(
      document.querySelectorAll<HTMLElement>(".lx-overlay"),
    ).filter((node) => !node.contains(ref.current));
    const previousInert = otherDialogs.map((node) => node.inert);
    otherDialogs.forEach((node) => (node.inert = true));
    const el = ref.current!;
    const selector =
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]';
    (
      el.querySelector<HTMLElement>(
        'input:not([type="checkbox"]):not([type="radio"])',
      ) ||
      el.querySelector<HTMLElement>(selector) ||
      el
    ).focus();
    const key = (event: KeyboardEvent) => {
      if (el.closest<HTMLElement>(".lx-overlay")?.inert) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
      }
      if (event.key === "Tab") {
        const nodes = Array.from(
          el.querySelectorAll<HTMLElement>(selector),
        ).filter((node) => node.getClientRects().length);
        const first = nodes[0],
          last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      if (bg) bg.inert = !!wasInert;
      otherDialogs.forEach(
        (node, index) => (node.inert = previousInert[index]),
      );
      old?.isConnected && old.focus();
    };
  }, []);
  return createPortal(
    <div
      className="lx-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={`lx-dialog motion-enter ${wide ? "lx-dialog-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        ref={ref}
        tabIndex={-1}
      >
        <header className="lx-dialog-head">
          <h2 id={id}>{title}</h2>
          <button
            className="lx-icon"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={22} />
          </button>
        </header>
        {children}
      </section>
    </div>,
    document.body,
  );
}

function Auth({ onLogin }: { onLogin: (user: LiveUser) => void }) {
  const [register, setRegister] = useState(false),
    [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await mutate<{ user: LiveUser; csrfToken: string }>(
        `/auth/${register ? "register" : "login"}`,
        { name, email, password },
      );
      setCsrfToken(result.csrfToken);
      setPassword("");
      onLogin(result.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="lx-auth">
      <div className="lx-auth-art">
        <span className="lx-logo">
          Attend<span>x</span>
          <i>LIVE</i>
        </span>
        <div className="lx-auth-copy">
          <span className="lx-eyebrow">YOUR AI COMPANY, CONNECTED</span>
          <h1>
            A place for ideas
            <br />
            to become real work.
          </h1>
          <p>
            Meet your team. Set a direction.
            <br />
            Follow every decision, file, and result.
          </p>
        </div>
        <img
          src={asset("office.png")}
          alt="An isometric gray and yellow virtual office"
        />
        <div className="lx-auth-note">
          <ShieldCheck />
          Your permissions. Your budget. Your final approval.
        </div>
      </div>
      <div className="lx-auth-panel">
        <div className="lx-auth-form">
          <span className="lx-eyebrow">ATTENDX WORKSPACE</span>
          <h2>{register ? "Create your company" : "Welcome back."}</h2>
          <p>
            {register
              ? "Your workspace starts with seven AI specialists, ready for your first brief."
              : "Sign in to your agents, projects, and delivery workspace."}
          </p>
          <Form onAction={submit}>
            {register && (
              <label className="lx-field">
                Your name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  required
                  maxLength={80}
                />
              </label>
            )}
            <label className="lx-field">
              Email address
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                maxLength={254}
              />
            </label>
            <label className="lx-field">
              Password
              <input
                type="password"
                aria-label="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={register ? "new-password" : "current-password"}
                required
                minLength={register ? 12 : 1}
                maxLength={256}
              />
              {register && <small>Use at least 12 characters.</small>}
            </label>
            {error && (
              <p className="lx-error" role="alert">
                {error}
              </p>
            )}
            <Submit onAction={submit} busy={busy}>
              {register ? "Create workspace" : "Sign in"}
              <ArrowRight />
            </Submit>
          </Form>
          <button
            className="lx-text-button"
            onClick={() => {
              setRegister(!register);
              setError("");
              setPassword("");
            }}
          >
            {register
              ? "Already have a workspace? Sign in"
              : "New to Attendx? Create a workspace"}
          </button>
          <div className="lx-auth-foot">
            <LockKey size={16} /> Credentials stay on your server. AI calls
            require a configured provider.
          </div>
        </div>
      </div>
    </main>
  );
}

function ProjectForm({
  state,
  onClose,
  action,
  onCreated,
}: {
  state: LiveState;
  onClose: () => void;
  action: Action;
  onCreated: (id: string) => void;
}) {
  const localOnly = state.runtimePolicy?.localOnly === true;
  const [name, setName] = useState(""),
    [brief, setBrief] = useState(""),
    [criteria, setCriteria] = useState(""),
    [repo, setRepo] = useState(""),
    [scope, setScope] = useState("client"),
    [budget, setBudget] = useState("10"),
    [team, setTeam] = useState(
      state.agents
        .filter((a) => ["manager", "engineer"].includes(a.template || ""))
        .map((a) => a.id),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (!team.length) throw new Error("Select at least one agent.");
      const result = (await action("/projects", {
        name,
        brief,
        scope,
        team,
        acceptanceCriteria: criteria.trim(),
        budgetCents: Math.round(Number(budget) * 100),
        repoUrl: repo.trim() || undefined,
      })) as { project: LiveProject };
      onClose();
      onCreated(result.project.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Start a real project" onClose={onClose} wide>
      <p className="lx-intro">
        Describe the outcome. Your manager will turn it into a plan for your
        approval before execution.
      </p>
      <Form onAction={submit}>
        <div className="lx-form-grid">
          <label className="lx-field">
            Project name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
              placeholder="Customer portal"
            />
          </label>
          <label className="lx-field">
            Workspace
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="client">Client project</option>
              <option value="product">Own product</option>
            </select>
          </label>
        </div>
        <label className="lx-field">
          What should the team deliver?
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            required
            rows={3}
            maxLength={12000}
            placeholder="Build a customer portal with login, invoices, and an admin dashboard…"
          />
        </label>
        <label className="lx-field">
          Acceptance criteria · one per line
          <textarea
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
            required
            rows={2}
            maxLength={6000}
            placeholder={
              "Invoices show correct totals\nInclude executable tests"
            }
          />
        </label>
        <div className="lx-form-grid">
          <label className="lx-field">
            Authorized GitHub repository · optional
            <input
              type="url"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="https://github.com/owner/repository"
            />
            <small>Read-only public import. No automatic push or merge.</small>
          </label>
          {localOnly ? (
            <div className="lx-info lx-form-policy">
              <ShieldCheck />
              <span>
                <strong>$0 external AI API cost</strong>
                Up to {state.runtimePolicy?.localCallLimit} local model attempts
                per project, including failed attempts. Server compute and
                storage remain separate costs.
              </span>
            </div>
          ) : (
            <label className="lx-field">
              Model budget · USD
              <input
                type="number"
                min="0.25"
                max="10000"
                step="0.01"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                required
              />
              <small>
                Calls reserve a conservative estimate; billing may differ.
              </small>
            </label>
          )}
        </div>
        <fieldset className="lx-team-picker">
          <legend>Assign your team</legend>
          <div className="lx-team-grid">
            {state.agents.map((a) => (
              <label
                key={a.id}
                className={
                  team.includes(a.id)
                    ? "lx-team-option selected"
                    : "lx-team-option"
                }
              >
                <input
                  type="checkbox"
                  checked={team.includes(a.id)}
                  onChange={() =>
                    setTeam((old) =>
                      old.includes(a.id)
                        ? old.filter((id) => id !== a.id)
                        : [...old, a.id],
                    )
                  }
                />
                <Avatar agent={a} />
                <span>
                  <strong>{a.name}</strong>
                  <small>{a.role}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {error && (
          <p className="lx-error" role="alert">
            {error}
          </p>
        )}
        <footer className="lx-actions">
          <button
            className="lx-button lx-secondary"
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>
          <Submit onAction={submit} busy={busy}>
            <Plus />
            Create project
          </Submit>
        </footer>
      </Form>
    </Modal>
  );
}

const providerPresets = [
  {
    label: "OpenAI",
    type: "openai" as const,
    url: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
  },
  {
    label: "Anthropic",
    type: "anthropic" as const,
    url: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-20250514",
  },
  {
    label: "OpenRouter",
    type: "openai" as const,
    url: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4.1-mini",
  },
  {
    label: "Groq",
    type: "openai" as const,
    url: "https://api.groq.com/openai/v1",
    model: "",
  },
  {
    label: "DeepSeek",
    type: "openai" as const,
    url: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
  },
  {
    label: "Gemini compatible",
    type: "openai" as const,
    url: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.5-flash",
  },
  {
    label: "Local Ollama",
    type: "openai" as const,
    url: "http://host.docker.internal:11434/v1",
    model: "qwen2.5-coder",
  },
];
function ProviderForm({
  provider,
  localOnly = false,
  onClose,
  onSaved,
  action,
}: {
  provider?: LiveProvider;
  localOnly?: boolean;
  onClose: () => void;
  onSaved: () => void;
  action: Action;
}) {
  const presets = localOnly
    ? providerPresets.filter((preset) => preset.label === "Local Ollama")
    : providerPresets;
  const initial = presets[0];
  const [label, setLabel] = useState(provider?.label || initial.label),
    [type, setType] = useState<"openai" | "anthropic">(
      provider?.type || initial.type,
    ),
    [baseUrl, setBase] = useState(provider?.baseUrl || initial.url),
    [model, setModel] = useState(provider?.model || initial.model),
    [key, setKey] = useState(""),
    [local, setLocal] = useState(localOnly || provider?.local || false),
    [roles, setRoles] = useState(provider?.roles?.join(", ") || ""),
    [priority, setPriority] = useState(provider?.priority ?? 1),
    [enabled, setEnabled] = useState(provider?.enabled ?? true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action(
        provider ? `/providers/${provider.id}` : "/providers",
        {
          label,
          type,
          baseUrl,
          model,
          apiKey: key || undefined,
          local,
          roles: roles
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
          priority,
          enabled,
        },
        provider ? "PATCH" : "POST",
      );
      setKey("");
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={provider ? "Edit AI connection" : "Add an AI connection"}
      onClose={() => {
        setKey("");
        onClose();
      }}
      wide
    >
      <p className="lx-intro">
        {localOnly
          ? "Only local model servers are allowed. Agents share server resources; no paid AI API key is required."
          : "Connect one model or a team of models. Keys are encrypted on the server and are never saved in browser storage."}
      </p>
      <Form onAction={submit}>
        {!provider && (
          <label className="lx-field">
            Quick setup
            <select
              defaultValue={initial.label}
              onChange={(e) => {
                const p = presets.find(
                  (p) => p.label === e.target.value,
                )!;
                setLabel(p.label);
                setType(p.type);
                setBase(p.url);
                setModel(p.model);
                setLocal(p.label === "Local Ollama");
              }}
            >
              {presets.map((p) => (
                <option key={p.label}>{p.label}</option>
              ))}
            </select>
          </label>
        )}
        <div className="lx-form-grid">
          <label className="lx-field">
            Connection name
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
              maxLength={80}
            />
          </label>
          <label className="lx-field">
            API format
            <select
              value={type}
              disabled={localOnly}
              onChange={(e) =>
                setType(e.target.value as "openai" | "anthropic")
              }
            >
              <option value="openai">OpenAI compatible</option>
              {!localOnly && <option value="anthropic">Anthropic</option>}
            </select>
          </label>
        </div>
        <label className="lx-field">
          API base URL
          <input
            type="url"
            value={baseUrl}
            onChange={(e) => setBase(e.target.value)}
            required
          />
          <small>
            {localOnly
              ? "Use http://ollama:11434/v1 for the cloud model service, or host.docker.internal for a model on your computer."
              : "Custom endpoints require the administrator's host allowlist. Local Ollama can use host.docker.internal."}
          </small>
        </label>
        <div className="lx-form-grid">
          <label className="lx-field">
            Model ID
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              required
              placeholder="Enter an available model ID"
              maxLength={160}
            />
          </label>
          <label className="lx-field">
            {localOnly ? "Local server key · optional" : "API key"}
            {provider?.keyPresent && (
              <small>
                Saved key ending {provider.last4 || "••••"}. Leave blank to keep
                it.
              </small>
            )}
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="new-password"
              spellCheck={false}
              placeholder={
                provider?.keyPresent
                  ? "Leave blank to keep saved key"
                  : localOnly
                    ? "No key needed for the managed Ollama service"
                    : "Paste key · optional for local Ollama"
              }
              maxLength={4096}
            />
          </label>
        </div>
        <div className="lx-form-grid">
          <label className="lx-field">
            Role routing · optional
            <input
              value={roles}
              onChange={(e) => setRoles(e.target.value)}
              placeholder="manager, engineer, quality"
              maxLength={200}
            />
            <small>
              Comma-separated role templates. Blank serves all roles.
            </small>
          </label>
          <label className="lx-field">
            Priority
            <input
              type="number"
              min="0"
              max="100"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
              required
            />
            <small>Lower values are tried first; fallback is bounded.</small>
          </label>
        </div>
        <label className="lx-check">
          <input
            type="checkbox"
            checked={local}
            disabled={localOnly}
            onChange={(e) => setLocal(e.target.checked)}
          />
          Keyless local Ollama connection
        </label>
        <label className="lx-check">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Enable this connection
        </label>
        {error && (
          <p className="lx-error" role="alert">
            {error}
          </p>
        )}
        <footer className="lx-actions">
          <button
            className="lx-button lx-secondary"
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>
          <Submit onAction={submit} busy={busy}>
            <LockKey />
            Save connection
          </Submit>
        </footer>
      </Form>
    </Modal>
  );
}

function Settings({
  state,
  action,
  refresh,
}: {
  state: LiveState;
  action: Action;
  refresh: () => Promise<void>;
}) {
  const localOnly = state.runtimePolicy?.localOnly === true;
  const modelConfigured = state.capabilities.modelConfigured === true;
  const [providers, setProviders] = useState<LiveProvider[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [editor, setEditor] = useState<LiveProvider | "new" | null>(null),
    [confirm, setConfirm] = useState<LiveProvider | null>(null);
  const load = useCallback(async () => {
    try {
      const data = await api<{ providers: LiveProvider[] } | LiveProvider[]>(
        "/providers",
      );
      setProviders(Array.isArray(data) ? data : data.providers);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="lx-settings">
      <div className="lx-section-title">
        <div>
          <span className="lx-eyebrow">COMPANY SETTINGS</span>
          <h2>AI connections</h2>
          <p>
            {localOnly
              ? "Local models only. Your named agents share the server's model resources."
              : "One model or many. Give every specialist the right connection."}
          </p>
        </div>
        <button
          className="lx-button lx-primary"
          onClick={() => setEditor("new")}
        >
          <Plus />
          {localOnly ? "Add local connection" : "Add provider"}
        </button>
      </div>
      <div className="lx-info">
        <ShieldCheck />
        <span>
          {localOnly
            ? "$0 external AI API cost. Remote AI providers are blocked by the server. Cloud VM, disk and network usage still consume cloud credits."
            : "API keys stay encrypted on your server. Agents cannot view keys or edit these settings. Connections are scoped to your account."}
        </span>
      </div>
      {localOnly && (
        <section className="lx-local-runtime" aria-label="Local model policy">
          <div>
            <Brain size={24} />
            <span>
              <strong>
                {modelConfigured
                  ? "Local connection configured"
                  : "Local connection required"}
              </strong>
              <small>
                {modelConfigured
                  ? "You can send an agent a short message to verify an actual model response. A configured connection does not verify model availability."
                  : "Ask the server administrator to start Ollama, or add a local connection below. No paid AI API key is needed."}
              </small>
            </span>
          </div>
          <dl>
            <div>
              <dt>Project model attempts</dt>
              <dd>{state.runtimePolicy?.localCallLimit}</dd>
            </div>
            <div>
              <dt>Concurrent jobs</dt>
              <dd>{state.runtimePolicy?.workerConcurrency}</dd>
            </div>
          </dl>
          <p>
            CPU responses can take minutes. Queued and running jobs appear in
            Activity; successful replies record their actual response time.
          </p>
        </section>
      )}
      {error && (
        <p className="lx-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <div className="lx-loading">
          <span className="motion-spinner" />
          Loading connections…
        </div>
      ) : providers.length ? (
        <div className="lx-provider-grid">
          {providers.map((p) => (
            <article key={p.id} className="lx-provider-card motion-enter">
              <header>
                <div className="lx-provider-symbol">
                  <Brain size={24} />
                </div>
                <Status
                  value={
                    localOnly && !p.local
                      ? "blocked"
                      : p.enabled
                        ? "enabled"
                        : "disabled"
                  }
                />
              </header>
              <h3>{p.label}</h3>
              <p className="lx-provider-model">{p.model}</p>
              <p className="lx-muted lx-break">{p.baseUrl}</p>
              {localOnly && !p.local && (
                <p className="lx-muted">
                  Remote connection blocked by local-only server policy.
                </p>
              )}
              <dl>
                <div>
                  <dt>Routes</dt>
                  <dd>
                    {p.roles.length ? p.roles.join(", ") : "All agent roles"}
                  </dd>
                </div>
                <div>
                  <dt>Priority</dt>
                  <dd>{p.priority}</dd>
                </div>
                <div>
                  <dt>Credential</dt>
                  <dd>
                    {p.keyPresent
                      ? `Saved · ••••${p.last4 || ""}`
                      : "No key · local/environment"}
                  </dd>
                </div>
              </dl>
              <footer>
                <button
                  className="lx-button lx-secondary"
                  disabled={localOnly && !p.local}
                  onClick={() => setEditor(p)}
                >
                  Edit
                </button>
                <button
                  className="lx-text-button lx-danger"
                  onClick={() => setConfirm(p)}
                >
                  Remove
                </button>
              </footer>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title={
            localOnly
              ? modelConfigured
                ? "Using the server-managed local connection"
                : "Connect your local model"
              : "Connect your first AI provider"
          }
        >
          {localOnly
            ? modelConfigured
              ? "No additional provider entry or paid API key is required. Agents use the local connection configured for this account."
              : "Add the address and model ID of your local server, or ask the administrator to configure it."
            : "Add your API key to unlock real agent planning and chat. Local Ollama is supported too."}
        </Empty>
      )}
      <div className="lx-settings-guide">
        <h3>
          {localOnly
            ? "How your local workforce works"
            : "How multiple models work together"}
        </h3>
        <div>
          <span>01</span>
          <p>
            <strong>{localOnly ? "Share one model" : "Choose by role"}</strong>
            {localOnly
              ? "Every specialist keeps its own role and project context while sharing the local model."
              : "Route planning to a reasoning model and development to a coding model."}
          </p>
        </div>
        <div>
          <span>02</span>
          <p>
            <strong>Keep work bounded</strong>
            {localOnly
              ? "Every local attempt, including a failed call, counts toward the project's finite model limit. No paid provider fallback is allowed."
              : "Project budgets cover every model attempt. A failed call can try one alternate provider."}
          </p>
        </div>
        <div>
          <span>03</span>
          <p>
            <strong>Review real results</strong>Provider responses become plans
            and evidence; executable checks determine delivery status.
          </p>
        </div>
      </div>
      {editor && (
        <ProviderForm
          provider={editor === "new" ? undefined : editor}
          localOnly={localOnly}
          action={action}
          onClose={() => setEditor(null)}
          onSaved={() => {
            void load();
            void refresh();
          }}
        />
      )}
      {confirm && (
        <Modal title="Remove AI connection?" onClose={() => setConfirm(null)}>
          <p>
            Remove <strong>{confirm.label}</strong> and its stored key? Jobs
            will use other eligible connections or become blocked.
          </p>
          <footer className="lx-actions">
            <button
              className="lx-button lx-secondary"
              onClick={() => setConfirm(null)}
            >
              Keep connection
            </button>
            <button
              className="lx-button lx-primary"
              onClick={async () => {
                try {
                  await action(`/providers/${confirm.id}`, {}, "DELETE");
                  setConfirm(null);
                  await load();
                } catch (e) {
                  setError((e as Error).message);
                  setConfirm(null);
                }
              }}
            >
              Remove connection
            </button>
          </footer>
        </Modal>
      )}
    </div>
  );
}

function HireForm({
  state,
  projectId,
  action,
  onClose,
}: {
  state: LiveState;
  projectId?: string;
  action: Action;
  onClose: () => void;
}) {
  const localOnly = state.runtimePolicy?.localOnly === true;
  const templates = (state.capabilities.agentTemplates as
    | { id: string; role: string }[]
    | undefined) || [
    { id: "engineer", role: "Software engineer" },
    { id: "quality", role: "Quality engineer" },
    { id: "security", role: "Security reviewer" },
    { id: "designer", role: "Product designer" },
    { id: "researcher", role: "Research specialist" },
    { id: "data", role: "Data engineer" },
  ];
  const [project, setProject] = useState(
      projectId || state.projects[0]?.id || "",
    ),
    [template, setTemplate] = useState(templates[0]?.id || "engineer"),
    [name, setName] = useState(""),
    [reason, setReason] = useState(""),
    [budget, setBudget] = useState("2"),
    [hours, setHours] = useState("24"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await action("/agents/hire", {
        projectId: project,
        template,
        name,
        reason,
        budgetCents: Math.round(Number(budget) * 100),
        expiresHours: Number(hours),
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Hire a scoped specialist" onClose={onClose}>
      <p className="lx-intro">
        New agents inherit bounded authority. They cannot grant themselves
        tools, budget, or release permission.
      </p>
      <Form onAction={submit}>
        <div className="lx-form-grid">
          <label className="lx-field">
            Human-like name
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              placeholder="Alex"
            />
          </label>
          <label className="lx-field">
            Specialty
            <select
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
            >
              {templates.map((t) => (
                <option value={t.id} key={t.id}>
                  {t.role}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="lx-field">
          Project
          <select
            value={project}
            onChange={(e) => setProject(e.target.value)}
            required
          >
            {state.projects.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="lx-field">
          Why is this agent needed?
          <textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            maxLength={2000}
          />
        </label>
        <div className="lx-form-grid">
          {localOnly ? (
            <div className="lx-info lx-form-policy">
              <ShieldCheck />
              <span>
                <strong>Shares the project's local model limit</strong>
                Hiring adds a scoped role, not another loaded model or paid AI
                subscription.
              </span>
            </div>
          ) : (
            <label className="lx-field">
              Budget ceiling · USD
              <input
                type="number"
                required
                min="0.25"
                max="1000"
                step="0.01"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
              />
            </label>
          )}
          <label className="lx-field">
            Expires after · hours
            <input
              type="number"
              required
              min="1"
              max="168"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
          </label>
        </div>
        {error && (
          <p className="lx-error" role="alert">
            {error}
          </p>
        )}
        <footer className="lx-actions">
          <Submit busy={busy} onAction={submit}>
            <Plus />
            Hire specialist
          </Submit>
        </footer>
      </Form>
    </Modal>
  );
}

function Chat({
  state,
  project,
  initialAgent,
  action,
  onArtifact,
}: {
  state: LiveState;
  project: LiveProject;
  initialAgent?: string;
  action: Action;
  onArtifact: (id: string) => void;
}) {
  const team = state.agents.filter((a) => a.projectId === project.id),
    [agentId, setAgentId] = useState(
      initialAgent || team[0]?.id || state.agents[0]?.id || "",
    ),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    bottom = useRef<HTMLDivElement>(null);
  const agent = state.agents.find((a) => a.id === agentId),
    messages = state.messages.filter(
      (m) => m.projectId === project.id && m.agentId === agentId,
    ),
    pending = state.tasks.filter(
      (t) =>
        t.kind === "chat" &&
        t.agentId === agentId &&
        t.projectId === project.id &&
        ["queued", "running"].includes(t.status),
    );
  useEffect(() => {
    bottom.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "nearest",
    });
  }, [messages.length, pending.length]);
  const blocked = state.tasks
    .filter(
      (t) =>
        t.kind === "chat" &&
        t.agentId === agentId &&
        t.projectId === project.id &&
        ["blocked", "failed"].includes(t.status) &&
        t.error,
    )
    .slice(0, 1);
  const send = async () => {
    if (!message.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await action(`/agents/${agentId}/chat`, {
        message: message.trim(),
        projectId: project.id,
      });
      setMessage("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="lx-chat">
      <header className="lx-chat-head">
        <label className="lx-field">
          Talk with
          <select
            aria-label="Chat agent"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
          >
            {state.agents.map((a) => (
              <option value={a.id} key={a.id}>
                {a.name} · {a.role}
              </option>
            ))}
          </select>
        </label>
        <span className="lx-ai-label">
          <Sparkle />
          AI agent · project-scoped memory
        </span>
      </header>
      {agent?.persona && <p className="lx-chat-persona">{agent.persona}</p>}
      <div
        className="lx-messages"
        role="log"
        aria-label="Agent conversation"
        aria-live="polite"
      >
        {messages.length ? (
          messages.map((m) => (
            <article className={`lx-message lx-message-${m.role}`} key={m.id}>
              <div className="lx-message-meta">
                <strong>
                  {m.role === "user" ? "You" : `${agent?.name || "Agent"} · AI`}
                </strong>
                <time>{date(m.createdAt)}</time>
              </div>
              <p>{m.content}</p>
              {(m.evidenceIds || m.evidence || []).map((id) => (
                <button
                  key={id}
                  className="lx-evidence-chip"
                  onClick={() => onArtifact(id)}
                >
                  <FileText />
                  View evidence
                </button>
              ))}
            </article>
          ))
        ) : (
          <Empty
            title={`Start a conversation with ${agent?.name || "your agent"}`}
          >
            Ask about the project, clarify requirements, or explain a change.
            Chat cannot silently change permissions or release software.
          </Empty>
        )}
        {pending.length > 0 && (
          <div className="lx-chat-pending" data-state="running">
            <span className="motion-spinner" />
            {state.runtimePolicy?.localOnly
              ? "Local response queued or running. CPU inference may take minutes; see Activity for actual status."
              : "Response queued or running · see Activity for actual status"}
          </div>
        )}
        {blocked.map((task) => (
          <p className="lx-error" role="status" key={task.id}>
            {task.error}
          </p>
        ))}
        <div ref={bottom} />
      </div>
      <Form onAction={send} className="lx-composer">
        <label className="lx-field">
          <span className="lx-sr-only">Message to agent</span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={12000}
            required
            rows={2}
            placeholder={`Message ${agent?.name || "your agent"}…`}
          />
        </label>
        <Submit onAction={send} busy={busy}>
          <ArrowRight />
          Send
        </Submit>
      </Form>
      {error && (
        <p className="lx-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function ArtifactViewer({ id, onClose }: { id: string; onClose: () => void }) {
  const [artifact, setArtifact] = useState<LiveArtifact | null>(null),
    [error, setError] = useState(""),
    [preview, setPreview] = useState(false);
  useEffect(() => {
    const ctrl = new AbortController();
    api<LiveArtifact | { artifact: LiveArtifact }>(
      `/artifacts/${encodeURIComponent(id)}`,
      { signal: ctrl.signal },
    )
      .then((r) => setArtifact("artifact" in r ? r.artifact : r))
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(e.message);
      });
    return () => ctrl.abort();
  }, [id]);
  const content = artifact ? pretty(artifact.content ?? "") : "",
    isHtml =
      artifact?.mime?.includes("text/html") ||
      artifact?.name?.endsWith(".html");
  return (
    <Modal title={artifact?.name || "Delivery evidence"} onClose={onClose} wide>
      {error ? (
        <p className="lx-error" role="alert">
          {error}
        </p>
      ) : !artifact ? (
        <div className="lx-loading">
          <span className="motion-spinner" />
          Loading evidence…
        </div>
      ) : (
        <>
          <div className="lx-artifact-toolbar">
            <Status value={artifact.kind} />
            <div>
              {artifact.kind === "candidate" && (
                <a
                  className="lx-button lx-secondary"
                  href={`/api/artifacts/${encodeURIComponent(id)}/bundle`}
                  download
                >
                  <DownloadSimple />
                  Source ZIP
                </a>
              )}
              {isHtml && (
                <button
                  className="lx-button lx-secondary"
                  onClick={() => setPreview(!preview)}
                >
                  {preview ? "View source" : "Static HTML preview"}
                </button>
              )}
              <a
                className="lx-button lx-primary"
                href={`/api/artifacts/${encodeURIComponent(id)}/download`}
                download
              >
                <DownloadSimple />
                Download
              </a>
            </div>
          </div>
          {preview ? (
            <>
              <p className="lx-muted">
                Static sandbox: scripts, forms, and external resources are
                disabled.
              </p>
              <iframe
                className="lx-html-preview"
                title="Sandboxed generated HTML"
                sandbox=""
                referrerPolicy="no-referrer"
                srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'">${content}`}
              />
            </>
          ) : (
            <pre className="lx-code">{content}</pre>
          )}
        </>
      )}
    </Modal>
  );
}

function ResearchPanel({
  state,
  project,
  action,
  onArtifact,
  onMemory,
}: {
  state: LiveState;
  project: LiveProject;
  action: Action;
  onArtifact: (id: string) => void;
  onMemory: () => void;
}) {
  const [query, setQuery] = useState(project.brief.slice(0, 1000)),
    [urls, setUrls] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const jobs = state.tasks.filter(
    (task) => task.projectId === project.id && task.kind === "research",
  );
  const pending = jobs.filter((task) =>
    ["queued", "running"].includes(task.status),
  );
  const sources = state.artifacts.filter(
    (artifact) =>
      artifact.projectId === project.id && artifact.kind.startsWith("research"),
  );
  const submit = async () => {
    if (busy || pending.length) return;
    setError("");
    const question = query.trim();
    const sourceUrls = urls
      .split("\n")
      .map((url) => url.trim())
      .filter(Boolean);
    if (question.length < 10 || question.length > 1000) {
      setError("Enter a research question between 10 and 1,000 characters.");
      return;
    }
    if (sourceUrls.length > 3) {
      setError("Enter up to three source URLs, one per line.");
      return;
    }
    try {
      for (const sourceUrl of sourceUrls) {
        if (new URL(sourceUrl).protocol !== "https:")
          throw new Error("Use HTTPS source URLs.");
      }
    } catch {
      setError("Use valid HTTPS source URLs, one per line.");
      return;
    }
    setBusy(true);
    try {
      await action(`/projects/${project.id}/research`, {
        query: question,
        urls: sourceUrls,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="lx-research">
      <p className="lx-intro">
        Search public GitHub repositories and documentation, or read allowed
        HTTPS source URLs. Saved extracts keep their citations and remain
        untrusted until you review them. Research does not execute downloaded
        content or train model weights.
      </p>
      <Form onAction={submit}>
        <label className="lx-field">
          Research question
          <textarea
            required
            minLength={10}
            maxLength={1000}
            rows={3}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find the official documentation and relevant examples for this project…"
          />
        </label>
        <label className="lx-field">
          Source URLs (optional)
          <textarea
            maxLength={6500}
            rows={3}
            value={urls}
            onChange={(event) => setUrls(event.target.value)}
            placeholder="https://github.com/owner/repository"
          />
          <small>
            Up to three HTTPS URLs, one per line. The server checks allowed
            hosts and response limits.
          </small>
        </label>
        <button
          className="lx-button lx-primary"
          type="submit"
          disabled={busy || pending.length > 0}
        >
          {busy ? <span className="motion-spinner" /> : <MagnifyingGlass />}
          Run research
        </button>
      </Form>
      {error && (
        <p className="lx-error" role="alert">
          {error}
        </p>
      )}
      {pending.length > 0 && (
        <p className="lx-info" role="status">
          Research is queued or running. The jobs below show its actual status;
          saved sources and reports appear in Evidence.
        </p>
      )}
      <h3 className="lx-subheading">Research jobs</h3>
      <div className="lx-task-list">
        {jobs.length ? (
          jobs.map((job) => (
            <article className="lx-task" key={job.id}>
              <div>
                <strong>Research</strong>
                <Status value={job.status} />
              </div>
              {job.error && <p className="lx-error">{job.error}</p>}
              <small>{date(job.updatedAt || job.createdAt)}</small>
            </article>
          ))
        ) : (
          <p className="lx-muted">No research has run for this project.</p>
        )}
      </div>
      {sources.length > 0 && (
        <>
          <h3 className="lx-subheading">Saved research evidence</h3>
          <div className="lx-artifact-list">
            {sources.map((source) => (
              <button
                className="lx-artifact-row"
                key={source.id}
                onClick={() => onArtifact(source.id)}
              >
                <FileText size={26} />
                <span>
                  <strong>{source.name}</strong>
                  <small>Source material · verify before reuse</small>
                </span>
                <ArrowSquareOut />
              </button>
            ))}
          </div>
        </>
      )}
      <div className="lx-info">
        <ShieldCheck />
        <span>
          Review the sources, then approve useful facts in Memory. Source text
          cannot grant an agent permissions or override your instructions.
          <button className="lx-text-button" onClick={onMemory}>
            Open Memory
          </button>
        </span>
      </div>
    </div>
  );
}

function MemoryPanel({
  state,
  project,
  action,
}: {
  state: LiveState;
  project: LiveProject;
  action: Action;
}) {
  const [content, setContent] = useState(""),
    [source, setSource] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [searchResults, setSearchResults] = useState<LiveKnowledgeItem[] | null>(null),
    [searchBusy, setSearchBusy] = useState(false),
    [searchError, setSearchError] = useState("");
  const searchGeneration = useRef(0);
  useEffect(
    () => () => {
      searchGeneration.current++;
    },
    [],
  );
  const findKnowledge = async () => {
    if (!search.trim() || searchBusy) return;
    const generation = ++searchGeneration.current;
    setSearchBusy(true);
    setSearchError("");
    try {
      const result = await api<{ items: LiveKnowledgeItem[] }>(
        `/projects/${project.id}/knowledge?q=${encodeURIComponent(search.trim())}`,
      );
      if (generation === searchGeneration.current) setSearchResults(result.items);
    } catch (e) {
      if (generation === searchGeneration.current)
        setSearchError((e as Error).message);
    } finally {
      if (generation === searchGeneration.current) setSearchBusy(false);
    }
  };
  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await action("/memories", {
        projectId: project.id,
        content,
        sourceArtifactId: source || undefined,
      });
      setContent("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const memories = state.memories.filter((m) => m.projectId === project.id);
  return (
    <div>
      <p className="lx-intro">
        Save verified requirements, decisions, and preferences. Retrieval stays
        within this project.
      </p>
      <section className="lx-knowledge-search" aria-label="Project knowledge search">
        <Form onAction={findKnowledge}>
          <label className="lx-field">
            Search project knowledge
            <input
              required
              maxLength={200}
              value={search}
              onChange={(event) => {
                searchGeneration.current++;
                setSearch(event.target.value);
                setSearchResults(null);
                setSearchError("");
                setSearchBusy(false);
              }}
              placeholder="Search approved memories and saved research…"
            />
          </label>
          <Submit onAction={findKnowledge} busy={searchBusy}>
            <MagnifyingGlass />
            Search knowledge
          </Submit>
        </Form>
        {searchError && (
          <p className="lx-error" role="alert">
            {searchError}
          </p>
        )}
        {searchResults !== null && (
          <div className="lx-knowledge-results" aria-live="polite">
            <p className="lx-muted">
              {searchResults.length} project context items. Research sources
              remain untrusted; verify facts before approving them below.
            </p>
            {searchResults.map((item) => (
              <article className="lx-knowledge-result" key={item.id}>
                <strong>{item.name}</strong>
                <small>{human(item.kind)}</small>
                <p>{item.snippet}</p>
              </article>
            ))}
          </div>
        )}
      </section>
      <Form onAction={save}>
        <label className="lx-field">
          Approved knowledge
          <textarea
            required
            rows={3}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={6000}
            placeholder="Our invoice totals use decimal arithmetic and UTC timestamps…"
          />
        </label>
        <label className="lx-field">
          Source evidence · optional
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">Owner supplied</option>
            {state.artifacts
              .filter((a) => a.projectId === project.id)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
        <Submit onAction={save} busy={busy}>
          <Database />
          Approve and remember
        </Submit>
      </Form>
      {error && (
        <p className="lx-error" role="alert">
          {error}
        </p>
      )}
      <div className="lx-records">
        {memories.length ? (
          memories.map((m) => (
            <article className="lx-record" key={m.id}>
              <span className="lx-record-icon">
                <Brain />
              </span>
              <div>
                <p>{m.content}</p>
                <small>Owner-approved · {date(m.createdAt)}</small>
              </div>
            </article>
          ))
        ) : (
          <Empty title="No project memory yet">
            Add knowledge that your agents can use in future conversations and
            delivery work.
          </Empty>
        )}
      </div>
    </div>
  );
}

function ImprovePanel({
  state,
  project,
  action,
}: {
  state: LiveState;
  project: LiveProject;
  action: Action;
}) {
  const [agentId, setAgent] = useState(state.agents[0]?.id || ""),
    [instructions, setInstructions] = useState(""),
    [fixtures, setFixtures] = useState([
      { input: "", expectedIncludes: "" },
      { input: "", expectedIncludes: "" },
    ]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await action("/improvements", {
        projectId: project.id,
        agentId,
        instructions,
        fixtures,
      });
      setInstructions("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <div className="lx-info">
        <ShieldCheck />
        <span>
          Candidate instructions are compared with the baseline on your explicit
          fixtures. No automatic promotion; these checks cover only the behavior
          you describe.
        </span>
      </div>
      <Form onAction={submit}>
        <label className="lx-field">
          Agent
          <select value={agentId} onChange={(e) => setAgent(e.target.value)}>
            {state.agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.role}
              </option>
            ))}
          </select>
        </label>
        <label className="lx-field">
          Candidate instructions
          <textarea
            required
            rows={3}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            maxLength={6000}
            placeholder="Always show assumptions, cite project evidence, and explain incomplete checks…"
          />
        </label>
        <fieldset className="lx-fixtures">
          <legend>Evaluation fixtures · 2–6 required</legend>
          {fixtures.map((fixture, index) => (
            <div className="lx-fixture" key={index}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <label className="lx-field">
                Input
                <input
                  required
                  value={fixture.input}
                  onChange={(e) =>
                    setFixtures((old) =>
                      old.map((f, i) =>
                        i === index ? { ...f, input: e.target.value } : f,
                      ),
                    )
                  }
                  placeholder="A concrete question or task"
                  maxLength={2000}
                />
              </label>
              <label className="lx-field">
                Expected response includes
                <input
                  required
                  value={fixture.expectedIncludes}
                  onChange={(e) =>
                    setFixtures((old) =>
                      old.map((f, i) =>
                        i === index
                          ? { ...f, expectedIncludes: e.target.value }
                          : f,
                      ),
                    )
                  }
                  placeholder="A specific phrase to check"
                  maxLength={1000}
                />
              </label>
              {fixtures.length > 2 && (
                <button
                  type="button"
                  className="lx-icon"
                  aria-label={`Remove fixture ${index + 1}`}
                  onClick={() =>
                    setFixtures((old) => old.filter((_, i) => i !== index))
                  }
                >
                  <X />
                </button>
              )}
            </div>
          ))}
          {fixtures.length < 6 && (
            <button
              className="lx-text-button"
              type="button"
              onClick={() =>
                setFixtures((old) => [
                  ...old,
                  { input: "", expectedIncludes: "" },
                ])
              }
            >
              <Plus />
              Add fixture
            </button>
          )}
        </fieldset>
        {error && (
          <p className="lx-error" role="alert">
            {error}
          </p>
        )}
        <Submit onAction={submit} busy={busy}>
          <Lightning />
          Evaluate candidate
        </Submit>
      </Form>
      <h3 className="lx-subheading">Instruction versions</h3>
      <div className="lx-records">
        {state.skills
          .filter((s) => s.agentId === agentId && s.projectId === project.id)
          .map((s) => (
            <article className="lx-version" key={s.id}>
              <header>
                <strong>Version {s.version}</strong>
                <Status value={s.status} />
              </header>
              <p>{s.instructions}</p>
              <details>
                <summary>Recorded evaluation</summary>
                <pre className="lx-code">
                  {pretty(s.evaluation || { status: "No evaluation recorded" })}
                </pre>
              </details>
              {["archived"].includes(s.status) && (
                <button
                  className="lx-button lx-secondary"
                  onClick={() =>
                    void action(`/skills/${s.id}/rollback`).catch(() => {})
                  }
                >
                  <ArrowClockwise />
                  Restore approved version
                </button>
              )}
            </article>
          ))}
      </div>
      <p className="lx-muted">
        Eligible candidates appear in Reviews for an owner decision. This
        improves instructions; it does not retrain the underlying model.
      </p>
    </div>
  );
}

function MonitoringPanel({
  state,
  project,
  action,
}: {
  state: LiveState;
  project: LiveProject;
  action: Action;
}) {
  const [minutes, setMinutes] = useState("60"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await action("/schedules", {
        projectId: project.id,
        intervalMinutes: Number(minutes),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <p className="lx-intro">
        Schedule real verification of existing delivery artifacts. Checks run
        through the isolated runner; they do not poll arbitrary URLs or invent
        product health.
      </p>
      <Form onAction={save} className="lx-inline-form">
        <label className="lx-field">
          Verification interval · minutes
          <input
            type="number"
            min="15"
            max="10080"
            required
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </label>
        <Submit busy={busy} onAction={save}>
          <Clock />
          Add schedule
        </Submit>
      </Form>
      {error && (
        <p className="lx-error" role="alert">
          {error}
        </p>
      )}
      <div className="lx-records">
        {state.schedules
          .filter((s) => s.projectId === project.id)
          .map((s) => (
            <article className="lx-record" key={s.id}>
              <Clock size={24} />
              <div>
                <strong>Every {s.intervalMinutes} minutes</strong>
                <p>Next check: {date(s.nextRun)}</p>
                <Status value={s.enabled ? "enabled" : "paused"} />
              </div>
              <button
                className="lx-button lx-secondary"
                onClick={() =>
                  void action(`/schedules/${s.id}/toggle`).catch(() => {})
                }
              >
                {s.enabled ? "Pause schedule" : "Enable schedule"}
              </button>
            </article>
          ))}
      </div>
    </div>
  );
}

function Reviews({
  state,
  action,
  projectId,
  onArtifact,
}: {
  state: LiveState;
  action: Action;
  projectId?: string;
  onArtifact: (id: string) => void;
}) {
  const [pending, setPending] = useState(""),
    [error, setError] = useState("");
  const reviews = state.reviews.filter(
    (r) => !projectId || r.projectId === projectId,
  );
  const decide = async (id: string, decision: string) => {
    setPending(id);
    setError("");
    try {
      await action(`/reviews/${id}/decision`, { decision });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending("");
    }
  };
  return (
    <div className="lx-review-list">
      {error && (
        <p className="lx-error" role="alert">
          {error}
        </p>
      )}
      {reviews.length ? (
        reviews.map((r) => (
          <article className="lx-review-card" key={r.id}>
            <header>
              <div className="lx-provider-symbol">
                <ShieldCheck />
              </div>
              <Status value={r.status} />
            </header>
            <span className="lx-eyebrow">{human(r.kind)} REVIEW</span>
            <h3>{r.title}</h3>
            <p>{r.details}</p>
            {Boolean(r.payload) && (
              <details>
                <summary>Review scope and evidence</summary>
                <pre className="lx-code">{pretty(r.payload)}</pre>
              </details>
            )}
            <small>
              {state.projects.find((p) => p.id === r.projectId)?.name} ·{" "}
              {date(r.createdAt)}
            </small>
            {r.kind === "release" &&
              state.artifacts
                .filter((a) => a.projectId === r.projectId)
                .map((a) => (
                  <button
                    key={a.id}
                    className="lx-evidence-chip"
                    onClick={() => onArtifact(a.id)}
                  >
                    <FileText />
                    {a.name}
                  </button>
                ))}
            {r.status === "pending" && (
              <footer>
                <button
                  className="lx-button lx-secondary"
                  disabled={pending === r.id}
                  onClick={() => void decide(r.id, "declined")}
                >
                  Decline
                </button>
                <button
                  className="lx-button lx-primary"
                  disabled={pending === r.id}
                  onClick={() => void decide(r.id, "approved")}
                >
                  <Check />
                  Approve {human(r.kind)}
                </button>
              </footer>
            )}
          </article>
        ))
      ) : (
        <Empty title="No reviews waiting">
          Plans, releases, hiring proposals, and evaluated improvements appear
          here for your decision.
        </Empty>
      )}
    </div>
  );
}

function ProjectWorkspace({
  state,
  projectId,
  initialTab = "Overview",
  initialAgent,
  action,
  onClose,
  onArtifact,
}: {
  state: LiveState;
  projectId: string;
  initialTab?: WorkspaceTab;
  initialAgent?: string;
  action: Action;
  onClose: () => void;
  onArtifact: (id: string) => void;
}) {
  const [tab, setTab] = useState<WorkspaceTab>(initialTab),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState("");
  const project = state.projects.find((p) => p.id === projectId);
  if (!project)
    return (
      <Modal title="Project unavailable" onClose={onClose}>
        <p>This project is no longer available.</p>
      </Modal>
    );
  const tasks = state.tasks.filter((t) => t.projectId === project.id),
    artifacts = state.artifacts.filter((a) => a.projectId === project.id),
    team = state.agents.filter((a) => a.projectId === project.id),
    plan =
      typeof project.plan === "string"
        ? (() => {
            try {
              return JSON.parse(project.plan);
            } catch {
              return project.plan;
            }
          })()
        : project.plan;
  const execute = async (verb: string) => {
    setBusy(verb);
    setError("");
    try {
      await action(`/projects/${project.id}/${verb}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
      setConfirm("");
    }
  };
  return (
    <Modal title={project.name} onClose={onClose} wide>
      <div className="lx-project-workspace">
        <div className="lx-workspace-summary">
          <span>
            {project.scope === "client" ? "CLIENT PROJECT" : "OWN PRODUCT"}
          </span>
          <Status value={project.status} />
          <span className="lx-budget">
            {state.runtimePolicy?.localOnly
              ? `$0 external AI API cost · ${project.localCalls ?? 0} / ${state.runtimePolicy.localCallLimit} local attempts`
              : `${money(project.spentCents)} reserved / ${money(project.budgetCents)}`}
          </span>
        </div>
        <div className="lx-tabs" role="tablist" aria-label="Project workspace">
          {(
            [
              "Overview",
              "Chat",
              "Research",
              "Evidence",
              "Memory",
              "Improve",
              "Monitoring",
            ] as WorkspaceTab[]
          ).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={tab === t ? "active" : ""}
              onClick={() => setTab(t)}
            >
              {t}
              {t === "Evidence" && artifacts.length > 0 && (
                <span>{artifacts.length}</span>
              )}
            </button>
          ))}
        </div>
        <div className="lx-tab-panel" role="tabpanel" aria-label={tab}>
          {tab === "Overview" && (
            <>
              <p className="lx-project-brief">{project.brief}</p>
              <div className="lx-project-controls">
                <button
                  className="lx-button lx-primary"
                  disabled={!!busy}
                  onClick={() => void execute("plan")}
                >
                  <Brain />
                  {busy === "plan"
                    ? "Queuing…"
                    : plan
                      ? "Update plan"
                      : "Generate plan"}
                </button>
                <button
                  className="lx-button lx-secondary"
                  disabled={!!busy || !project.planApproved}
                  title={
                    !project.planApproved
                      ? "Approve the plan in Reviews first"
                      : undefined
                  }
                  onClick={() => void execute("run")}
                >
                  <Play />
                  Run approved plan
                </button>
                <button
                  className="lx-button lx-secondary"
                  disabled={!!busy}
                  onClick={() =>
                    void execute(
                      project.status === "paused" ? "resume" : "pause",
                    )
                  }
                >
                  {project.status === "paused" ? <Play /> : <Pause />}
                  {project.status === "paused" ? "Resume" : "Pause"}
                </button>
                <button
                  className="lx-button lx-secondary"
                  disabled={!!busy || !artifacts.length}
                  onClick={() => void execute("verify")}
                >
                  <CheckCircle />
                  Verify
                </button>
                <button
                  className="lx-text-button lx-danger"
                  disabled={!!busy}
                  onClick={() => setConfirm("cancel")}
                >
                  <Stop />
                  Cancel work
                </button>
              </div>
              {error && (
                <p className="lx-error" role="alert">
                  {error}
                </p>
              )}
              {project.repoUrl && (
                <p className="lx-muted lx-break">
                  Authorized read-only source: {project.repoUrl}
                </p>
              )}
              <div className="lx-project-columns">
                <section>
                  <h3 className="lx-subheading">Delivery plan</h3>
                  {plan ? (
                    <pre className="lx-plan">{pretty(plan)}</pre>
                  ) : (
                    <div className="lx-info">
                      <Brain />
                      <span>
                        Generate a plan to clarify missing requirements and
                        split the project into tasks. Your approval is required
                        before running it.
                      </span>
                    </div>
                  )}
                  <h3 className="lx-subheading">Acceptance criteria</h3>
                  <ul className="lx-criteria">
                    {(Array.isArray(project.acceptanceCriteria)
                      ? project.acceptanceCriteria
                      : [project.acceptanceCriteria || "No criteria recorded"]
                    ).map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </section>
                <section>
                  <h3 className="lx-subheading">Assigned team</h3>
                  <div className="lx-assigned-team">
                    {team.map((a) => (
                      <button key={a.id} onClick={() => setTab("Chat")}>
                        <Avatar agent={a} />
                        <span>
                          <strong>{a.name}</strong>
                          <small>{a.role}</small>
                        </span>
                        <Status value={a.status} />
                      </button>
                    ))}
                  </div>
                  <h3 className="lx-subheading">Actual jobs</h3>
                  <div className="lx-task-list">
                    {tasks.length ? (
                      tasks.map((t) => (
                        <article
                          className="lx-task"
                          key={t.id}
                          data-state={
                            t.status === "running" ? "running" : undefined
                          }
                        >
                          <div>
                            <strong>{human(t.kind)}</strong>
                            <Status value={t.status} />
                          </div>
                          {t.error && <p className="lx-error">{t.error}</p>}
                          <small>{date(t.updatedAt || t.createdAt)}</small>
                        </article>
                      ))
                    ) : (
                      <p className="lx-muted">
                        No jobs have run for this project.
                      </p>
                    )}
                  </div>
                </section>
              </div>
              <h3 className="lx-subheading">Project approvals</h3>
              <Reviews
                state={state}
                action={action}
                projectId={project.id}
                onArtifact={onArtifact}
              />
            </>
          )}
          {tab === "Chat" && (
            <Chat
              state={state}
              project={project}
              initialAgent={initialAgent}
              action={action}
              onArtifact={onArtifact}
            />
          )}
          {tab === "Research" && (
            <ResearchPanel
              state={state}
              project={project}
              action={action}
              onArtifact={onArtifact}
              onMemory={() => setTab("Memory")}
            />
          )}
          {tab === "Evidence" && (
            <>
              <p className="lx-intro">
                Research citations, files, manifests, diffs, and actual test
                outcomes from this project. An artifact records what was
                produced; a test report determines whether checks passed.
              </p>
              <div className="lx-artifact-list">
                {artifacts.length ? (
                  artifacts.map((a) => (
                    <button
                      className="lx-artifact-row"
                      key={a.id}
                      onClick={() => onArtifact(a.id)}
                    >
                      <FileText size={26} />
                      <span>
                        <strong>{a.name}</strong>
                        <small>
                          {human(a.kind)} · {date(a.createdAt)}
                        </small>
                      </span>
                      <ArrowSquareOut />
                    </button>
                  ))
                ) : (
                  <Empty title="No project evidence yet">
                    Run research to save cited sources, or run an approved
                    project plan to produce candidate files and verification
                    results.
                  </Empty>
                )}
              </div>
            </>
          )}
          {tab === "Memory" && (
            <MemoryPanel state={state} project={project} action={action} />
          )}
          {tab === "Improve" && (
            <ImprovePanel state={state} project={project} action={action} />
          )}
          {tab === "Monitoring" && (
            <MonitoringPanel state={state} project={project} action={action} />
          )}
        </div>
      </div>
      {confirm === "cancel" && (
        <div className="lx-confirm-inline" role="alert">
          <p>
            Cancel queued and active work for this project? Existing evidence
            will remain available.
          </p>
          <button
            className="lx-button lx-secondary"
            onClick={() => setConfirm("")}
          >
            Keep working
          </button>
          <button
            className="lx-button lx-primary"
            onClick={() => void execute("cancel")}
          >
            Cancel project work
          </button>
        </div>
      )}
    </Modal>
  );
}

function Office({
  state,
  selected,
  onSelect,
  filter,
}: {
  state: LiveState;
  selected: string;
  onSelect: (id: string) => void;
  filter: string;
}) {
  const agents = state.agents.filter((a) =>
    `${a.name} ${a.role} ${a.task}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  return (
    <div className="lx-office">
      <img
        className="lx-office-image"
        src={asset("office.png")}
        alt="Virtual Attendx office floor"
      />
      <OfficeMotion
        agents={agents.flatMap((a) =>
          a.position ? [{ id: a.id, position: a.position }] : [],
        )}
        jobs={state.tasks}
        selectedAgentId={selected}
      />
      {agents.map((a, index) => {
        const position = a.position || {
          x: 0.17 + (index % 3) * 0.32,
          y: 0.23 + Math.floor(index / 3) * 0.23,
        };
        const running = state.tasks.some(
          (t) => t.agentId === a.id && t.status === "running",
        );
        return (
          <button
            key={a.id}
            className={`lx-agent-marker ${selected === a.id ? "selected" : ""}`}
            style={{
              left: `${Math.max(0.1, Math.min(0.9, position.x)) * 100}%`,
              top: `${Math.max(0.12, Math.min(0.85, position.y)) * 100}%`,
            }}
            data-state={running ? "running" : a.status}
            onClick={() => onSelect(a.id)}
            aria-label={`Select ${a.name}, ${a.role}, ${human(a.status)}`}
            aria-pressed={selected === a.id}
          >
            <Avatar agent={a} />
            <span>
              <strong>
                {a.name}
                <i className={`lx-agent-dot lx-dot-${a.status}`} />
              </strong>
              <small>{a.role}</small>
              <em>{a.activityLabel || human(a.status)}</em>
            </span>
            {running && <Pulse className="lx-marker-pulse" size={17} />}
          </button>
        );
      })}
      <div className="lx-office-caption">
        <span className="lx-status-dot" />
        Live workspace · activity reflects actual server jobs
      </div>
      {!agents.length && (
        <div className="lx-office-empty">No agents match your search.</div>
      )}
    </div>
  );
}

export default function LiveApp() {
  const [user, setUser] = useState<LiveUser | null>(null),
    [state, setState] = useState<LiveState | null>(null),
    [boot, setBoot] = useState(true),
    [error, setError] = useState(""),
    [view, setView] = useState<View>("Office"),
    [selected, setSelected] = useState(""),
    [query, setQuery] = useState(""),
    [projectForm, setProjectForm] = useState(false),
    [hire, setHire] = useState(false),
    [workspace, setWorkspace] = useState<{
      id: string;
      tab?: WorkspaceTab;
      agentId?: string;
    } | null>(null),
    [artifact, setArtifact] = useState(""),
    [connection, setConnection] = useState<
      "connected" | "reconnecting" | "disconnected"
    >("disconnected"),
    [mobile, setMobile] = useState(false),
    [layout, setLayout] = useState<"office" | "list">(() =>
      window.innerWidth < 750 ? "list" : "office",
    ),
    [toast, setToast] = useState("");
  const mounted = useRef(true),
    refreshing = useRef(false),
    again = useRef(false),
    authGeneration = useRef(0);
  const refresh = useCallback(async () => {
    if (refreshing.current) {
      again.current = true;
      return;
    }
    refreshing.current = true;
    const generation = authGeneration.current;
    try {
      const result = await api<LiveState>("/state");
      if (mounted.current && generation === authGeneration.current) {
        setState({
          ...result,
          agents: result.agents || [],
          projects: result.projects || [],
          tasks: result.tasks || [],
          messages: result.messages || [],
          events: result.events || [],
          reviews: result.reviews || [],
          artifacts: result.artifacts || [],
          memories: result.memories || [],
          skills: result.skills || [],
          schedules: result.schedules || [],
          capabilities: result.capabilities || {},
          metrics: result.metrics || {},
        });
        setUser(result.user);
        setSelected((old) =>
          result.agents.some((a) => a.id === old)
            ? old
            : result.agents[0]?.id || "",
        );
        setError("");
      }
    } catch (e) {
      if (!mounted.current || generation !== authGeneration.current) return;
      if (e instanceof ApiError && e.status === 401) {
        setUser(null);
        setState(null);
        setCsrfToken("");
      } else if (mounted.current) setError((e as Error).message);
    } finally {
      refreshing.current = false;
      if (again.current && mounted.current) {
        again.current = false;
        void refresh();
      }
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    api<{ user: LiveUser | null; csrfToken?: string }>("/session")
      .then(async (r) => {
        if (r.user) {
          setCsrfToken(r.csrfToken || "");
          setUser(r.user);
          await refresh();
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setBoot(false));
    return () => {
      mounted.current = false;
    };
  }, [refresh]);
  useEffect(() => {
    if (!user) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const source = new EventSource("/api/events", { withCredentials: true });
    setConnection("reconnecting");
    source.onopen = () => {
      setConnection("connected");
      void refresh();
    };
    source.addEventListener("change", () => {
      if (!timer)
        timer = setTimeout(() => {
          timer = undefined;
          void refresh();
        }, 160);
    });
    source.onerror = () => setConnection("reconnecting");
    const fallback = setInterval(() => void refresh(), 60000);
    return () => {
      source.close();
      if (timer) clearTimeout(timer);
      clearInterval(fallback);
      setConnection("disconnected");
    };
  }, [user?.id, refresh]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  const action: Action = useCallback(
    async (path, body = {}, method = "POST") => {
      const generation = authGeneration.current;
      try {
        const result = await mutate(path, body, method);
        if (generation !== authGeneration.current)
          throw new Error(
            "The signed-in session changed; refresh before continuing.",
          );
        await refresh();
        if (generation !== authGeneration.current)
          throw new Error(
            "The signed-in session changed; refresh before continuing.",
          );
        return result;
      } catch (e) {
        if (generation !== authGeneration.current) throw e;
        if (e instanceof ApiError && e.status === 401) {
          setUser(null);
          setState(null);
        }
        setToast((e as Error).message);
        throw e;
      }
    },
    [refresh],
  );
  const logout = async () => {
    authGeneration.current++;
    try {
      await mutate("/auth/logout");
      setCsrfToken("");
      setUser(null);
      setState(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const current = state?.agents.find((a) => a.id === selected),
    project =
      current && state?.projects.find((p) => p.id === current.projectId),
    active = state?.tasks.filter((t) => t.status === "running").length || 0,
    pending = state?.reviews.filter((r) => r.status === "pending").length || 0;
  const agents = useMemo(
    () =>
      state?.agents.filter((a) =>
        `${a.name} ${a.role} ${a.task}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ) || [],
    [state?.agents, query],
  );
  const openProject = (
    id: string,
    tab: WorkspaceTab = "Overview",
    agentId?: string,
  ) => setWorkspace({ id, tab, agentId });
  if (boot)
    return (
      <div className="lx-boot">
        <span className="lx-logo">
          Attend<span>x</span>
        </span>
        <span className="motion-spinner" />
        <p>Connecting to your workspace…</p>
      </div>
    );
  if (!user)
    return (
      <>
        {error && (
          <div className="lx-service-error" role="alert">
            {error}
            <button onClick={() => window.location.reload()}>
              Retry connection
            </button>
          </div>
        )}
        <Auth
          onLogin={(u) => {
            authGeneration.current++;
            setUser(u);
            void refresh();
          }}
        />
      </>
    );
  if (!state)
    return (
      <div className="lx-boot">
        <span className="motion-spinner" />
        <p>{error || "Loading your company…"}</p>
        <button
          className="lx-button lx-secondary"
          onClick={() => void refresh()}
        >
          Retry
        </button>
        <button className="lx-text-button" onClick={() => void logout()}>
          Sign out
        </button>
      </div>
    );
  const modelConfigured =
    state.capabilities.modelConfigured ??
    state.capabilities.model ??
    state.capabilities.providerConfigured;
  const localOnly = state.runtimePolicy?.localOnly === true;
  return (
    <div className={`lx-app ${mobile ? "lx-nav-open" : ""}`}>
      <a className="skip-link" href="#live-main">
        Skip to workspace
      </a>
      <aside className="lx-sidebar">
        <button
          className="lx-logo"
          onClick={() => {
            setView("Office");
            setMobile(false);
          }}
        >
          Attend<span>x</span>
          <i>LIVE</i>
        </button>
        <div className="lx-company-name">
          <span>{user.name?.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{user.name}'s company</strong>
            <small>Private workspace</small>
          </div>
        </div>
        <nav aria-label="Main navigation">
          {nav.map(({ name, Icon }) => (
            <button
              key={name}
              className={`lx-nav-item ${view === name ? "active" : ""}`}
              aria-current={view === name ? "page" : undefined}
              onClick={() => {
                setView(name);
                setMobile(false);
                setQuery("");
              }}
            >
              <Icon size={21} />
              {name}
              {name === "Reviews" && pending > 0 && (
                <span className="lx-nav-count">{pending}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="lx-sidebar-projects">
          <span className="lx-eyebrow">YOUR PROJECTS</span>
          {state.projects.slice(0, 5).map((p) => (
            <button
              key={p.id}
              onClick={() => {
                openProject(p.id);
                setMobile(false);
              }}
            >
              <i
                className={`lx-project-dot ${p.scope === "product" ? "product" : ""}`}
              />
              <span>{p.name}</span>
            </button>
          ))}
          <button onClick={() => setProjectForm(true)}>
            <Plus size={16} />
            New project
          </button>
        </div>
        <div className="lx-sidebar-foot">
          <ShieldCheck size={25} />
          <p>
            Governed by you<small>Scoped tools · reviewed releases</small>
          </p>
        </div>
        <button className="lx-signout" onClick={() => void logout()}>
          <SignOut />
          Sign out
        </button>
      </aside>
      <header className="lx-topbar">
        <button
          className="lx-icon lx-mobile-menu"
          aria-label={mobile ? "Close navigation" : "Open navigation"}
          onClick={() => setMobile(!mobile)}
        >
          {mobile ? <X /> : <List />}
        </button>
        <div className="lx-topbar-title">
          <strong>Company workspace</strong>
          <span className="lx-connection" data-connection={connection}>
            <i />
            {connection === "connected" ? "Live connection" : "Reconnecting…"}
          </span>
        </div>
        <label className="lx-search">
          <MagnifyingGlass size={19} />
          <input
            aria-label="Search agents and projects"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your company…"
          />
          {query && (
            <button
              className="lx-icon"
              aria-label="Clear search"
              onClick={() => setQuery("")}
            >
              <X size={16} />
            </button>
          )}
        </label>
        <button
          className="lx-button lx-primary"
          onClick={() => setProjectForm(true)}
        >
          <Plus />
          Assign project
        </button>
        <button
          className="lx-topbar-avatar"
          title={user.email}
          aria-label="Open account settings"
          onClick={() => setView("Settings")}
        >
          {user.name?.slice(0, 1).toUpperCase()}
        </button>
      </header>
      <main
        id="live-main"
        className={`lx-main ${view === "Office" ? "lx-office-main" : ""}`}
      >
        <div className="lx-page-heading">
          <div>
            <span className="lx-eyebrow">
              {view === "Office" ? "YOUR VIRTUAL COMPANY" : "ATTENDX WORKSPACE"}
            </span>
            <h1>
              {view === "Office"
                ? "Your office, alive."
                : view === "Agents"
                  ? "Meet your team."
                  : view === "Settings"
                    ? "Settings."
                    : `${view}.`}
            </h1>
            <p>
              {view === "Office"
                ? "A clear view of the people, plans, and progress behind your work."
                : view === "Projects"
                  ? "From your first brief to evidence you can review."
                  : view === "Agents"
                    ? "Named AI specialists, with bounded tools and shared direction."
                    : view === "Activity"
                      ? "A durable record of what actually happened."
                      : view === "Reviews"
                        ? "Your decisions move the company forward."
                        : "Connect models and shape how your company works."}
            </p>
          </div>
          {view === "Office" && (
            <div className="lx-layout-toggle" aria-label="Office layout">
              <button
                aria-pressed={layout === "office"}
                className={layout === "office" ? "active" : ""}
                onClick={() => setLayout("office")}
              >
                <SquaresFour />
                Office
              </button>
              <button
                aria-pressed={layout === "list"}
                className={layout === "list" ? "active" : ""}
                onClick={() => setLayout("list")}
              >
                <List />
                List
              </button>
            </div>
          )}
          {view === "Agents" && (
            <button
              className="lx-button lx-primary"
              onClick={() => setHire(true)}
            >
              <Plus />
              Hire agent
            </button>
          )}
        </div>
        {error && (
          <div className="lx-error lx-global-error" role="alert">
            {error}
            <button className="lx-text-button" onClick={() => void refresh()}>
              Retry
            </button>
          </div>
        )}
        {modelConfigured === false && view !== "Settings" && (
          <button
            className="lx-setup-banner"
            onClick={() => setView("Settings")}
          >
            <Lightning size={22} />
            <span>
              <strong>
                {localOnly
                  ? "Connect your local model to get started."
                  : "Connect your AI to get started."}
              </strong>{" "}
              {localOnly
                ? "No paid AI API key is required. Check the local connection in Settings."
                : "Add one or several providers in Settings. No model work is simulated."}
            </span>
            <ArrowRight />
          </button>
        )}
        {view === "Office" && (
          <>
            <section className="lx-metrics" aria-label="Live workspace metrics">
              <div>
                <UsersThree />
                <span>
                  <strong>{state.agents.length}</strong>AI specialists
                </span>
              </div>
              <div>
                <Pulse />
                <span>
                  <strong>{active}</strong>Running jobs
                </span>
              </div>
              <div>
                <FolderSimple />
                <span>
                  <strong>{state.projects.length}</strong>Projects
                </span>
              </div>
              <button onClick={() => setView("Reviews")}>
                <ShieldCheck />
                <span>
                  <strong>{pending}</strong>Pending reviews
                </span>
              </button>
            </section>
            <div className="lx-office-grid">
              <div className="lx-office-column">
                <div className="lx-stage-strip lx-workflow">
                  <span>
                    <i />
                    DELIVERY PIPELINE
                  </span>
                  {["Intake", "Build", "Verify", "Release"].map((s, i) => (
                    <span
                      key={s}
                      data-state={
                        state.projects.some(
                          (p) =>
                            p.stage === s &&
                            state.tasks.some(
                              (t) =>
                                t.projectId === p.id && t.status === "running",
                            ),
                        )
                          ? "running"
                          : undefined
                      }
                    >
                      <b>{String(i + 1).padStart(2, "0")}</b>
                      {s}
                      {i < 3 && (
                        <ArrowRight className="motion-flow-arrow" size={15} />
                      )}
                    </span>
                  ))}
                </div>
                {layout === "office" ? (
                  <Office
                    state={state}
                    selected={selected}
                    onSelect={setSelected}
                    filter={query}
                  />
                ) : (
                  <div className="lx-agent-list">
                    {agents.map((a) => (
                      <button
                        className={`lx-agent-row ${selected === a.id ? "selected" : ""}`}
                        key={a.id}
                        onClick={() => setSelected(a.id)}
                      >
                        <Avatar agent={a} />
                        <span>
                          <strong>{a.name}</strong>
                          <small>{a.role}</small>
                        </span>
                        <span>{a.activityLabel || human(a.status)}</span>
                        <Status value={a.status} />
                      </button>
                    ))}
                  </div>
                )}
                <div className="lx-feed">
                  <header>
                    <h3>
                      <Pulse />
                      Latest activity
                    </h3>
                    <button
                      className="lx-text-button"
                      onClick={() => setView("Activity")}
                    >
                      View all
                      <ArrowRight />
                    </button>
                  </header>
                  {state.events.slice(0, 3).map((e) => (
                    <article key={e.id}>
                      <i />
                      <p>{e.label}</p>
                      <time>{date(e.createdAt || e.time)}</time>
                    </article>
                  ))}
                </div>
              </div>
              <aside className="lx-inspector" aria-label="Selected agent">
                {current ? (
                  <>
                    <header>
                      <span className="lx-eyebrow">AGENT PROFILE</span>
                      <span className="lx-ai-label">AI</span>
                    </header>
                    <Avatar agent={current} large />
                    <h2>{current.name}</h2>
                    <p className="lx-inspector-role">{current.role}</p>
                    <Status value={current.status} />
                    <div className="lx-inspector-section">
                      <span>WORKING CONTEXT</span>
                      <h3>{project?.name || "Unassigned"}</h3>
                      <p>
                        {current.task || "Ready for an authorized project."}
                      </p>
                    </div>
                    <div className="lx-inspector-section">
                      <span>AGENT PERSONA</span>
                      <p>
                        {current.persona ||
                          "A specialized AI teammate operating within your project permissions."}
                      </p>
                    </div>
                    {current.expiresAt && (
                      <p className="lx-muted">
                        Authority expires {date(current.expiresAt)}
                      </p>
                    )}
                    <div className="lx-inspector-actions">
                      <button
                        className="lx-button lx-primary"
                        disabled={!project}
                        onClick={() =>
                          project && openProject(project.id, "Chat", current.id)
                        }
                      >
                        <ChatCircleText />
                        Chat with {current.name}
                      </button>
                      <button
                        className="lx-button lx-secondary"
                        disabled={!project}
                        onClick={() => project && openProject(project.id)}
                      >
                        <FolderSimple />
                        Open project
                      </button>
                      <button
                        className="lx-text-button"
                        onClick={() =>
                          void action(
                            `/agents/${current.id}/${current.status === "paused" ? "resume" : "pause"}`,
                          ).catch(() => {})
                        }
                      >
                        {current.status === "paused" ? <Play /> : <Pause />}
                        {current.status === "paused"
                          ? "Resume agent"
                          : "Pause agent"}
                      </button>
                    </div>
                    <div className="lx-inspector-security">
                      <ShieldCheck />
                      <p>
                        Every action has a boundary.
                        <small>
                          Agents cannot alter their own permissions or bypass
                          your approvals.
                        </small>
                      </p>
                    </div>
                  </>
                ) : (
                  <Empty title="Choose an agent">
                    Select someone in the office to see their role and chat.
                  </Empty>
                )}
              </aside>
            </div>
          </>
        )}
        {view === "Projects" && (
          <div className="lx-project-grid">
            {state.projects
              .filter((p) =>
                `${p.name} ${p.brief}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              )
              .map((p) => (
                <button
                  className="lx-project-card motion-enter"
                  key={p.id}
                  onClick={() => openProject(p.id)}
                >
                  <header>
                    <div className="lx-project-symbol">
                      <FolderSimple />
                    </div>
                    <Status value={p.status} />
                  </header>
                  <span className="lx-eyebrow">
                    {p.scope === "client" ? "CLIENT PROJECT" : "OWN PRODUCT"}
                  </span>
                  <h2>{p.name}</h2>
                  <p>{p.brief}</p>
                  <div className="lx-project-card-team">
                    {state.agents
                      .filter((a) => a.projectId === p.id)
                      .slice(0, 5)
                      .map((a) => (
                        <Avatar agent={a} key={a.id} />
                      ))}
                  </div>
                  <footer>
                    <span>
                      {localOnly
                        ? `${p.localCalls ?? 0} / ${state.runtimePolicy?.localCallLimit} local attempts`
                        : `${money(p.spentCents)} / ${money(p.budgetCents)}`}
                      <small>
                        {localOnly
                          ? "$0 external AI API cost"
                          : "Reserved estimate / budget"}
                      </small>
                    </span>
                    <ArrowRight />
                  </footer>
                </button>
              ))}
            <button
              className="lx-new-project"
              onClick={() => setProjectForm(true)}
            >
              <Plus size={30} />
              <h3>A new possibility.</h3>
              <p>Give your company its next project.</p>
            </button>
          </div>
        )}
        {view === "Agents" && (
          <div className="lx-agents-grid">
            {agents.map((a) => (
              <article className="lx-agent-card motion-enter" key={a.id}>
                <Avatar agent={a} large />
                <Status value={a.status} />
                <h2>{a.name}</h2>
                <p>{a.role}</p>
                <p className="lx-muted">
                  {a.persona || a.task || "Ready for your next project."}
                </p>
                <button
                  className="lx-button lx-secondary"
                  disabled={!a.projectId}
                  onClick={() => openProject(a.projectId, "Chat", a.id)}
                >
                  <ChatCircleText />
                  Start a conversation
                </button>
              </article>
            ))}
          </div>
        )}
        {view === "Activity" && (
          <div className="lx-activity-page">
            <LiveInsights state={state} />
            <div className="lx-section-title">
              <h2>Company event log</h2>
              <button
                className="lx-button lx-secondary"
                onClick={() => void refresh()}
              >
                <ArrowClockwise />
                Refresh
              </button>
            </div>
            {state.events.map((e) => (
              <article className="lx-event-row" key={e.id}>
                <span className="lx-event-symbol">
                  <Pulse />
                </span>
                <div>
                  <strong>{e.label}</strong>
                  <p>
                    {state.agents.find((a) => a.id === e.agentId)?.name ||
                      "System"}
                    {e.projectId
                      ? ` · ${state.projects.find((p) => p.id === e.projectId)?.name || "Project"}`
                      : ""}
                  </p>
                  {Boolean(e.detail) && (
                    <details>
                      <summary>Event details</summary>
                      <pre className="lx-code">{pretty(e.detail)}</pre>
                    </details>
                  )}
                </div>
                <time>{date(e.createdAt || e.time)}</time>
              </article>
            ))}
          </div>
        )}
        {view === "Reviews" && (
          <Reviews state={state} action={action} onArtifact={setArtifact} />
        )}
        {view === "Settings" && (
          <Settings state={state} action={action} refresh={refresh} />
        )}
      </main>
      {projectForm && (
        <ProjectForm
          state={state}
          action={action}
          onClose={() => setProjectForm(false)}
          onCreated={(id) => openProject(id)}
        />
      )}
      {hire && (
        <HireForm
          state={state}
          action={action}
          onClose={() => setHire(false)}
        />
      )}
      {workspace && (
        <ProjectWorkspace
          key={workspace.id}
          state={state}
          projectId={workspace.id}
          initialTab={workspace.tab}
          initialAgent={workspace.agentId}
          action={action}
          onClose={() => setWorkspace(null)}
          onArtifact={setArtifact}
        />
      )}
      {artifact && (
        <ArtifactViewer id={artifact} onClose={() => setArtifact("")} />
      )}
      {toast && (
        <div className="lx-toast" role="status">
          <span>{toast}</span>
          <button
            className="lx-icon"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X />
          </button>
        </div>
      )}
    </div>
  );
}
