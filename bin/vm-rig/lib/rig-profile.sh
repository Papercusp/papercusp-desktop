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
RIG_PROFILE_SAME_BOX_KEYS='SB_TOWER_HOME SB_TOWER_PORT SB_VM_HOME SB_VM_PORT SB_NODE SB_TSX SB_POT_HOME SB_REPO_KEY SB_WORKSPACE SB_PHYSICAL_ONLY_PHASES'

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
  for key in SB_TOWER_HOME SB_TOWER_PORT SB_VM_HOME SB_VM_PORT SB_NODE SB_TSX SB_POT_HOME SB_REPO_KEY SB_WORKSPACE; do
    [ -n "${!key:-}" ] || { echo "FATAL: $env does not set $key" >&2; return 2; }
  done
  case "$SB_TOWER_PORT$SB_VM_PORT" in *[!0-9]*) echo "FATAL: $env ports must be numeric" >&2; return 2 ;; esac
  [ "$SB_TOWER_PORT" != "$SB_VM_PORT" ] || { echo "FATAL: $env gives the tower and the VM the same port" >&2; return 2; }
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
  shared_vm="$SB_VM_HOME/.papercusp-workspaces/.shared"
  shared_tower="$SB_TOWER_HOME/.papercusp-workspaces/.shared"

  PHASE_A_POT_HOME="$SB_POT_HOME"
  PHASE_A_REPO_KEY="$SB_REPO_KEY"
  TOWER_GIT_SYNC_SLUG="$SB_POT_HOME"
  VM_GIT_SYNC_SLUG="$SB_POT_HOME"

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

  # The status probes name the pot and workspace; retarget them at the same-box pot.
  PHASE_A_TOWER_STATUS_ARGS="${PHASE_A_TOWER_STATUS_ARGS//\"harnessSlug\":\"hello-world-3-pot\"/\"harnessSlug\":\"$SB_POT_HOME\"}"
  PHASE_A_TOWER_STATUS_ARGS="${PHASE_A_TOWER_STATUS_ARGS//\"workspaceId\":\"papercusp-workspace\"/\"workspaceId\":\"$SB_WORKSPACE\"}"
  PHASE_A_VM_STATUS_ARGS="${PHASE_A_VM_STATUS_ARGS//\"harnessSlug\":\"hello-world-3-pot\"/\"harnessSlug\":\"$SB_POT_HOME\"}"
  PHASE_A_VM_STATUS_ARGS="${PHASE_A_VM_STATUS_ARGS//\"workspaceId\":\"papercusp-workspace\"/\"workspaceId\":\"$SB_WORKSPACE\"}"

  PATH="$RIG_PROFILE_LIB_DIR/same-box-transport:$PATH"
  export PATH HIVE_GIT_RIG HIVE_GIT_SAME_BOX_RIG
  export SAME_BOX_VM_HOME="$SB_VM_HOME" SAME_BOX_VM_PORT="$SB_VM_PORT" SAME_BOX_RIG_DIR="$dir"
  echo "RIG_PROFILE rig=same-box vm=$VM tower_port=$SB_TOWER_PORT vm_port=$SB_VM_PORT pot=$SB_POT_HOME dir=$dir" >&2
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
