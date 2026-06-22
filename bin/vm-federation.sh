#!/usr/bin/env bash
# vm-federation.sh — VM-based two-instance federation proof (Phase 2 of
# linux-test-vm-and-federation-2026-06-04, P-009/P-010/P-011/P-012).
#
# Proves the packaged .deb federates between SEPARATE MACHINES: each instance
# runs in its own pristine Ubuntu VM (real OS, real network hop over the
# papercusp-fedbr0 host bridge), with its own GitHub identity, write-free
# admission (attestation gist), and a deterministic host-run hyperdht/testnet
# bootstrap. The assert core is the same bin/lib/federation-asserts.sh the
# one-box smokes use (D-003) — only the driver differs.
#
# Modes:
#   --vms=2 (default)  fed-a VM ↔ fed-b VM                       (P-009)
#   --vms=1            host-local packaged instance ↔ fed-a VM    (P-010)
#   --dht=testnet (default) host-run hyperdht/testnet on the bridge IP
#   --dht=public       no PAPERCUSP_DHT_BOOTSTRAP — the real public DHT.
#                      Best-effort (P-012): same-host VMs share one public IP
#                      and may fail to hairpin; expect INCONCLUSIVE.
#   --net=bridge (default) papercusp-fedbr0 + taps (needs passwordless sudo)
#   --net=socket       rootless qemu socket L2 between exactly two VMs;
#                      DHT bootstrap runs INSIDE fed-a (requires --vms=2 +
#                      --dht=testnet)
#   --no-reset         reuse existing overlays + installed .deb (iteration);
#                      default is a pristine `vmctl reset` per VM + fresh
#                      install (the clean-boot acceptance run)
#   --skip-install     don't (re)install the .deb (with --no-reset)
#   --keep-up          leave the VMs running after the run (debugging)
#   --deb=PATH         .deb to test (default: newest in the bundle output)
#
# Pass criteria (the local merge proof, now cross-machine): both instances
# boot; [swarm] peer_connected in both logs (join FAILED → fail); a feature
# INSERTed on A lands in B's PG with origin='remote' within ~90s AND the
# reverse; teardown by power-off.
#
# Usage:
#   bin/vm-federation.sh [--vms=2] [--dht=testnet] [--net=bridge] [--deb=PATH]
set -uo pipefail

DESKTOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$DESKTOP_DIR/scripts/linux-test-vm/lib/common.sh"
source "$DESKTOP_DIR/scripts/linux-test-vm/lib/fed-net.sh"
source "$DESKTOP_DIR/bin/lib/federation-asserts.sh"
VMCTL="$DESKTOP_DIR/scripts/linux-test-vm/vmctl"
# common.sh does `set -euo pipefail` — disarm the leaked `-e`: this driver (like
# the smokes) manages its OWN exit codes and EXPECTS non-zero from the discovery/
# merge asserts (they report PASS/FAIL, never abort). With -e left on, the first
# transient non-zero (e.g. a curl to the just-booted sidecar API) killed the run.
set +e

# ── args ────────────────────────────────────────────────────────────────────
VMS=2; DHT=testnet; NET=bridge; RESET=1; INSTALL=1; KEEP_UP=0; DEB=""
for arg in "$@"; do
  case "$arg" in
    --vms=1) VMS=1 ;;
    --vms=2) VMS=2 ;;
    --dht=testnet) DHT=testnet ;;
    --dht=public)  DHT=public ;;
    --net=bridge)  NET=bridge ;;
    --net=socket)  NET=socket ;;
    --no-reset)    RESET=0 ;;
    --skip-install) INSTALL=0 ;;
    --keep-up)     KEEP_UP=1 ;;
    --deb=*)       DEB="${arg#--deb=}" ;;
    -h|--help)     sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown arg: $arg (see --help)" ;;
  esac
done
[ -n "$DEB" ] || DEB="$(default_deb)"
P_A_USER="${P_A_USER:-papercupai}"
P_B_USER="${P_B_USER:-aviynw}"
OPERATOR_DIR="${PAPERCUSP_OPERATOR_DIR:-/home/marsh-office/papercupai-workspace/papercup/apps/operator}"
# Real PUBLIC repo for the hive create-from-repo step (the retired share/finalize
# path used a synthetic repo id; the hive model clones a real repo). Override with
# PAPERCUSP_FED_REPO_URL. Needs VM→github egress (slirp user-net provides NAT).
REPO_URL="${PAPERCUSP_FED_REPO_URL:-https://github.com/octocat/Hello-World}"
DISPLAY_NUM="${PAPERCUSP_SMOKE_DISPLAY:-149}"   # only used by --vms=1's host instance
WORK="$(mktemp -d /tmp/vm-fed.XXXXXX)"
PKG="$WORK/pkg"; BIN="$PKG/usr/bin/papercusp-desktop"
SLUG="vmfed${WORK##*.}"   # per-run unique → reused embedded-PG state can't false-pass the merge

if [ "$NET" = "socket" ]; then
  [ "$VMS" = 2 ] || die "--net=socket supports exactly two VMs (it is a point-to-point L2 link)"
  [ "$DHT" = testnet ] || die "--net=socket requires --dht=testnet (bootstrap runs inside fed-a)"
fi

# ── instance table ──────────────────────────────────────────────────────────
# inst 'a' / 'b'; FED_KIND decides which driver primitive serves it.
declare -gA FED_KIND FED_VM FED_IDX FED_USER FED_TOKEN
if [ "$VMS" = 2 ]; then
  FED_KIND[a]=vm;    FED_VM[a]=fed-a; FED_IDX[a]=1
else
  FED_KIND[a]=local; FED_LOG[a]="$WORK/a.log"
fi
FED_KIND[b]=vm; FED_VM[b]=fed-b; FED_IDX[b]=2
[ "$VMS" = 1 ] && { FED_VM[b]=fed-a; FED_IDX[b]=1; }
FED_USER[a]="$P_A_USER"; FED_USER[b]="$P_B_USER"

# ── the vm/mixed driver vtable (overrides the lib's local-only default) ─────
drv_exec() {
  local inst="$1"
  case "${FED_KIND[$inst]}" in
    local) bash -s ;;
    vm)    vm_ssh "${FED_VM[$inst]}" 'bash -s' ;;
  esac
}
drv_applog() {
  local inst="$1"
  case "${FED_KIND[$inst]}" in
    local) echo "${FED_LOG[$inst]}" ;;
    vm)    echo "/home/tester/papercusp-app.log" ;;
  esac
}
drv_psql() {   # SQL goes over stdin — robust against nested quoting
  local inst="$1" sql="$2"
  case "${FED_KIND[$inst]}" in
    local) psql "${FED_DB[$inst]}" -tA -c "$sql" ;;
    vm)    printf '%s\n' "$sql" | vm_ssh "${FED_VM[$inst]}" \
             "psql 'postgresql://harness_admin:harness_admin_pwd@localhost:${FED_PG[$inst]}/papercusp' -tA" ;;
  esac
}

# ── cleanup ─────────────────────────────────────────────────────────────────
cleanup() {
  fed_log "cleanup (scoped to $WORK)"
  # --keep-up is a DEBUGGING flag — rescue the per-instance host/local app logs
  # the diagnosis needs BEFORE fed_cleanup_scoped rm -rf's $WORK. (VM-side logs
  # live in the guest, which --keep-up leaves running, reachable via vm_ssh.)
  if [ "$KEEP_UP" = 1 ]; then
    local dest="${PAPERCUSP_FED_LOGS_DIR:-/tmp/vm-fed-logs}/$SLUG" i
    mkdir -p "$dest"
    for i in a b; do
      [ "${FED_KIND[$i]:-}" = local ] && [ -f "${FED_LOG[$i]:-/nonexistent}" ] \
        && cp "${FED_LOG[$i]}" "$dest/$i.log" 2>/dev/null || true
    done
    log "--keep-up: preserved host/local instance logs → $dest"
  fi
  fed_cleanup_scoped "$WORK"
  if [ "$KEEP_UP" = 0 ]; then
    local n
    for n in $(fed_vm_names); do "$VMCTL" down "$n" || true; done
  else
    log "--keep-up: VMs left running ($(fed_vm_names | tr '\n' ' '))"
  fi
}
fed_vm_names() { { [ "${FED_KIND[a]}" = vm ] && echo "${FED_VM[a]}"; echo "${FED_VM[b]}"; } | sort -u; }
trap cleanup EXIT

# ── 1. artifact gates (P-011 static: fail fast on an older/corrupt .deb) ───
fed_log "artifact: $DEB"
fed_extract_deb "$DEB" "$PKG" || exit 2
fed_clobber_check "$PKG" || exit 2
fed_assert_deb_swarm_support "$PKG" || exit 2

# ── 2. identities ───────────────────────────────────────────────────────────
FED_TOKEN[a]="$(gh auth token --user "${FED_USER[a]}" 2>/dev/null)" || true
FED_TOKEN[b]="$(gh auth token --user "${FED_USER[b]}" 2>/dev/null)" || true
[ -n "${FED_TOKEN[a]}" ] && [ -n "${FED_TOKEN[b]}" ] \
  || { echo "FATAL: need gh tokens for ${FED_USER[a]} + ${FED_USER[b]} (gh auth login)"; exit 1; }

# ── 3. federation network ───────────────────────────────────────────────────
if [ "$NET" = bridge ]; then
  fednet_have_root || die "bridge mode needs passwordless sudo — rerun with --net=socket (rootless)"
  fed_log "bridge $FEDBR up (host $FEDBR_HOST_IP)"
  fednet_bridge_up
  for inst in a b; do
    [ "${FED_KIND[$inst]}" = vm ] && fednet_tap_up "${FED_IDX[$inst]}"
  done
fi

# ── 4. VMs up (pristine by default) ─────────────────────────────────────────
boot_vm() {  # <inst>
  local inst="$1" name="${FED_VM[$inst]}" idx="${FED_IDX[$inst]}"
  if [ "$RESET" = 1 ]; then
    fed_log "reset $name to a pristine overlay"
    "$VMCTL" reset "$name" || die "reset $name failed"
  fi
  fed_log "boot $name (fed NIC: $NET, slirp 10.31.$idx.0/24)"
  # Distinct slirp subnet per VM: with the qemu default both VMs are 10.0.2.15,
  # and hyperswarm's holepunch local-address candidates then point a peer at
  # ITSELF — discovery stalls even though the DHT join succeeds.
  FED_NIC="$(fednet_nic_args "$NET" "$idx")" SLIRP_NET="10.31.$idx.0/24" \
    "$VMCTL" up "$name" || die "boot $name failed"
  vm_ssh "$name" true 2>/dev/null || die "SSH not reachable on $name"
  fednet_guest_configure "$name" "$idx" "$NET" || die "guest fed-NIC config failed on $name"
}
for inst in a b; do [ "${FED_KIND[$inst]}" = vm ] && boot_vm "$inst"; done

# reachability: every VM must see the DHT host; in 2-VM mode also each other
if [ "$NET" = bridge ]; then
  for inst in a b; do
    [ "${FED_KIND[$inst]}" = vm ] || continue
    r="$(fednet_guest_ping "${FED_VM[$inst]}" "$FEDBR_HOST_IP")"
    echo "  ${FED_VM[$inst]} → host $FEDBR_HOST_IP: $r"
    [ "$r" = reachable ] || { echo "FATAL: bridge reachability failed"; exit 3; }
  done
  if [ "$VMS" = 2 ]; then
    r="$(fednet_guest_ping "${FED_VM[a]}" "$(fednet_bridge_ip "${FED_IDX[b]}")")"
    echo "  ${FED_VM[a]} → ${FED_VM[b]}: $r"
    [ "$r" = reachable ] || { echo "FATAL: VM↔VM bridge reachability failed"; exit 3; }
  fi
fi

# ── 5. install the .deb + driver prereqs in each VM ─────────────────────────
install_vm() {  # <inst>
  local inst="$1" name="${FED_VM[$inst]}"
  if [ "$INSTALL" = 1 ]; then
    fed_log "install .deb into $name (fresh-install dep resolution)"
    "$VMCTL" install "$name" "$DEB" || die "install failed on $name"
  fi
  # Driver prereqs (NOT app deps — the app's own dep test is the apt install
  # above): gh for identity resolution (gh-token.ts shells out to `gh auth
  # token`; the GH_TOKEN env var satisfies it without a login), psql for the
  # merge asserts (the .deb bundles initdb/postgres but no client).
  fed_log "driver prereqs in $name (gh + postgresql-client)"
  vm_ssh "$name" 'command -v gh >/dev/null && command -v psql >/dev/null' 2>/dev/null \
    || vm_ssh "$name" 'sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq gh postgresql-client >/dev/null' \
    || die "prereq install failed on $name"
}
for inst in a b; do [ "${FED_KIND[$inst]}" = vm ] && install_vm "$inst"; done

# ── 6. DHT bootstrap ────────────────────────────────────────────────────────
BOOTSTRAP=""
case "$DHT" in
  testnet)
    if [ "$NET" = bridge ]; then
      BOOTSTRAP="$(fed_start_testnet_dht "$OPERATOR_DIR" "$WORK" "$FEDBR_HOST_IP")" || exit 3
    else
      # socket mode: host is not on the fed L2 — bootstrap runs inside fed-a
      # (the .deb's own bundled node + a host-side esbuild bundle of
      # hyperdht/testnet would need native modules; apt node + npm hyperdht
      # is the pragmatic in-VM path).
      fed_log "spin testnet DHT inside ${FED_VM[a]} (rootless socket mode)"
      vm_ssh "${FED_VM[a]}" 'command -v node >/dev/null || sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs npm >/dev/null
        mkdir -p ~/fed-dht && cd ~/fed-dht && [ -d node_modules/hyperdht ] || npm install --no-audit --no-fund hyperdht >/dev/null 2>&1
        nohup node --input-type=module -e "
          import createTestnet from \"hyperdht/testnet.js\";
          const t = await createTestnet(3, { host: \"10.99.0.1\" });
          console.log(\"BOOTSTRAP=\" + t.bootstrap.map(b => b.host + \":\" + b.port).join(\",\"));
          setInterval(() => {}, 1 << 30);
        " > ~/fed-dht/dht.log 2>&1 & sleep 4; grep -oE "BOOTSTRAP=[^ ]+" ~/fed-dht/dht.log | head -1' \
        > "$WORK/vm-dht.out" 2>&1
      BOOTSTRAP="$(grep -oE 'BOOTSTRAP=[^ ]+' "$WORK/vm-dht.out" | head -1 | cut -d= -f2)"
      [ -n "$BOOTSTRAP" ] || { echo "FATAL: in-VM testnet DHT did not start"; cat "$WORK/vm-dht.out"; exit 3; }
    fi
    echo "PAPERCUSP_DHT_BOOTSTRAP=$BOOTSTRAP" ;;
  public)
    fed_log "P-012 stretch: PUBLIC DHT (no bootstrap override) — same-host VMs may fail to hairpin" ;;
esac

# ── 7. launch instances ─────────────────────────────────────────────────────
launch_vm_instance() {  # <inst> [wipe]   wipe=1 (first launch) clears PG state
  local inst="$1" wipe="${2:-1}" name="${FED_VM[$inst]}"
  fed_log "launch packaged app in $name (identity ${FED_USER[$inst]}${wipe:+, wipe=$wipe})"
  # env file over SSH stdin (0600) — keeps the token out of argv/ps
  printf 'GH_TOKEN=%s\n%s' "${FED_TOKEN[$inst]}" \
    "${BOOTSTRAP:+PAPERCUSP_DHT_BOOTSTRAP=$BOOTSTRAP}" \
    | vm_ssh "$name" 'umask 077; cat > ~/fed.env'
  # The desktop puts the embedded-PG data dir at ~/.papercusp-workspaces/.shared/
  # embedded-pg-data (NOT ~/.papercusp). WIPE=1 (first launch of a run) clears it
  # for a clean initdb + clean migration sequence — a reused dir can carry a
  # half-applied schema (e.g. a re-run migration ALTERing harness_features, now a
  # view post unify-work-items → "ADD COLUMN cannot be performed" → PG exits → no
  # DB). WIPE=0 (relaunch retry) PRESERVES the now-clean dir so the embedded-PG
  # spawn is a fast RESTART (~3s) that wins the desktop's 30s sidecar-start budget
  # instead of a fresh initdb (~20-30s) that loses it under concurrent 2-VM load.
  WIPE="$wipe" vm_run "$name" <<'EOF'
pkill -f papercusp-desktop 2>/dev/null; pkill -f 'sidecar/serve.mjs' 2>/dev/null
pkill -f embedded-postgres 2>/dev/null; sleep 1
rm -f ~/papercusp-app.log ~/.papercusp-workspaces/.shared/embedded-pg-data/postmaster.pid 2>/dev/null
if [ "${WIPE:-1}" = 1 ]; then rm -rf ~/.papercusp ~/.papercusp-workspaces; fi
mkdir -p ~/.papercusp ~/fed
export DISPLAY=:0 XAUTHORITY="$HOME/.Xauthority"
for _ in $(seq 1 30); do xdpyinfo -display :0 >/dev/null 2>&1 && break; sleep 1; done
xdpyinfo -display :0 >/dev/null 2>&1 || { echo "X :0 not ready (see ~/startx.log)"; exit 1; }
set -a; . ~/fed.env; set +a
setsid bash -c 'exec /usr/bin/papercusp-desktop' >"$HOME/papercusp-app.log" 2>&1 </dev/null &
sleep 1; echo "launched (wipe=${WIPE:-1})"
EOF
}
launch_local_instance() {  # <inst> — the --vms=1 host-side instance
  local inst="$1"
  fed_log "launch packaged app on the HOST (identity ${FED_USER[$inst]})"
  STARTED_XVFB="$(fed_ensure_display "$DISPLAY_NUM" "$WORK")"
  local envs=(GH_TOKEN="${FED_TOKEN[$inst]}")
  [ -n "$BOOTSTRAP" ] && envs+=(PAPERCUSP_DHT_BOOTSTRAP="$BOOTSTRAP")
  fed_local_launch "$WORK/inst-$inst" "${FED_LOG[$inst]}" "$BIN" "$DISPLAY_NUM" "${envs[@]}"
}
launch_instance() {  # <inst> [wipe]
  case "${FED_KIND[$1]}" in
    vm)    launch_vm_instance "$1" "${2:-1}" ;;
    local) launch_local_instance "$1" ;;
  esac
}
for inst in a b; do launch_instance "$inst" 1 || exit 4; done

# ── 8. boot + isolation ─────────────────────────────────────────────────────
# Bounded relaunch retry: a clean machine can lose the embedded-PG-vs-sidecar
# boot race (sidecar up first → ECONNREFUSED :5432 → "sidecar did not start
# within 30s" → app exits) when a fresh initdb (~20-30s) overruns the 30s budget
# under concurrent 2-VM load. The RELAUNCH passes wipe=0 so it PRESERVES the
# now-initialised data dir → a fast PG restart (~3s) wins the race. This is the
# clean-machine timing the VM exists to surface; the harness recovers it.
ensure_booted() {  # <inst>
  local inst="$1" attempt
  for attempt in 1 2 3; do
    fed_wait_boot "$inst" 40 && return 0
    [ "$attempt" = 3 ] && break
    echo "[$inst] boot attempt $attempt failed ($FED_BOOT_ERR) — relaunching (preserve data dir)"
    drv_exec "$inst" <<<"tail -6 $(drv_applog "$inst") 2>/dev/null | sed 's/^/    /'" || true
    launch_instance "$inst" 0 || return 1
  done
  return 1
}
fed_log "waiting for embedded-PG + sidecar in both instances"
ensure_booted a || { echo "A boot failed after retries: $FED_BOOT_ERR"; drv_exec a <<<"tail -25 $(drv_applog a)"; exit 4; }
ensure_booted b || { echo "B boot failed after retries: $FED_BOOT_ERR"; drv_exec b <<<"tail -25 $(drv_applog b)"; exit 4; }
[ "${FED_KIND[a]}" = local ] && FED_DB[a]="postgresql://harness_admin:harness_admin_pwd@localhost:${FED_PG[a]}/papercusp"
fed_log "A: PG=${FED_PG[a]} sc=${FED_SC[a]} | B: PG=${FED_PG[b]} sc=${FED_SC[b]}"
if [ "$VMS" = 2 ]; then
  echo "✓ isolated by construction (separate VMs)"
else
  fed_assert_isolated a b || exit 5
fi

# ── 9. create-from-repo on A (auto-publish) → discover → join on B ──────────
# The per-harness /share/finalize step was RETIRED (comb-retire-per-harness-
# sharing-2026-06-11 → the HIVE model). Current federation-setup: A creates a hive
# from a real PUBLIC repo (from-repo clones + blueprints + builds the hive home +
# member and AUTO-PUBLISHES on the directory topic), B discovers A's announce over
# the wire, then JOINS as a hive — the join re-keys B onto the owner's Hive-pubkey
# topic so writes actually federate (EI-681). Mirrors two-instance-hive-from-repo-
# smoke.sh over the vm/local drv_exec vtable.
fed_log "create-from-repo on A → discover → join on B (repo=$REPO_URL)"
fed_wait_api a || echo "⚠ A sidecar API not ready (proceeding)"
fed_wait_api b || echo "⚠ B sidecar API not ready (proceeding)"

a_resp="$(fed_hive_create_from_repo a "$REPO_URL")"
echo "A create → $(printf '%s' "$a_resp" | head -c 400)"
HIVE_SLUG="$(fed_json "$a_resp" "d['created']['hiveSlug']")"
MEMBER_SLUG="$(fed_json "$a_resp" "d['created']['memberSlug']")"
A_ANNOUNCED="$(fed_json "$a_resp" "d['publish']['announced']")"
if [ -n "$HIVE_SLUG" ] && [ -n "$MEMBER_SLUG" ]; then
  echo "✓ A created hive='$HIVE_SLUG' member='$MEMBER_SLUG' (publish.announced=$A_ANNOUNCED)"
else
  echo "✗ A from-repo create failed — body above"; drv_exec a <<<"tail -25 $(drv_applog a)"; exit 6
fi

# B discovers A's hive over the wire (proves the directory announce crossed) and
# reads its memberLinks; fall back to A's OWN listing if the announce hasn't landed
# in B's directory yet — the join + merge legs then still prove federation
# independent of the directory-announce projection.
fed_log "B: poll GET /api/discovery/hives for '$HIVE_SLUG' (~$(( ${DISCOVERY_RETRIES:-40} * 3 ))s)"
MEMBER_LINKS="[]"; links_via="directory(B)"
for _ in $(seq 1 "${DISCOVERY_RETRIES:-40}"); do
  brow="$(fed_hive_dir_row b "$HIVE_SLUG")"
  if [ -n "$brow" ]; then
    MEMBER_LINKS="$(fed_json "$brow" "json.dumps(d.get('memberLinks') or [])")"
    [ -n "$MEMBER_LINKS" ] && [ "$MEMBER_LINKS" != "[]" ] && break
  fi
  sleep 3
done
if [ -z "$MEMBER_LINKS" ] || [ "$MEMBER_LINKS" = "[]" ]; then
  arow="$(fed_hive_dir_row a "$HIVE_SLUG")"
  MEMBER_LINKS="$(fed_json "$arow" "json.dumps(d.get('memberLinks') or [])")"
  links_via="local(A-fallback)"
fi
if [ -n "$MEMBER_LINKS" ] && [ "$MEMBER_LINKS" != "[]" ]; then
  echo "✓ memberLinks resolved via $links_via: $(fed_json "$MEMBER_LINKS" 'len(d)') link(s)"
else
  echo "✗ no memberLinks from B's discovery OR A's local listing — cannot join"; exit 6
fi

fed_log "B: JOIN '$HIVE_SLUG' via POST /api/discovery/join-hive"
join_resp="$(fed_hive_join b "$HIVE_SLUG" "$MEMBER_LINKS")"
echo "B join-hive → $(printf '%s' "$join_resp" | head -c 400)"
J_OK="$(fed_json "$join_resp" "d.get('ok')")"
N_MEM_OK="$(fed_json "$join_resp" "sum(1 for m in (d.get('members') or []) if m.get('ok'))")"
if [ "$J_OK" = "True" ] && [ "${N_MEM_OK:-0}" -ge 1 ] 2>/dev/null; then
  echo "✓ B joined hive '$HIVE_SLUG' ($N_MEM_OK member(s) — view materialized, re-keyed onto owner topic)"
else
  echo "✗ B join-hive failed (ok=$J_OK members_ok=$N_MEM_OK) — body above"; drv_exec b <<<"tail -25 $(drv_applog b)"; exit 6
fi

# ── 10. discovery ([swarm] peer_connected across a real network hop) ────────
fed_log "wait for swarm peer discovery + admission (~90s)"
disc="$(fed_wait_discovery a b strict 30 || true)"
[ "$disc" = 1 ] && echo "✓ peers discovered each other across machines" || echo "⚠ no peer_connected in ~90s"

# ── 11. the bidirectional MERGE gate (slug-agnostic hive probe) ─────────────
# The hive model may remap harness_slug across peers, so poll the dst for the
# feature_id under ANY slug (fed_hive_merge_probe), seeded on the src's member
# harness ($MEMBER_SLUG). Same bidirectional proof as the pre-hive rig.
fed_log "A→B: write F-A2B on A's member ($MEMBER_SLUG, origin=local) → expect origin=remote in B"
ab="$(fed_hive_merge_probe a b "$MEMBER_SLUG" F-A2B 30 || true)"; ab="${ab%% *}"
[ "$ab" = 1 ] && echo "✓ A→B MERGE: F-A2B federated into B as origin=remote" || echo "✗ A→B: F-A2B not in B after ~90s"
fed_log "B→A: write F-B2A on B → expect origin=remote in A"
ba="$(fed_hive_merge_probe b a "$MEMBER_SLUG" F-B2A 30 || true)"; ba="${ba%% *}"
[ "$ba" = 1 ] && echo "✓ B→A MERGE: F-B2A federated into A as origin=remote" || echo "✗ B→A: F-B2A not in A after ~90s"

# ── 12. report ──────────────────────────────────────────────────────────────
fed_log "RESULT (vms=$VMS dht=$DHT net=$NET reset=$RESET)"
if [ "$disc" != 1 ] || [ "$ab" != 1 ] || [ "$ba" != 1 ]; then
  echo "── [swarm] diagnostics ──"
  for inst in a b; do
    echo "[$inst] $(drv_exec "$inst" <<<"grep -E '\[swarm\]' $(drv_applog "$inst") 2>/dev/null | tail -5" )"
  done
fi
echo "discovery=$([ "$disc" = 1 ] && echo PASS || echo FAIL)  A→B-merge=$([ "$ab" = 1 ] && echo PASS || echo FAIL)  B→A-merge=$([ "$ba" = 1 ] && echo PASS || echo FAIL)"
if [ "$disc" = 1 ] && [ "$ab" = 1 ] && [ "$ba" = 1 ]; then
  echo "OVERALL: PASS — packaged cross-machine federation proven (real OS × $((VMS)), real network hop, write-free admission)"
  exit 0
else
  if [ "$DHT" = public ]; then
    echo "OVERALL: INCONCLUSIVE — public-DHT mode is best-effort on same-host VMs (NAT hairpin; see D-004)"
    exit 7
  fi
  echo "OVERALL: INCOMPLETE — see the [swarm] diagnostics above + the per-instance app logs"
  exit 6
fi
