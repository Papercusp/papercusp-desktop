#!/usr/bin/env bash
# Mac public-release verification build (UNSIGNED, no publish, no git mutation).
# Owner directive 2026-07-05: "get the rest of the app ready for public release"
# (signing deferred — owner not enrolled in Apple Developer yet).
#
# Replicates ONLY the safe build legs of release-local.sh WITH_MAC:
#   snapshot HEAD (git archive, immune to the concurrently-edited shared tree, WI-1708)
#   -> cut a REAL depth-1 git seed on the tower (owner epoch keychain)
#   -> rsync -> VM -> mac-vm-build.sh (fast-iter test build) -> scp DMGs back.
# NO version bump, NO monorepo tag/push, NO gh release publish.
#
# Invocation: run from the tower/monorepo checkout (NOT on the VM) —
#   bash papercusp-desktop/bin/mac-vm-verify-build.sh
# It rsyncs a HEAD snapshot to the VM and drives mac-vm-build.sh remotely.
#
# MAC_BUILD_TARGET — rust target triple for the REMOTE build + the DMG
# pull-back path. Defaults to 'universal-apple-darwin' (the actual ship
# target — matches mac-vm-build.sh's own default) so a plain invocation
# verifies real arm64+x86_64 parity, not just one arch. Override to
# 'x86_64-apple-darwin' or 'aarch64-apple-darwin' for a faster single-arch
# smoke test. (Bug fixed 2026-07-25 / WI-5769: this used to be hardcoded to
# x86_64-apple-darwin below regardless of what the caller set, so every
# "universal verify" run before this fix silently only ever built x86_64 —
# universal build parity was never actually exercised end-to-end.)
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/mac-dmg-pullback.sh
source "$HERE/lib/mac-dmg-pullback.sh"

MONOREPO=/home/marsh-office/papercupai-workspace/papercusp
DESKTOP="$MONOREPO/papercusp-desktop"
KEY_FILE="$HOME/.papercusp/signing/papercusp.key"
SSH_OPTS=(-i "$HOME/.ssh/papercup-vm-mac" -p 2222 -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=10)
VM=aviweiss@127.0.0.1
VMDIR=papercup-build-mac/papercup
MAC_BUILD_TARGET="${MAC_BUILD_TARGET:-universal-apple-darwin}"
SHA="$(git -C "$MONOREPO" rev-parse --short HEAD)"
VER="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["version"])' "$DESKTOP/src-tauri/tauri.conf.json" 2>/dev/null || echo 0.0.0-rc)"
# Session-independent scratch dir (override via $MAC_VERIFY_BUILD_SCRATCH_ROOT if you
# want it parked somewhere durable across a single build run — default is a plain /tmp
# dir, not any one agent session's scratchpad, so any caller can run this standalone).
SCRATCH="${MAC_VERIFY_BUILD_SCRATCH_ROOT:-/tmp/mac-verify-build}/mac-build-$SHA"
mkdir -p "$SCRATCH/dmg"
echo "=== mac-verify-build sha=$SHA ver=$VER scratch=$SCRATCH $(date -u +%H:%M:%SZ) ==="

# ── EI-18656687593660627: no concurrent-run clobber ─────────────────────────
# VMDIR above is a FIXED remote path (no per-run isolation) — two agents each
# independently running this script (the common shape after a cold wake /
# identity churn re-lands two of them on the same lane) rsync + npm install +
# build into the SAME remote directory at once. Observed 2026-07-25: one run's
# `npm run build` (rolldown) died with a misleading "failed to resolve
# @mantine/hooks" while the other run's rsync/npm install was writing the same
# tree — a real, reproducible dependency was momentarily missing mid-write, so
# the failure looked like a product bug and wasted a full ~universal-arch
# build cycle chasing it. Serialize whole runs on this host with a flock
# (mirrors the exact `desktop-sidecar` EI-160 pattern in
# build-desktop-sidecar.sh) so a second concurrent invocation waits its turn
# instead of racing into the same VMDIR.
MAC_VM_BUILD_LOCKFILE="${MAC_VM_BUILD_LOCKFILE:-$HOME/.papercusp/locks/mac-vm-verify-build.lock}"
mkdir -p "$(dirname "$MAC_VM_BUILD_LOCKFILE")"
exec 9>"$MAC_VM_BUILD_LOCKFILE"
if ! flock -n 9; then
  echo "→ another mac-vm-verify-build.sh run holds $MAC_VM_BUILD_LOCKFILE (same fixed VMDIR=$VMDIR) — waiting for it"
  flock 9
fi

step() { echo; echo "### [$(date -u +%H:%M:%SZ)] $*"; }

step "1/6 VM reachable?"
ssh "${SSH_OPTS[@]}" "$VM" 'sw_vers -productVersion; sysctl -n hw.ncpu' || { echo "FATAL: mac VM unreachable on :2222"; exit 1; }

step "2/6 cut real depth-1 git seed on the tower (owner keychain)"
CUT="$SCRATCH/seed"; rm -rf "$CUT"
( cd "$MONOREPO/apps/operator" || exit 1
  OPATH="$PATH"; set -a; . ./.env.local 2>/dev/null; set +a; export PATH="$OPATH:$PATH"
  PAPERCUSP_ALLOW_DEV_RESTART=1 PAPERCUSP_WORKSPACE_ROOT="$MONOREPO" \
    npx tsx lib/release/cut-seed-cli.ts --out "$CUT" --repo "$MONOREPO" --no-corestore \
      --rev HEAD --depth 1 --origin https://github.com/Papercusp/papercup \
      --workspace-id papercusp-workspace --json ) 2>&1 | tail -25
[ -f "$CUT/manifest.json" ] || { echo "FATAL: seed cut produced no manifest.json"; exit 1; }
echo "seed cut OK: $(du -sh "$CUT" | cut -f1)"

step "3/6 snapshot HEAD (superproject + submodules)"
SNAP="$SCRATCH/snap"; rm -rf "$SNAP"; mkdir -p "$SNAP"
git -C "$MONOREPO" archive --format=tar HEAD | tar -x -C "$SNAP" || { echo "FATAL: git archive superproject"; exit 1; }
git -C "$MONOREPO" submodule foreach --recursive --quiet \
  'git archive --format=tar --prefix="$displaypath/" HEAD | tar -x -C "'"$SNAP"'"' || { echo "FATAL: git archive submodule"; exit 1; }
rm -rf "$SNAP/papercusp-desktop/src-tauri/seed"
mkdir -p "$SNAP/papercusp-desktop/src-tauri/seed"
cp -a "$CUT/." "$SNAP/papercusp-desktop/src-tauri/seed/"
# Overlay uncommitted working-tree fixes NOT yet in HEAD (git-sync commits async,
# so `git archive HEAD` above misses them). The C.UTF-8→C initdb-locale fix lives
# in embedded-postgres-server/src/index.js, which build-seed.mjs imports to build
# the PGDATA seed — it MUST be in the snapshot or the seed build re-FATALs on macOS.
# Idempotent: once git-sync commits it, this copies identical content.
# Always copy the live working-tree file (unconditional — a submodule-internal
# path can't be diffed against the superproject HEAD; and an identical copy when
# git-sync has already committed it is a harmless no-op).
for OVERLAY in \
  libs/papercusp/packages/embedded-postgres-server/src/index.js \
  papercusp-desktop/src-tauri/vendor/tauri-runtime-wry/src/lib.rs \
  papercusp-desktop/src-tauri/Cargo.toml \
  packages/operator-core/lib/harness-registry.ts \
  packages/operator-core/lib/harness-registry.test.ts \
  packages/operator-core/lib/harness/improvements/learning-infra-health.ts \
  packages/operator-core/lib/harness/improvements/learning-infra-health.test.ts \
  apps/operator/scripts/lib/mirror-tree.sh \
  apps/operator/scripts/setup-wake-runtime.sh \
  apps/operator/scripts/setup-vad-runtime.sh \
; do
  if [ -f "$MONOREPO/$OVERLAY" ]; then
    mkdir -p "$SNAP/$(dirname "$OVERLAY")"
    cp -a "$MONOREPO/$OVERLAY" "$SNAP/$OVERLAY"
    echo "overlaid working-tree file onto snapshot: $OVERLAY"
  fi
done
# Directory overlays: a whole NEW uncommitted vendored crate (git-archive HEAD
# misses the entire tree, and the per-file loop above can't enumerate 75 files).
# WI-3139: vendor/wry carries the url_from_webview nil-URL panic fix; the matching
# `[patch.crates-io] wry = { path = "vendor/wry" }` is in the overlaid Cargo.toml.
for OVERLAYDIR in \
  papercusp-desktop/src-tauri/vendor/wry \
; do
  if [ -d "$MONOREPO/$OVERLAYDIR" ]; then
    rm -rf "$SNAP/$OVERLAYDIR"
    mkdir -p "$SNAP/$(dirname "$OVERLAYDIR")"
    cp -a "$MONOREPO/$OVERLAYDIR" "$SNAP/$(dirname "$OVERLAYDIR")/"
    echo "overlaid working-tree DIR onto snapshot: $OVERLAYDIR ($(find "$MONOREPO/$OVERLAYDIR" -type f | wc -l | tr -d ' ') files)"
  fi
done
echo "snapshot staged: $(du -sh "$SNAP" | cut -f1)"

step "4/6 rsync snapshot -> VM:$VMDIR"
ssh "${SSH_OPTS[@]}" "$VM" "mkdir -p $VMDIR" || { echo "FATAL: mkdir VMDIR on VM"; exit 1; }
rsync -az --delete --exclude '/.papercusp/' \
  --exclude '/papercusp-desktop/src-tauri/sidecar/' \
  --exclude '/papercusp-desktop/src-tauri/macos-term-shim/.build/' \
  --exclude '.git' --exclude 'node_modules' --exclude 'target' \
  --exclude '.turbo' --exclude '.next' --exclude '.mcp.json' --exclude '.claude' \
  -e "ssh ${SSH_OPTS[*]}" "$SNAP/" "$VM:$VMDIR/" || { echo "FATAL: rsync"; exit 1; }
scp -i "$HOME/.ssh/papercup-vm-mac" -P 2222 -o BatchMode=yes -o StrictHostKeyChecking=no "$KEY_FILE" "$VM:.papercusp-updater.key" || { echo "FATAL: scp key"; exit 1; }

step "5/6 remote build ($MAC_BUILD_TARGET fast-iter test build)"
# WI-5769: npm install MUST run from the MONOREPO ROOT ($VMDIR), not from
# papercusp-desktop. papercusp-desktop/package.json has ~1 devDependency
# (@tauri-apps/cli) of its own, so an `npm install` run from inside that
# subdirectory only ever audits ~3 packages and never touches the root
# node_modules that apps/operator-vite (and every other workspace) actually
# builds against. Since the rsync step deliberately excludes node_modules
# (so it doesn't drift on every run), that root node_modules is a
# long-lived, only-ever-installed-elsewhere tree — any dependency added or
# changed in a workspace package.json since the VM's last REAL root install
# silently never gets installed by this "fast-iter" path, so a build that
# should now succeed (e.g. after fixing a missing dependency) keeps failing
# with the exact same resolve error, even though package.json/package-lock
# on the VM are already correct. Root-caused 2026-07-25 chasing a
# @mantine/hooks "still failing after the fix landed" mystery: the fix WAS
# on the VM, but this install never ran against it (node_modules mtime was
# >1h stale; the papercusp-desktop-scoped install audited only 3 packages).
ssh "${SSH_OPTS[@]}" "$VM" 'chmod 600 .papercusp-updater.key; bash -lc "
  cd '"$VMDIR"'
  echo npm-install...; npm install --legacy-peer-deps >/tmp/mac-rel-install.log 2>&1 || { echo NPM-FAIL; tail -30 /tmp/mac-rel-install.log; exit 1; }
  cd papercusp-desktop || exit 1
  export TAURI_SIGNING_PRIVATE_KEY=\$HOME/.papercusp-updater.key
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=
  export PAPERCUSP_BUILD_SHA='"$SHA"'
  export PAPERCUSP_BUILD_VERSION='"$VER"'
  export PAPERCUSP_SKIP_SEED_CUT=1
  export MAC_BUILD_TARGET='"$MAC_BUILD_TARGET"'
  export PAPERCUSP_FAST_ITER=1
  bash bin/mac-vm-build.sh
"' || { echo "FATAL: remote build failed"; exit 1; }

step "6/6 pull DMGs back"
# WI-489075: this pull-back is the ONLY evidence the verification build produced
# a shippable artifact, so every leg of it is fail-closed. Previously the scp was
# suffixed `|| true` and the listing `2>/dev/null`; with no `set -e` anywhere in
# this script, a failed pull / an empty bundle dir / a MAC_BUILD_TARGET path
# mismatch all still printed "BUILD DONE" and exited 0. A probe that cannot fail
# is not a check. Failure handling here matches the remote-build leg above
# (explicit `|| { echo FATAL; exit 1; }`) rather than a script-wide errexit.
scp -i "$HOME/.ssh/papercup-vm-mac" -P 2222 -o BatchMode=yes \
  "$VM:$VMDIR/papercusp-desktop/src-tauri/target/$MAC_BUILD_TARGET/release/bundle/dmg/*.dmg" "$SCRATCH/dmg/" \
  || { echo "FATAL: DMG pull-back failed (scp) — no release artifact retrieved for target=$MAC_BUILD_TARGET"; exit 1; }

echo; echo "=== DMGs ==="; ls -la "$SCRATCH/dmg/"

# The contract lives in lib/mac-dmg-pullback.sh so a test can execute it with no
# Mac, no VM and no network — see that file's header for the full rationale.
assert_dmg_pullback "$SCRATCH/dmg" "$MAC_BUILD_TARGET" || exit 1

echo "=== BUILD DONE sha=$SHA $(date -u +%H:%M:%SZ) ==="
