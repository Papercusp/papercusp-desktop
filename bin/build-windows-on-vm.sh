#!/usr/bin/env bash
# Build the Windows x86_64 INNO SETUP installer NATIVELY on the local
# Windows 11 QEMU VM (no cross-compile, no CI — see plan
# windows-desktop-release-readiness-2026-06-11 D-001).
#
# WHY INNO, NOT TAURI'S NSIS BUNDLE (WI-3172, 2026-07-06): the owner-mandated
# FULL offline seed (git super.bundle + hive corestore) puts the payload at
# ~3.4 GB, and makensis dies packaging it — "Internal compiler error #12345:
# error mmapping file ... out of range" at a ~2 GiB offset (signed-32-bit
# datablock limit; BOTH roles failed at ~1.97 GiB). The corestore alone is
# >2 GiB, so no slimming rescues NSIS; MSI caps lower (~2 GB CAB); a 7z-SFX
# combined .exe hits the Windows ~2 GB PE-loader limit. Inno Setup 6.5.2+
# builds a single setup.exe to ~4 GB. Template:
# src-tauri/windows/inno/papercusp.iss.
#
# The old WITH_WINDOWS=1 lane cross-compiled --target x86_64-pc-windows-gnu;
# that never worked (no cross/mingw toolchain here, and Tauri's supported
# Windows story is MSVC). This script replaces it:
#
#   1. Pack the desktop tree (incl. built sidecar + resources) as a tarball
#   2. scp into the VM, extract to an isolated build dir
#   3. npm install + `tauri build --no-bundle` + ISCC (Inno) under the MSVC env
#   4. Copy installer + updater .sig back to
#      src-tauri/target/windows-vm/bundle/inno/ for release-local.sh to pick up
#
# Prereqs (one-time, already provisioned on the VM):
#   - VS 2022 (Community or BuildTools) with C++ workload
#   - rustup stable-x86_64-pc-windows-msvc
#   - Node ≥22 on PATH
#   - Inno Setup 6.5.2+ (winget install --id JRSoftware.InnoSetup) — 6.7.3 provisioned 2026-07-06
#   - VM booted: ~/windows-vm/boot-windows.sh  (ssh -p 2223, key papercup-vm-win)
#
# Prereqs (per release, done by release-local.sh before calling this):
#   - bin/build-desktop-sidecar.sh has populated src-tauri/sidecar/
#   - scripts/build-rootfs.sh has produced src-tauri/resources/papercup-runtime.tar.gz
#
# Signing:
#   - Updater .sig (minisign): produced HOST-SIDE after collection
#     (`tauri signer sign`), never in the VM — the private key never leaves
#     this machine. NOTE the Windows auto-updater itself is PENDING REWORK
#     post-Inno-cutover (it expected the NSIS artifact; tracked on WI-3172) —
#     the .sig is still minted so the artifact chain stays uniform.
#   - Authenticode: in-VM via WINDOWS_SIGN_*/WINDOWS_CERT_* env (D-004,
#     owner-gated cert). Signs the app exe BEFORE packaging and the Inno
#     setup.exe after. Unset ⇒ unsigned build (dev/dogfood).
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

# ── Installer hive-seed — mirror of bin/mac-vm-build.sh cut_release_seed (plan
# hive-seed-bundle-2026-07-04 / WI-3005). Bundling (tauri.conf.json ships
# `seed/**/*`) and first-run restore (main.rs sets PAPERCUSP_SEED_DIR) are
# already cross-platform, so ONLY the CUT needs a Windows-lane equivalent — and
# it runs HERE on the host, NOT in the VM: cut-seed-cli refuses an epoch seal on
# a box without the live hive keychain (load-don't-mint, WI-1981), which the
# Windows VM lacks but the owner Tower (this host) has. The cut writes
# src-tauri/seed/ BEFORE the tar below so it ships in the bundle.
# PAPERCUSP_SKIP_SEED_CUT=1 reuses the existing/rsync'd seed (a1a71 guidance:
# rsync the real Tower seed for VM verification, don't cut on the VM).
cut_release_seed() {
  # Fast-iteration mode implies skip-seed-cut: a dev loop testing Rust/UI
  # changes never needs a fresh 3.77 GB seed (reuses whatever src-tauri/seed
  # holds). A real release leaves PAPERCUSP_FAST_ITER unset so the cut runs.
  if [[ "${PAPERCUSP_SKIP_SEED_CUT:-0}" == "1" || "${PAPERCUSP_FAST_ITER:-0}" == "1" ]]; then
    echo "==> seed: skipping cut (PAPERCUSP_SKIP_SEED_CUT/FAST_ITER) — using existing src-tauri/seed payload"
    [[ -f "$ROOT/src-tauri/seed/manifest.json" ]] || echo "WARN: no seed manifest present; this build will ship the placeholder seed" >&2
    return 0
  fi
  local repo operator_dir
  repo="$(cd "$ROOT/.." && pwd)"
  operator_dir="$repo/apps/operator"
  [[ -d "$operator_dir" ]] || fail "seed cutter not found at $operator_dir (set PAPERCUSP_SKIP_SEED_CUT=1 only for a deliberate placeholder build)"
  # Windows seed = DEPTH-1 (shallow) git bundle + shared-pot corestore snapshot.
  # WHY depth-1 is the WINDOWS default (this DIVERGES from mac-vm-build.sh, which
  # has NO installer size cap): a FULL-HISTORY git bundle of this monorepo is
  # ~1.75GiB; combined with the owner-mandated corestore (~2.3GiB) + slimmed
  # sidecar (~0.85GiB) + WSL rootfs (~0.24GiB) that is ~5.2GiB. The seed +
  # rootfs are ENCRYPTED/pre-compressed (stored raw in the installer), so that
  # payload would push the final Inno setup.exe past its ~4GB single-exe max
  # (and NSIS before it died at ~2GiB — the makensis "#12345" mmapping error).
  # A depth-1 bundle is ~76MB (WI-2903), keeping the full offline seed's raw
  # portion at ~2.5GiB and the final installer ≈2.7GB, safely inside 4GB. The
  # owner's own WI-3172 spec cites "git super.bundle ~76MB" (i.e. depth-1), so
  # a shallow seed is the intended/sufficient shape for an offline dogfood
  # pot — no deep history is needed at first boot (the pot can fetch history
  # from origin online later). Copy-pasting mac's full-history default here is
  # the bug that would silently over-cap every real full-seed build.
  # Escape hatch: export PAPERCUSP_SEED_DEPTH= (empty) to force full history.
  local seed_hive="${PAPERCUSP_SEED_HIVE:-papercusp}"
  local seed_workspace="${PAPERCUSP_SEED_WORKSPACE_ID:-papercusp-workspace}"
  local seed_origin="${PAPERCUSP_SEED_ORIGIN:-https://github.com/Papercusp/papercup}"
  local seed_rev="${PAPERCUSP_SEED_REV:-HEAD}"
  local seed_depth="${PAPERCUSP_SEED_DEPTH-1}"
  local core_args=()
  [[ "${PAPERCUSP_SEED_CORESTORE:-1}" != "1" ]] && core_args+=(--no-corestore)
  [[ -n "${PAPERCUSP_SEED_STORE_DIR:-}" ]] && core_args+=(--store-dir "$PAPERCUSP_SEED_STORE_DIR")
  local depth_args=()
  [[ -n "$seed_depth" ]] && depth_args+=(--depth "$seed_depth")
  echo "==> seed: cutting installer seed (hive=$seed_hive rev=$seed_rev depth=${seed_depth:-full} corestore=${PAPERCUSP_SEED_CORESTORE:-1})"
  (
    cd "$operator_dir"
    OPATH="$PATH"
    set -a
    [[ -f ./.env.local ]] && . ./.env.local
    set +a
    export PATH="$OPATH:$PATH"
    PAPERCUSP_ALLOW_DEV_RESTART=1 PAPERCUSP_WORKSPACE_ROOT="$repo" \
      npx tsx lib/release/cut-seed-cli.ts \
        --out "$ROOT/src-tauri/seed" \
        --repo "$repo" \
        --origin "$seed_origin" \
        --workspace-id "$seed_workspace" \
        --hive "$seed_hive" \
        --rev "$seed_rev" \
        "${depth_args[@]}" \
        "${core_args[@]}"
  ) || fail "seed cut failed (set PAPERCUSP_SKIP_SEED_CUT=1 to build with an existing/placeholder seed)"
}
cut_release_seed

# WI-3172 payload guard (Inno era). The binding limit is the FINAL setup.exe
# size: Inno 6.5.2+ supports a single Setup.exe to ~4GB (the Windows max; NSIS
# before it died at ~2GiB — "#12345 error mmapping"). The seed (encrypted
# corestore + git bundles) and the WSL rootfs tar.gz are INCOMPRESSIBLE and
# stored raw ([Files] nocompression), so they translate ~1:1 into installer
# bytes; the sidecar compresses ~3:1 under lzma2. Guard the raw-stored portion
# here, before the ~10-min pack/ship/compile: raw (seed+resources) ≤ 3.4GiB
# leaves ≥400MiB for the compressed sidecar (~0.35GiB) + exe + overhead under
# the 4GB exe max. The full-seed raw portion is ~2.5GiB by design (corestore
# ~2.2G + git ~76M + rootfs ~0.25G), so tripping this means an unexpectedly
# large corestore/git cut — recheck the seed before building. A hard
# post-collect assertion below also verifies the actual setup.exe size.
# (sidecar/code-server + sidecar/bin/omp are excluded from the tar and never
# ship — see the tar excludes below.)
raw_kb=$(du -sk --dereference "$ROOT/src-tauri/seed" "$ROOT/src-tauri/resources" 2>/dev/null | awk '{s+=$1} END {print s+0}')
raw_cap_kb=$((3482 * 1024)) # 3.4GiB raw-stored cap (full seed ~2.5GiB by design)
if (( raw_kb > raw_cap_kb )); then
  du -sh --dereference "$ROOT/src-tauri/seed" "$ROOT/src-tauri/resources" 2>/dev/null || true
  fail "raw-stored payload (seed+resources) is $((raw_kb / 1024 / 1024))GiB (> 3.4GiB guard, WI-3172) — these ship uncompressed inside the Inno setup.exe, which maxes at ~4GB. The full offline seed is ~2.5GiB by design; check for an unexpectedly-large corestore/git cut (full-history git? duplicate snapshot?) before building. PAPERCUSP_SEED_DEPTH= (full history) canNOT fit — see the seed-cut comment above."
fi

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

# Fast-iter (PAPERCUSP_FAST_ITER=1): extract OVER the existing build dir instead
# of wiping it. The tarball excludes src-tauri/target + node_modules, so those
# caches SURVIVE across builds → cargo goes incremental (~1-3 min) instead of a
# cold ~20 min rebuild, and npm install is a near-no-op. tar overwrites every
# source/sidecar file present in the archive, so correctness is preserved; the
# only gap vs a clean build is that a source file DELETED in the repo lingers in
# the VM (harmless for iteration — do a full non-FAST_ITER build for a release).
if [[ "${PAPERCUSP_FAST_ITER:-0}" == "1" ]]; then
  echo "==> extracting in VM ($VM_BUILD_DIR) — FAST_ITER: over existing dir, caches preserved"
  "${SSH[@]}" "powershell -NoProfile -Command \"New-Item -ItemType Directory -Force C:\\Users\\user\\$VM_BUILD_DIR | Out-Null; tar -xzf C:\\Users\\user\\papercusp-desktop-build.tar.gz -C C:\\Users\\user\\$VM_BUILD_DIR; Remove-Item C:\\Users\\user\\papercusp-desktop-build.tar.gz\""
else
  echo "==> extracting in VM ($VM_BUILD_DIR)"
  "${SSH[@]}" "powershell -NoProfile -Command \"Remove-Item -Recurse -Force C:\\Users\\user\\$VM_BUILD_DIR -ErrorAction SilentlyContinue; New-Item -ItemType Directory C:\\Users\\user\\$VM_BUILD_DIR | Out-Null; tar -xzf C:\\Users\\user\\papercusp-desktop-build.tar.gz -C C:\\Users\\user\\$VM_BUILD_DIR; Remove-Item C:\\Users\\user\\papercusp-desktop-build.tar.gz\""
fi

# ── Authenticode signing (WI-792 P-003) — sign the app .exe (BEFORE Inno packs
# it) + the Inno setup.exe IFF the owner provides a code-signing cert in env.
# With NO cert env set, SIGN_PRELUDE is empty and Sign-File is a no-op —
# UNSIGNED build, byte-identical to before. Full owner runbook:
# /internal/docs/agent-insights/windows-authenticode-signing-runbook
# (Pre-Inno this patched tauri.windows.conf.json for the NSIS bundler; the
# bundler no longer runs on Windows, so signing is a direct signtool/custom
# command via the Sign-File PS function defined in the build script below.)
WINDOWS_SIGN_TIMESTAMP_URL="${WINDOWS_SIGN_TIMESTAMP_URL:-http://timestamp.digicert.com}"
WINDOWS_SIGN_DIGEST="${WINDOWS_SIGN_DIGEST:-sha256}"
# RFC3161 timestamp (signtool `/tr <url> /td <digest>`) is the modern standard
# VERIFIED working here against digicert/sectigo/comodo (2026-07-05 self-signed
# dry-run); RFC3161-only CAs (e.g. SSL.com eSigner, common for EV) reject the
# legacy `/t`. Set WINDOWS_SIGN_TSP=false only for a timestamp server that
# lacks RFC3161. (The signCommand/EV custom-signer path does its own timestamping.)
WINDOWS_SIGN_TSP="${WINDOWS_SIGN_TSP:-true}"
if [[ "$WINDOWS_SIGN_TSP" == "true" || "$WINDOWS_SIGN_TSP" == "1" ]]; then
  SIGNTOOL_TS_ARGS="/tr ${WINDOWS_SIGN_TIMESTAMP_URL} /td ${WINDOWS_SIGN_DIGEST}"
else
  SIGNTOOL_TS_ARGS="/t ${WINDOWS_SIGN_TIMESTAMP_URL}"
fi
SIGN_PRELUDE=""
if [[ -n "${WINDOWS_SIGN_COMMAND:-}" ]]; then
  # EV / cloud-HSM path (non-exportable key): a custom signer, %1 = file path.
  SIGN_PRELUDE=$(cat <<PS
Write-Host "[build] Authenticode: custom signCommand (EV/cloud-HSM)"
\$script:SignCmd = '${WINDOWS_SIGN_COMMAND}'
PS
)
elif [[ -n "${WINDOWS_CERT_PFX_BASE64:-}" ]]; then
  # OV path: import the PFX into CurrentUser\My, sign by its thumbprint.
  SIGN_PRELUDE=$(cat <<PS
Write-Host "[build] Authenticode: importing PFX"
[IO.File]::WriteAllBytes("\$env:TEMP\\cs.pfx", [Convert]::FromBase64String("${WINDOWS_CERT_PFX_BASE64}"))
\$pfxpwd = ConvertTo-SecureString "${WINDOWS_CERT_PASSWORD:-}" -AsPlainText -Force
\$cert = Import-PfxCertificate -FilePath "\$env:TEMP\\cs.pfx" -CertStoreLocation Cert:\\CurrentUser\\My -Password \$pfxpwd
Remove-Item "\$env:TEMP\\cs.pfx" -Force
\$script:SignThumb = \$cert.Thumbprint
PS
)
elif [[ -n "${WINDOWS_CERTIFICATE_THUMBPRINT:-}" ]]; then
  # Cert already in the VM store (e.g. EV token CSP / cloud-HSM connector).
  SIGN_PRELUDE=$(cat <<PS
Write-Host "[build] Authenticode: signing by store thumbprint"
\$script:SignThumb = "${WINDOWS_CERTIFICATE_THUMBPRINT}"
PS
)
else
  echo "==> Authenticode: no WINDOWS_CERT_*/WINDOWS_SIGN_* env set — building UNSIGNED."
  echo "    A PUBLIC release MUST be signed: /internal/docs/agent-insights/windows-authenticode-signing-runbook"
fi

# Fast-iter build knobs — all no-ops unless PAPERCUSP_FAST_ITER=1. Injected into
# the PS1 heredoc below (unquoted <<EOF, so ${VAR} expands; the $-signs inside
# each value are NOT re-scanned, so PS variables like $LASTEXITCODE survive).
if [[ "${PAPERCUSP_FAST_ITER:-0}" == "1" ]]; then
  # sccache caches compiled crates across even clean builds; best-effort (only
  # if it's installed on the VM PATH). Persisted target/ already gives cargo
  # incremental regardless.
  FAST_ITER_PRELUDE='if (Get-Command sccache -ErrorAction SilentlyContinue) { $env:RUSTC_WRAPPER = "sccache"; Write-Host "[build] FAST_ITER: RUSTC_WRAPPER=sccache" } else { Write-Host "[build] FAST_ITER: sccache not on VM PATH (skipping; cargo incremental via persisted target still applies)" }'
  # node_modules persists across FAST_ITER builds — skip the reinstall when it is
  # already there. Change a dependency? run a full (non-FAST_ITER) build once.
  # ASCII ONLY inside PS1-bound strings: an em dash here once rendered as a
  # CP-1252 smart quote on the VM and truncated the string mid-line (the BOM
  # below now also guards this class).
  NPM_INSTALL_BLOCK='if (Test-Path node_modules) { Write-Host "[build] FAST_ITER: node_modules present - skipping npm install" } else { Write-Host "[build] npm install"; npm install --no-audit --no-fund 2>&1 }'
else
  FAST_ITER_PRELUDE=''
  NPM_INSTALL_BLOCK=$'Write-Host "[build] npm install"\nnpm install --no-audit --no-fund 2>&1'
fi
# Server bundle: built by DEFAULT even in FAST_ITER — the live operator on an
# installed box runs from the SERVER install's sidecar, so any sidecar/SPA/TS
# change MUST ship a fresh Server setup.exe (skipping it silently verifies a
# stale UI — bit the WI-3033 verify, 2026-07-05). Rust-only iterations can opt
# out with PAPERCUSP_FAST_ITER_GUI_ONLY=1; the skip also DELETES the stale
# Server artifacts from the VM's inno dir so the collection step below can't
# hand back a previous build's Server setup.exe as if fresh.
if [[ "${PAPERCUSP_FAST_ITER:-0}" == "1" && "${PAPERCUSP_FAST_ITER_GUI_ONLY:-0}" == "1" ]]; then
  SERVER_BUILD_BLOCK='Write-Host "[build] FAST_ITER GUI-only: skipping Papercusp Server bundle"; Remove-Item -Force "src-tauri\target\release\bundle\inno\Papercusp Server*" -ErrorAction SilentlyContinue'
else
  SERVER_BUILD_BLOCK=$'Write-Host "[build] tauri build: Papercusp Server (--no-bundle)"\nnpx tauri build --no-bundle --config src-tauri/tauri.server.conf.json 2>&1\nWrite-Host "[build] Server EXIT=$LASTEXITCODE"\nSign-File "src-tauri\\target\\release\\papercusp-desktop.exe"\nInvoke-Inno "Server" "com.papercusp.server" "Papercusp Server"'
fi

echo "==> writing build script"
BUILD_PS1="$(mktemp /tmp/vm-build-XXXX.ps1)"
# UTF-8 BOM: Windows PowerShell 5.1 decodes BOM-less .ps1 as CP-1252, which
# mangles any non-ASCII byte into stray smart-quotes/letters (a heredoc em
# dash became `”` and broke parsing — found live 2026-07-05, WI-3033 build).
printf '\xEF\xBB\xBF' > "$BUILD_PS1"
cat >> "$BUILD_PS1" <<EOF
\$ErrorActionPreference = 'Continue'
\$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
\$vcvars = "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\VC\\Auxiliary\\Build\\vcvars64.bat"
if (-not (Test-Path \$vcvars)) { \$vcvars = "C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat" }
cmd /c "\`"\$vcvars\`" && set" | ForEach-Object {
  if (\$_ -match "^(.*?)=(.*)\$") { [System.Environment]::SetEnvironmentVariable(\$matches[1], \$matches[2], "Process") }
}
Set-Location C:\\Users\\user\\$VM_BUILD_DIR\\papercusp-desktop
# Reclaim disk from prior installer outputs BEFORE building — two full-seed
# Inno installers are ~2.7GB each and the VM disk is tight.
Remove-Item -Recurse -Force "src-tauri\target\release\bundle\nsis","src-tauri\target\release\bundle\inno" -ErrorAction SilentlyContinue
Get-PSDrive C | ForEach-Object { Write-Host "[build] disk free: \$([int](\$_.Free/1MB)) MB" }
${FAST_ITER_PRELUDE}
${NPM_INSTALL_BLOCK}
${SIGN_PRELUDE}
# Authenticode signer — a no-op unless SIGN_PRELUDE set a thumbprint/command
# (see the host-side branch above). signtool comes from the VS SDK on PATH
# (vcvars64 sourced above).
function Sign-File([string]\$path) {
  if (\$script:SignCmd) {
    Write-Host "[build] Authenticode signing (custom): \$path"
    cmd /c \$script:SignCmd.Replace('%1', \$path)
    if (\$LASTEXITCODE -ne 0) { Write-Host "[build] AUTHENTICODE SIGN FAILED (\$LASTEXITCODE): \$path" }
  } elseif (\$script:SignThumb) {
    Write-Host "[build] Authenticode signing (signtool): \$path"
    signtool sign /sha1 \$script:SignThumb /fd ${WINDOWS_SIGN_DIGEST} ${SIGNTOOL_TS_ARGS} "\$path"
    if (\$LASTEXITCODE -ne 0) { Write-Host "[build] AUTHENTICODE SIGN FAILED (\$LASTEXITCODE): \$path" }
  }
}
# Package one role with Inno Setup (WI-3172 — replaces tauri's NSIS bundle;
# see src-tauri/windows/inno/papercusp.iss for why). Filters the per-file
# "Compressing:" spam (~50k sidecar files) out of the ssh log.
function Invoke-Inno([string]\$role, [string]\$appId, [string]\$appName) {
  \$ver = (Get-Content "src-tauri/tauri.conf.json" -Raw | ConvertFrom-Json).version
  \$iscc = Join-Path \$env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"
  if (-not (Test-Path \$iscc)) { \$iscc = Join-Path \${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe" }
  if (-not (Test-Path \$iscc)) {
    Write-Host "[build] ISCC NOT FOUND - provision: winget install --id JRSoftware.InnoSetup"
    Write-Host "[build] ISCC \$role EXIT=127"
    return
  }
  \$outDir = Join-Path \$PWD "src-tauri\target\release\bundle\inno"
  New-Item -ItemType Directory -Force \$outDir | Out-Null
  \$buildRoot = Join-Path \$PWD "src-tauri"
  Write-Host "[build] ISCC \$role packaging (full seed stored raw; several minutes)"
  & \$iscc "/DAppId=\$appId" "/DAppName=\$appName" "/DAppVersion=\$ver" "/DBuildRoot=\$buildRoot" "/O\$outDir" "src-tauri\windows\inno\papercusp.iss" 2>&1 | Where-Object { \$_ -notmatch '^\s*Compressing' }
  Write-Host "[build] ISCC \$role EXIT=\$LASTEXITCODE"
  Sign-File (Join-Path \$outDir "\${appName}_\${ver}_x64-setup.exe")
}
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
# generate_context! bakes the differing identifier. Each role compiles with
# --no-bundle (the NSIS bundler is retired on Windows — WI-3172) and is then
# packaged by Invoke-Inno. NOTE the two roles share one exe path, so each
# role's ISCC run MUST complete before the next role's cargo build overwrites
# target\release\papercusp-desktop.exe — keep build→package interleaved.
Write-Host "[build] tauri build: Papercusp GUI (--no-bundle)"
npx tauri build --no-bundle 2>&1
Write-Host "[build] GUI EXIT=\$LASTEXITCODE"
Sign-File "src-tauri\\target\\release\\papercusp-desktop.exe"
Invoke-Inno "GUI" "com.papercusp.gui" "Papercusp GUI"
${SERVER_BUILD_BLOCK}
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
# Per-step exit assertions. The cargo compile AND the Inno packaging of each
# built role must both report EXIT=0 (with --no-bundle there is no in-VM
# updater signing, so the old "expected keyless exit 1" allowance is gone —
# any nonzero step is a real failure).
grep -q '\[build\] GUI EXIT=0' /tmp/vm-release-build.log \
  || fail "GUI compile failed — see /tmp/vm-release-build.log"
grep -q '\[build\] ISCC GUI EXIT=0' /tmp/vm-release-build.log \
  || fail "GUI Inno packaging failed (ISCC nonzero/missing — winget install --id JRSoftware.InnoSetup on the VM if absent) — see /tmp/vm-release-build.log"
if ! grep -q 'FAST_ITER GUI-only' /tmp/vm-release-build.log; then
  grep -q '\[build\] Server EXIT=0' /tmp/vm-release-build.log \
    || fail "Server compile failed — see /tmp/vm-release-build.log"
  grep -q '\[build\] ISCC Server EXIT=0' /tmp/vm-release-build.log \
    || fail "Server Inno packaging failed — see /tmp/vm-release-build.log"
fi

echo "==> collecting artifacts"
OUT_DIR="$ROOT/src-tauri/target/windows-vm/bundle/inno"
mkdir -p "$OUT_DIR"
# files only — the dir may hold archived prev-version subdirs (e.g.
# prev-0.0.1/ for the future updater E2E); `rm -f dir/*` dies on them
# under set -e (bit the first uninterrupted run, 2026-06-12)
find "$OUT_DIR" -maxdepth 1 -type f -delete
INNO_VM_DIR="C:/Users/user/$VM_BUILD_DIR/papercusp-desktop/src-tauri/target/release/bundle/inno"
# Read one filename per line — a `for name in $(...)` word-SPLITS the space in
# the GUI/Server split's productNames ("Papercusp GUI_..-setup.exe") and scp's a
# truncated ".../Papercusp" path (No such file), silently collecting NOTHING
# (2026-07-02 parity fix). scp uses the SFTP protocol (OpenSSH 9+), which passes
# the spaced remote path literally, so no extra remote-shell quoting is needed.
while IFS= read -r name; do
  [[ -z "$name" ]] && continue
  "${SCP[@]}" "$VM_SSH_HOST":"$INNO_VM_DIR/$name" "$OUT_DIR/$name"
done < <("${SSH[@]}" "cmd /c dir /b \"C:\\Users\\user\\$VM_BUILD_DIR\\papercusp-desktop\\src-tauri\\target\\release\\bundle\\inno\"" | tr -d '\r\0')

# Ground-truth size check: Inno's single-exe limit is ~4GB. Warn near it.
for f in "$OUT_DIR"/*-setup.exe; do
  [[ -e "$f" ]] || continue
  size=$(stat -c%s "$f")
  if (( size > 4290772992 )); then
    fail "$(basename "$f") is $((size / 1024 / 1024))MB — exceeds Inno's ~4GB single-exe max; the payload must shrink or move to DiskSpanning (WI-3172)"
  elif (( size > 3900000000 )); then
    echo "WARN: $(basename "$f") is $((size / 1024 / 1024))MB — within ~10% of Inno's ~4GB single-exe max (WI-3172)" >&2
  fi
done

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
