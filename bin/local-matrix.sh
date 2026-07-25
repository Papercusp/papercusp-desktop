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

# WI-5631: pin the rig frames' home-harness slug to a synthetic, non-'papercusp' value.
# Left unset, deb-hetzner-rig.sh's RIG_HOME_HARNESS_SLUG stays empty, so every frame's
# operatorHomeHarnessSlug() falls through to LEGACY_DEFAULT_HOME_HARNESS='papercusp' —
# which then matches the `harness_slug` on federated ops carrying the REAL production
# papercusp home-harness backlog, so the engineer-issues projection's own-slug fast path
# (decideMemberContentOp: rowHarnessSlug === opts.harnessSlug → unconditional apply, no
# membership check) admits + writes that entire real backlog into the frame — thousands
# of "EI-13285 id collision" ops/run that starve the frame's event loop and block a clean
# replication_soak pass. One value for the whole rig run is enough (RIG_WORKSPACE_ID is
# likewise a single per-run value shared by every frame) — it only needs to NOT resolve
# to a real registered project. Override with RIG_HOME_HARNESS_SLUG if a scenario
# deliberately wants a specific (non-'papercusp') slug.
RIG_HOME_HARNESS_SLUG="${RIG_HOME_HARNESS_SLUG:-${NET}-home}"
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
# assert-integrity-ok: NCPU feeds a CONFIG decision, not an assert — nothing is scored off it.
# The fallback is also the CONSERVATIVE direction: an unmeasurable nproc reads as 8, which is
# < 24 and therefore DISABLES cpu pinning entirely. An unmeasured probe here can only forgo an
# optimisation, never make a claim falsely pass.
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

# ── frame MEMORY reservation (D-003 / EI-13317: genuine memory isolation) ────
# WI-5319 pinned the frame CPUs but left memory UNBOUNDED — so under host memory
# pressure the fleet's page-cache churn reclaims the frames' resident pages and
# their node/PG stall: the same starvation that breaks replication_soak's 90s
# reconnect SLA, on the memory axis. --memory-reservation sets cgroup-v2
# `memory.low` — a PROTECTED floor the kernel will not reclaim below under
# pressure (this is the isolation that matters); --memory is a generous hard cap
# for hygiene; --memory-swap==--memory disables swap growth so the frame stays
# resident (no swap-in latency spikes on the event loop; this box has no working
# --memory-swappiness). Sized way above one operator sidecar + embedded PG on
# this 251G box; override with PCUSP_RIG_MEM_{MAX,LOW} ('' disables that piece).
MEM_MAX="${PCUSP_RIG_MEM_MAX-16g}"
MEM_LOW="${PCUSP_RIG_MEM_LOW-4g}"
MEM_ARGS=""
[ -n "$MEM_MAX" ] && MEM_ARGS="--memory $MEM_MAX --memory-swap $MEM_MAX"
[ -n "$MEM_LOW" ] && MEM_ARGS="$MEM_ARGS --memory-reservation $MEM_LOW"

# ── genuine CPU EXCLUSIVITY (D-003: exclusive cores, not just affinity) ───────
# --cpuset-cpus above is AFFINITY ONLY: it confines the frame TO its cores but
# does NOT evict the host fleet OFF them, so under sustained load (this box idles
# at 40–120) fleet threads pile onto the frame's "reserved" cores and starve its
# node event loop during the restart/reconnect legs — exactly the miss that fails
# replication_soak (passes in ~10s on a quiet frame, misses the 90s SLA on a
# starved one). A cgroup-v2 EXCLUSIVE partition genuinely evicts every other
# cgroup from the frame's cores: we grant the frame cores as exclusively-
# allocatable at system.slice (parent of every docker-*.scope), then promote each
# frame's scope to `cpuset.cpus.partition=root`. Needs cgroup v2 + the cpuset
# controller delegated to system.slice + passwordless sudo; degrades to
# affinity-only with a WARN otherwise (never fails the run). The grant + each
# partition are released on teardown. PCUSP_RIG_EXCLUSIVE=0 opts out.
CGROOT="${PCUSP_CGROUP_ROOT:-/sys/fs/cgroup}"
RIG_EXCLUSIVE="${PCUSP_RIG_EXCLUSIVE:-1}"
RIG_EXCLUSIVE_ACTIVE=0

# Union of the frame cpusets actually in use (respects --frames + '' disables).
rig_exclusive_cores() {
  local list=""
  [ -n "$CPUSET_A" ] && list="$CPUSET_A"
  [ -n "$CPUSET_B" ] && list="${list:+$list,}$CPUSET_B"
  [ "$FRAMES" = 3 ] && [ -n "$CPUSET_C" ] && list="${list:+$list,}$CPUSET_C"
  printf '%s' "$list"
}

# Grant the frame cores as exclusively-allocatable at system.slice. Idempotent;
# returns non-zero (⇒ affinity-only fallback) if the platform can't support it.
rig_enable_exclusive() {
  [ "$RIG_EXCLUSIVE" = 1 ] || return 1
  local cores; cores="$(rig_exclusive_cores)"
  [ -n "$cores" ] || return 1   # no pinning at all (small box) ⇒ nothing to isolate
  [ "$(stat -fc %T "$CGROOT" 2>/dev/null)" = cgroup2fs ] || { log "WARN: not cgroup v2 — frames get CPU affinity only, NOT exclusive cores"; return 1; }
  [ -e "$CGROOT/system.slice/cpuset.cpus.exclusive" ] || { log "WARN: cpuset controller not delegated to system.slice — affinity only"; return 1; }
  sudo -n true 2>/dev/null || { log "WARN: no passwordless sudo — cannot make frame cores exclusive; affinity only"; return 1; }
  if sudo -n sh -c "printf '%s' '$cores' > '$CGROOT/system.slice/cpuset.cpus.exclusive'" 2>/dev/null; then
    RIG_EXCLUSIVE_ACTIVE=1
    return 0
  fi
  log "WARN: could not reserve exclusive cores [$cores] at system.slice — affinity only"
  return 1
}

# Promote one frame's cgroup scope to an exclusive partition root (evicts the
# host fleet off its cores). Best-effort: logs + continues on any failure.
rig_frame_exclusive() {  # $1=container name  $2=cpuset
  local cn="$1" cores="$2" id scope st
  { [ "$RIG_EXCLUSIVE_ACTIVE" = 1 ] && [ -n "$cores" ]; } || return 0
  id="$(docker inspect -f '{{.Id}}' "$cn" 2>/dev/null)" || return 0
  scope="$CGROOT/system.slice/docker-$id.scope"
  [ -d "$scope" ] || { log "WARN: no cgroup scope for frame $cn — cores $cores stay affinity-only"; return 0; }
  if sudo -n sh -c "printf '%s' '$cores' > '$scope/cpuset.cpus.exclusive' && echo root > '$scope/cpuset.cpus.partition'" 2>/dev/null; then
    st="$(cat "$scope/cpuset.cpus.partition" 2>/dev/null || echo '?')"
    case "$st" in
      root) log "frame $cn: EXCLUSIVE cores $cores — host fleet evicted (cgroup-v2 partition)" ;;
      *)    log "WARN: frame $cn partition=[$st] not exclusive — cores $cores stay affinity-only" ;;
    esac
  else
    log "WARN: could not make frame $cn cores $cores exclusive — affinity only"
  fi
}

# Release the system.slice exclusive grant (teardown, after the frame scopes are
# gone — removing the containers already dissolved their partitions). Also cleans
# a grant left by a hard-killed prior run. Unconditional beyond platform support
# so `--teardown` repairs a stale grant; writing empty over empty is a no-op.
rig_disable_exclusive() {
  [ "$(stat -fc %T "$CGROOT" 2>/dev/null)" = cgroup2fs ] || return 0
  [ -e "$CGROOT/system.slice/cpuset.cpus.exclusive" ] || return 0
  sudo -n sh -c "echo > '$CGROOT/system.slice/cpuset.cpus.exclusive'" 2>/dev/null || true
}

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
  rig_disable_exclusive   # release the system.slice exclusive-core grant (scopes now gone)
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
  # $CPU_ARGS_* / $MEM_ARGS word-split deliberately (frame CPU+memory reservation, defined above).
  docker run -d --name "$CN_A" --hostname rig-a --network "$NET" --ip "$IP_A" $CPU_ARGS_A $MEM_ARGS "$IMAGE_TAG" >/dev/null || exit 1
  docker run -d --name "$CN_B" --hostname rig-b --network "$NET" --ip "$IP_B" $CPU_ARGS_B $MEM_ARGS "$IMAGE_TAG" >/dev/null || exit 1
  if [ "$FRAMES" = 3 ]; then
    docker run -d --name "$CN_C" --hostname rig-c --network "$NET" --ip "$IP_C" $CPU_ARGS_C $MEM_ARGS "$IMAGE_TAG" >/dev/null || exit 1
  fi
fi

# ARM teardown now (frames exist). --keep-up / --reuse leave everything running.
[ "$KEEP_UP" = 1 ] || trap rig_local_teardown EXIT

# Promote the reserved frame cores to genuine EXCLUSIVE cgroup-v2 partitions so
# the host fleet cannot starve them (D-003). Runs for both fresh + --reuse frames
# (idempotent), after the teardown trap so a partial setup is still released.
if rig_enable_exclusive; then
  rig_frame_exclusive "$CN_A" "$CPUSET_A"
  rig_frame_exclusive "$CN_B" "$CPUSET_B"
  [ "$FRAMES" = 3 ] && rig_frame_exclusive "$CN_C" "$CPUSET_C"
fi

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
log "exec deb-hetzner-matrix.sh ${ARGS[*]:-} (BYO frames: $FRAME_IPS, home-harness-slug: $RIG_HOME_HARNESS_SLUG)"
RIG_FRAME_IPS="$FRAME_IPS" \
RIG_DHT_BOOTSTRAP="$BOOTSTRAP" \
RIG_SSH_IDENTITY="$SSH_KEY" \
RIG_HOME_HARNESS_SLUG="$RIG_HOME_HARNESS_SLUG" \
bash "$DESKTOP_DIR/bin/deb-hetzner-matrix.sh" ${ARGS[@]+"${ARGS[@]}"}
rc=$?
[ "$KEEP_UP" = 1 ] && log "--keep-up: frames + DHT left running (re-enter with --reuse; destroy with --teardown)"
exit $rc
