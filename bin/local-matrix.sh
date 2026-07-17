#!/usr/bin/env bash
# local-matrix.sh — ONE-COMMAND local containerized N-node federation matrix
# (2-frame by default; --frames=3 for the standing 3-node coverage gap, P-006
# of p2p-rest-lanes-2026-07-09 / umbrella P-010).
#
# Hetzner access is GONE (owner 2026-07-03; D-001 of
# shared-hive-p2p-release-readiness-2026-07-03). The live federation regression
# matrix (bin/deb-hetzner-matrix.sh + bin/lib/scenarios/*) still runs UNCHANGED —
# this wrapper provisions the frames LOCALLY instead of on Hetzner:
#
#   1. builds a tiny ubuntu-24.04 + sshd docker image (root pubkey login, the
#      same contract a Hetzner VM gives the rig: ssh root@ip, apt, runuser),
#   2. runs 2 (or 3, with --frames=3) frame containers on a dedicated bridge
#      network (fixed IPs),
#   3. starts a host-side hyperdht TESTNET node advertised on the bridge
#      gateway (co-located peers cannot rely on public-DHT NAT hairpinning —
#      same reason the two-instance smokes use PAPERCUSP_DHT_BOOTSTRAP),
#   4. execs bin/deb-hetzner-matrix.sh with RIG_FRAME_IPS + RIG_DHT_BOOTSTRAP +
#      RIG_SSH_IDENTITY set — the WI-1544 BYO-frames seam skips the Hetzner API
#      entirely (no HCLOUD_TOKEN needed; rig_cleanup destroys nothing — THIS
#      script owns the frames' lifecycle and tears them down on exit). With
#      3 BYO ips, deb-hetzner-matrix.sh auto-registers frame 'c' (2nd member)
#      IN ADDITION to a=owner/b=member — the live-Hetzner 2-server cap does not
#      apply here since nothing is provisioned on Hetzner (BYO skips the API).
#
# This is the EXACT mode that produced the 8/8 min-bar matrix run m1783013203
# (2026-07-02, container-grade). For a true kernel/network boundary use the
# tower↔VM rig instead: bin/vm-rig/README.md.
#
# Usage:
#   bin/local-matrix.sh                      # full 8-scenario run (needs a built .deb)
#   bin/local-matrix.sh --frames=3           # 3-node rig (owner + 2 members); the
#                                            #  8-scenario matrix still runs a/b only,
#                                            #  PLUS the membership_churn scenario
#                                            #  which exercises frame c
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
IP_C="${PCUSP_LOCAL_RIG_IP_C:-10.99.0.13}"
# Frame/state/lock identity is scoped to the NET (2026-07-03 collision fix):
# fixed container names made the rig ONE-PER-BOX even across separate bridge
# networks — a run on a custom net `docker rm -f`'d the default net's LIVE
# frames BY NAME (and vice versa; the 07-03 cross-lane collision destroyed a
# kept forensic rig this way). Default net keeps the legacy names/paths so
# existing runs/docs are untouched; a CUSTOM net gets its own container names,
# state file, and flock — rigs on distinct nets are independent by construction.
if [ "$NET" = pcusp-local-rig ]; then
  CN_A="${PCUSP_LOCAL_RIG_CN_A:-pcusp-rig-a}"; CN_B="${PCUSP_LOCAL_RIG_CN_B:-pcusp-rig-b}"; CN_C="${PCUSP_LOCAL_RIG_CN_C:-pcusp-rig-c}"
  STATE_FILE="${PCUSP_LOCAL_RIG_STATE:-/tmp/pcusp-local-rig.state}"
  RIG_LOCK_DEFAULT=/tmp/pcusp-local-rig.lock
else
  CN_A="${PCUSP_LOCAL_RIG_CN_A:-$NET-a}"; CN_B="${PCUSP_LOCAL_RIG_CN_B:-$NET-b}"; CN_C="${PCUSP_LOCAL_RIG_CN_C:-$NET-c}"
  STATE_FILE="${PCUSP_LOCAL_RIG_STATE:-/tmp/$NET.state}"
  RIG_LOCK_DEFAULT="/tmp/$NET.lock"
fi
IMAGE_TAG=pcusp-local-frame:ubuntu24
SSH_KEY="${PCUSP_LOCAL_RIG_KEY:-$HOME/.papercusp/local-rig-ssh}"

# ── frame CPU reservation (WI-5319 / plan D-003) ─────────────────────────────
# Pin each frame to its own reserved core set so fleet/host load cannot starve the
# frames' node main threads. Run 20260717-174333: rig-b logged 18×"boot timeout after
# 30000ms" + 10 late-adopt cycles with event-loop p99 1.48s under host load 40–100 —
# starved (unpinned) frames read as federation bugs. Defaults take the TOP cores,
# 8 per frame, only on boxes big enough that the reservation can't crowd the host
# (<24 cores ⇒ no pinning). Override per frame with PCUSP_RIG_CPUSET_{A,B,C}
# ('' disables). --cpu-shares=4096 additionally wins scheduler bursts against other
# docker work (default weight 1024) without hard-starving it.
NCPU="$(nproc 2>/dev/null || echo 8)"
if [ "$NCPU" -ge 24 ]; then
  _def_cpuset_a="$((NCPU-8))-$((NCPU-1))"
  _def_cpuset_b="$((NCPU-16))-$((NCPU-9))"
  _def_cpuset_c="$((NCPU-24))-$((NCPU-17))"
else
  _def_cpuset_a=""; _def_cpuset_b=""; _def_cpuset_c=""
fi
CPUSET_A="${PCUSP_RIG_CPUSET_A-$_def_cpuset_a}"
CPUSET_B="${PCUSP_RIG_CPUSET_B-$_def_cpuset_b}"
CPUSET_C="${PCUSP_RIG_CPUSET_C-$_def_cpuset_c}"
CPU_ARGS_A="--cpu-shares 4096"; [ -n "$CPUSET_A" ] && CPU_ARGS_A="--cpuset-cpus $CPUSET_A $CPU_ARGS_A"
CPU_ARGS_B="--cpu-shares 4096"; [ -n "$CPUSET_B" ] && CPU_ARGS_B="--cpuset-cpus $CPUSET_B $CPU_ARGS_B"
CPU_ARGS_C="--cpu-shares 4096"; [ -n "$CPUSET_C" ] && CPU_ARGS_C="--cpuset-cpus $CPUSET_C $CPU_ARGS_C"

# ── args ──────────────────────────────────────────────────────────────────────
DEB=""; ONLY=""; KEEP_UP=0; REUSE=0; MODE=run; FRAMES=2
for arg in "$@"; do case "$arg" in
  --deb=*)     DEB="${arg#--deb=}" ;;
  --only=*)    ONLY="${arg#--only=}" ;;
  --frames=*)  FRAMES="${arg#--frames=}" ;;
  --keep-up)   KEEP_UP=1 ;;
  --reuse)     REUSE=1 ;;
  --list)      MODE=list ;;
  --teardown)  MODE=teardown ;;
  -h|--help)   sed -n '2,52p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "unknown arg: $arg (try --help)" >&2; exit 2 ;;
esac; done
case "$FRAMES" in 2|3) : ;; *) echo "FATAL: --frames must be 2 or 3 (got '$FRAMES')" >&2; exit 2 ;; esac

log() { echo "[local-matrix] $*" >&2; }

[ "$MODE" = list ] && exec bash "$DESKTOP_DIR/bin/deb-hetzner-matrix.sh" --list

# ── single-tenant lock (per-NET since the 07-03 collision fix) ───────────────
# The rig is ONE-PER-NET: fixed container names + IPs, a shared bridge network,
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
RIG_LOCK="${PCUSP_LOCAL_RIG_LOCK:-$RIG_LOCK_DEFAULT}"
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
  docker rm -f "$CN_A" "$CN_B" "$CN_C" "$NET-dht" >/dev/null 2>&1 || true
  if [ -f "$STATE_FILE" ]; then
    local pid; pid="$(sed -n 's/^DHT_PID=//p' "$STATE_FILE" | head -1)"
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true   # legacy host-pid DHT state
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
#    gh/psql/git/curl pre-baked = what rig_setup_frame installs anyway; webkit
#    best-effort pre-bake to cut the per-run apt download). git is REQUIRED by
#    the sidecar's pots/from-repo clone (clone_git_missing, found 2026-07-03
#    P-004 run #4 — Hetzner VMs shipped git; a bare ubuntu:24.04 image doesn't).
#    After editing this package list: docker rmi pcusp-local-frame:ubuntu24 so
#    the build-once cache rebuilds (rig_setup_frame's per-run apt also
#    self-heals a stale image, at per-run cost). ─────────────────────────────
if ! docker image inspect "$IMAGE_TAG" >/dev/null 2>&1; then
  log "build frame image $IMAGE_TAG (one-time)"
  bctx="$(mktemp -d /tmp/pcusp-frame-img.XXXXXX)"
  cp "$SSH_KEY.pub" "$bctx/authorized_keys"
  cat > "$bctx/Dockerfile" <<'DOCKEREOF'
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends \
      openssh-server ca-certificates curl gh git postgresql-client lsof \
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
REUSE_OK=1
frame_running "$CN_A" && frame_running "$CN_B" || REUSE_OK=0
[ "$FRAMES" = 3 ] && { frame_running "$CN_C" || REUSE_OK=0; }
if [ "$REUSE" = 1 ] && [ "$REUSE_OK" = 1 ]; then
  log "reuse running frames $CN_A@$IP_A $CN_B@$IP_B$( [ "$FRAMES" = 3 ] && echo " $CN_C@$IP_C" )"
else
  REUSE=0
  docker rm -f "$CN_A" "$CN_B" "$CN_C" >/dev/null 2>&1 || true
  log "provision $FRAMES frames $CN_A@$IP_A $CN_B@$IP_B$( [ "$FRAMES" = 3 ] && echo " $CN_C@$IP_C" )"
  # $CPU_ARGS_* word-split deliberately (WI-5319 frame CPU reservation, defined above).
  docker run -d --name "$CN_A" --hostname rig-a --network "$NET" --ip "$IP_A" $CPU_ARGS_A "$IMAGE_TAG" >/dev/null || exit 1
  docker run -d --name "$CN_B" --hostname rig-b --network "$NET" --ip "$IP_B" $CPU_ARGS_B "$IMAGE_TAG" >/dev/null || exit 1
  if [ "$FRAMES" = 3 ]; then
    docker run -d --name "$CN_C" --hostname rig-c --network "$NET" --ip "$IP_C" $CPU_ARGS_C "$IMAGE_TAG" >/dev/null || exit 1
  fi
fi

# ARM teardown now (frames exist). --keep-up / --reuse leave everything running.
[ "$KEEP_UP" = 1 ] || trap rig_local_teardown EXIT

# wait sshd
sshprobe() { ssh -i "$SSH_KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null \
  -o LogLevel=ERROR -o ConnectTimeout=5 "root@$1" true 2>/dev/null; }
RIG_IPS=("$IP_A" "$IP_B"); [ "$FRAMES" = 3 ] && RIG_IPS+=("$IP_C")
for ip in "${RIG_IPS[@]}"; do
  ok=0
  for i in $(seq 1 20); do sshprobe "$ip" && { ok=1; break; }; sleep 2; done
  [ "$ok" = 1 ] || { echo "FATAL: sshd on frame $ip never answered" >&2; exit 1; }
done
log "frames ssh-ready"

# ── testnet DHT: 3 nodes IN A CONTAINER on the rig bridge (WI-1910 root fix) ──
# A single-node testnet is broken-BY-CONSTRUCTION for discovery: dht-rpc never
# COMMITS announces to bootstrap nodes, so a 1-node "DHT" stores nothing and no
# peer can ever find another — every containerized-rig run failed peer_connect
# REGARDLESS of deb (WI-1910, root-caused by 85300, thread post 49998). A
# host-side multi-node testnet is also wrong: on a multi-homed host the
# non-bootstrap nodes advertise the LAN ip (192.168.x.x), unreachable from the
# frames (probe: /tmp/wi1910-audit/dht99x3.log). Fix: createTestnet(3,{host})
# INSIDE a container ON the rig bridge with a static ip — all three nodes bind
# + advertise that bridge ip, announces commit to the two storage nodes, and
# frames reach everything as same-bridge c2c traffic (no ufw INPUT dependency).
DHT_IP="${PCUSP_LOCAL_RIG_DHT_IP:-${GW%.*}.5}"
DHT_CN="$NET-dht"
SIDECAR_NODE="$DESKTOP_DIR/src-tauri/sidecar/bin/node"
BOOTSTRAP=""
if [ "$REUSE" = 1 ] && [ -f "$STATE_FILE" ]; then
  if [ -n "$(docker ps -q -f "name=^${DHT_CN}\$")" ]; then
    BOOTSTRAP="$(sed -n 's/^BOOTSTRAP=//p' "$STATE_FILE" | head -1)"
    log "reuse DHT container $DHT_CN bootstrap=$BOOTSTRAP"
  else
    # stale state (legacy host-pid DHT or dead container) — clean, fall through
    pid="$(sed -n 's/^DHT_PID=//p' "$STATE_FILE" | head -1)"
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  fi
fi
if [ -z "$BOOTSTRAP" ]; then
  [ -x "$SIDECAR_NODE" ] || { echo "FATAL: sidecar node binary missing at $SIDECAR_NODE (build once: bin/build-desktop-sidecar.sh)" >&2; exit 1; }
  dhtjs="$(mktemp /tmp/pcusp-local-rig-dht.XXXXXX.cjs)"
  cat >"$dhtjs" <<'DHTJS'
const createTestnet = require('/opt/app/node_modules/hyperdht/testnet.js');
(async () => {
  const t = await createTestnet(3, { host: process.env.GW });
  console.log('BOOTSTRAP=' + t.bootstrap.map(b => b.host + ':' + b.port).join(','));
  for (const n of t.nodes) console.log('node: ' + n.host + ':' + n.port + ' ephemeral=' + n.ephemeral);
  process.stdin.resume();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
DHTJS
  log "start testnet DHT (3 nodes, containerized @ $DHT_IP — WI-1910 fix)"
  docker rm -f "$DHT_CN" >/dev/null 2>&1 || true
  docker run -d -i --name "$DHT_CN" --network "$NET" --ip "$DHT_IP" \
    -e GW="$DHT_IP" \
    -v "$ROOT":/opt/app:ro \
    -v "$SIDECAR_NODE":/usr/local/bin/pcusp-node:ro \
    -v "$dhtjs":/dht.cjs:ro \
    --entrypoint /usr/local/bin/pcusp-node \
    "$IMAGE_TAG" /dht.cjs >/dev/null || { echo "FATAL: DHT container failed to start" >&2; exit 1; }
  for i in $(seq 1 30); do
    BOOTSTRAP="$(docker logs "$DHT_CN" 2>/dev/null | sed -n 's/^BOOTSTRAP=//p' | head -1)"
    [ -n "$BOOTSTRAP" ] && break; sleep 1
  done
  [ -n "$BOOTSTRAP" ] || { echo "FATAL: containerized testnet DHT did not start:" >&2; docker logs "$DHT_CN" 2>&1 | tail -20 >&2; exit 1; }
  printf 'DHT_CONTAINER=%s\nBOOTSTRAP=%s\n' "$DHT_CN" "$BOOTSTRAP" > "$STATE_FILE"
  log "DHT up container=$DHT_CN bootstrap=$BOOTSTRAP"
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
FRAME_IPS="$IP_A $IP_B"; [ "$FRAMES" = 3 ] && FRAME_IPS="$IP_A $IP_B $IP_C"
log "exec deb-hetzner-matrix.sh ${ARGS[*]:-} (BYO frames: $FRAME_IPS)"
RIG_FRAME_IPS="$FRAME_IPS" \
RIG_DHT_BOOTSTRAP="$BOOTSTRAP" \
RIG_SSH_IDENTITY="$SSH_KEY" \
bash "$DESKTOP_DIR/bin/deb-hetzner-matrix.sh" ${ARGS[@]+"${ARGS[@]}"}
rc=$?
[ "$KEEP_UP" = 1 ] && log "--keep-up: frames + DHT left running (re-enter with --reuse; destroy with --teardown)"
exit $rc
