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
      export CARGO_TARGET_DIR="$dir"
      if ((i == 0)); then
        # "no other SLOT-HOLDING instance" — deliberately not "no other instance".
        # An unlocked bypasser is invisible to the flock, and the advisory just below
        # may well contradict a broader claim two lines later.
        echo "→ target dir: $dir (shared slot 0 — no other slot-holding desktop instance)" >&2
        # Slot 0 was free, yet a desktop build appears to be running: it did not come
        # through this wrapper (a bare `npm run tauri dev`, or an instance started
        # before slots existed), so it holds no lock and we are about to share its
        # target dir. We cannot stop it — only say so loudly, because the symptom it
        # produces is a mystery JSON parse error in a file git says is clean.
        #
        # `[t]auri` is bracketed deliberately: an unbracketed pattern matches this
        # very command's own argv, so the check would always "find" a peer.
        if pgrep -af '[t]auri dev' >/dev/null 2>&1; then
          echo "⚠ a desktop build is already running but holds NO slot lock — it bypassed this wrapper (bare \`npm run tauri dev\`?) or predates it." >&2
          echo "  Both builds now share $dir and may corrupt each other's generated app-manifest (WI-7101)." >&2
          echo "  Safest: stop it and relaunch it with \`npm run dev\`, or set PAPERCUSP_DESKTOP_TARGET_SLOTS to force this one onto its own slot." >&2
        fi
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
