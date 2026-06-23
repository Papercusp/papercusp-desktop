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

# PG client tools (pg_dump/psql/pg_dumpall) for the sidecar's snapshot
# subsystem wiring. Gate on pg_dumpall — the rarest of the three; the
# VM's hand-curated ~/postgres-bin has only pg_dump/psql and must not
# win the PATH race over a complete libpq keg (brew install libpq).
for d in /usr/local/opt/libpq/bin /opt/homebrew/opt/libpq/bin "$HOME/postgres-bin" "$HOME/local/pgsql/bin"; do
  [[ -x "$d/pg_dumpall" ]] && export PATH="$d:$PATH" && break
done

cd "$ROOT"
echo "===== mac build start $(date) (root: $ROOT) ====="
df -h "$HOME" | tail -1

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
bash bin/build-desktop-sidecar.sh
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
PUI_BIN="$(find "$REPO/apps/tui/target/release" "$REPO/target/release" -maxdepth 1 -name pui -type f 2>/dev/null | head -1)"
[[ -n "$PUI_BIN" ]] || { echo "ERROR: pui binary not found after build"; exit 1; }
cp "$PUI_BIN" "$SIDECAR/bin/pui"; chmod 755 "$SIDECAR/bin/pui"
echo "    ✓ pui → sidecar/bin/pui ($PUI_BIN)"
# 2. companion zellij plugin (wasm32-wasip1) — API version-coupled to zellij 0.44.3.
rustup target add wasm32-wasip1 >/dev/null 2>&1 || true
( cd "$REPO/apps/pui-zellij-plugin" && cargo build --release --target wasm32-wasip1 )
WASM="$(find "$REPO/apps/pui-zellij-plugin/target/wasm32-wasip1/release" "$REPO/target/wasm32-wasip1/release" -maxdepth 1 -name '*.wasm' -type f 2>/dev/null | head -1)"
[[ -n "$WASM" ]] || { echo "ERROR: companion .wasm not found after build"; exit 1; }
cp "$WASM" "$SIDECAR/pui-companion.wasm"
echo "    ✓ companion → sidecar/pui-companion.wasm ($WASM)"
# 3. zellij 0.44.3 — the plugin API is version-coupled; must match EXACTLY.
ZJ_VER=0.44.3
case "$(uname -m)" in arm64) ZJ_ARCH=aarch64 ;; *) ZJ_ARCH=x86_64 ;; esac
curl -fsSL "https://github.com/zellij-org/zellij/releases/download/v${ZJ_VER}/zellij-${ZJ_ARCH}-apple-darwin.tar.gz" | tar -xz -C "$SIDECAR/bin"
[[ -x "$SIDECAR/bin/zellij" ]] || { echo "ERROR: zellij ${ZJ_VER} not fetched"; exit 1; }
chmod 755 "$SIDECAR/bin/zellij"
echo "    ✓ zellij ${ZJ_VER} (${ZJ_ARCH}) → sidecar/bin/zellij"

echo "--- tauri build (universal-apple-darwin) ---"
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
CI=true npx tauri build --target universal-apple-darwin --bundles app,dmg

echo "--- artifacts ---"
ls -la src-tauri/target/universal-apple-darwin/release/bundle/dmg/ 2>/dev/null || true
ls -la src-tauri/target/universal-apple-darwin/release/bundle/macos/ 2>/dev/null || true
echo "===== mac build done $(date) ====="
