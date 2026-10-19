# Docker setup and operations

## Start on your computer

Start Docker Desktop (or Docker Engine with Compose v2). In the prototype checkout:

```sh
docker compose up --build -d --wait
docker compose ps
```

`web`, `api` and `runner` should be healthy. Open `http://localhost:8080` on that computer. Create an account, open Settings and add a provider. The chat preview and a cloud machine's localhost are separate from your computer's browser.

On Linux, set the broker's Docker socket group before starting:

```sh
export ATTENDX_DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)
docker compose up --build -d --wait
```

Socket access belongs to the broker only. Never mount it into API/frontend/generated jobs.

## Another port

On macOS/Linux: `ATTENDX_PORT=8081 docker compose up --build -d --wait`.

In PowerShell, set `$env:ATTENDX_PORT = "8081"`, then run Compose. Open `http://localhost:8081`. The binding remains local.

## AI providers

Settings stores up to 16 encrypted provider records. Blank role routing serves all roles; otherwise enter comma-separated IDs: `manager`, `engineer`, `quality`, `security`, `designer`, `researcher`, `data`. Lower priority is tried first. Every attempt reserves budget, including the one allowed fallback.

OpenAI-compatible bases include OpenAI `/v1`, OpenRouter `/api/v1`, Groq `/openai/v1`, DeepSeek `/v1` and Gemini `/v1beta/openai`. Anthropic uses `/v1` and its own messages protocol. Model availability depends on your account. Changing a destination/protocol requires a new credential; an old key is not forwarded to another provider.

For local Ollama, use `http://host.docker.internal:11434/v1` with keyless local mode. Its model must already be available and its server must accept connections from Docker's host gateway. Attendx does not install or start Ollama.

Custom HTTPS hosts require administrator configuration via `ATTENDX_PROVIDER_HOSTS` in a local `.env`, followed by Compose reconciliation. Optional environment fallback uses `ATTENDX_MODEL`, `ATTENDX_MODEL_API_KEY`, `ATTENDX_MODEL_BASE_URL` and `ATTENDX_MODEL_LOCAL`; it is restricted to the first account. Prefer per-account Settings. Never commit `.env` or use browser `VITE_` variables for keys.

## Cloud proxy certificates

This sandbox has a read-only home and an HTTPS proxy trust bundle. Keep TLS/package verification enabled; pass the trusted CA only for dependency installation:

```sh
export BUILDX_CONFIG=/tmp/attendx-buildx
docker build --secret id=build_ca,src=/etc/ssl/certs/ca-certificates.crt -t attendx-office:local .
docker build --target api -t attendx-api:local .
docker build -f runner/Dockerfile -t attendx-runner:local .
export ATTENDX_DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)
docker compose up --no-build -d --wait
```

Ordinary Docker Desktop installations with public HTTPS access need no CA step. This fixes build trust only; model runtime connections behind a corporate/cloud proxy may need separate approved trust/proxy configuration and allowed domains. Paid remote calls were not verified in this session.

## Data, updates and backups

Use `git pull --ff-only` and `docker compose up --build -d --wait` to update a clean checkout. Stop with `docker compose down`; data remains. Inspect errors with `docker compose logs api runner web`.

Back up data/control volumes while stopped. SQLite and `/data/master.key` belong together; the encryption key is deliberately outside the database. Retain `/control/runner-key` too. Do not remove normal workspace volumes during updates. Password/email recovery is not included in this local beta.

## Isolation and exposure

Web/API run non-root with read-only roots, dropped capabilities and resource limits. The private broker is trusted with the Docker daemon socket, which grants administrative host access. For production separation, put it on a dedicated worker host without unrelated workloads; local Compose is not a hostile multi-tenant security boundary.

Generated jobs use fixed pinned images, no network, no host mounts/secrets/capabilities, a non-root UID, read-only root and bounded temporary storage, CPU, memory, processes, time and output. Model text cannot supply Docker flags, mounts, images or arbitrary shell commands. Empty/skipped tests never count as passing execution.

Public access needs a chosen host, HTTPS and reviewed access controls. Set `ATTENDX_PUBLIC_ORIGIN` only for an intended public proxy. No deployment/tunnel is provisioned. With existing SSH access, a tunnel such as `ssh -L 8080:127.0.0.1:8080 user@server` can connect your browser to a remote service.
