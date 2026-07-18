#!/usr/bin/env bash
# deb-hetzner-brief2.sh — Brief 2: LIVE multi-member (3+) federation FANOUT.
#
# federation-release-hardening-relaunch P-002. Extends the 3-frame multimember
# TEMPLATE (deb-hetzner-multimember.sh, which proves only owner→both STAR fanout)
# into the full Brief-2 acceptance over THREE separate Hetzner VMs + real public DHT:
#
#   a = owner (papercupai) · b,c = members (aviynw; c may be P_C_USER)
#
#   (1) FEATURE fanout, BOTH origins:
#         owner a writes → assert lands origin=remote on b AND c   (star)
#         member b writes → assert lands origin=remote on a AND c   (member↔member+owner — the Brief-2 headline)
#   (2) PLAN-PART fanout, both origins (owner→b,c ; member b→a,c)
#   (3) COORD (comms) fanout, both origins (owner→b,c ; member b→a,c)
#
# NO restart after join — this deliberately exercises the forceReFold no-restart
# rebind path (the A→B roster-empty race the fix targets; e7698 flagged a live
# recurrence 2026-07-01, so this run is also a live data point on that fix).
#
# ⚠ QUOTA: provisions 3 servers. The Hetzner project quota is ~2 concurrent — a
# 3-frame run needs a quota bump / the ops/hetzner-federation-quota mutex, and must
# not collide with a concurrent 2-frame run. The PARENT handles quota; this script
# does NOT. COST-SAFETY: identical to the base rig — every server id is recorded
# (rig_create_server) BEFORE install and the EXIT trap DELETEs every id + confirms
# 404 for ALL frames, even if the 3rd provision fails on quota (servers=0).
#
# Env / creds (same as deb-hetzner-multimember.sh):
#   HCLOUD_TOKEN / HETZNER_SSH_KEY_ID / HETZNER_SSH_IDENTITY ; gh: papercupai + aviynw
# Usage: bin/deb-hetzner-brief2.sh [--locs=ash,ash,ash] [--type=cpx31] [--deb=PATH] [--keep-up]
set -uo pipefail

DESKTOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$DESKTOP_DIR/scripts/linux-test-vm/lib/common.sh"
source "$DESKTOP_DIR/bin/lib/federation-asserts.sh"
source "$DESKTOP_DIR/bin/lib/deb-hetzner-rig.sh"
set +e
set +u

# ── args / config ─────────────────────────────────────────────────────────────
LOCS="ash,ash,ash"; STYPE="cpx31"; DEB=""; KEEP_UP=0; IMAGE="ubuntu-24.04"
for arg in "$@"; do case "$arg" in
  --locs=*) LOCS="${arg#--locs=}" ;;
  --type=*) STYPE="${arg#--type=}" ;;
  --deb=*)  DEB="${arg#--deb=}" ;;
  --image=*) IMAGE="${arg#--image=}" ;;
  --keep-up) KEEP_UP=1 ;;
  -h|--help) sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) die "unknown arg: $arg" ;;
esac; done
IFS=',' read -r LOC_A LOC_B LOC_C <<<"$LOCS"
[ -n "$LOC_C" ] || LOC_C="$LOC_B"
# Default to the shared forceReFold .deb (WI-1367, verified forceReFold=4); fall back.
SHARED_DEB="/home/marsh-office/.cargo-target/release/bundle/deb/Papercusp_0.0.2_amd64.deb"
[ -n "$DEB" ] || { [ -f "$SHARED_DEB" ] && DEB="$SHARED_DEB" || DEB="$(default_deb)"; }
P_A_USER="${P_A_USER:-papercupai}"   # owner
P_B_USER="${P_B_USER:-aviynw}"       # member 1
P_C_USER="${P_C_USER:-aviynw}"       # member 2 (may share member-1 identity)

# ── init + ARM auto-destroy (BEFORE any provision) ────────────────────────────
RIG_KEEP_UP="$KEEP_UP"
rig_init "$STYPE" "$IMAGE" || exit 1
rig_install_exit_trap
RIG_DEB="$DEB"

# ── artifact gate (once) ──────────────────────────────────────────────────────
rig_gate_artifact "$DEB" || exit 2

# ── identities: a=owner, b+c=members ──────────────────────────────────────────
rig_set_identity a "$P_A_USER" || exit 1
rig_set_identity b "$P_B_USER" || exit 1
rig_set_identity c "$P_C_USER" || exit 1

# ── provision all 3 frames (records every id BEFORE install) ───────────────────
rig_provision "$LOC_A" "$LOC_B" "$LOC_C" || exit 3

# ── install .deb + launch sidecar on every frame ──────────────────────────────
rig_setup_all || exit 4

# ── boot + API readiness on every frame ───────────────────────────────────────
fed_log "wait embedded-PG + operator on all 3 sidecars"
rig_wait_all_ready 50 || exit 5
echo "✓ isolated by construction (3 separate cloud machines)"

# ── owner publishes the hive; all 3 frames join it ────────────────────────────
REPO_URL="${HIVE_REPO_URL:-https://github.com/octocat/Hello-World}"
rig_owner_publish_hive a "$REPO_URL" || exit 6
rig_join_all a   # a (owner self-join) + b + c → sets FRAME_MEMBER_SLUG[a|b|c]

fed_log "joined — wait for peer_connect + drain (NO restart — exercises forceReFold no-restart rebind)"
sleep 12
for inst in a b c; do
  echo "--- $inst [swarm]/drain diag ---"
  drv_exec "$inst" <<<"grep -aE '\[swarm\]|joined topic|peer_connected|drain|federate|attempted=' /home/pcusp/serve.log | tail -8"
done

# ── swarm discovery: owner↔both members AND member↔member (needed for b→c) ──────
rig_wait_swarm a b 70; disc_ab=$?
rig_wait_swarm a c 70; disc_ac=$?
rig_wait_swarm b c 70; disc_bc=$?

A_SLUG="${FRAME_MEMBER_SLUG[a]}"
B_SLUG="${FRAME_MEMBER_SLUG[b]}"

# ── fanout helpers: write ONCE on src, assert origin=remote on BOTH dsts ───────
# (fed_*_merge_assert hardcode plan_slug/msg per-src → can't fan to 2 dsts without
#  colliding; these write once + poll both. Echo "<r1> <r2>", 1=federated.)
poll_remote() {  # <inst> <fid> [tries]
  local inst="$1" fid="$2" tries="${3:-80}" i row
  for i in $(seq 1 "$tries"); do
    row="$(drv_psql "$inst" "SELECT harness_slug FROM harness_shared.harness_features_consolidated WHERE feature_id='$fid' AND origin='remote' LIMIT 1;" 2>/dev/null | tr -d '[:space:]')"
    [ -n "$row" ] && { echo "1 $row"; return 0; }
    sleep 3
  done; echo "0"; return 1
}
plan_part_fanout() {  # <src> <src_slug> <dst1> <dst2> [tries] → "<r1> <r2>"
  local src="$1" slug="$2" d1="$3" d2="$4" tries="${5:-80}" ps ts i r1=0 r2=0 row
  ps="ppfan-$src-$(date +%s)"; ts="$(date +%s)000"
  drv_psql "$src" "INSERT INTO harness_shared.harness_plan_parts (workspace_id,harness_slug,plan_slug,part_key,kind,body,ordinal,fed_ts,author,tombstone,origin) VALUES (COALESCE((SELECT workspace_id FROM harness_shared.pot_members WHERE coalesce(origin,'local')='local' ORDER BY joined_at LIMIT 1),'default'),'$slug','$ps','item:P-001','item','fanout-from-$src',1,$ts,'$src',false,'local');" >/dev/null
  for i in $(seq 1 "$tries"); do
    [ "$r1" = 0 ] && { row="$(drv_psql "$d1" "SELECT 1 FROM harness_shared.harness_plan_parts WHERE plan_slug='$ps' AND origin='remote' LIMIT 1;" 2>/dev/null | tr -d '[:space:]')"; [ "$row" = 1 ] && r1=1; }
    [ "$r2" = 0 ] && { row="$(drv_psql "$d2" "SELECT 1 FROM harness_shared.harness_plan_parts WHERE plan_slug='$ps' AND origin='remote' LIMIT 1;" 2>/dev/null | tr -d '[:space:]')"; [ "$row" = 1 ] && r2=1; }
    [ "$r1" = 1 ] && [ "$r2" = 1 ] && break
    sleep 3
  done; echo "$r1 $r2"
}
coord_fanout() {  # <src> <src_slug> <dst1> <dst2> <tag> [tries] → "<r1> <r2>"
  local src="$1" slug="$2" d1="$3" d2="$4" tag="$5" tries="${6:-80}" mid i r1=0 r2=0 row
  mid="COMM-$tag-$(date +%s)"
  drv_psql "$src" "INSERT INTO harness_shared.coord_event_log (workspace_id,surface,writer_key,msg_id,body,harness_slug,origin) VALUES (COALESCE((SELECT workspace_id FROM harness_shared.pot_members WHERE coalesce(origin,'local')='local' ORDER BY joined_at LIMIT 1),'default'),'messages','comm-probe','$mid','{\"kind\":\"message\",\"text\":\"brief2 fanout probe\"}'::jsonb,'$slug','local');" >/dev/null
  for i in $(seq 1 "$tries"); do
    [ "$r1" = 0 ] && { row="$(drv_psql "$d1" "SELECT 1 FROM harness_shared.coord_event_log WHERE msg_id='$mid' AND origin='remote' LIMIT 1;" 2>/dev/null | tr -d '[:space:]')"; [ "$row" = 1 ] && r1=1; }
    [ "$r2" = 0 ] && { row="$(drv_psql "$d2" "SELECT 1 FROM harness_shared.coord_event_log WHERE msg_id='$mid' AND origin='remote' LIMIT 1;" 2>/dev/null | tr -d '[:space:]')"; [ "$row" = 1 ] && r2=1; }
    [ "$r1" = 1 ] && [ "$r2" = 1 ] && break
    sleep 3
  done; echo "$r1 $r2"
}

# ── (1) FEATURE fanout — owner→{b,c} then member b→{a,c} ───────────────────────
fed_log "FEATURE fanout: owner a → b,c"
FIDA="F-OWNER-$(date +%s)"; rig_write_content a "$A_SLUG" "$FIDA" "owner fanout" todo >/dev/null
pb="$(poll_remote b "$FIDA" 80 || true)";  o2b=0; [ "${pb%% *}" = 1 ] && o2b=1
pc="$(poll_remote c "$FIDA" 80 || true)";  o2c=0; [ "${pc%% *}" = 1 ] && o2c=1
fed_log "FEATURE fanout: member b → a,c (the member↔member+owner headline)"
FIDB="F-MEMBER-$(date +%s)"; rig_write_content b "$B_SLUG" "$FIDB" "member fanout" todo >/dev/null
pa="$(poll_remote a "$FIDB" 80 || true)";  b2a=0; [ "${pa%% *}" = 1 ] && b2a=1
pcb="$(poll_remote c "$FIDB" 80 || true)"; b2c=0; [ "${pcb%% *}" = 1 ] && b2c=1

# ── (2) PLAN-PART fanout ───────────────────────────────────────────────────────
fed_log "PLAN-PART fanout: owner a → b,c"
read -r ppo2b ppo2c <<<"$(plan_part_fanout a "$A_SLUG" b c 80)"
fed_log "PLAN-PART fanout: member b → a,c"
read -r ppb2a ppb2c <<<"$(plan_part_fanout b "$B_SLUG" a c 80)"

# ── (3) COORD (comms) fanout ──────────────────────────────────────────────────
fed_log "COORD fanout: owner a → b,c"
read -r co2b co2c <<<"$(coord_fanout a "$A_SLUG" b c OWN 80)"
fed_log "COORD fanout: member b → a,c"
read -r cb2a cb2c <<<"$(coord_fanout b "$B_SLUG" a c MEM 80)"

# ── receive-side roster diag on ANY fanout miss (empty roster = the root cause) ─
allpass=1
for v in "$o2b" "$o2c" "$b2a" "$b2c" "$ppo2b" "$ppo2c" "$ppb2a" "$ppb2c" "$co2b" "$co2c" "$cb2a" "$cb2c"; do
  [ "$v" = 1 ] || allpass=0
done
if [ "$allpass" != 1 ]; then
  fed_log "FANOUT-DIAG: hive_members roster on each frame (empty roster drops every peer op — the forceReFold no-restart failure signature)"
  for inst in a b c; do echo "--- $inst roster ---"; rig_read_roster "$inst"; done
fi

# ── report ────────────────────────────────────────────────────────────────────
p(){ [ "$1" = 1 ] && echo PASS || echo FAIL; }
d(){ [ "$1" = 0 ] && echo PASS || echo FAIL; }
fed_log "RESULT (Brief 2: 3-frame multi-member fanout, Hetzner $STYPE $LOC_A+$LOC_B+$LOC_C, public DHT, forceReFold .deb, NO restart)"
echo "discovery:   a↔b=$(d "$disc_ab")  a↔c=$(d "$disc_ac")  b↔c=$(d "$disc_bc")"
echo "feature:     owner→b=$(p "$o2b")  owner→c=$(p "$o2c")  member b→a=$(p "$b2a")  member b→c=$(p "$b2c")"
echo "plan-part:   owner→b=$(p "$ppo2b")  owner→c=$(p "$ppo2c")  member b→a=$(p "$ppb2a")  member b→c=$(p "$ppb2c")"
echo "coord:       owner→b=$(p "$co2b")  owner→c=$(p "$co2c")  member b→a=$(p "$cb2a")  member b→c=$(p "$cb2c")"
if [ "$disc_ab" = 0 ] && [ "$disc_ac" = 0 ] && [ "$disc_bc" = 0 ] && [ "$allpass" = 1 ]; then
  echo "OVERALL: PASS — 3-machine multi-member FANOUT proven (owner→both members AND member→owner+member) for features, per-part plans, AND coord over real public DHT, no restart"
  exit 0
fi
echo "OVERALL: INCOMPLETE — see [swarm] diag + roster dump + /home/pcusp/serve.log on each frame"
exit 6
