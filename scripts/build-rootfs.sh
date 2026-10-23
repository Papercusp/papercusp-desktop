#!/usr/bin/env bash
# Build papercup-runtime.tar.gz — the WSL distro tarball we import on
# first launch on Windows.
#
# Strategy:
#   1. Pull the official Ubuntu base image.
#   2. Run our bootstrap inside a container (installs node, pnpm,
#      papercup deps, configures the default user, etc.).
#   3. Export the container's rootfs as a tarball.
#   4. Copy the tarball into src-tauri/resources/ so Tauri bundles it.
#
# Output: src-tauri/resources/papercup-runtime.tar.gz (~250–400 MB).
#
# Run this in CI (or manually) before a Windows release build. The
# actual `wsl --import` happens on the user's machine via wsl_setup.rs;
# this script is only about producing the tarball ahead of time.
# When invoking through pc-heavy, declare UBUNTU_IMAGE, NODE_VERSION,
# PNPM_VERSION, PAPERCUSP_RUNTIME_PLATFORM and PAPERCUSP_ROOTFS_OUT_DIR in
# PC_HEAVY_KEY_ENV, or disable coalescing. Distinct output targets must never
# inherit another target's successful command result.

set -euo pipefail

UBUNTU_IMAGE="${UBUNTU_IMAGE:-ubuntu:24.04}"
# Windows launches the sidecar with `wsl.exe --exec node`, so the guest's
# runtime must match the exact Node release used to build the sidecar's native
# modules (build-desktop-sidecar.sh defaults to v24.18.1). A major-only,
# latest-v* lookup can silently produce an ABI mismatch and is not reproducible.
NODE_VERSION="${NODE_VERSION:-24.18.1}"
NODE_VERSION="${NODE_VERSION#v}"
if ! [[ "$NODE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "ERROR: NODE_VERSION must be an exact Node release (for example 24.18.1); got '$NODE_VERSION'" >&2
  exit 2
fi
PNPM_VERSION="${PNPM_VERSION:-9.15.0}"
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/resources"
OUTPUT_DIR="${PAPERCUSP_ROOTFS_OUT_DIR:-$OUT_DIR}"
OUT_TARBALL="${OUTPUT_DIR}/papercup-runtime.tar.gz"
RUNTIME_PLATFORM="${PAPERCUSP_RUNTIME_PLATFORM:-}"
if [[ -z "$RUNTIME_PLATFORM" ]]; then
  case "$(uname -m)" in
    x86_64) RUNTIME_PLATFORM=linux/amd64 ;;
    aarch64|arm64) RUNTIME_PLATFORM=linux/arm64 ;;
    *) echo "ERROR: set PAPERCUSP_RUNTIME_PLATFORM to linux/amd64 or linux/arm64" >&2; exit 2 ;;
  esac
fi
case "$RUNTIME_PLATFORM" in
  linux/amd64|linux/arm64) ;;
  *) echo "ERROR: unsupported runtime platform: $RUNTIME_PLATFORM" >&2; exit 2 ;;
esac
CONTAINER="papercup-runtime-build-$$"

# The shipped bootstrap is the single recipe source. Keeping an embedded copy
# here previously discarded fixes (including network preflight) on regeneration.
BOOTSTRAP_FILE="${OUT_DIR}/papercup-bootstrap.sh"
test -s "$BOOTSTRAP_FILE" || { echo "missing bootstrap: $BOOTSTRAP_FILE" >&2; exit 2; }
BOOTSTRAP_SH="$(cat "$BOOTSTRAP_FILE")"
BUN_HELPER_FILE="${OUT_DIR}/papercup-bun-runtime.py"
test -s "$BUN_HELPER_FILE" || { echo "missing Bun input helper: $BUN_HELPER_FILE" >&2; exit 2; }
BUN_HELPER_SH="$(cat "$BUN_HELPER_FILE")"

# ── Recipe fingerprint (WI-4448) ─────────────────────────────────────
# THE thing that determines what ends up inside the rootfs: the bootstrap we run
# in the container, the base image, and the pinned runtime versions. Deliberately
# NOT a hash of this whole file — a comment or a stamp-block edit must not
# invalidate a perfectly good tarball. A gate that cries wolf gets switched off,
# and then it is not a gate.
#
# This is the SINGLE SOURCE OF TRUTH for the fingerprint: build-windows-on-vm.sh
# re-derives it by calling `build-rootfs.sh --print-recipe-fingerprint` rather
# than reimplementing the hash, so the producer and the checker cannot drift
# apart. (Drift between two hand-maintained copies of the same knowledge is
# precisely what let .papercusp/ into the release bundle — WI-4419.)
recipe_fingerprint() {
  printf '%s\n%s\n%s\n%s\n%s\n%s\n' \
    "$UBUNTU_IMAGE" "$NODE_VERSION" "$PNPM_VERSION" "$BOOTSTRAP_SH" "$RUNTIME_PLATFORM" "$BUN_HELPER_SH" \
  | { sha256sum 2>/dev/null || shasum -a 256; } | cut -d' ' -f1
}

if [[ "${1:-}" == "--print-recipe-fingerprint" ]]; then
  recipe_fingerprint
  exit 0
fi

case "$RUNTIME_PLATFORM" in
  linux/amd64) BUN_ARCH=x64 ;;
  linux/arm64) BUN_ARCH=arm64 ;;
esac

# Packaging is read-only: a receipt for the rootfs alone cannot vouch for the
# separate Linux ZIP that existing distros consume during upgrades.
if [[ "${1:-}" == "--verify-artifacts" ]]; then
  python3 "$BUN_HELPER_FILE" verify-rootfs --target-os linux --target-arch "$BUN_ARCH" \
    --resource-dir "$OUTPUT_DIR" --recipe-sha256 "$(recipe_fingerprint)"
  exit 0
fi

# pc-heavy keys environment inputs only when the caller declares them BEFORE
# its wrapper starts. Catch a missing declaration in the leader, before any
# Docker work or output mutation, so a follower cannot inherit a false success.
if [[ -n "${PC_HEAVY_ADMISSION_ID:-}" ]]; then
  case "${PC_HEAVY_COALESCE:-1}" in
    0|off|OFF|false|FALSE|no|NO) ;;
    *)
      _rootfs_key_env=" $(printf '%s' "${PC_HEAVY_KEY_ENV:-}" | tr ',[:space:]' ' ') "
      for _rootfs_input in UBUNTU_IMAGE NODE_VERSION PNPM_VERSION PAPERCUSP_RUNTIME_PLATFORM PAPERCUSP_ROOTFS_OUT_DIR; do
        if [[ "$_rootfs_key_env" != *" $_rootfs_input "* ]]; then
          echo "ERROR: coalesced rootfs build requires $_rootfs_input in PC_HEAVY_KEY_ENV before pc-heavy, or PC_HEAVY_COALESCE=0" >&2
          exit 2
        fi
      done
      unset _rootfs_key_env _rootfs_input
      ;;
  esac
fi

# Docker can pull a foreign-architecture image without being able to execute
# it. Check that boundary before bootstrap work or replacing a valid archive.
docker pull --platform "$RUNTIME_PLATFORM" "$UBUNTU_IMAGE"
if ! docker run --rm --platform "$RUNTIME_PLATFORM" "$UBUNTU_IMAGE" /bin/true; then
  echo "ERROR: Docker cannot execute $RUNTIME_PLATFORM; configure a native runner or QEMU binfmt support before building the runtime." >&2
  exit 2
fi

# A failed export must leave no final-path artifact for a later build guard to
# mistake for a complete rootfs. Publish the successful export with rename(2)
# below so readers see either no file or the complete tarball. Keep this
# destructive cleanup AFTER the read-only fingerprint fast path: callers use
# --print-recipe-fingerprint to validate an existing tarball and that probe
# must never remove the artifact it is checking (EI-21677432340139970).
mkdir -p "$OUTPUT_DIR"
rm -f "$OUT_TARBALL"
OUT_TMP="$(mktemp "${OUT_TARBALL}.tmp.XXXXXX")"
BUN_ARCHIVE_TMP="$(mktemp "${OUTPUT_DIR}/.bun-linux.XXXXXX")"

cleanup() {
  local status="$?"
  trap - EXIT
  [[ -z "$OUT_TMP" ]] || rm -f "$OUT_TMP"
  [[ -z "$BUN_ARCHIVE_TMP" ]] || rm -f "$BUN_ARCHIVE_TMP"
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

# ── Run the bootstrap inside the container ───────────────────────────
# Use `docker create` then `docker start -a` so we get the container ID
# back and can `docker export` it. `docker run` would tear down on exit.
docker create \
  --platform "$RUNTIME_PLATFORM" \
  --name "$CONTAINER" \
  -e NODE_VERSION="$NODE_VERSION" \
  -e PNPM_VERSION="$PNPM_VERSION" \
  -e PAPERCUSP_ROOTFS_BUILD=1 \
  "$UBUNTU_IMAGE" \
  bash -c "mkdir -p /opt/papercup && mv /tmp/papercup-bun-runtime.py /opt/papercup/papercup-bun-runtime.py && $BOOTSTRAP_SH && cat > /opt/papercup/bootstrap << 'BS'
$BOOTSTRAP_SH
BS
chmod +x /opt/papercup/bootstrap"

docker cp "$BUN_HELPER_FILE" "$CONTAINER:/tmp/papercup-bun-runtime.py"
docker start -a "$CONTAINER"
# Retain the exact validated Linux input outside disposable /root caches.
# The installed Server transfers it into old distros before their bootstrap.
docker cp "$CONTAINER:/opt/papercup/papercup-bun-linux.zip" "$BUN_ARCHIVE_TMP"
test -s "$BUN_ARCHIVE_TMP"
python3 "$BUN_HELPER_FILE" verify-archive --target-os linux --target-arch "$BUN_ARCH" \
  --archive "$BUN_ARCHIVE_TMP"

# ── Export rootfs as a tarball ───────────────────────────────────────
echo "exporting rootfs to $OUT_TARBALL"
docker export "$CONTAINER" | gzip -9 > "$OUT_TMP"
mv -f "$OUT_TMP" "$OUT_TARBALL"
mv -f "$BUN_ARCHIVE_TMP" "${OUTPUT_DIR}/papercup-bun-linux.zip"
OUT_TMP=""

ls -lh "$OUT_TARBALL"

# ── Freshness stamp (WI-4448) ────────────────────────────────────────
# The Windows cut NEVER rebuilds this tarball — bin/build-windows-on-vm.sh only
# asserts it EXISTS and ships whatever is on disk. So editing the recipe above
# (the apt list, the bootstrap) without re-running THIS script means the fix
# never reaches the distro, the build is still GREEN, and it fails only in the
# user's hands. That is exactly how libasound2t64 was nearly shipped missing,
# which would have left the Windows chat dock opening onto a dead `pui` — a
# blank pane, the same class we already fixed once on Linux.
#
# So stamp the RECIPE alongside the output. build-windows-on-vm.sh re-derives the
# fingerprint and refuses to package on a mismatch, turning "changed the recipe,
# forgot to rebuild" into a loud build failure instead of a shipped-dead distro.
# Same fail-closed contract as the sidecar stamp (P-004 / D-003).
# shellcheck source=../bin/lib/portable-sha256.sh
source "$(cd "$(dirname "$0")/.." && pwd)/bin/lib/portable-sha256.sh"
_recipe_sha="$(recipe_fingerprint)"
_rootfs_sha="$(papercusp_portable_sha256 "$OUT_TARBALL")"
_bun_archive_sha="$(papercusp_portable_sha256 "${OUTPUT_DIR}/papercup-bun-linux.zip")"
{
  printf '{\n'
  printf '  "recipeSha256": "%s",\n' "${_recipe_sha:-}"
  printf '  "rootfsSha256": "%s",\n' "${_rootfs_sha:-}"
  printf '  "bunArchiveSha256": "%s",\n' "${_bun_archive_sha:-}"
  printf '  "platform": "%s",\n'    "$RUNTIME_PLATFORM"
  printf '  "nodeVersion": "%s",\n' "$NODE_VERSION"
  printf '  "pnpmVersion": "%s",\n' "$PNPM_VERSION"
  printf '  "baseImage": "%s",\n'   "$UBUNTU_IMAGE"
  printf '  "builtAtUtc": "%s",\n'   "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '  "epochSec": %s\n'        "$(date +%s)"
  printf '}\n'
} > "${OUTPUT_DIR}/.rootfs-build-stamp"
echo "→ wrote rootfs freshness stamp (recipe ${_recipe_sha:0:12}…, WI-4448)"

# ── Ship the recipe + the bootstrap AS RESOURCES (WI-4478) ────────────
# The tarball is imported ONLY on a machine with no distro. An existing install
# keeps the distro it imported months ago, forever — `wsl_setup::detect()` sees a
# distro that exists and starts, returns Ready, and never looks at what is inside
# it. So a change made HERE reaches new installs and NOBODY ELSE: every existing
# user updates the app and keeps a distro provisioned by the OLD recipe.
#
# Re-importing would be wrong (it destroys the user's workspaces inside the
# distro, ~23 GB on our own test VM). The bootstrap is idempotent by
# construction, so the fix is to RE-RUN THE CURRENT ONE in the existing distro.
# For that, the app needs two things at runtime that it could not otherwise get:
#   papercup-rootfs-recipe  — the fingerprint of the recipe the SHIPPED tarball
#                             was built from, to compare against the one recorded
#                             inside the distro.
#   papercup-bootstrap.sh   — the CURRENT bootstrap. Re-running the copy already
#                             inside the distro (/opt/papercup/bootstrap) is
#                             useless: that IS the old one.
# Plain (non-dot) filenames: tauri.conf's `resources/*` glob must actually pick
# them up, and the .rootfs-build-stamp above is a BUILD-time artifact only.
# The bootstrap resource is the canonical input read above, not a generated
# copy to overwrite. The container received these exact bytes.
printf '%s\n' "${_recipe_sha:-}" > "${OUTPUT_DIR}/papercup-rootfs-recipe"
echo "→ shipped papercup-bootstrap.sh + papercup-rootfs-recipe as resources (WI-4478)"

echo "done. ship it as a Tauri resource."
