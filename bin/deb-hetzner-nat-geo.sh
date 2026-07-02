#!/usr/bin/env bash
# deb-hetzner-nat-geo.sh — Brief 8 LIVE scenario: federation beyond the easy
# public-IP, same-region topology — across DISTANT regions and behind a real
# NAT/firewall that forces DHT holepunch (not a trivial direct connect).
#
# federation-release-hardening-relaunch-2026-07-01 P-008 / WI-1334.
#
# WHY: every prior federation proof used two same-region public-IP Hetzner VMs —
# the EASY case (direct connect, no holepunch, low latency). Real users are behind
# NAT and spread across geographies. This proves the two hard axes live:
#   (a) GEO DIVERSITY — the two frames sit in DISTANT regions (cross-continent by
#       default, e.g. Ashburn US ↔ Helsinki EU), so the swarm peers over real
#       inter-continental latency, not a same-DC hop.
#   (b) NAT / FIREWALL — frame B runs a STATEFUL firewall (a restricted-cone-NAT
#       approximation): only outbound-initiated (ESTABLISHED,RELATED) inbound is
#       allowed; SSH (22) stays open for the driver; every other NEW inbound is
#       DROPPED. So B is NOT directly reachable — the hyperswarm peer connection
#       can ONLY form via DHT holepunch (both peers punch outbound; the return
#       rides the conntrack ESTABLISHED state). If federation still works, holepunch
#       works behind that NAT. If it doesn't, THAT is the finding to document.
#
# THE TEST (the decisive signal is peer_connected + bidirectional merge):
#   1. provision a (owner) + b (member) in DISTANT regions.
#   2. install + boot the sidecars; publish + join the hive.
#   3. apply the NAT firewall to B (AFTER boot, so the driver keeps SSH; BEFORE the
#      swarm peers, so peering must holepunch through it).
#   4. wait swarm peer_connected a↔b — this succeeding IS the holepunch-behind-NAT
#      + cross-region proof.
#   5. federate a feature A→B AND B→A — content crosses in both directions.
#   6. report the region pair, the NAT state, and the holepunch/merge verdicts.
#
# NOTE (documented limitation): a stateful conntrack firewall models a full/restricted-
# cone NAT. SYMMETRIC NAT (per-destination port mapping) is strictly harder for
# holepunch and is a stronger follow-up (would need a real symmetric-NAT middlebox,
# not iptables on the endpoint). This scenario proves the common case; it flags
# symmetric NAT as the remaining rung.
#
# COST-SAFETY: identical to deb-hetzner-federation.sh — every provisioned server id
# is recorded BEFORE install, and the EXIT trap (rig_install_exit_trap → rig_cleanup)
# DELETEs every recorded id + confirms 404. 2 frames → fits the ~2-server quota.
# ⚠ Acquire the Hetzner-quota lock (locks:acquire { paths:['ops/hetzner-federation-quota'] })
# before provisioning; verify `servers = 0` + release after.
#
# Env / creds (same as deb-hetzner-federation.sh):
#   HCLOUD_TOKEN / HETZNER_SSH_KEY_ID / HETZNER_SSH_IDENTITY
#   gh auth: papercupai (owner=a) + aviynw (member=b)
#
# Usage: bin/deb-hetzner-nat-geo.sh [--locs=ash,hel1] [--type=cpx31] [--deb=PATH] [--nat=on|off] [--keep-up]
set -uo pipefail

DESKTOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$DESKTOP_DIR/scripts/linux-test-vm/lib/common.sh"
source "$DESKTOP_DIR/bin/lib/federation-asserts.sh"
source "$DESKTOP_DIR/bin/lib/deb-hetzner-rig.sh"
set +e   # this driver owns its own exit codes
set +u   # the FED_*/FRAME_* assoc arrays are nounset-hostile

# ── NAT firewall function (scenario-local helper — NOT the shared rig lib) ────
# rig_apply_nat_firewall <inst> — apply a stateful restricted-cone-NAT firewall to
# <inst>: accept loopback + ESTABLISHED,RELATED + SSH(22) + ICMP, then DROP all
# other NEW inbound (policy set LAST so the live SSH session — already ESTABLISHED —
# survives). OUTPUT stays ACCEPT so the peer punches outbound freely. Idempotent.
rig_apply_nat_firewall() {
  # NB: split declarations — a single `local a=$1 b=${arr[$a]}` evaluates ALL RHS
  # expansions before ANY assignment lands, so ${FRAME_IP[$inst]} would see an
  # empty $inst → "bad array subscript" + empty ip → NAT firewall silently skipped
  # (frame B stays fully open, invalidating the NAT axis). Matches the rig lib form.
  local inst="$1"; local ip="${FRAME_IP[$inst]}"
  [ -n "$ip" ] || { fed_log "[$inst] NAT-SKIP: no IP resolved for frame '$inst' (FRAME_IP unset)"; return 1; }
  fed_log "[$inst] apply STATEFUL NAT firewall (drop unsolicited inbound; keep SSH+established) → force DHT holepunch"
  rig_ssh "$ip" 'bash -s' <<'EOF'
set -e
command -v iptables >/dev/null 2>&1 || { export DEBIAN_FRONTEND=noninteractive; apt-get install -y -qq iptables >/dev/null 2>&1 || true; }
command -v iptables >/dev/null 2>&1 || { echo "NAT-SKIP: iptables unavailable"; exit 0; }
# Order matters: install the ACCEPT rules FIRST, set the DROP policy LAST, so the
# current (ESTABLISHED) SSH session is never cut.
iptables -F INPUT || true
iptables -A INPUT -i lo -j ACCEPT
iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A INPUT -p tcp --dport 22 -m conntrack --ctstate NEW -j ACCEPT
iptables -A INPUT -p icmp -j ACCEPT
iptables -P INPUT DROP
echo "NAT-firewall active (restricted-cone approximation):"
iptables -S INPUT | sed 's/^/  /'
EOF
}

# ── args / config ─────────────────────────────────────────────────────────────
# Default to a CROSS-CONTINENT pair: ash (Ashburn, US-East) ↔ hel1 (Helsinki, EU).
LOCS="ash,hel1"; STYPE="cpx31"; DEB=""; KEEP_UP=0; IMAGE="ubuntu-24.04"; NAT="on"
for arg in "$@"; do case "$arg" in
  --locs=*) LOCS="${arg#--locs=}" ;;
  --type=*) STYPE="${arg#--type=}" ;;
  --deb=*)  DEB="${arg#--deb=}" ;;
  --image=*) IMAGE="${arg#--image=}" ;;
  --nat=*)  NAT="${arg#--nat=}" ;;
  --keep-up) KEEP_UP=1 ;;
  -h|--help) sed -n '2,52p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) die "unknown arg: $arg" ;;
esac; done
IFS=',' read -r LOC_A LOC_B <<<"$LOCS"
[ -n "$LOC_B" ] || LOC_B="$LOC_A"
[ -n "$DEB" ] || DEB="$(default_deb)"
P_A_USER="${P_A_USER:-papercupai}"; P_B_USER="${P_B_USER:-aviynw}"

# ── init the reusable rig + ARM auto-destroy (BEFORE any provision) ────────────
RIG_KEEP_UP="$KEEP_UP"
rig_init "$STYPE" "$IMAGE" || exit 1
rig_install_exit_trap
RIG_DEB="$DEB"

# ── artifact gate ─────────────────────────────────────────────────────────────
rig_gate_artifact "$DEB" || exit 2

# ── identities (a=owner, b=joiner) ────────────────────────────────────────────
rig_set_identity a "$P_A_USER" || exit 1
rig_set_identity b "$P_B_USER" || exit 1

# ── provision both frames in DISTANT regions (records ids BEFORE install) ─────
fed_log "GEO: frame a=$LOC_A  frame b=$LOC_B (NAT=$NAT)"
rig_provision "$LOC_A" "$LOC_B" || exit 3

# ── install .deb + launch the headless sidecar on each frame ──────────────────
rig_setup_frame a || exit 4
rig_setup_frame b || exit 4

# ── boot + api ────────────────────────────────────────────────────────────────
fed_log "wait embedded-PG + operator in both sidecars"
fed_wait_boot a 50 || { echo "A boot failed: $FED_BOOT_ERR"; drv_exec a <<<"tail -25 /home/pcusp/serve.log"; exit 5; }
fed_wait_boot b 50 || { echo "B boot failed: $FED_BOOT_ERR"; drv_exec b <<<"tail -25 /home/pcusp/serve.log"; exit 5; }
echo "✓ isolated by construction (separate cloud machines, distant regions)"
fed_log "A[$LOC_A]: PG=${FED_PG[a]} sc=${FED_SC[a]} | B[$LOC_B]: PG=${FED_PG[b]} sc=${FED_SC[b]}"
fed_wait_api a || echo "⚠ A api not ready"; fed_wait_api b || echo "⚠ B api not ready"

# ── apply the NAT firewall to B (after boot: driver keeps SSH; before peering) ─
# Track whether the firewall was ACTUALLY applied — a failed apply must NOT be
# reported as a NAT pass (that was the FRAME_IP-empty false-signal bug).
nat_applied=0
if [ "$NAT" = "on" ]; then
  if rig_apply_nat_firewall b; then nat_applied=1
  else echo "✗ NAT firewall NOT applied on B — result CANNOT claim the NAT axis (see NAT-SKIP above)"; fi
else
  echo "NAT disabled (--nat=off): geo-only run"
fi

# ── REAL hive join (both peers via /api/discovery/join-hive) ──────────────────
REPO_URL="${HIVE_REPO_URL:-https://github.com/octocat/Hello-World}"
rig_owner_publish_hive a "$REPO_URL" || exit 6
rig_join_hive a; A_MEMBER_SLUG="${FRAME_MEMBER_SLUG[a]}"
rig_join_hive b; B_MEMBER_SLUG="${FRAME_MEMBER_SLUG[b]}"
fed_log "join-hive booted + re-keyed the substrate — wait for peer_connect + drain over the DISTANT/NAT topology"
sleep 12
for inst in a b; do
  echo "--- $inst [swarm]/holepunch diag ---"
  drv_exec "$inst" <<<"grep -aE '\[swarm\]|joined topic|peer_connected|holepunch|punch|dht|announce|lookup|drain|federate' /home/pcusp/serve.log | tail -10"
done

# ── THE KEY TEST: peer_connected across regions + through B's NAT (holepunch) ──
fed_log "wait swarm peer_connected a↔b (SUCCESS = holepunch worked cross-region + behind B's NAT)"
disc="$(fed_wait_discovery a b strict 180 || true)"   # generous window: cross-continent + holepunch adds latency (doubled 90→180 tries, try5)
hp=0; [ "$disc" = 1 ] && hp=1
[ "$hp" = 1 ] && echo "✓ peer_connected a↔b — holepunch succeeded across [$LOC_A↔$LOC_B]${NAT:+ + NAT=$NAT}" \
             || echo "✗ NO peer_connected in ~270s — holepunch/cross-region peering FAILED (a real Brief-8 finding; see diag)"

# ── content federation A→B and B→A over the NAT/geo topology ──────────────────
fed_log "A→B MERGE (hive slug-agnostic probe) over the distant/NAT topology"
probe_ab="$(fed_hive_merge_probe a b "$A_MEMBER_SLUG" F-NAT-A2B 180 || true)"
ab=0; [ "${probe_ab%% *}" = 1 ] && ab=1
[ "$ab" = 1 ] && echo "✓ A→B: F-NAT-A2B federated into B origin=remote (slug='${probe_ab#* }')" || echo "✗ A→B failed (probe=$probe_ab)"
fed_log "B→A MERGE (reverse — the NAT'd member must also PUSH to the owner)"
probe_ba="$(fed_hive_merge_probe b a "$B_MEMBER_SLUG" F-NAT-B2A 180 || true)"
ba=0; [ "${probe_ba%% *}" = 1 ] && ba=1
[ "$ba" = 1 ] && echo "✓ B→A: F-NAT-B2A federated into A origin=remote (slug='${probe_ba#* }')" || echo "✗ B→A failed (probe=$probe_ba)"

# on any fail, dump the receive-side roster (empty roster = the e7698 no-restart signal)
if [ "$ab" != 1 ] || [ "$ba" != 1 ]; then
  fed_log "MERGE-DIAG: hive_members roster on each frame (empty roster ⇒ decideMemberContentOp drops peer ops — the no-restart roster race)"
  for inst in a b; do echo "--- $inst roster ---"; rig_read_roster "$inst"; done
fi

# ── report ────────────────────────────────────────────────────────────────────
fed_log "BRIEF 8 NAT/GEO RESULT (2-frame .deb sidecar, Hetzner $STYPE, public DHT)"
cat <<REPORT
  region pair          : $LOC_A ↔ $LOC_B  (cross-continent by default)
  NAT on frame B       : $([ "$NAT" = on ] && { [ "$nat_applied" = 1 ] && echo 'on — APPLIED (stateful restricted-cone approximation)' || echo 'on — REQUESTED BUT NOT APPLIED (⚠ NAT axis UNPROVEN)'; } || echo 'off (geo-only)')
  holepunch/peering    : $([ "$hp" = 1 ] && echo 'PASS — peer_connected' || echo 'FAIL — no peer_connected')
  content A→B          : $([ "$ab" = 1 ] && echo PASS || echo FAIL)
  content B→A          : $([ "$ba" = 1 ] && echo PASS || echo FAIL)

  Documented limitation: this proves the full/restricted-cone-NAT case. SYMMETRIC
  NAT (per-destination port mapping) is a stronger rung — needs a real symmetric-NAT
  middlebox, not endpoint iptables. Flagged as a follow-up, not covered here.
REPORT
# NAT axis must have been ACTUALLY applied to claim a NAT pass (guards the false-signal bug).
nat_ok=1; [ "$NAT" = "on" ] && [ "$nat_applied" != 1 ] && nat_ok=0
if [ "$hp" = 1 ] && [ "$ab" = 1 ] && [ "$ba" = 1 ] && [ "$nat_ok" = 1 ]; then
  echo "OVERALL: PASS — federation works cross-region${NAT:+ + behind a NAT firewall} (real public DHT holepunch)"; exit 0
fi
[ "$nat_ok" = 1 ] || echo "OVERALL: INCOMPLETE — NAT firewall was requested but never applied (frame IP unresolved); the NAT axis is UNPROVEN even if peering/merge passed"
echo "OVERALL: INCOMPLETE — federation degraded under geo/NAT; see [swarm]/holepunch diag + serve.log on each frame"
# EXIT trap (rig_cleanup) tears down all frames + confirms servers=0.
exit 6
