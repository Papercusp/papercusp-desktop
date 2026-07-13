#!/usr/bin/env bash
# gate-sidecar-boots.sh — the packed sidecar must actually BOOT before we ship it.
#
# WHY THIS EXISTS
# 0.0.9 shipped a sidecar that could not start on ANY platform. Five green cuts
# missed it. The bundle's closure-copier followed only `dependencies`, so sharp's
# native binary (an optionalDependency — that is the napi convention) was never
# copied; the installed app died at import with `Could not load the "sharp" module`.
#
# It survived every check because of a FALLBACK. When its own sidecar fails, the
# desktop app falls back to an operator on :3070 — which exists on our dev boxes
# and on NO user's machine. So the app looked healthy exactly where we tested it
# and was dead everywhere else.
#
#   A FALLBACK THAT HIDES A FATAL ERROR IS WORSE THAN NO FALLBACK, and
#   VERIFICATION PERFORMED IN AN ENVIRONMENT THAT SUPPLIES A DEPENDENCY THE
#   ARTIFACT IS SUPPOSED TO CARRY CANNOT SEE THE FAILURE.
#
# We already gate PACKED (the host-bake byte check) and DELIVERED (the ARRIVES
# /proc/<pid>/environ probe). Nothing gated "the thing we packed can START" —
# that gap IS how this shipped. This is that gate.
#
# WHAT IT DOES
# Runs the PACKED serve.mjs with the BUNDLED node, in an isolated root, with the
# same env the Rust host passes (src-tauri/src/main.rs), and requires it to SERVE
# HTTP. Nothing is mocked: it is the shipped artifact, started the shipped way.
#
# THE ISOLATION IS THE WHOLE POINT — DO NOT WEAKEN IT
# Node resolves a missing module by walking node_modules UPWARD from the file. Run
# the bundle from inside the repo and a missing native resolves out of the REPO's
# node_modules — the broken bundle boots fine and the gate passes vacuously. So we
# copy the bundle to a base with NO node_modules in any ancestor, and REFUSE TO RUN
# if we cannot find one. (This is not theoretical: the first base tried was $HOME,
# and this box has a ~/node_modules that supplied the exact missing native.)
#
# `--ensure` IS SAFE HERE ONLY BECAUSE HOME IS PRIVATE. serve's reconcileEnsure
# reads ~/.papercusp/operator.json and, on a build-identity mismatch, SIGTERM+
# SIGKILLs the operator it finds. Pointed at the real HOME it would kill the live
# operator the whole fleet is using. The private HOME means it finds no discovery
# record, cold-starts, and cannot see — let alone kill — anything real. Never run
# this against the developer's HOME.
#
#   bash bin/gate-sidecar-boots.sh [sidecar-dir]     # exits 0 = boots, 1 = DOA
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
SIDECAR="${1:-$ROOT/src-tauri/sidecar}"
BOOT_TIMEOUT="${PAPERCUSP_BOOT_GATE_TIMEOUT:-180}"

fail() { echo "❌ BOOT GATE FAILED: $*" >&2; exit 1; }

[[ -d "$SIDECAR" ]]            || fail "no sidecar dir at $SIDECAR"
[[ -f "$SIDECAR/serve.mjs" ]]  || fail "no serve.mjs in $SIDECAR"
[[ -x "$SIDECAR/bin/node" ]]   || fail "no BUNDLED node at $SIDECAR/bin/node — the gate must use the node we ship, not the box's"

echo "== boot gate: can the PACKED sidecar actually start?"

# ── 1. An isolation base with NO node_modules above it ────────────────────────
# Without this the box lends the bundle what the bundle failed to carry.
ancestors_clean() {
  local p="$1"
  while [[ "$p" != "/" ]]; do
    [[ -d "$p/node_modules" ]] && { echo "$p/node_modules"; return 1; }
    p="$(dirname "$p")"
  done
  [[ -d /node_modules ]] && { echo "/node_modules"; return 1; }
  return 0
}
dev_of() { df --output=source "$1" 2>/dev/null | tail -1 | tr -d ' '; }

SIDE_DEV="$(dev_of "$SIDECAR")"
ISO_BASE=""
for cand in "${PAPERCUSP_BOOT_GATE_BASE:-}" /var/tmp "${TMPDIR:-/tmp}" /tmp; do
  [[ -n "$cand" && -d "$cand" && -w "$cand" ]] || continue
  if contaminated="$(ancestors_clean "$cand")"; then
    ISO_BASE="$cand"
    # Same device ⇒ `cp -al` hardlinks: instant, and adds no disk (a cut has died
    # on disk pressure before). Keep looking if this base is on another device.
    [[ "$(dev_of "$cand")" == "$SIDE_DEV" ]] && break
  else
    echo "   skipping $cand — contaminated: $contaminated"
  fi
done
[[ -n "$ISO_BASE" ]] || fail "no isolation base free of an ancestor node_modules — the gate cannot prove anything, so it refuses to pass"

ISO="$(mktemp -d "$ISO_BASE/pc-bootgate-XXXXXX")"
cleanup() {
  [[ -n "${PID:-}" ]] && { kill -TERM "-$PID" 2>/dev/null; sleep 1; kill -KILL "-$PID" 2>/dev/null; }
  rm -rf "$ISO"
}
trap cleanup EXIT
echo "   isolated at $ISO (no ancestor node_modules)"

HARDLINKED=0
if cp -al "$SIDECAR" "$ISO/sidecar" 2>/dev/null; then
  HARDLINKED=1
  echo "   bundle hardlinked (same device — no copy, no disk)"
else
  echo "   bundle on another device — real copy (slower)"
  cp -a "$SIDECAR" "$ISO/sidecar" || fail "could not stage the bundle"
fi
B="$ISO/sidecar"
mkdir -p "$ISO/home" "$ISO/pgdata" "$ISO/dev-source"
# Hardlinks share inodes: a sidecar that wrote to its OWN dir IN PLACE would mutate
# the real staged bundle the cut is about to pack. It doesn't today (the shipped
# sidecar lives read-only under /usr/lib, so it can't), and this marker proves it
# still doesn't — rather than trusting that it never will.
touch "$ISO/.before-boot"

# ── 2. Boot it the way the product does ───────────────────────────────────────
# Mirrors the sidecar spawn env in src-tauri/src/main.rs. Without the resource
# paths, serve falls back to REPO-RELATIVE defaults that do not exist inside a
# bundle, and dies on missing migrations — a gate artifact that looks exactly
# like a real failure. If main.rs gains a resource path, add it here too; the
# drift check below prints the ones we do not pass.
HTTP_PORT=$(( 20000 + RANDOM % 20000 ))
PG_PORT=$((  40000 + RANDOM % 20000 ))
echo "   booting bundled node $("$B/bin/node" --version) → http :$HTTP_PORT, pg :$PG_PORT"

set -m
env -i \
  HOME="$ISO/home" \
  PATH="$B/bin:/usr/bin:/bin" \
  LANG=C.UTF-8 TERM=dumb \
  PAPERCUSP_DESKTOP=1 \
  PAPERCUSP_SERVE_UI=0 \
  PAPERCUSP_HONO_PORT="$HTTP_PORT" \
  PAPERCUSP_PG_PORT="$PG_PORT" \
  PAPERCUSP_PG_DATA_DIR="$ISO/pgdata" \
  PAPERCUSP_PG_SQL_DIR="$B/db-sql" \
  PAPERCUSP_PG_SEED_PATH="$B/db-seed.tar.gz" \
  PAPERCUSP_SEED_DIR="$B/../seed" \
  PAPERCUSP_HARNESS_DIR="$B/harness" \
  PAPERCUSP_RUBRICS_DIR="$B/rubrics" \
  PAPERCUSP_PROMPTS_DIR="$B/prompts" \
  PAPERCUSP_DOCS_ROOT="$B/internal-docs" \
  PAPERCUSP_SOURCE_ARCHIVE="$B/source.tar.zst" \
  PAPERCUSP_DEV_SOURCE_DIR="$ISO/dev-source" \
  "$B/bin/node" "$B/serve.mjs" --ensure > "$ISO/boot.log" 2>&1 &
PID=$!

# ── 3. It must SERVE. Exiting is death; silence until the deadline is death. ──
deadline=$(( $(date +%s) + BOOT_TIMEOUT ))
served=0
while [[ $(date +%s) -lt $deadline ]]; do
  if ! kill -0 "$PID" 2>/dev/null; then
    wait "$PID"; rc=$?
    echo "── last 25 lines of the packed sidecar's boot log ──" >&2
    tail -25 "$ISO/boot.log" >&2
    fail "the packed sidecar EXITED (rc=$rc) instead of serving. This bundle is DOA on any machine that lacks a fallback operator."
  fi
  if curl -sf -m 2 -o /dev/null "http://127.0.0.1:$HTTP_PORT/api/" 2>/dev/null; then
    served=1; break
  fi
  sleep 2
done

if [[ $served -ne 1 ]]; then
  echo "── last 25 lines of the packed sidecar's boot log ──" >&2
  tail -25 "$ISO/boot.log" >&2
  fail "the packed sidecar never served on :$HTTP_PORT within ${BOOT_TIMEOUT}s — treating silence as failure, not success."
fi

if [[ $HARDLINKED -eq 1 ]]; then
  touched="$(find "$SIDECAR" -newer "$ISO/.before-boot" -type f 2>/dev/null | head -5)"
  [[ -n "$touched" ]] && fail "the booted sidecar wrote INTO ITS OWN BUNDLE DIR, and hardlinks made that a write to the REAL staged bundle:
$touched
  Re-run with PAPERCUSP_BOOT_GATE_BASE set to a dir on ANOTHER device (forces a real copy). The cut must not pack a bundle this gate mutated."
fi

echo "✅ BOOT GATE PASSED — the packed sidecar cold-started and served, with no fallback operator to lean on."

# ── 4. Drift check: has the product's spawn env grown a resource path we omit? ─
# A gate that silently stops matching the product's spawn is a gate that stops
# proving anything. Advisory (a new var is usually optional), but never silent.
MAIN_RS="$ROOT/src-tauri/src/main.rs"
if [[ -f "$MAIN_RS" ]]; then
  missing=""
  for v in $(grep -oE '"PAPERCUSP_[A-Z_]*(DIR|PATH|ROOT|ARCHIVE)"' "$MAIN_RS" | tr -d '"' | sort -u); do
    grep -q "$v=" "${BASH_SOURCE[0]}" || missing="$missing $v"
  done
  [[ -n "$missing" ]] && echo "   ⚠ drift: main.rs passes the sidecar resource path(s)$missing that this gate does not — if a boot failure looks bogus, start here."
fi
exit 0
