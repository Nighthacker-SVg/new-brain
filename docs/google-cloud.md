# Attendx on Google Cloud: private CPU trial deployment

This package prepares the existing Attendx office, API, task worker, SQLite
storage, execution broker and one shared local Ollama model on a **single CPU
VM**. It does not create a new foundation model, train weights, or turn every
agent into a separate loaded model. Agent identities share the inference server
and run one generation at a time.

**Current verification boundary:** scripts and Compose configuration can be
checked locally. No Google Cloud account is authenticated in the development
environment, so VM provisioning, IAM/quota, IAP access and inference speed on the
Google VM must be verified after the account owner runs the package. A two-hour
setup is a target, not a guarantee. VM creation is not a readiness check.

## Resource plan and spending

| Resource | Default |
|---|---|
| Zone | `us-central1-a`, explicitly overridable |
| VM | `e2-standard-4`: 4 vCPU, 16GB RAM, Debian 12; **no GPU** |
| Disk | 80GB persistent balanced boot disk, including Docker volumes |
| Model | `qwen2.5-coder:3b`, a small initial coding baseline |
| Model runtime | Official Ollama image pinned by manifest digest |
| Model limits | One loaded model, one generation, 4096-token context, 1024 output tokens |
| Attendx limits | Local providers only; 200 local calls per project |
| Network | Dedicated VPC/subnet; only SSH from IAP's `35.235.240.0/20` |
| Public application ports | None. Web is bound to VM loopback; model/API/broker are not published |
| External IP | Ephemeral, for outgoing package/model downloads; no public app ingress |
| VM identity | No attached service account or Google Cloud API scopes |
| Automatic stop | Four hours after each boot; configurable from one to eight hours |

**Cloud compute, disks, addresses and network usage consume trial credits.**
Local inference avoids a paid AI API bill; Google Cloud infrastructure is still
metered. Check the actual remaining credits and expiry in **Billing → Credits**.
This script never upgrades/activates paid billing and never requests a GPU.
Standard trial accounts do not receive GPU quota by default. Budgets/alerts do
not impose a spending hard cap. Stopping the VM retains its disk and therefore
does not stop every charge. There is no claim of permanent free hosting.

The small model is a functional starting point, **not a promise of ChatGPT-level
coding quality**. Benchmark project plans, valid JSON and independently specified
acceptance tests before client work. Each model has its own weight license;
commercial usage of the selected checkpoint must be checked separately from
Attendx/Ollama's software license. The exact `3b` weight license was not verified
by this package's local tests. Large Colibri models and fine-tuning are separate
experiments, not part of this fast baseline deployment.

## Before execution

Use **Google Cloud Shell** in the intended project, signed in with your own
account. Do not paste credentials, private keys or service-account JSON into
chat. You need permission to enable Compute Engine/IAP, create the VM/network/
firewall, and connect through IAP. If a policy blocks an operation, request the
specific permission from the project administrator; do not disable security
policies or grant broad roles automatically.

IAP access commonly needs `roles/iap.tunnelResourceAccessor`. Projects enforcing
OS Login also need an appropriate OS Login role (administrator access is needed
for the VM-local `sudo` helpers). The script respects existing OS Login policy,
blocks project-wide SSH keys, and does not change IAM grants. Cloud Shell's
normal SSH tooling manages your SSH key; it is not copied into this repository.

## Deploy the exact downloaded revision

In Cloud Shell:

```bash
git clone --branch attendx-office-prototype --single-branch https://github.com/Nighthacker-SVg/new-brain.git attendx-cloud
cd attendx-cloud
PROJECT_ID=project-0a3017f8-3c64-4f72-86f
APP_REF=$(git rev-parse HEAD)
bash deploy/gcp/deploy.sh --project "$PROJECT_ID" --ref "$APP_REF" --dry-run
```

The dry run prints the resource plan and makes **no Google Cloud changes**. The
explicit full commit SHA pins the code the VM will fetch; the VM does not track
a moving branch. After checking the plan and your trial balance, execute:

```bash
bash deploy/gcp/deploy.sh --project "$PROJECT_ID" --ref "$APP_REF"
```

The script validates identifiers before resource mutation, checks regional
CPU/address/disk quota, and never substitutes a more expensive machine when
quota is missing. Existing unrelated resources with matching names are refused.
Rerunning against its already-created VM does not replace it or delete data.
Managed network/firewall resources from an interrupted run are only reused when
they match the expected configuration.

Installation runs on the VM: signed Debian/Docker packages, exact app revision,
pinned container bases, then the local model download. The automatic stop timer
is installed before package installation, so ordinary setup failures remain
bounded. Model downloads are persistent and can resume on a later attempt.

## Check progress and actual readiness

```bash
bash deploy/gcp/status.sh --project "$PROJECT_ID" --logs
bash deploy/gcp/status.sh --project "$PROJECT_ID"
```

Early during installation, the status helper may not yet exist. Use the logs
option; if SSH itself is unavailable, inspect Compute Engine → VM → serial/startup
logs and the specific IAP/IAM error. Do not open SSH or app ports to the internet
as a workaround.

The startup script checks `/api/health` and requests **one real generated model
response**, requiring a completed response and positive generated-token count.
It records those checks with the source revision in `/opt/attendx/ready.json`.
This proves a minimal API/model path; it does not prove arbitrary project
delivery, model quality, security or training. Confirm a real agent chat and a
small tested project through the UI next.

## Open the private office in Cloud Shell

```bash
bash deploy/gcp/access.sh --project "$PROJECT_ID"
```

Keep the terminal running. Select **Cloud Shell → Web Preview → port 8080**.
The helper detects the actual preview URL, configures that **exact HTTPS origin**
on the API, and opens an IAP SSH tunnel to the VM's loopback port. Wildcard CORS
or hostname trust is not used. Cloud Shell's preview is a private access method,
not a public production website or a permanently running connection.

If the preview URL cannot be detected, copy its hostname from the browser and
run, for example:

```bash
bash deploy/gcp/access.sh --project "$PROJECT_ID" --origin https://8080-YOUR-ACTUAL-PREVIEW-HOST.cloudshell.dev
```

Use only the actual origin: no path, trailing slash, query, credentials or port.
A restarted Cloud Shell session may get a new hostname; rerun the helper then.
On a computer with `gcloud` installed, use `--local` and open
`http://localhost:8080` on that computer instead. A localhost link on the VM is
not directly accessible from your computer. `--local` explicitly clears any
previous Cloud Shell preview origin before opening the tunnel; switching back to
Cloud Shell configures its exact HTTPS origin again. Strict origin checks remain
enabled in both modes.

Create your first Attendx account. Its seeded agents initially wait for work;
being idle does not indicate failed inference. The server's keyless model
connection is available to the **first registered account**. For a second account,
an owner can add its own Local Ollama connection with base
`http://ollama:11434/v1`, model `qwen2.5-coder:3b`, and keyless local mode.
Start with one small project and clear acceptance criteria. The default model
has a finite context/output budget; do not begin with a large repository.

## Retained data, updates and stopping

Data and model volumes live on the boot disk: projects, users, sessions, memories,
artifacts, database, encryption master key, broker control key and model weights.
Normal container recreation and VM stop/start retain them. **Do not run
`docker compose down --volumes`, delete Docker volumes, or prune the daemon.**
The VM-local checkout/config are root-owned; runtime configuration is mode `0600`.
Keep database, journals and encryption keys together in consistent backups.
Back up during a maintenance window before migrations or destructive cleanup.
Snapshots/backups also consume storage credits and are not automatically created.

Update to an explicitly reviewed full commit through IAP:

```bash
gcloud compute ssh attendx-office --project "$PROJECT_ID" --zone us-central1-a --tunnel-through-iap \
  --command 'sudo /opt/attendx/app/deploy/gcp/admin.sh update FULL_40_CHARACTER_COMMIT_SHA'
```

The helper refuses a dirty checkout, retains volumes, and prints the previous
revision. It does not blindly roll back a database migration. After an update,
repeat the model/project checks. Reboots keep an explicitly updated checkout.

Stop compute explicitly:

```bash
gcloud compute instances stop attendx-office --project "$PROJECT_ID" --zone us-central1-a
```

Restart when needed:

```bash
gcloud compute instances start attendx-office --project "$PROJECT_ID" --zone us-central1-a
```

The four-hour timer restarts from the new boot; disk charges continue while
stopped. To remove everything, first export/verify any needed data, then use the
Console's delete flow for **this VM and its boot disk only**. Deleting that disk
irreversibly removes the database, keys and models. Dedicated resources are named
`attendx-office-net`, `attendx-office-subnet` and `attendx-office-iap-ssh`; delete
only those after verifying they are no longer used. No automatic destructive
cleanup is included.

## Scope of this initial cloud package

This is a private, single-owner beta deployment. The broker retains administrative
Docker-daemon access as documented in [readiness.md](readiness.md). The execution
runner has bounded, network-isolated dependency-free Node/Python jobs. This setup
does not enable general internet access inside generated jobs, arbitrary package
installation, uncontrolled recursive hiring, public production releases, model
weight training or unsupervised self-modification. Persistent approved knowledge
and evaluated instruction improvements are distinct from model training.

The safest first success criterion is: create account → agent chat → small project
plan → owner approval → actual execution/tests → source artifact and preview.

The app also includes **Memory → Search project knowledge** and a **Research**
tab. Retrieval uses lightweight scoped lexical search. Research reads bounded,
allowlisted public HTTPS documents or discovers public GitHub repositories and
READMEs; it saves source URLs, timestamps and fetch outcomes, with one optional
unverified model summary. Source text is untrusted and is never automatically
approved as memory. This is not unrestricted search, recursive crawling or model
weight training. The collector uses direct DNS/HTTPS; verify outbound access on
the target VM. Larger models and broader project support remain independently
measured changes after the basic delivery path works.
