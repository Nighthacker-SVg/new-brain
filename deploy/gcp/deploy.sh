#!/usr/bin/env bash
# Run in Google Cloud Shell. This does not activate/upgrade a billing account.
set -euo pipefail
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR/lib.sh"

usage() {
  cat <<'EOF'
Usage: bash deploy/gcp/deploy.sh --ref FULL_COMMIT_SHA [options]
  --project ID       Google Cloud Project ID (default: active gcloud project)
  --zone ZONE        default: us-central1-a
  --name NAME        default: attendx-office
  --hours N          stop the VM N hours after each boot, 1-8; default: 4
  --dry-run          print the resource plan; never invoke gcloud mutations
  --help

Creates one CPU e2-standard-4 VM (16GB RAM), 80GB persistent disk, an isolated
network/subnet and an IAP-only SSH rule. App and model ports are not public.
Running resources consume trial credits; stopping the VM retains billed disk.
Check your remaining credits/expiry in Billing. Budgets are alerts, not hard caps.
EOF
}

PROJECT=''; ZONE=us-central1-a; NAME=attendx-office; REF=''; HOURS=4; DRY_RUN=false
while (($#)); do
  case "$1" in
    --project|--zone|--name|--ref|--hours)
      (($# >= 2)) || die "Missing value for $1"
      case "$1" in
        --project) PROJECT=$2;; --zone) ZONE=$2;; --name) NAME=$2;; --ref) REF=$2;; --hours) HOURS=$2;;
      esac
      shift 2;;
    --dry-run) DRY_RUN=true; shift;;
    --help|-h) usage; exit 0;;
    *) die "Unknown option: $1";;
  esac
done
[[ -n "$PROJECT" ]] || PROJECT=$(default_project)
valid_project "$PROJECT"; valid_name "$NAME"; valid_zone "$ZONE"; valid_ref "$REF"
[[ "$HOURS" =~ ^[1-8]$ ]] || die "--hours must be an integer from 1 to 8."
REGION=${ZONE%-*}; NETWORK="$NAME-net"; SUBNET="$NAME-subnet"; FIREWALL="$NAME-iap-ssh"; TAG="$NAME-iap"
MARKER='Attendx managed private CPU demo'

printf 'Attendx cloud plan: project=%s zone=%s commit=%s\n' "$PROJECT" "$ZONE" "$REF"
printf 'CPU VM: e2-standard-4; RAM:16GB; disk:80GB; no GPU; no service account.\n'
printf 'Only SSH from IAP 35.235.240.0/20 is allowed. Model/app have no public ingress.\n'
printf 'Automatic VM stop: %sh after boot. Disk/model data remain and consume credits.\n' "$HOURS"
printf 'This script does not upgrade billing. Check trial balance/expiry before execution.\n'

CREATE_NETWORK=(gcloud compute networks create "$NETWORK" --project "$PROJECT" --subnet-mode custom --description "$MARKER" --quiet)
CREATE_SUBNET=(gcloud compute networks subnets create "$SUBNET" --project "$PROJECT" --region "$REGION" --network "$NETWORK" --range 10.64.0.0/24 --description "$MARKER" --quiet)
CREATE_FIREWALL=(gcloud compute firewall-rules create "$FIREWALL" --project "$PROJECT" --network "$NETWORK" --direction INGRESS --priority 1000 --action ALLOW --rules tcp:22 --source-ranges 35.235.240.0/20 --target-tags "$TAG" --description "$MARKER" --quiet)

if "$DRY_RUN"; then
  print_command gcloud services enable compute.googleapis.com iap.googleapis.com --project "$PROJECT"
  print_command "${CREATE_NETWORK[@]}"
  print_command "${CREATE_SUBNET[@]}"
  print_command "${CREATE_FIREWALL[@]}"
  print_command gcloud compute instances create "$NAME" --project "$PROJECT" --zone "$ZONE" --machine-type e2-standard-4 --network "$NETWORK" --subnet "$SUBNET" --tags "$TAG" --image-family debian-12 --image-project debian-cloud --boot-disk-size 80GB --boot-disk-type pd-balanced --no-service-account --no-scopes --metadata block-project-ssh-keys=true --labels attendx-managed=true --metadata-from-file "startup-script=$SCRIPT_DIR/bootstrap.sh,attendx-config=GENERATED_CONFIG_JSON" --quiet
  printf 'No Google Cloud changes were made.\n'
  exit 0
fi

require_command gcloud; require_command python3
[[ -n "$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null)" ]] || die "Open authenticated Google Cloud Shell first. No keys are needed in chat."
gcloud projects describe "$PROJECT" --format='value(projectId)' >/dev/null
gcloud services enable compute.googleapis.com iap.googleapis.com --project "$PROJECT" --quiet

if EXISTING=$(gcloud compute instances describe "$NAME" --project "$PROJECT" --zone "$ZONE" --format=json 2>/dev/null); then
  python3 -c 'import json,sys; j=json.load(sys.stdin); sys.exit(0 if j.get("labels",{}).get("attendx-managed")=="true" else 1)' <<<"$EXISTING" || die "An unrelated VM already uses this name. Choose another --name; nothing was replaced."
  printf 'Managed VM already exists; it was not replaced. Use status.sh and access.sh.\n'
  exit 0
fi

# A visible quota failure must not silently trigger a more expensive machine/region.
QUOTAS=$(gcloud compute regions describe "$REGION" --project "$PROJECT" --format=json)
python3 - "$QUOTAS" <<'PY'
import json,sys
j=json.loads(sys.argv[1]); required={'CPUS':4,'E2_CPUS':4,'IN_USE_ADDRESSES':1,'PERSISTENT_DISKS_TOTAL_GB':80}
for q in j.get('quotas',[]):
    needed=required.get(q['metric'])
    if needed and q.get('limit',0)-q.get('usage',0)<needed:
        sys.exit(f"Insufficient {q['metric']} quota in this region. No larger/paid fallback was selected.")
PY

ensure_resource() {
  local kind=$1; shift
  local resource=$1; shift
  local existing
  if existing=$(gcloud compute "$kind" describe "$resource" --project "$PROJECT" "$@" --format='value(description)' 2>/dev/null); then
    [[ "$existing" == "$MARKER" ]] || die "Existing $kind/$resource is not managed by this script; refusing to modify it."
    return 0
  fi
  return 1
}
ensure_resource networks "$NETWORK" || "${CREATE_NETWORK[@]}"
if SUBNET_JSON=$(gcloud compute networks subnets describe "$SUBNET" --project "$PROJECT" --region "$REGION" --format=json 2>/dev/null); then
  python3 -c 'import json,sys; j=json.load(sys.stdin); ok=j.get("description")==sys.argv[1] and j.get("ipCidrRange")=="10.64.0.0/24" and j.get("network","").endswith("/"+sys.argv[2]);sys.exit(0 if ok else 1)' "$MARKER" "$NETWORK" <<<"$SUBNET_JSON" || die "Existing subnet differs from the planned private subnet; refusing to adopt it."
else
  "${CREATE_SUBNET[@]}"
fi
if RULE_JSON=$(gcloud compute firewall-rules describe "$FIREWALL" --project "$PROJECT" --format=json 2>/dev/null); then
  python3 -c 'import json,sys; j=json.load(sys.stdin); ok=j.get("description")==sys.argv[1] and j.get("sourceRanges")==["35.235.240.0/20"] and j.get("targetTags")==[sys.argv[2]] and j.get("allowed")==[{"IPProtocol":"tcp","ports":["22"]}] and j.get("network","").endswith("/"+sys.argv[3]) and j.get("direction")=="INGRESS";sys.exit(0 if ok else 1)' "$MARKER" "$TAG" "$NETWORK" <<<"$RULE_JSON" || die "Existing firewall differs from the IAP-only rule; refusing to adopt it."
else
  "${CREATE_FIREWALL[@]}"
fi

CONFIG=$(mktemp); trap 'rm -f "$CONFIG"' EXIT
python3 - "$REF" "$HOURS" >"$CONFIG" <<'PY'
import json,sys
print(json.dumps({'commit':sys.argv[1],'stop_hours':int(sys.argv[2]),'model':'qwen2.5-coder:3b'}))
PY
gcloud compute instances create "$NAME" --project "$PROJECT" --zone "$ZONE" \
  --machine-type e2-standard-4 --network "$NETWORK" --subnet "$SUBNET" --tags "$TAG" \
  --image-family debian-12 --image-project debian-cloud --boot-disk-size 80GB --boot-disk-type pd-balanced \
  --no-service-account --no-scopes --metadata block-project-ssh-keys=true \
  --labels attendx-managed=true --metadata-from-file "startup-script=$SCRIPT_DIR/bootstrap.sh,attendx-config=$CONFIG" --quiet
printf '\nVM created; installation continues on the VM. No readiness claim yet.\n'
printf 'Check: bash deploy/gcp/status.sh --project %q --zone %q --name %q\n' "$PROJECT" "$ZONE" "$NAME"
printf 'Open:  bash deploy/gcp/access.sh --project %q --zone %q --name %q\n' "$PROJECT" "$ZONE" "$NAME"
