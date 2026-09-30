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
VM_IDENTITY_DIR="${PCUSP_VM_IDENTITY_DIR:-/Users/aviweiss/.papercusp-workspaces/.shared/.papercusp/identity}"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no)
# physical-drill-iteration-speed-2026-09-29 P-005 (D-003): HIVE_GIT_RIG=same-box retargets
# every host value above at the same-box two-instance rig; the default changes nothing.
# shellcheck source=lib/rig-profile.sh
. "$HERE/lib/rig-profile.sh"
rig_profile_apply || exit 2

source_preflight=0
if [ "${1:-}" = '--source-preflight' ]; then
  source_preflight=1
  shift
fi
evidence_out="${1:-}"
trust_out="${2:-}"
failure_diagnostics_out=''
fail() {
  local message="$*"
  printf 'hive-git-physical-probe: %s\n' "$message" >&2
  if [ -n "${run_dir:-}" ] && [ -d "$run_dir" ]; then
    printf '%s\n' "$message" >"$run_dir/failure.err" || true
    chmod 600 "$run_dir/failure.err" 2>/dev/null || true
  fi
  exit 1
}

[ "${HIVE_GIT_PHYSICAL_PLAN:-}" = "p2p-git-live-activation-2026-07-09" ] \
  || fail 'must be launched by the canonical P-505 drill'
if [ "$source_preflight" -eq 0 ] && [ -z "${PAPERCUSP_CAPABILITY_BASH_BACKGROUND_TASK_ID:-}" ]; then
  fail 'physical run requires a durable capability:bash background task enrollment'
fi
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
  failure_diagnostics_out="${evidence_out}.failure-diagnostics"
  [ ! -e "$failure_diagnostics_out" ] \
    || fail 'refusing to overwrite pre-banked failure diagnostics'
fi
[ -x "$TSX" ] && [ -f "$PRODUCER" ] || fail 'local TypeScript producer is unavailable'
[ -x "$SCENARIO" ] \
  || fail "canonical E/G scenario driver is not executable: $SCENARIO"

# physical-drill-iteration-speed-2026-09-29 P-002 (R-3): a diagnostic re-run names
# its phases in HIVE_GIT_PHYSICAL_PHASES (the drill's --only-phase/--from-phase).
# Validate it before the first ssh, so a typo costs a second rather than a staging
# round-trip. Empty = every phase = the only run that may produce release evidence.
# shellcheck source=../lib/physical-phase-select.sh
. "$HERE/../lib/physical-phase-select.sh"
physical_phases="$(physical_phase_list "${HIVE_GIT_PHYSICAL_PHASES:-}")" \
  || fail "invalid HIVE_GIT_PHYSICAL_PHASES: ${HIVE_GIT_PHYSICAL_PHASES:-}"
physical_full_run=0
physical_phase_is_full "$physical_phases" && physical_full_run=1
# A same-box rehearsal is never release evidence, even with every phase selected (D-003),
# and it refuses a phase that needs a property only the physical rig has.
if rig_profile_is_diagnostic; then physical_full_run=0; fi
rig_profile_refuse_physical_only "$physical_phases" || exit 2

# Readiness is an OFFLINE gate and must precede the first VM ssh. An incomplete
# checked-in scenario must not touch the physical rig merely to discover that
# it cannot emit an admissible manifest yet.
"$SCENARIO" --require-ready >/dev/null

# Build a run-local dependency overlay for a staged source tree. Used for BOTH
# hosts: piped to the tower's node for the tower snapshot, and over ssh to the
# VM's node for the VM run-source. Arguments: <run root> <installed root>.
# Third-party modules remain read-only links into the installed tree, while
# every staged workspace package wins over the installed tree's potentially
# stale (VM bundle) or moving (tower working tree) workspace symlink, including
# packages that did not exist when that tree was cut.
run_source_overlay_js() {
  cat <<'NODE'
// VM-RUN-SOURCE-OVERLAY-BEGIN
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

// Reuse every canonical workspace registry staged into the immutable run tree
// rather than maintaining a second hand-written directory list here. The root
// registry covers the main monorepo; nested repositories such as
// libs/papercusp carry their own registry and may declare packages (for example
// @papercusp/file-claim) that intentionally are not repeated at the root.
const rootRegistryPath = path.join(runRoot, 'package.json');
const workspaceRegistryPaths = [...new Set([
  rootRegistryPath,
  ...fs.globSync('**/package.json', {
    cwd: runRoot,
    exclude: ['**/node_modules/**'],
  }).map((relative) => path.join(runRoot, relative)),
])];
const workspaceRoots = new Set();
let rootRegistryFound = false;
for (const registryPath of workspaceRegistryPaths) {
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const workspacePatterns = Array.isArray(registry.workspaces)
    ? registry.workspaces
    : registry.workspaces?.packages;
  if (registryPath === rootRegistryPath) {
    rootRegistryFound = Array.isArray(workspacePatterns) && workspacePatterns.length > 0;
  }
  if (!Array.isArray(workspacePatterns)) continue;
  const registryRoot = path.dirname(registryPath);
  for (const pattern of workspacePatterns) {
    for (const relative of fs.globSync(pattern, {
      cwd: registryRoot,
      exclude: ['**/node_modules/**'],
    })) {
      const packageRoot = path.join(registryRoot, relative);
      if (fs.existsSync(path.join(packageRoot, 'package.json'))) workspaceRoots.add(packageRoot);
    }
  }
}
if (!rootRegistryFound) {
  throw new Error('root package.json has no workspace registry for the VM run-source overlay');
}
for (const packageRoot of workspaceRoots) {
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

// WI-10004062 — package-local (non-hoisted) dependencies. `git archive` stages
// no node_modules, so a workspace package whose installed copy carries its own
// nested node_modules (the tower's operator-core pins its own @anthropic-ai and
// @ai-sdk versions there) would otherwise resolve those imports UPWARD to the
// root copy: a different version, silently. Mirror each installed package-local
// node_modules into the run tree entry by entry. The @papercusp scope and dot
// entries are skipped on purpose: a workspace import must keep resolving upward
// to the run-local overlay above, never back into the installed tree.
for (const packageRoot of workspaceRoots) {
  const relative = path.relative(runRoot, packageRoot);
  if (!relative || relative.startsWith('..')) continue;
  const installedNested = path.join(installedRoot, relative, 'node_modules');
  let nestedEntries;
  try {
    if (!fs.statSync(installedNested).isDirectory()) continue;
    nestedEntries = fs.readdirSync(installedNested, { withFileTypes: true });
  } catch {
    continue;
  }
  const runNested = path.join(packageRoot, 'node_modules');
  if (hasEntry(runNested)) continue;
  for (const entry of nestedEntries) {
    if (entry.name === '@papercusp' || entry.name.startsWith('.')) continue;
    fs.mkdirSync(runNested, { recursive: true, mode: 0o700 });
    const source = path.join(installedNested, entry.name);
    const target = path.join(runNested, entry.name);
    if (entry.name.startsWith('@') && (entry.isDirectory() || entry.isSymbolicLink())) {
      fs.mkdirSync(target, { recursive: true });
      for (const child of fs.readdirSync(source)) {
        link(path.join(source, child), path.join(target, child));
      }
    } else {
      link(source, target);
    }
  }
}

// Fail before identity lookup or rig mutation if ANY direct Papercusp
// dependency of operator-core still resolves into the installed bundle. This
// guards the dependency CLOSURE, rather than pinning today's one missing
// package name and re-arming the same mixed-version failure for the next one.
const operatorManifest = JSON.parse(
  fs.readFileSync(path.join(runRoot, 'packages', 'operator-core', 'package.json'), 'utf8'),
);
const canonicalRunRoot = fs.realpathSync(runRoot);
const staleWorkspaceDependencies = Object.keys(operatorManifest.dependencies ?? {})
  .filter((name) => name.startsWith('@papercusp/'))
  .filter((name) => {
    const target = path.join(runModules, ...name.split('/'));
    if (!hasEntry(target)) return true;
    const resolved = fs.realpathSync(target);
    return resolved !== canonicalRunRoot && !resolved.startsWith(`${canonicalRunRoot}${path.sep}`);
  });
if (staleWorkspaceDependencies.length > 0) {
  throw new Error(
    `operator-core workspace dependencies were not staged into the VM run-source overlay: ${staleWorkspaceDependencies.join(', ')}`,
  );
}
// VM-RUN-SOURCE-OVERLAY-END
NODE
}

# PINNED-SOURCE-BEGIN
# WI-10004062 — PIN ONE SOURCE AND RUN IT ON BOTH HOSTS.
#
# The VM has always run an immutable git-archive snapshot, but the tower ran
# $PRODUCER and its whole import closure straight out of $REPO_ROOT: the shared
# working tree that parallel builders edit. Two failures followed. A peer's
# uncommitted edit to pot-git/physical-drill-*.ts made the tower differ from
# the VM, so the digest check refused the run before any phase. And because the
# scenario calls the tower producer dozens of times, an edit landing MID-run
# changed tower behaviour between phases with nothing to notice it. Each cost a
# rig slot plus a VM swap cycle (2026-09-30, WI-10004055 retries #1 and #2, no
# phase verdict from either).
#
# So resolve the superproject commit and every libs/ submodule commit ONCE,
# here. Extract them into a run-private tower snapshot carrying the same
# dependency overlay the VM uses, and stage the SAME commits onto the VM below.
# Every tower producer call (both preflights, identity, every scenario phase,
# sign, finalize) then runs bytes that cannot change under the run, and one
# commit names the run's source. The working tree's dirtiness stops mattering:
# uncommitted edits are simply not part of the run, and the probe says so.
source_sha="$(git -C "$REPO_ROOT" rev-parse --verify 'HEAD^{commit}')" \
  || fail 'could not resolve the tower superproject commit to pin'
# Submodules are enumerated from .gitmodules, not a hand-list, so adding a
# submodule cannot silently re-arm the WI-39361 trap (see the VM staging note).
staged_submodules=()
staged_submodule_shas=()
while IFS= read -r sm_path; do
  [ -n "$sm_path" ] || continue
  case "$sm_path" in libs/*) ;; *) continue ;; esac
  [ -e "$REPO_ROOT/$sm_path/.git" ] \
    || fail "required submodule is not initialised on the tower: $sm_path"
  sm_sha="$(git -C "$REPO_ROOT/$sm_path" rev-parse --verify 'HEAD^{commit}')" \
    || fail "could not resolve the submodule commit to pin: $sm_path"
  staged_submodules+=("$sm_path")
  staged_submodule_shas+=("$sm_sha")
done < <(git -C "$REPO_ROOT" config --file "$REPO_ROOT/.gitmodules" \
  --get-regexp '^submodule\..*\.path$' | awk '{ print $2 }')
[ "${#staged_submodules[@]}" -gt 0 ] \
  || fail 'no libs/ submodules were staged — .gitmodules is unreadable or empty'

# Stream the PINNED source into one host. "$@" is the extracting command: a
# local tar for the tower snapshot, an ssh-wrapped tar for the VM. The pinned
# shas are the only revision named here: re-resolving HEAD at staging time
# would let a git-sync commit between the two hosts' staging split them.
stage_pinned_source() {
  local host="$1" i sm_path
  shift
  git -C "$REPO_ROOT" archive --format=tar "$source_sha" -- \
    packages libs scripts package.json tsconfig.base.json \
    | "$@" \
    || fail "could not stage the pinned superproject source snapshot on the $host"
  for i in "${!staged_submodules[@]}"; do
    sm_path="${staged_submodules[$i]}"
    git -C "$REPO_ROOT/$sm_path" archive --format=tar --prefix="$sm_path/" "${staged_submodule_shas[$i]}" \
      | "$@" \
      || fail "could not stage the pinned submodule snapshot on the $host: $sm_path"
  done
}

tower_source="$(mktemp -d "${TMPDIR:-/tmp}/hive-git-physical-tower-source.XXXXXX")"
# cleanup() (installed below) removes the snapshot too; until then this narrower
# trap keeps an early refusal from leaking a multi-hundred-MB tree.
trap 'rm -rf -- "$tower_source"' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
stage_pinned_source tower tar -xf - -C "$tower_source"
empty_tower_submodules=''
for sm_path in "${staged_submodules[@]}"; do
  [ -n "$(find "$tower_source/$sm_path" -type f -print -quit 2>/dev/null)" ] \
    || empty_tower_submodules="$empty_tower_submodules $sm_path"
done
[ -z "$empty_tower_submodules" ] \
  || fail "tower snapshot submodule tree contains NO FILES:$empty_tower_submodules"
run_source_overlay_js | node - "$tower_source" "$REPO_ROOT" \
  || fail 'could not build the tower run-source dependency overlay'
PRODUCER="$tower_source/packages/operator-core/lib/sync/pot-git/physical-drill-producer.ts"
[ -f "$PRODUCER" ] || fail "pinned source $source_sha carries no physical-drill producer"
# Repo-aware producer code (the rig preflight's git reads) must still inspect
# the LIVE repository, not the snapshot its own import.meta.url now points into.
export PAPERCUSP_REPO_DIR="$REPO_ROOT"
# D-086 (p2p-public-release-endgame-2026-09-01): the rig preflight's
# drill-source-committed check verifies the code the run EXECUTES (this snapshot
# against this commit), not the live tree's dirt, which is not part of the run.
export PHYSICAL_DRILL_SOURCE_SHA="$source_sha"
export PHYSICAL_DRILL_TOWER_SOURCE="$tower_source"
uncommitted_drill_sources="$(git -C "$REPO_ROOT" status --porcelain -- \
  packages/operator-core/lib/sync/pot-git 2>/dev/null || true)"
printf 'hive-git-physical-run: pinned source %s (+%d submodules) on tower and VM\n' \
  "$source_sha" "${#staged_submodules[@]}" >&2
if [ -n "$uncommitted_drill_sources" ]; then
  printf 'hive-git-physical-run: uncommitted pot-git edits are NOT part of this run:\n%s\n' \
    "$uncommitted_drill_sources" >&2
fi
# PINNED-SOURCE-END

# Phase E is the only phase that touches GitHub remotes. Prove the fixed canary
# has both configured remotes, authenticated push permission, and the exact
# starting refs before the first SSH or any phase mutation. A partial run that
# does not select E never touches the remotes, so it skips this check.
case ",$physical_phases," in
  *,E,*) "$TSX" "$PRODUCER" phase-e-preflight >/dev/null ;;
esac
# RIG-PREFLIGHT (physical-drill-iteration-speed P-003, R-5): the P-505 guard-rail facts as
# read-only checks, before the first rig ssh — pinned drill source (the tower snapshot equals the pinned commit; D-086),
# canary mode baseline, no leftover Phase D trust hold, VM payload = the tower-composed build,
# both owners answering. A refusal names the check (PHYSICAL_PREFLIGHT_FAILED <check>) in
# seconds instead of surfacing mid-phase. PCUSP_VM_GITHUB_USER_ID overrides the VM user.
# The rig profile adds its own checks/ports (same-box: the throwaway owners' ports, never :3070).
rig_preflight_args=()
mapfile -t rig_preflight_args < <(rig_profile_preflight_args)
PCUSP_VM_SSH="$VM" "$TSX" "$PRODUCER" rig-preflight \
  --vm-github-user-id "${PCUSP_VM_GITHUB_USER_ID:-1567022}" \
  ${rig_preflight_args[@]+"${rig_preflight_args[@]}"} >/dev/null \
  || fail 'rig preflight refused the run (the PHYSICAL_PREFLIGHT_FAILED line above names the check)'

run_dir="$(mktemp -d "${TMPDIR:-/tmp}/hive-git-physical-run.XXXXXX")"
remote_source="/tmp/hive-git-physical-source.$$"

# FAILED-RUN-DIAGNOSTIC-CLEANUP-BEGIN
preserve_failed_run_diagnostics() {
  local exit_status="$1"
  [ -n "$failure_diagnostics_out" ] || return 0

  node - "$run_dir" "$failure_diagnostics_out" "$exit_status" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const [sourceRoot, destinationRoot, rawExitStatus] = process.argv.slice(2);
const perFileLimitBytes = 256 * 1024;
const totalLimitBytes = 1024 * 1024;
// Which files are banked is DERIVED from the run tree, never hand-listed. A
// hand-list named only Phase A, so every Phase B-G failure banked nothing of
// the phase that failed (P-505 run 24 lost all Phase D observations,
// WI-10003767). Scope: failure.err at the root, plus every .json/.err/.log file
// under a phase-<letter>/ directory. Root-level identities, receipts and
// unsigned evidence stay out. Order is priority under the byte cap: the LATEST
// phase first (phases run A..G, so that is the one that failed), and inside a
// phase the named observations before numbered poll attempts, newest attempt
// first.
const phaseDirs = fs.readdirSync(sourceRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^phase-[a-z]$/.test(entry.name))
  .map((entry) => entry.name)
  .sort()
  .reverse();
const attemptNumber = (relative) => {
  const match = /-(\d+)\.[a-z]+$/.exec(relative);
  return match ? Number(match[1]) : null;
};
const byPriority = (a, b) => {
  const na = attemptNumber(a);
  const nb = attemptNumber(b);
  if ((na === null) !== (nb === null)) return na === null ? -1 : 1;
  if (na !== null && nb !== null && na !== nb) return nb - na;
  return a < b ? -1 : a > b ? 1 : 0;
};
const phaseFiles = (phase) => {
  const out = [];
  const walk = (relative) => {
    for (const entry of fs.readdirSync(path.join(sourceRoot, relative), { withFileTypes: true })) {
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (/\.(json|err|log)$/.test(entry.name)) out.push(child);
    }
  };
  walk(phase);
  return out.sort(byPriority);
};
const allowed = ['failure.err', ...phaseDirs.flatMap(phaseFiles)];
const sensitiveKey = /(authorization|cookie|credential|password|secret|token|private.?key)/i;
const sanitizeText = (value) => value
  .replace(
    /-----BEGIN [^-\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\n]*PRIVATE KEY-----/g,
    '[REDACTED PRIVATE KEY]',
  )
  .replace(/\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g, '[REDACTED TOKEN]')
  .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED]')
  .replace(/([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s/]+@/gi, '$1[REDACTED]@');
const sanitize = (value, key = '') => {
  if (key && sensitiveKey.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return sanitizeText(value);
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, sanitize(child, childKey)]));
  }
  return value;
};

const temporaryRoot = fs.mkdtempSync(`${destinationRoot}.tmp.`);
fs.chmodSync(temporaryRoot, 0o700);
const included = [];
const skipped = [];
let totalBytes = 0;
try {
  for (const relative of allowed) {
    const source = path.join(sourceRoot, relative);
    let stat;
    try {
      stat = fs.lstatSync(source);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      skipped.push({ path: relative, reason: 'not-regular-file' });
      continue;
    }
    if (stat.size > perFileLimitBytes || totalBytes + stat.size > totalLimitBytes) {
      skipped.push({ path: relative, reason: 'source-size-cap', bytes: stat.size });
      continue;
    }

    const raw = fs.readFileSync(source, 'utf8');
    let sanitized;
    try {
      sanitized = `${JSON.stringify(sanitize(JSON.parse(raw)), null, 2)}\n`;
    } catch {
      sanitized = sanitizeText(raw);
    }
    const sanitizedBytes = Buffer.byteLength(sanitized);
    if (sanitizedBytes > perFileLimitBytes || totalBytes + sanitizedBytes > totalLimitBytes) {
      skipped.push({ path: relative, reason: 'sanitized-size-cap', bytes: sanitizedBytes });
      continue;
    }

    const destination = path.join(temporaryRoot, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.writeFileSync(destination, sanitized, { mode: 0o600, flag: 'wx' });
    included.push({ path: relative, bytes: sanitizedBytes });
    totalBytes += sanitizedBytes;
  }

  const manifest = {
    schemaVersion: 'hive-git-physical-failure-diagnostics/v1',
    exitStatus: Number(rawExitStatus),
    sanitized: true,
    caps: { perFileBytes: perFileLimitBytes, totalBytes: totalLimitBytes },
    included,
    skipped,
    includedBytes: totalBytes,
  };
  fs.writeFileSync(path.join(temporaryRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx',
  });
  fs.renameSync(temporaryRoot, destinationRoot);
} catch (error) {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  throw error;
}
NODE
}

cleanup() {
  local exit_status=$?
  trap - EXIT HUP INT TERM
  ssh "${SSH_OPTS[@]}" "$VM" \
    "case '$remote_source' in /tmp/hive-git-physical-source.[0-9]*) rm -rf -- '$remote_source' ;; esac" \
    >/dev/null 2>&1 || true
  if [ -n "${tower_source:-}" ]; then
    rm -rf -- "$tower_source"
  fi
  if [ "$exit_status" -ne 0 ] && [ "$source_preflight" -eq 0 ]; then
    if preserve_failed_run_diagnostics "$exit_status"; then
      printf 'hive-git-physical-probe: preserved failed-run diagnostics at %s\n' \
        "$failure_diagnostics_out" >&2
      rm -rf "$run_dir"
    else
      printf 'hive-git-physical-probe: diagnostic sanitization failed; private raw workspace retained at %s\n' \
        "$run_dir" >&2
    fi
  else
    rm -rf "$run_dir"
  fi
  exit "$exit_status"
}
# FAILED-RUN-DIAGNOSTIC-CLEANUP-END
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

tower_identity="$run_dir/tower-identity.json"
vm_identity="$run_dir/vm-identity.json"
unsigned_evidence="$run_dir/unsigned-evidence.json"
tower_receipt="$run_dir/tower-receipt.json"
vm_receipt="$run_dir/vm-receipt.json"
remote_unsigned="/tmp/hive-git-physical-unsigned-$$.json"
VM_PRODUCER="$remote_source/packages/operator-core/lib/sync/pot-git/physical-drill-producer.ts"

# The bundle-extracted VM dev-source is intentionally pinned to the installed
# app and can be older than this release candidate. Stage the SAME pinned
# commits the tower snapshot was cut from (PINNED-SOURCE above) instead of
# overwriting that installed tree. The installed node_modules supplies the
# VM-native dependency closure; the digest check below proves both hosts hold
# the same producer bytes before either host identity is read.
ssh "${SSH_OPTS[@]}" "$VM" \
  "[ -x '$VM_TSX' ] && [ -d '$VM_DEP_SOURCE/node_modules' ] && [ ! -e '$remote_source' ] && mkdir -m 700 '$remote_source'" \
  || fail 'could not create the canonical VM run-source directory'
# Stage every first-party package, not only operator-core. The producer loads
# operator-core's real module graph during identity/preflight; leaving one of
# its workspace dependencies (for example packages/coordination) behind in the
# installed bundle creates a mixed-version graph and surfaces as a misleading
# missing named export. `git archive` excludes node_modules, so widening this
# tracked-source slice does not copy the dependency payload.
#
# Submodule CONTENTS are staged one archive per submodule repo, because
# `git archive` NEVER includes a submodule's files — it emits the bare
# mount-point directory and nothing else, silently. Verified directly:
#   $ git archive --format=tar HEAD -- libs/papercusp-shared | tar -tf -
#   libs/
#   libs/papercusp-shared/        ← two empty dirs, zero files
# A hand-rolled single archive once staged libs/papercusp ONLY, leaving
# libs/papercusp-shared — a declared npm workspace and a direct operator-core
# dependency — resolving on the rig to the installed bundle's STALE copy. Fresh
# operator-core against a stale sibling fails as an unresolvable import naming
# a SYMBOL, which reads like "someone broke an export" rather than "the harness
# never shipped the file" (WI-39361: `'@papercusp/papercusp-shared/agent' does
# not provide an export named 'parseUsageReset'`). stage_pinned_source walks
# the .gitmodules-derived staged_submodules list for exactly this reason.
stage_pinned_source VM ssh "${SSH_OPTS[@]}" "$VM" "tar -xf - -C '$remote_source'"

# RECURRENCE GUARD (WI-39361): prove the staged tree actually contains FILES for
# every submodule before any identity is read. A staging regression must fail
# HERE, naming the path, instead of surfacing minutes later on the rig as an
# import error that points at the consuming file rather than the missing one.
empty_staged="$(ssh "${SSH_OPTS[@]}" "$VM" \
  "for d in ${staged_submodules[*]}; do \
     [ -n \"\$(find '$remote_source'/\$d -type f -print -quit 2>/dev/null)\" ] || echo \$d; \
   done")" \
  || fail 'could not verify the staged submodule contents on the VM'
[ -z "$empty_staged" ] \
  || fail "staged submodule tree contains NO FILES on the VM: $(echo $empty_staged)"

# Build the VM run-source dependency overlay with the same script the tower
# snapshot used (run_source_overlay_js, defined above), over the installed
# bundle's node_modules.
run_source_overlay_js | ssh "${SSH_OPTS[@]}" "$VM" \
  "'$VM_NODE' - '$remote_source' '$VM_DEP_SOURCE'" \
  || fail 'could not build the VM run-source dependency overlay'
local_producer_sha="$(sha256sum "$PRODUCER" | awk '{print $1}')"
remote_producer_sha="$(ssh "${SSH_OPTS[@]}" "$VM" \
  "shasum -a 256 '$VM_PRODUCER' | awk '{print \$1}'")" \
  || fail 'could not hash the staged VM physical-drill producer'
[ "$remote_producer_sha" = "$local_producer_sha" ] \
  || fail 'staged VM physical-drill producer does not match the pinned tower snapshot'

# Identity preflight is load-only: the cached announce identity must still
# match an EXISTING keychain entry on each host. No gh lookup or key mint occurs.
"$TSX" "$PRODUCER" identity tower "$TOWER_CACHE" >"$tower_identity"
[ -s "$tower_identity" ] || fail 'tower identity command produced no JSON'
ssh "${SSH_OPTS[@]}" "$VM" \
  "PAPERCUSP_IDENTITY_DIR='$VM_IDENTITY_DIR' '$VM_NODE' '$VM_TSX' '$VM_PRODUCER' identity vm '$VM_CACHE'" >"$vm_identity"
[ -s "$vm_identity" ] || fail 'VM identity command produced no JSON'
"$TSX" "$PRODUCER" preflight "$tower_identity" "$vm_identity" >/dev/null
if [ "$source_preflight" -eq 1 ]; then
  printf '{"schemaVersion":"hive-git-physical-source-preflight/v1","ready":true,"producerSha256":"%s","sourceCommit":"%s","topology":"tower-vm-distinct-host-identities"}\n' \
    "$local_producer_sha" "$source_sha"
  exit 0
fi

# The scenario receives the preflighted identities so its topology is pinned
# before it mutates anything. It must emit fresh, UNATTESTED same-run
# observations for every leg in the evidence schema's ALL_LEGS (not a fixed
# A-H span — legs I/J were appended) at an absent path; the finalizer rejects
# pre-banked signatures.
HIVE_GIT_PHYSICAL_PLAN="$HIVE_GIT_PHYSICAL_PLAN" \
  HIVE_GIT_PHYSICAL_EXECUTE="$HIVE_GIT_PHYSICAL_PLAN" \
  HIVE_GIT_PHYSICAL_VM_SOURCE="$remote_source" \
  HIVE_GIT_PHYSICAL_TOWER_SOURCE="$tower_source" \
  "$SCENARIO" "$unsigned_evidence" "$tower_identity" "$vm_identity"
# PARTIAL-RUN-EXIT (P-002): a partial run is a diagnostic. The scenario writes no
# unsigned evidence for it, and nothing here may sign or finalize one: release
# evidence needs every phase from ONE run. Report what ran and stop before `sign`.
if [ "$physical_full_run" != 1 ]; then
  printf '{"schemaVersion":"hive-git-physical-partial/v1","phases":"%s","releaseEvidence":false}\n' \
    "$physical_phases"
  exit 0
fi
[ -s "$unsigned_evidence" ] || fail 'canonical scenario produced no unsigned evidence'

"$TSX" "$PRODUCER" sign "$unsigned_evidence" tower "$TOWER_CACHE" >"$tower_receipt"
scp "${SSH_OPTS[@]}" "$unsigned_evidence" "$VM:$remote_unsigned" >/dev/null
if ! ssh "${SSH_OPTS[@]}" "$VM" \
  "PAPERCUSP_IDENTITY_DIR='$VM_IDENTITY_DIR' '$VM_NODE' '$VM_TSX' '$VM_PRODUCER' sign '$remote_unsigned' vm '$VM_CACHE'" \
  >"$vm_receipt"; then
  ssh "${SSH_OPTS[@]}" "$VM" "rm -f '$remote_unsigned'" >/dev/null 2>&1 || true
  fail 'VM host receipt failed'
fi
ssh "${SSH_OPTS[@]}" "$VM" "rm -f '$remote_unsigned'" >/dev/null 2>&1 || true

"$TSX" "$PRODUCER" finalize \
  "$unsigned_evidence" "$tower_receipt" "$vm_receipt" "$evidence_out" "$trust_out"
