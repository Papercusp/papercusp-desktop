#!/usr/bin/env bash
# claim-target-dir.sh — pick a Rust target dir this desktop instance can own ALONE.
#
# SOURCE this, do not execute it: it exports CARGO_TARGET_DIR into the caller's
# environment and holds a lock fd that the caller's later `exec` must inherit.
#
#   . "$(dirname "$0")/lib/claim-target-dir.sh"
#   exec npm run tauri -- dev ...
#
# WHY THIS EXISTS (WI-7101)
# Cargo configuration pins a shared `build.target-dir` for the whole box
# (originally ~/.cargo-target, later relocated to the data disk). So every
# papercusp-desktop build shares ONE target dir — including the GENERATED
# app-manifest under `<target>/debug/build/papercusp-desktop-*/out/app-manifest`.
# Two concurrent builds interleave writes to it and BOTH die with:
#
#   thread 'main' panicked at build.rs:305:6:
#   failed to run tauri_build with the app-command manifest (WI-1976):
#   failed to parse JSON: expected `,` or `]` at line 14 column 9
#
# That is not a tracked file, so `git status` is clean and every checked-in
# capabilities/*.json parses fine — which is exactly why it reads as a mystery.
#
# The expensive part: `tauri dev` REBUILDS ON CHANGE, so an agent starting a
# second instance corrupts the manifest under the OWNER'S already-running
# desktop and takes it down too. On 2026-08-02 that is precisely what happened,
# and the agent was FOLLOWING the documented advice (CLAUDE.md "start the shell
# and drive it" + the stored guidance to use an isolated Xvfb instance rather
# than drive the owner's window). The recommended safe practice was the thing
# that broke the owner's desktop. Hence a fix in the wrapper, not a new warning.
#
# THE APPROACH: target-dir SLOTS, claimed by non-blocking flock.
# Slot 0 is the existing shared dir, so the ordinary single-instance case is
# unchanged and keeps its warm cache. A second instance takes slot 1, a third
# slot 2, and so on. Slots have STABLE names, which is the whole point — a
# per-pid dir would isolate just as well but pay a COLD (~10min) build every
# single launch, whereas a slot keeps its own incremental cache across runs.
#
# Why flock rather than "is another instance running?": a pgrep/pidfile test is
# check-then-act, so two launches racing at the same moment both see "nobody
# there" and both take slot 0 — reproducing the exact bug. The flock IS the
# decision, so the claim is atomic. A POSIX lock lives on the open file
# DESCRIPTION, so it survives the caller's `exec` and is released automatically
# when the process dies: no trap, no cleanup, no stale lock to reap.
#
# Escape hatches:
#   CARGO_TARGET_DIR=...                    already set ⇒ respected, no claim
#   PAPERCUSP_DESKTOP_TARGET_SLOTS=N        how many slots to offer (default 4)
#   PAPERCUSP_DESKTOP_TARGET_SLOTS=0        disable entirely (legacy behaviour)
#   PAPERCUSP_DESKTOP_NATIVE_DEV=1         reserve each candidate's native budget
#   PAPERCUSP_DESKTOP_CARGO_FALLBACK_ROOTS  ordered absolute roots, one per line;
#       native dev only, after primary candidates cannot be admitted. These are
#       build-cache placements, never backup/archive volumes. No cache is moved.

# Lock files live OUTSIDE the target dirs they guard: a `cargo clean` (or an
# agent reclaiming disk) wipes a target dir, and a lock file vanishing out from
# under a live holder would let a second instance claim a slot that is still in use.
__pc_slot_lockdir="${HOME}/.papercusp/desktop-dev-slots"

# Release cuts retain their finished artifacts and the target roots that contain
# them. Load the shared retention helper here so slot selection can skip a root
# protected by any active cut, even when this wrapper is used directly rather
# than through release-local.sh.
__pc_claim_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=release-artifacts.sh
source "$__pc_claim_dir/release-artifacts.sh"
# shellcheck source=cargo-target-root.sh
source "$__pc_claim_dir/cargo-target-root.sh"
# shellcheck source=disk-preflight.sh
source "$__pc_claim_dir/disk-preflight.sh"

# Keep the atomic receipt in the launcher's shell, never a command substitution
# whose owning process exits before the build starts.
__pc_admit_target() {
  [[ "${__pc_native_admission:-0}" == 1 ]] || return 0
  local need inherited="${__pc_native_inherited:-}" receipt expires now
  need="$(papercusp_native_dev_cargo_need_gb "$1")" || return $?
  if [[ -n "$inherited" ]]; then
    papercusp_require_free_gb "$1" "$need" "native dev Cargo build" "$inherited" >&2 || return $?
    receipt="${PAPERCUSP_DISK_RESERVATION_FILE:-}"
    if [[ "$receipt" == "$inherited" ]]; then
      # Handoff spends the preparation owner's existing time window; it does
      # not request a brand-new six-hour window after preparation has elapsed.
      # require_free_gb verified the device, purpose, live owner and ancestry;
      # require_disk_reservation below still verifies the complete receipt.
      expires="$(sed -n 's/^expires=//p' "$receipt")"
      now="$(date +%s)"
      if [[ "$expires" =~ ^[0-9]+$ ]] && ((expires > now)); then
        local PAPERCUSP_DISK_RESERVATION_TTL_SEC="$((expires - now))"
      fi
    else
      inherited="$receipt"
    fi
  fi
  papercusp_require_disk_reservation "$1" "$need" "native dev Cargo build" \
    "$inherited" >&2 || return $?
  export PAPERCUSP_DISK_RESERVATION_FILE
}

# Slot locks retain their legacy names, while this second lock serializes the
# actual canonical target across primary/fallback configurations and aliases.
# fd 7 is inherited across exec like slot fd 8 (sidecar locking uses fd 9).
__pc_lock_target_root() {
  local root key claim_fd lockdir="${HOME}/.papercusp/desktop-dev-slots/target-roots"
  root="$(realpath -m -- "$1")" || return 1
  key="$(node -e 'process.stdout.write(require("node:crypto").createHash("sha256").update(process.argv[1]).digest("hex"))' "$root")" || return 1
  mkdir -p -- "$lockdir" || return 1
  exec {claim_fd}>>"$lockdir/$key.lock" || return 1
  if ! flock -n "$claim_fd"; then
    exec {claim_fd}>&-
    return 1
  fi
  if [[ -n "${2:-}" ]]; then
    # Reaping may run while fd 7 protects the caller's selected target. Use a
    # separate temporary descriptor, without releasing the launcher's claim.
    printf -v "$2" '%s' "$claim_fd"
  else
    exec 7>&"$claim_fd"
    exec {claim_fd}>&-
  fi
}

__pc_target_retention_allows() {
  local tags status=0
  tags="$(release_artifacts_retention_path_is_leased "$1" 2>/dev/null)" || status=$?
  case "$status" in
    1) return 0 ;;
    0) release_artifacts_retention_matches_are_own_cut "$tags" && return 0 ;;
  esac
  echo "→ target root $1 SKIPPED: foreign or unreadable release-retention lease (${tags//$'\n'/,}; status $status)" >&2
  return 1
}

# Is a live process EXECUTING out of this target dir?
#
# The flock below proves only that a LAUNCHER is alive. It is held by the launcher
# process (`npm run tauri dev`, or the tauri CLI on the `npm run tauri -- dev` path)
# and is NOT inherited by the desktop binary that CLI spawns. Measured 2026-08-09 on a
# desktop running 57min past its build: `fuser` reported ONLY npm (pid 599420) holding
# slot0.lock, while the app (pid 599886) held no fd on it at all. So a desktop whose
# launcher was reaped — routine here, where a service-cgroup restart takes out
# agent-owned children (EI-9748) — keeps running out of its target dir holding NO lock,
# and the next launcher correctly sees a free slot and builds into a dir a live desktop
# depends on. That is the gap this closes.
#
# Read the kernel's executable links, never argv. The check this replaces could,
# and did, get fooled: `pgrep -af '[t]auri dev'`
# matched the wrapper's OWN ANCESTOR on every `npm run tauri -- dev` launch, because npm
# rewrites its process title to `npm run tauri dev …` — and it also matched any peer
# agent's shell that had merely typed the string. Bracketing `[t]auri` guards the pgrep's
# own argv only, never an ancestor's. That false positive is why this file used to print
# "a desktop build is already running but holds NO slot lock" on launches where nothing
# else was running at all, and it is the reason a warning was never enough here (WI-37452).
#
# Linux uses one in-process /proc scan, reading only exe links. `fuser -s` also
# walks unrelated processes' file descriptors and stalled a verifier for minutes
# BEFORE Cargo started (EI-22467167909855383). Spawning readlink once per PID is
# expensive too; Node is already required by this npm launcher. A renamed or
# deleted executable under the target root still protects that root.
# KNOWN BLIND SPOT:
#   - A build started OUTSIDE this wrapper (a bare `cargo tauri dev`) has no app running
#     yet, so nothing here can see it. That path is unprotected by construction.
__pc_desktop_running_in() {
  local dir="$1"
  if [[ -d /proc/self ]]; then
    local status=0
    # An unavailable probe must never be interpreted as an unused target root.
    node - "$dir" <<'JS' || status=$?
const fs = require('node:fs');
const path = require('node:path');
let root = path.resolve(process.argv[2]);
try { root = fs.realpathSync(root); } catch (error) {
  if (error.code !== 'ENOENT') process.exit(2);
}
let pids;
try { pids = fs.readdirSync('/proc'); } catch { process.exit(2); }
let unknown = false;
for (const pid of pids) {
  if (!/^\d+$/.test(pid)) continue;
  try {
    const exe = fs.readlinkSync(`/proc/${pid}/exe`).replace(/ \(deleted\)$/, '');
    if (exe.startsWith(root + path.sep)) process.exit(0);
  } catch (error) {
    // Match fuser's visibility: exited/kernel tasks have no executable link;
    // nondumpable tasks (including the same user's keyring) deny ptrace reads.
    // Those denials say nothing about this target root. The launcher flock is
    // still authoritative, and ordinary orphaned desktop executables remain
    // readable. Unexpected probe failures retain the safety fence.
    if (['ENOENT', 'ESRCH', 'EACCES', 'EPERM'].includes(error.code)) continue;
    unknown = true;
  }
}
process.exit(unknown ? 2 : 1);
JS
    if [[ "$status" == 1 ]]; then return 1; fi
    if [[ "$status" != 0 ]]; then
      echo "→ executable identity probe unavailable for $dir — treating the slot as occupied" >&2
    fi
    return 0
  fi
  command -v fuser >/dev/null 2>&1 || return 1
  fuser -s "${dir}/debug/papercusp-desktop" 2>/dev/null
}

# Restore a missing relocation referent without replacing its symlink.
#
__pc_restore_missing_symlink_referent() {
  local root="${1:?symlink root required}"
  local label="${2:-target}"
  local raw_target target parent

  [[ -L "$root" && ! -e "$root" ]] || return 0
  raw_target="$(readlink "$root")" || {
    echo "ERROR: cannot read $label symlink: $root" >&2
    return 1
  }
  [[ -n "$raw_target" ]] || {
    echo "ERROR: $label symlink has an empty referent: $root" >&2
    return 1
  }
  case "$raw_target" in
    /*) target="$raw_target" ;;
    *) target="$(dirname "$root")/$raw_target" ;;
  esac
  parent="$(dirname "$target")"
  [[ -d "$parent" ]] || {
    echo "ERROR: $label symlink $root points below missing parent $parent — refusing to manufacture the relocation hierarchy" >&2
    return 1
  }
  if ! mkdir -- "$target" 2>/dev/null && [[ ! -d "$target" ]]; then
    echo "ERROR: cannot recreate missing $label referent $target for $root" >&2
    return 1
  fi
  echo "→ restored missing $label referent $target (preserved symlink $root)" >&2
}

# Materialize a derived target root before handing it to Cargo.  The configured
# shared root can live below a parent that the desktop user may traverse but
# cannot modify (the production /mnt/data/cargo-target placement is exactly
# that shape).  In that case Cargo cannot create a sibling such as
# /mnt/data/cargo-target-dev2: its own temporary mkdir fails with EACCES before
# compilation begins.  Keep the preferred sibling when its parent permits it;
# otherwise place the stable slot inside the already-writable shared root.  The
# fallback remains on the configured filesystem and outside Cargo's ordinary
# debug/release namespace.
__pc_prepare_derived_target_root() {
  local preferred="${1:?preferred target root required}"
  local shared="${2:?shared target root required}"
  local slot_name="${3:?slot name required}"
  local fallback_parent fallback

  if [[ -d "$preferred" && -w "$preferred" && -x "$preferred" ]]; then
    printf '%s\n' "$preferred"
    return 0
  fi
  if [[ ! -e "$preferred" && ! -L "$preferred" ]] \
    && mkdir -- "$preferred" 2>/dev/null; then
    printf '%s\n' "$preferred"
    return 0
  fi

  fallback_parent="$shared/.papercusp-target-slots"
  fallback="$fallback_parent/$slot_name"
  if [[ ! -d "$shared" || ! -w "$shared" || ! -x "$shared" ]]; then
    echo "ERROR: cannot prepare target slot $preferred and shared root is not writable: $shared" >&2
    return 1
  fi
  if ! mkdir -p -- "$fallback_parent" 2>/dev/null; then
    echo "ERROR: cannot prepare target-slot fallback parent: $fallback_parent" >&2
    return 1
  fi
  if [[ -e "$fallback" && ! -d "$fallback" ]]; then
    echo "ERROR: target-slot fallback exists but is not a directory: $fallback" >&2
    return 1
  fi
  if [[ ! -e "$fallback" ]] && ! mkdir -- "$fallback" 2>/dev/null; then
    echo "ERROR: cannot prepare target-slot fallback: $fallback" >&2
    return 1
  fi
  if [[ ! -w "$fallback" || ! -x "$fallback" ]]; then
    echo "ERROR: target-slot fallback is not writable: $fallback" >&2
    return 1
  fi

  echo "→ target slot $preferred cannot be materialized; using writable same-filesystem fallback $fallback" >&2
  printf '%s\n' "$fallback"
}

# Prepare a source-tree collection target without replacing relocation links.
# The completed package already lives in an isolated Cargo root and must be
# copied into the canonical source-tree target. Recreate only the missing
# referent directory when its immediate parent already exists; never replace
# the symlink, manufacture a missing parent hierarchy, or route around a
# non-directory occupant.
papercusp_prepare_collection_target_root() {
  local root="${1:?collection target root required}"

  __pc_restore_missing_symlink_referent "$root" "collection target" || return 1

  if [[ -e "$root" && ! -d "$root" ]]; then
    echo "ERROR: collection target root exists but is not a directory: $root" >&2
    return 1
  fi
  [[ ! -L "$root" || -d "$root" ]] || {
    echo "ERROR: collection target symlink remains unusable after recovery: $root" >&2
    return 1
  }
}

# Ask Cargo for its effective placement, including project configuration,
# CARGO_HOME and CARGO_BUILD_TARGET_DIR. Parsing one TOML file or retaining the
# historical HOME/.cargo-target name silently overrides a configured relocation
# (EI-22589688521091797). Query the actual target project, not the current
# orchestrator's checkout, when executing an exact-source release retry.
__pc_cargo_target_root() {
  local project="${PAPERCUSP_DESKTOP_TARGET_ROOT:-${ROOT:-$PWD}}"
  if [[ -f "$project/src-tauri/Cargo.toml" ]]; then
    project="$project/src-tauri"
  elif [[ ! -f "$project/Cargo.toml" ]]; then
    project="$__pc_claim_dir/../../src-tauri"
  fi
  # The shared resolver (bin/lib/cargo-target-root.sh) is the single reader.
  papercusp_cargo_metadata_target_dir "$project"
}

# PRIVATE OVERFLOW SLOTS — reaping and warm reuse (WI-10004764)
#
# When every named slot is busy the claim falls back to a private per-pid root
# (`<shared>-pid<N>`, or `<shared>/.papercusp-target-slots/pid<N>` below a
# non-writable parent). Nothing ever removed one. Each is a COLD Cargo root of
# 27-65 GiB, and on this box overflow is routine: on 2026-10-01 the data disk held
# 131 of them, 774 GiB, and was at 99%. A finished private root is only garbage —
# so reap it, and let the next overflow launch ADOPT the newest dead one as a warm
# cache instead of paying another cold build and another 60 GiB of writes.
#
# A private root is reapable only when ALL hold:
#   - no live claimant: its lock (`<lockdir>/pid<N>.lock`, taken by every new
#     private claim and inherited across `exec` like the named-slot locks) is
#     free; a LEGACY root with no lock file needs its claiming pid to be gone,
#     and a live — possibly recycled — pid keeps it (fails toward keeping);
#   - nothing references it: no process executes from it, runs inside it, or has
#     CARGO_TARGET_DIR pointing into it (one /proc pass; an unreadable /proc
#     keeps everything);
#   - it is idle past PAPERCUSP_DESKTOP_PRIVATE_SLOT_GRACE_SEC (default 1800);
#   - no release-retention lease covers it (a finished cut's artifacts live in
#     exactly these roots; the lease expiring is what releases them).
# Reaping renames the root aside under a lock (atomic, same filesystem), then
# deletes through release_artifacts_guarded_delete, which re-checks leases and
# writes the deletion audit. Deletion runs in the background at idle I/O
# priority so a launch never waits on it; an interrupted deletion leaves a
# `.reaping-*` dir that the next reaper finishes.
#
#   PAPERCUSP_DESKTOP_PRIVATE_SLOT_REAP=0      never reap or adopt
#   PAPERCUSP_DESKTOP_PRIVATE_SLOT_GRACE_SEC   idle time before a dead root is touched
#   PAPERCUSP_DESKTOP_PRIVATE_SLOT_REAP_SYNC=1 delete in the foreground (tests, reap-only runs)

# Print "<dir>\t<slot-name>" for every private root under a shared root.
__pc_private_slot_candidates() {
  local shared="${1:?shared target root required}" dir name sibling_prefix
  sibling_prefix="${shared##*/}-"
  for dir in "${shared}"-pid* "${shared}/.papercusp-target-slots"/pid*; do
    [[ -d "$dir" && ! -L "$dir" ]] || continue
    name="${dir##*/}"
    name="${name#"$sibling_prefix"}"
    [[ "$name" =~ ^pid[0-9]+(-[0-9]+)?$ ]] || continue
    printf '%s\t%s\n' "$dir" "$name"
  done
}

# 0 when no claimant is alive for this private root.
__pc_private_slot_unclaimed() {
  local name="$1" lock pid
  lock="${__pc_slot_lockdir}/${name}.lock"
  if [[ -e "$lock" ]]; then
    # Held by any live process that inherited the claim's descriptor.
    ( exec 6>>"$lock" && flock -n 6 ) 2>/dev/null || return 1
    return 0
  fi
  pid="${name#pid}"
  pid="${pid%%-*}"
  # Legacy root: its claiming pid is the only liveness signal. A pid owned by
  # another user answers EPERM to kill -0 but still exists in /proc.
  if kill -0 "$pid" 2>/dev/null || [[ -e "/proc/$pid" ]]; then
    return 1
  fi
  return 0
}

# Newest mtime (epoch seconds) of a root and the Cargo profile dirs inside it.
__pc_private_slot_last_active() {
  local dir="$1" newest=0 p t
  for p in "$dir" "$dir/debug" "$dir/release" "$dir/release/bundle"; do
    [[ -e "$p" ]] || continue
    t="$(stat -c %Y -- "$p" 2>/dev/null)" || continue
    (( t > newest )) && newest="$t"
  done
  printf '%s\n' "$newest"
}

# Read candidate roots on stdin; print those a live process references.
# Prints every candidate when /proc cannot be read reliably (fails closed).
__pc_private_slots_referenced() {
  if [[ ! -d /proc/self ]]; then cat; return 0; fi
  local status=0
  node -e '
const fs = require("node:fs");
const path = require("node:path");
const roots = fs.readFileSync(0, "utf8").split("\n").filter(Boolean);
const real = roots.map((r) => { try { return fs.realpathSync(r); } catch { return path.resolve(r); } });
const hits = new Set();
const inside = (p, i) => p === real[i] || p.startsWith(real[i] + path.sep)
  || p === roots[i] || p.startsWith(roots[i] + path.sep);
const mark = (p) => { for (let i = 0; i < roots.length; i++) if (inside(p, i)) hits.add(roots[i]); };
let pids;
try { pids = fs.readdirSync("/proc"); } catch { process.exit(2); }
let unknown = false;
const tolerated = ["ENOENT", "ESRCH", "EACCES", "EPERM"];
for (const pid of pids) {
  if (!/^\d+$/.test(pid)) continue;
  for (const link of ["exe", "cwd"]) {
    try { mark(fs.readlinkSync(`/proc/${pid}/${link}`).replace(/ \(deleted\)$/, "")); }
    catch (e) { if (!tolerated.includes(e.code)) unknown = true; }
  }
  try {
    for (const kv of fs.readFileSync(`/proc/${pid}/environ`, "latin1").split("\0")) {
      if (kv.startsWith("CARGO_TARGET_DIR=")) mark(path.resolve(kv.slice(17) || "/nonexistent"));
    }
  } catch (e) { if (!tolerated.includes(e.code)) unknown = true; }
}
if (unknown) process.exit(2);
for (const r of hits) process.stdout.write(r + "\n");
' || status=$?
  if [[ "$status" != 0 ]]; then
    echo "→ private target-slot reference probe unavailable — keeping every private root" >&2
    return 2
  fi
}

# 0 when every Cargo build-script output in this root was generated AT this path.
#
# A Cargo root is NOT relocatable. Cargo keeps a finished build script's output
# when the root moves, because its fingerprint does not change. Build scripts write
# absolute paths into their OUT_DIR files, and Cargo cannot rewrite those: tauri's
# `out/tauri-core-*-permission-files` lists every permission .toml by absolute path,
# and tauri_build reads the list to build the app manifest. A moved root therefore
# breaks the next `tauri dev` with "failed to read plugin permissions … No such file"
# (WI-10004841). `root-output` records the OUT_DIR each script ran against, so a
# root-output outside this root marks a root that was moved. It may only be reaped.
__pc_private_slot_paths_anchored() {
  local dir="$1" real f stray
  local -a outs=()
  for f in "$dir"/debug/build/*/root-output "$dir"/release/build/*/root-output \
           "$dir"/*/debug/build/*/root-output "$dir"/*/release/build/*/root-output; do
    [[ -f "$f" ]] && outs+=("$f")
  done
  ((${#outs[@]} > 0)) || return 0
  real="$(realpath -- "$dir" 2>/dev/null)" || real="$dir"
  stray="$(printf '%s\0' "${outs[@]}" | xargs -0 grep -L -F -e "$dir/" -e "$real/" -- 2>/dev/null)"
  [[ -z "$stray" ]]
}

# Delete roots already renamed aside (`.reaping-*`), through the audited guard.
__pc_private_slot_delete_renamed() {
  local shared="$1" dir
  local -a doomed=()
  for dir in "${shared%/*}/.${shared##*/}-reaping-"* "${shared}/.papercusp-target-slots"/.reaping-*; do
    [[ -d "$dir" && ! -L "$dir" ]] && doomed+=("$dir")
  done
  ((${#doomed[@]} > 0)) || return 0
  if [[ "${PAPERCUSP_DESKTOP_PRIVATE_SLOT_REAP_SYNC:-0}" == "1" ]]; then
    PAPERCUSP_RELEASE_DELETER=claim-target-dir.sh release_artifacts_guarded_delete "${doomed[@]}" || true
    return 0
  fi
  (
    # Drop every inherited descriptor first. The launcher's slot lock (fd 8) and
    # any caller lock (fd 9, cargo-build-safe) would otherwise stay held for as
    # long as this deletion runs, and the slot would look busy after its build
    # had ended.
    local fd
    for fd in /proc/"$BASHPID"/fd/*; do
      fd="${fd##*/}"
      [[ "$fd" =~ ^[0-9]+$ ]] && ((fd > 2)) && eval "exec ${fd}>&-" 2>/dev/null || true
    done
    command -v ionice >/dev/null 2>&1 && { ionice -c3 -p "$BASHPID" 2>/dev/null || true; }
    renice -n 19 -p "$BASHPID" >/dev/null 2>&1 || true
    PAPERCUSP_RELEASE_DELETER=claim-target-dir.sh release_artifacts_guarded_delete "${doomed[@]}" || true
  ) </dev/null >/dev/null 2>&1 &
}

# __pc_reap_private_target_slots <shared> [adopt-name]
# Reap dead private roots. With adopt-name (the caller's own per-pid slot name),
# ADOPT the newest reapable root IN PLACE instead of deleting it: take that root's
# own lock, keep its path, and set __pc_adopted_private_root to it and
# __pc_adopted_private_lock_fd to the open, flocked descriptor (the caller moves
# its claim onto it). Never rename a root to adopt it: a moved Cargo root strands
# the absolute paths its build scripts wrote (WI-10004841), so a root that an
# older reaper already moved is reaped, never adopted.
# Count the same private population, including interrupted/background deletions.
# A failed bounded measurement refuses this pass rather than reporting zero.
__pc_private_slot_bytes() {
  local shared="$1" dir name usage bytes total=0
  local -a roots=()
  while IFS=$'\t' read -r dir name; do roots+=("$dir"); done < <(__pc_private_slot_candidates "$shared")
  for dir in "${shared%/*}/.${shared##*/}-reaping-"* "${shared}/.papercusp-target-slots"/.reaping-*; do
    [[ -d "$dir" && ! -L "$dir" ]] && roots+=("$dir")
  done
  if ((${#roots[@]} == 0)); then printf '0\n'; return 0; fi
  # One deadline covers the whole population, including a large backlog.
  usage="$(timeout --signal=KILL 10s du -sx -B1 -- "${roots[@]}" 2>/dev/null)" || return 2
  while read -r bytes dir; do
    [[ "$bytes" =~ ^[0-9]+$ ]] || return 2
    total=$((total + bytes))
  done <<< "$usage"
  printf '%s\n' "$total"
}

__pc_reap_private_target_slots() {
  local shared="${1:?shared target root required}" adopt_name="${2:-}"
  __pc_adopted_private_root=""
  __pc_adopted_private_lock_fd=""
  [[ "${PAPERCUSP_DESKTOP_PRIVATE_SLOT_REAP:-1}" != "0" ]] || return 0
  command -v flock >/dev/null 2>&1 || return 0
  # Empty arrays under `set -u` and {fd} allocation need bash >= 4.4.
  (( BASH_VERSINFO[0] > 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4) )) || return 0
  local grace="${PAPERCUSP_DESKTOP_PRIVATE_SLOT_GRACE_SEC:-1800}"
  [[ "$grace" =~ ^[0-9]+$ ]] || grace=1800

  local reap_fd mutex_input='' mutex_pid='' candidate has_candidates=0
  # Protect the original path through its rename: checking only the renamed
  # deletion path loses a pin committed against the original Cargo root.
  # Empty launches have no original path to mutate and must not queue behind
  # unrelated retention work. Renamed debris has its own guarded-delete lock.
  while IFS= read -r candidate; do has_candidates=1; break; done < <(__pc_private_slot_candidates "$shared")
  if ((has_candidates)); then
    release_artifacts_retention_mutex_acquire mutex_input mutex_pid || return $?
  fi
  if ! exec {reap_fd}>>"${__pc_slot_lockdir}/private-slots.lock"; then
    release_artifacts_retention_mutex_release "$mutex_input" "$mutex_pid"
    return 2
  fi
  if ! flock -w 30 "$reap_fd"; then
    exec {reap_fd}>&-
    release_artifacts_retention_mutex_release "$mutex_input" "$mutex_pid"
    return 0
  fi

  local now dir name last lease_status reap_lease_tags before_bytes after_bytes max_bytes
  local -a eligible=()
  local -a leased_paths=() retained_paths=()
  max_bytes="${PAPERCUSP_DESKTOP_PRIVATE_SLOT_MAX_BYTES:-21474836480}"
  if [[ ! "$max_bytes" =~ ^[0-9]{1,15}$ ]]; then
    echo 'private target-slot cap requires positive safe-integer bytes' >&2
    exec {reap_fd}>&-
    release_artifacts_retention_mutex_release "$mutex_input" "$mutex_pid"
    return 2
  fi
  max_bytes=$((10#$max_bytes))
  if ((max_bytes <= 0)); then
    exec {reap_fd}>&-
    release_artifacts_retention_mutex_release "$mutex_input" "$mutex_pid"
    return 2
  fi
  if ! before_bytes="$(__pc_private_slot_bytes "$shared")"; then
    echo 'private target-slot cap measurement failed; keeping all roots' >&2
    exec {reap_fd}>&-
    release_artifacts_retention_mutex_release "$mutex_input" "$mutex_pid"
    return 2
  fi
  now="$(date +%s)"
  while IFS=$'\t' read -r dir name; do
    [[ -n "$dir" ]] || continue
    # 0 = leased, 2 = unreadable retention marker: both keep the root. ANY lease
    # keeps a private root (a reaper is no cut, so no own-cut exemption applies);
    # the tags are captured, not discarded to /dev/null, which the release-artifacts
    # selftest forbids for every caller in this file.
    lease_status=0
    reap_lease_tags="$(release_artifacts_retention_path_is_leased "$dir" 2>/dev/null)" || lease_status=$?
    if (( lease_status != 1 )); then leased_paths+=("$dir"); continue; fi
    __pc_private_slot_unclaimed "$name" || continue
    last="$(__pc_private_slot_last_active "$dir")"
    (( now - last >= grace )) || continue
    eligible+=("$last"$'\t'"$dir"$'\t'"$name")
  done < <(__pc_private_slot_candidates "$shared")

  local refs="" sorted="" adopt_row="" row
  if ((${#eligible[@]} > 0)); then
    if refs="$(printf '%s\n' "${eligible[@]}" | cut -f2 | __pc_private_slots_referenced)"; then
      # Evict oldest first. Only adoption prefers the warmest eligible cache;
      # the remaining deletions still run in ascending last-write order.
      sorted="$(printf '%s\n' "${eligible[@]}" | sort -n)"
      if [[ -n "$adopt_name" ]]; then
        while IFS=$'\t' read -r last dir name; do
          if ! grep -qxF -- "$dir" <<< "$refs" && __pc_private_slot_paths_anchored "$dir"; then
            adopt_row="$last"$'\t'"$dir"$'\t'"$name"
            break
          fi
        done < <(printf '%s\n' "${eligible[@]}" | sort -rn)
        if [[ -n "$adopt_row" ]]; then
          sorted="$adopt_row
$(while IFS= read -r row; do [[ "$row" == "$adopt_row" ]] || printf '%s\n' "$row"; done <<< "$sorted")"
        fi
      fi
    fi
  fi

  local stamp target adopted=0 adopt_fd root_guard_fd
  while IFS=$'\t' read -r last dir name; do
    [[ -n "$dir" ]] || continue
    if grep -qxF -- "$dir" <<< "$refs"; then continue; fi
    # A different primary/fallback configuration can hold the same physical
    # root under another slot namespace. Hold its canonical lock throughout
    # adoption/rename, then re-check claimant and retention state under it.
    root_guard_fd=""
    __pc_lock_target_root "$dir" root_guard_fd || continue
    lease_status=0
    reap_lease_tags="$(release_artifacts_retention_path_is_leased "$dir" 2>/dev/null)" || lease_status=$?
    if ((lease_status != 1)) || ! __pc_private_slot_unclaimed "$name"; then
      exec {root_guard_fd}>&-
      continue
    fi
    if [[ "${PAPERCUSP_DESKTOP_PRIVATE_SLOT_REAP_DRY_RUN:-0}" == "1" ]]; then
      echo "would reap: $dir (idle since $(date -u -d "@$last" +%FT%TZ 2>/dev/null || echo "$last"))"
      exec {root_guard_fd}>&-
      continue
    fi
    if [[ -n "$adopt_name" && "$adopted" == 0 ]]; then
      if ! __pc_private_slot_paths_anchored "$dir"; then
        echo "→ dead private target slot $dir was relocated (its build-script outputs point elsewhere) — reaping it instead of adopting (WI-10004841)" >&2
      else
        # A legacy root has no lock file yet; opening one for append creates it.
        adopt_fd=""
        if exec {adopt_fd}>>"${__pc_slot_lockdir}/${name}.lock" && flock -n "$adopt_fd"; then
          touch -- "$dir" || true
          PAPERCUSP_RELEASE_DELETER=claim-target-dir.sh release_artifacts_deletion_audit adopt "$dir" "" \
            "dead private target slot reused in place as a warm cache by $adopt_name" 2>/dev/null || true
          __pc_adopted_private_root="$dir"
          __pc_adopted_private_lock_fd="$adopt_fd"
          adopted=1
          exec {root_guard_fd}>&-
          continue
        fi
        # Its lock was taken since the eligibility check: it has a claimant now,
        # so neither adopt nor reap it.
        if [[ -n "$adopt_fd" ]]; then exec {adopt_fd}>&-; fi
        exec {root_guard_fd}>&-
        continue
      fi
    fi
    stamp="$(date +%s%N)"
    if [[ "${dir##*/}" == "$name" ]]; then
      target="${dir%/*}/.reaping-${name}-${stamp}"
    else
      target="${dir%/*}/.${shared##*/}-reaping-${name}-${stamp}"
    fi
    if mv -T -- "$dir" "$target" 2>/dev/null; then
      rm -f -- "${__pc_slot_lockdir}/${name}.lock"
      PAPERCUSP_RELEASE_DELETER=claim-target-dir.sh release_artifacts_deletion_audit reap "$dir" "" \
        "dead private target slot (no claimant, unreferenced, idle >= ${grace}s); renamed to $target for deletion" 2>/dev/null || true
      echo "→ reaped dead private target slot $dir" >&2
    fi
    exec {root_guard_fd}>&-
  done <<< "$sorted"

  flock -u "$reap_fd" || true
  exec {reap_fd}>&-
  release_artifacts_retention_mutex_release "$mutex_input" "$mutex_pid"
  __pc_private_slot_delete_renamed "$shared"
  if ! after_bytes="$(__pc_private_slot_bytes "$shared")"; then
    echo 'private target-slot cap post-measurement failed' >&2
    return 2
  fi
  while IFS=$'\t' read -r dir name; do retained_paths+=("$dir"); done < <(__pc_private_slot_candidates "$shared")
  node -e 'const [root, max, before, after, dry, leased, ...retainedPaths] = process.argv.slice(1);
    const pinnedPaths = leased ? leased.split("\n") : [];
    process.stderr.write("private-slot-cap " + JSON.stringify({root, maxBytes: Number(max),
      beforeBytes: Number(before), afterBytes: Number(after), dryRun: dry === "1",
      overByBytes: Math.max(0, Number(after) - Number(max)), pinnedPaths,
      retainedPaths}) + "\n");' "$shared/.papercusp-target-slots" "$max_bytes" "$before_bytes" "$after_bytes" \
    "${PAPERCUSP_DESKTOP_PRIVATE_SLOT_REAP_DRY_RUN:-0}" "$(printf '%s\n' "${leased_paths[@]}")" "${retained_paths[@]}"
  return 0
}

# True when the root slot <index> WOULD build into already holds a debug Cargo
# cache: the criterion papercusp_native_dev_cargo_need_gb uses to price a build.
# Mirrors __pc_prepare_derived_target_root: a usable preferred sibling wins; an
# absent one is created (cold) when its parent allows; otherwise the
# same-filesystem fallback is used.
__pc_target_slot_is_warm() {
  local shared="${1:?shared target root required}" index="${2:?slot index required}"
  local preferred
  if ((index == 0)); then
    [[ -d "$shared/debug/deps" ]]
    return
  fi
  preferred="${shared}-dev$((index + 1))"
  if [[ -d "$preferred" && -w "$preferred" && -x "$preferred" ]]; then
    [[ -d "$preferred/debug/deps" ]]
    return
  fi
  if [[ ! -e "$preferred" && ! -L "$preferred" && -w "$(dirname -- "$preferred")" ]]; then
    return 1
  fi
  [[ -d "$shared/.papercusp-target-slots/dev$((index + 1))/debug/deps" ]]
}

__pc_claim_target_root() {
  # An explicit CARGO_TARGET_DIR is a deliberate choice (a .deb cut on an
  # isolated dir, a test harness) — never second-guess it.
  if [[ -n "${CARGO_TARGET_DIR:-}" ]]; then
    echo "→ target dir: honouring preset CARGO_TARGET_DIR=$CARGO_TARGET_DIR (no slot claimed)" >&2
    __pc_admit_target "$CARGO_TARGET_DIR"
    return $?
  fi

  local slots="${PAPERCUSP_DESKTOP_TARGET_SLOTS:-4}"
  if [[ "$slots" == "0" ]]; then
    echo "⚠ target-dir slots DISABLED (PAPERCUSP_DESKTOP_TARGET_SLOTS=0) — a second concurrent desktop build will corrupt the shared app-manifest (WI-7101)" >&2
    if [[ "${__pc_native_admission:-0}" == 1 ]]; then
      local disabled_target
      disabled_target="$(__pc_cargo_target_root)" || return $?
      __pc_admit_target "$disabled_target" || return $?
    fi
    return 0
  fi

  # No flock(1) (macOS ships none) — we cannot claim atomically, so do not
  # pretend to. Leave the shared dir in place and say so, rather than handing
  # back a slot whose exclusivity we cannot actually guarantee.
  if ! command -v flock >/dev/null 2>&1; then
    echo "⚠ flock(1) unavailable — cannot claim a target-dir slot; concurrent desktop builds may corrupt the shared app-manifest (WI-7101)" >&2
    if [[ "${__pc_native_admission:-0}" == 1 ]]; then
      local unlocked_target
      unlocked_target="$(__pc_cargo_target_root)" || return $?
      __pc_admit_target "$unlocked_target" || return $?
    fi
    return 0
  fi

  local shared
  shared="${1:-}"
  [[ -n "$shared" ]] || shared="$(__pc_cargo_target_root)" || return 1
  # Cargo metadata tells us the authoritative root, but does not promise that
  # it already exists.  Materialize that explicit configured path before slot
  # selection so a writable relocation parent remains usable and every derived
  # fallback has a real shared root to live below.  Preserve symlinks for the
  # guarded recovery path in the loop below.
  if [[ ! -e "$shared" && ! -L "$shared" ]]; then
    if ! mkdir -p -- "$shared" 2>/dev/null; then
      echo "ERROR: cannot materialize configured Cargo target root: $shared" >&2
      return 1
    fi
  elif [[ -e "$shared" && ! -d "$shared" ]]; then
    echo "ERROR: configured Cargo target root exists but is not a directory: $shared" >&2
    return 1
  fi
  mkdir -p "$__pc_slot_lockdir"

  local i j dir lockfile preferred_dir lease_tags
  local slot_count=0 own_slot_index_set=','
  local -a slot_order

  # A resumed cut's own lease identifies where its reusable artifacts live.
  # Prioritize those roots before ordinary free slots, or the first-free scan
  # can send a reuse leg to an empty cache even though its artifacts are leased
  # under a later slot (WI-10003548).
  for ((i = 0; i < slots; i++)); do
    if ((i == 0)); then dir="$shared"; else dir="${shared}-dev$((i + 1))"; fi
    if lease_tags="$(release_artifacts_retention_path_is_leased "$dir" 2>/dev/null)" \
      && release_artifacts_retention_matches_are_own_cut "$lease_tags"; then
      slot_order[$slot_count]="$i"
      slot_count=$((slot_count + 1))
      own_slot_index_set+="$i,"
    fi
  done
  # Among ordinary slots, scan WARM roots (an existing debug/deps cache) before
  # COLD ones, index order within each class. First-free used to hand a launch
  # an empty slot while a warm one sat free, and the native-dev admission then
  # demanded the cold budget (65 GiB vs 12 GiB in cargo-target-root.sh): on a
  # nearly-full data disk every verifier was refused (WI-6554700010011501).
  local pass warm
  for pass in warm cold; do
    for ((i = 0; i < slots; i++)); do
      case "$own_slot_index_set" in
        *,"$i",*) continue ;;
      esac
      warm=cold
      __pc_target_slot_is_warm "$shared" "$i" && warm=warm
      [[ "$warm" == "$pass" ]] || continue
      slot_order[$slot_count]="$i"
      slot_count=$((slot_count + 1))
    done
  done

  for ((j = 0; j < slot_count; j++)); do
    i="${slot_order[$j]}"
    # Slot 0 IS Cargo's configured shared dir. Keep its existing warm cache,
    # and derive every extra slot on the same configured filesystem.
    if ((i == 0)); then dir="$shared"; else dir="${shared}-dev$((i + 1))"; fi
    preferred_dir="$dir"
    lockfile="${__pc_slot_lockdir}/slot${i}.lock"

    # fd 8 deliberately: bin/cargo-build-safe.sh uses fd 9 for the sidecar lock,
    # and a launch path can end up holding both.
    exec 8>>"$lockfile" || continue
    if flock -n 8; then
      # A completed cut can outlive its launcher. Never reuse a target root that
      # ANOTHER cut's active retention lease covers; a later cleanup/build must not
      # erase the finalized artifact or its isolated Cargo cache.
      #
      # But a cut must never be refused its OWN lease. Leg 1 (linux) finishes and
      # takes a cut-scoped lease over this slot; leg 2 (mac) then carries the SAME
      # tag, so skipping on any match at all drove it to a private per-pid slot
      # where PAPERCUSP_REUSE_LINUX found no leg-1 artifacts and the leg died after
      # ~35min of redone work. The lease pre-registers the mac and windows paths, so
      # it was authored expecting those legs to run inside it (EI-23946118243608426).
      # Keep the tags the predicate reports instead of discarding them, and defer to
      # the shared own-cut rule, which fails closed on an unset/foreign/invalid tag.
      if ! __pc_target_retention_allows "$dir"; then
        exec 8>&-
        continue
      fi
      # A slot name can outlive the storage it points at. This host deliberately
      # relocates the warm Cargo caches with symlinks; after the backing root was
      # removed, slot 1 remained a dangling ~/.cargo-target-dev2 symlink. `flock`
      # quite correctly claimed the OUT-OF-TREE lock, but Cargo then failed before
      # compilation with ENOTDIR while trying to create the target directory.
      # Restore only a missing referent whose immediate parent already exists:
      # this preserves the relocation link and makes the stable warm slot usable
      # again without deleting or replacing host state. If the parent is missing,
      # or the referent cannot be recreated, preserve the link and fail closed.
      if [[ -L "$dir" && ! -e "$dir" ]]; then
        if ! __pc_restore_missing_symlink_referent "$dir" "target slot"; then
          echo "→ slot $i SKIPPED: target root $dir is a broken symlink — preserving it and isolating the build" >&2
          exec 8>&-
          continue
        fi
      fi
      if [[ -e "$dir" && ! -d "$dir" ]]; then
        echo "→ slot $i SKIPPED: target root $dir exists but is not a directory — preserving it and isolating the build" >&2
        exec 8>&-
        continue
      fi
      if ((i > 0)); then
        dir="$(__pc_prepare_derived_target_root "$dir" "$shared" "dev$((i + 1))")" || {
          echo "→ slot $i SKIPPED: target root $preferred_dir cannot be prepared safely" >&2
          exec 8>&-
          continue
        }
        # Same own-cut rule as the preferred-root check above: refuse a FOREIGN
        # cut's lease, never this cut's own (EI-23946118243608426).
        if [[ "$dir" != "$preferred_dir" ]] && ! __pc_target_retention_allows "$dir"; then
          exec 8>&-
          continue
        fi
      elif [[ -d "$dir" && ( ! -w "$dir" || ! -x "$dir" ) ]]; then
        echo "→ slot $i SKIPPED: configured shared target root is not writable: $dir" >&2
        exec 8>&-
        continue
      fi
      # The lock was free — but that only means no LAUNCHER is alive. Before building
      # into this dir, ask the question that actually decides safety: is a desktop still
      # RUNNING out of it? If so, skip the slot and isolate. Failing safe costs a cold
      # target dir; failing open costs a peer their window, which is the WI-7101
      # incident this whole file exists to prevent. Acting beats warning: the old
      # warning was printed at second ~1 of a ~19s build and scrolled past under cargo
      # output, so the damage was committed before anyone could read it.
      if __pc_desktop_running_in "$dir"; then
        echo "→ slot $i SKIPPED: a desktop is still running out of $dir but holds no slot lock (its launcher is gone) — isolating so we cannot corrupt its app-manifest (WI-7101)" >&2
        exec 8>&-
        continue
      fi
      if ! __pc_lock_target_root "$dir"; then
        exec 8>&-
        continue
      fi
      if ! __pc_admit_target "$dir"; then
        exec 7>&-
        exec 8>&-
        continue
      fi
      export CARGO_TARGET_DIR="$dir"
      if ((i == 0)); then
        # Both halves of this claim are now CHECKED: the flock says no launcher holds
        # the slot, and the exe probe says nothing is running out of the dir. It used to
        # claim only the first half while an advisory two lines later contradicted it.
        echo "→ target dir: $dir (shared slot 0 — no launcher holds it, nothing running out of it)" >&2
      elif [[ -d "$dir/debug/deps" ]]; then
        echo "→ target dir: $dir (slot $i — free and already warm, chosen ahead of colder free slots; isolated from the shared dir, WI-7101)" >&2
      else
        echo "→ target dir: $dir (slot $i — another desktop instance holds the shared dir; isolating so we cannot corrupt its app-manifest, WI-7101)" >&2
        echo "  first build in this slot is a COLD build; later launches reuse its cache" >&2
      fi
      __pc_reap_private_target_slots "$shared" || true
      return 0
    fi
    # Someone else holds this slot. Drop our handle and try the next one.
    exec 8>&-
  done

  # Every slot busy. Fall back to a private per-pid dir: it is CORRECT, and
  # correctness is what this whole file is protecting. Never fall back to the
  # shared dir — that is precisely the corruption path.
  #
  # The private root is locked like a named slot (fd 8, inherited across exec), so
  # the reaper can tell exactly when its last user is gone. A recycled pid whose
  # earlier private lock is still held by an orphaned descendant gets a unique name.
  local private_name="pid$$"
  exec 8>>"${__pc_slot_lockdir}/${private_name}.lock"
  if ! flock -n 8; then
    exec 8>&-
    private_name="pid$$-$(date +%s)"
    exec 8>>"${__pc_slot_lockdir}/${private_name}.lock"
    flock -n 8 || true
  fi
  # Prefer a dead private root's warm cache over a cold build (WI-10004764).
  __pc_reap_private_target_slots "$shared" "$private_name" || true
  if [[ -n "${__pc_adopted_private_root:-}" ]]; then
    # Move the claim onto the adopted root's own lock: fd 8 is the descriptor the
    # launch inherits. Re-pointing it releases the per-pid lock, which guards no root.
    exec 8>&"$__pc_adopted_private_lock_fd"
    exec {__pc_adopted_private_lock_fd}>&-
    rm -f -- "${__pc_slot_lockdir}/${private_name}.lock"
    if ! __pc_lock_target_root "$__pc_adopted_private_root"; then
      exec 8>&-
      return 28
    fi
    if ! __pc_admit_target "$__pc_adopted_private_root"; then
      exec 7>&-
      exec 8>&-
      return 28
    fi
    export CARGO_TARGET_DIR="$__pc_adopted_private_root"
    echo "⚠ all $slots target-dir slots are busy — reusing a dead private root's warm cache as $CARGO_TARGET_DIR." >&2
    echo "  Raise PAPERCUSP_DESKTOP_TARGET_SLOTS if this box routinely runs more desktops than that." >&2
    return 0
  fi
  local private_target="${shared}-${private_name}"
  private_target="$(__pc_prepare_derived_target_root "$private_target" "$shared" "$private_name")" || {
    echo "ERROR: all target-dir slots are busy and no private target root can be prepared safely" >&2
    exec 8>&-
    return 1
  }
  if ! __pc_target_retention_allows "$private_target" || __pc_desktop_running_in "$private_target"; then
    exec 8>&-
    return 28
  fi
  if ! __pc_lock_target_root "$private_target"; then
    exec 8>&-
    return 28
  fi
  if ! __pc_admit_target "$private_target"; then
    exec 7>&-
    exec 8>&-
    return 28
  fi
  export CARGO_TARGET_DIR="$private_target"
  echo "⚠ all $slots target-dir slots are busy — using private $CARGO_TARGET_DIR (cold build)." >&2
  echo "  Raise PAPERCUSP_DESKTOP_TARGET_SLOTS if this box routinely runs more desktops than that." >&2
  return 0
}

__pc_claim_target_dir() {
  if [[ "${PAPERCUSP_DESKTOP_NATIVE_DEV:-0}" != 1 ]]; then
    __pc_claim_target_root
    return $?
  fi
  local __pc_native_admission=1
  local __pc_native_inherited="${PAPERCUSP_DISK_RESERVATION_FILE:-}"
  # Explicit caller placement is authoritative, including when it cannot fit.
  if [[ -n "${CARGO_TARGET_DIR:-}" || "${PAPERCUSP_DESKTOP_TARGET_SLOTS:-4}" == 0 ]] \
    || ! command -v flock >/dev/null 2>&1; then
    __pc_claim_target_root
    return $?
  fi
  local primary root key
  primary="$(__pc_cargo_target_root)" || return $?
  if __pc_claim_target_root "$primary"; then return 0; fi
  # Alternative placements have independent stable slot locks. No filesystem
  # fallback is guessed, and every candidate uses the same safety/admission path.
  local __pc_slot_lockdir="$__pc_slot_lockdir"
  local primary_lockdir="$__pc_slot_lockdir" seen
  seen="$(realpath -m -- "$primary")" || return 28
  while IFS= read -r root; do
    [[ -n "$root" ]] || continue
    if [[ "$root" != /* ]]; then
      echo "ERROR: native Cargo fallback root must be absolute: $root" >&2
      continue
    fi
    root="$(realpath -m -- "$root")" || continue
    if grep -qxF -- "$root" <<< "$seen"; then continue; fi
    seen+=$'\n'"$root"
    key="$(node -e 'process.stdout.write(require("node:crypto").createHash("sha256").update(process.argv[1]).digest("hex"))' "$root")" || return 28
    __pc_slot_lockdir="$primary_lockdir/roots/$key"
    if __pc_claim_target_root "$root"; then return 0; fi
  done <<< "${PAPERCUSP_DESKTOP_CARGO_FALLBACK_ROOTS:-}"
  echo "ERROR: no safe native Cargo target has sufficient reserved capacity in the configured roots" >&2
  return 28
}

# PAPERCUSP_DESKTOP_REAP_ONLY=1 loads the helpers without claiming a slot
# (bin/reap-private-target-slots.sh).
if [[ "${PAPERCUSP_DESKTOP_REAP_ONLY:-0}" != "1" ]]; then
  __pc_claim_target_dir
fi
