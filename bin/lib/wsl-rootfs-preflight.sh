#!/usr/bin/env bash
# wsl-rootfs-preflight.sh — the release cut's fail-fast WSL rootfs gate.
#
# Source this file, then call `papercusp_wsl_rootfs_preflight <target ROOT>`,
# where ROOT is the papercusp-desktop checkout being cut. It returns 0 when
# ROOT/src-tauri/resources holds WSL runtime inputs the Windows leg will accept,
# and returns 1 with an actionable message when it does not. It never exits the
# caller.
#
# WHY IT RUNS THE LEG'S OWN CHECK (WI-6554700010042513). The Windows leg refuses
# to pack the rootfs unless `scripts/build-rootfs.sh --verify-artifacts` passes
# (build-windows-cross.sh). That check needs four files to agree: the tracked
# .rootfs-build-stamp, the tracked papercup-rootfs-recipe, the gitignored
# papercup-runtime.tar.gz and the gitignored papercup-bun-linux.zip. It also
# needs the stamp's recipeSha256 to match the CURRENT recipe fingerprint. The
# previous preflight compared only the tarball sha against the stamp. In the
# 0.0.32 cut the tarball matched but the tracked stamp was stale (old recipe,
# no bunArchiveSha256), so the preflight passed and the Windows leg failed
# minutes later, taking the cut down with it. Running the leg's exact check
# here costs seconds.
#
# WHICH build-rootfs.sh. The verifier is the TARGET's script, because the
# recipe fingerprint hashes the target's own bootstrap and Bun helper, which is
# the correct reference for the target's resources. This helper file itself
# belongs to the orchestrator revision and must be sourced from
# $ORCHESTRATOR_HERE/lib, not $ROOT/bin/lib: an exact-source salvage cut runs
# the current release-local.sh against a frozen target (WI-6554700010042517).
#
# OLD TARGETS. A build-rootfs.sh that predates --verify-artifacts ignores the
# unknown flag and runs a FULL docker build, and that build begins by deleting
# papercup-runtime.tar.gz. So the flag is called only when the target script
# implements it. Otherwise this falls back to the sha-only comparison with a
# loud warning.
#
# HYDRATION. Both artifacts are gitignored, so a fresh worktree has neither. A
# missing artifact is copied from a donor only when its sha256 equals the
# TRACKED stamp's value for it. Donors, in order:
#   - PAPERCUSP_ROOTFS_DONOR: a papercup-runtime.tar.gz path (its directory is
#     also searched for the zip) or a resources directory;
#   - one level of sibling checkouts in the workspace (never a deep find).

# shellcheck source=portable-sha256.sh
source "$(dirname "${BASH_SOURCE[0]}")/portable-sha256.sh"

PAPERCUSP_WSL_ROOTFS_TARBALL=papercup-runtime.tar.gz
PAPERCUSP_WSL_BUN_ARCHIVE=papercup-bun-linux.zip

# _papercusp_wsl_stamp_field STAMP KEY — prints the string value or nothing.
_papercusp_wsl_stamp_field() {
  python3 -c 'import json,sys
v = json.load(open(sys.argv[1])).get(sys.argv[2], "")
print(v if isinstance(v, str) else "")' "$1" "$2" 2>/dev/null || true
}

# _papercusp_wsl_donor_dirs ROOT — candidate resources directories, one per line.
_papercusp_wsl_donor_dirs() {
  local root="$1" donor="${PAPERCUSP_ROOTFS_DONOR:-}" ws d
  if [[ -n "$donor" ]]; then
    if [[ -d "$donor" ]]; then printf '%s\n' "$donor"; else printf '%s\n' "$(dirname "$donor")"; fi
  fi
  ws="$(cd "$root/../.." 2>/dev/null && pwd)" || return 0
  for d in "$ws"/*/papercusp-desktop/src-tauri/resources "$ws"/papercusp-desktop/src-tauri/resources; do
    [[ -d "$d" ]] && printf '%s\n' "$d"
  done
  return 0
}

# _papercusp_wsl_hydrate ROOT NAME WANT_SHA — copy a verified donor into place.
_papercusp_wsl_hydrate() {
  local root="$1" name="$2" want="$3"
  local dest="${4:-$root/src-tauri/resources}/$name" cand dir explicit=""
  if [[ -n "${PAPERCUSP_ROOTFS_DONOR:-}" && -f "${PAPERCUSP_ROOTFS_DONOR}" && "$name" == "$PAPERCUSP_WSL_ROOTFS_TARBALL" ]]; then
    explicit="$PAPERCUSP_ROOTFS_DONOR"
  fi
  while IFS= read -r cand; do
    [[ -n "$cand" && -f "$cand" ]] || continue
    [[ -e "$dest" && "$cand" -ef "$dest" ]] && continue
    if [[ "$(papercusp_portable_sha256 "$cand")" == "$want" ]]; then
      cp -- "$cand" "$dest.tmp.$$" && mv -f -- "$dest.tmp.$$" "$dest" || {
        rm -f -- "$dest.tmp.$$"
        echo "ERROR: could not copy the verified donor $cand to $dest" >&2
        return 1
      }
      echo "==> WSL $name hydrated from $cand (sha256 verified against the tracked stamp)"
      return 0
    fi
    echo "    (donor rejected: sha256 differs from the tracked stamp: $cand)"
  done < <(
    [[ -n "$explicit" ]] && printf '%s\n' "$explicit"
    while IFS= read -r dir; do printf '%s\n' "$dir/$name"; done < <(_papercusp_wsl_donor_dirs "$root")
  )
  return 1
}

# --read-only is used by release:cut before creating a managed task. If inputs
# need donors, validate a disposable view outside the frozen checkout. Regular
# files (not symlinks) are required by the target verifier; hardlink when possible
# and copy otherwise. The verifier still comes from ROOT, so its recipe and Bun
# pin remain authoritative. No input in ROOT is hydrated or changed.
papercusp_wsl_rootfs_preflight() {
  local root="${1:?papercusp_wsl_rootfs_preflight: ROOT is required}"
  case "${2:-}" in
    '') _papercusp_wsl_rootfs_check "$root" "$root/src-tauri/resources" ;;
    --read-only) _papercusp_wsl_rootfs_readiness "$root" ;;
    *) echo "ERROR: unknown WSL preflight mode: $2" >&2; return 2 ;;
  esac
}

_papercusp_wsl_rootfs_readiness() (
  local root="$1" res="$1/src-tauri/resources" view name
  # Reject unmaterializable stamps before copying any large input to scratch.
  _papercusp_wsl_rootfs_metadata "$root" "$res" || return 1
  # The common already-materialized case needs no scratch files or copies.
  if [[ -f "$res/$PAPERCUSP_WSL_ROOTFS_TARBALL" && -f "$res/$PAPERCUSP_WSL_BUN_ARCHIVE" ]]; then
    _papercusp_wsl_rootfs_check "$root" "$res"
    return $?
  fi
  view="$(mktemp -d "${TMPDIR:-/tmp}/papercusp-wsl-readiness.XXXXXX")" || return 1
  trap 'rm -rf -- "$view"' EXIT
  for name in .rootfs-build-stamp papercup-rootfs-recipe "$PAPERCUSP_WSL_ROOTFS_TARBALL" "$PAPERCUSP_WSL_BUN_ARCHIVE"; do
    if [[ -L "$res/$name" ]]; then
      echo "ERROR: rootfs input must be a regular file: $name" >&2
      return 1
    fi
    [[ -f "$res/$name" ]] || continue
    ln -- "$res/$name" "$view/$name" 2>/dev/null ||
      cp -p -- "$res/$name" "$view/$name" || return 1
  done
  _papercusp_wsl_rootfs_check "$root" "$view"
)

_papercusp_wsl_rootfs_metadata() {
  local root="$1" res="$2"
  local stamp="$res/.rootfs-build-stamp"
  local name key want

  if [[ ! -f "$stamp" ]]; then
    echo "ERROR: WITH_WINDOWS=1 but the tracked rootfs stamp is missing: $stamp" >&2
    echo "       Run scripts/build-rootfs.sh in $root, or cut with WITH_WINDOWS=0." >&2
    return 1
  fi

  for name in "$PAPERCUSP_WSL_ROOTFS_TARBALL" "$PAPERCUSP_WSL_BUN_ARCHIVE"; do
    [[ -f "$res/$name" ]] && continue
    case "$name" in
      "$PAPERCUSP_WSL_ROOTFS_TARBALL") key=rootfsSha256 ;;
      *) key=bunArchiveSha256 ;;
    esac
    want="$(_papercusp_wsl_stamp_field "$stamp" "$key")"
    if [[ -z "$want" ]]; then
      echo "ERROR: $name is missing and $stamp has no $key, so no donor can be verified." >&2
      echo "       The tracked stamp predates this artifact. Re-run scripts/build-rootfs.sh and let the new stamp be committed." >&2
      return 1
    fi
  done
}

_papercusp_wsl_rootfs_check() {
  local root="$1" res="$2"
  local stamp="$res/.rootfs-build-stamp" verifier="$root/scripts/build-rootfs.sh"
  local name key want have
  _papercusp_wsl_rootfs_metadata "$root" "$res" || return 1
  for name in "$PAPERCUSP_WSL_ROOTFS_TARBALL" "$PAPERCUSP_WSL_BUN_ARCHIVE"; do
    [[ -f "$res/$name" ]] && continue
    case "$name" in
      "$PAPERCUSP_WSL_ROOTFS_TARBALL") key=rootfsSha256 ;;
      *) key=bunArchiveSha256 ;;
    esac
    want="$(_papercusp_wsl_stamp_field "$stamp" "$key")"
    echo "==> WSL $name absent (gitignored, so a fresh worktree never has one); attempting VERIFIED hydration"
    _papercusp_wsl_hydrate "$root" "$name" "$want" "$res" || {
      echo "ERROR: WITH_WINDOWS=1 but no $name matching the TRACKED stamp was found." >&2
      echo "       want $key: $want" >&2
      echo "       Run scripts/build-rootfs.sh, set PAPERCUSP_ROOTFS_DONOR to a resources directory or" >&2
      echo "       papercup-runtime.tar.gz path holding matching artifacts, or cut with WITH_WINDOWS=0." >&2
      echo "       (Failing here costs seconds; failing in the Windows leg aborts the whole cut.)" >&2
      return 1
    }
  done

  if [[ -f "$verifier" ]] && grep -qF -- '"--verify-artifacts"' "$verifier"; then
    if ! PAPERCUSP_RUNTIME_PLATFORM=linux/amd64 PAPERCUSP_ROOTFS_OUT_DIR="$res" \
        bash "$verifier" --verify-artifacts; then
      echo "ERROR: WSL runtime inputs in $res fail the Windows leg's own check" >&2
      echo "       (build-rootfs.sh --verify-artifacts, which build-windows-cross.sh runs before packing)." >&2
      echo "       A stale recipe means the tracked stamp no longer matches this commit's bootstrap:" >&2
      echo "       re-run scripts/build-rootfs.sh in a checkout of this commit and let the stamp be committed." >&2
      return 1
    fi
    echo "==> WSL rootfs, Bun archive and recipe verified by the target's build-rootfs.sh --verify-artifacts"
    return 0
  fi

  echo "WARN: $verifier does not implement --verify-artifacts. Calling it would start a FULL rebuild" >&2
  echo "      that deletes $PAPERCUSP_WSL_ROOTFS_TARBALL, so only the stamp's sha256 values are compared." >&2
  for name in "$PAPERCUSP_WSL_ROOTFS_TARBALL" "$PAPERCUSP_WSL_BUN_ARCHIVE"; do
    case "$name" in
      "$PAPERCUSP_WSL_ROOTFS_TARBALL") key=rootfsSha256 ;;
      *) key=bunArchiveSha256 ;;
    esac
    want="$(_papercusp_wsl_stamp_field "$stamp" "$key")"
    [[ -n "$want" ]] || continue
    if [[ ! -f "$res/$name" ]]; then
      echo "ERROR: $res/$name is missing." >&2
      return 1
    fi
    have="$(papercusp_portable_sha256 "$res/$name")"
    if [[ "$have" != "$want" ]]; then
      echo "ERROR: $name does not match the tracked .rootfs-build-stamp; refusing to pack it." >&2
      echo "       want $want" >&2
      echo "       have $have  ($res/$name)" >&2
      echo "       Re-run scripts/build-rootfs.sh to regenerate it for this commit." >&2
      return 1
    fi
  done
  echo "==> WSL rootfs verified against the tracked stamp (sha only; target predates --verify-artifacts)"
  return 0
}
