#!/usr/bin/env bash
# Shared validation only: sourcing this file never invokes Google Cloud.
set -euo pipefail

die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
require_command() { command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"; }
valid_project() { [[ "$1" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || die "Use a valid Google Cloud Project ID, not its display name."; }
valid_name() { [[ "$1" =~ ^[a-z][a-z0-9-]{0,38}[a-z0-9]$ ]] || die "Instance name must be 2-40 lowercase letters, numbers or dashes."; }
valid_zone() { [[ "$1" =~ ^[a-z]+-[a-z]+[0-9]+-[a-z]$ ]] || die "Use a zone such as us-central1-a."; }
valid_ref() { [[ "$1" =~ ^[0-9a-f]{40}$ ]] || die "--ref must be a full 40-character Git commit SHA."; }
valid_origin() {
  python3 - "$1" <<'PY'
import re,sys,urllib.parse
raw=sys.argv[1]
try:
    u=urllib.parse.urlsplit(raw)
    valid=(u.scheme=='https' and u.hostname and
           re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?',u.hostname) and
           u.netloc==u.hostname and not u.username and not u.password and
           not u.path and not u.query and not u.fragment)
except ValueError:
    valid=False
if not valid:
    sys.exit('Error: origin must be exactly https://hostname, with no path, port, credentials, query or fragment.')
PY
}

default_project() {
  require_command gcloud
  local p
  p=$(gcloud config get-value project 2>/dev/null)
  [[ -n "$p" && "$p" != '(unset)' ]] || die "Pass --project YOUR_PROJECT_ID or select a project in Cloud Shell."
  printf '%s' "$p"
}

# Print a shell-safe command for an explicit, non-mutating dry run.
print_command() { printf '  '; printf '%q ' "$@"; printf '\n'; }

# Shared file operation, also exercised against temporary files in offline tests.
# Callers validate a non-empty HTTPS origin first; empty resets normal localhost use.
set_runtime_origin() {
  python3 - "$1" "$2" <<'PY'
import os,pathlib,sys,tempfile
p=pathlib.Path(sys.argv[1]); origin=sys.argv[2]
if any(c in origin for c in '\r\n\0'):
    sys.exit('Invalid origin characters.')
lines=p.read_text().splitlines(); key='ATTENDX_PUBLIC_ORIGIN='
lines=[x for x in lines if not x.startswith(key)]+[key+origin]
fd,tmp=tempfile.mkstemp(dir=p.parent,prefix='.runtime-'); os.fchmod(fd,0o600)
with os.fdopen(fd,'w') as f: f.write('\n'.join(lines)+'\n')
os.replace(tmp,p)
PY
}
