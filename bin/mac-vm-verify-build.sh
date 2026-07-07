#!/usr/bin/env bash
# Mac public-release verification build (UNSIGNED, no publish, no git mutation).
# Owner directive 2026-07-05: "get the rest of the app ready for public release"
# (signing deferred — owner not enrolled in Apple Developer yet).
#
# Replicates ONLY the safe build legs of release-local.sh WITH_MAC:
#   snapshot HEAD (git archive, immune to the concurrently-edited shared tree, WI-1708)
#   -> cut a REAL depth-1 git seed on the tower (owner epoch keychain)
#   -> rsync -> VM -> mac-vm-build.sh (x86_64 fast-iter test build) -> scp DMGs back.
# NO version bump, NO monorepo tag/push, NO gh release publish.
#
# Invocation: run from the tower/monorepo checkout (NOT on the VM) —
#   bash papercusp-desktop/bin/mac-vm-verify-build.sh
# It rsyncs a HEAD snapshot to the VM and drives mac-vm-build.sh remotely.
set -uo pipefail

MONOREPO=/home/marsh-office/papercupai-workspace/papercusp
DESKTOP="$MONOREPO/papercusp-desktop"
KEY_FILE="$HOME/.papercusp/signing/papercusp.key"
SSH_OPTS=(-i "$HOME/.ssh/papercup-vm-mac" -p 2222 -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=10)
VM=aviweiss@127.0.0.1
VMDIR=papercup-build-mac/papercup
SHA="$(git -C "$MONOREPO" rev-parse --short HEAD)"
VER="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["version"])' "$DESKTOP/src-tauri/tauri.conf.json" 2>/dev/null || echo 0.0.0-rc)"
# Session-independent scratch dir (override via $MAC_VERIFY_BUILD_SCRATCH_ROOT if you
# want it parked somewhere durable across a single build run — default is a plain /tmp
# dir, not any one agent session's scratchpad, so any caller can run this standalone).
SCRATCH="${MAC_VERIFY_BUILD_SCRATCH_ROOT:-/tmp/mac-verify-build}/mac-build-$SHA"
mkdir -p "$SCRATCH/dmg"
echo "=== mac-verify-build sha=$SHA ver=$VER scratch=$SCRATCH $(date -u +%H:%M:%SZ) ==="

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
rsync -az --delete --exclude '.git' --exclude 'node_modules' --exclude 'target' \
  --exclude '.turbo' --exclude '.next' --exclude '.mcp.json' --exclude '.claude' \
  -e "ssh ${SSH_OPTS[*]}" "$SNAP/" "$VM:$VMDIR/" || { echo "FATAL: rsync"; exit 1; }
scp -i "$HOME/.ssh/papercup-vm-mac" -P 2222 -o BatchMode=yes -o StrictHostKeyChecking=no "$KEY_FILE" "$VM:.papercusp-updater.key" || { echo "FATAL: scp key"; exit 1; }

step "5/6 remote build (x86_64 fast-iter test build)"
ssh "${SSH_OPTS[@]}" "$VM" 'chmod 600 .papercusp-updater.key; bash -lc "
  cd '"$VMDIR"'/papercusp-desktop || exit 1
  echo npm-install...; npm install --legacy-peer-deps >/tmp/mac-rel-install.log 2>&1 || { echo NPM-FAIL; tail -30 /tmp/mac-rel-install.log; exit 1; }
  export TAURI_SIGNING_PRIVATE_KEY=\$HOME/.papercusp-updater.key
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=
  export PAPERCUSP_BUILD_SHA='"$SHA"'
  export PAPERCUSP_BUILD_VERSION='"$VER"'
  export PAPERCUSP_SKIP_SEED_CUT=1
  export MAC_BUILD_TARGET=x86_64-apple-darwin
  export PAPERCUSP_FAST_ITER=1
  bash bin/mac-vm-build.sh
"' || { echo "FATAL: remote build failed"; exit 1; }

step "6/6 pull DMGs back"
scp -i "$HOME/.ssh/papercup-vm-mac" -P 2222 -o BatchMode=yes \
  "$VM:$VMDIR/papercusp-desktop/src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/*.dmg" "$SCRATCH/dmg/" || true
echo; echo "=== DMGs ==="; ls -la "$SCRATCH/dmg/" 2>/dev/null
echo "=== BUILD DONE sha=$SHA $(date -u +%H:%M:%SZ) ==="
