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
NODE_VERSION="${NODE_VERSION:-24.15.0}"
NODE_VERSION="${NODE_VERSION#v}"
if ! [[ "$NODE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "ERROR: NODE_VERSION must be an exact Node release (for example 24.15.0); got '$NODE_VERSION'" >&2
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
