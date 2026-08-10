#!/usr/bin/env bash
# disk-preflight.selftest.sh — guards lib/disk-preflight.sh (EI-20090527288494606).
#
# THE BUG THIS GUARDS
# -------------------
# build-desktop-sidecar.sh began a multi-GB node_modules stage with no free-space
# precondition and died mid-copy on `cp: No space left on device` with the root fs
# at 100%. The failure mode that matters is not the dead build — it is the
# PARTIALLY-staged sidecar left behind, which still looks structurally valid to
# whatever packages it next.
#
# Two properties are pinned here, because each has already failed once in this repo:
#
#   1. BEHAVIOUR — the helper refuses when short and passes when there is room, and
#      is fail-OPEN when it cannot measure. A guard that dies on an unusual mount
#      would become a new way for builds to fail, which is worse than the bug.
#   2. WIRING — every entry point that stages multi-GB actually CALLS it. This is
#      the property rust-path-remap.selftest.sh exists for too: a shared helper that
#      no caller invokes is indistinguishable from no helper at all, and nothing
#      complains. Asserted structurally, so a new entry point cannot silently skip it.
#
# Hermetic: pure shell + a tmpdir. No network, no docker, no build.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$DIR/disk-preflight.sh"
[ -f "$LIB" ] || { echo "FAIL: $LIB not found"; exit 1; }
# shellcheck source=/dev/null
source "$LIB"

FAILS=0
ok()  { echo "  ✓ $*"; }
bad() { echo "  ✗ $*"; FAILS=$((FAILS + 1)); }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ── 1. papercusp_free_gb ──────────────────────────────────────────────────────
FREE="$(papercusp_free_gb "$TMP")"
if [[ "$FREE" =~ ^[0-9]+$ ]]; then
  ok "papercusp_free_gb returns an integer GB for a real dir (${FREE}GB)"
else
  bad "papercusp_free_gb returned a non-integer for a real dir: '$FREE'"
fi

# The staging dir usually does not exist yet when the guard runs, so the helper
# must walk up to the nearest existing ancestor rather than silently answering
# "unmeasurable" — which would make the guard a no-op exactly where it is needed.
DEEP="$(papercusp_free_gb "$TMP/not/created/yet")"
if [[ "$DEEP" =~ ^[0-9]+$ ]]; then
  ok "papercusp_free_gb walks up to an existing ancestor for a not-yet-created path (${DEEP}GB)"
else
  bad "papercusp_free_gb failed on a not-yet-created path ('$DEEP') — the guard would no-op for real staging dirs"
fi

# ── 2. papercusp_require_free_gb ──────────────────────────────────────────────
# Passes when the requirement is trivially satisfiable.
if papercusp_require_free_gb "$TMP" 0 "selftest (no-op requirement)" >/dev/null 2>&1; then
  ok "require_free_gb passes when there is room"
else
  bad "require_free_gb refused a 0GB requirement — it would block every build"
fi

# Refuses, with ENOSPC(28), when the requirement cannot be met. 99999999GB is
# larger than any real filesystem, so this is deterministic on any host.
OUT="$(papercusp_require_free_gb "$TMP" 99999999 "selftest (impossible requirement)" 2>&1)"
RC=$?
if [ "$RC" -eq 28 ]; then
  ok "require_free_gb refuses an impossible requirement with exit 28 (ENOSPC)"
else
  bad "require_free_gb returned $RC for an impossible requirement, expected 28"
fi
case "$OUT" in
  *"insufficient disk"*) ok "the refusal names the problem in its first line" ;;
  *) bad "the refusal message did not say 'insufficient disk': $OUT" ;;
esac
case "$OUT" in
  *"$TMP"*) ok "the refusal names the staging dir it measured" ;;
  *) bad "the refusal did not name the measured dir — the reader cannot tell WHICH fs is full" ;;
esac

# Fail-OPEN when the path cannot be measured at all.
if papercusp_require_free_gb "" 99999999 "selftest (unmeasurable)" >/dev/null 2>&1; then
  ok "require_free_gb fails OPEN when it cannot measure (never a new way for builds to die)"
else
  bad "require_free_gb refused an UNMEASURABLE path — a broken df would now block builds"
fi

# ── 3. wiring: the staging entry points actually call it ──────────────────────
# Structural, for the reason in the header: a helper nothing calls is dark.
for SCRIPT in build-desktop-sidecar.sh build-windows-cross.sh; do
  P="$DIR/../$SCRIPT"
  if [ ! -f "$P" ]; then
    bad "$SCRIPT missing — update this list if it was renamed/removed"
    continue
  fi
  if grep -q 'papercusp_require_free_gb' "$P"; then
    ok "$SCRIPT calls the disk preflight before staging"
  else
    bad "$SCRIPT stages multi-GB but never calls papercusp_require_free_gb (see lib/disk-preflight.sh)"
  fi
done

if [ "$FAILS" -eq 0 ]; then echo "PASS"; exit 0; fi
echo "FAIL ($FAILS)"; exit 1
