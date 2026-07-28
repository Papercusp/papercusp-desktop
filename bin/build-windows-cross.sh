#!/usr/bin/env bash
# Build the Windows x86_64 Inno Setup installer(s) by CROSS-COMPILING on THIS
# Linux box — no QEMU Windows VM, no SSH. Retires bin/build-windows-on-vm.sh's
# fragile, slow, lease-contended VM leg (WI-5651; the VM's heartbeat deaths
# caused 3 of WI-5600's failed builds, EI-18152964860625919).
#
# WHY THIS WORKS (all four gates proven end-to-end on Linux, 2026-07-20):
#   Gate 1  cargo-xwin cross-compiles a real release papercusp-desktop.exe
#           (PE32+ GUI x86-64, ~22MB, ~2m15s cold) — Tauri's supported Windows
#           target is MSVC and cargo-xwin manages the CRT + Windows SDK import
#           libs, so this is the SAME toolchain the VM used, minus the VM.
#   Gate 2  Inno Setup 6.7.3 under wine 9.0 packs a valid GUI setup.exe in ~64s
#           (vs the VM's ~40min) — same papercusp.iss, headless via xvfb.
#   Gate 2b The Server role DiskSpans identically (setup.exe stub + *-setup-N.bin
#           slices) — byte-shape-identical to the VM, so release-local.sh's
#           WI-5600 span->zip + record path consumes it unchanged.
#   Gate 3  Signing reproduces on Linux: the updater .sig (ed25519/minisign via
#           `tauri signer sign`) was ALWAYS a host-side step here; Authenticode
#           (osslsigncode) signs a cross-built PE and verifies "ok" WHEN the
#           owner supplies a cert (cert-conditional, currently a no-op in prod).
#
# ROLE CORRECTNESS (the subtlety a naive wiring gets wrong): the app resolves
# its role at runtime from the BAKED bundle identifier — app_role::detect(
# &app.config().identifier), main.rs:3594 — and generate_context!() bakes that
# identifier at COMPILE time from tauri.conf.json. So the Server binary MUST be
# compiled with com.papercusp.server baked in, exactly as the VM does two
# separate `tauri build --config tauri.server.conf.json` compiles. We replicate
# that by setting TAURI_CONFIG (the merge mechanism `tauri build --config` uses
# under the hood — @tauri-apps/cli CHANGELOG: "TAURI_CONFIG now represents the
# configuration to be merged") for the Server compile. One binary does NOT serve
# both roles — packing a Server installer around the GUI binary would ship a
# Server bundle that detects as GUI and never spawns the sidecar.
#
# ENV CONTRACT (mirrors bin/build-windows-on-vm.sh so release-local.sh can call
# either with the same env):
#   PAPERCUSP_BUILD_ROLES     roles to build (default "gui server")
#   PAPERCUSP_BUILD_SHA       baked into the exe (option_env!, /api/health)
#   PAPERCUSP_BUILD_VERSION   shipped version (option_env!); also the installer
#                             filename version (falls back to tauri.conf.json)
#   PAPERCUSP_RELEASE_HOST    the updater's poll host, baked at compile (load via
#                             lib/release-host.sh); asserted present in the exe
#   PAPERCUSP_STAGE_SOURCE    1 (default) stages the dev/local runnable source
#                             tree -> sidecar/source.tar.zst so the Server role
#                             DiskSpans the "5-button" bundle (WI-3308)
#   PAPERCUSP_SINGLE_FILE     1 forces /DSingleFile (one setup.exe even for the
#                             Server tree; for hosting off a 2GiB-capped store)
#   TAURI_SIGNING_PRIVATE_KEY_PATH / _PASSWORD   updater .sig key (default
#                             ~/.papercusp/signing/papercusp.key, empty password)
#   WINDOWS_CERT_BASE64 + WINDOWS_CERT_PASSWORD  optional Authenticode: a
#                             base64 PKCS#12 code-signing cert. Unset => UNSIGNED
#                             (byte-identical to the current prod builds).
#   WINDOWS_SIGN_DIGEST       Authenticode digest (default sha256)
#   WINDOWS_SIGN_TIMESTAMP_URL RFC3161 TS server (default digicert); empty => no TS
#
# PREREQS (release-local.sh does these before calling any Windows leg; this
# script SHIPS the tree as-is and never rebuilds them — same fail-closed
# contract as the VM script):
#   - bin/build-desktop-sidecar.sh has populated src-tauri/sidecar/
#   - scripts/build-rootfs.sh produced src-tauri/resources/papercup-runtime.tar.gz
#   - src-tauri/seed/ is cut (bin/ensure-release-seed.sh / cut-seed-cli)
#
# TOOLCHAIN (one-time, already provisioned on this box — WI-5651):
#   - cargo-xwin + `rustup target add x86_64-pc-windows-msvc` + clang/lld/llvm-rc
#   - wine 9.0 (+ wine32:i386) + Inno Setup 6.7.3 under WINEPREFIX
#     ~/.papercusp/wine-inno (ISCC at drive_c/InnoSetup6/ISCC.exe) + xvfb
#   - osslsigncode 2.8 (only used when a WINDOWS_CERT_* cert is supplied)

set -euo pipefail

# ── Self-read guard (WI-3306): parse the whole script before executing, so a
# peer's mid-run edit to this shared-tree file can't shift the running shell's
# read offset into changed bytes. Matching } + exit 0 at EOF.
{

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
SRC_TAURI="$ROOT/src-tauri"

fail() { echo "ERROR: $*" >&2; exit 1; }

# Update source baked at compile (WI-4389/WI-3875): main.rs resolves it with
# option_env!("PAPERCUSP_RELEASE_HOST"). Load it here so a direct run of this
# script (not just via release-local.sh) still bakes a real host — omit it and
# the shipped app polls nothing and the Tauri updater reads that as "up to date"
# forever (the 0.0.8 defect). load_release_host is idempotent + override-safe.
# shellcheck source=lib/release-host.sh
source "$HERE/lib/release-host.sh"
load_release_host

TARGET="x86_64-pc-windows-msvc"
ROLES="${PAPERCUSP_BUILD_ROLES:-gui server}"
# Resolve the cargo target dir ONCE, deterministically — this box relocates it
# via ~/.cargo/config.toml (target-dir = ~/.cargo-target) AND src-tauri/target is
# a symlink, so a naive "$SRC_TAURI/target/..." path is wrong. Same derivation
# release-local.sh uses (its line ~1134).
CARGO_TARGET_ROOT="$(cd "$SRC_TAURI" && cargo metadata --no-deps --format-version 1 2>/dev/null \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("target_directory",""))' 2>/dev/null || true)"
[[ -n "$CARGO_TARGET_ROOT" ]] || CARGO_TARGET_ROOT="$SRC_TAURI/target"
CROSS_EXE="$CARGO_TARGET_ROOT/$TARGET/release/papercusp-desktop.exe"
KEY_FILE="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.papercusp/signing/papercusp.key}"
KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
# Pinned tauri CLI, resolved via `npx --yes -p @tauri-apps/cli@VER` — NEVER a bare
# `npx tauri` / `npm run tauri`, which resolve node_modules/.bin/tauri (ABSENT in the
# release checkout) and die with "could not determine executable to run" (the
# attempt-8 rc=1: the updater-.sig signer step below). Same idiom as release-local.sh.
TAURI_CLI_VERSION="${PAPERCUSP_TAURI_CLI_VERSION:-${TAURI_CLI_VERSION:-2.11.0}}"
WINEPREFIX_INNO="${PAPERCUSP_WINE_INNO_PREFIX:-$HOME/.papercusp/wine-inno}"
ISCC_EXE="${PAPERCUSP_ISCC_EXE:-$WINEPREFIX_INNO/drive_c/InnoSetup6/ISCC.exe}"
WINDOWS_SIGN_DIGEST="${WINDOWS_SIGN_DIGEST:-sha256}"
WINDOWS_SIGN_TIMESTAMP_URL="${WINDOWS_SIGN_TIMESTAMP_URL-http://timestamp.digicert.com}"

# Single-file opt-in (owner-directed 2026-07-08, mirror of the VM script):
# PAPERCUSP_SINGLE_FILE=1 -> ISCC /DSingleFile -> papercusp.iss omits
# DiskSpanning even for the Server tree. Default = Server spans <2GiB slices.
SPAN_DEFINE=()
[[ "${PAPERCUSP_SINGLE_FILE:-0}" == "1" ]] && SPAN_DEFINE=("/DSingleFile")

# ── Toolchain preflight ──────────────────────────────────────────────────────
command -v cargo-xwin >/dev/null 2>&1 || command -v cargo >/dev/null 2>&1 \
  || fail "cargo not on PATH"
cargo xwin --version >/dev/null 2>&1 \
  || fail "cargo-xwin not installed (cargo install cargo-xwin) — the Windows cross toolchain"
rustup target list --installed 2>/dev/null | grep -qx "$TARGET" \
  || fail "rustup target $TARGET not installed (rustup target add $TARGET)"
command -v wine >/dev/null 2>&1 || fail "wine not installed (apt install wine + dpkg --add-architecture i386)"
command -v xvfb-run >/dev/null 2>&1 || fail "xvfb-run not installed (apt install xvfb) — ISCC runs headless under it"
[[ -f "$ISCC_EXE" ]] || fail "ISCC not found at $ISCC_EXE — provision Inno Setup 6.7.3 under WINEPREFIX=$WINEPREFIX_INNO"
[[ -f "$KEY_FILE" ]] || fail "updater signing key not found at $KEY_FILE (bin/setup-signing-key.sh)"

# ── Payload presence (fail-closed, mirror of the VM script's asserts). This
# script never REBUILDS these — release-local.sh does; we ship them as-is.
[[ -d "$SRC_TAURI/sidecar/apps" ]] || fail "sidecar not built — run bin/build-desktop-sidecar.sh first"
[[ -f "$SRC_TAURI/resources/papercup-runtime.tar.gz" ]] || fail "WSL rootfs missing — run scripts/build-rootfs.sh first"
[[ -f "$SRC_TAURI/icons/icon.ico" ]] || fail "src-tauri/icons/icon.ico missing (papercusp.iss SetupIconFile)"

VERSION="${PAPERCUSP_BUILD_VERSION:-$(node -p "require('$SRC_TAURI/tauri.conf.json').version" 2>/dev/null || echo unknown)}"
[[ "$VERSION" != "unknown" && -n "$VERSION" ]] || fail "could not resolve the build version (PAPERCUSP_BUILD_VERSION or tauri.conf.json)"

# Authenticode is opt-in on an owner-supplied cert (currently unset in prod, so
# a byte-identical UNSIGNED build). Materialize the PKCS#12 once if provided.
AUTHENTICODE_PFX=""
if [[ -n "${WINDOWS_CERT_BASE64:-}" ]]; then
  command -v osslsigncode >/dev/null 2>&1 || fail "WINDOWS_CERT_BASE64 set but osslsigncode not installed (apt install osslsigncode)"
  AUTHENTICODE_PFX="$(mktemp /tmp/papercusp-authenticode-XXXX.pfx)"
  printf '%s' "$WINDOWS_CERT_BASE64" | base64 -d > "$AUTHENTICODE_PFX" \
    || fail "WINDOWS_CERT_BASE64 is not valid base64"
  echo "==> Authenticode signing ENABLED (owner cert supplied)"
else
  echo "==> Authenticode signing DISABLED (no WINDOWS_CERT_BASE64) — UNSIGNED build (same as current prod)"
fi

cleanup() {
  local status="$?"
  trap - EXIT
  [[ -n "$AUTHENTICODE_PFX" && -f "$AUTHENTICODE_PFX" ]] && rm -f "$AUTHENTICODE_PFX"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Authenticode-sign a PE in place with osslsigncode, IFF a cert was supplied
# (else a no-op — same semantics as the VM's Sign-File). Timestamp is RFC3161
# when a TS url is set; empty url => offline (no TS).
authenticode_sign() {
  local pe="$1"
  [[ -n "$AUTHENTICODE_PFX" ]] || return 0
  local tmp; tmp="$(mktemp "${pe}.signed.XXXX")"
  local ts_args=()
  [[ -n "$WINDOWS_SIGN_TIMESTAMP_URL" ]] && ts_args=(-ts "$WINDOWS_SIGN_TIMESTAMP_URL")
  echo "  authenticode: $(basename "$pe")"
  osslsigncode sign -pkcs12 "$AUTHENTICODE_PFX" -pass "${WINDOWS_CERT_PASSWORD:-}" \
    -h "$WINDOWS_SIGN_DIGEST" -n "Papercusp" "${ts_args[@]}" \
    -in "$pe" -out "$tmp" >/dev/null 2>&1 \
    || { rm -f "$tmp"; fail "osslsigncode failed to Authenticode-sign $pe"; }
  mv -f "$tmp" "$pe"
}

# Convert an absolute Linux path to the wine drive path (Z: maps to /).
winpath() { printf 'Z:%s' "$(printf '%s' "$1" | sed 's:/:\\:g')"; }

# ── Source-tree + env-sidecar staging (mirror of the VM script's flock block).
# stage-source-tree.sh writes src-tauri/sidecar/source.tar.zst (the Server span
# trigger); env-sidecars/staging is the packaged env switcher's staging bundle.
# Both re-staged fresh, serialized against a concurrent sidecar publish via the
# same flock on src-tauri/sidecar.lock.
(
  flock 9
  PAPERCUSP_SIDECAR_LOCK_HELD=1 bash "$ROOT/bin/stage-source-tree.sh"
  if [[ "${PAPERCUSP_STAGE_SOURCE:-1}" == "1" ]]; then
    [[ -f "$SRC_TAURI/sidecar/source.tar.zst" ]] \
      || fail "PAPERCUSP_STAGE_SOURCE=1 but stage-source-tree.sh left no sidecar/source.tar.zst"
    echo "    source.tar.zst staged ($(du -h "$SRC_TAURI/sidecar/source.tar.zst" | cut -f1)) — Server role will DiskSpan"
  fi
  # env-sidecars/staging: hardlink the primary sidecar payload (tar/ISCC store
  # once). Staged OUTSIDE sidecar/ (build-desktop-sidecar.sh's atomic publish
  # replaces sidecar/ wholesale). Sidecar-shaped: serve.mjs + spa/ + db-sql/
  # (+ prompts/harness when present); NO bin/, NO internal-docs, NO db-seed.
  ENV_SC="$SRC_TAURI/env-sidecars/staging"
  rm -rf "$SRC_TAURI/env-sidecars"
  mkdir -p "$ENV_SC"
  cp -al "$SRC_TAURI/sidecar/serve.mjs" "$ENV_SC/serve.mjs"
  cp -al "$SRC_TAURI/sidecar/spa" "$ENV_SC/spa"
  cp -al "$SRC_TAURI/sidecar/db-sql" "$ENV_SC/db-sql"
  for extra in prompts harness; do
    [[ -d "$SRC_TAURI/sidecar/$extra" ]] && cp -al "$SRC_TAURI/sidecar/$extra" "$ENV_SC/$extra"
  done
  echo "    env-sidecars/staging staged (hardlinked)"
) 9>>"$SRC_TAURI/sidecar.lock"

# ── Stage dir the .iss reads via {#BuildRoot}. papercusp.iss wants the exe at
# {BuildRoot}\target\release\papercusp-desktop.exe and sibling dirs sidecar,
# resources, seed, env-sidecars, icons, windows. We symlink the src-tauri dirs
# (wine follows them) and drop the freshly-compiled per-role exe into
# target/release/ just before each pack.
STAGE="$(mktemp -d /tmp/win-cross-stage-XXXX)"
OUT_DIR="$SRC_TAURI/target/windows-vm/bundle/inno"   # the dir release-local.sh collects from
mkdir -p "$STAGE/target/release" "$OUT_DIR"
for d in sidecar resources seed env-sidecars icons windows; do
  [[ -e "$SRC_TAURI/$d" ]] && ln -sfn "$SRC_TAURI/$d" "$STAGE/$d"
done
ISS_WIN="$(winpath "$SRC_TAURI/windows/inno/papercusp.iss")"
BUILDROOT_WIN="$(winpath "$STAGE")"
# Clean stale collected artifacts (files only; keep any prev-version subdirs).
find "$OUT_DIR" -maxdepth 1 -type f -delete

# ── Per-role: cross-compile -> stage exe -> ISCC-under-wine -> collect ────────
run_iscc() {
  local app_id="$1" app_name="$2"
  local out_win; out_win="$(winpath "$STAGE/out")"
  rm -rf "$STAGE/out"; mkdir -p "$STAGE/out"
  echo "  ISCC (wine, headless): $app_name"
  WINEPREFIX="$WINEPREFIX_INNO" WINEDEBUG=-all WINEDLLOVERRIDES="mscoree=d;mshtml=d" \
    xvfb-run -a wine "$ISCC_EXE" \
      "/DAppId=$app_id" "/DAppName=$app_name" "/DAppVersion=$VERSION" \
      "/DBuildRoot=$BUILDROOT_WIN" "/O$out_win" \
      "${SPAN_DEFINE[@]}" "$ISS_WIN" 2>&1 \
    | grep -vE '^\s*Compressing' || true
  # Move every produced artifact (setup.exe [+ *-setup-N.bin span slices]) to OUT_DIR.
  local moved=0 f
  shopt -s nullglob
  for f in "$STAGE/out/${app_name}_${VERSION}_x64-setup.exe" "$STAGE/out/${app_name}_${VERSION}_x64-setup-"*.bin; do
    [[ -e "$f" ]] || continue
    mv -f "$f" "$OUT_DIR/"; moved=1
  done
  shopt -u nullglob
  [[ "$moved" == "1" ]] || fail "ISCC produced no artifact for role '$app_name' (expected ${app_name}_${VERSION}_x64-setup.exe in $STAGE/out)"
}

for role in $ROLES; do
  case "$role" in
    gui)    app_id="com.papercusp.gui";    app_name="Papercusp GUI";    tauri_cfg="" ;;
    server) app_id="com.papercusp.server"; app_name="Papercusp Server"; tauri_cfg="$SRC_TAURI/tauri.server.conf.json" ;;
    *) echo "WARN: unknown role '$role' — skipping" >&2; continue ;;
  esac
  echo "==> [$role] cross-compiling papercusp-desktop.exe ($TARGET)"
  # TAURI_CONFIG merges tauri.server.conf.json over tauri.conf.json at BOTH
  # build.rs (tauri_build) and generate_context!() time, baking the server
  # identifier/productName — the mechanism `tauri build --config` uses.
  # tauri_build emits rerun-if-env-changed=TAURI_CONFIG, so switching roles
  # re-runs generate_context! (final-crate relink only, deps stay warm).
  cfg_env=()
  [[ -n "$tauri_cfg" ]] && cfg_env=(TAURI_CONFIG="$(cat "$tauri_cfg")")
  ( cd "$SRC_TAURI" && env \
      "PAPERCUSP_BUILD_SHA=${PAPERCUSP_BUILD_SHA:-}" \
      "PAPERCUSP_BUILD_VERSION=${PAPERCUSP_BUILD_VERSION:-}" \
      "PAPERCUSP_RELEASE_HOST=${PAPERCUSP_RELEASE_HOST:-}" \
      "${cfg_env[@]}" \
      cargo xwin build --release --target "$TARGET" -p papercusp-desktop )
  EXE="$CROSS_EXE"
  [[ -f "$EXE" ]] || fail "cross-compile produced no papercusp-desktop.exe for role '$role' at $EXE"

  # Assert the release host was actually baked (the 0.0.8 defect: an empty host
  # compiles fine and the updater reads it as "up to date" forever).
  # grep the binary directly (-a) rather than `strings … | grep -q`: under
  # `set -o pipefail`, grep -q exits on first match and SIGPIPEs strings (141),
  # which pipefail then propagates as a spurious failure whenever the host IS
  # present — the exact inversion of what the guard is checking.
  if [[ -n "${PAPERCUSP_RELEASE_HOST:-}" ]]; then
    grep -aqF "$PAPERCUSP_RELEASE_HOST" "$EXE" \
      || fail "[$role] PAPERCUSP_RELEASE_HOST='$PAPERCUSP_RELEASE_HOST' is NOT baked into the exe — cargo cached a stale/empty host. Clean the crate and rebuild."
  fi

  # Authenticode-sign the app exe BEFORE Inno packs it (mirror of the VM: sign
  # the payload exe, then the setup.exe after). No-op without a cert.
  cp -f "$EXE" "$STAGE/target/release/papercusp-desktop.exe"
  authenticode_sign "$STAGE/target/release/papercusp-desktop.exe"

  echo "==> [$role] packing installer with Inno Setup under wine"
  run_iscc "$app_id" "$app_name"
done

# ── Size + span sanity (mirror of the VM collection asserts) ─────────────────
shopt -s nullglob
for f in "$OUT_DIR"/*-setup.exe; do
  size=$(stat -c%s "$f")
  if (( size > 4290772992 )); then
    fail "$(basename "$f") is $((size/1024/1024))MB — exceeds Inno's ~4GB single-exe max (WI-3172); the Server tree must DiskSpan (do not set PAPERCUSP_SINGLE_FILE=1 for a full-seed Server build)"
  elif (( size > 3900000000 )); then
    echo "WARN: $(basename "$f") is $((size/1024/1024))MB — within ~10% of Inno's ~4GB single-exe max (WI-3172)" >&2
  fi
done
if [[ "${PAPERCUSP_STAGE_SOURCE:-1}" == "1" && "${PAPERCUSP_SINGLE_FILE:-0}" != "1" && " $ROLES " == *" server "* ]]; then
  compgen -G "$OUT_DIR/*Server*-setup-*.bin" > /dev/null \
    || fail "Server role built with PAPERCUSP_STAGE_SOURCE=1 but no *-setup-*.bin slices — DiskSpanning didn't engage (source.tar.zst missing from the BuildRoot?)"
fi
shopt -u nullglob

# ── Sign the setup.exe(s): Authenticode (cert-conditional) THEN the host-side
# updater .sig (ed25519/minisign) that the shipped auto-updater verifies.
echo "==> signing installers"
shopt -s nullglob
SETUP_EXES=("$OUT_DIR"/*-setup.exe)
shopt -u nullglob
[[ ${#SETUP_EXES[@]} -gt 0 ]] || fail "no *-setup.exe in $OUT_DIR after packing"
for SETUP_EXE in "${SETUP_EXES[@]}"; do
  authenticode_sign "$SETUP_EXE"
  echo "  updater .sig: $(basename "$SETUP_EXE")"
  # Strip the two signing env vars a newer tauri CLI hard-rejects alongside
  # --private-key-path, so ONLY the explicit key path is seen (2026-07-08 fix).
  ( cd "$ROOT" && env -u TAURI_SIGNING_PRIVATE_KEY -u TAURI_SIGNING_PRIVATE_KEY_PATH \
      npx --yes -p @tauri-apps/cli@"$TAURI_CLI_VERSION" tauri signer sign --private-key-path "$KEY_FILE" --password "$KEY_PASSWORD" "$SETUP_EXE" >/dev/null )
  [[ -f "$SETUP_EXE.sig" ]] || fail "tauri signer produced no .sig for $SETUP_EXE"
done

# ── Provenance (shared emitter, one schema across all legs). Enumerate every
# distributable: the setup.exe stubs AND the DiskSpanning *-setup-*.bin slices.
shopt -s nullglob
PROV_ARTIFACTS=("$OUT_DIR"/*-setup.exe "$OUT_DIR"/*-setup-*.bin)
shopt -u nullglob
PROVENANCE_GIT_ROOT="$ROOT" \
PROVENANCE_SIGNED="$([[ -n "$AUTHENTICODE_PFX" ]] && echo true || echo false)" \
  bash "$ROOT/bin/emit-build-provenance.sh" \
    "$OUT_DIR" \
    "$VERSION" \
    "${PAPERCUSP_BUILD_SHA:-}" \
    false \
    "${PROV_ARTIFACTS[@]}"

rm -rf "$STAGE"
echo "==> done — Windows artifacts (cross-built, no VM) in $OUT_DIR"
ls -lh "$OUT_DIR"
exit 0

}  # ── end self-read guard (WI-3306) ──
