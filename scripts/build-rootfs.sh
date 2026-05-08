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
NODE_VERSION="${NODE_VERSION:-22}"
PNPM_VERSION="${PNPM_VERSION:-9.15.0}"
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/resources"
OUT_TARBALL="${OUT_DIR}/papercup-runtime.tar.gz"
CONTAINER="papercup-runtime-build-$$"

mkdir -p "$OUT_DIR"

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
  postgresql-client \
  overmind \
  tmux \
  ripgrep

# Node + pnpm via fnm (faster + reproducible than nvm).
if ! command -v fnm >/dev/null 2>&1; then
  curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell
  export PATH="$HOME/.local/share/fnm:$PATH"
  fnm install "${NODE_VERSION:-22}"
  fnm default "${NODE_VERSION:-22}"
fi

# pnpm
npm install -g "pnpm@${PNPM_VERSION:-9.15.0}"

# Papercup repo location convention.
mkdir -p /home/$DEFAULT_USER/papercup
chown -R "$DEFAULT_USER:$DEFAULT_USER" /home/$DEFAULT_USER

apt-get clean
rm -rf /var/lib/apt/lists/*

echo "papercup bootstrap complete"
EOF

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

trap "docker rm -f $CONTAINER >/dev/null 2>&1 || true" EXIT
docker start -a "$CONTAINER"

# ── Export rootfs as a tarball ───────────────────────────────────────
echo "exporting rootfs to $OUT_TARBALL"
docker export "$CONTAINER" | gzip -9 > "$OUT_TARBALL"

ls -lh "$OUT_TARBALL"
echo "done. ship it as a Tauri resource."
