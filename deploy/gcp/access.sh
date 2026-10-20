#!/usr/bin/env bash
# Open a private local SSH tunnel. Cloud Shell Web Preview needs its exact origin.
set -euo pipefail
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR/lib.sh"
PROJECT=''; ZONE=us-central1-a; NAME=attendx-office; ORIGIN=''; DRY_RUN=false; LOCAL=false
while (($#)); do
  case "$1" in
    --project|--zone|--name|--origin)
      (($#>=2)) || die "Missing value for $1"
      case "$1" in --project) PROJECT=$2;; --zone) ZONE=$2;; --name) NAME=$2;; --origin) ORIGIN=$2;; esac
      shift 2;;
    --local) LOCAL=true; shift;;
    --dry-run) DRY_RUN=true; shift;;
    --help|-h) printf 'Usage: access.sh [--project ID] [--zone ZONE] [--name NAME] [--origin https://preview-host] [--local] [--dry-run]\nRun in Cloud Shell, then Web Preview port 8080. --local is for a computer with gcloud and a localhost browser.\n'; exit 0;;
    *) die "Unknown option: $1";;
  esac
done
[[ -n "$PROJECT" ]] || PROJECT=$(default_project)
valid_project "$PROJECT"; valid_name "$NAME"; valid_zone "$ZONE"
if "$LOCAL" && [[ -n "$ORIGIN" ]]; then die "Choose --local or --origin, not both."; fi
if ! "$LOCAL" && [[ -z "$ORIGIN" ]]; then
  require_command gcloud
  CANDIDATE=$(gcloud cloud-shell get-url-for-web-preview --port=8080 2>/dev/null || true)
  ORIGIN=$(python3 - "$CANDIDATE" <<'PY'
import re,sys
matches=re.findall(r'https://[a-zA-Z0-9.-]+\.cloudshell\.dev',sys.argv[1])
print(matches[0].lower() if matches else '')
PY
)
  if [[ -z "$ORIGIN" && "${WEB_HOST:-}" =~ ^[a-z0-9.-]+\.cloudshell\.dev$ ]]; then
    ORIGIN="https://8080-${WEB_HOST}"
  fi
  [[ -n "$ORIGIN" ]] || die "Could not detect Cloud Shell preview URL. Open Web Preview → port 8080, copy its https://hostname (no path), then pass --origin URL. Or use --local on your own computer."
fi
if [[ -n "$ORIGIN" ]]; then valid_origin "$ORIGIN"; fi
SSH=(gcloud compute ssh "$NAME" --project "$PROJECT" --zone "$ZONE" --tunnel-through-iap)
if "$LOCAL"; then
  REMOTE_COMMAND='sudo /opt/attendx/app/deploy/gcp/admin.sh clear-origin'
  if "$DRY_RUN"; then print_command "${SSH[@]}" --command "$REMOTE_COMMAND"; else
    require_command gcloud
    "${SSH[@]}" --command "$REMOTE_COMMAND"
  fi
fi
if [[ -n "$ORIGIN" ]]; then
  printf -v REMOTE_COMMAND 'sudo /opt/attendx/app/deploy/gcp/admin.sh set-origin %q' "$ORIGIN"
  if "$DRY_RUN"; then print_command "${SSH[@]}" --command "$REMOTE_COMMAND"; else
    require_command gcloud
    "${SSH[@]}" --command "$REMOTE_COMMAND"
  fi
  printf 'Exact Cloud Shell preview origin: %s\n' "$ORIGIN"
fi
if "$DRY_RUN"; then
  print_command "${SSH[@]}" -- -N -L 127.0.0.1:8080:127.0.0.1:8080 -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3
  printf 'No origin changes or tunnel were created.\n'
  exit 0
fi
require_command gcloud
printf 'Keep this terminal open. In Cloud Shell choose Web Preview → port 8080.\n'
printf 'On your own computer (--local), browse http://localhost:8080. Stop tunnel with Ctrl+C.\n'
exec "${SSH[@]}" -- -N -L 127.0.0.1:8080:127.0.0.1:8080 -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3
