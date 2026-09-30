# rig-profile.sh — the one place that says WHICH machines a physical hive-git run talks to.
#
# physical-drill-iteration-speed-2026-09-29 P-005 (R-4), design = plan decision D-003.
#
# hive-git-physical-probe.sh and hive-git-physical-scenario.sh hard-code the physical rig
# (tower = this box, VM = the macOS rig VM). Harness timing and lifecycle bugs were found one
# 18-26 minute physical run at a time. A rig PROFILE lets the SAME scenario, through the SAME
# entry point (bin/hive-git-drill.sh -> probe -> scenario), run against the same-box
# two-instance rig first, in minutes:
#
#   HIVE_GIT_RIG=physical   (default) nothing changes; every value stays the checked-in one.
#   HIVE_GIT_RIG=same-box   both halves are throwaway from-source headless operators on this
#                           box (bin/vm-rig/same-box-rig.sh up). Every host value comes from
#                           $HIVE_GIT_SAME_BOX_RIG/rig.env, and the "VM" is reached through
#                           lib/same-box-transport/{ssh,scp}, which accept ONLY the host
#                           $RIG_PROFILE_SAME_BOX_HOST and refuse every other one — a same-box
#                           run can never reach the physical rig.
#
# A same-box run is ALWAYS diagnostic: rig_profile_is_diagnostic makes the probe and the
# scenario treat it as a partial run, so nothing is ever signed, finalized or counted as
# release evidence — even when every phase is selected.
#
# Callers source this file, define their own constants, then call rig_profile_apply once
# before their first host access. The function only ASSIGNS the caller's globals.

RIG_PROFILE_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RIG_PROFILE_SAME_BOX_HOST='same-box-vm'
# The only keys rig.env may set. Anything else (or any line that is not KEY=value with a
# quoted or plain value) refuses the rig: rig.env is sourced, so it must not carry code.
RIG_PROFILE_SAME_BOX_KEYS='SB_TOWER_HOME SB_TOWER_PORT SB_TOWER_PG_PORT SB_VM_HOME SB_VM_PORT SB_VM_PG_PORT SB_NODE SB_TSX SB_POT_HOME SB_GIT_SYNC_SLUG SB_REPO_KEY SB_GITHUB_REMOTE SB_WORKSPACE SB_PHYSICAL_ONLY_PHASES'

rig_profile_name() { printf '%s\n' "${HIVE_GIT_RIG:-physical}"; }

# 0 when the active profile can never produce release evidence.
rig_profile_is_diagnostic() { [ "$(rig_profile_name)" = same-box ]; }

rig_profile_validate() { # [name] — exit 2 on an unknown profile
  case "${1:-$(rig_profile_name)}" in
    physical|same-box) return 0 ;;
    *) echo "FATAL: HIVE_GIT_RIG=${1:-$(rig_profile_name)} is not a rig profile (physical | same-box)" >&2; return 2 ;;
  esac
}

# Load and check $HIVE_GIT_SAME_BOX_RIG/rig.env into SB_* shell variables.
rig_profile_load_same_box() {
  local dir="${HIVE_GIT_SAME_BOX_RIG:-}" env line key
  if [ -z "$dir" ] || [ ! -f "$dir/rig.env" ]; then
    echo "FATAL: the same-box rig needs HIVE_GIT_SAME_BOX_RIG=<rig dir with rig.env>; bring one up with papercusp-desktop/bin/vm-rig/same-box-rig.sh up" >&2
    return 2
  fi
  env="$dir/rig.env"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    key="${line%%=*}"
    if ! printf '%s' "$line" | grep -qE "^SB_[A-Z_]+=('[^']*'|[A-Za-z0-9_./:@,+-]*)$" \
      || [[ " $RIG_PROFILE_SAME_BOX_KEYS " != *" $key "* ]]; then
      echo "FATAL: $env line is not an allowed SB_* assignment: $line" >&2
      return 2
    fi
  done <"$env"
  # shellcheck source=/dev/null
  . "$env"
  for key in SB_TOWER_HOME SB_TOWER_PORT SB_TOWER_PG_PORT SB_VM_HOME SB_VM_PORT SB_VM_PG_PORT SB_NODE SB_TSX SB_POT_HOME SB_GIT_SYNC_SLUG SB_REPO_KEY SB_GITHUB_REMOTE SB_WORKSPACE; do
    [ -n "${!key:-}" ] || { echo "FATAL: $env does not set $key" >&2; return 2; }
  done
  case "$SB_TOWER_PORT$SB_VM_PORT$SB_TOWER_PG_PORT$SB_VM_PG_PORT" in *[!0-9]*) echo "FATAL: $env ports must be numeric" >&2; return 2 ;; esac
  [ "$SB_TOWER_PORT" != "$SB_VM_PORT" ] || { echo "FATAL: $env gives the tower and the VM the same port" >&2; return 2; }
  [ "$SB_TOWER_PG_PORT" != "$SB_VM_PG_PORT" ] || { echo "FATAL: $env gives the tower and the VM the same PG port" >&2; return 2; }
  # The live operator's database is the native :5432; a rig instance must never name it.
  [ "$SB_TOWER_PG_PORT" != 5432 ] && [ "$SB_VM_PG_PORT" != 5432 ] \
    || { echo "FATAL: $env names the live operator's PG port 5432 for a rig instance" >&2; return 2; }
  [ "$SB_TOWER_HOME" != "$SB_VM_HOME" ] || { echo "FATAL: $env gives the tower and the VM the same home" >&2; return 2; }
  [ "$SB_TOWER_HOME" != "$HOME" ] && [ "$SB_VM_HOME" != "$HOME" ] \
    || { echo "FATAL: $env points an instance at the real \$HOME ($HOME); the same-box rig must use throwaway homes" >&2; return 2; }
  return 0
}

# Assign the caller's host globals for the active profile. Probe and scenario share this.
rig_profile_apply() {
  rig_profile_validate || return 2
  [ "$(rig_profile_name)" = same-box ] || return 0
  rig_profile_load_same_box || return 2
  local dir shared_vm shared_tower
  dir="$(cd "$HIVE_GIT_SAME_BOX_RIG" && pwd)"
  # The physical desktop writes its identity under ~/.papercusp-workspaces/.shared/.papercusp;
  # a same-box owner runs with HOME=<rig home> and PAPERCUSP_HOME scrubbed, so it writes
  # <rig home>/.papercusp (r5 rehearsal: the .shared path failed the host receipt).
  shared_vm="$SB_VM_HOME"
  shared_tower="$SB_TOWER_HOME"

  PHASE_A_POT_HOME="$SB_POT_HOME"
  PHASE_A_REPO_KEY="$SB_REPO_KEY"
  # The rig's pot comes from create-from-repo: a pot home plus a member checkout. git-sync
  # and the working tree belong to the member on both hosts; the pot-git store stays keyed
  # by the pot slug (VM_REPO / TOWER_REPO below).
  TOWER_GIT_SYNC_SLUG="$SB_GIT_SYNC_SLUG"
  VM_GIT_SYNC_SLUG="$SB_GIT_SYNC_SLUG"

  VM="$RIG_PROFILE_SAME_BOX_HOST"
  VM_HOME="$SB_VM_HOME"
  VM_NODE="$SB_NODE"
  VM_TSX="$SB_TSX"
  VM_REPO="$SB_VM_HOME/.papercusp/pot-git/$SB_POT_HOME/$SB_REPO_KEY.git"
  VM_CALL="$dir/vmcall.sh"
  VM_MCP_CALL="$dir/mcp-call.mjs"
  VM_OWNER_PORT="$SB_VM_PORT"
  VM_OWNER_LAUNCHER="$dir/boot-vm.sh"
  VM_OWNER_LAUNCHER_SPAWNS_ONLY=0
  VM_OWNER_IDENTITY_DIR="$shared_vm/.papercusp/identity"
  VM_IDENTITY_DIR="$shared_vm/.papercusp/identity"
  VM_CACHE="$shared_vm/.papercusp/local-announce-identity.json"
  VM_DEP_SOURCE="$dir/vm-dep-source"

  TOWER_CALL="$dir/tower-call"
  TOWER_REPO="$SB_TOWER_HOME/.papercusp/pot-git/$SB_POT_HOME/$SB_REPO_KEY.git"
  TOWER_CACHE="$shared_tower/.papercusp/local-announce-identity.json"
  DEPLOY="$RIG_PROFILE_LIB_DIR/same-box-deploy.sh"

  # No status-query rewrite here: the scenario builds its phase A status query from the
  # git-sync slug set above (phase_a_status_args), the same slug its readiness gate matches.
  # A string rewrite to the pot home split the two (same-box run 20260930T050610Z).

  # The producer's target (physicalDrillTarget in physical-drill-phase-a.ts): it reads these
  # only under HIVE_GIT_RIG=same-box and marks the run diagnostic, so it can never sign.
  export HIVE_GIT_DRILL_TARGET_POT_HOME="$SB_POT_HOME" HIVE_GIT_DRILL_TARGET_REPO_KEY="$SB_REPO_KEY" \
    HIVE_GIT_DRILL_TARGET_GITHUB_REMOTE="$SB_GITHUB_REMOTE" HIVE_GIT_DRILL_TARGET_GIT_SYNC_SLUG="$SB_GIT_SYNC_SLUG"

  # Tower-side producer calls run as the rig's throwaway tower, never as the caller's live
  # operator (same-box-transport/tower-tsx).
  TSX="$RIG_PROFILE_LIB_DIR/same-box-transport/tower-tsx"

  PATH="$RIG_PROFILE_LIB_DIR/same-box-transport:$PATH"
  export PATH HIVE_GIT_RIG HIVE_GIT_SAME_BOX_RIG
  export SAME_BOX_VM_HOME="$SB_VM_HOME" SAME_BOX_VM_PORT="$SB_VM_PORT" SAME_BOX_RIG_DIR="$dir"
  export SAME_BOX_TOWER_HOME="$SB_TOWER_HOME" SAME_BOX_TOWER_PORT="$SB_TOWER_PORT" \
    SAME_BOX_TSX="$SB_TSX" SAME_BOX_NODE="$SB_NODE"
  # Each instance's own embedded-PG port. The transports pin PAPERCUSP_PG_PORT to it, so when
  # an owner is down (the scenario restarts the VM) a producer's DB discovery falls back to the
  # rig's own dead port, never to the native :5432 live operator database (D-005).
  export SAME_BOX_TOWER_PG_PORT="$SB_TOWER_PG_PORT" SAME_BOX_VM_PG_PORT="$SB_VM_PG_PORT"
  echo "RIG_PROFILE rig=same-box vm=$VM tower_port=$SB_TOWER_PORT vm_port=$SB_VM_PORT pot=$SB_POT_HOME dir=$dir" >&2
}

# Pre-run precondition for the same-box rig: every host path the profile hands the probe and
# scenario must exist on the rig. A profile path that does not match what the rig's owners
# actually wrote (the r5 rehearsal's announce-identity cache) otherwise surfaces only after
# the slow run has started. Runs apply in a subshell so the caller's globals stay untouched.
# Prints one MISSING line per absent path; exit 0 ready, 1 not ready, 2 profile unusable.
RIG_PROFILE_SAME_BOX_PATHS='TOWER_CACHE TOWER_REPO VM_CACHE VM_IDENTITY_DIR VM_OWNER_IDENTITY_DIR VM_REPO VM_CALL VM_MCP_CALL VM_OWNER_LAUNCHER VM_DEP_SOURCE'
rig_profile_same_box_paths_ready() {
  [ "$(rig_profile_name)" = same-box ] || return 0
  (
    rig_profile_apply 2>/dev/null || exit 2
    missing=0
    for var in $RIG_PROFILE_SAME_BOX_PATHS; do
      if [ -z "${!var:-}" ] || [ ! -e "${!var}" ]; then
        echo "RIG_PROFILE_PATH_MISSING $var=${!var:-<unset>}" >&2
        missing=1
      elif [[ "$var" == *_REPO ]] && [ "$(git --git-dir="${!var}" rev-parse --is-bare-repository 2>/dev/null)" != true ]; then
        # A pot-git store is ready only once it is a bare repo. git-sync creates the directory
        # before its init lands, and same-box run 20260930T054405Z failed phase A in 50s on an
        # empty store directory that an existence check had passed.
        echo "RIG_PROFILE_PATH_NOT_A_REPO $var=${!var}" >&2
        missing=1
      fi
    done
    exit "$missing"
  )
}

# The pot-git / git-sync failure lines each same-box owner logged (<rig dir>/{tower,vm}.log),
# newest 5 per owner, prefixed with the log name. A store that never initialises says WHY in
# its OWNER's log, not in converge-*.log: same-box run 7 (WI-10003976) died pointing at the
# converge logs while vm.log held 'pot-git: init --bare failed ... refusing local git spawn'.
rig_profile_owner_git_failures() { # <rig dir>
  local role
  for role in tower vm; do
    [ -f "$1/$role.log" ] || continue
    { grep -E 'pot-git.*(failed|refus)|git-sync.*(failed|error)' "$1/$role.log" | tail -n 5 \
      | sed "s/^/  $role.log: /"; } || true
  done
  return 0
}

# Extra `physical-drill-producer rig-preflight` arguments for the active profile, one per line
# (read them with mapfile). The physical profile adds nothing: every check, both owners on
# :3070. The same-box profile points hosts-answering at the two throwaway owners' ports — the
# default :3070 there is the LIVE operator, which would report a down rig as up — and runs only
# the checks that measure THIS rig. The other three read physical-rig state that a same-box rig
# does not have (the composed VM payload stamp, the live tower's Phase D trust rows and Phase E
# canary mode); running them would measure a different machine, so the probe names them skipped.
rig_profile_preflight_args() {
  [ "$(rig_profile_name)" = same-box ] || return 0
  printf '%s\n' --check drill-source-committed --check hosts-answering \
    --tower-port "$SB_TOWER_PORT" --vm-port "$SB_VM_PORT"
  echo "RIG_PROFILE preflight=same-box checks=drill-source-committed,hosts-answering skipped=canary-mode-baseline,vm-trust-hold-ready,vm-payload-current (physical-rig state)" >&2
}

# Phases the same-box rig cannot prove (a physical-only property), as "X:reason;Y:reason".
# The probe refuses a same-box selection that includes one, naming the reason, rather than
# running a phase whose verdict would mean nothing.
rig_profile_refuse_physical_only() { # <canonical selection "A,B,…">
  [ "$(rig_profile_name)" = same-box ] || return 0
  local entry phase reason
  local IFS=';'
  for entry in ${SB_PHYSICAL_ONLY_PHASES:-}; do
    phase="${entry%%:*}"; reason="${entry#*:}"
    case ",$1," in
      *",$phase,"*)
        echo "FATAL: phase $phase needs the physical rig ($reason); drop it from the same-box selection" >&2
        return 2 ;;
    esac
  done
  return 0
}
