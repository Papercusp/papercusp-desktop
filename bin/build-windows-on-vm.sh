#!/usr/bin/env bash
# Build the Windows x86_64 NSIS installer NATIVELY on the local Windows 11
# QEMU VM (no cross-compile, no CI — see plan
# windows-desktop-release-readiness-2026-06-11 D-001).
#
# The old WITH_WINDOWS=1 lane cross-compiled --target x86_64-pc-windows-gnu;
# that never worked (no cross/mingw toolchain here, and Tauri's supported
# Windows story is MSVC). This script replaces it:
#
#   1. Pack the desktop tree (incl. built sidecar + resources) as a tarball
#   2. scp into the VM, extract to an isolated build dir
#   3. npm install + `tauri build --bundles nsis` under the MSVC env
#   4. Copy installer + updater .sig back to
#      src-tauri/target/windows-vm/bundle/nsis/ for release-local.sh to pick up
#
# Prereqs (one-time, already provisioned on the VM):
#   - VS 2022 (Community or BuildTools) with C++ workload
#   - rustup stable-x86_64-pc-windows-msvc
#   - Node ≥22 on PATH
#   - VM booted: ~/windows-vm/boot-windows.sh  (ssh -p 2223, key papercup-vm-win)
#
# Prereqs (per release, done by release-local.sh before calling this):
#   - bin/build-desktop-sidecar.sh has populated src-tauri/sidecar/
#   - scripts/build-rootfs.sh has produced src-tauri/resources/papercup-runtime.tar.gz
#
# Signing: pass the minisign key through so `createUpdaterArtifacts` can sign.
#   TAURI_SIGNING_PRIVATE_KEY_PATH (host path, default ~/.papercusp/signing/papercusp.key)
#   TAURI_SIGNING_PRIVATE_KEY_PASSWORD (optional)

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

VM_SSH_KEY="${VM_SSH_KEY:-$HOME/.ssh/papercup-vm-win}"
VM_SSH_PORT="${VM_SSH_PORT:-2223}"
VM_SSH_HOST="${VM_SSH_HOST:-user@127.0.0.1}"
VM_BUILD_DIR="${VM_BUILD_DIR:-papercup-build-release}"   # under C:\Users\user\
KEY_FILE="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.papercusp/signing/papercusp.key}"
KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

SSH=(ssh -i "$VM_SSH_KEY" -p "$VM_SSH_PORT" -o ConnectTimeout=10 -o ServerAliveInterval=30 "$VM_SSH_HOST")
SCP=(scp -i "$VM_SSH_KEY" -P "$VM_SSH_PORT" -o ConnectTimeout=10)

fail() { echo "ERROR: $*" >&2; exit 1; }

[[ -d "$ROOT/src-tauri/sidecar/apps" ]] || fail "sidecar not built — run bin/build-desktop-sidecar.sh first"
[[ -f "$ROOT/src-tauri/resources/papercup-runtime.tar.gz" ]] || fail "WSL rootfs missing — run scripts/build-rootfs.sh first"
[[ -f "$KEY_FILE" ]] || fail "signing key not found at $KEY_FILE (bin/setup-signing-key.sh)"
"${SSH[@]}" 'cmd /c echo VM-OK' >/dev/null 2>&1 || fail "VM unreachable on :$VM_SSH_PORT — boot it: ~/windows-vm/boot-windows.sh"

echo "==> packing desktop tree"
TARBALL="$(mktemp /tmp/papercusp-desktop-build-XXXX.tar.gz)"
trap 'rm -f "$TARBALL"' EXIT
# -h dereferences symlinks (node_modules/.bin shims) — Windows tar can't
# create them. Keep sidecar/**/node_modules (runtime deps); drop only the
# desktop repo's own toolchain node_modules.
tar -czhf "$TARBALL" \
  --exclude='.git' \
  --exclude='papercusp-desktop/node_modules' \
  --exclude='papercusp-desktop/web/node_modules' \
  --exclude='src-tauri/target' \
  --exclude='src-tauri/sidecar.tmp.*' \
  --exclude='src-tauri/sidecar.lock*' \
  -C "$ROOT/.." papercusp-desktop
ls -lh "$TARBALL"

echo "==> shipping to VM"
"${SCP[@]}" "$TARBALL" "$VM_SSH_HOST":'C:/Users/user/papercusp-desktop-build.tar.gz' \
  2>/dev/null || "${SCP[@]}" "$TARBALL" "scp://$VM_SSH_HOST:$VM_SSH_PORT/C:/Users/user/papercusp-desktop-build.tar.gz"
"${SCP[@]}" "$KEY_FILE" "$VM_SSH_HOST":'C:/Users/user/papercusp-signing.key'

echo "==> extracting in VM ($VM_BUILD_DIR)"
"${SSH[@]}" "powershell -NoProfile -Command \"Remove-Item -Recurse -Force C:\\Users\\user\\$VM_BUILD_DIR -ErrorAction SilentlyContinue; New-Item -ItemType Directory C:\\Users\\user\\$VM_BUILD_DIR | Out-Null; tar -xzf C:\\Users\\user\\papercusp-desktop-build.tar.gz -C C:\\Users\\user\\$VM_BUILD_DIR; Remove-Item C:\\Users\\user\\papercusp-desktop-build.tar.gz\""

echo "==> writing build script"
BUILD_PS1="$(mktemp /tmp/vm-build-XXXX.ps1)"
cat > "$BUILD_PS1" <<EOF
\$ErrorActionPreference = 'Continue'
\$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
\$vcvars = "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\VC\\Auxiliary\\Build\\vcvars64.bat"
if (-not (Test-Path \$vcvars)) { \$vcvars = "C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat" }
cmd /c "\`"\$vcvars\`" && set" | ForEach-Object {
  if (\$_ -match "^(.*?)=(.*)\$") { [System.Environment]::SetEnvironmentVariable(\$matches[1], \$matches[2], "Process") }
}
\$env:TAURI_SIGNING_PRIVATE_KEY = "C:\\Users\\user\\papercusp-signing.key"
\$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "$KEY_PASSWORD"
Set-Location C:\\Users\\user\\$VM_BUILD_DIR\\papercusp-desktop
Write-Host "[build] npm install"
npm install --no-audit --no-fund 2>&1
Write-Host "[build] tauri build --bundles nsis"
npx tauri build --bundles nsis 2>&1
Write-Host "[build] EXIT=\$LASTEXITCODE"
EOF
"${SCP[@]}" "$BUILD_PS1" "$VM_SSH_HOST":'C:/Users/user/vm-release-build.ps1'
rm -f "$BUILD_PS1"

echo "==> building (this holds the ssh session; first build ~15-25 min)"
"${SSH[@]}" 'powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\user\vm-release-build.ps1' \
  | tee /tmp/vm-release-build.log
grep -q "EXIT=0" /tmp/vm-release-build.log || fail "VM build failed — see /tmp/vm-release-build.log"

echo "==> collecting artifacts"
OUT_DIR="$ROOT/src-tauri/target/windows-vm/bundle/nsis"
mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR"/*
NSIS_VM_DIR="C:/Users/user/$VM_BUILD_DIR/papercusp-desktop/src-tauri/target/release/bundle/nsis"
for name in $("${SSH[@]}" "cmd /c dir /b \"C:\\Users\\user\\$VM_BUILD_DIR\\papercusp-desktop\\src-tauri\\target\\release\\bundle\\nsis\"" | tr -d '\r'); do
  "${SCP[@]}" "$VM_SSH_HOST":"$NSIS_VM_DIR/$name" "$OUT_DIR/$name"
done
"${SSH[@]}" 'powershell -NoProfile -Command "Remove-Item C:\Users\user\papercusp-signing.key -ErrorAction SilentlyContinue"'

ls -lh "$OUT_DIR"
echo "==> done — artifacts in $OUT_DIR"
