#!/usr/bin/env bash
# verify-appimage-packed-sidecar.sh — extract a built AppImage and boot-gate the
# sidecar it actually carries (EI-11935).
#
# WHY THIS EXISTS
# During the 0.0.9 ARRIVES verification an ad-hoc, uncommitted script extracted
# the GUI AppImage to check the packed sidecar. Its scratch dir was a HARDCODED
# `mktemp -d /mnt/data/appimg-arrives.XXXXXX`; on this box /mnt/data was not
# writable, mktemp failed, `$WORK` stayed empty, and `cd "$WORK"` (= `cd ""`) was
# a silent no-op — so `--appimage-extract` unpacked `squashfs-root/` (3.6GB,
# including a >100MB binary) INTO the git working tree. git-sync's auto-commit
# staged 8352 small squashfs-root files and hit the GitHub 100MB cap on the rest.
#
#   A SCRATCH-DIR SETUP THAT CAN SILENTLY FALL THROUGH TO THE CWD ON FAILURE IS
#   NOT A CONVENIENCE — IT IS A LANDMINE IN THE SHARED GIT TREE.
#
# This script is the committed replacement for that hand-rolled extraction: the
# scratch dir is ALWAYS out-of-tree, ALWAYS verified writable, and any failure to
# obtain one is a hard, loud, nonzero-exit failure — never a fallthrough to
# wherever the script happened to be invoked from.
#
#   bash bin/verify-appimage-packed-sidecar.sh <path-to-AppImage>
#
# Exits 0 = the AppImage's packed sidecar boots and serves; 1 = it does not (or
# the AppImage itself could not be extracted/located).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

fail() { echo "❌ VERIFY-APPIMAGE FAILED: $*" >&2; exit 1; }

APPIMAGE="${1:-}"
[[ -n "$APPIMAGE" ]]  || fail "usage: $0 <path-to-AppImage>"
[[ -f "$APPIMAGE" ]]  || fail "no AppImage at $APPIMAGE"
APPIMAGE="$(cd "$(dirname "$APPIMAGE")" && pwd)/$(basename "$APPIMAGE")"  # absolutize before we cd away
[[ -x "$APPIMAGE" ]]  || chmod +x "$APPIMAGE" 2>/dev/null || fail "AppImage is not executable and could not chmod +x: $APPIMAGE"

# ── 1. An OUT-OF-TREE, verified-writable scratch dir — fail closed, never fall
#      through to the caller's cwd (that fallthrough is exactly what shipped
#      3.6GB of squashfs-root into the git tree on 2026-07-14).
#      `${TMPDIR:-/tmp}` (never a hardcoded host-specific path like /mnt/data)
#      so this works unmodified on any box/CI runner.
SCRATCH_BASE="${PAPERCUSP_APPIMAGE_VERIFY_BASE:-${TMPDIR:-/tmp}}"
[[ -d "$SCRATCH_BASE" && -w "$SCRATCH_BASE" ]] \
  || fail "scratch base '$SCRATCH_BASE' does not exist or is not writable — refusing to guess a fallback (this is the exact footgun EI-11935 fixes)"

WORK="$(mktemp -d "$SCRATCH_BASE/appimg-arrives.XXXXXX")" \
  || fail "mktemp -d under '$SCRATCH_BASE' failed — refusing to proceed with an empty/unset scratch dir"
[[ -n "$WORK" && -d "$WORK" ]] \
  || fail "mktemp reported success but '$WORK' is not a real directory — refusing to extract anywhere uncertain"

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

echo "== verify-appimage-packed-sidecar: extracting $(basename "$APPIMAGE")"
echo "   scratch dir: $WORK (out-of-tree, will be removed on exit)"

# `cd` into the verified scratch dir EXPLICITLY — never `cd "$WORK"` with an
# unchecked variable; the checks above guarantee $WORK is real before we get here.
cd "$WORK"

# --appimage-extract needs no FUSE/mount and always unpacks to ./squashfs-root
# relative to the CURRENT directory — which is why landing in the wrong cwd is
# the entire failure mode this script exists to close.
"$APPIMAGE" --appimage-extract >/dev/null 2>&1 \
  || fail "'$APPIMAGE --appimage-extract' failed"
[[ -d "$WORK/squashfs-root" ]] || fail "extraction reported success but $WORK/squashfs-root is missing"

# The packed sidecar lives at usr/lib/<product>/sidecar inside the AppImage
# (same layout build-appimage.sh assembles it into — see its APPDIR_SIDECAR
# resolution for the canonical path shape).
SIDECAR_DIR="$(ls -d "$WORK"/squashfs-root/usr/lib/*/sidecar 2>/dev/null | head -1)"
[[ -n "$SIDECAR_DIR" && -d "$SIDECAR_DIR" ]] \
  || fail "no packed sidecar found under $WORK/squashfs-root/usr/lib/*/sidecar — is this really a papercup AppImage?"

echo "   packed sidecar: $SIDECAR_DIR"
echo "== delegating to gate-sidecar-boots.sh (same boot contract as the pre-pack gate)"

# Delegate to the existing, already-hardened boot gate rather than re-implement
# its isolation-base / port-collision-retry / hermetic-env logic here.
bash "$HERE/gate-sidecar-boots.sh" "$SIDECAR_DIR"
