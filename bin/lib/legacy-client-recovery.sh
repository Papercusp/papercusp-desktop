#!/usr/bin/env bash
# Legacy-client recovery phases for bin/candidate-install-upgrade-rollback.sh
# (r2-to-gcs-storage-migration-2026-10-23 R-3/R-6, WI-6554700010025562).
#
# A client built before a release-host move keeps polling the host baked into
# its binary. When that host is gone, the client must (a) say it COULD NOT
# CHECK rather than "you are up to date", and (b) be recoverable by an explicit,
# signature-verified manual install of the new release that keeps the user's
# data. These helpers make both claims executable on the disposable Linux VM:
#
#   legacy_client_recovery_trusted_pubkey     the updater key the OLD build trusts
#   legacy_client_recovery_verify_signatures  candidate .sig files verify under it
#   legacy_client_recovery_update_probe_script  old client's update-check verdict
#   legacy_client_recovery_seed_script        seed user data before the upgrade
#   legacy_client_recovery_check_script       require that data after each flip
#
# The *_script functions print guest-side bash for `vmctl ssh <vm> 'bash -s'`.
# They print one machine-readable line each; the host parses that line and
# never trusts the guest's exit status alone.

LEGACY_CLIENT_RECOVERY_BIN="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# legacy_client_recovery_trusted_pubkey <desktop-repo> <baseline-build-sha>
# Print plugins.updater.pubkey from the baseline's own source commit: the key
# that installed client actually enforces. Fails closed when the commit or key
# cannot be read; never falls back to the candidate's (or the working tree's) key.
legacy_client_recovery_trusted_pubkey() {
  local repo="${1:-}" sha="${2:-}" conf
  [[ -n "$repo" && "$sha" =~ ^[0-9a-f]{7,64}$ ]] || return 2
  conf="$(git -C "$repo" show "$sha:src-tauri/tauri.conf.json" 2>/dev/null)" || return 1
  python3 -c '
import json, sys
key = (json.load(sys.stdin).get("plugins") or {}).get("updater", {}).get("pubkey") or ""
if not key.strip():
    raise SystemExit(1)
print(key.strip())
' <<<"$conf"
}

# legacy_client_recovery_verify_signatures <pubkey> <artifact>...
# Verify each artifact's sibling .sig under <pubkey>. Prints one tab-separated
# row per artifact: <name>\t<exit>\t<verifier-json>. Returns 1 when any
# signature is missing or invalid, 2 on usage.
legacy_client_recovery_verify_signatures() {
  local pubkey="${1:-}" artifact out status rc=0
  [[ -n "$pubkey" && $# -ge 2 ]] || return 2
  shift
  local verifier="${PAPERCUSP_LEGACY_SIGNATURE_VERIFIER:-$LEGACY_CLIENT_RECOVERY_BIN/verify-tauri-signature.mjs}"
  for artifact in "$@"; do
    if [[ ! -f "$artifact.sig" ]]; then
      printf '%s\t2\t{"valid":false,"error":"missing .sig"}\n' "$(basename -- "$artifact")"
      rc=1
      continue
    fi
    status=0
    out="$(node "$verifier" "$pubkey" "$artifact" "$artifact.sig" --json 2>&1)" || status=$?
    printf '%s\t%s\t%s\n' "$(basename -- "$artifact")" "$status" "$(tr -d '\n' <<<"$out")"
    [[ "$status" -eq 0 ]] || rc=1
  done
  return "$rc"
}

# Guest-side prelude shared by the scripts below: resolve the running
# operator's port and the embedded PostgreSQL URL from the files the Server
# writes, and the psql shipped inside the Server bundle.
_legacy_client_recovery_guest_prelude() {
  cat <<'PRELUDE'
set -euo pipefail
PC_HOME="$HOME/.papercusp"
json_field() { python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$1" "$2"; }
PC_PORT="$(json_field "$PC_HOME/operator.json" port)"
PC_PG_URL="$(json_field "$PC_HOME/embedded-pg.json" url)"
PC_PSQL=""
for candidate in "/usr/lib/Papercusp Server/sidecar/bin/psql" "$(command -v psql || true)"; do
  if [[ -n "$candidate" && -x "$candidate" ]]; then PC_PSQL="$candidate"; break; fi
done
[[ -n "$PC_PSQL" ]] || { echo "no psql in the Server bundle or PATH" >&2; exit 1; }
pc_sql() { "$PC_PSQL" "$PC_PG_URL" -XAtq -v ON_ERROR_STOP=1 -c "$1"; }
pc_sha() { if [[ -f "$1" ]]; then sha256sum "$1" | cut -d' ' -f1; else echo absent; fi; }
PRELUDE
}

# legacy_client_recovery_update_probe_script <current-version>
# Ask the running (old) operator the exact question its updater asks, for both
# products, and report status + X-Update-Check + X-Update-Reason.
legacy_client_recovery_update_probe_script() {
  local version="${1:-}"
  [[ "$version" =~ ^[0-9A-Za-z.+~-]+$ ]] || return 2
  _legacy_client_recovery_guest_prelude
  cat <<PROBE
CURRENT_VERSION='$version'
PROBE
  cat <<'PROBE'
for product in gui server; do
  headers="$(mktemp)"
  status="$(curl -sS -m 90 -o /dev/null -D "$headers" -w '%{http_code}' \
    "http://127.0.0.1:$PC_PORT/api/updates/manifest?target=linux&arch=x86_64&current_version=$CURRENT_VERSION&product=$product" || echo 000)"
  check="$(awk -F': *' 'tolower($1)=="x-update-check"{gsub(/\r/,"",$2);print $2}' "$headers" | tail -1)"
  reason="$(awk -F': *' 'tolower($1)=="x-update-reason"{gsub(/\r/,"",$2);print $2}' "$headers" | tail -1)"
  rm -f "$headers"
  printf 'PAPERCUSP_LEGACY_UPDATE_CHECK product=%s status=%s check=%s reason=%s\n' \
    "$product" "$status" "${check:-none}" "${reason:-none}"
done
PROBE
}

# legacy_client_recovery_seed_script <nonce>
# Write user data the upgrade must keep: a row in the embedded database and a
# file in the Papercusp home. Also fingerprint the database encryption key and
# agent identity, whose loss would orphan encrypted data and the user's agents.
legacy_client_recovery_seed_script() {
  local nonce="${1:-}"
  [[ "$nonce" =~ ^[0-9a-f]{16,64}$ ]] || return 2
  _legacy_client_recovery_guest_prelude
  cat <<SEED
NONCE='$nonce'
SEED
  cat <<'SEED'
pc_sql "CREATE SCHEMA IF NOT EXISTS papercusp_user_data_probe;
  CREATE TABLE IF NOT EXISTS papercusp_user_data_probe.marker (nonce text PRIMARY KEY, written_at timestamptz NOT NULL DEFAULT now());
  INSERT INTO papercusp_user_data_probe.marker (nonce) VALUES ('$NONCE') ON CONFLICT DO NOTHING;" >/dev/null
mkdir -p "$PC_HOME/user-data-probe"
printf '%s\n' "$NONCE" >"$PC_HOME/user-data-probe/$NONCE"
printf 'PAPERCUSP_USER_DATA_SEEDED nonce=%s key=%s agent=%s\n' \
  "$NONCE" "$(pc_sha "$PC_HOME/db-encryption-key")" "$(pc_sha "$PC_HOME/su-agent-id")"
SEED
}

# legacy_client_recovery_check_script <nonce> <phase>
# Report whether the seeded data survived. Never fails on a miss: the host
# compares the reported line against the seed line and decides.
legacy_client_recovery_check_script() {
  local nonce="${1:-}" phase="${2:-}"
  [[ "$nonce" =~ ^[0-9a-f]{16,64}$ && "$phase" =~ ^[a-z-]+$ ]] || return 2
  _legacy_client_recovery_guest_prelude
  cat <<CHECK
NONCE='$nonce'
PHASE='$phase'
CHECK
  cat <<'CHECK'
pg="$(pc_sql "SELECT count(*) FROM papercusp_user_data_probe.marker WHERE nonce = '$NONCE'" 2>/dev/null || echo error)"
if [[ -f "$PC_HOME/user-data-probe/$NONCE" ]] && [[ "$(cat "$PC_HOME/user-data-probe/$NONCE")" == "$NONCE" ]]; then file=present; else file=absent; fi
printf 'PAPERCUSP_USER_DATA_CHECK phase=%s pg=%s file=%s key=%s agent=%s\n' \
  "$PHASE" "$pg" "$file" "$(pc_sha "$PC_HOME/db-encryption-key")" "$(pc_sha "$PC_HOME/su-agent-id")"
CHECK
}

# legacy_client_recovery_update_verdict <probe-output>
# Returns 0 ("not-silent") only when both products reported and neither
# answered up_to_date: a 200 (the old host still bridges an offer) or a 204
# cannot_check tells the user something. "answered-up-to-date" is honest when
# the old host is alive and simply has nothing newer, so the CALLER decides
# whether it is a failure (it is when the old host is known to be gone).
legacy_client_recovery_update_verdict() {
  local output="${1:-}" gui server
  gui="$(grep -E '^PAPERCUSP_LEGACY_UPDATE_CHECK product=gui ' <<<"$output" | tail -1)"
  server="$(grep -E '^PAPERCUSP_LEGACY_UPDATE_CHECK product=server ' <<<"$output" | tail -1)"
  [[ -n "$gui" && -n "$server" ]] || { echo "missing-report"; return 1; }
  local line
  for line in "$gui" "$server"; do
    if [[ "$line" == *" check=up_to_date "* ]]; then echo "answered-up-to-date"; return 1; fi
    if [[ "$line" != *" status=200 "* && "$line" != *" check=cannot_check "* ]]; then
      echo "unclassified"; return 1
    fi
  done
  echo "not-silent"
}

# legacy_client_recovery_data_verdict <seed-line> <check-line>
# PASS only when the row and file are present and both fingerprints are
# unchanged from the seed.
legacy_client_recovery_data_verdict() {
  local seed="${1:-}" check="${2:-}" key agent
  [[ "$seed" == PAPERCUSP_USER_DATA_SEEDED* && "$check" == PAPERCUSP_USER_DATA_CHECK* ]] || { echo "missing-report"; return 1; }
  key="$(sed -n 's/.* key=\([^ ]*\).*/\1/p' <<<"$seed")"
  agent="$(sed -n 's/.* agent=\([^ ]*\).*/\1/p' <<<"$seed")"
  [[ "$check" == *" pg=1 "* ]] || { echo "database-row-lost"; return 1; }
  [[ "$check" == *" file=present "* ]] || { echo "file-lost"; return 1; }
  [[ "$key" != absent && "$check" == *" key=$key "* ]] || { echo "encryption-key-changed"; return 1; }
  [[ "$agent" != absent && "$check" == *" agent=$agent" ]] || { echo "agent-identity-changed"; return 1; }
  echo "preserved"
}
