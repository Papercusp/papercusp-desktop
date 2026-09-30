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
  local port="$1" label="$2" secs="${3:-300}" logf="${4:-}" i code
  for i in $(seq 1 "$secs"); do
    code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:$port/api/health" 2>/dev/null || true)"
    [ "$code" = 200 ] && { echo "same-box-rig: $label owner :$port healthy after ${i}s" >&2; return 0; }
    # Node prints a "Node.js v<N>" trailer only when the process died on an uncaught error,
    # so a crashed owner fails here in seconds instead of after the whole health budget.
    if [ -n "$logf" ] && grep -q '^Node\.js v[0-9]' "$logf" 2>/dev/null; then
      echo "same-box-rig: $label owner :$port CRASHED after ${i}s — last lines of $logf:" >&2
      tail -n 15 "$logf" >&2
      return 1
    fi
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
  preflight_natives "$side" || return 1
  HOME="$real" FED_SMOKE_SCOPE="$dir" \
    fed_local_launch_sidecar "$home" "$dir/$role.log" "$side" "$port" "$pg" \
      PAPERCUSP_DHT_BOOTSTRAP="$dht" || return 1
  wait_health "$port" "$role" 300 "$dir/$role.log"
}

# The composed payload carries serve.mjs plus its own embedded-postgres-server copy only.
# Every externalized package (NATIVE_PKGS, @lydell/*, @embedded-postgres/<host>, ...) must
# resolve from sidecar/node_modules. On the physical VM those entries are symlinks into the
# installed app's node_modules (boot-headless-current.sh); here they link into the repo
# root's node_modules — the same tree vm-dep-source names. Only MISSING entries are added,
# so the composed embedded-postgres-server is never shadowed.
link_natives() { # <sidecar dir>
  local side="$1" src="$ROOT/node_modules" e child name n=0
  [ -d "$src" ] || { echo "same-box-rig: no $src to link natives from" >&2; return 1; }
  mkdir -p "$side/node_modules" || return 1
  for e in "$src"/*; do
    name="$(basename "$e")"
    case "$name" in
      @*)
        mkdir -p "$side/node_modules/$name" || return 1
        for child in "$e"/*; do
          [ -e "$side/node_modules/$name/${child##*/}" ] || [ -L "$side/node_modules/$name/${child##*/}" ] && continue
          ln -s "$child" "$side/node_modules/$name/${child##*/}" && n=$((n + 1))
        done ;;
      *)
        [ -e "$side/node_modules/$name" ] || [ -L "$side/node_modules/$name" ] && continue
        ln -s "$e" "$side/node_modules/$name" && n=$((n + 1)) ;;
    esac
  done
  echo "same-box-rig: linked $n package entries from $src into $side/node_modules" >&2
}

# Fail in seconds, naming the package, instead of an owner that dies on ERR_MODULE_NOT_FOUND.
preflight_natives() { # <sidecar dir>
  local side="$1" p missing=()
  for p in @lydell/node-pty @papercusp/embedded-postgres-server @embedded-postgres/linux-x64 \
           better-sqlite3 sodium-native udx-native; do
    [ -f "$side/node_modules/$p/package.json" ] || missing+=("$p")
  done
  [ ${#missing[@]} -eq 0 ] && return 0
  echo "same-box-rig: sidecar $side cannot resolve: ${missing[*]}" >&2
  echo "  (a rig-composed sidecar gets them from link_natives; a --sidecar you pass must carry them)" >&2
  return 1
}

# Put the rig's pot in the canary's steady mode and let git-sync create both pot-git stores.
# The canary runs `bridged` (since 2026-07-17), and git-sync creates a pot-git store only in a
# non-legacy mode. Everything here goes through the rig's OWN profile — the tower-tsx and ssh
# transports and the tower-call / vmcall.sh doors the scenario uses — so a profile defect fails
# `up`, in seconds, instead of the first phase. Bounded: SAME_BOX_CONVERGE_SEC (default 300).
converge_pot_git() {
  (
    export HIVE_GIT_RIG=same-box HIVE_GIT_SAME_BOX_RIG="$dir"
    # shellcheck source=lib/rig-profile.sh
    source "$HERE/lib/rig-profile.sh"
    rig_profile_apply 2>>"$dir/converge-profile.log" || exit 2
    local producer="$ROOT/packages/operator-core/lib/sync/pot-git/physical-drill-producer.ts"
    local vm_producer="$VM_DEP_SOURCE/packages/operator-core/lib/sync/pot-git/physical-drill-producer.ts"
    local budget="${SAME_BOX_CONVERGE_SEC:-300}" start=$SECONDS
    "$TSX" "$producer" same-box-pot-mode bridged >"$dir/converge-mode-tower.json" 2>>"$dir/converge-mode.log" \
      || { echo "same-box-rig: could not set the tower pot mode (log: $dir/converge-mode.log)" >&2; exit 1; }
    ssh "$VM" "'$VM_NODE' '$VM_TSX' '$vm_producer' same-box-pot-mode bridged" \
      >"$dir/converge-mode-vm.json" 2>>"$dir/converge-mode.log" \
      || { echo "same-box-rig: could not set the VM pot mode (log: $dir/converge-mode.log)" >&2; exit 1; }
    # A store counts only once it is a bare repo: git-sync creates the directory before its init
    # lands, and an existence check here let run 20260930T054405Z reach phase A on an empty store.
    bare_repo() { [ "$(git --git-dir="$1" rev-parse --is-bare-repository 2>/dev/null)" = true ]; }
    while :; do
      bare_repo "$TOWER_REPO" && [ "$(ssh "$VM" "git --git-dir='$VM_REPO' rev-parse --is-bare-repository" 2>/dev/null)" = true ] && {
        echo "same-box-rig: pot-git stores present on both owners after $((SECONDS - start))s" >&2
        exit 0
      }
      [ $((SECONDS - start)) -lt "$budget" ] || break
      printf '{"installSlug":"%s"}' "$SB_GIT_SYNC_SLUG" \
        | "$TOWER_CALL" git-sync:run --json - >>"$dir/converge-git-sync.log" 2>&1 || true
      ssh "$VM" "'$VM_CALL' git-sync:run '{\"installSlug\":\"$SB_GIT_SYNC_SLUG\"}' --workspace '$SB_WORKSPACE' --harness '$SB_POT_HOME'" \
        >>"$dir/converge-git-sync.log" 2>&1 || true
      sleep 10
    done
    store_state() { # <repo> → bare | EMPTY-DIR | MISSING
      if bare_repo "$1"; then echo bare; elif [ -d "$1" ]; then echo EMPTY-DIR; else echo MISSING; fi
    }
    echo "same-box-rig: after ${budget}s tower store $(store_state "$TOWER_REPO") ($TOWER_REPO)," \
      "VM store $(store_state "$VM_REPO") ($VM_REPO)" >&2
    # The reason a store never initialised lives in its OWNER's log, not in the converge logs.
    # Run 7 (WI-10003976) died here pointing at converge-*.log while the cause — the owner's
    # 'pot-git: init --bare failed ... refusing local git spawn' — sat unread in vm.log.
    for role in tower vm; do
      [ -f "$dir/$role.log" ] || continue
      { grep -E 'pot-git.*(failed|refus)|git-sync.*(failed|error)' "$dir/$role.log" | tail -n 5 \
        | sed "s/^/  $role.log: /" >&2; } || true
    done
    exit 1
  )
}

# Every host path the rig profile hands the probe and scenario exists on this rig
# (rig-profile.sh rig_profile_same_box_paths_ready — the drill entry runs the same check).
profile_paths_ready() {
  (
    export HIVE_GIT_RIG=same-box HIVE_GIT_SAME_BOX_RIG="$dir"
    # shellcheck source=lib/rig-profile.sh
    source "$HERE/lib/rig-profile.sh"
    rig_profile_same_box_paths_ready
  )
}

# Finish (or redo) the post-join half of `up` on a rig whose owners are up and whose rig.env is
# written: install the VM driver, then converge the pot mode and both pot-git stores. Also the
# way to re-converge after a VM owner restart.
cmd_converge() {
  [ -n "$dir" ] && [ -f "$dir/rig.env" ] || die "converge needs --dir <rig dir with rig.env>"
  dir="$(cd "$dir" && pwd)"
  # Run through bash: the git index tracks lib/same-box-deploy.sh as 100644, so a fresh
  # checkout has no exec bit (r4 rig `up` died on 'Permission denied' here).
  SAME_BOX_RIG_DIR="$dir" bash "$HERE/lib/same-box-deploy.sh" same-box-vm >&2 || die "same-box-deploy.sh failed"
  converge_pot_git || die "the pot-git stores never appeared on both owners (logs: $dir/converge-*.log)"
  profile_paths_ready || die "the rig profile names a path this rig does not have (RIG_PROFILE_PATH_MISSING above)"
  echo "same-box-rig: CONVERGED $dir"
  echo "HIVE_GIT_SAME_BOX_RIG=$dir"
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
    link_natives "$sidecar" || die "could not link native packages into $sidecar"
  fi
  [ -f "$sidecar/serve.mjs" ] || die "no serve.mjs in $sidecar"
  preflight_natives "$sidecar" || die "the sidecar cannot boot (missing packages above)"

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

  # The repo key is canonical gh-<GitHub repository id> (the join link carries the same
  # repo_key); create-from-repo reports the id, not the key.
  local repo_key gh_id vm_repo
  repo_key="$(fed_json "$created" "d['created'].get('repoKey') or ''")"
  if [ -z "$repo_key" ]; then
    gh_id="$(fed_json "$created" "d['created'].get('githubRepositoryId') or ''")"
    case "$gh_id" in ''|*[!0-9]*) ;; *) repo_key="gh-$gh_id" ;; esac
  fi
  [ -n "$repo_key" ] || die "create-from-repo returned neither repoKey nor githubRepositoryId (see $dir/create-from-repo.json)"
  # create-from-repo makes a pot home plus a member checkout; the member owns git-sync and the
  # working tree on the tower, and the VM's join must register the same member slug.
  local git_sync_slug vm_member
  git_sync_slug="$(fed_json "$created" "d['created'].get('memberSlug') or ''")"
  vm_member="$(fed_json "$joined" "((d.get('members') or [{}])[0]).get('slug') or ''")"
  [ -n "$git_sync_slug" ] || die "create-from-repo returned no memberSlug (see $dir/create-from-repo.json)"
  [ "$vm_member" = "$git_sync_slug" ] \
    || die "the VM joined member '$vm_member', the tower's member is '$git_sync_slug' (see $dir/join.json)"

  cat >"$dir/rig.env" <<EOF
SB_TOWER_HOME=$dir/tower-home
SB_TOWER_PORT=$tp
SB_TOWER_PG_PORT=$tpg
SB_VM_HOME=$dir/vm-home
SB_VM_PORT=$vp
SB_VM_PG_PORT=$vpg
SB_NODE=$(command -v node)
SB_TSX=$ROOT/node_modules/tsx/dist/cli.mjs
SB_POT_HOME=$pot
SB_GIT_SYNC_SLUG=$git_sync_slug
SB_REPO_KEY=$repo_key
SB_GITHUB_REMOTE=${repo%.git}
SB_WORKSPACE=papercusp-workspace
SB_PHYSICAL_ONLY_PHASES=$PHYSICAL_ONLY
EOF
  cat >"$dir/tower-call" <<EOF
#!/usr/bin/env bash
# ptool pinned to the same-box tower owner (generated by same-box-rig.sh). It runs AS the
# tower: its HOME holds the superuser token that owner accepts, and the caller's operator
# home/database/credential variables are scrubbed (the caller's token is refused there).
exec env -u PAPERCUSP_HOME -u DATABASE_URL -u PAPERCUSP_DATABASE_URL -u HARNESS_DATABASE_URL \\
  -u HARNESS_ADMIN_DATABASE_URL -u PAPERCUSP_PG_URL -u GH_TOKEN -u GITHUB_TOKEN \\
  HOME='$dir/tower-home' "$HOME/.local/bin/ptool" "\$@" --url=http://127.0.0.1:$tp
EOF
  cat >"$dir/boot-vm.sh" <<EOF
#!/usr/bin/env bash
# The same-box VM owner launcher the scenario restarts (generated by same-box-rig.sh).
exec bash '$HERE/same-box-rig.sh' start-vm --dir '$dir'
EOF
  chmod 0755 "$dir/tower-call" "$dir/boot-vm.sh"
  ln -sfn "$ROOT" "$dir/vm-dep-source"
  SAME_BOX_RIG_DIR="$dir" bash "$HERE/lib/same-box-deploy.sh" same-box-vm >&2 || die "same-box-deploy.sh failed"
  converge_pot_git || die "the pot-git stores never appeared on both owners (logs: $dir/converge-*.log)"
  profile_paths_ready || die "the rig profile names a path this rig does not have (RIG_PROFILE_PATH_MISSING above)"

  echo "same-box-rig: UP pot=$pot git_sync=$git_sync_slug repo_key=$repo_key tower=:$tp vm=:$vp dht=$dht"
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
  converge) cmd_converge ;;
  status) cmd_status ;;
  start-vm) cmd_start_vm ;;
  down) cmd_down ;;
  *) die "usage: same-box-rig.sh up|status|start-vm|down [--dir <rig dir>] [--repo <github url>] [--sidecar <dir>]" ;;
esac
