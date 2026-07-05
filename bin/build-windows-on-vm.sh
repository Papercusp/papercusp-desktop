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
# Signing: the updater .sig is produced HOST-SIDE after collection
# (`tauri signer sign`), never in the VM. Two reasons: (a) the private key
# never leaves this machine; (b) Windows cannot hold an EMPTY env var —
# PowerShell `$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""` DELETES the
# variable, so an empty-passphrase key makes tauri-cli prompt on stdin and
# hang forever over ssh. The in-VM build therefore runs keyless and is
# EXPECTED to exit 1 with "A public key has been found, but no private
# key" AFTER writing the complete installer — the script asserts exactly
# that outcome.
#   TAURI_SIGNING_PRIVATE_KEY_PATH (host path, default ~/.papercusp/signing/papercusp.key)
#   TAURI_SIGNING_PRIVATE_KEY_PASSWORD (optional, host-side only)

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

VM_SSH_KEY="${VM_SSH_KEY:-$HOME/.ssh/papercup-vm-win}"
VM_SSH_PORT="${VM_SSH_PORT:-2223}"
VM_SSH_HOST="${VM_SSH_HOST:-user@127.0.0.1}"
VM_BUILD_DIR="${VM_BUILD_DIR:-papercup-build-release}"   # under C:\Users\user\
KEY_FILE="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.papercusp/signing/papercusp.key}"
KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

# -o IdentitiesOnly=yes: pin auth to $VM_SSH_KEY only. Without it, a loaded
# ssh-agent with >5 keys exhausts the server's auth-tries on agent keys first
# and fails "Too many authentication failures" before the -i key is tried
# (bit a WI-800 rebuild, 2026-06-25).
SSH=(ssh -i "$VM_SSH_KEY" -o IdentitiesOnly=yes -p "$VM_SSH_PORT" -o ConnectTimeout=10 -o ServerAliveInterval=30 "$VM_SSH_HOST")
SCP=(scp -i "$VM_SSH_KEY" -o IdentitiesOnly=yes -P "$VM_SSH_PORT" -o ConnectTimeout=10)

fail() { echo "ERROR: $*" >&2; exit 1; }

[[ -d "$ROOT/src-tauri/sidecar/apps" ]] || fail "sidecar not built — run bin/build-desktop-sidecar.sh first"
[[ -f "$ROOT/src-tauri/resources/papercup-runtime.tar.gz" ]] || fail "WSL rootfs missing — run scripts/build-rootfs.sh first"

# Fast LOCAL Windows-cfg compile gate (WI-2215) — catch cfg(windows) Rust
# errors on THIS box in ~40s (~4s warm) instead of discovering them 15-25 min
# into the VM build. Opt out with SKIP_WINDOWS_CFG_PRECHECK=1. If the local
# cargo-xwin toolchain isn't set up (script exits 2), we WARN and continue —
# the VM build is still the source of truth; the gate is a fast fail-early.
if [[ "${SKIP_WINDOWS_CFG_PRECHECK:-0}" != "1" ]]; then
  echo "==> Windows-cfg pre-check (local; skip with SKIP_WINDOWS_CFG_PRECHECK=1)"
  set +e
  "$HERE/check-windows-cfg.sh"
  precheck_rc=$?
  set -e
  if [[ "$precheck_rc" -eq 2 ]]; then
    echo "    (local cargo-xwin gate not set up — see bin/check-windows-cfg.sh; continuing to VM build)" >&2
  elif [[ "$precheck_rc" -ne 0 ]]; then
    fail "Windows-cfg pre-check found compile errors (above) — fix before spending a VM build. (SKIP_WINDOWS_CFG_PRECHECK=1 to override.)"
  fi
fi
[[ -f "$KEY_FILE" ]] || fail "signing key not found at $KEY_FILE (bin/setup-signing-key.sh)"
"${SSH[@]}" 'cmd /c echo VM-OK' >/dev/null 2>&1 || fail "VM unreachable on :$VM_SSH_PORT — boot it: ~/windows-vm/boot-windows.sh"

echo "==> packing desktop tree"
TARBALL="$(mktemp /tmp/papercusp-desktop-build-XXXX.tar.gz)"
trap 'rm -f "$TARBALL"' EXIT
# -h dereferences symlinks (node_modules/.bin shims) — Windows tar can't
# create them. Keep sidecar/**/node_modules (runtime deps); drop only the
# desktop repo's own toolchain node_modules.
#
# Windows payload trims (NSIS hard-caps the installer datablock at ~2 GiB —
# the full 2.4 GB payload dies in makensis with "error mmapping datablock"):
#   - sidecar/code-server (447 MB): main.rs spawn_code_server already
#     falls back gracefully when it's absent on Windows.
#   - sidecar/bin/omp (485 MB): OMP integration is Windows-unsupported in
#     v1 (desktop-app-install-integration-2026-05-23 D-002; the endpoint
#     short-circuits with windows_not_supported_in_v1).
# Serialize the pack against build-desktop-sidecar.sh's atomic sidecar publish:
# that script holds an flock on src-tauri/sidecar.lock for its whole build and
# finishes with an atomic rename of sidecar.tmp.<pid> → sidecar/. In a shared
# tree a CONCURRENT fleet sidecar build renaming sidecar/ mid-tar makes tar die
# "file changed as we read it" (STAGE2_FAILED exit=1, observed 2026-07-03 with
# two agents building at once). Taking the SAME lock blocks the tar until any
# in-flight publish completes AND blocks a new publish from starting until the
# read is done, so the tree is stable across the whole pack. flock creates the
# lock file if absent (harmless — it's excluded from the tarball below).
flock "$ROOT/src-tauri/sidecar.lock" \
tar -czhf "$TARBALL" \
  --exclude='.git' \
  --exclude='papercusp-desktop/node_modules' \
  --exclude='papercusp-desktop/web/node_modules' \
  --exclude='src-tauri/target' \
  --exclude='src-tauri/sidecar.tmp.*' \
  --exclude='src-tauri/sidecar.lock*' \
  --exclude='src-tauri/sidecar/code-server' \
  --exclude='src-tauri/sidecar/bin/omp' \
  -C "$ROOT/.." papercusp-desktop
ls -lh "$TARBALL"

echo "==> shipping to VM"
"${SCP[@]}" "$TARBALL" "$VM_SSH_HOST":'C:/Users/user/papercusp-desktop-build.tar.gz'

echo "==> extracting in VM ($VM_BUILD_DIR)"
"${SSH[@]}" "powershell -NoProfile -Command \"Remove-Item -Recurse -Force C:\\Users\\user\\$VM_BUILD_DIR -ErrorAction SilentlyContinue; New-Item -ItemType Directory C:\\Users\\user\\$VM_BUILD_DIR | Out-Null; tar -xzf C:\\Users\\user\\papercusp-desktop-build.tar.gz -C C:\\Users\\user\\$VM_BUILD_DIR; Remove-Item C:\\Users\\user\\papercusp-desktop-build.tar.gz\""

# ── Authenticode signing (WI-792 P-003) — sign the bundled .exe + NSIS installer
# IFF the owner provides a code-signing cert in env. With NO cert env set,
# SIGN_PRELUDE is empty and the build is UNSIGNED — byte-identical to before.
# Full owner runbook: /internal/docs/agent-insights/windows-authenticode-signing-runbook
# tauri reads bundle.windows.{certificateThumbprint|signCommand,timestampUrl,
# digestAlgorithm,tsp} from tauri.windows.conf.json; we patch it in-VM before the build.
WINDOWS_SIGN_TIMESTAMP_URL="${WINDOWS_SIGN_TIMESTAMP_URL:-http://timestamp.digicert.com}"
WINDOWS_SIGN_DIGEST="${WINDOWS_SIGN_DIGEST:-sha256}"
# tsp=true → tauri emits the RFC3161 timestamp (signtool `/tr <url> /td <digest>`),
# the modern standard VERIFIED working here against digicert/sectigo/comodo
# (2026-07-05 self-signed dry-run). With tsp unset/false, tauri falls back to the
# LEGACY `/t <url>` timestamp, which RFC3161-only CAs (e.g. SSL.com eSigner, common
# for EV) reject — so we default ON. Set WINDOWS_SIGN_TSP=false only for a legacy
# timestamp server that lacks RFC3161. (signCommand/EV custom-signer path handles
# its own timestamping, so tsp is not injected there.)
WINDOWS_SIGN_TSP="${WINDOWS_SIGN_TSP:-true}"
TSP_PS=$([[ "$WINDOWS_SIGN_TSP" == "true" || "$WINDOWS_SIGN_TSP" == "1" ]] && echo '$true' || echo '$false')
SIGN_PRELUDE=""
if [[ -n "${WINDOWS_SIGN_COMMAND:-}" ]]; then
  # EV / cloud-HSM path (non-exportable key): a custom signer, %1 = file path.
  SIGN_PRELUDE=$(cat <<PS
Write-Host "[build] Authenticode: injecting signCommand (EV/cloud-HSM)"
\$cfgPath = "src-tauri/tauri.windows.conf.json"
\$cfg = Get-Content \$cfgPath -Raw | ConvertFrom-Json
if (-not \$cfg.bundle.windows) { \$cfg.bundle | Add-Member -Force windows ([pscustomobject]@{}) }
\$cfg.bundle.windows | Add-Member -Force signCommand "${WINDOWS_SIGN_COMMAND}"
\$cfg | ConvertTo-Json -Depth 20 | Set-Content \$cfgPath
PS
)
elif [[ -n "${WINDOWS_CERT_PFX_BASE64:-}" ]]; then
  # OV path: import the PFX into CurrentUser\My, read its thumbprint, patch config.
  SIGN_PRELUDE=$(cat <<PS
Write-Host "[build] Authenticode: importing PFX + setting certificateThumbprint"
[IO.File]::WriteAllBytes("\$env:TEMP\\cs.pfx", [Convert]::FromBase64String("${WINDOWS_CERT_PFX_BASE64}"))
\$pwd = ConvertTo-SecureString "${WINDOWS_CERT_PASSWORD:-}" -AsPlainText -Force
\$cert = Import-PfxCertificate -FilePath "\$env:TEMP\\cs.pfx" -CertStoreLocation Cert:\\CurrentUser\\My -Password \$pwd
Remove-Item "\$env:TEMP\\cs.pfx" -Force
\$cfgPath = "src-tauri/tauri.windows.conf.json"
\$cfg = Get-Content \$cfgPath -Raw | ConvertFrom-Json
if (-not \$cfg.bundle.windows) { \$cfg.bundle | Add-Member -Force windows ([pscustomobject]@{}) }
\$cfg.bundle.windows | Add-Member -Force certificateThumbprint \$cert.Thumbprint
\$cfg.bundle.windows | Add-Member -Force timestampUrl "${WINDOWS_SIGN_TIMESTAMP_URL}"
\$cfg.bundle.windows | Add-Member -Force digestAlgorithm "${WINDOWS_SIGN_DIGEST}"
\$cfg.bundle.windows | Add-Member -Force tsp ${TSP_PS}
\$cfg | ConvertTo-Json -Depth 20 | Set-Content \$cfgPath
PS
)
elif [[ -n "${WINDOWS_CERTIFICATE_THUMBPRINT:-}" ]]; then
  # Cert already in the VM store (e.g. EV token CSP / cloud-HSM connector).
  SIGN_PRELUDE=$(cat <<PS
Write-Host "[build] Authenticode: setting certificateThumbprint (cert already in store)"
\$cfgPath = "src-tauri/tauri.windows.conf.json"
\$cfg = Get-Content \$cfgPath -Raw | ConvertFrom-Json
if (-not \$cfg.bundle.windows) { \$cfg.bundle | Add-Member -Force windows ([pscustomobject]@{}) }
\$cfg.bundle.windows | Add-Member -Force certificateThumbprint "${WINDOWS_CERTIFICATE_THUMBPRINT}"
\$cfg.bundle.windows | Add-Member -Force timestampUrl "${WINDOWS_SIGN_TIMESTAMP_URL}"
\$cfg.bundle.windows | Add-Member -Force digestAlgorithm "${WINDOWS_SIGN_DIGEST}"
\$cfg.bundle.windows | Add-Member -Force tsp ${TSP_PS}
\$cfg | ConvertTo-Json -Depth 20 | Set-Content \$cfgPath
PS
)
else
  echo "==> Authenticode: no WINDOWS_CERT_*/WINDOWS_SIGN_* env set — building UNSIGNED."
  echo "    A PUBLIC release MUST be signed: /internal/docs/agent-insights/windows-authenticode-signing-runbook"
fi

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
Set-Location C:\\Users\\user\\$VM_BUILD_DIR\\papercusp-desktop
Write-Host "[build] npm install"
npm install --no-audit --no-fund 2>&1
${SIGN_PRELUDE}
# Build provenance: baked via option_env!("PAPERCUSP_BUILD_SHA") (main.rs) so
# the operator's /api/health self-reports the commit. Empty when unset.
\$env:PAPERCUSP_BUILD_SHA = "${PAPERCUSP_BUILD_SHA:-}"
Write-Host "[build] PAPERCUSP_BUILD_SHA=\$env:PAPERCUSP_BUILD_SHA"
# Same provenance mechanism for the shipped app VERSION (WI-2644) — see the
# matching PAPERCUSP_BUILD_VERSION option_env! in main.rs. release-local.sh
# forwards its own \$VERSION arg into this script's env.
\$env:PAPERCUSP_BUILD_VERSION = "${PAPERCUSP_BUILD_VERSION:-}"
Write-Host "[build] PAPERCUSP_BUILD_VERSION=\$env:PAPERCUSP_BUILD_VERSION"
# Two-bundle split (one binary, two roles — see src-tauri/src/app_role.rs):
# GUI (base config) + Server (tauri.server.conf.json override). Distinct
# productNames → distinct *-setup.exe filenames; each recompiles because
# generate_context! bakes the differing identifier.
Write-Host "[build] tauri build: Papercusp GUI --bundles nsis"
npx tauri build --bundles nsis 2>&1
Write-Host "[build] GUI EXIT=\$LASTEXITCODE"
Write-Host "[build] tauri build: Papercusp Server --bundles nsis"
npx tauri build --bundles nsis --config src-tauri/tauri.server.conf.json 2>&1
Write-Host "[build] Server EXIT=\$LASTEXITCODE"
EOF
"${SCP[@]}" "$BUILD_PS1" "$VM_SSH_HOST":'C:/Users/user/vm-release-build.ps1'
rm -f "$BUILD_PS1"

echo "==> building (this holds the ssh session; first build ~15-25 min)"
# 2>&1 BEFORE the pipe: cargo + tauri-cli print progress (including the
# load-bearing "Finished 1 bundle at:" line) to STDERR, which ssh carries on
# its own stderr channel — without the merge it bypasses tee and the
# assertions below see an empty log (bit the first uninterrupted run live,
# 2026-06-11: bundle finished, lane reported "produced no bundle").
"${SSH[@]}" 'powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\user\vm-release-build.ps1' \
  2>&1 | tee /tmp/vm-release-build.log
# Keyless in-VM build: the ONLY sanctioned failure is the missing-private-key
# error AFTER the bundle finished (see the signing note up top). Anything
# else — or no finished bundle — is a real failure.
if ! grep -q "Finished.*1 bundle at" /tmp/vm-release-build.log; then
  fail "VM build produced no bundle — see /tmp/vm-release-build.log"
fi
if ! grep -q "EXIT=0" /tmp/vm-release-build.log \
   && ! grep -q "A public key has been found, but no private key" /tmp/vm-release-build.log; then
  fail "VM build failed for a reason other than the expected keyless-sign skip — see /tmp/vm-release-build.log"
fi

echo "==> collecting artifacts"
OUT_DIR="$ROOT/src-tauri/target/windows-vm/bundle/nsis"
mkdir -p "$OUT_DIR"
# files only — the dir also holds archived prev-version subdirs (e.g.
# prev-0.0.1/ for the future updater E2E); `rm -f dir/*` dies on them
# under set -e (bit the first uninterrupted run, 2026-06-12)
find "$OUT_DIR" -maxdepth 1 -type f -delete
NSIS_VM_DIR="C:/Users/user/$VM_BUILD_DIR/papercusp-desktop/src-tauri/target/release/bundle/nsis"
# Read one filename per line — a `for name in $(...)` word-SPLITS the space in
# the GUI/Server split's productNames ("Papercusp GUI_..-setup.exe") and scp's a
# truncated ".../Papercusp" path (No such file), silently collecting NOTHING
# (2026-07-02 parity fix). scp uses the SFTP protocol (OpenSSH 9+), which passes
# the spaced remote path literally, so no extra remote-shell quoting is needed.
while IFS= read -r name; do
  [[ -z "$name" ]] && continue
  "${SCP[@]}" "$VM_SSH_HOST":"$NSIS_VM_DIR/$name" "$OUT_DIR/$name"
done < <("${SSH[@]}" "cmd /c dir /b \"C:\\Users\\user\\$VM_BUILD_DIR\\papercusp-desktop\\src-tauri\\target\\release\\bundle\\nsis\"" | tr -d '\r\0')

echo "==> signing updater artifacts (host-side)"
# The GUI/Server split emits TWO *-setup.exe — sign BOTH. The old `head -1` left
# the Server bundle's updater artifact unsigned (2026-07-02 parity fix).
shopt -s nullglob
SETUP_EXES=("$OUT_DIR"/*-setup.exe)
shopt -u nullglob
[[ ${#SETUP_EXES[@]} -gt 0 ]] || fail "no *-setup.exe came back from the VM"
for SETUP_EXE in "${SETUP_EXES[@]}"; do
  echo "  signing: $(basename "$SETUP_EXE")"
  (cd "$ROOT" && npx tauri signer sign \
    --private-key-path "$KEY_FILE" \
    --password "$KEY_PASSWORD" \
    "$SETUP_EXE")
  [[ -f "$SETUP_EXE.sig" ]] || fail "tauri signer produced no .sig for $SETUP_EXE"
done

ls -lh "$OUT_DIR"
echo "==> done — artifacts in $OUT_DIR"
