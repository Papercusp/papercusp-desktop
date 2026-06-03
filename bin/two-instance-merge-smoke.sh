#!/usr/bin/env bash
# two-instance-merge-smoke.sh — packaged cross-process federation MERGE proof.
#
# The companion to two-instance-federation-smoke.sh (which proves boot+isolation
# +discovery). This one proves the actual write-free MERGE: a feature written on
# instance A federates into instance B's PG, gated by the REAL write-free
# admission (per-identity attestation gist + signed announce — NO shared-repo
# write), between two SEPARATELY-PACKAGED desktop processes on one box.
#
# Why this became possible (non-collaborator-join-fork-pr-2026-06-02, "A3"):
#   Joining is now WRITE-FREE — admission verifies the device↔github binding from
#   the announced attestation GIST + signed announce, not a contributor file
#   written to the shared repo. So a SYNTHETIC github_repository_id is fine: it
#   only seeds the swarm topic; each peer self-publishes its own gist. The old
#   smoke's "a synthetic repo id can't publish a binding → no merge" ceiling is
#   gone (share/finalize returns bindingPublished:true on a synthetic repo).
#
# How same-box discovery is made deterministic:
#   Two Hyperswarm instances on ONE box can't reliably holepunch to their own
#   public IP over the PUBLIC DHT (NAT hairpinning) — which is why the in-process
#   p079 live test uses a local `hyperdht/testnet`. This smoke does the same for
#   the PACKAGED app via PAPERCUSP_DHT_BOOTSTRAP (added to swarm.ts): it spins a
#   local testnet DHT and points BOTH instances at it, so they discover each
#   other over loopback. *** REQUIRES a .deb built from a tree that includes the
#   swarm.ts PAPERCUSP_DHT_BOOTSTRAP support + the boot.ts [swarm] logs. *** On an
#   older .deb the env is ignored (public DHT) and discovery may not occur.
#
# Identities: A=papercupai, B=aviynw (distinct, via per-instance GH_TOKEN), the
#   same real pair the p079 live test uses. Override with P_A_USER / P_B_USER.
#
# Usage:
#   bin/two-instance-merge-smoke.sh [path/to/Papercusp_*.deb] [synthetic_repo_id]
set -uo pipefail

DEB="${1:-$(dirname "$0")/../src-tauri/target/release/bundle/deb/Papercusp_0.0.1_amd64.deb}"
SYNTH_REPO_ID="${2:-918273645}"
P_A_USER="${P_A_USER:-papercupai}"
P_B_USER="${P_B_USER:-aviynw}"
OPERATOR_DIR="${PAPERCUSP_OPERATOR_DIR:-/home/marsh-office/papercupai-workspace/papercup/apps/operator}"
DISPLAY_NUM="${PAPERCUSP_SMOKE_DISPLAY:-148}"
WORK="$(mktemp -d /tmp/merge-smoke.XXXXXX)"
PKG="$WORK/pkg"; BIN="$PKG/usr/bin/papercusp-desktop"
A_HOME="$WORK/inst-a"; B_HOME="$WORK/inst-b"; A_LOG="$WORK/a.log"; B_LOG="$WORK/b.log"
declare -a KILL_PIDS=()
log(){ printf '\n=== %s ===\n' "$*"; }

cleanup() {
  log "cleanup (scoped to $WORK)"
  for p in "${KILL_PIDS[@]:-}"; do [ -n "$p" ] && kill -9 "$p" 2>/dev/null || true; done
  # SCOPED: only procs whose cmdline contains THIS run's $WORK (never a broad
  # `pkill -f papercusp-desktop`, which would hit peers' dev desktops).
  ps -eo pid,args 2>/dev/null | grep -F "$WORK" | grep -v grep | awk '{print $1}' | xargs -r kill -9 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
}
trap cleanup EXIT

# ── tokens (distinct identities) ───────────────────────────────────────────────
A_TOKEN="$(gh auth token --user "$P_A_USER" 2>/dev/null)" || true
B_TOKEN="$(gh auth token --user "$P_B_USER" 2>/dev/null)" || true
[ -n "$A_TOKEN" ] && [ -n "$B_TOKEN" ] || { echo "FATAL: need gh tokens for $P_A_USER + $P_B_USER (gh auth login)"; exit 1; }

# ── extract + clobber pre-check ────────────────────────────────────────────────
log "extract $DEB"
[ -f "$DEB" ] || { echo "FATAL: .deb not found: $DEB"; exit 1; }
mkdir -p "$PKG"; dpkg-deb -x "$DEB" "$PKG"
[ -x "$BIN" ] || { echo "FATAL: binary missing: $BIN"; exit 1; }
SIDE="$PKG/usr/lib/Papercusp/sidecar"
for f in "$SIDE/host.mjs" "$SIDE/embedded-postgres-server/bin/embedded-postgres-server.mjs" "$SIDE/spa/index.html"; do
  sz=$(stat -c%s "$f" 2>/dev/null || echo 0)
  [ "$sz" -gt 0 ] || { echo "FATAL: .deb CLOBBERED (0-byte $f) — rebuild with bin/release-local.sh"; exit 2; }
done

# ── headless display (dedicated — never share a peer's :99/:100/...) ───────────
if DISPLAY=":$DISPLAY_NUM" xdpyinfo >/dev/null 2>&1; then echo "FATAL: :$DISPLAY_NUM busy — set PAPERCUSP_SMOKE_DISPLAY to a free one"; exit 1; fi
log "start Xvfb :$DISPLAY_NUM"
Xvfb ":$DISPLAY_NUM" -screen 0 1280x1024x24 >"$WORK/xvfb.log" 2>&1 & KILL_PIDS+=("$!"); sleep 2

# ── local testnet DHT (deterministic same-box discovery) ───────────────────────
log "spin local testnet DHT (hyperdht/testnet)"
( cd "$OPERATOR_DIR" && node --input-type=module -e '
  import createTestnet from "hyperdht/testnet.js";
  const t = await createTestnet(3);
  console.log("BOOTSTRAP=" + t.bootstrap.map(b => b.host + ":" + b.port).join(","));
  process.stdin.resume();
' ) >"$WORK/dht.log" 2>&1 & KILL_PIDS+=("$!")
BOOTSTRAP=""
for i in $(seq 1 20); do
  BOOTSTRAP=$(grep -oE 'BOOTSTRAP=[^ ]+' "$WORK/dht.log" 2>/dev/null | head -1 | cut -d= -f2)
  [ -n "$BOOTSTRAP" ] && break; sleep 1
done
[ -n "$BOOTSTRAP" ] || { echo "FATAL: testnet DHT did not start"; cat "$WORK/dht.log"; exit 3; }
echo "PAPERCUSP_DHT_BOOTSTRAP=$BOOTSTRAP"

# ── launch one isolated packaged instance with a specific identity + the testnet ─
launch() { # home logf token
  local home="$1" logf="$2" token="$3"
  mkdir -p "$home/.config"; ln -sf "$HOME/.config/gh" "$home/.config/gh"
  ( cd "$PKG/usr/bin"
    DISPLAY=":$DISPLAY_NUM" HOME="$home" GH_TOKEN="$token" \
      PAPERCUSP_DHT_BOOTSTRAP="$BOOTSTRAP" \
      PATH="$(dirname "$(command -v node)"):$PATH" \
      setsid nohup vglrun -d egl0 "$BIN" >"$logf" 2>&1 < /dev/null ) &
  KILL_PIDS+=("$!")
}
log "launch A ($P_A_USER) + B ($P_B_USER)"; launch "$A_HOME" "$A_LOG" "$A_TOKEN"; launch "$B_HOME" "$B_LOG" "$B_TOKEN"

# ── wait for boot; capture PG + sidecar ports + admin DSN ──────────────────────
wait_boot() { # logf -> "PG_PORT SIDECAR_PORT"
  local logf="$1" i pg sc
  for i in $(seq 1 50); do
    pg=$(grep -oE 'ready on localhost:[0-9]+ db=papercusp' "$logf" 2>/dev/null | grep -oE '[0-9]+' | tail -1)
    sc=$(grep -oE 'hono-host\] listening on http://127\.0\.0\.1:[0-9]+' "$logf" 2>/dev/null | grep -oE '[0-9]+' | tail -1)
    [ -n "$pg" ] && [ -n "$sc" ] && { echo "$pg $sc"; return 0; }
    grep -qiE 'falling through to pglite|initdb may have failed' "$logf" 2>/dev/null && { echo FAIL; return 1; }
    sleep 3
  done; echo TIMEOUT; return 1
}
A_PORTS=$(wait_boot "$A_LOG") || { echo "A boot failed: $A_PORTS"; tail -20 "$A_LOG"; exit 4; }
B_PORTS=$(wait_boot "$B_LOG") || { echo "B boot failed: $B_PORTS"; tail -20 "$B_LOG"; exit 4; }
A_PG=${A_PORTS%% *}; A_SC=${A_PORTS##* }; B_PG=${B_PORTS%% *}; B_SC=${B_PORTS##* }
A_DB="postgresql://harness_admin:harness_admin_pwd@localhost:$A_PG/papercusp"
B_DB="postgresql://harness_admin:harness_admin_pwd@localhost:$B_PG/papercusp"
log "A: PG=$A_PG sc=$A_SC | B: PG=$B_PG sc=$B_SC"
[ "$A_PG" != "$B_PG" ] && [ "$A_SC" != "$B_SC" ] || { echo "FATAL: not isolated"; exit 5; }

# ── register a harness + share write-free on BOTH (same synthetic repo id) ──────
TOPIC=$(printf 'papercusp-substrate-v1:gh:%s' "$SYNTH_REPO_ID" | sha256sum | cut -d' ' -f1)
SLUG=mergesmoke
share() { # sidecar_port folder
  curl -s -m 60 -X POST "http://127.0.0.1:$1/api/harness/projects" -H 'content-type: application/json' \
    -d "{\"slug\":\"$SLUG\",\"parentDir\":\"$WORK\",\"folderName\":\"$2\"}" >/dev/null
  curl -s -m 90 -X POST "http://127.0.0.1:$1/api/harness/$SLUG/share/finalize" -H 'content-type: application/json' \
    -d "{\"state\":{\"topic\":\"$TOPIC\",\"github_repository_id\":$SYNTH_REPO_ID,\"github_remote\":\"https://github.com/$P_A_USER/$SLUG\",\"privacy\":\"shared-private\"}}"
}
log "register + share write-free on both (topic=${TOPIC:0:16}…)"
echo "A: $(share "$A_SC" proj-a | grep -oE '"bindingPublished":[a-z]+|"state":"[a-z-]+"')"
echo "B: $(share "$B_SC" proj-b | grep -oE '"bindingPublished":[a-z]+|"state":"[a-z-]+"')"

# ── wait for mutual swarm admission ([swarm] peer_connected — now logged) ───────
log "wait for swarm peer discovery + admission (~90s)"
disc=0
for i in $(seq 1 30); do
  if grep -qE '\[swarm\] peer_connected' "$A_LOG" "$B_LOG" 2>/dev/null; then disc=1; break; fi
  if grep -qE '\[swarm\] join FAILED' "$A_LOG" "$B_LOG" 2>/dev/null; then
    echo "✗ swarm join FAILED — see logs:"; grep -E '\[swarm\] join FAILED' "$A_LOG" "$B_LOG"; break; fi
  sleep 3
done
[ "$disc" = 1 ] && echo "✓ peers discovered each other" || echo "⚠ no peer_connected in ~90s"

# ── A→B MERGE: write a feature on A, assert it federates into B's PG ────────────
TS=$(date +%s)000
log "A→B: INSERT feature on A (origin=local) → expect origin=remote in B"
psql "$A_DB" -tA -c "INSERT INTO harness_shared.harness_features_consolidated (harness_slug,feature_id,title,summary,status,attempts,origin,ts,created_ts,updated_ts) VALUES ('$SLUG','F-A2B','from $P_A_USER','merge proof','todo',0,'local',$TS,$TS,$TS);" >/dev/null
ab=0
for i in $(seq 1 30); do
  row=$(psql "$B_DB" -tA -c "SELECT origin FROM harness_shared.harness_features_consolidated WHERE harness_slug='$SLUG' AND feature_id='F-A2B';" 2>/dev/null)
  [ "$row" = "remote" ] && { ab=1; break; }; sleep 3
done
[ "$ab" = 1 ] && echo "✓ A→B MERGE: F-A2B federated into B as origin=remote" || echo "✗ A→B: F-A2B not in B after ~90s"

# ── B→A MERGE (symmetric) ───────────────────────────────────────────────────────
log "B→A: INSERT feature on B → expect origin=remote in A"
psql "$B_DB" -tA -c "INSERT INTO harness_shared.harness_features_consolidated (harness_slug,feature_id,title,summary,status,attempts,origin,ts,created_ts,updated_ts) VALUES ('$SLUG','F-B2A','from $P_B_USER','merge proof','in-progress',0,'local',$TS,$TS,$TS);" >/dev/null
ba=0
for i in $(seq 1 30); do
  row=$(psql "$A_DB" -tA -c "SELECT origin FROM harness_shared.harness_features_consolidated WHERE harness_slug='$SLUG' AND feature_id='F-B2A';" 2>/dev/null)
  [ "$row" = "remote" ] && { ba=1; break; }; sleep 3
done
[ "$ba" = 1 ] && echo "✓ B→A MERGE: F-B2A federated into A as origin=remote" || echo "✗ B→A: F-B2A not in A after ~90s"

# ── report ───────────────────────────────────────────────────────────────────────
log "RESULT"
echo "discovery=$([ $disc = 1 ] && echo PASS || echo FAIL)  A→B-merge=$([ $ab = 1 ] && echo PASS || echo FAIL)  B→A-merge=$([ $ba = 1 ] && echo PASS || echo FAIL)"
[ "$disc" = 1 ] && [ "$ab" = 1 ] && [ "$ba" = 1 ] && { echo "OVERALL: PASS — write-free packaged merge proven"; exit 0; } || { echo "OVERALL: INCOMPLETE — see [swarm] log lines in $A_LOG / $B_LOG"; exit 6; }
