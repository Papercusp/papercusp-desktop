#!/usr/bin/env bash
# disk-preflight.sh — refuse a build at second ZERO when the filesystem it will
# stage into lacks headroom, instead of dying three minutes into a multi-GB copy.
#
# WHY (EI-20090527288494606, 2026-08-10): build-desktop-sidecar.sh failed with
#   cp: error copying ... No space left on device
# while staging node_modules into src-tauri/sidecar.tmp.<pid>, root fs at 100%.
# No build entry point checked free space, so a full disk surfaced as a confusing
# mid-copy `cp` error deep in a log rather than a one-line refusal up front. The
# dangerous outcome is not the failed build — it is the PARTIALLY-staged one: a
# sidecar that looks structurally valid and gets packaged into an installer.
#
# This is the THIRD time this class has been paid for here, which is why it is a
# shared helper and not another inline check:
#   - 0.0.11 (2026-07-15) mac-vm-build.sh: a second role's cold compile ran out of
#     disk MID-BUILD and died with no artifacts and no DONE sentinel — "a mysterious
#     hang/kill" that was ENOSPC. Fixed inline at mac-vm-build.sh:485.
#   - 2026-08-10: the same class, on a different script, rediscovered the same way.
# Source this instead of hand-rolling a fourth `df | awk` (see EI-9905 for the same
# argument about sha256).
#
#   source "$(dirname "$0")/lib/disk-preflight.sh"
#   papercusp_require_free_gb "$STAGING_DIR" 12 "sidecar staging"
#
# WHICH FILESYSTEM: pass the directory the build will WRITE INTO, not $PWD. On this
# box they differ in the way that matters — the repo is on the 1.9T root fs (the
# constrained one) while /tmp is a separate 7.3T volume with ~1.8T free. Checking
# the wrong one answers confidently about a disk you are not filling.
#
# FAIL-OPEN ON MEASUREMENT FAILURE, FAIL-CLOSED ON A REAL SHORTAGE: if `df` cannot
# read the path (missing dir, unusual mount) the build PROCEEDS — a guard that
# cannot measure must not become a new way for builds to die. Only a measured,
# genuine shortage refuses.

# Free space in whole GB on the filesystem containing $1. Prints an integer, or an
# EMPTY string when it cannot be measured. `df -Pk` is POSIX (portable to darwin,
# where GNU-only flags are absent); -P forces one line per fs so a long device name
# cannot wrap and shift the column.
papercusp_free_gb() {
  local path="$1" out=""
  [ -n "$path" ] || return 0
  # Walk up to the nearest existing ancestor: the staging dir usually does not
  # exist yet at preflight time, and `df` on a missing path reports nothing.
  while [ -n "$path" ] && [ ! -d "$path" ]; do
    local parent
    parent="$(dirname "$path")"
    [ "$parent" = "$path" ] && break
    path="$parent"
  done
  [ -d "$path" ] || return 0
  out="$(df -Pk "$path" 2>/dev/null | awk 'NR==2 {print int($4/1024/1024)}')" || true
  printf '%s' "$out"
}

# Refuse the build unless $1 has at least $2 GB free. $3 is a human label for the
# message ("sidecar staging", "cold compile"). Exits 28 (ENOSPC) so a caller's
# sentinel/DONE handling can distinguish "out of disk" from a compile error.
papercusp_require_free_gb() {
  local dir="$1" need_gb="$2" label="${3:-build}"
  local free_gb
  free_gb="$(papercusp_free_gb "$dir")"

  if [ -z "$free_gb" ]; then
    # Unmeasurable -> proceed. Say so, so a later ENOSPC is not a total mystery.
    echo "    (disk preflight SKIPPED for $label — could not measure free space on '$dir')" >&2
    return 0
  fi

  if [ "$free_gb" -lt "$need_gb" ]; then
    echo "ERROR: insufficient disk for $label: ${free_gb}GB free, need ~${need_gb}GB." >&2
    echo "       Staging target: $dir" >&2
    echo "       This build stages multi-GB trees; starting now would fail MID-COPY and can" >&2
    echo "       leave a PARTIALLY-staged bundle that still looks valid to later steps." >&2
    echo "       Free space first (stale cargo target dirs, npm/playwright caches, old builds)," >&2
    echo "       or point the staging dir at a roomier filesystem." >&2
    return 28 # ENOSPC — callers `|| exit $?` to preserve it
  fi

  echo "    (disk preflight ✓ ${free_gb}GB free on '$dir' — ok for $label, needs ~${need_gb}GB)"
  return 0
}
