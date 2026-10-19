# Attendx in Docker

Docker builds the locked frontend dependencies and TypeScript/Vite output, then serves only the compiled public files with Nginx. The runtime image contains no app source checkout, development server, Node runtime, API keys, or autonomous-agent service. Node 24 and the Nginx runtime are pinned to the base-image digests used for verification; update the pins and rerun checks when upgrading them.

## Start on your computer

With Docker Desktop running (or Docker Engine and Compose v2 installed), clone the `attendx-office-prototype` branch, enter that checkout, and run:

```sh
docker compose up --build -d --wait
docker compose ps
```

Open `http://localhost:8080` **on the same computer that runs Docker**. A cloud machine's localhost is not your computer's localhost. The chat Web preview is not needed for this local workflow.

The service must show `healthy`. If it fails, inspect `docker compose logs web`. A port-allocation error means another program owns port 8080; choose a different port rather than stopping that program.

If your organization's HTTPS proxy uses a private certificate authority, provide its trusted PEM bundle as an optional build secret. Keep TLS verification enabled. For example, on a system where the trusted bundle is `/etc/ssl/certs/ca-certificates.crt`:

```sh
docker build --secret id=build_ca,src=/etc/ssl/certs/ca-certificates.crt -t attendx-office:local .
docker compose up --no-build -d --wait
```

Use your actual trusted bundle path. The certificate mount exists only during dependency installation and is not copied into the image. This extra step is unnecessary on computers with ordinary public HTTPS access. In this cloud sandbox, Buildx also needs a writable config directory; prefix Docker build commands with `BUILDX_CONFIG=/tmp/attendx-buildx`.

For port 8081 on macOS/Linux:

```sh
ATTENDX_PORT=8081 docker compose up --build -d --wait
```

For port 8081 in Windows PowerShell:

```powershell
$env:ATTENDX_PORT = "8081"
docker compose up --build -d --wait
```

Then open `http://localhost:8081`. The binding remains local to your computer.

## Update or stop

From a clean checkout of the prototype branch:

```sh
git pull --ff-only
docker compose up --build -d --wait
```

Stop with `docker compose down`. There are no database volumes or saved agent jobs in this prototype; sample state lives in the browser and resets on refresh.

## Verify

The image healthcheck requests `/healthz`. The runtime runs as UID/GID 101, drops all Linux capabilities, disallows gaining privileges, uses a read-only root filesystem with a small temporary filesystem, and has CPU, memory and process limits. The build context excludes Git history, local environment files, dependency folders and screenshots. Only public build output permits cross-origin asset reads for restricted preview frames.

If Node and browser-test dependencies are also installed on the host, run the existing browser suite against the container:

```sh
ATTENDX_BASE_URL=http://127.0.0.1:8080 npm run test:e2e
```

These are optional developer checks, not requirements to run the UI. The production image intentionally omits test tools. Docker does not turn the sample review controls into real authorization or connect model providers.

Verified in the cloud environment: the Docker image built with locked packages and TypeScript checking; Compose reached `healthy`; all 11 existing browser tests passed against the container, including the opaque iframe and sample download. HTTP checks confirmed correct asset MIME types, cross-origin public asset access, and 404 responses for missing modules and private source paths. Runtime inspection confirmed UID/GID 101, dropped capabilities, a read-only root filesystem, and absence of the build CA mount. The loopback healthcheck explicitly bypasses outbound proxies.

## Remote or public access

This Compose configuration intentionally listens only on the Docker host's loopback interface. On a remote server, use an authenticated SSH tunnel, for example `ssh -L 8080:127.0.0.1:8080 user@server`, then open `http://localhost:8080` on your computer. The example needs your actual server address and SSH access; no tunnel or public deployment is provisioned here.

Public deployment needs a hosting destination and HTTPS/access controls appropriate to the data being displayed. Do not put provider credentials in this frontend image or browser variables.
