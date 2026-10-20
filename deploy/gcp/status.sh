#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR/lib.sh"
PROJECT=''; ZONE=us-central1-a; NAME=attendx-office; LOGS=false
while (($#)); do
  case "$1" in
    --project|--zone|--name)
      (($#>=2)) || die "Missing value for $1"
      case "$1" in --project) PROJECT=$2;; --zone) ZONE=$2;; --name) NAME=$2;; esac
      shift 2;;
    --logs) LOGS=true; shift;;
    --help|-h) printf 'Usage: status.sh [--project ID] [--zone ZONE] [--name NAME] [--logs]\n'; exit 0;;
    *) die "Unknown option: $1";;
  esac
done
[[ -n "$PROJECT" ]] || PROJECT=$(default_project)
valid_project "$PROJECT"; valid_name "$NAME"; valid_zone "$ZONE"; require_command gcloud
gcloud compute instances describe "$NAME" --project "$PROJECT" --zone "$ZONE" \
  --format='table(name,status,machineType.basename(),disks[0].diskSizeGb)'
STATE=$(gcloud compute instances describe "$NAME" --project "$PROJECT" --zone "$ZONE" --format='value(status)')
if [[ "$STATE" != RUNNING ]]; then
  printf 'VM is not running. Retained disk still consumes credits. Explicit restart:\n'
  print_command gcloud compute instances start "$NAME" --project "$PROJECT" --zone "$ZONE"
  exit 0
fi
if "$LOGS"; then
  gcloud compute ssh "$NAME" --project "$PROJECT" --zone "$ZONE" --tunnel-through-iap \
    --command 'sudo tail -n 80 /var/log/attendx-setup.log'
else
  gcloud compute ssh "$NAME" --project "$PROJECT" --zone "$ZONE" --tunnel-through-iap \
    --command 'sudo /opt/attendx/app/deploy/gcp/admin.sh status'
fi
