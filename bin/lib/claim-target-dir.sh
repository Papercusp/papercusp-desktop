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
# ~/.cargo/config.toml pins `build.target-dir=~/.cargo-target` for the whole box
# (set 2026-06-17, to stop per-checkout target/ dirs bloating to ~150G). So every
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
# `fuser` answers from the kernel's exe MAPPING, which is the whole point: it cannot be
# fooled by argv. The check this replaces could, and did. `pgrep -af '[t]auri dev'`
# matched the wrapper's OWN ANCESTOR on every `npm run tauri -- dev` launch, because npm
# rewrites its process title to `npm run tauri dev …` — and it also matched any peer
# agent's shell that had merely typed the string. Bracketing `[t]auri` guards the pgrep's
# own argv only, never an ancestor's. That false positive is why this file used to print
# "a desktop build is already running but holds NO slot lock" on launches where nothing
# else was running at all, and it is the reason a warning was never enough here (WI-37452).
#
# KNOWN BLIND SPOTS, measured rather than assumed:
#   - If the binary was REPLACED after the app started, the running process holds the old
#     inode and this returns false. Catching that needs a /proc-wide exe scan: ~18s across
#     the ~5600 processes on this box, far too slow for a launch path.
#   - A build started OUTSIDE this wrapper (a bare `cargo tauri dev`) has no app running
#     yet, so nothing here can see it. That path is unprotected by construction.
__pc_desktop_running_in() {
  local dir="$1"
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

__pc_claim_target_dir() {
  # An explicit CARGO_TARGET_DIR is a deliberate choice (a .deb cut on an
  # isolated dir, a test harness) — never second-guess it.
  if [[ -n "${CARGO_TARGET_DIR:-}" ]]; then
    echo "→ target dir: honouring preset CARGO_TARGET_DIR=$CARGO_TARGET_DIR (no slot claimed)" >&2
    return 0
  fi

  local slots="${PAPERCUSP_DESKTOP_TARGET_SLOTS:-4}"
  if [[ "$slots" == "0" ]]; then
    echo "⚠ target-dir slots DISABLED (PAPERCUSP_DESKTOP_TARGET_SLOTS=0) — a second concurrent desktop build will corrupt the shared app-manifest (WI-7101)" >&2
    return 0
  fi

  # No flock(1) (macOS ships none) — we cannot claim atomically, so do not
  # pretend to. Leave the shared dir in place and say so, rather than handing
  # back a slot whose exclusivity we cannot actually guarantee.
  if ! command -v flock >/dev/null 2>&1; then
    echo "⚠ flock(1) unavailable — cannot claim a target-dir slot; concurrent desktop builds may corrupt the shared app-manifest (WI-7101)" >&2
    return 0
  fi

  mkdir -p "$__pc_slot_lockdir"

  local shared="${HOME}/.cargo-target"
  local i dir lockfile
  for ((i = 0; i < slots; i++)); do
    # Slot 0 IS the pre-existing shared dir — keep the name so every warm cache
    # already on this box stays usable instead of being orphaned on first run.
    if ((i == 0)); then dir="$shared"; else dir="${shared}-dev$((i + 1))"; fi
    lockfile="${__pc_slot_lockdir}/slot${i}.lock"

    # fd 8 deliberately: bin/cargo-build-safe.sh uses fd 9 for the sidecar lock,
    # and a launch path can end up holding both.
    exec 8>>"$lockfile" || continue
    if flock -n 8; then
      # A completed cut can outlive its launcher. Never reuse a target root that
      # an active retention lease covers; a later cleanup/build must not erase
      # the finalized artifact or its isolated Cargo cache.
      if release_artifacts_retention_path_is_leased "$dir" >/dev/null 2>&1; then
        echo "→ slot $i SKIPPED: target root $dir is covered by an active release-retention lease" >&2
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
      export CARGO_TARGET_DIR="$dir"
      if ((i == 0)); then
        # Both halves of this claim are now CHECKED: the flock says no launcher holds
        # the slot, and the exe probe says nothing is running out of the dir. It used to
        # claim only the first half while an advisory two lines later contradicted it.
        echo "→ target dir: $dir (shared slot 0 — no launcher holds it, nothing running out of it)" >&2
      else
        echo "→ target dir: $dir (slot $i — another desktop instance holds the shared dir; isolating so we cannot corrupt its app-manifest, WI-7101)" >&2
        echo "  first build in this slot is a COLD build; later launches reuse its cache" >&2
      fi
      return 0
    fi
    # Someone else holds this slot. Drop our handle and try the next one.
    exec 8>&-
  done

  # Every slot busy. Fall back to a private per-pid dir: a cold build is slow,
  # but it is CORRECT, and correctness is what this whole file is protecting.
  # Never fall back to the shared dir — that is precisely the corruption path.
  export CARGO_TARGET_DIR="${shared}-pid$$"
  echo "⚠ all $slots target-dir slots are busy — using private $CARGO_TARGET_DIR (cold build)." >&2
  echo "  Raise PAPERCUSP_DESKTOP_TARGET_SLOTS if this box routinely runs more desktops than that." >&2
  return 0
}

__pc_claim_target_dir
