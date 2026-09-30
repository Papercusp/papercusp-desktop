#!/usr/bin/env bash
# physical-phase-select.sh — which A-H phases of the hive-git physical scenario to run.
#
# physical-drill-iteration-speed-2026-09-29 P-002 (R-3). A full physical run is 18-26
# minutes; a fix to one phase should be verified in minutes. The drill takes
# `--only-phase D[,E]` or `--from-phase D`, turns it into a canonical comma list with
# physical_phase_select, and hands that list to the probe and the scenario as
# HIVE_GIT_PHYSICAL_PHASES. The scenario runs only those phases against the rig state
# the previous run left behind (the join, the pot repo, the VM install), and emits NO
# release evidence: evidence needs every phase from one run, so a partial run is a
# diagnostic, never an acceptance.
#
# One parser for all three scripts, so they cannot disagree about what a selection means.
# Sourced; defines functions only.

PHYSICAL_PHASES_ALL='A,B,C,D,E,F,G,H'

# physical_phase_select only-phase|from-phase <spec>
#   only-phase D      -> D          only-phase e,d  -> D,E   (canonical order, deduped)
#   from-phase D      -> D,E,F,G,H
# Prints the canonical list; exits 2 with a reason on stderr for anything else.
physical_phase_select() {
  local mode="${1:-}" spec p out=''
  spec="$(printf '%s' "${2:-}" | tr '[:lower:]' '[:upper:]' | tr -d ' ')"
  case "$mode" in
    only-phase)
      [[ "$spec" =~ ^[A-H](,[A-H])*$ ]] || {
        printf 'physical phase selection: --only-phase wants A-H letters, comma-separated (got %s)\n' "${2:-<empty>}" >&2
        return 2
      }
      for p in ${PHYSICAL_PHASES_ALL//,/ }; do
        case ",$spec," in *",$p,"*) out="${out:+$out,}$p" ;; esac
      done
      ;;
    from-phase)
      [[ "$spec" =~ ^[A-H]$ ]] || {
        printf 'physical phase selection: --from-phase wants one letter A-H (got %s)\n' "${2:-<empty>}" >&2
        return 2
      }
      out="${PHYSICAL_PHASES_ALL#*"${spec}"}"
      out="${spec}${out}"
      ;;
    *)
      printf 'physical phase selection: mode must be only-phase or from-phase (got %s)\n' "${mode:-<empty>}" >&2
      return 2
      ;;
  esac
  printf '%s\n' "$out"
}

# physical_phase_list [<canonical-or-loose list>] — the phases a run executes. Empty means
# all of them (the release run). Anything else is validated like --only-phase.
physical_phase_list() {
  if [ -z "${1:-}" ]; then
    printf '%s\n' "$PHYSICAL_PHASES_ALL"
    return 0
  fi
  physical_phase_select only-phase "$1"
}

# physical_phase_is_full <list> — true only when the list selects every phase, i.e. the
# run may produce release evidence.
physical_phase_is_full() {
  local list
  list="$(physical_phase_list "${1:-}")" || return 1
  [ "$list" = "$PHYSICAL_PHASES_ALL" ]
}
