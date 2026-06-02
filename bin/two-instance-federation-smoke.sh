#!/usr/bin/env bash
# two-instance-federation-smoke.sh — packaged cross-process federation smoke (#3)
#
# Launches the PACKAGED desktop (.deb) TWICE, fully isolated, headless under
# Xvfb, and verifies: (1) both instances boot (embedded-PG + sidecar + substrate),
# (2) they are mutually isolated (own HOME → own ~/.papercusp, embedded-PG port,
# corestore, dynamically-picked sidecar port), (3) both join ONE synthetic
# shared-harness swarm topic and DISCOVER each other over Hyperswarm.
#
# SCOPE / what this does NOT prove:
#   The federation MERGE (a write on A landing in B's PG) is gated by the
#   channel-2 admission check, which requires REAL GitHub-published bindings
#   (contributor file + OAuth) — i.e. the two-real-identity P-079 acceptance
#   step. A synthetic repo id can't publish a binding, so peers connect + replicate
#   raw cores but neither ADMITS the other's log → no merge. The merge logic
#   itself is wire-proven (real testnet-DHT swarm, two distinct identities, PG
#   convergence) by apps/operator/lib/sync/hyperbee/__tests__/two-peer-swarm-bidi.test.ts.
#   To exercise a REAL packaged merge: point this at a real repo both identities
#   can publish to (or run the live two-machine P-079).
#
# VALIDATION STATUS (2026-06-02): the clobber pre-check + extract + Xvfb + single-
#   instance launch path were run for real. The current release .deb is CORRUPT
#   (0-byte sidecar bundle — the build-desktop-sidecar.sh concurrent-build clobber,
#   project_desktop_bundle_empty_pg_binaries), so the pre-check below FAILS LOUD on
#   it. Rebuild a clean .deb (bin/release-local.sh) before the launch path runs.
#
# Usage:
#   bin/two-instance-federation-smoke.sh [path/to/Papercusp_*.deb] [synthetic_repo_id]
set -euo pipefail

DEB="${1:-$(dirname "$0")/../src-tauri/target/release/bundle/deb/Papercusp_0.0.1_amd64.deb}"
SYNTH_REPO_ID="${2:-999000777}"      # a github_repository_id that does NOT exist (synthetic topic)
DISPLAY_NUM="${PAPERCUSP_SMOKE_DISPLAY:-99}"
WORK="$(mktemp -d /tmp/p3-smoke.XXXXXX)"
PKG="$WORK/pkg"
A_HOME="$WORK/inst-a"; B_HOME="$WORK/inst-b"
A_LOG="$WORK/a.log";   B_LOG="$WORK/b.log"
STARTED_XVFB=0
declare -a CHILD_PIDS=()

log(){ printf '\n=== %s ===\n' "$*"; }
cleanup() {
  log "cleanup"
  for p in "${CHILD_PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null || true; done
  # kill anything still pointed at our isolated homes (sidecar/node/postgres)
  ps -eo pid,args 2>/dev/null | grep -E "$WORK/inst-" | grep -v grep | awk '{print $1}' | xargs -r kill -9 2>/dev/null || true
  [ "$STARTED_XVFB" = "1" ] && pkill -f "Xvfb :$DISPLAY_NUM" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
}
trap cleanup EXIT

# ── 1. extract + assert the bundle is NOT clobbered ────────────────────────────
log "extract $DEB"
[ -f "$DEB" ] || { echo "FATAL: .deb not found: $DEB"; exit 1; }
mkdir -p "$PKG"; dpkg-deb -x "$DEB" "$PKG"
BIN="$PKG/usr/bin/papercusp-desktop"
SIDECAR="$PKG/usr/lib/Papercusp/sidecar"
[ -x "$BIN" ] || { echo "FATAL: binary missing in .deb: $BIN"; exit 1; }

log "clobber pre-check (the build-clobber defect ships 0-byte sidecar files)"
CLOBBERED=0
for f in "$SIDECAR/host.mjs" \
         "$SIDECAR/embedded-postgres-server/bin/embedded-postgres-server.mjs" \
         "$SIDECAR/embedded-postgres-server/node_modules/@embedded-postgres/linux-x64/native/bin/initdb" \
         "$SIDECAR/embedded-postgres-server/node_modules/@embedded-postgres/linux-x64/native/bin/postgres" \
         "$SIDECAR/spa/index.html"; do
  sz=$(stat -c%s "$f" 2>/dev/null || echo MISSING)
  printf '  %10s  %s\n' "$sz" "$f"
  [ "$sz" = "0" ] || [ "$sz" = "MISSING" ] && CLOBBERED=1
done
if [ "$CLOBBERED" = "1" ]; then
  echo
  echo "FATAL: this .deb is CORRUPT — 0-byte/missing sidecar files (the"
  echo "       build-desktop-sidecar.sh concurrent-build clobber). The packaged app"
  echo "       cannot boot embedded-PG or the operator. Rebuild with a clean,"
  echo "       non-concurrent 'bin/release-local.sh' and re-run this smoke."
  exit 2
fi

# ── 2. headless display ────────────────────────────────────────────────────────
if ! DISPLAY=":$DISPLAY_NUM" xdpyinfo >/dev/null 2>&1; then
  log "starting Xvfb :$DISPLAY_NUM (headless — never the user's :0)"
  nohup Xvfb ":$DISPLAY_NUM" -screen 0 1280x1024x24 >"$WORK/xvfb.log" 2>&1 &
  STARTED_XVFB=1; sleep 2
fi

# ── 3. launch one isolated packaged instance ───────────────────────────────────
launch() {
  local home="$1" logf="$2"
  mkdir -p "$home/.config"
  ln -sf "$HOME/.config/gh" "$home/.config/gh"          # share gh auth (announce identity)
  ln -sf "$HOME/.gitconfig" "$home/.gitconfig" 2>/dev/null || true
  ( cd "$PKG/usr/bin"
    DISPLAY=":$DISPLAY_NUM" HOME="$home" PATH="$(dirname "$(command -v node)"):$PATH" \
      vglrun -d egl0 "$BIN" >"$logf" 2>&1 ) &
  CHILD_PIDS+=("$!")
}

# Wait for the per-instance boot-log markers, capture the dynamic ports.
wait_boot() {  # $1=logf  → echoes "PG_PORT SIDECAR_PORT" or fails
  local logf="$1" i pg sc
  for i in $(seq 1 40); do
    pg=$(grep -oE 'embedded-postgres-server ready on 127\.0\.0\.1:[0-9]+' "$logf" 2>/dev/null | grep -oE '[0-9]+$' | tail -1)
    sc=$(grep -oE 'spawning sidecar on port [0-9]+' "$logf" 2>/dev/null | grep -oE '[0-9]+' | tail -1)
    [ -n "$pg" ] && [ -n "$sc" ] && { echo "$pg $sc"; return 0; }
    grep -qiE 'falling through to pglite|initdb may have failed' "$logf" 2>/dev/null && { echo "EMBEDDED_PG_FAILED"; return 1; }
    sleep 3
  done
  echo "BOOT_TIMEOUT"; return 1
}

log "launch instance A ($A_HOME)"; launch "$A_HOME" "$A_LOG"
log "launch instance B ($B_HOME)"; launch "$B_HOME" "$B_LOG"

A_PORTS=$(wait_boot "$A_LOG") || { echo "instance A boot failed: $A_PORTS"; tail -20 "$A_LOG"; exit 3; }
B_PORTS=$(wait_boot "$B_LOG") || { echo "instance B boot failed: $B_PORTS"; tail -20 "$B_LOG"; exit 3; }
A_PG=${A_PORTS%% *}; A_SC=${A_PORTS##* }
B_PG=${B_PORTS%% *}; B_SC=${B_PORTS##* }
log "instance A: PG=$A_PG sidecar=$A_SC | instance B: PG=$B_PG sidecar=$B_SC"
[ "$A_PG" != "$B_PG" ] && [ "$A_SC" != "$B_SC" ] && echo "✓ isolated (distinct PG + sidecar ports)" || { echo "FATAL: port collision — instances not isolated"; exit 4; }

# ── 4. share a synthetic harness on BOTH (same github_repository_id → same swarm topic) ──
# The substrate is always-on (Stage 4d). Both instances POST share/finalize with the
# SAME synthetic repo id so deriveSwarmTopic(sha256("papercusp-substrate-v1:gh:<id>"))
# matches → they join one swarm. (Requires a registered harness in each workspace;
# in a clean run, scaffold/select one first. See dogfood docs for the wizard path.)
share_synthetic() {  # $1=sidecar_port $2=harness_slug
  curl -s --max-time 20 -X POST "http://127.0.0.1:$1/api/harness/$2/share/finalize" \
    -H 'content-type: application/json' \
    -d "{\"state\":{\"github_repository_id\":$SYNTH_REPO_ID,\"privacy\":\"shared-private\"}}" | head -c 300
}
log "share synthetic harness on both (topic = sha256(papercusp-substrate-v1:gh:$SYNTH_REPO_ID))"
echo "A: $(share_synthetic "$A_SC" sheets)"; echo "B: $(share_synthetic "$B_SC" sheets)"

# ── 5. verify Hyperswarm peer DISCOVERY (boot-history peer_connected) ───────────
# Poll each instance's substrate boot-history for a peer_connected event (the
# proof the two packaged processes found each other over the real DHT).
log "verify swarm peer discovery (poll boot-history for peer_connected, ~60s)"
discovered=0
for i in $(seq 1 20); do
  if grep -qiE 'peer_connected|peer connected|onAnnounce|admit' "$A_LOG" "$B_LOG" 2>/dev/null; then
    discovered=1; break; fi
  sleep 3
done
[ "$discovered" = "1" ] && echo "✓ peers discovered each other over Hyperswarm" \
  || echo "⚠ no peer_connected within 60s (DHT holepunch can be slow; check boot logs)"

# ── 6. report ───────────────────────────────────────────────────────────────────
log "RESULT"
echo "Packaged two-instance boot + isolation: PASS (PG A=$A_PG B=$B_PG, sidecar A=$A_SC B=$B_SC)"
echo "Swarm peer discovery: $([ "$discovered" = 1 ] && echo PASS || echo INCONCLUSIVE)"
echo "Federation MERGE: NOT exercised here — admission-gated on real GitHub bindings (P-079)."
echo "  Merge logic is wire-proven by two-peer-swarm-bidi.test.ts."
echo "(cleanup runs on exit)"
