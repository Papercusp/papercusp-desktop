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

# WI-4419 follow-up: mac-vm-build.sh is a RELEASE build entrypoint, so arm
# build-desktop-sidecar.sh's unconditional identity-scan of the assembled sidecar
# by default (env does NOT cross the release-local.sh ssh boundary, so it must be
# defaulted HERE, not relied upon from the caller). The mac sidecar's docs-qa
# copies are exactly what leaked the mac VM's aviweiss/avraham creds in 0.0.9;
# this makes the build FAIL rather than ship them again.
export PAPERCUSP_RELEASE_AUDIT="${PAPERCUSP_RELEASE_AUDIT:-1}"

# WI-4781 (build-box-identity hygiene, cosmetic — not a security fix; the mac
# ARRIVES on desktop 0.0.9 audit found the shipped binaries embed the build
# VM's $HOME in Rust DEPENDENCY source-paths, e.g.
# /Users/aviweiss/.cargo/registry/src/index.crates.io-…/<crate>/src/*.rs, in
# panic/debug strings — standard Rust behavior without --remap-path-prefix.
# Non-sensitive (no credentials; the build account name is already public and
# rotated separately under WI-4723) but worth stripping for hygiene. Must be
# exported BEFORE every cargo/tauri invocation below (pui, the companion wasm
# plugin, and both tauri build roles). A RUSTFLAGS change busts the cargo
# incremental cache once (a one-time full rebuild), same as any other RUSTFLAGS
# edit — expected, not a regression. Verify post-build with:
#   strings <binary> | grep -c /Users/   (and /home/) — should be 0.
CARGO_HOME_EFFECTIVE="${CARGO_HOME:-$HOME/.cargo}"
export RUSTFLAGS="${RUSTFLAGS:-} --remap-path-prefix=$HOME=/build-home --remap-path-prefix=$CARGO_HOME_EFFECTIVE=/build-cargo"

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
  # Owner directive 2026-07-07 (supersedes WI-2903 option A's full-history
  # default): release seeds ship DEPTH-1 — a one-commit snapshot of --rev, not
  # the ~1.75GiB full-history bundle. Full history stays on GitHub; first-boot
  # fetch back-fills it from origin when online. This matches
  # build-windows-on-vm.sh (which needed depth-1 anyway for the 4GB installer
  # cap). Escape hatch: export PAPERCUSP_SEED_DEPTH= (empty) forces full
  # history. Git-only stays opt-in via PAPERCUSP_SEED_CORESTORE=0. cut-seed-cli
  # refuses an epoch seal on a box without the live hive keychain
  # (load-don't-mint) and a missing/empty corestore dir.
  local seed_hive="${PAPERCUSP_SEED_HIVE:-papercusp}"
  local seed_workspace="${PAPERCUSP_SEED_WORKSPACE_ID:-papercusp-workspace}"
  local seed_origin="${PAPERCUSP_SEED_ORIGIN:-https://github.com/Papercusp/papercup}"
  local seed_rev="${PAPERCUSP_SEED_REV:-HEAD}"
  local seed_depth="${PAPERCUSP_SEED_DEPTH-1}"
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
  # P-004 trim: --sparse ships only the head-snapshot span (~40MB vs ~2.1GB) of a FRESH
  # corestore cut. Gated OFF for --no-corestore (corestore!=1) AND for reuse=1 (a grafted
  # corestore is shipped as-cut, preserving its coreSparseFrom) — cut-seed-cli THROWS on
  # either combination. Default-ON; PAPERCUSP_SEED_SPARSE=0 forces full history.
  local sparse_args=()
  [[ "${PAPERCUSP_SEED_CORESTORE:-1}" == "1" && "${PAPERCUSP_SEED_REUSE_CORESTORE:-0}" != "1" && "${PAPERCUSP_SEED_SPARSE:-1}" == "1" ]] && sparse_args+=(--sparse)
  local depth_args=()
  if [[ -n "$seed_depth" ]]; then
    depth_args+=(--depth "$seed_depth")
  fi
  echo "--- seed: cutting installer seed (hive=$seed_hive rev=$seed_rev depth=${seed_depth:-full} corestore=${PAPERCUSP_SEED_CORESTORE:-1} reuse=${PAPERCUSP_SEED_REUSE_CORESTORE:-0} sparse=$([[ ${#sparse_args[@]} -gt 0 ]] && echo 1 || echo 0)) ---"
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

# ── Recurrence guard (EI-12894): fail FAST + legibly on workspace-link drift ──
# The sidecar build below esbuilds @papercusp/operator-core, which resolves
# @papercusp/* via the MONOREPO-ROOT node_modules (createRequire walks up). If the
# VM's root node_modules is stale — missing a workspace package added since its last
# root `npm install` (the rsync that stages the tree excludes node_modules, so it
# drifts) — esbuild dies ~35 min deep with a cryptic `Could not resolve` (the 0.0.11
# r8 mac-leg kill; @papercusp/kokoro-tts was the first to bite). Assert every root
# `workspaces` entry has a node_modules/<name> link NOW, before the build, so drift
# surfaces as an immediate NAMED failure instead of a late esbuild resolve error.
# `set -eo pipefail` aborts the build on the guard's non-zero exit. $ROOT is
# papercusp-desktop; the monorepo root (where the guard + the root node_modules that
# esbuild resolves against both live) is one directory up.
MONO_ROOT="$(cd "$ROOT/.." && pwd)"
if [[ -f "$MONO_ROOT/scripts/assert-workspace-links.mjs" ]]; then
  echo "--- workspace-link drift guard (root: $MONO_ROOT) ---"
  node "$MONO_ROOT/scripts/assert-workspace-links.mjs" --root "$MONO_ROOT"
else
  # Building an older snapshot (a tag cut before this guard existed) — degrade to a
  # warn rather than a self-inflicted hard failure on a missing script.
  echo "WARN: workspace-link guard not found at $MONO_ROOT/scripts/assert-workspace-links.mjs — skipping (older snapshot?)"
fi

echo "--- sidecar (darwin $(uname -m)) ---"
# REUSE only a real DARWIN sidecar. A host-side `rsync` can clobber the VM's
# darwin sidecar with the Linux host's `src-tauri/sidecar` (Linux node/binaries)
# — reusing THAT yields an app that dies with "exec format error" on macOS. Gate
# on the node being a Mach-O; otherwise rebuild regardless of the flag.
if [[ "$PAPERCUSP_REUSE_SIDECAR" == "1" && -d src-tauri/sidecar/apps ]] \
   && file src-tauri/sidecar/bin/node 2>/dev/null | grep -q 'Mach-O'; then
  echo "    PAPERCUSP_REUSE_SIDECAR=1 — reusing existing DARWIN src-tauri/sidecar (skipping the ~1.2GB rebuild)"
  # A REUSED sidecar skipped build-desktop-sidecar.sh and with it the
  # release-bundle dependency verifier (WI-3315) — run it here so the reuse
  # fast-path can't ship a bundle with host-masked deps (the pg_wrapper /
  # unbundled-kopia bug class). Fails the build on violation, same as the
  # rebuild path.
  bash bin/verify-sidecar-bundle.sh src-tauri/sidecar
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

# ── env-sidecars/staging (WI-3285 P-004; pinned contract, plan
# env-switcher-packaged-all-platforms-2026-07-06) ──────────────────────────
# The packaged env switcher spawns <sidecarDir>/env-sidecars/<envId>/serve.mjs,
# discovered via dirname(PAPERCUSP_SIDECAR_BIN) = the installed sidecar dir
# (env-operator-launcher.ts resolveBundledSidecar). V1 ships exactly ONE extra
# bundle: staging — and this build is cut from the staging tip, so it clones
# the just-built primary sidecar's payload. Unlike Windows (packed from the
# SHARED dev-box tree, so staged outside sidecar/ and mapped in by the Inno
# .iss), this script runs sequentially on the VM's own checkout AFTER the
# sidecar publish, so staging INSIDE sidecar/ is stable — the same pattern as
# the chat-dock files above — and the existing `sidecar/**/*` resources glob
# (both role confs) bundles it into Contents/Resources with zero tauri.conf /
# Rust changes. Nesting inside sidecar/ also lets the env serve.mjs resolve
# the primary's node_modules (createRequire walks up), same as Windows'
# {app}\sidecar\env-sidecars layout. Sidecar-shaped per the contract:
# serve.mjs + spa/ + db-sql/ (+ prompts/harness when present). NO bin/ (the
# launcher reuses the primary's node), NO internal-docs (V1 env serves no
# /internal/docs), NO db-seed (the env attaches to the primary's embedded PG,
# EI-126 request-only). APFS clonefile (cp -c) keeps the staged copy ~0 extra
# bytes on the chronically-tight VM disk; tauri copies real bytes into the
# .app at bundle time.
echo "--- env-sidecars/staging (packaged env switcher, P-004) ---"
env_sc_copy() { # $1=src $2=dst — clonefile when the fs supports it, else copy
  rm -rf "$2"
  cp -Rc "$1" "$2" 2>/dev/null || { rm -rf "$2"; cp -R "$1" "$2"; }
}
ENV_SC="$SIDECAR/env-sidecars/staging"
rm -rf "$SIDECAR/env-sidecars"
mkdir -p "$ENV_SC"
env_sc_copy "$SIDECAR/serve.mjs" "$ENV_SC/serve.mjs"
env_sc_copy "$SIDECAR/spa" "$ENV_SC/spa"
env_sc_copy "$SIDECAR/db-sql" "$ENV_SC/db-sql"
for env_sc_extra in prompts harness; do
  [[ -e "$SIDECAR/$env_sc_extra" ]] && env_sc_copy "$SIDECAR/$env_sc_extra" "$ENV_SC/$env_sc_extra"
done
[[ -f "$ENV_SC/serve.mjs" && -d "$ENV_SC/spa" && -d "$ENV_SC/db-sql" ]] \
  || { echo "ERROR: env-sidecars/staging incomplete (need serve.mjs + spa/ + db-sql/)"; exit 1; }
echo "    ✓ env-sidecars/staging staged ($(du -sh "$ENV_SC" | cut -f1) apparent, clonefile-shared)"

# ── dev/local runnable source tree (WI-3307 all-5-buttons; mirrors
# build-windows-on-vm.sh + release-local.sh) ────────────────────────────────
# stage-source-tree.sh self-gates on PAPERCUSP_STAGE_SOURCE=1 (prints a skip
# line otherwise) and writes src-tauri/sidecar/source.tar.zst; the existing
# `sidecar/**/*` resources glob sweeps it into the bundle. Unlike Windows this
# runs on the VM's own sequential checkout, so no sidecar flock is needed
# (same rationale as the env-sidecars staging above). The archive ships in the
# SERVER app only — see the per-role stash in the build loop below.
bash bin/stage-source-tree.sh
if [[ "${PAPERCUSP_STAGE_SOURCE:-0}" == "1" ]]; then
  [[ -f src-tauri/sidecar/source.tar.zst ]] \
    || { echo "ERROR: PAPERCUSP_STAGE_SOURCE=1 but stage-source-tree.sh left no src-tauri/sidecar/source.tar.zst"; exit 1; }
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
  # ── disk preflight (durable fix 2026-07-15) ────────────────────────────────
  # Each role compiles into its OWN ~11-12GB CARGO_TARGET_DIR (role-gui +
  # role-server ≈ 24GB of target). On the disk-tight VM the SECOND role's cold
  # compile silently ran out of disk MID-BUILD and died with no artifacts AND no
  # DONE sentinel — it looked like a mysterious hang/kill but was ENOSPC (0.0.11,
  # 2026-07-15). Fail LOUD + EARLY instead: a cold compile (no target dir yet)
  # needs ~14GB free; an incremental one + bundle/DMG needs ~5GB. Below that,
  # refuse with an actionable message rather than dying invisibly near 96% full.
  free_gb=$(( $(df -Pk "$PWD" | awk 'NR==2{print $4}') / 1024 / 1024 ))
  if [[ -d "$CARGO_TARGET_DIR" ]]; then need_gb=5; disk_kind="incremental compile + bundle"; else need_gb=14; disk_kind="cold compile"; fi
  if (( free_gb < need_gb )); then
    echo "ERROR: insufficient disk for $role_label ($disk_kind): ${free_gb}GB free, need ~${need_gb}GB." >&2
    echo "       Each role uses a separate ~12GB cargo target dir (gui + server ≈ 24GB total)." >&2
    echo "       Free space on the build VM, or build a single role:" >&2
    echo "         PAPERCUSP_BUILD_ROLES=gui bin/mac-vm-build.sh" >&2
    exit 28  # ENOSPC — a clear failure + DONE:28 sentinel, never a silent wedge
  fi
  echo "    (disk preflight ✓ ${free_gb}GB free — ok for $disk_kind of $role_label)"
  verbose_flag=()
  [[ "${PAPERCUSP_BUILD_VERBOSE:-0}" == "1" ]] && verbose_flag=(--verbose)
  fast_cfg=()
  if [[ "$PAPERCUSP_FAST_ITER" == "1" ]]; then
    echo "    (PAPERCUSP_FAST_ITER=1 — skipping updater artifacts; NOT a release build)"
    fast_cfg=(--config '{"bundle":{"createUpdaterArtifacts":false}}')
  fi
  # WI-3307 (all-5-buttons): the multi-GB dev/local source bundle ships in the
  # SERVER app only — Server spawns the operator (main.rs points
  # PAPERCUSP_SOURCE_ARCHIVE at its OWN sidecar copy), while a GUI copy would
  # just double the .app + DMG footprint on the disk-tight VM. Stash it out of
  # sidecar/ for the gui leg; restore for the server leg (+ after the loop).
  SRC_ZST="src-tauri/sidecar/source.tar.zst"
  SRC_ZST_STASH="src-tauri/source.tar.zst.role-stash"
  if [[ "$role" == "gui" && -f "$SRC_ZST" ]]; then mv "$SRC_ZST" "$SRC_ZST_STASH"; fi
  if [[ "$role" == "server" && -f "$SRC_ZST_STASH" ]]; then mv "$SRC_ZST_STASH" "$SRC_ZST"; fi
  # ── WI-4723: correct-by-construction resource hygiene (mac creds-leak fix) ──
  # tauri copies the bundle `resources` (sidecar/**, seed/**, resources/*) into a
  # PERSISTENT per-target staging tree next to the binary and assembles the .app
  # FROM there with a copy-into-NEVER-delete step, so the staging accumulates the
  # UNION of every past cut. That is how the PRUNED mac-VM creds docs
  # (agent-insights/mac-vm-qmp-recovery.mdx → sudo pw 'aviweiss', loginwindow pw
  # 'avraham', build-system/**) re-shipped in the public 0.0.8/0.0.9 bundles even
  # though src-tauri/sidecar SOURCE is clean (audit --scan-dir RC=0). This role
  # target dir is PERSISTENT BY DESIGN (role-$role, kept incremental across legs,
  # L353-357), so it carries that accumulation from cut to cut. Make the shipped
  # bytes a PURE FUNCTION of the clean source: rsync -a --delete src-tauri/{sidecar,
  # seed,resources} over every per-arch + universal staging resource tree BEFORE
  # the build. --delete evicts stale files the source no longer has; tauri's
  # in-build copy only re-adds (clean) source files, so it cannot re-introduce the
  # cruft. This MUST precede the build, not follow it: `tauri build --bundles app`
  # mints the .app AND the signed .app.tar.gz+.sig in the SAME step, so cleaning
  # the .app afterwards is a FALSE fix — the tarball is already minted from the
  # dirty .app. We clean the INPUT; the post-build --scan-dir gate below proves it.
  # (Linux does the analogous clean in build-appimage.sh step 2b, AFTER tauri's
  # packaging crashes and BEFORE appimagetool packs; mac has no such window, hence
  # pre-staging here.) Scoped to the 3 resource subdirs only — cargo build
  # artifacts (deps/, build/, the binaries) are untouched, preserving incrementality.
  for _stage_rel in \
      "$CARGO_TARGET_DIR/aarch64-apple-darwin/release" \
      "$CARGO_TARGET_DIR/x86_64-apple-darwin/release" \
      "$CARGO_TARGET_DIR/$MAC_BUILD_TARGET/release"; do
    for _res in sidecar seed resources; do
      _res_src="$ROOT/src-tauri/$_res"
      _res_dst="$_stage_rel/$_res"
      [[ -d "$_res_src" && -d "$_res_dst" ]] || continue
      echo "    (WI-4723 resource-hygiene: rsync --delete $_res → ${_stage_rel#$PWD/})"
      rsync -a --delete "$_res_src"/ "$_res_dst"/
    done
  done
  CI=true "${iopolicy_cmd[@]}" npx tauri build "${verbose_flag[@]}" --target "$MAC_BUILD_TARGET" --bundles app "${role_cfg[@]}" "${fast_cfg[@]}"
  [[ -d "$role_bundle_dir/macos/$role_label.app" ]] || { echo "ERROR: $role_label build produced no .app"; exit 1; }
  # ── WI-4723: fail-closed identity scan of the ASSEMBLED .app (mac creds-leak gate) ──
  # The fail-closed backstop for the resource-hygiene rsync above: scan the bytes
  # that actually ship. audit-release-bundle.py --scan-dir hunts the build-box
  # identity AND the known-sensitive cross-box identities (aviweiss/avraham/
  # marsh-office, WI-4419 KNOWN_SENSITIVE_IDENTITIES — hunted regardless of which
  # box runs the build, so the mac leg catches avraham/marsh-office too) over the
  # assembled tree, honoring NO path-exclude, and exits non-zero if any land in the
  # .app. grep -rIlE skips binary files, so shipped dylibs with an embedded build
  # path don't false-positive — only TEXT leaks (the docs class) trip it. This
  # closes the mac gap the 0.0.9 ARRIVES probe caught: the linux AppImage leg has
  # the equivalent scan (build-appimage.sh), the mac leg had NONE. Fail BEFORE the
  # host-baked assert + the artifact hardlink below, so a dirty .app — and its
  # already-minted .app.tar.gz+.sig — can never reach record-release.
  python3 "$HERE/audit-release-bundle.py" --scan-dir "$role_bundle_dir/macos/$role_label.app" \
    || { echo "ERROR: $role_label — assembled .app carries sensitive identity (see scan above); refusing to package a bundle that leaks build-infra creds"; exit 1; }
  # LABELED != PACKED (WI-4389): the .app EXISTING says nothing about whether the
  # update source actually made it into the binary. option_env!("PAPERCUSP_RELEASE_HOST")
  # reads the env of THIS cargo process — on the VM — and bakes an empty string,
  # SUCCESSFULLY, if the var was not exported into the remote build. The app then
  # polls nothing and the updater says "up to date" forever. Gate on the BYTES, here
  # in the producer, so no leg can forget it (0.0.8 shipped exactly this defect and
  # it cost a full rebuild + manual reinstall).
  bash "$HERE/assert-release-host-baked.sh" "$role_bundle_dir/macos/$role_label.app" \
    || { echo "ERROR: $role_label — release host not baked; refusing to package a permanently-un-updatable app"; exit 1; }
  # Downstream (release fetch, install verify) reads artifacts from the legacy
  # shared bundle dir — hardlink the updater artifacts over (same volume, free).
  mkdir -p "$BUNDLE_DIR/macos"
  for f in "$role_bundle_dir/macos/$role_label.app.tar.gz" "$role_bundle_dir/macos/$role_label.app.tar.gz.sig"; do
    if [[ -f "$f" ]]; then ln -f "$f" "$BUNDLE_DIR/macos/" || cp "$f" "$BUNDLE_DIR/macos/"; fi
  done
done
unset CARGO_TARGET_DIR
# WI-3307: if the loop ended with the source archive still stashed (e.g.
# PAPERCUSP_BUILD_ROLES="gui"), put it back so the sidecar dir stays complete.
if [[ -f "src-tauri/source.tar.zst.role-stash" ]]; then
  mv "src-tauri/source.tar.zst.role-stash" "src-tauri/sidecar/source.tar.zst"
fi

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
