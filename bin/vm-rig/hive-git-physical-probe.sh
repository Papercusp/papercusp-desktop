#!/usr/bin/env bash
# hive-git-physical-probe.sh — canonical, fail-closed producer for the P-505
# two-machine hive-git release evidence consumed by bin/hive-git-drill.sh.
#
# This wrapper does not invent any scenario result. It first proves two distinct
# cached/keychain device identities, then delegates the mutation/observation work
# to the separately checked-in canonical scenario driver. Only that driver's
# fresh unsigned manifest is signed on BOTH physical hosts and finalized.
#
# The scenario entrypoint is checked in, but remains execution-incomplete until
# its fixed A-G phase executors land. It exits before the first mutation and
# produces no manifest, so installing the invocation contract cannot turn
# either release SKIP green.
#
# Usage (only through hive-git-drill.sh):
#   hive-git-physical-probe.sh /abs/evidence.json /abs/trust.json
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${PAPERCUSP_REPO_DIR:-$(cd "$HERE/../../.." && pwd)}"
PRODUCER="$REPO_ROOT/packages/operator-core/lib/sync/pot-git/physical-drill-producer.ts"
SCENARIO="$HERE/hive-git-physical-scenario.sh"
TSX="$REPO_ROOT/node_modules/.bin/tsx"
VM="${PCUSP_VM_SSH:-aviweiss@172.31.44.2}"
VM_SOURCE="${PCUSP_VM_DEV_SOURCE:-/Users/aviweiss/.papercusp-workspaces/.shared/dev-source}"
VM_NODE="${PCUSP_VM_NODE:-/Applications/Papercusp Server.app/Contents/Resources/sidecar/bin/node}"
VM_TSX="${PCUSP_VM_TSX:-$VM_SOURCE/node_modules/tsx/dist/cli.mjs}"
VM_PRODUCER="${PCUSP_VM_PHYSICAL_PRODUCER:-$VM_SOURCE/packages/operator-core/lib/sync/pot-git/physical-drill-producer.ts}"
TOWER_CACHE="${PAPERCUSP_ANNOUNCE_IDENTITY_CACHE:-$HOME/.papercusp-workspaces/.shared/.papercusp/local-announce-identity.json}"
VM_CACHE="${PCUSP_VM_ANNOUNCE_IDENTITY_CACHE:-/Users/aviweiss/.papercusp-workspaces/.shared/.papercusp/local-announce-identity.json}"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no)

evidence_out="${1:-}"
trust_out="${2:-}"
fail() { echo "hive-git-physical-probe: $*" >&2; exit 1; }

[ "${HIVE_GIT_PHYSICAL_PLAN:-}" = "p2p-git-live-activation-2026-07-09" ] \
  || fail 'must be launched by the canonical P-505 drill'
[ -n "$evidence_out" ] && [ "${evidence_out#/}" != "$evidence_out" ] \
  || fail 'evidence output must be an absolute path'
[ -n "$trust_out" ] && [ "${trust_out#/}" != "$trust_out" ] \
  || fail 'trust output must be an absolute path'
[ "$evidence_out" != "$trust_out" ] || fail 'evidence and trust outputs must differ'
[ ! -e "$evidence_out" ] && [ ! -e "$trust_out" ] \
  || fail 'refusing to overwrite a pre-banked output'
[ -x "$TSX" ] && [ -f "$PRODUCER" ] || fail 'local TypeScript producer is unavailable'
[ -x "$SCENARIO" ] \
  || fail "canonical E/G scenario driver is not executable: $SCENARIO"

# Readiness is an OFFLINE gate and must precede the first VM ssh. An incomplete
# checked-in scenario must not touch the physical rig merely to discover that
# it cannot emit an admissible manifest yet.
"$SCENARIO" --require-ready >/dev/null

run_dir="$(mktemp -d "${TMPDIR:-/tmp}/hive-git-physical-run.XXXXXX")"
cleanup() { rm -rf "$run_dir"; }
trap cleanup EXIT HUP INT TERM

tower_identity="$run_dir/tower-identity.json"
vm_identity="$run_dir/vm-identity.json"
unsigned_evidence="$run_dir/unsigned-evidence.json"
tower_receipt="$run_dir/tower-receipt.json"
vm_receipt="$run_dir/vm-receipt.json"
remote_unsigned="/tmp/hive-git-physical-unsigned-$$.json"

# Identity preflight is load-only: the cached announce identity must still
# match an EXISTING keychain entry on each host. No gh lookup or key mint occurs.
"$TSX" "$PRODUCER" identity tower "$TOWER_CACHE" >"$tower_identity"
ssh "${SSH_OPTS[@]}" "$VM" \
  "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' identity vm '$VM_CACHE'" >"$vm_identity"
"$TSX" "$PRODUCER" preflight "$tower_identity" "$vm_identity" >/dev/null

# The scenario receives the preflighted identities so its topology is pinned
# before it mutates anything. It must emit fresh, UNATTESTED same-run A-G
# observations at an absent path; the finalizer rejects pre-banked signatures.
HIVE_GIT_PHYSICAL_PLAN="$HIVE_GIT_PHYSICAL_PLAN" \
  PCUSP_VM_SSH="$VM" \
  "$SCENARIO" "$unsigned_evidence" "$tower_identity" "$vm_identity"
[ -s "$unsigned_evidence" ] || fail 'canonical scenario produced no unsigned evidence'

"$TSX" "$PRODUCER" sign "$unsigned_evidence" tower "$TOWER_CACHE" >"$tower_receipt"
scp "${SSH_OPTS[@]}" "$unsigned_evidence" "$VM:$remote_unsigned" >/dev/null
if ! ssh "${SSH_OPTS[@]}" "$VM" \
  "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' sign '$remote_unsigned' vm '$VM_CACHE'" \
  >"$vm_receipt"; then
  ssh "${SSH_OPTS[@]}" "$VM" "rm -f '$remote_unsigned'" >/dev/null 2>&1 || true
  fail 'VM host receipt failed'
fi
ssh "${SSH_OPTS[@]}" "$VM" "rm -f '$remote_unsigned'" >/dev/null 2>&1 || true

"$TSX" "$PRODUCER" finalize \
  "$unsigned_evidence" "$tower_receipt" "$vm_receipt" "$evidence_out" "$trust_out"
