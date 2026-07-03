#!/usr/bin/env bash
# local-matrix.sh — ONE-COMMAND local containerized 2-node federation matrix.
#
# Hetzner access is GONE (owner 2026-07-03; D-001 of
# shared-hive-p2p-release-readiness-2026-07-03). The live federation regression
# matrix (bin/deb-hetzner-matrix.sh + bin/lib/scenarios/*) still runs UNCHANGED —
# this wrapper provisions the frames LOCALLY instead of on Hetzner:
#
#   1. builds a tiny ubuntu-24.04 + sshd docker image (root pubkey login, the
#      same contract a Hetzner VM gives the rig: ssh root@ip, apt, runuser),
#   2. runs 2 frame containers on a dedicated bridge network (fixed IPs),
#   3. starts a host-side hyperdht TESTNET node advertised on the bridge
#      gateway (co-located peers cannot rely on public-DHT NAT hairpinning —
#      same reason the two-instance smokes use PAPERCUSP_DHT_BOOTSTRAP),
#   4. execs bin/deb-hetzner-matrix.sh with RIG_FRAME_IPS + RIG_DHT_BOOTSTRAP +
#      RIG_SSH_IDENTITY set — the WI-1544 BYO-frames seam skips the Hetzner API
#      entirely (no HCLOUD_TOKEN needed; rig_cleanup destroys nothing — THIS
#      script owns the frames' lifecycle and tears them down on exit).
#
# This is the EXACT mode that produced the 8/8 min-bar matrix run m1783013203
# (2026-07-02, container-grade). For a true kernel/network boundary use the
# tower↔VM rig instead: bin/vm-rig/README.md.
#
# Usage:
#   bin/local-matrix.sh                      # full 8-scenario run (needs a built .deb)
#   bin/local-matrix.sh --deb=PATH           # explicit artifact (default: newest bundle;
#                                            #  a stale-deb warning prints if it predates HEAD)
#   bin/local-matrix.sh --only=b5_restart,concurrent_lww
#   bin/local-matrix.sh --list               # print registered scenarios, no provision
#   bin/local-matrix.sh --keep-up            # leave frames + DHT up after the run
#   bin/local-matrix.sh --reuse              # reuse frames + DHT from a --keep-up run
#   bin/local-matrix.sh --teardown           # destroy frames + network + DHT and exit
#
# Requirements: docker (daemon running, caller in the docker group), node with
# hyperdht resolvable from apps/operator (the sidecar workspace), gh auth for
# the two frame identities (papercupai + aviynw — same as the Hetzner rig), a
# built .deb (bin/build-desktop-sidecar.sh + `npm run build`, or release-local.sh).
#
# Firewall note: frames reach the DHT node on the bridge GATEWAY ip. If ufw is
# active and INPUT-filtering the docker bridge, allow it once:
#   sudo ufw allow from 10.99.0.0/24
set -uo pipefail

DESKTOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$DESKTOP_DIR/.." && pwd)"
OPERATOR_DIR="${PAPERCUSP_OPERATOR_DIR:-$ROOT/apps/operator}"

NET="${PCUSP_LOCAL_RIG_NET:-pcusp-local-rig}"
SUBNET="${PCUSP_LOCAL_RIG_SUBNET:-10.99.0.0/24}"
GW="${PCUSP_LOCAL_RIG_GW:-10.99.0.1}"
IP_A="${PCUSP_LOCAL_RIG_IP_A:-10.99.0.11}"
IP_B="${PCUSP_LOCAL_RIG_IP_B:-10.99.0.12}"
CN_A=pcusp-rig-a; CN_B=pcusp-rig-b
IMAGE_TAG=pcusp-local-frame:ubuntu24
SSH_KEY="${PCUSP_LOCAL_RIG_KEY:-$HOME/.papercusp/local-rig-ssh}"
STATE_FILE="${PCUSP_LOCAL_RIG_STATE:-/tmp/pcusp-local-rig.state}"

# ── args ──────────────────────────────────────────────────────────────────────
DEB=""; ONLY=""; KEEP_UP=0; REUSE=0; MODE=run
for arg in "$@"; do case "$arg" in
  --deb=*)    DEB="${arg#--deb=}" ;;
  --only=*)   ONLY="${arg#--only=}" ;;
  --keep-up)  KEEP_UP=1 ;;
  --reuse)    REUSE=1 ;;
  --list)     MODE=list ;;
  --teardown) MODE=teardown ;;
  -h|--help)  sed -n '2,46p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "unknown arg: $arg (try --help)" >&2; exit 2 ;;
esac; done

log() { echo "[local-matrix] $*" >&2; }

[ "$MODE" = list ] && exec bash "$DESKTOP_DIR/bin/deb-hetzner-matrix.sh" --list

# ── single-tenant lock ────────────────────────────────────────────────────────
# The rig is ONE-PER-BOX: fixed container names + IPs, a shared bridge network,
# and a gateway DHT. Without a lock, two concurrent runs mutually destroy each
# other: provisioning `docker rm -f`s the other run's LIVE frames, and the EXIT
# trap tears down the shared net/DHT mid-run (2026-07-03 P-004×P-002 collision:
# a peer's teardown killed a soak's freshly provisioned frames inside its
# wait-sshd window — surfaced as a phantom "FATAL ssh"). flock serializes runs
# AND --teardown (tearing down under a live run is the same destructive op):
# a second invocation WAITS up to RIG_LOCK_WAIT_S (default 7200s), logging the
# holder; RIG_LOCK_WAIT_S=0 fails fast (exit 3). The lock releases on process
# exit (flock fd semantics) — after a --keep-up run the frames stay up but the
# rig becomes claimable, on purpose (--reuse re-enters; a full run replaces).
RIG_LOCK="${PCUSP_LOCAL_RIG_LOCK:-/tmp/pcusp-local-rig.lock}"
exec 9>>"$RIG_LOCK" || { echo "FATAL: cannot open rig lock $RIG_LOCK" >&2; exit 1; }
if ! flock -n 9; then
  RIG_LOCK_HOLDER="$(cat "$RIG_LOCK.holder" 2>/dev/null || echo 'unknown holder')"
  RIG_LOCK_WAIT="${RIG_LOCK_WAIT_S:-7200}"
  if [ "$RIG_LOCK_WAIT" = 0 ]; then
    echo "FATAL: rig busy — held by: $RIG_LOCK_HOLDER (single-tenant; RIG_LOCK_WAIT_S=0 ⇒ fail-fast)" >&2
    exit 3
  fi
  log "rig busy — held by: $RIG_LOCK_HOLDER; waiting up to ${RIG_LOCK_WAIT}s (RIG_LOCK_WAIT_S=0 to fail fast)"
  flock -w "$RIG_LOCK_WAIT" 9 || { echo "FATAL: rig still busy after ${RIG_LOCK_WAIT}s — held by: $RIG_LOCK_HOLDER" >&2; exit 3; }
fi
printf '%s pid=%s %s\n' "$(date -Is)" "$$" "${RIG_LOCK_LABEL:-${USER:-?}:local-matrix $*}" >"$RIG_LOCK.holder"

# ── teardown (also the EXIT-trap body) ────────────────────────────────────────
rig_local_teardown() {
  log "teardown: frames + DHT"
  docker rm -f "$CN_A" "$CN_B" >/dev/null 2>&1 || true
  if [ -f "$STATE_FILE" ]; then
    local pid; pid="$(sed -n 's/^DHT_PID=//p' "$STATE_FILE" | head -1)"
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
    rm -f "$STATE_FILE"
  fi
  docker network rm "$NET" >/dev/null 2>&1 || true
}
if [ "$MODE" = teardown ]; then rig_local_teardown; echo "torn down."; exit 0; fi

command -v docker >/dev/null || { echo "FATAL: docker not found — the containerized rig needs it" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "FATAL: docker daemon unreachable (is the caller in the docker group?)" >&2; exit 1; }

# ── firewall preflight (frames→gateway DHT leg; found live 2026-07-03 P-004) ──
# The frames reach the host DHT node on the bridge GATEWAY ip. An active ufw
# with no allow-rule for the rig subnet silently drops exactly that leg (ssh +
# docker still work, so the miss surfaces much later as DHT bootstrap
# timeouts). Check it NOW instead of leaving it to the header comment.
if command -v ufw >/dev/null; then
  UFW_STATUS="$(sudo -n ufw status 2>/dev/null || true)"
  if printf '%s' "$UFW_STATUS" | grep -q '^Status: active'; then
    if ! printf '%s' "$UFW_STATUS" | grep -qF "$SUBNET"; then
      echo "FATAL: ufw is ACTIVE with no allow-rule for the rig subnet $SUBNET — the frames→gateway DHT leg will be dropped. Fix once:" >&2
      echo "  sudo ufw allow from $SUBNET comment 'papercusp local-rig frames'" >&2
      exit 1
    fi
  elif [ -z "$UFW_STATUS" ] && systemctl is-active --quiet ufw 2>/dev/null; then
    log "WARN: ufw service is active but passwordless sudo is unavailable — cannot verify an allow-rule for $SUBNET; if DHT bootstrap times out later, run: sudo ufw allow from $SUBNET"
  fi
fi

# ── ssh keypair (the frames' root login — rig contract: ssh -i KEY root@ip) ──
if [ ! -f "$SSH_KEY" ]; then
  log "generate rig ssh key $SSH_KEY"
  mkdir -p "$(dirname "$SSH_KEY")"
  ssh-keygen -q -t ed25519 -N '' -C pcusp-local-rig -f "$SSH_KEY" || exit 1
fi

# ── network ───────────────────────────────────────────────────────────────────
if ! docker network inspect "$NET" >/dev/null 2>&1; then
  log "create network $NET ($SUBNET gw $GW)"
  docker network create --subnet "$SUBNET" --gateway "$GW" "$NET" >/dev/null || exit 1
fi

# ── frame image (ubuntu-24.04 = the .deb's target ABI, EI-503; sshd + root key;
#    gh/psql/curl pre-baked = what rig_setup_frame installs anyway; webkit
#    best-effort pre-bake to cut the per-run apt download) ────────────────────
if ! docker image inspect "$IMAGE_TAG" >/dev/null 2>&1; then
  log "build frame image $IMAGE_TAG (one-time)"
  bctx="$(mktemp -d /tmp/pcusp-frame-img.XXXXXX)"
  cp "$SSH_KEY.pub" "$bctx/authorized_keys"
  cat > "$bctx/Dockerfile" <<'DOCKEREOF'
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends \
      openssh-server ca-certificates curl gh postgresql-client lsof \
 && apt-get install -y -qq libwebkit2gtk-4.1-0 xdg-utils || true
RUN mkdir -p /run/sshd /root/.ssh && chmod 700 /root/.ssh
COPY authorized_keys /root/.ssh/authorized_keys
RUN chmod 600 /root/.ssh/authorized_keys \
 && printf 'PermitRootLogin prohibit-password\nUseDNS no\n' > /etc/ssh/sshd_config.d/pcusp-rig.conf
CMD ["/usr/sbin/sshd","-D","-e"]
DOCKEREOF
  docker build -q -t "$IMAGE_TAG" "$bctx" >/dev/null || { echo "FATAL: frame image build failed" >&2; rm -rf "$bctx"; exit 1; }
  rm -rf "$bctx"
fi

frame_running() { [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = "true" ]; }

# ── provision / reuse frames ─────────────────────────────────────────────────
if [ "$REUSE" = 1 ] && frame_running "$CN_A" && frame_running "$CN_B"; then
  log "reuse running frames $CN_A@$IP_A $CN_B@$IP_B"
else
  REUSE=0
  docker rm -f "$CN_A" "$CN_B" >/dev/null 2>&1 || true
  log "provision frames $CN_A@$IP_A $CN_B@$IP_B"
  docker run -d --name "$CN_A" --hostname rig-a --network "$NET" --ip "$IP_A" "$IMAGE_TAG" >/dev/null || exit 1
  docker run -d --name "$CN_B" --hostname rig-b --network "$NET" --ip "$IP_B" "$IMAGE_TAG" >/dev/null || exit 1
fi

# ARM teardown now (frames exist). --keep-up / --reuse leave everything running.
[ "$KEEP_UP" = 1 ] || trap rig_local_teardown EXIT

# wait sshd
sshprobe() { ssh -i "$SSH_KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null \
  -o LogLevel=ERROR -o ConnectTimeout=5 "root@$1" true 2>/dev/null; }
for ip in "$IP_A" "$IP_B"; do
  ok=0
  for i in $(seq 1 20); do sshprobe "$ip" && { ok=1; break; }; sleep 2; done
  [ "$ok" = 1 ] || { echo "FATAL: sshd on frame $ip never answered" >&2; exit 1; }
done
log "frames ssh-ready"

# ── host-side testnet DHT advertised on the bridge gateway ───────────────────
# Single node on the gateway ip — a multi-node testnet's secondary nodes
# advertise 127.0.0.1 addresses the frames cannot reach (same finding as
# fed_start_testnet_dht in bin/lib/federation-asserts.sh).
BOOTSTRAP=""
if [ "$REUSE" = 1 ] && [ -f "$STATE_FILE" ]; then
  pid="$(sed -n 's/^DHT_PID=//p' "$STATE_FILE" | head -1)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    BOOTSTRAP="$(sed -n 's/^BOOTSTRAP=//p' "$STATE_FILE" | head -1)"
    log "reuse DHT pid=$pid bootstrap=$BOOTSTRAP"
  fi
fi
if [ -z "$BOOTSTRAP" ]; then
  dhtlog="$(mktemp /tmp/pcusp-local-rig-dht.XXXXXX.log)"
  log "start testnet DHT (single node, advertised on $GW)"
  ( cd "$OPERATOR_DIR" && PAPERCUSP_DHT_HOST="$GW" node --input-type=module -e '
      import createTestnet from "hyperdht/testnet.js";
      const host = process.env.PAPERCUSP_DHT_HOST;
      const t = await createTestnet(1, { host });
      console.log("BOOTSTRAP=" + t.bootstrap.map(b => b.host + ":" + b.port).join(","));
      process.stdin.resume();
    ' ) >"$dhtlog" 2>&1 &
  DHT_PID=$!
  for i in $(seq 1 20); do
    BOOTSTRAP="$(sed -n 's/^BOOTSTRAP=//p' "$dhtlog" | head -1)"
    [ -n "$BOOTSTRAP" ] && break; sleep 1
  done
  [ -n "$BOOTSTRAP" ] || { echo "FATAL: testnet DHT did not start:" >&2; cat "$dhtlog" >&2; exit 1; }
  printf 'DHT_PID=%s\nBOOTSTRAP=%s\n' "$DHT_PID" "$BOOTSTRAP" > "$STATE_FILE"
  log "DHT up pid=$DHT_PID bootstrap=$BOOTSTRAP"
fi

# ── ufw hint (frames → gateway DHT is INPUT-chain traffic on the bridge) ──────
if command -v ufw >/dev/null 2>&1 && sudo -n ufw status 2>/dev/null | grep -q 'Status: active'; then
  sudo -n ufw status 2>/dev/null | grep -q "${SUBNET%/*}" \
    || log "⚠ ufw is ACTIVE with no rule for $SUBNET — if scenarios stall on peer_connect: sudo ufw allow from $SUBNET"
fi

# ── run the matrix through the BYO-frames seam ────────────────────────────────
ARGS=()
[ -n "$DEB" ]  && ARGS+=("--deb=$DEB")
[ -n "$ONLY" ] && ARGS+=("--only=$ONLY")
[ "$KEEP_UP" = 1 ] && ARGS+=("--keep-up")
log "exec deb-hetzner-matrix.sh ${ARGS[*]:-} (BYO frames: $IP_A $IP_B)"
RIG_FRAME_IPS="$IP_A $IP_B" \
RIG_DHT_BOOTSTRAP="$BOOTSTRAP" \
RIG_SSH_IDENTITY="$SSH_KEY" \
bash "$DESKTOP_DIR/bin/deb-hetzner-matrix.sh" ${ARGS[@]+"${ARGS[@]}"}
rc=$?
[ "$KEEP_UP" = 1 ] && log "--keep-up: frames + DHT left running (re-enter with --reuse; destroy with --teardown)"
exit $rc
