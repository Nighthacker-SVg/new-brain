#!/usr/bin/env bash
# VM-local operations. Invoke through sudo over IAP SSH; never print runtime.env.
set -euo pipefail
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR/lib.sh"
[[ $EUID == 0 ]] || die "Run this VM-local helper with sudo."
APP=/opt/attendx/app; ENV_FILE=/opt/attendx/runtime.env
cd "$APP"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f compose.yaml -f compose.gcp.yaml)
case "${1:-status}" in
  status)
    "${COMPOSE[@]}" ps -a
    curl --fail --silent --show-error --max-time 10 http://127.0.0.1:8080/api/health
    printf '\n'
    if [[ -f /opt/attendx/ready.json ]]; then
      python3 - /opt/attendx/ready.json "$(git rev-parse HEAD)" <<'PY'
import json,sys
try:
    j=json.load(open(sys.argv[1]))
    if j.get('commit')!=sys.argv[2]:
        print('Stored readiness marker is stale for this source revision; verification is required.')
    else:
        print(json.dumps(j))
except (OSError,ValueError):
    print('Readiness marker is unavailable or invalid; verification is required.')
PY
    else printf 'Initial inference smoke check has not completed.\n'; fi
    systemctl list-timers attendx-stop.timer --no-pager;;
  set-origin)
    [[ $# == 2 ]] || die "Usage: admin.sh set-origin https://preview-hostname"
    valid_origin "$2"
    set_runtime_origin "$ENV_FILE" "$2"
    "${COMPOSE[@]}" up -d --no-deps --force-recreate --wait --wait-timeout 90 api
    printf 'Exact browser origin configured.\n';;
  clear-origin)
    [[ $# == 1 ]] || die "Usage: admin.sh clear-origin"
    set_runtime_origin "$ENV_FILE" ''
    "${COMPOSE[@]}" up -d --no-deps --force-recreate --wait --wait-timeout 90 api
    printf 'Preview origin cleared; normal localhost origin checks are active.\n';;
  logs)
    "${COMPOSE[@]}" logs --tail 80 api ollama model-init runner;;
  update)
    [[ $# == 2 ]] || die "Usage: admin.sh update FULL_COMMIT_SHA"
    valid_ref "$2"
    [[ -z "$(git status --porcelain)" ]] || die "Checkout has changes. Preserve/review them before updating."
    PREVIOUS=$(git rev-parse HEAD)
    git fetch --depth 1 origin "$2"
    git checkout --detach "$2"
    rm -f /opt/attendx/ready.json
    printf 'Previous commit: %s\n' "$PREVIOUS"
    timeout 1800 "${COMPOSE[@]}" build
    systemctl restart attendx.service
    curl --fail --silent --show-error --max-time 15 http://127.0.0.1:8080/api/health
    printf '\nUpdated source; retained database, master/control keys and model volume.\n'
    printf 'Source rollback requires a compatible database version; do not reset/remove volumes.\n';;
  *) die "Supported VM-local operations: status, logs, set-origin URL, clear-origin, update COMMIT";;
esac
