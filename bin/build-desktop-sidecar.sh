#!/usr/bin/env bash
# Build the Node sidecar that the Papercusp desktop app bundles.
#
# Strategy: build apps/papercusp as a Next.js standalone bundle, then
# copy it into apps/papercusp-desktop/sidecar/ where Tauri's bundler
# picks it up as a resource (declared in tauri.conf.json `resources`).
#
# The standalone bundle is self-contained — it includes its own
# node_modules tree pruned to only what's needed at runtime.

set -euo pipefail

# Multi-repo layout (post phase-c split). The desktop bundle pulls from
# three sibling repos that must be cloned next to each other:
#
#   papercupai/papercusp-desktop   ← this repo (HERE = bin/)
#   papercupai/papercup            ← contains apps/operator (the Next.js UI)
#   papercupai/papercusp           ← contains packages/papercusp-mcp-server
#                                    + packages/pglite-server (formerly
#                                    libs/papercusp at aviynw/Restart)
#
# Override locations with PAPERCUP_ROOT / PAPERCUSP_ROOT if your layout
# differs (e.g. CI clones into a flat workspace dir).

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
PAPERCUP_ROOT="${PAPERCUP_ROOT:-$ROOT/../papercup}"
PAPERCUSP_ROOT="${PAPERCUSP_ROOT:-$ROOT/../papercusp}"
WEB_DIR="$PAPERCUP_ROOT/apps/operator"
SIDECAR_DIR="$ROOT/src-tauri/sidecar"

if [[ ! -d "$WEB_DIR" ]]; then
  echo "ERROR: papercup/apps/operator not found at $WEB_DIR"
  echo "       Set PAPERCUP_ROOT to the path of your papercupai/papercup clone."
  exit 1
fi
if [[ ! -d "$PAPERCUSP_ROOT" ]]; then
  echo "ERROR: papercusp not found at $PAPERCUSP_ROOT"
  echo "       Set PAPERCUSP_ROOT to the path of your papercupai/papercusp clone."
  exit 1
fi

echo "→ building $WEB_DIR as Next.js standalone bundle"
echo "→ installing operator deps"
(cd "$WEB_DIR" && npm install --legacy-peer-deps --prefer-offline --no-audit --no-fund)

echo "→ verifying workspace deps resolved"
echo "  apps/papercusp/node_modules/@restart/ contents:"
ls -la "$WEB_DIR/node_modules/@restart" 2>&1 | head -10 || echo "(no @restart subdir)"
echo "  apps/papercusp/node_modules/@papercusp/ contents:"
ls -la "$WEB_DIR/node_modules/@papercusp" 2>&1 | head -10 || echo "(no @papercusp subdir)"

(cd "$WEB_DIR" && npm run build)

if [[ ! -d "$WEB_DIR/.next/standalone" ]]; then
  echo "ERROR: expected $WEB_DIR/.next/standalone after build — did the build fail?"
  exit 1
fi

echo "→ clearing old sidecar at $SIDECAR_DIR"
rm -rf "$SIDECAR_DIR"
mkdir -p "$SIDECAR_DIR"

echo "→ copying standalone bundle"
# The standalone dir layout is preserved:
#   sidecar/
#     apps/papercusp/server.js   ← runtime entry point (cwd matters)
#     node_modules/              ← hoisted runtime deps
# Tauri's main.rs spawns `node apps/papercusp/server.js` with cwd = sidecar/
# so __dirname-relative .next paths resolve correctly.
cp -a "$WEB_DIR/.next/standalone/." "$SIDECAR_DIR/"

# Copy static assets — Next standalone build excludes these by default.
echo "→ copying static assets"
mkdir -p "$SIDECAR_DIR/apps/papercusp/.next"
cp -a "$WEB_DIR/.next/static" "$SIDECAR_DIR/apps/papercusp/.next/static"
if [[ -d "$WEB_DIR/public" ]]; then
  cp -a "$WEB_DIR/public" "$SIDECAR_DIR/apps/papercusp/public"
fi

# Sanity-check the entry point exists at the expected path
if [[ ! -f "$SIDECAR_DIR/apps/papercusp/server.js" ]]; then
  echo "ERROR: expected $SIDECAR_DIR/apps/papercusp/server.js after standalone copy"
  exit 1
fi

# Bundle the harness package (run.sh, prompts, templates, identity, docs-viewer).
# At runtime, the sidecar reads PAPERCUSP_HARNESS_DIR (set by Tauri main.rs)
# to locate this. Without it, the harness loop has nothing to execute.
HARNESS_SRC="$PAPERCUSP_ROOT/packages/harness"
HARNESS_DST="$SIDECAR_DIR/harness"
echo "→ copying harness package from $HARNESS_SRC"
if [[ ! -d "$HARNESS_SRC" ]]; then
  echo "ERROR: harness package not found at $HARNESS_SRC"
  exit 1
fi
mkdir -p "$HARNESS_DST"
# Use `find -type f` enumeration instead of `cp -a` so we:
#  1. Skip symlinks entirely (find -type f doesn't match -type l). The harness
#     has dev-time symlinks like docs-viewer/src/content/docs/projects/restart
#     pointing at /home/marsh-office/Restart/docs — those dangle on CI and
#     either cause Tauri's resource bundler to fail (Linux/mac) or `cp` itself
#     to fail (Windows can't create those symlinks).
#  2. Skip docs-viewer entirely. It's an Astro sub-project that needs its own
#     node_modules and isn't required by the harness loop. Phase 4 polish.
#  3. Skip node_modules — those would be re-installed at runtime if needed,
#     not bundled.
echo "→ enumerating harness files (skipping symlinks, docs-viewer, node_modules)"
( cd "$HARNESS_SRC" && find . -type f \
    -not -path "./docs-viewer/*" \
    -not -path "./node_modules/*" \
    -not -path "*/.git/*" ) > /tmp/harness-files.txt
file_count=$(wc -l < /tmp/harness-files.txt)
echo "  $file_count files to copy"
while IFS= read -r f; do
  rel="${f#./}"
  dst_dir="$HARNESS_DST/$(dirname "$rel")"
  mkdir -p "$dst_dir"
  cp "$HARNESS_SRC/$rel" "$HARNESS_DST/$rel"
done < /tmp/harness-files.txt
rm -f /tmp/harness-files.txt

# Sanity-check the artifacts the orchestrator actually needs
for required in run.sh prompts templates; do
  if [[ ! -e "$HARNESS_DST/$required" ]]; then
    echo "ERROR: harness bundle missing $required at $HARNESS_DST"
    exit 1
  fi
done
# run.sh needs to be executable (cp loses the bit on some platforms)
chmod +x "$HARNESS_DST/run.sh"
find "$HARNESS_DST/bin" -type f -name "*.sh" -exec chmod +x {} \; 2>/dev/null || true

# Bundle the embedded pglite-server so desktop installs don't need a
# system Postgres. The Tauri main spawns this alongside the Next.js
# sidecar in production builds (gated by PAPERCUSP_USE_PGLITE=1).
PGLITE_SRC="$PAPERCUSP_ROOT/packages/pglite-server"
PGLITE_DST="$SIDECAR_DIR/pglite-server"
echo "→ bundling pglite-server"
if [[ ! -d "$PGLITE_SRC" ]]; then
  echo "ERROR: @restart/pglite-server not found at $PGLITE_SRC"
  exit 1
fi
mkdir -p "$PGLITE_DST"
cp "$PGLITE_SRC/package.json" "$PGLITE_DST/"
cp -a "$PGLITE_SRC/src" "$PGLITE_DST/"
cp -a "$PGLITE_SRC/bin" "$PGLITE_DST/"
chmod +x "$PGLITE_DST/bin/pglite-server.mjs"
# Install pglite + pglite-socket into the bundled package's node_modules.
# These pull in WASM + native artifacts that Next standalone tracing
# doesn't pick up, so we install them locally inside the bundle.
echo "→ installing pglite-server runtime deps into the bundle"
( cd "$PGLITE_DST" && npm install --omit=dev --silent ) || {
  echo "ERROR: failed to install pglite-server runtime deps"
  exit 1
}
# Sanity check
if [[ ! -d "$PGLITE_DST/node_modules/@electric-sql/pglite" ]]; then
  echo "ERROR: bundled pglite missing — node_modules install didn't include @electric-sql/pglite"
  exit 1
fi

# Bundle the papercusp MCP server. Auto-registered into ~/.omp/agent/mcp.json
# on first pi spawn (pty.ts:ensurePapercuspMcpRegistered) so the LLM sees
# mcp_papercusp_* tools out of the box.
MCP_SRC="$PAPERCUSP_ROOT/packages/papercusp-mcp-server"
MCP_DST="$SIDECAR_DIR/papercusp-mcp-server"
echo "→ bundling papercusp-mcp-server"
if [[ -d "$MCP_SRC" ]]; then
  mkdir -p "$MCP_DST"
  cp "$MCP_SRC/package.json" "$MCP_DST/"
  cp -a "$MCP_SRC/src" "$MCP_DST/"
  cp -a "$MCP_SRC/bin" "$MCP_DST/"
  chmod +x "$MCP_DST/bin/papercusp-mcp-server.mjs"
  ( cd "$MCP_DST" && npm install --omit=dev --silent ) || {
    echo "WARN: failed to install MCP server deps; users won't see mcp_papercusp_* tools"
  }
fi

# node-pty's prebuilt native bindings live in
# `node_modules/@lydell/node-pty-<platform>/prebuilds/<arch>/pty.node`
# and are loaded via dynamic require — Next.js's standalone tracer
# doesn't follow that, so the .node files aren't copied. We copy them
# explicitly from the source workspace's node_modules into whichever
# platform packages exist in the bundled tree.
echo "→ patching @lydell/node-pty prebuilts (native bindings)"
for pkg in $SIDECAR_DIR/node_modules/@lydell/node-pty-*/; do
  [[ -d "$pkg" ]] || continue
  pkg_name="$(basename "$pkg")"
  src_prebuilds="$ROOT/node_modules/@lydell/$pkg_name/prebuilds"
  if [[ -d "$src_prebuilds" ]]; then
    cp -a "$src_prebuilds" "$pkg/"
    echo "  ✓ $pkg_name → $(find "$pkg/prebuilds" -name '*.node' | wc -l) .node file(s)"
  fi
done

# Bundle the framework DDL files so pglite-mode init can find them at
# runtime. The Tauri main applies these on first boot via
# papercusp-init-db.sh in pglite mode.
echo "→ bundling framework DDL"
mkdir -p "$SIDECAR_DIR/db-sql"
cp "$PAPERCUSP_ROOT/libs/db/sql/"*.sql "$SIDECAR_DIR/db-sql/"

# Compute size
total_size=$(du -sh "$SIDECAR_DIR" 2>/dev/null | awk '{print $1}')
echo "✓ sidecar built at $SIDECAR_DIR ($total_size)"
