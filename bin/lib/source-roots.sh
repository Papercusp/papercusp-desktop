#!/usr/bin/env bash
# papercusp_repo_root — resolve THE ONE monorepo root a sidecar build reads source from.
#
# EI-21832562420831737. build-desktop-sidecar.sh's own header advertises REPO_ROOT as the
# way to relocate the build ("Override locations with REPO_ROOT / PAPERCUSP_ROOT if your
# layout differs"), and a release-audited cut needs exactly that: build from a pinned,
# tracked-clean checkout so HEAD cannot move under a ~17-minute build and peers' dirty
# files cannot be baked in.
#
# But the script derived the repo root TWICE, independently:
#
#     REPO_ROOT="${REPO_ROOT:-$ROOT/..}"        # honours the override
#     REPO="$(cd "$ROOT/.." && pwd)"            # ~4,300 lines later — ignores it
#
# `$REPO` is not a minor local: the entire chat-dock half of the build reads through it —
# `$REPO/apps/tui`, `$REPO/apps/pui-zellij-plugin`, the `git -C "$REPO" rev-parse` that
# supplies the pui build sha, the dirty probe behind its `_PUI_BUILD_DIRTY` flag, and the
# `--remap-path-prefix=$REPO=/papercusp` that scrubs build paths out of the shipped
# binaries. So `REPO_ROOT=<pinned> build-desktop-sidecar.sh` — the documented invocation —
# produced a bundle whose JavaScript came from the pinned tree and whose Rust came from
# the live one, while the release stamp claimed the pin for all of it.
#
# WHY THAT IS THE DANGEROUS SHAPE rather than merely a bug: it fails SILENTLY and it fails
# PARTIALLY. Both roots exist, both are real checkouts, every path resolves, every build
# step succeeds. There is no error to notice — the only evidence is bytes whose provenance
# is a blend of two commits, which is precisely what the release audit exists to make
# impossible and precisely what it cannot see. The workaround that shipped r15 relocated
# the WHOLE invocation (running the copy of this script inside the pinned worktree), which
# makes the two roots agree by accident; it never exercised the documented override, so the
# trap stayed armed for the next reader who takes the header at its word.
#
# THE RULE: one root, resolved once, honoured everywhere. Canonicalised, so the value that
# reaches `--remap-path-prefix` and every error message is a real path and not
# `/…/papercusp-desktop/..`.
#
# ⚠ NEVER FAILS THE CALLER, deliberately. A root that cannot be entered is echoed back
# unchanged so the script's own named guards report it ("papercup/apps/operator not found
# at <path> — Set REPO_ROOT to the path of your clone"). Exiting here instead would move
# that failure ~200 lines earlier and lose the diagnosis, which is the same ordering
# mistake the identity-check comment at the top of the producer already documents.
#
# PORTABILITY: macOS ships /bin/bash 3.2.57 and this file is sourced by scripts that run on
# the mac VM. Everything here is bash 3.2 (no mapfile, no associative arrays, no ${var^^});
# see scripts/check-mac-bash-portability.mjs.

# Usage: papercusp_repo_root <desktop_root> [<override>]
# Echoes the monorepo root. <override> defaults to $REPO_ROOT from the environment, so the
# caller can assign straight onto REPO_ROOT itself. A blank/whitespace-only override counts
# as absent — same normalisation the vm-release entry gate applies to its pins, so "set but
# empty" cannot silently relocate a build to `/`.
papercusp_repo_root() {
  local _desktop_root="${1:-}"
  local _override="${2-${REPO_ROOT:-}}"
  local _candidate

  if [[ -n "${_override//[[:space:]]/}" ]]; then
    _candidate="$_override"
  else
    _candidate="$_desktop_root/.."
  fi

  ( cd "$_candidate" 2>/dev/null && pwd ) || printf '%s\n' "$_candidate"
}
