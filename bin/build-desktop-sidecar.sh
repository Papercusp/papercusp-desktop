#!/usr/bin/env bash
# Build the Node sidecar that the Papercusp desktop app bundles.
#
# Strategy: build papercup/apps/operator as a Next.js standalone bundle, then
# copy it into papercusp-desktop/src-tauri/sidecar/ where Tauri's bundler
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
#                                    formerly libs/papercusp at aviynw/Restart pre-split)
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
echo "  apps/operator/node_modules/@restart/ contents:"
ls -la "$WEB_DIR/node_modules/@restart" 2>&1 | head -10 || echo "(no @restart subdir)"
echo "  apps/operator/node_modules/@papercusp/ contents:"
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
#     apps/operator/server.js    ← runtime entry point (cwd matters)
#     node_modules/              ← hoisted runtime deps
# Tauri's main.rs spawns `node apps/operator/server.js` with cwd = sidecar/
# so __dirname-relative .next paths resolve correctly.
cp -a "$WEB_DIR/.next/standalone/." "$SIDECAR_DIR/"

# Copy static assets — Next standalone build excludes these by default.
echo "→ copying static assets"
mkdir -p "$SIDECAR_DIR/apps/operator/.next"
cp -a "$WEB_DIR/.next/static" "$SIDECAR_DIR/apps/operator/.next/static"
if [[ -d "$WEB_DIR/public" ]]; then
  cp -a "$WEB_DIR/public" "$SIDECAR_DIR/apps/operator/public"
fi

# Sanity-check the entry point exists at the expected path
if [[ ! -f "$SIDECAR_DIR/apps/operator/server.js" ]]; then
  echo "ERROR: expected $SIDECAR_DIR/apps/operator/server.js after standalone copy"
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
#     pointing at retired pre-split paths — those dangle on CI and
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
# Next's tracer copies @lydell/node-pty-<plat>/lib but not the
# prebuilds/<arch>/pty.node native binary (it's loaded via dynamic
# require, see next.config.js outputFileTracingIncludes for the
# half-fix that covers /api/[[...route]]/**). We backfill from the
# operator workspace's node_modules — that's where npm actually
# installed @lydell/* — rather than the desktop repo root, which
# only depends on @tauri-apps/cli.
for pkg in $SIDECAR_DIR/node_modules/@lydell/node-pty-*/; do
  [[ -d "$pkg" ]] || continue
  pkg_name="$(basename "$pkg")"
  src_prebuilds=""
  for cand in \
    "$WEB_DIR/node_modules/@lydell/$pkg_name/prebuilds" \
    "$PAPERCUP_ROOT/node_modules/@lydell/$pkg_name/prebuilds" \
    "$ROOT/node_modules/@lydell/$pkg_name/prebuilds"; do
    if [[ -d "$cand" ]]; then
      src_prebuilds="$cand"
      break
    fi
  done
  if [[ -n "$src_prebuilds" ]]; then
    cp -a "$src_prebuilds" "$pkg/"
    echo "  ✓ $pkg_name ← $src_prebuilds → $(find "$pkg/prebuilds" -name '*.node' | wc -l) .node file(s)"
  else
    echo "  ⚠ $pkg_name: no prebuilds source found in any candidate path; the catch-all /api route will 500 at module load"
  fi
done

# Bundle the framework DDL files so pglite-mode init can find them at
# runtime. The Tauri main applies these on first boot via
# papercusp-init-db.sh in pglite mode.
echo "→ bundling framework DDL"
mkdir -p "$SIDECAR_DIR/db-sql"
cp "$PAPERCUSP_ROOT/libs/db/sql/"*.sql "$SIDECAR_DIR/db-sql/"

# Bundle the sidecar preload script. Loaded via `node --require` before
# server.js to strip Node 22+'s partial localStorage stub (see file
# header for full reasoning).
echo "→ bundling sidecar preload"
cp "$ROOT/bin/sidecar-preload.js" "$SIDECAR_DIR/sidecar-preload.js"

# ---------------------------------------------------------------------------
# Bundle external binaries — omp (Pi) and code-server.
#
# These are the runtime dependencies the @papercupai/pi-coding and
# @papercupai/vscode-server plugins require. Vendoring them here means
# desktop installs work out of the box without users having to install
# Pi via brew or code-server via apt.
#
# Layout under the sidecar:
#   sidecar/bin/omp[.exe]            ← Pi CLI; Tauri prepends sidecar/bin to PATH
#   sidecar/code-server/bin/code-server  ← code-server entry; Tauri spawns it
#
# We pick the binary matching the target platform/arch the build host
# is running on. CI runs the desktop build under `tauri build` on a
# matrix of macos-{14,13}, ubuntu-22.04, and windows-2022, so each
# matrix leg picks the right asset.
# ---------------------------------------------------------------------------
target_os=""
target_arch=""
case "$(uname -s)" in
  Linux*)  target_os="linux" ;;
  Darwin*) target_os="darwin" ;;
  MINGW*|MSYS*|CYGWIN*) target_os="windows" ;;
  *) target_os="$(uname -s)" ;;
esac
case "$(uname -m)" in
  x86_64|amd64) target_arch="x64" ;;
  arm64|aarch64) target_arch="arm64" ;;
  *) target_arch="$(uname -m)" ;;
esac
echo "→ bundling external binaries for $target_os-$target_arch"

# OMP_DIR / BIN_DIR — destination for bundled CLIs (node, omp, gh). Tauri
# prepends this dir to the sidecar's PATH on spawn (see main.rs PATH
# munging) so the sidecar finds them without a user-side install. Hoisted
# here from below because the Node download block referenced OMP_DIR
# before its old in-place definition under `set -u`, killing the build
# with 'OMP_DIR: unbound variable'.
OMP_DIR="$SIDECAR_DIR/bin"
mkdir -p "$OMP_DIR"

# Node.js — vendor a known-good runtime so users don't need Node on PATH.
# Tauri main spawns the sidecar + pglite-server with this binary explicitly
# (see resolve_node_bin in main.rs). Bare `node` only — we don't need npm
# at runtime, the standalone bundle has its dependencies pre-installed.
NODE_VERSION="${NODE_VERSION:-v24.15.0}"
node_dst=""
case "$target_os" in
  linux)   node_archive="node-${NODE_VERSION}-linux-${target_arch}.tar.xz" ;;
  darwin)  case "$target_arch" in
             x64)   node_archive="node-${NODE_VERSION}-darwin-x64.tar.gz" ;;
             arm64) node_archive="node-${NODE_VERSION}-darwin-arm64.tar.gz" ;;
           esac ;;
  windows) node_archive="node-${NODE_VERSION}-win-x64.zip" ;;
esac
if [[ -n "${node_archive:-}" ]]; then
  echo "→ downloading Node $NODE_VERSION → $node_archive"
  node_tarball="/tmp/$node_archive"
  if curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/${node_archive}" -o "$node_tarball"; then
    tmp_node_dir=$(mktemp -d)
    case "$node_archive" in
      *.tar.xz) tar -xJf "$node_tarball" -C "$tmp_node_dir" --strip-components=1 ;;
      *.tar.gz) tar -xzf "$node_tarball" -C "$tmp_node_dir" --strip-components=1 ;;
      *.zip)    unzip -q "$node_tarball" -d "$tmp_node_dir" && \
                 inner=$(find "$tmp_node_dir" -maxdepth 1 -mindepth 1 -type d | head -1) && \
                 mv "$inner"/* "$tmp_node_dir/" 2>/dev/null || true ;;
    esac
    if [[ -f "$tmp_node_dir/bin/node" ]]; then
      cp "$tmp_node_dir/bin/node" "$OMP_DIR/node"
      chmod +x "$OMP_DIR/node"
      node_dst="$OMP_DIR/node"
    elif [[ -f "$tmp_node_dir/node.exe" ]]; then
      cp "$tmp_node_dir/node.exe" "$OMP_DIR/node.exe"
      node_dst="$OMP_DIR/node.exe"
    fi
    rm -rf "$tmp_node_dir" "$node_tarball"
    if [[ -n "$node_dst" ]]; then
      echo "  ✓ node at $node_dst ($(du -h "$node_dst" | awk '{print $1}'))"
    else
      echo "  ⚠ node tarball extracted but no node binary found at expected path; sidecar will fall back to system node"
    fi
  else
    echo "  ⚠ failed to download Node; sidecar will fall back to system node"
  fi
fi

# gh (GitHub CLI) — single Go binary, used by harness flows that
# create/comment on GitHub PRs. cli/cli releases ship per-platform
# tarballs; we extract just `bin/gh[.exe]` into our sidecar/bin/.
GH_VERSION="${GH_VERSION:-2.92.0}"
gh_archive=""
gh_inner_dir=""
case "$target_os" in
  linux)   gh_archive="gh_${GH_VERSION}_linux_${target_arch}.tar.gz";  gh_inner_dir="gh_${GH_VERSION}_linux_${target_arch}" ;;
  darwin)  case "$target_arch" in
             x64)   gh_archive="gh_${GH_VERSION}_macOS_amd64.zip";   gh_inner_dir="gh_${GH_VERSION}_macOS_amd64" ;;
             arm64) gh_archive="gh_${GH_VERSION}_macOS_arm64.zip";   gh_inner_dir="gh_${GH_VERSION}_macOS_arm64" ;;
           esac ;;
  windows) gh_archive="gh_${GH_VERSION}_windows_amd64.zip";          gh_inner_dir="gh_${GH_VERSION}_windows_amd64" ;;
esac
if [[ -n "$gh_archive" ]]; then
  echo "→ downloading gh $GH_VERSION → $gh_archive"
  gh_tarball="/tmp/$gh_archive"
  if curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/${gh_archive}" -o "$gh_tarball"; then
    gh_tmp=$(mktemp -d)
    case "$gh_archive" in
      *.tar.gz) tar -xzf "$gh_tarball" -C "$gh_tmp" ;;
      *.zip)    unzip -q "$gh_tarball" -d "$gh_tmp" ;;
    esac
    # Find the gh binary regardless of inner dir naming quirks
    gh_src=$(find "$gh_tmp" -name "gh" -o -name "gh.exe" 2>/dev/null | head -1)
    if [[ -n "$gh_src" && -f "$gh_src" ]]; then
      gh_dst="$OMP_DIR/$(basename "$gh_src")"
      cp "$gh_src" "$gh_dst"
      chmod +x "$gh_dst"
      echo "  ✓ gh at $gh_dst ($(du -h "$gh_dst" | awk '{print $1}'))"
    else
      echo "  ⚠ gh archive extracted but no gh binary found"
    fi
    rm -rf "$gh_tmp" "$gh_tarball"
  else
    echo "  ⚠ failed to download gh; harness GitHub-integration flows will fall back to user-installed gh"
  fi
fi

# MinGit-busybox (Windows only) — provides BOTH `git.exe` and a busybox-
# backed `bash.exe`, plus the small POSIX util set the harness scripts
# expect (sed, grep, sort, …). macOS/Linux ship git + bash by default so
# we skip vendoring there. Tauri main prepends `git/cmd` and `git/usr/bin`
# to PATH on Windows so all bundled tools resolve by name.
#
# We pin to the busybox flavor of MinGit (vs. the full MinGit) because it
# includes the POSIX shell + utils the harness needs; the regular MinGit
# strips them.
if [[ "$target_os" == "windows" ]]; then
  MINGIT_VERSION="${MINGIT_VERSION:-2.54.0}"
  MINGIT_TAG="${MINGIT_TAG:-v${MINGIT_VERSION}.windows.1}"
  mingit_asset="MinGit-${MINGIT_VERSION}-busybox-64-bit.zip"
  GIT_DIR="$SIDECAR_DIR/git"
  echo "→ downloading MinGit-busybox $MINGIT_VERSION (provides git.exe + bash.exe + POSIX utils on Windows)"
  mingit_zip="/tmp/$mingit_asset"
  if curl -fsSL "https://github.com/git-for-windows/git/releases/download/${MINGIT_TAG}/${mingit_asset}" -o "$mingit_zip"; then
    rm -rf "$GIT_DIR"
    mkdir -p "$GIT_DIR"
    unzip -q "$mingit_zip" -d "$GIT_DIR"
    rm -f "$mingit_zip"
    # MinGit-busybox bundles busybox.exe but no bash.exe — busybox
    # dispatches by argv[0], so a copy named bash.exe routes to its
    # built-in shell. The harness `run.sh` shebang and several scripts
    # need bash on PATH; this is how we satisfy that on Windows.
    if [[ -f "$GIT_DIR/mingw64/bin/busybox.exe" ]]; then
      cp "$GIT_DIR/mingw64/bin/busybox.exe" "$GIT_DIR/mingw64/bin/bash.exe"
    fi
    if [[ -f "$GIT_DIR/cmd/git.exe" && -f "$GIT_DIR/mingw64/bin/bash.exe" ]]; then
      echo "  ✓ MinGit at $GIT_DIR ($(du -sh "$GIT_DIR" | awk '{print $1}'))"
    else
      echo "  ⚠ MinGit zip extracted but cmd/git.exe + mingw64/bin/bash.exe not at expected paths"
      rm -rf "$GIT_DIR"
    fi
  else
    echo "  ⚠ failed to download MinGit; Windows builds will require user-installed Git for Windows"
  fi
fi

# omp (Pi) — github.com/can1357/oh-my-pi releases. Latest tag has
# omp-{darwin,linux,windows}-{x64,arm64}[.exe] assets.
OMP_VERSION="${OMP_VERSION:-v14.5.14}"
# OMP_DIR is now hoisted above; mkdir is idempotent.
omp_asset=""
omp_dst=""
case "$target_os" in
  darwin)  omp_asset="omp-darwin-${target_arch}";    omp_dst="$OMP_DIR/omp" ;;
  linux)   omp_asset="omp-linux-${target_arch}";     omp_dst="$OMP_DIR/omp" ;;
  windows) omp_asset="omp-windows-x64.exe";          omp_dst="$OMP_DIR/omp.exe" ;;
esac
if [[ -n "$omp_asset" ]]; then
  echo "→ downloading omp $OMP_VERSION → $omp_asset"
  if curl -fsSL "https://github.com/can1357/oh-my-pi/releases/download/$OMP_VERSION/$omp_asset" -o "$omp_dst"; then
    chmod +x "$omp_dst"
    echo "  ✓ omp at $omp_dst ($(du -h "$omp_dst" | awk '{print $1}'))"
  else
    echo "  ⚠ failed to download omp; pi-coding plugin will fall back to system PATH"
    rm -f "$omp_dst"
  fi
else
  echo "  ⚠ no omp asset for $target_os-$target_arch; pi-coding plugin will require user-installed omp"
fi

# code-server — github.com/coder/code-server releases. Linux + macOS only;
# Windows users would have to install separately (code-server upstream
# does not ship a native Windows binary).
CODE_SERVER_VERSION="${CODE_SERVER_VERSION:-4.117.0}"
CS_DIR="$SIDECAR_DIR/code-server"
cs_asset=""
case "$target_os" in
  linux)  case "$target_arch" in
            x64)   cs_asset="code-server-${CODE_SERVER_VERSION}-linux-amd64.tar.gz" ;;
            arm64) cs_asset="code-server-${CODE_SERVER_VERSION}-linux-arm64.tar.gz" ;;
          esac ;;
  darwin) case "$target_arch" in
            x64)   cs_asset="code-server-${CODE_SERVER_VERSION}-macos-amd64.tar.gz" ;;
            arm64) cs_asset="code-server-${CODE_SERVER_VERSION}-macos-arm64.tar.gz" ;;
          esac ;;
esac
if [[ -n "$cs_asset" ]]; then
  echo "→ downloading code-server $CODE_SERVER_VERSION → $cs_asset"
  cs_tarball="/tmp/$cs_asset"
  if curl -fsSL "https://github.com/coder/code-server/releases/download/v${CODE_SERVER_VERSION}/$cs_asset" -o "$cs_tarball"; then
    rm -rf "$CS_DIR"
    mkdir -p "$CS_DIR"
    tar -xzf "$cs_tarball" -C "$CS_DIR" --strip-components=1
    rm -f "$cs_tarball"
    if [[ -x "$CS_DIR/bin/code-server" ]]; then
      echo "  ✓ code-server at $CS_DIR ($(du -sh "$CS_DIR" | awk '{print $1}'))"
    else
      echo "  ⚠ code-server tarball extracted but bin/code-server is missing"
      rm -rf "$CS_DIR"
    fi
  else
    echo "  ⚠ failed to download code-server; vscode-server plugin will fall back to localhost:8082"
    rm -f "$cs_tarball"
  fi
else
  echo "  ⚠ no code-server build for $target_os-$target_arch (upstream doesn't ship Windows); vscode-server plugin will require external code-server"
fi

# Compute size
total_size=$(du -sh "$SIDECAR_DIR" 2>/dev/null | awk '{print $1}')
echo "✓ sidecar built at $SIDECAR_DIR ($total_size)"
