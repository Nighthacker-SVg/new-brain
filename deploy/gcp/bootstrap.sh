#!/usr/bin/env bash
# Google Compute Engine startup script, run as root. No credentials in metadata.
set -euo pipefail
umask 077
mkdir -p /opt/attendx
rm -f /opt/attendx/ready.json
exec > >(tee -a /var/log/attendx-setup.log) 2>&1
trap 'printf "Attendx setup failed at line %s. Inspect /var/log/attendx-setup.log; automatic VM stop remains enabled.\n" "$LINENO"' ERR

# Establish a default bound before even installing startup prerequisites.
cat >/etc/systemd/system/attendx-stop.service <<'EOF'
[Unit]
Description=Stop the bounded Attendx trial VM
[Service]
Type=oneshot
ExecStart=/usr/sbin/shutdown -h now
EOF
cat >/etc/systemd/system/attendx-stop.timer <<'EOF'
[Unit]
Description=Stop Attendx four hours after boot
[Timer]
OnBootSec=4h
Unit=attendx-stop.service
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now attendx-stop.timer

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl git gnupg python3

CONFIG=$(mktemp)
trap 'rm -f "$CONFIG"' EXIT
curl --fail --silent --show-error --retry 5 --max-time 30 \
  -H 'Metadata-Flavor: Google' \
  http://metadata.google.internal/computeMetadata/v1/instance/attributes/attendx-config >"$CONFIG"
readarray -t SETTINGS < <(python3 - "$CONFIG" <<'PY'
import json,re,sys
j=json.load(open(sys.argv[1])); ref=j.get('commit',''); hours=j.get('stop_hours'); model=j.get('model','')
if not re.fullmatch('[0-9a-f]{40}',ref) or type(hours) is not int or not 1<=hours<=8 or model!='qwen2.5-coder:3b':
    sys.exit('Invalid Attendx startup configuration.')
print(ref); print(hours); print(model)
PY
)
((${#SETTINGS[@]} == 3)) || { printf 'Invalid/missing startup settings.\n'; exit 1; }
REF=${SETTINGS[0]}; STOP_HOURS=${SETTINGS[1]}; MODEL=${SETTINGS[2]}

# Apply the validated override; OnBootSec still measures from this boot.
cat >/etc/systemd/system/attendx-stop.timer <<EOF
[Unit]
Description=Stop Attendx ${STOP_HOURS} hours after each boot
[Timer]
OnBootSec=${STOP_HOURS}h
Unit=attendx-stop.service
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl restart attendx-stop.timer

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl --fail --silent --show-error --retry 3 --max-time 60 https://download.docker.com/linux/debian/gpg \
    -o /etc/apt/keyrings/docker.asc
  chmod 0644 /etc/apt/keyrings/docker.asc
  ARCH=$(dpkg --print-architecture)
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable\n' "$ARCH" >/etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y --no-install-recommends docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

APP=/opt/attendx/app
if [[ ! -d "$APP/.git" ]]; then
  [[ ! -e "$APP" ]] || { printf 'Refusing to overwrite existing %s\n' "$APP"; exit 1; }
  mkdir "$APP"
  git -C "$APP" init
  git -C "$APP" remote add origin https://github.com/Nighthacker-SVg/new-brain.git
  git -C "$APP" fetch --depth 1 origin "$REF"
  git -C "$APP" checkout --detach "$REF"
else
  # An existing VM may have received an explicit admin update. Never undo it at boot.
  printf 'Using retained checkout at %s\n' "$(git -C "$APP" rev-parse HEAD)"
fi
[[ -f "$APP/compose.gcp.yaml" && -f "$APP/deploy/gcp/admin.sh" ]] || { printf 'Pinned commit lacks the Google Cloud package.\n'; exit 1; }

if [[ ! -f /opt/attendx/runtime.env ]]; then
  cat >/opt/attendx/runtime.env <<EOF
ATTENDX_MODEL=$MODEL
ATTENDX_PORT=8080
ATTENDX_DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)
ATTENDX_PUBLIC_ORIGIN=
EOF
  chmod 0600 /opt/attendx/runtime.env
fi
python3 - <<'PY'
import os,pathlib
p=pathlib.Path('/opt/attendx/runtime.env'); lines=p.read_text().splitlines()
gid=str(os.stat('/var/run/docker.sock').st_gid)
lines=[('ATTENDX_DOCKER_GID='+gid) if x.startswith('ATTENDX_DOCKER_GID=') else x for x in lines]
p.write_text('\n'.join(lines)+'\n'); p.chmod(0o600)
PY

cat >/etc/systemd/system/attendx.service <<'EOF'
[Unit]
Description=Attendx private CPU stack
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target
[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/attendx/app
ExecStart=/usr/bin/docker compose --env-file /opt/attendx/runtime.env -f compose.yaml -f compose.gcp.yaml up -d --wait --wait-timeout 2700
ExecStop=/usr/bin/docker compose --env-file /opt/attendx/runtime.env -f compose.yaml -f compose.gcp.yaml stop
TimeoutStartSec=2800
TimeoutStopSec=90
[Install]
WantedBy=multi-user.target
EOF

cd "$APP"
COMPOSE=(docker compose --env-file /opt/attendx/runtime.env -f compose.yaml -f compose.gcp.yaml)
timeout 1800 "${COMPOSE[@]}" build
# Python jobs need this fixed runner image; Node is already pulled by the build.
timeout 600 docker pull python:3.12-alpine@sha256:1b668429b3511ab407d8e00648891631b0b1a4d7e15e3ca70f38ab5b91ad4ab4
systemctl daemon-reload
systemctl enable attendx.service
systemctl restart attendx.service

curl --fail --silent --show-error --max-time 15 http://127.0.0.1:8080/api/health
printf '\nChecking one actual local-model response (not a test fixture).\n'
timeout 240 "${COMPOSE[@]}" exec -T api node --input-type=module -e '
const r=await fetch("http://ollama:11434/api/generate",{
 method:"POST",headers:{"Content-Type":"application/json"},
 body:JSON.stringify({model:process.env.ATTENDX_MODEL,prompt:"Reply with READY only.",stream:false,options:{num_predict:16,num_ctx:1024,temperature:0}}),
 signal:AbortSignal.timeout(210000)});
if(!r.ok)throw new Error("Local model HTTP "+r.status);
const j=await r.json();
if(!j.done||typeof j.response!=="string"||!j.response.trim()||!(j.eval_count>0))throw new Error("No completed model generation");
console.log("Local model inference passed; generated tokens:",j.eval_count);'
python3 - "$APP" <<'PY'
import datetime,json,pathlib,subprocess,sys
root=pathlib.Path(sys.argv[1]); ref=subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip()
pathlib.Path('/opt/attendx/ready.json').write_text(json.dumps({'commit':ref,'verified_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'checks':['api_health','actual_local_model_generation']})+'\n')
PY
printf '\nAttendx API and local-model smoke check passed. Create your account through the private tunnel next.\n'
printf 'No public app/model ports were opened. VM stops %s hours after boot; disk remains.\n' "$STOP_HOURS"
