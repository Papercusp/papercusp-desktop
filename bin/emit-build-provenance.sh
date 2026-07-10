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
# Sibling: bin/build-windows-on-vm.sh emits the same JSON shape INLINE (it adds
# a Windows-only packedSrcFingerprint, computed from the tarball it ships to the
# VM). This standalone exists so the Mac leg of release-local.sh — which has no
# such tarball, builds from `git archive HEAD` on the VM, and had NO provenance
# at all — reaches parity. TODO(generic-first): migrate the Windows call site
# here (parameterizing the extra field) once this has ridden a live cut.
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

PROV="$OUT_DIR/build-provenance.json"
{
  printf '{\n'
  printf '  "version": "%s",\n'   "$VERSION"
  printf '  "buildSha": "%s",\n'  "$BUILD_SHA"
  printf '  "reused": %s,\n'      "$REUSED"
  printf '  "gitHead": "%s",\n'   "$GIT_HEAD"
  printf '  "gitDirty": %s,\n'    "$GIT_DIRTY"
  printf '  "builtAtUtc": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '  "artifacts": [\n'
  _first=1
  for f in "$@"; do
    [[ -e "$f" ]] || continue
    (( _first )) || printf ',\n'; _first=0
    printf '    { "name": "%s", "bytes": %s, "sha256": "%s" }' \
      "$(basename "$f")" "$(_bytes "$f")" "$(sha256sum "$f" | cut -d' ' -f1)"
  done
  printf '\n  ]\n}\n'
} > "$PROV"
echo "==> build provenance written: $PROV"
cat "$PROV"
