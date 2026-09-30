#!/usr/bin/env bash
# same-box-rig.sh — bring up / tear down the same-box two-instance rig that
# `bin/hive-git-drill.sh --rig same-box` rehearses the physical scenario against
# (plan physical-drill-iteration-speed-2026-09-29 P-005 / R-4, design = decision D-003).
#
#   same-box-rig.sh up     [--dir <rig dir>] [--repo <github url>] [--sidecar <composed dir>]
#   same-box-rig.sh status --dir <rig dir>
#   same-box-rig.sh start-vm --dir <rig dir>      (the rig's VM owner launcher; boot-vm.sh calls it)
#   same-box-rig.sh down   --dir <rig dir>
#
# WHAT `up` BUILDS — nothing new, only glue over the canonical federation helpers:
#   * one CURRENT composed sidecar (compose-rig-sidecar-current.sh --no-push), written into
#     the rig directory. It is the payload the physical VM runs, so both halves match it.
#     NEVER the shared default cache: the physical rig's preflight compares against that
#     stamp, and recomposing it would break a concurrent physical run.
#   * a 3-node testnet DHT (fed_start_testnet_dht, kept up for the rig's lifetime);
#   * two isolated owners (fed_local_launch_sidecar — throwaway HOMEs, own ports, own
#     embedded PG, the ambient-env scrubbing every local smoke relies on);
#   * the tower creates a pot from --repo (fed_hive_create_from_repo), the VM joins it through
#     discovery (fed_hive_join);
#   * rig.env (the ONLY input rig-profile.sh reads), tower-call (ptool pinned to the tower
#     owner), boot-vm.sh (the VM owner launcher the scenario restarts), vm-dep-source (the
#     repo root, whose node_modules the VM-side producer runs from), and the VM driver
#     (same-box-deploy.sh).
#
# A same-box run is diagnostic only: rig-profile.sh marks it so, and nothing it produces
# can be signed, finalized or counted as release evidence.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "$HERE/../.." && pwd)"
ROOT="$(cd "$DESKTOP_DIR/.." && pwd)"
# shellcheck source=../lib/federation-asserts.sh
source "$DESKTOP_DIR/bin/lib/federation-asserts.sh"
declare -a FED_KILL_PIDS=()

DEFAULT_REPO='https://github.com/octocat/Hello-World'   # repo id 1296269 = the physical rig's gh-1296269
# Phase E pushes to GitHub remotes only the physical rig owns.
PHYSICAL_ONLY="'E:touches the GitHub canary remotes only the physical rig owns'"

die() { echo "same-box-rig: $*" >&2; exit 2; }

cmd="${1:-}"; [ $# -gt 0 ] && shift
dir="" repo="$DEFAULT_REPO" sidecar=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) dir="${2:-}"; shift 2 ;;
    --dir=*) dir="${1#--dir=}"; shift ;;
    --repo) repo="${2:-}"; shift 2 ;;
    --repo=*) repo="${1#--repo=}"; shift ;;
    --sidecar) sidecar="${2:-}"; shift 2 ;;
    --sidecar=*) sidecar="${1#--sidecar=}"; shift ;;
    *) die "unknown argument: $1" ;;
  esac
done

state_get() { sed -n "s/^$1=//p" "$dir/rig.state" 2>/dev/null | tail -1; }

wait_health() { # <port> <label> [seconds]
  local port="$1" label="$2" secs="${3:-300}" i code
  for i in $(seq 1 "$secs"); do
    code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:$port/api/health" 2>/dev/null || true)"
    [ "$code" = 200 ] && { echo "same-box-rig: $label owner :$port healthy after ${i}s" >&2; return 0; }
    [ $((i % 30)) -eq 0 ] && echo "  … $label owner :$port not healthy yet (last=$code, ${i}s)" >&2
    sleep 1
  done
  echo "same-box-rig: $label owner :$port never answered 200 in ${secs}s" >&2
  return 1
}

# Launch one owner with the rig's saved parameters. HOME is restored to the real home first:
# the ssh shim runs boot-vm.sh with HOME=<VM home>, and the launcher links the REAL gh config.
launch_owner() { # <tower|vm>
  local role="$1" home port pg side dht real
  home="$(state_get "${role}_home")"; port="$(state_get "${role}_port")"; pg="$(state_get "${role}_pg")"
  side="$(state_get sidecar)"; dht="$(state_get dht_bootstrap)"; real="$(state_get real_home)"
  [ -n "$home" ] && [ -n "$port" ] && [ -n "$pg" ] && [ -f "$side/serve.mjs" ] && [ -n "$dht" ] \
    || die "rig.state in $dir is incomplete for $role"
  HOME="$real" FED_SMOKE_SCOPE="$dir" \
    fed_local_launch_sidecar "$home" "$dir/$role.log" "$side" "$port" "$pg" \
      PAPERCUSP_DHT_BOOTSTRAP="$dht" || return 1
  wait_health "$port" "$role"
}

cmd_up() {
  [ -n "$dir" ] || dir="$HOME/.papercusp-same-box-rigs/$(date -u +%Y%m%dT%H%M%SZ)-$$"
  [ ! -e "$dir/rig.env" ] || die "$dir already holds a rig (rig.env exists); run down first"
  mkdir -p "$dir/tower-home" "$dir/vm-home" || die "cannot create $dir"
  dir="$(cd "$dir" && pwd)"
  echo "same-box-rig: rig dir $dir" >&2

  if [ -z "$sidecar" ]; then
    sidecar="$dir/sidecar"
    echo "same-box-rig: composing a current sidecar into $sidecar (not the shared cache)" >&2
    PCUSP_RIG_COMPOSE_OUT="$sidecar" "$HERE/compose-rig-sidecar-current.sh" --no-push >"$dir/compose.log" 2>&1 \
      || { tail -20 "$dir/compose.log" >&2; die "compose-rig-sidecar-current.sh failed (log: $dir/compose.log)"; }
  fi
  [ -f "$sidecar/serve.mjs" ] || die "no serve.mjs in $sidecar"

  local dht tp tpg vp vpg
  dht="$(fed_start_testnet_dht "$ROOT" "$dir" "" 1)" || die "testnet DHT did not start (log: $dir/dht.log)"
  # The kept-up DHT carries the marker papercusp-persist-dht-<this pid> in its argv. The
  # bracket keeps pgrep from matching its own pattern.
  local dht_pid
  dht_pid="$(pgrep -f "[p]apercusp-persist-dht-$$" | head -1)"
  tp="$(fed_pick_free_port 18471)"; tpg="$(fed_pick_free_port 18532)"
  vp="$(fed_pick_free_port $((tp + 100)))"; vpg="$(fed_pick_free_port $((tpg + 100)))"
  cat >"$dir/rig.state" <<EOF
real_home=$HOME
sidecar=$sidecar
dht_bootstrap=$dht
dht_marker=papercusp-persist-dht-$$
dht_pid=$dht_pid
tower_home=$dir/tower-home
tower_port=$tp
tower_pg=$tpg
vm_home=$dir/vm-home
vm_port=$vp
vm_pg=$vpg
EOF
  launch_owner tower || die "tower owner did not come up (log: $dir/tower.log)"
  launch_owner vm || die "VM owner did not come up (log: $dir/vm.log)"

  # The pot: created on the tower from the repo, joined by the VM through discovery.
  declare -gA FED_SC=([tower]="$tp" [vm]="$vp")
  local created pot links joined
  created="$(fed_hive_create_from_repo tower "$repo")"
  printf '%s\n' "$created" >"$dir/create-from-repo.json"
  pot="$(fed_json "$created" "d['created']['potSlug']")"
  [ -n "$pot" ] || die "create-from-repo on the tower returned no potSlug (see $dir/create-from-repo.json)"
  local pot_id i row
  pot_id="$(fed_json "$created" "d['created'].get('potId') or d.get('potId') or ''")"
  for i in $(seq 1 60); do
    row="$(fed_hive_dir_row vm "${pot_id:-$pot}")"
    links="$(fed_json "$row" "json.dumps(d.get('memberLinks') or [])")"
    [ -n "$links" ] && [ "$links" != '[]' ] && break
    sleep 2
  done
  [ -n "${links:-}" ] && [ "$links" != '[]' ] || die "the VM never discovered pot $pot (tower create: $dir/create-from-repo.json)"
  joined="$(fed_hive_join vm "${pot_id:-$pot}" "$links")"
  printf '%s\n' "$joined" >"$dir/join.json"
  [ "$(fed_json "$joined" "d.get('ok')")" = True ] || die "the VM's join of $pot failed (see $dir/join.json)"

  local repo_key tower_repo vm_repo
  repo_key="$(fed_json "$created" "d['created'].get('repoKey') or ''")"
  if [ -z "$repo_key" ]; then
    tower_repo="$(ls -d "$dir/tower-home/.papercusp/pot-git/$pot"/*.git 2>/dev/null | head -1)"
    repo_key="$(basename "${tower_repo:-}" .git)"
  fi
  [ -n "$repo_key" ] || die "cannot find the pot-git repo key for $pot under $dir/tower-home/.papercusp/pot-git"
  vm_repo="$dir/vm-home/.papercusp/pot-git/$pot/$repo_key.git"
  [ -d "$vm_repo" ] || echo "same-box-rig: WARNING the VM has no $vm_repo yet (join may still be cloning)" >&2

  cat >"$dir/rig.env" <<EOF
SB_TOWER_HOME=$dir/tower-home
SB_TOWER_PORT=$tp
SB_VM_HOME=$dir/vm-home
SB_VM_PORT=$vp
SB_NODE=$(command -v node)
SB_TSX=$ROOT/node_modules/tsx/dist/cli.mjs
SB_POT_HOME=$pot
SB_REPO_KEY=$repo_key
SB_WORKSPACE=papercusp-workspace
SB_PHYSICAL_ONLY_PHASES=$PHYSICAL_ONLY
EOF
  cat >"$dir/tower-call" <<EOF
#!/usr/bin/env bash
# ptool pinned to the same-box tower owner (generated by same-box-rig.sh).
exec "$HOME/.local/bin/ptool" "\$@" --url=http://127.0.0.1:$tp
EOF
  cat >"$dir/boot-vm.sh" <<EOF
#!/usr/bin/env bash
# The same-box VM owner launcher the scenario restarts (generated by same-box-rig.sh).
exec bash '$HERE/same-box-rig.sh' start-vm --dir '$dir'
EOF
  chmod 0755 "$dir/tower-call" "$dir/boot-vm.sh"
  ln -sfn "$ROOT" "$dir/vm-dep-source"
  SAME_BOX_RIG_DIR="$dir" "$HERE/lib/same-box-deploy.sh" same-box-vm >&2 || die "same-box-deploy.sh failed"

  echo "same-box-rig: UP pot=$pot repo_key=$repo_key tower=:$tp vm=:$vp dht=$dht"
  echo "HIVE_GIT_SAME_BOX_RIG=$dir"
}

cmd_status() {
  [ -f "$dir/rig.state" ] || die "no rig at ${dir:-<unset>}"
  local role port code
  for role in tower vm; do
    port="$(state_get "${role}_port")"
    code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:$port/api/health" 2>/dev/null || true)"
    echo "$role :$port health=$code"
  done
  echo "dht $(state_get dht_bootstrap)"
}

cmd_start_vm() {
  [ -f "$dir/rig.state" ] || die "no rig at ${dir:-<unset>}"
  launch_owner vm
}

# Stop by port and by the rig's own argv markers — never by a binary name.
cmd_down() {
  [ -f "$dir/rig.state" ] || die "no rig at ${dir:-<unset>}"
  local role port pid marker
  for role in tower vm; do
    port="$(state_get "${role}_port")"
    for pid in $(ss -ltnpH "sport = :$port" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u); do
      kill -TERM "$pid" 2>/dev/null && echo "same-box-rig: stopped $role owner pid=$pid (:$port)" >&2
    done
  done
  marker="$(state_get dht_marker)"; pid="$(state_get dht_pid)"
  # Kill the recorded DHT pid only while its argv still carries this rig's marker, so a
  # recycled pid is never touched.
  if [ -n "$marker" ] && [ -n "$pid" ] && tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null | grep -qF -- "$marker"; then
    kill -TERM "$pid" 2>/dev/null && echo "same-box-rig: stopped testnet DHT pid=$pid" >&2
  fi
  rm -f "$dir/rig.env"
  echo "same-box-rig: DOWN $dir (homes kept for diagnosis; delete the directory to discard)"
}

case "$cmd" in
  up) cmd_up ;;
  status) cmd_status ;;
  start-vm) cmd_start_vm ;;
  down) cmd_down ;;
  *) die "usage: same-box-rig.sh up|status|start-vm|down [--dir <rig dir>] [--repo <github url>] [--sidecar <dir>]" ;;
esac
