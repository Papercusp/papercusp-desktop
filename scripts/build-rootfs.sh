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
OUT_TARBALL="${OUT_DIR}/papercup-runtime.tar.gz"
CONTAINER="papercup-runtime-build-$$"

mkdir -p "$OUT_DIR"
# A failed export must leave no final-path artifact for a later build guard to
# mistake for a complete rootfs. Publish the successful export with rename(2)
# below so readers see either no file or the complete tarball.
rm -f "$OUT_TARBALL"
OUT_TMP="$(mktemp "${OUT_TARBALL}.tmp.XXXXXX")"

cleanup() {
  local status="$?"
  trap - EXIT
  [[ -z "$OUT_TMP" ]] || rm -f "$OUT_TMP"
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

# ── Bootstrap script that runs inside the container ──────────────────
# This script ALSO ships inside the rootfs at /opt/papercup/bootstrap so
# wsl_setup::run_bootstrap() can re-run it on the user's machine after
# the wsl --import completes (e.g. if the user moves to a new repo).
read -r -d '' BOOTSTRAP_SH <<'EOF' || true
#!/usr/bin/env bash
set -euo pipefail

# Configure the default user. WSL's default-user is set via
# /etc/wsl.conf; create the user if missing.
DEFAULT_USER="papercup"
if ! id "$DEFAULT_USER" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "$DEFAULT_USER"
  # Minimal images ship without sudo — the dir appears only when the
  # package installs (added to the apt list below); create it now.
  mkdir -p /etc/sudoers.d
  echo "$DEFAULT_USER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/papercup
  chmod 0440 /etc/sudoers.d/papercup
fi

cat > /etc/wsl.conf <<WSLCONF
[user]
default=$DEFAULT_USER

[boot]
systemd=true

[interop]
enabled=true
appendWindowsPath=false
WSLCONF

# Base packages.
#
# libasound2t64 is NOT audio support — do not drop it as "WSL has no sound card"
# (WI-4448). The chat dock's `pui` binary links libasound.so.2 via its voice-mode
# cpal dependency, so WITHOUT this package pui cannot even be LOADED inside the
# distro ("error while loading shared libraries") and the Windows dock opens a
# zellij session whose chat pane is a dead binary — the same blank-pane failure
# linux-chat-dock-parity-2026-06-27 already fixed once on Linux. The dynamic
# linker needs the .so present at exec time whether or not a sound device exists.
# (Ubuntu 24.04 renamed libasound2 → libasound2t64 in the t64 transition.)
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  build-essential \
  ca-certificates \
  curl \
  git \
  jq \
  unzip \
  python3 \
  python3-pip \
  sudo \
  gnupg \
  postgresql-client \
  tmux \
  xz-utils \
  ripgrep \
  libasound2t64

# overmind is not in the Ubuntu archive — fetch the release binary.
OVERMIND_VERSION="${OVERMIND_VERSION:-2.5.1}"
curl -fsSL "https://github.com/DarthSim/overmind/releases/download/v${OVERMIND_VERSION}/overmind-v${OVERMIND_VERSION}-linux-amd64.gz" \
  | gunzip > /usr/local/bin/overmind
chmod +x /usr/local/bin/overmind
overmind --version

# kopia — the backup engine ("Enabled by default" per the Setup Wizard);
# without it the Backups feature is unavailable in the Windows runtime.
# Official APT repo per kopia.io/docs/installation.
# --batch --yes: this script re-runs at FIRST BOOT as /opt/papercup/bootstrap
# (see header) — the keyring baked at image-build time already exists then,
# and bare `gpg --dearmor` hangs forever on an interactive "Overwrite? (y/N)"
# prompt (wedged the Windows first-run live, 2026-06-11). Every step in this
# script must stay idempotent AND prompt-free.
curl -fsSL https://kopia.io/signing-key \
  | gpg --batch --yes --dearmor -o /usr/share/keyrings/kopia-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/kopia-keyring.gpg] http://packages.kopia.io/apt/ stable main" \
  > /etc/apt/sources.list.d/kopia.list
apt-get update
apt-get install -y --no-install-recommends kopia
kopia --version

# Node into /usr/local — it must be on the DEFAULT non-login PATH: the
# desktop spawns `wsl.exe --exec node` (no shell, no profile read), and
# appendWindowsPath=false above leaves PATH = /usr/local/bin:/usr/bin:…
# Shim/profile installs (fnm, nvm) are invisible there. Keep this exact
# version in lockstep with the bundled sidecar so native addons load under the
# same ABI. The URL is pinned to a release, never a moving latest-v* alias.
NODE_VERSION="${NODE_VERSION:-24.18.1}"
NODE_VERSION="${NODE_VERSION#v}"
if ! [[ "$NODE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "ERROR: NODE_VERSION must be an exact Node release (for example 24.18.1); got '$NODE_VERSION'" >&2
  exit 2
fi
NODE_TARBALL="node-v${NODE_VERSION}-linux-x64.tar.xz"
curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TARBALL}" \
  | tar -xJ -C /usr/local --strip-components=1
node --version

# pnpm
npm install -g "pnpm@${PNPM_VERSION:-9.15.0}"

# Papercup repo location convention.
mkdir -p /home/$DEFAULT_USER/papercup
chown -R "$DEFAULT_USER:$DEFAULT_USER" /home/$DEFAULT_USER

# ── install-size trim (install-size-audit 2026-07-07, owner-directed) ────────
# Drop content the RUNTIME never needs — package docs, man/info pages, and
# non-English locale catalogs — plus build/download caches. This deliberately
# does NOT touch build-essential, /usr/include headers, or any library the
# native-module rebuilds (better-sqlite3, node-pty via node-gyp) depend on, so
# no functionality is lost; it only removes reference material + caches, which
# shrinks the exported rootfs (papercup-runtime.tar.gz) on Windows. Every rm is
# tolerant of an already-absent path (safe under `set -euo pipefail`).
rm -rf \
  /usr/share/doc/* \
  /usr/share/man/* \
  /usr/share/info/* \
  /usr/share/doc-base/* \
  /usr/share/lintian/* \
  /root/.npm /root/.cache \
  /tmp/node-compile-cache
# Locales: keep C/POSIX + en*, drop the rest.
find /usr/share/locale -mindepth 1 -maxdepth 1 -type d \
  ! -name 'en*' ! -name 'C*' ! -name 'POSIX' -exec rm -rf {} + 2>/dev/null || true
npm cache clean --force 2>/dev/null || true

apt-get clean
rm -rf /var/lib/apt/lists/*

echo "papercup bootstrap complete"
EOF

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
  printf '%s\n%s\n%s\n%s\n' \
    "$UBUNTU_IMAGE" "$NODE_VERSION" "$PNPM_VERSION" "$BOOTSTRAP_SH" \
  | { sha256sum 2>/dev/null || shasum -a 256; } | cut -d' ' -f1
}

if [[ "${1:-}" == "--print-recipe-fingerprint" ]]; then
  recipe_fingerprint
  exit 0
fi

# ── Run the bootstrap inside the container ───────────────────────────
docker pull "$UBUNTU_IMAGE"

# Use `docker create` then `docker start -a` so we get the container ID
# back and can `docker export` it. `docker run` would tear down on exit.
docker create \
  --name "$CONTAINER" \
  -e NODE_VERSION="$NODE_VERSION" \
  -e PNPM_VERSION="$PNPM_VERSION" \
  "$UBUNTU_IMAGE" \
  bash -c "$BOOTSTRAP_SH && mkdir -p /opt/papercup && cat > /opt/papercup/bootstrap << 'BS'
$BOOTSTRAP_SH
BS
chmod +x /opt/papercup/bootstrap"

docker start -a "$CONTAINER"

# ── Export rootfs as a tarball ───────────────────────────────────────
echo "exporting rootfs to $OUT_TARBALL"
docker export "$CONTAINER" | gzip -9 > "$OUT_TMP"
mv -f "$OUT_TMP" "$OUT_TARBALL"
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
{
  printf '{\n'
  printf '  "recipeSha256": "%s",\n' "${_recipe_sha:-}"
  printf '  "rootfsSha256": "%s",\n' "${_rootfs_sha:-}"
  printf '  "builtAtUtc": "%s",\n'   "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '  "epochSec": %s\n'        "$(date +%s)"
  printf '}\n'
} > "${OUT_DIR}/.rootfs-build-stamp"
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
printf '%s\n' "$BOOTSTRAP_SH" > "${OUT_DIR}/papercup-bootstrap.sh"
printf '%s\n' "${_recipe_sha:-}" > "${OUT_DIR}/papercup-rootfs-recipe"
echo "→ shipped papercup-bootstrap.sh + papercup-rootfs-recipe as resources (WI-4478)"

echo "done. ship it as a Tauri resource."
