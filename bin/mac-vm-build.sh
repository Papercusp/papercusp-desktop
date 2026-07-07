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
#   PAPERCUSP_FAST_ITER — '1' skips the updater .app.tar.gz artifacts (a
#     single-threaded gzip of the multi-GB .app per role) and packs DMGs at
#     zlib-level=1. Install/launch testing only — NEVER for release artifacts.
#     Default '0'.
#   (Cargo target dirs are per-role — src-tauri/target/role-{gui,server} — so
#    the two roles' builds stay incremental across legs instead of invalidating
#    each other's leaf compile + link; see the note in the role loop.)
MAC_BUILD_TARGET="${MAC_BUILD_TARGET:-universal-apple-darwin}"
PAPERCUSP_REUSE_SIDECAR="${PAPERCUSP_REUSE_SIDECAR:-0}"
PAPERCUSP_FAST_ITER="${PAPERCUSP_FAST_ITER:-0}"

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
  # WI-3244 (parity with build-windows-on-vm.sh): the LIVE per-workspace corestore
  # is fd-locked by the running operator/substrate, so a fresh snapshot fails
  # "File descriptor could not be locked" without a quiesce.
  # PAPERCUSP_SEED_REUSE_CORESTORE=1 grafts the ALREADY-CUT corestore from
  # src-tauri/seed onto a fresh git cut (cut-seed-cli --reuse-corestore, WI-3232).
  if [[ "${PAPERCUSP_SEED_REUSE_CORESTORE:-0}" == "1" ]]; then
    core_args=(--reuse-corestore "$ROOT/src-tauri/seed")
    [[ -n "${PAPERCUSP_SEED_STORE_DIR:-}" ]] && echo "WARN: PAPERCUSP_SEED_STORE_DIR ignored under PAPERCUSP_SEED_REUSE_CORESTORE=1" >&2
  fi
  # WI-3232 (owner: "Full pot, plaintext seed" — alpha dogfood): without
  # seed/epoch-keys.json a fresh offline install cannot decrypt the pot, and
  # cut-seed-cli emits it only on --emit-epoch-key (this script never passed it —
  # epoch-keyed seeds so far came from manual cuts). Opt out with
  # PAPERCUSP_SEED_EMIT_EPOCH_KEY=0.
  local emit_args=()
  [[ "${PAPERCUSP_SEED_EMIT_EPOCH_KEY:-1}" == "1" ]] && emit_args+=(--emit-epoch-key)
  local depth_args=()
  if [[ -n "$seed_depth" ]]; then
    depth_args+=(--depth "$seed_depth")
  fi
  echo "--- seed: cutting installer seed (hive=$seed_hive rev=$seed_rev depth=${seed_depth:-full} corestore=${PAPERCUSP_SEED_CORESTORE:-1} reuse=${PAPERCUSP_SEED_REUSE_CORESTORE:-0}) ---"
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
        "${emit_args[@]}"
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
# CI=true → tauri-bundler stays non-interactive (no Finder/AppleScript steps
# that time out headless over SSH).
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
# DMGs are packed DIRECTLY by this script (see the pack loop below), NOT by
# tauri: tauri's create-dmg fork (bundle_dmg.sh) mounts a rw image and
# detaches it, and that detach hits DiskArbitration timeouts under
# post-reboot Spotlight indexing (3× on 2026-07-05) — while this script's own
# repack step was already re-creating every DMG from scratch anyway to add
# the tutorial app. So tauri builds only the .app (+ updater tar.gz/sig), and
# a single-invocation `hdiutil create -srcfolder` is the only DMG producer.
# This also removes the old per-role DMG stash dance (tauri's dmg bundler
# wiped bundle/dmg at the start of each role's build).
mkdir -p src-tauri/target
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
  # Per-role cargo target dir: the roles bake different bundle identifiers
  # (generate_context!), so a SHARED target dir forces the leaf-crate recompile
  # + full relink every build as the roles alternate (~9–14 min/leg). One dir
  # per role keeps each role incremental across legs, at the cost of a one-time
  # cold compile per role and a second target dir on disk.
  export CARGO_TARGET_DIR="$PWD/src-tauri/target/role-$role"
  role_bundle_dir="$CARGO_TARGET_DIR/$MAC_BUILD_TARGET/release/bundle"
  echo "--- tauri build: $role_label ($MAC_BUILD_TARGET, target dir role-$role) ---"
  verbose_flag=()
  [[ "${PAPERCUSP_BUILD_VERBOSE:-0}" == "1" ]] && verbose_flag=(--verbose)
  fast_cfg=()
  if [[ "$PAPERCUSP_FAST_ITER" == "1" ]]; then
    echo "    (PAPERCUSP_FAST_ITER=1 — skipping updater artifacts; NOT a release build)"
    fast_cfg=(--config '{"bundle":{"createUpdaterArtifacts":false}}')
  fi
  CI=true "${iopolicy_cmd[@]}" npx tauri build "${verbose_flag[@]}" --target "$MAC_BUILD_TARGET" --bundles app "${role_cfg[@]}" "${fast_cfg[@]}"
  [[ -d "$role_bundle_dir/macos/$role_label.app" ]] || { echo "ERROR: $role_label build produced no .app"; exit 1; }
  # Downstream (release fetch, install verify) reads artifacts from the legacy
  # shared bundle dir — hardlink the updater artifacts over (same volume, free).
  mkdir -p "$BUNDLE_DIR/macos"
  for f in "$role_bundle_dir/macos/$role_label.app.tar.gz" "$role_bundle_dir/macos/$role_label.app.tar.gz.sig"; do
    if [[ -f "$f" ]]; then ln -f "$f" "$BUNDLE_DIR/macos/" || cp "$f" "$BUNDLE_DIR/macos/"; fi
  done
done
unset CARGO_TARGET_DIR

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

# Pack each role's DMG: main .app + tutorial app + /Applications symlink, in
# ONE `hdiutil create -srcfolder` (no rw-image mount/detach — see the note
# above the role loop). Filename matches what tauri's bundler would produce.
# The stage lives on the same APFS volume so `cp -c` clones instead of
# copying the multi-GB seeded .app (falls back to a plain copy elsewhere).
VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
case "$MAC_BUILD_TARGET" in
  x86_64-*)  DMG_ARCH="x64" ;;
  aarch64-*) DMG_ARCH="aarch64" ;;
  *)         DMG_ARCH="$MAC_BUILD_TARGET" ;;
esac
mkdir -p "$BUNDLE_DIR/dmg"
# FAST_ITER packs at zlib-level=1: ~3-5x faster for a few hundred MB of size —
# fine for install/launch testing, wrong for shipped artifacts.
dmg_compress=(-format UDZO)
[[ "$PAPERCUSP_FAST_ITER" == "1" ]] && dmg_compress=(-format UDZO -imagekey zlib-level=1)
for role in $PAPERCUSP_BUILD_ROLES; do
  case "$role" in
    gui)    main_app="Papercusp GUI.app" ;;
    server) main_app="Papercusp Server.app" ;;
    *) continue ;;
  esac
  app_src="$PWD/src-tauri/target/role-$role/$MAC_BUILD_TARGET/release/bundle/macos/$main_app"
  [[ -d "$app_src" ]] || { echo "    ? $main_app missing at $app_src — skipping DMG pack"; continue; }
  vol="$(basename "$main_app" .app)"
  dmg="$BUNDLE_DIR/dmg/${vol}_${VERSION}_${DMG_ARCH}.dmg"
  echo "--- packing $(basename "$dmg") ($main_app + Tutorial & Setup) ---"
  STAGE="$(mktemp -d "$PWD/src-tauri/target/papercusp-dmg-stage.XXXXXX")"
  cp -Rc "$app_src" "$STAGE/" 2>/dev/null || cp -R "$app_src" "$STAGE/"
  cp -R "$TUT_APP" "$STAGE/"
  ln -s /Applications "$STAGE/Applications"
  rm -f "$dmg"
  "${iopolicy_cmd[@]}" hdiutil create -volname "$vol" -srcfolder "$STAGE" -ov "${dmg_compress[@]}" "$dmg"
  rm -rf "$STAGE"
  echo "    ✓ $(basename "$dmg")"
done

echo "--- artifacts ($MAC_BUILD_TARGET) ---"
ls -la "src-tauri/target/$MAC_BUILD_TARGET/release/bundle/dmg/" 2>/dev/null || true
ls -la "src-tauri/target/$MAC_BUILD_TARGET/release/bundle/macos/" 2>/dev/null || true
for role in $PAPERCUSP_BUILD_ROLES; do
  ls -la "src-tauri/target/role-$role/$MAC_BUILD_TARGET/release/bundle/macos/" 2>/dev/null || true
done
echo "===== mac build done $(date) ====="
