#!/usr/bin/env bash
# Build the macOS desktop app (.app + .dmg + updater .app.tar.gz/.sig) by
# CROSS-COMPILING on THIS Linux box — no QEMU mac VM, no SSH. Retires
# bin/mac-vm-build.sh's fragile, slow, lease-contended VM leg AS A BUILD
# DEPENDENCY (WI-5651). Per owner Avi (2026-07-20) the mac VM stays EXISTING +
# startable for TESTING the app — this only removes the VM from the BUILD path.
#
# WHY THIS WORKS (all stages proven end-to-end on Linux, 2026-07-20):
#   Sidecar  bin/build-desktop-sidecar.sh cross-builds a fully-darwin sidecar
#            (embedded-pg, pgvector, pg client tools, node, kopia, zellij, pui,
#            better-sqlite3 — all Mach-O x86_64, dylib refs rewritten + signed);
#            verify-sidecar-bundle.sh --target-os darwin passes. (Tasks 2+3.)
#   Binary   `cargo zigbuild` (zig as the cross-linker + a real macOS SDK on the
#            box) compiles a release papercusp-desktop for x86_64 + aarch64;
#            llvm-lipo fuses them into a universal Mach-O. Per-ROLE identity is
#            baked EXACTLY as the VM did it (see ROLE CORRECTNESS below).
#   .app     Tauri's macOS bundler is host-only (it refuses to assemble a mac
#            bundle off a mac), so this script HAND-ASSEMBLES the .app to the
#            byte-layout Tauri emits — verified against a real tauri-produced
#            reference bundle: Contents/{Info.plist, MacOS/papercusp-desktop,
#            Resources/{icon.icns, sidecar/, seed/, resources/}}. The Info.plist
#            is Tauri's computed CFBundle* keys merged with src-tauri/Info.plist
#            (the ATS/mic keys — WI-1802: without NSAppTransportSecurity the
#            packaged mac app renders a BLANK page, so this merge is load-bearing).
#   Sign     rcodesign (Rust; no `codesign`) deep-signs the bundle with
#            entitlements.plist — ad-hoc by default (parity with the current
#            unsigned prod dmgs), real cert when MAC_SIGN_P12_BASE64 is supplied.
#   Updater  `tauri signer sign` over <productName>.app.tar.gz is the SAME
#            host-side ed25519/minisign step the mac leg always ran.
#   DMG      libdmg-hfsplus (`hfsplus addall` + the `dmg` UDIF converter) over an
#            mkfs.hfsplus image builds a real compressed .dmg with NO hdiutil and
#            NO root.
#
# ROLE CORRECTNESS (the subtlety a naive wiring gets wrong — identical to
# build-windows-cross.sh): the app resolves its role at RUNTIME from the BAKED
# bundle identifier (app_role::detect(&app.config().identifier)), and
# generate_context!() bakes that identifier at COMPILE time from tauri.conf.json.
# So the Server binary MUST be compiled with com.papercusp.server baked in — we
# set TAURI_CONFIG (the merge mechanism `tauri build --config` uses) for the
# Server compile, exactly as the VM ran two separate `tauri build --config
# tauri.server.conf.json` compiles. One binary does NOT serve both roles. NOTE:
# BOTH identifier literals appear in every binary (detect() compares against
# both), so you can NOT grep-verify the baked role — the generated Info.plist is
# kept role-consistent BY CONSTRUCTION (this one loop drives the compile AND the
# plist for each role).
#
# ENV CONTRACT (mirrors bin/mac-vm-build.sh / build-windows-cross.sh so
# release-local.sh can drive this leg with the same env):
#   PAPERCUSP_BUILD_ROLES     roles to build (default "gui server")
#   MAC_BUILD_TARGET          universal-apple-darwin (default; x86_64+aarch64),
#                             or x86_64-apple-darwin / aarch64-apple-darwin for a
#                             faster single-arch TEST build
#   PAPERCUSP_BUILD_SHA       baked (option_env!, /api/health); default: git HEAD
#   PAPERCUSP_BUILD_VERSION   shipped version (option_env!); also the dmg/app
#                             filename version (falls back to tauri.conf.json)
#   PAPERCUSP_RELEASE_HOST    updater poll host, baked at compile (load via
#                             lib/release-host.sh); asserted present in the binary
#   PAPERCUSP_DARWIN_SIDECAR_DIR  prebuilt darwin sidecar to bundle (default
#                             /var/tmp/darwin-sidecar-test). Build it first with
#                             TARGET_OS=darwin TARGET_ARCH=x64 PAPERCUSP_SIDECAR_OUT=<dir>
#                             bin/build-desktop-sidecar.sh
#   PAPERCUSP_MAC_OUT         output bundle dir (default
#                             src-tauri/target/<MAC_BUILD_TARGET>/release/bundle —
#                             the path release-local.sh's mac leg collects from)
#   TAURI_SIGNING_PRIVATE_KEY_PATH / _PASSWORD   updater .sig key (default
#                             ~/.papercusp/signing/papercusp.key, empty password)
#   MAC_SIGN_P12_BASE64 + MAC_SIGN_P12_PASSWORD  optional Apple code-signing cert
#                             (base64 PKCS#12). Unset => ad-hoc signature (same
#                             gatekeeper posture as the current prod dmgs).
#
# KNOWN CROSS-BUILD GAPS (disclosed; both need mac-native artifacts a Linux host
# cannot produce — the kept mac VM remains the place to generate them):
#   - libPapercuspTermShim.dylib is Swift, built on macOS only. Absent here, the
#     embedded terminal degrades to NewWindow at runtime (mac-vm-build.sh's own
#     documented fallback). Vendor a prebuilt universal dylib at
#     src-tauri/resources/libPapercuspTermShim.dylib to ship it.
#   - source.tar.zst (the dev/local "run from source" buttons, WI-3308) is NOT
#     staged for cross builds: it would carry THIS box's LINUX-native node_modules,
#     which break under the bundled darwin node. The 3 bundled-sidecar buttons
#     work; the 2 from-source buttons are the gap. Set PAPERCUSP_STAGE_SOURCE=1 to
#     force-stage anyway (wrong-arch — testing only).
#
# TOOLCHAIN (one-time, already provisioned on this box — WI-5651):
#   - rustup targets x86_64-apple-darwin + aarch64-apple-darwin; cargo-zigbuild;
#     zig (PAPERCUSP_ZIG_DIR, default /tmp/zig); a macOS SDK (SDKROOT, default
#     ~/.papercusp/macos-sdk/MacOSX.sdk); rcodesign; llvm-lipo-18
#   - dmg tools at ~/.papercusp/mac-cross-tools/{dmg,hfsplus} (libdmg-hfsplus) +
#     mkfs.hfsplus (apt hfsprogs)

set -euo pipefail

# ── Self-read guard (WI-3306): parse the whole script before executing, so a
# peer's mid-run edit to this shared-tree file can't shift the running shell's
# read offset into changed bytes. Matching } + exit 0 at EOF.
{

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
SRC_TAURI="$ROOT/src-tauri"

fail() { echo "ERROR: $*" >&2; exit 1; }

# Update source baked at compile (WI-4389). load_release_host is idempotent +
# override-safe: an already-exported PAPERCUSP_RELEASE_HOST wins; otherwise the
# box's ~/.papercusp/release-host.env is read. A direct run still bakes a real
# host (the 0.0.8 "polls nothing forever" defect the gate below also guards).
# shellcheck source=lib/release-host.sh
source "$HERE/lib/release-host.sh"
load_release_host

# WI-4419: a release build arms the sidecar identity-scan by default.
export PAPERCUSP_RELEASE_AUDIT="${PAPERCUSP_RELEASE_AUDIT:-1}"

# WI-4781: strip the build box's $HOME / cargo registry paths from panic/debug
# strings in the shipped binary (--remap-path-prefix). Must be exported BEFORE
# cargo. A RUSTFLAGS change busts the incremental cache once — expected.
CARGO_HOME_EFFECTIVE="${CARGO_HOME:-$HOME/.cargo}"
export RUSTFLAGS="${RUSTFLAGS:-} --remap-path-prefix=$HOME=/build-home --remap-path-prefix=$CARGO_HOME_EFFECTIVE=/build-cargo"

# Build sha baked via option_env! (parity with the VM/windows legs' own loaders).
if [[ -z "${PAPERCUSP_BUILD_SHA:-}" ]]; then
  export PAPERCUSP_BUILD_SHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo '')"
  echo "==> PAPERCUSP_BUILD_SHA not inherited — computed locally: ${PAPERCUSP_BUILD_SHA:-<none>}"
fi

# ── Config / knobs ────────────────────────────────────────────────────────────
ROLES="${PAPERCUSP_BUILD_ROLES:-gui server}"
MAC_BUILD_TARGET="${MAC_BUILD_TARGET:-universal-apple-darwin}"
case "$MAC_BUILD_TARGET" in
  universal-apple-darwin) ARCHES=(x86_64-apple-darwin aarch64-apple-darwin); DMG_ARCH="universal-apple-darwin" ;;
  x86_64-apple-darwin)    ARCHES=(x86_64-apple-darwin);  DMG_ARCH="x64" ;;
  aarch64-apple-darwin)   ARCHES=(aarch64-apple-darwin); DMG_ARCH="aarch64" ;;
  *) fail "unsupported MAC_BUILD_TARGET '$MAC_BUILD_TARGET' (use universal-apple-darwin | x86_64-apple-darwin | aarch64-apple-darwin)" ;;
esac

ZIG_DIR="${PAPERCUSP_ZIG_DIR:-/tmp/zig}"
export SDKROOT="${SDKROOT:-$HOME/.papercusp/macos-sdk/MacOSX.sdk}"
MAC_TOOLS="${PAPERCUSP_MAC_CROSS_TOOLS:-$HOME/.papercusp/mac-cross-tools}"
DMG_TOOL="$MAC_TOOLS/dmg"
HFSPLUS_TOOL="$MAC_TOOLS/hfsplus"
LIPO_BIN="${PAPERCUSP_LLVM_LIPO:-llvm-lipo-18}"
KEY_FILE="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.papercusp/signing/papercusp.key}"
KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
# Pinned tauri CLI, resolved via `npx --yes -p @tauri-apps/cli@VER` — NEVER a bare
# `npx tauri`, which resolves node_modules/.bin/tauri (ABSENT in the release checkout)
# and dies with "could not determine executable to run" (attempt-8 rc=1 class — the
# updater-.sig signer step below). Same idiom as release-local.sh / build-appimage.sh.
TAURI_CLI_VERSION="${PAPERCUSP_TAURI_CLI_VERSION:-${TAURI_CLI_VERSION:-2.11.0}}"
ENTITLEMENTS="$SRC_TAURI/entitlements.plist"
DARWIN_SIDECAR="${PAPERCUSP_DARWIN_SIDECAR_DIR:-/var/tmp/darwin-sidecar-test}"
# stage-source-tree is OFF for cross by default (wrong-arch node_modules; see the
# KNOWN GAPS header). Opt in with PAPERCUSP_STAGE_SOURCE=1.
PAPERCUSP_STAGE_SOURCE="${PAPERCUSP_STAGE_SOURCE:-0}"

VERSION="${PAPERCUSP_BUILD_VERSION:-$(node -p "require('$SRC_TAURI/tauri.conf.json').version" 2>/dev/null || echo unknown)}"

# Cargo target root: THIS box relocates it via ~/.cargo/config.toml
# (target-dir = ~/.cargo-target) AND src-tauri/target is a symlink, so a naive
# "$SRC_TAURI/target/..." path is the WRONG place to read the compiled binary.
# Same derivation build-windows-cross.sh + release-local.sh use.
CARGO_TARGET_ROOT="$(cd "$SRC_TAURI" && cargo metadata --no-deps --format-version 1 2>/dev/null \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("target_directory",""))' 2>/dev/null || true)"
[[ -n "$CARGO_TARGET_ROOT" ]] || CARGO_TARGET_ROOT="$SRC_TAURI/target"

# Output bundle dir — the path release-local.sh's mac leg collects from
# ($ROOT/src-tauri/target/universal-apple-darwin/release/bundle). Overridable for
# scratch test cuts.
OUT_BUNDLE="${PAPERCUSP_MAC_OUT:-$SRC_TAURI/target/$MAC_BUILD_TARGET/release/bundle}"

# Optional real Apple code-signing cert (else ad-hoc). Materialize once.
MAC_CERT_P12=""
if [[ -n "${MAC_SIGN_P12_BASE64:-}" ]]; then
  MAC_CERT_P12="$(mktemp /tmp/papercusp-mac-cert-XXXX.p12)"
  printf '%s' "$MAC_SIGN_P12_BASE64" | base64 -d > "$MAC_CERT_P12" \
    || fail "MAC_SIGN_P12_BASE64 is not valid base64"
  echo "==> mac code-signing ENABLED (owner cert supplied)"
else
  echo "==> mac code-signing: ad-hoc (no MAC_SIGN_P12_BASE64) — same gatekeeper posture as current prod dmgs"
fi

cleanup() {
  local status="$?"
  trap - EXIT
  [[ -n "$MAC_CERT_P12" && -f "$MAC_CERT_P12" ]] && rm -f "$MAC_CERT_P12"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# ── Toolchain preflight (fail-closed) ─────────────────────────────────────────
[[ -x "$ZIG_DIR/zig" ]] || fail "zig not found at $ZIG_DIR/zig (set PAPERCUSP_ZIG_DIR)"
command -v cargo-zigbuild >/dev/null 2>&1 || fail "cargo-zigbuild not installed (cargo install cargo-zigbuild)"
[[ -d "$SDKROOT" ]] || fail "macOS SDK not found at $SDKROOT (set SDKROOT)"
command -v rcodesign >/dev/null 2>&1 || fail "rcodesign not installed (cargo install apple-codesign)"
command -v "$LIPO_BIN" >/dev/null 2>&1 || fail "$LIPO_BIN not found (llvm)"
command -v mkfs.hfsplus >/dev/null 2>&1 || fail "mkfs.hfsplus not found (apt install hfsprogs)"
[[ -x "$DMG_TOOL" && -x "$HFSPLUS_TOOL" ]] || fail "dmg tools missing — expected $DMG_TOOL + $HFSPLUS_TOOL (libdmg-hfsplus)"
[[ -f "$KEY_FILE" ]] || fail "updater signing key not found at $KEY_FILE (bin/setup-signing-key.sh)"
[[ -f "$SRC_TAURI/icons/icon.icns" ]] || fail "src-tauri/icons/icon.icns missing"
[[ -f "$ENTITLEMENTS" ]] || fail "src-tauri/entitlements.plist missing"
[[ -f "$SRC_TAURI/Info.plist" ]] || fail "src-tauri/Info.plist missing (the ATS/mic keys merged into every bundle)"
[[ "$VERSION" != "unknown" && -n "$VERSION" ]] || fail "could not resolve the build version (PAPERCUSP_BUILD_VERSION or tauri.conf.json)"
for a in "${ARCHES[@]}"; do
  rustup target list --installed 2>/dev/null | grep -qx "$a" || fail "rustup target $a not installed (rustup target add $a)"
done
# Darwin sidecar must be built AND actually darwin (a stray linux sidecar here
# would ship an app that dies with 'exec format error' on macOS).
[[ -d "$DARWIN_SIDECAR/apps" && -f "$DARWIN_SIDECAR/bin/node" ]] \
  || fail "darwin sidecar not found at $DARWIN_SIDECAR — build it: TARGET_OS=darwin TARGET_ARCH=x64 PAPERCUSP_SIDECAR_OUT=$DARWIN_SIDECAR bin/build-desktop-sidecar.sh"
file "$DARWIN_SIDECAR/bin/node" 2>/dev/null | grep -q 'Mach-O' \
  || fail "sidecar at $DARWIN_SIDECAR is NOT darwin (bin/node is not Mach-O) — rebuild the darwin sidecar"

echo "===== mac cross-build start $(date) ====="
echo "  roles=$ROLES  target=$MAC_BUILD_TARGET  version=$VERSION  sha=${PAPERCUSP_BUILD_SHA:-<none>}"
echo "  sidecar=$DARWIN_SIDECAR  out=$OUT_BUNDLE"
if [[ -n "${PAPERCUSP_RELEASE_HOST:-}" ]]; then
  _rh_auth="${PAPERCUSP_RELEASE_HOST#*://}"; _rh_auth="${_rh_auth%%/*}"
  echo "  release-host=<set: $_rh_auth> (path redacted — it is the shared secret)"
else
  echo "  release-host=<unset — auto-update disabled>"
fi

# ── Info.plist generator: Tauri's computed CFBundle* keys, then src-tauri/
# Info.plist merged ON TOP (mic + ATS). plistlib keeps it byte-valid. ───────────
gen_info_plist() { # $1=identifier $2=productName $3=out_plist
  python3 - "$1" "$2" "$VERSION" "$SRC_TAURI/Info.plist" "$3" <<'PY'
import sys, plistlib
ident, name, ver, userplist, out = sys.argv[1:6]
d = {
    "CFBundleDevelopmentRegion": "English",
    "CFBundleDisplayName": name,
    "CFBundleExecutable": "papercusp-desktop",
    "CFBundleIdentifier": ident,
    "CFBundleInfoDictionaryVersion": "6.0",
    "CFBundleName": name,
    "CFBundlePackageType": "APPL",
    "CFBundleShortVersionString": ver,
    "CFBundleVersion": ver,
    "CSResourcesFileMapped": True,
    "LSApplicationCategoryType": "public.app-category.developer-tools",
    "LSMinimumSystemVersion": "10.15",
    "CFBundleIconFile": "icon.icns",
    "LSRequiresCarbon": True,
    "NSHighResolutionCapable": True,
}
with open(userplist, "rb") as f:
    d.update(plistlib.load(f))   # user keys (mic, ATS) win — same order as Tauri
with open(out, "wb") as f:
    plistlib.dump(d, f)
PY
}

# ── env-sidecars/staging (packaged env switcher, WI-3285 P-004): clone the
# primary sidecar's serve.mjs + spa + db-sql (+ prompts/harness) so the env
# launcher can spawn <sidecar>/env-sidecars/<env>/serve.mjs. Pure JS/SQL/SPA —
# cross-safe (reuses the primary's darwin node). Runs on the .app's OWN sidecar
# copy, never the shared source. ─────────────────────────────────────────────
stage_env_sidecars() { # $1=sidecar dir (inside the .app)
  local sc="$1" env_sc="$1/env-sidecars/staging"
  rm -rf "$sc/env-sidecars"
  mkdir -p "$env_sc"
  cp -a "$sc/serve.mjs" "$env_sc/serve.mjs"
  cp -a "$sc/spa"       "$env_sc/spa"
  cp -a "$sc/db-sql"    "$env_sc/db-sql"
  for extra in prompts harness; do
    [[ -e "$sc/$extra" ]] && cp -a "$sc/$extra" "$env_sc/$extra"
  done
  [[ -f "$env_sc/serve.mjs" && -d "$env_sc/spa" && -d "$env_sc/db-sql" ]] \
    || fail "env-sidecars/staging incomplete (need serve.mjs + spa/ + db-sql/)"
}

# ── Hand-assemble the .app to Tauri's macOS layout. ───────────────────────────
assemble_app() { # $1=identifier $2=productName $3=universal_binary $4=app_out
  local ident="$1" name="$2" bin="$3" app="$4"
  rm -rf "$app"
  mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
  gen_info_plist "$ident" "$name" "$app/Contents/Info.plist"
  cp "$bin" "$app/Contents/MacOS/papercusp-desktop"
  chmod 755 "$app/Contents/MacOS/papercusp-desktop"
  cp "$SRC_TAURI/icons/icon.icns" "$app/Contents/Resources/icon.icns"

  # sidecar/** -> Contents/Resources/sidecar/ (a real copy per role: signing
  # seals the nested Mach-O in place, so the two roles can't share bytes).
  echo "    (copying darwin sidecar → $name.app Resources — $(du -sh "$DARWIN_SIDECAR" | cut -f1))"
  cp -a "$DARWIN_SIDECAR" "$app/Contents/Resources/sidecar"
  stage_env_sidecars "$app/Contents/Resources/sidecar"

  # source.tar.zst (server-only 5-buttons) — see KNOWN GAPS; opt-in only.
  if [[ "$PAPERCUSP_STAGE_SOURCE" == "1" ]]; then
    echo "    ⚠ PAPERCUSP_STAGE_SOURCE=1 — staging THIS box's (LINUX) source tree; the dev/local buttons will carry wrong-arch node_modules"
    PAPERCUSP_STAGE_SOURCE=1 bash "$HERE/stage-source-tree.sh"
    [[ -f "$SRC_TAURI/sidecar/source.tar.zst" ]] \
      && cp -a "$SRC_TAURI/sidecar/source.tar.zst" "$app/Contents/Resources/sidecar/source.tar.zst"
  fi

  # seed/** -> Contents/Resources/seed/
  if [[ -d "$SRC_TAURI/seed" && -f "$SRC_TAURI/seed/manifest.json" ]]; then
    cp -a "$SRC_TAURI/seed" "$app/Contents/Resources/seed"
  else
    echo "    WARN: no cut seed at $SRC_TAURI/seed — the app ships without a first-boot seed"
  fi

  # resources/* -> Contents/Resources/resources/ — MAC-SELECTIVE. The WSL rootfs
  # (papercup-runtime.tar.gz) + its bootstrap are windows/linux-only; a real mac
  # bundle ships only .gitkeep + libPapercuspTermShim.dylib (when built). Do NOT
  # blind-copy resources/*.
  mkdir -p "$app/Contents/Resources/resources"
  [[ -f "$SRC_TAURI/resources/.gitkeep" ]] && cp "$SRC_TAURI/resources/.gitkeep" "$app/Contents/Resources/resources/" || true
  if [[ -f "$SRC_TAURI/resources/libPapercuspTermShim.dylib" ]]; then
    cp "$SRC_TAURI/resources/libPapercuspTermShim.dylib" "$app/Contents/Resources/resources/"
    echo "    ✓ vendored libPapercuspTermShim.dylib (embedded terminal enabled)"
  else
    echo "    (no libPapercuspTermShim.dylib — embedded terminal degrades to NewWindow; see KNOWN GAPS)"
  fi
}

# ── rcodesign deep-sign the bundle (ad-hoc, or the supplied cert). The nested
# sidecar Mach-O were signed individually during the sidecar build; the bundle
# sign seals them into CodeResources. ─────────────────────────────────────────
sign_app() { # $1=app
  local app="$1" args=(--entitlements-xml-path "$ENTITLEMENTS")
  [[ -n "$MAC_CERT_P12" ]] && args+=(--p12-file "$MAC_CERT_P12" --p12-password "${MAC_SIGN_P12_PASSWORD:-}")
  echo "    signing $(basename "$app") (rcodesign${MAC_CERT_P12:+, cert})"
  rcodesign sign "${args[@]}" "$app" >/dev/null 2>&1 \
    || fail "rcodesign failed to sign $app"
  [[ -f "$app/Contents/_CodeSignature/CodeResources" ]] \
    || fail "signing produced no _CodeSignature for $app"
}

# ── Updater artifact: <productName>.app.tar.gz + ed25519/minisign .sig. ────────
make_updater() { # $1=app $2=productName
  local app="$1" name="$2"
  local tgz="$OUT_BUNDLE/macos/$name.app.tar.gz"
  echo "    updater: $name.app.tar.gz (+ .sig)"
  ( cd "$(dirname "$app")" && tar czf "$tgz" "$name.app" ) || fail "tar of $name.app failed"
  # Strip the two env vars a newer tauri CLI rejects alongside --private-key-path.
  ( cd "$ROOT" && env -u TAURI_SIGNING_PRIVATE_KEY -u TAURI_SIGNING_PRIVATE_KEY_PATH \
      npx --yes -p @tauri-apps/cli@"$TAURI_CLI_VERSION" tauri signer sign --private-key-path "$KEY_FILE" --password "$KEY_PASSWORD" "$tgz" >/dev/null ) \
    || fail "tauri signer failed for $tgz"
  [[ -f "$tgz.sig" ]] || fail "tauri signer produced no .sig for $tgz"
}

# ── "Papercusp Tutorial & Setup.app" baked into the DMG (WI-2945) — parity with
# the Linux .deb third .desktop + the Windows shortcut. Platform-independent. ──
build_tutorial_app() { # $1=dest dir (dmg stage)
  local tut="$1/Papercusp Tutorial & Setup.app"
  rm -rf "$tut"
  mkdir -p "$tut/Contents/MacOS" "$tut/Contents/Resources"
  cat > "$tut/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Papercusp Tutorial &amp; Setup</string>
  <key>CFBundleDisplayName</key><string>Papercusp Tutorial &amp; Setup</string>
  <key>CFBundleIdentifier</key><string>com.papercusp.tutorial</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>papercusp-tutorial</string>
  <key>CFBundleIconFile</key><string>icon.icns</string>
  <key>LSMinimumSystemVersion</key><string>10.15</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST
  cp "$SRC_TAURI/icons/icon.icns" "$tut/Contents/Resources/icon.icns" 2>/dev/null || true
  cat > "$tut/Contents/MacOS/papercusp-tutorial" <<'EXEC'
#!/bin/bash
# Papercusp Tutorial launcher — baked at build time (build-mac-cross.sh, WI-2945).
set -e
TMP="$(mktemp -t papercusp-tutorial).command"
cat > "$TMP" <<'SCRIPT'
#!/bin/bash
export PATH="$HOME/.papercusp/bin:$HOME/.local/bin:$PATH"
if [ -x "$HOME/.papercusp/bin/papercusp" ]; then
  exec "$HOME/.papercusp/bin/papercusp" tutorial
fi
echo "Papercusp setup hasn't finished yet — launching Papercusp now."
open -b com.papercusp.gui 2>/dev/null || open -a "Papercusp GUI" 2>/dev/null || \
  echo "Could not launch Papercusp — open the Papercusp GUI app first, then retry."
SCRIPT
chmod +x "$TMP"
TERM_APP="Terminal.app"
[ -d "/Applications/iTerm.app" ] && TERM_APP="iTerm.app"
open -na "$TERM_APP" "$TMP"
EXEC
  chmod 755 "$tut/Contents/MacOS/papercusp-tutorial"
}

# ── Build a real compressed .dmg with libdmg-hfsplus (no hdiutil, no root):
# stage → mkfs.hfsplus → hfsplus addall → dmg UDIF-convert → sign → verify. ────
make_dmg() { # $1=app $2=productName
  local app="$1" name="$2"
  local dmg="$OUT_BUNDLE/dmg/${name}_${VERSION}_${DMG_ARCH}.dmg"
  local stage raw; stage="$(mktemp -d)"; raw="$(mktemp)"
  cp -a "$app" "$stage/"
  build_tutorial_app "$stage"

  # Size the HFS+ image with GENEROUS slack: content + 25% + 300MB. HFS+ needs
  # headroom beyond the raw bytes for its catalog/extents B-trees + allocation
  # bitmap, which for a bundle with ~14k files (the sidecar node_modules) is well
  # past a small fixed margin — an 80MB slack silently ran `hfsplus addall` out of
  # space mid-populate (WI-5651). The empty tail compresses to ~nothing in the
  # UDIF convert, so oversizing the raw image barely affects the final dmg.
  local bytes mb; bytes=$(du -sb "$stage" | cut -f1); mb=$(( bytes/1024/1024 + bytes/1024/1024/4 + 300 ))
  echo "    dmg: $(basename "$dmg") (staging $((bytes/1024/1024))MB → ${mb}MB image)"
  dd if=/dev/zero of="$raw" bs=1M count="$mb" status=none
  mkfs.hfsplus -v "$name" "$raw" >/dev/null 2>&1 || fail "mkfs.hfsplus failed for $name"

  # Populate the image. PRIMARY: loop-mount + `cp -a` (root, via passwordless
  # sudo). This is REQUIRED for a working install, not a nicety: the userspace
  # `hfsplus addall` writes EVERY file mode 0644, so a dmg-installed app cannot
  # exec its own binaries — "Permission denied", verified on macOS (WI-5651).
  # cp -a preserves the exec bits AND the /Applications drag symlink, and is ~20x
  # faster (kernel bulk writes: ~8s vs ~2.5min). FALLBACK (no sudo / no hfsplus
  # module): `addall` + re-chmod every source executable (0644→0755), so the
  # install still runs (minus the /Applications symlink). Force the fallback with
  # PAPERCUSP_DMG_NO_MOUNT=1.
  local populated=0
  if [[ "${PAPERCUSP_DMG_NO_MOUNT:-0}" != "1" ]] && sudo -n true 2>/dev/null \
     && sudo -n modprobe hfsplus 2>/dev/null; then
    local mnt; mnt="$(mktemp -d)"
    if sudo -n mount -o loop,rw -t hfsplus "$raw" "$mnt" 2>/dev/null; then
      if sudo cp -a "$stage/." "$mnt/" && sudo ln -sf /Applications "$mnt/Applications"; then
        populated=1
      fi
      sync; sudo umount "$mnt" 2>/dev/null || true
    fi
    rmdir "$mnt" 2>/dev/null || true
  fi
  if [[ "$populated" != "1" ]]; then
    echo "    (dmg: loop-mount unavailable — addall + exec-perm repair; no /Applications symlink)"
    "$HFSPLUS_TOOL" "$raw" addall "$stage" >/dev/null 2>&1 || fail "hfsplus addall failed for $name"
    # addall writes 0644 for everything — restore +x on the source's executables,
    # or the installed app can't run its own binaries.
    local relf
    while IFS= read -r -d '' f; do
      relf="${f#$stage/}"
      "$HFSPLUS_TOOL" "$raw" chmod 0755 "/$relf" >/dev/null 2>&1 || true
    done < <(find "$stage" -type f -perm -u+x -print0)
  fi

  rm -f "$dmg"
  "$DMG_TOOL" "$raw" "$dmg" >/dev/null 2>&1 || fail "dmg UDIF conversion failed for $name"
  rm -f "$raw"; rm -rf "$stage"

  # Structurally verify the app + its binary actually landed in the image BEFORE
  # signing. Capture the listing to a var and grep THAT — NEVER `7z l | grep -q`:
  # grep -q exits on first match and SIGPIPEs 7z (exit 141), which `set -o
  # pipefail` then propagates as a spurious pack failure whenever 7z's enumeration
  # outlives the match. That is real: the larger universal dmg failed here while
  # the smaller x64 dmg raced clean (same class as build-windows-cross.sh's
  # grep-vs-strings note).
  local listing; listing="$(7z l "$dmg" 2>/dev/null || true)"
  grep -qF "$name.app/Contents/MacOS/papercusp-desktop" <<<"$listing" \
    || fail "dmg $(basename "$dmg") does not contain $name.app/Contents/MacOS/papercusp-desktop — pack failed"

  # Sign the dmg ONLY with a real cert. The current prod dmgs ship UNSIGNED, and
  # the .app inside is already signed; rcodesign's ad-hoc dmg signature adds
  # nothing for gatekeeper and is non-standard, so the ad-hoc path skips it.
  if [[ -n "$MAC_CERT_P12" ]]; then
    rcodesign sign --p12-file "$MAC_CERT_P12" --p12-password "${MAC_SIGN_P12_PASSWORD:-}" "$dmg" >/dev/null 2>&1 \
      || echo "    WARN: rcodesign could not sign the dmg (non-fatal)"
  fi
  echo "    ✓ $(basename "$dmg") ($(du -h "$dmg" | cut -f1))"
}

# ── Per-role: cross-compile (per arch) → lipo → assemble → gate → sign → updater → dmg ──
mkdir -p "$OUT_BUNDLE/macos" "$OUT_BUNDLE/dmg"
PROV_ARTIFACTS=()

for role in $ROLES; do
  case "$role" in
    gui)    app_id="com.papercusp.gui";    product="Papercusp GUI";    tauri_cfg="" ;;
    server) app_id="com.papercusp.server"; product="Papercusp Server"; tauri_cfg="$SRC_TAURI/tauri.server.conf.json" ;;
    *) echo "WARN: unknown role '$role' — skipping" >&2; continue ;;
  esac
  echo "==> [$role] $product"

  # TAURI_CONFIG merges the server override at build.rs + generate_context! time,
  # baking com.papercusp.server. tauri_build emits rerun-if-env-changed=TAURI_CONFIG,
  # so switching roles re-runs generate_context! (final-crate relink; deps warm).
  cfg_env=()
  [[ -n "$tauri_cfg" ]] && cfg_env=(TAURI_CONFIG="$(cat "$tauri_cfg")")

  thin_bins=()
  for arch in "${ARCHES[@]}"; do
    echo "    [$role] cargo zigbuild $arch"
    ( cd "$SRC_TAURI" && env \
        "PATH=$ZIG_DIR:$PATH" \
        "SDKROOT=$SDKROOT" \
        "PAPERCUSP_BUILD_SHA=${PAPERCUSP_BUILD_SHA:-}" \
        "PAPERCUSP_BUILD_VERSION=${PAPERCUSP_BUILD_VERSION:-}" \
        "PAPERCUSP_RELEASE_HOST=${PAPERCUSP_RELEASE_HOST:-}" \
        "${cfg_env[@]}" \
        cargo zigbuild --release --target "$arch" -p papercusp-desktop )
    local_bin="$CARGO_TARGET_ROOT/$arch/release/papercusp-desktop"
    [[ -f "$local_bin" ]] || fail "[$role] cross-compile produced no binary for $arch at $local_bin"
    thin_bins+=("$local_bin")
  done

  # lipo → universal (or copy the single arch)
  uni_bin="$CARGO_TARGET_ROOT/papercusp-desktop-$role-$DMG_ARCH"
  if [[ ${#thin_bins[@]} -gt 1 ]]; then
    "$LIPO_BIN" -create "${thin_bins[@]}" -output "$uni_bin" || fail "[$role] llvm-lipo failed"
  else
    cp "${thin_bins[0]}" "$uni_bin"
  fi

  # Assert the release host was baked into the BYTES (the 0.0.8 silent-killer).
  # grep -a, never `strings | grep -q` (SIGPIPE under pipefail); LC_ALL=C for
  # byte-exact matching in a Mach-O with invalid-UTF-8 .rodata.
  if [[ -n "${PAPERCUSP_RELEASE_HOST:-}" ]]; then
    needle="${PAPERCUSP_RELEASE_HOST#*://}"; needle="${needle%%/*}"
    LC_ALL=C grep -aqF -- "$needle" "$uni_bin" \
      || fail "[$role] PAPERCUSP_RELEASE_HOST authority '$needle' is NOT baked into the binary — cargo cached a stale/empty host. Clean the crate and rebuild."
  fi

  app="$OUT_BUNDLE/macos/$product.app"
  echo "    [$role] assembling $product.app"
  assemble_app "$app_id" "$product" "$uni_bin" "$app"

  # ── MANDATORY gates (mac-vm-build.sh L524-547 parity) ──
  # (a) creds-leak scan of the ASSEMBLED bytes (WI-4723). Honors no path-exclude.
  python3 "$HERE/audit-release-bundle.py" --scan-dir "$app" \
    || fail "[$role] assembled .app carries a sensitive identity (see scan) — refusing to package a creds-leaking bundle"
  # (b) release host baked in the shipped bytes (LABELED != PACKED, WI-4389).
  bash "$HERE/assert-release-host-baked.sh" "$app" \
    || fail "[$role] release host not baked — refusing to package a permanently-un-updatable app"

  sign_app "$app"
  make_updater "$app" "$product"
  make_dmg "$app" "$product"

  PROV_ARTIFACTS+=("$OUT_BUNDLE/dmg/${product}_${VERSION}_${DMG_ARCH}.dmg" "$OUT_BUNDLE/macos/$product.app.tar.gz")
done

# ── Provenance (shared emitter, one schema across all legs). ──────────────────
if [[ -x "$HERE/emit-build-provenance.sh" && ${#PROV_ARTIFACTS[@]} -gt 0 ]]; then
  PROVENANCE_GIT_ROOT="$ROOT" \
  PROVENANCE_SIGNED="$([[ -n "$MAC_CERT_P12" ]] && echo true || echo false)" \
    bash "$HERE/emit-build-provenance.sh" \
      "$OUT_BUNDLE" \
      "$VERSION" \
      "${PAPERCUSP_BUILD_SHA:-}" \
      false \
      "${PROV_ARTIFACTS[@]}" || echo "WARN: provenance emit failed (non-fatal)"
fi

echo "===== mac cross-build done $(date) — artifacts in $OUT_BUNDLE ====="
ls -lh "$OUT_BUNDLE/macos/" 2>/dev/null || true
ls -lh "$OUT_BUNDLE/dmg/" 2>/dev/null || true
exit 0

}  # ── end self-read guard (WI-3306) ──
