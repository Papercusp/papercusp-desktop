#!/usr/bin/env bash
# Emit build-provenance.json next to a set of release artifacts (EI-8914).
#
# WHY: an installer must be traceable back to the bytes it was built from. The
# operator self-reports ONE string (PAPERCUSP_BUILD_SHA at /api/health); this
# records the WHOLE provenance next to the artifacts — the shipped version, the
# baked sha, the git head + dirty state, and the sha256 of every artifact — so a
# reviewer/owner can verify a downloaded installer, and so a stale artifact
# can't masquerade as a fresh cut (the LABELED != PACKED failure class: the
# 0.0.5 win cut on 2026-07-09 shipped sha 1a161ab-wi3407 while its packed bytes
# were ecea544, ~10k lines apart).
#
# ONE emitter, ONE schema across all three legs (P-002 consolidation): the
# Linux + Mac legs of release-local.sh call this directly, and the Windows leg
# (bin/build-windows-on-vm.sh) now calls it too instead of its old inline
# duplicate. Leg-specific fields ride an optional env seam so a leg that doesn't
# need them gets byte-identical output:
#   PROVENANCE_PACKED_SRC_FINGERPRINT — Windows: a hash of the exact tree packed
#     to the VM (its strongest anti-LABELED!=PACKED signal; Mac/Linux have none).
#   PROVENANCE_SIGNED (true|false)    — Windows: whether Authenticode was configured.
#   PROVENANCE_TOOLCHAIN (json)       — the build toolchain as a JSON object
#     (rustc/node/tauriCli), recorded by the leg whose emitter runs ON the builder
#     (the Linux leg: host == builder). P-014 reproducibility hygiene.
#
# Usage:
#   emit-build-provenance.sh OUT_DIR VERSION BUILD_SHA REUSED ARTIFACT...
#     OUT_DIR      dir to write build-provenance.json into
#     VERSION      shipped app version (PAPERCUSP_BUILD_VERSION)
#     BUILD_SHA    baked PAPERCUSP_BUILD_SHA (what /api/health self-reports)
#     REUSED       "true" | "false" — were these artifacts BUILT this cut, or
#                  SALVAGED from a prior one (PAPERCUSP_REUSE_MAC/WIN)? A reused
#                  set carries THIS cut's version/sha LABEL but was not built
#                  from the current source — so `reused:true` is the honest flag
#                  that its label may not match its bytes.
#     ARTIFACT...  the shipped files to fingerprint (globs pre-expanded by the
#                  caller; non-existent paths are skipped)
#
# Artifact `name` is the path RELATIVE TO OUT_DIR when the artifact lives under
# it (e.g. "deb/App_0.0.8_amd64.deb"), else the basename (WI-4243: basenames
# forced verify-provenance.sh consumers to build symlink stages for the
# linux/mac subdir layouts). Each artifact also records `sig`: whether a
# co-located minisign .sig existed AT EMIT TIME — the unambiguous per-artifact
# answer WI-4243 found missing (the top-level windows `signed` field means
# Authenticode, NOT minisign, and was being misread).
#
# The git head/dirty are read from PROVENANCE_GIT_ROOT (default: $PWD) — the
# orchestrator's checkout, which (unlike a VM's rsync'd, .git-less tree) can
# resolve them.
set -euo pipefail

if [[ $# -lt 4 ]]; then
  echo "usage: $0 OUT_DIR VERSION BUILD_SHA REUSED ARTIFACT..." >&2
  exit 2
fi
OUT_DIR="$1"; VERSION="$2"; BUILD_SHA="$3"; REUSED="$4"; shift 4
[[ "$REUSED" == "true" || "$REUSED" == "false" ]] || { echo "REUSED must be true|false, got '$REUSED'" >&2; exit 2; }
[[ -d "$OUT_DIR" ]] || { echo "OUT_DIR '$OUT_DIR' is not a directory" >&2; exit 2; }

GIT_ROOT="${PROVENANCE_GIT_ROOT:-$PWD}"
GIT_HEAD="$(git -C "$GIT_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
GIT_DIRTY="$(git -C "$GIT_ROOT" diff --quiet HEAD 2>/dev/null && echo false || echo true)"

# Portable file size: GNU stat (-c, the Linux dev box) then BSD stat (-f).
_bytes() { stat -c %s "$1" 2>/dev/null || stat -f %z "$1"; }

# Artifact name: relative to OUT_DIR when under it, else basename (see header).
_OUT_REAL="$(realpath "$OUT_DIR")"
_name() {
  local rp; rp="$(realpath "$1")"
  if [[ "$rp" == "$_OUT_REAL"/* ]]; then printf '%s' "${rp#"$_OUT_REAL"/}"; else basename "$1"; fi
}

PROV="$OUT_DIR/build-provenance.json"
{
  printf '{\n'
  printf '  "version": "%s",\n'   "$VERSION"
  printf '  "buildSha": "%s",\n'  "$BUILD_SHA"
  printf '  "reused": %s,\n'      "$REUSED"
  printf '  "gitHead": "%s",\n'   "$GIT_HEAD"
  printf '  "gitDirty": %s,\n'    "$GIT_DIRTY"
  # Optional leg-specific fields (P-002 consolidation) — emitted only when the
  # caller sets the env seam, so mac/linux output is byte-unchanged. The Windows
  # leg passes both: packedSrcFingerprint (a hash of the exact tree it packed to
  # the VM — its strongest anti-LABELED!=PACKED signal) and signed (Authenticode).
  if [[ -n "${PROVENANCE_PACKED_SRC_FINGERPRINT:-}" ]]; then
    printf '  "packedSrcFingerprint": "%s",\n' "$PROVENANCE_PACKED_SRC_FINGERPRINT"
  fi
  if [[ -n "${PROVENANCE_SIGNED:-}" ]]; then
    printf '  "signed": %s,\n' "$PROVENANCE_SIGNED"
  fi
  # P-014 (repro hygiene): the exact build toolchain, pre-formatted JSON. Populated
  # by a leg whose emitter runs ON the build machine (Linux: host == builder). The
  # mac/win legs build on a VM, so their host-side emit leaves this unset rather
  # than record a misleading HOST toolchain — VM-side capture is a followup.
  if [[ -n "${PROVENANCE_TOOLCHAIN:-}" ]]; then
    printf '  "toolchain": %s,\n' "$PROVENANCE_TOOLCHAIN"
  fi
  printf '  "builtAtUtc": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '  "artifacts": [\n'
  _first=1
  for f in "$@"; do
    [[ -e "$f" ]] || continue
    (( _first )) || printf ',\n'; _first=0
    printf '    { "name": "%s", "bytes": %s, "sha256": "%s", "sig": %s }' \
      "$(_name "$f")" "$(_bytes "$f")" "$(sha256sum "$f" | cut -d' ' -f1)" \
      "$([[ -f "$f.sig" ]] && echo true || echo false)"
  done
  printf '\n  ]\n}\n'
} > "$PROV"
echo "==> build provenance written: $PROV"
cat "$PROV"
