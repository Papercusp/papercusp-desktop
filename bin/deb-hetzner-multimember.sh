#!/usr/bin/env bash
# deb-hetzner-multimember.sh — SAMPLE 3-FRAME federation scenario (Brief 2 template).
#
# The TEMPLATE for the live-matrix briefs (federation-release-hardening 2-7): it
# sources the reusable rig lib (bin/lib/deb-hetzner-rig.sh) + the shared asserts
# (bin/lib/federation-asserts.sh), provisions THREE Hetzner frames (a=owner +
# b,c=members), joins ALL THREE to ONE hive, federates one write owner→both
# members, and tears down with the same EXIT-trap servers=0 guarantee the 2-frame
# base run carries. It exists to PROVE the lib supports 3+ frames and to give the
# brief-2..7 authors a copy-start that does NOT collide on deb-hetzner-federation.sh.
#
# This is a minimal star-fanout proof (owner → both members). Brief 2 extends it to
# member↔member fanout (b writes → a AND c receive) + plan-part + coord; Briefs 3-7
# swap in the revoke / kill-sidecar / restart / concurrent / negative primitives the
# lib already exposes (rig_kill_sidecar, rig_restart_sidecar, rig_assert_absent, …).
#
# ⚠ QUOTA: this provisions 3 servers. The Hetzner project quota appears to be ~2
# concurrent servers — a 3-frame run likely needs a quota bump FIRST, and must not
# collide with a concurrent 2-frame run on the quota (run sequentially or stagger).
# The parent must handle the quota bump; this script does NOT attempt it.
#
# COST-SAFETY: identical to the base rig — every provisioned server id is recorded
# (rig_create_server) BEFORE install, and the EXIT trap (rig_install_exit_trap →
# rig_cleanup) DELETEs every recorded id + confirms 404, for ALL THREE frames.
#
# Env / creds (same as deb-hetzner-federation.sh):
#   HCLOUD_TOKEN / HETZNER_SSH_KEY_ID / HETZNER_SSH_IDENTITY
#   gh auth: papercupai (owner) + aviynw (members) — b and c may SHARE aviynw
#   (a real multi-device-same-identity topology) or be split via P_C_USER.
#
# Usage: bin/deb-hetzner-multimember.sh [--locs=ash,ash,ash] [--type=cpx31] [--deb=PATH] [--keep-up]
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
  -h|--help) sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) die "unknown arg: $arg" ;;
esac; done
IFS=',' read -r LOC_A LOC_B LOC_C <<<"$LOCS"
[ -n "$LOC_C" ] || LOC_C="$LOC_B"   # default the 3rd loc to the 2nd if omitted
[ -n "$DEB" ] || DEB="$(default_deb)"
P_A_USER="${P_A_USER:-papercupai}"   # owner
P_B_USER="${P_B_USER:-aviynw}"       # member 1
P_C_USER="${P_C_USER:-aviynw}"       # member 2 (may share member-1's gh identity)

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
rig_join_all a   # a (owner self-join) + b + c

# join-hive boots + re-keys the substrate at join — give the swarm time to peer.
fed_log "joined — wait for peer_connect + drain (NO restart)"
sleep 12
for inst in a b c; do
  echo "--- $inst [swarm]/drain diag ---"
  drv_exec "$inst" <<<"grep -aE '\[swarm\]|joined topic|peer_connected|drain|federate|attempted=' /home/pcusp/serve.log | tail -8"
done

# ── swarm discovery: owner must peer with BOTH members ─────────────────────────
rig_wait_swarm a b 70; disc_ab=$?
rig_wait_swarm a c 70; disc_ac=$?

# ── federate ONE write owner→both members (the acceptance check) ───────────────
# Owner writes a feature; assert it lands origin=remote on BOTH b and c. This is
# the minimal star-fanout proof; Brief 2 adds the reverse (member→owner+member) +
# plan-part + coord using the same primitives.
OWNER_SLUG="${FRAME_MEMBER_SLUG[a]}"
fed_log "OWNER→BOTH-MEMBERS: a writes a feature; assert it federates to b AND c"
FID="F-OWNER-$(date +%s)"
rig_write_content a "$OWNER_SLUG" "$FID" "multimember fanout proof" todo >/dev/null

# poll each member for origin=remote (slug-agnostic: hive may remap harness_slug).
poll_remote() {  # <inst> <fid> <tries>
  local inst="$1" fid="$2" tries="${3:-80}" i row
  for i in $(seq 1 "$tries"); do
    row="$(drv_psql "$inst" "SELECT harness_slug FROM harness_shared.harness_features_consolidated WHERE feature_id='$fid' AND origin='remote' LIMIT 1;" 2>/dev/null | tr -d '[:space:]')"
    [ -n "$row" ] && { echo "1 $row"; return 0; }
    sleep 3
  done
  echo "0"; return 1
}
pb="$(poll_remote b "$FID" 80 || true)"; ab2b=0; [ "${pb%% *}" = 1 ] && ab2b=1
pc="$(poll_remote c "$FID" 80 || true)"; ab2c=0; [ "${pc%% *}" = 1 ] && ab2c=1
[ "$ab2b" = 1 ] && echo "✓ owner→b: $FID federated into b (slug='${pb#* }')" || echo "✗ owner→b failed (probe=$pb)"
[ "$ab2c" = 1 ] && echo "✓ owner→c: $FID federated into c (slug='${pc#* }')" || echo "✗ owner→c failed (probe=$pc)"

# on any fail, dump the receive-side roster on each member (empty roster = root cause)
if [ "$ab2b" != 1 ] || [ "$ab2c" != 1 ]; then
  fed_log "FANOUT-DIAG: hive_members roster on each member (empty roster drops every peer op)"
  for inst in b c; do echo "--- $inst roster ---"; rig_read_roster "$inst"; done
fi

# ── report ────────────────────────────────────────────────────────────────────
fed_log "RESULT (3-frame .deb sidecar, Hetzner $STYPE $LOC_A+$LOC_B+$LOC_C, public DHT)"
echo "disc a↔b=$([ "$disc_ab" = 0 ] && echo PASS || echo FAIL)  disc a↔c=$([ "$disc_ac" = 0 ] && echo PASS || echo FAIL)  owner→b=$([ "$ab2b" = 1 ] && echo PASS || echo FAIL)  owner→c=$([ "$ab2c" = 1 ] && echo PASS || echo FAIL)"
if [ "$disc_ab" = 0 ] && [ "$disc_ac" = 0 ] && [ "$ab2b" = 1 ] && [ "$ab2c" = 1 ]; then
  echo "OVERALL: PASS — owner federates a write to BOTH members across 3 separate Hetzner VMs (real public DHT)"; exit 0
fi
echo "OVERALL: INCOMPLETE — see [swarm] diagnostics + /home/pcusp/serve.log on each frame"; exit 6
