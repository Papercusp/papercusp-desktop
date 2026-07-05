#!/usr/bin/env bash
# Build the macOS desktop bundle ON a Darwin host (the build VM).
# Successor to the loose ~/mac-build.sh v6 — now versioned in-repo.
# Driven over SSH by the release flow (WITH_MAC leg) or by hand:
#
#   ssh <vm> 'TAURI_SIGNING_PRIVATE_KEY=... bash papercup-build-mac/papercup/papercusp-desktop/bin/mac-vm-build.sh'
#
# Steps (plan mac-desktop-release-readiness-2026-06-11, D-006):
#   1. SwiftTerm term-shim → src-tauri/resources/ (universal when the
#      toolchain allows; absence degrades to NewWindow at runtime)
#   2. sidecar via bin/build-desktop-sidecar.sh (darwin host-arch binaries —
#      the sidecar deliberately stays single-arch, see D-006)
#   3. tauri build --target universal-apple-darwin (app + dmg + updater
#      artifacts; .sig requires TAURI_SIGNING_PRIVATE_KEY in env)
set -eo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

# nvm Node 22 for the build (the *bundled* runtime is vendored separately).
if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  . "$HOME/.nvm/nvm.sh"
  nvm use 22 >/dev/null
fi
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}"

# Homebrew on PATH. pgvector (and the libpq keg below) live under Homebrew's
# prefix, which a NON-login shell does NOT have on PATH — e.g. a detached
# `nohup bash mac-vm-build.sh` (vs the release flow's `bash -lc`). Without this
# the sidecar's pgvector-bundling step aborts with "pgvector was NOT bundled …
# type public.vector does not exist". `brew shellenv` is idempotent, so this is a
# harmless no-op when a login shell already sourced it. (x86_64: /usr/local;
# Apple-silicon: /opt/homebrew.)
for _brew in /usr/local/bin/brew /opt/homebrew/bin/brew; do
  [[ -x "$_brew" ]] && eval "$("$_brew" shellenv)" && break
done

# PG client tools (pg_dump/psql/pg_dumpall) for the sidecar's snapshot
# subsystem wiring. Gate on pg_dumpall — the rarest of the three; the
# VM's hand-curated ~/postgres-bin has only pg_dump/psql and must not
# win the PATH race over a complete libpq keg (brew install libpq).
for d in /usr/local/opt/libpq/bin /opt/homebrew/opt/libpq/bin "$HOME/postgres-bin" "$HOME/local/pgsql/bin"; do
  [[ -x "$d/pg_dumpall" ]] && export PATH="$d:$PATH" && break
done

# ── Build knobs (test-iteration speed-ups; defaults preserve the RELEASE path) ──
#   MAC_BUILD_TARGET — rust target triple. Default 'universal-apple-darwin'
#     (x86_64 + arm64, for shipping). Set 'x86_64-apple-darwin' for a faster
#     single-arch TEST build on the x86_64 VM — halves the cargo step (#2).
#   PAPERCUSP_REUSE_SIDECAR — '1' SKIPS the ~1.2GB sidecar rebuild and reuses the
#     existing src-tauri/sidecar (#1). ONLY safe when your change does NOT touch
#     the sidecar (operator-core / serve.mjs / the Vite SPA / prompts) — i.e. a
#     Rust/desktop-only iteration. Default '0' (always rebuild — correct for
#     releases + any operator change).
MAC_BUILD_TARGET="${MAC_BUILD_TARGET:-universal-apple-darwin}"
PAPERCUSP_REUSE_SIDECAR="${PAPERCUSP_REUSE_SIDECAR:-0}"

cd "$ROOT"
echo "===== mac build start $(date) (root: $ROOT) ====="
df -h "$HOME" | tail -1

cut_release_seed() {
  if [[ "${PAPERCUSP_SKIP_SEED_CUT:-0}" == "1" ]]; then
    echo "--- seed: PAPERCUSP_SKIP_SEED_CUT=1 — using existing src-tauri/seed payload ---"
    [[ -f "$ROOT/src-tauri/seed/manifest.json" ]] || echo "WARN: no seed manifest present; this build will ship the placeholder seed"
    return 0
  fi
  local repo
  repo="$(cd "$ROOT/.." && pwd)"
  local operator_dir="$repo/apps/operator"
  if [[ ! -d "$operator_dir" ]]; then
    echo "ERROR: seed cutter not found at $operator_dir"
    echo "       Set PAPERCUSP_SKIP_SEED_CUT=1 only for a deliberate placeholder build."
    exit 1
  fi
  # Owner decision 2026-07-05 (WI-2903, option A): the release seed is a FULL-history
  # git bundle + the shared-pot corestore snapshot. Depth-1/git-only are the opt-in
  # small/test escape hatches (PAPERCUSP_SEED_DEPTH=1 / PAPERCUSP_SEED_CORESTORE=0),
  # never the release default. cut-seed-cli refuses an epoch seal on a box without
  # the live hive keychain (load-don't-mint) and a missing/empty corestore dir.
  local seed_hive="${PAPERCUSP_SEED_HIVE:-papercusp}"
  local seed_workspace="${PAPERCUSP_SEED_WORKSPACE_ID:-papercusp-workspace}"
  local seed_origin="${PAPERCUSP_SEED_ORIGIN:-https://github.com/Papercusp/papercup}"
  local seed_rev="${PAPERCUSP_SEED_REV:-HEAD}"
  local seed_depth="${PAPERCUSP_SEED_DEPTH:-}"
  local core_args=()
  if [[ "${PAPERCUSP_SEED_CORESTORE:-1}" != "1" ]]; then
    core_args+=(--no-corestore)
  fi
  if [[ -n "${PAPERCUSP_SEED_STORE_DIR:-}" ]]; then
    core_args+=(--store-dir "$PAPERCUSP_SEED_STORE_DIR")
  fi
  local depth_args=()
  if [[ -n "$seed_depth" ]]; then
    depth_args+=(--depth "$seed_depth")
  fi
  echo "--- seed: cutting installer seed (hive=$seed_hive rev=$seed_rev depth=${seed_depth:-full} corestore=${PAPERCUSP_SEED_CORESTORE:-1}) ---"
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
  )
}

cut_release_seed

echo "--- term shim (SwiftPM) ---"
(
  cd src-tauri/macos-term-shim
  swift build -c release --arch x86_64 --arch arm64 \
    || { echo "universal shim build failed; retrying host-arch only"; swift build -c release; }
)
SHIM=""
for p in \
  src-tauri/macos-term-shim/.build/apple/Products/Release/libPapercuspTermShim.dylib \
  src-tauri/macos-term-shim/.build/release/libPapercuspTermShim.dylib; do
  [[ -f "$p" ]] && SHIM="$p" && break
done
mkdir -p src-tauri/resources
if [[ -n "$SHIM" ]]; then
  cp "$SHIM" src-tauri/resources/libPapercuspTermShim.dylib
  lipo -info src-tauri/resources/libPapercuspTermShim.dylib || true
else
  echo "WARN: term shim dylib not produced — embedded terminal will downgrade to NewWindow"
fi

echo "--- sidecar (darwin $(uname -m)) ---"
# REUSE only a real DARWIN sidecar. A host-side `rsync` can clobber the VM's
# darwin sidecar with the Linux host's `src-tauri/sidecar` (Linux node/binaries)
# — reusing THAT yields an app that dies with "exec format error" on macOS. Gate
# on the node being a Mach-O; otherwise rebuild regardless of the flag.
if [[ "$PAPERCUSP_REUSE_SIDECAR" == "1" && -d src-tauri/sidecar/apps ]] \
   && file src-tauri/sidecar/bin/node 2>/dev/null | grep -q 'Mach-O'; then
  echo "    PAPERCUSP_REUSE_SIDECAR=1 — reusing existing DARWIN src-tauri/sidecar (skipping the ~1.2GB rebuild)"
else
  if [[ "$PAPERCUSP_REUSE_SIDECAR" == "1" ]]; then
    echo "    PAPERCUSP_REUSE_SIDECAR=1 but the sidecar is missing or NOT darwin (an rsync likely clobbered it with the Linux host sidecar) — rebuilding to be safe"
  fi
  bash bin/build-desktop-sidecar.sh
fi
echo "--- sidecar node arch ---"
file src-tauri/sidecar/bin/node || true

# ── chat dock: bundle pui + companion wasm + zellij (WI-668) ──────────────
# The docked terminal runs `pui chat` (zellij with the pui-companion plugin).
# None of these ship by default → the dock is a blank pane in a packaged app.
# Drop them into the sidecar so native_terminal.rs (prepare_dock_env) can put
# pui+zellij on PATH and point PUI_COMPANION_WASM at the bundled plugin.
echo "--- chat dock: pui + companion wasm + zellij 0.44.3 ---"
REPO="$(cd "$ROOT/.." && pwd)"
SIDECAR="$ROOT/src-tauri/sidecar"
mkdir -p "$SIDECAR/bin"
# 1. pui binary (apps/tui) — native release build.
( cd "$REPO/apps/tui" && cargo build --release )
# Existence-checked candidates (NOT `find` over maybe-missing dirs — under
# `set -eo pipefail` a missing path arg makes find non-zero → pipefail → exit).
PUI_BIN=""
for _c in "$REPO/apps/tui/target/release/pui" "$REPO/target/release/pui"; do
  [[ -f "$_c" ]] && PUI_BIN="$_c" && break
done
[[ -n "$PUI_BIN" ]] || { echo "ERROR: pui binary not found after build"; exit 1; }
cp "$PUI_BIN" "$SIDECAR/bin/pui"; chmod 755 "$SIDECAR/bin/pui"
echo "    ✓ pui → sidecar/bin/pui ($PUI_BIN)"
# 2. companion zellij plugin (wasm32-wasip1) — API version-coupled to zellij 0.44.3.
rustup target add wasm32-wasip1 >/dev/null 2>&1 || true
( cd "$REPO/apps/pui-zellij-plugin" && cargo build --release --target wasm32-wasip1 )
WASM=""
for _c in "$REPO/apps/pui-zellij-plugin/target/wasm32-wasip1/release/pui_companion.wasm" "$REPO/target/wasm32-wasip1/release/pui_companion.wasm"; do
  [[ -f "$_c" ]] && WASM="$_c" && break
done
[[ -n "$WASM" ]] || { echo "ERROR: companion .wasm not found after build"; exit 1; }
cp "$WASM" "$SIDECAR/pui-companion.wasm"
echo "    ✓ companion → sidecar/pui-companion.wasm ($WASM)"
# 3. zellij 0.44.3 — the plugin API is version-coupled; must match EXACTLY.
ZJ_VER=0.44.3
case "$(uname -m)" in arm64) ZJ_ARCH=aarch64 ;; *) ZJ_ARCH=x86_64 ;; esac
if [[ -x "$SIDECAR/bin/zellij" ]] && "$SIDECAR/bin/zellij" --version 2>/dev/null | grep -q "$ZJ_VER"; then
  echo "    ✓ zellij ${ZJ_VER} already bundled — skipping download"
else
  curl -fsSL "https://github.com/zellij-org/zellij/releases/download/v${ZJ_VER}/zellij-${ZJ_ARCH}-apple-darwin.tar.gz" | tar -xz -C "$SIDECAR/bin"
  [[ -x "$SIDECAR/bin/zellij" ]] || { echo "ERROR: zellij ${ZJ_VER} not fetched"; exit 1; }
  chmod 755 "$SIDECAR/bin/zellij"
  echo "    ✓ zellij ${ZJ_VER} (${ZJ_ARCH}) → sidecar/bin/zellij"
fi

echo "--- tauri build ($MAC_BUILD_TARGET) ---"
# Tauri v2 only reads TAURI_SIGNING_PRIVATE_KEY (content or path) — map the
# legacy _PATH spelling forward so older callers keep working.
if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" && -n "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]]; then
  export TAURI_SIGNING_PRIVATE_KEY="$TAURI_SIGNING_PRIVATE_KEY_PATH"
fi
if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  echo "WARN: no TAURI_SIGNING_PRIVATE_KEY in env — updater artifacts will be unsigned/fail"
fi
# CI=true → tauri-bundler passes --skip-jenkins to bundle_dmg.sh, skipping
# the AppleScript Finder-styling step that times out headless (-1712 over
# SSH on the VM). The DMG just gets default icon layout.
#
# Two-bundle split (ONE binary, two roles — see src-tauri/src/app_role.rs):
#   * gui    — base tauri.conf.json          (Papercusp GUI,    com.papercusp.gui)
#   * server — tauri.server.conf.json override (Papercusp Server, com.papercusp.server)
# Both share the sidecar payload built above. Each role recompiles the Rust
# binary because generate_context! bakes the (different) identifier, which is
# how the runtime picks its role. Distinct productNames → distinct bundle
# filenames, so they don't clobber. Set PAPERCUSP_BUILD_ROLES="gui" (or
# "server") to build just one while iterating.
PAPERCUSP_BUILD_ROLES="${PAPERCUSP_BUILD_ROLES:-gui server}"
BUNDLE_DIR="src-tauri/target/$MAC_BUILD_TARGET/release/bundle"
# tauri's dmg bundler CLEANS bundle/dmg/ at the start of each build, so in a
# multi-role loop the second role silently WIPES the first role's DMG (observed
# 2026-07-05: the gui+server loop ended with only the Server DMG). Stash each
# role's DMG as it's produced, restore them all after the loop.
# The stash must NOT live in /tmp — macOS clears it at boot, and a mid-build
# guest reboot (see the AHCI panic note below) then eats the finished DMGs.
# Same volume as bundle/dmg so the mv is a rename, not a copy.
mkdir -p src-tauri/target
DMG_STASH="$(mktemp -d "$PWD/src-tauri/target/papercusp-dmg-stash.XXXXXX")"
# hdiutil packing a multi-GB DMG (the ~4GB seeded bundle) saturates the virtual
# AHCI disk hard enough to kernel-panic the build VM: IPI/TLB-flush timeout via
# the IOAHCIBlockStorage watchdog ComReset path (observed 2026-07-05, Sonoma
# guest on QEMU/OSX-KVM). Run build+bundle under a gentler IO policy to smooth
# the write burst. Override with PAPERCUSP_BUILD_IOPOLICY
# (important|standard|utility|throttle) or =off to disable.
BUILD_IOPOLICY="${PAPERCUSP_BUILD_IOPOLICY:-utility}"
iopolicy_cmd=()
if [[ "$BUILD_IOPOLICY" != "off" ]] && command -v taskpolicy >/dev/null 2>&1; then
  iopolicy_cmd=(taskpolicy -d "$BUILD_IOPOLICY")
  echo "    (bundling under IO policy: $BUILD_IOPOLICY)"
fi
for role in $PAPERCUSP_BUILD_ROLES; do
  case "$role" in
    gui)    role_cfg=() ;             role_label="Papercusp GUI" ;;
    server) role_cfg=(--config src-tauri/tauri.server.conf.json) ; role_label="Papercusp Server" ;;
    *) echo "WARN: unknown PAPERCUSP_BUILD_ROLES entry '$role' — skipping"; continue ;;
  esac
  echo "--- tauri build: $role_label ($MAC_BUILD_TARGET) ---"
  CI=true "${iopolicy_cmd[@]}" npx tauri build --target "$MAC_BUILD_TARGET" --bundles app,dmg "${role_cfg[@]}"
  found_dmg=0
  for d in "$BUNDLE_DIR"/dmg/*.dmg; do
    [[ -f "$d" ]] || continue
    mv "$d" "$DMG_STASH/" && found_dmg=1
  done
  [[ "$found_dmg" == "1" ]] || { echo "ERROR: $role_label build produced no DMG"; exit 1; }
done
mkdir -p "$BUNDLE_DIR/dmg"
for d in "$DMG_STASH"/*.dmg; do
  [[ -f "$d" ]] && mv "$d" "$BUNDLE_DIR/dmg/"
done
rmdir "$DMG_STASH" 2>/dev/null || true

# ── third icon: "Papercusp Tutorial & Setup.app" baked into the DMGs (WI-2945) ──
# Parity with the Linux .deb's third .desktop entry + the Windows Start-Menu
# shortcut (WI-2197): a lightweight .app whose executable opens Terminal running
# `papercusp tutorial`. First-boot provisioning (writeMacTutorialApp,
# packages/operator-core/lib/desktop-install/papercusp-files.ts) writes the
# SAME bundle into ~/Applications as a fallback — keep the two in sync (same
# canonical name), and it skips itself when this baked copy landed in
# /Applications. Baking it into the DMG makes all THREE icons visible at
# install time instead of after first boot.
TUT_APP="$BUNDLE_DIR/macos/Papercusp Tutorial & Setup.app"
echo "--- generating $TUT_APP ---"
rm -rf "$TUT_APP"
mkdir -p "$TUT_APP/Contents/MacOS" "$TUT_APP/Contents/Resources"
cat > "$TUT_APP/Contents/Info.plist" <<'PLIST'
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
cp src-tauri/icons/icon.icns "$TUT_APP/Contents/Resources/icon.icns" 2>/dev/null \
  || echo "    (no icon.icns — tutorial app ships with the generic icon)"
cat > "$TUT_APP/Contents/MacOS/papercusp-tutorial" <<'EXEC'
#!/bin/bash
# Papercusp Tutorial launcher — baked at build time (mac-vm-build.sh, WI-2945);
# first-boot provisioning (papercusp-files.ts writeMacTutorialApp) writes the
# same bundle to ~/Applications when this one isn't installed. Opens a real
# Terminal window running `papercusp tutorial` (mirrors native_console.rs
# spawn_macos_new_window).
set -e
TMP="$(mktemp -t papercusp-tutorial).command"
cat > "$TMP" <<'SCRIPT'
#!/bin/bash
export PATH="$HOME/.papercusp/bin:$HOME/.local/bin:$PATH"
if [ -x "$HOME/.papercusp/bin/papercusp" ]; then
  exec "$HOME/.papercusp/bin/papercusp" tutorial
fi
# CLI not provisioned yet — first Server boot writes it (installPapercuspFiles).
echo "Papercusp setup hasn't finished yet — launching Papercusp now."
echo "Give it a minute to finish first-run setup, then open Papercusp Tutorial again."
open -b com.papercusp.gui 2>/dev/null || open -a "Papercusp GUI" 2>/dev/null || \
  echo "Could not launch Papercusp — open the Papercusp GUI app first, then retry."
SCRIPT
chmod +x "$TMP"
TERM_APP="Terminal.app"
[ -d "/Applications/iTerm.app" ] && TERM_APP="iTerm.app"
open -na "$TERM_APP" "$TMP"
EXEC
chmod 755 "$TUT_APP/Contents/MacOS/papercusp-tutorial"
echo "    ✓ generated"

# Repack each role's DMG to carry the tutorial app beside the main .app.
# (tauri's bundler admits no extra top-level items, so re-create the DMG:
# same volname, same app + /Applications symlink, plus the tutorial app.
# CI=true above already skipped Finder styling, so no layout is lost.)
for dmg in "$BUNDLE_DIR"/dmg/*.dmg; do
  [[ -f "$dmg" ]] || continue
  case "$dmg" in *"Papercusp GUI"*) main_app="Papercusp GUI.app" ;;
                 *"Papercusp Server"*) main_app="Papercusp Server.app" ;;
                 *) echo "    ? unknown dmg $dmg — skipping tutorial bake"; continue ;; esac
  [[ -d "$BUNDLE_DIR/macos/$main_app" ]] || { echo "    ? $main_app missing — skipping"; continue; }
  vol="$(basename "$main_app" .app)"
  echo "--- repacking $(basename "$dmg") with Papercusp Tutorial & Setup.app ---"
  STAGE="$(mktemp -d /tmp/papercusp-dmg-stage.XXXXXX)"
  cp -R "$BUNDLE_DIR/macos/$main_app" "$STAGE/"
  cp -R "$TUT_APP" "$STAGE/"
  ln -s /Applications "$STAGE/Applications"
  rm -f "$dmg"
  hdiutil create -volname "$vol" -srcfolder "$STAGE" -ov -format UDZO -quiet "$dmg"
  rm -rf "$STAGE"
  echo "    ✓ $(basename "$dmg") now carries the Tutorial & Setup app"
done

echo "--- artifacts ($MAC_BUILD_TARGET) ---"
ls -la "src-tauri/target/$MAC_BUILD_TARGET/release/bundle/dmg/" 2>/dev/null || true
ls -la "src-tauri/target/$MAC_BUILD_TARGET/release/bundle/macos/" 2>/dev/null || true
echo "===== mac build done $(date) ====="
