#!/usr/bin/env bash
# release-seed-guard.sh: a release-audited Server build must carry the first-boot
# hive seed, or say explicitly why it does not (WI-6554700010012075).
#
# WHY: the D-223/D-224 private candidate (2026-10-13) was built from a clean
# materialized checkout. src-tauri/seed/ is gitignored, so that checkout had no seed.
# With PAPERCUSP_SKIP_SEED_CUT=1 ("reuse src-tauri/seed as-is") every producer only
# WARNed ("the Server ships without a first-boot seed") and exited 0. The Mac Server
# shipped seedless, offline self-admit is gated on a seed restore
# (packages/operator-core/lib/harness/bootstrap-papercusp-hive.ts, `seedRan`), and the
# P-521 offline-restore leg failed by construction hours after nomination.
#
# Policy, one call per producer, run BEFORE the expensive build:
#   - roles without "server": nothing to check (seed/** is Server-only).
#   - vm-release profile: seeds are excluded BY DESIGN (tauri.vm-release.conf.json).
#   - not a release audit (PAPERCUSP_RELEASE_AUDIT != 1): WARN only (dev builds).
#   - release audit + seed manifest present: pass, and print a SEED_GUARD receipt line.
#   - release audit + no seed: REFUSE, unless the caller opts out explicitly with
#       PAPERCUSP_ALLOW_SEEDLESS_RELEASE=1 and a non-empty
#       PAPERCUSP_ALLOW_SEEDLESS_REASON, which is printed into the build log.
#
# Usage: source this file, then
#   release_seed_guard "<roles>" "<distribution profile>" "<seed dir>" || exit 1

release_seed_guard() {
  local roles="${1:-}" profile="${2:-}" seed_dir="${3:-}"
  local manifest="$seed_dir/manifest.json"

  case " $roles " in
    *" server "*) ;;
    *) return 0 ;;
  esac
  if [[ "$profile" == "vm-release" ]]; then
    echo "SEED_GUARD role=server profile=vm-release seed=excluded-by-profile"
    return 0
  fi

  if [[ -f "$manifest" ]]; then
    local sha
    sha="$( (sha256sum "$manifest" 2>/dev/null || shasum -a 256 "$manifest" 2>/dev/null) | awk '{print $1}')"
    echo "SEED_GUARD role=server profile=${profile:-unknown} seed=present manifestSha256=${sha:-unknown}"
    return 0
  fi

  if [[ "${PAPERCUSP_RELEASE_AUDIT:-0}" != "1" ]]; then
    echo "WARN: no seed manifest at $manifest. This (non-release-audit) Server build ships without a first-boot seed." >&2
    return 0
  fi

  if [[ "${PAPERCUSP_ALLOW_SEEDLESS_RELEASE:-0}" == "1" ]]; then
    if [[ -z "${PAPERCUSP_ALLOW_SEEDLESS_REASON:-}" ]]; then
      echo "ERROR: PAPERCUSP_ALLOW_SEEDLESS_RELEASE=1 needs a non-empty PAPERCUSP_ALLOW_SEEDLESS_REASON (it is recorded in the build log)." >&2
      return 1
    fi
    echo "SEED_GUARD role=server profile=${profile:-unknown} seed=absent allowed=1 reason=${PAPERCUSP_ALLOW_SEEDLESS_REASON}"
    return 0
  fi

  cat >&2 <<EOF
ERROR: release-audited Server build (profile ${profile:-unknown}) has no hive seed at
         $seed_dir
       The installer would ship without the first-boot pot seed, so the pot cannot
       appear offline. src-tauri/seed/ is gitignored, so a clean release checkout
       never has one. PAPERCUSP_SKIP_SEED_CUT=1 only REUSES an existing seed.
       Fix: stage the Tower-cut seed into that directory (bin/ensure-release-seed.sh
       on the owner box, then copy it), or, for a deliberately seedless candidate,
       export PAPERCUSP_ALLOW_SEEDLESS_RELEASE=1 with
       PAPERCUSP_ALLOW_SEEDLESS_REASON='<decision ref and why>'.
EOF
  return 1
}
