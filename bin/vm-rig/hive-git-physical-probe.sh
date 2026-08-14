#!/usr/bin/env bash
# hive-git-physical-probe.sh — canonical, fail-closed producer for the P-505
# two-machine hive-git release evidence consumed by bin/hive-git-drill.sh.
#
# This wrapper does not invent any scenario result. It first proves two distinct
# cached/keychain device identities, then delegates the mutation/observation work
# to the separately checked-in canonical scenario driver. Only that driver's
# fresh unsigned manifest is signed on BOTH physical hosts and finalized.
#
# The scenario entrypoint is execution-ready, but remains inert unless this
# canonical probe is selected by the drill. The probe forwards the plan slug as
# the scenario's separate destructive-execution grant; neither a bare readiness
# check nor a direct scenario call without that grant can mutate the rig.
#
# Usage (only through hive-git-drill.sh):
#   hive-git-physical-probe.sh /abs/evidence.json /abs/trust.json
# Safe live preflight (stages/verifies current source + identities; no mutation):
#   HIVE_GIT_PHYSICAL_PLAN=p2p-git-live-activation-2026-07-09 \
#     hive-git-physical-probe.sh --source-preflight
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${PAPERCUSP_REPO_DIR:-$(cd "$HERE/../../.." && pwd)}"
PRODUCER="$REPO_ROOT/packages/operator-core/lib/sync/pot-git/physical-drill-producer.ts"
SCENARIO="$HERE/hive-git-physical-scenario.sh"
TSX="$REPO_ROOT/node_modules/.bin/tsx"
VM='aviweiss@172.31.44.2'
VM_DEP_SOURCE='/Users/aviweiss/.papercusp-workspaces/.shared/dev-source'
VM_NODE='/Applications/Papercusp Server.app/Contents/Resources/sidecar/bin/node'
VM_TSX="$VM_DEP_SOURCE/node_modules/tsx/dist/cli.mjs"
TOWER_CACHE="${PAPERCUSP_ANNOUNCE_IDENTITY_CACHE:-$HOME/.papercusp-workspaces/.shared/.papercusp/local-announce-identity.json}"
VM_CACHE="${PCUSP_VM_ANNOUNCE_IDENTITY_CACHE:-/Users/aviweiss/.papercusp-workspaces/.shared/.papercusp/local-announce-identity.json}"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no)

source_preflight=0
if [ "${1:-}" = '--source-preflight' ]; then
  source_preflight=1
  shift
fi
evidence_out="${1:-}"
trust_out="${2:-}"
fail() { echo "hive-git-physical-probe: $*" >&2; exit 1; }

[ "${HIVE_GIT_PHYSICAL_PLAN:-}" = "p2p-git-live-activation-2026-07-09" ] \
  || fail 'must be launched by the canonical P-505 drill'
if [ "$source_preflight" -eq 1 ]; then
  [ "$#" -eq 0 ] || fail 'usage: hive-git-physical-probe.sh --source-preflight'
else
  [ "$#" -eq 2 ] || fail 'usage: hive-git-physical-probe.sh /abs/evidence.json /abs/trust.json'
  [ -n "$evidence_out" ] && [ "${evidence_out#/}" != "$evidence_out" ] \
    || fail 'evidence output must be an absolute path'
  [ -n "$trust_out" ] && [ "${trust_out#/}" != "$trust_out" ] \
    || fail 'trust output must be an absolute path'
  [ "$evidence_out" != "$trust_out" ] || fail 'evidence and trust outputs must differ'
  [ ! -e "$evidence_out" ] && [ ! -e "$trust_out" ] \
    || fail 'refusing to overwrite a pre-banked output'
fi
[ -x "$TSX" ] && [ -f "$PRODUCER" ] || fail 'local TypeScript producer is unavailable'
[ -x "$SCENARIO" ] \
  || fail "canonical E/G scenario driver is not executable: $SCENARIO"

# Readiness is an OFFLINE gate and must precede the first VM ssh. An incomplete
# checked-in scenario must not touch the physical rig merely to discover that
# it cannot emit an admissible manifest yet.
"$SCENARIO" --require-ready >/dev/null

run_dir="$(mktemp -d "${TMPDIR:-/tmp}/hive-git-physical-run.XXXXXX")"
remote_source="/tmp/hive-git-physical-source.$$"
cleanup() {
  ssh "${SSH_OPTS[@]}" "$VM" \
    "case '$remote_source' in /tmp/hive-git-physical-source.[0-9]*) rm -rf -- '$remote_source' ;; esac" \
    >/dev/null 2>&1 || true
  rm -rf "$run_dir"
}
trap cleanup EXIT HUP INT TERM

tower_identity="$run_dir/tower-identity.json"
vm_identity="$run_dir/vm-identity.json"
unsigned_evidence="$run_dir/unsigned-evidence.json"
tower_receipt="$run_dir/tower-receipt.json"
vm_receipt="$run_dir/vm-receipt.json"
remote_unsigned="/tmp/hive-git-physical-unsigned-$$.json"
VM_PRODUCER="$remote_source/packages/operator-core/lib/sync/pot-git/physical-drill-producer.ts"

# The bundle-extracted VM dev-source is intentionally pinned to the installed
# app and can be older than this release candidate. Stage an immutable HEAD
# snapshot for the observer/adapter instead of overwriting that installed tree.
# The installed node_modules supplies the VM-native dependency closure; the
# exact producer bytes must still match the tower working tree before either
# host identity is read.
ssh "${SSH_OPTS[@]}" "$VM" \
  "[ -x '$VM_TSX' ] && [ -d '$VM_DEP_SOURCE/node_modules' ] && [ ! -e '$remote_source' ] && mkdir -m 700 '$remote_source'" \
  || fail 'could not create the canonical VM run-source directory'
git -C "$REPO_ROOT" archive --format=tar HEAD -- \
  packages/operator-core libs/generic scripts package.json tsconfig.base.json \
  | ssh "${SSH_OPTS[@]}" "$VM" "tar -xf - -C '$remote_source'" \
  || fail 'could not stage the immutable superproject source snapshot on the VM'
git -C "$REPO_ROOT/libs/papercusp" archive --format=tar --prefix=libs/papercusp/ HEAD \
  | ssh "${SSH_OPTS[@]}" "$VM" "tar -xf - -C '$remote_source'" \
  || fail 'could not stage the immutable papercusp-library snapshot on the VM'

# Build a run-local dependency overlay. Third-party modules remain read-only
# links into the installed bundle, while every staged workspace package wins
# over the bundle's potentially stale workspace symlink (including packages
# that did not exist when that bundle was cut).
ssh "${SSH_OPTS[@]}" "$VM" \
  "'$VM_NODE' - '$remote_source' '$VM_DEP_SOURCE'" <<'NODE' \
  || fail 'could not build the VM run-source dependency overlay'
const fs = require('node:fs');
const path = require('node:path');
const [runRoot, installedRoot] = process.argv.slice(2);
const installedModules = path.join(installedRoot, 'node_modules');
const runModules = path.join(runRoot, 'node_modules');
fs.mkdirSync(runModules, { mode: 0o700 });

const hasEntry = (target) => {
  try { fs.lstatSync(target); return true; } catch { return false; }
};
const link = (source, target) => {
  if (!hasEntry(target)) fs.symlinkSync(source, target, 'dir');
};

for (const entry of fs.readdirSync(installedModules, { withFileTypes: true })) {
  const source = path.join(installedModules, entry.name);
  const target = path.join(runModules, entry.name);
  // A scope may itself be a symlink in an installed npm tree. Always make the
  // run-local scope a real directory so replacing one of its package links can
  // never traverse back into and mutate the installed bundle.
  if (entry.name.startsWith('@') && (entry.isDirectory() || entry.isSymbolicLink())) {
    fs.mkdirSync(target, { recursive: true });
    for (const child of fs.readdirSync(source)) {
      link(path.join(source, child), path.join(target, child));
    }
  } else {
    link(source, target);
  }
}

const packageBases = [
  path.join(runRoot, 'packages'),
  path.join(runRoot, 'libs', 'generic'),
  path.join(runRoot, 'libs', 'papercusp', 'libs'),
  path.join(runRoot, 'libs', 'papercusp', 'packages'),
];
for (const base of packageBases) {
  if (!fs.existsSync(base)) continue;
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageRoot = path.join(base, entry.name);
    const manifestPath = path.join(packageRoot, 'package.json');
    if (!fs.existsSync(manifestPath)) continue;
    const name = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).name;
    if (typeof name !== 'string' || !name) continue;
    const target = path.join(runModules, ...name.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (hasEntry(target)) {
      const stat = fs.lstatSync(target);
      if (!stat.isSymbolicLink()) throw new Error(`refusing to replace non-link dependency ${name}`);
      fs.unlinkSync(target);
    }
    fs.symlinkSync(packageRoot, target, 'dir');
  }
}
NODE
local_producer_sha="$(sha256sum "$PRODUCER" | awk '{print $1}')"
remote_producer_sha="$(ssh "${SSH_OPTS[@]}" "$VM" \
  "shasum -a 256 '$VM_PRODUCER' | awk '{print \$1}'")" \
  || fail 'could not hash the staged VM physical-drill producer'
[ "$remote_producer_sha" = "$local_producer_sha" ] \
  || fail 'staged VM physical-drill producer does not match the tower working tree'

# Identity preflight is load-only: the cached announce identity must still
# match an EXISTING keychain entry on each host. No gh lookup or key mint occurs.
"$TSX" "$PRODUCER" identity tower "$TOWER_CACHE" >"$tower_identity"
ssh "${SSH_OPTS[@]}" "$VM" \
  "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' identity vm '$VM_CACHE'" >"$vm_identity"
"$TSX" "$PRODUCER" preflight "$tower_identity" "$vm_identity" >/dev/null
if [ "$source_preflight" -eq 1 ]; then
  printf '{"schemaVersion":"hive-git-physical-source-preflight/v1","ready":true,"producerSha256":"%s","topology":"tower-vm-distinct-host-identities"}\n' \
    "$local_producer_sha"
  exit 0
fi

# The scenario receives the preflighted identities so its topology is pinned
# before it mutates anything. It must emit fresh, UNATTESTED same-run A-G
# observations at an absent path; the finalizer rejects pre-banked signatures.
HIVE_GIT_PHYSICAL_PLAN="$HIVE_GIT_PHYSICAL_PLAN" \
  HIVE_GIT_PHYSICAL_EXECUTE="$HIVE_GIT_PHYSICAL_PLAN" \
  HIVE_GIT_PHYSICAL_VM_SOURCE="$remote_source" \
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
