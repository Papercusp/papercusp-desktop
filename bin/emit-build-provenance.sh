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
#   PROVENANCE_SIDECAR_DIR            — the packed sidecar's directory. The emitter
#     reads THAT dir's own build-provenance.json and folds a compact `sidecar` record
#     (gitHead / builtAtUtc / serve.mjs sha256) in beside the Rust-layer fields, so the
#     artifact records WHICH sidecar it shipped and not merely which commit built the
#     binary. EI-20086238555902880 — the two halves refresh on different policies.
#   PROVENANCE_TOOLCHAIN (json)       — the build toolchain as a JSON object
#     (rustc/node/tauriCli), recorded by the leg whose emitter runs ON the builder
#     (the Linux leg: host == builder). P-014 reproducibility hygiene.
#   PROVENANCE_REPLACE_BUILD_SHA_FROM — compare-and-swap repair seam. When the
#     output already attests the exact same artifact bytes, changing buildSha is
#     refused unless this value exactly matches the existing buildSha. This keeps
#     metadata-only recovery from replacing the identity baked into /api/health.
#   PROVENANCE_REPLACE_VERSION_FROM   — the equivalent compare-and-swap seam for
#     the baked app version. Same-byte version rewrites are otherwise refused.
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
# The source git head/dirty normally come from PROVENANCE_GIT_ROOT (default:
# $PWD). A release orchestrator whose build mutates tracked staging files MUST
# capture the clean input state before those mutations and pass it through
# PROVENANCE_SOURCE_GIT_HEAD / PROVENANCE_SOURCE_GIT_DIRTY. The record keeps
# both moments: gitHead/gitDirty describe the source accepted at cut start,
# while gitHeadAtEmit/gitDirtyAtEmit describe the checkout when this file was
# emitted. Conflating those moments made every normal release look dirty after
# the cutter regenerated tracked env-sidecars (EI-20555742146560765).
set -euo pipefail

if [[ $# -lt 4 ]]; then
  echo "usage: $0 OUT_DIR VERSION BUILD_SHA REUSED ARTIFACT..." >&2
  exit 2
fi
OUT_DIR="$1"; VERSION="$2"; BUILD_SHA="$3"; REUSED="$4"; shift 4
[[ "$REUSED" == "true" || "$REUSED" == "false" ]] || { echo "REUSED must be true|false, got '$REUSED'" >&2; exit 2; }
[[ -d "$OUT_DIR" ]] || { echo "OUT_DIR '$OUT_DIR' is not a directory" >&2; exit 2; }

GIT_ROOT="${PROVENANCE_GIT_ROOT:-$PWD}"
GIT_ROOT="$(git -C "$GIT_ROOT" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$GIT_ROOT")"
GIT_HEAD_AT_EMIT="$(git -C "$GIT_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"

# A superproject's `git diff HEAD` is not a complete clean-snapshot proof. Git
# can report an uninitialized/empty submodule as clean for that path (the
# gitlink is still the committed value), while `git -C <path>` may resolve up
# into the superproject and return a plausible HEAD. That is exactly the shape
# that produced a dirty-looking tree with papercusp-desktop lacking its own
# checked-out commit, then let provenance consumers treat the snapshot as
# usable. Before recording `gitDirty=false`, verify every recursive submodule's
# worktree root and HEAD against the gitlink printed by `submodule status`.
submodule_worktree_dirty() {
  local status_output line expected path sub_root actual top
  if ! status_output="$(git -C "$GIT_ROOT" submodule status --recursive 2>/dev/null)"; then
    # An unreadable status is not evidence of a clean snapshot.
    return 0
  fi

  if [[ -z "$status_output" ]]; then
    # `submodule status` can be empty when the config/worktree is damaged. If
    # HEAD still contains a gitlink, fail closed rather than accepting it.
    if git -C "$GIT_ROOT" ls-tree -r HEAD 2>/dev/null | grep -q '^160000 '; then
      return 0
    fi
    return 1
  fi

  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    expected="${line#?}"
    expected="${expected%% *}"
    path="${line#?}"
    path="${path#"$expected"}"
    path="${path# }"
    path="${path%% *}"
    [[ -n "$expected" && -n "$path" ]] || return 0

    sub_root="$GIT_ROOT/$path"
    [[ -d "$sub_root" ]] || return 0
    # A missing/empty submodule `.git` must not fall through to the parent
    # repository's HEAD. The top-level check makes that distinction explicit.
    top="$(git -C "$sub_root" rev-parse --show-toplevel 2>/dev/null || true)"
    [[ "$top" = "$sub_root" ]] || return 0
    actual="$(git -C "$sub_root" rev-parse HEAD 2>/dev/null || true)"
    [[ -n "$actual" && ( "$actual" = "$expected" || "$actual" = "$expected"* ) ]] || return 0
  done <<< "$status_output"

  return 1
}

GIT_DIRTY_AT_EMIT=true
if git -C "$GIT_ROOT" diff --quiet HEAD 2>/dev/null && ! submodule_worktree_dirty; then
  GIT_DIRTY_AT_EMIT=false
fi

# The orchestrator is the only layer that can observe the release INPUT before
# it performs its own version/staging mutations. Direct emitter callers omit
# these seams and retain the conservative emit-time behavior. Values are
# validated rather than truthy-coerced so a typo cannot manufacture clean
# provenance.
GIT_HEAD="${PROVENANCE_SOURCE_GIT_HEAD:-$GIT_HEAD_AT_EMIT}"
GIT_DIRTY="${PROVENANCE_SOURCE_GIT_DIRTY:-$GIT_DIRTY_AT_EMIT}"
[[ "$GIT_HEAD" == "unknown" || "$GIT_HEAD" =~ ^[0-9a-fA-F]{7,64}$ ]] \
  || { echo "PROVENANCE_SOURCE_GIT_HEAD must be a git object id or 'unknown', got '$GIT_HEAD'" >&2; exit 2; }
[[ "$GIT_DIRTY" == "true" || "$GIT_DIRTY" == "false" ]] \
  || { echo "PROVENANCE_SOURCE_GIT_DIRTY must be true|false, got '$GIT_DIRTY'" >&2; exit 2; }

# Portable file size: GNU stat (-c, the Linux dev box) then BSD stat (-f).
_bytes() { stat -c %s "$1" 2>/dev/null || stat -f %z "$1"; }

# WI-37746 (closes the WI-37738 stranding class): the release host BAKED INTO
# THESE BINARIES, recorded as a SHA-256 FINGERPRINT — never the URL itself.
#
# WHY A FINGERPRINT AND NOT THE URL: this file ships NEXT TO the artifacts (and
# the release identity gate scans what ships), and the URL's path segment is the
# unguessable secret that keeps the bucket unlisted (D-002/D-003). A fingerprint
# still answers the only question publish time asks — "were these bytes built
# for the prefix we are about to upload to?" — while carrying nothing secret.
#
# WHY IT IS NEEDED AT ALL, given upload-release.sh already greps the artifacts:
# that check greps for the CURRENT host, so an artifact baked to a DIFFERENT
# HOST matches nothing, is skipped rather than counted, and lands in the "could
# not read a baked host" branch — a WARNING THAT SHIPS. Measured 2026-08-11 on
# fixtures: same-host/wrong-prefix BLOCKS correctly, a wholly different baked
# host WARNS AND SHIPS. Compressed artifacts (.tar.gz/.dmg) reach that same
# warning path for an unrelated reason. The bytes therefore cannot be the
# evidence; the BUILD is the only place the baked value is known for certain.
#
# `null` = no host was baked into this build. A MISSING key = emitted by a
# pre-WI-37746 build — a distinction upload-release.sh relies on.
_release_host_fp() {
  local h="${PAPERCUSP_RELEASE_HOST:-}"
  h="${h%/}"   # normalize: a trailing slash must not change the fingerprint
  if [[ -z "$h" ]]; then printf 'null'; return; fi
  printf '"%s"' "$(printf '%s' "$h" | sha256sum | cut -d' ' -f1)"
}

# EI-20086238555902880: WHICH SIDECAR IS PACKED INTO THESE BYTES.
#
# THE GAP THIS CLOSES: a desktop build compiles FRESH Rust but reuses whatever
# prebuilt sidecar bundle happens to be on disk — rebuilding it is a separate manual
# step. So the two halves of a shipped app can be hours apart in provenance, and the
# fields above describe only the Rust/orchestrator half. Measured on the 0.0.14
# Windows cut: installer built 15:45:18Z from gitHead c5d848155a, while its packed
# serve.mjs was baked 03:09:18Z — twelve and a half hours older — and a fix committed
# at 15:38:38Z was simply absent from the shipped payload.
#
# Why that is dangerous beyond the one missing fix: gitHead + gitDirty READ as a
# complete provenance claim, so a reviewer who checks this file — the right instinct,
# and exactly what the reporter did — concludes the artifact carries everything at that
# commit. TRUE of the Rust layer, FALSE of the sidecar, and nothing on the artifact
# surfaced the difference.
#
# THIS IS DELIBERATELY INFORMATION, NOT A BLOCKING STALENESS RULE. A
# "sidecar older than sources" assertion was already considered and REJECTED in writing
# in bin/lib/sidecar-freshness.js: one shared checkout, HEAD moving every few minutes,
# so such a rule fires on nearly every build for every agent and trains the bypass.
# Recording the fact has no false-positive rate; judging it has a large one. Anyone
# who needs a BLOCKING check still has the caller-declared
# PAPERCUSP_REQUIRE_SIDECAR_CONTAINS=<sha> assertion, which cannot cry wolf.
#
# Resolved HERE rather than at each call site on purpose: four legs hand-assembling
# the same record is how two lists drift apart (see the GLFALLBACK_SONAMES fix in
# build-appimage.sh for the same lesson). A leg names the directory; the shape lives once.
#
# `null` = the leg named no sidecar. `{"status":"absent"}` = it named one that carries
# no provenance file — which sidecar-freshness.js treats as UNDECIDABLE, never a pass,
# so the two must stay distinguishable here too. A MISSING key = a pre-EI-20086238555902880 emitter.
_sidecar_provenance() {
  local d="${PROVENANCE_SIDECAR_DIR:-}"
  if [[ -z "$d" ]]; then printf 'null'; return; fi
  local p="$d/build-provenance.json"
  if [[ ! -f "$p" ]]; then printf '{ "status": "absent" }'; return; fi
  # Parsed with sed, not python3/jq: this emitter also runs on the mac VM, whose
  # /bin/bash is 3.2 and whose interpreter set is not ours to assume. The input is
  # THIS script's own output format, so the shape is guaranteed, not hoped for.
  local _head _built _sha
  _head="$(sed -n 's/.*"gitHead"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$p" | head -1)"
  _built="$(sed -n 's/.*"builtAtUtc"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$p" | head -1)"
  # serve.mjs's own sha256 is the CONTENT identity of the packed half — the one field
  # that answers "are these the bytes I think they are" without trusting a timestamp.
  _sha="$(grep '"name": "serve.mjs"' "$p" | sed -n 's/.*"sha256"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
  printf '{ "gitHead": "%s", "builtAtUtc": "%s", "serveMjsSha256": "%s" }' \
    "${_head:-unknown}" "${_built:-unknown}" "${_sha:-unknown}"
}

# Artifact name: relative to OUT_DIR when under it, else basename (see header).
_OUT_REAL="$(realpath "$OUT_DIR")"
_name() {
  local rp; rp="$(realpath "$1")"
  if [[ "$rp" == "$_OUT_REAL"/* ]]; then printf '%s' "${rp#"$_OUT_REAL"/}"; else basename "$1"; fi
}

PROV="$OUT_DIR/build-provenance.json"

# A metadata-only recovery must not silently relabel bytes that already have an
# attestation. That is how the 0.0.18 Windows recovery replaced the cutter's
# baked short SHA (2363b77a) with the full source commit: both values named the
# same commit, but only one was compiled into /api/health. Detect the strong
# case we can prove locally — the existing record names the exact same complete
# artifact set by path, byte count, and sha256 — and make identity changes an
# explicit compare-and-swap operation. A genuinely fresh build has different
# artifact bytes and remains free to replace an older record without a flag.
_existing_artifact_rows() {
  # Parse both this emitter's compact artifact lines and a jq-pretty-printed
  # record. The latter is the exact 0.0.18 recovery shape that exposed this
  # bug. Keep this POSIX-awk-only: the emitter also runs on the mac builder.
  awk '
    function string_field(line, key, value) {
      value = line
      sub("^.*\\\"" key "\\\"[[:space:]]*:[[:space:]]*\\\"", "", value)
      sub("\\\".*$", "", value)
      return value
    }
    function number_field(line, key, value) {
      value = line
      sub("^.*\\\"" key "\\\"[[:space:]]*:[[:space:]]*", "", value)
      sub("[^0-9].*$", "", value)
      return value
    }
    /"name"[[:space:]]*:/ { name = string_field($0, "name") }
    /"bytes"[[:space:]]*:/ { bytes = number_field($0, "bytes") }
    /"sha256"[[:space:]]*:/ { sha = string_field($0, "sha256") }
    /"sig"[[:space:]]*:/ {
      if (name != "" && bytes != "" && sha != "") print name "\t" bytes "\t" sha
      name = bytes = sha = ""
    }
  ' "$1"
}

_existing_artifacts_match() {
  [[ -f "$PROV" ]] || return 1
  local current_rows existing_rows f
  current_rows="$({
    for f in "$@"; do
      [[ -e "$f" ]] || continue
      printf '%s\t%s\t%s\n' \
        "$(_name "$f")" "$(_bytes "$f")" "$(sha256sum "$f" | cut -d' ' -f1)"
    done
  } | LC_ALL=C sort)"
  existing_rows="$(_existing_artifact_rows "$PROV" | LC_ALL=C sort)"
  [[ -n "$current_rows" && "$existing_rows" == "$current_rows" ]]
}

if _existing_artifacts_match "$@"; then
  _existing_version="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$PROV" | head -1)"
  _existing_build_sha="$(sed -n 's/.*"buildSha"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$PROV" | head -1)"
  [[ -n "$_existing_version" && -n "$_existing_build_sha" ]] || {
    echo "ERROR: existing $PROV matches the current artifact bytes but lacks version/buildSha; refusing to replace an unreadable baked identity" >&2
    exit 1
  }
  if [[ "$_existing_version" != "$VERSION" ]]; then
    [[ "${PROVENANCE_REPLACE_VERSION_FROM:-}" == "$_existing_version" ]] || {
      echo "ERROR: existing $PROV attests these exact artifact bytes as version $_existing_version; refusing to rewrite their baked version as $VERSION" >&2
      echo "       For a verified metadata repair, set PROVENANCE_REPLACE_VERSION_FROM=$_existing_version (compare-and-swap)." >&2
      exit 1
    }
  fi
  if [[ "$_existing_build_sha" != "$BUILD_SHA" ]]; then
    [[ "${PROVENANCE_REPLACE_BUILD_SHA_FROM:-}" == "$_existing_build_sha" ]] || {
      echo "ERROR: existing $PROV attests these exact artifact bytes as buildSha $_existing_build_sha; refusing to rewrite their baked identity as $BUILD_SHA" >&2
      echo "       Source-commit equivalence is insufficient: /api/health reports the exact compiled string." >&2
      echo "       For a verified metadata repair, set PROVENANCE_REPLACE_BUILD_SHA_FROM=$_existing_build_sha (compare-and-swap)." >&2
      exit 1
    }
  fi
fi

{
  printf '{\n'
  printf '  "version": "%s",\n'   "$VERSION"
  printf '  "buildSha": "%s",\n'  "$BUILD_SHA"
  printf '  "reused": %s,\n'      "$REUSED"
  printf '  "gitHead": "%s",\n'   "$GIT_HEAD"
  printf '  "gitDirty": %s,\n'    "$GIT_DIRTY"
  printf '  "gitHeadAtEmit": "%s",\n' "$GIT_HEAD_AT_EMIT"
  printf '  "gitDirtyAtEmit": %s,\n' "$GIT_DIRTY_AT_EMIT"
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
  # WI-37746: always present (null when no host was baked), so a MISSING key
  # unambiguously means "a pre-WI-37746 emitter produced this" rather than
  # "nothing was baked" — upload-release.sh treats those two cases differently.
  printf '  "releaseHostSha256": %s,\n' "$(_release_host_fp)"
  # EI-20086238555902880: always present (null when the leg named no sidecar), so a
  # MISSING key means "a pre-EI-20086238555902880 emitter wrote this" rather than
  # "nothing was packed" — the same present-vs-missing distinction releaseHostSha256
  # relies on, and the reason neither is emitted only when non-empty.
  printf '  "sidecar": %s,\n' "$(_sidecar_provenance)"
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
