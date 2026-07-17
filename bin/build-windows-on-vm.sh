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

# ── Self-read guard (WI-3306, 2026-07-08) ───────────────────────────────────
# The ENTIRE body runs inside this { } brace group, so bash parses the whole
# script into memory BEFORE executing any of it. This is a shared-tree script
# the fleet edits WHILE it runs; without the guard bash reads the file
# incrementally and a peer's mid-run edit shifts the running shell's read offset
# into changed bytes, corrupting execution — the exact cause of build6b's
# "line 284: ad: command not found" (EXIT 127, 2026-07-07). The matching } +
# exit 0 are at EOF. (bin/stage-source-tree.sh, called below, carries the same
# guard for its own multi-minute tar window.)
{

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

# ── Update source (WI-4389). This script runs on the LINUX box (it drives the
# Windows VM over ssh), so it can and must load the host itself. It already
# EXPORTS it into the VM's $env: block and already GATES the built .exe on the
# bytes (Assert-ReleaseHostBaked) — but both read PAPERCUSP_RELEASE_HOST from
# THIS process, which was only ever populated by release-local.sh. Run this
# script directly (the normal way to retry the Windows leg) and the var was
# empty: cargo baked an empty host, and the gate's own "no host configured —
# nothing to assert" branch waved it through. Loading it here closes that.
# shellcheck source=lib/release-host.sh
source "$HERE/lib/release-host.sh"
load_release_host

VM_SSH_KEY="${VM_SSH_KEY:-$HOME/.ssh/papercup-vm-win}"
VM_SSH_PORT="${VM_SSH_PORT:-2223}"
VM_SSH_HOST="${VM_SSH_HOST:-user@127.0.0.1}"
VM_BUILD_DIR="${VM_BUILD_DIR:-papercup-build-release}"   # under C:\Users\user\
# Single-file installer opt-in (owner-directed 2026-07-08): PAPERCUSP_SINGLE_FILE=1
# passes ISCC /DSingleFile → papercusp.iss omits DiskSpanning → one setup.exe even
# with the 2.2 GB source tree (for hosting off GitHub, whose assets cap at 2 GiB).
# Default = spanned <2 GiB slices so the standard GitHub release flow still works.
SPAN_DEFINE=""
[[ "${PAPERCUSP_SINGLE_FILE:-0}" == "1" ]] && SPAN_DEFINE='"/DSingleFile" '
KEY_FILE="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.papercusp/signing/papercusp.key}"
KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

# Exe-only fast-deploy mode (EI-8798, 2026-07-09): for a Rust/UI-only change
# where sidecar/rootfs/seed are byte-identical (FAST_ITER reuses them), the
# ONLY changed artifact is the ~21MB papercusp-desktop.exe — the full ISCC
# packaging (several minutes) + the 2.8GB Inno installer + a VERYSILENT
# reinstall over the VM ssh link (which can get killed mid-extract on a long
# blocking op, leaving a stuck *_setup.exe.tmp holding file locks) buys
# nothing for verifying that class of change. PAPERCUSP_EXE_ONLY=1 skips Inno
# packaging entirely and just scp's the freshly-built, freshly-signed exe(s)
# back to $OUT_DIR/exe-only/ — copy it over an existing install by hand
# (Copy-Item -Force over the installed .../papercusp-desktop.exe; no
# uninstall/reinstall needed since a dependency/resource-only change wasn't
# made). Optionally push it straight onto a running verify target: set
# PAPERCUSP_EXE_ONLY_DEPLOY_HOST (+ _PORT/_KEY, default this build VM's) and
# PAPERCUSP_EXE_ONLY_DEPLOY_PATH (the installed exe's path on that target) to
# have this script taskkill the app, overwrite the exe, and leave it stopped
# (relaunch is the caller's job — the install may be GUI or Server-role).
# A full dependency/resource change still needs a real (non-exe-only) build.
PAPERCUSP_EXE_ONLY="${PAPERCUSP_EXE_ONLY:-0}"
EXE_ONLY_DEPLOY_HOST="${PAPERCUSP_EXE_ONLY_DEPLOY_HOST:-}"
EXE_ONLY_DEPLOY_PATH="${PAPERCUSP_EXE_ONLY_DEPLOY_PATH:-}"
EXE_ONLY_DEPLOY_PORT="${PAPERCUSP_EXE_ONLY_DEPLOY_PORT:-$VM_SSH_PORT}"
EXE_ONLY_DEPLOY_KEY="${PAPERCUSP_EXE_ONLY_DEPLOY_KEY:-$VM_SSH_KEY}"
if [[ "$PAPERCUSP_EXE_ONLY" == "1" ]]; then
  echo "==> PAPERCUSP_EXE_ONLY=1: skipping ISCC/Inno packaging — collecting the built exe(s) only"
  [[ -n "$EXE_ONLY_DEPLOY_HOST" && -z "$EXE_ONLY_DEPLOY_PATH" ]] && fail "PAPERCUSP_EXE_ONLY_DEPLOY_HOST set without PAPERCUSP_EXE_ONLY_DEPLOY_PATH"
fi

# -o IdentitiesOnly=yes: pin auth to $VM_SSH_KEY only. Without it, a loaded
# ssh-agent with >5 keys exhausts the server's auth-tries on agent keys first
# and fails "Too many authentication failures" before the -i key is tried
# (bit a WI-800 rebuild, 2026-06-25).
# -o ServerAliveCountMax=20: the default (3) kills the session after 90s of VM
# unresponsiveness — a host load spike starves the VM's sshd for longer than
# that and aborted a 0.0.7 release leg mid-build (2026-07-10, load avg >2000).
# 20 × 30s = 10 min of tolerance before declaring the VM dead.
SSH=(ssh -i "$VM_SSH_KEY" -o IdentitiesOnly=yes -p "$VM_SSH_PORT" -o ConnectTimeout=10 -o ServerAliveInterval=30 -o ServerAliveCountMax=20 "$VM_SSH_HOST")
SCP=(scp -i "$VM_SSH_KEY" -o IdentitiesOnly=yes -P "$VM_SSH_PORT" -o ConnectTimeout=10)

fail() { echo "ERROR: $*" >&2; exit 1; }

# WI-4642 / P-021: this VM + VM_BUILD_DIR is shared across every agent and
# every release cut. Acquire the registered host+directory lease BEFORE any
# destructive preflight, extract, or build. The lease helper heartbeats for a
# long build, declares a latched release event, and verifies cleanup on every
# exit/signal. Contention fails here, before either run can touch the VM.
# shellcheck source=lib/windows-build-resource-lease.sh
source "$HERE/lib/windows-build-resource-lease.sh"
windows_build_lease_acquire \
  "$VM_SSH_HOST" "$VM_SSH_PORT" "$VM_BUILD_DIR" \
  "Windows desktop build${PAPERCUSP_BUILD_VERSION:+ version=$PAPERCUSP_BUILD_VERSION}" \
  "${PAPERCUSP_WINDOWS_BUILD_ETA_SEC:-7200}" \
  || fail "Windows VM/build directory is leased by another run; see locks:list for owner, purpose, ETA, and release event"

windows_build_cleanup() {
  local status="$?"
  trap - EXIT
  if [[ -n "${TARBALL:-}" ]]; then
    rm -f "$TARBALL" "$TARBALL.fp" "$TARBALL.totals.log"
  fi
  if ! windows_build_lease_release && [[ "$status" == "0" ]]; then
    status=74
  fi
  exit "$status"
}
trap windows_build_cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Content hash of everything that decides whether the Rust binary compiles and
# what it is. EI-8914: the shared checkout is edited CONCURRENTLY by the whole
# fleet, so "the tree we gated" and "the tree we packed" are different trees
# unless we prove otherwise. Cheap enough to call several times.
rust_src_fingerprint() {
  {
    find "$ROOT/src-tauri/src" -type f -name '*.rs' -print0 2>/dev/null | sort -z | xargs -0 -r sha256sum 2>/dev/null
    sha256sum "$ROOT/src-tauri/Cargo.toml" "$ROOT/src-tauri/Cargo.lock" 2>/dev/null
    sha256sum "$ROOT"/src-tauri/tauri*.conf.json 2>/dev/null
  } | sha256sum | cut -d' ' -f1
}

[[ -d "$ROOT/src-tauri/sidecar/apps" ]] || fail "sidecar not built — run bin/build-desktop-sidecar.sh first"
[[ -f "$ROOT/src-tauri/resources/papercup-runtime.tar.gz" ]] || fail "WSL rootfs missing — run scripts/build-rootfs.sh first"

# ── WSL rootfs freshness contract — FAIL-CLOSED (WI-4448) ────────────────────
# This script never rebuilds the rootfs; it ships whatever tarball is on disk.
# So a fix made to scripts/build-rootfs.sh (say, adding a library the distro
# needs) reaches the shipped distro ONLY if someone re-ran that script — and if
# they did not, EVERYTHING STILL GOES GREEN. The Rust half of the fix ships, the
# distro half does not, and the failure surfaces in the user's hands.
#
# That nearly shipped: the checked-in tarball predated libasound2t64, so the new
# Windows chat dock would have opened a zellij session whose chat pane was a dead
# binary. Nothing in the build would have said a word.
#
# So verify the tarball against the recipe that produced it. The fingerprint is
# derived BY build-rootfs.sh (--print-recipe-fingerprint), never reimplemented
# here — a checker that re-derives the producer's knowledge drifts from it, and
# that drift is the bug, not the check.
verify_rootfs_freshness() {
  local res="$ROOT/src-tauri/resources"
  local tarball="$res/papercup-runtime.tar.gz"
  local stamp="$res/.rootfs-build-stamp"
  if [[ "${PAPERCUSP_ALLOW_STALE_ROOTFS:-0}" == "1" ]]; then
    echo "==> ⚠ PAPERCUSP_ALLOW_STALE_ROOTFS=1 — skipping the WSL rootfs freshness guard (WI-4448)"
    return 0
  fi
  [[ -f "$stamp" ]] || fail "WSL rootfs has no freshness stamp ($stamp) — it was built by an old build-rootfs.sh, so we cannot tell whether it matches the current recipe. Rebuild: bash scripts/build-rootfs.sh. Override: PAPERCUSP_ALLOW_STALE_ROOTFS=1. (WI-4448)"

  local want_recipe have_recipe
  want_recipe="$(grep -oE '"recipeSha256"[[:space:]]*:[[:space:]]*"[0-9a-f]{64}"' "$stamp" | grep -oE '[0-9a-f]{64}' | head -1)"
  have_recipe="$(bash "$ROOT/scripts/build-rootfs.sh" --print-recipe-fingerprint 2>/dev/null)"
  [[ -n "$want_recipe" && -n "$have_recipe" ]] || fail "could not derive the WSL rootfs recipe fingerprint (stamp=${want_recipe:-<none>} current=${have_recipe:-<none>}) — rebuild: bash scripts/build-rootfs.sh. Override: PAPERCUSP_ALLOW_STALE_ROOTFS=1. (WI-4448)"
  [[ "$want_recipe" == "$have_recipe" ]] || fail "WSL rootfs is STALE: scripts/build-rootfs.sh has changed since this tarball was built (recipe now ${have_recipe:0:12}…, tarball built from ${want_recipe:0:12}…). Shipping it would silently omit whatever that change added — the build would go GREEN and the distro would be broken in the user's hands. Rebuild: bash scripts/build-rootfs.sh. Override: PAPERCUSP_ALLOW_STALE_ROOTFS=1. (WI-4448)"

  # The tarball must also be the one the stamp describes — catches a half-written
  # export, or a concurrent rebuild swapping it mid-cut.
  local want_tar have_tar
  want_tar="$(grep -oE '"rootfsSha256"[[:space:]]*:[[:space:]]*"[0-9a-f]{64}"' "$stamp" | grep -oE '[0-9a-f]{64}' | head -1)"
  have_tar="$(sha256sum "$tarball" 2>/dev/null | cut -d' ' -f1)"
  [[ -n "$want_tar" && -n "$have_tar" ]] || fail "could not hash the WSL rootfs tarball for the freshness guard — rebuild: bash scripts/build-rootfs.sh. Override: PAPERCUSP_ALLOW_STALE_ROOTFS=1. (WI-4448)"
  [[ "$want_tar" == "$have_tar" ]] || fail "WSL rootfs tarball ($have_tar) does not match its build stamp ($want_tar) — it is corrupt, half-exported, or was swapped by a concurrent rebuild. Rebuild: bash scripts/build-rootfs.sh. Override: PAPERCUSP_ALLOW_STALE_ROOTFS=1. (WI-4448)"

  echo "==> ✓ WSL rootfs freshness verified (recipe ${have_recipe:0:12}…, WI-4448)"
}
verify_rootfs_freshness

# ── P-004 (desktop-build-hardening-tri-platform-2026-07-11): sidecar freshness
# contract — FAIL-CLOSED (D-003) ─────────────────────────────────────────────
# This script PACKS sidecar/serve.mjs AS-IS (it never rebuilds the sidecar), so
# a stale serve.mjs left from an older operator build would ship silently — the
# artifact-level LABELED!=PACKED class (the Rust source is already re-gated above
# via rust_src_fingerprint; the sidecar was the remaining hole). Verify the
# packed serve.mjs against the freshness stamp build-desktop-sidecar.sh writes.
# Fail-closed: on ANY mismatch ABORT rather than ship an unverifiable bundle —
# never silently auto-rebuild (D-003). Escape hatch: PAPERCUSP_ALLOW_STALE_SIDECAR=1.
verify_sidecar_freshness() {
  local sc="$ROOT/src-tauri/sidecar"
  local stamp="$sc/.sidecar-build-stamp"
  if [[ "${PAPERCUSP_ALLOW_STALE_SIDECAR:-0}" == "1" ]]; then
    echo "==> ⚠ PAPERCUSP_ALLOW_STALE_SIDECAR=1 — skipping the sidecar freshness guard (P-004)"
    return 0
  fi
  [[ -f "$stamp" ]] || fail "sidecar has no freshness stamp ($stamp) — it was built by an old build-desktop-sidecar.sh or hand-assembled. Rebuild: bash bin/build-desktop-sidecar.sh (then re-run). Override: PAPERCUSP_ALLOW_STALE_SIDECAR=1. (P-004)"
  local want_serve have_serve
  want_serve="$(grep -oE '"serveSha256"[[:space:]]*:[[:space:]]*"[0-9a-f]{64}"' "$stamp" | grep -oE '[0-9a-f]{64}' | head -1)"
  have_serve="$(sha256sum "$sc/serve.mjs" 2>/dev/null | cut -d' ' -f1)"
  [[ -n "$want_serve" && -n "$have_serve" ]] || fail "could not compute serve.mjs sha for the freshness guard (stamp=${want_serve:-<none>} packed=${have_serve:-<none>}) — rebuild the sidecar. (P-004)"
  [[ "$want_serve" == "$have_serve" ]] || fail "packed serve.mjs ($have_serve) does not match its build stamp ($want_serve) — the sidecar tree is stale / corrupt / half-swapped by a concurrent build. Rebuild: bash bin/build-desktop-sidecar.sh. Override: PAPERCUSP_ALLOW_STALE_SIDECAR=1. (LABELED!=PACKED, P-004)"
  # Cut-scoped freshness: release-local exports the cut-start epoch, so the
  # sidecar MUST have been (re)built at/after it — i.e. as part of THIS cut, not
  # a stale leftover from a prior build hours/days ago.
  if [[ -n "${PAPERCUSP_SIDECAR_MIN_EPOCH_SEC:-}" ]]; then
    local built_epoch
    built_epoch="$(grep -oE '"epochSec"[[:space:]]*:[[:space:]]*[0-9]+' "$stamp" | grep -oE '[0-9]+' | head -1)"
    if [[ "${built_epoch:-0}" -lt "$PAPERCUSP_SIDECAR_MIN_EPOCH_SEC" ]]; then
      fail "sidecar predates this cut (built epoch ${built_epoch:-0} < cut-start $PAPERCUSP_SIDECAR_MIN_EPOCH_SEC) — it was NOT rebuilt for this release, so it may ship stale operator code. Rebuild: bash bin/build-desktop-sidecar.sh. Override: PAPERCUSP_ALLOW_STALE_SIDECAR=1. (P-004)"
    fi
  fi
  # Byte-exact to the serve.mjs release-local freshly built for THIS cut, when it
  # drives us — catches a concurrent `tauri dev`/rebuild swapping serve.mjs mid-cut.
  if [[ -n "${PAPERCUSP_EXPECTED_SERVE_SHA:-}" && "$PAPERCUSP_EXPECTED_SERVE_SHA" != "$have_serve" ]]; then
    fail "packed serve.mjs ($have_serve) != the sidecar release-local built for this cut ($PAPERCUSP_EXPECTED_SERVE_SHA) — a concurrent sidecar rebuild swapped it mid-cut. Rebuild + re-pack. Override: PAPERCUSP_ALLOW_STALE_SIDECAR=1. (P-004)"
  fi
  echo "==> ✓ sidecar freshness verified (serve.mjs ${have_serve:0:12}…, P-004)"
}
verify_sidecar_freshness

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
# Remember exactly WHICH tree that gate passed on. The pack is minutes away
# (seed cut + a 2.2G zstd source stage sit in between); if a peer edits
# src-tauri/src in that window the gate's verdict no longer describes what we
# are about to ship, and we re-gate before packing. EI-8914.
PRECHECK_FP="$(rust_src_fingerprint)"
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
  # Depth-1 is now the release default EVERYWHERE (owner directive 2026-07-07:
  # trim git history from release builds, full history stays on GitHub —
  # mac-vm-build.sh + release-local.sh align). Windows additionally NEEDS it
  # for the installer size cap: a FULL-HISTORY git bundle of this monorepo is
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
  # WI-3244: snapshotting the LIVE per-workspace corestore fails "File descriptor
  # could not be locked" while the operator/substrate on this box holds it open —
  # the cutter needs a quiescent store. PAPERCUSP_SEED_REUSE_CORESTORE=1 instead
  # grafts the ALREADY-CUT corestore from src-tauri/seed onto a fresh git cut
  # (cut-seed-cli --reuse-corestore, WI-3232): no quiesce, no lock, fresh code
  # seed. The corestore snapshot is then as old as the last full cut — fine for
  # dogfood; do a quiesced full cut when the hive STATE itself must be current.
  if [[ "${PAPERCUSP_SEED_REUSE_CORESTORE:-0}" == "1" ]]; then
    core_args=(--reuse-corestore "$ROOT/src-tauri/seed")
    [[ -n "${PAPERCUSP_SEED_STORE_DIR:-}" ]] && echo "WARN: PAPERCUSP_SEED_STORE_DIR ignored under PAPERCUSP_SEED_REUSE_CORESTORE=1" >&2
  fi
  # WI-3232 (owner: "Full pot, plaintext seed" — alpha dogfood): the installer seed
  # MUST carry seed/epoch-keys.json or a fresh offline install cannot decrypt the
  # pot (no admission ever happens). cut-seed-cli emits it only on --emit-epoch-key,
  # and this script historically never passed it — every epoch-keyed seed so far
  # came from a manual cut. Opt out for a non-dogfood build with
  # PAPERCUSP_SEED_EMIT_EPOCH_KEY=0 (ships the hive readable — deliberate here).
  local emit_args=()
  [[ "${PAPERCUSP_SEED_EMIT_EPOCH_KEY:-1}" == "1" ]] && emit_args+=(--emit-epoch-key)
  # P-004 trim: --sparse ships only the head-snapshot span (~40MB vs ~2.1GB) of a FRESH
  # corestore cut. Gated OFF for --no-corestore AND reuse=1 (a grafted corestore ships
  # as-cut, coreSparseFrom preserved) — cut-seed-cli THROWS on either. Default-ON;
  # PAPERCUSP_SEED_SPARSE=0 forces full history.
  local sparse_args=()
  [[ "${PAPERCUSP_SEED_CORESTORE:-1}" == "1" && "${PAPERCUSP_SEED_REUSE_CORESTORE:-0}" != "1" && "${PAPERCUSP_SEED_SPARSE:-1}" == "1" ]] && sparse_args+=(--sparse)
  echo "==> seed: cutting installer seed (hive=$seed_hive rev=$seed_rev depth=${seed_depth:-full} corestore=${PAPERCUSP_SEED_CORESTORE:-1} reuse=${PAPERCUSP_SEED_REUSE_CORESTORE:-0} sparse=$([[ ${#sparse_args[@]} -gt 0 ]] && echo 1 || echo 0))"
  local depth_args=()
  [[ -n "$seed_depth" ]] && depth_args+=(--depth "$seed_depth")
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
        "${core_args[@]}" \
        "${sparse_args[@]}" \
        "${emit_args[@]}"
  ) || fail "seed cut failed (PAPERCUSP_SEED_REUSE_CORESTORE=1 grafts the existing corestore when the live store is fd-locked by the running operator; PAPERCUSP_SKIP_SEED_CUT=1 reuses the whole existing seed)"
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
# Retired local artifacts (sidecar/code-server + sidecar/bin/omp) are excluded
# from the tar if a stale local build left them behind — see the tar excludes
# below.
raw_kb=$(du -sk --dereference "$ROOT/src-tauri/seed" "$ROOT/src-tauri/resources" 2>/dev/null | awk '{s+=$1} END {print s+0}')
raw_cap_kb=$((3482 * 1024)) # 3.4GiB raw-stored cap (full seed ~2.5GiB by design)
if (( raw_kb > raw_cap_kb )); then
  du -sh --dereference "$ROOT/src-tauri/seed" "$ROOT/src-tauri/resources" 2>/dev/null || true
  fail "raw-stored payload (seed+resources) is $((raw_kb / 1024 / 1024))GiB (> 3.4GiB guard, WI-3172) — these ship uncompressed inside the Inno setup.exe, which maxes at ~4GB. The full offline seed is ~2.5GiB by design; check for an unexpectedly-large corestore/git cut (full-history git? duplicate snapshot?) before building. PAPERCUSP_SEED_DEPTH= (full history) canNOT fit — see the seed-cut comment above."
fi

echo "==> packing desktop tree"
TARBALL="$(mktemp /tmp/papercusp-desktop-build-XXXX.tar.gz)"
# -h dereferences symlinks (node_modules/.bin shims) — Windows tar can't
# create them. Keep sidecar/**/node_modules (runtime deps); drop only the
# desktop repo's own toolchain node_modules.
#
# Windows payload trims: code-server and sidecar/bin/omp are retired, but older
# local builds may still have those large gitignored artifacts under sidecar/.
# Keep excluding them so a stale tree cannot bloat the VM upload.
# Serialize the pack against build-desktop-sidecar.sh's atomic sidecar publish:
# that script holds an flock on src-tauri/sidecar.lock for its whole build and
# finishes with an atomic rename of sidecar.tmp.<pid> → sidecar/. In a shared
# tree a CONCURRENT fleet sidecar build renaming sidecar/ mid-tar makes tar die
# "file changed as we read it" (STAGE2_FAILED exit=1, observed 2026-07-03 with
# two agents building at once). Taking the SAME lock blocks the tar until any
# in-flight publish completes AND blocks a new publish from starting until the
# read is done, so the tree is stable across the whole pack. flock creates the
# lock file if absent (harmless — it's excluded from the tarball below).
(
  flock 9
  # ── dev/local runnable source tree (WI-3306/WI-3308 all-5-buttons) ──
  # stage-source-tree.sh self-gates on PAPERCUSP_STAGE_SOURCE=1 (prints a skip
  # line otherwise) and writes src-tauri/sidecar/source.tar.zst. Staged INSIDE
  # this flock: sidecar/ is atomically REPLACED by every sidecar publish, so an
  # archive staged outside the lock can be silently wiped by a concurrent fleet
  # build and the pack would ship a 3-button bundle with no error. The archive
  # is deliberately NOT in the seed+resources raw guard above — papercusp.iss
  # self-detects it (FileExists) and flips the Server role to DiskSpanning
  # (setup.exe + *.bin slices), so Inno's ~4GB single-exe max no longer binds.
  # PAPERCUSP_SIDECAR_LOCK_HELD=1: we already hold `flock 9` on sidecar.lock for
  # this whole subshell (the `9>>…/sidecar.lock` at the closing paren below), so
  # stage-source-tree.sh must NOT re-acquire it — its `exec 9>` opens a fresh,
  # unlocked file description that then blocks on ours, self-deadlocking the whole
  # win leg (observed + killed on the 2026-07-13 0.0.9 cut). The lock we hold
  # already serializes this stage against any concurrent sidecar publish.
  PAPERCUSP_SIDECAR_LOCK_HELD=1 bash "$ROOT/bin/stage-source-tree.sh"
  if [[ "${PAPERCUSP_STAGE_SOURCE:-0}" == "1" ]]; then
    [[ -f "$ROOT/src-tauri/sidecar/source.tar.zst" ]] \
      || fail "PAPERCUSP_STAGE_SOURCE=1 but stage-source-tree.sh left no src-tauri/sidecar/source.tar.zst"
    echo "    source.tar.zst staged ($(du -h "$ROOT/src-tauri/sidecar/source.tar.zst" | cut -f1)) — Server role will DiskSpan"
  fi
  # ── env-sidecars/staging (WI-3285 P-004; pinned contract, plan
  # env-switcher-packaged-all-platforms-2026-07-06) ──
  # The packaged env switcher spawns <sidecarDir>/env-sidecars/<envId>/serve.mjs.
  # V1 ships exactly ONE extra bundle: staging — and since THIS build is cut from
  # the staging tip, the bundle HARDLINKS the primary sidecar's payload (tar
  # stores hardlinked content once, so the 3.4GiB raw guard and pack time are
  # unaffected; Inno compresses the extra copy per-file at ISCC time). Staged
  # OUTSIDE sidecar/ (build-desktop-sidecar.sh's atomic publish REPLACES sidecar/
  # wholesale — anything inside would be silently wiped) and re-staged fresh on
  # every pack, inside the same flock, so it can never go stale or race a
  # publish. Sidecar-shaped per the contract: serve.mjs + spa/ + db-sql/ (+
  # prompts/harness when present). NO bin/ (the launcher reuses the primary's
  # node), NO internal-docs (V1 env serves no /internal/docs), NO db-seed (the
  # env attaches to the primary's embedded PG, EI-126 request-only).
  ENV_SC="$ROOT/src-tauri/env-sidecars/staging"
  rm -rf "$ROOT/src-tauri/env-sidecars"
  mkdir -p "$ENV_SC"
  cp -al "$ROOT/src-tauri/sidecar/serve.mjs" "$ENV_SC/serve.mjs"
  cp -al "$ROOT/src-tauri/sidecar/spa" "$ENV_SC/spa"
  cp -al "$ROOT/src-tauri/sidecar/db-sql" "$ENV_SC/db-sql"
  for env_sc_extra in prompts harness; do
    if [[ -d "$ROOT/src-tauri/sidecar/$env_sc_extra" ]]; then
      cp -al "$ROOT/src-tauri/sidecar/$env_sc_extra" "$ENV_SC/$env_sc_extra"
    fi
  done
  echo "    env-sidecars/staging staged ($(du -sh "$ENV_SC" | cut -f1) apparent, hardlinked — ~0 extra tar bytes)"
  # GNU tar exits 1 for "file changed as we read it" — a WARNING (the entry is
  # still written), not corruption. The flock above serializes SIDECAR publishes,
  # but other shared-tree writers (e.g. the parallel linux leg of the same cut
  # re-staging/bundling) can still touch files mid-read; under the script's
  # set -e that exit 1 killed the ENTIRE win leg silently right here on the
  # 2026-07-09 desktop-v0.0.5-alpha cut (log ends at the tar warning, no error).
  # Tolerate exactly rc<=1 (warnings stay visible on stderr); rc>=2 stays fatal —
  # same policy as stage-source-tree.sh.
  # ── EI-8914 pack-verify loop ──────────────────────────────────────────────
  # The flock above only serializes SIDECAR publishes. src-tauri/src is still
  # live: a peer editing main.rs mid-tar gets packed half-written (and the
  # tolerated rc==1 "file changed as we read it" warning HIDES it), while an
  # edit landing between the pre-check and the tar ships code no Windows gate
  # ever saw. Both were observed on 2026-07-09: a peer's `sweep_orphaned_
  # sidecars()` call went in with only a `#[cfg(unix)]` definition, so the
  # windows target was E0425-red for ~90s. That failure would otherwise have
  # surfaced ~35 min later, on the VM, as "the Windows build is broken".
  #
  # Fingerprint → pack → re-fingerprint. If the source moved during the tar,
  # the tarball may be torn: throw it away and repack. If the source no longer
  # matches what the Windows gate approved, re-gate before spending the VM.
  packed_ok=0
  for pack_attempt in 1 2 3; do
    fp_pre="$(rust_src_fingerprint)"
    if [[ "$fp_pre" != "$PRECHECK_FP" ]]; then
      echo "    src-tauri/src changed since the Windows-cfg gate — re-gating the tree we are about to pack (attempt $pack_attempt/3)"
      if [[ "${SKIP_WINDOWS_CFG_PRECHECK:-0}" != "1" ]]; then
        set +e; "$HERE/check-windows-cfg.sh"; regate_rc=$?; set -e
        (( regate_rc == 0 || regate_rc == 2 )) \
          || fail "Windows-cfg gate FAILED on the tree about to be packed — a peer edit landed after the early pre-check (EI-8914). Nothing was shipped. Re-run once the tree is green."
      fi
      PRECHECK_FP="$fp_pre"
    fi

    set +e
    # WI-4232: --totals writes the pre-compression byte count to stderr
    # ("Total bytes written: N") — captured to a log so the disk-preflight
    # step below can compute the REAL space requirement (the VM extract needs
    # the tarball + this many uncompressed bytes to coexist, WI-3360) instead
    # of a stale fixed threshold. Captured to a file rather than `2>&1 |
    # tee`'d so the tolerated "file changed as we read it" warning (rc<=1,
    # see above) still reaches stderr live for a human watching the build.
    tar --totals -czhf "$TARBALL" \
      --exclude='.git' \
      --exclude='papercusp-desktop/node_modules' \
      --exclude='papercusp-desktop/web/node_modules' \
      --exclude='src-tauri/target' \
      --exclude='src-tauri/sidecar.tmp.*' \
      --exclude='src-tauri/sidecar.lock*' \
      --exclude='src-tauri/sidecar/code-server' \
      --exclude='src-tauri/sidecar/bin/omp' \
      -C "$ROOT/.." papercusp-desktop 2>"$TARBALL.totals.log"
    tar_rc=$?
    set -e
    cat "$TARBALL.totals.log" >&2
    (( tar_rc <= 1 )) || fail "desktop-tree pack tar failed (exit $tar_rc)"

    fp_post="$(rust_src_fingerprint)"
    if [[ "$fp_pre" == "$fp_post" ]]; then
      packed_ok=1
      # Hand the packed tree's identity back across the subshell boundary.
      printf '%s\n' "$fp_pre" > "$TARBALL.fp"
      break
    fi
    echo "    ⚠ src-tauri/src changed DURING the pack (concurrent peer edit) — the tarball may be torn; repacking (attempt $pack_attempt/3)" >&2
  done
  (( packed_ok == 1 )) \
    || fail "src-tauri/src kept changing under the pack after 3 attempts (EI-8914) — a peer is actively editing. Wait for the tree to quiesce, then re-run."
) 9>>"$ROOT/src-tauri/sidecar.lock"
ls -lh "$TARBALL"

# WI-4232: the exact pre-compression size of the packed tree, captured via
# `tar --totals` during the pack above — used below to compute the VM disk
# preflight requirement. Deliberately NOT `gzip -l` (its trailer is a 32-bit
# ISIZE that wraps silently for an archive whose *uncompressed* content
# exceeds 4GiB — a real risk here since the full offline seed alone is
# ~2.5GiB and a fat cut's tarball has been observed at 9.1G compressed).
TAR_UNCOMPRESSED_BYTES="$(grep -oE 'Total bytes written: [0-9]+' "$TARBALL.totals.log" 2>/dev/null | grep -oE '[0-9]+$' || true)"
rm -f "$TARBALL.totals.log"
[[ -n "$TAR_UNCOMPRESSED_BYTES" ]] \
  || fail "could not parse the uncompressed tarball size out of 'tar --totals' output (WI-4232) — cannot compute the VM disk preflight requirement"

# ── Pre-flight: reclaim stale build output, then assert the VM has enough free
# space for THIS build — not a fixed guess. WI-3360 build#7 died when C: hit 0
# during the tar extract, truncating src-tauri/src/main.rs (and serve.mjs, the
# bin/* binaries, db-seed) into a bogus Rust "expected item after doc comment"
# error, NOT a real code fault. The bundle/inno output (~4 GB of installer
# .bin/.exe) is regenerated every build and already copied back to OUT_DIR, so
# it is always safe to drop before re-extracting.
#
# WI-4232: a prior version of this check asserted a FIXED "free >= 6GB" —
# but the real requirement scales with the tarball being shipped (the extract
# needs the compressed tarball AND its extracted tree to coexist on disk,
# WI-3360) plus the build's own output. A build with 7.84GB free PASSED the
# fixed check, then died mid-scp on a 9.1G tarball minutes later. Compute the
# real number instead: tarball bytes (compressed, coexists with the extracted
# tree during `tar -xzf`) + extracted bytes (uncompressed, exact — from
# `tar --totals` above, not guessed) + a payload-independent build headroom
# (fresh MSVC cargo target dir + npm install + the Inno installer output,
# ~4GB alone per WI-3172) + slack. Overridable via env for a future build that
# outgrows the historical headroom.
BUILD_HEADROOM_GB="${BUILD_HEADROOM_GB:-8}"
PREFLIGHT_SLACK_GB="${PREFLIGHT_SLACK_GB:-2}"
TAR_BYTES=$(stat -c%s "$TARBALL")
REQUIRED_BYTES=$(( TAR_BYTES + TAR_UNCOMPRESSED_BYTES + BUILD_HEADROOM_GB * 1024 * 1024 * 1024 + PREFLIGHT_SLACK_GB * 1024 * 1024 * 1024 ))
REQUIRED_GB=$(awk "BEGIN { printf \"%.2f\", $REQUIRED_BYTES/1024/1024/1024 }")
REQUIRED_BREAKDOWN="$(( TAR_BYTES/1024/1024/1024 ))G tarball + $(( TAR_UNCOMPRESSED_BYTES/1024/1024/1024 ))G extract + ${BUILD_HEADROOM_GB}G build headroom + ${PREFLIGHT_SLACK_GB}G slack = ${REQUIRED_GB}G required"
# RECLAIM THE OLD TREE *BEFORE* ASSERTING, NOT AFTER (the double-count).
# The extract step below deletes $VM_BUILD_DIR wholesale and untars a fresh tree into
# it — so the old tree's bytes are NOT competing with the new build and must not be
# counted against it. Asserting first and reclaiming later demanded room for BOTH at
# once, which is a free-space bar the build never actually has to clear. It is not
# hypothetical: attempt9's own killed extract left a 6.4GB tree behind, and the next
# cut then failed DISK_TOO_LOW at 15.3GB free on a VM that had 21.7GB once that
# doomed tree was subtracted. A cut refusing to start over space it is about to free
# is a false negative, and the "fix" it invites (hand-deleting on the VM) is a manual
# step that has to be repeated after every failure.
# FAST_ITER is the deliberate exception: it extracts OVER the existing dir precisely to
# keep target/ + node_modules warm, so there the old tree IS live and only the narrow
# stale outputs are reclaimable.
if [[ "${PAPERCUSP_FAST_ITER:-0}" == "1" ]]; then
  RECLAIM_PS="Remove-Item -Recurse -Force 'C:\\Users\\user\\$VM_BUILD_DIR\\papercusp-desktop\\src-tauri\\target\\release\\bundle\\inno' -EA SilentlyContinue;"
  RECLAIM_DESC="stale inno output (FAST_ITER: keeping the build dir + caches)"
else
  RECLAIM_PS="Remove-Item -Recurse -Force 'C:\\Users\\user\\$VM_BUILD_DIR' -EA SilentlyContinue;"
  RECLAIM_DESC="the whole previous build dir (the extract deletes it anyway)"
fi
RECLAIM_PS="$RECLAIM_PS Remove-Item -Force 'C:\\Users\\user\\papercusp-desktop-build.tar.gz' -EA SilentlyContinue;"

echo "==> pre-flight: reclaiming $RECLAIM_DESC, THEN asserting free space ($REQUIRED_BREAKDOWN)"
VM_FREE_OUTPUT="$("${SSH[@]}" "powershell -NoProfile -Command \"$RECLAIM_PS \$f=[math]::Round((Get-PSDrive C).Free/1GB,2); Write-Output ('VM C: free = '+\$f+' GB'); if (\$f -lt $REQUIRED_GB) { Write-Output 'DISK_TOO_LOW'; exit 1 }\"" \
  | tr -d '\r')" \
  || fail "VM C: has <${REQUIRED_GB}GB free even after reclaiming stale output ($REQUIRED_BREAKDOWN — was: $VM_FREE_OUTPUT) — free space before rebuilding (WI-3360: a full disk truncates main.rs mid-extract; the extract needs the tarball + extracted tree to coexist). Quick reclaim: 'powercfg -h off' drops hiberfil.sys (~12 GB on a headless build VM), or delete old version-scoped installers under C:\\Users\\user\\$VM_BUILD_DIR. (WI-4232: this requirement is now computed from the actual tarball size, not a stale fixed 6GB — set BUILD_HEADROOM_GB / PREFLIGHT_SLACK_GB to retune it.)"
echo "    $VM_FREE_OUTPUT"

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
  # node_modules persists across FAST_ITER builds — skip the reinstall when it is
  # already there. Change a dependency? run a full (non-FAST_ITER) build once.
  # ASCII ONLY inside PS1-bound strings: an em dash here once rendered as a
  # CP-1252 smart quote on the VM and truncated the string mid-line (the BOM
  # below now also guards this class).
  NPM_INSTALL_BLOCK='if (Test-Path node_modules) { Write-Host "[build] FAST_ITER: node_modules present - skipping npm install" } else { Write-Host "[build] npm install"; npm install --no-audit --no-fund 2>&1 }'
else
  NPM_INSTALL_BLOCK=
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
  if [[ "$PAPERCUSP_EXE_ONLY" == "1" ]]; then
    SERVER_BUILD_BLOCK=$'Write-Host "[build] tauri build: Papercusp Server (--no-bundle)"\nnpx tauri build --no-bundle --config src-tauri/tauri.server.conf.json 2>&1\nWrite-Host "[build] Server EXIT=$LASTEXITCODE"\nAssert-ReleaseHostBaked "src-tauri\\target\\release\\papercusp-desktop.exe"\nSign-File "src-tauri\\target\\release\\papercusp-desktop.exe"\nWrite-Host "[build] EXE_ONLY: skipping ISCC Server packaging"\nWrite-Host "[build] ISCC Server EXIT=0"\nCopy-Item -Force "src-tauri\\target\\release\\papercusp-desktop.exe" "src-tauri\\target\\release\\papercusp-desktop-Server.exe"'
  else
    SERVER_BUILD_BLOCK=$'Write-Host "[build] tauri build: Papercusp Server (--no-bundle)"\nnpx tauri build --no-bundle --config src-tauri/tauri.server.conf.json 2>&1\nWrite-Host "[build] Server EXIT=$LASTEXITCODE"\nAssert-ReleaseHostBaked "src-tauri\\target\\release\\papercusp-desktop.exe"\nSign-File "src-tauri\\target\\release\\papercusp-desktop.exe"\nInvoke-Inno "Server" "com.papercusp.server" "Papercusp Server"'
  fi
fi

# ── EI-8914: DERIVE the provenance label from the tree we actually packed ──
# `PAPERCUSP_BUILD_SHA` is baked in via option_env! and self-reported by the
# operator at /api/health. It used to be a caller-supplied constant tied to
# nothing: the 0.0.5 cut on 2026-07-09 shipped `1a161ab-wi3407` while its
# packed main.rs was byte-identical to ecea544 — 767 files and ~10k lines
# apart. A release artifact that lies about its own provenance is worse than
# one with no label at all. The commit portion is now COMPUTED; callers may
# only add a human suffix via PAPERCUSP_BUILD_TAG.
#
# Note the label can never be a bare commit: the pack snapshots the WORKING
# TREE, which on this fleet is ~always dirty against HEAD (git-sync commits on
# a schedule). So say so, with `-dirty`.
PACKED_FP="$(cat "$TARBALL.fp" 2>/dev/null || echo unknown)"
_head_sha="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo nogit)"
if ! git -C "$ROOT" diff --quiet HEAD -- src-tauri 2>/dev/null; then
  _head_sha="${_head_sha}-dirty"
fi
if [[ -n "${PAPERCUSP_BUILD_SHA:-}" ]]; then
  echo "==> ⚠ PAPERCUSP_BUILD_SHA is DEPRECATED (EI-8914): a caller-supplied commit is not tied to the packed bytes." >&2
  echo "    Demoting '${PAPERCUSP_BUILD_SHA}' to a suffix. Use PAPERCUSP_BUILD_TAG for human context." >&2
  PAPERCUSP_BUILD_TAG="${PAPERCUSP_BUILD_TAG:-$PAPERCUSP_BUILD_SHA}"
fi
PAPERCUSP_BUILD_SHA="${_head_sha}${PAPERCUSP_BUILD_TAG:+-${PAPERCUSP_BUILD_TAG}}"
echo "==> build provenance: sha=$PAPERCUSP_BUILD_SHA version=${PAPERCUSP_BUILD_VERSION:-<tauri.conf.json>} packed-src=${PACKED_FP:0:16}"

# ── WI-4389: the release host must be PACKED, not merely LABELED ─────────────
# main.rs bakes the update source with option_env!("PAPERCUSP_RELEASE_HOST") at
# COMPILE time, and the compile happens on the VM over ssh. Env does NOT cross
# ssh: the var reaches cargo only via the \$env: block in the PS1 below. Omit it
# and cargo bakes an EMPTY string and the compile SUCCEEDS — the installer works,
# the bundle is signed, latest.json verifies, and the shipped app polls nothing
# forever, because the Tauri updater cannot tell a failed check from "no update".
# That is exactly the 0.0.8 defect, and it was found only by grepping the shipped
# binary AFTER the fact.
#
# The mac leg already gates on this (bin/assert-release-host-baked.sh, called from
# mac-vm-build.sh) — Windows never got wired to it, so the identical bug could ship
# here silently. Gate on the BYTES, on the VM, right after each cargo build: the
# raw exe is what Inno packages, and it never comes back to this host in the normal
# (non-EXE_ONLY) path, so a host-side grep could not see it.
#
# Needle = the host's AUTHORITY only (scheme + secret path stripped) — same rule as
# assert-release-host-baked.sh, so the secret-bearing path is never echoed into the
# ssh build log.
RELEASE_HOST_NEEDLE="${PAPERCUSP_RELEASE_HOST:-}"
RELEASE_HOST_NEEDLE="${RELEASE_HOST_NEEDLE#*://}"   # strip scheme
RELEASE_HOST_NEEDLE="${RELEASE_HOST_NEEDLE%%/*}"    # authority only
if [[ -z "$RELEASE_HOST_NEEDLE" ]]; then
  echo "==> WARNING: PAPERCUSP_RELEASE_HOST is unset — the Windows build will ship WITHOUT"
  echo "             an update source. Installers work; auto-update does NOT (the 0.0.8 defect)."
  echo "             release-local.sh sources ~/.papercusp/release-host.env; a standalone run does not."
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
# WI-4389 gate: prove the release host was PACKED into the bytes cargo just
# produced. "Set in the env block" is a LABEL; the only evidence it was PACKED is
# finding it inside the artifact. findstr is binary-safe and streams (the exe is
# large; ReadAllBytes would double it in RAM). ASCII only in this file.
function Assert-ReleaseHostBaked([string]\$path) {
  \$needle = "${RELEASE_HOST_NEEDLE}"
  if (-not \$needle) {
    Write-Host "[build] release-host assert: no host configured - nothing to assert (auto-update will NOT work)"
    return
  }
  if (-not (Test-Path \$path)) {
    Write-Host "[build] RELEASE HOST ASSERT ERROR: no such binary: \$path"
    exit 1
  }
  & findstr /M "/C:\$needle" "\$path" | Out-Null
  if (\$LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[build] X RELEASE HOST NOT BAKED: \$path"
    Write-Host "[build]   Expected the configured host ('\$needle') in the binary's bytes; it is ABSENT."
    Write-Host "[build]   This build would ship an app that can NEVER reach the update manifest, and it"
    Write-Host "[build]   would NOT look broken: the installer works, the bundle verifies, and the Tauri"
    Write-Host "[build]   updater renders a failed check as 'up to date' - PERMANENTLY. (The 0.0.8 defect.)"
    Write-Host '[build]   CAUSE: PAPERCUSP_RELEASE_HOST absent from the \$env: block below -- option_env!'
    Write-Host "[build]   then bakes an empty string and the compile SUCCEEDS."
    exit 1
  }
  Write-Host "[build] OK release host is BAKED into \$path"
}
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
  # Per-role seed note (EI-12909): only the Server bundle carries the seed
  # (papercusp.iss:109 guards it behind AppId == com.papercusp.server; the GUI
  # bundle ships NO seed — WI-3234). One shared line interpolating \$role must
  # NOT claim "full seed stored raw" for the seedless GUI. Slowness is
  # LZMA-compressing the ~50k-file sidecar (true for BOTH roles), not the seed.
  \$seedNote = if (\$role -eq 'Server') { 'incl. the raw-stored multi-GB seed' } else { 'no seed in this bundle — the GUI carries none (WI-3234)' }
  Write-Host "[build] ISCC \$role packaging (\$seedNote; SLOW — measured ~40+ min, LZMA-compressing the ~50k-file sidecar, EI-12902; ISCC output block-buffers on the VM, so this phase can look SILENT the whole time — that is NORMAL, not a hang)"
  & \$iscc "/DAppId=\$appId" "/DAppName=\$appName" "/DAppVersion=\$ver" "/DBuildRoot=\$buildRoot" "/O\$outDir" ${SPAN_DEFINE}"src-tauri\windows\inno\papercusp.iss" 2>&1 | Where-Object { \$_ -notmatch '^\s*Compressing' }
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
# WI-4389/WI-3875: the update source is baked by option_env!("PAPERCUSP_RELEASE_HOST")
# at COMPILE time, and the compile happens on the VM — so it must be set HERE, in the
# remote build's env, exactly like the two provenance vars above. It does not cross ssh
# on its own. Omit it and cargo bakes an EMPTY host: the shipped app polls nothing and
# the Tauri updater reads that as "up to date" FOREVER (the 0.0.8 defect that forced a
# full rebuild). release-local.sh exports it, so this script inherits it.
\$env:PAPERCUSP_RELEASE_HOST = "${PAPERCUSP_RELEASE_HOST:-}"
Write-Host "[build] PAPERCUSP_RELEASE_HOST=\$env:PAPERCUSP_RELEASE_HOST"
# WI-4781 (build-box-identity hygiene, cosmetic — not a security fix; parity
# with the mac/linux legs' identical RUSTFLAGS export): without
# --remap-path-prefix, Rust DEPENDENCY source-paths embed this VM's user
# profile dir (e.g. C:\Users\<build-user>\.cargo\registry\src\…\<crate>\src\*.rs)
# in shipped binaries' panic/debug strings. Non-sensitive (no credentials) but
# worth stripping. \$env:USERPROFILE is always set on Windows; CARGO_HOME
# defaults to %USERPROFILE%\.cargo when unset. Targets use forward slashes —
# --remap-path-prefix's replacement is an opaque string baked into the binary,
# not a real path, so this is valid on Windows too and avoids backslash-escaping
# a Windows path inside this generated PowerShell string.
\$env:RUSTFLAGS = "--remap-path-prefix=\$env:USERPROFILE=/build-home --remap-path-prefix=\$env:USERPROFILE\.cargo=/build-cargo"
Write-Host "[build] RUSTFLAGS=\$env:RUSTFLAGS"
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
Assert-ReleaseHostBaked "src-tauri\\target\\release\\papercusp-desktop.exe"
Sign-File "src-tauri\\target\\release\\papercusp-desktop.exe"
$( if [[ "$PAPERCUSP_EXE_ONLY" == "1" ]]; then
cat <<'PSEXE'
Write-Host "[build] EXE_ONLY: skipping ISCC GUI packaging"
Write-Host "[build] ISCC GUI EXIT=0"
Copy-Item -Force "src-tauri\target\release\papercusp-desktop.exe" "src-tauri\target\release\papercusp-desktop-GUI.exe"
PSEXE
else
echo 'Invoke-Inno "GUI" "com.papercusp.gui" "Papercusp GUI"'
fi )
${SERVER_BUILD_BLOCK}
EOF
"${SCP[@]}" "$BUILD_PS1" "$VM_SSH_HOST":'C:/Users/user/vm-release-build.ps1'
rm -f "$BUILD_PS1"

# ── Whole-leg build timeout (EI-12902) — MAC PARITY ──────────────────────────
# The mac leg bounds its remote build under PAPERCUSP_MAC_BUILD_TIMEOUT_SEC; the
# windows leg had NO bound at all. Its only limits were the ssh keepalives
# (ConnectTimeout / ServerAliveInterval / ServerAliveCountMax above), which prove
# the VM's sshd still ANSWERS — NOT that the build is PROGRESSING. So a build that
# wedges behind a network-alive VM (a deadlocked/spinning ISCC, a full disk, a
# stuck MSVC child) hung this blocking ssh FOREVER — and because release-local.sh's
# join_leg does a bare `wait "$pid"`, the ENTIRE cut hung with it: no watchdog, no
# diagnostic, no exit code.
#
# This is a WALL-CLOCK BACKSTOP, deliberately sized ABOVE a healthy build — NOT a
# tight bound. A real win leg legitimately runs LONG: measured on the 0.0.11 cut,
# GUI ISCC alone took 2,557s (42.6 min) packaging the ~4GB raw-stored seed, plus a
# comparable Server ISCC and two Rust builds ⇒ ~5,000-6,000s+ end to end. A naive
# small timeout would FALSELY KILL good builds (worse than a hang — a hang is at
# least honest), so the default is 10800s (3h), well clear of the measured cost and
# env-tunable. On timeout we do NOT re-invoke (a re-run doubles the wall clock, it
# does not save it — same D-005 reasoning as the mac leg): we fail with a named
# error + a tail of the leg log and leave the VM build running for inspection.
# (A progress-based SILENCE detector would be the better long-term shape, but it
# needs the remote ISCC output to STREAM instead of block-buffer for ~42 min on the
# VM — a larger change; this backstop closes the infinite-hang gap safely meanwhile.)
WIN_BUILD_TIMEOUT_SEC="${PAPERCUSP_WIN_BUILD_TIMEOUT_SEC:-10800}"
echo "==> building (this holds the ssh session; first build ~15-25 min; hard cap ${WIN_BUILD_TIMEOUT_SEC}s)"
# 2>&1 BEFORE the pipe: cargo + tauri-cli print progress (including the
# load-bearing "Finished 1 bundle at:" line) to STDERR, which ssh carries on
# its own stderr channel — without the merge it bypasses tee and the
# assertions below see an empty log (bit the first uninterrupted run live,
# 2026-06-11: bundle finished, lane reported "produced no bundle").
# `timeout` wraps the ssh (the left side of the pipe). On expiry it SIGTERMs the
# LOCAL ssh (SIGKILL 30s later if it will not die); with no -t the signal is NOT
# propagated to the VM, so the remote build keeps running for inspection — exactly
# what we want. PIPESTATUS[0] is timeout's/ssh's rc (124/137 on expiry), not tee's.
set +e
timeout --signal=TERM --kill-after=30s "$WIN_BUILD_TIMEOUT_SEC" \
  "${SSH[@]}" 'powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\user\vm-release-build.ps1' \
  2>&1 | tee /tmp/vm-release-build.log
build_ssh_rc="${PIPESTATUS[0]}"
set -e
if [[ "$build_ssh_rc" == "124" || "$build_ssh_rc" == "137" ]]; then
  echo "" >&2
  echo "ERROR: Windows build exceeded the ${WIN_BUILD_TIMEOUT_SEC}s hard cap (EI-12902) — the local ssh was terminated, but the build MAY STILL BE RUNNING on the VM (inspect it there before assuming it is dead). NOT re-invoking (a re-run doubles the wall clock, it does not save it). If a legitimately larger build needs more time, raise PAPERCUSP_WIN_BUILD_TIMEOUT_SEC; otherwise investigate the VM (wedged ISCC/MSVC, full disk). Tail of the leg log:" >&2
  tail -40 /tmp/vm-release-build.log 2>/dev/null | sed 's/^/  [win-vm] /' >&2 || true
  exit 124
elif [[ "$build_ssh_rc" != "0" ]]; then
  # Preserve the prior `set -e | pipefail` behavior: a nonzero build ssh (an in-VM
  # Assert-ReleaseHostBaked `exit 1`, or an ssh transport failure) fails the leg
  # exactly as before, so the grep assertions below are reached only on a clean
  # ssh exit.
  echo "ERROR: Windows build ssh exited $build_ssh_rc — see /tmp/vm-release-build.log" >&2
  exit "$build_ssh_rc"
fi
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

if [[ "$PAPERCUSP_EXE_ONLY" == "1" ]]; then
  echo "==> collecting exe-only artifact(s)"
  OUT_DIR="$ROOT/src-tauri/target/windows-vm/bundle/exe-only"
  mkdir -p "$OUT_DIR"
  find "$OUT_DIR" -maxdepth 1 -type f -delete
  VM_RELEASE_DIR="C:/Users/user/$VM_BUILD_DIR/papercusp-desktop/src-tauri/target/release"
  COLLECTED=()
  "${SCP[@]}" "$VM_SSH_HOST":"$VM_RELEASE_DIR/papercusp-desktop-GUI.exe" "$OUT_DIR/papercusp-desktop-GUI.exe" \
    && COLLECTED+=(GUI:"$OUT_DIR/papercusp-desktop-GUI.exe")
  if ! grep -q 'FAST_ITER GUI-only' /tmp/vm-release-build.log; then
    "${SCP[@]}" "$VM_SSH_HOST":"$VM_RELEASE_DIR/papercusp-desktop-Server.exe" "$OUT_DIR/papercusp-desktop-Server.exe" \
      && COLLECTED+=(Server:"$OUT_DIR/papercusp-desktop-Server.exe")
  fi
  [[ ${#COLLECTED[@]} -gt 0 ]] || fail "PAPERCUSP_EXE_ONLY=1 but no papercusp-desktop-*.exe came back from the VM"
  ls -lh "$OUT_DIR"

  if [[ -n "$EXE_ONLY_DEPLOY_HOST" ]]; then
    DEPLOY_SSH=(ssh -i "$EXE_ONLY_DEPLOY_KEY" -o IdentitiesOnly=yes -p "$EXE_ONLY_DEPLOY_PORT" -o ConnectTimeout=10 "$EXE_ONLY_DEPLOY_HOST")
    DEPLOY_SCP=(scp -i "$EXE_ONLY_DEPLOY_KEY" -o IdentitiesOnly=yes -P "$EXE_ONLY_DEPLOY_PORT" -o ConnectTimeout=10)
    # Deploy the FIRST collected role (GUI, unless GUI-only skipped it and only
    # Server built) — set PAPERCUSP_FAST_ITER_GUI_ONLY=1 alongside this to be
    # explicit about which role's exe is going out when both were built.
    DEPLOY_LOCAL="${COLLECTED[0]#*:}"
    echo "==> EXE_ONLY deploy: pushing $(basename "$DEPLOY_LOCAL") to $EXE_ONLY_DEPLOY_HOST:$EXE_ONLY_DEPLOY_PATH"
    # Best-effort stop: an in-use exe can't be overwritten on Windows. Ignore
    # failure (process may not be running, or may be named differently).
    "${DEPLOY_SSH[@]}" 'taskkill /IM papercusp-desktop.exe /F' >/dev/null 2>&1 || true
    sleep 2
    "${DEPLOY_SCP[@]}" "$DEPLOY_LOCAL" "$EXE_ONLY_DEPLOY_HOST":"$EXE_ONLY_DEPLOY_PATH" \
      || fail "EXE_ONLY deploy: scp to $EXE_ONLY_DEPLOY_HOST:$EXE_ONLY_DEPLOY_PATH failed"
    echo "==> EXE_ONLY deploy: done — app is STOPPED on $EXE_ONLY_DEPLOY_HOST; relaunch it yourself"
  else
    echo "==> EXE_ONLY: no PAPERCUSP_EXE_ONLY_DEPLOY_HOST set — exe(s) left in $OUT_DIR for a manual Copy-Item -Force"
  fi
  echo "==> done (exe-only)"
  exit 0
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
# (A source-bundled Server build spans instead — its setup.exe is a small stub
# and never trips this; the payload lives in the *.bin slices asserted below.)
for f in "$OUT_DIR"/*-setup.exe; do
  [[ -e "$f" ]] || continue
  size=$(stat -c%s "$f")
  if (( size > 4290772992 )); then
    fail "$(basename "$f") is $((size / 1024 / 1024))MB — exceeds Inno's ~4GB single-exe max; the payload must shrink or move to DiskSpanning (WI-3172)"
  elif (( size > 3900000000 )); then
    echo "WARN: $(basename "$f") is $((size / 1024 / 1024))MB — within ~10% of Inno's ~4GB single-exe max (WI-3172)" >&2
  fi
done

# Source-bundled build (WI-3306/WI-3308): DiskSpanning must actually have
# engaged — the Server payload comes back as setup.exe + setup-*.bin slices.
# No slices means source.tar.zst never reached the VM build tree (the .iss
# FileExists gate saw nothing) and the "5-button" build silently shipped
# 3-button; fail loudly instead. Install note: run the Server setup.exe from
# the collected dir (or the VM's inno dir) so the .bin slices sit next to it.
if [[ "${PAPERCUSP_STAGE_SOURCE:-0}" == "1" ]] && ! grep -q 'FAST_ITER GUI-only' /tmp/vm-release-build.log; then
  compgen -G "$OUT_DIR/*Server*-setup-*.bin" > /dev/null \
    || fail "PAPERCUSP_STAGE_SOURCE=1 but no Server setup-*.bin slices came back — DiskSpanning didn't engage (source.tar.zst missing from the VM build tree?)"
fi

echo "==> signing updater artifacts (host-side)"
# The GUI/Server split emits TWO *-setup.exe — sign BOTH. The old `head -1` left
# the Server bundle's updater artifact unsigned (2026-07-02 parity fix).
shopt -s nullglob
SETUP_EXES=("$OUT_DIR"/*-setup.exe)
shopt -u nullglob
[[ ${#SETUP_EXES[@]} -gt 0 ]] || fail "no *-setup.exe came back from the VM"
for SETUP_EXE in "${SETUP_EXES[@]}"; do
  echo "  signing: $(basename "$SETUP_EXE")"
  # release-local.sh exports TAURI_SIGNING_PRIVATE_KEY (tauri reads it as
  # --private-key); a newer tauri CLI HARD-REJECTS it alongside --private-key-path
  # ("cannot be used with"). Strip both signing env vars for this call so ONLY the
  # explicit --private-key-path is seen (2026-07-08 fix; broke the 0.0.3-alpha win leg).
  (cd "$ROOT" && env -u TAURI_SIGNING_PRIVATE_KEY -u TAURI_SIGNING_PRIVATE_KEY_PATH \
    npx tauri signer sign \
    --private-key-path "$KEY_FILE" \
    --password "$KEY_PASSWORD" \
    "$SETUP_EXE")
  [[ -f "$SETUP_EXE.sig" ]] || fail "tauri signer produced no .sig for $SETUP_EXE"
done

# EI-8914 / P-002: emit provenance via the SHARED bin/emit-build-provenance.sh
# — one emitter, one JSON schema across all three legs (was an inline duplicate
# here). The Windows-only fields pass through the PROVENANCE_* env seam:
#   * packedSrcFingerprint — a hash of the exact tree we packed to the VM (this
#     leg's strongest anti-LABELED!=PACKED signal; mac/linux don't have it).
#   * signed — whether Authenticode signing was configured.
# gitHead/gitDirty now come from the shared emitter over PROVENANCE_GIT_ROOT=$ROOT
# (whole papercusp-desktop tree, vs the old src-tauri-only diff — strictly more
# honest, since the packed sidecar comes from outside src-tauri). This leg only
# ever runs a FRESH build (release-local's REUSE_WIN path skips it), so reused=false.
# WI-4243: enumerate EVERY distributable — the setup.exe stubs AND the Inno
# DiskSpanning *-setup-*.bin payload slices (0.0.8 shipped the Server payload
# in two unhashed .bins; the owner handoff needed manual sha256s). nullglob so
# a GUI-only build (no slices) passes a clean list.
shopt -s nullglob
PROV_ARTIFACTS=("$OUT_DIR"/*-setup.exe "$OUT_DIR"/*-setup-*.bin)
shopt -u nullglob
PROVENANCE_GIT_ROOT="$ROOT" \
PROVENANCE_PACKED_SRC_FINGERPRINT="${PACKED_FP:-unknown}" \
PROVENANCE_SIGNED="$([[ -n "${WINDOWS_CERT_BASE64:-}${WINDOWS_SIGN_COMMAND:-}" ]] && echo true || echo false)" \
  bash "$ROOT/bin/emit-build-provenance.sh" \
    "$OUT_DIR" \
    "${PAPERCUSP_BUILD_VERSION:-$(node -p "require('$ROOT/src-tauri/tauri.conf.json').version" 2>/dev/null || echo unknown)}" \
    "${PAPERCUSP_BUILD_SHA}" \
    false \
    "${PROV_ARTIFACTS[@]}"

ls -lh "$OUT_DIR"
echo "==> done — artifacts in $OUT_DIR"
exit 0

}  # ── end self-read guard (WI-3306) — opened after 'set -euo pipefail' above ──
Write-Host "[build] npm install"\nnpm install --no-audit --no-fund 2>&1'
fi

# WI-5083 (desktop-build-speed-2026-07-16#P-004): RUSTC_WRAPPER=sccache backed
# by a persistent %USERPROFILE%\.cache\sccache on THIS VM — UNCONDITIONAL now
# (previously only wired under PAPERCUSP_FAST_ITER=1, and only best-effort if
# already installed — that missed exactly the "clean checkout" case this WI
# asks for, since a clean extract has no persisted target/ to fall back on).
# Ensure-Sccache installs a static binary into %USERPROFILE%\.local\bin if
# sccache isn't already on PATH (winget/choco aren't guaranteed provisioned on
# this VM — a direct GitHub-release download needs neither). Best-effort
# throughout — sccache absent/uninstallable just skips RUSTC_WRAPPER, exactly
# like before this existed; never fails the build. ASCII ONLY (see the
# NPM_INSTALL_BLOCK comment above — the same CP-1252 mis-decode trap applies
# to every PS1-bound heredoc value in this script).
# shellcheck disable=SC2016  # PS $-syntax, not bash — must stay unexpanded
SCCACHE_PRELUDE=$(cat <<'PS1BLOCK'
function Ensure-Sccache {
  $sccacheVer = "0.16.0"
  $sccacheCmd = Get-Command sccache -ErrorAction SilentlyContinue
  $localBin = Join-Path $env:USERPROFILE ".local\bin"
  if (-not $sccacheCmd -and (Test-Path (Join-Path $localBin "sccache.exe"))) {
    $env:Path = "$localBin;$env:Path"
    $sccacheCmd = Get-Command sccache -ErrorAction SilentlyContinue
  }
  if (-not $sccacheCmd) {
    Write-Host "[build] sccache: not on PATH - installing v$sccacheVer into $localBin (WI-5083)"
    try {
      New-Item -ItemType Directory -Force $localBin | Out-Null
      $zip = Join-Path $env:TEMP "sccache-dl.zip"
      $extractDir = Join-Path $env:TEMP "sccache-extract"
      $url = "https://github.com/mozilla/sccache/releases/download/v$sccacheVer/sccache-v$sccacheVer-x86_64-pc-windows-msvc.zip"
      Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
      Remove-Item -Recurse -Force $extractDir -ErrorAction SilentlyContinue
      Expand-Archive -Path $zip -DestinationPath $extractDir -Force
      $exe = Get-ChildItem -Path $extractDir -Filter sccache.exe -Recurse | Select-Object -First 1
      if ($exe) {
        Copy-Item -Force $exe.FullName (Join-Path $localBin "sccache.exe")
        $env:Path = "$localBin;$env:Path"
        $sccacheCmd = Get-Command sccache -ErrorAction SilentlyContinue
      }
      Remove-Item -Force $zip -ErrorAction SilentlyContinue
      Remove-Item -Recurse -Force $extractDir -ErrorAction SilentlyContinue
    } catch {
      Write-Host "[build] WARN sccache install failed ($_) - continuing without RUSTC_WRAPPER"
    }
  }
  if ($sccacheCmd) {
    $env:RUSTC_WRAPPER = "sccache"
    $env:SCCACHE_DIR = Join-Path $env:USERPROFILE ".cache\sccache"
    # Smaller cap than the dev-box default (30G): this VM's C: is chronically
    # tight (see the disk-preflight/reclaim logic elsewhere in this script).
    $env:SCCACHE_CACHE_SIZE = "10G"
    # sccache + cargo's own incremental cache fight over the same job — see
    # lib/sccache.sh (the bash-side twin of this function) for the rationale.
    $env:CARGO_INCREMENTAL = "0"
    New-Item -ItemType Directory -Force $env:SCCACHE_DIR | Out-Null
    Write-Host "[build] sccache: RUSTC_WRAPPER=$env:RUSTC_WRAPPER SCCACHE_DIR=$env:SCCACHE_DIR SCCACHE_CACHE_SIZE=$env:SCCACHE_CACHE_SIZE"
  } else {
    Write-Host "[build] sccache: unavailable - building without RUSTC_WRAPPER (WI-5083 benefit skipped this run)"
  }
}
Ensure-Sccache
PS1BLOCK
)
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
  if [[ "$PAPERCUSP_EXE_ONLY" == "1" ]]; then
    SERVER_BUILD_BLOCK=$'Write-Host "[build] tauri build: Papercusp Server (--no-bundle)"\nnpx tauri build --no-bundle --config src-tauri/tauri.server.conf.json 2>&1\nWrite-Host "[build] Server EXIT=$LASTEXITCODE"\nAssert-ReleaseHostBaked "src-tauri\\target\\release\\papercusp-desktop.exe"\nSign-File "src-tauri\\target\\release\\papercusp-desktop.exe"\nWrite-Host "[build] EXE_ONLY: skipping ISCC Server packaging"\nWrite-Host "[build] ISCC Server EXIT=0"\nCopy-Item -Force "src-tauri\\target\\release\\papercusp-desktop.exe" "src-tauri\\target\\release\\papercusp-desktop-Server.exe"'
  else
    SERVER_BUILD_BLOCK=$'Write-Host "[build] tauri build: Papercusp Server (--no-bundle)"\nnpx tauri build --no-bundle --config src-tauri/tauri.server.conf.json 2>&1\nWrite-Host "[build] Server EXIT=$LASTEXITCODE"\nAssert-ReleaseHostBaked "src-tauri\\target\\release\\papercusp-desktop.exe"\nSign-File "src-tauri\\target\\release\\papercusp-desktop.exe"\nInvoke-Inno "Server" "com.papercusp.server" "Papercusp Server"'
  fi
fi

# ── EI-8914: DERIVE the provenance label from the tree we actually packed ──
# `PAPERCUSP_BUILD_SHA` is baked in via option_env! and self-reported by the
# operator at /api/health. It used to be a caller-supplied constant tied to
# nothing: the 0.0.5 cut on 2026-07-09 shipped `1a161ab-wi3407` while its
# packed main.rs was byte-identical to ecea544 — 767 files and ~10k lines
# apart. A release artifact that lies about its own provenance is worse than
# one with no label at all. The commit portion is now COMPUTED; callers may
# only add a human suffix via PAPERCUSP_BUILD_TAG.
#
# Note the label can never be a bare commit: the pack snapshots the WORKING
# TREE, which on this fleet is ~always dirty against HEAD (git-sync commits on
# a schedule). So say so, with `-dirty`.
PACKED_FP="$(cat "$TARBALL.fp" 2>/dev/null || echo unknown)"
_head_sha="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo nogit)"
if ! git -C "$ROOT" diff --quiet HEAD -- src-tauri 2>/dev/null; then
  _head_sha="${_head_sha}-dirty"
fi
if [[ -n "${PAPERCUSP_BUILD_SHA:-}" ]]; then
  echo "==> ⚠ PAPERCUSP_BUILD_SHA is DEPRECATED (EI-8914): a caller-supplied commit is not tied to the packed bytes." >&2
  echo "    Demoting '${PAPERCUSP_BUILD_SHA}' to a suffix. Use PAPERCUSP_BUILD_TAG for human context." >&2
  PAPERCUSP_BUILD_TAG="${PAPERCUSP_BUILD_TAG:-$PAPERCUSP_BUILD_SHA}"
fi
PAPERCUSP_BUILD_SHA="${_head_sha}${PAPERCUSP_BUILD_TAG:+-${PAPERCUSP_BUILD_TAG}}"
echo "==> build provenance: sha=$PAPERCUSP_BUILD_SHA version=${PAPERCUSP_BUILD_VERSION:-<tauri.conf.json>} packed-src=${PACKED_FP:0:16}"

# ── WI-4389: the release host must be PACKED, not merely LABELED ─────────────
# main.rs bakes the update source with option_env!("PAPERCUSP_RELEASE_HOST") at
# COMPILE time, and the compile happens on the VM over ssh. Env does NOT cross
# ssh: the var reaches cargo only via the \$env: block in the PS1 below. Omit it
# and cargo bakes an EMPTY string and the compile SUCCEEDS — the installer works,
# the bundle is signed, latest.json verifies, and the shipped app polls nothing
# forever, because the Tauri updater cannot tell a failed check from "no update".
# That is exactly the 0.0.8 defect, and it was found only by grepping the shipped
# binary AFTER the fact.
#
# The mac leg already gates on this (bin/assert-release-host-baked.sh, called from
# mac-vm-build.sh) — Windows never got wired to it, so the identical bug could ship
# here silently. Gate on the BYTES, on the VM, right after each cargo build: the
# raw exe is what Inno packages, and it never comes back to this host in the normal
# (non-EXE_ONLY) path, so a host-side grep could not see it.
#
# Needle = the host's AUTHORITY only (scheme + secret path stripped) — same rule as
# assert-release-host-baked.sh, so the secret-bearing path is never echoed into the
# ssh build log.
RELEASE_HOST_NEEDLE="${PAPERCUSP_RELEASE_HOST:-}"
RELEASE_HOST_NEEDLE="${RELEASE_HOST_NEEDLE#*://}"   # strip scheme
RELEASE_HOST_NEEDLE="${RELEASE_HOST_NEEDLE%%/*}"    # authority only
if [[ -z "$RELEASE_HOST_NEEDLE" ]]; then
  echo "==> WARNING: PAPERCUSP_RELEASE_HOST is unset — the Windows build will ship WITHOUT"
  echo "             an update source. Installers work; auto-update does NOT (the 0.0.8 defect)."
  echo "             release-local.sh sources ~/.papercusp/release-host.env; a standalone run does not."
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
# WI-4389 gate: prove the release host was PACKED into the bytes cargo just
# produced. "Set in the env block" is a LABEL; the only evidence it was PACKED is
# finding it inside the artifact. findstr is binary-safe and streams (the exe is
# large; ReadAllBytes would double it in RAM). ASCII only in this file.
function Assert-ReleaseHostBaked([string]\$path) {
  \$needle = "${RELEASE_HOST_NEEDLE}"
  if (-not \$needle) {
    Write-Host "[build] release-host assert: no host configured - nothing to assert (auto-update will NOT work)"
    return
  }
  if (-not (Test-Path \$path)) {
    Write-Host "[build] RELEASE HOST ASSERT ERROR: no such binary: \$path"
    exit 1
  }
  & findstr /M "/C:\$needle" "\$path" | Out-Null
  if (\$LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[build] X RELEASE HOST NOT BAKED: \$path"
    Write-Host "[build]   Expected the configured host ('\$needle') in the binary's bytes; it is ABSENT."
    Write-Host "[build]   This build would ship an app that can NEVER reach the update manifest, and it"
    Write-Host "[build]   would NOT look broken: the installer works, the bundle verifies, and the Tauri"
    Write-Host "[build]   updater renders a failed check as 'up to date' - PERMANENTLY. (The 0.0.8 defect.)"
    Write-Host '[build]   CAUSE: PAPERCUSP_RELEASE_HOST absent from the \$env: block below -- option_env!'
    Write-Host "[build]   then bakes an empty string and the compile SUCCEEDS."
    exit 1
  }
  Write-Host "[build] OK release host is BAKED into \$path"
}
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
  # Per-role seed note (EI-12909): only the Server bundle carries the seed
  # (papercusp.iss:109 guards it behind AppId == com.papercusp.server; the GUI
  # bundle ships NO seed — WI-3234). One shared line interpolating \$role must
  # NOT claim "full seed stored raw" for the seedless GUI. Slowness is
  # LZMA-compressing the ~50k-file sidecar (true for BOTH roles), not the seed.
  \$seedNote = if (\$role -eq 'Server') { 'incl. the raw-stored multi-GB seed' } else { 'no seed in this bundle — the GUI carries none (WI-3234)' }
  Write-Host "[build] ISCC \$role packaging (\$seedNote; SLOW — measured ~40+ min, LZMA-compressing the ~50k-file sidecar, EI-12902; ISCC output block-buffers on the VM, so this phase can look SILENT the whole time — that is NORMAL, not a hang)"
  & \$iscc "/DAppId=\$appId" "/DAppName=\$appName" "/DAppVersion=\$ver" "/DBuildRoot=\$buildRoot" "/O\$outDir" ${SPAN_DEFINE}"src-tauri\windows\inno\papercusp.iss" 2>&1 | Where-Object { \$_ -notmatch '^\s*Compressing' }
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
# WI-4389/WI-3875: the update source is baked by option_env!("PAPERCUSP_RELEASE_HOST")
# at COMPILE time, and the compile happens on the VM — so it must be set HERE, in the
# remote build's env, exactly like the two provenance vars above. It does not cross ssh
# on its own. Omit it and cargo bakes an EMPTY host: the shipped app polls nothing and
# the Tauri updater reads that as "up to date" FOREVER (the 0.0.8 defect that forced a
# full rebuild). release-local.sh exports it, so this script inherits it.
\$env:PAPERCUSP_RELEASE_HOST = "${PAPERCUSP_RELEASE_HOST:-}"
Write-Host "[build] PAPERCUSP_RELEASE_HOST=\$env:PAPERCUSP_RELEASE_HOST"
# WI-4781 (build-box-identity hygiene, cosmetic — not a security fix; parity
# with the mac/linux legs' identical RUSTFLAGS export): without
# --remap-path-prefix, Rust DEPENDENCY source-paths embed this VM's user
# profile dir (e.g. C:\Users\<build-user>\.cargo\registry\src\…\<crate>\src\*.rs)
# in shipped binaries' panic/debug strings. Non-sensitive (no credentials) but
# worth stripping. \$env:USERPROFILE is always set on Windows; CARGO_HOME
# defaults to %USERPROFILE%\.cargo when unset. Targets use forward slashes —
# --remap-path-prefix's replacement is an opaque string baked into the binary,
# not a real path, so this is valid on Windows too and avoids backslash-escaping
# a Windows path inside this generated PowerShell string.
\$env:RUSTFLAGS = "--remap-path-prefix=\$env:USERPROFILE=/build-home --remap-path-prefix=\$env:USERPROFILE\.cargo=/build-cargo"
Write-Host "[build] RUSTFLAGS=\$env:RUSTFLAGS"
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
Assert-ReleaseHostBaked "src-tauri\\target\\release\\papercusp-desktop.exe"
Sign-File "src-tauri\\target\\release\\papercusp-desktop.exe"
$( if [[ "$PAPERCUSP_EXE_ONLY" == "1" ]]; then
cat <<'PSEXE'
Write-Host "[build] EXE_ONLY: skipping ISCC GUI packaging"
Write-Host "[build] ISCC GUI EXIT=0"
Copy-Item -Force "src-tauri\target\release\papercusp-desktop.exe" "src-tauri\target\release\papercusp-desktop-GUI.exe"
PSEXE
else
echo 'Invoke-Inno "GUI" "com.papercusp.gui" "Papercusp GUI"'
fi )
${SERVER_BUILD_BLOCK}
EOF
"${SCP[@]}" "$BUILD_PS1" "$VM_SSH_HOST":'C:/Users/user/vm-release-build.ps1'
rm -f "$BUILD_PS1"

# ── Whole-leg build timeout (EI-12902) — MAC PARITY ──────────────────────────
# The mac leg bounds its remote build under PAPERCUSP_MAC_BUILD_TIMEOUT_SEC; the
# windows leg had NO bound at all. Its only limits were the ssh keepalives
# (ConnectTimeout / ServerAliveInterval / ServerAliveCountMax above), which prove
# the VM's sshd still ANSWERS — NOT that the build is PROGRESSING. So a build that
# wedges behind a network-alive VM (a deadlocked/spinning ISCC, a full disk, a
# stuck MSVC child) hung this blocking ssh FOREVER — and because release-local.sh's
# join_leg does a bare `wait "$pid"`, the ENTIRE cut hung with it: no watchdog, no
# diagnostic, no exit code.
#
# This is a WALL-CLOCK BACKSTOP, deliberately sized ABOVE a healthy build — NOT a
# tight bound. A real win leg legitimately runs LONG: measured on the 0.0.11 cut,
# GUI ISCC alone took 2,557s (42.6 min) packaging the ~4GB raw-stored seed, plus a
# comparable Server ISCC and two Rust builds ⇒ ~5,000-6,000s+ end to end. A naive
# small timeout would FALSELY KILL good builds (worse than a hang — a hang is at
# least honest), so the default is 10800s (3h), well clear of the measured cost and
# env-tunable. On timeout we do NOT re-invoke (a re-run doubles the wall clock, it
# does not save it — same D-005 reasoning as the mac leg): we fail with a named
# error + a tail of the leg log and leave the VM build running for inspection.
# (A progress-based SILENCE detector would be the better long-term shape, but it
# needs the remote ISCC output to STREAM instead of block-buffer for ~42 min on the
# VM — a larger change; this backstop closes the infinite-hang gap safely meanwhile.)
WIN_BUILD_TIMEOUT_SEC="${PAPERCUSP_WIN_BUILD_TIMEOUT_SEC:-10800}"
echo "==> building (this holds the ssh session; first build ~15-25 min; hard cap ${WIN_BUILD_TIMEOUT_SEC}s)"
# 2>&1 BEFORE the pipe: cargo + tauri-cli print progress (including the
# load-bearing "Finished 1 bundle at:" line) to STDERR, which ssh carries on
# its own stderr channel — without the merge it bypasses tee and the
# assertions below see an empty log (bit the first uninterrupted run live,
# 2026-06-11: bundle finished, lane reported "produced no bundle").
# `timeout` wraps the ssh (the left side of the pipe). On expiry it SIGTERMs the
# LOCAL ssh (SIGKILL 30s later if it will not die); with no -t the signal is NOT
# propagated to the VM, so the remote build keeps running for inspection — exactly
# what we want. PIPESTATUS[0] is timeout's/ssh's rc (124/137 on expiry), not tee's.
set +e
timeout --signal=TERM --kill-after=30s "$WIN_BUILD_TIMEOUT_SEC" \
  "${SSH[@]}" 'powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\user\vm-release-build.ps1' \
  2>&1 | tee /tmp/vm-release-build.log
build_ssh_rc="${PIPESTATUS[0]}"
set -e
if [[ "$build_ssh_rc" == "124" || "$build_ssh_rc" == "137" ]]; then
  echo "" >&2
  echo "ERROR: Windows build exceeded the ${WIN_BUILD_TIMEOUT_SEC}s hard cap (EI-12902) — the local ssh was terminated, but the build MAY STILL BE RUNNING on the VM (inspect it there before assuming it is dead). NOT re-invoking (a re-run doubles the wall clock, it does not save it). If a legitimately larger build needs more time, raise PAPERCUSP_WIN_BUILD_TIMEOUT_SEC; otherwise investigate the VM (wedged ISCC/MSVC, full disk). Tail of the leg log:" >&2
  tail -40 /tmp/vm-release-build.log 2>/dev/null | sed 's/^/  [win-vm] /' >&2 || true
  exit 124
elif [[ "$build_ssh_rc" != "0" ]]; then
  # Preserve the prior `set -e | pipefail` behavior: a nonzero build ssh (an in-VM
  # Assert-ReleaseHostBaked `exit 1`, or an ssh transport failure) fails the leg
  # exactly as before, so the grep assertions below are reached only on a clean
  # ssh exit.
  echo "ERROR: Windows build ssh exited $build_ssh_rc — see /tmp/vm-release-build.log" >&2
  exit "$build_ssh_rc"
fi
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

if [[ "$PAPERCUSP_EXE_ONLY" == "1" ]]; then
  echo "==> collecting exe-only artifact(s)"
  OUT_DIR="$ROOT/src-tauri/target/windows-vm/bundle/exe-only"
  mkdir -p "$OUT_DIR"
  find "$OUT_DIR" -maxdepth 1 -type f -delete
  VM_RELEASE_DIR="C:/Users/user/$VM_BUILD_DIR/papercusp-desktop/src-tauri/target/release"
  COLLECTED=()
  "${SCP[@]}" "$VM_SSH_HOST":"$VM_RELEASE_DIR/papercusp-desktop-GUI.exe" "$OUT_DIR/papercusp-desktop-GUI.exe" \
    && COLLECTED+=(GUI:"$OUT_DIR/papercusp-desktop-GUI.exe")
  if ! grep -q 'FAST_ITER GUI-only' /tmp/vm-release-build.log; then
    "${SCP[@]}" "$VM_SSH_HOST":"$VM_RELEASE_DIR/papercusp-desktop-Server.exe" "$OUT_DIR/papercusp-desktop-Server.exe" \
      && COLLECTED+=(Server:"$OUT_DIR/papercusp-desktop-Server.exe")
  fi
  [[ ${#COLLECTED[@]} -gt 0 ]] || fail "PAPERCUSP_EXE_ONLY=1 but no papercusp-desktop-*.exe came back from the VM"
  ls -lh "$OUT_DIR"

  if [[ -n "$EXE_ONLY_DEPLOY_HOST" ]]; then
    DEPLOY_SSH=(ssh -i "$EXE_ONLY_DEPLOY_KEY" -o IdentitiesOnly=yes -p "$EXE_ONLY_DEPLOY_PORT" -o ConnectTimeout=10 "$EXE_ONLY_DEPLOY_HOST")
    DEPLOY_SCP=(scp -i "$EXE_ONLY_DEPLOY_KEY" -o IdentitiesOnly=yes -P "$EXE_ONLY_DEPLOY_PORT" -o ConnectTimeout=10)
    # Deploy the FIRST collected role (GUI, unless GUI-only skipped it and only
    # Server built) — set PAPERCUSP_FAST_ITER_GUI_ONLY=1 alongside this to be
    # explicit about which role's exe is going out when both were built.
    DEPLOY_LOCAL="${COLLECTED[0]#*:}"
    echo "==> EXE_ONLY deploy: pushing $(basename "$DEPLOY_LOCAL") to $EXE_ONLY_DEPLOY_HOST:$EXE_ONLY_DEPLOY_PATH"
    # Best-effort stop: an in-use exe can't be overwritten on Windows. Ignore
    # failure (process may not be running, or may be named differently).
    "${DEPLOY_SSH[@]}" 'taskkill /IM papercusp-desktop.exe /F' >/dev/null 2>&1 || true
    sleep 2
    "${DEPLOY_SCP[@]}" "$DEPLOY_LOCAL" "$EXE_ONLY_DEPLOY_HOST":"$EXE_ONLY_DEPLOY_PATH" \
      || fail "EXE_ONLY deploy: scp to $EXE_ONLY_DEPLOY_HOST:$EXE_ONLY_DEPLOY_PATH failed"
    echo "==> EXE_ONLY deploy: done — app is STOPPED on $EXE_ONLY_DEPLOY_HOST; relaunch it yourself"
  else
    echo "==> EXE_ONLY: no PAPERCUSP_EXE_ONLY_DEPLOY_HOST set — exe(s) left in $OUT_DIR for a manual Copy-Item -Force"
  fi
  echo "==> done (exe-only)"
  exit 0
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
# (A source-bundled Server build spans instead — its setup.exe is a small stub
# and never trips this; the payload lives in the *.bin slices asserted below.)
for f in "$OUT_DIR"/*-setup.exe; do
  [[ -e "$f" ]] || continue
  size=$(stat -c%s "$f")
  if (( size > 4290772992 )); then
    fail "$(basename "$f") is $((size / 1024 / 1024))MB — exceeds Inno's ~4GB single-exe max; the payload must shrink or move to DiskSpanning (WI-3172)"
  elif (( size > 3900000000 )); then
    echo "WARN: $(basename "$f") is $((size / 1024 / 1024))MB — within ~10% of Inno's ~4GB single-exe max (WI-3172)" >&2
  fi
done

# Source-bundled build (WI-3306/WI-3308): DiskSpanning must actually have
# engaged — the Server payload comes back as setup.exe + setup-*.bin slices.
# No slices means source.tar.zst never reached the VM build tree (the .iss
# FileExists gate saw nothing) and the "5-button" build silently shipped
# 3-button; fail loudly instead. Install note: run the Server setup.exe from
# the collected dir (or the VM's inno dir) so the .bin slices sit next to it.
if [[ "${PAPERCUSP_STAGE_SOURCE:-0}" == "1" ]] && ! grep -q 'FAST_ITER GUI-only' /tmp/vm-release-build.log; then
  compgen -G "$OUT_DIR/*Server*-setup-*.bin" > /dev/null \
    || fail "PAPERCUSP_STAGE_SOURCE=1 but no Server setup-*.bin slices came back — DiskSpanning didn't engage (source.tar.zst missing from the VM build tree?)"
fi

echo "==> signing updater artifacts (host-side)"
# The GUI/Server split emits TWO *-setup.exe — sign BOTH. The old `head -1` left
# the Server bundle's updater artifact unsigned (2026-07-02 parity fix).
shopt -s nullglob
SETUP_EXES=("$OUT_DIR"/*-setup.exe)
shopt -u nullglob
[[ ${#SETUP_EXES[@]} -gt 0 ]] || fail "no *-setup.exe came back from the VM"
for SETUP_EXE in "${SETUP_EXES[@]}"; do
  echo "  signing: $(basename "$SETUP_EXE")"
  # release-local.sh exports TAURI_SIGNING_PRIVATE_KEY (tauri reads it as
  # --private-key); a newer tauri CLI HARD-REJECTS it alongside --private-key-path
  # ("cannot be used with"). Strip both signing env vars for this call so ONLY the
  # explicit --private-key-path is seen (2026-07-08 fix; broke the 0.0.3-alpha win leg).
  (cd "$ROOT" && env -u TAURI_SIGNING_PRIVATE_KEY -u TAURI_SIGNING_PRIVATE_KEY_PATH \
    npx tauri signer sign \
    --private-key-path "$KEY_FILE" \
    --password "$KEY_PASSWORD" \
    "$SETUP_EXE")
  [[ -f "$SETUP_EXE.sig" ]] || fail "tauri signer produced no .sig for $SETUP_EXE"
done

# EI-8914 / P-002: emit provenance via the SHARED bin/emit-build-provenance.sh
# — one emitter, one JSON schema across all three legs (was an inline duplicate
# here). The Windows-only fields pass through the PROVENANCE_* env seam:
#   * packedSrcFingerprint — a hash of the exact tree we packed to the VM (this
#     leg's strongest anti-LABELED!=PACKED signal; mac/linux don't have it).
#   * signed — whether Authenticode signing was configured.
# gitHead/gitDirty now come from the shared emitter over PROVENANCE_GIT_ROOT=$ROOT
# (whole papercusp-desktop tree, vs the old src-tauri-only diff — strictly more
# honest, since the packed sidecar comes from outside src-tauri). This leg only
# ever runs a FRESH build (release-local's REUSE_WIN path skips it), so reused=false.
# WI-4243: enumerate EVERY distributable — the setup.exe stubs AND the Inno
# DiskSpanning *-setup-*.bin payload slices (0.0.8 shipped the Server payload
# in two unhashed .bins; the owner handoff needed manual sha256s). nullglob so
# a GUI-only build (no slices) passes a clean list.
shopt -s nullglob
PROV_ARTIFACTS=("$OUT_DIR"/*-setup.exe "$OUT_DIR"/*-setup-*.bin)
shopt -u nullglob
PROVENANCE_GIT_ROOT="$ROOT" \
PROVENANCE_PACKED_SRC_FINGERPRINT="${PACKED_FP:-unknown}" \
PROVENANCE_SIGNED="$([[ -n "${WINDOWS_CERT_BASE64:-}${WINDOWS_SIGN_COMMAND:-}" ]] && echo true || echo false)" \
  bash "$ROOT/bin/emit-build-provenance.sh" \
    "$OUT_DIR" \
    "${PAPERCUSP_BUILD_VERSION:-$(node -p "require('$ROOT/src-tauri/tauri.conf.json').version" 2>/dev/null || echo unknown)}" \
    "${PAPERCUSP_BUILD_SHA}" \
    false \
    "${PROV_ARTIFACTS[@]}"

ls -lh "$OUT_DIR"
echo "==> done — artifacts in $OUT_DIR"
exit 0

}  # ── end self-read guard (WI-3306) — opened after 'set -euo pipefail' above ──
