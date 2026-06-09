#!/usr/bin/env bash
# two-instance-hive-directory-smoke.sh — packaged P2P HIVE DIRECTORY proof.
#
# The directory sibling of two-instance-merge-smoke.sh: two SEPARATELY-PACKAGED
# desktop instances on one box, distinct GitHub identities, isolated local
# testnet DHT (PAPERCUSP_DHT_BOOTSTRAP) — instance A publishes a hive listing
# (discovery:set_hive → signed announce on the global directory topic) and the
# smoke asserts it appears in instance B's directory (GET /api/discovery/hives)
# with title/owner/member-links intact, and symmetrically B's hive on A.
#
# This is the FULL-APP-STACK version of the in-process live E2E
# (hive-directory-live-two-peer.test.ts): real per-instance identity resolution
# + attestation gists, the real boot-join (boot-all → wireHiveDirectoryForWorkspace,
# with the lazy ensureHiveDirectoryWired fallback), the real MCP tool + HTTP
# endpoint — everything short of two physical machines on the public DHT
# (same-host holepunch never completes; the testnet DHT is the documented
# substitute — see agent-insights/standalone-hyperswarm-discovery-driver).
#
# REQUIRES a .deb built from a tree that includes the directory transport fixes
# (createDirectoryGossip — p2p-hive-directory D-007); enforced by a static grep.
#
# Usage:
#   bin/two-instance-hive-directory-smoke.sh [path/to/Papercusp_*.deb]
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/federation-asserts.sh"

DEB="${1:-$(dirname "$0")/../src-tauri/target/release/bundle/deb/Papercusp_0.0.1_amd64.deb}"
P_A_USER="${P_A_USER:-papercupai}"
P_B_USER="${P_B_USER:-aviynw}"
OPERATOR_DIR="${PAPERCUSP_OPERATOR_DIR:-/home/marsh-office/papercupai-workspace/papercup/apps/operator}"
DISPLAY_NUM="${PAPERCUSP_SMOKE_DISPLAY:-149}"
WORK="$(mktemp -d /tmp/hive-dir-smoke.XXXXXX)"
PKG="$WORK/pkg"; BIN="$PKG/usr/bin/papercusp-desktop"
A_HOME="$WORK/inst-a"; B_HOME="$WORK/inst-b"
FED_LOG[a]="$WORK/a.log"; FED_LOG[b]="$WORK/b.log"
log() { fed_log "$@"; }

cleanup() { log "cleanup (scoped to $WORK)"; fed_cleanup_scoped "$WORK"; }
trap cleanup EXIT

# ── tokens (distinct identities) ───────────────────────────────────────────────
A_TOKEN="$(gh auth token --user "$P_A_USER" 2>/dev/null)" || true
B_TOKEN="$(gh auth token --user "$P_B_USER" 2>/dev/null)" || true
[ -n "$A_TOKEN" ] && [ -n "$B_TOKEN" ] || { echo "FATAL: need gh tokens for $P_A_USER + $P_B_USER (gh auth login)"; exit 1; }

# ── extract + clobber pre-check + swarm/directory support fail-fast ────────────
log "extract $DEB"
fed_extract_deb "$DEB" "$PKG" || exit 1
fed_clobber_check "$PKG" || exit 2
fed_assert_deb_swarm_support "$PKG" || exit 2
if ! grep -rqs "createDirectoryGossip" "$PKG/usr/lib/Papercusp/sidecar/serve.mjs" 2>/dev/null \
  && ! grep -rqls "createDirectoryGossip" "$PKG/usr/lib/Papercusp/sidecar" 2>/dev/null | head -1 | grep -q .; then
  echo "FATAL: packaged sidecar lacks the directory transport (createDirectoryGossip) — rebuild the .deb from a tree with p2p-hive-directory D-007"
  exit 2
fi

# ── headless display (dedicated — never share a peer's :99/:100/:148) ──────────
fed_fresh_display "$DISPLAY_NUM" "$WORK" || exit 1

# ── local testnet DHT (deterministic same-box discovery) ───────────────────────
BOOTSTRAP="$(fed_start_testnet_dht "$OPERATOR_DIR" "$WORK")" || exit 3
echo "PAPERCUSP_DHT_BOOTSTRAP=$BOOTSTRAP"

# ── launch two isolated packaged instances with distinct identities ────────────
log "launch A ($P_A_USER) + B ($P_B_USER)"
fed_local_launch "$A_HOME" "${FED_LOG[a]}" "$BIN" "$DISPLAY_NUM" GH_TOKEN="$A_TOKEN" PAPERCUSP_DHT_BOOTSTRAP="$BOOTSTRAP"
fed_local_launch "$B_HOME" "${FED_LOG[b]}" "$BIN" "$DISPLAY_NUM" GH_TOKEN="$B_TOKEN" PAPERCUSP_DHT_BOOTSTRAP="$BOOTSTRAP"

fed_wait_boot a 50 || { echo "A boot failed: $FED_BOOT_ERR"; tail -20 "${FED_LOG[a]}"; exit 4; }
fed_wait_boot b 50 || { echo "B boot failed: $FED_BOOT_ERR"; tail -20 "${FED_LOG[b]}"; exit 4; }
FED_DB[a]="postgresql://harness_admin:harness_admin_pwd@localhost:${FED_PG[a]}/papercusp"
FED_DB[b]="postgresql://harness_admin:harness_admin_pwd@localhost:${FED_PG[b]}/papercusp"
log "A: PG=${FED_PG[a]} sc=${FED_SC[a]} | B: PG=${FED_PG[b]} sc=${FED_SC[b]}"
fed_assert_isolated a b || exit 5
fed_wait_api a 30 || { echo "A sidecar API never came up"; exit 4; }
fed_wait_api b 30 || { echo "B sidecar API never came up"; exit 4; }

# ── helpers: per-instance MCP tool call + directory listing ─────────────────────

# dir_set_hive <inst> <home> <hiveId> <title> — publish a public hive listing on
# one instance via its own MCP surface (superuser bearer is self-provisioned at
# boot under that instance's HOME). Echoes the tool's JSON result text.
dir_set_hive() {
  local inst="$1" home="$2" hive_id="$3" title="$4" tok
  tok="$(cat "$home/.papercusp/superuser-token" 2>/dev/null)" || true
  [ -n "$tok" ] || { echo '{"error":"no superuser-token under instance HOME"}'; return 1; }
  curl -s -m 30 -X POST "http://127.0.0.1:${FED_SC[$inst]}/api/mcp?superuser=1" \
    -H "Authorization: Bearer $tok" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"discovery:set_hive\",\"arguments\":{\"hiveId\":\"$hive_id\",\"title\":\"$title\",\"description\":\"packaged two-instance directory smoke\",\"visibility\":\"public\",\"memberLinks\":[\"papercusp://harness?topic=$(printf 'a%.0s' {1..64})&repo=918273645\"]}}}" \
    | grep -o '"text":"{[^}]*}*"' | head -1
}

# dir_list <inst> — the instance's discovered-hive list (loopback HTTP route).
dir_list() {
  local inst="$1"
  curl -s -m 10 "http://127.0.0.1:${FED_SC[$inst]}/api/discovery/hives"
}

# dir_wait_listed <inst> <hiveId> <owner> [tries] — poll an instance's directory
# until the hive appears (verified announce ingested over the testnet wire).
dir_wait_listed() {
  local inst="$1" hive_id="$2" owner="$3" tries="${4:-40}" i body
  for i in $(seq 1 "$tries"); do
    body="$(dir_list "$inst")"
    if echo "$body" | grep -q "\"hiveId\":\"$hive_id\"" && echo "$body" | grep -q "\"owner\":\"$owner\""; then
      echo 1; return 0
    fi
    sleep 3
  done
  echo 0; return 1
}

# ── A publishes → B lists; B publishes → A lists ───────────────────────────────
log "A ($P_A_USER): publish hive-from-a to the directory"
resA="$(dir_set_hive a "$A_HOME" hive-from-a "Alpha live hive ($P_A_USER)")"
echo "A set_hive → $resA"
log "B ($P_B_USER): publish hive-from-b to the directory"
resB="$(dir_set_hive b "$B_HOME" hive-from-b "Beta live hive ($P_B_USER)")"
echo "B set_hive → $resB"

log "wait: B's directory lists hive-from-a (announce crossed the wire + verified)"
ab="$(dir_wait_listed b hive-from-a "$P_A_USER" 40 || true)"
[ "$ab" = 1 ] && echo "✓ A→B: hive-from-a listed on B (owner=$P_A_USER)" || { echo "✗ A→B: hive-from-a never listed on B"; echo "B directory: $(dir_list b | head -c 400)"; }

log "wait: A's directory lists hive-from-b (reverse direction)"
ba="$(dir_wait_listed a hive-from-b "$P_B_USER" 40 || true)"
[ "$ba" = 1 ] && echo "✓ B→A: hive-from-b listed on A (owner=$P_B_USER)" || { echo "✗ B→A: hive-from-b never listed on A"; echo "A directory: $(dir_list a | head -c 400)"; }

# member-links must survive the announce → ingest → HTTP projection round-trip.
links_ok=0
if [ "$ab" = 1 ] && dir_list b | grep -q "papercusp://harness?topic=aaaa"; then links_ok=1; fi
[ "$links_ok" = 1 ] && echo "✓ member-links intact on B's listing" || echo "✗ member-links missing on B's listing"

# ── report ───────────────────────────────────────────────────────────────────────
log "RESULT"
echo "A→B-listed=$([ "$ab" = 1 ] && echo PASS || echo FAIL)  B→A-listed=$([ "$ba" = 1 ] && echo PASS || echo FAIL)  member-links=$([ "$links_ok" = 1 ] && echo PASS || echo FAIL)"
if [ "$ab" = 1 ] && [ "$ba" = 1 ] && [ "$links_ok" = 1 ]; then
  echo "OVERALL: PASS — packaged two-instance hive directory proven"
  exit 0
else
  echo "OVERALL: INCOMPLETE — check [hive-directory]/[swarm] lines in ${FED_LOG[a]} / ${FED_LOG[b]}"
  grep -iE "hive-directory|\[swarm\]" "${FED_LOG[a]}" 2>/dev/null | tail -8
  grep -iE "hive-directory|\[swarm\]" "${FED_LOG[b]}" 2>/dev/null | tail -8
  exit 6
fi
