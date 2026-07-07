#!/usr/bin/env bash
# Build the Node sidecar that the Papercusp desktop app bundles.
#
# Strategy (post operator-vite migration, Phase F3/G4; entry swapped to
# `serve` by SP1 C5): the operator UI is the Vite SPA (apps/operator-vite),
# and the SPA + /api/* + /internal/docs/* are served by a single-process Hono
# host. The boot entry is `apps/operator/bin/serve.ts` — the headless
# operator orchestrator that ALSO owns embedded Postgres (start, migrations,
# ~/.papercusp/embedded-pg.json) and writes ~/.papercusp/operator.json
# discovery. This script `vite build`s the SPA and esbuild-bundles serve into
# papercusp-desktop/src-tauri/sidecar/, which Tauri's bundler picks up as a
# resource (declared in tauri.conf.json `resources`). Tauri main.rs spawns
# `node sidecar/serve.mjs --ensure`.
#
# The bundled sidecar is self-contained: serve.mjs has every inlinable module
# bundled in; only genuinely-native deps (node-pty, the holepunch stack) and
# the embedded-postgres-server package (PG binaries resolve off its real
# package dir) ship as node_modules.

set -euo pipefail

# Multi-repo layout (post phase-c split). The desktop bundle pulls from
# two sibling clones:
#
#   Papercusp/papercusp-desktop   ← this repo (HERE = bin/)
#   Papercusp/papercup            ← contains apps/operator (Next.js UI)
#                                    AND libs/papercusp/ (submodule with
#                                    embedded-postgres-server, zero-cache-server,
#                                    harness, papercusp-mcp-server,
#                                    cli, orchestrator). The submodule is the
#                                    canonical post-phase-c location for these
#                                    packages — the old sibling-repo
#                                    Papercusp/papercusp clone is no longer
#                                    used by this script.
#
# Override locations with REPO_ROOT / PAPERCUSP_ROOT if your layout
# differs (e.g. CI clones into a flat workspace dir).

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
REPO_ROOT="${REPO_ROOT:-$ROOT/..}"
PAPERCUSP_ROOT="${PAPERCUSP_ROOT:-$REPO_ROOT/libs/papercusp}"
WEB_DIR="$REPO_ROOT/apps/operator"
SIDECAR_DIR="$ROOT/src-tauri/sidecar"

if [[ ! -d "$WEB_DIR" ]]; then
  echo "ERROR: papercup/apps/operator not found at $WEB_DIR"
  echo "       Set REPO_ROOT to the path of your Papercusp/papercup clone."
  exit 1
fi
if [[ ! -d "$PAPERCUSP_ROOT" ]]; then
  echo "ERROR: papercusp not found at $PAPERCUSP_ROOT"
  echo "       Set PAPERCUSP_ROOT to the path of your Papercusp/papercusp clone."
  exit 1
fi

# WI-2644: the packaged sidecar's serve.mjs runs standalone (no `npm run`
# context), so process.env.npm_package_version is unset at runtime and
# build-info.ts / serve.ts fall back to their (differing) hardcoded defaults
# — the installed app's /api/health + UI footer report a fake '0.0.0'/dev
# version instead of the real shipped one. tauri.conf.json's `version` is the
# authoritative shipped version (release.config.ts's versionFiles bumps
# package.json + tauri.conf.json + Cargo.toml together on every release), so
# read it here and bake it into the bundle via esbuild --define below —
# same mechanism as the existing PAPERCUP_DOGFOOD_REPO_REF bake.
PAPERCUSP_DESKTOP_VERSION="$(node -e "try{process.stdout.write(require('$ROOT/src-tauri/tauri.conf.json').version||'')}catch(e){}" 2>/dev/null)"
# Built as an array (not a bare --define string) so the UNREADABLE case omits
# the flag ENTIRELY rather than baking an empty string: `?? '0.0.0'`-style
# fallbacks only trigger on undefined/null, so `--define:...="\"\""` would bake
# a WORSE empty-string version than today's unset-env fallback.
VERSION_DEFINE_ARGS=()
if [[ -n "$PAPERCUSP_DESKTOP_VERSION" ]]; then
  VERSION_DEFINE_ARGS=(--define:process.env.npm_package_version="\"${PAPERCUSP_DESKTOP_VERSION}\"")
else
  echo "WARN: could not read version from $ROOT/src-tauri/tauri.conf.json — sidecar will report its unstamped fallback version"
fi

# ── EI-160: no concurrent-build clobber (P-056) ─────────────────────────────
# Two builds racing into the same live SIDECAR_DIR used to interleave
# rm -rf/cp — a reader (a running `tauri dev`, the federation smoke rigs)
# caught mid-swap saw a half-written bundle, and a second builder could
# truncate binaries the first was still copying. Serialize whole builds with
# flock, build into a temp sibling, and publish with an atomic rename at the
# very end so readers only ever see the complete old tree or the complete
# new tree.
SIDECAR_FINAL_DIR="$SIDECAR_DIR"
SIDECAR_TMP_DIR="$SIDECAR_FINAL_DIR.tmp.$$"
mkdir -p "$(dirname "$SIDECAR_FINAL_DIR")"
exec 9>"$SIDECAR_FINAL_DIR.lock"
SIDECAR_LOCKDIR=""
if command -v flock >/dev/null 2>&1; then
  if ! flock -n 9; then
    echo "→ another build-desktop-sidecar.sh holds $SIDECAR_FINAL_DIR.lock — waiting for it"
    flock 9
  fi
else
  # macOS ships no flock(1) — same EI-160 serialization via a mkdir
  # spinlock with stale-PID reclaim.
  SIDECAR_LOCKDIR="$SIDECAR_FINAL_DIR.lockdir"
  while ! mkdir "$SIDECAR_LOCKDIR" 2>/dev/null; do
    holder="$(cat "$SIDECAR_LOCKDIR/pid" 2>/dev/null || true)"
    if [[ -n "$holder" ]] && ! kill -0 "$holder" 2>/dev/null; then
      rm -rf "$SIDECAR_LOCKDIR"
      continue
    fi
    echo "→ another build-desktop-sidecar.sh holds $SIDECAR_LOCKDIR — waiting for it"
    sleep 5
  done
  echo "$$" > "$SIDECAR_LOCKDIR/pid"
fi
SIDECAR_DIR="$SIDECAR_TMP_DIR"
# Clean the temp tree (and the darwin lockdir) on any exit; after the
# publish rename the tmp half is a no-op.
trap 'rm -rf "$SIDECAR_TMP_DIR" ${SIDECAR_LOCKDIR:+"$SIDECAR_LOCKDIR"}' EXIT

# ---------------------------------------------------------------------------
# operator-vite migration (Phase F3 / G4). The desktop UI is no longer a
# Next.js app — it is the Vite SPA (apps/operator-vite) served, together
# with /api/* and /internal/docs/*, by the single-process Hono host
# (apps/operator/bin/hono-host.ts). So instead of `next build` →
# `.next/standalone`, this section:
#
#   1. installs operator + operator-vite deps,
#   2. `vite build`s the SPA → apps/operator-vite/dist/,
#   3. esbuild-bundles the serve entry into one ESM file (sidecar/serve.mjs),
#   4. copies the SPA, the Starlight docs, operator prompts, and the
#      externalized native deps (node-pty, embedded-postgres-server, …)
#      into the sidecar.
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
VITE_DIR="$REPO_ROOT/apps/operator-vite"
if [[ ! -d "$VITE_DIR" ]]; then
  echo "ERROR: apps/operator-vite not found at $VITE_DIR"
  exit 1
fi
echo "→ installing operator + operator-vite deps (ONE combined workspace install)"
# ROOT-CAUSE FIX (2026-07-07, WI-3284): this USED to be two SEPARATE
# `(cd apps/operator && npm install)` then `(cd apps/operator-vite && npm install)`
# calls. Each such directory-scoped install reconciles the shared root
# node_modules against ONLY that one workspace's OWN declared dependency graph
# and PRUNES anything not in it — so the SECOND call (operator-vite) silently
# stripped packages the FIRST call (operator) had just hoisted for itself,
# because npm's dependency graph only follows package.json "dependencies"
# edges, not Vite's `@` alias (which treats apps/operator/app/** as literal
# operator-vite source, not a package boundary). Every package reachable ONLY
# through that alias — @glideapps/glide-data-grid's peers (lodash / marked /
# react-responsive-carousel), @papercusp/lexicon, @udecode/plate-markdown,
# dockview (via @papercusp/dock-workbench) — has repeatedly broken `vite
# build` with "Rolldown failed to resolve <pkg>" this way. Patching
# apps/operator-vite/package.json one missing package at a time (the old
# glide-data-grid fix) does not scale — a NEW alias-reachable import from
# apps/operator always reopens the same hole.
# FIX: install BOTH workspaces in ONE npm call so npm reconciles against the
# UNION of their declared dependency graphs — nothing either one needs gets
# pruned, regardless of which one the vite alias actually resolves through.
(cd "$REPO_ROOT" && npm install --legacy-peer-deps --prefer-offline --no-audit --no-fund --ignore-scripts \
  --workspace=@papercusp/operator --workspace=@papercusp/operator-vite)

echo "→ verifying workspace deps resolved"
echo "  apps/operator/node_modules/@restart/ contents:"
ls -la "$WEB_DIR/node_modules/@restart" 2>&1 | head -10 || echo "(no @restart subdir)"
echo "  apps/operator/node_modules/@papercusp/ contents:"
ls -la "$WEB_DIR/node_modules/@papercusp" 2>&1 | head -10 || echo "(no @papercusp subdir)"

echo "→ building operator-vite SPA (vite build → dist/)"
(cd "$REPO_ROOT" && npm --workspace @papercusp/operator-vite run build)
if [[ ! -f "$VITE_DIR/dist/index.html" ]]; then
  echo "ERROR: expected $VITE_DIR/dist/index.html after the Vite build"
  exit 1
fi

echo "→ building sidecar into $SIDECAR_DIR (atomic publish to $SIDECAR_FINAL_DIR at the end)"
rm -rf "$SIDECAR_DIR"
mkdir -p "$SIDECAR_DIR" "$SIDECAR_DIR/node_modules/@lydell"

echo "→ esbuild-bundling the serve entry (headless operator boot) → $SIDECAR_DIR/serve.mjs"
# SP1 C5 (operator-core-headless-serve-2026-06-04, Decision F): the sidecar
# entry is now `bin/serve.ts` — the self-contained operator boot that OWNS
# embedded-PG (start, migrations, embedded-pg.json) and writes operator.json
# discovery. The Rust embedder spawns `serve.mjs --ensure` instead of the old
# host.mjs + a separate embedded-postgres-server process. serve imports the
# full host graph (host-handler/host-bootstrap), so the bundle recipe is the
# same as the old host.mjs one.
#
# ESM output: the host's import graph contains `import.meta.url` (a CJS
# bundle rejects it). ESM has no `__dirname`/`__filename`/`require`, so the
# banner re-creates them — the standard esbuild-ESM-for-Node recipe — for
# the bundled code + the externalized CJS deps below.
#
# node-pty (the pty-terminal routes) is the host's one hard native dep —
# it loads a platform .node binary and cannot be inlined. Keep the list in
# sync if a future host route pulls in another native/.wasm package (see
# the FIRST-BUILD NOTE above).
# `const module/exports`: some bundled files use the CJS `if (require.main ===
# module)` CLI-guard idiom (e.g. bin/audit-memory-anchors.ts). In an ESM bundle
# `module` is undefined → ReferenceError at host.mjs load. Define a dummy
# `module` (an object, so `require.main === module` is always false → the CLI
# guard body is skipped, which is correct — it is not the entrypoint) + a
# matching `exports`.
HOST_BANNER="import{createRequire as __pcr}from'module';import{fileURLToPath as __pftu}from'url';import{dirname as __pdn}from'path';const require=__pcr(import.meta.url);const __filename=__pftu(import.meta.url);const __dirname=__pdn(__filename);const module={exports:{}};const exports=module.exports;"
# Native (.node-addon) packages esbuild cannot inline — they load a platform
# binary via node-gyp-build / bare's `require.addon`, which only resolves
# relative to the real package dir. Inlining them makes host.mjs crash at LOAD
# with "Cannot find addon" (observed: sodium-native). node-pty (@lydell) is the
# pty dep; the rest are the hypercore/holepunch "dogfood substrate" P2P stack,
# eagerly imported by the orchestrator-claim + harness + dogfood-substrate
# routes. Each is externalized here AND copied (with prebuilds/) into the
# bundle below. Over-shipping an unused one is harmless; a missing required one
# crashes the boot.
NATIVE_PKGS=(
  sodium-native udx-native rocksdb-native quickbit-native rabin-native
  simdle-native fs-native-extensions
  bare-fs bare-os bare-url bare-inspect bare-type
  # better-sqlite3 — REQUIRED addon (native-addon-preflight.ts DEFAULT_REQUIRED_ADDONS;
  # mem0's store). Loaded via dynamic require('better-sqlite3') (the boot preflight
  # test-load + mem0), so esbuild never sees it statically → it was neither inlined
  # nor copied, and the packaged operator FAILed the addon preflight at boot with
  # "Cannot find module 'better-sqlite3'" (2-machine release rig, EI-2634).
  # Externalize + closure-copy brings the package incl. its build/Release/
  # better_sqlite3.node binding + bindings/prebuild-install — same pattern as the
  # natives above. (shared-hive-public-release-2026-06-22 BUG-2.)
  better-sqlite3
  # ssh2 — its optional sshcrypto.node accel binding only EXISTS where
  # node-gyp could build it (the mac VM has Xcode; the linux box doesn't
  # compile it), and esbuild has no .node loader → mac-only bundle error.
  # Externalize + closure-copy (asn1, bcrypt-pbkdf) like the other natives;
  # its in-tree try/catch handles an absent binding at runtime.
  ssh2
)
HOST_EXTERNALS=(
  --external:@lydell/*
  --external:bufferutil
  --external:utf-8-validate
  --external:fsevents
  # cpu-features — OPTIONAL native dep of ssh2 (required inside try/catch; ssh2
  # falls back cleanly when the require fails). Its build/Release/*.node binding
  # comes and goes with node_modules churn (node-gyp can't rebuild it under
  # modern Python — distutils removed), so bundling it makes the sidecar build
  # flaky. Externalize: present → loads; absent → ssh2's catch handles it.
  --external:cpu-features
  # @embedded-postgres/<platform> — `embedded-postgres/dist/binary.js` does
  # `import('@embedded-postgres/<plat>')` for EVERY platform, but only the host's
  # own (linux-x64) is installed, so esbuild can't resolve the others and the
  # bundle fails. Externalize ONLY the non-host platforms; linux-x64 MUST stay
  # bundled — host.mjs imports it at runtime (the operator's embedded-PG discovery
  # path), and externalizing it makes host.mjs crash at boot with
  # ERR_MODULE_NOT_FOUND (it's not resolvable next to the standalone host.mjs).
  --external:@embedded-postgres/darwin-arm64
  --external:@embedded-postgres/darwin-x64
  --external:@embedded-postgres/linux-arm
  --external:@embedded-postgres/linux-arm64
  --external:@embedded-postgres/linux-ia32
  --external:@embedded-postgres/linux-ppc64
  --external:@embedded-postgres/windows-x64
  # SP1 C5: serve starts embedded PG IN-PROCESS via this package. It must be
  # externalized — its PG binary paths resolve off the real package dir
  # (@embedded-postgres/<plat>/dist/index.js uses import.meta.url), which an
  # inlined bundle would break. The real package (with its node_modules incl.
  # the platform binaries) ships at sidecar/node_modules/@papercusp/
  # embedded-postgres-server below, where bare-specifier resolution from
  # serve.mjs finds it.
  --external:@papercusp/embedded-postgres-server
  # @opentelemetry/* SDK packages — @dbos-inc/dbos-sdk lazily require()s these
  # at RUNTIME (telemetry/traces.js installTraceContextManager + exporters.js)
  # and ONLY behind `if (globalParams.tracingEnabled)` / a configured OTLP
  # exporter. The operator never enables DBOS OTLP tracing, so that require
  # path is dead at runtime. They are NOT installed (only @opentelemetry/api +
  # semantic-conventions are — those resolve + bundle fine), so without these
  # externals esbuild hard-fails "Could not resolve" and the sidecar build dies
  # (blocked every .deb build on staging HEAD, 2026-06-22). Externalize them —
  # same pattern as cpu-features above: the guarded require never runs, so an
  # absent module is harmless. If DBOS OTLP tracing is ever enabled in the
  # bundled sidecar, install these as real deps instead of externalizing.
  # (shared-hive-public-release-2026-06-22 P0 build-integrity fix.)
  --external:@opentelemetry/context-async-hooks
  --external:@opentelemetry/core
  --external:@opentelemetry/resources
  --external:@opentelemetry/sdk-trace-base
  --external:@opentelemetry/sdk-trace-node
  --external:@opentelemetry/sdk-logs
  --external:@opentelemetry/sdk-metrics
  --external:@opentelemetry/exporter-trace-otlp-proto
  --external:@opentelemetry/exporter-logs-otlp-proto
  --external:@opentelemetry/exporter-metrics-otlp-proto
)
for np in "${NATIVE_PKGS[@]}"; do HOST_EXTERNALS+=( "--external:$np" ); done
# esbuild pinned to 0.25.x — the repo's hoisted esbuild is 0.17.x, which
# predates `with { type: 'json' }` import-attribute support (the host graph
# imports a plugin JSON schema that way). Verified 2026-05-21: 0.25.0
# bundles the full host graph clean (17.5MB host.mjs, valid ESM) with the
# externals below — esbuild inlines workspace + hoisted deps alike, so the
# monorepo dep-hoist is a non-issue.
# --define:__PAPERCUSP_BUNDLED_SIDECAR__=true (EI-650): in this single-file
# bundle EVERY inlined module shares ONE import.meta.url (serve.mjs's own),
# which equals process.argv[1] — so a library-CLI's naive self-exec guard
# (`import.meta.url === pathToFileURL(process.argv[1]).href` and the
# `file://${process.argv[1]}` / `fileURLToPath(import.meta.url) === argv[1]`
# spellings) fires for EVERY bundled CLI at boot, each running main()+
# process.exit() and killing the operator before it serves. The CJS
# `require.main === module` idiom is already neutralised by the dummy `module`
# in HOST_BANNER; this define is the symmetric fix for the ESM idiom — library
# CLIs guard with isCliEntry() (operator-core/lib/util/cli-entry.ts), which
# returns false when this define is present, so only the real entry (serve.ts,
# which does NOT use the helper) boots.
# --define:process.env.PAPERCUP_DOGFOOD_REPO_REF (clone-progress + version-pin):
# bake the release's monorepo ref so the shipped app's `papercusp` dogfood hive
# clones the EXACT version the binary was built from (bootstrap-papercusp-hive's
# dogfoodRef() reads process.env.PAPERCUP_DOGFOOD_REPO_REF). release-local.sh
# exports it (= the release tag) + tags the monorepo. Unset (a plain dev sidecar
# build) bakes "" → the bootstrap falls back to the remote default branch (main).
# --define:process.env.npm_package_version (WI-2644): bake the real shipped
# version (read from tauri.conf.json above) so build-info.ts's health endpoint
# + serve.ts's own VERSION const report the actual installed version instead
# of their unset-env fallback ('0.0.0' / '0.1.0-dev'). Empty when unreadable
# (plain dev run outside this script) → both call sites keep their existing
# fallback, unchanged from today.
(cd "$WEB_DIR" && npx --yes esbuild@0.25.0 bin/serve.ts \
  --bundle --platform=node --format=esm --target=node22 \
  --outfile="$SIDECAR_DIR/serve.mjs" \
  --banner:js="$HOST_BANNER" \
  --define:__PAPERCUSP_BUNDLED_SIDECAR__=true \
  --define:process.env.PAPERCUP_DOGFOOD_REPO_REF="\"${PAPERCUP_DOGFOOD_REPO_REF:-}\"" \
  --define:process.env.PAPERCUP_DOGFOOD_HIVE_PUBKEY="\"${PAPERCUP_DOGFOOD_HIVE_PUBKEY:-}\"" \
  --define:process.env.PAPERCUP_DOGFOOD_HIVE_INVITE_SECRET="\"${PAPERCUP_DOGFOOD_HIVE_INVITE_SECRET:-}\"" \
  "${VERSION_DEFINE_ARGS[@]}" \
  "${HOST_EXTERNALS[@]}")
if [[ ! -f "$SIDECAR_DIR/serve.mjs" ]]; then
  echo "ERROR: esbuild did not produce $SIDECAR_DIR/serve.mjs"
  exit 1
fi

echo "→ esbuild-bundling packaged MCP proxy → $SIDECAR_DIR/mcp-proxy.mjs"
(cd "$WEB_DIR" && npx --yes esbuild@0.25.0 bin/mcp-proxy.ts \
  --bundle --platform=node --format=esm --target=node22 \
  --outfile="$SIDECAR_DIR/mcp-proxy.mjs" \
  --banner:js="$HOST_BANNER")
if [[ ! -f "$SIDECAR_DIR/mcp-proxy.mjs" ]]; then
  echo "ERROR: esbuild did not produce $SIDECAR_DIR/mcp-proxy.mjs"
  exit 1
fi

# psu + ptool — the superuser CLI launcher and the defineTool CLI. Ship them in
# the runtime so an end user can open a superuser agent session from the app
# (psu-in-desktop-builds-2026-06-23 A1). esbuild-bundles each into a
# SELF-CONTAINED ESM file the SAME way serve.mjs is built: @inquirer/prompts
# (the picker) and @modelcontextprotocol/sdk (ptool's transport) are inlined, so
# the shipped runtime needs NO operator node_modules tree for them. node-pty is
# the only external — psu-pty-host.mjs `require()`s @lydell/node-pty LAZILY (only
# on the pty-host path), so it resolves from sidecar/node_modules at runtime just
# like serve.mjs, and the common launch path never touches it.
#
# Two deliberate differences from the serve.mjs recipe:
#   * NO --define:__PAPERCUSP_BUNDLED_SIDECAR__=true. That define makes
#     isCliEntry() return false to stop inlined library-CLIs self-exec'ing inside
#     serve.mjs. psu/ptool ARE the real entrypoints — they MUST run main() when
#     invoked, so the define must be absent.
#   * Only --external:@lydell/* (psu/ptool don't pull the holepunch native stack).
# The ~/.papercusp/bin/{psu,ptool} shims that `exec node` these are written on
# boot by installPapercuspFiles() (papercup CLAUDE.md desktop-install path; A2).
echo "→ esbuild-bundling psu + ptool + onboard + tutorial-runner → $SIDECAR_DIR/scripts/"
mkdir -p "$SIDECAR_DIR/scripts"
# pairs of <output-name>:<source-stem> (source lives at $WEB_DIR/scripts/<stem>.mjs)
# onboard = the onboarding/tutorial concierge (agent-first-onboarding P-014):
# shipped so the deb postinst can expose `papercusp onboard|tutorial` + the
# Papercusp Tutorial desktop icon.
# tutorial-runner = the DETERMINISTIC tutorial the concierge launches at handoff
# (deterministic-onboarding-tutorial-2026-07-04 P-006/P-008). MUST ship next to
# onboard.mjs: the concierge resolves it via `new URL('./tutorial-runner.mjs',
# import.meta.url)`, so the output name MUST stay `tutorial-runner`. Without it a
# packaged build silently falls back to the agentic tutor.
for _psu_cli in psu:psu-launcher ptool:ptool onboard:onboard-launcher tutorial-runner:tutorial-runner; do
  _psu_out="${_psu_cli%%:*}"
  _psu_src="${_psu_cli##*:}"
  if [[ ! -f "$WEB_DIR/scripts/$_psu_src.mjs" ]]; then
    echo "ERROR: $WEB_DIR/scripts/$_psu_src.mjs not found — psu cannot ship"
    exit 1
  fi
  (cd "$WEB_DIR" && npx --yes esbuild@0.25.0 "scripts/$_psu_src.mjs" \
    --bundle --platform=node --format=esm --target=node22 \
    --outfile="$SIDECAR_DIR/scripts/$_psu_out.mjs" \
    --banner:js="$HOST_BANNER" \
    "--external:@lydell/*")
  if [[ ! -f "$SIDECAR_DIR/scripts/$_psu_out.mjs" ]]; then
    echo "ERROR: esbuild did not produce $SIDECAR_DIR/scripts/$_psu_out.mjs"
    exit 1
  fi
done
echo "  bundled psu.mjs + ptool.mjs + onboard.mjs + tutorial-runner.mjs"

# Copy the externalized native deps. esbuild inlined everything else, so
# this is a tiny tree — node-pty + its platform-binary sub-package(s).
# Search every node_modules the monorepo might have hoisted them into.
echo "→ copying externalized native deps (node-pty) into the sidecar"
npt_count=0
for base in "$WEB_DIR/node_modules" "$REPO_ROOT/node_modules" "$ROOT/node_modules"; do
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

# Copy the externalized hypercore/holepunch native packages — WITH their full
# runtime dependency closure (require-addon, streamx, b4a, compact-encoding, …)
# — into the bundle. esbuild inlines the host's own JS, but the externalized
# native packages resolve their deps from node_modules at runtime, so the whole
# closure must be present or host.mjs crashes ("Cannot find module
# 'require-addon'"). BFS each native package's package.json `dependencies`.
echo "→ copying externalized native deps + their dependency closure into the sidecar"
nat_copied=0; nat_missing=0
# Visited-set as a space-delimited string, NOT `declare -A` — macOS ships
# bash 3.2 (no associative arrays) and this script must run on the mac
# build VM (mac-desktop-release-readiness-2026-06-11).
_seen=" "
# The bare-*/holepunch native packages (bare-type, bare-fs, bare-os, …) ship
# npm-published prebuilds for EVERY platform they support — not just desktop
# (linux/darwin/win32) but android-{ia32,arm,arm64,x64} and ios-{arm64,x64}
# simulator variants too, each a real Android/iOS ELF/Mach-O binary. A plain
# `cp -a` brings all of them, which (a) bloats the sidecar ~13x over what one
# platform needs, and (b) breaks Linux AppImage bundling outright: linuxdeploy
# walks every ELF file under the AppDir resolving shared-library deps via ldd,
# and chokes on the Android prebuilds — `ERROR: Could not find dependency:
# libm.so` (Android's bionic libc has no standalone libm.so; the symbol is
# folded into libc.so) — which aborts the whole `tauri build --bundles
# appimage` (WI-807). Prune every closure-copied package's `prebuilds/`
# down to just this build host's platform-arch dir immediately after copying.
_bare_node_platform=""
case "$(uname -s)" in
  Linux*)               _bare_node_platform="linux" ;;
  Darwin*)              _bare_node_platform="darwin" ;;
  MINGW*|MSYS*|CYGWIN*) _bare_node_platform="win32" ;;
esac
_bare_node_arch=""
case "$(uname -m)" in
  x86_64|amd64)  _bare_node_arch="x64" ;;
  arm64|aarch64) _bare_node_arch="arm64" ;;
esac
prune_foreign_prebuilds() {
  local pkg_dir="$1"
  [[ -d "$pkg_dir/prebuilds" && -n "$_bare_node_platform" && -n "$_bare_node_arch" ]] || return 0
  local keep="${_bare_node_platform}-${_bare_node_arch}"
  local pd pd_name pruned=0
  for pd in "$pkg_dir/prebuilds"/*/; do
    [[ -d "$pd" ]] || continue
    pd_name="$(basename "$pd")"
    [[ "$pd_name" == "$keep" ]] && continue
    rm -rf "$pd"
    pruned=$((pruned+1))
  done
  [[ $pruned -gt 0 ]] && echo "  ✂ $(basename "$pkg_dir"): pruned $pruned foreign-platform prebuilds/ dir(s), kept $keep"
}
copy_pkg_closure() {
  local queue=("$1")
  while [[ ${#queue[@]} -gt 0 ]]; do
    local cur="${queue[0]}"; queue=("${queue[@]:1}")
    case "$_seen" in *" $cur "*) continue ;; esac
    _seen="${_seen}${cur} "
    [[ -e "$SIDECAR_DIR/node_modules/$cur" ]] && continue
    local src=""
    for base in "$WEB_DIR/node_modules" "$REPO_ROOT/node_modules" "$ROOT/node_modules"; do
      [[ -d "$base/$cur" ]] && { src="$base/$cur"; break; }
    done
    if [[ -z "$src" ]]; then
      echo "  ⚠ closure dep '$cur' not found in any node_modules"; nat_missing=$((nat_missing+1)); continue
    fi
    mkdir -p "$SIDECAR_DIR/node_modules/$(dirname "$cur")"
    cp -aL "$src" "$SIDECAR_DIR/node_modules/$cur"
    prune_foreign_prebuilds "$SIDECAR_DIR/node_modules/$cur"
    nat_copied=$((nat_copied+1))
    local deps; deps=$(node -e "try{const d=require('$src/package.json').dependencies||{};process.stdout.write(Object.keys(d).join(' '))}catch(e){}" 2>/dev/null)
    for d in $deps; do queue+=("$d"); done
  done
}
for np in "${NATIVE_PKGS[@]}"; do copy_pkg_closure "$np"; done
echo "  copied $nat_copied package(s) ($nat_missing missing)"

# rrule is loaded at runtime via `createRequire(import.meta.url)('rrule')` in
# operator-core/lib/harness/routines/schedule-next.ts (rrule's CJS build sets
# __esModule:true with NO `default`, so every static-import form diverges between
# the tsx dev host and the esbuild bundle — createRequire is the only form that
# works in both). esbuild can't see a dynamic createRequire, so it never inlines
# rrule, and it is pure-JS (not in NATIVE_PKGS) so it was never copied either —
# the bundled operator then crashed at boot with `Cannot find module 'rrule'`
# (EMBEDDED_PG_FAILED). Copy rrule + its dep closure (tslib) so the runtime
# createRequire('rrule') from sidecar/serve.mjs resolves.
echo "→ copying createRequire runtime dep rrule (+ closure) into the sidecar"
copy_pkg_closure rrule
echo "  rrule closure copied ($nat_copied total package(s), $nat_missing missing)"

# luxon — IDENTICAL createRequire gotcha as rrule above. schedule-next.ts loads
# `createRequire(import.meta.url)('luxon')` (DST-correct schedule math; landed
# 2026-06-17 in 5472dec3c, the scheduled-plans EI-1368/136 fixes — which did NOT
# add this copy line). esbuild can't see the dynamic createRequire, luxon is
# pure-JS (no deps, not in NATIVE_PKGS) so it was never copied → the packaged
# operator crashed at boot with `Cannot find module 'luxon'` (EMBEDDED_PG_FAILED),
# i.e. the .deb did not boot at all. Copy luxon so the runtime createRequire('luxon')
# from sidecar/serve.mjs resolves. (shared-hive-release-testing Lane A, A-001.)
echo "→ copying createRequire runtime dep luxon (+ closure) into the sidecar"
copy_pkg_closure luxon
echo "  luxon closure copied ($nat_copied total package(s), $nat_missing missing)"

# Static payloads the host serves. host-spa.ts / host-docs.ts resolve these
# from the PAPERCUSP_SPA_DIST / PAPERCUSP_DOCS_ROOT env vars Tauri main.rs
# sets — see those files' root-resolution comments.
echo "→ copying operator-vite/dist → sidecar/spa"
cp -a "$VITE_DIR/dist" "$SIDECAR_DIR/spa"
# WI-3172 / WI-3063 — trim dead weight from the copied SPA so the Windows payload
# clears the NSIS 4GiB datablock cap WITHOUT dropping the offline seed. The Vite
# dist is a wholesale copy of web/public, which bundles the whole Starlight site
# under dist/internal/docs — but /internal/docs/* is served by the DEDICATED
# docsRoutes (bin/host-docs.ts, from PAPERCUSP_DOCS_ROOT = sidecar/internal-docs),
# registered BEFORE the SPA catch-all (bin/host-spa.ts is the final `*` fallback).
# So spa/internal/docs is NEVER served — it's a 147MB byte-for-byte duplicate of
# sidecar/internal-docs. It also carries any stale `<name>.old.<pid>` dir the
# docs-sync atomic-swap (operator-docs postbuild-copy.sh) left un-reaped in
# public/internal/ (found live 2026-07-06: spa/internal/docs.old.2116786 = 146MB
# of pure garbage). Drop the duplicate + purge stale swap leftovers (~293MB).
rm -rf "$SIDECAR_DIR/spa/internal/docs"
find "$SIDECAR_DIR/spa" -depth -type d -name '*.old.[0-9]*' -prune -exec rm -rf {} + 2>/dev/null || true
echo "→ copying Starlight docs → sidecar/internal-docs"
if [[ -d "$WEB_DIR/public/internal/docs" ]]; then
  # WI-1998: public/internal/docs is a live docs-sync deploy target
  # (apps/operator-docs/scripts/postbuild-copy.sh) that republishes via an
  # atomic rename-swap, not an in-place mutation — so the window this `cp -a`
  # can lose to has shrunk from "however long a delete+rewrite mirror takes"
  # to "this cp -a happened to start/traverse during someone else's rename
  # swap", which is rare but not impossible for a multi-second recursive copy
  # racing a swap that can land at any instant. A swapped-out old tree isn't
  # reaped for a couple minutes (see postbuild-copy.sh), so a short retry
  # picks up either the (still-intact) pre-swap tree a moment earlier or the
  # (now-published) post-swap tree a moment later — either is a valid
  # complete docs tree; only the fraction-of-a-second window mid-swap fails.
  _docs_cp_attempts=5
  _docs_cp_ok=0
  for _docs_cp_try in $(seq 1 "$_docs_cp_attempts"); do
    rm -rf "$SIDECAR_DIR/internal-docs"
    if cp -a "$WEB_DIR/public/internal/docs" "$SIDECAR_DIR/internal-docs" 2>/tmp/docs-cp-err.$$; then
      _docs_cp_ok=1
      break
    fi
    echo "  ⚠ Starlight docs copy attempt $_docs_cp_try/$_docs_cp_attempts hit a live docs-sync republish race — retrying"
    cat /tmp/docs-cp-err.$$ >&2 || true
    rm -f /tmp/docs-cp-err.$$
    sleep 1
  done
  rm -f /tmp/docs-cp-err.$$
  if [[ "$_docs_cp_ok" -ne 1 ]]; then
    echo "ERROR: Starlight docs copy failed $_docs_cp_attempts times (persistent docs-sync race or a real fault, not a one-off) — aborting rather than shipping a partial/missing docs tree"
    exit 1
  fi
else
  echo "  ⚠ $WEB_DIR/public/internal/docs not found — /internal/docs/* will 404 in the bundle"
fi

# docs-qa retrieval grounding (2026-07-05). The tutorial/palette "Ask a question"
# (packages/operator-core/.../desktop/docs-qa.ts → @papercusp/docs-engine searchDocs)
# reads the SOURCE Starlight .mdx tree via _repo-paths.DOCS_CONTENT_ROOT — NOT the
# rendered public/internal/docs copied above. In a packaged sidecar, findRepoRoot()
# walks up from cwd (= the sidecar dir), finds no repo, and falls back to cwd, so
# DOCS_CONTENT_ROOT resolves to <sidecar>/apps/operator-docs/src/content/docs. Ship the
# source tree THERE so retrieveDocsContext returns real blocks and the answer is grounded
# (cites /internal/docs/...) instead of hallucinating. Without this the retrieval returns
# zero blocks in EVERY packaged install → the deflecting "I can't define that" answers the
# owner hit on 2026-07-05.
_docs_src="$WEB_DIR/../operator-docs/src/content/docs"
if [[ -d "$_docs_src" ]]; then
  echo "→ copying Starlight docs SOURCE tree → sidecar/apps/operator-docs/src/content/docs (docs-qa grounding)"
  mkdir -p "$SIDECAR_DIR/apps/operator-docs/src/content"
  rm -rf "$SIDECAR_DIR/apps/operator-docs/src/content/docs"
  cp -a "$_docs_src" "$SIDECAR_DIR/apps/operator-docs/src/content/docs"
else
  echo "  ⚠ $_docs_src not found — docs-qa (tutorial/palette Ask) will be UNGROUNDED in the bundle"
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

# Same reason: the Claude/Codex CC hooks (statusline-fleet + lock/coord/activity/
# lifecycle/objective-title/bash-gate/workitem-nudge) under
# apps/operator/scripts/hooks/cc/ are read at runtime by
# lib/desktop-install/papercusp-files.ts (installClaudeHooks → ~/.papercusp/hooks/cc/
# + merged into ~/.claude/settings.json). esbuild doesn't trace them, so copy the
# runtime scripts explicitly. Without them the packaged Mac/Windows app installs NO
# Claude statusline/lock/coord hooks (EI-8191: "blank bottom statusline", lock
# enforcement silently off). Only the *.sh scripts — skip __tests__/ and *.tmp scratch.
CC_HOOK_SRC_DIR="$WEB_DIR/scripts/hooks/cc"
if [[ -d "$CC_HOOK_SRC_DIR" ]]; then
  CC_HOOK_DST_DIR="$SIDECAR_DIR/apps/operator/scripts/hooks/cc"
  echo "→ copying cc hooks → sidecar/apps/operator/scripts/hooks/cc/"
  mkdir -p "$CC_HOOK_DST_DIR"
  cp -a "$CC_HOOK_SRC_DIR"/*.sh "$CC_HOOK_DST_DIR"/
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
#
# The top-level `prompts/` dir was RETIRED by the deterministic-blueprints
# migration — role spawn prompts now live PER-BLUEPRINT at
# `blueprints/<bp>/prompts/<role>.md` (the `find -type f` copy above brings them
# over with the rest of `blueprints/`). So require `blueprints` (+ `templates`)
# and assert a representative role prompt actually landed, instead of the stale
# top-level `prompts/` dir.
for required in blueprints templates; do
  if [[ ! -e "$HARNESS_DST/$required" ]]; then
    echo "ERROR: harness bundle missing $required at $HARNESS_DST"
    exit 1
  fi
done
# Assert the base-blueprint prompt set actually landed. NOTE: the previous
# sentinel was the single file `blueprints/base/prompts/queen.md`, but the
# WI-2932 blueprint rename churn (2026-07-05) moved/renamed the queen prompts
# (queen.md → queen.base.md → relocated again mid-refactor), so a single-file
# sentinel red-pins this build on an unrelated in-flight rename. Guard the
# INVARIANT instead: a healthy base prompt dir carries dozens of role prompts —
# require a sane minimum so a broken copy (0/near-0 files) still fails loudly.
BASE_PROMPTS_COUNT=$(find "$HARNESS_DST/blueprints/base/prompts" -maxdepth 1 -name '*.md' -type f 2>/dev/null | wc -l)
if [[ "$BASE_PROMPTS_COUNT" -lt 10 ]]; then
  echo "ERROR: harness bundle base prompts look missing/empty ($BASE_PROMPTS_COUNT .md files under blueprints/base/prompts) at $HARNESS_DST"
  echo "  Role spawn prompts live under blueprints/<bp>/prompts/ — the harness copy did not bring them over."
  exit 1
fi
find "$HARNESS_DST/bin" -type f -name "*.sh" -exec chmod +x {} \; 2>/dev/null || true

# Bundle the first-party app-templates (local-first-party-template-bundling-2026-07-07).
# The `templates:*` verbs resolve the bundled first-party templates from this dir at
# runtime (packages/operator-core/lib/cupboard/template-store.ts). Tauri's main.rs sets
# PAPERCUSP_TEMPLATES_DIR -> <resources>/sidecar/templates; a dev checkout with no env
# falls back to the in-repo templates/ dir. Shipped via tauri.conf.json resources
# ("sidecar/**/*"). Content only — the per-template checks/*.test.ts are PORTABLE content
# copied into composed apps, never run in-repo (templates/ is excluded from test discovery).
TEMPLATES_SRC="$REPO_ROOT/templates"
TEMPLATES_DST="$SIDECAR_DIR/templates"
echo "→ copying first-party templates from $TEMPLATES_SRC"
if [[ ! -d "$TEMPLATES_SRC" ]]; then
  echo "ERROR: first-party templates dir not found at $TEMPLATES_SRC"
  exit 1
fi
mkdir -p "$TEMPLATES_DST"
( cd "$TEMPLATES_SRC" && find . -type f \
    -not -path "./node_modules/*" \
    -not -path "*/.git/*" ) > /tmp/template-files.txt
while IFS= read -r f; do
  rel="${f#./}"
  mkdir -p "$TEMPLATES_DST/$(dirname "$rel")"
  cp "$TEMPLATES_SRC/$rel" "$TEMPLATES_DST/$rel"
done < /tmp/template-files.txt
rm -f /tmp/template-files.txt
# Sanity: the first-party set + their self-describing listing.json actually landed.
tmpl_count=$(find "$TEMPLATES_DST" -maxdepth 2 -name listing.json 2>/dev/null | wc -l)
if [[ "$tmpl_count" -lt 1 ]]; then
  echo "ERROR: no first-party template listing.json landed at $TEMPLATES_DST"
  exit 1
fi
echo "  ✓ $tmpl_count first-party templates bundled → $TEMPLATES_DST"

# Bundle the first-party rubrics (local-first-party-rubric-bundling-2026-07-07) —
# same design as the templates block above: self-describing dirs (listing.json +
# rubric.json + METHOD.md) resolved at runtime from the bundled layer via
# PAPERCUSP_RUBRICS_DIR (Tauri main.rs → <resources>/sidecar/rubrics; dev falls
# back to the in-repo rubrics/ dir) and SEEDED into the workspace rubric store on
# first use, so a fresh install has the standard rubrics on day one.
RUBRICS_SRC="$REPO_ROOT/rubrics"
RUBRICS_DST="$SIDECAR_DIR/rubrics"
echo "→ copying first-party rubrics from $RUBRICS_SRC"
if [[ ! -d "$RUBRICS_SRC" ]]; then
  echo "ERROR: first-party rubrics dir not found at $RUBRICS_SRC"
  exit 1
fi
mkdir -p "$RUBRICS_DST"
( cd "$RUBRICS_SRC" && find . -type f \
    -not -path "./node_modules/*" \
    -not -path "*/.git/*" ) > /tmp/rubric-files.txt
while IFS= read -r f; do
  rel="${f#./}"
  mkdir -p "$RUBRICS_DST/$(dirname "$rel")"
  cp "$RUBRICS_SRC/$rel" "$RUBRICS_DST/$rel"
done < /tmp/rubric-files.txt
rm -f /tmp/rubric-files.txt
# Sanity: the first-party set + their self-describing listing.json actually landed.
rubric_count=$(find "$RUBRICS_DST" -maxdepth 2 -name listing.json 2>/dev/null | wc -l)
if [[ "$rubric_count" -lt 1 ]]; then
  echo "ERROR: no first-party rubric listing.json landed at $RUBRICS_DST"
  exit 1
fi
echo "  ✓ $rubric_count first-party rubrics bundled → $RUBRICS_DST"

# Bundle the @papercusp/orchestrator entry bins as self-contained esbuild .mjs,
# shipped as a SIBLING of harness/ (sidecar/orchestrator/bin/*.mjs) — the path
# harnessPath('../orchestrator/bin/...') + the preflight harness check resolve to.
# The DBOS orchestrator-runner spawns invoke-once as a SEPARATE `node` process;
# bundling it self-contained means no tsx + no node_modules dep tree on disk
# (mirrors the host.mjs approach). harness-paths.ts prefers the .mjs when present.
ORCH_SRC="$PAPERCUSP_ROOT/packages/orchestrator"
ORCH_DST="$SIDECAR_DIR/orchestrator"
echo "→ esbuild-bundling orchestrator bins from $ORCH_SRC"
if [[ ! -d "$ORCH_SRC/bin" ]]; then
  echo "ERROR: orchestrator package not found at $ORCH_SRC"
  exit 1
fi
mkdir -p "$ORCH_DST/bin"
for b in invoke-once run assemble-prompt get-plan-context; do
  if [[ -f "$ORCH_SRC/bin/$b.ts" ]]; then
    (cd "$WEB_DIR" && npx --yes esbuild@0.25.0 "$ORCH_SRC/bin/$b.ts" \
      --bundle --platform=node --format=esm --target=node22 \
      --outfile="$ORCH_DST/bin/$b.mjs")
  fi
done
# Minimal package.json so the dir is a resolvable @papercusp/orchestrator root.
cat > "$ORCH_DST/package.json" <<'JSON'
{ "name": "@papercusp/orchestrator", "version": "0.0.1", "private": true, "type": "module" }
JSON
if [[ ! -f "$ORCH_DST/bin/invoke-once.mjs" ]]; then
  echo "ERROR: orchestrator invoke-once.mjs not produced at $ORCH_DST/bin"
  exit 1
fi
echo "  ✓ orchestrator bins bundled → $ORCH_DST/bin"

# Bundle the embedded-postgres-server package (real PG with logical
# replication enabled). This is the ONLY desktop DB — the legacy
# pglite-server fallback was removed 2026-06-01 (a failed embedded-PG must
# fail LOUD, not silently degrade to a WASM single-connection engine).
#
# SP1 C5: no longer spawned as its own process — serve.mjs imports
# `@papercusp/embedded-postgres-server` (externalized in the esbuild step
# above) and runs PG IN-PROCESS. Shipping it under sidecar/node_modules/
# makes the bare-specifier import resolve, and keeps the PG binary paths
# (computed from the package's own import.meta.url) correct.
EMBEDDED_PG_SRC="$PAPERCUSP_ROOT/packages/embedded-postgres-server"
EMBEDDED_PG_DST="$SIDECAR_DIR/node_modules/@papercusp/embedded-postgres-server"
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

# ── BUILD-TIME ASSERTION: the embedded-PG server binaries MUST be real ──────
# This is the guard for the 0-byte-binary bug (2026-06-01): a concurrent /
# interrupted build, a strip step, or a botched copy can leave initdb /
# postgres present-but-empty or non-executable in the bundle. The packaged
# app would then fail to initdb at runtime. With the pglite fallback gone,
# that's a hard, user-visible failure — so catch it HERE, at build time,
# before anything ships. We assert across EVERY bundled @embedded-postgres
# platform tree (cross-platform builds may have more than one).
echo "→ asserting embedded-postgres binaries are present, non-empty, and executable"
pg_bin_checked=0
for _pg_bin_dir in "$EMBEDDED_PG_DST/node_modules/@embedded-postgres"/*/native/bin; do
  [[ -d "$_pg_bin_dir" ]] || continue
  for _req_bin in initdb postgres; do
    _bin_path="$_pg_bin_dir/$_req_bin"
    if [[ ! -e "$_bin_path" ]]; then
      echo "ERROR: bundled embedded-PG binary missing: $_bin_path"
      echo "  The embedded-postgres npm install did not produce this binary."
      echo "  Refusing to ship a bundle whose Postgres cannot initdb."
      exit 1
    fi
    if [[ ! -s "$_bin_path" ]]; then
      echo "ERROR: bundled embedded-PG binary is 0 bytes: $_bin_path"
      echo "  An empty binary means an interrupted build or a botched copy"
      echo "  truncated it. (Concurrent builds are flock-serialized and publish"
      echo "  atomically since P-056, so a parallel build should no longer be"
      echo "  the cause.) Refusing to ship a broken Postgres."
      exit 1
    fi
    if [[ ! -x "$_bin_path" ]]; then
      echo "ERROR: bundled embedded-PG binary is not executable: $_bin_path"
      echo "  The executable bit was lost (cp without -a / mode-preservation)."
      echo "  Refusing to ship a Postgres binary the app cannot exec."
      exit 1
    fi
    _bin_size=$(stat -c %s "$_bin_path" 2>/dev/null || stat -f %z "$_bin_path" 2>/dev/null || echo 0)
    echo "  ✓ $_req_bin: ${_bin_size} bytes, executable ($_bin_path)"
    pg_bin_checked=$((pg_bin_checked + 1))
  done
done
if [[ "$pg_bin_checked" -eq 0 ]]; then
  echo "ERROR: no @embedded-postgres/*/native/bin/ tree found to assert against"
  echo "  Expected initdb + postgres under $EMBEDDED_PG_DST/node_modules/@embedded-postgres/*/native/bin/"
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
      # Modern pgvector keg layout: per-PG-version subdirs under the
      # pgvector keg itself (opt/pgvector/lib/postgresql@18/vector.dylib).
      if [[ ! -f "$pgv_lib_src" ]] && pgv_prefix=$(brew --prefix pgvector 2>/dev/null); then
        pgv_lib_src="$pgv_prefix/lib/postgresql@18/vector.dylib"
        pgv_ext_src="$pgv_prefix/share/postgresql@18/extension"
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
      # cp -f, not GNU-only -u: BSD/macOS cp has no -u.
      cp -f "$pgv_lib_src" "$plat_dir/lib/postgresql/"
      cp -f "$pgv_ext_src"/vector*.sql "$plat_dir/share/postgresql/extension/"
      cp -f "$pgv_ext_src/vector.control" "$plat_dir/share/postgresql/extension/"
      pgvector_copied=$((pgvector_copied + 1))
    done
    echo "  ✓ pgvector copied into $pgvector_copied embedded-postgres tree(s) (lib.${pgv_lib_ext} + sql + control)"
  else
    # HARD ERROR, not the old "mem0 in-memory fallback" warning: the
    # baseline schema CREATEs vector-typed columns, so a fresh-DB boot of a
    # bundle without pgvector dies fatally ('type "public.vector" does not
    # exist') — proven on the first mac DMG first-launch (2026-06-11).
    echo "ERROR: pgvector not found at $pgv_lib_src — a bundle without it cannot boot a fresh database"
    case "$_pgv_os" in
      linux)  echo "    Install: sudo apt install postgresql-18-pgvector" ;;
      darwin) echo "    Install: brew install pgvector  (requires postgresql@18 keg)" ;;
    esac
    exit 1
  fi
fi

# Fail loudly if pgvector ended up NOT bundled on a platform that requires it.
# The per-source HARD ERROR above only fires when a source was FOUND but
# incomplete (brew present, .dylib missing). It does NOT catch the SILENT-SKIP
# cases: on darwin `pgv_lib_src` is only set inside `if command -v brew`, so a
# build shell without `brew` on PATH (e.g. a NON-LOGIN shell that never ran
# path_helper, so /usr/local/bin is absent) leaves it empty → the whole block
# is skipped with no copy and no error → a bundle ships with no pgvector and
# dies on first fresh-DB boot ('type "public.vector" does not exist'). This
# backstop makes that a build failure instead. (Proven live 2026-06-30 on the
# mac VM: a nohup/non-login test build silently shipped a pgvector-less sidecar.)
if [[ "$_pgv_os" != "windows" && "${pgvector_copied:-0}" -eq 0 ]]; then
  echo "ERROR: pgvector was NOT bundled into any embedded-postgres tree on $_pgv_os."
  echo "       A fresh-DB boot will die fatally with 'type \"public.vector\" does not exist'."
  case "$_pgv_os" in
    linux)  echo "       Install: sudo apt install postgresql-18-pgvector" ;;
    darwin) echo "       Install: brew install pgvector  — AND ensure 'brew' is on PATH for the build shell"
            echo "                (a non-login shell may lack /usr/local/bin; run the build via 'bash -lc' or 'eval \$(/usr/local/bin/brew shellenv)')" ;;
  esac
  exit 1
fi

# Surface real pg_dump / psql to the sidecar's $PATH so the snapshot
# subsystem (packages/backup/src/hook.ts spawns `pg_dump` by bare name; the
# legacy libs/papercusp-export-state/src/pg-dump.ts is retired) finds them.
# NOTE hook.ts DEGRADES SOFTLY on spawn failure — a broken vendored tool means
# snapshots silently ship WITHOUT the PG dump, which is why the guards below
# hard-fail the build instead of trusting a runtime error to surface it.
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
# The embedded server's major version — vendored client tools must match it
# (pg_dump cannot dump a server NEWER than itself, so distro-default clients —
# e.g. Ubuntu 24.04's v16 vs our embedded 18 — are not acceptable sources).
EMBEDDED_PG_MAJOR="$("$EMBEDDED_PG_BIN_DIR/postgres" --version 2>/dev/null | grep -oE '[0-9]+' | head -1)"
if [[ -z "$EMBEDDED_PG_MAJOR" ]]; then
  echo "ERROR: could not determine embedded postgres major version from $EMBEDDED_PG_BIN_DIR/postgres"
  exit 1
fi

# NEVER vendor a #!-script as a pg tool. On Debian/Ubuntu `command -v psql`
# resolves to postgresql-common's perl pg_wrapper DISPATCHER, not the real
# binary. It works on the build host (wrapper + versioned client both
# installed there) so every build-time probe passes — then dies on every
# clean machine (`Can't locate PgCommon.pm`). We shipped ALL FOUR tools as
# that broken 9.5K shim until 2026-07-07, which silently disabled the PG half
# of the snapshot subsystem in the packaged app (hook.ts degrades to a
# dump-less snapshot on spawn failure). Resolve the real binary or fail loud.
_is_script() { [[ "$(head -c 2 "$1" 2>/dev/null)" == "#!" ]]; }

_pg_build_os="$(uname -s)"
for tool in pg_dump psql pg_dumpall pg_restore; do
  src=""
  method=""
  if [[ -x "$EMBEDDED_PG_BIN_DIR/$tool" ]] && ! _is_script "$EMBEDDED_PG_BIN_DIR/$tool"; then
    src="$EMBEDDED_PG_BIN_DIR/$tool"
    method="symlink (from embedded-postgres)"
  fi
  # Debian/Ubuntu: the REAL versioned binaries live under /usr/lib/postgresql/
  # (pgdg layout). Require the major to match the embedded server exactly.
  if [[ -z "$src" && "$_pg_build_os" == "Linux" && -x "/usr/lib/postgresql/$EMBEDDED_PG_MAJOR/bin/$tool" ]] \
      && ! _is_script "/usr/lib/postgresql/$EMBEDDED_PG_MAJOR/bin/$tool"; then
    src="/usr/lib/postgresql/$EMBEDDED_PG_MAJOR/bin/$tool"
    method="copy (real binary, pgdg /usr/lib/postgresql/$EMBEDDED_PG_MAJOR/bin)"
  fi
  # pg_config bindir (brew libpq keg, pgdg with pg_config on PATH, …).
  if [[ -z "$src" ]] && command -v pg_config >/dev/null 2>&1; then
    _pg_bindir="$(pg_config --bindir 2>/dev/null)"
    if [[ -n "$_pg_bindir" && -x "$_pg_bindir/$tool" ]] && ! _is_script "$_pg_bindir/$tool"; then
      src="$_pg_bindir/$tool"
      method="copy (pg_config bindir $_pg_bindir)"
    fi
  fi
  # Last resort: system PATH — but REJECT script shims instead of vendoring them.
  if [[ -z "$src" ]] && system_path=$(command -v "$tool" 2>/dev/null) && [[ -n "$system_path" ]]; then
    if _is_script "$system_path"; then
      echo "ERROR: $tool on PATH ($system_path) is a script shim (Debian pg_wrapper), not a"
      echo "  real binary. Vendoring it ships a tool that only runs on hosts with a full"
      echo "  PostgreSQL client install (the 2026-07-07 broken-psql bug class). Install the"
      echo "  real client matching the embedded server:"
      echo "    Ubuntu/Debian: apt-get install postgresql-client-$EMBEDDED_PG_MAJOR   (pgdg repo)"
      exit 1
    fi
    src="$system_path"
    method="copy (from system PATH)"
  fi
  if [[ -z "$src" ]]; then
    echo "ERROR: $tool not found in embedded-postgres distribution AND not on system PATH"
    echo "  embedded-postgres ships server-only (initdb, pg_ctl, postgres). The build"
    echo "  host needs PostgreSQL client tools (real binaries, major $EMBEDDED_PG_MAJOR)"
    echo "  for the snapshot subsystem to work in the bundled desktop app. Install via:"
    echo "    macOS:   brew install libpq && brew link --force libpq"
    echo "    Ubuntu:  apt-get install postgresql-client-$EMBEDDED_PG_MAJOR   (pgdg repo)"
    echo "    Windows: install PostgreSQL from postgresql.org"
    exit 1
  fi
  case "$method" in
    symlink*) ln -sfn "$src" "$SIDECAR_DIR/bin/$tool" ;;
    copy*)
      if [[ "$_pg_build_os" == "Linux" ]]; then
        # Real pgdg binaries link libpq.so.5 (and psql libreadline.so.8) that a
        # clean target machine may not have. Ship the binary under bin/.pg-real/
        # fronted by a sh wrapper whose LD_LIBRARY_PATH points at (a) the
        # embedded-postgres lib dir — libpq.so.5 plus the openssl-1.1 it links,
        # already shipped for the server ($ORIGIN/../lib) — and (b) .pg-real/lib
        # for readline/tinfo copied off the build host. Remaining deps
        # (zstd/lz4/z/crypto3) are Ubuntu base-system libs.
        mkdir -p "$SIDECAR_DIR/bin/.pg-real/lib"
        cp -L "$src" "$SIDECAR_DIR/bin/.pg-real/$tool"
        chmod 755 "$SIDECAR_DIR/bin/.pg-real/$tool"
        _emb_lib_rel="${EMBEDDED_PG_BIN_DIR#"$SIDECAR_DIR"/}"   # node_modules/.../native/bin
        _emb_lib_rel="../${_emb_lib_rel%/bin}/lib"               # ../node_modules/.../native/lib (relative to bin/)
        cat > "$SIDECAR_DIR/bin/$tool" <<WRAP
#!/bin/sh
# Generated by build-desktop-sidecar.sh — vendored PostgreSQL client tool.
# Real binary in .pg-real/; libs resolved from the embedded-postgres lib dir
# (libpq + its openssl 1.1) and .pg-real/lib (readline/tinfo).
d=\$(CDPATH= cd -- "\$(dirname -- "\$0")" && pwd)
LD_LIBRARY_PATH="\$d/$_emb_lib_rel:\$d/.pg-real/lib\${LD_LIBRARY_PATH:+:\$LD_LIBRARY_PATH}" exec "\$d/.pg-real/$tool" "\$@"
WRAP
        chmod 755 "$SIDECAR_DIR/bin/$tool"
      else
        # chmod 755, not just +x: brew ships these 0555 (read-only) and
        # tauri-build's resource copy into target/<triple>/release/ then
        # EACCESes overwriting its own previous read-only copy on rebuild.
        cp -L "$src" "$SIDECAR_DIR/bin/$tool"
        chmod 755 "$SIDECAR_DIR/bin/$tool"
        # Windows: an .exe copied without its sibling DLLs (libpq.dll, ssl,
        # iconv/intl) still resolves them via PATH on the BUILD host — masked
        # — and breaks on clean machines (WI-3313). Ship the source dir's
        # DLLs beside the exes: the exe's own dir is first in the Windows
        # DLL search order, making the tools self-contained.
        case "$_pg_build_os" in
          MINGW*|MSYS*|CYGWIN*)
            cp -n "$(dirname "$src")"/*.dll "$SIDECAR_DIR/bin/" 2>/dev/null || true ;;
        esac
      fi
      ;;
  esac
  echo "  $tool: $method ($src)"
  echo "$tool: $method ($src)" >> "$SOURCE_NOTE_FILE"
done

# Linux: psql needs readline+tinfo, which minimal images may lack — bundle them
# into .pg-real/lib (tiny; resolved via the wrapper's LD_LIBRARY_PATH).
if [[ "$_pg_build_os" == "Linux" && -d "$SIDECAR_DIR/bin/.pg-real" ]]; then
  for _lib in libreadline.so.8 libtinfo.so.6; do
    _libpath="$(ldconfig -p 2>/dev/null | awk -v l="$_lib" '$1==l {print $NF; exit}')"
    if [[ -n "$_libpath" && -e "$_libpath" ]]; then
      cp -L "$_libpath" "$SIDECAR_DIR/bin/.pg-real/lib/$_lib"
    else
      echo "ERROR: $_lib not found on build host (needed by vendored psql on clean targets)"
      exit 1
    fi
  done
fi

# Sanity-probe every bundled tool AS INSTALLED (i.e. through the wrapper on
# linux, so the bundled-libs path is what's exercised) — and assert none of
# them is still a #!-script (the pg_wrapper bug class shipping again).
for tool in pg_dump psql pg_dumpall pg_restore; do
  _final="$SIDECAR_DIR/bin/$tool"
  if [[ "$_pg_build_os" == "Linux" && -e "$SIDECAR_DIR/bin/.pg-real/$tool" ]] && _is_script "$SIDECAR_DIR/bin/.pg-real/$tool"; then
    echo "ERROR: vendored $tool (.pg-real) is a script shim — refusing to ship it"
    exit 1
  fi
  if [[ "$_pg_build_os" != "Linux" ]] && _is_script "$_final"; then
    echo "ERROR: bundled $tool is a script shim — refusing to ship it"
    exit 1
  fi
  if ! _probe_out="$("$_final" --version 2>&1)"; then
    echo "ERROR: bundled $tool fails --version probe; not loadable as installed:"
    echo "  $_probe_out"
    echo "  This usually means dynamic library mismatch (e.g. libpq from a different"
    echo "  PG major version). Build on a host with real PG $EMBEDDED_PG_MAJOR client tools."
    exit 1
  fi
  echo "  $tool probe: $_probe_out"
done
# Linux: assert the vendored binaries' NEEDED libs all resolve using ONLY the
# wrapper's lib path + system dirs — catches a dep that exists on the build
# host but would never ship (masked-on-build-host bug class).
if [[ "$_pg_build_os" == "Linux" && -d "$SIDECAR_DIR/bin/.pg-real" ]]; then
  _emb_lib_dir="${EMBEDDED_PG_BIN_DIR%/bin}/lib"
  for tool in pg_dump psql pg_dumpall pg_restore; do
    _missing="$(LD_LIBRARY_PATH="$_emb_lib_dir:$SIDECAR_DIR/bin/.pg-real/lib" ldd "$SIDECAR_DIR/bin/.pg-real/$tool" 2>/dev/null | grep 'not found' || true)"
    if [[ -n "$_missing" ]]; then
      echo "ERROR: vendored $tool has unresolved shared libs:"
      echo "$_missing"
      exit 1
    fi
  done
fi

# ── kopia (snapshot subsystem, WI-3312) ─────────────────────────────────────
# packages/backup/src/workspace-backup.ts spawns bare `kopia` (KOPIA_BIN ??
# 'kopia') with sidecar/bin on the operator PATH. It was never bundled: dev
# boxes have a system kopia so everything worked there, while clean installs
# got `spawn kopia ENOENT` and every snapshot silently shipped without a
# kopia backup — same masked-dependency class as the pg_wrapper bug above.
# kopia is a single fully-static Go binary (Apache-2.0) — vendor it.
if [[ -x "$SIDECAR_DIR/bin/kopia" ]] && "$SIDECAR_DIR/bin/kopia" --version >/dev/null 2>&1; then
  echo "  kopia: already bundled ($("$SIDECAR_DIR/bin/kopia" --version 2>/dev/null | head -1))"
else
  _kopia_src="$(command -v kopia 2>/dev/null || true)"
  if [[ -z "$_kopia_src" ]]; then
    echo "ERROR: kopia not found on the build host — required for the bundled snapshot"
    echo "  subsystem (packages/backup/src/workspace-backup.ts). Install the static"
    echo "  binary: https://kopia.io/docs/installation/  (apt/brew install kopia)"
    exit 1
  fi
  if _is_script "$_kopia_src"; then
    echo "ERROR: kopia on PATH ($_kopia_src) is a script shim — refusing to vendor it"
    exit 1
  fi
  cp -L "$_kopia_src" "$SIDECAR_DIR/bin/kopia"
  chmod 755 "$SIDECAR_DIR/bin/kopia"
  if ! "$SIDECAR_DIR/bin/kopia" --version >/dev/null 2>&1; then
    echo "ERROR: bundled kopia fails --version probe as installed"
    exit 1
  fi
  echo "  kopia: copy ($_kopia_src) → $("$SIDECAR_DIR/bin/kopia" --version 2>/dev/null | head -1)"
  echo "kopia: copy (from system PATH) ($_kopia_src)" >> "$SOURCE_NOTE_FILE"
fi

# NOTE: zero-cache-server is no longer bundled (SP1 C5, 2026-06-06). The
# legacy opt-in spawn (PAPERCUSP_USE_ZERO_CACHE=1) was removed from the Rust
# embedder along with the rest of its PG/sidecar process management — the
# operator's /api/zero-harness/sse path (PG LISTEN/NOTIFY) replaced the Zero
# WS transport on desktop back on 2026-05-07. Saves ~50MB of bundle.

# NOTE: the legacy pglite-server is no longer bundled (removed 2026-06-01).
# embedded-postgres-server is the only desktop DB. A failed embedded-PG must
# fail LOUD (see Tauri main.rs) rather than silently degrade to a WASM
# single-connection engine with limited LISTEN/NOTIFY.

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
    "$REPO_ROOT/node_modules/@lydell/$pkg_name/prebuilds" \
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

# Bundle the framework DDL files so embedded-PG first-boot init can find
# them at runtime. The Tauri main passes this dir to serve.mjs
# (PAPERCUSP_PG_SQL_DIR) which applies the schema on first boot.
echo "→ bundling framework DDL"
rm -rf "$SIDECAR_DIR/db-sql"
mkdir -p "$SIDECAR_DIR/db-sql"
cp "$PAPERCUSP_ROOT/libs/db/sql/"*.sql "$SIDECAR_DIR/db-sql/"

# WI-3047 guard: assert what we just copied EXACTLY matches the source tree at
# this instant (same count, same highest migration number) — cheap defense-in-
# depth against a partial/failed cp, a stale leftover db-sql/ from a prior
# build (hence the rm -rf above), or a future refactor that decouples this copy
# from the seed build below. Root cause of the WI-3047 incident was actually a
# STALE `libs/papercusp` SUBMODULE checkout (see the freshness check in
# release-local.sh, which is where that class is actually caught); this check
# covers the narrower "the tree itself and what got shipped disagree" case so a
# regression here is a red build, not a silent runtime error a user hits.
_tree_sql_max="$(ls "$PAPERCUSP_ROOT/libs/db/sql/"*.sql 2>/dev/null | xargs -n1 basename | grep -oE '^[0-9]+' | sort -n | tail -1)"
_tree_sql_count="$(ls "$PAPERCUSP_ROOT/libs/db/sql/"*.sql 2>/dev/null | wc -l | tr -d ' ')"
_shipped_sql_max="$(ls "$SIDECAR_DIR/db-sql/"*.sql 2>/dev/null | xargs -n1 basename | grep -oE '^[0-9]+' | sort -n | tail -1)"
_shipped_sql_count="$(ls "$SIDECAR_DIR/db-sql/"*.sql 2>/dev/null | wc -l | tr -d ' ')"
if [[ -z "$_tree_sql_max" || "$_tree_sql_max" != "$_shipped_sql_max" || "$_tree_sql_count" != "$_shipped_sql_count" ]]; then
  echo "ERROR: shipped sidecar/db-sql/ (highest=$_shipped_sql_max, count=$_shipped_sql_count) does not match"
  echo "       the source tree libs/db/sql/ (highest=$_tree_sql_max, count=$_tree_sql_count) — refusing to ship"
  echo "       a schema that could silently diverge from the tree (WI-3047)."
  exit 1
fi
echo "    ✓ shipped db-sql/ matches the tree (highest migration $_tree_sql_max, $_tree_sql_count files)"

# ── Pre-migrated PGDATA seed (desktop first-boot fast path) ─────────────────
# Boot the JUST-BUNDLED embedded-PG ONCE at build time (initdb + apply every
# migration in db-sql/), cleanly stop, and archive the resulting data dir into
# db-seed.tar.gz. On a FRESH install the Server extracts this INSTEAD of running
# the ~11s "initdb + full migration replay" (see embedded-postgres-server
# src/index.js seedPath handling — measured ~11x faster first-boot; ~13MB gz).
# Because it runs the SAME bundled binary that ships, the seed is byte-compatible
# with THIS bundle's platform by construction (no cross-arch seed hazard). It also
# doubles as a build-time gate that the full migration set applies cleanly on this
# platform. Skip with PAPERCUSP_BUILD_PG_SEED=0 (then first-boot falls back to the
# old initdb+replay path — correct, just slow).
if [[ "${PAPERCUSP_BUILD_PG_SEED:-1}" == "1" ]]; then
  echo "→ building pre-migrated PGDATA seed (first-boot fast path)"
  _seed_tmp="$(mktemp -d)"
  if node "$EMBEDDED_PG_DST/bin/build-seed.mjs" \
       --data "$_seed_tmp/pgdata" \
       --sql "$SIDECAR_DIR/db-sql" \
       --out "$SIDECAR_DIR/db-seed.tar.gz" \
       --port "${PAPERCUSP_BUILD_PG_SEED_PORT:-5549}"; then
    echo "→ db-seed.tar.gz staged ($(du -h "$SIDECAR_DIR/db-seed.tar.gz" | cut -f1))"
  else
    echo "ERROR: pre-migrated seed build failed — refusing to ship a bundle without a verified schema."
    echo "  (Set PAPERCUSP_BUILD_PG_SEED=0 to intentionally ship without the first-boot fast path.)"
    rm -f "$SIDECAR_DIR/db-seed.tar.gz"
    rm -rf "$_seed_tmp"
    exit 1
  fi
  rm -rf "$_seed_tmp"
else
  echo "→ skipping pre-migrated seed (PAPERCUSP_BUILD_PG_SEED=0) — first-boot will initdb + replay migrations"
fi

# Bundle the @papercusp/locks (papercusp_su side-DB) migrations. EI-2669:
# @papercusp/locks is esbuild-BUNDLED into serve.mjs (not externalized), so its
# su-lock-store resolves SQL_DIR = dirname(import.meta.url)/sql = <sidecar>/sql.
# esbuild inlines only JS, never the package's sibling src/sql/*.sql, so without
# this copy the packaged git-sync lock infra ENOENTs on scandir '<sidecar>/sql'
# and git-sync (repo-content sync for hive members) is degraded on EVERY hive.
# These are the LOCK schema (001-bootstrap … 015-…), a distinct set from the
# framework DDL above — they must land at sidecar/sql/, NOT db-sql/.
echo "→ bundling @papercusp/locks DDL"
mkdir -p "$SIDECAR_DIR/sql"
cp "$PAPERCUSP_ROOT/packages/locks/src/sql/"*.sql "$SIDECAR_DIR/sql/"

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
# Tauri main spawns the sidecar + embedded-postgres-server with this binary
# explicitly (see resolve_node_bin in main.rs). Bare `node` only — we don't need npm
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
  # gh names its linux x86_64 asset "amd64" (not "x64") — x64 404s silently.
  linux)   _gh_arch="$target_arch"; [[ "$target_arch" == "x64" ]] && _gh_arch="amd64"
           gh_archive="gh_${GH_VERSION}_linux_${_gh_arch}.tar.gz";  gh_inner_dir="gh_${GH_VERSION}_linux_${_gh_arch}" ;;
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
# expect (sed, grep, sort, …). Tauri main prepends `git/cmd` and `git/usr/bin`
# to PATH on Windows so all bundled tools resolve by name.
#
# ⚠ macOS does NOT ship a working git by default: a fresh, Xcode-CLT-less Mac
#   has only the `/usr/bin/git` STUB, which on non-interactive invocation prints
#   "xcode-select: no developer tools were found …" and exits non-zero — so the
#   dogfood `git clone` fails ("Setting up Papercusp workspace failed", found on
#   an owner Mac VM 2026-06-25). We currently DON'T vendor git on macOS, so the
#   wizard now (a) prepends /opt/homebrew/bin to the sidecar PATH (tool-path.ts)
#   to find a Homebrew git/gh, and (b) surfaces an actionable "run
#   `xcode-select --install`" hint when git is genuinely absent (clone-github.ts
#   git_missing). Vendoring a relocatable macOS git is the robust fix — tracked
#   as a follow-up. Linux ships git via the distro, so we skip vendoring there.
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

# meridian (@rynfar/meridian) DECOMMISSIONED 2026-07-06 (owner directive, WI-3180)
# — "we are no longer using meridian." It routed omp/pi through the user's Claude
# Max subscription (local daemon :3456) and cost ~509MB in the sidecar (chiefly its
# two bundled claude binaries), the single biggest slice of the Windows NSIS-4GiB
# payload problem (WI-3172). No longer bundled. The first-launch install
# (setup-pty-commands.ts), the preflight :3456 probe, and the 'omp-meridian'
# onboarding framework are removed alongside it.

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
# NOTE: the glob is a SUBSTRING match (*plpython*, not plpython*) — contrib
# "bridge" extensions like ltree_plpython3.so / hstore_plperl.so / jsonb_
# plpython3.so link libpython/libperl too but are PREFIXED with the data-type
# name, not the language, so a prefix-only glob (plpython*) misses them. A
# missed one still crashes AppImage bundling the same way (WI-807 live repro:
# `ERROR: Could not find dependency: libpython3.6m.so.1.0` from
# ltree_plpython3.so, only surfaced after the plpython*-prefixed files were
# already stripped). plpgsql is safe under substring matching too — it
# contains none of plperl/plpython/pltcl as a substring.
echo "→ stripping unused PL/* extensions (plperl, plpython, pltcl) from embedded-postgres"
pl_count=0
for ext_dir in "$EMBEDDED_PG_DST/node_modules/@embedded-postgres"/*/native/share/postgresql/extension; do
  [[ -d "$ext_dir" ]] || continue
  for f in "$ext_dir"/*plperl* "$ext_dir"/*plpython* "$ext_dir"/*pltcl*; do
    [[ -e "$f" ]] || continue
    rm -f "$f"
    pl_count=$((pl_count + 1))
  done
done
for lib_dir in "$EMBEDDED_PG_DST/node_modules/@embedded-postgres"/*/native/lib/postgresql; do
  [[ -d "$lib_dir" ]] || continue
  for f in "$lib_dir"/*plperl* "$lib_dir"/*plpython* "$lib_dir"/*pltcl*; do
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
# NOTE: publishers spell the musl variant TWO different ways — the
# `-linuxmusl-<arch>` node-gyp-build convention (@lydell/node-pty,
# @img/sharp) AND the `linux-<arch>-musl` napi-rs convention (e.g.
# @libsql/linux-x64-musl, pulled in transitively via meridian-host's
# node_modules). A pattern that only matches the first form misses the
# second and still crashes linuxdeploy on `libc.musl-x86_64.so.1` (WI-807
# live repro: meridian-host/node_modules/@libsql/linux-x64-musl/index.node
# — "Failed to run ldd: exited with code 1"). Match "musl" anywhere in the
# dir name so both conventions (and any future variant) are caught.
echo "→ stripping musl-libc native binary variants (incompatible with glibc AppImage)"
musl_dirs=$(find "$SIDECAR_DIR" -type d -iname "*musl*" 2>/dev/null)
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
  # The temp build dir never carries a prior seed — pull it forward from
  # the last PUBLISHED bundle when present (the cross-platform bake flow).
  if [[ -f "$SIDECAR_FINAL_DIR/seed.dump" && ! -f "$SIDECAR_DIR/seed.dump" ]]; then
    cp -a "$SIDECAR_FINAL_DIR/seed.dump" "$SIDECAR_DIR/seed.dump"
  fi
  if [[ -f "$SIDECAR_DIR/seed.dump" ]]; then
    seed_size=$(du -h "$SIDECAR_DIR/seed.dump" | awk '{print $1}')
    echo "→ no PAPERCUSP_SEED_PG_URL set; reusing existing seed.dump ($seed_size)"
    echo "  (this is the cross-platform path: bake on Linux once, rsync to Mac/Win,"
    echo "   then run this script without the env var so the pre-baked dump survives.)"
  else
    echo "→ no PAPERCUSP_SEED_PG_URL set and no existing seed.dump; bundle will boot empty"
  fi
fi

# ── chat dock: pui + companion wasm + zellij 0.44.3 (cross-platform) ─────────
# The desktop chat dock runs `pui chat` (zellij hosting the pui-companion plugin).
# This was mac-ONLY (in bin/mac-vm-build.sh), so a packaged LINUX app shipped NONE
# of these → the dock was a blank pane (the pui/zellij binaries simply weren't
# bundled). Bundling them here (the shared sidecar builder, run by every platform's
# build) — OS-aware on the zellij triple — gives Linux parity. native_terminal.rs's
# cross-platform dock-env prep then puts sidecar/bin on PATH + points
# PUI_COMPANION_WASM at the bundled plugin. (linux-chat-dock-parity-2026-06-27.)
echo "→ chat dock: pui + companion wasm + zellij 0.44.3"
REPO="$(cd "$ROOT/.." && pwd)"
mkdir -p "$SIDECAR_DIR/bin"
# Resolve cargo's REAL target dir (honors CARGO_TARGET_DIR + ~/.cargo/config.toml
# `[build] target-dir` — this box redirects ALL builds to ~/.cargo-target, so the
# built binaries are NOT under <crate>/target/. Same resolution release-local.sh
# uses; empty string on failure → the standard in-crate paths below still match).
CARGO_TGT="$(cd "$REPO/apps/tui" && cargo metadata --no-deps --format-version 1 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin).get("target_directory",""))' 2>/dev/null)"
# 1. pui (apps/tui) — native release build for the host triple.
( cd "$REPO/apps/tui" && cargo build --release )
# Existence-checked candidates (NOT `find` over a maybe-missing dir — under
# `set -eo pipefail` a missing path arg makes find non-zero → exit). The resolved
# CARGO_TGT comes first (covers the target-dir redirect); then the standard
# in-crate / workspace target dirs (non-redirected boxes, e.g. the mac VM).
PUI_BIN=""
for _c in "$CARGO_TGT/release/pui" "$REPO/apps/tui/target/release/pui" "$REPO/target/release/pui"; do
  [[ -f "$_c" ]] && PUI_BIN="$_c" && break
done
[[ -n "$PUI_BIN" ]] || { echo "ERROR: pui binary not found after build"; exit 1; }
cp "$PUI_BIN" "$SIDECAR_DIR/bin/pui"; chmod 755 "$SIDECAR_DIR/bin/pui"
echo "    ✓ pui → sidecar/bin/pui ($PUI_BIN)"
# 2. companion zellij plugin (wasm32-wasip1) — plugin API version-coupled to zellij 0.44.3.
rustup target add wasm32-wasip1 >/dev/null 2>&1 || true
( cd "$REPO/apps/pui-zellij-plugin" && cargo build --release --target wasm32-wasip1 )
WASM=""
for _c in "$CARGO_TGT/wasm32-wasip1/release/pui_companion.wasm" "$REPO/apps/pui-zellij-plugin/target/wasm32-wasip1/release/pui_companion.wasm" "$REPO/target/wasm32-wasip1/release/pui_companion.wasm"; do
  [[ -f "$_c" ]] && WASM="$_c" && break
done
[[ -n "$WASM" ]] || { echo "ERROR: companion .wasm not found after build"; exit 1; }
cp "$WASM" "$SIDECAR_DIR/pui-companion.wasm"
echo "    ✓ companion → sidecar/pui-companion.wasm ($WASM)"
# 3. zellij 0.44.3 — the plugin API is version-coupled; must match EXACTLY.
#    OS-aware triple: Linux uses the STATIC musl build (libc-independent → portable
#    across distros); macOS uses apple-darwin (matching bin/mac-vm-build.sh).
ZJ_VER=0.44.3
case "$(uname -m)" in arm64|aarch64) ZJ_ARCH=aarch64 ;; *) ZJ_ARCH=x86_64 ;; esac
case "$(uname -s)" in
  Linux*)  ZJ_TRIPLE="${ZJ_ARCH}-unknown-linux-musl" ;;
  Darwin*) ZJ_TRIPLE="${ZJ_ARCH}-apple-darwin" ;;
  *)       echo "ERROR: zellij bundling: unsupported OS $(uname -s)"; exit 1 ;;
esac
if [[ -x "$SIDECAR_DIR/bin/zellij" ]] && "$SIDECAR_DIR/bin/zellij" --version 2>/dev/null | grep -q "$ZJ_VER"; then
  echo "    ✓ zellij ${ZJ_VER} already present — skipping download"
else
  curl -fsSL "https://github.com/zellij-org/zellij/releases/download/v${ZJ_VER}/zellij-${ZJ_TRIPLE}.tar.gz" | tar -xz -C "$SIDECAR_DIR/bin"
  [[ -x "$SIDECAR_DIR/bin/zellij" ]] || { echo "ERROR: zellij ${ZJ_VER} (${ZJ_TRIPLE}) not fetched"; exit 1; }
  chmod 755 "$SIDECAR_DIR/bin/zellij"
  echo "    ✓ zellij ${ZJ_VER} (${ZJ_TRIPLE}) → sidecar/bin/zellij"
fi

# ── release-bundle dependency verifier (WI-3315) ────────────────────────────
# Verifies the bundle against its RUNTIME CONTRACT (manifest of spawned tools,
# no script shims, linkage closure over bundle libs + base allowlist) BEFORE
# the atomic publish — a bundle that fails never replaces the last good one.
# The point: build-host probes are masked (the host has the dev deps), which
# is exactly how the pg_wrapper psql (WI-3311) and unbundled kopia (WI-3312)
# shipped broken. See the verifier's header before touching its allowlists.
"$ROOT/bin/verify-sidecar-bundle.sh" "$SIDECAR_DIR"

# ── EI-160: atomic publish (P-056) ──────────────────────────────────────────
# Retire the old bundle via rename, rename the temp build into place, then
# delete the retired tree. Renames on one filesystem are atomic, so a
# concurrent reader sees only complete-old or complete-new — never the
# half-written dir the old in-place rm -rf/cp produced.
# Normalize owner-write on the whole tree: sources copied from brew kegs
# (libpq tools, pgvector dylib) arrive 0444/0555, and tauri-build's
# per-target resource copy then EACCESes overwriting its own previous
# read-only copy on every REBUILD (whack-a-mole class: pg_dumpall, then
# vector.dylib — kill it wholesale).
chmod -R u+w "$SIDECAR_DIR"

# NB: plain `mv src dst` (no GNU-only -T) — both renames have a
# guaranteed-absent destination, so BSD/macOS mv does the same rename(2)
# and never falls into move-INTO-directory mode.
OLD_DIR="$SIDECAR_FINAL_DIR.old.$$"
if [[ -d "$SIDECAR_FINAL_DIR" ]]; then
  mv "$SIDECAR_FINAL_DIR" "$OLD_DIR"
fi
mv "$SIDECAR_TMP_DIR" "$SIDECAR_FINAL_DIR"
rm -rf "$OLD_DIR"
SIDECAR_DIR="$SIDECAR_FINAL_DIR"

# Compute size
total_size=$(du -sh "$SIDECAR_DIR" 2>/dev/null | awk '{print $1}')
echo "✓ sidecar built at $SIDECAR_DIR ($total_size)"
