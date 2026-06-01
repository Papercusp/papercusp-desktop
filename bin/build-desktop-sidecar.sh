#!/usr/bin/env bash
# Build the Node sidecar that the Papercusp desktop app bundles.
#
# Strategy (post operator-vite migration, Phase F3/G4): the operator UI is
# the Vite SPA (apps/operator-vite), and the SPA + /api/* + /internal/docs/*
# are served by a single-process Hono host (apps/operator/bin/hono-host.ts).
# This script `vite build`s the SPA and esbuild-bundles the host into
# papercusp-desktop/src-tauri/sidecar/, which Tauri's bundler picks up as a
# resource (declared in tauri.conf.json `resources`). Tauri main.rs spawns
# `node sidecar/host.cjs`.
#
# The bundled sidecar is self-contained: host.cjs has every inlinable module
# bundled in; only genuinely-native deps (node-pty) ship as node_modules.

set -euo pipefail

# Multi-repo layout (post phase-c split). The desktop bundle pulls from
# two sibling clones:
#
#   Papercusp/papercusp-desktop   ← this repo (HERE = bin/)
#   Papercusp/papercup            ← contains apps/operator (Next.js UI)
#                                    AND libs/papercusp/ (submodule with
#                                    embedded-postgres-server, zero-cache-server,
#                                    harness, papercusp-mcp-server, pglite-server,
#                                    cli, orchestrator). The submodule is the
#                                    canonical post-phase-c location for these
#                                    packages — the old sibling-repo
#                                    Papercusp/papercusp clone is no longer
#                                    used by this script.
#
# Override locations with PAPERCUP_ROOT / PAPERCUSP_ROOT if your layout
# differs (e.g. CI clones into a flat workspace dir).

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
PAPERCUP_ROOT="${PAPERCUP_ROOT:-$ROOT/../papercup}"
PAPERCUSP_ROOT="${PAPERCUSP_ROOT:-$PAPERCUP_ROOT/libs/papercusp}"
WEB_DIR="$PAPERCUP_ROOT/apps/operator"
SIDECAR_DIR="$ROOT/src-tauri/sidecar"

if [[ ! -d "$WEB_DIR" ]]; then
  echo "ERROR: papercup/apps/operator not found at $WEB_DIR"
  echo "       Set PAPERCUP_ROOT to the path of your Papercusp/papercup clone."
  exit 1
fi
if [[ ! -d "$PAPERCUSP_ROOT" ]]; then
  echo "ERROR: papercusp not found at $PAPERCUSP_ROOT"
  echo "       Set PAPERCUSP_ROOT to the path of your Papercusp/papercusp clone."
  exit 1
fi

# ---------------------------------------------------------------------------
# operator-vite migration (Phase F3 / G4). The desktop UI is no longer a
# Next.js app — it is the Vite SPA (apps/operator-vite) served, together
# with /api/* and /internal/docs/*, by the single-process Hono host
# (apps/operator/bin/hono-host.ts). So instead of `next build` →
# `.next/standalone`, this section:
#
#   1. installs operator + operator-vite deps,
#   2. `vite build`s the SPA → apps/operator-vite/dist/,
#   3. esbuild-bundles the Hono host into one CJS file (sidecar/host.cjs),
#   4. copies the SPA, the Starlight docs, operator prompts, and the one
#      externalized native dep (node-pty) into the sidecar.
#
# Why esbuild and not a node_modules copy: the monorepo hoists deps to the
# repo-root node_modules, so `cp apps/operator/node_modules` would miss
# them. `next build`'s standalone tracer used to resolve that; esbuild
# resolves it differently — it follows the host's import graph and *inlines*
# every module, hoisting and workspace symlinks alike. The result needs no
# node_modules except the handful that genuinely cannot be inlined.
#
# ┌─ BUNDLE STEP: VERIFIED 2026-05-21 ──────────────────────────────────┐
# │ The esbuild bundle step itself is verified — esbuild@0.25.0 bundles  │
# │ the full host import graph clean (17.5MB host.mjs, parses as valid   │
# │ ESM) with exactly the HOST_EXTERNALS below. node-pty is the only     │
# │ genuinely-native external. UNVERIFIED beyond bundling: whether the   │
# │ bundle RUNS correctly in the packaged desktop (needs a real          │
# │ `tauri build` + the embedded-PG sidecars). If a FUTURE host route    │
# │ adds a native (.node) or .wasm dep, esbuild will fail with "Could    │
# │ not resolve" — add that package to HOST_EXTERNALS and copy it into   │
# │ sidecar/node_modules alongside the node-pty copy below.              │
# └─────────────────────────────────────────────────────────────────────┘
# ---------------------------------------------------------------------------
echo "→ building operator-vite SPA + esbuild-bundling the Hono host"
echo "→ installing operator deps (esbuild resolves the host import graph against these)"
(cd "$WEB_DIR" && npm install --legacy-peer-deps --prefer-offline --no-audit --no-fund --ignore-scripts)

echo "→ verifying workspace deps resolved"
echo "  apps/operator/node_modules/@restart/ contents:"
ls -la "$WEB_DIR/node_modules/@restart" 2>&1 | head -10 || echo "(no @restart subdir)"
echo "  apps/operator/node_modules/@papercusp/ contents:"
ls -la "$WEB_DIR/node_modules/@papercusp" 2>&1 | head -10 || echo "(no @papercusp subdir)"

VITE_DIR="$PAPERCUP_ROOT/apps/operator-vite"
if [[ ! -d "$VITE_DIR" ]]; then
  echo "ERROR: apps/operator-vite not found at $VITE_DIR"
  exit 1
fi
echo "→ installing operator-vite deps"
(cd "$VITE_DIR" && npm install --legacy-peer-deps --prefer-offline --no-audit --no-fund --ignore-scripts)

echo "→ building operator-vite SPA (vite build → dist/)"
(cd "$PAPERCUP_ROOT" && npm --workspace @papercusp/operator-vite run build)
if [[ ! -f "$VITE_DIR/dist/index.html" ]]; then
  echo "ERROR: expected $VITE_DIR/dist/index.html after the Vite build"
  exit 1
fi

echo "→ clearing old sidecar at $SIDECAR_DIR"
rm -rf "$SIDECAR_DIR"
mkdir -p "$SIDECAR_DIR" "$SIDECAR_DIR/node_modules/@lydell"

echo "→ esbuild-bundling the Hono host → $SIDECAR_DIR/host.mjs"
# ESM output: the host's import graph contains `import.meta.url` (a CJS
# bundle rejects it). ESM has no `__dirname`/`__filename`/`require`, so the
# banner re-creates them — the standard esbuild-ESM-for-Node recipe — for
# the bundled code + the externalized CJS deps below.
#
# node-pty (the pty-terminal routes) is the host's one hard native dep —
# it loads a platform .node binary and cannot be inlined. Keep the list in
# sync if a future host route pulls in another native/.wasm package (see
# the FIRST-BUILD NOTE above).
HOST_BANNER="import{createRequire as __pcr}from'module';import{fileURLToPath as __pftu}from'url';import{dirname as __pdn}from'path';const require=__pcr(import.meta.url);const __filename=__pftu(import.meta.url);const __dirname=__pdn(__filename);"
HOST_EXTERNALS=(
  --external:@lydell/*
  --external:bufferutil
  --external:utf-8-validate
  --external:fsevents
)
# esbuild pinned to 0.25.x — the repo's hoisted esbuild is 0.17.x, which
# predates `with { type: 'json' }` import-attribute support (the host graph
# imports a plugin JSON schema that way). Verified 2026-05-21: 0.25.0
# bundles the full host graph clean (17.5MB host.mjs, valid ESM) with the
# externals below — esbuild inlines workspace + hoisted deps alike, so the
# monorepo dep-hoist is a non-issue.
(cd "$WEB_DIR" && npx --yes esbuild@0.25.0 bin/hono-host.ts \
  --bundle --platform=node --format=esm --target=node22 \
  --outfile="$SIDECAR_DIR/host.mjs" \
  --banner:js="$HOST_BANNER" \
  "${HOST_EXTERNALS[@]}")
if [[ ! -f "$SIDECAR_DIR/host.mjs" ]]; then
  echo "ERROR: esbuild did not produce $SIDECAR_DIR/host.mjs"
  exit 1
fi

# Copy the externalized native deps. esbuild inlined everything else, so
# this is a tiny tree — node-pty + its platform-binary sub-package(s).
# Search every node_modules the monorepo might have hoisted them into.
echo "→ copying externalized native deps (node-pty) into the sidecar"
npt_count=0
for base in "$WEB_DIR/node_modules" "$PAPERCUP_ROOT/node_modules" "$ROOT/node_modules"; do
  for nptdir in "$base/@lydell"/node-pty*; do
    [[ -d "$nptdir" ]] || continue
    name="$(basename "$nptdir")"
    [[ -e "$SIDECAR_DIR/node_modules/@lydell/$name" ]] && continue
    cp -aL "$nptdir" "$SIDECAR_DIR/node_modules/@lydell/$name"
    npt_count=$((npt_count + 1))
  done
done
echo "  copied $npt_count node-pty package(s)"
if [[ "$npt_count" -eq 0 ]]; then
  echo "ERROR: node-pty not found in any node_modules — the pty terminal routes will crash"
  exit 1
fi

# Static payloads the host serves. host-spa.ts / host-docs.ts resolve these
# from the PAPERCUSP_SPA_DIST / PAPERCUSP_DOCS_ROOT env vars Tauri main.rs
# sets — see those files' root-resolution comments.
echo "→ copying operator-vite/dist → sidecar/spa"
cp -a "$VITE_DIR/dist" "$SIDECAR_DIR/spa"
echo "→ copying Starlight docs → sidecar/internal-docs"
if [[ -d "$WEB_DIR/public/internal/docs" ]]; then
  cp -a "$WEB_DIR/public/internal/docs" "$SIDECAR_DIR/internal-docs"
else
  echo "  ⚠ $WEB_DIR/public/internal/docs not found — /internal/docs/* will 404 in the bundle"
fi

# Operator prompts — some endpoint-route handlers read apps/operator/prompts/
# at runtime. esbuild doesn't trace runtime fs reads, so copy them explicitly.
if [[ -d "$WEB_DIR/prompts" ]]; then
  echo "→ copying operator prompts → sidecar/prompts"
  cp -a "$WEB_DIR/prompts" "$SIDECAR_DIR/prompts"
fi

# Desktop-install integration (Phase 1 of
# desktop-app-install-integration-2026-05-23) reads two files at runtime
# and copies them into ~/.papercusp/: the engineer-collaborator playbook
# and the omp coord extension. The playbook lives under prompts/ (above),
# but the coord extension is under apps/operator/scripts/hooks/omp/.
# esbuild doesn't trace it (read via fs.readFile path), so copy
# explicitly, preserving the apps/operator/scripts/hooks/omp/ layout
# that lib/desktop-install/papercusp-files.ts expects.
COORD_HOOK_SRC="$WEB_DIR/scripts/hooks/omp/coord-hook.ts"
if [[ -f "$COORD_HOOK_SRC" ]]; then
  COORD_HOOK_DST="$SIDECAR_DIR/apps/operator/scripts/hooks/omp/coord-hook.ts"
  echo "→ copying omp coord-hook → sidecar/apps/operator/scripts/hooks/omp/"
  mkdir -p "$(dirname "$COORD_HOOK_DST")"
  cp -a "$COORD_HOOK_SRC" "$COORD_HOOK_DST"
fi

# Same reason: lib/desktop-install/papercusp-files.ts resolves the
# playbook source via <operatorAppRoot>/prompts/papercusp-su.tools.md.
# In production the operator app root lives at sidecar/apps/operator/,
# so the playbook must be available there too (the sidecar/prompts/
# copy above is for other endpoint-route handlers with a different
# expectation).
PLAYBOOK_SRC="$WEB_DIR/prompts/papercusp-su.tools.md"
if [[ -f "$PLAYBOOK_SRC" ]]; then
  PLAYBOOK_DST="$SIDECAR_DIR/apps/operator/prompts/papercusp-su.tools.md"
  mkdir -p "$(dirname "$PLAYBOOK_DST")"
  cp -a "$PLAYBOOK_SRC" "$PLAYBOOK_DST"
fi

# Bundle the `papercup` CLI shim + greeting status script. Used by the
# native-console launcher (the "+" button in the chrome header) — the
# user's spawned terminal runs `papercup status` before exec'ing their
# shell. Next.js standalone build doesn't include apps/operator/scripts/
# (not imported by any route), so we copy them explicitly.
#
# Lives in `sidecar/bin/` so Tauri's existing PATH-prepend
# (sidecar/bin → child PATH) makes `papercup` discoverable without
# absolute paths in the launcher one-liner.
PAPERCUP_SCRIPTS_SRC="$WEB_DIR/scripts"
PAPERCUP_BIN_DST="$SIDECAR_DIR/bin"
if [[ -f "$PAPERCUP_SCRIPTS_SRC/papercup" && -f "$PAPERCUP_SCRIPTS_SRC/papercup-status.mjs" ]]; then
  echo "→ copying papercup CLI shim → $PAPERCUP_BIN_DST"
  mkdir -p "$PAPERCUP_BIN_DST"
  cp -a "$PAPERCUP_SCRIPTS_SRC/papercup" "$PAPERCUP_BIN_DST/papercup"
  cp -a "$PAPERCUP_SCRIPTS_SRC/papercup-status.mjs" "$PAPERCUP_BIN_DST/papercup-status.mjs"
  chmod +x "$PAPERCUP_BIN_DST/papercup"
else
  echo "  ⚠ papercup shim source not found at $PAPERCUP_SCRIPTS_SRC; native console greeting will degrade"
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

# Sanity-check the artifacts the orchestrator actually needs.
# (run.sh was retired — see harness commit 4b7e162 "retire run.sh — the TS
# orchestrator is the only driver"; the iteration driver is now
# @papercusp/orchestrator, so the legacy run.sh is no longer bundled.)
for required in prompts templates; do
  if [[ ! -e "$HARNESS_DST/$required" ]]; then
    echo "ERROR: harness bundle missing $required at $HARNESS_DST"
    exit 1
  fi
done
find "$HARNESS_DST/bin" -type f -name "*.sh" -exec chmod +x {} \; 2>/dev/null || true

# Bundle the embedded-postgres-server (real PG with logical replication
# enabled, so Zero / pgoutput consumers can subscribe). This is the
# preferred desktop DB as of 2026-05-05; pglite-server is still bundled
# below for legacy fallback (PAPERCUSP_USE_EMBEDDED_PG=0). Tauri main
# selects which one to spawn.
EMBEDDED_PG_SRC="$PAPERCUSP_ROOT/packages/embedded-postgres-server"
EMBEDDED_PG_DST="$SIDECAR_DIR/embedded-postgres-server"
echo "→ bundling embedded-postgres-server"
if [[ ! -d "$EMBEDDED_PG_SRC" ]]; then
  echo "ERROR: @restart/embedded-postgres-server not found at $EMBEDDED_PG_SRC"
  exit 1
fi
mkdir -p "$EMBEDDED_PG_DST"
cp "$EMBEDDED_PG_SRC/package.json" "$EMBEDDED_PG_DST/"
cp -a "$EMBEDDED_PG_SRC/src" "$EMBEDDED_PG_DST/"
cp -a "$EMBEDDED_PG_SRC/bin" "$EMBEDDED_PG_DST/"
chmod +x "$EMBEDDED_PG_DST/bin/embedded-postgres-server.mjs"
# Install embedded-postgres + postgres-js. embedded-postgres pulls platform
# binaries (~60-150MB per arch) — npm picks the right @embedded-postgres/<plat>
# package automatically based on the build host's platform. For
# cross-platform releases, run this script once per target platform.
echo "→ installing embedded-postgres-server runtime deps into the bundle (~60-150MB binary download)"
( cd "$EMBEDDED_PG_DST" && npm install --omit=dev --no-workspaces --legacy-peer-deps --silent ) || {
  echo "ERROR: failed to install embedded-postgres-server runtime deps"
  exit 1
}
# Sanity check: must have at least one @embedded-postgres/<platform> binary pkg
if ! ls "$EMBEDDED_PG_DST/node_modules/@embedded-postgres" 2>/dev/null | grep -q .; then
  echo "ERROR: bundled embedded-postgres missing platform binary — node_modules install didn't include @embedded-postgres/*"
  exit 1
fi

# Bundle pgvector into the embedded-postgres binary tree, per platform.
# Without this, mem0's vector store falls back to in-process memory
# (volatile across restarts). The embedded-postgres binaries from zonky
# ship server-only — no extensions beyond plpgsql — so we source pgvector
# from a system install on the build host and copy it into the bundle.
#
# Platform sources:
#   Linux (Ubuntu/Debian): apt install postgresql-18-pgvector
#                          → /usr/lib/postgresql/18/lib/vector.so
#                            /usr/share/postgresql/18/extension/vector*
#   macOS (Homebrew):      brew install pgvector (against postgresql@18)
#                          → $(brew --prefix)/lib/postgresql/vector.dylib
#                            $(brew --prefix)/share/postgresql@18/extension/vector*
#   Windows:               No automation yet; we warn and continue. mem0
#                          falls back to in-memory provider on Windows
#                          desktops until a vector.dll is bundled.
echo "→ bundling pgvector into embedded-postgres (per platform)"
pgvector_copied=0
# Compute platform locally — target_os is computed later in this script.
case "$(uname -s)" in
  Linux*)               _pgv_os="linux" ;;
  Darwin*)              _pgv_os="darwin" ;;
  MINGW*|MSYS*|CYGWIN*) _pgv_os="windows" ;;
  *)                    _pgv_os="$(uname -s)" ;;
esac
case "$_pgv_os" in
  linux)
    pgv_lib_src="/usr/lib/postgresql/18/lib/vector.so"
    pgv_ext_src="/usr/share/postgresql/18/extension"
    pgv_lib_ext="so"
    ;;
  darwin)
    if command -v brew >/dev/null 2>&1; then
      brew_prefix="$(brew --prefix 2>/dev/null)"
      pgv_lib_src="$brew_prefix/lib/postgresql/vector.dylib"
      pgv_ext_src="$brew_prefix/share/postgresql@18/extension"
      if [[ ! -f "$pgv_lib_src" ]] && pg_prefix=$(brew --prefix postgresql@18 2>/dev/null); then
        pgv_lib_src="$pg_prefix/lib/postgresql/vector.dylib"
        pgv_ext_src="$pg_prefix/share/postgresql@18/extension"
      fi
      pgv_lib_ext="dylib"
    fi
    ;;
  windows)
    echo "  ⚠ pgvector not bundled on Windows (no automated source); mem0 will use in-memory fallback on Windows desktops"
    pgv_lib_src=""
    ;;
esac

if [[ -n "${pgv_lib_src:-}" ]]; then
  if [[ -f "$pgv_lib_src" && -d "$pgv_ext_src" ]]; then
    for plat_dir in "$EMBEDDED_PG_DST/node_modules/@embedded-postgres"/*/native; do
      [[ -d "$plat_dir" ]] || continue
      mkdir -p "$plat_dir/lib/postgresql" "$plat_dir/share/postgresql/extension"
      cp -u "$pgv_lib_src" "$plat_dir/lib/postgresql/"
      cp -u "$pgv_ext_src"/vector*.sql "$plat_dir/share/postgresql/extension/"
      cp -u "$pgv_ext_src/vector.control" "$plat_dir/share/postgresql/extension/"
      pgvector_copied=$((pgvector_copied + 1))
    done
    echo "  ✓ pgvector copied into $pgvector_copied embedded-postgres tree(s) (lib.${pgv_lib_ext} + sql + control)"
  else
    echo "  ⚠ pgvector not found at $pgv_lib_src (build host missing pgvector); mem0 will use in-memory fallback"
    case "$_pgv_os" in
      linux)  echo "    Install: sudo apt install postgresql-18-pgvector" ;;
      darwin) echo "    Install: brew install pgvector  (requires postgresql@18 keg)" ;;
    esac
  fi
fi

# Surface real pg_dump / psql to the sidecar's $PATH so the snapshot
# subsystem (libs/papercusp-export-state/src/pg-dump.ts) finds them.
# Replaces the legacy WASM-pg_dump path that went through pglite-server's
# /admin/pg-dump endpoint.
#
# IMPORTANT: zonky's embedded-postgres-binaries (what `embedded-postgres`
# wraps) ships SERVER-only — initdb, pg_ctl, postgres. Client tools
# (pg_dump, psql, pg_dumpall) are stripped to keep size small (~60MB
# instead of ~200MB). So we can't symlink from the embedded distribution
# alone; we have to source the client tools elsewhere. Strategy:
#   1. If an embedded copy exists for the tool → use it.
#   2. Otherwise, copy from the build host's system PATH.
#   3. If neither: HARD FAIL — snapshot capture would be broken on the
#      shipped bundle. Don't silently produce a broken release.
mkdir -p "$SIDECAR_DIR/bin"
EMBEDDED_PG_BIN_DIR=""
for plat in "$EMBEDDED_PG_DST/node_modules/@embedded-postgres"/*/native/bin; do
  if [[ -d "$plat" ]]; then
    EMBEDDED_PG_BIN_DIR="$plat"
    break
  fi
done
if [[ -z "$EMBEDDED_PG_BIN_DIR" ]]; then
  echo "ERROR: could not find native/bin directory inside @embedded-postgres/*"
  exit 1
fi
echo "→ wiring pg_dump / psql / pg_dumpall into $SIDECAR_DIR/bin/"
SOURCE_NOTE_FILE="$SIDECAR_DIR/bin/.pg-tools-source"
> "$SOURCE_NOTE_FILE"
for tool in pg_dump psql pg_dumpall pg_restore; do
  src=""
  if [[ -x "$EMBEDDED_PG_BIN_DIR/$tool" ]]; then
    src="$EMBEDDED_PG_BIN_DIR/$tool"
    method="symlink (from embedded-postgres)"
  elif system_path=$(command -v "$tool" 2>/dev/null) && [[ -n "$system_path" ]]; then
    src="$system_path"
    method="copy (from system PATH)"
  fi
  if [[ -z "$src" ]]; then
    echo "ERROR: $tool not found in embedded-postgres distribution AND not on system PATH"
    echo "  embedded-postgres ships server-only (initdb, pg_ctl, postgres). The build"
    echo "  host needs PostgreSQL client tools installed for the snapshot subsystem"
    echo "  to work in the bundled desktop app. Install via:"
    echo "    macOS:   brew install libpq && brew link --force libpq"
    echo "    Ubuntu:  apt-get install postgresql-client"
    echo "    Windows: install PostgreSQL from postgresql.org"
    exit 1
  fi
  case "$method" in
    symlink*) ln -sfn "$src" "$SIDECAR_DIR/bin/$tool" ;;
    copy*)    cp -L "$src" "$SIDECAR_DIR/bin/$tool"; chmod +x "$SIDECAR_DIR/bin/$tool" ;;
  esac
  echo "  $tool: $method ($src)"
  echo "$tool: $method ($src)" >> "$SOURCE_NOTE_FILE"
done
# Sanity-check that the bundled binary actually runs
if ! "$SIDECAR_DIR/bin/pg_dump" --version >/dev/null 2>&1; then
  echo "ERROR: bundled pg_dump fails --version probe; the binary is not loadable on this host"
  echo "  This usually means dynamic library mismatch (e.g. system libpq from a different"
  echo "  PG major version). Resolve by either:"
  echo "    - building on a host with PG 17/18 client tools matching the server,"
  echo "    - or vendoring libpq alongside (out of scope for this script)."
  exit 1
fi
echo "  pg_dump probe: $("$SIDECAR_DIR/bin/pg_dump" --version)"

# Bundle zero-cache-server (Rocicorp Zero's WebSocket sync server). Boots
# against embedded-postgres after migrations apply, exposes WS that the
# operator's HarnessZeroProvider connects to. Without this bundled, the
# desktop falls back to polling — same UX as today, just slower.
ZERO_CACHE_SRC="$PAPERCUSP_ROOT/packages/zero-cache-server"
ZERO_CACHE_DST="$SIDECAR_DIR/zero-cache-server"
echo "→ bundling zero-cache-server"
if [[ ! -d "$ZERO_CACHE_SRC" ]]; then
  echo "ERROR: @restart/zero-cache-server not found at $ZERO_CACHE_SRC"
  exit 1
fi
mkdir -p "$ZERO_CACHE_DST"
cp "$ZERO_CACHE_SRC/package.json" "$ZERO_CACHE_DST/"
cp -a "$ZERO_CACHE_SRC/src" "$ZERO_CACHE_DST/"
cp -a "$ZERO_CACHE_SRC/bin" "$ZERO_CACHE_DST/"
chmod +x "$ZERO_CACHE_DST/bin/zero-cache-server.mjs"
echo "→ installing zero-cache-server runtime deps (~50MB @rocicorp/zero)"
( cd "$ZERO_CACHE_DST" && npm install --omit=dev --no-workspaces --legacy-peer-deps --silent ) || {
  echo "ERROR: failed to install zero-cache-server runtime deps"
  exit 1
}
if [[ ! -x "$ZERO_CACHE_DST/node_modules/.bin/zero-cache" ]]; then
  echo "ERROR: bundled zero-cache binary missing"
  exit 1
fi

# Bundle the legacy pglite-server. Kept as a fallback path
# (PAPERCUSP_USE_EMBEDDED_PG=0 → falls back to pglite-server). Will be
# removed once embedded-postgres-server is validated in production.
PGLITE_SRC="$PAPERCUSP_ROOT/packages/pglite-server"
PGLITE_DST="$SIDECAR_DIR/pglite-server"
echo "→ bundling pglite-server (legacy fallback)"
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
# pglite-tools (WASM pg_dump for the legacy pglite-server /admin/pg-dump
# path) is now optional — the embedded-postgres path supplies a real
# pg_dump on PATH, so snapshot capture works there without it. Warn if
# missing so users opting back into the pglite fallback get a useful
# diagnostic if snapshots fail; don't HARD-fail the build.
if [[ ! -d "$PGLITE_DST/node_modules/@electric-sql/pglite-tools" ]]; then
  echo "WARN: bundled pglite-tools missing — pglite fallback won't have snapshot capture"
  echo "      (the embedded-postgres path uses real pg_dump from sidecar/bin/, so this only matters if PAPERCUSP_USE_EMBEDDED_PG=0)"
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

# meridian — routes omp/pi through the user's Claude Max subscription.
# Bundled at build time so the user doesn't need npm-i it; its
# transitive dep @anthropic-ai/claude-code (closed-source, Commercial
# ToS) is stripped here and re-installed at first launch by the
# desktop's Rust startup. This keeps redistribution clean while still
# giving users a one-double-click experience after a brief first-run
# install (~30s on a fast link).
MERIDIAN_VERSION="${MERIDIAN_VERSION:-1.42.1}"
MERIDIAN_DIR="$SIDECAR_DIR/meridian-host"
echo "→ bundling meridian @rynfar/meridian@$MERIDIAN_VERSION → $MERIDIAN_DIR"
mkdir -p "$MERIDIAN_DIR"
cat > "$MERIDIAN_DIR/package.json" <<JSON
{
  "name": "papercusp-meridian-host",
  "version": "0.0.0",
  "private": true,
  "dependencies": { "@rynfar/meridian": "$MERIDIAN_VERSION" }
}
JSON
if (cd "$MERIDIAN_DIR" && npm install --no-package-lock --omit=dev --silent 2>&1 | tail -5); then
  # Strip closed-source claude-code from the bundle. First-launch
  # install on the user's machine pulls it from the official npm
  # registry (Anthropic-published) into the same node_modules tree, so
  # the require() path resolves identically.
  rm -rf "$MERIDIAN_DIR/node_modules/@anthropic-ai/claude-code"
  rm -rf "$MERIDIAN_DIR/node_modules/@anthropic-ai/claude-agent-sdk"
  # Tauri's resource bundler enumerates all files at config-time. The
  # claude-code .bin symlink (`meridian-host/node_modules/.bin/claude`)
  # is referenced by tauri.conf.json — without a placeholder, cargo
  # check fails with "resource path doesn't exist". Stub it here so
  # bundling succeeds; first-launch install (handled by Rust startup)
  # overwrites with the real binary.
  # Replace dangling .bin symlinks with stubs (tauri's resource bundler
  # validates symlink targets — dangles fail cargo check). The first-
  # launch installer overwrites them with real binaries.
  mkdir -p "$MERIDIAN_DIR/node_modules/.bin"
  for stub_name in claude anthropic-ai-sdk; do
    rm -f "$MERIDIAN_DIR/node_modules/.bin/$stub_name"
    cat > "$MERIDIAN_DIR/node_modules/.bin/$stub_name" <<'STUB'
#!/usr/bin/env sh
echo "claude-code is being installed on first launch — please wait, then retry." >&2
exit 1
STUB
    chmod +x "$MERIDIAN_DIR/node_modules/.bin/$stub_name"
  done
  meridian_size=$(du -sh "$MERIDIAN_DIR" 2>/dev/null | awk '{print $1}')
  echo "  ✓ meridian bundled ($meridian_size; claude-code deferred to first launch)"
else
  echo "  ⚠ failed to npm-install meridian; AI agent routing will require user-installed meridian"
  rm -rf "$MERIDIAN_DIR"
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

# Strip embedded-postgres language extensions that link to system libs we
# don't ship (libpython3.6, libperl5.26, libtcl). These are PL/Python,
# PL/Perl, PL/Tcl — none of which Papercusp uses. linuxdeploy walks every
# ELF in the sidecar during AppImage bundling and bails on missing libs.
# IMPORTANT: only strip plperl/plpython/pltcl — DO NOT strip plpgsql,
# which is the default procedural language and required for ANY pgdata
# initdb (FATAL: extension "plpgsql" is not available).
echo "→ stripping unused PL/* extensions (plperl, plpython, pltcl) from embedded-postgres"
pl_count=0
for ext_dir in "$EMBEDDED_PG_DST/node_modules/@embedded-postgres"/*/native/share/postgresql/extension; do
  [[ -d "$ext_dir" ]] || continue
  for f in "$ext_dir"/plperl* "$ext_dir"/plpython* "$ext_dir"/pltcl*; do
    [[ -e "$f" ]] || continue
    rm -f "$f"
    pl_count=$((pl_count + 1))
  done
done
for lib_dir in "$EMBEDDED_PG_DST/node_modules/@embedded-postgres"/*/native/lib/postgresql; do
  [[ -d "$lib_dir" ]] || continue
  for f in "$lib_dir"/plperl* "$lib_dir"/plpython* "$lib_dir"/pltcl*; do
    [[ -e "$f" ]] || continue
    rm -f "$f"
    pl_count=$((pl_count + 1))
  done
done
echo "  removed $pl_count PL/* extension files (plpgsql preserved)"

# Strip musl-libc native binary variants. npm pulls these in as optional
# deps (e.g. @img/sharp-linuxmusl-*, @lydell/node-pty-linuxmusl-*) alongside
# the glibc variants, intended for Alpine. Our AppImage targets glibc, so
# these are dead weight AND they break linuxdeploy: it walks every ELF and
# tries to resolve its deps, but `libc.musl-x86_64.so.1` doesn't exist on
# the glibc runner, so AppImage bundling aborts with:
#   ERROR: Could not find dependency: libc.musl-x86_64.so.1
#   ERROR: Failed to deploy dependencies for existing files
#   Error [tauri_cli] failed to bundle project
# Documented in the AppImage debug arc 2026-05-01.
echo "→ stripping musl-libc native binary variants (incompatible with glibc AppImage)"
musl_dirs=$(find "$SIDECAR_DIR" -type d \( -name "*-linuxmusl-*" -o -name "*-linuxmusl" \) 2>/dev/null)
if [[ -n "$musl_dirs" ]]; then
  while IFS= read -r d; do
    echo "  ✗ removing $d"
    rm -rf "$d"
  done <<< "$musl_dirs"
else
  echo "  (none found)"
fi

# Bake a seed dump (Part 2 — build-time data sync to Mac/Windows).
#
# When PAPERCUSP_SEED_PG_URL is set, pg_dump that DB into sidecar/seed.dump.
# On first launch in a fresh install, the desktop's Rust main detects an
# empty data dir AND the presence of seed.dump, then runs pg_restore so
# the user's Mac/Windows install starts with the same data as Linux at
# build time.
#
# Typical invocation:
#   PAPERCUSP_SEED_PG_URL=$(jq -r .url ~/.papercusp/embedded-pg.json) \
#     bin/build-desktop-sidecar.sh
#
# When PAPERCUSP_SEED_PG_URL is unset, the seed step is skipped entirely
# and the resulting bundle behaves like before (empty PG on first boot,
# only schema applied via migrations).
if [[ -n "${PAPERCUSP_SEED_PG_URL:-}" ]]; then
  echo "→ baking seed.dump from $PAPERCUSP_SEED_PG_URL"
  # --no-owner / --no-acl keep the dump portable across PG roles (the
  # restored DB owns rows as harness_admin, regardless of source owner).
  # --no-publications skips zero_harness publication (recreated by the
  # embedded-pg-server's startup code, post-migrations).
  # Custom format (-F c) is compressed and supports parallel restore.
  if "$SIDECAR_DIR/bin/pg_dump" \
        -d "$PAPERCUSP_SEED_PG_URL" \
        -F c --no-owner --no-acl --no-publications --no-subscriptions \
        --exclude-schema='_zero_*' --exclude-schema='zero_0*' \
        -f "$SIDECAR_DIR/seed.dump" 2>&1; then
    seed_size=$(du -h "$SIDECAR_DIR/seed.dump" | awk '{print $1}')
    echo "  ✓ seed.dump baked ($seed_size)"
  else
    echo "  ⚠ pg_dump failed; bundle will ship without seed (fresh installs start empty)"
    rm -f "$SIDECAR_DIR/seed.dump"
  fi
else
  if [[ -f "$SIDECAR_DIR/seed.dump" ]]; then
    seed_size=$(du -h "$SIDECAR_DIR/seed.dump" | awk '{print $1}')
    echo "→ no PAPERCUSP_SEED_PG_URL set; reusing existing seed.dump ($seed_size)"
    echo "  (this is the cross-platform path: bake on Linux once, rsync to Mac/Win,"
    echo "   then run this script without the env var so the pre-baked dump survives.)"
  else
    echo "→ no PAPERCUSP_SEED_PG_URL set and no existing seed.dump; bundle will boot empty"
  fi
fi

# Compute size
total_size=$(du -sh "$SIDECAR_DIR" 2>/dev/null | awk '{print $1}')
echo "✓ sidecar built at $SIDECAR_DIR ($total_size)"
